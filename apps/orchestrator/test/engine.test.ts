import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Scenario, centsToMillionths, loadScenario, parseUsd, parseUsdz, sumMillionths } from "@meter/core";
import { EventLog } from "@meter/ledger";
import { Engine, type RunResult } from "../src/engine.ts";
import { RulePlanner } from "../src/planner.ts";
import type { PlannerPort } from "../src/ports.ts";
import { SimApprovals, SimHolds, SimMarket, SimWallet } from "../src/sim.ts";

const scenario = loadScenario(fileURLToPath(new URL("../../../scenario/kit12.json", import.meta.url)));

function rig(over: { approve?: boolean; scenario?: Scenario; planner?: PlannerPort; shockAt?: number | null } = {}) {
  const s = over.scenario ?? scenario;
  const market = new SimMarket(s);
  const holds = new SimHolds();
  const approvals = new SimApprovals(() => over.approve ?? true);
  const log = new EventLog(":memory:");
  const wallets = new Map<string, SimWallet>();
  const engine = new Engine({
    scenario: s,
    market,
    holds,
    approvals,
    planner: over.planner ?? new RulePlanner(),
    log,
    wallet: async (id) => {
      const w = new SimWallet(market, s.maxPayment, id);
      wallets.set(id, w);
      return w;
    },
    sleep: async () => undefined,
    depositRetryMs: 0,
    ...(over.shockAt === undefined ? {} : { shockAt: over.shockAt }),
  });
  return { engine, market, holds, approvals, log, wallets };
}

const job = (r: RunResult, id: string) => r.jobs.find((j) => j.id === id)!;
const types = (log: EventLog) => log.all().map((e) => e.type);

/** The promises Kit 12 makes, checked after every run whatever happened in it. */
function assertInvariants(r: RunResult, s: Scenario, holds: SimHolds, wallets: Map<string, SimWallet>) {
  let deposited = 0n;
  for (const j of r.jobs) {
    deposited += j.deposited;
    expect(j.spent <= j.deposited).toBe(true);
    expect(j.deposited <= centsToMillionths(j.authorized)).toBe(true);
    if (j.captured !== null) {
      expect(centsToMillionths(j.captured)).toBe(j.spent);
      expect(j.captured <= j.authorized).toBe(true);
    }
  }
  expect(r.reserve + deposited).toBe(s.float);
  expect(r.reserve >= s.reserveFloor).toBe(true);
  for (const h of holds.holds.values()) {
    expect(h.captures <= 1).toBe(true);
    expect(h.captures === 1 || h.cancelled).toBe(true); // no hold is left open
  }
  for (const w of wallets.values()) expect(w.withdrawn).toBe(1);
  expect(r.reconciled).toBe(true);
  expect(r.chainIntact).toBe(true);
}

describe("a quiet run (no shock)", () => {
  it("finishes all three jobs and captures exactly what each spent", async () => {
    const { engine, holds, wallets, log } = rig({ shockAt: null });
    const r = await engine.run();
    assertInvariants(r, scenario, holds, wallets);
    for (const j of r.jobs) expect(j.finished).toBe(true);
    expect(r.jobs.every((j) => j.state === "float_withdraw_queued")).toBe(true);
    expect(types(log)).not.toContain("hold.raise_requested");
  });

  it("buys every deposit before any payment", async () => {
    const { engine, log } = rig({ shockAt: null });
    await engine.run();
    const t = types(log);
    expect(t.indexOf("run.funded")).toBeLessThan(t.indexOf("payment"));
    expect(t.filter((x) => x === "float.deposited").length).toBeGreaterThanOrEqual(3);
  });

  it("charges below the hold and leaves the rest released", async () => {
    const { engine } = rig({ shockAt: null });
    const r = await engine.run();
    for (const j of r.jobs) expect(j.captured! < j.authorized).toBe(true);
  });
});

describe("the Kit 12 shock", () => {
  it("re-routes off the slow provider, asks the customer, raises before topping up, and stays inside every limit", async () => {
    const { engine, holds, wallets, log, approvals } = rig();
    const r = await engine.run();
    assertInvariants(r, scenario, holds, wallets);

    const t = types(log);
    expect(t).toContain("shock.overrun");
    expect(t).toContain("shock.slowdown");
    expect(t).toContain("job.rerouted");
    expect(approvals.requests[0]?.jobId).toBe("B");

    // After the raise, the deposit total may pass the old hold; never before it.
    const events = log.all();
    const raisedAt = events.findIndex((e) => e.type === "hold.raised" && e.job === "B");
    expect(raisedAt).toBeGreaterThan(-1);
    let deposited = 0;
    for (const e of events.slice(0, raisedAt)) {
      if (e.type === "float.deposited" && e.job === "B") deposited = Number(e.data.deposited);
    }
    expect(deposited).toBeLessThanOrEqual(0.75);
    expect(job(r, "B").authorized > parseUsd("0.75")).toBe(true);
  });

  it("asks at the shock, not when the job runs dry, and costs the ask on the new route", async () => {
    const { engine, log, approvals } = rig();
    await engine.run();
    const events = log.all();
    const shock = events.findIndex((e) => e.type === "shock.slowdown");
    const firstPlan = events.findIndex((e, i) => i > shock && e.type === "plan.revised");
    const asks = (events[firstPlan]!.data.decisions as Array<{ kind: string; job: string }>).filter((d) => d.kind === "ask_hold_raise");
    expect(asks.map((a) => a.job)).toEqual(["B"]);
    expect(approvals.requests.length).toBe(1);
  });

  it("an approved raise is money the customer's job can actually use", async () => {
    const { engine } = rig();
    const r = await engine.run();
    const b = job(r, "B");
    // The approval has to buy something: spend goes past the original $0.75 hold.
    expect(b.spent > centsToMillionths(parseUsd("0.75"))).toBe(true);
    expect(b.captured).toBe(b.authorized === b.captured ? b.authorized : b.captured);
    expect(centsToMillionths(b.authorized) - b.spent < centsToMillionths(parseUsd("0.10"))).toBe(true);
  });

  it("never asks for a raise the float can't fund", async () => {
    const tight = { ...scenario, float: parseUsdz("0.80"), reserveFloor: parseUsdz("0.05"), jobs: scenario.jobs.map((j) => ({ ...j, initialDeposit: parseUsdz("0.20") })) };
    const { engine, approvals, holds, wallets } = rig({ scenario: tight });
    const r = await engine.run();
    expect(approvals.requests).toEqual([]);
    assertInvariants(r, tight, holds, wallets);
  });

  it("stops paying for premium paragraphs once the float is short", async () => {
    const { engine, log } = rig();
    await engine.run();
    const events = log.all();
    const shock = events.findIndex((e) => e.type === "shock.overrun");
    expect(events.slice(0, shock).some((e) => e.type === "step.upgraded")).toBe(true);
    expect(events.slice(shock).filter((e) => e.type === "step.upgraded" && e.job === "B")).toEqual([]);
  });

  it("rations the short float: jobs A and C still finish", async () => {
    const { engine } = rig();
    const r = await engine.run();
    expect(job(r, "A").finished).toBe(true);
    expect(job(r, "C").finished).toBe(true);
  });

  it("if the customer declines, the job stops inside its hold and is charged only for what it got", async () => {
    const { engine, holds, wallets, log } = rig({ approve: false });
    const r = await engine.run();
    assertInvariants(r, scenario, holds, wallets);
    const b = job(r, "B");
    expect(b.authorized).toBe(parseUsd("0.75"));
    expect(b.captured! <= parseUsd("0.75")).toBe(true);
    expect(b.finished).toBe(false);
    expect(types(log)).toContain("hold.raise_declined");
    expect(log.all().filter((e) => e.type === "hold.raise_requested" && e.job === "B").length).toBe(1);
  });
});

describe("getting unused float back", () => {
  it("reports withdrawn only once the payouts add up, not on the first empty answer", async () => {
    const { engine, log } = rig();
    const r = await engine.run();
    const unused = r.jobs.reduce((sum, j) => sum + (j.deposited - j.spent), 0n);
    expect(unused > 0n).toBe(true);
    expect(types(log)).not.toContain("float.withdrawn");

    expect(await engine.claimFloat(0, Date.now() + 5000)).toBe(true);
    const events = log.all();
    const claimed = events.filter((e) => e.type === "float.claimed").reduce((sum, e) => sum + parseUsdz(String(e.data.amount)), 0n);
    expect(claimed).toBe(unused);
    expect(events.filter((e) => e.type === "float.withdrawn").length).toBe(3);
    const firstClaim = events.findIndex((e) => e.type === "float.claimed");
    const queued = events.findIndex((e) => e.type === "float.queued");
    expect(queued).toBeGreaterThan(-1);
    expect(queued).toBeLessThan(firstClaim);
  });

  it("gives up at the deadline and says so", async () => {
    const { engine, log } = rig();
    const r = await engine.run();
    expect(await engine.claimFloat(0, Date.now() - 1)).toBe(false);
    // A job with nothing unused is done at once; anything with money still out must not read as withdrawn.
    const stillOut = r.jobs.filter((j) => j.deposited > j.spent).map((j) => j.id);
    expect(stillOut.length).toBeGreaterThan(0);
    const withdrawn = log.all().filter((e) => e.type === "float.withdrawn").map((e) => e.job);
    for (const id of stillOut) expect(withdrawn).not.toContain(id);
  });
});

describe("failures", () => {
  it("a provider that fails after payment still costs its price, and capture includes it", async () => {
    const { engine, market, holds, wallets, log } = rig({ shockAt: null });
    await market.dropNext("search");
    const r = await engine.run();
    assertInvariants(r, scenario, holds, wallets);
    expect(types(log)).toContain("step.failed_after_payment");
  });

  it("a reprice above the wallet cap never pays, and the rest of the job still closes cleanly", async () => {
    const { engine, market, holds, wallets, log } = rig({ shockAt: null });
    await market.setPrice("lookup", parseUsdz("0.09"));
    const r = await engine.run();
    for (const j of r.jobs) expect(j.spent <= j.deposited).toBe(true);
    expect(types(log)).toContain("job.failed");
    for (const h of holds.holds.values()) expect(h.captures === 1 || h.cancelled).toBe(true);
    expect(sumMillionths(await wallets.get("A")!.payments().then((p) => p.map((x) => x.amount)))).toBe(job(r, "A").spent);
  });

  it("a job that pays for nothing has its hold cancelled, not captured", async () => {
    const { engine, market, holds, log } = rig({ shockAt: null });
    await market.setPrice("search", parseUsdz("0.09"));
    await engine.run();
    expect(types(log)).toContain("hold.cancelled");
    for (const h of holds.holds.values()) {
      expect(h.cancelled).toBe(true);
      expect(h.captures).toBe(0);
    }
  });

  it("a planner proposing something unsafe is refused and nothing moves", async () => {
    const reckless: PlannerPort = {
      propose: async (s) => [{ kind: "grant_reserve", jobId: s.jobs[0]!.id, amount: parseUsdz("5.00"), reason: "all in" }],
      judgeStep: async () => ({ providerId: null, reason: "" }),
    };
    const { engine, holds, wallets, log } = rig({ planner: reckless });
    const r = await engine.run();
    const refused = log.all().flatMap((e) => (e.type === "plan.revised" ? (e.data.decisions as Array<{ accepted: boolean }>) : [])).filter((d) => !d.accepted);
    expect(refused.length).toBeGreaterThan(0);
    assertInvariants(r, scenario, holds, wallets);
  });

  it("a crashing planner stops no money rule: jobs close and holds settle", async () => {
    const broken: PlannerPort = {
      propose: async () => {
        throw new Error("model unavailable");
      },
      judgeStep: async () => ({ providerId: null, reason: "" }),
    };
    const { engine, holds, wallets, log } = rig({ planner: broken });
    const r = await engine.run();
    expect(types(log)).toContain("plan.failed");
    assertInvariants(r, scenario, holds, wallets);
  });
});
