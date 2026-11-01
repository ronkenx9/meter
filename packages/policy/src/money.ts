// Hard money rules. The model proposes; these functions decide. All pure, all exact.
//
// The invariant everything rests on: a job's deposits never exceed its authorized hold.
// A clearing wallet can only spend what was deposited into it, so spend <= deposits <= hold,
// and a capture of exactly the spend can never exceed the hold.

import {
  type Cents,
  type Millionths,
  centsToMillionths,
  millionths,
  millionthsToCents,
  millionthsToCentsCeil,
  sumMillionths,
} from "@meter/core";

export interface JobMoney {
  id: string;
  /** Total currently authorized on the card (after any confirmed increments). */
  authorized: Cents;
  /** Everything deposited into this job's clearing wallet. */
  deposited: Millionths;
  /** Everything this job's wallet has paid, from the wallet's own record. */
  spent: Millionths;
  /** Set once the single capture succeeds. */
  captured: Cents | null;
  cancelled: boolean;
}

export interface Pool {
  /** Undeposited float the operator still holds. */
  reserve: Millionths;
  /** The reserve may not go below this. */
  floor: Millionths;
}

export type Refusal<R extends string> = { ok: false; reason: R; detail: string };
export type Ok<T> = { ok: true } & T;

const refuse = <R extends string>(reason: R, detail: string): Refusal<R> => ({ ok: false, reason, detail });

export function holdInMillionths(job: JobMoney): Millionths {
  return centsToMillionths(job.authorized);
}

export function depositLeft(job: JobMoney): Millionths {
  return millionths(job.deposited - job.spent);
}

/** May this job pay one more request at this price right now? */
export function canPay(
  job: JobMoney,
  price: Millionths,
): Ok<{}> | Refusal<"closed" | "over_hold" | "needs_top_up"> {
  if (job.captured !== null || job.cancelled) return refuse("closed", `job ${job.id} is closed`);
  if (job.spent + price > holdInMillionths(job)) {
    return refuse("over_hold", `job ${job.id} would spend past its ${job.authorized}c hold`);
  }
  if (price > depositLeft(job)) {
    return refuse("needs_top_up", `job ${job.id} has ${depositLeft(job)} millionths deposited unspent, needs ${price}`);
  }
  return { ok: true };
}

/** Move float from the reserve into a job's wallet. The hold must already cover the new deposit total. */
export function checkTopUp(
  job: JobMoney,
  amount: Millionths,
  pool: Pool,
): Ok<{ reserveAfter: Millionths; depositedAfter: Millionths }> | Refusal<"closed" | "non_positive" | "raise_hold_first" | "reserve_floor"> {
  if (job.captured !== null || job.cancelled) return refuse("closed", `job ${job.id} is closed`);
  if (amount <= 0n) return refuse("non_positive", "top-up must be positive");
  const depositedAfter = millionths(job.deposited + amount);
  if (depositedAfter > holdInMillionths(job)) {
    return refuse("raise_hold_first", `deposits would reach ${depositedAfter} millionths, above the ${job.authorized}c hold`);
  }
  const reserveAfter = millionths(pool.reserve - amount);
  if (reserveAfter < pool.floor) {
    return refuse("reserve_floor", `reserve would fall to ${reserveAfter}, below the floor of ${pool.floor}`);
  }
  return { ok: true, reserveAfter, depositedAfter };
}

/** Spend this job is on course for if it finishes its remaining steps at these prices. */
export function projectSpend(job: JobMoney, remainingPrices: Iterable<Millionths>): Millionths {
  return millionths(job.spent + sumMillionths(remainingPrices));
}

/** The new hold total to ask the customer for so the projected spend fits. */
export function holdRaiseFor(
  job: JobMoney,
  projected: Millionths,
): Ok<{ newTotal: Cents }> | Refusal<"closed" | "not_needed"> {
  if (job.captured !== null || job.cancelled) return refuse("closed", `job ${job.id} is closed`);
  const newTotal = millionthsToCentsCeil(projected);
  if (newTotal <= job.authorized) return refuse("not_needed", `projected spend fits the ${job.authorized}c hold`);
  return { ok: true, newTotal };
}

/** Airwallex rejects an increment that is not above the current total; mirror that before calling. */
export function checkIncrement(job: JobMoney, newTotal: Cents): Ok<{}> | Refusal<"closed" | "not_above_current"> {
  if (job.captured !== null || job.cancelled) return refuse("closed", `job ${job.id} is closed`);
  if (newTotal <= job.authorized) return refuse("not_above_current", `${newTotal}c is not above the current ${job.authorized}c`);
  return { ok: true };
}

export type CloseAction = { kind: "capture"; amount: Cents } | { kind: "cancel" };

/**
 * How to close a job's hold. The capture amount is the wallet's own record of payments, which must
 * agree with the ledger's running spend; any disagreement blocks the close for a person to look at.
 */
export function closeAction(
  job: JobMoney,
  walletPayments: Iterable<Millionths>,
): Ok<{ action: CloseAction }> | Refusal<"closed" | "ledger_mismatch" | "over_hold" | "sub_cent"> {
  if (job.captured !== null || job.cancelled) return refuse("closed", `job ${job.id} is already closed`);
  const paid = sumMillionths(walletPayments);
  if (paid !== job.spent) {
    return refuse("ledger_mismatch", `wallet record ${paid} != ledger spend ${job.spent} for job ${job.id}`);
  }
  if (paid === 0n) return { ok: true, action: { kind: "cancel" } };
  if (paid > holdInMillionths(job)) return refuse("over_hold", `spend ${paid} exceeds the ${job.authorized}c hold`);
  if (paid % 10_000n !== 0n) return refuse("sub_cent", `spend ${paid} millionths is not whole cents`);
  return { ok: true, action: { kind: "capture", amount: millionthsToCents(paid) } };
}

/** Float left in a job's wallet after its spend; withdrawn once final. */
export function unusedFloat(job: JobMoney): Millionths {
  return depositLeft(job);
}

export function newJobMoney(id: string, authorized: Cents): JobMoney {
  return { id, authorized, deposited: millionths(0n), spent: millionths(0n), captured: null, cancelled: false };
}

