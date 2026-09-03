# TODOS

## Contracts

### Multi-vendor VendorRegistry

**What:** Generalize `VendorRegistry.trusted_pubkey` (currently one key) into a `Table<address, vector<u8>>` supporting multiple registered vendors, with each order referencing which vendor(s) it trusts.

**Why:** The MVP hardcodes one demo vendor's signing key. A real product would have many suppliers, each needing their own signing identity — the research doc's supplier story assumes exactly this.

**Context:** Surfaced during the `/plan-eng-review` pass on 2026-09-03. Today's single-pubkey design (see IMPLEMENTATION_PLAN.md §3, adopted to close a price/payee trust gap the review found) is intentionally the simplest version that still closes that gap for one vendor. This is the scaling path once there's more than one.

**Effort:** M
**Priority:** P3
**Depends on:** The signed-vendor-response scheme (§3, §4.2) already being solid in production use.

### On-chain OrderRegistry (scaling upgrade for order discovery)

**What:** Replace or augment the event-derived `getActiveOrders` tool (§4.2) with a shared `Table<ID, u8>` registry object, updated by every `create_order`/`execute_order`/`cancel_order` call, giving O(1) order-status lookups instead of event-log replay.

**Why:** Event replay is the correct, boring choice at demo scale (no extra shared-object writes, no contention point), but degrades as order-history volume grows over the system's lifetime.

**Context:** Surfaced during the `/plan-eng-review` pass on 2026-09-03, discussing how the agent discovers which orders are currently `Locked`. The registry alternative was explicitly evaluated and rejected for the MVP — it adds a write to every contract function (a single shared-object bottleneck under concurrent settlement) for a benefit this MVP's actual order volume doesn't need yet. Don't build speculatively — revisit only if real usage shows event-replay is actually too slow.

**Effort:** M
**Priority:** P4
**Depends on:** None — but should wait for real usage data before starting.

## Infrastructure

### CI pipeline for the automated test suite

**What:** A GitHub Actions workflow running `sui move test` and the Vitest tool-test suite (§10.1, §10.2) on every push, plus the Playwright E2E test (§10.3) at minimum before any commit tagged demo-ready.

**Why:** §10 specifies what tests to write, not how they run automatically. Without CI, a regression is only caught if someone remembers to run the suite by hand before each change.

**Context:** Surfaced during the `/plan-eng-review` pass on 2026-09-03 as a distribution/CI gap — the review's own process requires flagging this explicitly rather than letting it drop silently. A Move-tests-only workflow is cheap and catches the highest-value regression class (contract bugs) immediately; the E2E job is harder to run in CI given testnet/faucet rate limits and may be better kept as a manual pre-demo gate for now.

**Effort:** S (Move-tests-only workflow) / M (full suite including E2E in CI)
**Priority:** P2
**Depends on:** §10's test suite existing first.

### Wire the watcher's `checkNow()` and `onAlert` hooks to Telegram (§4.3 point 2, §9.1)

**What:** Once Hermes/Telegram wiring exists (§7 step 3), connect the "check now" Telegram intent to `agent/watcher/src/index.ts`'s exported `checkNow()` function (so a live demo doesn't have to wait on the poll interval), and replace `onAlert`'s current `console.error` stand-in with an actual Telegram message to yourself (not the owner) when a vendor's failure streak crosses `WATCHER_ALERT_THRESHOLD`.

**Why:** The watcher (below, now built) intentionally deferred both of these — they need Hermes's Telegram gateway to exist first, which is a separate, not-yet-done build step (§7 step 3).

**Context:** Surfaced 2026-09-03 while building the watcher. Both hooks are already exported/injectable (`checkNow` from `index.ts`, `onAlert` in `loop.ts`'s `WatcherDeps`) specifically so this is a wiring task, not a redesign.

**Effort:** S
**Priority:** P1 — depends on §7 step 3 landing first.
**Depends on:** Hermes/Telegram gateway wiring (§7 step 3).

### Give Hermes persistent project context for order creation (`agent/hermes.config/`, §4.1)

**What:** Hermes correctly parses NL intent into `createOrder` arguments when the owner's address, `VendorRegistry.rate_mist_per_cent`, and each item's vendor URL are supplied as context in the prompt (verified 5/5 times, see IMPLEMENTATION_PLAN.md's "Current status") — but nothing today supplies that context automatically inside a real Telegram conversation. Build `agent/hermes.config/` (named in §4.1's structure but not yet created) with whatever Hermes actually auto-loads per conversation (its own docs/`--ignore-rules` help text mentions `AGENTS.md`/`SOUL.md` auto-injection) containing: the current rate, the item→vendor-URL table, and instructions never to call `executeOrder` (that's the watcher's job only).

**Why:** Without this, a real Telegram message can't actually produce a correct `createOrder` call — the test that passed this session only worked because I fed Hermes the missing facts by hand in the prompt.

**Context:** Surfaced 2026-09-03 while validating §8.3's NL-parsing checklist item via `hermes -z` oneshot mode. Also unconfirmed: whether the live Telegram gateway's conversations actually run with this repo as their working directory (which is what would make a repo-local `AGENTS.md` auto-inject) — needs checking against how this Hermes install's gateway was set up (`hermes project`/`hermes gateway setup`), since that determines where this config file actually needs to live.

**Effort:** S
**Priority:** P0 — blocks §7 step 3's "a live Telegram message should be able to lock real testnet SUI into a real order" from being true.
**Depends on:** Nothing — unblocked now.

### Bridge `createOrder`'s unsigned tx to a signer before real zkLogin exists (§7 steps 3-5's stand-in signer)

**What:** `createOrder` returns unsigned tx bytes by design (§4.5 — only the owner should sign). `e2e-smoke.ts` signs those bytes inline with the stand-in keypair as a one-off manual script, but nothing in the Hermes-triggered path (Telegram → Hermes → `createOrder` tool) can sign and submit that transaction today. Until either this or real zkLogin (§7 step 6) exists, a live Telegram order request can get an unsigned tx built and nothing further — it cannot lock funds.

**Why:** §7's own sequencing intentionally defers real zkLogin past steps 2-5 specifically so "the core loop is provable before the hardest integration is even started" (§7's sequencing-correction note) — but that provability requires *some* signer in the loop, and right now there isn't one outside a manual script.

**Context:** Surfaced 2026-09-03 alongside the item above, while checking what "a live Telegram message should be able to lock real testnet SUI into a real order" (§7 step 3) actually requires end-to-end. Needs a decision, not just code: e.g. a dev-only `/sign`-shaped stub that auto-signs with the stand-in keypair (mimicking the shape of §4.5's real flow so swapping it out later is mechanical), versus a temporary direct signing step inside the watcher or a small bridge script. Whatever's chosen should be clearly dev-only and easy to delete when §7 step 6 lands, per §7's own priority line about not letting stand-ins linger past their purpose.

**Effort:** S-M depending on approach
**Priority:** P0 — same blocker as the item above.
**Depends on:** Nothing — unblocked now, but worth deciding the approach deliberately rather than improvising it.

## Completed

- **sui-tools MCP server connected to Hermes, and NL intent parsing validated live** (§7 step 3, first half) — 2026-09-03. `hermes mcp add sui-tools --command node --args <abs path>\agent\sui-mcp\dist\server.js` registered and connects cleanly (`hermes mcp test sui-tools`: 6/6 tools discovered). Confirmed Telegram/Discord/WhatsApp gateway credentials and the gateway service already existed on this machine from prior setup, so that sub-step of §7 step 3 needed no work. Validated §8.3's first checklist item for real: ran the plan's exact demo phrasing through `hermes -z` (oneshot) 5 times in a row, every run producing the identical correct `createOrder` call (`itemId=coffee, targetPriceCents=1000, quantity=50, paymentAmountMist=50000000`) and a successfully-built unsigned tx. Along the way, added self-loading `.env` support (via `dotenv`, resolved relative to each package's own source location) to both `agent/sui-mcp/src/config.ts` and `agent/watcher/src/config.ts` — without it, `hermes mcp add`'s spawned `node dist/server.js` subprocess had no env vars at all. Two real gaps found by this test and **not yet closed** — see the two new P0 items above: Hermes has no persistent, automatic source for the owner address/rate/vendor-URL context this test fed it by hand, and nothing in the Hermes-triggered path can actually sign the unsigned tx `createOrder` returns.
- **Deterministic watcher process built** (§4.1, §4.3, §7 step 4) — 2026-09-03. `agent/watcher/src/index.ts` runs a plain `setInterval` loop (`getActiveOrders()` → `getOrder()` → `checkVendorPrice()` → `executeOrder()`, no LLM) against the same sui-mcp tool functions Hermes uses, imported as a real local package dependency (`agent/sui-mcp` now emits type declarations; `agent/watcher` depends on `"@giam-siap/sui-mcp": "file:../sui-mcp"`). Core tick logic (`agent/watcher/src/loop.ts`) is dependency-injected and covered by 12/12 passing Vitest tests exercising the full §9.1 failure matrix (vendor failures never treated as price=0, alert-after-N-consecutive-failures, retry-with-backoff on transient `executeOrder` failures, race-vs-bug detection on an on-chain revert, one bad order never blocking the rest of a tick). Also added `agent/watcher/dev/vendor-stub.ts`, a local signed-quote HTTP server matching §4.2's vendor interface spec exactly, for testing the loop before teammates' real mock-vendor site exists. Not yet done: wiring `checkNow()`/`onAlert` to actual Telegram (see the new P1 item above) — that's blocked on §7 step 3, not on this work.
- **sui-mcp tool test suite fully green (13/13)** — 2026-09-03. Fixed both the fake-address fixtures and a deeper bug: tests asserted a `.target` field on `MoveCall` commands that the SDK doesn't produce (it splits into `.package`/`.module`/`.function`), and `createOrder`'s test expected 6 arguments against the real 7-argument contract signature (missing the `Clock` param). See IMPLEMENTATION_PLAN.md's "Current status" section.
- **Contract deployed to Sui testnet**, `VendorRegistry` configured (rate + dev vendor pubkey), wallet funded — 2026-09-03.
- **`@mysten/sui` upgraded 1.28.0 → 2.29.0 and ported to the gRPC Core API** (`SuiGrpcClient` replacing the removed `SuiClient`) — 2026-09-03. The public testnet fullnode had removed a JSON-RPC method the old SDK's transaction builder depended on; this was a hard, unconditional break, not an edge case. See IMPLEMENTATION_PLAN.md's "Current status" section for the full list of what this touched.
- **Full `create_order → execute_order` loop confirmed live on testnet** (real escrow lock, real signature verification, real payout to a fresh address) via `agent/sui-mcp/e2e-smoke.ts` — 2026-09-03.
