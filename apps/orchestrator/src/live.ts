// Live adapters: Airwallex sandbox card holds and Metal testnet clearing, behind the engine's ports.

import { randomUUID } from "node:crypto";
import { type Cents, type Millionths, baseUnitsToMillionths, formatUsd, millionths, millionthsToDecimal, parseUsd } from "@meter/core";
import { type AirwallexClient, type PaymentIntent, cancelHold, captureHold, createIntent, getIntent, holdState, incrementHold } from "@meter/airwallex";
import { METAL_NETWORKS } from "@metalntwx/metal-pay";
import type { Market } from "@meter/providers";
import type { ApprovalsPort, HoldRaiseRequest, HoldReceipt, HoldsPort, MarketPort, Offer } from "./ports.ts";

/** The market runs in this process; shocks change the provider's next 402 directly. */
export class LiveMarket implements MarketPort {
  private readonly market: Market;
  private readonly baseUrl: string;

  constructor(market: Market, baseUrl: string) {
    this.market = market;
    this.baseUrl = baseUrl;
  }
  async offers(): Promise<Offer[]> {
    return [...this.market.providers.values()].map((p) => ({ id: p.id, kind: p.kind, tier: p.tier ?? null, price: p.price, latencyMs: p.latencyMs }));
  }
  url(id: string, query: Record<string, string>) {
    return `${this.baseUrl}/${id}?${new URLSearchParams(query)}`;
  }
  private provider(id: string) {
    const p = this.market.providers.get(id);
    if (!p) throw new Error(`no provider ${id}`);
    return p;
  }
  async setLatency(id: string, latencyMs: number) {
    this.provider(id).latencyMs = latencyMs;
  }
  async setPrice(id: string, price: Millionths) {
    this.provider(id).price = price;
  }
  async dropNext(id: string) {
    this.provider(id).dropNext = true;
  }
  clearingKey(id: string) {
    return this.provider(id).clearingKey;
  }
  async settled(id: string): Promise<Millionths> {
    const res = await fetch(`${METAL_NETWORKS.testnet.facilitatorUrl}/settlements?payTo=${this.clearingKey(id)}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`/settlements -> HTTP ${res.status}`);
    const body = (await res.json()) as { settlements?: Array<{ amount?: string }> } | Array<{ amount?: string }>;
    const rows = Array.isArray(body) ? body : (body.settlements ?? []);
    return millionths(rows.reduce((sum, r) => sum + baseUnitsToMillionths(BigInt(r.amount ?? "0")), 0n));
  }
}

export interface PendingHold {
  jobId: string;
  customer: string;
  amount: string;
  intentId: string;
  clientSecret: string;
  currency: string;
}

/**
 * `open` creates the intent and waits. The customer's browser confirms it through Airwallex's hosted card
 * fields, then tells us; we re-read the intent ourselves, so a browser can't claim a hold it didn't place.
 */
export class LiveHolds implements HoldsPort {
  private readonly awx: AirwallexClient;
  private readonly runId: string;
  private readonly captureIds = new Map<string, string>();
  private readonly waiting = new Map<string, { pending: PendingHold; resolve: (r: HoldReceipt) => void; reject: (e: Error) => void }>();
  onAwaiting: ((p: PendingHold) => void) | null = null;

  constructor(awx: AirwallexClient, runId: string) {
    this.awx = awx;
    this.runId = runId;
  }

  async open(job: { id: string; customer: string; amount: Cents }): Promise<HoldReceipt> {
    const pi = await createIntent(this.awx, {
      amount: job.amount,
      currency: "USD",
      merchantOrderId: `meter-${this.runId}-${job.id}`.slice(0, 64),
      requestId: randomUUID(),
      descriptor: "METER TAB",
      metadata: { job: job.id, run: this.runId },
    });
    if (!pi.client_secret) throw new Error(`Airwallex returned no client secret for ${pi.id}`);
    const pending: PendingHold = { jobId: job.id, customer: job.customer, amount: formatUsd(job.amount), intentId: pi.id, clientSecret: pi.client_secret, currency: pi.currency };
    return new Promise<HoldReceipt>((resolve, reject) => {
      this.waiting.set(job.id, { pending, resolve, reject });
      this.onAwaiting?.(pending);
    });
  }

  pendingFor(jobId: string): PendingHold | null {
    return this.waiting.get(jobId)?.pending ?? null;
  }

  pendingAll(): PendingHold[] {
    return [...this.waiting.values()].map((w) => w.pending);
  }

  /** The browser says it's done. Trust only what Airwallex reports. */
  async confirmed(jobId: string): Promise<HoldReceipt> {
    const w = this.waiting.get(jobId);
    if (!w) throw new Error(`no hold waiting for job ${jobId}`);
    const pi = await getIntent(this.awx, w.pending.intentId);
    if (pi.status !== "REQUIRES_CAPTURE") throw new Error(`hold for job ${jobId} reads ${pi.status}, not REQUIRES_CAPTURE`);
    const type = pi.latest_payment_attempt?.payment_method_options?.card?.authorization_type;
    if (type !== "pre_auth") throw new Error(`hold for job ${jobId} is ${type}, and only a pre_auth can be raised`);
    const receipt = toReceipt(pi);
    this.waiting.delete(jobId);
    w.resolve(receipt);
    return receipt;
  }

  async declined(jobId: string): Promise<void> {
    const w = this.waiting.get(jobId);
    if (!w) return;
    this.waiting.delete(jobId);
    await cancelHold(this.awx, w.pending.intentId, { requestId: randomUUID(), reason: "customer did not approve the hold" }).catch(() => undefined);
    w.reject(new Error("customer did not approve the hold"));
  }

  async increment(intentId: string, newTotal: Cents): Promise<HoldReceipt> {
    return toReceipt(await incrementHold(this.awx, intentId, { newTotal, requestId: randomUUID() }));
  }

  async capture(intentId: string, amount: Cents) {
    // The same id on every try, so a retry after a lost answer can't become a second capture.
    const requestId = this.captureIds.get(intentId) ?? randomUUID();
    this.captureIds.set(intentId, requestId);
    const pi = await captureHold(this.awx, intentId, { amount, requestId });
    return { ...toReceipt(pi), captured: parseUsd(pi.captured_amount ?? 0) };
  }

  async cancel(intentId: string, reason: string): Promise<HoldReceipt> {
    return toReceipt(await cancelHold(this.awx, intentId, { requestId: randomUUID(), reason }));
  }
}

function toReceipt(pi: PaymentIntent): HoldReceipt {
  const s = holdState(pi);
  return { intentId: s.intentId, authorized: s.authorized, status: s.status };
}

/** Waits for the customer's decision from the page. Silence past the timeout counts as no. */
export class WebApprovals implements ApprovalsPort {
  private readonly timeoutMs: number;
  private readonly waiting = new Map<string, { request: HoldRaiseRequest; resolve: (yes: boolean) => void }>();

  constructor(timeoutMs = 10 * 60_000) {
    this.timeoutMs = timeoutMs;
  }

  requestHoldRaise(request: HoldRaiseRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.answer(request.jobId, false), this.timeoutMs);
      this.waiting.set(request.jobId, {
        request,
        resolve: (yes) => {
          clearTimeout(timer);
          resolve(yes);
        },
      });
    });
  }

  pending(): Array<{ jobId: string; customer: string; currentHold: string; newTotal: string; spent: string; message: string }> {
    return [...this.waiting.values()].map(({ request: r }) => ({ jobId: r.jobId, customer: r.customer, currentHold: formatUsd(r.currentHold), newTotal: formatUsd(r.newTotal), spent: millionthsToDecimal(r.spent), message: r.message }));
  }

  /** `newTotal` binds the answer to the amount the customer saw; a stale page can't approve a different one. */
  answer(jobId: string, yes: boolean, newTotal?: string): boolean {
    const w = this.waiting.get(jobId);
    if (!w) return false;
    if (yes && newTotal !== formatUsd(w.request.newTotal)) return false;
    this.waiting.delete(jobId);
    w.resolve(yes);
    return true;
  }
}
