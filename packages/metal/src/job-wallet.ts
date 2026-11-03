// One clearing wallet per job: deposit, pay providers per request, read the wallet's own record, withdraw.
// A wallet pays one request at a time, so concurrency comes from one wallet per job, never from sharing one.

import {
  ClearingRefusal,
  METAL_NETWORKS,
  USDZ,
  clearingBalance,
  clearingSpendable,
  createClearingClient,
  createMetalPaymentClient,
  depositToClearing,
  registerClearingClient,
  withdrawFromClearing,
} from "@metalntwx/metal-pay";
import { openClearingWallet } from "@metalntwx/metal-pay/node";
import { type Millionths, baseUnitsToMillionths, millionthsToBaseUnits, sumMillionths } from "@meter/core";
import type { PrivateKeyAccount } from "viem/accounts";

type Hex = `0x${string}`;
type Wallet = Awaited<ReturnType<typeof openClearingWallet>>;

export const CHAIN_ID = 63825;
export const NETWORK = "eip155:63825" as const;

export interface ClearingDeployment {
  settlement: Hex;
  serviceUrl: string;
  validatorUrls: string[];
}

/** The deployment the facilitator settles against. Never hard-coded: the offer must match it. */
export async function readDeployment(fetcher: typeof fetch = fetch): Promise<ClearingDeployment> {
  const res = await fetcher(`${METAL_NETWORKS.testnet.facilitatorUrl}/supported`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`facilitator /supported -> HTTP ${res.status}`);
  const { kinds } = (await res.json()) as { kinds: Array<{ scheme: string; network: string; extra?: Record<string, unknown> }> };
  const kind = kinds.find((k) => k.scheme === "bajillion" && k.network === NETWORK);
  if (!kind?.extra) throw new Error(`facilitator lists no clearing deployment for ${NETWORK}`);
  return {
    settlement: kind.extra.settlement as Hex,
    serviceUrl: kind.extra.serviceUrl as string,
    validatorUrls: (kind.extra.validatorUrls as string[]) ?? [],
  };
}

export interface RecordedPayment {
  id: string;
  amount: Millionths;
  /** The seller's clearing key, which identifies the provider. */
  recipient: string;
}

export type PayOutcome =
  | { kind: "paid"; status: number; body: string; price: Millionths; payment: RecordedPayment; tries: number; ms: number }
  /** The server answered without taking a payment (an error, or a refused offer). */
  | { kind: "unpaid"; status: number; body: string; tries: number; ms: number }
  | { kind: "needs_deposit"; tries: number; ms: number; detail: string }
  /** A lost-answer payment is held for another URL; it must be resent there before anything else. */
  | { kind: "held"; url: string | null; amount: string; tries: number; ms: number; detail: string };

export interface JobWalletConfig {
  directory: string;
  rpcUrl: string;
  operator: PrivateKeyAccount;
  deployment: ClearingDeployment;
  /** The dearest price this job accepts; a dearer offer is refused before anything is signed. */
  maxPayment: Millionths;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A few epoch gaps; past this the service is down, not between epochs.
const MAX_TRIES = 40;

export class JobWallet {
  readonly directory: string;
  private readonly wallet: Wallet;
  private readonly config: JobWalletConfig;
  private readonly fetchWithPayment: ReturnType<typeof createMetalPaymentClient>["fetchWithPayment"];
  private readonly clearing: ReturnType<typeof createClearingClient>;

  private constructor(config: JobWalletConfig, wallet: Wallet) {
    this.config = config;
    this.directory = config.directory;
    this.wallet = wallet;
    const { client, fetchWithPayment } = createMetalPaymentClient({ account: config.operator, network: "testnet" });
    this.clearing = createClearingClient({
      serviceUrl: config.deployment.serviceUrl,
      rpcUrl: config.rpcUrl,
      network: NETWORK,
      settlement: config.deployment.settlement,
      asset: USDZ.address as Hex,
      signer: wallet.signer,
      store: wallet.store,
      maxAmount: millionthsToBaseUnits(config.maxPayment),
    });
    registerClearingClient(client, NETWORK, this.clearing);
    this.fetchWithPayment = fetchWithPayment;
  }

  static async open(config: JobWalletConfig): Promise<JobWallet> {
    return new JobWallet(config, await openClearingWallet(config.directory));
  }

  get account(): Hex {
    return this.wallet.signer.publicKey as Hex;
  }

  /** Pays from the next epoch. Callers must serialize deposits across wallets: they share one operator nonce. */
  async deposit(amount: Millionths): Promise<void> {
    await depositToClearing({
      rpcUrl: this.config.rpcUrl,
      chainId: CHAIN_ID,
      from: this.config.operator,
      settlement: this.config.deployment.settlement,
      asset: USDZ.address as Hex,
      account: this.account,
      amount: millionthsToBaseUnits(amount),
    });
  }

  /** The wallet's own record: what was actually paid, including requests that failed after payment. */
  async payments(): Promise<RecordedPayment[]> {
    const state = await this.wallet.store.load();
    return Object.entries(state?.payments ?? {}).map(([id, p]) => ({
      id,
      amount: baseUnitsToMillionths(BigInt(p.invoice.amount)),
      recipient: p.invoice.recipient,
    }));
  }

  async spent(): Promise<Millionths> {
    return sumMillionths((await this.payments()).map((p) => p.amount));
  }

  /** The service's estimate only; it can read low around an epoch close. Budget from the ledger, not this. */
  async spendable(): Promise<bigint> {
    return clearingSpendable({
      rpcUrl: this.config.rpcUrl,
      settlement: this.config.deployment.settlement,
      serviceUrl: this.config.deployment.serviceUrl,
      account: this.account,
    });
  }

  async balance() {
    return clearingBalance(this.config.deployment.serviceUrl, this.account);
  }

  /**
   * Buys one request. Waits out epoch gaps, and resends a lost-answer payment to the same URL, which
   * can never pay twice. A held payment for a different URL is returned to the caller, who must not reroute.
   */
  async pay(url: string, init?: RequestInit): Promise<PayOutcome> {
    const before = new Set((await this.payments()).map((p) => p.id));
    const started = Date.now();
    let tries = 0;
    for (;;) {
      tries++;
      const ms = () => Date.now() - started;
      try {
        const res = await this.fetchWithPayment(url, init);
        const body = await res.text();
        const fresh = (await this.payments()).find((p) => !before.has(p.id));
        if (fresh) return { kind: "paid", status: res.status, body, price: fresh.amount, payment: fresh, tries, ms: ms() };
        return { kind: "unpaid", status: res.status, body, tries, ms: ms() };
      } catch (error) {
        const refusal = asRefusal(error);
        if (!refusal) throw error;
        const ms_ = ms();
        if (tries >= MAX_TRIES) throw new Error(`gave up after ${tries} tries on ${url}: ${refusal.message}`, { cause: error });
        if (refusal.retry.action === "deposit") return { kind: "needs_deposit", tries, ms: ms_, detail: refusal.message };
        if (refusal.retry.action === "repeat_same_request" && refusal.retry.url !== null && refusal.retry.url !== url) {
          return { kind: "held", url: refusal.retry.url, amount: refusal.retry.amount, tries, ms: ms_, detail: refusal.message };
        }
        await sleep(refusal.retry.ms);
      }
    }
  }

  /** The held payment, if a lost answer left one. */
  async held() {
    return this.clearing.pendingInvoice();
  }

  /** Queue, wait, claim: call again until `empty`. Paid to the operator. */
  async withdraw() {
    return withdrawFromClearing({
      rpcUrl: this.config.rpcUrl,
      chainId: CHAIN_ID,
      from: this.config.operator,
      settlement: this.config.deployment.settlement,
      serviceUrl: this.config.deployment.serviceUrl,
      signer: this.wallet.signer,
    });
  }
}

function asRefusal(error: unknown): ClearingRefusal | null {
  if (error instanceof ClearingRefusal) return error;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof ClearingRefusal ? cause : null;
}
