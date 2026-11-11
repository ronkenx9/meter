// Plays a recorded run back through the dashboard, with no keys and no network. The picture is rebuilt from
// the recorded events alone, and the recording's hash chain is checked first, so what plays is what happened.

import { readFileSync } from "node:fs";
import { type Scenario, formatUsd, formatUsdz } from "@meter/core";
import { type LogEvent, verifyEvents } from "@meter/ledger";

const dollars = (s: unknown) => Number(String(s).replace("$", ""));
const six = (n: number) => n.toFixed(6);

interface ReplayJob {
  id: string;
  customer: string;
  brief: string;
  state: string;
  route: string;
  authorized: string;
  deposited: string;
  spent: string;
  remaining: { model: number; search: number; lookup: number };
  projected: string;
  holdFinal: boolean;
  raisePending: boolean;
  paragraphsDone: number;
  paragraphsTotal: number;
  intentId: string | null;
  captured: string | null;
}

export function loadRecording(path: string): LogEvent[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogEvent);
}

export class Replay {
  readonly id: string;
  readonly recordedAt: string;
  readonly chainBroken: number | null;
  private readonly events: LogEvent[];
  private readonly played: LogEvent[] = [];
  private readonly listeners = new Set<(e: LogEvent) => void>();
  private readonly jobs: ReplayJob[];
  private readonly offers: Array<{ id: string; kind: string; tier: string | null; price: string; latencyMs: number }>;
  private readonly raises = new Map<string, { jobId: string; customer: string; currentHold: string; newTotal: string; spent: string; message: string }>();
  private readonly float: string;
  private readonly floor: string;
  private reserve: string;
  private shocked = false;
  private result: { reconciled: boolean; chainIntact: boolean } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(events: LogEvent[], scenario: Scenario, name: string) {
    this.events = events;
    this.id = `replay-${name}`;
    this.recordedAt = events[0]?.at ?? "";
    this.chainBroken = verifyEvents(events);
    const started = events.find((e) => e.type === "run.started")?.data ?? {};
    this.float = String(started.float ?? formatUsdz(scenario.float));
    this.floor = String(started.reserveFloor ?? formatUsdz(scenario.reserveFloor));
    this.reserve = this.float;
    this.offers = scenario.providers.map((p) => ({ id: p.id, kind: p.kind, tier: p.tier ?? null, price: formatUsdz(p.price), latencyMs: p.latencyMs }));
    const start = [...scenario.providers].filter((p) => p.kind === "model").sort((a, b) => Number(a.price - b.price))[0]!.id;
    const ran = new Set((started.jobs as string[] | undefined) ?? scenario.jobs.map((j) => j.id));
    // A one-job recording is the short rails check, which runs 3 paragraphs, 1 search and 1 lookup.
    const short = ran.size === 1 && !events.some((e) => e.type === "shock.overrun");
    const sized = scenario.jobs.filter((j) => ran.has(j.id)).map((j) => (short ? { ...j, paragraphs: 3, searches: 1, lookups: 1 } : j));
    this.jobs = sized.map((j) => ({
      id: j.id,
      customer: j.customer,
      brief: j.brief,
      state: "quoted",
      route: start,
      authorized: formatUsd(j.hold),
      deposited: six(0),
      spent: six(0),
      remaining: { model: j.paragraphs, search: j.searches, lookup: j.lookups },
      projected: six(0),
      holdFinal: false,
      raisePending: false,
      paragraphsDone: 0,
      paragraphsTotal: j.paragraphs,
      intentId: null,
      captured: null,
    }));
  }

  get finished() {
    return this.played.length === this.events.length;
  }

  /** Waits between events are the recorded ones, divided by `speed` and capped, so minutes of waiting play in seconds. */
  start(speed = 14, capMs = 650) {
    let i = 0;
    const next = () => {
      const e = this.events[i++];
      if (!e) return;
      this.apply(e);
      this.played.push(e);
      for (const l of this.listeners) l(e);
      const after = this.events[i];
      if (!after) return;
      const gap = new Date(after.at).getTime() - new Date(e.at).getTime();
      this.timer = setTimeout(next, Math.max(0, Math.min(gap / speed, capMs)));
    };
    next();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  all(afterSeq = 0) {
    return this.played.filter((e) => e.seq > afterSeq);
  }

  subscribe(l: (e: LogEvent) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private price(id: string) {
    return dollars(this.offers.find((o) => o.id === id)?.price ?? 0);
  }

  private apply(e: LogEvent) {
    const d = e.data;
    const job = this.jobs.find((j) => j.id === e.job);
    switch (e.type) {
      case "job.state":
        if (job) job.state = String(d.state);
        break;
      case "hold.placed":
        if (job) Object.assign(job, { intentId: String(d.intentId), authorized: String(d.amount) });
        break;
      case "hold.raised":
        if (job) job.authorized = String(d.authorized);
        break;
      case "float.deposited":
        if (job) job.deposited = String(d.deposited);
        this.reserve = String(d.reserve);
        break;
      case "run.funded":
        this.reserve = String(d.reserve);
        break;
      case "payment":
        if (job) job.spent = String(d.spent);
        break;
      case "report.text":
      case "step.skipped": {
        if (!job) break;
        const kind = String(d.step).split("-")[0] as "model" | "search" | "lookup";
        job.remaining[kind] = Math.max(0, job.remaining[kind] - 1);
        if (kind === "model" && e.type === "report.text") job.paragraphsDone++;
        break;
      }
      case "shock.overrun":
        if (job) {
          job.remaining.model += Number(d.paragraphsNow) - job.paragraphsTotal;
          job.paragraphsTotal = Number(d.paragraphsNow);
        }
        this.shocked = true;
        break;
      case "shock.slowdown": {
        const o = this.offers.find((x) => x.id === d.provider);
        if (o) o.latencyMs = Number(d.latencyMs);
        break;
      }
      case "drill.reprice_over_cap": {
        const o = this.offers.find((x) => x.id === d.provider);
        if (o) o.price = six(Number(d.price));
        break;
      }
      case "job.rerouted":
        if (job) job.route = String(d.to);
        break;
      case "hold.raise_requested":
        if (job) {
          job.raisePending = true;
          this.raises.set(job.id, { jobId: job.id, customer: job.customer, currentHold: String(d.from), newTotal: String(d.to), spent: job.spent, message: String(d.message) });
        }
        break;
      case "hold.raise_approved":
      case "hold.raise_declined":
      case "hold.raise_failed":
        if (job) {
          job.raisePending = false;
          job.holdFinal = e.type !== "hold.raise_approved";
          this.raises.delete(job.id);
        }
        break;
      case "hold.captured":
        if (job) job.captured = String(d.captured);
        break;
      case "run.finished":
        this.result = { reconciled: d.reconciled === true, chainIntact: this.chainBroken === null };
        break;
    }
    for (const j of this.jobs) {
      const of = (kind: string) => dollars(this.offers.find((o) => o.kind === kind)?.price ?? 0);
      j.projected = six(dollars(j.spent) + j.remaining.model * this.price(j.route) + j.remaining.search * of("search") + j.remaining.lookup * of("lookup"));
    }
  }

  state(liveReady: boolean) {
    return {
      run: this.id,
      mode: "replay",
      recordedAt: this.recordedAt,
      liveReady,
      finished: this.finished,
      error: null,
      shocked: this.shocked,
      float: this.float,
      floor: this.floor,
      reserve: this.reserve,
      offers: this.offers,
      jobs: this.jobs,
      holdsWaiting: [],
      raisesWaiting: [...this.raises.values()],
      chainBroken: this.chainBroken,
      events: this.played.length,
      result: this.result,
    };
  }
}
