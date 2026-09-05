/** Same status enum as agent/sui-mcp/src/tools/getOrder.ts's OrderView — read the SAME on-chain
 * shape here, no redefinition drift (§5's brief). */
export const STATUS_LOCKED = 1;
export const STATUS_FULFILLED = 2;
export const STATUS_CANCELLED = 3;

export type TxLogKind = "created" | "fulfilled" | "cancelled";

export interface OrderRow {
  id: string;
  owner: string;
  /** RM sen (field name kept "cents" from the original spec) — same unit the contract and the
   * vendor's signed quote use (§3/§4.2). */
  targetPriceCents: number;
  quantity: number;
  status: number;
  /** Current on-chain escrow balance, in MIST, as a string (avoids float precision loss over
   * JSON). Only meaningful while `status === STATUS_LOCKED`; drained to 0 on settlement/cancel. */
  escrowMist: string;
  /** The vendor-quoted settlement price (RM sen) from `OrderFulfilled`, once known. There is
   * no "current vendor price" for a still-Locked order available on-chain — the contract never
   * stores one (§3's `ProcurementOrder` has no such field), and the dashboard is scoped to
   * on-chain reads only, not vendor polling (§5.1/§5.3). */
  settledPriceCents: number | null;
  supplier: string | null;
  createdDigest: string | null;
  fulfilledDigest: string | null;
  cancelledDigest: string | null;
}

export interface TxLogEntry {
  key: string;
  kind: TxLogKind;
  orderId: string;
  digest: string;
  summary: string;
}

export interface DashboardSnapshot {
  connected: boolean;
  network: string;
  packageId: string;
  lastUpdated: number;
  lastError: string | null;
  totals: {
    /** Sum of `escrow.value()` across currently-`Locked` orders, in MIST (§5.2). */
    lockedMist: string;
    /** Sum of `(quantity * price) * rate_mist_per_cent` across `Fulfilled` orders, in MIST. */
    settledMist: string;
  };
  orders: OrderRow[];
  /** Newest first. */
  txLog: TxLogEntry[];
}
