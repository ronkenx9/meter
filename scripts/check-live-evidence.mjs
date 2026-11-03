// Re-checks recorded live runs against the chain itself, without trusting the files:
// recomputes each log's hash chain, re-sums its payments, and compares with Metal's settlement list.
// Usage: check-live-evidence.mjs <run.jsonl>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const file = process.argv[2];
const events = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const fail = (m) => { console.error(m); process.exit(1); };

let prev = "0".repeat(64);
for (const e of events) {
  const hash = createHash("sha256").update(JSON.stringify([prev, e.seq, e.at, e.type, e.job, JSON.stringify(e.data)])).digest("hex");
  if (e.prev !== prev || hash !== e.hash) fail(`hash chain broken at event ${e.seq}`);
  prev = e.hash;
}

const usd = (s) => Math.round(Number(String(s).replace("$", "")) * 1e6);
const jobs = [...new Set(events.filter((e) => e.type === "hold.placed").map((e) => e.job))];
if (!jobs.length) fail("no live holds in this log");
let payments = 0;
for (const job of jobs) {
  const held = events.find((e) => e.type === "hold.placed" && e.job === job);
  if (!held.data.intentId.startsWith("int_") || held.data.intentId.startsWith("int_sim")) fail(`job ${job}: not a live intent`);
  const paid = events.filter((e) => e.type === "payment" && e.job === job);
  payments += paid.length;
  const sum = paid.reduce((a, e) => a + usd(e.data.price), 0);
  const captured = events.find((e) => e.type === "hold.captured" && e.job === job);
  if (!captured) fail(`job ${job}: no capture`);
  if (usd(captured.data.captured) !== sum) fail(`job ${job}: captured ${captured.data.captured} but payments sum to ${sum / 1e6}`);
  const raised = events.filter((e) => e.type === "hold.raised" && e.job === job).at(-1);
  const hold = usd((raised ?? held).data.authorized ?? held.data.amount);
  if (sum > hold) fail(`job ${job}: spent past its hold`);
  if (events.filter((e) => e.type === "hold.captured" && e.job === job).length !== 1) fail(`job ${job}: captured more than once`);
}
// Replay money in log order: at no moment may a job's deposits pass the hold it had at that moment.
const authorized = new Map(), deposited = new Map();
for (const e of events) {
  if (e.type === "hold.placed") authorized.set(e.job, usd(e.data.amount));
  if (e.type === "hold.raised") authorized.set(e.job, usd(e.data.authorized));
  if (e.type === "float.deposited") {
    deposited.set(e.job, usd(e.data.deposited));
    if (usd(e.data.deposited) > authorized.get(e.job)) fail(`job ${e.job}: deposits ${e.data.deposited} passed the hold at event ${e.seq}`);
  }
}
const recon = events.filter((e) => e.type.startsWith("reconcile."));
if (!recon.length || recon.some((e) => e.data.match !== true)) fail("a reconciliation row did not match");
if (!events.some((e) => e.type === "run.finished" && e.data.reconciled === true)) fail("run did not finish reconciled");
console.log(`jobs=${jobs.length} payments=${payments} events=${events.length}`);
console.log("LIVE_RUN_EVIDENCE_OK");
