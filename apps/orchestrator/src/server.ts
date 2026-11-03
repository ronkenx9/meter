// `node --env-file=.env apps/orchestrator/src/server.ts`, then open http://localhost:4378.
// Live mode needs Airwallex and Metal keys (see README). Sim mode needs nothing: same engine, same rules, no network.
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ModelClient, createModelClient, pingModel } from "@meter/ai";
import { AirwallexClient } from "@meter/airwallex";
import { type Scenario, formatUsd, formatUsdz, loadScenario, parseUsdz } from "@meter/core";
import { EventLog } from "@meter/ledger";
import { JobWallet, readDeployment } from "@meter/metal";
import { createClaudeWriter, createMarket } from "@meter/providers";
import express, { type Request, type Response } from "express";
import { privateKeyToAccount } from "viem/accounts";
import { Engine, type RunResult } from "./engine.ts";
import { LiveHolds, LiveMarket, WebApprovals } from "./live.ts";
import { ClaudePlanner } from "./claude-planner.ts";
import { RulePlanner } from "./planner.ts";
import type { HoldsPort, MarketPort } from "./ports.ts";
import { SimHolds, SimMarket, SimWallet } from "./sim.ts";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const page = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const PORT = Number(process.env.PORT ?? 4378);

const liveReady = () => Boolean(process.env.AWX_CLIENT_ID && process.env.AWX_API_KEY && process.env.METAL_RPC_URL && process.env.METAL_OPERATOR_KEY);

type Mode = "live" | "sim";

interface Run {
  id: string;
  mode: Mode;
  scenario: Scenario;
  log: EventLog;
  holds: HoldsPort;
  approvals: WebApprovals;
  engine: Engine;
  market: MarketPort;
  result: RunResult | null;
  error: string | null;
}
let current: Run | null = null;

/** A short single-job scenario: the whole money path in about a minute, for checking the rails. */
function oneJob(s: Scenario): Scenario {
  const j = s.jobs[0]!;
  return { ...s, jobs: [{ ...j, paragraphs: 3, searches: 1, lookups: 1 }] };
}

function launch(run: Run, claimEveryMs: number, claimForMs: number) {
  void run.engine
    .run()
    .then(async (result) => {
      run.result = result;
      await run.engine.claimFloat(claimEveryMs, Date.now() + claimForMs);
    })
    .catch((e) => {
      run.error = String(e);
      run.log.append("run.crashed", null, { error: String(e) });
    });
}

async function startLive(scenario: Scenario, shock: boolean): Promise<Run> {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = root(`wallets/run-${id}`);
  mkdirSync(root("runs"), { recursive: true });
  const log = new EventLog(root(`runs/${id}.sqlite`));
  const rpcUrl = process.env.METAL_RPC_URL!;
  const operator = privateKeyToAccount(process.env.METAL_OPERATOR_KEY as `0x${string}`);
  const deployment = await readDeployment();
  // Find a bad key now, before any money moves. The run still works without Claude, and says so.
  let ai: ModelClient | null = createModelClient();
  let aiNote: string | null = ai ? null : "ANTHROPIC_API_KEY is not set";
  if (ai) {
    try {
      await pingModel(ai);
    } catch (e) {
      aiNote = String((e as Error).message).slice(0, 200);
      ai = null;
    }
  }
  log.append("ai.status", null, ai ? { planner: "claude", writer: "claude" } : { planner: "rules", writer: "stand-in", reason: aiNote });
  const providers = await createMarket({ scenario, walletRoot: `${dir}/providers`, ...(ai ? { writer: createClaudeWriter(ai, scenario) } : {}) });
  const { baseUrl } = await providers.listen(0);
  const market = new LiveMarket(providers, baseUrl);
  const holds = new LiveHolds(AirwallexClient.fromEnv(), id);
  holds.onAwaiting = (p) => log.append("hold.awaiting_customer", p.jobId, { intentId: p.intentId, amount: p.amount });
  const approvals = new WebApprovals();
  const engine = new Engine({
    scenario,
    market,
    holds,
    approvals,
    planner: ai ? new ClaudePlanner(ai) : new RulePlanner(),
    log,
    wallet: (jobId) => JobWallet.open({ directory: `${dir}/jobs/${jobId}`, rpcUrl, operator, deployment, maxPayment: scenario.maxPayment }),
    shockAt: shock ? scenario.shock.atFractionOfRun : null,
  });
  const run: Run = { id, mode: "live", scenario, log, holds, approvals, engine, market, result: null, error: null };
  // Unused float becomes claimable about ten to twenty minutes after each job's last payment.
  launch(run, 60_000, 40 * 60_000);
  return run;
}

function startSim(scenario: Scenario, shock: boolean): Run {
  const id = `sim-${Date.now()}`;
  const log = new EventLog(":memory:");
  const market = new SimMarket(scenario);
  const approvals = new WebApprovals();
  const holds = new SimHolds();
  const engine = new Engine({
    scenario,
    market,
    holds,
    approvals,
    planner: new RulePlanner(),
    log,
    wallet: async (jobId) => new SimWallet(market, scenario.maxPayment, jobId, 600),
    depositRetryMs: 300,
    shockAt: shock ? scenario.shock.atFractionOfRun : null,
  });
  const run: Run = { id, mode: "sim", scenario, log, holds, approvals, engine, market, result: null, error: null };
  launch(run, 1500, 60_000);
  return run;
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => void res.type("html").send(page("index.html")));
app.get("/approve", (_req, res) => void res.type("html").send(page("approve.html")));

app.post("/api/run", async (req: Request, res: Response) => {
  if (current && !current.result && !current.error) return void res.status(409).json({ error: "a run is in progress", id: current.id });
  const mode: Mode = req.query.mode === "live" ? "live" : "sim";
  if (mode === "live" && !liveReady()) return void res.status(400).json({ error: "live mode needs AWX_CLIENT_ID, AWX_API_KEY, METAL_RPC_URL and METAL_OPERATOR_KEY in .env" });
  const scenario = loadScenario(root("scenario/kit12.json"));
  const short = req.query.jobs === "1";
  const effective = short ? oneJob(scenario) : scenario;
  const shock = !short && req.query.shock !== "off";
  try {
    current = mode === "live" ? await startLive(effective, shock) : startSim(effective, shock);
    res.status(201).json({ id: current.id, mode });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

const need = (res: Response): Run | null => {
  if (!current) res.status(404).json({ error: "no run" });
  return current;
};

app.get("/api/state", async (_req, res) => {
  if (!current) return void res.json({ run: null, liveReady: liveReady() });
  const offers = await current.market.offers();
  const v = current.engine.view(offers);
  const s = current.scenario;
  res.json({
    run: current.id,
    mode: current.mode,
    liveReady: liveReady(),
    finished: current.result !== null,
    error: current.error,
    shocked: v.shocked,
    float: formatUsdz(s.float),
    floor: formatUsdz(s.reserveFloor),
    reserve: formatUsdz(v.reserve),
    offers: offers.map((o) => ({ id: o.id, kind: o.kind, tier: o.tier, price: formatUsdz(o.price), latencyMs: o.latencyMs })),
    jobs: v.jobs.map((j) => ({
      ...j,
      authorized: formatUsd(j.authorized),
      deposited: formatUsdz(j.deposited),
      spent: formatUsdz(j.spent),
      projected: formatUsdz(j.projected),
      captured: j.captured === null ? null : formatUsd(j.captured),
    })),
    holdsWaiting: current.holds instanceof LiveHolds ? current.holds.pendingAll().map(({ clientSecret: _s, ...p }) => p) : [],
    raisesWaiting: current.approvals.pending(),
    chainBroken: current.log.verify(),
    events: current.log.all().length,
    result: current.result ? { reconciled: current.result.reconciled, chainIntact: current.result.chainIntact } : null,
  });
});

/** Everything since `after`, then live. */
app.get("/api/events", (req, res) => {
  const run = need(res);
  if (!run) return;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  for (const e of run.log.all(Number(req.query.after ?? 0))) send(e);
  const off = run.log.subscribe(send);
  req.on("close", off);
});

app.get("/api/holds/:job", (req, res) => {
  const run = need(res);
  if (!run) return;
  const p = run.holds instanceof LiveHolds ? run.holds.pendingFor(req.params.job) : null;
  if (!p) return void res.status(404).json({ error: "no hold waiting for this job" });
  res.json(p);
});

app.post("/api/holds/:job/confirmed", async (req, res) => {
  const run = need(res);
  if (!run || !(run.holds instanceof LiveHolds)) return;
  try {
    const r = await run.holds.confirmed(req.params.job);
    res.json({ intentId: r.intentId, status: r.status, authorized: formatUsd(r.authorized) });
  } catch (e) {
    res.status(409).json({ error: String((e as Error).message) });
  }
});

app.post("/api/holds/:job/declined", async (req, res) => {
  const run = need(res);
  if (!run || !(run.holds instanceof LiveHolds)) return;
  await run.holds.declined(req.params.job);
  res.json({ ok: true });
});

app.post("/api/raises/:job", (req, res) => {
  const run = need(res);
  if (!run) return;
  const { approve, newTotal } = req.body as { approve?: boolean; newTotal?: string };
  const ok = run.approvals.answer(req.params.job, approve === true, newTotal);
  res.status(ok ? 200 : 409).json({ ok });
});

/** Break-it drills judges can fire mid-run. */
app.post("/api/drills/:name", async (req, res) => {
  const run = need(res);
  if (!run) return;
  const route = run.engine.view().jobs.find((j) => j.state === "running")?.route ?? "model-standard";
  switch (req.params.name) {
    case "shock":
      await run.engine.fireShock();
      break;
    case "fail-after-payment":
      await run.market.dropNext(route);
      run.log.append("drill.fail_after_payment", null, { provider: route });
      break;
    case "reprice-over-cap":
      await run.market.setPrice(route, parseUsdz("0.09"));
      run.log.append("drill.reprice_over_cap", null, { provider: route, price: "0.09" });
      break;
    default:
      return void res.status(404).json({ error: "no such drill" });
  }
  res.json({ ok: true });
});

app.listen(PORT, "127.0.0.1", () => console.log(`METER on http://localhost:${PORT}`));
