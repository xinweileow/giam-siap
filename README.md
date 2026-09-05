# Giam Siap

**Giam Siap** is an agentic B2B purchasing escrow engine built on Sui. An SME restaurant or cafe owner states a need in plain language to a Telegram bot — no wallet app, no crypto knowledge required — and an AI agent researches a fair market price, sizes the order, and locks the funds into a Move-contract escrow at that target price. From there, the AI steps back: a deterministic on-chain watcher verifies the vendor's own cryptographically signed price quote and settles the trade automatically the instant it meets the target — no re-approval, no invoice, no counterparty risk.

## Problem Statement

Three related pains, one system:

- **Owners waste real time and money just watching prices move.** Ingredient prices shift day to day across vendors, but checking them is manual and unrewarding work — so owners either miss the dip and overpay, or react too slowly and stock out mid-service.
- **SME restaurants and cafes don't have a procurement team to fall back on.** A larger F&B chain has staff whose job is to know what a fair market price looks like and how much stock the business actually needs. A single-outlet SME owner has none of that — they're guessing at both numbers themselves, on top of running the floor, which means the business either overpays for what it buys or over/under-orders against demand it never had time to properly size.
- **Every order today means a negotiation, and every negotiation means friction on both sides.** Owners spend time haggling price and credit terms with suppliers instead of running their business; suppliers spend that same time chasing Net-30/Net-60 invoices instead of getting paid, which strains their cash flow and ties up working capital that should already be theirs.
- **Neither side can safely automate any of this today.** Web2 tooling can't be trusted with real spending authority without either a human re-approving every transaction (which defeats the point of automating it) or a high-fee third-party processor sitting in the middle (which eats the margin automation was supposed to protect).

**Giam Siap's answer, in one sentence: it gives an SME owner the procurement team they can't afford to hire, and replaces the negotiation both sides can't afford to keep wasting time at.** 
The owner doesn't need to arrive with a price and quantity already worked out — they can just state a need (*"I want to procure coffee beans"*), and the agent asks a few follow-ups about their actual business (location, operating days, typical volume, stock on hand), researches the real current market price itself, and proposes both numbers with its reasoning, doing the market research and demand sizing a bigger business would pay a team to do. And because the owner is only ever agreeing to an objective, pre-committed condition — not haggling a deal with a person on the other end — there's nothing left to negotiate: the smart contract, not the agent and not any human, locks the funds the moment the owner confirms and releases them the instant the vendor's own signed price meets that condition, so the supplier is paid instantly and trustlessly, with no invoice to chase and no counterparty risk on either side.

## Blockchain Technology Used

- **[Sui](https://sui.io)** (testnet) — the settlement layer. Escrow, price/payee verification, and payout all happen inside a single [Move](https://docs.sui.io/concepts/sui-move-concepts) smart contract (`giam_siap::procurement`).
- **On-chain ed25519 signature verification** — a vendor's price quote must be cryptographically signed; the contract verifies the signature itself before ever releasing funds, so settlement never depends on trusting the agent's word.
- **zkLogin via [Enoki](https://portal.enoki.mystenlabs.com)** — real, non-custodial login with a Google account. No seed phrase, no wallet extension; the owner's Sui address is derived directly from their OAuth identity.
- **Enoki gas-station sponsorship** — the owner only ever authorizes their own spend; network gas is sponsored, so they never need to hold or manage a separate gas token.

## AI x Sui Track Fit

**Ideas:** transaction-executing assistant, workflow automation, agent-to-agent commerce.

- **AI solves a real problem** — an SME owner has no procurement team, so pricing and quantity decisions fall on whoever is already running the floor: they either don't have time to check vendor prices and overpay, or guess at order size without ever properly sizing demand. Hermes' market-search step takes that job over — it asks about the business (location, operating days, volume, stock on hand), researches the real current vendor price itself, and comes back with a sized, priced order proposal instead of leaving the owner to work both numbers out alone. The benefit isn't just saved time: it's an owner who now orders at a fair, researched price and a quantity that actually matches their business, without needing to hire the staff a bigger chain would for exactly this.
- **Why Sui specifically** — the product needs a currency escrow that no one, not even the agent or the team running it, can quietly override once it's locked, and Move's object model gives that for free: the escrowed coin is a resource with one owner and one exit path (`execute_order`'s signature check or a cancel), so there's no shared mutable state for a bug or a rogue call to corrupt mid-flight. zkLogin and sponsored transactions being native Sui/Enoki primitives, not a third-party wallet SDK bolted on top, is what makes it possible to onboard an owner with just a Google login and no gas token in the first place. And PTBs let the whole "source payment coin → lock into escrow" step happen as one atomic transaction, so there's never a half-finished order sitting in limbo.
- **Thoughtful UX** — the interface is Telegram, not a wallet dApp, because that's where the target user already is. SME restaurant and cafe owners aren't crypto-native and won't install a wallet extension or manage a seed phrase just to buy ingredients — they already run their business through a phone and a chat app. So the entire blockchain layer is hidden behind a conversation: sign in with Google (zkLogin), never touch gas (Enoki sponsorship), and start from a bare need like *"I want to procure coffee beans"* instead of a form full of on-chain parameters. The owner experiences "texting a bot," not "using a blockchain."

**Sui features used:** zkLogin (via Enoki) for non-custodial login · sponsored transactions (Enoki gas station) so owners never hold gas · Programmable Transaction Blocks composing coin-sourcing and the `create_order` Move call in one atomic transaction · on-chain ed25519 signature verification gating payout.

## Smart Contract Addresses (Testnet)

| Object | Address |
|---|---|
| Package (`giam_siap::procurement`) | [`0x9d4610475a54bd178cd0da67ad73d52af794b7309f097da16fbf22441b61572f`](https://suiscan.xyz/testnet/object/0x9d4610475a54bd178cd0da67ad73d52af794b7309f097da16fbf22441b61572f) |
| `VendorRegistry` (shared object) | [`0xf068649dd7a8e56a9001baa8dec22ec47aee4d9249051e6bc380b283dd037e52`](https://suiscan.xyz/testnet/object/0xf068649dd7a8e56a9001baa8dec22ec47aee4d9249051e6bc380b283dd037e52) |

Network: **Sui Testnet**. Every order, escrow lock, and settlement is a real transaction, viewable on [Suiscan](https://suiscan.xyz/testnet).

## Architecture

```
Telegram (owner) ──▶ Hermes AI agent
                          │  1. market-search needs assessment (bare intent only):
                          │     asks follow-ups (location, operating days, volume, stock),
                          │     estimates quantity, researches real market price via
                          │     web search, confirms {itemId, targetPriceCents, quantity}
                          │  2. intent parsing → createOrder / cancelOrder
                          ▼
                  sui-tools MCP server ──▶ Sui testnet contract
                          ▲                  (escrow, verification, payout)
                          │
              deterministic watcher 
                          │
                          ▼
                  vendor price feed (signed quotes)

Dashboard (read-only) ── polls the chain ── shows live escrow + settlement state
```

- `contracts/` — the Move smart contract (escrow, vendor-signature verification, settlement).
- `agent/sui-mcp/` — MCP tool server exposing `createOrder`, `checkVendorPrice`, `executeOrder`, etc. Used by Hermes for intent parsing, and directly by the watcher.
- `agent/watcher/` — the deterministic settlement loop. Polls active orders and vendor prices on a timer; on a price match, submits `execute_order` itself using a scoped on-chain capability. No LLM anywhere in this path — the money-moving decision is entirely rule-based.
- `dashboard/` — a Next.js app: a public, read-only view of live escrow/settlement state, plus the real zkLogin sign-in (`/auth`) and per-order transaction approval (`/sign`) pages.
- `agent/hermes.config/` — the Telegram bot's system prompt and project context, kept in sync with the live Hermes profile. `system-prompt.md`'s "Market-search needs assessment" section is what drives the autonomous price/quantity reasoning above — it's prompt-driven, not a separate service, since Hermes itself has no custom conversation code in this repo.

**Note on the market-search step:** its web-research price is only ever used to size the *order* — settlement itself still only ever executes against a real, cryptographically signed vendor quote via `checkVendorPrice`/the watcher, never against a web-search result directly. That keeps the trustless settlement guarantee intact even though the price *proposal* now comes from open-web research instead of the owner typing a number.

## Setup and Installation

### Prerequisites

- Node.js 24+ and npm
- A [Hermes Agent](https://hermes.bot) install, for the Telegram bot runtime
- (Optional, only needed to modify/redeploy the contract) the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install)
- A Telegram bot token (via BotFather) and, for real zkLogin, an [Enoki](https://portal.enoki.mystenlabs.com) API key + a Google OAuth client

### 1. Clone and install each package

```bash
git clone https://github.com/xinweileow/giam-siap.git
cd giam-siap

cd agent/sui-mcp && npm install && npm run build && cd ../..
cd agent/watcher && npm install && npm run build && cd ../..
cd dashboard && npm install && cd ..
```

### 2. Configure environment variables

Copy each `.env.example` to `.env` and fill in the values (testnet RPC URL, the contract addresses above, your own signing key, Enoki credentials, etc.):

```bash
cp agent/sui-mcp/.env.example agent/sui-mcp/.env
cp agent/watcher/.env.example agent/watcher/.env
cp dashboard/.env.example dashboard/.env
```

### 3. Run the test suites

```bash
cd contracts && sui move test          # Move unit tests (needs the Sui CLI)
cd agent/sui-mcp && npm test           # sui-mcp tool tests
cd agent/watcher && npm test           # watcher loop tests
cd dashboard && npm run build          # dashboard build check
```

### 4. Wire up Hermes and start everything

```bash
# Register the MCP tool server with Hermes
hermes mcp add sui-tools --command node --args agent/sui-mcp/dist/server.js
hermes gateway setup   # connect your Telegram bot token

# Sync this project's system prompt into your Hermes profile
node agent/hermes.config/sync-to-hermes-profile.mjs

# Start each process
node agent/watcher/dist/index.js       # the settlement loop
cd dashboard && npm run dev            # the dashboard, http://localhost:3000
hermes gateway run                     # the Telegram bot
```

Message the bot in Telegram to try the full flow: sign in via `/auth`, approve the order via `/sign`, and watch it settle automatically on the dashboard once the vendor's price meets your target. You can either state a fully-specified order (*"Procure 50kg coffee beans, target RM10/kg"*) or just a bare need (*"I want to procure coffee beans for my restaurant"*) — the agent will ask a few follow-ups, research a fair price itself, and propose the order for your confirmation before it ever touches the chain.

## Team Members

```bash
- Leow Wei Xin
- Thong Poh Yoke
- Chan Jin Xuan
- Richie Wong Yu Zhi
