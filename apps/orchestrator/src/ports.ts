// The engine only talks to these interfaces. Live adapters use Airwallex and Metal;
// sim adapters run the same decisions offline, so every sandbox-only call sits behind one seam.

import type { Cents, Millionths, ProviderKind } from "@meter/core";
import type { Proposal } from "@meter/policy";

export interface Offer {
  id: string;
  kind: ProviderKind;
  tier: string | null;
  price: Millionths;
  latencyMs: number;
}

export interface MarketPort {
  offers(): Promise<Offer[]>;
  url(providerId: string, query: Record<string, string>): string;
  /** Shock controls. Live, these change the next 402; they never touch a buyer's cache. */
  setLatency(providerId: string, latencyMs: number): Promise<void>;
  setPrice(providerId: string, price: Millionths): Promise<void>;
  dropNext(providerId: string): Promise<void>;
  /** The next paid request goes through, but its answer never arrives. */
  loseNext(providerId: string): Promise<void>;
  /** The provider's clearing key, which is how a wallet's payments map back to it. */
  clearingKey(providerId: string): string;
  /** Total the settlement layer has recorded for this provider, for reconciliation. */
  settled(providerId: string): Promise<Millionths>;
}

export interface WalletPayment {
  id: string;
  amount: Millionths;
  recipient: string;
}

export type PayResult =
  | { kind: "paid"; status: number; body: string; price: Millionths; payment: WalletPayment; tries: number; ms: number }
  | { kind: "unpaid"; status: number; body: string; tries: number; ms: number }
  | { kind: "needs_deposit"; tries: number; ms: number; detail: string }
  | { kind: "held"; url: string | null; amount: string; tries: number; ms: number; detail: string };

export interface WalletPort {
  deposit(amount: Millionths): Promise<void>;
  pay(url: string): Promise<PayResult>;
  payments(): Promise<WalletPayment[]>;
  spent(): Promise<Millionths>;
  withdraw(): Promise<WithdrawResult>;
}

/** Leaving clearing takes two calls with a wait between: queue the final balance, then claim the payout. */
export type WithdrawResult =
  /** Nothing final to take yet (recent payments still in their challenge window), or nothing left. */
  | { status: "empty" }
  /** A withdrawal is queued and its epoch isn't final. */
  | { status: "waiting"; epoch?: bigint | string }
  | { status: "sent"; claimed: Array<{ amount: bigint; tx: string }>; queued: { tx: string } | null }
  | { status: "deferred"; [key: string]: unknown };

export interface HoldReceipt {
  intentId: string;
  authorized: Cents;
  status: string;
}

export interface HoldsPort {
  /** Resolves once the customer has approved the hold and it reads REQUIRES_CAPTURE. */
  open(job: { id: string; customer: string; amount: Cents }): Promise<HoldReceipt>;
  increment(intentId: string, newTotal: Cents): Promise<HoldReceipt>;
  capture(intentId: string, amount: Cents): Promise<HoldReceipt & { captured: Cents }>;
  cancel(intentId: string, reason: string): Promise<HoldReceipt>;
  /** What the card processor says now, for recovery after a crash. */
  read(intentId: string): Promise<HoldReceipt & { captured: Cents }>;
}

/** The approval is bound to what the customer saw: this job, this total, this message. */
export interface HoldRaiseRequest {
  jobId: string;
  customer: string;
  currentHold: Cents;
  newTotal: Cents;
  spent: Millionths;
  message: string;
}

export interface ApprovalsPort {
  requestHoldRaise(req: HoldRaiseRequest): Promise<boolean>;
}

export interface JobView {
  id: string;
  customer: string;
  brief: string;
  state: string;
  route: string;
  authorized: Cents;
  deposited: Millionths;
  spent: Millionths;
  remaining: { model: number; search: number; lookup: number };
  /** Spend if the job finishes all remaining steps on its current route. */
  projected: Millionths;
  holdFinal: boolean;
  raisePending: boolean;
  paragraphsDone: number;
  paragraphsTotal: number;
  intentId: string | null;
  captured: Cents | null;
}

export interface Snapshot {
  reason: string;
  jobs: JobView[];
  offers: Offer[];
  reserve: Millionths;
  floor: Millionths;
}

export interface StepJudgment {
  providerId: string | null;
  reason: string;
}

export interface PlanSource {
  source: "model" | "rules";
  model?: string;
  summary?: string;
  note?: string;
}

export interface PlannerPort {
  /** Who made the last plan; recorded in the run log. */
  lastPlan?: PlanSource;
  /** Revise the plan. Proposals are checked against the money rules before anything moves. */
  propose(snapshot: Snapshot): Promise<Proposal[]>;
  /**
   * For one paragraph: is it worth a dearer provider than the job's current route?
   * `slack` is what's left of the whole float if every live job finishes as projected; negative means short.
   */
  judgeStep(job: JobView, paragraph: { index: number; total: number }, offers: Offer[], slack: Millionths): Promise<StepJudgment>;
}
