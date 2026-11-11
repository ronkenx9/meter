// Thousands of random runs through the real engine and money rules on simulated rails, each checked against
// the promises Kit 12 makes. Half the runs are planned by a planner that proposes nonsense on purpose, to show
// that the rules hold whatever the planner says. Seeded, so a failure names the run that reproduces it.
// Usage: check-sim.ts [runs=10000] [seed=12]
import { fileURLToPath } from "node:url";
import { type Cents, type Millionths, type Scenario, cents, centsToMillionths, loadScenario, millionths, sumMillionths } from "@meter/core";
import { EventLog } from "@meter/ledger";
import type { Proposal } from "@meter/policy";
import { Engine } from "../src/engine.ts";
import { RulePlanner } from "../src/planner.ts";
import type { ExpectedOffer, JobView, Offer, PlannerPort, Snapshot, StepJudgment } from "../src/ports.ts";
import { SimApprovals, SimHolds, SimMarket, SimWallet } from "../src/sim.ts";

const RUNS = Number(process.argv[2] ?? 10_000);
const SEED = Number(process.argv[3] ?? 12);
const base = loadScenario(fileURLToPath(new URL("../../../scenario/kit12.json", import.meta.url)));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const usdz = (c: number) => millionths(BigInt(c) * 10_000n);

/** Kit 12's shape with every number shaken: holds, float, deposits, job sizes, and when and how hard the shock hits. */
function randomScenario(r: () => number): Scenario {
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const floor = int(0, 10);
  let free = int(60, 260) - floor;
  const float = usdz(free + floor);
  const jobs = base.jobs.map((j) => {
    const hold = int(20, 150);
    const deposit = Math.max(0, Math.min(hold, int(5, 40), free));
    free -= deposit;
    return { ...j, hold: cents(BigInt(hold)) as Cents, initialDeposit: usdz(deposit), paragraphs: int(2, 18), searches: int(0, 3), lookups: int(0, 3) };
  });
  return {
    ...base,
    float,
    reserveFloor: usdz(floor),
    jobs,
    shock: { ...base.shock, atFractionOfRun: 0.1 + r() * 0.8, overrunJob: jobs[int(0, jobs.length - 1)]!.id, tokenMultiplier: int(2, 5) },
  };
}

/** Proposes whatever it likes: unknown jobs and providers, grants far past the float, raises that go down. */
class ChaosPlanner implements PlannerPort {
  proposed = 0;
  private readonly r: () => number;
  constructor(r: () => number) {
    this.r = r;
  }
  private pick<T>(xs: T[]): T {
    return xs[Math.floor(this.r() * xs.length)]!;
  }
  async propose(s: Snapshot): Promise<Proposal[]> {
    const jobs = [...s.jobs.map((j) => j.id), "Z"];
    const providers = [...s.offers.map((o) => o.id), "model-nobody"];
    const plan: Proposal[] = [];
    for (let n = Math.floor(this.r() * 6); n > 0; n--) {
      const jobId = this.pick(jobs);
      const kind = this.pick(["reroute", "grant_reserve", "ask_hold_raise", "pause"] as const);
      if (kind === "reroute") plan.push({ kind, jobId, toProvider: this.pick(providers), reason: "chaos" });
      else if (kind === "grant_reserve") plan.push({ kind, jobId, amount: usdz(Math.floor(this.r() * 400) - 50), reason: "chaos" });
      else if (kind === "ask_hold_raise") plan.push({ kind, jobId, newTotal: cents(BigInt(Math.floor(this.r() * 400))) as Cents, message: "chaos" });
      else plan.push({ kind, jobId, reason: "chaos" });
    }
    this.proposed += plan.length;
    return plan;
  }
  async judgeStep(_job: JobView, _p: { index: number; total: number }, offers: Offer[]): Promise<StepJudgment> {
    return { providerId: this.r() < 0.3 ? this.pick([...offers.map((o) => o.id), "model-nobody"]) : null, reason: "chaos" };
  }
}

/** Breaks things at random just before a payment: failures after payment, lost answers, repricing, a swapped payee. */
class FaultyWallet extends SimWallet {
  private readonly r: () => number;
  private readonly m: SimMarket;
  constructor(m: SimMarket, max: Millionths, id: string, r: () => number) {
    super(m, max, id);
    this.r = r;
    this.m = m;
  }
  override async pay(url: string, expect?: ExpectedOffer) {
    const id = new URL(url).host;
    const x = this.r();
    if (x < 0.03) await this.m.dropNext(id);
    else if (x < 0.06) await this.m.loseNext(id);
    else if (x < 0.07) await this.m.swapPayee(id);
    else if (x < 0.09) await this.m.setPrice(id, usdz(1 + Math.floor(this.r() * 8)));
    return super.pay(url, expect);
  }
}

const tally = { runs: 0, payments: 0, refusedProposals: 0, proposals: 0, refusedPayments: 0, raises: 0, declined: 0, finished: 0, jobs: 0 };

async function one(seed: number): Promise<string | null> {
  const r = rng(seed);
  const s = randomScenario(r);
  const chaos = r() < 0.5;
  const market = new SimMarket(s);
  const holds = new SimHolds();
  const approvals = new SimApprovals(() => r() < 0.6);
  const log = new EventLog(":memory:");
  const wallets = new Map<string, FaultyWallet>();
  const planner = chaos ? new ChaosPlanner(r) : new RulePlanner();
  const engine = new Engine({
    scenario: s,
    market,
    holds,
    approvals,
    planner,
    log,
    wallet: async (id) => {
      const w = new FaultyWallet(market, s.maxPayment, id, r);
      wallets.set(id, w);
      return w;
    },
    sleep: async () => undefined,
    depositRetryMs: 0,
    shockAt: r() < 0.15 ? null : s.shock.atFractionOfRun,
  });
  const result = await engine.run();
  const events = log.all();
  log.close();

  const fail = (rule: string) => `seed ${seed}${chaos ? " (chaos planner)" : ""}: ${rule}`;
  const keys = new Set(s.providers.map((p) => market.clearingKey(p.id)));
  let deposited = 0n;
  for (const j of result.jobs) {
    deposited += j.deposited;
    const record = await wallets.get(j.id)!.payments();
    const paid = sumMillionths(record.map((p) => p.amount));
    if (j.spent > j.deposited) return fail(`job ${j.id} spent past its deposits`);
    if (j.deposited > centsToMillionths(j.authorized)) return fail(`job ${j.id} was funded past its hold`);
    if (paid !== j.spent) return fail(`job ${j.id}: wallet record and ledger disagree`);
    if (j.captured !== null && centsToMillionths(j.captured) !== paid) return fail(`job ${j.id}: charged something other than what was paid`);
    if (j.captured !== null && j.captured > j.authorized) return fail(`job ${j.id}: charged past the hold`);
    if (j.captured === null && paid > 0n) return fail(`job ${j.id}: paid providers but never charged the customer`);
    if (record.some((p) => !keys.has(p.recipient))) return fail(`job ${j.id}: paid someone who is not a provider`);
    if (record.some((p) => p.amount > s.maxPayment)) return fail(`job ${j.id}: paid above the cap`);
  }
  if (result.reserve + deposited !== s.float) return fail("float is not all accounted for");
  if (result.reserve < s.reserveFloor) return fail("reserve fell below its floor");
  for (const [id, h] of holds.holds) {
    if (h.captures > 1) return fail(`${id} captured twice`);
    if (h.captures === 0 && !h.cancelled) return fail(`${id} left open`);
  }
  if (!result.reconciled) return fail("did not reconcile");
  if (!result.chainIntact) return fail("event log chain broken");

  // In order: no deposit ever took a job past the hold it had at that moment, and no raise came before a yes.
  const hold = new Map<string, number>();
  const approved = new Map<string, number>();
  for (const e of events) {
    const id = e.job ?? "";
    if (e.type === "hold.placed") hold.set(id, Number(String(e.data.amount).replace("$", "")));
    if (e.type === "hold.raise_approved") approved.set(id, (approved.get(id) ?? 0) + 1);
    if (e.type === "hold.raised") {
      if (!approved.get(id)) return fail(`job ${id}: hold raised without the customer's yes`);
      approved.set(id, approved.get(id)! - 1);
      hold.set(id, Number(String(e.data.authorized).replace("$", "")));
    }
    if (e.type === "float.deposited" && Number(e.data.deposited) > (hold.get(id) ?? 0) + 1e-9) return fail(`job ${id}: deposits passed the hold in force`);
    if (e.type === "payment") tally.payments++;
    if (e.type === "payment.refused") tally.refusedPayments++;
    if (e.type === "hold.raised") tally.raises++;
    if (e.type === "hold.raise_declined") tally.declined++;
    if (e.type === "plan.revised") {
      const d = e.data.decisions as Array<{ accepted: boolean }>;
      tally.proposals += d.length;
      tally.refusedProposals += d.filter((x) => !x.accepted).length;
    }
  }
  tally.runs++;
  tally.jobs += result.jobs.length;
  tally.finished += result.jobs.filter((j) => j.finished).length;
  return null;
}

const started = Date.now();
for (let i = 0; i < RUNS; i++) {
  const bad = await one(SEED * 1_000_003 + i).catch((e) => `seed ${SEED * 1_000_003 + i}: engine threw ${String(e).slice(0, 200)}`);
  if (bad) {
    console.log(`SIM_VIOLATION after ${i} clean runs. ${bad}`);
    process.exit(1);
  }
}
console.log(
  `SIM_OK ${tally.runs} runs, 0 violations. ${tally.payments} payments, ${tally.refusedPayments} offers refused unsigned, ` +
    `${tally.refusedProposals} of ${tally.proposals} proposals refused by the rules, ${tally.raises} raises approved, ${tally.declined} declined, ` +
    `${tally.finished} of ${tally.jobs} jobs finished in full. ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
