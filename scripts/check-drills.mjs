// The two recorded break-it drills did what they claim. Usage: check-drills.mjs lost-answer|crash <log.jsonl>
import { readFileSync } from "node:fs";
const [kind, file] = process.argv.slice(2);
const L = readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
const of = (t) => L.filter((e) => e.type === t);
const fail = (m) => { console.error(m); process.exit(1); };
const paid = (job) => of("payment").filter((e) => e.job === job).reduce((s, e) => s + Math.round(Number(e.data.price) * 1e6), 0);

if (kind === "lost-answer") {
  if (!of("drill.lose_answer").length) fail("no drill");
  const lost = of("step.failed_after_payment").find((e) => e.data.answer === "lost");
  if (!lost) fail("no paid request was booked as a lost answer");
  const step = of("payment").find((e) => e.seq < lost.seq && e.data.status === 0)?.data.step;
  if (!of("report.text").some((e) => e.job === lost.job && e.data.step === step)) fail(`step ${step} was never delivered after the loss`);
  const cap = of("hold.captured").find((e) => e.job === lost.job);
  if (Math.round(Number(cap.data.captured.slice(1)) * 1e6) !== paid(lost.job)) fail("capture differs from what was paid");
  if (of("run.finished")[0]?.data.reconciled !== true) fail("not reconciled");
  console.log(`LOST_ANSWER_OK ${lost.data.provider} answer lost, booked as paid, ${step} bought again, charged ${cap.data.captured}`);
} else if (kind === "crash") {
  if (of("run.finished").length || of("hold.captured").length) fail("the run was not cut short");
  const done = of("recovery.captured");
  if (done.length !== 1) fail("recovery did not capture exactly once");
  const c = done[0];
  if (Math.round(Number(c.data.captured.slice(1)) * 1e6) !== paid(c.job)) fail("recovery captured something other than what was paid");
  if (!of("recovery.already_closed").some((e) => e.job === c.job)) fail("a second recovery was not shown to be harmless");
  console.log(`CRASH_RECOVERY_OK ${c.job} captured ${c.data.captured} after the crash, second pass changed nothing`);
} else fail("usage: check-drills.mjs lost-answer|crash <log.jsonl>");
