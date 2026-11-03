// The agent: Claude reads the situation and proposes a typed plan. It holds no credentials and moves no money;
// every proposal still goes through the policy checks. Any model failure falls back to the rule planner, and
// the run log records which of the two decided.

import { type ModelClient, PLANNER_MODEL } from "@meter/ai";
import { type Millionths, UnitError, formatUsd, formatUsdz, millionths, parseUsd, parseUsdz } from "@meter/core";
import type { Proposal } from "@meter/policy";
import { RulePlanner, affordablePremium } from "./planner.ts";
import type { JobView, Offer, PlanSource, PlannerPort, Snapshot, StepJudgment } from "./ports.ts";

const PLAN_SYSTEM = `You run the buying desk for an AI research-report service. Several customer jobs run at once. Each customer approved a card hold, and each job pays providers per request from a deposit of *USDZ (1 *USDZ = $1). The float is short by design: the jobs could together spend more than it holds.

Your goals, in order: charge no customer past their hold; finish as many jobs in full as the money allows; then be fast. A slow provider delays work, but running out of money loses it. So before moving jobs to a dearer provider, add up what every job would then cost and compare it with the money available. If it doesn't fit, a job with few steps left costs little time on a slow provider, and what it saves can finish a job with many steps left.

Each time something changes, decide:
- reroute: move a job's paragraphs to another model provider. Avoid a provider answering in 3000 ms or more when the money allows it.
- grant_reserve: move money from the reserve to a job's deposit. Only the money above the reserve floor is available. Grant the job what it needs next.
- ask_hold_raise: ask a customer to raise their hold. Ask when a job can only finish, or can only leave a slow provider, by passing its hold AND the float could actually spend the extra once the other jobs' choices are counted; a raise the float can't fund wastes the customer's attention. newTotalUsd is the new total hold, covering only what can be funded. The message goes to the customer: plain, two sentences, what changed, what they get, that they are only charged for what is used, and what happens if they decline.
- pause: stop a job for now, only if that is clearly better than letting it run.

Code enforces the money rules and will refuse anything outside them: deposits can't pass a job's hold, the reserve can't go below its floor, and a raise must be above the current hold. Propose only what is worth doing now; an empty list is a fine answer. A job with raisePending or holdFinal must not be asked again. Amounts are decimal dollars. Give each decision a short reason a person could check.`;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "proposals"],
  properties: {
    summary: { type: "string" },
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "jobId", "toProvider", "amountUsd", "newTotalUsd", "text"],
        properties: {
          kind: { type: "string", enum: ["reroute", "grant_reserve", "ask_hold_raise", "pause"] },
          jobId: { type: "string" },
          toProvider: { type: ["string", "null"] },
          amountUsd: { type: ["string", "null"] },
          newTotalUsd: { type: ["string", "null"] },
          text: { type: "string", description: "The reason; for ask_hold_raise, the message to the customer." },
        },
      },
    },
  },
} as const;

const JUDGE_SYSTEM = `You decide which paragraphs of a research report are worth a dearer, better model. Pick at most 3: those a reader leans on most, such as the opening, a key comparison, or the conclusion. Most paragraphs should stay on the job's normal provider.`;

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paragraphs"],
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "why"],
        properties: { index: { type: "integer" }, why: { type: "string" } },
      },
    },
  },
} as const;

interface RawProposal {
  kind: Proposal["kind"];
  jobId: string;
  toProvider: string | null;
  amountUsd: string | null;
  newTotalUsd: string | null;
  text: string;
}

export class ClaudePlanner implements PlannerPort {
  private readonly client: ModelClient;
  private readonly fallback = new RulePlanner();
  private readonly judged = new Map<string, Promise<Map<number, string>>>();
  lastPlan: PlanSource = { source: "rules" };

  constructor(client: ModelClient) {
    this.client = client;
  }

  async propose(s: Snapshot): Promise<Proposal[]> {
    try {
      const { text, model } = await this.client.complete({
        model: PLANNER_MODEL,
        system: PLAN_SYSTEM,
        user: JSON.stringify(situation(s), null, 1),
        effort: "medium",
        maxTokens: 8000,
        schema: PLAN_SCHEMA,
        timeoutMs: 45_000,
      });
      const parsed = JSON.parse(text) as { summary: string; proposals: RawProposal[] };
      const plan = parsed.proposals.map(toProposal);
      this.lastPlan = { source: "model", model, summary: parsed.summary };
      return plan;
    } catch (e) {
      this.lastPlan = { source: "rules", note: `model unavailable, used rules: ${String((e as Error).message).slice(0, 160)}` };
      return this.fallback.propose(s);
    }
  }

  async judgeStep(job: JobView, paragraph: { index: number; total: number }, offers: Offer[], slack: Millionths): Promise<StepJudgment> {
    // One decision per report outline rather than one per paragraph, so judging doesn't slow every payment.
    const key = `${job.id}:${paragraph.total}`;
    let picks = this.judged.get(key);
    if (!picks) {
      picks = this.pickParagraphs(job, paragraph.total);
      this.judged.set(key, picks);
    }
    const why = (await picks).get(paragraph.index);
    if (!why) return { providerId: null, reason: "ordinary paragraph" };
    return affordablePremium(job, paragraph, offers, slack, why);
  }

  private async pickParagraphs(job: JobView, total: number): Promise<Map<number, string>> {
    try {
      const { text } = await this.client.complete({
        model: PLANNER_MODEL,
        system: JUDGE_SYSTEM,
        user: `Report: ${job.brief}\nParagraphs: ${total}, numbered from 1.`,
        effort: "low",
        maxTokens: 3000,
        schema: JUDGE_SCHEMA,
        timeoutMs: 30_000,
      });
      const { paragraphs } = JSON.parse(text) as { paragraphs: Array<{ index: number; why: string }> };
      return new Map(paragraphs.slice(0, 3).map((p) => [p.index, p.why]));
    } catch {
      return new Map([[1, "the opening"], [total, "the conclusion"]]);
    }
  }
}

function situation(s: Snapshot) {
  const price = (id: string) => s.offers.find((o) => o.id === id)?.price ?? 0n;
  const of = (kind: string) => s.offers.find((o) => o.kind === kind)?.price ?? 0n;
  return {
    whatChanged: s.reason,
    reserveUsd: formatUsdz(s.reserve),
    reserveFloorUsd: formatUsdz(s.floor),
    availableFromReserveUsd: formatUsdz(millionths(s.reserve - s.floor)),
    providers: s.offers.map((o) => ({ id: o.id, kind: o.kind, tier: o.tier, priceUsd: formatUsdz(o.price), latencyMs: o.latencyMs })),
    jobs: s.jobs.map((j) => ({
      id: j.id,
      brief: j.brief,
      state: j.state,
      route: j.route,
      holdUsd: formatUsd(j.authorized),
      depositedUsd: formatUsdz(j.deposited),
      spentUsd: formatUsdz(j.spent),
      remainingSteps: j.remaining,
      paragraphs: `${j.paragraphsDone} of ${j.paragraphsTotal}`,
      // Worked out here so the model reasons about the choice, not the arithmetic.
      projectedSpendByProviderUsd: Object.fromEntries(
        s.offers
          .filter((o) => o.kind === "model")
          .map((o) => [o.id, formatUsdz(millionths(j.spent + BigInt(j.remaining.model) * price(o.id) + BigInt(j.remaining.search) * of("search") + BigInt(j.remaining.lookup) * of("lookup")))]),
      ),
      raisePending: j.raisePending,
      holdFinal: j.holdFinal,
    })),
  };
}

function toProposal(p: RawProposal): Proposal {
  const need = (v: string | null, what: string): string => {
    if (v === null) throw new UnitError(`${p.kind} for ${p.jobId} has no ${what}`);
    return v.replace("$", "");
  };
  switch (p.kind) {
    case "reroute":
      return { kind: "reroute", jobId: p.jobId, toProvider: need(p.toProvider, "provider"), reason: p.text };
    case "grant_reserve":
      return { kind: "grant_reserve", jobId: p.jobId, amount: parseUsdz(need(p.amountUsd, "amount")), reason: p.text };
    case "ask_hold_raise":
      return { kind: "ask_hold_raise", jobId: p.jobId, newTotal: parseUsd(need(p.newTotalUsd, "new total")), message: p.text };
    case "pause":
      return { kind: "pause", jobId: p.jobId, reason: p.text };
    default:
      throw new UnitError(`unknown proposal kind ${String(p.kind)}`);
  }
}
