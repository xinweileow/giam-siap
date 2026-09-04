import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { makeSuiClient } from "./suiClient";
import { loadConfig, type Config } from "./config";
import {
  STATUS_CANCELLED,
  STATUS_FULFILLED,
  STATUS_LOCKED,
  type DashboardSnapshot,
  type OrderRow,
  type TxLogEntry,
} from "./types";

const MODULE_NAME = "procurement";
const MAX_TX_LOG = 200;

interface EventLike {
  eventType: string;
  json: Record<string, unknown> | null;
  transactionDigest: string;
  checkpoint: string | null;
  eventIndex: number;
}

interface StoreState {
  cursor: string | null;
  orders: Map<string, OrderRow>;
  txLog: TxLogEntry[];
  rateMistPerCent: bigint | null;
  connected: boolean;
  lastError: string | null;
  lastUpdated: number;
  refreshing: Promise<void> | null;
}

function createState(): StoreState {
  return {
    cursor: null,
    orders: new Map(),
    txLog: [],
    rateMistPerCent: null,
    connected: false,
    lastError: null,
    lastUpdated: 0,
    refreshing: null,
  };
}

// Survive Next.js dev's module hot-reloading (a reload would otherwise re-run this module and
// lose the cursor/accumulated in-memory state) — same singleton-on-globalThis pattern commonly
// used for DB clients in Next.js apps. Also the reason this is a single in-memory store rather
// than a real indexer/DB: fine at this app's demo scale (§5.3), not fine as a distributed cache.
const globalForStore = globalThis as unknown as {
  __giamSiapDashboardStore?: StoreState;
  __giamSiapDashboardClient?: SuiGrpcClient;
};

function getState(): StoreState {
  if (!globalForStore.__giamSiapDashboardStore) {
    globalForStore.__giamSiapDashboardStore = createState();
  }
  return globalForStore.__giamSiapDashboardStore;
}

function getClient(config: Config): SuiGrpcClient {
  if (!globalForStore.__giamSiapDashboardClient) {
    globalForStore.__giamSiapDashboardClient = makeSuiClient(config);
  }
  return globalForStore.__giamSiapDashboardClient;
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}..${id.slice(-4)}` : id;
}

function eventSuffix(eventType: string): string {
  const idx = eventType.lastIndexOf("::");
  return idx === -1 ? eventType : eventType.slice(idx + 2);
}

async function ensureRate(client: SuiGrpcClient, config: Config, state: StoreState): Promise<void> {
  if (state.rateMistPerCent !== null) return;
  const { object } = await client.getObject({ objectId: config.vendorRegistryId, include: { json: true } });
  const fields = object.json;
  if (!fields) {
    throw new Error(`VendorRegistry ${config.vendorRegistryId} has no content`);
  }
  state.rateMistPerCent = BigInt(fields.rate_mist_per_cent as string | number);
}

function applyEvent(state: StoreState, event: EventLike): void {
  const fields = event.json;
  if (!fields) return;
  const orderId = fields.order_id as string | undefined;
  if (!orderId) return;

  const kind = eventSuffix(event.eventType);
  const key = `${event.checkpoint ?? "0"}-${event.transactionDigest}-${event.eventIndex}`;

  if (kind === "OrderCreated") {
    const targetPriceCents = Number(fields.target_price);
    state.orders.set(orderId, {
      id: orderId,
      owner: fields.owner as string,
      targetPriceCents,
      quantity: Number(fields.quantity),
      status: STATUS_LOCKED,
      escrowMist: "0",
      settledPriceCents: null,
      supplier: null,
      createdDigest: event.transactionDigest,
      fulfilledDigest: null,
      cancelledDigest: null,
    });
    state.txLog.push({
      key,
      kind: "created",
      orderId,
      digest: event.transactionDigest,
      summary: `Order ${shortId(orderId)} created, target $${(targetPriceCents / 100).toFixed(2)} x ${fields.quantity}`,
    });
  } else if (kind === "OrderFulfilled") {
    const priceCents = Number(fields.price);
    const supplier = fields.supplier as string;
    const existing = state.orders.get(orderId);
    if (existing) {
      existing.status = STATUS_FULFILLED;
      existing.settledPriceCents = priceCents;
      existing.supplier = supplier;
      existing.fulfilledDigest = event.transactionDigest;
      existing.escrowMist = "0";
    } else {
      // Event lag edge case (see IMPLEMENTATION_PLAN.md "Current status"): we somehow saw
      // OrderFulfilled before OrderCreated in this stream. Keep a minimal placeholder row rather
      // than dropping the order entirely.
      state.orders.set(orderId, {
        id: orderId,
        owner: "?",
        targetPriceCents: priceCents,
        quantity: 0,
        status: STATUS_FULFILLED,
        escrowMist: "0",
        settledPriceCents: priceCents,
        supplier,
        createdDigest: null,
        fulfilledDigest: event.transactionDigest,
        cancelledDigest: null,
      });
    }
    state.txLog.push({
      key,
      kind: "fulfilled",
      orderId,
      digest: event.transactionDigest,
      summary: `Order ${shortId(orderId)} executed at $${(priceCents / 100).toFixed(2)}/unit`,
    });
  } else if (kind === "OrderCancelled") {
    const existing = state.orders.get(orderId);
    if (existing) {
      existing.status = STATUS_CANCELLED;
      existing.cancelledDigest = event.transactionDigest;
      existing.escrowMist = "0";
    }
    state.txLog.push({
      key,
      kind: "cancelled",
      orderId,
      digest: event.transactionDigest,
      summary: `Order ${shortId(orderId)} cancelled, escrow refunded`,
    });
  }

  if (state.txLog.length > MAX_TX_LOG) {
    state.txLog.splice(0, state.txLog.length - MAX_TX_LOG);
  }
}

/** Same emitModule-filtered, cursor-paginated pattern as agent/sui-mcp's getActiveOrders — never
 * a full re-fetch, only ever appends events newer than `state.cursor` (§5.2). One filter across
 * all three event types (OrderCreated/OrderFulfilled/OrderCancelled) instead of three, since they
 * all live in the same module. */
async function drainEvents(client: SuiGrpcClient, config: Config, state: StoreState): Promise<void> {
  let hasNextPage = true;
  while (hasNextPage) {
    const page = await client.listEvents({
      filter: { emitModule: `${config.packageId}::${MODULE_NAME}` },
      order: "ascending",
      after: state.cursor ?? undefined,
    });
    for (const event of page.events) {
      applyEvent(state, event);
    }
    state.cursor = page.endCursor ?? state.cursor;
    hasNextPage = page.hasNextPage;
  }
}

/**
 * Refreshes escrow balances (and double-checks status) for every order our event stream still
 * believes is `Locked`, reading straight from the Move object. Object reads are immediately
 * consistent while `listEvents` trails execution slightly (documented gRPC behavior, see
 * IMPLEMENTATION_PLAN.md's "Current status"), so this is what keeps the status badge from ever
 * showing a stale LOCKED after a same-tick settlement (§8.5's acceptance criterion).
 */
async function refreshActiveOrders(client: SuiGrpcClient, state: StoreState): Promise<void> {
  const activeIds = [...state.orders.values()].filter((o) => o.status === STATUS_LOCKED).map((o) => o.id);
  if (activeIds.length === 0) return;

  const { objects } = await client.getObjects({ objectIds: activeIds, include: { json: true } });
  for (const result of objects) {
    if (result instanceof Error) continue;
    if (!result.json) continue;
    const order = state.orders.get(result.objectId);
    if (!order) continue;
    const fields = result.json;
    order.status = Number(fields.status);
    order.escrowMist = String(BigInt(fields.escrow as string | number));
    order.owner = (fields.owner as string | undefined) ?? order.owner;
    order.targetPriceCents = fields.target_price !== undefined ? Number(fields.target_price) : order.targetPriceCents;
    order.quantity = fields.quantity !== undefined ? Number(fields.quantity) : order.quantity;
  }
}

function computeTotals(state: StoreState): { lockedMist: bigint; settledMist: bigint } {
  let lockedMist = 0n;
  let settledMist = 0n;
  for (const order of state.orders.values()) {
    if (order.status === STATUS_LOCKED) {
      lockedMist += BigInt(order.escrowMist || "0");
    } else if (order.status === STATUS_FULFILLED && order.settledPriceCents !== null && state.rateMistPerCent !== null) {
      settledMist += BigInt(order.quantity) * BigInt(order.settledPriceCents) * state.rateMistPerCent;
    }
  }
  return { lockedMist, settledMist };
}

async function refreshOnce(config: Config, client: SuiGrpcClient, state: StoreState): Promise<void> {
  await ensureRate(client, config, state);
  await drainEvents(client, config, state);
  await refreshActiveOrders(client, state);
}

/**
 * Single-flight, interval-rate-limited refresh: at most one in-flight RPC round-trip at a time,
 * and never more often than `DASHBOARD_POLL_INTERVAL_MS` (default 5s, §5.2) — several browser
 * tabs polling `/api/state` concurrently still only cost one upstream refresh per interval.
 *
 * On failure, the previous good snapshot is returned with `connected: false` — the API route
 * never throws just because one poll tick failed, so the frontend can show a "reconnecting"
 * indicator instead of freezing or blanking (§9.1's dashboard row).
 */
export async function getSnapshot(): Promise<DashboardSnapshot> {
  const config = loadConfig();
  const client = getClient(config);
  const state = getState();
  const isStale = Date.now() - state.lastUpdated >= config.pollIntervalMs;

  if (isStale && !state.refreshing) {
    state.refreshing = refreshOnce(config, client, state)
      .then(() => {
        state.connected = true;
        state.lastError = null;
      })
      .catch((error: unknown) => {
        state.connected = false;
        state.lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        state.lastUpdated = Date.now();
        state.refreshing = null;
      });
  }

  if (state.refreshing) {
    await state.refreshing;
  }

  const totals = computeTotals(state);
  return {
    connected: state.connected,
    network: config.network,
    packageId: config.packageId,
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    totals: {
      lockedMist: totals.lockedMist.toString(),
      settledMist: totals.settledMist.toString(),
    },
    // Map insertion order == first-seen order, oldest first; newest-created shows up top.
    orders: [...state.orders.values()].reverse(),
    txLog: [...state.txLog].reverse(),
  };
}
