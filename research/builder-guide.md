# Building on Airwallex

Use this guide to choose an agentic banking idea, connect to Airwallex’s sandbox, and build a working demo. Choose from twelve starter kits across treasury and payments operations, expense policy, multi-tenant platforms, lending, revenue protection, agentic commerce, and Metal testnet, or adapt one to your own idea.

For each kit, decide what the agent should do when the balance, deadline, evidence, or risk changes. Review the relevant endpoints and implementation details here, then, for kits 1 through 8, use the docs MCP server or [API reference](https://www.airwallex.com/docs/api/introduction) for exact payload fields. For kits 1 through 8, build with synthetic data and replace the sample amounts and rates with values that fit your demo.

Contents: [Where to start](#where-to-start) | [Get running](#get-running) | [Build around a financial decision](#build-around-a-financial-decision) | [The starter kits](#the-starter-kits) | [Working with the API](#working-with-the-api) | [Platform setup](#platform-setup-connected-accounts) | [Sandbox constraints](#sandbox-constraints) | [Documentation and support](#documentation-and-support)

## Where to start

Six use cases, twelve starter kits. Take one as written, change it, or apply the criteria in [Build around a financial decision](#build-around-a-financial-decision) to your own idea.

**Treasury & Ops**

| \# | Starter kit | What you build | Before you start |
| :---- | :---- | :---- | :---- |
| 1 | [Adaptive Treasury Controller](#1-adaptive-treasury-controller) | Decide which obligations to fund, convert, defer, or escalate when cash is short. | Fund a wallet |
| 3 | [Payment Ops Incident Commander](#3-payment-ops-incident-commander) | Resolve a delayed supplier transfer without paying twice. | Fund a wallet |

Cash placement and reconciliation are Treasury & Ops jobs too, and we have not written kits for them. Good territory if you want a problem few other builders will take on.

**Expense & Policy**

| \# | Starter kit | What you build | Before you start |
| :---- | :---- | :---- | :---- |
| 2 | [Intent-Bound Purchase Agent](#2-intent-bound-purchase-agent) | Choose monthly or annual SaaS terms, then enforce the choice with virtual-card controls. | Fund a wallet |

**Multi-Tenant Platforms**

| \# | Starter kit | What you build | Before you start |
| :---- | :---- | :---- | :---- |
| 5 | [Platform Spend Controller](#5-platform-spend-controller) | Issue cards to connected accounts and ration bridge funding when customer deposits arrive late. | Request platform access |
| 6 | [Multi-Employer Payroll Executor](#6-multi-employer-payroll-executor) | Run payroll across three connected accounts without using one employer’s funds for another. | Request platform access; three accounts |
| 8 | [Marketplace Settlement Agent](#8-marketplace-settlement-agent) | Set seller reserves, pay net proceeds, and revise one reserve when risk changes. | Request platform access |

**Dynamic Lending**

| \# | Starter kit | What you build | Before you start |
| :---- | :---- | :---- | :---- |
| 7 | [Portfolio Lending Agent](#7-portfolio-lending-agent) | Collect repayments and size a new revenue-based advance without breaching a reserve floor. | Request platform access |

**Revenue Protection**

| \# | Starter kit | What you build | Before you start |
| :---- | :---- | :---- | :---- |
| 4 | [Dispute Response Agent](#4-dispute-response-agent) | Accept, challenge, or escalate chargebacks based on evidence and cost. | None |

**Agentic Commerce**

| \# | Starter kit | What you build | Before you start |
| :---- | :---- | :---- | :---- |
| 9 | [Approval-Bound Shopping Agent](#9-approval-bound-shopping-agent) | Complete a real merchant checkout. The shopper approves the product, merchant, and total on screen. If those change, ask again. Then read the payment result back. | Allowlisted [Airi CLI](https://github.com/airwallex/airi-cli) access |
| 10 | [Merchant-Enabled Agentic Checkout](#10-merchant-enabled-agentic-checkout) | Let shoppers find a sandbox merchant's products through Claude, pay with a test card, and receive a merchant order number. | Request merchant-side Agentic Commerce access. Catalogue upload and the merchant MCP connection are in the [Merchant Onboarding API](/agentic-commerce/). |
| 11 | [x402 Business Agents](#11-x402-business-agents) | Rebalance your agents' spending limits when an upstream price rises, and settle a dispute from signed orders. | Fund a wallet; Metal testnet key and RPC endpoint |
| 12 | [Inference Sourcing Agent](#12-inference-sourcing-agent) | Re-route AI jobs between paid providers and ration a short float without charging past any hold. | Metal testnet key and RPC endpoint |

**Before you start**

Kits 1 through 4 need no extra enablement. They use only the sandbox. Pick kit 2 or 4 if you want to call the API before funding a wallet.

Kits 5, 6, 7, and 8 need connected accounts and platform payments on your sandbox account. Ask Airwallex to enable them. You cannot switch those on yourself. In those kits you act as the platform and operate accounts for your own customers. These kits also use only the sandbox.

Kit 9 needs [Airi CLI](https://github.com/airwallex/airi-cli). Airi CLI is in public beta, and access is still allowlisted. Create and manage your Airi account at [app.airi.com](https://app.airi.com/), then email [devhelp@airwallex.com](mailto:devhelp@airwallex.com) with that account's email address and allow time for access before you plan the build. Participants receive an Airwallex-issued card. You place real orders at merchants of your choice.

Kit 10 needs merchant-side Agentic Commerce access. Sign up for the sandbox first (step 1 under [Get running](#get-running)), then email [devhelp@airwallex.com](mailto:devhelp@airwallex.com) to ask Airwallex how to enable merchant-side Agentic Commerce and to request the sample catalog format, the merchant-specific MCP connection details, and the test-checkout instructions. Allow time for a reply before you plan the build. Use synthetic products and a test card. Do not use Airi CLI or buy from a real merchant for this kit.

Kits 11 and 12 need no extra enablement on Airwallex. Both kits use the Airwallex sandbox, set up as in [Get running](#get-running), and Metal testnet, which is self-serve: you need an RPC endpoint of your own and a funded testnet key. Metal's agent guides cover both: sign in to the [Metal console](https://console-testnet.metalntwx.com/) with the email you registered with, and open them from its API Docs link. Both kits pay in \*USDZ, the dollar token on Metal testnet, which also pays gas; fund it from the [public faucet](https://faucet.metalntwx.com/) in those guides or from the console's Faucet page.

## Get running

Use this section for kits 1 through 8, and for the Airwallex side of kits 11 and 12. For a guided version of these setup steps, use [airwallexdev.com](https://airwallexdev.com).

**1\. Sign up** at [sandbox.airwallex.com](https://sandbox.airwallex.com). A personal email is fine, but use one you can read because team invitations arrive by email. Your Client ID and API key are under **Account \> Developer \> API keys**.

If you add a second business in the web app, use `New Business Sandbox` or `Sandbox Business`. Airwallex automatically approves sandbox onboarding and KYB for those names; other names remain In review.

**2\. Connect your agent** to Airwallex’s hosted MCP servers. Add the docs server first, since it needs no account.

```sh
# Claude Code
claude mcp add-json airwallex-docs '{ "type": "http", "url": "https://mcp.sandbox.airwallex.com/docs" }'
claude mcp add-json airwallex-dev '{ "type": "http", "url": "https://mcp.sandbox.airwallex.com/developer" }'
```

For Cursor, Codex, Gemini CLI, and Windsurf, follow the client-specific setup at [airwallexdev.com](https://airwallexdev.com) and use the same two server URLs. If you cannot authenticate to the developer server, keep the docs server and call REST directly.

**3\. Verify.** Ask your agent to list your Global Accounts. If it returns an empty list, authentication worked and your account has no Global Accounts.

**4\. Learn four conventions before your first API call.**

- **The main API base URL is `https://api.sandbox.airwallex.com`, and its paths start with `/api/v1`.** Add that prefix to the endpoints listed in each kit. For example, call `POST /transfers/create` at `POST https://api.sandbox.airwallex.com/api/v1/transfers/create`. Send evidence uploads in kit 4 to `files.sandbox.airwallex.com` instead.
- **Authenticate with `POST /api/v1/authentication/login`**, sending `x-client-id` and `x-api-key` as headers and no body. You get back a 30-minute bearer token. Send it on authenticated API calls as `Authorization: Bearer <token>`.
- **Amounts are in major units, not cents.** `100` is one hundred dollars. If you send `5000` for fifty dollars, you move five thousand.
- **Generate a UUID when an endpoint requires `request_id`.** Reuse it only when retrying the same operation, and generate a new one for each new operation. If you reuse an id for a different operation within 7 days, Airwallex returns `duplicate_request_id` and does not process the new request.

Set your sandbox credentials in the shell, then call the login endpoint. Copy the bearer token from the response, and do not commit either credential.

```sh
export AWX_CLIENT_ID="<sandbox-client-id>"
export AWX_API_KEY="<sandbox-api-key>"

curl -X POST https://api.sandbox.airwallex.com/api/v1/authentication/login \
 -H "x-client-id: $AWX_CLIENT_ID" \
 -H "x-api-key: $AWX_API_KEY"
```

Call REST with the HTTP client you already use, or let the developer MCP server assemble the payloads.

**5\. Fund your sandbox.** Note that your Wallet will be credited with funds in each currency to facilitate test transactions. List your Global Accounts first and reuse one with local USD account details. Create one only if the list is empty, then simulate a deposit into it.

```http
GET /api/v1/global_accounts

# Only if the account has no suitable Global Account
POST /api/v1/global_accounts/create
 { "request_id": "<uuid>", "country_code": "US",
 "required_features": [{ "currency": "USD", "transfer_method": "LOCAL" }] }

POST /api/v1/simulation/deposit/create
 { "global_account_id": "<existing or new id>", "amount": 25000, "payer_name": "Seed funding" }
```

Although the deposit response says PENDING, the balance appears immediately, so deposit enough to cover your demo. `country_code` refers to the country of the account rather than its currency; for EUR, use `NL`, `FR`, `DE` or another euro member. The deposit lands in the selected Global Account's currency, so read the Global Account first and pick one in the currency you intend to fund. `payer_name` is optional, and the request takes no `currency` field; if you send one, Airwallex discards it without an error. If you need another currency, fund the account in USD and convert.

**6\. Give your agent context once.** Paste this at the start of a session for kits 1 through 8, and for the Airwallex calls in kits 11 and 12.

```text
You’re building with Airwallex sandbox APIs: payments, treasury, spend,
cards, FX, and multi-currency wallets. Use only sandbox data.

MCP servers, if connected:
 Docs (no login): https://mcp.sandbox.airwallex.com/docs
 Developer (sandbox login): https://mcp.sandbox.airwallex.com/developer

Amounts are major units, not cents. When a call requires request_id,
reuse the UUID only for a retry of the same operation.

First task: list global accounts. If none, create one and simulate a
deposit. Then list balances. If you can’t, tell me what’s missing:
docs MCP, developer MCP, sandbox login, or a global account.
```

If setup fails, stop before you build on top of it. Check whether the business is In review because of its name, the API key has the required scopes, the developer MCP login completed, and a funded Global Account exists.

## Build around a financial decision

Choose a finance task that someone repeats and identify the decision inside it. The agent should choose differently when a balance, deadline, piece of evidence, or risk changes. Let the agent move money or update financial state, and state which actions require a person’s approval.

In the demo, show the user’s goal, the agent’s initial plan, the new information, the revised decision, and the resulting balance, payment, or status. Keep amounts, limits, reserves, validation, duplicate protection, and state transitions in code. Use the model to read unstructured text, compare evidence, propose a plan, and explain an exception. Give the model typed tools rather than unrestricted credentials, and bind each approval to the amount, currency, counterparty, purchase terms, and evidence shown to the approver.

Put sandbox-only simulation calls behind one interface so you can replace them without rewriting the decision logic. Finish the demo with a financial action or an escalation to a person. If the agent should make the same choice every time, write the rule in code instead of asking a model to narrate it.

## The starter kits

For kits 1 through 8, use the endpoint lists to identify calls, then ask the [docs MCP server](#documentation-and-support) for exact fields. Before you build, review [Working with the API](#working-with-the-api) and [Sandbox constraints](#sandbox-constraints). Kits 11 and 12 take field-level Metal detail from the linked Metal agent guides, and Airwallex field detail from the docs MCP or the kit 1 and kit 4 sections they cite.

### 1. Adaptive Treasury Controller

Build for a founder or treasury lead who cannot fund everything due at once. Five obligations across three currencies fall due over 72 hours, and you can pay only part of them from available cash after preserving a reserve floor. The agent funds the shipping invoice whose non-payment would stop operations, converts the minimum for a time-sensitive supplier, defers the cheapest obligation, and escalates a policy exception. After a deposit arrives, the agent recalculates only the decisions affected by the new balance.

Tie the agent’s execution limit to forecast confidence by allowing a larger autonomous conversion when bank and invoice data support the receipt forecast. If a customer email contradicts that forecast, lower the limit and require a person to approve the same conversion. Keep those thresholds in policy code rather than prompts.

**The flow:** read balances and obligations, plan in code, lower forecast confidence for one receipt, simulate the deposit, recalculate, then execute one FX conversion and one supplier transfer and confirm the remaining reserve.

**Endpoints:** `GET /balances/current`, `GET /fx/rates/current`, `POST /fx/quotes/create`, `POST /fx/conversions/create`, `POST /beneficiaries/schema`, `POST /beneficiaries/create`, `POST /transfers/create`, `POST /simulation/deposit/create`, `POST /simulation/transfers/{id}/transition`.

**Watch out for:**

- Include the flat EUR 12.85 fee for each SWIFT payout in the conversion amount. LOCAL payouts have no fee.
- Leave `x-api-version` off FX calls.
- Treat every FX quote as single-use: book it once with one request ID, and get a fresh quote if you need to convert again.
- Book the conversion over REST because no MCP tool exists for that call.

### 2. Intent-Bound Purchase Agent

Build for a founder or procurement operator weighing a SaaS purchase. Paying annually costs 18 percent less but pushes cash below the minimum reserve in week seven. Paying monthly costs more but keeps the cash available and preserves the option to cancel. The agent chooses monthly, records when to reconsider, and creates a virtual card whose spending controls enforce that choice.

Enforce spending policy with card controls rather than a prompt, since only the controls can block an authorization. Let the model read the terms, then calculate the cash effects, apply policy and build the card payload in code.

**The flow:** create a cardholder and a card with limits, a currency allowlist and merchant categories, then simulate authorizations that pass and fail, and show the decline reason matching the policy.

**Endpoints:** `POST /issuing/cardholders/create`, `POST /issuing/cards/create`, `GET /issuing/cards/{card_id}/limits`, `POST /issuing/cards/{id}/update` to freeze, `POST /simulation/issuing/create`, then `/simulation/issuing/{transaction_id}/capture`, `/simulation/issuing/{transaction_id}/reverse` and `/simulation/issuing/refund`, and `GET /issuing/transactions`.

**Watch out for:**

- Do not wait for a status called APPROVED. A cleared transaction can remain PENDING longer than your demo, and REST and MCP use different status names. In the demo, treat `transaction_type: CLEARING` as accepted and use `failure_reason` for a decline. Keep the REST and MCP state mappings separate.
- Per-transaction limits are inclusive. An amount equal to the limit clears and then reaches the funding check.
- Keep separate state machines for cards and transfers. A declined card transaction ends in FAILED, while a failed transfer ends in CANCELLED.
- Use MCP to create a cardholder on your own account. The field is `cardholder_type` on MCP and `type` on REST.

### 3. Payment Ops Incident Commander

Your company sent a supplier transfer through Airwallex days ago. The supplier says its deadline has passed and nothing arrived, but nobody can confirm whether the transfer will still clear. The agent decides whether to wait, replace or escalate, and code enforces finality, idempotency and duplicate locks so it cannot pay twice.

Know the state machine before you design around it. When a transfer does not complete, Airwallex sets its status to CANCELLED rather than FAILED, but CANCELLED does not mean a person cancelled it. Airwallex also returns a failure type such as a bank return or recall, which you can use to decide what happens next.

**The flow:** send a transfer, leave it in an intermediate state, fail it with a chosen failure type, then have the agent decide and issue a replacement under a duplicate lock.

**Endpoints:** `POST /beneficiaries/schema`, `POST /beneficiaries/create`, `POST /transfers/create`, `POST /simulation/transfers/{id}/transition`, `GET /transfers`.

**Watch out for:**

- Simulate SENT before PAID. A chosen `failure_type` applies only after the transfer reaches SENT.
- Prefer a `FAILED` transition with a failure type over a bare cancellation, which returns only `failure_reason: "simulation"`.
- Give the original and replacement transfers different `request_id` values, even when the beneficiary and amount match.
- Budget for two SWIFT fees if both transfers use SWIFT. If you fund the wallet for one payment, the replacement can fail on insufficient funds.
- Do not close the incident only because the replacement reaches PAID. Record what happened to the original transfer as well.

### 4. Dispute Response Agent

Build for a finance ops lead at an online merchant who has to work through a chargeback queue. Each case has a deadline, a disputed amount and order evidence. The merchant pays a chargeback fee even after winning, so defending a small dispute can cost more than accepting it.

Use three cases with different evidence and economics. Challenge a large fraud claim when the device fingerprint and IP match three prior undisputed orders and the customer signed for delivery. Accept and refund a small not-received claim when the delivery scan has no signature and the dispute fee exceeds the amount at risk. Escalate a credit-not-processed case when the customer emailed support twice and received no reply. Then have the issuing bank reject the evidence on the challenged case.

**The flow:** create and confirm three payment intents with the test card, stage disputes on them, read amounts and reason codes, decide per case, accept the small one, challenge the strong one with evidence, then handle the rejection.

**Endpoints:** `POST /pa/payment_intents/create` and `POST /pa/payment_intents/{id}/confirm` to create payments, `POST /simulation/pa/payment_disputes/create`, `GET /pa/payment_disputes`, `POST /files/upload` on `files.sandbox.airwallex.com`, `POST /pa/payment_disputes/{id}/accept`, `POST /pa/payment_disputes/{id}/challenge`, then `POST /simulation/pa/payment_disputes/{id}/escalate` and `POST /simulation/pa/payment_disputes/{id}/resolve`, and `GET /pa/refunds`.

**Watch out for:**

- Use REST for challenge and accept calls. The challenge tool lacks required fields.
- Configure the dispute fee in your application because the sandbox does not deduct it. Use the typed accept and challenge reasons to record the decision; the accept enum includes a low-value reason.
- Create the challenged case at `RFI`. Challenge it, then call the escalation simulator to move it to `CHARGEBACK`, where it lands back in `REQUIRES_RESPONSE` for the rejection beat. Escalating from `CHARGEBACK` fails with `validation_error | Dispute transition is not supported`. Create the accept and escalate cases at `RFI` or `CHARGEBACK`. `PRE_CHARGEBACK` auto-accepts in the same second. Use Visa reason codes `10.4`, `13.1` or `13.6`.
- Upload evidence to the file host as JPG or PDF. Airwallex rejects PNG.
- Use test card `4035501000000008` with any future expiry and CVC when you create the payment intents.

### 5. Platform Spend Controller

You are the platform issuing corporate cards to small businesses. Each customer is a connected account with its own wallet that the customer funds. When a customer funds that wallet on time, card spend draws from the customer’s balance and you do not move your own money.

When a customer’s deposit arrives late, you have to decide whether to cover a payment due today. You can advance the shortfall from your own wallet and collect it back when their deposit lands. You hold far less bridge capital than your customers collectively need, so you have to choose who to bridge when capital is scarce. Set a reserve floor that can constrain the advance. If it never binds, the agent never has to ration capital.

**The flow:** create and activate three connected accounts, fund each customer wallet, issue cards on their behalf, simulate spend including a decline, then bridge one shortfall and collect a monthly fee.

**Endpoints:** [connected account setup](#platform-setup-connected-accounts), then `POST /global_accounts/create` and `POST /simulation/deposit/create` per customer, `POST /issuing/cardholders/create` and `POST /issuing/cards/create` with `x-on-behalf-of`, `POST /simulation/issuing/create`, `GET /balances/current`, `POST /connected_account_transfers/create` to bridge and `POST /charges/create` to collect the fee.

**Watch out for:**

- Fund the customer wallet enough to reach the card-limit check. Otherwise Airwallex returns insufficient funds first.
- Send `x-on-behalf-of` on the card simulation. Always send a unique request ID on transfer creation, and treat any non-success response as ambiguous: query the transfer list for your request ID before retrying, so a retry can never create a second transfer.
- Create customer cards over REST because MCP authenticates as the platform and cannot send `x-on-behalf-of`.

### 6. Multi-Employer Payroll Executor

You are the platform running weekly contractor payroll for small companies with international teams, with each employer represented by a connected account. For every employer, calculate payroll including fees, convert currencies, create contractor beneficiaries, send payouts and collect your fee.

Then one employer comes up short. Their wallet does not cover the converted payroll plus the fee, both contractors expect to be paid today, and another employer’s deposit arrives mid-run into a different wallet. The deposit leaves the short employer’s balance unchanged. Your policy should not use one employer’s funds to cover another employer’s payroll, even though the platform can execute that transfer when you provide the source account’s authorization. If the agent sums balances across tenants, it will report enough money for a batch the short employer cannot fund.

**The flow:** activate three employers, fund two, price each payroll including fees, convert on behalf of each employer, create contractor beneficiaries, pay, then handle the shortfall and collect fees.

**Endpoints:** [connected account setup](#platform-setup-connected-accounts), then per employer `POST /global_accounts/create`, `POST /simulation/deposit/create`, `POST /beneficiaries/validate`, `POST /beneficiaries/create`, `POST /fx/quotes/create`, `POST /fx/conversions/create`, `POST /transfers/create` and `POST /simulation/transfers/{id}/transition`, all with `x-on-behalf-of`, then `POST /charges/create` for the fee.

**Watch out for:**

- Calculate SWIFT fees before converting. If you convert only the payroll total, the last contractor's payout fails on insufficient funds.
- Set the transfer method for each contractor explicitly rather than inferring it from the absence of a fee.
- Send `x-on-behalf-of` on every employer FX call. Include the header with the connected account's ID on every conversion and simulation call; without it the call targets your platform wallet, not the connected account. Confirm the landing account as described in [Booking an FX conversion](#booking-an-fx-conversion).
- Use the simulation call to move each transfer to a terminal status. Transfers created on a customer’s behalf otherwise remain in PROCESSING.
- Activate all three employer accounts before calling FX, then allow a few minutes for the configuration to become available.

### 7. Portfolio Lending Agent

You are the platform disbursing revenue-based advances, with each borrower represented by a connected account. You pay advances into borrower wallets, borrowers receive revenue into those wallets, and you collect weekly repayments as a share of that week’s revenue.

Two borrowers are mid-term with different repayment rates and remaining balances, while a third has passed underwriting and is waiting for money. Because the full third advance would breach the portfolio reserve floor, the agent must choose whether to disburse part of it, delay it or reallocate capital. If a borrower repays less than expected, the agent makes that choice again with less cash available.

**The flow:** activate borrowers, fund wallets, collect the week’s repayments scaled to revenue, then decide and execute a disbursement that respects the floor, and reconcile the portfolio afterwards.

**Endpoints:** [connected account setup](#platform-setup-connected-accounts), then `POST /global_accounts/create` and `POST /simulation/deposit/create` to stage borrower revenue, `GET /balances/current`, `POST /charges/create` to collect repayments, `POST /connected_account_transfers/create` to disburse, and `POST /platform_reports/create` for the portfolio snapshot.

**Watch out for:**

- Set the reserve floor high enough to constrain the disbursement. Otherwise the agent never has to choose between funding and waiting.
- Check the borrower’s balance before collecting a repayment. If the balance is short, record a receivable instead of sending a charge that will fail.
- Send `type: "BALANCE_REPORT"` for the portfolio snapshot and omit date filters. Download the report within 60 seconds after the link appears.

### 8. Marketplace Settlement Agent

You operate a marketplace where buyers pay you and sellers hold connected accounts. In each cycle you settle what every seller earned, but you remain liable for refunds after payout, so you retain a reserve against each seller’s refund risk. The seller receives less cash whenever you increase that reserve.

The platform balance equals what the three sellers are owed, with no extra cash. Set each reserve from the seller’s trailing refund rate and assign the highest reserve to the newest seller. Then you learn of a carrier failure at one seller before their payout runs. Dozens of orders are undelivered, refund requests have started and that seller’s exposure exceeds the model estimate.

**The flow:** activate three sellers, fund the platform wallet, compute per-seller reserves, pay out the net, then recompute one seller’s exposure on the new evidence and recover a refund shortfall.

**Endpoints:** [connected account setup](#platform-setup-connected-accounts), then `POST /simulation/deposit/create` to fund the platform wallet, `GET /balances/current`, `POST /connected_account_transfers/create` to pay out and release reserve, `POST /charges/create` to recover a shortfall, and `POST /platform_reports/create` for the reconciliation.

**Watch out for:**

- Track reserves in your own ledger because Airwallex does not provide an escrow or held-balance object for this flow.
- Reconcile each cycle. Payouts, refunds and released reserve must equal what each seller was owed, while the platform’s remaining balance must equal unreleased reserves.
- Check the seller wallet before recovering a shortfall. The charge fails if the balance is short.
- Recalculate only the affected seller’s reserve when new evidence arrives.

### 9. Approval-Bound Shopping Agent

Build for a shopper who wants an agent to complete a purchase from product search through order confirmation. The shopper gives the agent a need, a budget, merchant constraints, and delivery requirements. The agent works against real merchant sites through browser automation. Your agent reads pages, compares current prices, availability, and delivery choices, builds a cart, fills the checkout forms, and completes the checkout. It requests approval for the exact product, merchant, fulfillment choice, and final total shown to the shopper. Airi CLI does not run the checkout. After the shopper authorizes payment, your agent calls Airi CLI to select the payment method, create the payment mandate (the shopper’s approved authorization for the purchase), and retrieve the one-time payment credentials it uses at checkout. [Airi CLI](https://github.com/airwallex/airi-cli) is in public beta, and access is still allowlisted.

You can also build on the buyer side or the merchant side. Those are not this kit.

Buyer-side. A price-watch agent that rebooks, or a routine reorder agent. A rebooking agent needs a new approval for each replacement, and it should not cancel the original until the replacement is available. A reorder agent needs approval for every purchase. The agent shops and pays. The merchant does not change its site.

Merchant-side. A WebMCP storefront. The merchant site exposes shopping actions. A browser agent calls those actions. The site calls Airwallex MCP from its own backend for product discovery and checkout, then shows the result on the page. That is not the docs MCP or the developer MCP used in the rest of this guide. Keep merchant and Airwallex credentials on the backend. Do not put them in WebMCP tool parameters or in page JavaScript.

A connector between a merchant and an agent platform is a separate build. It can handle a supported reversal or refund. A WebMCP storefront is not the merchant for your shopping agent. The two builds do not have to belong to the same team.

After approval, real merchants change terms in ways your agent cannot predict: the price may move, an item may go out of stock, the merchant may propose a substitution, or the merchant may require a login or verification step. The approval covers only what the shopper saw: the product, the merchant, and the total. The agent pauses, preserves the shopping state, and shows the new price, item, or substitute. When a change falls outside the approved scope, the agent asks for approval again. It then resumes the same checkout instead of starting over or swapping in a substitute without asking. After checkout, the agent reports the payment result back to Airi CLI. Before any retry, the application checks the prior attempt.

**The flow:** The agent captures the shopper's intent and budget, reads the merchant's catalog through browser automation, builds the cart, and requests approval for the displayed total. It pauses for approval again when anything falls outside the approved terms. It drives the merchant checkout, calls Airi CLI for the payment credentials and the payment mandate after the shopper authorizes payment, then reports the payment result back to Airi CLI.

**Endpoints:** [Airi CLI](https://github.com/airwallex/airi-cli) is in public beta, and access is still allowlisted. Install and authenticate from that repo once your access is approved. Create and manage your Airi account at [app.airi.com](https://app.airi.com/); product information is coming to [airi.com](https://airi.com). Email [devhelp@airwallex.com](mailto:devhelp@airwallex.com) with the email address on your Airi account to ask for access.

**Watch out for:**

- You place real orders at any merchant that accepts card payment. Participants receive an Airwallex-issued card. If the merchant allows refunds, you can choose to refund a purchase to stretch the budget.
- You can hand merchant verification steps to the shopper or handle them in another way your build supports. Do not bypass a merchant's security controls.
- Bind each approval to the product, merchant, amount, fulfillment choice, and terms shown to the shopper. One approval is not unlimited permission. Ask again when any of those details fall outside what the shopper approved.
- Treat a timeout, a populated form, or a submitted request as unconfirmed. Report the payment result back to Airi CLI before you retry, or you can charge the shopper twice.
- Keep card data and merchant and payment credentials out of model context and browser-exposed parameters. Store them on a server you control.

### 10. Merchant-Enabled Agentic Checkout

Build for a retail merchant that wants shoppers to find and buy its products through Claude. Create a sandbox storefront and upload at least 100 synthetic products using the format Airwallex provides with access. Configure the merchant-specific MCP endpoint in Claude locally. The agent searches the catalog instead of crawling the merchant's website or using a shopping assistant built by the merchant.

The shopper picks a product from the current matches. Before payment, the agent confirms the merchant, product, quantity, delivery choice, and final total. If the item becomes unavailable or the price or delivery terms change after approval, pause and ask again. Keep the approved terms and checkout reference so the application can check the first attempt before a retry.

**The flow:** request merchant-side access, create the sandbox merchant and storefront, upload at least 100 products, retrieve the merchant MCP endpoint, and connect Claude locally. Ask Claude to search and refine the choice, confirm the checkout terms, then present the payment component or iframe Airwallex specifies. The shopper enters the supplied test card in that component. Complete checkout and return the merchant order number and payment outcome. Demonstrate one changed-price, unavailable-product, or declined-payment path without submitting a duplicate payment. Record a short video of the setup, the Claude configuration, the purchase, the exception, and the order confirmation.

**Endpoints:** Catalogue upload, ingest, product upserts, and the merchant MCP connection are in the [Merchant Onboarding API](/agentic-commerce/). Ask Airwallex for merchant setup and activation, the product-search tool schema, checkout creation and state rules, hosted test-payment instructions, and the completion, order-response, and retry contract. Do not substitute the docs or developer MCP server URLs for the merchant's endpoint.

**Watch out for:**

- Use synthetic catalog and shopper data and sandbox payment details only. Keep live merchant, shopper, and card data out of the build.
- Confirm the merchant, product, quantity, delivery choice, and final total before payment. Ask again when any approved detail changes.
- Collect card details only in the hosted component or iframe Airwallex specifies. Keep raw card data out of Claude's context and application logs.
- If checkout times out or a test payment fails, check the existing checkout and payment outcome before retrying. Follow the idempotency rules Airwallex supplies. If you cannot verify the first attempt, stop rather than submit another payment.
- Return a merchant order number or merchant confirmation alongside the payment outcome, not just a payment-intent ID.
- Configure Claude with the merchant endpoint for the core build. Automatic discovery from a merchant website is optional. Ask Airwallex for a supported discovery-file path and schema if you attempt it.

### 11. x402 Business Agents

You run a data business. Customers' agents buy market data from you per query, paying into your Metal account and signing each order they pay for. Three agents of yours draw on that account, each under its own mandate, limits your account enforces on chain: a sourcing agent buys the upstream data, a support agent refunds customers, and a treasury agent watches their spending, moves earnings to Airwallex and pays a monthly licence fee invoiced in euros. You simulate the customer, its agent and the upstream provider too.

Let your three agents spend 20 \*USDZ between them: the sourcing agent's mandate allows 10 \*USDZ in all, at most 3 cents a purchase, the support agent's 4 \*USDZ and the treasury agent's 6 \*USDZ. A query sells for 5 cents and its upstream data costs 2 cents. Then the upstream price rises to 4 cents, above the sourcing agent's 3-cent cap, so its next purchase is refused. The treasury agent proposes new limits within the 20 \*USDZ, with or without a higher query price, and you approve them by replacing the mandates. A customer disputes a batch of charges: its agent never placed those orders, it says, and some of the data you sold it was wrong. The signed orders show its agent did place them. Where you judge the data you sold was wrong, the support agent refunds the charge from its budget. Keep prices, budgets and the licence fee in code, and let the model weigh the rest.

**The flow:** create your account, its three mandates, and a customer's account and mandate, run the upstream provider and a query route that requires a signed order, sell queries, raise the upstream price and show the refusal, replace the mandates, resolve the disputed batch, then move earnings to Airwallex and pay the licence fee.

**Endpoints:** On Metal, `metal-agent account create` and `mandate credential create`, `bind`, `replace`, `pull` (a `--payment-id` per refund) and `verify` ([Pay under spending limits](https://docs.metalntwx.com/agents/mandates), [Send a direct payout](https://docs.metalntwx.com/agents/payouts)); `requireSignedOffer`, with `SIGNED_OFFER_REQUIRED` and the route as its resource in your route's offer, then `signedOfferOf` and `verifyMandatePayment` ([Require a signed order](https://docs.metalntwx.com/agents/require-signed-order)). On Airwallex, `POST /simulation/deposit/create` and `GET /deposits`, then the FX, beneficiary and transfer calls of [kit 1](#1-adaptive-treasury-controller).

**Watch out for:**

- Keep owner keys away from agents: an agent holding one has no limit. Give each agent its own mandate and the mandate key `credential create` writes beside it.
- Nothing stores signed orders. Keep each one from `signedOfferOf` with its transaction hash and what you delivered, which `onAfterSettle`'s transport context carries. An order proves the price and route, not the query or the data's quality.
- The account caps each agent's budget, not their total, so hold the 20 in code. A replacement carries what the agent spent, so its budget must exceed that. Create it with `--mandate-key-file` naming the agent's key, then restart the agent on it: the old credential is refused as revoked. Mandates pay whole cents only.
- A purchase over its cap moves nothing and comes back as a 402 naming the reason. When the sourcing agent's purchase is refused, answer the customer with an error status: the middleware then doesn't settle their payment.
- A timeout is unconfirmed. For a payout, rerun the same `mandate pull`, which pays at most once. For a purchase, look it up in the facilitator's `/settlements` before paying again.
- The Airwallex sandbox can't receive stablecoins. Send earnings to a Metal address you hold, mark the hash credited in your records, then simulate a deposit of the same amount with the hash as its `reference`.

### 12. Inference Sourcing Agent

You operate an AI service that writes research reports. Each report takes model calls, web searches and data lookups, and several providers sell each at different prices and speeds, charging for each paragraph of an answer as its own request. Your agent buys every step from the provider that fits what is left of the job's budget. Each customer approves a card hold for their job's budget through Airwallex, you capture what the job spent, and the agent pays providers from \*USDZ you deposit for each job. You run the providers too, from a real model or from stand-in text.

Three jobs run at once with holds of \$1.00, \$0.75 and \$0.75, and your float is 1.50 \*USDZ, less than the 2.50 they could spend: deposit part of it for each job and keep the rest to top up. Model providers charge 1, 2 and 5 cents a paragraph, a web search 2 cents and a data lookup 3. Midway, one job's prompt runs to four times the tokens budgeted, and the cheapest provider slows under the load. The agent decides which jobs move to another provider, which get the reserve, and which customer is asked to raise their hold. A good run charges no customer past their hold, finishes the jobs it can, and asks before spending more. Keep price lists, budgets and the reserve in code, and let the model judge which answers are worth the more expensive provider.

**The flow:** run three providers at different prices, hold each customer's card, deposit float for each job, run the jobs, let one overrun while a provider slows, re-route and top up from the reserve, then capture what each job spent, release the rest of each hold and withdraw the unused float.

**Endpoints:** On Airwallex, `POST /pa/payment_intents/create`, `POST /pa/payment_intents/{id}/confirm` with `authorization_type: 'pre_auth'` and `auto_capture: false`, then `/increment_authorization`, `/capture` and `/cancel`. On Metal, from `@metalntwx/metal-pay` ([Offer clearing](https://docs.metalntwx.com/agents/clearing)): `ClearingServerScheme` for each provider, `openClearingWallet`, `depositToClearing`, `registerClearingClient` with `createClearingClient`, `clearingSpendable` and `withdrawFromClearing`.

**Watch out for:**

- A provider's price is whatever its next `402` offer says. Set the clearing client's `maxAmount` to the dearest price you accept.
- A clearing wallet pays one request at a time, about one every 3 seconds on testnet. Many attempts are refused with `between_epochs`: retry after the `retry.ms` it gives. Plan tens of payments per job, and run jobs in parallel, one wallet each.
- Give each job a fresh wallet and deposit in each run: you capture from the wallet's record, which counts everything it ever paid. If a payment's answer is lost, the wallet pays nothing else until you resend that request to the same provider at the same price, so do that before you reroute the job.
- Unused float leaves only once final, 10 minutes or more after a job's last payment on testnet. `withdrawFromClearing` first queues the withdrawal, answering with an empty `claimed`, and a later call about 10 minutes on claims it. A deposit takes several seconds and pays from the next epoch, so top up early, one deposit at a time.
- Capture once and never more than the hold, so raise the hold before you top up. A request that fails after its payment still cost its price. Clearing amounts are 18-decimal \*USDZ base units, and prices and deposits must be whole millionths; Airwallex's are major units.
- Place each hold with kit 4's test card as a pre-authorization; an ordinary hold refuses increments. It waits at `REQUIRES_CAPTURE`, and `/increment_authorization` takes the new total. Capture or cancel every hold, a failed job's included, before it lapses.

## Working with the API

### REST or MCP

You can complete kits 1 through 8 over REST. Kit 9 combines browser automation for shopping with the provided payment tooling. For kit 10, configure Claude with the merchant-specific MCP endpoint after Airwallex enables the sandbox merchant. Do not use the docs or developer MCP server as that storefront endpoint. Kits 11 and 12 use Metal's CLI and `@metalntwx/metal-pay` for the chain side and REST for the Airwallex side. Do not use the Airwallex docs or developer MCP server as the Metal endpoint. The developer MCP server can help assemble cardholder and beneficiary payloads. Because that server authenticates as your platform account and cannot send `x-on-behalf-of`, use REST for most calls in kits 5 through 8\. For kits 1 through 4, use whichever interface fits your implementation.

Use these rules:

- **Use MCP to set up a card on your own account.** A DELEGATE cardholder needs only an email and comes back READY in the create response, so you have nothing to poll. The REST call takes a name, date of birth, address and consent field, followed by a readiness check.
- **MCP `create_beneficiary` takes `dry_run: true`**, which validates a payload and returns `"OK"` without creating anything. The MCP tool takes nested `bank_details` and `address` objects rather than flat fields. To validate beneficiary details without creating anything over REST, call the documented `POST /api/v1/beneficiaries/validate` endpoint; do not rely on `dry_run` flags on the create call. That endpoint also accepts `x-on-behalf-of`.

Use REST for FX conversions, beneficiary validation, dispute challenges, connected-account calls, and platform money movement because no MCP tool exists or the available tool lacks required fields.

MCP tool availability can change. Test each MCP call during setup, before you build on it, and keep the equivalent REST call behind one function so you can switch with a one-line change.

### Booking an FX conversion

There is no MCP tool, so use REST in kits 1, 6, and 11\. Required fields are `buy_currency`, `sell_currency`, one of `buy_amount` or `sell_amount`, and `request_id`. Pass `quote_id` from a prior `create_fx_quote` to lock the rate, or omit it to convert at spot.

```http
POST /api/v1/fx/conversions/create
 headers: Authorization: Bearer <token>
 x-on-behalf-of: acct_... # kit 6 only, omit for kit 1
 { "request_id": "<uuid>", "buy_currency": "EUR",
 "sell_currency": "USD", "buy_amount": "7525.70" }
```

**Do not drop the header in kit 6\.** Without it, the call targets your platform wallet rather than the employer's connected account. Pass the account id into the conversion function before you build the batch, and read the connected account's balances after the call to confirm the conversion landed there. See the [Create a conversion](https://www.airwallex.com/docs/api/transactional_fx/conversion/create) reference.

### Beneficiary payloads

If you build kit 1, 3, 6, or 11, call `POST /api/v1/beneficiaries/schema` for the target country and currency. Required fields differ by corridor, so check the schema before you build a beneficiary payload. Wrap the validation payload as `{"beneficiary": {...}, "transfer_methods": ["LOCAL"]}`. Send `transfer_methods`, not `payment_methods`. If you send the wrong field, Airwallex returns code `001` and names a field you did not send.

Use these corridor-specific fields:

- **US, USD, LOCAL.** Use flat `bank_details` with `account_routing_type1: "aba"`, plus a `bank_account_category` of exactly `"Checking"` or `"Savings"`. Airwallex rejects other casing with code `016`. Include `street_address`, `city`, `state`, `postcode`, and `country_code` in the address.
- **GB, GBP, LOCAL.** Include `bank_name`, which the US corridor does not require, and set the routing type to lowercase `sort_code`. Airwallex rejects `SORT_CODE` with code `011`.
- **DE, EUR, SWIFT.** Use an IBAN plus `swift_code`, and omit the routing fields.

For these sandbox flows, use synthetic account numbers, names and addresses. Airwallex validates routing codes, sort codes and IBAN checksums, so use a valid routing identifier with a synthetic account number. `transfer_method` on `transfers/create` accepts only `LOCAL` and `SWIFT`. Airwallex charges a flat fee per SWIFT payout and no fee for LOCAL payouts.

## Platform setup: connected accounts

In kits 5 through 8, your platform acts on behalf of customers who hold connected accounts. You open and operate each connected account for one customer, with a separate wallet, balance and limits. Use the same setup for all four kits. Airwallex does not enable connected accounts by default, and platform payments is a separate switch. Ask for both, because connected accounts alone will not let you call `connected_account_transfers/create` or `charges/create`. Email [devhelp@airwallex.com](mailto:devhelp@airwallex.com) with your sandbox email and Client ID, and allow time for a reply before you plan a build around it.

Each connected account has its own wallet, balance, and limits. Keep customer funds separate in your policy and do not use one customer’s money for another customer’s obligation. Airwallex can execute a connected-account transfer when your platform supplies the source account’s authorization, so your policy has to enforce that separation. In kit 6, a deposit reaches Employer C while Employer B remains short.

For customer-scoped balances, FX, issuing, beneficiaries, and transfers, call the ordinary APIs with `x-on-behalf-of`. Use `connected_account_transfers/create` to move platform money into a customer wallet and `charges/create` to collect a fee or repayment. You do not need those platform calls for kits 1 through 4, or for kits 11 and 12.

Set two authority boundaries: what the agent may do for a person, and what your platform may do for a customer. A charge can pull money from a customer wallet, so define when the agent may create one and when a person must approve it. In kit 8, the platform holds money that belongs to a seller.

### Creating and activating an account

| Step | Action | Endpoint | Notes |
| :---- | :---- | :---- | :---- |
| 1 | Create | `POST /api/v1/accounts/create` | `account_details` is required, though `{}` satisfies it. Include all known account fields here. Returns an `acct_` id at status CREATED. |
| 2 | Fill gaps | `POST /api/v1/accounts/{id}/update` | Airwallex locks fields after submit. Include the business person in the create request because adding one here does not persist. |
| 3 | Submit | `POST /api/v1/accounts/{id}/submit` | Empty body. |
| 4 | Activate | `POST /api/v1/simulation/accounts/{id}/update_status` | `{"next_status": "ACTIVE", "force": true}`. Wait about two seconds after submit. |
| 5 | Confirm | `GET /api/v1/accounts/{id}` | Status ACTIVE. Wait a few minutes before your first FX call; a newly activated account may return `unconfigured_client_fee` during that window. |

Put `business_person_details` and `business_details` directly inside `account_details`; do not nest one inside the other. `industry_category_code` is in `ICCV3_XXXXXX` format rather than an MCC code, so fetch valid values from `GET /api/v1/reference/industry_categories`.

Set `business_identifiers` with an EIN before you submit. Without it, you cannot create a valid on-behalf-of transfer: Airwallex returns error `001` when you omit `payer` and error `048` when you supply it. You cannot edit an account after submission, so create another account if you omitted the EIN.

Account addresses use `address_line1` and `suburb`, while beneficiary addresses use `street_address` and `city`. If you send the beneficiary field names in an account address, Airwallex drops them without returning an error.

### Acting on behalf of a customer

Send `x-on-behalf-of: {acct_id}` on each customer-scoped call, and Airwallex processes the request against that customer’s account. Use it when you read balances, create or validate beneficiaries, create transfers, call FX, create a Global Account, simulate a deposit, issue a card or simulate a transfer status.

Before the account reaches ACTIVE, FX returns `forbidden`. During the first few minutes after activation, it may return `unconfigured_client_fee`. Deposit and transfer simulations always require the header.

### Platform money movement

Use these two calls for platform money movement in kits 5 through 8, and wrap each one in a reusable function.

```http
POST /api/v1/connected_account_transfers/create # platform to customer
 { "request_id": "<uuid>", "amount": 2000, "currency": "USD",
 "destination": "acct_...", "reason": "wages_salary", "reference": "payroll top-up" }

POST /api/v1/charges/create # customer to platform
 { "request_id": "<uuid>", "amount": 25, "currency": "USD",
 "source": "acct_...", "reason": "professional_business_services", "reference": "platform fee" }
```

For both calls:

- **`destination` and `source` are plain strings**, not nested objects. Send the `acct_` id directly.
- **`reference` is required on both.** Airwallex checks this field first, so you will not see errors for other invalid fields until you add it.
- **`reason` is a closed enum.** The first error lists values that a second validator then rejects, so a value from that list can still fail. There is no `platform_fee`. Use `professional_business_services` for a platform fee and `wages_salary` for a payroll top-up.
- **Airwallex returns `status: "NEW"` for both calls.** Do not treat the create response as final. Store the returned object id and retrieve the object until its status changes to `SETTLED`.

For a portfolio or settlement report, send `type` as well as `file_format` to `POST /api/v1/platform_reports/create`. Airwallex validates `type` first.

## Sandbox constraints

Check these constraints before debugging a failed call. Airwallex may change sandbox behavior without warning, so retest any behavior your build depends on.

**Money and identity**

- **Amounts are major units.** `100` is one hundred dollars.
- **If you reuse a `request_id` inside 7 days, Airwallex returns `duplicate_request_id`.** Use a UUID, and reuse one only when retrying the same operation. Transfers reject anything under 10 or over 50 characters with code `018`; a 36-character UUID meets that rule.
- **Send `transfer_currency` and `transfer_amount` to `transfers/create`.** If you send `payment_currency`, Airwallex returns code `001`.

**Transfers and payouts**

- **SWIFT payouts cost a flat fee from the same wallet, local payouts are free.** EUR SWIFT transfers of 100, 1,000, 2,000 and 4,000 each cost a flat EUR 12.85. Add one fee per payout when you calculate how much to convert.
- **A failed transfer ends in CANCELLED, never in a status called FAILED**, and CANCELLED does not mean a person cancelled it. Read `failure_type` and `failure_reason`.
- **Use the transfer state rules from kit 3's watch-outs: poll until a terminal state, and treat SENT as in-flight, never final.**
- **Airwallex validates bank details when you create the beneficiary, not when you pay.** A bad IBAN fails with code `083` at creation, so you cannot make a payment fail on bad details. Move it to SENT and then FAILED instead.
- **Call the beneficiary schema endpoint first.** Fields differ by country and currency. Use a real routing code with a made-up account number, since invented routing codes fail with a bare code `010` that names only the field.

**Cards**

- **Card transaction reads use different status vocabularies.** After capture, REST may report APPROVED while MCP reports CLEARED, and the REST read may remain PENDING during a short demo. For demo logic, use `transaction_type: CLEARING` for an accepted transaction and `failure_reason` for a decline, or keep a separate state map for each read path.
- **Declined card transactions end in FAILED while failed transfers end in CANCELLED.** Use the transfer state rules from kit 3's watch-outs for the transfer side. Decline reasons in sandbox: `INSUFFICIENT_FUNDS`, `LIMIT_EXCEEDED`, `CURRENCY_NOT_ALLOWED`, `MERCHANT_CATEGORY_NOT_ALLOWED`, `OUT_OF_ALLOWED_TIME_RANGE`, `CARD_INACTIVE`, `CARD_CLOSED`.
- **Airwallex enforces inclusive per-transaction limits.** On a \$100 limit, \$100.00 clears and \$100.01 fails with `LIMIT_EXCEEDED`. `PER_TRANSACTION` limits are not cumulative, so add `ALL_TIME` or `MONTHLY` alongside to track total spend.
- **Cardholders and cards reach their ready state without an approval call, so poll instead of calling `pass_review`.** Both reach READY and ACTIVE within seconds. Virtual cards activate automatically. Freeze, unfreeze and close through `POST /api/v1/issuing/cards/{id}/update` with `card_status`, to show an agent revoking its own authority mid-run.

**FX**

- **Leave `x-api-version` off the FX calls.** Neither the rate nor the conversion endpoint needs it. Airwallex returns `incorrect_version` for a stale value.
- **A rate is not a quote.** `get_fx_rate` returns an indicative rate with no `quote_id`. Read `rate` off a rate check and `client_rate` off a quote, or you get `undefined`.
- **Conversions settle immediately** with `status: "SETTLED"` and no pending state.

**Platform kits**

- **Pass `x-on-behalf-of` on ordinary banking calls made for a connected account.** Add it when you call balances, FX, issuing, beneficiaries, transfers, Global Accounts, deposits, and transfer simulations. Platform-level calls use `source` or `destination` instead. If the API returns an error on a customer-scoped simulation, check whether the object was created before retrying; reuse the same request ID so duplicates are rejected.
- **Enforce tenant isolation in your policy.** Do not sum balances across customers or use one customer’s funds for another.
- **Transfers created on a customer’s behalf do not reach a terminal status without a simulation call.** They remain in PROCESSING until you advance them with the simulation endpoint.
- **Airwallex returns three different insufficient-funds codes for the same account state.** `transfers/create` returns `balance_insufficient`, `charges/create` returns `insufficient_fund`, and `fx/conversions/create` returns `insufficient_funds`. Match on the code the endpoint returns.
- **MCP cannot act on behalf of a customer**, so anything customer-scoped is a REST call.

**Environment**

- **Sandbox enforces rate limits:** 20 requests per second globally, 10 per endpoint, and 10 concurrent. If you get a 429, back off and retry; do not send bursts of parallel requests during your demo.
- **The deposit simulation reports PENDING and posts immediately.** Re-read balances before recalculating anything.
- **Use the US and GB local corridors or the EUR and GBP SWIFT corridors in these examples.** Other corridors use different beneficiary fields, so check the schema first.

## Documentation and support

- [airwallexdev.com](https://airwallexdev.com) for the guided setup path with copy buttons
- Docs MCP at `https://mcp.sandbox.airwallex.com/docs`, no account needed, for exact fields
- Developer MCP at `https://mcp.sandbox.airwallex.com/developer` for real sandbox calls
- [AgentOS MCP](https://www.airwallex.com/docs/developer-tools/ai/agentos) for the production account. Production login. Not the sandbox docs or developer servers.
- [Sandbox environment](https://www.airwallex.com/docs/developer-tools/sandbox-environment) and the [Postman quickstart](https://www.airwallex.com/docs/developer-tools/api/quickstart-with-postman) if you want to send requests manually
- [Webhooks](https://www.airwallex.com/docs/developer-tools/webhooks/webhooks-overview.md) for long-running integrations. Verify the HMAC-SHA256 signature against the raw bytes rather than a re-serialized body, dedupe on event id because delivery is at-least-once, and return 200 fast
- API reference for [balances](https://www.airwallex.com/docs/api/core_resources/balances/current), [Global Accounts](https://www.airwallex.com/docs/api/core_resources/global_accounts/list), [transfers](https://www.airwallex.com/docs/api/payouts/transfers/create), [beneficiary schema](https://www.airwallex.com/docs/api/payouts/beneficiaries/schema), [FX quotes](https://www.airwallex.com/docs/api/transactional_fx/quotes/create), [FX conversions](https://www.airwallex.com/docs/api/transactional_fx/conversion/create), [issuing](https://www.airwallex.com/docs/api/issuing/cards/create), [disputes](https://www.airwallex.com/docs/api/payments/payment_disputes/challenge.md), [connected accounts](https://www.airwallex.com/docs/api/scale/accounts/create) and [deposit simulation](https://www.airwallex.com/docs/api/simulation/deposits/create)

If your idea does not fit these twelve kits, use the criteria in [Build around a financial decision](#build-around-a-financial-decision). Email [devhelp@airwallex.com](mailto:devhelp@airwallex.com) when Airwallex returns behavior not covered here.
