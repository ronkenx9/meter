// The keyless replay rebuilds the dashboard's picture from a recording alone. This plays every recording to the
// end and checks the picture against the recording's own closing figures. Usage: check-replay.ts
import { fileURLToPath } from "node:url";
import { loadScenario } from "@meter/core";
import { Replay, loadRecording } from "../src/replay.ts";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const scenario = loadScenario(root("scenario/kit12.json"));
const fail = (m: string) => {
  console.error(m);
  process.exit(1);
};

const out: string[] = [];
for (const name of ["live-kit12-run", "live-kit12-no-raise-run", "live-swapped-payee-drill", "live-lost-answer-drill"]) {
  const events = loadRecording(root(`research/${name}.jsonl`));
  const replay = new Replay(events, scenario, name);
  if (replay.chainBroken !== null) fail(`${name}: hash chain broken at event ${replay.chainBroken}`);
  await new Promise<void>((done) => {
    replay.subscribe(() => replay.finished && done());
    replay.start(1e9, 0);
  });
  const s = replay.state(false);
  if (s.events !== events.length) fail(`${name}: played ${s.events} of ${events.length} events`);
  for (const cap of events.filter((e) => e.type === "hold.captured")) {
    const job = s.jobs.find((j) => j.id === cap.job)!;
    if (job.captured !== cap.data.captured) fail(`${name}: job ${cap.job} shows ${job.captured}, recorded ${String(cap.data.captured)}`);
    if (Number(job.spent).toFixed(2) !== Number(String(cap.data.captured).slice(1)).toFixed(2)) fail(`${name}: job ${cap.job} spend ${job.spent} differs from its charge`);
    if (Number(job.deposited) > Number(job.authorized.slice(1)) + 1e-9) fail(`${name}: job ${cap.job} shows deposits past its hold`);
  }
  const reserve = events.findLast((e) => e.type === "run.finished")?.data.reserve;
  if (reserve !== undefined && s.reserve !== reserve) fail(`${name}: reserve shows ${s.reserve}, recorded ${String(reserve)}`);
  out.push(`${name} ${events.length}`);
}
console.log(`REPLAY_OK ${out.join(", ")} events; every charge, spend and reserve matches the recording`);
