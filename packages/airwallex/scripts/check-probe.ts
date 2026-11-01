// Re-checks the recorded hold probe against live Airwallex state, so the evidence can't go stale silently:
// tab 1 must still read SUCCEEDED with $1.40 authorized and exactly $0.37 captured; tab 2 must read CANCELLED.
import { readFileSync } from "node:fs";
import { parseUsd } from "@meter/core";
import { AirwallexClient } from "../src/client.ts";
import { getIntent } from "../src/holds.ts";

type Step = { step: string; ok: boolean; id?: string };
const probe = JSON.parse(readFileSync(new URL("../../../research/airwallex-probe.json", import.meta.url), "utf8")) as {
  confirmedVia: string;
  steps: Step[];
};

const problems: string[] = [];
if (probe.confirmedVia !== "hosted card element (browser)") problems.push(`confirmedVia is ${probe.confirmedVia}`);
const failed = probe.steps.filter((s) => !s.ok).map((s) => s.step);
if (failed.length) problems.push(`recorded failures: ${failed.join("; ")}`);
for (const needed of ["increment to $1.40", "again (not above current)", "capture $0.37", "second capture", "capture above the hold", "tab2 cancel"]) {
  if (!probe.steps.some((s) => s.ok && s.step.includes(needed))) problems.push(`no passing step for "${needed}"`);
}

const idOf = (tab: string) => probe.steps.find((s) => s.step.startsWith(`${tab} approved hold`))?.id;
const awx = AirwallexClient.fromEnv();
const t1 = idOf("tab1");
const t2 = idOf("tab2");
if (!t1 || !t2) problems.push("missing approved intent ids");
else {
  const [a, b] = await Promise.all([getIntent(awx, t1), getIntent(awx, t2)]);
  if (a.status !== "SUCCEEDED") problems.push(`tab1 ${a.id} is ${a.status}`);
  if (parseUsd(a.amount) !== parseUsd("1.40")) problems.push(`tab1 authorized ${a.amount}`);
  if (parseUsd(a.captured_amount ?? 0) !== parseUsd("0.37")) problems.push(`tab1 captured ${a.captured_amount}`);
  if (a.latest_payment_attempt?.payment_method_options?.card?.authorization_type !== "pre_auth") problems.push("tab1 was not a pre_auth");
  if (b.status !== "CANCELLED") problems.push(`tab2 ${b.id} is ${b.status}`);
  if (parseUsd(b.captured_amount ?? 0) !== 0n) problems.push(`tab2 captured ${b.captured_amount}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`tab1=${t1} SUCCEEDED 1.40/0.37 tab2=${t2} CANCELLED`);
console.log("AIRWALLEX_HOLD_EVIDENCE_OK");
