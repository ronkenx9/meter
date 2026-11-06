// `node --env-file=.env apps/orchestrator/scripts/recover.ts runs/<run id>.sqlite`: settle a live run that stopped
// mid-way. Captures what each job's wallet paid, cancels holds with nothing to charge, queues unused float.
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { AirwallexClient } from "@meter/airwallex";
import { loadScenario } from "@meter/core";
import { EventLog } from "@meter/ledger";
import { JobWallet, readDeployment } from "@meter/metal";
import { privateKeyToAccount } from "viem/accounts";
import { LiveHolds } from "../src/live.ts";
import { recover } from "../src/recover.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: recover.ts runs/<run id>.sqlite");
const id = basename(file, ".sqlite");
const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const scenario = loadScenario(root("scenario/kit12.json"));
const log = new EventLog(file);
const deployment = await readDeployment();
const operator = privateKeyToAccount(process.env.METAL_OPERATOR_KEY as `0x${string}`);
const wallets = new Map<string, JobWallet>();
const wallet = async (jobId: string) => {
  let w = wallets.get(jobId);
  if (!w) {
    w = await JobWallet.open({ directory: root(`wallets/run-${id}/jobs/${jobId}`), rpcUrl: process.env.METAL_RPC_URL!, operator, deployment, maxPayment: scenario.maxPayment });
    wallets.set(jobId, w);
  }
  return w;
};
const result = await recover(log, new LiveHolds(AirwallexClient.fromEnv(), id), wallet);
for (const j of result) console.log(`${j.id}: ${j.outcome}${j.captured === null ? "" : ` ${j.captured}c`} (wallet paid ${j.walletSpent} millionths, unused ${j.unused})`);
const broken = log.verify();
console.log(broken === null ? "RECOVERED log intact" : `log broken at event ${broken}`);
