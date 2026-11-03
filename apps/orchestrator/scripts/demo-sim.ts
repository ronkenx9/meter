// `pnpm demo:sim`: the whole Kit 12 scenario offline, with no keys, printed as a story.
// Pass --decline to have the customer refuse the higher hold.
import { fileURLToPath } from "node:url";
import { formatUsd, formatUsdz, loadScenario } from "@meter/core";
import { EventLog } from "@meter/ledger";
import { Engine } from "../src/engine.ts";
import { RulePlanner } from "../src/planner.ts";
import { SimApprovals, SimHolds, SimMarket, SimWallet } from "../src/sim.ts";

const scenario = loadScenario(fileURLToPath(new URL("../../../scenario/kit12.json", import.meta.url)));
const decline = process.argv.includes("--decline");
const market = new SimMarket(scenario);
const log = new EventLog(":memory:");
const quiet = new Set(["job.state", "payment", "reconcile.provider"]);
log.subscribe((e) => {
  if (quiet.has(e.type)) return;
  console.log(`${String(e.seq).padStart(4)} ${e.type.padEnd(24)} ${(e.job ?? "-").padEnd(2)} ${JSON.stringify(e.data).slice(0, 240)}`);
});

const engine = new Engine({
  scenario,
  market,
  holds: new SimHolds(),
  approvals: new SimApprovals(() => !decline),
  planner: new RulePlanner(),
  log,
  wallet: async (id) => new SimWallet(market, scenario.maxPayment, id),
  sleep: async () => undefined,
  depositRetryMs: 0,
});

const r = await engine.run();
console.log("\njob  state                   hold    captured  deposited  spent     paragraphs  finished");
for (const j of r.jobs) {
  console.log(`${j.id.padEnd(4)} ${j.state.padEnd(23)} ${formatUsd(j.authorized).padEnd(7)} ${(j.captured === null ? "-" : formatUsd(j.captured)).padEnd(9)} ${formatUsdz(j.deposited).padEnd(10)} ${formatUsdz(j.spent).padEnd(9)} ${`${j.paragraphs}/${j.paragraphsPlanned}`.padEnd(11)} ${j.finished}`);
}
console.log(`reserve left ${formatUsdz(r.reserve)}  reconciled ${r.reconciled}  log intact ${r.chainIntact}  events ${log.all().length}`);
