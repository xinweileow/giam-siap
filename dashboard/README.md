# Giam Siap — Dashboard

Read-only public view of the `giam_siap::procurement` contract on Sui testnet — see
[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) §5 for the spec this implements and §5.3 for
what's explicitly out of scope (no auth, no historical charts, no indexer/DB).

## Setup

```bash
npm install
cp .env.example .env   # fill in SUI_PACKAGE_ID / SUI_VENDOR_REGISTRY_ID from the plan's
                        # "Current status" section (already done for the live testnet deployment)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or whichever port `next dev` picks if 3000
is busy).

No private key or `AgentCap`/`AdminCap` needed — this app only ever reads on-chain state.

## How it works

- `src/lib/store.ts` — a single in-memory, server-side store. On each request to `/api/state`
  that's more than `DASHBOARD_POLL_INTERVAL_MS` (default 5s) stale, it drains new
  `OrderCreated`/`OrderFulfilled`/`OrderCancelled` events via `SuiGrpcClient.listEvents` (cursor
  pagination, append-only — never a full re-fetch), then re-reads the escrow balance/status of
  every still-`Locked` order via `getObjects` (object reads are immediately consistent; events lag
  slightly behind execution, per the plan's "Current status" section).
- `src/app/api/state/route.ts` — thin route handler returning the store's current snapshot as
  JSON.
- `src/components/Dashboard.tsx` — client component polling `/api/state` every 5s, rendering the
  three elements from §5.2 (Escrow Vault Tracker, Live Order Table, Transaction Log). Shows a
  "Reconnecting…" indicator instead of freezing if a poll fails (§9.1).

## Build / typecheck

```bash
npm run build
```
