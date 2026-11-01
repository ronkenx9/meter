// Live sandbox probe of every card call Kit 12 needs:
//   tab 1: $1.00 pre-auth hold -> increment to $1.40 -> capture $0.37 -> second capture (must fail)
//   tab 2: $0.75 pre-auth hold -> capture above the hold (must fail) -> cancel
// With no arguments it creates and confirms both holds server-side (needs native API access).
// With `--approved <tab1 intent> <tab2 intent>` it starts from holds a customer approved on the hosted card page.
// Writes intent ids and statuses (no credentials) to research/airwallex-probe.json.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseUsd } from "@meter/core";
import { AirwallexClient, AirwallexError } from "../src/client.ts";
import { type PaymentIntent, type TestCard, cancelHold, captureHold, confirmPreAuth, createIntent, getIntent, holdState, incrementHold } from "../src/holds.ts";

// Kit 4's sandbox test card, which the Kit 12 brief says to use for pre-auth holds.
const CARD: TestCard = { number: "4035501000000008", expiry_month: "12", expiry_year: "2030", cvc: "123", name: "Meter Probe" };

const awx = AirwallexClient.fromEnv();
const steps: Array<Record<string, unknown>> = [];
let failures = 0;

function summarize(pi: PaymentIntent) {
  const s = holdState(pi);
  return {
    id: pi.id,
    status: pi.status,
    amount: pi.amount,
    captured_amount: pi.captured_amount ?? null,
    authorized_cents: Number(s.authorized),
    attempt_status: pi.latest_payment_attempt?.status ?? null,
    authorization_type: pi.latest_payment_attempt?.payment_method_options?.card?.authorization_type ?? null,
  };
}

async function step(name: string, fn: () => Promise<PaymentIntent>, expect: (pi: PaymentIntent) => string | null): Promise<PaymentIntent | null> {
  try {
    const pi = await fn();
    const problem = expect(pi);
    if (problem) failures++;
    steps.push({ step: name, ok: !problem, ...(problem ? { problem } : {}), ...summarize(pi) });
    console.log(`${problem ? "FAIL" : "ok  "} ${name}: ${pi.status} amount=${pi.amount} captured=${pi.captured_amount ?? 0}${problem ? ` (${problem})` : ""}`);
    return pi;
  } catch (e) {
    failures++;
    const err = e instanceof AirwallexError ? { status: e.status, code: e.code, message: e.message } : { message: String(e) };
    steps.push({ step: name, ok: false, error: err });
    console.log(`FAIL ${name}: ${err.message}`);
    return null;
  }
}

async function expectRefusal(name: string, fn: () => Promise<PaymentIntent>): Promise<void> {
  try {
    const pi = await fn();
    failures++;
    steps.push({ step: name, ok: false, problem: "expected a refusal", ...summarize(pi) });
    console.log(`FAIL ${name}: accepted (${pi.status}), expected a refusal`);
  } catch (e) {
    const err = e instanceof AirwallexError ? { status: e.status, code: e.code, message: e.message } : { message: String(e) };
    steps.push({ step: name, ok: true, refused: err });
    console.log(`ok   ${name}: refused ${err.message}`);
  }
}

const run = new Date().toISOString().replace(/[:.]/g, "-");
const is = (status: string) => (pi: PaymentIntent) => (pi.status === status ? null : `status ${pi.status}, expected ${status}`);

const approved = process.argv[2] === "--approved" ? process.argv.slice(3, 5) : null;
if (approved && approved.length !== 2) throw new Error("usage: probe-hold.ts --approved <tab1 intent id> <tab2 intent id>");

/** A $amount pre-auth hold in REQUIRES_CAPTURE: approved in the browser, or created and confirmed here. */
async function openHold(tab: string, amount: string, approvedId: string | undefined): Promise<PaymentIntent | null> {
  const isHeld = (pi: PaymentIntent) =>
    pi.status !== "REQUIRES_CAPTURE"
      ? `status ${pi.status}, expected REQUIRES_CAPTURE`
      : parseUsd(pi.amount) !== parseUsd(amount)
        ? `amount ${pi.amount}, expected ${amount}`
        : pi.latest_payment_attempt?.payment_method_options?.card?.authorization_type !== "pre_auth"
          ? `authorization_type ${pi.latest_payment_attempt?.payment_method_options?.card?.authorization_type}, expected pre_auth`
          : null;
  if (approvedId) return step(`${tab} approved hold $${amount} (hosted card page)`, () => getIntent(awx, approvedId), isHeld);
  const created = await step(`${tab} create $${amount}`, () => createIntent(awx, { amount: parseUsd(amount), currency: "USD", merchantOrderId: `probe-${run}-${tab}`, requestId: randomUUID(), descriptor: "METER TAB" }), is("REQUIRES_PAYMENT_METHOD"));
  if (!created) return null;
  return step(`${tab} confirm pre_auth`, () => confirmPreAuth(awx, created.id, { requestId: randomUUID(), card: CARD }), isHeld);
}

// Tab 1: the full life of a tab that overran and got a raise.
const t1 = await openHold("tab1", "1.00", approved?.[0]);
if (t1) {
  await step("tab1 increment to $1.40", () => incrementHold(awx, t1.id, { newTotal: parseUsd("1.40"), requestId: randomUUID() }), (pi) =>
    pi.status !== "REQUIRES_CAPTURE" ? `status ${pi.status}` : parseUsd(pi.amount) !== parseUsd("1.40") ? `amount ${pi.amount}, expected 1.40` : null,
  );
  await expectRefusal("tab1 increment to $1.40 again (not above current)", () => incrementHold(awx, t1.id, { newTotal: parseUsd("1.40"), requestId: randomUUID() }));
  await step("tab1 capture $0.37", () => captureHold(awx, t1.id, { amount: parseUsd("0.37"), requestId: randomUUID() }), (pi) =>
    pi.status !== "SUCCEEDED" ? `status ${pi.status}, expected SUCCEEDED` : parseUsd(pi.captured_amount ?? 0) !== parseUsd("0.37") ? `captured ${pi.captured_amount}` : null,
  );
  await expectRefusal("tab1 second capture $0.10", () => captureHold(awx, t1.id, { amount: parseUsd("0.10"), requestId: randomUUID() }));
  await step("tab1 read back", () => getIntent(awx, t1.id), (pi) =>
    pi.status !== "SUCCEEDED" ? `status ${pi.status}` : parseUsd(pi.captured_amount ?? 0) !== parseUsd("0.37") ? `captured ${pi.captured_amount}` : null,
  );
}

// Tab 2: a job that paid for nothing, so its hold is cancelled.
const t2 = await openHold("tab2", "0.75", approved?.[1]);
if (t2) {
  await expectRefusal("tab2 capture above the hold ($0.80)", () => captureHold(awx, t2.id, { amount: parseUsd("0.80"), requestId: randomUUID() }));
  await step("tab2 cancel", () => cancelHold(awx, t2.id, { requestId: randomUUID(), reason: "job paid for nothing" }), is("CANCELLED"));
}

writeFileSync(
  new URL("../../../research/airwallex-probe.json", import.meta.url),
  JSON.stringify({ ranAt: new Date().toISOString(), confirmedVia: approved ? "hosted card element (browser)" : "native API", card: "4035501000000008 (sandbox test card)", steps }, null, 2) + "\n",
);
if (failures) {
  console.log(`AIRWALLEX_PROBE_FAILED failures=${failures}`);
  process.exit(1);
}
console.log(`AIRWALLEX_HOLDS_OK steps=${steps.length}`);
