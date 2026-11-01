import { describe, expect, it } from "vitest";
import { type Millionths, cents, millionths, parseUsd, parseUsdz } from "@meter/core";
import {
  type JobMoney,
  canPay,
  checkIncrement,
  checkTopUp,
  closeAction,
  holdRaiseFor,
  newJobMoney,
  projectSpend,
} from "../src/money.ts";

const job = (over: Partial<JobMoney> = {}): JobMoney => ({ ...newJobMoney("B", parseUsd("0.75")), ...over });
const u = parseUsdz;

describe("canPay", () => {
  it("pays from deposit within the hold", () => {
    expect(canPay(job({ deposited: u("0.30"), spent: u("0.10") }), u("0.02")).ok).toBe(true);
  });
  it("asks for a top-up when the deposit runs dry", () => {
    const r = canPay(job({ deposited: u("0.30"), spent: u("0.29") }), u("0.02"));
    expect(r).toMatchObject({ ok: false, reason: "needs_top_up" });
  });
  it("refuses any payment past the hold", () => {
    const r = canPay(job({ deposited: u("0.75"), spent: u("0.74") }), u("0.02"));
    expect(r).toMatchObject({ ok: false, reason: "over_hold" });
  });
  it("allows spending exactly to the hold", () => {
    expect(canPay(job({ deposited: u("0.75"), spent: u("0.73") }), u("0.02")).ok).toBe(true);
  });
  it("refuses a closed job", () => {
    expect(canPay(job({ deposited: u("0.30"), captured: cents(10n) }), u("0.01"))).toMatchObject({ reason: "closed" });
    expect(canPay(job({ deposited: u("0.30"), cancelled: true }), u("0.01"))).toMatchObject({ reason: "closed" });
  });
});

describe("checkTopUp", () => {
  const pool = { reserve: u("0.50"), floor: u("0.10") };
  it("moves reserve into a job whose hold covers it", () => {
    const r = checkTopUp(job({ deposited: u("0.30") }), u("0.20"), pool);
    expect(r).toEqual({ ok: true, reserveAfter: u("0.30"), depositedAfter: u("0.50") });
  });
  it("refuses to top up past the hold: raise the hold first", () => {
    const r = checkTopUp(job({ deposited: u("0.70") }), u("0.10"), pool);
    expect(r).toMatchObject({ ok: false, reason: "raise_hold_first" });
  });
  it("after an increment, the same top-up passes", () => {
    const raised = job({ deposited: u("0.70"), authorized: parseUsd("1.25") });
    expect(checkTopUp(raised, u("0.10"), pool).ok).toBe(true);
  });
  it("keeps the reserve above its floor", () => {
    const r = checkTopUp(job({ authorized: parseUsd("2.00") }), u("0.45"), pool);
    expect(r).toMatchObject({ ok: false, reason: "reserve_floor" });
  });
  it("refuses zero and negative amounts", () => {
    expect(checkTopUp(job(), millionths(0n), pool)).toMatchObject({ reason: "non_positive" });
    expect(checkTopUp(job(), millionths(-1n), pool)).toMatchObject({ reason: "non_positive" });
  });
});

describe("hold raise", () => {
  it("sizes the new total to the projected spend, rounded up to a cent", () => {
    const j = job({ spent: u("0.60") });
    const projected = projectSpend(j, [u("0.05"), u("0.05"), u("0.05"), u("0.021")]);
    expect(projected).toBe(u("0.771"));
    expect(holdRaiseFor(j, projected)).toEqual({ ok: true, newTotal: parseUsd("0.78") });
  });
  it("is not needed when the projection fits", () => {
    expect(holdRaiseFor(job(), u("0.75"))).toMatchObject({ ok: false, reason: "not_needed" });
  });
  it("mirrors Airwallex: the increment must exceed the current total", () => {
    expect(checkIncrement(job(), parseUsd("0.75"))).toMatchObject({ reason: "not_above_current" });
    expect(checkIncrement(job(), parseUsd("0.76")).ok).toBe(true);
  });
});

describe("closeAction", () => {
  it("captures exactly the wallet's recorded spend", () => {
    const paid = ["0.02", "0.02", "0.05", "0.03"].map(u);
    const r = closeAction(job({ deposited: u("0.30"), spent: u("0.12") }), paid);
    expect(r).toEqual({ ok: true, action: { kind: "capture", amount: parseUsd("0.12") } });
  });
  it("cancels a hold that paid for nothing", () => {
    expect(closeAction(job(), [])).toEqual({ ok: true, action: { kind: "cancel" } });
  });
  it("blocks the close when the wallet and ledger disagree", () => {
    const r = closeAction(job({ spent: u("0.12") }), [u("0.10")]);
    expect(r).toMatchObject({ ok: false, reason: "ledger_mismatch" });
  });
  it("never captures above the hold", () => {
    const r = closeAction(job({ spent: u("0.80") }), [u("0.80")]);
    expect(r).toMatchObject({ ok: false, reason: "over_hold" });
  });
  it("never captures a sub-cent amount", () => {
    const r = closeAction(job({ spent: u("0.105") }), [u("0.105")]);
    expect(r).toMatchObject({ ok: false, reason: "sub_cent" });
  });
  it("captures only once", () => {
    const r = closeAction(job({ spent: u("0.10"), captured: parseUsd("0.10") }), [u("0.10")]);
    expect(r).toMatchObject({ ok: false, reason: "closed" });
  });
});

describe("invariant under random operation sequences", () => {
  // Deterministic LCG so a failure is reproducible.
  const rng = (seed: number) => () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);

  it("spend never exceeds deposits and deposits never exceed the hold", () => {
    const prices = ["0.01", "0.02", "0.05", "0.02", "0.03"].map(u);
    for (let run = 0; run < 300; run++) {
      const rand = rng(run + 1);
      let j = job({ authorized: parseUsd(["1.00", "0.75"][run % 2]!) });
      let pool = { reserve: u("1.50"), floor: u("0.10") };
      for (let step = 0; step < 120; step++) {
        const roll = rand();
        if (roll < 0.6) {
          const price = prices[Math.floor(rand() * prices.length)]!;
          if (canPay(j, price).ok) j = { ...j, spent: (j.spent + price) as Millionths };
        } else if (roll < 0.85) {
          const amt = u(["0.05", "0.10", "0.25"][Math.floor(rand() * 3)]!);
          const t = checkTopUp(j, amt, pool);
          if (t.ok) {
            j = { ...j, deposited: t.depositedAfter };
            pool = { ...pool, reserve: t.reserveAfter };
          }
        } else {
          const next = cents(j.authorized + BigInt(1 + Math.floor(rand() * 30)));
          if (checkIncrement(j, next).ok) j = { ...j, authorized: next };
        }
        expect(j.spent <= j.deposited).toBe(true);
        expect(j.deposited <= j.authorized * 10_000n).toBe(true);
        expect(pool.reserve >= pool.floor).toBe(true);
      }
      const close = closeAction(j, [j.spent]);
      if (close.ok && close.action.kind === "capture") expect(close.action.amount <= j.authorized).toBe(true);
    }
  });
});
