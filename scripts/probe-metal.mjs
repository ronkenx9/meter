// Reads Metal's public testnet facilitator: is it ready, and which Clearing deployment does it settle against?
// Saves the answer to research/metal-supported.json, since recovery needs the contract and service URL later.
import { writeFileSync } from "node:fs";

const BASE = "https://x402-testnet.metalntwx.com";
const NETWORK = "eip155:63825";
const USDZ = "0x000000000000000000000000000000000000b5d5";

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const ready = await getJson(`${BASE}/readyz`);
const net = ready.networks?.find((n) => n.network === NETWORK);
if (!ready.ok || !net?.ok) throw new Error(`facilitator not ready for ${NETWORK}: ${JSON.stringify(ready)}`);

const supported = await getJson(`${BASE}/x402/facilitator/supported`);
const clearing = supported.kinds?.find((k) => k.scheme === "bajillion" && k.network === NETWORK);
if (!clearing) throw new Error(`no bajillion kind for ${NETWORK}`);
const { settlement, asset, serviceUrl, validatorUrls = [] } = clearing.extra ?? {};
if (!/^0x[0-9a-fA-F]{40}$/.test(settlement ?? "")) throw new Error(`bad settlement address ${settlement}`);
if (String(asset).toLowerCase() !== USDZ) throw new Error(`clearing asset ${asset} is not *USDZ`);
if (!/^https:\/\//.test(serviceUrl ?? "")) throw new Error(`bad clearing service URL ${serviceUrl}`);

const service = await fetch(serviceUrl, { signal: AbortSignal.timeout(20_000) }).then((r) => r.status, (e) => `unreachable: ${e.message}`);

const record = { checkedAt: new Date().toISOString(), network: NETWORK, settlement, asset, serviceUrl, validatorUrls, serviceStatus: service };
writeFileSync(new URL("../research/metal-supported.json", import.meta.url), JSON.stringify(record, null, 2) + "\n");

console.log(`service=${serviceUrl} status=${service} validators=${validatorUrls.length}`);
console.log(`METAL_FACILITATOR_OK settlement=${settlement}`);
