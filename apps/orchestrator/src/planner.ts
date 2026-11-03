// The deterministic planner: what runs with no model key, and what the model planner falls back to.
// It only proposes; the policy package decides what is allowed.

import { type Millionths, centsToMillionths, formatUsd, millionths, millionthsToCentsCeil } from "@meter/core";
import type { Proposal } from "@meter/policy";
import type { JobView, Offer, PlannerPort, Snapshot, StepJudgment } from "./ports.ts";

/** A model provider this slow is treated as unavailable for routing. */
export const SLOW_MS = 3000;

function cheapestModel(offers: Offer[]): Offer | undefined {
  return offers.filter((o) => o.kind === "model" && o.latencyMs < SLOW_MS).sort((a, b) => Number(a.price - b.price))[0];
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

export class RulePlanner implements PlannerPort {
  async propose(s: Snapshot): Promise<Proposal[]> {
    const plan: Proposal[] = [];
    const byId = new Map(s.offers.map((o) => [o.id, o]));
    const best = cheapestModel(s.offers);
    const of = (kind: string) => s.offers.find((o) => o.kind === kind)?.price ?? 0n;

    // 1. Move jobs off a slowed provider. Everything below is costed on the route each job will be on.
    const routes = new Map<string, string>();
    for (const j of s.jobs) {
      const route = byId.get(j.route);
      if (best && (!route || route.latencyMs >= SLOW_MS) && best.id !== j.route) {
        plan.push({ kind: "reroute", jobId: j.id, toProvider: best.id, reason: `${j.route} slowed to ${route?.latencyMs ?? "?"} ms; ${best.id} answers in ${best.latencyMs} ms for $${dollars(best.price)} a paragraph` });
        routes.set(j.id, best.id);
      } else routes.set(j.id, j.route);
    }
    const projected = (j: JobView): Millionths =>
      millionths(j.spent + BigInt(j.remaining.model) * (byId.get(routes.get(j.id)!)?.price ?? 0n) + BigInt(j.remaining.search) * of("search") + BigInt(j.remaining.lookup) * of("lookup"));

    // 2. Ration the reserve: smallest need first, so the most jobs finish. A job can only be funded up to its hold.
    const needs = s.jobs
      .filter((j) => !j.raisePending)
      .map((j) => ({ job: j, need: millionths(min(projected(j), centsToMillionths(j.authorized)) - j.deposited) }))
      .sort((a, b) => Number(a.need - b.need));
    let free = millionths(s.reserve - s.floor);
    for (const { job, need } of needs) {
      if (need <= 0n) continue;
      const amount = millionths(min(need, free));
      if (amount <= 0n) continue;
      plan.push({ kind: "grant_reserve", jobId: job.id, amount, reason: `${job.id} has ${job.remaining.model} paragraphs left and needs $${dollars(need)} more; reserve is the only source` });
      free = millionths(free - amount);
    }

    // 3. Ask a customer for more only if the float could actually spend it. A raise we can't fund is a pointless ask.
    for (const j of s.jobs) {
      if (j.holdFinal || j.raisePending) continue;
      const hold = centsToMillionths(j.authorized);
      const want = projected(j);
      if (want <= hold) continue;
      const grantedHere = plan.reduce((sum, p) => (p.kind === "grant_reserve" && p.jobId === j.id ? sum + p.amount : sum), 0n);
      const fundable = millionths(j.deposited + grantedHere + free);
      const newTotal = millionthsToCentsCeil(millionths(min(want, fundable)));
      if (newTotal <= j.authorized) continue;
      plan.push({
        kind: "ask_hold_raise",
        jobId: j.id,
        newTotal,
        message: `Your report grew: ${j.remaining.model} paragraphs remain. Raising your hold from ${formatUsd(j.authorized)} to ${formatUsd(newTotal)} lets us ${want > fundable ? "write as much of it as our funds allow" : "finish it"}. You are only charged for what is actually used. If you decline, we stop at your current hold and send what is done.`,
      });
    }
    return plan;
  }

  async judgeStep(job: JobView, paragraph: { index: number; total: number }, offers: Offer[], slack: Millionths): Promise<StepJudgment> {
    // The opening and the conclusion carry the report.
    if (paragraph.index !== 1 && paragraph.index !== paragraph.total) return { providerId: null, reason: "ordinary paragraph" };
    return affordablePremium(job, paragraph, offers, slack, `paragraph ${paragraph.index} of ${paragraph.total} is the ${paragraph.index === 1 ? "opening" : "conclusion"}`);
  }
}

/** A paragraph worth paying up for only gets it while the whole float and this customer's hold have room. */
export function affordablePremium(job: JobView, paragraph: { index: number }, offers: Offer[], slack: Millionths, why: string): StepJudgment {
  const premium = offers.filter((o) => o.kind === "model" && o.latencyMs < SLOW_MS).sort((a, b) => Number(b.price - a.price))[0];
  if (!premium || premium.id === job.route) return { providerId: null, reason: "already on the best provider" };
  const extra = premium.price - (offers.find((o) => o.id === job.route)?.price ?? 0n);
  if (slack < extra) return { providerId: null, reason: `paragraph ${paragraph.index} matters, but the float is short by $${dollars(extra - slack)}` };
  if (job.projected + extra > centsToMillionths(job.authorized)) return { providerId: null, reason: "no room under the customer's hold" };
  return { providerId: premium.id, reason: why };
}

function dollars(m: bigint): string {
  return (Number(m) / 1_000_000).toFixed(2);
}
