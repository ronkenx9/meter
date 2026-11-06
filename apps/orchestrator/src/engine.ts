// The control loop: three jobs, one short float. Money rules live in @meter/policy; this file sequences them.
// Order that matters: every deposit before any job starts, hold raised before top-up, one capture from the
// wallet's own record, and a lost-answer payment resent before any reroute.

import { type Cents, type Millionths, type Scenario, type ScenarioJob, baseUnitsToMillionths, centsToMillionths, formatUsd, formatUsdz, millionths, sumMillionths } from "@meter/core";
import type { EventLog } from "@meter/ledger";
import { type JobMoney, type JobState, type Proposal, assertTransition, canPay, checkPlan, checkTopUp, closeAction, depositLeft, holdIsOpen, newJobMoney } from "@meter/policy";
import type { ApprovalsPort, HoldsPort, JobView, MarketPort, Offer, PlannerPort, Snapshot, WalletPort } from "./ports.ts";

type Step = { kind: "model" | "search" | "lookup"; index: number };

interface Job {
  spec: ScenarioJob;
  state: JobState;
  money: JobMoney;
  intentId: string | null;
  wallet: WalletPort;
  route: string;
  steps: Step[];
  paragraphsDone: number;
  paragraphsTotal: number;
  /** The customer declined a raise: finish within this hold, and never ask again. */
  holdFinal: boolean;
  raisePending: boolean;
  /** Money moves in flight for this job; it pays nothing until they land. */
  blockers: Set<Promise<unknown>>;
  /** Reserve already committed to deposits that haven't landed, so a second plan can't grant it twice. */
  inFlight: Millionths;
  /** Consecutive requests that reached no one. */
  outages: number;
  output: string[];
  /** Last failed attempt at the head step, so a failed-after-payment request is retried once. */
  headFailures: number;
}

export interface EngineDeps {
  scenario: Scenario;
  market: MarketPort;
  holds: HoldsPort;
  approvals: ApprovalsPort;
  planner: PlannerPort;
  log: EventLog;
  wallet: (jobId: string) => Promise<WalletPort>;
  /** Seconds a topped-up deposit needs before it can pay; sim runs set this near zero. */
  sleep?: (ms: number) => Promise<void>;
  depositRetryMs?: number;
  /** Fire the scenario's shock automatically once this share of planned steps is done. Default: the scenario's. */
  shockAt?: number | null;
}

export interface JobResult {
  id: string;
  state: JobState;
  authorized: Cents;
  captured: Cents | null;
  deposited: Millionths;
  spent: Millionths;
  paragraphs: number;
  paragraphsPlanned: number;
  finished: boolean;
  output: string[];
}

export interface RunResult {
  jobs: JobResult[];
  reserve: Millionths;
  reconciled: boolean;
  chainIntact: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const DEPOSIT_TRIES = 3;
const OUTAGE_TRIES = 6;
const isTransient = (e: unknown) => /fetch failed|timeout|send the request again/i.test(String(e));

export class Engine {
  private readonly d: EngineDeps;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly jobs = new Map<string, Job>();
  private reserve: Millionths;
  private decisions: Promise<unknown> = Promise.resolve();
  private deposits: Promise<unknown> = Promise.resolve();
  private shocked = false;
  private plannedSteps = 0;
  private doneSteps = 0;

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.sleep = deps.sleep ?? defaultSleep;
    this.reserve = deps.scenario.float;
  }

  private emit(type: string, job: string | null, data: Record<string, unknown> = {}) {
    this.d.log.append(type, job, data);
  }

  private move(job: Job, to: JobState) {
    job.state = assertTransition(job.state, to);
    this.emit("job.state", job.spec.id, { state: to });
  }

  /** Current money per job, for the dashboard and tests. */
  view(offers: Offer[] = []): { jobs: JobView[]; reserve: Millionths; shocked: boolean } {
    return { jobs: [...this.jobs.values()].map((j) => this.jobView(j, offers)), reserve: this.reserve, shocked: this.shocked };
  }

  private jobView(j: Job, offers: Offer[]): JobView {
    const remaining = { model: 0, search: 0, lookup: 0 };
    for (const s of j.steps) remaining[s.kind]++;
    const price = (id: string) => offers.find((o) => o.id === id)?.price ?? 0n;
    const of = (kind: string) => offers.find((o) => o.kind === kind)?.price ?? 0n;
    const projected = millionths(j.money.spent + BigInt(remaining.model) * price(j.route) + BigInt(remaining.search) * of("search") + BigInt(remaining.lookup) * of("lookup"));
    return {
      id: j.spec.id,
      customer: j.spec.customer,
      brief: j.spec.brief,
      state: j.state,
      route: j.route,
      authorized: j.money.authorized,
      deposited: millionths(j.money.deposited + j.inFlight),
      spent: j.money.spent,
      remaining,
      projected,
      holdFinal: j.holdFinal,
      raisePending: j.raisePending,
      paragraphsDone: j.paragraphsDone,
      paragraphsTotal: j.paragraphsTotal,
      intentId: j.intentId,
      captured: j.money.captured,
    };
  }

  async run(): Promise<RunResult> {
    const s = this.d.scenario;
    const offers = await this.d.market.offers();
    const startRoute = offers.filter((o) => o.kind === "model").sort((a, b) => Number(a.price - b.price))[0]!.id;
    this.emit("run.started", null, { float: formatUsdz(s.float), reserveFloor: formatUsdz(s.reserveFloor), jobs: s.jobs.map((j) => j.id) });

    for (const spec of s.jobs) {
      const steps: Step[] = [];
      for (let i = 1; i <= spec.searches; i++) steps.push({ kind: "search", index: i });
      for (let i = 1; i <= spec.lookups; i++) steps.push({ kind: "lookup", index: i });
      for (let i = 1; i <= spec.paragraphs; i++) steps.push({ kind: "model", index: i });
      this.plannedSteps += steps.length;
      this.jobs.set(spec.id, {
        spec,
        state: "quoted",
        money: newJobMoney(spec.id, spec.hold),
        intentId: null,
        wallet: await this.d.wallet(spec.id),
        route: startRoute,
        steps,
        paragraphsDone: 0,
        paragraphsTotal: spec.paragraphs,
        holdFinal: false,
        raisePending: false,
        blockers: new Set(),
        inFlight: millionths(0n),
        outages: 0,
        output: [],
        headFailures: 0,
      });
    }

    // Holds first: a customer who never approves costs nothing and gets no float.
    await Promise.all([...this.jobs.values()].map((j) => this.openHold(j)));
    const held = [...this.jobs.values()].filter((j) => j.state === "held");

    // Every deposit before any job starts: a deposit only pays from the next epoch.
    for (const j of held) await this.topUp(j, j.spec.initialDeposit, "initial deposit");
    for (const j of held) this.move(j, "funded");
    this.emit("run.funded", null, { reserve: formatUsdz(this.reserve) });

    await Promise.all(held.map((j) => this.runJob(j)));
    await this.decisions;

    const reconciled = await this.reconcile();
    await this.queueWithdrawals();
    const chainIntact = this.d.log.verify() === null;
    this.emit("run.finished", null, { reconciled, reserve: formatUsdz(this.reserve) });

    return {
      jobs: [...this.jobs.values()].map((j) => ({
        id: j.spec.id,
        state: j.state,
        authorized: j.money.authorized,
        captured: j.money.captured,
        deposited: j.money.deposited,
        spent: j.money.spent,
        paragraphs: j.paragraphsDone,
        paragraphsPlanned: j.paragraphsTotal,
        finished: j.steps.length === 0,
        output: j.output,
      })),
      reserve: this.reserve,
      reconciled,
      chainIntact,
    };
  }

  private async openHold(job: Job) {
    this.move(job, "hold_requested");
    this.emit("hold.requested", job.spec.id, { customer: job.spec.customer, amount: formatUsd(job.spec.hold) });
    try {
      const hold = await this.d.holds.open({ id: job.spec.id, customer: job.spec.customer, amount: job.spec.hold });
      job.intentId = hold.intentId;
      job.money = { ...job.money, authorized: hold.authorized };
      this.move(job, "held");
      this.emit("hold.placed", job.spec.id, { intentId: hold.intentId, amount: formatUsd(hold.authorized), status: hold.status });
    } catch (e) {
      job.money = { ...job.money, cancelled: true };
      this.move(job, "cancelled");
      this.emit("hold.failed", job.spec.id, { error: String(e) });
    }
  }

  /** Deposits share one operator nonce, so they run one at a time. The reserve is spent before the await. */
  private topUp(job: Job, amount: Millionths, reason: string): Promise<void> {
    this.reserve = millionths(this.reserve - amount);
    job.inFlight = millionths(job.inFlight + amount);
    const done = this.deposits.then(async () => {
      const t = Date.now();
      for (let attempt = 1; ; attempt++) {
        try {
          await job.wallet.deposit(amount);
          break;
        } catch (e) {
          this.emit("float.deposit_failed", job.spec.id, { amount: formatUsdz(amount), attempt, error: String(e).slice(0, 300) });
          // It may have landed, so sending it again could pay twice. It stays unaccounted, and reconciliation says so.
          if (/outcome is unknown/.test(String(e))) return;
          if (attempt < DEPOSIT_TRIES) {
            await this.sleep(this.d.depositRetryMs ?? 5000);
            continue;
          }
          // It never reached the job, so it is back in the reserve and the next plan sees the true figures.
          this.reserve = millionths(this.reserve + amount);
          job.inFlight = millionths(job.inFlight - amount);
          return;
        }
      }
      job.inFlight = millionths(job.inFlight - amount);
      job.money = { ...job.money, deposited: millionths(job.money.deposited + amount) };
      this.emit("float.deposited", job.spec.id, { amount: formatUsdz(amount), reason, deposited: formatUsdz(job.money.deposited), reserve: formatUsdz(this.reserve), ms: Date.now() - t });
    });
    this.deposits = done;
    return done;
  }

  private block(job: Job, work: Promise<unknown>) {
    const p = work.finally(() => job.blockers.delete(p));
    job.blockers.add(p);
    return p;
  }

  private async unblocked(job: Job) {
    while (job.blockers.size) await Promise.allSettled([...job.blockers]);
  }

  private async runJob(job: Job) {
    this.move(job, "running");
    try {
      while (job.steps.length) {
        await this.unblocked(job);
        if (!job.steps.length) break;
        const step = job.steps[0]!;
        const providerId = await this.providerFor(job, step);
        const offers = await this.d.market.offers();
        const offer = offers.find((o) => o.id === providerId)!;

        const check = canPay(job.money, offer.price);
        if (!check.ok) {
          if (check.reason === "closed") break;
          this.emit("job.shortfall", job.spec.id, { reason: check.reason, detail: check.detail, price: formatUsdz(offer.price) });
          if (!(await this.resolveShortfall(job, offer.price))) {
            this.emit("job.stopped", job.spec.id, { reason: "no money the rules allow for the next step", stepsLeft: job.steps.length });
            break;
          }
          continue;
        }

        const url = this.d.market.url(providerId, { job: job.spec.id, step: `${step.kind}-${step.index}`, of: String(job.paragraphsTotal), attempt: String(job.headFailures) });
        const outcome = await this.payOrLost(job, url);
        if (!outcome) continue;
        if (!(await this.handleOutcome(job, step, providerId, outcome))) break;
        this.maybeShock();
      }
    } catch (e) {
      this.emit("job.failed", job.spec.id, { error: String(e) });
    }
    try {
      await this.close(job);
    } catch (e) {
      // The hold stays open for a person, and the other jobs still close.
      this.emit("close.blocked", job.spec.id, { reason: "airwallex_unreachable", detail: String(e).slice(0, 300) });
    }
  }

  /**
   * A request whose answer never came back may still have been paid. The wallet's record says which: a paid one
   * is a failed-after-payment like any other, and an unpaid one is sent again. Null means "send it again".
   */
  private async payOrLost(job: Job, url: string): Promise<Awaited<ReturnType<WalletPort["pay"]>> | null> {
    const before = new Set((await job.wallet.payments()).map((p) => p.id));
    try {
      const outcome = await job.wallet.pay(url);
      job.outages = 0;
      return outcome;
    } catch (e) {
      if (!isTransient(e)) throw e;
      const paid = (await job.wallet.payments()).find((p) => !before.has(p.id));
      if (paid) return { kind: "paid", status: 0, body: "", price: paid.amount, payment: paid, tries: 1, ms: 0 };
      if (++job.outages >= OUTAGE_TRIES) throw e;
      this.emit("step.retry", job.spec.id, { attempt: job.outages, error: String(e).slice(0, 200) });
      await this.sleep(this.d.depositRetryMs ?? 5000);
      return null;
    }
  }

  /** Waits out a brief outage. Only for calls that are safe to send again. */
  private async retrying<T>(event: string, job: Job, call: () => Promise<T>, canRetry: (e: unknown) => boolean = () => true): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (e) {
        if (attempt >= OUTAGE_TRIES || !canRetry(e)) throw e;
        this.emit(event, job.spec.id, { attempt, error: String(e).slice(0, 200) });
        await this.sleep(this.d.depositRetryMs ?? 5000);
      }
    }
  }

  /** The cheap default is the job's route; the planner may pay up for a paragraph that matters. */
  private async providerFor(job: Job, step: Step): Promise<string> {
    const offers = await this.d.market.offers();
    if (step.kind !== "model") return offers.find((o) => o.kind === step.kind)!.id;
    const verdict = await this.d.planner.judgeStep(this.jobView(job, offers), { index: step.index, total: job.paragraphsTotal }, offers, this.floatSlack(offers));
    if (verdict.providerId && verdict.providerId !== job.route) {
      this.emit("step.upgraded", job.spec.id, { paragraph: step.index, provider: verdict.providerId, reason: verdict.reason });
      return verdict.providerId;
    }
    return job.route;
  }

  /** Free reserve plus unspent deposits, minus what every live job still expects to spend. */
  private floatSlack(offers: Offer[]): Millionths {
    let slack = this.reserve - this.d.scenario.reserveFloor;
    for (const j of this.jobs.values()) {
      if (!holdIsOpen(j.state)) continue;
      const v = this.jobView(j, offers);
      slack += v.deposited - v.projected;
    }
    return millionths(slack);
  }

  private async handleOutcome(job: Job, step: Step, providerId: string, outcome: Awaited<ReturnType<WalletPort["pay"]>>): Promise<boolean> {
    const id = job.spec.id;
    switch (outcome.kind) {
      case "paid": {
        // Spend comes from the wallet's record, which includes requests that failed after payment.
        const spent = await job.wallet.spent();
        job.money = { ...job.money, spent };
        this.emit("payment", id, { provider: providerId, step: `${step.kind}-${step.index}`, price: formatUsdz(outcome.price), spent: formatUsdz(spent), status: outcome.status, tries: outcome.tries, ms: outcome.ms, invoice: outcome.payment.id });
        if (outcome.status === 200) {
          job.steps.shift();
          job.headFailures = 0;
          this.doneSteps++;
          if (step.kind === "model") job.paragraphsDone++;
          const text = textOf(outcome.body);
          job.output.push(text);
          this.emit("report.text", id, { step: `${step.kind}-${step.index}`, provider: providerId, text });
          return true;
        }
        // It still cost its price. Try once more, then give up on this step rather than burn the budget.
        // Status 0: paid, but the answer never arrived.
        job.headFailures++;
        this.emit("step.failed_after_payment", id, { provider: providerId, status: outcome.status, ...(outcome.status === 0 ? { answer: "lost" } : {}), attempts: job.headFailures });
        if (job.headFailures >= 2) {
          job.steps.shift();
          job.headFailures = 0;
          this.doneSteps++;
        }
        return true;
      }
      case "unpaid":
        this.emit("step.unpaid", id, { provider: providerId, status: outcome.status, body: outcome.body.slice(0, 200) });
        job.headFailures++;
        if (job.headFailures >= 3) throw new Error(`${providerId} refused ${job.headFailures} times without taking payment`);
        return true;
      case "needs_deposit":
        // Normal right after a top-up: a deposit only counts from the next epoch.
        this.emit("step.waiting_for_deposit", id, { detail: outcome.detail });
        job.headFailures++;
        if (job.headFailures >= 12) throw new Error(`deposit never became spendable: ${outcome.detail}`);
        await this.sleep(this.d.depositRetryMs ?? 5000);
        return true;
      case "held":
        // A lost answer left a payment held for another URL. It must go through before anything else.
        this.emit("step.held_payment", id, { url: outcome.url, amount: outcome.amount });
        if (!outcome.url) throw new Error(`held payment with no URL: ${outcome.detail}`);
        await job.wallet.pay(outcome.url);
        job.money = { ...job.money, spent: await job.wallet.spent() };
        return true;
    }
  }

  /** Runs a replan and reports whether the job can now afford this price. */
  private async resolveShortfall(job: Job, price: Millionths): Promise<boolean> {
    await this.replan(`job ${job.spec.id} cannot afford its next step`);
    await this.unblocked(job);
    if (canPay(job.money, price).ok) return true;
    // The plan costs jobs at their route price, so a step upgraded to a dearer provider can still come up short.
    // Fund exactly that step if the rules allow it, rather than abandon a job with reserve to spare.
    const short = millionths(price - depositLeft(job.money));
    const allowed = checkTopUp(job.money, short, { reserve: this.reserve, floor: this.d.scenario.reserveFloor });
    if (!allowed.ok) return false;
    await this.block(job, this.topUp(job, short, "covers the next step exactly"));
    return canPay(job.money, price).ok;
  }

  private maybeShock() {
    if (this.shocked) return;
    const at = this.d.shockAt === undefined ? this.d.scenario.shock.atFractionOfRun : this.d.shockAt;
    if (at === null || this.plannedSteps === 0) return;
    if (this.doneSteps / this.plannedSteps >= at) void this.fireShock();
  }

  /** The kit's shock: one job's prompt runs to N times its budget, and the cheapest provider slows. */
  async fireShock(): Promise<void> {
    if (this.shocked) return;
    this.shocked = true;
    const { overrunJob, tokenMultiplier, slowProvider, slowLatencyMs } = this.d.scenario.shock;
    const job = this.jobs.get(overrunJob);
    if (job && job.steps.length) {
      const extra = job.paragraphsTotal * (tokenMultiplier - 1);
      for (let i = 1; i <= extra; i++) job.steps.push({ kind: "model", index: job.paragraphsTotal + i });
      job.paragraphsTotal += extra;
      this.plannedSteps += extra;
      this.emit("shock.overrun", overrunJob, { multiplier: tokenMultiplier, paragraphsNow: job.paragraphsTotal });
    }
    await this.d.market.setLatency(slowProvider, slowLatencyMs);
    this.emit("shock.slowdown", null, { provider: slowProvider, latencyMs: slowLatencyMs });
    await this.replan("the shock: an overrun and a slow provider");
  }

  /** Decisions run one at a time, so two jobs can't plan against the same reserve. */
  replan(reason: string): Promise<void> {
    const done = this.decisions.then(() => this.decide(reason));
    this.decisions = done.catch(() => undefined);
    return done;
  }

  private async decide(reason: string) {
    const offers = await this.d.market.offers();
    const live = [...this.jobs.values()].filter((j) => ["running", "rerouting", "over_budget", "awaiting_hold_raise"].includes(j.state));
    if (!live.length) return;
    const snapshot: Snapshot = { reason, jobs: live.map((j) => this.jobView(j, offers)), offers, reserve: this.reserve, floor: this.d.scenario.reserveFloor };
    let plan: Proposal[];
    try {
      plan = await this.d.planner.propose(snapshot);
    } catch (e) {
      this.emit("plan.failed", null, { error: String(e) });
      return;
    }
    const verdicts = checkPlan(plan, {
      jobs: new Map(live.map((j) => [j.spec.id, { ...j.money, deposited: millionths(j.money.deposited + j.inFlight) }])),
      pool: { reserve: this.reserve, floor: this.d.scenario.reserveFloor },
      offers: new Map(offers.map((o) => [o.id, { id: o.id, kind: o.kind, price: o.price, available: true }])),
      maxPayment: this.d.scenario.maxPayment,
      heldPayments: new Map(),
    });
    this.emit("plan.revised", null, {
      reason,
      planner: this.d.planner.lastPlan ?? { source: "rules" },
      reserve: formatUsdz(this.reserve),
      decisions: verdicts.map((v) => ({ ...describe(v.proposal), accepted: v.accepted, ...(v.accepted ? {} : { refused: v.reason }) })),
    });
    for (const v of verdicts) if (v.accepted) this.apply(v.proposal);
  }

  private apply(p: Proposal) {
    const job = this.jobs.get(p.jobId)!;
    switch (p.kind) {
      case "reroute":
        if (job.state === "running") {
          this.move(job, "rerouting");
          job.route = p.toProvider;
          this.emit("job.rerouted", job.spec.id, { to: p.toProvider, reason: p.reason });
          this.move(job, "running");
        } else {
          job.route = p.toProvider;
          this.emit("job.rerouted", job.spec.id, { to: p.toProvider, reason: p.reason });
        }
        return;
      case "grant_reserve":
        void this.block(job, this.topUp(job, p.amount, p.reason));
        return;
      case "ask_hold_raise":
        void this.block(job, this.askHoldRaise(job, p.newTotal, p.message));
        return;
      case "pause":
        this.emit("job.paused", job.spec.id, { reason: p.reason });
        return;
    }
  }

  /** Customer yes: raise the hold, then let a fresh plan top up. In that order, always. */
  private async askHoldRaise(job: Job, newTotal: Cents, message: string) {
    job.raisePending = true;
    if (job.state === "running") this.move(job, "over_budget");
    if (job.state === "over_budget") this.move(job, "awaiting_hold_raise");
    this.emit("hold.raise_requested", job.spec.id, { from: formatUsd(job.money.authorized), to: formatUsd(newTotal), message });
    let approved = false;
    try {
      approved = await this.d.approvals.requestHoldRaise({ jobId: job.spec.id, customer: job.spec.customer, currentHold: job.money.authorized, newTotal, spent: job.money.spent, message });
    } catch (e) {
      this.emit("hold.raise_failed", job.spec.id, { error: String(e) });
    }
    if (approved) {
      this.emit("hold.raise_approved", job.spec.id, { to: formatUsd(newTotal) });
      const r = await this.d.holds.increment(job.intentId!, newTotal);
      job.money = { ...job.money, authorized: r.authorized };
      this.emit("hold.raised", job.spec.id, { intentId: job.intentId, authorized: formatUsd(r.authorized), status: r.status });
    } else {
      job.holdFinal = true;
      this.emit("hold.raise_declined", job.spec.id, { hold: formatUsd(job.money.authorized) });
    }
    job.raisePending = false;
    if (job.state === "awaiting_hold_raise") this.move(job, "running");
    await this.replan(approved ? `customer ${job.spec.id} approved a higher hold` : `customer ${job.spec.id} declined; finish within the hold`);
  }

  private async close(job: Job) {
    if (!holdIsOpen(job.state)) return;
    if (job.state === "awaiting_hold_raise" || job.state === "over_budget") this.move(job, "running");
    if (job.state === "rerouting") this.move(job, "running");
    this.move(job, "draining");
    const payments = await job.wallet.payments();
    const result = closeAction(job.money, payments.map((p) => p.amount));
    if (!result.ok) {
      // A mismatch or an over-hold blocks the close for a person. Better a stuck hold than a wrong charge.
      this.emit("close.blocked", job.spec.id, { reason: result.reason, detail: result.detail });
      return;
    }
    if (result.action.kind === "cancel") {
      const r = await this.retrying("close.retry", job, () => this.d.holds.cancel(job.intentId!, "job paid for nothing"));
      job.money = { ...job.money, cancelled: true };
      this.move(job, "cancelled");
      this.emit("hold.cancelled", job.spec.id, { intentId: job.intentId, status: r.status });
      return;
    }
    this.move(job, "capturing");
    const { amount } = result.action;
    const r = await this.retrying("close.retry", job, () => this.d.holds.capture(job.intentId!, amount));
    job.money = { ...job.money, captured: r.captured };
    this.move(job, "captured");
    this.emit("hold.captured", job.spec.id, { intentId: job.intentId, captured: formatUsd(r.captured), authorized: formatUsd(job.money.authorized), status: r.status, walletSpent: formatUsdz(job.money.spent) });
  }

  /** capture == wallet record per job, and wallet records == the settlement layer per provider. */
  private async reconcile(): Promise<boolean> {
    let ok = true;
    const all = [...this.jobs.values()];
    // Every dollar of float is in the reserve or in a job's wallet. Anything else is money the books lost.
    await this.deposits;
    const accounted = millionths(this.reserve + sumMillionths(all.map((j) => j.money.deposited)));
    const floatMatch = accounted === this.d.scenario.float;
    ok &&= floatMatch;
    this.emit("reconcile.float", null, { float: formatUsdz(this.d.scenario.float), accounted: formatUsdz(accounted), match: floatMatch });
    for (const job of all) {
      if (job.money.captured === null) continue;
      const paid = sumMillionths((await job.wallet.payments()).map((p) => p.amount));
      const match = centsToMillionths(job.money.captured) === paid;
      ok &&= match;
      this.emit("reconcile.job", job.spec.id, { captured: formatUsd(job.money.captured), walletRecord: formatUsdz(paid), match });
    }
    const offers = await this.d.market.offers();
    const records = await Promise.all(all.map((j) => j.wallet.payments()));
    for (const offer of offers) {
      const key = this.d.market.clearingKey(offer.id);
      const wallets = sumMillionths(records.flat().filter((p) => p.recipient === key).map((p) => p.amount));
      const settled = await this.d.market.settled(offer.id);
      const match = wallets === settled;
      ok &&= match;
      this.emit("reconcile.provider", null, { provider: offer.id, walletRecords: formatUsdz(wallets), settled: formatUsdz(settled), match });
    }
    return ok;
  }

  /**
   * Unused float can only leave once final (minutes after a job's last payment), in two calls: queue, then claim.
   * Call this after run(). A job counts as withdrawn only when its payouts add up to its unused float, never on
   * an "empty" answer, which also means "nothing final yet". Returns false if `deadline` passes first.
   */
  async claimFloat(intervalMs: number, deadline: number): Promise<boolean> {
    const pending = [...this.jobs.values()].filter((j) => j.state === "float_withdraw_queued");
    const claimed = new Map(pending.map((j) => [j.spec.id, 0n]));
    const finish = (job: Job) => {
      this.move(job, "float_withdrawn");
      this.emit("float.withdrawn", job.spec.id, { amount: formatUsdz(millionths(claimed.get(job.spec.id)!)) });
      pending.splice(pending.indexOf(job), 1);
    };
    for (const job of [...pending]) if (job.money.deposited === job.money.spent) finish(job);
    while (pending.length && Date.now() < deadline) {
      for (const job of [...pending]) {
        try {
          const r = await job.wallet.withdraw();
          if (r.status !== "sent") continue;
          if (r.queued) this.emit("float.queued", job.spec.id, { tx: r.queued.tx });
          for (const c of r.claimed) {
            const amount = baseUnitsToMillionths(BigInt(c.amount));
            claimed.set(job.spec.id, claimed.get(job.spec.id)! + amount);
            this.emit("float.claimed", job.spec.id, { amount: formatUsdz(amount), tx: c.tx });
          }
          if (claimed.get(job.spec.id)! >= job.money.deposited - job.money.spent) finish(job);
        } catch (e) {
          this.emit("float.claim_retry", job.spec.id, { error: String(e).slice(0, 200) });
        }
      }
      if (pending.length) await this.sleep(intervalMs);
    }
    return pending.length === 0;
  }

  private async queueWithdrawals() {
    for (const job of this.jobs.values()) {
      if (job.state !== "captured" && job.state !== "cancelled") continue;
      const unused = millionths(job.money.deposited - job.money.spent);
      try {
        const result = await job.wallet.withdraw();
        this.move(job, "float_withdraw_queued");
        this.emit("float.withdraw_requested", job.spec.id, { unused: formatUsdz(unused), status: result.status });
      } catch (e) {
        this.emit("float.withdraw_failed", job.spec.id, { unused: formatUsdz(unused), error: String(e) });
      }
    }
  }
}

function textOf(body: string): string {
  try {
    return String((JSON.parse(body) as { text?: unknown }).text ?? body);
  } catch {
    return body;
  }
}

function describe(p: Proposal): Record<string, unknown> {
  switch (p.kind) {
    case "reroute":
      return { kind: p.kind, job: p.jobId, to: p.toProvider, why: p.reason };
    case "grant_reserve":
      return { kind: p.kind, job: p.jobId, amount: formatUsdz(p.amount), why: p.reason };
    case "ask_hold_raise":
      return { kind: p.kind, job: p.jobId, newTotal: formatUsd(p.newTotal), why: p.message };
    case "pause":
      return { kind: p.kind, job: p.jobId, why: p.reason };
  }
}
