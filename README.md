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

Every payment passes two locks. The engine checks the price against the job's money before asking. Then the wallet checks the offer it is about to sign: if it names anyone but that provider's own key, or asks more than the quoted price, nothing is signed, the provider is blocked for the rest of the run, and its jobs move to the next cheapest one.

## Proof

Every claim here is checked by a script against a recorded, hash-chained log. `pnpm check:evidence` reruns the offline checks; `pnpm check:chain` also compares the payments with Metal's own settlement records.

| Claim | Evidence | Check |
|---|---|---|
| Full Kit 12 run, decided and written by real Claude: A charged $0.30 (14/14 paragraphs), B raised from $0.75 to $0.90 by the customer on the dashboard and charged $0.88 (40/40), C $0.25 (10/10). Float balanced at $1.50, every capture equal to its wallet. | `research/live-kit12-run.jsonl` | `scripts/check-claude-run.mjs`, `scripts/check-live-evidence.mjs` |
| A second Kit 12 run where the float could not fund a raise: Claude asked for none and said why, moved the two shorter jobs to the faster provider, and all three finished inside their first holds ($0.47, $0.65, $0.32). | `research/live-kit12-no-raise-run.jsonl` | `scripts/check-claude-run.mjs --no-raise` |
| A provider took payment and lost its answer. METER booked it as a paid failure, bought the step again, and charged exactly what was paid. | `research/live-lost-answer-drill.jsonl` | `scripts/check-drills.mjs lost-answer` |
| The server was killed mid-job. Recovery captured exactly what the wallet had paid; running it again changed nothing. | `research/live-crash-recovery-drill.jsonl` | `scripts/check-drills.mjs crash` |
| A provider's offer named another payee. The wallet signed nothing, the provider was blocked, the step was bought from another provider, and the customer was charged $0.11, exactly what was paid. Metal's settlement records show nothing paid to the other key. | `research/live-swapped-payee-drill.jsonl` | `scripts/check-drills.mjs swapped-payee` |
| 10,000 random runs, half planned by a planner proposing nonsense: zero rule violations. | run it: `pnpm check:sim` | `apps/orchestrator/scripts/check-sim.ts` |
| The keyless replay shows what the recordings say: every charge, spend and reserve matches. | run it: `pnpm check:replay` | `apps/orchestrator/scripts/check-replay.ts` |
| Every Airwallex card call Kit 12 needs: hold, raise, one partial capture, refused second and over-hold captures, cancel. | `research/airwallex-probe.json` | `packages/airwallex/scripts/check-probe.ts` |
| The scenario matches the numbers in the official Kit 12 brief, parsed from the guide, not copied. | `scenario/kit12.json` | `scripts/check-scenario.mjs` |

`GATES.md` lists all 17 acceptance gates with the command and expected output for each.

## Run it

You need Node 23.6 or newer and pnpm.

```bash
pnpm install
```

### No keys: see it in five minutes

```bash
pnpm start
```

Open http://localhost:4378. The landing page explains the product and replays a run in place; **Open app** (or http://localhost:4378/app) is the operator's dashboard. There, click **Replay**. It plays back a real run on the Airwallex sandbox and Metal testnet from its hash-chained log, sped up, after checking the log's chain. The picker has four recordings: the Kit 12 run where a customer raises a hold, a Kit 12 run where no raise was needed, and two drills.

Then check the money rules yourself:

```bash
pnpm test          # 105 tests
pnpm check:sim     # 10,000 random runs, about 25 seconds
pnpm check:evidence
```

`check:sim` puts 10,000 random scenarios through the real engine and rules on simulated rails: random holds, float, job sizes and shock timing, with providers that fail after payment, lose answers, reprice and swap their payee. Half the runs are planned by a planner that proposes nonsense on purpose (unknown jobs, grants past the float, raises that go down). After each run it checks that no job spent past its deposits or was funded past its hold, every charge equals what was paid, no payment went to anyone but a provider, no hold was raised without a yes, the float is all accounted for and no hold is left open. It prints the seed of any run that fails. Removing one rule from `packages/policy` makes it fail within a few runs.

### Offline simulation

The same engine and money rules against simulated rails, printed as a story:

```bash
pnpm demo:sim
```

Or open the dashboard and click **Run simulation**:

```bash
pnpm start
```

Then go to http://localhost:4378/app. The offline mode uses the rule planner, not Claude.

### Live

1. Copy `.env.example` to `.env`.
2. **Airwallex:** sign up at [sandbox.airwallex.com](https://sandbox.airwallex.com) and add a business named `New Business Sandbox` (it is approved automatically and has Payments). Put its Client ID and API key in `AWX_CLIENT_ID` and `AWX_API_KEY`.
3. **Metal:** run `pnpm setup:metal`. It creates a testnet operator key, funds it from the public faucet, and buys an RPC endpoint over x402 with that test money, writing both to `.env`. Safe to run again.
4. **Claude:** put an API key in `ANTHROPIC_API_KEY`. Without one, live runs still work, using the rule planner and stand-in text, and the dashboard says so.
5. `pnpm start`, open http://localhost:4378/app, and click **Run live**. Each customer approves their hold at `/approve?job=A` (and `B`, `C`) with Airwallex's test card `4035 5010 0000 0008`, any future expiry and CVC `123`.

A full live run takes about 11 minutes; a payment takes about 7 seconds per wallet on testnet. Unused float is claimable about 15 to 20 minutes after each job's last payment, and the server claims it on its own. Keep the machine awake during a run.

### Break it

The dashboard's **Break it** panel works during a live run:

- **Overrun + slowdown:** fires the Kit 12 shock now.
- **Fail after payment:** the next request is paid and then fails. It still costs its price; METER tries once more.
- **Lose an answer:** the next paid request's connection drops before the answer arrives. METER books it as paid and buys the step again.
- **Reprice over cap:** a provider asks more than METER will pay. Nothing moves.
- **Swap the payee:** the next provider asked names someone else as the payee. The wallet signs nothing, that provider is blocked, and the step is bought elsewhere.

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

- The test customers are played by us: the card holds use Airwallex's test card, and the raise in the recorded run was approved by clicking the dashboard's button.
- Search and lookup have no web access. They are labelled as notes and never present anything as a retrieved result.
- A hold nobody approves is cancelled after 15 minutes. An approval page left open about an hour can fail with "Authentication failed".
- Recovery settles a crashed run; it doesn't resume it.
- Whether a customer is asked to raise a hold depends on the money at that moment. In one recorded Kit 12 run the raise could be funded and was asked for; in another it could not, so it was not asked. Both are in `research/`.
- Metal's testnet has slow stretches. On 2026-11-11 one run met repeated deposit timeouts and a deposit sent with its outcome unknown. METER left that money unaccounted, said the float did not balance, charged every customer exactly what was paid, and stopped the largest job short (`research/live-degraded-testnet-run.jsonl`). The wallet now looks such a deposit up and settles it either way; that fix is unit-tested but has not yet met the same failure live.
- The readout of when unused float becomes claimable is built from Metal's `contextOf` call and has not been seen live yet.
- The landing page's product cards are drawn from the recorded run's figures, not screenshots; the hero is the real app.
