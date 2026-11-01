import { describe, expect, it } from "vitest";
import {
  UnitError,
  baseUnitsToMillionths,
  centsToMajor,
  centsToMillionths,
  formatUsd,
  millionths,
  millionthsToBaseUnits,
  millionthsToCents,
  millionthsToCentsCeil,
  parseUsd,
  parseUsdz,
  sumMillionths,
} from "../src/units.ts";

describe("parseUsdz", () => {
  it("reads kit prices as millionths", () => {
    expect(parseUsdz("0.01")).toBe(10_000n);
    expect(parseUsdz("0.05")).toBe(50_000n);
    expect(parseUsdz("1.50")).toBe(1_500_000n);
    expect(parseUsdz("0.000001")).toBe(1n);
    expect(parseUsdz("2")).toBe(2_000_000n);
  });
  it("accepts trailing zeros past six places", () => {
    expect(parseUsdz("0.0200000000")).toBe(20_000n);
  });
  it("rejects sub-millionth, negative and malformed amounts", () => {
    expect(() => parseUsdz("0.0000001")).toThrow(UnitError);
    expect(() => parseUsdz("-0.01")).toThrow(UnitError);
    expect(() => parseUsdz("1e-2")).toThrow(UnitError);
    expect(() => parseUsdz("")).toThrow(UnitError);
    expect(() => parseUsdz("0.01 ")).not.toThrow();
  });
});

describe("parseUsd", () => {
  it("reads strings and Airwallex JSON numbers as cents", () => {
    expect(parseUsd("1.00")).toBe(100n);
    expect(parseUsd("0.75")).toBe(75n);
    expect(parseUsd(0.75)).toBe(75n);
    expect(parseUsd(0.1 + 0.2)).toBe(30n);
    expect(parseUsd(25000)).toBe(2_500_000n);
  });
  it("rejects fractions of a cent", () => {
    expect(() => parseUsd("0.755")).toThrow(UnitError);
    expect(() => parseUsd(0.001)).toThrow(UnitError);
    expect(() => parseUsd(Number.NaN)).toThrow(UnitError);
  });
});

describe("chain units", () => {
  it("round-trips millionths through 18-decimal base units", () => {
    const m = parseUsdz("0.37");
    const b = millionthsToBaseUnits(m);
    expect(b).toBe(370_000_000_000_000_000n);
    expect(baseUnitsToMillionths(b)).toBe(m);
  });
  it("refuses base units that are not whole millionths", () => {
    expect(() => baseUnitsToMillionths(1n)).toThrow(UnitError);
  });
  it("round-trips every amount up to $10 at millionth resolution samples", () => {
    for (let i = 0n; i <= 10_000_000n; i += 7_919n) {
      expect(baseUnitsToMillionths(millionthsToBaseUnits(millionths(i)))).toBe(i);
    }
  });
});

describe("card units", () => {
  it("converts spend to cents only when exact", () => {
    expect(millionthsToCents(parseUsdz("0.37"))).toBe(37n);
    expect(() => millionthsToCents(parseUsdz("0.375"))).toThrow(UnitError);
  });
  it("ceil sizing covers the spend", () => {
    expect(millionthsToCentsCeil(parseUsdz("0.371"))).toBe(38n);
    expect(millionthsToCentsCeil(parseUsdz("0.37"))).toBe(37n);
    expect(millionthsToCentsCeil(millionths(0n))).toBe(0n);
  });
  it("formats for Airwallex and people", () => {
    expect(centsToMajor(parseUsd("0.75"))).toBe(0.75);
    expect(centsToMajor(parseUsd("1.00"))).toBe(1);
    expect(formatUsd(parseUsd("0.05"))).toBe("$0.05");
    expect(centsToMillionths(parseUsd("0.75"))).toBe(750_000n);
  });
  it("sums a job's payments exactly", () => {
    const paid = ["0.01", "0.02", "0.05", "0.02", "0.03"].map(parseUsdz);
    expect(millionthsToCents(sumMillionths(paid))).toBe(13n);
  });
});
