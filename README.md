# Giam Siap

**Giam Siap** ("save/economize" in Hokkien) is an agentic B2B procurement escrow engine built on Sui. A restaurant or cafe owner tells a Telegram bot to lock funds for a purchase at a target price; an autonomous AI agent watches the vendor's price in the background and settles the trade on-chain the instant the price condition is met — no human re-approval, no invoice, no counterparty risk.

## Problem Statement

Three related pains, one system:

- **Restaurant/cafe owners** waste time manually tracking volatile ingredient prices across vendors. They either overpay (missing a price dip) or stock out (moving too slowly).
- **Suppliers** wait on Net-30/Net-60 invoices, straining cash flow and tying up working capital that should already be theirs.
- **Neither side can safely automate this today.** Web2 tooling can't be trusted with real spending authority without either a human re-approving every transaction (which defeats the point of automating it) or a high-fee third-party processor sitting in the middle (which eats the margin automation was supposed to protect).

Giam Siap's answer: a trustless on-chain escrow paired with an autonomous monitoring agent. The owner states a spending intent once; the agent watches the market continuously; the smart contract — not the agent, not any human — enforces that funds move only when the owner's own stated condition is actually met.

## Blockchain Technology Used

- **[Sui](https://sui.io)** (testnet) — the settlement layer. Escrow, price/payee verification, and payout all happen inside a single [Move](https://docs.sui.io/concepts/sui-move-concepts) smart contract (`giam_siap::procurement`).
- **On-chain ed25519 signature verification** — a vendor's price quote must be cryptographically signed; the contract verifies the signature itself before ever releasing funds, so settlement never depends on trusting the agent's word.
- **zkLogin via [Enoki](https://portal.enoki.mystenlabs.com)** — real, non-custodial login with a Google account. No seed phrase, no wallet extension; the owner's Sui address is derived directly from their OAuth identity.
- **Enoki gas-station sponsorship** — the owner only ever authorizes their own spend; network gas is sponsored, so they never need to hold or manage a separate gas token.

## Smart Contract Addresses (Testnet)

| Object | Address |
|---|---|
| Package (`giam_siap::procurement`) | [`0x9d4610475a54bd178cd0da67ad73d52af794b7309f097da16fbf22441b61572f`](https://suiscan.xyz/testnet/object/0x9d4610475a54bd178cd0da67ad73d52af794b7309f097da16fbf22441b61572f) |
| `VendorRegistry` (shared object) | [`0xf068649dd7a8e56a9001baa8dec22ec47aee4d9249051e6bc380b283dd037e52`](https://suiscan.xyz/testnet/object/0xf068649dd7a8e56a9001baa8dec22ec47aee4d9249051e6bc380b283dd037e52) |

Network: **Sui Testnet**. Every order, escrow lock, and settlement is a real transaction, viewable on [Suiscan](https://suiscan.xyz/testnet).

## Architecture

```
Telegram (owner) ──▶ Hermes AI agent (intent parsing only)
                          │
                          ▼
                  sui-tools MCP server ──▶ Sui testnet contract
                          ▲                  (escrow, verification, payout)
                          │
              deterministic watcher (no LLM, timer-driven)
                          │
                          ▼
                  vendor price feed (signed quotes)

Dashboard (read-only) ── polls the chain ── shows live escrow + settlement state
```

- `contracts/` — the Move smart contract (escrow, vendor-signature verification, settlement).
- `agent/sui-mcp/` — MCP tool server exposing `createOrder`, `checkVendorPrice`, `executeOrder`, etc. Used by Hermes for intent parsing, and directly by the watcher.
- `agent/watcher/` — the deterministic settlement loop. Polls active orders and vendor prices on a timer; on a price match, submits `execute_order` itself using a scoped on-chain capability. No LLM anywhere in this path — the money-moving decision is entirely rule-based.
- `dashboard/` — a Next.js app: a public, read-only view of live escrow/settlement state, plus the real zkLogin sign-in (`/auth`) and per-order transaction approval (`/sign`) pages.
- `agent/hermes.config/` — the Telegram bot's system prompt and project context, kept in sync with the live Hermes profile.

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

Message the bot in Telegram (e.g. *"Procure 50kg coffee beans, target RM10/kg"*) to try the full flow: sign in via `/auth`, approve the order via `/sign`, and watch it settle automatically on the dashboard once the vendor's price meets your target.

## Team Members

<!-- TODO: add team member names here -->
-
-
-
