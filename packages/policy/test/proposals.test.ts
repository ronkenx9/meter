import { describe, expect, it } from "vitest";
import { parseUsd, parseUsdz as u } from "@meter/core";
import { type JobMoney, newJobMoney } from "../src/money.ts";
import { type PlanContext, type ProviderOffer, checkPlan, checkProposal } from "../src/proposals.ts";
import { TransitionError, assertTransition, canTransition, holdIsOpen, mayPay } from "../src/state.ts";

const offers = new Map<string, ProviderOffer>([
  ["model-basic", { id: "model-basic", kind: "model", price: u("0.01"), available: false }],
  ["model-standard", { id: "model-standard", kind: "model", price: u("0.02"), available: true }],
  ["model-premium", { id: "model-premium", kind: "model", price: u("0.05"), available: true }],
  ["gouger", { id: "gouger", kind: "model", price: u("0.09"), available: true }],
]);

const mk = (id: string, hold: string, deposited: string, spent: string): JobMoney => ({
  ...newJobMoney(id, parseUsd(hold)),
  deposited: u(deposited),
  spent: u(spent),
});

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  jobs: new Map([
    ["A", mk("A", "1.00", "0.40", "0.20")],
    ["B", mk("B", "0.75", "0.30", "0.29")],
    ["C", mk("C", "0.75", "0.30", "0.10")],
  ]),
  pool: { reserve: u("0.50"), floor: u("0.10") },
  offers,
  maxPayment: u("0.05"),
  heldPayments: new Map(),
  ...over,
});

describe("checkProposal", () => {
  it("accepts a reroute to a live provider under the cap", () => {
    expect(checkProposal({ kind: "reroute", jobId: "A", toProvider: "model-standard", reason: "slow" }, ctx()).accepted).toBe(true);
  });
  it("rejects a reroute to the slowed provider, a gouger, or a provider that does not exist", () => {
    for (const to of ["model-basic", "gouger", "nope"]) {
      expect(checkProposal({ kind: "reroute", jobId: "A", toProvider: to, reason: "" }, ctx()).accepted).toBe(false);
    }
  });
  it("rejects a reroute while a lost-answer payment is held for another provider", () => {
    const v = checkProposal(
      { kind: "reroute", jobId: "A", toProvider: "model-premium", reason: "" },
      ctx({ heldPayments: new Map([["A", "model-basic"]]) }),
    );
    expect(v).toMatchObject({ accepted: false, reason: expect.stringMatching(/resend its held payment/) });
  });
  it("rejects a grant above the hold and accepts one within it", () => {
    expect(checkProposal({ kind: "grant_reserve", jobId: "B", amount: u("0.50"), reason: "" }, ctx()).accepted).toBe(false);
    expect(checkProposal({ kind: "grant_reserve", jobId: "B", amount: u("0.20"), reason: "" }, ctx()).accepted).toBe(true);
  });
  it("rejects a hold raise that is not a raise", () => {
    expect(checkProposal({ kind: "ask_hold_raise", jobId: "B", newTotal: parseUsd("0.75"), message: "" }, ctx()).accepted).toBe(false);
    expect(checkProposal({ kind: "ask_hold_raise", jobId: "B", newTotal: parseUsd("1.40"), message: "" }, ctx()).accepted).toBe(true);
  });
  it("rejects anything about an unknown job", () => {
    expect(checkProposal({ kind: "pause", jobId: "Z", reason: "" }, ctx()).accepted).toBe(false);
  });
});

describe("checkPlan", () => {
  it("stops two grants that fit alone from draining the reserve together", () => {
    const verdicts = checkPlan(
      [
        { kind: "grant_reserve", jobId: "A", amount: u("0.30"), reason: "" },
        { kind: "grant_reserve", jobId: "C", amount: u("0.20"), reason: "" },
      ],
      ctx(),
    );
    expect(verdicts.map((v) => v.accepted)).toEqual([true, false]);
  });
  it("counts an earlier grant against the same job's hold", () => {
    const verdicts = checkPlan(
      [
        { kind: "grant_reserve", jobId: "B", amount: u("0.25"), reason: "" },
        // 0.30 deposited + 0.25 + 0.25 = 0.80, past the 0.75 hold.
        { kind: "grant_reserve", jobId: "B", amount: u("0.25"), reason: "" },
      ],
      { ...ctx(), pool: { reserve: u("1.00"), floor: u("0.10") } },
    );
    expect(verdicts.map((v) => v.accepted)).toEqual([true, false]);
  });
});

describe("job state machine", () => {
  it("walks the happy path with a hold raise", () => {
    const path = ["quoted", "hold_requested", "held", "funded", "running", "over_budget", "awaiting_hold_raise", "running", "draining", "capturing", "captured", "float_withdraw_queued", "float_withdrawn"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });
  it("refuses to capture twice or pay after capture", () => {
    expect(() => assertTransition("captured", "capturing")).toThrow(TransitionError);
    expect(() => assertTransition("captured", "running")).toThrow(TransitionError);
    expect(mayPay("captured")).toBe(false);
  });
  it("lets a failed job's hold be cancelled, never stranded", () => {
    expect(canTransition("draining", "cancelled")).toBe(true);
    expect(holdIsOpen("draining")).toBe(true);
    expect(holdIsOpen("cancelled")).toBe(false);
  });
});
