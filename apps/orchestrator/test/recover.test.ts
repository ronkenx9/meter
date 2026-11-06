import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadScenario, parseUsd, parseUsdz } from "@meter/core";
import { EventLog } from "@meter/ledger";
import { recover } from "../src/recover.ts";
import { SimHolds, SimMarket, SimWallet } from "../src/sim.ts";

const scenario = loadScenario(fileURLToPath(new URL("../../../scenario/kit12.json", import.meta.url)));

/** A run that died mid-way: three holds, some payments the log never heard about. */
async function crashed() {
  const market = new SimMarket(scenario);
  const holds = new SimHolds();
  const log = new EventLog(":memory:");
  const wallets = new Map<string, SimWallet>();
  for (const [id, hold, deposit, pays] of [["A", "1.00", "0.25", 3], ["B", "0.75", "0.20", 0], ["C", "0.75", "0.20", 2]] as const) {
    const h = await holds.open({ id, amount: parseUsd(hold) });
    log.append("hold.placed", id, { intentId: h.intentId, amount: `$${hold}`, status: h.status });
    const w = new SimWallet(market, scenario.maxPayment, id);
    await w.deposit(parseUsdz(deposit));
    log.append("float.deposited", id, { amount: deposit });
    for (let i = 0; i < pays; i++) await w.pay(market.url("model-standard", { job: id, step: `model-${i}` }));
    wallets.set(id, w);
  }
  // C was captured at the card processor just before the crash, but the log never recorded it.
  const cIntent = log.all().find((e) => e.job === "C" && e.type === "hold.placed")!.data.intentId as string;
  await holds.capture(cIntent, parseUsd("0.04"));
  return { holds, log, wallet: async (id: string) => wallets.get(id)! };
}

describe("recovering a run that crashed", () => {
  it("captures exactly what each wallet paid, cancels a hold with nothing paid, and never captures twice", async () => {
    const { holds, log, wallet } = await crashed();
    const result = await recover(log, holds, wallet);
    const by = new Map(result.map((j) => [j.id, j]));
    expect(by.get("A")).toMatchObject({ outcome: "captured", captured: parseUsd("0.06") });
    expect(by.get("B")).toMatchObject({ outcome: "cancelled", captured: null });
    expect(by.get("C")).toMatchObject({ outcome: "already_closed", captured: parseUsd("0.04") });
    expect(holds.events.filter((e) => e.startsWith("capture"))).toHaveLength(2);
    expect(log.all().filter((e) => e.type === "recovery.withdraw_requested").map((e) => e.job)).toEqual(["A", "B", "C"]);
    expect(log.verify()).toBeNull();
  });

  it("is safe to run again", async () => {
    const { holds, log, wallet } = await crashed();
    await recover(log, holds, wallet);
    const again = await recover(log, holds, wallet);
    expect(again.every((j) => j.outcome === "already_closed")).toBe(true);
    expect(holds.events.filter((e) => e.startsWith("capture"))).toHaveLength(2);
  });
});
