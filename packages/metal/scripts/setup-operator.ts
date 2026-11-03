// One-time testnet setup with no console or owner steps:
//   1. create the operator key if .env has none (testnet only; written to .env, never printed),
//   2. top it up from the public faucet,
//   3. buy an RPC endpoint over x402 with that testnet money, and write its URL to .env.
// Safe to re-run: it reuses what exists, and an address is handed one endpoint however often it pays.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createMetalPaymentClient } from "@metalntwx/metal-pay";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = new URL("../../../.env", import.meta.url);
const FAUCET = "https://faucet.metalntwx.com/api/fund";
const RPC_BASE = "https://rpc-testnet.metalntwx.com/v1";

function setEnv(name: string, value: string): void {
  const text = readFileSync(ENV, "utf8");
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  writeFileSync(ENV, re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`);
  chmodSync(ENV, 0o600);
}

let key = process.env.METAL_OPERATOR_KEY?.trim() as `0x${string}` | undefined;
if (!key) {
  key = generatePrivateKey();
  setEnv("METAL_OPERATOR_KEY", key);
  console.log("created operator key (saved to .env)");
}
const account = privateKeyToAccount(key);
console.log(`operator ${account.address}`);

const funded = await fetch(FAUCET, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: account.address, symbol: "USDZ" }),
  signal: AbortSignal.timeout(90_000),
});
const grant = (await funded.json()) as { amount?: string; txHash?: string; error?: string; code?: string };
if (funded.ok) console.log(`faucet granted ${grant.amount} base units, tx ${grant.txHash}`);
else if (funded.status === 409) console.log("faucet: already funded");
else throw new Error(`faucet ${funded.status}: ${JSON.stringify(grant)}`);

if (process.env.METAL_RPC_URL?.trim()) {
  console.log("METAL_RPC_URL already set; not buying an endpoint");
} else {
  const { fetchWithPayment } = createMetalPaymentClient({ account, network: "testnet" });
  const res = await fetchWithPayment(RPC_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const body = await res.text();
  const endpoint = res.headers.get("rpc-aas-endpoint");
  if (!res.ok || !endpoint) throw new Error(`endpoint purchase failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  // The URL is its own credential, so it goes to .env and is never logged.
  setEnv("METAL_RPC_URL", new URL(endpoint, RPC_BASE).toString());
  console.log(`bought RPC endpoint; eth_chainId -> ${body.slice(0, 120)}`);
}
console.log("METAL_SETUP_OK");
