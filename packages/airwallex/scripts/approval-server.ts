// Customer hold-approval page. The server creates the PaymentIntent; the customer's browser confirms it
// through Airwallex's hosted card element as a pre-auth, so card data never touches our server.
// Run: node --env-file=.env packages/airwallex/scripts/approval-server.ts   (PORT defaults to 4377)
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { formatUsd, parseUsd } from "@meter/core";
import { AirwallexClient, AirwallexError } from "../src/client.ts";
import { createIntent, getIntent, holdState } from "../src/holds.ts";

const PORT = Number(process.env.PORT ?? 4377);
const awx = AirwallexClient.fromEnv();

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function errorBody(e: unknown) {
  return e instanceof AirwallexError ? { error: e.message, code: e.code ?? null } : { error: String(e) };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE, "text/html; charset=utf-8");

    if (req.method === "POST" && url.pathname === "/api/holds") {
      const body = await readJson(req);
      const amount = parseUsd(String(body.amount ?? ""));
      const job = String(body.job ?? "probe").replace(/[^\w-]/g, "").slice(0, 24) || "probe";
      if (amount <= 0n || amount > parseUsd("10.00")) return send(res, 400, { error: "amount must be between $0.01 and $10.00" });
      const pi = await createIntent(awx, {
        amount,
        currency: "USD",
        merchantOrderId: `meter-${job}-${Date.now()}`,
        requestId: randomUUID(),
        descriptor: "METER TAB",
        metadata: { job },
      });
      console.log(`created ${pi.id} ${formatUsd(amount)} for job ${job}`);
      return send(res, 201, { intent_id: pi.id, client_secret: pi.client_secret, currency: pi.currency, amount: pi.amount });
    }

    const m = /^\/api\/holds\/(int_[\w]+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const pi = await getIntent(awx, m[1]!);
      const s = holdState(pi);
      const authType = pi.latest_payment_attempt?.payment_method_options?.card?.authorization_type ?? null;
      console.log(`read ${pi.id}: ${pi.status} authorized=${formatUsd(s.authorized)} auth_type=${authType}`);
      return send(res, 200, { intent_id: pi.id, status: pi.status, amount: pi.amount, authorization_type: authType });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    return send(res, 502, errorBody(e));
  }
});

server.listen(PORT, () => console.log(`approval page on http://localhost:${PORT}`));

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>METER · Approve your tab</title>
<script src="https://static.airwallex.com/components/sdk/v1/index.js"></script>
<style>
  :root { --bg:#0b0d10; --panel:#14181d; --line:#262c34; --text:#e8ecf1; --muted:#8b95a3; --accent:#7cf29c; --warn:#ffb86b; --bad:#ff6b6b; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font:15px/1.5 ui-sans-serif, -apple-system, "Inter", system-ui, sans-serif; padding:16px; }
  .card { width:100%; max-width:440px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:24px; }
  .brand { font-weight:700; letter-spacing:.18em; font-size:12px; color:var(--muted); }
  h1 { font-size:20px; margin:6px 0 4px; }
  p { color:var(--muted); margin:0 0 16px; }
  .terms { display:grid; grid-template-columns:1fr auto; gap:6px 12px; padding:12px 0; margin-bottom:16px;
           border-top:1px solid var(--line); border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  .terms span:nth-child(odd) { color:var(--muted); }
  .terms strong { font-size:18px; }
  #card { background:#fff; border-radius:8px; padding:12px; min-height:46px; }
  button { margin-top:16px; width:100%; padding:12px; border:0; border-radius:8px; font:600 15px/1 inherit;
           background:var(--accent); color:#06210f; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #status { margin-top:14px; min-height:22px; font-size:14px; }
  .ok { color:var(--accent); } .warn { color:var(--warn); } .bad { color:var(--bad); }
  code { font-size:12px; color:var(--muted); word-break:break-all; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">METER</div>
  <h1>Approve a hold for your research job</h1>
  <p>We place a hold on your card for the job's budget, charge only what the job spends, and release the rest.</p>
  <div class="terms">
    <span>Job</span><span id="job">–</span>
    <span>Hold (maximum charge)</span><strong id="amount">–</strong>
    <span>Captured</span><span>only what's spent, once</span>
  </div>
  <div id="card"></div>
  <button id="approve" type="button" disabled>Approve hold</button>
  <div id="status" role="status" aria-live="polite">Setting up…</div>
  <div><code id="intent"></code></div>
</main>
<script>
  const q = new URLSearchParams(location.search);
  const job = q.get("job") || "A";
  const amount = q.get("amount") || "1.00";
  const $ = (id) => document.getElementById(id);
  const say = (text, cls = "") => { $("status").textContent = text; $("status").className = cls; };
  $("job").textContent = job;
  $("amount").textContent = "$" + Number(amount).toFixed(2) + " USD";

  (async () => {
    try {
      const r = await fetch("/api/holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, amount }) });
      const hold = await r.json();
      if (!r.ok) throw new Error(hold.error || "could not create the hold");
      $("intent").textContent = hold.intent_id;
      document.body.dataset.intent = hold.intent_id;

      await window.AirwallexComponentsSDK.init({ env: "demo", enabledElements: ["payments"] });
      const card = await window.AirwallexComponentsSDK.createElement("card", {
        intent_id: hold.intent_id,
        client_secret: hold.client_secret,
        currency: hold.currency,
        authorizationType: "pre_auth",
        autoCapture: false,
        allowedCardNetworks: ["visa", "mastercard"],
      });
      card.mount("card");
      card.on && card.on("ready", () => say("Enter your card to approve the hold."));
      $("approve").disabled = false;
      say("Enter your card to approve the hold.");

      $("approve").addEventListener("click", async () => {
        $("approve").disabled = true;
        say("Placing the hold…");
        try {
          await card.confirm({ intent_id: hold.intent_id, client_secret: hold.client_secret });
          const check = await fetch("/api/holds/" + hold.intent_id).then((x) => x.json());
          document.body.dataset.status = check.status;
          if (check.status === "REQUIRES_CAPTURE") say("Hold placed: $" + Number(check.amount).toFixed(2) + " (" + check.authorization_type + "). Nothing charged yet.", "ok");
          else say("Airwallex reports " + check.status + ".", "warn");
        } catch (e) {
          document.body.dataset.status = "ERROR";
          say("Hold failed: " + (e && (e.message || e.code) || e), "bad");
          $("approve").disabled = false;
        }
      });
    } catch (e) {
      document.body.dataset.status = "ERROR";
      say(String(e.message || e), "bad");
    }
  })();
</script>
</body>
</html>`;
