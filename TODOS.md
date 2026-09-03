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

## Completed

- **Deterministic watcher process built** (§4.1, §4.3, §7 step 4) — 2026-09-03. `agent/watcher/src/index.ts` runs a plain `setInterval` loop (`getActiveOrders()` → `getOrder()` → `checkVendorPrice()` → `executeOrder()`, no LLM) against the same sui-mcp tool functions Hermes uses, imported as a real local package dependency (`agent/sui-mcp` now emits type declarations; `agent/watcher` depends on `"@giam-siap/sui-mcp": "file:../sui-mcp"`). Core tick logic (`agent/watcher/src/loop.ts`) is dependency-injected and covered by 12/12 passing Vitest tests exercising the full §9.1 failure matrix (vendor failures never treated as price=0, alert-after-N-consecutive-failures, retry-with-backoff on transient `executeOrder` failures, race-vs-bug detection on an on-chain revert, one bad order never blocking the rest of a tick). Also added `agent/watcher/dev/vendor-stub.ts`, a local signed-quote HTTP server matching §4.2's vendor interface spec exactly, for testing the loop before teammates' real mock-vendor site exists. Not yet done: wiring `checkNow()`/`onAlert` to actual Telegram (see the new P1 item above) — that's blocked on §7 step 3, not on this work.
- **sui-mcp tool test suite fully green (13/13)** — 2026-09-03. Fixed both the fake-address fixtures and a deeper bug: tests asserted a `.target` field on `MoveCall` commands that the SDK doesn't produce (it splits into `.package`/`.module`/`.function`), and `createOrder`'s test expected 6 arguments against the real 7-argument contract signature (missing the `Clock` param). See IMPLEMENTATION_PLAN.md's "Current status" section.
- **Contract deployed to Sui testnet**, `VendorRegistry` configured (rate + dev vendor pubkey), wallet funded — 2026-09-03.
- **`@mysten/sui` upgraded 1.28.0 → 2.29.0 and ported to the gRPC Core API** (`SuiGrpcClient` replacing the removed `SuiClient`) — 2026-09-03. The public testnet fullnode had removed a JSON-RPC method the old SDK's transaction builder depended on; this was a hard, unconditional break, not an edge case. See IMPLEMENTATION_PLAN.md's "Current status" section for the full list of what this touched.
- **Full `create_order → execute_order` loop confirmed live on testnet** (real escrow lock, real signature verification, real payout to a fresh address) via `agent/sui-mcp/e2e-smoke.ts` — 2026-09-03.
