// `node --env-file=.env apps/orchestrator/scripts/check-planner.ts [rounds]`: the agent's judgment on real Claude at two
// recorded moments, no money involved. Prints what each plan would leave every job with, so a bad plan is plain to see.
import { createModelClient } from "@meter/ai";
import { formatUsdz, millionths, parseUsd, parseUsdz } from "@meter/core";
import { ClaudePlanner } from "../src/claude-planner.ts";
import type { JobView, Offer, Snapshot } from "../src/ports.ts";

const client = createModelClient();
if (!client) throw new Error("ANTHROPIC_API_KEY is not set");
const rounds = Number(process.argv[2] ?? 3);

const offers: Offer[] = [
  { id: "model-basic", kind: "model", tier: "basic", price: parseUsdz("0.01"), latencyMs: 6000 },
  { id: "model-standard", kind: "model", tier: "standard", price: parseUsdz("0.02"), latencyMs: 700 },
  { id: "model-premium", kind: "model", tier: "premium", price: parseUsdz("0.05"), latencyMs: 1200 },
  { id: "search", kind: "search", tier: null, price: parseUsdz("0.02"), latencyMs: 500 },
  { id: "lookup", kind: "lookup", tier: null, price: parseUsdz("0.03"), latencyMs: 500 },
];
const job = (id: string, hold: string, deposited: string, spent: string, left: number, total: number): JobView => ({
  id,
  customer: `Customer ${id}`,
  brief: "A research report",
  state: "running",
  route: "model-basic",
  authorized: parseUsd(hold),
  deposited: parseUsdz(deposited),
  spent: parseUsdz(spent),
  remaining: { model: left, search: 0, lookup: 0 },
  projected: parseUsdz(spent) + BigInt(left) * parseUsdz("0.01"),
  holdFinal: false,
  raisePending: false,
  paragraphsDone: total - left,
  paragraphsTotal: total,
  intentId: "int_x",
  captured: null,
} as JobView);

const moments: Array<[string, Snapshot]> = [
  ["three jobs, the float can't put them all on the fast provider", { reason: "the shock: an overrun and a slow provider", jobs: [job("A", "1.00", "0.25", "0.21", 9, 14), job("B", "0.75", "0.20", "0.18", 36, 40), job("C", "0.75", "0.25", "0.20", 5, 10)], offers, reserve: parseUsdz("0.80"), floor: parseUsdz("0.05") }],
  ["one job, plenty of float, no raise needed", { reason: "the cheapest provider slowed", jobs: [job("B", "0.75", "0.20", "0.10", 30, 33)], offers, reserve: parseUsdz("0.85"), floor: parseUsdz("0.05") }],
];

for (const [name, snap] of moments) {
  console.log(`\n=== ${name}`);
  const results = await Promise.all(
    Array.from({ length: rounds }, async () => {
      const planner = new ClaudePlanner(client);
      const plan = await planner.propose(snap);
      return { plan, source: planner.lastPlan.source, summary: planner.lastPlan.summary };
    }),
  );
  for (const { plan, source } of results) {
    const route = new Map(snap.jobs.map((j) => [j.id, j.route]));
    const funded = new Map(snap.jobs.map((j) => [j.id, j.deposited]));
    const hold = new Map(snap.jobs.map((j) => [j.id, j.authorized as bigint]));
    let granted = millionths(0n);
    for (const p of plan) {
      if (p.kind === "reroute") route.set(p.jobId, p.toProvider);
      if (p.kind === "grant_reserve") {
        funded.set(p.jobId, millionths(funded.get(p.jobId)! + p.amount));
        granted = millionths(granted + p.amount);
      }
      if (p.kind === "ask_hold_raise") hold.set(p.jobId, BigInt(p.newTotal));
    }
    const rows = snap.jobs.map((j) => {
      const price = offers.find((o) => o.id === route.get(j.id))!.price;
      const needs = millionths(j.spent + BigInt(j.remaining.model) * price);
      return `${j.id} ${route.get(j.id)} needs ${formatUsdz(needs)} funded ${formatUsdz(funded.get(j.id)!)} hold $${Number(hold.get(j.id)) / 100}`;
    });
    console.log(`[${source}] granted ${formatUsdz(granted)} | ${rows.join(" | ")} | raises: ${plan.filter((p) => p.kind === "ask_hold_raise").length}`);
  }
  const raise = results.flatMap((r) => r.plan).find((p) => p.kind === "ask_hold_raise");
  if (raise && raise.kind === "ask_hold_raise") console.log(`customer message: ${raise.message}`);
}
