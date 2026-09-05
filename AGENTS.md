# Giam Siap — agent instructions

Full plan: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) (read its "Current status" section
first — it's kept up to date with what's actually built vs. still open). Open items:
[TODOS.md](./TODOS.md).

This file is what Hermes (and any other coding agent) auto-loads for a CLI/chat session started
with this repo as its working directory (`hermes -z`, `hermes chat`, `hermes --tui`, etc. — see
`hermes --help`'s `--ignore-rules` entry). For the **Telegram gateway** conversation specifically,
the equivalent, reliably-injected context lives in a separate, machine-local Hermes profile config
— see [agent/hermes.config/README.md](./agent/hermes.config/README.md) for why, and
[agent/hermes.config/context.json](./agent/hermes.config/context.json) for the canonical facts
below.

## Fixed facts — use these, don't guess or re-derive them

- **Package**: `0x9d4610475a54bd178cd0da67ad73d52af794b7309f097da16fbf22441b61572f` (testnet)
- **VendorRegistry**: `0xf068649dd7a8e56a9001baa8dec22ec47aee4d9249051e6bc380b283dd037e52`,
  `rate_mist_per_cent = 1000` — so `paymentAmountMist = quantity * targetPriceCents * 1000`.
- **Dev stand-in owner/agent address** (until real zkLogin lands, §4.5/§7 step 6):
  `0xf93fec94e303510a6f301554359d36c31f387537823367146a9815cd971efc05`.
- **sui-tools MCP server**: registered with Hermes as `sui-tools`
  (`node agent/sui-mcp/dist/server.js`) — `createOrder`, `cancelOrder`, `getOrder`,
  `getActiveOrders`, `checkVendorPrice`, `executeOrder`, `getOwnerAddress` (looks up the owner's
  real zkLogin address), `requestOwnerSignature` (the real zkLogin signing handoff), plus the
  dev-only `devSignAndSubmitTx` fallback (see below).
- **Never call `executeOrder` from an LLM/chat context** — settlement is exclusively
  `agent/watcher/`'s deterministic loop's job (§4.1's architecture note). If asked to "check now",
  hit the watcher's local control endpoint instead: `POST http://127.0.0.1:4300/check-now`.
- **Always call `getOwnerAddress` before `createOrder`/`cancelOrder`** — never reuse an address
  from earlier in the conversation. If it returns null, the owner hasn't signed in yet; send them
  the `/auth` link and don't build the order until they have (§4.5 step 2).
- **`createOrder`/`cancelOrder` return unsigned tx bytes only** (§4.5 — only the owner should sign
  their own spend). As of §7 step 6's wiring, the default path is real: call
  `requestOwnerSignature` (`agent/sui-mcp/src/tools/requestOwnerSignature.ts`) with those bytes and
  the owner's real address from `getOwnerAddress`, which registers them with the dashboard and
  returns a `/sign?tx=<id>` link — send that link to the owner and wait for them to approve it in
  their browser (real Enoki/zkLogin, real gas paid by them until sponsorship is wired, see
  TODOS.md). `devSignAndSubmitTx` still exists as an explicitly-labeled fallback that auto-signs
  with a dev keypair, skipping the owner's real approval — only use it if asked to, and always
  disclose that it bypasses real approval.

## Market-search needs assessment (bare procurement intents)

If asked to procure an item with no clear price/quantity given (e.g. "I want to
procure coffee beans"), don't just ask for numbers — run the same
needs-assessment flow documented in full in
`agent/hermes.config/system-prompt.md`'s "Market-search needs assessment"
section (this is the canonical copy; keep this pointer in sync if that
section moves): ask short follow-ups about location/operating days/volume
tied to the item/current stock, estimate `quantity` yourself from the
answers (showing the math and a business-model reason), research the real
current market price yourself via web search (never ask the owner to look
it up, and explain why the market's at that level if you find a reason),
then confirm the derived `{itemId, targetPriceCents, quantity}` with the
owner before calling `createOrder`.

## Verification commands

```bash
cd contracts && sui move test                 # Move unit tests (§10.1)
cd agent/sui-mcp && npm test                  # sui-mcp tool tests, Vitest (§10.2)
cd agent/watcher && npm test                  # watcher loop tests, Vitest
cd agent/sui-mcp && npm run build              # tsc --noEmit-equivalent + emits dist/ (watcher depends on this)
cd dashboard && npm run build                  # Next.js build
```

## Conventions

- TypeScript across `agent/` and `dashboard/`, strict-ish, no unnecessary comments — match the
  existing file you're editing's style before adding your own.
- Every non-trivial design decision in this repo is explained in IMPLEMENTATION_PLAN.md's prose,
  not scattered across code comments — when you make one, update that file's "Current status"
  section (and TODOS.md's Completed list) the same way prior sessions have, rather than leaving
  the decision undocumented.
