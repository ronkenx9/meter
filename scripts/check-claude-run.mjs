// The recorded Kit 12 run was decided and written by real Claude, and it is a good run, not only a tidy one.
import { readFileSync } from "node:fs";
const L = readFileSync(process.argv[2], "utf8").trim().split("\n").map(JSON.parse);
const of = (t) => L.filter((e) => e.type === t);
const fail = (m) => { console.error(m); process.exit(1); };

const ai = of("ai.status")[0];
if (ai?.data.planner !== "claude" || ai.data.writer !== "claude") fail("the run did not use Claude");
const plans = of("plan.revised");
if (!plans.length || plans.some((p) => p.data.planner.source !== "model")) fail("a plan came from the rule fallback");
if (of("job.stopped").length || of("job.failed").length) fail("a job did not finish");

const scope = { A: 14, B: 40, C: 10 };
for (const [job, want] of Object.entries(scope)) {
  const done = of("report.text").filter((e) => e.job === job && e.data.step.startsWith("model"));
  if (new Set(done.map((e) => e.data.step)).size !== want) fail(`job ${job} delivered ${done.length} of ${want} paragraphs`);
  for (const e of done) if (/\bparagraph\b|should (cover|establish)/i.test(e.data.text) || e.data.text.includes("\n\n")) fail(`job ${job} ${e.data.step} describes itself`);
}
const tiers = new Set(of("report.text").map((e) => e.data.provider));
for (const t of ["model-basic", "model-standard", "model-premium"]) if (!tiers.has(t)) fail(`${t} never wrote anything`);

const noRaise = process.argv[3] === "--no-raise";
if (noRaise) {
  // The other good outcome: a raise the float could not fund is never asked for, and every job fits its first hold.
  if (of("hold.raise_requested").length) fail("a raise was asked for");
  if (!of("shock.overrun").length || !of("job.rerouted").length) fail("no shock, or nothing moved off the slow provider");
  const first = Object.fromEntries(of("hold.placed").map((e) => [e.job, Number(e.data.amount.slice(1))]));
  for (const c of of("hold.captured")) if (Number(c.data.captured.slice(1)) > first[c.job]) fail(`job ${c.job} was charged past its hold`);
  if (!plans.some((p) => /raise/i.test(p.data.planner.summary ?? ""))) fail("no plan says why no raise was asked");
} else {
  if (!of("hold.raise_requested").some((e) => e.job === "B") || !of("hold.raised").some((e) => e.job === "B")) fail("no customer-approved raise");
  const raiseAt = of("hold.raised")[0].seq;
  const topUpAfter = of("float.deposited").some((e) => e.job === "B" && e.seq > raiseAt);
  if (!topUpAfter) fail("nothing was deposited after the raise");
}
const float = of("reconcile.float")[0];
if (!float?.data.match) fail("the float does not balance");
if (of("run.finished")[0]?.data.reconciled !== true) fail("the run did not reconcile");
console.log(`CLAUDE_RUN_OK${noRaise ? " no raise needed," : ""} ${plans.length} plans, ${of("report.text").length} texts, charged ${of("hold.captured").map((e) => `${e.job} ${e.data.captured}`).join(", ")}`);
