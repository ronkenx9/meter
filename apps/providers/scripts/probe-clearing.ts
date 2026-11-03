// Live Metal testnet probe of the buyer and seller sides of clearing, with real receipts:
//   deposit into a fresh job wallet -> buy requests from three providers at live 402 prices -> reprice mid-run
//   -> offer above the cap is refused -> reconcile wallet record vs facilitator settlements -> queue the withdrawal.
// `--claim <wallet dir>` comes back later to claim the unused float.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Millionths, formatUsdz, loadScenario, parseUsdz, sumMillionths } from "@meter/core";
import { JobWallet, readDeployment } from "@meter/metal";
import { privateKeyToAccount } from "viem/accounts";
import { createMarket } from "../src/app.ts";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const rpcUrl = process.env.METAL_RPC_URL!;
const operator = privateKeyToAccount(process.env.METAL_OPERATOR_KEY as `0x${string}`);
if (!rpcUrl) throw new Error("METAL_RPC_URL is not set; run packages/metal/scripts/setup-operator.ts");

const scenario = loadScenario(root("scenario/kit12.json"));
const deployment = await readDeployment();

if (process.argv[2] === "--claim") {
  const job = await JobWallet.open({ directory: process.argv[3]!, rpcUrl, operator, deployment, maxPayment: scenario.maxPayment });
  const r = await job.withdraw();
  console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`balance ${JSON.stringify(await job.balance())}`);
  process.exit(0);
}

const run = new Date().toISOString().replace(/[:.]/g, "-");
const walletRoot = root(`wallets/probe-${run}`);
mkdirSync(walletRoot, { recursive: true });
const log: Array<Record<string, unknown>> = [];
const note = (step: string, data: Record<string, unknown> = {}) => {
  log.push({ step, at: new Date().toISOString(), ...data });
  console.log(`${step} ${JSON.stringify(data)}`);
};

const market = await createMarket({ scenario, walletRoot: `${walletRoot}/providers` });
const { server, baseUrl } = await market.listen(0);
note("market up", { baseUrl, providers: [...market.providers.values()].map((p) => `${p.id}@${formatUsdz(p.price)}`) });

const job = await JobWallet.open({ directory: `${walletRoot}/job`, rpcUrl, operator, deployment, maxPayment: scenario.maxPayment });
const depositAmount = parseUsdz("0.15");
let t = Date.now();
await job.deposit(depositAmount);
note("deposited", { amount: formatUsdz(depositAmount), account: job.account, ms: Date.now() - t });

const buy = async (provider: string, step: number) => {
  const outcome = await job.pay(`${baseUrl}/${provider}?job=probe&step=${step}`);
  if (outcome.kind === "paid") {
    note(`paid ${provider}`, { price: formatUsdz(outcome.price), status: outcome.status, tries: outcome.tries, ms: outcome.ms, body: outcome.body.slice(0, 80) });
  } else note(`NOT paid ${provider}`, { ...outcome });
  return outcome;
};

let failures = 0;
const expectPaid = (o: Awaited<ReturnType<typeof buy>>, price: string) => {
  if (o.kind !== "paid" || o.price !== parseUsdz(price) || o.status !== 200) {
    failures++;
    note("FAIL expected a paid 200", { want: price, got: o.kind });
  }
};

expectPaid(await buy("model-basic", 1), "0.01");
expectPaid(await buy("model-standard", 2), "0.02");
expectPaid(await buy("search", 3), "0.02");

// The price is whatever the next 402 says.
market.providers.get("model-basic")!.price = parseUsdz("0.03");
note("repriced model-basic to 0.03");
expectPaid(await buy("model-basic", 4), "0.03");

// A dearer offer than the cap moves nothing.
market.providers.get("model-premium")!.price = parseUsdz("0.09");
const spentBefore = await job.spent();
let refused = false;
try {
  const o = await job.pay(`${baseUrl}/model-premium?job=probe&step=5`);
  refused = o.kind !== "paid";
  note("over-cap offer", { outcome: o.kind, status: "status" in o ? o.status : null });
} catch (e) {
  refused = true;
  note("over-cap offer refused", { message: String((e as Error).message).slice(0, 160) });
}
if (!refused || (await job.spent()) !== spentBefore) {
  failures++;
  note("FAIL over-cap offer paid");
}

// A provider that fails after being paid still cost its price, and the wallet's record shows it.
market.providers.get("search")!.dropNext = true;
const dropped = await buy("search", 6);
if (dropped.kind !== "paid" || dropped.status !== 503) {
  failures++;
  note("FAIL failed-after-payment should still be a recorded payment", { got: dropped.kind });
}

// Reconcile three ways: wallet record, sum by provider, and the facilitator's settlement list.
const payments = await job.payments();
const spent = sumMillionths(payments.map((p) => p.amount));
const byProvider: Record<string, string> = {};
for (const p of market.providers.values()) {
  byProvider[p.id] = formatUsdz(sumMillionths(payments.filter((x) => x.recipient === p.clearingKey).map((x) => x.amount)));
}
const facilitator = `https://x402-testnet.metalntwx.com/x402/facilitator`;
const settled: Record<string, Millionths> = {};
for (const p of market.providers.values()) {
  const res = await fetch(`${facilitator}/settlements?payTo=${p.clearingKey}`, { signal: AbortSignal.timeout(20_000) });
  const body = (await res.json()) as { settlements?: Array<{ amount?: string }> } | Array<{ amount?: string }>;
  const rows = Array.isArray(body) ? body : (body.settlements ?? []);
  settled[p.id] = sumMillionths(rows.map((r) => (BigInt(r.amount ?? "0") / 1_000_000_000_000n) as Millionths));
}
const settledTotal = sumMillionths(Object.values(settled));
note("reconcile", { walletCount: payments.length, walletSpent: formatUsdz(spent), byProvider, facilitatorSettled: formatUsdz(settledTotal) });
if (spent !== parseUsdz("0.10")) {
  failures++;
  note("FAIL wallet spent != 0.10", { spent: formatUsdz(spent) });
}
if (settledTotal !== spent) {
  failures++;
  note("FAIL facilitator settlements != wallet record");
}

note("spendable estimate", { spendable: (await job.spendable()).toString() });
t = Date.now();
const queued = await job.withdraw();
note("withdraw", { result: JSON.parse(JSON.stringify(queued, (_k, v) => (typeof v === "bigint" ? v.toString() : v))), ms: Date.now() - t });

writeFileSync(root("research/metal-clearing-probe.json"), JSON.stringify({ ranAt: new Date().toISOString(), network: "eip155:63825", settlement: deployment.settlement, operator: operator.address, jobAccount: job.account, walletDir: `wallets/probe-${run}/job`, failures, log }, null, 2) + "\n");
server.close();

if (failures) {
  console.log(`METAL_CLEARING_PROBE_FAILED failures=${failures}`);
  process.exit(1);
}
console.log(`METAL_CLEARING_OK spent=${formatUsdz(spent)} payments=${payments.length}`);
process.exit(0);
