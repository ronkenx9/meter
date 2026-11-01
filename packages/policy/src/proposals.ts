// The model's revised plan arrives as typed proposals. Each is checked against the money rules
// before anything moves; a rejected proposal is shown on the dashboard with its reason.

import type { Cents, Millionths } from "@meter/core";
import { type JobMoney, type Pool, canPay, checkIncrement, checkTopUp } from "./money.ts";

export interface ProviderOffer {
  id: string;
  kind: "model" | "search" | "lookup";
  /** The price in the provider's latest 402 offer, never a cached list price. */
  price: Millionths;
  available: boolean;
}

export type Proposal =
  | { kind: "reroute"; jobId: string; toProvider: string; reason: string }
  | { kind: "grant_reserve"; jobId: string; amount: Millionths; reason: string }
  | { kind: "ask_hold_raise"; jobId: string; newTotal: Cents; message: string }
  | { kind: "pause"; jobId: string; reason: string };

export interface PlanContext {
  jobs: ReadonlyMap<string, JobMoney>;
  pool: Pool;
  offers: ReadonlyMap<string, ProviderOffer>;
  maxPayment: Millionths;
  /** Jobs with a held payment whose answer was lost; they must resend to the same provider first. */
  heldPayments: ReadonlyMap<string, string>;
}

export type Verdict = { proposal: Proposal; accepted: true } | { proposal: Proposal; accepted: false; reason: string };

export function checkProposal(p: Proposal, ctx: PlanContext): Verdict {
  const job = ctx.jobs.get(p.jobId);
  if (!job) return { proposal: p, accepted: false, reason: `no job ${p.jobId}` };

  switch (p.kind) {
    case "reroute": {
      const offer = ctx.offers.get(p.toProvider);
      if (!offer || !offer.available) return { proposal: p, accepted: false, reason: `${p.toProvider} has no live offer` };
      if (offer.price > ctx.maxPayment) return { proposal: p, accepted: false, reason: `${p.toProvider} is above the clearing cap` };
      const held = ctx.heldPayments.get(p.jobId);
      if (held && held !== p.toProvider) {
        return { proposal: p, accepted: false, reason: `job ${p.jobId} must resend its held payment to ${held} before rerouting` };
      }
      const pay = canPay(job, offer.price);
      if (!pay.ok && pay.reason !== "needs_top_up") return { proposal: p, accepted: false, reason: pay.detail };
      return { proposal: p, accepted: true };
    }
    case "grant_reserve": {
      const top = checkTopUp(job, p.amount, ctx.pool);
      return top.ok ? { proposal: p, accepted: true } : { proposal: p, accepted: false, reason: top.detail };
    }
    case "ask_hold_raise": {
      const inc = checkIncrement(job, p.newTotal);
      return inc.ok ? { proposal: p, accepted: true } : { proposal: p, accepted: false, reason: inc.detail };
    }
    case "pause":
      return job.captured === null && !job.cancelled
        ? { proposal: p, accepted: true }
        : { proposal: p, accepted: false, reason: `job ${p.jobId} is closed` };
  }
}

/**
 * Checks a whole plan in order against a running copy of the pool, so two grants that each fit
 * alone cannot together drain the reserve below its floor.
 */
export function checkPlan(plan: readonly Proposal[], ctx: PlanContext): Verdict[] {
  let reserve = ctx.pool.reserve;
  const jobs = new Map(ctx.jobs);
  return plan.map((p) => {
    const v = checkProposal(p, { ...ctx, jobs, pool: { ...ctx.pool, reserve } });
    if (v.accepted && p.kind === "grant_reserve") {
      reserve = (reserve - p.amount) as Millionths;
      const j = jobs.get(p.jobId)!;
      jobs.set(p.jobId, { ...j, deposited: (j.deposited + p.amount) as Millionths });
    }
    return v;
  });
}
