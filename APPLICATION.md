# METER: Airwallex Agentic Banking Hackathon application

Deadline: 2026-10-23 18:29 UTC (11:59 PM IST). The form fields were not visible without logging in, so each section below stands alone. Paste whichever ones the form asks for. Where a field is short, use the one-liner or the 50-word version.

---

## Project name
METER

## One-liner
AI jobs that run on a bar tab: a card hold up front, a fraction of a cent per streamed chunk through Metal clearing, and one exact capture through Airwallex when the job closes.

## Track / prizes
- Starter kit: 12, Inference Sourcing Agent (Agentic Commerce)
- Prize targets: Metal Award, Judges' Choice

## 50-word version
METER is an inference sourcing agent for an AI service. Each customer's job opens a tab: an Airwallex card pre-authorization. The agent buys every model call, search and lookup from the provider whose live x402 price fits what's left, paying per chunk via Metal clearing. It captures exactly what was spent.

---

## Problem
AI products buy inference from several providers whose prices and speeds change by the minute. They sell to customers who want a fixed budget. Today the operator absorbs the mismatch:
- They prepay providers in large blocks and guess which provider to use.
- They charge customers a flat fee and hope jobs don't overrun.
- They can't pay a provider per chunk of output, because a card or bank transaction costs more than the chunk does.

So an overrunning job either quietly burns margin or gets killed. And when a cheap provider slows down, nobody switches mid-job.

## Solution
METER connects the customer's money and the providers' prices inside one control loop.

1. **Open the tab.** Each customer approves a budget, and METER places a card pre-authorization for it through Airwallex (`authorization_type: pre_auth`, `auto_capture: false`).
2. **Fund the job.** METER deposits that job's share of the operator's *USDZ float into Metal clearing.
3. **Buy per step, at the live price.** Every model call, web search and data lookup goes to whichever provider's current x402 offer fits the job's remaining budget. METER pays with a clearing payment that signs the job's running total. It reads the price from every 402 response and never caches it.
4. **React when things change.** Midway, one job's prompt runs to 4x its token budget and the cheapest model provider slows under load. The agent decides:
   - which jobs move to another provider,
   - which jobs get the float that's left,
   - which customer is asked to raise their hold.
   If that customer approves, METER increments the authorization before topping up the deposit.
5. **Close the tab.** METER reads the clearing position, captures exactly that amount once on the card, cancels or releases the rest, and withdraws unused deposits when the epoch closes. A failed job still gets its hold captured or cancelled.

**Who decides what:**
- **Code holds the money rules:** price lists, budgets, the float floor, the hold ceiling, idempotency and the single-capture rule.
- **The model makes judgment calls:** which answers are worth paying a more expensive provider for, and how to explain to the customer why their job needs a bigger hold.

## Why this needs Airwallex and Metal
- **Without Metal clearing, the product doesn't exist.** Per-chunk payments are only possible because the payer deposits once and signs a running total, and the operator nets and settles each epoch. Any other rail costs more per payment than the chunk is worth.
- **Without Airwallex, there's no customer side.** The pre-auth, increment, single capture and cancel are what turn a customer's budget into a hard ceiling that the agent can't exceed.
- METER is where the two meet. The card hold must always cover the clearing position, and the capture must equal it exactly.

## What the demo shows (under 5 minutes, key beat in 60 seconds)
1. Three customers submit research jobs, each approving a hold on screen. Three tabs open.
2. The three jobs stream side by side, each with a live meter ticking per chunk and showing which provider is being paid.
3. The shock: job B's prompt balloons to 4x its tokens and the cheapest provider's latency spikes.
4. The agent's revised plan, shown as a decision card:
   - job A switches provider mid-stream,
   - job C is paused to preserve the float floor,
   - customer B is asked to raise their hold.
5. Customer B approves. The authorization increments, then the deposit tops up, in that order.
6. The jobs finish. Each card capture matches its clearing position to the cent. Unused holds are released, and deposits are withdrawn at epoch close.
7. Proof panel: Airwallex payment-intent states next to Metal clearing positions and settlement transactions.

## Safety and correctness (the parts judges can try to break)
- **One capture per intent, never above the hold.** The hold is raised before the deposit is topped up, never after.
- **One key, one payment at a time.** After a timeout, METER reads the position before signing again. A timeout counts as unconfirmed, never as failed.
- **The float stays below the sum of the jobs' budgets on purpose,** so the agent really has to ration.
- **Every hold ends captured or cancelled before it lapses,** including holds for failed jobs.
- **Units are converted in one place:** *USDZ is 18-decimal base units; Airwallex uses major units.
- **Per-provider receipts are kept,** because the clearing position is one total per job.
- **Sandbox simulation calls sit behind one interface,** so going live means swapping that adapter.

## Architecture
- **Agent loop:** for each job, a typed state machine (open → running → over_budget → awaiting_hold_raise → closing → captured | cancelled) with explicit budgets and stop conditions. The model sees typed tools only and never gets credentials.
- **Providers:** three x402 endpoints that we run ourselves using `ClearingDebitServerScheme`. They have different prices and latencies, and stream answers chunk by chunk from a real model or from stand-in text.
- **Payments:**
  - Airwallex payment intents (pre-auth, increment_authorization, capture, cancel) with test card 4035501000000008.
  - Metal `@metalntwx/metal-pay` (`depositToClearing`, `ClearingDebitScheme`, `withdrawFromClearing`) and the facilitator's `POST /clearing/position`.
- **Stack:** TypeScript, Node, Postgres for tabs, receipts and the ledger, and a React live dashboard.
- **Verification:** a reconciliation check runs at every tab close: capture == clearing position == sum of provider receipts. Any mismatch blocks the close and escalates to a person.

## Plan for the build window (Oct 25 – Nov 13)
- **Week 1:** Airwallex pre-auth/increment/capture/cancel loop, and Metal clearing deposit/pay/position/withdraw. One job, one provider, end to end, with exact capture.
- **Week 2:** three providers with live 402 pricing, the multi-job scheduler, float rationing, the overrun and slowdown shocks, and the hold-raise approval.
- **Week 3:** live meter dashboard, reconciliation checks, failure paths (timeouts, a lapsed hold, a failed job), the video and the repo README with setup.

**Fallback if time runs short:** two providers with stand-in text and a single job. The core chain of hold → clearing payments → exact capture still ships.

## Honest limits
- Everything runs on the Airwallex sandbox and Metal testnet with test cards and synthetic jobs.
- We run the providers ourselves to stage price changes and slowdowns. Real third-party providers would need to accept Metal clearing.
- The Airwallex sandbox can't receive stablecoins, so the fiat and *USDZ sides are reconciled in our ledger, not through a direct bridge.

## Why me
I've shipped agent payment systems on x402 and agent wallets, plus self-running agent loops with budgets, scoring and verifiers:
- **FLOAT:** a reserve engine that keeps idle agent funds earning while staying ready to pay.
- **STIPEND:** a spend firewall enforced on-chain.
- **TEAMPOT:** payroll and approvals on Tempo.
- **EXHIBIT A:** a chargeback agent.
- **Several hackathon builds** that went from idea to live deploy and a demo video within the event window.

METER builds on the same parts: budgets, stop conditions, idempotent money movement, and a verifier that can say no.

## Team
- Solo builder: Kenn Ronin. GitHub: github.com/ronkenx9. X: @kenn_ronin
- Open to adding a teammate from the Discord for the dashboard or video.

## Links
- Portfolio: [ADD]
- Prior work: [ADD 2–3 repo or demo links, e.g. EXHIBIT A at exhibit-a-pi.vercel.app]
