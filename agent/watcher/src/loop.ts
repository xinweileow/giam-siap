import { STATUS_LOCKED, type OrderView } from "@giam-siap/sui-mcp/dist/tools/getOrder.js";
import type { VendorQuote } from "@giam-siap/sui-mcp/dist/tools/checkVendorPrice.js";
import { ExecuteOrderGuardError, type ExecuteOrderInput } from "@giam-siap/sui-mcp/dist/tools/executeOrder.js";

/** Minimal shape loop.ts needs from SuiGrpcClient.signAndExecuteTransaction's result — see
 * e2e-smoke.ts for the same Transaction/FailedTransaction union pattern. */
export interface ExecuteOrderResult {
  digest?: string;
  Transaction?: { digest: string; effects?: { status?: { success?: boolean } } };
  FailedTransaction?: { digest: string; effects?: { status?: { success?: boolean } } };
}

export type OrderOutcome =
  | "executed"
  | "no_match"
  | "not_locked"
  | "vendor_unreachable"
  | "execute_failed"
  | "race_already_resolved"
  | "error";

export interface OrderCheckResult {
  orderId: string;
  outcome: OrderOutcome;
  detail?: string;
}

/**
 * Everything the deterministic tick needs, injected so loop.ts is unit-testable without a real
 * SuiGrpcClient or network access (§10.2's testing style). In production (watcher/src/index.ts)
 * these are thin wrappers around the exact same sui-mcp tool functions Hermes uses (§4.1).
 */
export interface WatcherDeps {
  getActiveOrders(): Promise<string[]>;
  getOrder(orderId: string): Promise<OrderView>;
  checkVendorPrice(input: { url: string; itemId: string; vendorPubkeyHex: string }): Promise<VendorQuote>;
  executeOrder(input: ExecuteOrderInput, targetPriceCents: number): Promise<ExecuteOrderResult>;
  vendorPubkeyHex: string;
  /** Consecutive vendor-check failures (per order+URL) before onAlert fires (§9.1). Default 3. */
  alertThreshold?: number;
  /** Backoff schedule (ms) between executeOrder retries on a transient/RPC failure (§9.1). */
  retryDelaysMs?: number[];
  /** Fired when a failure streak crosses alertThreshold — wire this to a real Telegram alert
   * once §7 step 3 lands; defaults to a console.error so failures are never silent in the meantime. */
  onAlert?: (message: string) => void;
  log?: (message: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The deterministic settlement loop (§4.3): getActiveOrders() -> per order, checkVendorPrice()
 * against its vendor_urls -> executeOrder() on a valid match. No LLM anywhere in this path.
 * Returns a fresh `tick()` function that owns its own failure-streak state, so it survives across
 * calls within one process but never persists anything the watcher needs to be correct after a
 * restart — getActiveOrders() re-derives the Locked set from chain state every time (§9.1).
 */
export function createWatcher(deps: WatcherDeps) {
  const log = deps.log ?? ((message: string) => console.log(message));
  const onAlert = deps.onAlert ?? ((message: string) => console.error(`ALERT: ${message}`));
  const alertThreshold = deps.alertThreshold ?? 3;
  const retryDelaysMs = deps.retryDelaysMs ?? [500, 1000, 2000];

  // Keyed by `${orderId}|${url}` — a vendor going down doesn't quietly reset every other order's count.
  const vendorFailureStreaks = new Map<string, number>();

  function recordVendorFailure(key: string, message: string): void {
    const count = (vendorFailureStreaks.get(key) ?? 0) + 1;
    vendorFailureStreaks.set(key, count);
    log(`${key}: vendor check failed (streak ${count}): ${message}`);
    // Exactly `===`, not `>=`: fire once when a failure episode first crosses the threshold, not
    // again on every subsequent tick for as long as it stays broken — a real bug found live (one
    // stale test order alerted the owner's Telegram 400+ times in a row). A success later deletes
    // this key (below), so a fresh failure episode still gets its own single alert.
    if (count === alertThreshold) {
      onAlert(`Vendor check has failed ${count} times in a row for ${key}: ${message}`);
    }
  }

  async function executeMatch(orderId: string, order: OrderView, quote: VendorQuote): Promise<OrderCheckResult> {
    const input: ExecuteOrderInput = {
      orderId,
      priceCents: quote.price_cents,
      supplierAddress: quote.supplier_address,
      ts: quote.ts,
      sigHex: quote.sig,
    };

    let lastErrorMessage = "unknown error";
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        const result = await deps.executeOrder(input, order.targetPrice);
        const settled = result.Transaction ?? result.FailedTransaction;
        if (!settled) {
          throw new Error(`Unexpected executeOrder result shape: ${JSON.stringify(result)}`);
        }

        if (settled.effects?.status?.success === false) {
          // Reverted on-chain — check whether this is a race (someone else already
          // executed/cancelled the order between our read and this call) rather than a real bug
          // (§9.1: "retrying blindly would be wrong" if it's already resolved).
          const current = await deps.getOrder(orderId).catch(() => null);
          if (current && current.status !== STATUS_LOCKED) {
            log(`order ${orderId}: execute_order reverted but order is already status=${current.status} — a race, not a bug`);
            return { orderId, outcome: "race_already_resolved" };
          }
          const detail = JSON.stringify(settled.effects?.status);
          log(`order ${orderId}: execute_order reverted on-chain: ${detail}`);
          return { orderId, outcome: "execute_failed", detail };
        }

        log(`order ${orderId}: executed at ${quote.price_cents} cents -> supplier ${quote.supplier_address}, tx ${settled.digest}`);
        return { orderId, outcome: "executed", detail: settled.digest };
      } catch (err) {
        if (err instanceof ExecuteOrderGuardError) {
          // Client-side guard already refused a bad price before touching the network — not
          // transient, retrying won't help.
          log(`order ${orderId}: refused to execute — ${err.message}`);
          return { orderId, outcome: "execute_failed", detail: err.message };
        }
        lastErrorMessage = err instanceof Error ? err.message : String(err);
        if (attempt < retryDelaysMs.length) {
          const delay = retryDelaysMs[attempt];
          log(`order ${orderId}: executeOrder attempt ${attempt + 1} failed (${lastErrorMessage}), retrying in ${delay}ms`);
          await sleep(delay);
        }
      }
    }

    // Exhausted retries — report failure back to the tick loop instead of throwing, so one bad
    // order never stops the others from being checked (§9.1).
    log(`order ${orderId}: executeOrder failed after ${retryDelaysMs.length + 1} attempts: ${lastErrorMessage}`);
    return { orderId, outcome: "execute_failed", detail: lastErrorMessage };
  }

  async function checkOrder(orderId: string): Promise<OrderCheckResult> {
    const order = await deps.getOrder(orderId);

    if (order.status !== STATUS_LOCKED) {
      // getActiveOrders()'s event-derived set can briefly lag a status change (documented gRPC
      // index-trailing behavior, not a bug — §4.2) — just skip it this tick.
      return { orderId, outcome: "not_locked" };
    }

    let anyVendorSucceeded = false;
    for (const url of order.vendorUrls) {
      const key = `${orderId}|${url}`;
      let quote: VendorQuote;
      try {
        quote = await deps.checkVendorPrice({ url, itemId: order.itemId, vendorPubkeyHex: deps.vendorPubkeyHex });
      } catch (err) {
        // Never treat a failed/malformed/unsigned quote as "price = 0" — a false settlement is
        // worse than a skipped cycle (§9.1). Try this order's other vendor_urls, if any.
        recordVendorFailure(key, err instanceof Error ? err.message : String(err));
        continue;
      }
      vendorFailureStreaks.delete(key);
      anyVendorSucceeded = true;

      if (quote.price_cents > order.targetPrice) {
        log(`order ${orderId}: vendor price ${quote.price_cents} exceeds target ${order.targetPrice}, monitoring`);
        continue;
      }

      return executeMatch(orderId, order, quote);
    }

    return { orderId, outcome: anyVendorSucceeded ? "no_match" : "vendor_unreachable" };
  }

  async function tick(): Promise<OrderCheckResult[]> {
    const orderIds = await deps.getActiveOrders();
    const results: OrderCheckResult[] = [];
    for (const orderId of orderIds) {
      // Each order is independent — one order's bug or one vendor's outage must never stop the
      // rest of the poll cycle from running (§9.1).
      try {
        results.push(await checkOrder(orderId));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`order ${orderId}: unexpected error, skipping this tick: ${message}`);
        results.push({ orderId, outcome: "error", detail: message });
      }
    }
    return results;
  }

  return { tick };
}

export type Watcher = ReturnType<typeof createWatcher>;
