import { describe, expect, it } from "vitest";
import type { AirwallexClient } from "@meter/airwallex";
import { parseUsd } from "@meter/core";
import { LiveHolds } from "../src/live.ts";

/** Records what reaches Airwallex. Enough of the client for creating and cancelling an intent. */
function fakeAirwallex() {
  const calls: string[] = [];
  const awx = {
    async post(path: string) {
      calls.push(path);
      if (path.endsWith("/create")) return { id: "int_1", client_secret: "secret", currency: "USD", amount: 1, status: "REQUIRES_PAYMENT_METHOD" };
      return { id: "int_1", status: "CANCELLED", amount: 1, currency: "USD" };
    },
  } as unknown as AirwallexClient;
  return { awx, calls };
}

describe("a hold nobody approves", () => {
  it("is cancelled at Airwallex after the timeout, and the job hears why", async () => {
    const { awx, calls } = fakeAirwallex();
    const holds = new LiveHolds(awx, "run", 20);
    const opened = holds.open({ id: "A", customer: "Customer A", amount: parseUsd("1.00") });
    await expect(opened).rejects.toThrow(/did not approve the hold within/);
    expect(calls.some((c) => c.endsWith("/int_1/cancel"))).toBe(true);
    expect(holds.pendingAll()).toEqual([]);
  });
});
