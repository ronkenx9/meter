// The market: every provider sells one request over x402, paid by Metal clearing at its current price.
// Each has its own clearing key so settlements identify it. Prices and latency live in memory,
// so a shock changes the very next 402 offer; nothing is cached on the buyer's side.

import type { Server } from "node:http";
import { join } from "node:path";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ClearingServerScheme, METAL_NETWORKS, registerMetalScheme } from "@metalntwx/metal-pay";
import { openClearingWallet } from "@metalntwx/metal-pay/node";
import { type Millionths, type Scenario, type ScenarioProvider, millionthsToDecimal, parseUsdz } from "@meter/core";
import express, { type Express } from "express";

const NETWORK = "eip155:63825" as const;

export interface LiveProvider extends ScenarioProvider {
  clearingKey: string;
  /** Fail after payment, once, to exercise the failed-after-payment path. */
  dropNext: boolean;
  /** Take the next payment, then cut the connection before the answer, so the buyer never sees its receipt. */
  loseNext: boolean;
}

export type Writer = (p: LiveProvider, query: URLSearchParams) => Promise<string> | string;

export interface MarketOptions {
  scenario: Scenario;
  /** Each provider's clearing wallet lives in <walletRoot>/<provider id>. */
  walletRoot: string;
  writer?: Writer;
}

export interface Market {
  app: Express;
  providers: Map<string, LiveProvider>;
  listen(port: number): Promise<{ server: Server; baseUrl: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const standIn: Writer = (p, q) => {
  const step = q.get("step") ?? "1";
  if (p.kind === "search") return `Search results for job ${q.get("job")}, query ${step}: three sources worth reading.`;
  if (p.kind === "lookup") return `Data lookup for job ${q.get("job")}, record ${step}: figures retrieved.`;
  return `[${p.tier} model] Paragraph ${step} of the report for job ${q.get("job")}.`;
};

export async function createMarket({ scenario, walletRoot, writer = standIn }: MarketOptions): Promise<Market> {
  const facilitator = new HTTPFacilitatorClient({ url: METAL_NETWORKS.testnet.facilitatorUrl });
  const server = registerMetalScheme(new x402ResourceServer(facilitator), { networks: ["testnet"] }).register(NETWORK, new ClearingServerScheme(NETWORK));

  const providers = new Map<string, LiveProvider>();
  for (const p of scenario.providers) {
    const wallet = await openClearingWallet(join(walletRoot, p.id));
    providers.set(p.id, { ...p, clearingKey: wallet.signer.publicKey, dropNext: false, loseNext: false });
  }

  const routes = Object.fromEntries(
    [...providers.values()].map((p) => [
      `GET /${p.id}`,
      {
        accepts: {
          scheme: "bajillion",
          network: NETWORK,
          payTo: p.clearingKey,
          // Read per request, so the 402 always carries the live price.
          price: () => millionthsToDecimal(p.price),
        },
        description: `${p.kind} request from ${p.id}`,
      },
    ]),
  );

  const app = express();
  app.use(express.json());

  // Unpaid: the market's own state and the shock controls the dashboard and drills use.
  app.get("/market", (_req, res) => {
    res.json({ providers: [...providers.values()].map((p) => ({ id: p.id, kind: p.kind, tier: p.tier ?? null, price: millionthsToDecimal(p.price), latencyMs: p.latencyMs, clearingKey: p.clearingKey })) });
  });
  app.post("/market/:id", (req, res) => {
    const p = providers.get(req.params.id);
    if (!p) return void res.status(404).json({ error: "no such provider" });
    const { price, latencyMs, dropNext, loseNext } = req.body as { price?: string; latencyMs?: number; dropNext?: boolean; loseNext?: boolean };
    if (price !== undefined) p.price = parseUsdz(price) as Millionths;
    if (latencyMs !== undefined) p.latencyMs = latencyMs;
    if (dropNext !== undefined) p.dropNext = dropNext;
    if (loseNext !== undefined) p.loseNext = loseNext;
    res.json({ id: p.id, price: millionthsToDecimal(p.price), latencyMs: p.latencyMs, dropNext: p.dropNext, loseNext: p.loseNext });
  });

  // Installed before the payment middleware, which keeps this as the real end and calls it only after settling.
  // So the payment goes through and the connection drops before the answer and its receipt reach the buyer.
  app.use((req, res, next) => {
    const p = providers.get(req.path.slice(1));
    const paid = req.headers["payment-signature"] !== undefined || req.headers["x-payment"] !== undefined;
    if (p?.loseNext && paid) {
      // One lost answer per drill, whichever provider is paid first.
      for (const q of providers.values()) q.loseNext = false;
      res.end = (() => {
        res.socket?.destroy();
        return res;
      }) as typeof res.end;
    }
    next();
  });

  app.use(paymentMiddleware(routes, server));

  for (const p of providers.values()) {
    app.get(`/${p.id}`, async (req, res) => {
      if (p.dropNext) {
        p.dropNext = false;
        return void res.status(503).json({ error: "provider failed after payment" });
      }
      const started = Date.now();
      const query = new URL(req.originalUrl, "http://x").searchParams;
      try {
        const text = await writer(p, query);
        // latencyMs is the slowest this provider answers; a slowdown shock stretches a fast model call to it.
        await sleep(Math.max(0, p.latencyMs - (Date.now() - started)));
        res.json({ provider: p.id, kind: p.kind, tier: p.tier ?? null, text });
      } catch (e) {
        // The payment already happened, so this is a real failed-after-payment, which the engine handles.
        res.status(502).json({ error: "provider could not produce an answer", detail: String((e as Error).message).slice(0, 200) });
      }
    });
  }

  return {
    app,
    providers,
    listen: (port) =>
      new Promise((resolve, reject) => {
        const s = app.listen(port, "127.0.0.1", (err?: Error) => {
          if (err) return reject(err);
          const addr = s.address();
          resolve({ server: s, baseUrl: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}` });
        });
      }),
  };
}
