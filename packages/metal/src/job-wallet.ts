// One clearing wallet per job: deposit, pay providers per request, read the wallet's own record, withdraw.
// A wallet pays one request at a time, so concurrency comes from one wallet per job, never from sharing one.

import {
  ClearingRefusal,
  METAL_NETWORKS,
  USDZ,
  clearingAbi,
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
import { createPublicClient, createWalletClient, http } from "viem";
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
  | { kind: "held"; url: string | null; amount: string; tries: number; ms: number; detail: string }
  /** The offer named a different payee or a higher price than agreed. Nothing was signed. */
  | { kind: "refused"; reason: string; tries: number; ms: number };

/** What the buyer agreed to before asking: who gets paid, and at most how much. */
export interface ExpectedOffer {
  price: Millionths;
  recipient: string;
}

const REFUSED = "METER refused the offer: ";

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
  /** Set for the length of one pay() call; a wallet pays one request at a time. */
  private expect: ExpectedOffer | null = null;

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
    // The second lock: checked against the offer actually being signed, so a 402 that changes between
    // quote and payment can't slip through.
    client.onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
      const e = this.expect;
      if (!e) return;
      if (r.payTo.toLowerCase() !== e.recipient.toLowerCase()) return { abort: true, reason: `${REFUSED}it pays ${r.payTo}, not the provider's key` };
      const asked = baseUnitsToMillionths(BigInt(r.amount));
      if (asked > e.price) return { abort: true, reason: `${REFUSED}it asks ${asked} millionths, above the quoted ${e.price}` };
    });
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
    try {
      await depositToClearing({
        rpcUrl: this.config.rpcUrl,
        chainId: CHAIN_ID,
        from: this.config.operator,
        settlement: this.config.deployment.settlement,
        asset: USDZ.address as Hex,
        account: this.account,
        amount: millionthsToBaseUnits(amount),
      });
    } catch (e) {
      // "Sent, outcome unknown" is not an answer the books can use. Find out, so the money is either in the
      // wallet or provably still with the operator. If that can't be settled either, the original error stands.
      const sent = unknownOutcome(e);
      if (!sent) throw e;
      const landed = await this.settle(sent.hash, sent.nonce).catch(() => null);
      if (landed === null) throw e;
      if (landed && sent.call === "deposit") return;
      throw new Error(`${sent.call} ${sent.hash} ${landed ? "landed, but the deposit after it was never sent" : "never landed and now never can"}: nothing moved, so it is safe to send again`, { cause: e });
    }
  }

  /**
   * Whether a transaction of unknown outcome landed. It waits for a receipt; if none comes, it spends the same
   * nonce on an empty transaction, so the first one can never land late. True: landed. False: it never will.
   */
  private async settle(hash: Hex, nonce: number): Promise<boolean> {
    const chain = createPublicClient({ transport: http(this.config.rpcUrl) });
    const from = this.config.operator.address;
    const receipt = () => chain.getTransactionReceipt({ hash }).then((r) => r.status === "success", () => null);
    const decided = async (tries: number): Promise<boolean | null> => {
      for (let i = 0; i < tries; i++) {
        const r = await receipt();
        if (r !== null) return r;
        // The nonce went to something else, so this one is dead. One last look in case it mined just now.
        if ((await chain.getTransactionCount({ address: from })) > nonce) return (await receipt()) ?? false;
        await sleep(3000);
      }
      return null;
    };
    const first = await decided(15);
    if (first !== null) return first;
    const fees = await chain.estimateFeesPerGas();
    await createWalletClient({ account: this.config.operator, transport: http(this.config.rpcUrl) })
      .sendTransaction({ chain: null, to: from, value: 0n, nonce, gas: 21_000n, maxFeePerGas: fees.maxFeePerGas * 3n + 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 3n + 2n })
      .catch(() => undefined);
    const second = await decided(20);
    if (second === null) throw new Error(`could not settle ${hash}`);
    return second;
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
  async pay(url: string, expect?: ExpectedOffer, init?: RequestInit): Promise<PayOutcome> {
    this.expect = expect ?? null;
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
        const refused = refusedReason(error);
        if (refused) return { kind: "refused", reason: refused, tries, ms: ms() };
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

  /** When a waiting epoch's challenge window closes, so a countdown can replace polling. Null if it can't be read. */
  async claimableAt(epoch: bigint): Promise<Date | null> {
    try {
      const chain = createPublicClient({ transport: http(this.config.rpcUrl) });
      const context = (await chain.readContract({ address: this.config.deployment.settlement, abi: clearingAbi, functionName: "contextOf", args: [epoch] })) as { challengeDeadline?: bigint };
      return context.challengeDeadline ? new Date(Number(context.challengeDeadline) * 1000) : null;
    } catch {
      return null;
    }
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

/** The SDK's "sent, outcome unknown" error names the call, its hash and its nonce. */
export function unknownOutcome(error: unknown): { call: string; hash: Hex; nonce: number } | null {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const m = /(\w+) (0x[0-9a-f]{64}) with nonce (\d+) was sent and its outcome is unknown/.exec(String((e as Error).message ?? e));
    if (m) return { call: m[1]!, hash: m[2] as Hex, nonce: Number(m[3]) };
  }
  return null;
}

/** Our own abort, wherever the x402 client wrapped it. */
function refusedReason(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const at = String((e as Error).message ?? e).indexOf(REFUSED);
    if (at >= 0) return String((e as Error).message ?? e).slice(at + REFUSED.length);
  }
  return null;
}

function asRefusal(error: unknown): ClearingRefusal | null {
  if (error instanceof ClearingRefusal) return error;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof ClearingRefusal ? cause : null;
}
