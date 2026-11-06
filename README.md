# METER

An AI research service that buys every step of a report from paid providers, rations a short float between several customers' jobs, and never charges anyone past the hold they approved on their card.

Built for the Airwallex Agentic Banking Hackathon, **Kit 12: Inference Sourcing Agent**. Customer holds run on the Airwallex sandbox; every provider request is paid on Metal testnet through clearing; Claude decides where the money goes and writes the reports.

## What happens in a run

1. Three customers approve card holds of $1.00, $0.75 and $0.75 on a hosted Airwallex page, as pre-authorizations.
2. METER deposits part of its 1.50 *USDZ float into a fresh clearing wallet per job and keeps the rest in reserve.
3. Each job buys paragraphs, searches and lookups from five providers over x402. The three model tiers are real models: Haiku, Sonnet and Opus at 1, 2 and 5 cents. Claude picks the few paragraphs worth the dear one.
4. Midway, one job's scope grows fourfold and the cheapest provider slows to 6 seconds.
5. Claude (Opus 5.5) reads the whole situation and proposes a plan: who moves provider, who gets the reserve, which customer is asked to raise their hold, and in what words. Code checks every proposal against the money rules before anything moves.
6. When a job ends, METER captures exactly what its wallet paid, once, releases the rest of the hold, and withdraws the unused float.

The rules Claude cannot break, because code enforces them: deposits never pass a job's hold, the reserve never drops below its floor, a hold is raised before any money is spent past it, and the capture equals the wallet's own record of payments. Claude holds no keys and never sees card data.

## Proof

Every claim here is checked by a script against a recorded, hash-chained log. `pnpm check:evidence` reruns the offline checks; `pnpm check:chain` also compares the payments with Metal's own settlement records.

| Claim | Evidence | Check |
|---|---|---|
| Full Kit 12 run, decided and written by real Claude: A charged $0.31 (14/14 paragraphs), B raised from $0.75 to $0.91 by the customer and charged $0.88 (40/40), C $0.25 (10/10). Float balanced at $1.50, every capture equal to its wallet. | `research/live-kit12-run.jsonl` | `scripts/check-claude-run.mjs`, `scripts/check-live-evidence.mjs` |
| A provider took payment and lost its answer. METER booked it as a paid failure, bought the step again, and charged exactly what was paid. | `research/live-lost-answer-drill.jsonl` | `scripts/check-drills.mjs lost-answer` |
| The server was killed mid-job. Recovery captured exactly what the wallet had paid; running it again changed nothing. | `research/live-crash-recovery-drill.jsonl` | `scripts/check-drills.mjs crash` |
| Every Airwallex card call Kit 12 needs: hold, raise, one partial capture, refused second and over-hold captures, cancel. | `research/airwallex-probe.json` | `packages/airwallex/scripts/check-probe.ts` |
| The scenario matches the numbers in the official Kit 12 brief, parsed from the guide, not copied. | `scenario/kit12.json` | `scripts/check-scenario.mjs` |

`GATES.md` lists all 13 acceptance gates with the command and expected output for each.

## Run it

You need Node 23.6 or newer and pnpm.

```bash
pnpm install
```

### Offline, no keys

The same engine and money rules against simulated rails, printed as a story:

```bash
pnpm demo:sim
```

Or open the dashboard and click **Run simulation**:

```bash
pnpm start
```

Then go to http://localhost:4378. The offline mode uses the rule planner, not Claude.

### Live

1. Copy `.env.example` to `.env`.
2. **Airwallex:** sign up at [sandbox.airwallex.com](https://sandbox.airwallex.com) and add a business named `New Business Sandbox` (it is approved automatically and has Payments). Put its Client ID and API key in `AWX_CLIENT_ID` and `AWX_API_KEY`.
3. **Metal:** run `pnpm setup:metal`. It creates a testnet operator key, funds it from the public faucet, and buys an RPC endpoint over x402 with that test money, writing both to `.env`. Safe to run again.
4. **Claude:** put an API key in `ANTHROPIC_API_KEY`. Without one, live runs still work, using the rule planner and stand-in text, and the dashboard says so.
5. `pnpm start`, open http://localhost:4378, and click **Run live**. Each customer approves their hold at `/approve?job=A` (and `B`, `C`) with Airwallex's test card `4035 5010 0000 0008`, any future expiry and CVC `123`.

A full live run takes about 11 minutes; a payment takes about 7 seconds per wallet on testnet. Unused float is claimable about 15 to 20 minutes after each job's last payment, and the server claims it on its own. Keep the machine awake during a run.

### Break it

The dashboard's **Break it** panel works during a live run:

- **Overrun + slowdown:** fires the Kit 12 shock now.
- **Fail after payment:** the next request is paid and then fails. It still costs its price; METER tries once more.
- **Lose an answer:** the next paid request's connection drops before the answer arrives. METER books it as paid and buys the step again.
- **Reprice over cap:** a provider asks more than METER will pay. Nothing moves.

If the server dies mid-run, settle the run from its log and the wallets' own records:

```bash
pnpm recover runs/<run id>.sqlite
```

## Layout

| Path | What it is |
|---|---|
| `packages/core` | Money units (card cents, *USDZ millionths) and the scenario loader |
| `packages/policy` | The money rules every proposal passes through |
| `packages/ledger` | The hash-chained event log |
| `packages/airwallex` | Card holds: create, confirm on the hosted page, raise, capture, cancel |
| `packages/metal` | A clearing wallet per job: deposit, pay over x402, withdraw |
| `packages/ai` | The one place METER calls Claude |
| `apps/providers` | The five providers, each selling over x402 with its own clearing key |
| `apps/orchestrator` | The engine, Claude planner, rule planner, dashboard, approval page and recovery |

## Known limits

- The recorded run's report text predates the writer being told each paragraph's position, so B's paragraph 20 opens "In closing". New runs carry the fix.
- In the recorded run, the customer's raise was approved by a script acting as the test customer, through the same endpoint the dashboard's button uses.
- Search and lookup have no web access. They are labelled as notes and never present anything as a retrieved result.
- A hold nobody approves is cancelled after 15 minutes. An approval page left open about an hour can fail with "Authentication failed".
- Recovery settles a crashed run; it doesn't resume it.
