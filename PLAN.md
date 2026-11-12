# METER build plan

Airwallex Agentic Banking Hackathon, **Kit 12: Inference Sourcing Agent**. Targets: **Metal Award** ($15k, "requires Metal and Airwallex tooling") and **Judges' Choice** ($20k, open).

Drafted 2026-10-30, day 4 of the build. Sources are listed at the bottom; local copies are in `research/`.

---

## Status (Nov 11)

**Done and verified (GATES.md 17/17; 108 tests; 10,000 random runs clean):**
- Fresh main run on the current code (`research/live-kit12-run.jsonl`, Nov 11): A $0.30 (14/14), B raised from $0.75 to $0.90 by a click on the dashboard and charged $0.88 (40/40), C $0.25 (10/10). Float balanced, reconciled, every plan from Claude.
- A second good run where the float could not fund a raise, so none was asked (`research/live-kit12-no-raise-run.jsonl`).
- Payee and price lock on every payment, proven live (`research/live-swapped-payee-drill.jsonl`); earlier drills (lost answer, crash recovery) still pass.
- `pnpm check:sim`: 10,000 random runs, half with a planner proposing nonsense. It found two real bugs, now fixed: two raises for one customer in a plan crashed the engine, and a planner could ask the same customer forever (now at most 3 asks).
- Keyless replay of four recordings in the dashboard; landing page at `/` in the Teampot design system, dashboard at `/app` restyled to match.
- The wallet now settles a deposit of unknown outcome (looks it up, and if it is still pending takes its nonce). Found in a degraded-testnet run kept as `research/live-degraded-testnet-run.jsonl`.

**Known limits:** see README. Not yet seen live: the unknown-deposit fix meeting that failure again, and the float claimable-time readout.

**Left, in order:**
1. Demo video under 5 minutes (Creative Draft first), then submit by Nov 14.

Pushed Nov 12 to https://github.com/ronkenx9/meter (public). CI passes on GitHub: install, typecheck, tests, 10,000 random runs, evidence checks. Dependabot opened a vitest 4 bump (PR #1); not merged.

**Measured, differs from the docs:** a payment takes about 7 s per wallet, not 3 s; a full run with real Claude takes about 11 minutes. Keep the Mac awake: sleep mid-run froze one for 10 minutes.

## 1. Dates and what to submit

| When | What |
|---|---|
| Oct 27 – **Nov 15, 11:59 PM PST** (Nov 16, 07:59 UTC) | Build phase. Extended from Nov 13 per Dan Kim (Airwallex) in Slack #announcements, Oct 30. Aim to submit **Nov 14**. |
| Nov 15 | Finalists announced |
| Nov 19 | Demo day in SF; remote is fine |

**Submit:** a working demo, a video under 5 minutes, and a repo with setup instructions. No judging rubric has been published. Build to the guide's five beats: goal → initial plan → new information → revised decision → resulting money state.

## 2. The kit is our idea, so build to its numbers

Kit 12 describes METER almost exactly. Judges will check the run against these numbers, so keep them as the canonical scenario in `scenario/kit12.json`:

- **Three jobs:** card holds of **$1.00, $0.75 and $0.75**.
- **Float:** **1.50 *USDZ**, against 2.50 the jobs could spend. Deposit part of the float per job and keep the rest as a reserve.
- **Prices:** model providers charge **1, 2 and 5 cents a paragraph**, web search costs **2c**, data lookup **3c**. Each paragraph is its own paid request.
- **The shock:** midway, one job's prompt runs to **4× its budgeted tokens** and the **cheapest provider slows**.
- **What the agent must do:**
  - re-route jobs to other providers,
  - decide which jobs get the reserve,
  - ask a customer to raise their hold.
- **A good run:** no customer is charged past their hold, the jobs that can finish do, and the agent asks before spending more.
- **Close:** capture exactly what each job spent, release the rest of each hold, and withdraw the unused float.

### Corrections to APPLICATION.md, from the docs

- The scheme is **`bajillion`**, served with `ClearingServerScheme`. There is no `ClearingDebitServerScheme`.
- There is **no `POST /clearing/position`**. A job's spend comes from:
  - the job wallet's own record, `(await wallet.store.load()).payments`,
  - `clearingBalance()` and `clearingSpendable()`, which are estimates,
  - the facilitator's `GET /settlements?payTo=`.
- **One wallet pays about one request every 3 seconds.** That shapes the whole design: one wallet per job, and jobs of tens of payments, not hundreds.
- **Unused float can only be withdrawn about 10 minutes after the job's last payment** (the clearing page says 20+). It takes two calls: queue, then claim. The video cuts across this wait, and the dashboard shows the countdown.

## 3. Builder kits and resources we use

| Resource | Use |
|---|---|
| [Builder guide, Kit 12](https://airwallexdev.com/guide#12-inference-sourcing-agent) (`research/builder-guide.md`) | Scenario numbers, endpoints and watch-outs, built as written |
| Airwallex **docs MCP** `https://mcp.sandbox.airwallex.com/docs` | Added as `airwallex-docs` on Nov 1, in the meter project's Claude Code config; it connects. The hold API fields in section 6 come from it. |
| Airwallex **developer MCP** `https://mcp.sandbox.airwallex.com/developer` | Added as `airwallex-dev`; needs a sandbox login (owner runs `/mcp` in a terminal `claude` session in `meter/`). Ad-hoc sandbox probes while building; the app itself uses REST. |
| Airwallex sandbox REST `https://api.sandbox.airwallex.com/api/v1` | `/authentication/login`, `/pa/payment_intents/create`, `/{id}/confirm`, `/{id}/increment_authorization`, `/{id}/capture`, `/{id}/cancel`, webhooks |
| `@metalntwx/metal-pay@0.3.4` + `viem` | Provider side: `ClearingServerScheme`, `registerMetalScheme`. Payer side: `openClearingWallet`, `depositToClearing`, `createClearingClient`, `registerClearingClient`, `clearingSpendable`, `clearingBalance`, `withdrawFromClearing`, `clearingAbi` |
| `@x402/core` + `@x402/express` | x402 resource server for our three providers |
| `@metalntwx/metal-agent@0.3.3` CLI | Key creation and faucet funding in setup scripts; `metal-agent status` for proofs |
| Metal facilitator `https://x402-testnet.metalntwx.com/x402/facilitator` | `/supported` (Clearing contract, service URL, validators), `/settlements`, `/readyz` |
| Metal testnet | Chain ID **63825**. RPC is `https://rpc-testnet.metalntwx.com/v1/<endpoint-id>` from the [console](https://console-testnet.metalntwx.com). Explorer is `testnet.metalntwx.com`. *USDZ is at `0x…B5d5` with 18 decimals. |
| Metal faucet | `POST https://faucet.metalntwx.com/api/fund {"address","symbol":"USDZ"}` tops up to 100 *USDZ. Limits: once a minute, 10 per IP per day. |
| Claude ($10k hackathon credits) | Providers write real paragraphs (cheap tier on `claude-haiku-5-5`, dear tier on `claude-sonnet-5-5`). The agent's judgment calls run on `claude-sonnet-5-5`. |
| Support | devhelp@airwallex.com for sandbox surprises; Metal Slack (partner support per the landing page). The Discord link wasn't found; get it from the acceptance email. |
| Reference: [quartermaster](https://github.com/big14way/quartermaster) (Kit 11) | Fellow MIT entry. Its pattern of hash-chained run logs, reconciliation and drills is a good bar to match. Don't copy code. |

## 4. Competitors (audited Oct 30)

- **[ScottVentures/Scott-IS-Agent](https://github.com/ScottVentures/Scott-IS-Agent)**, Kit 12, Metal Award.
  - It's a mock only: its Metal settlement and Airwallex top-up are unchecked roadmap items.
  - It has no pre-auth holds and doesn't use the clearing SDK.
  - Its README states its own Metal settlement is a hook, so it currently doesn't meet the Metal requirement.
- **[big14way/quartermaster](https://github.com/big14way/quartermaster)**, Kit 11, Metal Award. This is the real rival.
  - Self-reported: live on Metal and Airwallex, 49 tests, CI, a 4-minute video, and drills for a compromised agent and crash-retry.
  - It's a different kit, but it competes for the same $15k.

**How we win:**
1. **Both rails live, both ways.** We use card pre-auth, increment, capture and cancel on Airwallex, plus clearing deposit, pay and withdraw on Metal. Quartermaster uses Airwallex for deposits, FX and transfers only, never a card hold.
2. **Every number checks out on screen.** The capture, the wallet record, the receipts and the facilitator's settlements match to the millionth, each shown with an explorer or sandbox link.
3. **Break-it drills judges can trigger from the dashboard** (section 7).
4. **Real model output** with a visible quality trade-off, not just a price race.

## 5. Architecture

```
meter/
  apps/
    providers/    3 model providers + search + lookup: Express + x402 bajillion,
                  live price table, shock controls (slowdown, reprice)
    orchestrator/ job state machines, scheduler, reserve rationing, Airwallex + Metal adapters
    dashboard/    Vite + React: three live meters, decision cards, approval modal, proof panel
  packages/
    core/         units (USDZ base units <-> millionths <-> USD major), money types, ids
    ledger/       SQLite (node:sqlite) store for tabs, deposits, payments, receipts and an
                  append-only hash-chained event log
    airwallex/    REST client: login, token refresh, intents, webhooks (HMAC, dedupe)
    metal/        clearing payer per job wallet, deposit/withdraw, settlements reader
    policy/       pure functions: can_pay, needs_hold_raise, reserve allocation, float floor, capture amount
    planner/      Claude tool-calling: route choice, quality judgment, customer explanation
    sim/          one SimAdapter interface (Airwallex sandbox simulations, stand-in text mode)
  scenario/kit12.json
  runs/           <run-id>.jsonl evidence logs
```

- **Stack:** pnpm monorepo, Node ≥ 22.13 (for `node:sqlite`, which clearing wallets need), TypeScript, vitest and Playwright.
- **Ledger:** SQLite instead of the Postgres in the application. There are fewer moving parts, judges can run it, and the same store type also backs the clearing wallets.

**Per-job state machine:**

```
quoted → hold_requested → held (REQUIRES_CAPTURE) → funded (deposit landed, next epoch)
  → running ⇄ rerouting
  → over_budget → awaiting_hold_raise → (approved: increment → top-up) | (declined: finish within hold)
  → draining (last payment, answers settled) → capturing → captured | cancelled
  → float_withdraw_queued → float_withdrawn
```

**Starting split (revised Nov 3):** A $0.25, B $0.20, C $0.20, leaving $0.85 in reserve with a $0.05 floor, so the rationing is real.

**Who decides what:**

| Code (hard rules) | Model (judgment) |
|---|---|
| Price lists and the `maxAmount` cap | Whether a paragraph needs the 5c provider (rubric: accuracy, citations, depth) |
| Per-job budget, hold ceiling, float floor | Which over-budget job deserves the reserve, given progress and value |
| Hold raised *before* top-up; one capture, never above the hold | The customer-facing message asking for a hold raise |
| A lost answer is resent to the same URL at the same price before any reroute | Explaining each re-route in plain words on the decision card |
| Idempotency keys, capture = wallet record | |

The model only proposes. `policy/` validates every proposal and rejects any that breaks a rule. Rejected proposals appear on the dashboard as such.

## 6. The money path for one job

1. **Hold.**
   - `POST /pa/payment_intents/create`: amount $1.00, `merchant_order_id = job id`, `request_id = uuid`.
   - `POST /pa/payment_intents/{id}/confirm`: test card `4035501000000008`, with `payment_method_options.card.authorization_type: "pre_auth"` and `auto_capture: false`.
   - Wait for `REQUIRES_CAPTURE`, from the webhook or by polling.
2. **Fund.**
   - Open a fresh clearing wallet for the job (`runs/<run>/wallets/<job>`).
   - Call `depositToClearing` with the job's share. All deposits go in before any job starts, because a deposit only pays from the next epoch.
3. **Run.**
   - Each step does `fetchWithPayment(providerUrl)`. The provider returns 402 with its current price, and the client pays through clearing within `maxAmount = 0.05`.
   - Record the invoice id, amount, recipient and receipt, then append the paragraph.
   - On `between_epochs`, sleep for `retry.ms`.
   - If a payment's answer is lost, resend the same URL at the same price, or call `clearing.pay(pendingInvoice)`, before doing anything else.
4. **Overrun.**
   - Policy projects the overspend: `spent + remaining_steps × price > hold`.
   - The planner proposes a move: re-route, give it reserve, or ask for a hold raise.
   - On customer approval, in order:
     - `POST /{id}/increment_authorization` with the **new total**,
     - confirm the new amount,
     - then call `depositToClearing` to top up from the reserve.
5. **Close.**
   - Capture amount = the sum of the job wallet's recorded payments, converted from 18-decimal base units to USD. Reconciliation must agree: wallet record = provider receipts = facilitator `/settlements` for each provider key.
   - `POST /{id}/capture` with that amount, once.
   - If the job failed and spent nothing, call `/cancel` instead.
6. **Withdraw.**
   - Call `withdrawFromClearing` to queue the withdrawal; the result is `sent` with an empty `claimed`.
   - Call it again about 10 minutes later to claim. Repeat until `empty` and `clearingBalance.amount == "0"`.

### Airwallex hold API, verified from the docs MCP (Nov 1)

- **`increment_authorization`** takes `{ amount, request_id }`.
  - `amount` is the **new total** and must be greater than the current authorized total.
  - Only a single capture is allowed afterwards.
- **`capture`** takes `{ request_id, amount? }`. `amount` must be ≤ the authorized amount; a partial capture releases the rest.
- **`cancel`** takes `{ cancellation_reason?, cancellation_reason_code? }`.
  - It's allowed from `REQUIRES_PAYMENT_METHOD` or `REQUIRES_CAPTURE`.
  - Cancelling at `REQUIRES_CAPTURE` reverses the hold.
- **`confirm`** with raw card details:
  - Body: `{ request_id, payment_method: { type: "card", card: { number, expiry_month, expiry_year, cvc, name } }, payment_method_options: { card: { authorization_type: "pre_auth", auto_capture: false } } }`.
  - It returns `REQUIRES_CAPTURE`.
  - **Settled Nov 1:** the sandbox refuses it ("not enabled for native API access"). Holds are confirmed in the browser through Airwallex.js hosted card fields instead (`packages/airwallex/scripts/approval-server.ts`): `createElement('card', { intent_id, client_secret, currency, authorizationType: 'pre_auth', autoCapture: false })`, then `card.confirm()`. Increment, capture and cancel stay server-side REST. The dashboard's approve-hold modal reuses this.
  - **Verified live (GATES G7):** a $1.00 pre-auth was raised to $1.40 and captured $0.37 → SUCCEEDED. A repeat increment to the same total was refused (`validation_error`), a second capture was refused (`invalid_status_for_operation`), and a capture above a $0.75 hold was refused (`amount_above_limit`). A $0.75 hold was cancelled → CANCELLED.
  - **Sandbox account:** Payments only works on the US business "New Business Sandbox"; the HK one has no Payments.
  - **Browser automation note:** the hosted field needs one click to wake and a second to focus, and drops fast keystrokes, so type in 4-digit chunks.
- **Hold lifetime:** about 7 days for a standard authorization, up to 30 with `pre_auth` (Mastercard; Visa only for some merchant categories). An expired authorization ends `CANCELLED`. Every demo hold closes within minutes, so this only matters for drill 7.
- **Webhooks:** `payment_intent.requires_capture`, `payment_intent.succeeded`, `payment_intent.cancelled`, `payment_intent.payment_failed`.

Units are converted only in `packages/core/units.ts`, which is property-tested: USD major units ↔ millionths ↔ 18-decimal base units, rounding prices to whole millionths.

## 7. Break-it drills (dashboard buttons, each with a test)

1. **Overrun**: job B's prompt ×4, which triggers the hold-raise request.
2. **Slowdown**: latency on the 1c provider rises from 200 ms to 6 s, which triggers a re-route.
3. **Reprice**: a provider raises its price mid-job above `maxAmount`. The payment is refused and the job re-routes.
4. **Lost answer**: the provider drops the response after payment. The job must resend to the same URL at the same price before moving on, and pays only once.
5. **Customer declines the raise**: the job finishes within its hold, returns a partial report, and its capture is at most the hold.
6. **Crash and restart**: kill the orchestrator mid-run. On restart it rebuilds from the ledger and wallet stores, and nothing is paid or captured twice.
7. **Hold about to lapse**: a job is stalled. It's captured or cancelled before expiry.
8. **Capture-guard tamper**: try to capture more than the hold or capture twice. Code refuses, and the refusal is logged.

## 8. Day-by-day (finish by Nov 12, buffer on Nov 13)

| Day | Date | Output |
|---|---|---|
| 0 | Oct 30 (today) | Owner setup (section 9). Scaffold the monorepo, `core/units` with tests, the `scenario/kit12.json` file. |
| 1 | Oct 31 | **Airwallex probe:** login, then create → confirm pre_auth → increment → partial capture, plus a cancel path, on a real sandbox intent. Record exact fields from the docs MCP. Webhook receiver with HMAC and dedupe. |
| 2 | Nov 1 | **Metal probe:** faucet, read `/supported`, one provider with `bajillion`, open a job wallet, deposit, 10 paid requests, then queue and claim the withdrawal. Measure real throughput and the withdraw delay. |
| 3 | Nov 2 | **One job end to end:** hold → deposit → ~30 paid paragraphs → capture equal to the wallet record → withdraw. Reconciliation check. This is the milestone the fallback depends on. |
| 4 | Nov 3 | Three providers plus search and lookup, the live price table, shock controls, real Claude paragraphs per tier. |
| 5 | Nov 4 | Scheduler: three parallel jobs with one wallet each, reserve rationing, float floor. |
| 6 | Nov 5 | Planner tools and the policy validator. Overrun → hold-raise → increment → top-up ordering. Decline path. |
| 7 | Nov 6 | Dashboard: three meters ticking per payment, decision cards, approval modal, epoch clock, proof panel with explorer and sandbox links. |
| 8 | Nov 7 | Drills 3–8, crash recovery, hash-chained run log. `pnpm demo --headless` (stand-in text, no keys) and a live mode. |
| 9 | Nov 8 | Full live rehearsal of the Kit 12 scenario, saving `runs/live-*.jsonl` and proof links. Fix what breaks. Autotest pass on desktop and mobile. |
| 10 | Nov 9 | README: setup in under 10 minutes, architecture diagram, proof table, honest limits. CI (vitest and e2e headless). |
| 11 | Nov 10 | Demo video under 5 min: key beat in the first 60 s, using the pitch-demo-video skill and the approved METER 30s brand film as the opener. |
| 12 | Nov 11 | Owner review of the video, revisions, second live run for fresh proofs. |
| 13 | Nov 12 | **Submit**: repo public, video, demo link, HackerEarth form (owner). |
| — | Nov 13 | Buffer only. |

**Fallback (cut in this order if late):** drills 6–8 → search and lookup providers → real-model paragraphs (keep stand-in text) → third job. The hold → clearing payments → exact capture → withdraw chain must ship however much is cut.

## 9. Owner steps (blocking; only you can do these)

1. **Airwallex sandbox:** sign up at sandbox.airwallex.com. If you create a second business, name it `Sandbox Business` so KYB auto-approves. Copy the client ID and API key from Account > Developer > API keys into `meter/.env` (`AWX_CLIENT_ID`, `AWX_API_KEY`). Never paste them in chat.
2. **Airwallex webhook:** after day 1, register the tunnel URL I give you in the sandbox webhook settings and put the secret in `.env` (`AWX_WEBHOOK_SECRET`).
3. **Metal console:** create an RPC endpoint at console-testnet.metalntwx.com. Billing setup uses their sandbox test card, so you enter it. Put the endpoint URL in `.env` as `METAL_RPC_URL`.
4. **Anthropic key:** claim the hackathon Claude credits, then set `ANTHROPIC_API_KEY` in `.env`.
5. **GitHub:** create the repo `ronkenx9/meter`, or approve me creating it with `gh`.
6. **Confirm** the exact Nov 13 cut-off time and the Discord or Slack links from your acceptance email.
7. **Submit** the HackerEarth form on Nov 12. Posting and submitting are yours.

## 10. Risks

| Risk | Mitigation |
|---|---|
| New sandbox business has online Payments off: every intent create returns `configuration_error`, and no payment methods are listed (seen Nov 1) | Owner activates Payments and Cards in the sandbox web app; if that can't be self-served, email devhelp@airwallex.com the same day |
| Increment on a sandbox pre-auth behaves differently from the docs | Probe it on day 1; email devhelp the same day if it fails; fallback is a larger initial hold and showing the agent refusing to exceed it |
| Clearing throughput (~1 payment per 3 s per wallet) makes the demo slow | Paragraph-sized steps; a job of about 25–40 payments runs in about 2 minutes; three jobs in parallel; the video speeds up the middle with an on-screen clock |
| 10–20 minute withdraw finality | Dashboard countdown; the video cuts across it; a later run shows the claim |
| Metal testnet or faucet outage | Keep extra funded keys; run `readyz` checks in the dashboard; record a full live run early (day 9) |
| Airwallex rate limits (10 per endpoint per second) | One shared token, a serialized intent queue, 429 backoff |
| Unpublished rubric | Hit all five guide beats explicitly, with the decision and proof on screen at all times |

## Sources

- Builder guide: https://airwallexdev.com/guide (markdown: https://airwallexdev.com/agentic-banking-builder-guide.md)
- Hackathon page: https://airwallex.hackerearth.com/
- Metal clearing: https://docs.metalntwx.com/agents/clearing, facilitator: https://docs.metalntwx.com/agents/facilitator, testnet: https://docs.metalntwx.com/start/connect-to-testnet, index: https://docs.metalntwx.com/llms.txt
- Airwallex payment intents: https://www.airwallex.com/docs/api/payments/payment_intents/increment_authorization
- Competitors: https://github.com/ScottVentures/Scott-IS-Agent, https://github.com/big14way/quartermaster
