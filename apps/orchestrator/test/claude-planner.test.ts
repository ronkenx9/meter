import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CompleteRequest, ModelClient } from "@meter/ai";
import { ModelRefused, createModelClient } from "@meter/ai";
import { centsToMillionths, loadScenario, parseUsd, parseUsdz } from "@meter/core";
import { EventLog } from "@meter/ledger";
import { createClaudeWriter } from "@meter/providers";
import { ClaudePlanner } from "../src/claude-planner.ts";
import { Engine } from "../src/engine.ts";
import type { JobView, Offer, Snapshot } from "../src/ports.ts";
import { SimApprovals, SimHolds, SimMarket, SimWallet } from "../src/sim.ts";

const scenario = loadScenario(fileURLToPath(new URL("../../../scenario/kit12.json", import.meta.url)));

function fake(reply: (req: CompleteRequest) => string | Error): ModelClient & { calls: CompleteRequest[] } {
  const calls: CompleteRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const r = reply(req);
      if (r instanceof Error) throw r;
      return { text: r, model: req.model };
    },
  };
}

const offers: Offer[] = [
  { id: "model-basic", kind: "model", tier: "basic", price: parseUsdz("0.01"), latencyMs: 6000 },
  { id: "model-standard", kind: "model", tier: "standard", price: parseUsdz("0.02"), latencyMs: 700 },
  { id: "model-premium", kind: "model", tier: "premium", price: parseUsdz("0.05"), latencyMs: 1200 },
  { id: "search", kind: "search", tier: null, price: parseUsdz("0.02"), latencyMs: 500 },
  { id: "lookup", kind: "lookup", tier: null, price: parseUsdz("0.03"), latencyMs: 500 },
];

const view = (over: Partial<JobView> = {}): JobView => ({
  id: "B",
  customer: "Customer B",
  brief: "A report",
  state: "running",
  route: "model-basic",
  authorized: parseUsd("0.75"),
  deposited: parseUsdz("0.20"),
  spent: parseUsdz("0.10"),
  remaining: { model: 30, search: 0, lookup: 0 },
  projected: parseUsdz("0.40"),
  holdFinal: false,
  raisePending: false,
  paragraphsDone: 3,
  paragraphsTotal: 33,
  intentId: "int_x",
  captured: null,
  ...over,
});

const snap = (): Snapshot => ({ reason: "the shock", jobs: [view()], offers, reserve: parseUsdz("0.85"), floor: parseUsdz("0.05") });
const planReply = (proposals: unknown[], summary = "Moving B") => JSON.stringify({ summary, proposals });
const raw = { toProvider: null, amountUsd: null, newTotalUsd: null, text: "why" };

describe("ClaudePlanner.propose", () => {
  it("turns the model's plan into typed proposals and records who decided", async () => {
    const client = fake(() =>
      planReply([
        { ...raw, kind: "reroute", jobId: "B", toProvider: "model-standard" },
        { ...raw, kind: "grant_reserve", jobId: "B", amountUsd: "0.30" },
        { ...raw, kind: "ask_hold_raise", jobId: "B", newTotalUsd: "$0.90", text: "Please approve." },
      ]),
    );
    const p = new ClaudePlanner(client);
    const plan = await p.propose(snap());
    expect(plan).toEqual([
      { kind: "reroute", jobId: "B", toProvider: "model-standard", reason: "why" },
      { kind: "grant_reserve", jobId: "B", amount: parseUsdz("0.30"), reason: "why" },
      { kind: "ask_hold_raise", jobId: "B", newTotal: parseUsd("0.90"), message: "Please approve." },
    ]);
    expect(p.lastPlan).toMatchObject({ source: "model", model: "claude-opus-5-5", summary: "Moving B" });
    expect(client.calls[0]!.schema).toBeDefined();
  });

  it("gives the model the worked numbers and no credentials or card data", async () => {
    const client = fake(() => planReply([]));
    await new ClaudePlanner(client).propose(snap());
    const sent = JSON.parse(client.calls[0]!.user);
    expect(sent.availableFromReserveUsd).toBe("0.800000");
    expect(sent.jobs[0].projectedSpendByProviderUsd["model-standard"]).toBe("0.700000");
    expect(client.calls[0]!.user).not.toMatch(/int_x|key|secret/i);
  });

  it.each([
    ["an API failure", () => new Error("500 from the API")],
    ["a refusal", () => new ModelRefused("declined")],
    ["output that isn't JSON", () => "sure, here is my plan"],
    ["an unparseable amount", () => planReply([{ ...raw, kind: "grant_reserve", jobId: "B", amountUsd: "a lot" }])],
    ["a missing amount", () => planReply([{ ...raw, kind: "grant_reserve", jobId: "B" }])],
    ["an unknown kind", () => planReply([{ ...raw, kind: "buy_crypto", jobId: "B" }])],
  ])("falls back to the rule planner on %s and says so", async (_name, reply) => {
    const p = new ClaudePlanner(fake(reply as (r: CompleteRequest) => string | Error));
    const plan = await p.propose(snap());
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.some((x) => x.kind === "reroute")).toBe(true);
    expect(p.lastPlan.source).toBe("rules");
    expect(p.lastPlan.note).toMatch(/model unavailable/);
  });
});

describe("ClaudePlanner.judgeStep", () => {
  const picks = () => fake(() => JSON.stringify({ paragraphs: [{ index: 2, why: "the key comparison" }] }));
  const slack = parseUsdz("1.00");
  const on = view({ route: "model-standard" });

  it("asks once per report outline, not once per paragraph", async () => {
    const client = picks();
    const p = new ClaudePlanner(client);
    expect(await p.judgeStep(on, { index: 1, total: 10 }, offers, slack)).toMatchObject({ providerId: null });
    expect(await p.judgeStep(on, { index: 2, total: 10 }, offers, slack)).toEqual({ providerId: "model-premium", reason: "the key comparison" });
    expect(await p.judgeStep(on, { index: 3, total: 10 }, offers, slack)).toMatchObject({ providerId: null });
    expect(client.calls.length).toBe(1);
    await p.judgeStep(on, { index: 2, total: 40 }, offers, slack);
    expect(client.calls.length).toBe(2);
  });

  it("the model's wish doesn't override the budget", async () => {
    const p = new ClaudePlanner(picks());
    expect(await p.judgeStep(on, { index: 2, total: 10 }, offers, parseUsdz("0.01"))).toMatchObject({ providerId: null, reason: expect.stringMatching(/short/) });
    const tight = view({ route: "model-standard", authorized: parseUsd("0.40"), projected: parseUsdz("0.40") });
    expect(await new ClaudePlanner(picks()).judgeStep(tight, { index: 2, total: 10 }, offers, slack)).toMatchObject({ providerId: null, reason: expect.stringMatching(/hold/) });
  });

  it("falls back to the opening and conclusion if the model fails", async () => {
    const p = new ClaudePlanner(fake(() => new Error("down")));
    expect((await p.judgeStep(on, { index: 1, total: 10 }, offers, slack)).providerId).toBe("model-premium");
    expect((await p.judgeStep(on, { index: 5, total: 10 }, offers, slack)).providerId).toBeNull();
    expect((await p.judgeStep(on, { index: 10, total: 10 }, offers, slack)).providerId).toBe("model-premium");
  });
});

describe("Claude in the full engine", () => {
  function rig(reply: (r: CompleteRequest) => string | Error) {
    const market = new SimMarket(scenario);
    const holds = new SimHolds();
    const log = new EventLog(":memory:");
    const engine = new Engine({
      scenario,
      market,
      holds,
      approvals: new SimApprovals(),
      planner: new ClaudePlanner(fake(reply)),
      log,
      wallet: async (id) => new SimWallet(market, scenario.maxPayment, id),
      sleep: async () => undefined,
      depositRetryMs: 0,
    });
    return { engine, holds, log };
  }
  const judged = (r: CompleteRequest) => r.system.startsWith("You decide which paragraphs");

  it("an unsafe plan from the model is refused by the money rules, and every limit holds", async () => {
    const { engine, log } = rig((r) =>
      judged(r)
        ? JSON.stringify({ paragraphs: [] })
        : planReply([
            { ...raw, kind: "grant_reserve", jobId: "B", amountUsd: "5.00" },
            { ...raw, kind: "ask_hold_raise", jobId: "B", newTotalUsd: "0.10" },
            { ...raw, kind: "reroute", jobId: "B", toProvider: "no-such-provider" },
          ]),
    );
    const r = await engine.run();
    const decisions = log.all().filter((e) => e.type === "plan.revised").flatMap((e) => e.data.decisions as Array<{ accepted: boolean; refused?: string }>);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => !d.accepted)).toBe(true);
    for (const j of r.jobs) {
      expect(j.spent <= j.deposited).toBe(true);
      expect(j.deposited <= centsToMillionths(j.authorized)).toBe(true);
      if (j.captured !== null) expect(centsToMillionths(j.captured)).toBe(j.spent);
    }
    expect(r.reserve >= scenario.reserveFloor).toBe(true);
    expect(r.reconciled).toBe(true);
  });

  it("a model that goes down mid-run costs nothing: rules take over and the log shows it", async () => {
    const { engine, log } = rig(() => new Error("API down"));
    const r = await engine.run();
    const plans = log.all().filter((e) => e.type === "plan.revised");
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((e) => (e.data.planner as { source: string }).source === "rules")).toBe(true);
    expect(r.reconciled).toBe(true);
    expect(r.jobs.find((j) => j.id === "A")!.finished).toBe(true);
  });

  it("logs delivered text, so the report can be read back", async () => {
    const { engine, log } = rig((r) => (judged(r) ? JSON.stringify({ paragraphs: [] }) : planReply([])));
    await engine.run();
    expect(log.all().filter((e) => e.type === "report.text").length).toBeGreaterThan(0);
  });
});

describe("createClaudeWriter", () => {
  const providers = { "model-premium": { id: "model-premium", kind: "model", tier: "premium" }, "model-basic": { id: "model-basic", kind: "model", tier: "basic" }, search: { id: "search", kind: "search" } } as const;
  const as = (p: unknown) => p as Parameters<ReturnType<typeof createClaudeWriter>>[0];
  const q = (job: string, step: string) => new URLSearchParams({ job, step });
  const para = (paragraph: string) => JSON.stringify({ paragraph });

  it("each tier uses its own model, and later paragraphs see earlier ones of the same job only", async () => {
    let n = 0;
    const client = fake(() => para(`text ${++n}`));
    const write = createClaudeWriter(client, scenario);
    await write(as(providers["model-basic"]), q("A", "model-1"));
    await write(as(providers["model-premium"]), q("A", "model-2"));
    await write(as(providers["model-basic"]), q("B", "model-1"));
    expect(client.calls.map((c) => c.model)).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "claude-haiku-5-5"]);
    expect(client.calls[1]!.user).toContain("text 1");
    expect(client.calls[2]!.user).not.toContain("text 1");
    expect(client.calls[1]!.user).toContain(scenario.jobs[0]!.brief);
  });

  it("search and lookup never claim retrieved results, and no prompt invites invented facts", async () => {
    const client = fake((r) => (r.schema ? para("Report text.") : "notes"));
    const write = createClaudeWriter(client, scenario);
    await write(as(providers.search), q("A", "search-1"));
    await write(as(providers["model-basic"]), q("A", "model-1"));
    expect(client.calls[0]!.system).toMatch(/no web or database access/);
    for (const c of client.calls) expect(c.system).toMatch(/not invent statistics/i);
  });

  it("rewrites a paragraph that describes itself, and gives up rather than sell one that keeps doing it", async () => {
    const replies = [para("Because this is the opening paragraph, it should establish the basics."), para("Real report text.")];
    const client = fake(() => replies.shift()!);
    const write = createClaudeWriter(client, scenario);
    expect(await write(as(providers["model-basic"]), q("A", "model-1"))).toBe("Real report text.");
    expect(client.calls.length).toBe(2);
    const stuck = createClaudeWriter(fake(() => para("This paragraph should cover costs.")), scenario);
    await expect(stuck(as(providers["model-basic"]), q("A", "model-1"))).rejects.toThrow(/kept describing/);
  });

  it("tells the model where the paragraph sits, and rewrites one that concludes the report early", async () => {
    const replies = [para("In closing, that is the whole picture."), para("Middle text."), para("In closing, that is the whole picture.")];
    const client = fake(() => replies.shift()!);
    const write = createClaudeWriter(client, scenario);
    const at = (step: string, of: string) => new URLSearchParams({ job: "A", step, of });
    expect(await write(as(providers["model-basic"]), at("model-5", "10"))).toBe("Middle text.");
    expect(client.calls[0]!.user).toMatch(/do not open or conclude/);
    expect(await write(as(providers["model-basic"]), at("model-10", "10"))).toMatch(/^In closing/);
    expect(client.calls[2]!.user).toMatch(/draw it to a conclusion/);
  });

  it("refuses to write for an unknown job rather than guess a topic", async () => {
    const write = createClaudeWriter(fake(() => para("x")), scenario);
    await expect(write(as(providers["model-basic"]), q("Z", "model-1"))).rejects.toThrow(/no brief/);
  });
});

describe("createModelClient", () => {
  it("returns nothing without a key, so runs fall back instead of crashing", () => {
    expect(createModelClient({})).toBeNull();
    expect(createModelClient({ ANTHROPIC_API_KEY: "  " })).toBeNull();
  });
});
