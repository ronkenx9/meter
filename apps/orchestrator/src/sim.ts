// Offline adapters: the same engine and rules with no network, keys or funds.
// These enforce what the real rails enforce (spend only what's deposited, capture once and never above
// the hold, increments must go up), so a bug in the engine fails here the way it would live.

import { type Cents, type Millionths, type Scenario, cents, millionths, millionthsToBaseUnits, sumMillionths } from "@meter/core";
import type { ApprovalsPort, HoldReceipt, HoldRaiseRequest, HoldsPort, MarketPort, Offer, PayResult, WalletPayment, WalletPort, WithdrawResult } from "./ports.ts";

export class SimMarket implements MarketPort {
  private readonly list: Offer[];
  readonly ledger = new Map<string, Millionths>();
  private readonly drop = new Set<string>();

  constructor(s: Scenario) {
    this.list = s.providers.map((p) => ({ id: p.id, kind: p.kind, tier: p.tier ?? null, price: p.price, latencyMs: p.latencyMs }));
  }
  async offers() {
    return this.list.map((o) => ({ ...o }));
  }
  url(id: string, query: Record<string, string>) {
    return `sim://${id}?${new URLSearchParams(query)}`;
  }
  async setLatency(id: string, latencyMs: number) {
    this.list.find((o) => o.id === id)!.latencyMs = latencyMs;
  }
  async setPrice(id: string, price: Millionths) {
    this.list.find((o) => o.id === id)!.price = price;
  }
  async dropNext(id: string) {
    this.drop.add(id);
  }
  clearingKey(id: string) {
    return `key-${id}`;
  }
  async settled(id: string) {
    return this.ledger.get(id) ?? millionths(0n);
  }
  /** One paid request: charges the settlement ledger, and may fail after taking the money. */
  serve(id: string, amount: Millionths): { status: number; body: string } {
    this.ledger.set(id, millionths((this.ledger.get(id) ?? 0n) + amount));
    if (this.drop.delete(id)) return { status: 503, body: JSON.stringify({ error: "provider failed after payment" }) };
    return { status: 200, body: JSON.stringify({ provider: id, text: `text from ${id}` }) };
  }
  priceOf(id: string) {
    return this.list.find((o) => o.id === id)!.price;
  }
}

export class SimWallet implements WalletPort {
  private deposited = 0n;
  private readonly record: WalletPayment[] = [];
  private seq = 0;
  private readonly market: SimMarket;
  private readonly maxPayment: Millionths;
  private readonly jobId: string;
  private readonly delayMs: number;
  withdrawn = 0;

  constructor(market: SimMarket, maxPayment: Millionths, jobId: string, delayMs = 0) {
    this.market = market;
    this.maxPayment = maxPayment;
    this.jobId = jobId;
    this.delayMs = delayMs;
  }
  async deposit(amount: Millionths) {
    this.deposited += amount;
  }
  async payments() {
    return [...this.record];
  }
  async spent() {
    return sumMillionths(this.record.map((p) => p.amount));
  }
  /** Mirrors testnet: not final yet, then queue, then wait, then the payout, then nothing left. */
  async withdraw(): Promise<WithdrawResult> {
    this.withdrawn++;
    const unused = this.deposited - (await this.spent());
    switch (this.withdrawn) {
      case 1:
        return { status: "empty" };
      case 2:
        return { status: "sent", claimed: [], queued: { tx: "0xqueue" } };
      case 3:
        return { status: "waiting", epoch: 1n };
      case 4:
        return { status: "sent", claimed: unused > 0n ? [{ amount: millionthsToBaseUnits(millionths(unused)), tx: "0xclaim" }] : [], queued: null };
      default:
        return { status: "empty" };
    }
  }
  async pay(url: string): Promise<PayResult> {
    const id = new URL(url).host;
    const price = this.market.priceOf(id);
    if (price > this.maxPayment) return { kind: "unpaid", status: 402, body: "offer above maxAmount", tries: 1, ms: 0 };
    if ((await this.spent()) + price > this.deposited) return { kind: "needs_deposit", tries: 1, ms: 0, detail: "deposit too low" };
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs * (0.7 + Math.random() * 0.6)));
    const payment: WalletPayment = { id: `${this.jobId}-${++this.seq}`, amount: price, recipient: this.market.clearingKey(id) };
    this.record.push(payment);
    const served = this.market.serve(id, price);
    return { kind: "paid", status: served.status, body: served.body, price, payment, tries: 1, ms: 0 };
  }
}

export class SimHolds implements HoldsPort {
  readonly holds = new Map<string, { authorized: Cents; captures: number; cancelled: boolean; captured: Cents }>();
  private n = 0;
  readonly events: string[] = [];

  async open(job: { id: string; amount: Cents }): Promise<HoldReceipt> {
    const intentId = `int_sim_${job.id}_${++this.n}`;
    this.holds.set(intentId, { authorized: job.amount, captures: 0, cancelled: false, captured: cents(0n) });
    return { intentId, authorized: job.amount, status: "REQUIRES_CAPTURE" };
  }
  async increment(intentId: string, newTotal: Cents) {
    const h = this.holds.get(intentId)!;
    if (newTotal <= h.authorized) throw new Error("Invalid amount, must be greater than previous authorized amount");
    h.authorized = newTotal;
    this.events.push(`increment ${intentId} ${newTotal}`);
    return { intentId, authorized: newTotal, status: "REQUIRES_CAPTURE" };
  }
  async capture(intentId: string, amount: Cents) {
    const h = this.holds.get(intentId)!;
    if (h.captures > 0) throw new Error("invalid_status_for_operation");
    if (amount > h.authorized) throw new Error("amount_above_limit");
    h.captures++;
    h.captured = amount;
    this.events.push(`capture ${intentId} ${amount}`);
    return { intentId, authorized: h.authorized, captured: amount, status: "SUCCEEDED" };
  }
  async cancel(intentId: string) {
    const h = this.holds.get(intentId)!;
    h.cancelled = true;
    return { intentId, authorized: h.authorized, status: "CANCELLED" };
  }
}

export class SimApprovals implements ApprovalsPort {
  readonly requests: HoldRaiseRequest[] = [];
  private readonly decide: (r: HoldRaiseRequest) => boolean;
  constructor(decide: (r: HoldRaiseRequest) => boolean = () => true) {
    this.decide = decide;
  }
  async requestHoldRaise(r: HoldRaiseRequest) {
    this.requests.push(r);
    return this.decide(r);
  }
}
