import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScenarioError, loadScenario, parseScenario, totalHolds } from "../src/scenario.ts";
import { parseUsdz } from "../src/units.ts";

const path = fileURLToPath(new URL("../../../scenario/kit12.json", import.meta.url));
const raw = () => JSON.parse(readFileSync(path, "utf8"));

describe("kit12 scenario", () => {
  const s = loadScenario(path);

  it("is short on float by design", () => {
    expect(s.float).toBe(parseUsdz("1.50"));
    expect(totalHolds(s)).toBe(parseUsdz("2.50"));
    expect(s.float < totalHolds(s)).toBe(true);
  });

  it("keeps a reserve above the floor after initial deposits", () => {
    const deposited = s.jobs.reduce((a, j) => a + j.initialDeposit, 0n);
    expect(s.float - deposited).toBe(parseUsdz("0.50"));
    expect(s.float - deposited >= s.reserveFloor).toBe(true);
  });

  it("sets the clearing cap to the dearest provider", () => {
    const dearest = s.providers.reduce((a, p) => (p.price > a ? p.price : a), 0n);
    expect(s.maxPayment).toBe(dearest);
  });
});

describe("parseScenario rejects unsafe scenarios", () => {
  it("a deposit above the job's hold", () => {
    const r = raw();
    r.jobs[1].initialDepositUsdz = "0.80";
    expect(() => parseScenario(r)).toThrow(/exceeds its hold/);
  });
  it("deposits above the float", () => {
    const r = raw();
    r.jobs[0].initialDepositUsdz = "1.00";
    r.jobs[1].initialDepositUsdz = "0.60";
    expect(() => parseScenario(r)).toThrow(ScenarioError);
  });
  it("a provider priced over the clearing cap", () => {
    const r = raw();
    r.providers[2].priceUsdz = "0.06";
    expect(() => parseScenario(r)).toThrow(/exceeds maxPaymentUsdz/);
  });
  it("a sub-millionth price", () => {
    const r = raw();
    r.providers[0].priceUsdz = "0.0100001";
    expect(() => parseScenario(r)).toThrow(ScenarioError);
  });
  it("a sub-cent hold", () => {
    const r = raw();
    r.jobs[0].holdUsd = "1.005";
    expect(() => parseScenario(r)).toThrow(ScenarioError);
  });
  it("a shock aimed at a missing job", () => {
    const r = raw();
    r.shock.overrunJob = "Z";
    expect(() => parseScenario(r)).toThrow(/not a job/);
  });
});
