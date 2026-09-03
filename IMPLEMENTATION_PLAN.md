# Giam Siap — Implementation Plan

Companion to [Giam_Siap_Idea_Research.md](./Giam_Siap_Idea_Research.md). That doc is the pitch; this doc is how we actually build it, straight through, to a live end-to-end service on Sui testnet.

**Decisions locked (resolved from the open questions raised in an earlier draft of this plan):**
- **Real zkLogin** — not the custodial-key shortcut. See §4.5.
- **Testnet SUI directly** as the escrow currency — no custom test-USDC coin. See §3.
- **Mock vendor "contract"** = a data-format agreement with your teammates, not a smart contract — see §4.2. You don't build their site; you hand them a spec.

## Current status (as of 2026-09-03) — read this before assuming §7's steps are still ahead of you

§7 steps 0, 1, and 2a are **done and confirmed live on testnet**, not just unit-tested:

- **Contract deployed to testnet.** Package `0x9d4610475a54bd178cd0da67ad73d52af794b7309f097da16fbf22441b61572f`. `AgentCap` and `AdminCap` are both held by the deploy address (`0xf93fec94e303510a6f301554359d36c31f387537823367146a9815cd971efc05`) — this address is also today's dev-only owner stand-in (§3 build checklist step 5), so one funded testnet account currently plays owner + agent. `VendorRegistry` (shared object `0xf068649dd7a8e56a9001baa8dec22ec47aee4d9249051e6bc380b283dd037e52`) is configured with `rate_mist_per_cent = 1000` (1 cent = 1000 MIST, so a $500 order costs ≈0.05 SUI — cheap enough to run many demo orders off one faucet drip) and a registered dev-only mock-vendor pubkey (swap for teammates' real one via `update_vendor_pubkey` once they hand it over, §7 step 2b). All of this lives in `agent/sui-mcp/.env` (gitignored — a `.gitignore` didn't exist before this session, now does).
- **All 15 Move unit tests pass** (`sui move test`), all **13 sui-mcp Vitest tests pass** (`npm test` in `agent/sui-mcp`) — the 3 that were failing at the top of this session (stale fake addresses, plus a deeper bug: the tests asserted a `.target` field on `MoveCall` commands that doesn't exist — the SDK actually splits it into `.package`/`.module`/`.function` — and `createOrder`'s test expected 6 arguments when the real contract signature takes 7, including a `Clock`) are now fixed and green.
- **A full `create_order → execute_order` loop ran live on testnet**, not simulated: escrow locked, a real ed25519-signed vendor quote built and verified, settlement executed via the `AgentCap`, and the payout landed in a fresh supplier address's balance. Script at `agent/sui-mcp/e2e-smoke.ts` (manual, not part of the Vitest suite — run with `npx tsx e2e-smoke.ts` after sourcing `.env`).
- **The wallet is funded** (1 SUI via the web faucet at faucet.sui.io — the CLI faucet still redirects there, unchanged from before).

**A real SDK breaking change was found and fixed, and it matters for anything written against this plan's earlier code samples**: `@mysten/sui` was pinned at `1.28.0`, which builds transactions by calling a JSON-RPC method (`suix_getNormalizedMoveFunction`, called internally as `getNormalizedMoveFunction`) that the **public testnet fullnode has now removed** — every `client.signAndExecuteTransaction()` / `tx.build({client})` call failed outright with `Method not found`, independent of anything in this codebase. The fix was upgrading to `@mysten/sui@2.29.0` (current latest) and porting off the removed `SuiClient` (`@mysten/sui/client`) to `SuiGrpcClient` (`@mysten/sui/grpc`) — Mysten's own migration guidance points the same way (`docs.sui.io/develop/accessing-data/json-rpc-migration`). This touched `suiClient.ts`, `getOrder.ts`, `getActiveOrders.ts`, and `executeOrder.ts`'s execution path (not the pure `buildXTx` functions, which don't touch the network). **Anywhere this plan says `SuiClient`/`@mysten/sui/client`/`queryEvents`, read it as `SuiGrpcClient`/`@mysten/sui/grpc`/`listEvents` instead** — §1, §2.3, §4.1, §4.2, and §5.2 all predate this finding.

A few smaller real bugs surfaced and got fixed along the way, worth knowing about if you touch this code again:
- `decodeSuiPrivateKey()`'s return field is `scheme`, not `schema` (renamed in the 2.x SDK).
- `@types/node` was never installed — `Buffer`/`process`/`node:crypto` typed as errors under `tsc --noEmit`. Added as a devDependency; `npm run build` is now actually clean (it wasn't before, silently, because nothing had run it).
- Reading an `Option<address>` back via `include: { json: true }` returns the address string directly when `Some`, not `{fields:{vec:[...]}}` (old JSON-RPC shape) or a wrapping array — `getOrder.ts`'s `parseOptionAddress` now matches this.
- `execute_order`'s on-chain staleness check (`assert!(ts <= now_s, E_STALE_TIMESTAMP)`) can abort if the client's `ts` is built from `Date.now()` with no buffer — the shared `Clock` object's timestamp can trail wall-clock time by a few seconds. Whatever builds a vendor-quote timestamp for signing (the real vendor site, or the local dev stub) should back it off by several seconds, not use `Date.now()` verbatim.
- `getActiveOrders()`'s event-derived order set lags newly-created orders by a few seconds after the creating transaction lands — `getObject` reads are immediately consistent, but `listEvents` reads from indexed state that trails execution slightly (this is documented gRPC behavior, not a bug). **This matters for the watcher's design (§4.3, §9.1)**: don't call `getActiveOrders()` in the same breath as a `create_order` you just submitted and expect to see it; the existing 15–30s poll interval already comfortably absorbs this, so no design change needed, just don't be surprised by it in a tight manual test loop.

**Update (same day, later session) — the watcher process now exists.** `agent/watcher/` (§4.1, §4.3) is built: a deterministic `setInterval` loop (`agent/watcher/src/index.ts`, default 20s, configurable via `WATCHER_POLL_INTERVAL_MS`) that calls `getActiveOrders()` → `getOrder()` → `checkVendorPrice()` → `executeOrder()` — no LLM anywhere in this path, exactly as §4.1's architecture note specifies. It imports sui-mcp's tool functions as a real dependency rather than duplicating them: `agent/sui-mcp/tsconfig.json` now emits declarations (`"declaration": true`), and `agent/watcher/package.json` depends on `"@giam-siap/sui-mcp": "file:../sui-mcp"`, importing tool functions from its built `dist/` output directly (e.g. `@giam-siap/sui-mcp/dist/tools/getOrder.js`). The core tick logic lives in `agent/watcher/src/loop.ts` as `createWatcher(deps)`, fully dependency-injected so it's unit-testable without a real `SuiGrpcClient` — **12/12 Vitest tests pass** (`npm test` in `agent/watcher`), covering the full §9.1 failure matrix: a vendor fetch/signature failure is skipped and logged, never treated as "price = 0"; a per-order-and-URL failure streak triggers `onAlert` after `WATCHER_ALERT_THRESHOLD` (default 3) consecutive misses, cleared on the next success; `executeOrder` retries transient/RPC failures with backoff (default `[500, 1000, 2000]`ms) but never retries a client-side `ExecuteOrderGuardError` or a race (order already `Fulfilled`/`Cancelled` by the time of an on-chain revert — detected by re-reading the order, not blind-retried); one order's error never stops the rest of that tick's orders from being checked. `checkNow()` is exported from `index.ts` for the future Telegram "check now" trigger (§4.3 point 2) to call once Hermes/Telegram wiring exists — it isn't wired to Telegram yet, and `onAlert` currently just logs to console (`console.error`) rather than sending a real alert message, both intentionally deferred to §7 step 3. Also added: `agent/watcher/dev/vendor-stub.ts`, a tiny local HTTP server implementing §4.2's exact vendor interface spec (`GET /api/price?item=<id>`, `POST /api/set-price`), signed with the same `DEV_VENDOR_PRIVATE_KEY` already registered in `VendorRegistry`, so the full loop is testable end-to-end before teammates' real mock-vendor site exists — this also doubles as the "you control the price-match moment" lever for §9.2's demo-day fallback.

**Update (same day, later session) — the dashboard now exists.** `dashboard/` (§5, §7 step 5) is a Next.js (App Router) app scaffolded with `create-next-app`, plus `@mysten/sui@^2.29.0` — matching the SDK-migration note above, it uses `SuiGrpcClient`/`listEvents` from the start, never the removed `SuiClient`/`queryEvents`. It's a single read-only page with exactly §5.2's three elements (Escrow Vault Tracker, Live Order Table, Transaction Log with Suiscan links) and nothing else (§5.3) — no auth, no per-order vendor-price column (see below). Architecture: `src/lib/store.ts` is a single in-memory, server-side store (survives Next dev's hot-reload via a `globalThis` singleton, same pattern as a pooled DB client) that on each `/api/state` request more than `DASHBOARD_POLL_INTERVAL_MS` (default 5s) stale, drains `OrderCreated`/`OrderFulfilled`/`OrderCancelled` events in one cursor-paginated `listEvents` call filtered by `emitModule: "<packageId>::procurement"` (one filter catches all three event types, since they share a module — simpler than the three separate per-event-type queries `agent/sui-mcp/getActiveOrders.ts` uses), then re-reads escrow/status for every still-`Locked` order via `getObjects` (object reads are immediately consistent; events trail slightly, per this section's `getActiveOrders()` note above — this is what keeps a status badge from ever showing stale `LOCKED` after a same-tick settlement). `src/app/api/state/route.ts` is a thin dynamic route handler serving the store's snapshot as JSON; `src/components/Dashboard.tsx` polls it client-side every 5s. Verified against the live deployed contract during this session: correctly read 4 real orders left over from earlier `e2e-smoke.ts`/watcher runs, and the Escrow Vault Tracker's totals (10,000,000 MIST locked, 9,500,000 MIST settled) reconciled exactly against the on-chain math (`quantity × price × rate_mist_per_cent`) — §8.5's acceptance checklist passes. Also manually verified the §9.1 "RPC down" fallback: pointing `SUI_RPC_URL` at an unreachable host makes `/api/state` return `connected: false` with `lastError` set (never a frozen/blank page), recovering automatically once the URL is fixed.

One real design gap surfaced while building this, worth knowing about: **the mockup in §5.2 shows a live "Current" vendor price for a still-`Locked` order (e.g. "$12.00"), but nothing on-chain ever stores that** — `ProcurementOrder` (§3) has no such field, and the only place a live vendor price transiently exists is inside the watcher's process, which the dashboard is explicitly not supposed to call (§5.1/§5.3 scope it to on-chain reads only). The dashboard shows `"Monitoring…"` for a Locked order's Current column and the real settled price (from `OrderFulfilled`, once its event catches up) for an Executed one, rather than inventing a second vendor-polling path that would duplicate the watcher's job. If a live "current price" column is wanted later, it has to come from the watcher publishing its last-checked price somewhere the dashboard can read (e.g. a dynamic field on the order, or the watcher pushing to the same in-memory store over a shared process) — that's a real follow-up, not a bug in what's built now (added to TODOS.md).

`dashboard/.env.example` (and a gitignored `dashboard/.env`, same pattern as `agent/sui-mcp`) hold `SUI_RPC_URL`/`SUI_NETWORK`/`SUI_PACKAGE_ID`/`SUI_VENDOR_REGISTRY_ID` — no private key, since this app never signs anything. Note `dashboard/.gitignore` (generated by `create-next-app`) ignores `.env*` with no `!.env.example` exception by default — added that exception so `.env.example` is still committed, matching the root `.gitignore`'s pattern.

**Not yet done**: Hermes/Telegram wiring (§7 step 3, including actually wiring the watcher's `checkNow()`/`onAlert` hooks to Telegram) and the zkLogin swap-in (§7 step 6) — those remain exactly as described below. The mock vendor site is still teammates' open item (§7 step 2b) — a dev-only stand-in vendor keypair is registered in `VendorRegistry` today, and `agent/watcher/dev/vendor-stub.ts` (above) lets the watcher be tested against it before their real endpoint exists.

## 0. Product definition — the north star

Read this section again whenever a build decision feels ambiguous. Every technical choice in §2–§7 should trace back to something here. If a shortcut you're about to take doesn't serve one of these goals, that's a signal the build is drifting, not that the goal needs to bend.

**One paragraph:** Giam Siap is an agentic B2B auto-buying engine. A restaurant owner tells a Telegram bot "lock $500 for 50kg coffee at target $10/kg." Funds get locked into a Sui Move escrow object (`ProcurementOrder`). A Hermes AI agent polls vendor price pages in the background; the moment a price meets the target, it builds and submits a Sui Programmable Transaction Block that atomically validates the price, releases escrow to the supplier, and refunds any excess — no human in the loop for settlement.

### 0.1 The problem

Three distinct pains, one system:
- **Restaurant/cafe owners** waste time manually tracking prices across vendors. Volatile fresh-ingredient prices mean they either overpay (missed a dip) or stock out (moved too slow).
- **Suppliers** wait on Net-30/Net-60 invoices, which strains cash flow and ties up working capital that should already be theirs.
- **Neither side can safely automate this today** — Web2 tooling can't be trusted with real spending authority without either a human re-approving every transaction (which defeats the point of automating it) or a high-fee third-party processor sitting in the middle (which eats the margin the automation was supposed to protect).

### 0.2 The solution

A trustless escrow protocol (Sui Move) paired with an autonomous monitoring agent (Hermes). The owner states a spending intent once; the agent watches the market continuously; the contract enforces that funds move only when the owner's own stated condition is met — nobody, including the agent itself, can spend outside those bounds. The trust doesn't come from trusting the AI; it comes from the AI having no authority to violate what's written on-chain.

### 0.3 Key features, in priority order — what must actually work

1. **Conversational escrow** — natural language in Telegram → funds locked on-chain. This is the "an AI agent just handled real money safely" moment. If this isn't reliable, nothing downstream matters.
2. **Autonomous price sentry** — the agent checks vendor prices on its own schedule, not only when prompted. This is what makes it *autonomous* commerce rather than a chatbot with a buy button.
3. **Atomic settlement** — one on-chain transaction validates the price, pays the supplier, and refunds any excess, together or not at all. A partial state (funds moved but no payout, or price checked but nothing happened) is not acceptable — that's the line between a demo and a system a real business could actually trust.
4. **Zero Web3 friction** — zkLogin (no seed phrases) + sponsored transactions (no gas token to manage). If an owner ever has to think about a wallet or buy SUI just to pay gas, this feature has failed, independent of whether the contract logic is correct.

### 0.4 End goal — what "done" looks like

A restaurant owner with zero crypto experience, starting from a cold Telegram chat, can:
1. Authenticate with their Google account (zkLogin) — no wallet, no seed phrase.
2. State a procurement intent in plain language and have real testnet SUI locked into on-chain escrow, paying zero gas themselves.
3. Watch the agent report monitoring status without further input from them.
4. See the order settle automatically on-chain the moment a real (or demo-triggered) price match occurs, with a link to verify it actually happened.
5. See that same order reflected live on a public dashboard the entire time.

That full loop, run once, cleanly, end-to-end on testnet, with nothing faked or narrated around, **is** the deliverable. §2 through §7 exist to make that loop real, not to make it look real.

### 0.5 Non-goals — explicitly out of scope, don't let these creep back in

- Real fiat or mainnet funds, anywhere, ever, in this build — testnet only, free faucet funds, zero financial risk (see earlier discussion on this).
- Multi-vendor price negotiation or bidding — the agent checks a target, it doesn't haggle.
- Delivery/logistics tracking after settlement — payment finality is the scope, not fulfillment.
- Dashboard auth, multi-tenant views, historical analytics (§5.3) — one public read-only view is enough.
- A production-grade event indexer/database — client-side polling is fine at this scale; don't over-build the observability layer relative to the core loop.
- Building the mock vendor site — that's teammates' deliverable. Your responsibility there is the interface spec (§4.2), not the implementation.

### 0.6 User stories — full, end-to-end

Every workflow step below maps to a specific place in this plan. Use that mapping when you're unsure whether something you're building is in scope: if a step doesn't serve one of these two stories, it doesn't belong in the MVP.

One terminology note before the stories: the original pitch language below says "USDC" and "testnet USDC" in places — that's from an earlier framing. Per the decision in the intro, **the actual unit locked and settled on-chain is testnet SUI**, not a custom USDC token. Dollar figures ($500, $10/kg) are kept because that's how an owner actually thinks and talks — the Telegram NL parser converts that into a SUI-denominated `target_price`/`amount` under the hood (§4.2's `createOrder` tool).

#### Restaurant Owner — SME Cafe Owner / Procurement Manager

> "As a cafe manager, I want to initiate a procurement request directly in Telegram, lock budget funds into a Sui smart contract escrow, have an AI agent monitor vendor prices 24/7, and automatically settle the order when my price target is hit, so that I secure inventory at optimal rates without manual work."

| # | Step | What actually happens | Where it's built |
|---|---|---|---|
| 1 | **Input** | Owner sends a natural-language command to the Telegram bot — e.g. *"Procure 50kg Coffee Beans with a max budget of $500 at target price $10/kg."* | §4.4 (Telegram gateway) — Hermes's own NL/tool-calling handles this, no custom parser needed |
| 2 | **Contract creation** | Hermes parses the request into `{itemId, targetPrice, quantity}`, calls the `createOrder` tool, and prompts the owner to authorize the `create_order` Move call before anything touches the chain. | §4.2 (`createOrder` tool), §3 (`create_order` function) |
| 3 | **Escrow lock** | Owner approves via their zkLogin session (Google-authenticated, no seed phrase). The transaction locks real testnet SUI into the `ProcurementOrder` escrow object. Enoki sponsors gas, so the owner never holds or spends a gas token. | §4.5 (zkLogin + Enoki sponsorship), §3 (`escrow: Balance<SUI>`) |
| 4 | **Autonomous monitoring** | The agent fetches the vendor's price feed in the background on its own schedule — not waiting for the owner to ask — and posts status updates ("Monitoring active, vendor price $12.00 exceeds target $10.00") back into the Telegram chat. | §4.3 (orchestration loop / cron), §4.2 (`checkVendorPrice` tool) |
| 5 | **Outcome** | The moment the vendor's price meets or drops below $10/kg, the agent builds and submits the `execute_order` PTB itself — no further owner approval needed, since the owner's own pre-set condition is what authorizes it. Telegram receives a confirmation with a Suiscan link to the settlement transaction. | §3 (`execute_order`), §6 (end-to-end diagram) |

**Acceptance test for this story**: an owner who has never touched crypto before can complete steps 1–5 from a cold Telegram chat without help, and step 3 is the only moment they take an action (approve) — steps 4 and 5 require zero further input from them.

#### Supplier — Wholesale Food Vendor / Distributor

> "As a food supplier, I want to update my daily product pricing on my portal and have the agent automatically detect price matches against active buyer escrows, so that orders execute immediately and I receive instant on-chain token payouts without invoice delays."

| # | Step | What actually happens | Where it's built |
|---|---|---|---|
| 1 | **Input** | Supplier updates their catalog price — e.g. a flash sale drops coffee beans from $12.00/kg to $9.50/kg. This is entirely on the mock vendor site your teammates own; you only care that it's reachable at the agreed endpoint. | Teammates' deliverable (§0.7); the contract between you and them is §4.2's interface spec (`GET /api/price → {"price": <number>}`) |
| 2 | **Web scan & match** | On its next poll, the agent fetches the updated price via `checkVendorPrice` and compares it against every `Locked` order's `target_price`. | §4.3 (orchestration loop), §4.2 (`checkVendorPrice`, `getOrder`) |
| 3 | **Smart contract execution** | On a match, the agent invokes `execute_order` using its own scoped `AgentCap` — not the owner's key, not a shared admin key. This is what makes the authority model safe: the agent can *only* call this one function, and only when the on-chain assertion (`scraped_price <= target_price`) actually holds. | §3 (`execute_order`, `AgentCap`) |
| 4 | **Outcome** | Escrowed SUI splits and transfers directly to the supplier's address within the same atomic transaction — no invoice, no net-30 wait, no counterparty risk. The dashboard's order row flips to `FULFILLED`/`EXECUTED` within a few seconds (next poll cycle). | §3 (`OrderFulfilled` event), §5 (dashboard order table + tx log) |

**Note on scope**: the original pitch mentions an "automated delivery dispatch alert" as part of the supplier's outcome. That's a real, desirable feature but it's logistics, not settlement — it's explicitly a **non-goal** for this build (§0.5). Don't build it into the MVP; if there's time left after the core loop in §7 is solid, it's a fine stretch item, not before.

**Acceptance test for this story**: a price update on the vendor side, with no further action from anyone, results in an on-chain payout to the supplier and a dashboard update — the supplier never has to "claim" or confirm anything.

Both stories reduce to the same underlying test stated in §0.4: **does the system move money only when, and exactly when, the stated condition is true — with no human re-approval and no manual intervention?** If yes, the idea is proven. If any step above needs to be faked to make the demo work, that step isn't done yet.

### 0.7 Ownership

Three components, three owners:

| Component | Owns | Depends on |
|---|---|---|
| `contracts/` — Sui Move | You (or whoever owns chain) | Sui CLI + testnet |
| `agent/` — Hermes AI agent | You | Move contract deployed, Telegram bot token |
| `dashboard/` — Next.js UI | You | Move contract deployed (reads on-chain state) |
| Mock vendor site | **Teammates (per your note)** | Just needs to expose a URL the agent's scraper tool can hit |

---

## 1. Reality check on tooling (read this before assuming anything is wired up)

- **Hermes Agent** is installed and working (`hermes status` runs clean, Telegram/Discord/WhatsApp gateways are built in via `hermes gateway setup`). Good — this is your agent runtime.
- **No MCP servers are configured** (`hermes mcp list` → empty). Hermes's built-in catalog (`hermes mcp catalog`) has Stripe, Supabase, Linear, etc. — **no Sui MCP exists**, official or otherwise.
- **No Sui CLI is installed** on this machine yet (`sui` not on PATH).
- Node.js 24 / npm 11 are available — enough to run `@mysten/sui` (the official TS SDK).

Conclusion: "the Sui MCP linked to this computer" doesn't exist yet — **you need to build it**. The cleanest path, and the one that matches the research doc's "custom tools" language, is:

> Build a tiny local **stdio MCP server** (`agent/sui-mcp/`, Node/TS, using `@mysten/sui`) that exposes tools like `create_order`, `execute_order`, `get_order`, `check_vendor_price`. Register it with Hermes via `hermes mcp add sui-tools --command node --args agent/sui-mcp/dist/server.js`. Hermes then calls these tools like any other MCP tool during the conversation or from a cron job.

This keeps signing logic in one auditable place (the MCP server holds the agent's scoped keypair), and Hermes stays a thin orchestrator. Exact setup commands for all of this are in §2.

---

## 2. Setup — getting the tooling actually running

This is the gap between "the research doc name-drops these tools" and "they're wired up on this machine." Two tracks: getting Claude Code (or whoever's coding this) hooked up to Sui's documentation, and getting the actual runtime pieces (Sui CLI, Hermes↔MCP connection, Enoki) installed. Do §2.1 and §2.2 now; §2.3 and §2.4 have real dependencies noted below.

### 2.1 The "Sui MCP server" you found — read this before installing anything Sui-branded

The docs.sui.io/getting-started/sui-mcp-server page is real and official, but not what the name implies. It's `sui-docs`, a hosted MCP server at `https://sui.mcp.kapa.ai` exposing exactly two tools — `search_sui_knowledge_sources` and `get_sui_knowledge_documents`. It's a **documentation search bot**: it cannot build, sign, or submit transactions, query on-chain objects, or deploy Move contracts. This confirms §1's finding — there's no official Sui MCP for on-chain operations, and this one isn't a runtime component of the system you're building. It's useful only as a research aid while writing the Move module (§3) and the sui-mcp TS server (§4.1).

It's already registered in your Claude Code config, but scoped to your home directory (`C:/Users/USER`), not this repo — so a Claude Code session started in `giam-siap` can't see it. Register it here too, from this repo's root:
```bash
claude mcp add --transport http sui-docs https://sui.mcp.kapa.ai
```

### 2.2 Sui CLI + testnet account — start this now, nothing blocks it

```bash
# Install per https://docs.sui.io/guides/developer/getting-started/sui-install
# (Windows: prebuilt binary release or `cargo install --locked --git https://github.com/MystenLabs/sui.git sui`
# — there's no winget/choco package, budget a few minutes for a cargo build if you go that route)
sui --version

sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
sui client switch --env testnet
sui client new-address ed25519          # this becomes your deploy address and holds the AgentCap
sui client faucet                        # free testnet SUI — see earlier answer, no real money involved
sui client gas                           # confirm the faucet actually landed funds
```

### 2.3 Hermes ↔ sui-mcp connection — blocked until §4.1 exists

Hermes needs nothing new installed (`hermes status` already runs clean). What's missing is the MCP *connection*, and that has a real dependency: the sui-mcp server doesn't exist until you've built it in §4.1. Once it does:
```bash
cd agent/sui-mcp && npm install && npm run build
hermes mcp add sui-tools --command node --args agent/sui-mcp/dist/server.js
hermes mcp list          # confirm sui-tools shows up
hermes mcp test sui-tools
```
Telegram bot registration and the cron job are separate setup steps covered in §4.4 and §4.3 — nothing to do here beyond confirming the MCP connection itself.

### 2.4 Enoki (zkLogin + sponsorship) — account setup can start now, testing is blocked on the contract

1. Create an account and API key (scoped to testnet) at `portal.enoki.mystenlabs.com`.
2. Register a Google OAuth client in Google Cloud Console, redirect URI pointing at your `/auth` route.
3. Add to `agent/.env`:
   ```
   ENOKI_API_KEY=...
   ENOKI_GOOGLE_CLIENT_ID=...
   ```
4. `npm install @mysten/enoki` wherever `/auth` lives — putting it in `dashboard/` next to the Next.js app avoids standing up a fourth deployable just for one route.

Account creation and OAuth registration don't depend on anything else and can happen right now. You won't be able to test a real signed transaction through it, though, until the contract (§3) is deployed.

### 2.5 What's actually blocked vs. what isn't

| Setup step | Blocked on |
|---|---|
| Sui CLI + testnet (§2.2) | Nothing — do it first |
| `sui-docs` MCP registration (§2.1) | Nothing — do it first, helps with everything after |
| Enoki account + OAuth client (§2.4) | Nothing — do it first |
| Enoki *tested end-to-end* | Contract deployed (§3) |
| Hermes MCP connection (§2.3) | sui-mcp server built (§4.1) — don't attempt this before then |

---

## 3. Smart contract (`contracts/`)

### Module: `giam_siap::procurement`

**What changed here from the first draft, and why:** the eng review (below, §11) found that the original design let the AgentCap holder assert *any* price and *any* payee for a locked order, with nothing on-chain to check either claim — a bigger hole than it first looked like, since it means "trustless" wasn't fully true. The fix adopted: the vendor's price response must be **signed**, and execute_order verifies that signature instead of trusting a raw agent-supplied number. This closes both the price-trust and the payee-trust gap in one mechanism, at the cost of one more object (`VendorRegistry`) and one more function argument.

**Objects**

```move
public struct ProcurementOrder has key, store {
    id: UID,
    owner: address,               // restaurant owner
    item_id: String,
    vendor_urls: vector<String>,  // controlled endpoint(s) the agent checks — set at creation
    target_price: u64,            // price per unit, in USD CENTS — same unit the vendor's signature
                                   // covers (§4.2), so the on-chain price comparison never needs its own
                                   // conversion; only the final SUI payout does, via VendorRegistry's rate
    quantity: u64,
    escrow: Balance<SUI>,         // locked funds — testnet SUI, no custom coin
    supplier: Option<address>,    // set only on Fulfilled, from the vendor's signed response
    status: u8,                   // 0=Draft 1=Locked 2=Fulfilled 3=Cancelled
    created_at: u64,
}

public struct AgentCap has key, store {
    id: UID,                      // capability object — only holder can call execute_order
}

public struct VendorRegistry has key {
    id: UID,
    trusted_pubkey: vector<u8>,   // the mock vendor's ed25519 public key — registered once, updatable by AdminCap
    rate_mist_per_cent: u64,      // fixed demo-day USD↔SUI rate (§4.5) — lives on-chain so create_order's
                                   // invariant and execute_order's payout always read the SAME rate, instead
                                   // of trusting a rate the off-chain caller could pass inconsistently
}

public struct AdminCap has key, store {
    id: UID,                      // lets you rotate trusted_pubkey without redeploying the whole package
}
```

Use **`AgentCap`** (a Move capability object) instead of a hardcoded address check — it's the idiomatic Sui pattern for "this specific off-chain actor is authorized to trigger settlement," and it's revocable (owner can burn/transfer the cap to kill agent authority without touching escrow logic). `AdminCap` exists for exactly one reason: once teammates generate their mock vendor's signing keypair, you register the public key via `VendorRegistry` without a redeploy.

**Functions**

- `create_order(payment: Coin<SUI>, registry: &VendorRegistry, item_id: String, vendor_urls: vector<String>, target_price: u64, quantity: u64, ctx) -> ID`
  Asserts `target_price > 0 && quantity > 0` (closes the degenerate-order gap) and `payment.value() >= (quantity * target_price) * registry.rate_mist_per_cent` (the *escrow-sufficiency invariant*, converted through the same on-chain rate execute_order will later use — this is the fix for the worst possible failure mode: without it, a budget/target mismatch, e.g. from rounding, would only surface as an abort at `execute_order` time, live, mid-settlement, instead of failing safely at creation). Locks `payment` into the order's `Balance`, sets status `Locked`, shares the object internally via `transfer::share_object` and returns its `ID` to the caller — the earlier draft had this function both return the object *and* share it, which isn't valid Move; one or the other. Emits `OrderCreated`.
- `execute_order(order: &mut ProcurementOrder, cap: &AgentCap, registry: &VendorRegistry, price: u64, supplier: address, ts: u64, sig: vector<u8>, ctx)`
  Verifies `sig` against `registry.trusted_pubkey` over `(order.item_id, price, ts, supplier)` using `sui::ed25519::ed25519_verify` — this is what makes price *and* payee independently checkable instead of agent-asserted; note `price` here is in the same USD-cents unit the vendor signed, matching `target_price`'s unit, so the comparison below needs no conversion. Also asserts `ts` is recent (rejects a replayed old signature). Then: asserts `price <= order.target_price`, asserts status is `Locked`, splits `(quantity * price) * registry.rate_mist_per_cent` MIST to `supplier` (the one place a $→SUI conversion actually happens), refunds any remainder to `order.owner`, writes `order.supplier = option::some(supplier)`, sets status `Fulfilled`, emits `OrderFulfilled { order_id, price, supplier }`.
- `cancel_order(order: &mut ProcurementOrder, ctx)` — owner-only escape hatch, refunds full escrow, sets `Cancelled`, emits `OrderCancelled`. This is the demo's stuck-order recovery path (§9.2) — note it's owner-signed, so it shares the same zkLogin browser-signing dependency as `create_order` (§4.5); that's an accepted, documented coupling, not a gap (see §9.2).

**Events** (this is what the dashboard subscribes to — build these first, before the UI):

```move
public struct OrderCreated has copy, drop { order_id: ID, owner: address, target_price: u64, quantity: u64 }
public struct OrderFulfilled has copy, drop { order_id: ID, price: u64, supplier: address }
public struct OrderCancelled has copy, drop { order_id: ID }
```

**PTB composition (what the agent actually submits at execution time):**
One PTB, built client-side in the MCP server, containing: `execute_order` call → (Move function internally does the signature check, split/transfer/refund, atomically). You don't need multiple PTB commands unless you're also writing a Walrus blob reference or emitting a receipt NFT — for this MVP, one `moveCall` command is enough; PTBs matter for the pitch narrative ("atomic, single transaction") more than for code complexity here.

**Build checklist — do this first, it blocks everything else:**
1. `sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443` (install the Sui CLI first — not present locally).
2. `sui move new procurement`, write the module above using `sui::sui::SUI` as the coin type directly — no custom coin to mint or manage. `sui client faucet` gives you real testnet SUI to escrow, which is one less moving part than a self-minted token.
3. `sui client publish --gas-budget 100000000` → save `packageId`.
4. Mint yourself an `AgentCap` and an `AdminCap`, transfer both to the address the Hermes MCP server will sign with. Create the `VendorRegistry` shared object with a placeholder `trusted_pubkey` (update it once teammates hand you their real public key) and set `rate_mist_per_cent` to your chosen fixed demo-day rate (§4.5) — pick this rate once, here, and every other component (Telegram parsing, vendor price checks) just works in USD cents from then on, no off-chain conversion math anywhere else in the system.
5. **Dev-only stand-in**: for early development of §4/§5/§7 before the real zkLogin browser-signing flow (§4.5) is solid, generate one throwaway Ed25519 keypair to sign `create_order` calls locally — swap it for the real owner-signed flow once §4.5 is working. See §7's cut-line note for why this ordering matters.

---

## 4. AI agent (`agent/`)

### 4.1 Structure

**Architecture note (from the eng review):** the settlement loop is deterministic code, not an LLM tool-calling loop. The LLM's job stops at parsing the owner's intent when an order is created — after that, a plain watcher process calls the same sui-mcp tool functions directly, on a timer, with no LLM in between. This matters because it's the money path: deterministic code is what the Move/Vitest test suite in §10 can actually cover, and it removes LLM nondeterminism/cost from every single poll tick instead of just at order creation.

```
agent/
├── sui-mcp/                 # the custom local MCP server (Node/TS) — used by BOTH Hermes (for intent parsing) and the watcher below
│   ├── src/
│   │   ├── server.ts        # stdio MCP server entrypoint (for Hermes tool-calling at order-creation time)
│   │   ├── suiClient.ts     # @mysten/sui SuiClient + Ed25519Keypair (AgentCap signer)
│   │   ├── tools/
│   │   │   ├── createOrder.ts
│   │   │   ├── executeOrder.ts
│   │   │   ├── cancelOrder.ts
│   │   │   ├── getOrder.ts
│   │   │   ├── getActiveOrders.ts    # derives the Locked-order set from OrderCreated/Fulfilled/Cancelled events
│   │   │   └── checkVendorPrice.ts   # fetches a signed price from a mock vendor URL
│   │   └── config.ts
│   └── package.json
├── watcher/                  # NEW — the deterministic settlement loop, no LLM involved
│   └── src/index.ts           # imports the SAME tool functions above directly (not via MCP), runs on a timer
├── hermes.config/            # Hermes project config, Telegram gateway config (intent parsing only)
└── .env.example
```

### 4.2 What each MCP tool does

- `checkVendorPrice({ url, itemId })` — fetches a signed price quote from one of an order's `vendor_urls`. **This is not something you build** — the mock vendor site is your teammates' deliverable, per your split. What you owe *them* is a spec: their endpoint must expose `GET /api/price?item=<id> → {"item": "<id>", "price_cents": 950, "unit": "kg", "ts": <unix_seconds>, "supplier_address": "0x...", "sig": "<hex ed25519 signature over item|price_cents|ts|supplier_address>"}` — **price as an integer in cents, not a decimal**, so the exact bytes being signed and later verified on-chain are unambiguous (float serialization differences between their stack and Move's would otherwise break signature verification). Signed with a keypair they generate and hand you the public key for (registered into the contract's `VendorRegistry` via `AdminCap`, §3). This closes the price/payee trust gap the eng review found — the contract verifies the signature itself, not just the agent's word. Send them this spec before they start; don't let scope drift to raw HTML scraping (fragile) or unsigned JSON (the trust gap comes right back).
- `getOrder({ orderId })` — reads on-chain object via `SuiClient.getObject`, returns status/target/current price/vendor_urls.
- `getActiveOrders()` — derives the currently-`Locked` order set by querying `OrderCreated` events (paginated via cursor, not a full re-fetch each call — see §5.2's matching fix) and subtracting IDs already seen in `OrderFulfilled`/`OrderCancelled`. This is what makes the watcher (§4.3) restart-safe: it never holds "orders to watch" only in memory, it re-derives the set from chain state every time it needs it, satisfying §9.1's reliability principle.
- `createOrder({ itemId, vendorUrls, targetPriceCents, quantity, paymentAmountMist })` — builds the `create_order` PTB. Note `targetPriceCents` is a direct USD-cents conversion of what the owner said ("$10/kg" → `1000`) — no exchange-rate math happens here, the contract's `VendorRegistry.rate_mist_per_cent` handles the only $↔SUI conversion in the whole system (§3). **The owner signs this one, not the agent** — it's their money. The tool returns an unsigned transaction; the owner's browser signs it via the zkLogin flow in §4.5 (a real per-order signing step, not a server-side replay — see §4.5 for why). During early development, this can be signed by the throwaway stand-in keypair from §3's build checklist step 5 instead, per §7's build-order note.
- `executeOrder({ orderId, priceCents, supplierAddress, ts, sig })` — signs and submits with the `AgentCap` keypair, passing through the vendor's signed price quote unmodified (same USD-cents unit end to end) for on-chain verification. Called only by the deterministic watcher (§4.3), never by the LLM directly.
- `cancelOrder({ orderId })` — owner-signed, same signing path as `createOrder`. The demo's escape hatch for a stuck order (§9.2) — note it shares create_order's zkLogin dependency, it isn't a fully independent fallback.

### 4.3 Orchestration loop

The settlement loop is a **deterministic watcher process** (`agent/watcher/`), not an LLM tool-calling loop — see §4.1's architecture note for why. Two ways to trigger it, both calling the exact same code:

1. **Scheduled**: the watcher runs on a plain `setInterval`/cron every 15–30s: `getActiveOrders()` → for each, `checkVendorPrice()` against its `vendor_urls` → if `price <= target_price`, call `executeOrder()`. No LLM call anywhere in this path.
2. **Telegram-triggered**: owner (or presenter, live) messages the bot "check now" → Hermes recognizes this as a trigger intent (still just intent parsing, not decision-making) and invokes the watcher's check function directly, immediately, instead of waiting for the next tick. Good for the on-stage demo since you don't want to wait on a timer.

Hermes's own role is now scoped to exactly one thing: parsing the owner's natural-language order request into `{itemId, vendorUrls, targetPrice, quantity, amountSui}` at creation time, and relaying status messages back to Telegram. It never decides when to settle.

### 4.4 Telegram gateway

`hermes gateway setup` walks through registering a bot with BotFather and wiring the token in. Natural-language parsing ("Lock $500 for 50kg Coffee Beans at target $10/kg" → `{itemId, targetPriceCents: 1000, quantity: 50, paymentAmountMist}`) is just the system prompt + tool-calling Hermes already does — no custom NLP needed, that's the whole point of using an LLM agent here. Per §4.1's architecture note, this is the *only* place Hermes's LLM touches the money path — everything after order creation runs through the deterministic watcher, not another LLM call.

### 4.5 zkLogin + sponsored transactions — real, via Enoki

You confirmed real zkLogin, not the custodial-key shortcut. Rolling your own zkLogin (salt server + ZK proving service + epoch-aware ephemeral keys) is genuinely heavy infra — the part worth avoiding isn't the *feature*, it's *hosting your own prover*. Use **Enoki** (Mysten Labs' hosted zkLogin + gas-station service, `@mysten/enoki`) to get real, non-custodial zkLogin without standing up that infra yourself. It bundles both things the research doc wants — zkLogin identity *and* sponsored transactions — behind one SDK and one API key.

**Why this is still "real" zkLogin, not a shortcut:** the owner authenticates with their actual Google account, Enoki's prover generates the actual ZK proof, and the resulting Sui address is derived the standard way (`sub` + salt + OAuth JWT → zk address) — nothing custodial about the address itself. What Enoki removes is *you* having to run the salt/proving backend.

**Correction from the eng review — read this before building step 3.** The first draft of this plan assumed the backend could hold a "stored Enoki session" and sign later transactions with it server-side. That's not how zkLogin actually works: verified directly against Sui's own docs, the ephemeral private key used to sign lives **only in the client that authenticated** and must be present at the moment of every signature — a backend cannot replay a stored session to sign a transaction it wasn't present for. The fix below reflects that: the owner's browser does the actual signing, every time, not just at first login.

**Flow:**
1. **Enoki setup**: create an API key at `portal.enoki.mystenlabs.com`, register a Google OAuth client, point its redirect at a small web page you host (this is the one piece of "web UI" beyond the dashboard — a single route, doubling as both `/auth` and `/sign`, not a full app).
2. **First-time owner auth**: Telegram bot's first reply to a new user includes a magic link to `/auth?telegramUserId=<id>`. Owner taps it, completes Google OAuth in-browser, Enoki's `EnokiFlow` returns a zkLogin Sui address + session. Backend immediately faucets the new address (free testnet SUI, no real money — see the earlier discussion on this in-conversation) so the owner never has to think about funding before their first order. Backend also persists `{telegramUserId → zkLoginAddress}` to the same Railway/Render volume §4.6 already mounts for `.env` and the signing key (not just in memory — a restart shouldn't force every owner to redo Google OAuth). Enoki's own session data (which lets the *browser* skip re-prompting Google on a later visit) is restored client-side by the Enoki SDK itself when the owner returns to `/sign`, not something the backend replays on their behalf.
3. **create_order signing — happens at EVERY order, not just first login**: `createOrder` builds the unsigned tx; the backend sends the owner a link to `/sign?tx=<pending_id>`. The owner taps it, Enoki's client-side SDK silently restores their session (no repeat Google prompt, thanks to step 2's persistence) and signs the transaction *in that browser tab*, then the page submits it (Enoki's gas-station API sponsors the tx, so the owner never touches gas). This is one browser round-trip per order — a small, real UX cost the original draft didn't account for, but it's what makes this genuinely real zkLogin rather than an impossible server-side shortcut.
4. **execute_order signing**: unrelated to zkLogin — this is signed by the `AgentCap` keypair the sui-mcp server holds directly (a normal Ed25519 keypair, not a zkLogin address, since it's the agent acting on its own scoped authority, not on behalf of a user). This step is unaffected by the correction above.

This is more work than the stub (a real OAuth round-trip, a real per-order signing tap, and one hosted web route), but it's a bounded, well-documented integration, not a research project — Enoki exists specifically to make this buildable in a single sitting.

### 4.6 Deployment

For the live demo, don't run this on a laptop tethered to venue WiFi. Options, fastest first:

1. **Railway or Render (recommended)** — Hermes ships a Dockerfile already (`Dockerfile` in the hermes-agent install). Deploy **two processes** from `agent/`, not one — per §4.1/§4.3's architecture, the watcher is intentionally decoupled from Hermes's own LLM loop, so it shouldn't run through `hermes cron` (which would route it back through Hermes's agent runtime, reintroducing the nondeterminism the eng review specifically removed):
   - **Process A — Hermes gateway**: `hermes gateway start`, with the sui-mcp stdio server as a child process (`hermes mcp add`) for intent-parsing tool calls only.
   - **Process B — the watcher**: `node agent/watcher/dist/index.js`, a plain long-running script with its own `setInterval`, importing the same sui-mcp tool functions directly (no MCP/LLM layer in this process at all).
   - Attach a persistent volume at `/data` for `.env`, Telegram session state, the MCP server's signing key, and the owner-session store from §4.5 step 2.
   - Set env vars: `TELEGRAM_BOT_TOKEN`, `SUI_PACKAGE_ID`, `SUI_AGENT_CAP_ID`, `SUI_VENDOR_REGISTRY_ID`, `AGENT_PRIVATE_KEY`, `SUI_RPC_URL`, `ENOKI_API_KEY`.
   - Expose nothing publicly required for Telegram (it's outbound long-polling or webhook — either works; long-polling is simpler and avoids needing a public HTTPS endpoint). The `/auth`+`/sign` route (§4.5) does need a public HTTPS endpoint, hence living in `dashboard/`'s deployment rather than here.
2. Keep a **local fallback**: run both processes in foreground on a laptop with hotspot tethering as backup in case the cloud deploy has issues on stage — cheap insurance.

**Setup commands** (run once the contract, including `VendorRegistry`, is deployed):
```bash
hermes gateway setup            # wire up Telegram bot token
hermes mcp add sui-tools --command node --args agent/sui-mcp/dist/server.js
cd agent/watcher && npm install && npm run build && node dist/index.js   # start the watcher as its own process
```

---

## 5. Dashboard (`dashboard/`)

### 5.1 Stack

Next.js (App Router) + `@mysten/sui` (`SuiClient`) + `@mysten/sui/graphql` for event subscriptions. Single page, no auth needed (read-only public demo view) — don't build a login system for this, it's not on the critical path.

### 5.2 Layout — exactly the three elements the research doc scopes, nothing more

```
┌─────────────────────────────────────────────────────────────┐
│  Giam Siap — Escrow Monitor                    ● Live (testnet)│
├─────────────────────────────────────────────────────────────┤
│  ESCROW VAULT TRACKER                                          │
│  ┌──────────────────┐  ┌──────────────────┐                   │
│  │ Locked in escrow  │  │ Total settled    │                   │
│  │   1,250 SUI       │  │   3,400 SUI      │                   │
│  └──────────────────┘  └──────────────────┘                   │
├─────────────────────────────────────────────────────────────┤
│  LIVE ORDER TABLE                                               │
│  Order ID   Owner        Target   Current   Status             │
│  0xab12..   0x9f3c...    $10.00   $12.00   🟡 MONITORING       │
│  0x7cd4..   0x9f3c...    $10.00   $9.50    🟢 EXECUTED         │
├─────────────────────────────────────────────────────────────┤
│  TRANSACTION LOG                                                │
│  ✓ Order 0x7cd4 executed at $9.50/kg → suiscan.xyz/tx/abc123   │
│  ✓ Order 0x1122 created, 500 SUI locked → suiscan.xyz/tx/def   │
└─────────────────────────────────────────────────────────────┘
```

- **Escrow Vault Tracker**: sum `escrow.value()` across `Locked` orders vs. sum of historical `OrderFulfilled.price*quantity` — query via `getOwnedObjects`/`queryEvents` filtered by package+module, or (cleaner) index events into an in-memory/lightweight store polled every 5s. Don't build a real indexer/DB for this MVP — polling `queryEvents` client-side every few seconds is fine at demo scale.
- **Live Order Table**: `client.getDynamicFields`/`multiGetObjects` on known order IDs (tracked from `OrderCreated` events) → shows `status` field directly from the Move object, badge color keyed off it.
- **Transaction Log**: append-only list built from `OrderCreated` + `OrderFulfilled` events, each linking to `https://suiscan.xyz/testnet/tx/<digest>`.

Poll on a `setInterval` (5s) calling `SuiClient.queryEvents({ MoveEventModule: { package, module: 'procurement' } }, cursor)` — track the cursor from the previous response and pass it back in, appending only new events to local state instead of re-fetching the full history every tick. This is the same event-pagination pattern §4.2's `getActiveOrders` tool needs anyway (eng review finding), so it's not new work, just applying it here too — and it keeps every poll cheap regardless of how many test orders accumulate over a long rehearsal session (§8.6). No websocket/GraphQL subscription complexity needed unless you have spare time.

### 5.3 What NOT to build

No auth, no multi-tenant views, no historical charts, no mobile polish beyond "doesn't look broken." Every hour spent here is an hour not spent making the contract↔agent loop reliable, which is what actually gets demoed.

---

## 6. How the three pieces link — end-to-end

```
Telegram (owner)
   │  "Lock $500 for 50kg coffee at $10/kg"
   ▼
Hermes Agent (LLM: intent parsing ONLY) ──▶ sui-mcp tool: createOrder(...) → unsigned tx
   │                                            │
   │◀── link to /sign?tx=<id> ──────────────────┘
   ▼
Owner's browser: taps link, Enoki restores session (no re-OAuth), SIGNS there, submits
   (gas sponsored by Enoki — owner never touches gas or a wallet)
   ▼
Sui testnet: create_order() ─▶ ProcurementOrder{status:Locked} shared object
                                  │ (invariant checked: escrow covers quantity×target_price)
                                  │ emits OrderCreated
                                  ▼
                          Dashboard polls queryEvents(cursor) → shows LOCKED row

Watcher process (every 15-30s, NO LLM) ──▶ getActiveOrders() → checkVendorPrice(vendor_url) → signed quote
   │                                  │
   │                          price > target? → log "monitoring", no-op
   │                          price ≤ target, sig valid? ─▶ sui-mcp: executeOrder(...)
   ▼                                            │
Telegram: "Monitoring active..."                ▼
                                        Sui testnet: execute_order()
                                          → verifies vendor signature against VendorRegistry
                                          → escrow splits to supplier (rate-converted to MIST)
                                          → status = Fulfilled, order.supplier recorded
                                          → emits OrderFulfilled
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                                ▼
              Dashboard: row → EXECUTED,          Telegram: "🎉 Order
              tx log gets suiscan link             Executed at $9.50/kg!"
                                                    + suiscan link
```

The **contract is the source of truth**; the agent is a trigger, the dashboard is a read-only mirror, and Telegram is the human interface. This means contracts get finished and deployed to testnet *first*, before anything else — both the agent and the dashboard are built against its ABI/events and can't be meaningfully tested without it.

---

## 7. Build sequence — one continuous run to a live testnet service

No calendar days. This is a dependency-ordered pipeline: each stage unblocks the next, so work it in order, straight through, until step 8 is a real Telegram bot settling real testnet transactions that the dashboard shows live. Everything here is yours except the mock vendor site itself (teammates own the implementation) — hand them the interface spec in step 2 and let them build in parallel while you continue.

**Sequencing correction from the eng review**: the original order put zkLogin integration (a real OAuth+browser-signing round-trip, see §4.5) directly in the middle of the critical path, blocking everything after it. Real zkLogin now comes *later* in the sequence — steps 2-5 use a throwaway stand-in keypair for owner-signing (§3 build checklist step 5) so the core loop is provable before the hardest integration is even started. Swap the stub for real zkLogin in step 6, once everything it depends on already works.

**Priority line, in case time runs short** — read this now, not mid-crunch:
- **P0 (this is the deliverable, per §0.4):** contract deployed with the signed-vendor-response scheme (§3) — it's load-bearing to `execute_order` itself, not an add-on, so it can't be cut without redesigning settlement; the sui-mcp tools; the deterministic watcher; the dashboard; Hermes/Telegram wiring; one full end-to-end pass (step 8), even if it's still running on the stand-in signer.
- **P1 (do these, but they're the first things to drop if the clock wins):** swapping the stand-in for real zkLogin (step 6) — if this doesn't land in time, the honest fallback is the custodial-key shortcut this plan explicitly chose against, clearly labeled in the pitch as a scope cut, not hidden; the full three-tier automated test suite (§10) — the manual §8 checklist is the fallback, not nothing; dashboard event-cursor pagination (§5.2) — matters for a long rehearsal day, not for the demo itself.

0. **Setup** (§2) — Sui CLI + testnet account, `sui-docs` MCP registration, Enoki account creation (still do this now — OAuth client setup doesn't block on anything, only the *signing swap* in step 6 does). All unblocked, do it first.
1. **Contract, deployed** — write `giam_siap::procurement` (§3): `ProcurementOrder`, `AgentCap`, `AdminCap`, `VendorRegistry`, `create_order`/`execute_order`/`cancel_order`, the three events, the escrow-sufficiency invariant, the ed25519 signature check. `sui client publish`, save `packageId`, mint `AgentCap`/`AdminCap`, create `VendorRegistry` with your chosen fixed rate. Generate the throwaway stand-in keypair for owner-signing during steps 2-5. Nothing downstream can be tested against real state until this exists.
2. **Two things in parallel once the contract is live:**
   - **(a) sui-mcp server + watcher** — scaffold `agent/sui-mcp/` and `agent/watcher/` (§4.1), wire `SuiClient` to the deployed package, implement all six tools including `getActiveOrders` and `cancelOrder`. Test each from the CLI directly against the real testnet contract, signing `createOrder` calls with the stand-in keypair — confirm `create_order` locks funds, `execute_order` actually verifies a signature and splits/pays out, before adding any Hermes orchestration on top. Write a trivial local JSON stub endpoint for `checkVendorPrice` to test against too, so you're not blocked waiting on teammates' real endpoint.
   - **(b) Hand teammates the signed vendor interface spec** — `GET /api/price?item=<id> → {item, price_cents, unit, ts, supplier_address, sig}` (§4.2), including that they need to generate an ed25519 keypair and give you the public key. This supersedes the research doc's "Hybrid 3-URL" scraping idea — real external sites are dropped (§5.2/§9.2) in favor of controlled, signed endpoints only.
3. **Hermes wiring** — connect the MCP server per §2.3 (`hermes mcp add sui-tools`), then `hermes gateway setup` for Telegram/BotFather, then confirm natural-language intent parsing produces correct `createOrder` tool calls (still against the stand-in signer). At this point a live Telegram message should be able to lock real testnet SUI into a real order.
4. **Autonomous loop** — start the watcher (§4.6, its own process, not `hermes cron`) polling `checkVendorPrice` every 15–30s against your local stub first, then teammates' real endpoint once it's live, calling `executeOrder` when a validly-signed price matches. Also wire the "check now" Telegram-triggered path. Register teammates' real public key into `VendorRegistry` (via `AdminCap`) as soon as they hand it over.
5. **Dashboard** — scaffold Next.js, poll `queryEvents` with a cursor (§5.2) for the deployed package, build the three elements against the *same live contract* the watcher is now settling orders on. You should be able to watch a row flip from MONITORING to EXECUTED in real time as step 4 fires — all still on the stand-in signer at this point, which is fine, the loop itself is what's being proven.
6. **zkLogin swap-in (Enoki)** — now that the rest of the loop is provably working, stand up the `/auth`+`/sign` route, get one real owner login working end-to-end (Google consent → zkLogin address → auto-faucet → persisted session, §4.5), and get a real per-order browser-signed `create_order` working. Swap `createOrder`'s signer from the stand-in keypair to this real flow. This is the P1 item from the priority line above — if it's not solid yet, the stand-in signer keeps the rest of the system demoable while you keep working it.
7. **Deploy for real usage** — Hermes gateway + watcher (two processes) to Railway/Render (Dockerfile + persistent volume per §4.6), dashboard (including `/auth`+`/sign`) to Vercel. Keep the local dual-process fallback for the demo stage.
8. **End-to-end pass, on the real signing flow** — from a cold Telegram chat: authenticate via real zkLogin, lock funds via a real browser signature, watch the watcher monitor, trigger (or wait for) a validly-signed price match, confirm settlement on-chain, watch the dashboard update, follow the Suiscan link, and confirm `cancel_order` also works through the same real signing flow. If this whole chain runs clean once, it'll run clean again — that's the deliverable §0.4 describes.

**Concrete next action**: install the Sui CLI and start on step 1 — everything else is blocked on a deployed `packageId`.

---

## 8. Acceptance criteria — per component, testable

§0.4 and §0.6 state the goal in narrative form. This section breaks it into checklists you can actually tick off while building each piece, rather than only finding out something's wrong during the full end-to-end pass in step 8 of §7.

### 8.1 Smart contract (§3)

- [ ] `create_order` reverts if `target_price == 0`, `quantity == 0`, or the locked coin's value is less than `(quantity * target_price) * rate_mist_per_cent` (the escrow-sufficiency invariant — this must fail at creation, never at settlement).
- [ ] `create_order` locks exactly the coin passed in, sets status `Locked`, and emits exactly one `OrderCreated` with correct `owner`/`target_price`/`quantity`/`vendor_urls`.
- [ ] `execute_order` reverts when `sig` doesn't verify against `VendorRegistry.trusted_pubkey` for the given `(item_id, price, ts, supplier)` — a forged or mismatched signature must never settle an order.
- [ ] `execute_order` reverts when `ts` is stale (replaying an old, once-valid signed quote must not work).
- [ ] `execute_order` reverts the whole transaction (no partial state) when `price > target_price`, even with a validly-signed quote.
- [ ] `execute_order` reverts when called without a valid `AgentCap` reference.
- [ ] `execute_order` reverts if the order's status isn't `Locked` (blocks double-execution and executing a cancelled order).
- [ ] `execute_order` on success: supplier receives exactly `(quantity * price) * rate_mist_per_cent` MIST, owner receives the exact remainder, `order.supplier` is written, status becomes `Fulfilled`, exactly one `OrderFulfilled` emitted.
- [ ] `cancel_order` is owner-only, refunds the full escrow, sets `Cancelled`, emits `OrderCancelled`.
- [ ] `cancel_order` reverts on anything but a `Locked` order.
- [ ] `AdminCap` can update `VendorRegistry.trusted_pubkey` without a package redeploy (needed once teammates hand over their real key).

### 8.2 sui-mcp tools (§4.2)

- [ ] `checkVendorPrice` returns a signed price quote for a valid endpoint within a 10s timeout.
- [ ] `checkVendorPrice` fails loudly on an unreachable, malformed, or unsigned/invalid-signature endpoint — never silently returns `0`/`null`/an unverified value (a false "price = 0" would trigger a false settlement; see §9.1).
- [ ] `getOrder` returns accurate on-chain status/target/escrow/vendor_urls for a known order ID.
- [ ] `getActiveOrders` returns exactly the currently-`Locked` order IDs — correctly excludes anything already `Fulfilled`/`Cancelled`, and correctly re-derives the full set after a fresh cold start (no reliance on prior in-memory state).
- [ ] `createOrder` returns an unsigned transaction that, once signed (stand-in keypair during dev, real zkLogin later), the network actually accepts.
- [ ] `executeOrder` refuses to fire when `price > targetPrice` as a first line of defense in the tool itself — the contract enforces this too, but checking client-side avoids wasting a doomed on-chain call.
- [ ] `cancelOrder` returns an unsigned transaction that, once owner-signed, successfully cancels a `Locked` order.

### 8.3 Telegram / orchestration (§4.3, §4.4)

- [ ] The exact demo phrasing ("Procure 50kg Coffee Beans... target price $10/kg") parses to the correct `{itemId, targetPrice, quantity}` **5 times in a row** — LLM parsing isn't fully deterministic, so test repeatedly, not once.
- [ ] The cron job checks every currently `Locked` order each cycle, not just the most recently created one.
- [ ] The "check now" Telegram trigger produces the same result as waiting for the next cron tick.
- [ ] The owner receives at least one monitoring-status message before settlement (proves the autonomy is visible, not a black box).
- [ ] The owner receives a settlement confirmation with a working Suiscan link.

### 8.4 zkLogin / Enoki (§4.5)

- [ ] A new Telegram user completing `/auth` ends up with a valid zkLogin Sui address, auto-faucet-funded by the backend immediately, with no manual step from the owner.
- [ ] A returning user visiting `/sign` skips the Google OAuth prompt (session restored client-side) but still performs a real in-browser signature for that specific order — confirm this happens every time, not just at first login.
- [ ] The owner-session store (§4.5 step 2) survives a full restart of the agent process — a returning owner doesn't need to redo Google OAuth just because the container restarted.
- [ ] A `create_order` transaction signed in the browser via the real zkLogin flow succeeds on testnet with Enoki-sponsored gas — the owner's own SUI balance used for gas is exactly zero.
- [ ] `cancel_order`, signed via the same real zkLogin flow, successfully cancels a `Locked` order end-to-end.

### 8.5 Dashboard (§5)

- [ ] A newly created order appears in the Live Order Table within one polling interval, with correct fields.
- [ ] Status badge transitions (LOCKED → MONITORING → EXECUTED) match actual on-chain status, never a stale cached value.
- [ ] Escrow Vault Tracker totals reconcile against a manual spot-check on Suiscan.
- [ ] Every transaction log entry's Suiscan link resolves to the actual corresponding transaction.

### 8.6 End-to-end (ties back to §0.6)

- [ ] The full owner story (§0.6) completes cold, with zero manual intervention after the single approval step.
- [ ] The full supplier story (§0.6) completes with zero manual intervention at any step.
- [ ] **Both run successfully twice in a row without restarting anything.** This is the single highest-value check in this whole section — most demo-day failures are second-run bugs (stale cron state, an order counted twice, a session that doesn't survive reuse), not first-run bugs, and you will not catch them by only ever running the loop once.

---

## 9. Failure modes & fallbacks

Two different concerns, both real: **runtime resilience** (what the system itself should do when something goes wrong) and **demo-day resilience** (what you, the human, do when something goes wrong live). The research doc's "Hybrid 3-URL" idea and the local-gateway backup already cover part of the second category — this section makes both categories complete and explicit.

### 9.1 Runtime failure matrix

| Failure | Detection | Fallback behavior |
|---|---|---|
| Vendor endpoint unreachable or times out | `checkVendorPrice` fetch error | Skip this poll cycle, log it, retry next cycle. Never treat a failed fetch as "price = 0" — that would trigger a false settlement, which is worse than doing nothing. |
| Vendor endpoint returns malformed data, or a price whose signature doesn't verify against `VendorRegistry` | Schema check + signature check inside `checkVendorPrice` before returning a value | Same as above — skip, log; if it fails 3 cycles in a row, send yourself (not the owner) a Telegram alert so a broken interface or a stale/wrong registered public key doesn't fail silently for the whole demo. |
| Sui RPC down or slow | Transaction submission timeout in sui-mcp | Retry with backoff, 3 attempts. If still failing, `executeOrder` reports failure back to the cron loop rather than crashing it — one bad order should never stop monitoring of every other order. |
| `execute_order` reverts on-chain (e.g. someone else cancelled the order between check and execute) | Transaction result inspection | Log clearly; re-check the order's current status before retrying — if it's already `Fulfilled`/`Cancelled`, this was a race, not a bug, and retrying blindly would be wrong. |
| Enoki session expired | Signing call returns an auth error | Prompt the owner to re-auth via the `/auth` link; never silently drop the order. |
| Hermes process crashes or the cron loop stops | Railway/Render health check, or manual `hermes status` | Container auto-restart handles the process. The design requirement this forces: the agent's list of "orders to watch" must always be **derived by querying the contract for `Locked` orders**, never held only in memory — otherwise a restart silently stops monitoring every order that was locked before the crash. |
| Dashboard RPC polling fails or gets rate-limited | Fetch error in the poll loop | Show a "reconnecting" indicator instead of silently freezing on stale data. A frozen dashboard reads as broken even when the chain state is actually fine. |

### 9.2 Demo-day fallbacks (consolidated — these were already scattered through earlier sections)

- **Agent hosting**: primary is the Railway/Render deployment (§4.6); fallback is `hermes gateway run` on a tethered laptop — **rehearsed at least once beforehand**, not assumed to work cold if you're forced onto it live.
- **Price-match guarantee**: your team controls the vendor endpoint(s) directly (§7 step 2b — the eng review dropped the original "Hybrid 3-URL" idea of also scraping real external sites, since those are anti-bot-protected and would likely block a cloud-hosted agent mid-demo), so the price-match moment is never left to chance.
- **A stuck order**: `cancel_order` (§3) exists so a demo order that never matches isn't a dead end. Note it's owner-signed via the same real zkLogin browser flow as `create_order` (§4.5) — it isn't a fully independent fallback if zkLogin itself is the thing having trouble on stage. Rehearsing the cancel flow is part of §8.6's run-twice rule for exactly this reason: any fragility here should surface during rehearsal, not on stage.
- **The run-twice rule**: per §8.6, rehearse the entire loop twice back-to-back before presenting. This is the cheapest insurance in the whole plan and catches the failure mode that actually tends to bite on stage.

---

## 10. Testing — automated coverage, not just the manual §8 checklist

§8's checklist tells you whether the system works *right now*, by hand. It says nothing about whether a change on day 2 quietly breaks something that worked on day 1 — that's what automated tests are for, and the plan had none until this review. Three tiers, chosen because each is cheap for what it covers, not because "more tests" is the goal for its own sake:

### 10.1 Move unit tests (`contracts/tests/procurement_tests.move`)

Run via `sui move test` — fully offline against a simulated chain, no testnet gas, no network flakiness, fast enough to run before every publish. Write one test per revert branch in §8.1's checklist:
- `test_create_order_happy_path` — funds lock, `OrderCreated` emitted with correct fields.
- `test_create_order_rejects_zero_target_price`, `test_create_order_rejects_zero_quantity`.
- `test_create_order_rejects_insufficient_escrow` — the invariant from Tension 3, using a `test_scenario` with a deliberately-underfunded coin.
- `test_execute_order_happy_path` — valid signature, correct split/refund/status/event, `order.supplier` written.
- `test_execute_order_rejects_invalid_signature`, `test_execute_order_rejects_stale_timestamp`, `test_execute_order_rejects_price_above_target`, `test_execute_order_rejects_wrong_status`, `test_execute_order_rejects_missing_agent_cap`.
- `test_cancel_order_happy_path`, `test_cancel_order_rejects_non_owner`, `test_cancel_order_rejects_non_locked_status`.
- `test_admin_can_rotate_vendor_pubkey`.

This is the highest-leverage test tier in the whole plan: it's the money logic, it's nearly free to write with CC given how templatable Move test boilerplate is, and it catches a fund-loss bug before you ever touch testnet.

### 10.2 sui-mcp tool tests (`agent/sui-mcp/src/tools/*.test.ts`, Vitest)

Mock `SuiClient` and `fetch` — no real network calls, no testnet dependency, runs in CI in seconds:
- `checkVendorPrice`: happy path (valid signed quote), timeout (mocked fetch never resolves → confirm it skips, doesn't return 0), malformed JSON, invalid signature (confirm it's rejected client-side, not just relying on the contract).
- `getActiveOrders`: correctly derives the Locked set from mocked event pages, correctly excludes Fulfilled/Cancelled IDs, correctly pages via cursor across mocked multi-page responses.
- `createOrder`/`executeOrder`/`cancelOrder`: produce well-formed unsigned transactions from valid inputs; `executeOrder` refuses to build a call when `price > targetPrice` (the client-side guard from §8.2).

### 10.3 One Playwright E2E test — the owner story (`dashboard/e2e/owner-flow.spec.ts`)

Everything above tests components in isolation; nothing catches a break in the Telegram→zkLogin→contract→dashboard chain itself, which is the actual thing being demoed. Run this against testnet (real, not mocked) as the final gate before any demo/rehearsal:
1. Simulate the Telegram intent message (or call the parsing function directly if driving real Telegram in CI is impractical — document which if so).
2. Complete the `/auth` → `/sign` flow in a real headless browser.
3. Confirm `ProcurementOrder` exists on-chain with `Locked` status.
4. Trigger a price match against a local stub vendor endpoint.
5. Confirm settlement on-chain and the dashboard reflects `EXECUTED` within one poll interval.

This is the single test that would have caught the Enoki server-side-signing assumption (Tension 1) immediately, had it existed before that assumption was written down — a fast unit-test suite proves the parts work, an E2E test proves the *chain* of parts works, and this plan specifically needed the second kind.

**Where this fits in the build sequence**: write Move tests alongside §7 step 1 (same sitting, same file you're already writing), Vitest tests alongside §7 step 2a, and the E2E test once step 6's real zkLogin flow lands — it can't meaningfully run before that exists. If time runs out per §7's priority line, the E2E test is P1 alongside the zkLogin swap-in itself; the Move and Vitest tiers are cheap enough to stay P0.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 16 findings (8 architecture/code-quality/test/performance + 8 cross-model tensions), all resolved and applied to the plan |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**CODEX:** Codex CLI is installed and authenticated but timed out after 5 minutes on this review; fell back to a Claude subagent per the skill's error-handling path.

**CROSS-MODEL:** The Claude subagent (outside voice) found 9 points the 4-section review missed, 8 of them substantive enough to present individually. Two were rated critical: the zkLogin server-side-signing design was verified against Sui's own docs to be technically impossible as originally written (fixed: real per-order browser signing), and nothing funded a new owner's escrow before their first order (fixed: auto-faucet on auth). Both are now resolved in the plan, not just documented as known issues.

**VERDICT:** ENG CLEARED — ready to implement. No other review is required to ship; CEO and Design reviews remain available but optional (offered, declined in favor of proceeding directly to build).

NO UNRESOLVED DECISIONS
