import { readFileSync } from "node:fs";
import { type Cents, type Millionths, UnitError, centsToMillionths, parseUsd, parseUsdz, sumMillionths } from "./units.ts";

export type ProviderKind = "model" | "search" | "lookup";

export interface ScenarioJob {
  id: string;
  customer: string;
  hold: Cents;
  initialDeposit: Millionths;
  brief: string;
  paragraphs: number;
  searches: number;
  lookups: number;
}

export interface ScenarioProvider {
  id: string;
  kind: ProviderKind;
  price: Millionths;
  latencyMs: number;
  tier?: string;
}

export interface Scenario {
  name: string;
  currency: "USD";
  float: Millionths;
  reserveFloor: Millionths;
  maxPayment: Millionths;
  jobs: ScenarioJob[];
  providers: ScenarioProvider[];
  shock: {
    atFractionOfRun: number;
    overrunJob: string;
    tokenMultiplier: number;
    slowProvider: string;
    slowLatencyMs: number;
  };
}

export class ScenarioError extends Error {
  override name = "ScenarioError";
}

type Raw = Record<string, unknown>;

function str(o: Raw, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) throw new ScenarioError(`${key} must be a non-empty string`);
  return v;
}

function int(o: Raw, key: string, min = 0): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new ScenarioError(`${key} must be an integer >= ${min}`);
  return v;
}

function money<T>(fn: () => T, where: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof UnitError) throw new ScenarioError(`${where}: ${e.message}`);
    throw e;
  }
}

const KINDS: readonly ProviderKind[] = ["model", "search", "lookup"];

export function parseScenario(raw: unknown): Scenario {
  if (typeof raw !== "object" || raw === null) throw new ScenarioError("scenario must be an object");
  const r = raw as Raw;
  if (r.currency !== "USD") throw new ScenarioError("currency must be USD");

  const jobs = (Array.isArray(r.jobs) ? r.jobs : []).map((j: Raw): ScenarioJob => ({
    id: str(j, "id"),
    customer: str(j, "customer"),
    hold: money(() => parseUsd(str(j, "holdUsd")), `job ${String(j.id)} holdUsd`),
    initialDeposit: money(() => parseUsdz(str(j, "initialDepositUsdz")), `job ${String(j.id)} initialDepositUsdz`),
    brief: str(j, "brief"),
    paragraphs: int(j, "paragraphs", 1),
    searches: int(j, "searches"),
    lookups: int(j, "lookups"),
  }));
  if (jobs.length === 0) throw new ScenarioError("at least one job is required");

  const providers = (Array.isArray(r.providers) ? r.providers : []).map((p: Raw): ScenarioProvider => {
    const kind = p.kind as ProviderKind;
    if (!KINDS.includes(kind)) throw new ScenarioError(`provider ${String(p.id)} kind must be one of ${KINDS.join(", ")}`);
    const provider: ScenarioProvider = {
      id: str(p, "id"),
      kind,
      price: money(() => parseUsdz(str(p, "priceUsdz")), `provider ${String(p.id)} priceUsdz`),
      latencyMs: int(p, "latencyMs", 1),
    };
    if (typeof p.tier === "string") provider.tier = p.tier;
    return provider;
  });

  const shockRaw = (r.shock ?? {}) as Raw;
  const scenario: Scenario = {
    name: str(r, "name"),
    currency: "USD",
    float: money(() => parseUsdz(str(r, "floatUsdz")), "floatUsdz"),
    reserveFloor: money(() => parseUsdz(str(r, "reserveFloorUsdz")), "reserveFloorUsdz"),
    maxPayment: money(() => parseUsdz(str(r, "maxPaymentUsdz")), "maxPaymentUsdz"),
    jobs,
    providers,
    shock: {
      atFractionOfRun: Number(shockRaw.atFractionOfRun),
      overrunJob: str(shockRaw, "overrunJob"),
      tokenMultiplier: int(shockRaw, "tokenMultiplier", 1),
      slowProvider: str(shockRaw, "slowProvider"),
      slowLatencyMs: int(shockRaw, "slowLatencyMs", 1),
    },
  };
  validate(scenario);
  return scenario;
}

function validate(s: Scenario): void {
  const ids = new Set<string>();
  for (const j of s.jobs) {
    if (ids.has(j.id)) throw new ScenarioError(`duplicate job id ${j.id}`);
    ids.add(j.id);
    // A job's deposits must never exceed its hold: that is what keeps spend <= capture <= hold.
    if (j.initialDeposit > centsToMillionths(j.hold)) throw new ScenarioError(`job ${j.id} initial deposit exceeds its hold`);
  }
  const providerIds = new Set(s.providers.map((p) => p.id));
  if (providerIds.size !== s.providers.length) throw new ScenarioError("duplicate provider id");
  for (const kind of KINDS) {
    if (!s.providers.some((p) => p.kind === kind)) throw new ScenarioError(`no ${kind} provider`);
  }
  for (const p of s.providers) {
    if (p.price > s.maxPayment) throw new ScenarioError(`provider ${p.id} price exceeds maxPaymentUsdz`);
    if (p.price === 0n) throw new ScenarioError(`provider ${p.id} must charge something`);
  }
  const deposited = sumMillionths(s.jobs.map((j) => j.initialDeposit));
  if (deposited > s.float) throw new ScenarioError("initial deposits exceed the float");
  if (s.float - deposited < s.reserveFloor) throw new ScenarioError("initial deposits leave the reserve below its floor");
  if (!ids.has(s.shock.overrunJob)) throw new ScenarioError(`shock.overrunJob ${s.shock.overrunJob} is not a job`);
  if (!providerIds.has(s.shock.slowProvider)) throw new ScenarioError(`shock.slowProvider ${s.shock.slowProvider} is not a provider`);
  if (!(s.shock.atFractionOfRun > 0 && s.shock.atFractionOfRun < 1)) throw new ScenarioError("shock.atFractionOfRun must be between 0 and 1");
}

export function loadScenario(path: string): Scenario {
  return parseScenario(JSON.parse(readFileSync(path, "utf8")));
}

/** What every job could spend if each ran to its hold. */
export function totalHolds(s: Scenario): Millionths {
  return sumMillionths(s.jobs.map((j) => centsToMillionths(j.hold)));
}
