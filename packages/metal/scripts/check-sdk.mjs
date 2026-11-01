// Confirms the pinned SDK exports everything the Kit 12 flow calls, so a version bump that drops one fails loudly.
import { readFileSync } from "node:fs";

const pay = await import("@metalntwx/metal-pay");
const node = await import("@metalntwx/metal-pay/node");

const needed = {
  "@metalntwx/metal-pay": [
    "ClearingServerScheme",
    "registerMetalScheme",
    "METAL_NETWORKS",
    "USDZ",
    "usdzBaseUnits",
    "depositToClearing",
    "createMetalPaymentClient",
    "createClearingClient",
    "registerClearingClient",
    "clearingSpendable",
    "clearingBalance",
    "withdrawFromClearing",
    "recoverFromClearing",
    "clearingAbi",
  ],
  "@metalntwx/metal-pay/node": ["openClearingWallet"],
};

const mods = { "@metalntwx/metal-pay": pay, "@metalntwx/metal-pay/node": node };
const missing = Object.entries(needed).flatMap(([m, names]) => names.filter((n) => !(n in mods[m])).map((n) => `${m}:${n}`));
if (missing.length) {
  console.error(`missing exports: ${missing.join(", ")}`);
  process.exit(1);
}

const testnet = pay.METAL_NETWORKS.testnet;
if (testnet.chainId !== 63825) throw new Error(`testnet chainId is ${testnet.chainId}`);
if (pay.usdzBaseUnits("0.02") !== "20000000000000000") throw new Error(`usdzBaseUnits("0.02") = ${pay.usdzBaseUnits("0.02")}`);

const { version } = JSON.parse(readFileSync(new URL("../node_modules/@metalntwx/metal-pay/package.json", import.meta.url), "utf8"));
if (version !== "0.3.4") throw new Error(`expected pinned metal-pay 0.3.4, found ${version}`);
console.log(`facilitator=${testnet.facilitatorUrl} version=${version ?? "unknown"}`);
console.log("METAL_SDK_OK");
