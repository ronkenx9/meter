import { describe, expect, it } from "vitest";
import { unknownOutcome } from "../src/job-wallet.ts";

describe("a deposit sent with its outcome unknown", () => {
  // The wording Metal's SDK threw on testnet on 2026-11-11, with a made-up hash.
  const hash = `0x${"ab".repeat(32)}`;
  const text = `deposit ${hash} with nonce 319 was sent and its outcome is unknown: look it up before sending it again`;

  it("is recognised with its call, hash and nonce, so it can be looked up", () => {
    expect(unknownOutcome(new Error(text))).toEqual({ call: "deposit", hash, nonce: 319 });
  });

  it("is found when another error wraps it", () => {
    expect(unknownOutcome(new Error("deposit failed", { cause: new Error(text) }))?.nonce).toBe(319);
  });

  it("is not confused with an ordinary failure", () => {
    expect(unknownOutcome(new Error("the Clearing contract took no deposits before the timeout"))).toBeNull();
  });
});
