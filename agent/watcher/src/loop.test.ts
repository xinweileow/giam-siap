import { describe, expect, it, vi } from "vitest";
import { STATUS_LOCKED, STATUS_FULFILLED, type OrderView } from "@giam-siap/sui-mcp/dist/tools/getOrder.js";
import { ExecuteOrderGuardError } from "@giam-siap/sui-mcp/dist/tools/executeOrder.js";
import { createWatcher, type WatcherDeps, type ExecuteOrderResult } from "./loop.js";

function makeOrder(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: "0xorder1",
    owner: "0xowner",
    itemId: "coffee",
    vendorUrls: ["https://vendor.example/api/price"],
    targetPrice: 1000,
    quantity: 5,
    escrowValue: 5_000_000,
    supplier: null,
    status: STATUS_LOCKED,
    ...overrides,
  };
}

function makeQuote(overrides: Partial<{ price_cents: number }> = {}) {
  return {
    item: "coffee",
    price_cents: 950,
    unit: "kg",
    ts: 1_700_000_000,
    supplier_address: "0xsupplier",
    sig: "aa".repeat(64),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
  return {
    getActiveOrders: vi.fn(async () => ["0xorder1"]),
    getOrder: vi.fn(async () => makeOrder()),
    checkVendorPrice: vi.fn(async () => makeQuote()),
    executeOrder: vi.fn(async (): Promise<ExecuteOrderResult> => ({
      Transaction: { digest: "0xdigest", effects: { status: { success: true } } },
    })),
    vendorPubkeyHex: "deadbeef",
    log: () => {},
    onAlert: vi.fn(),
    retryDelaysMs: [],
    ...overrides,
  };
}

describe("createWatcher.tick", () => {
  it("executes an order when the vendor quote is at or below target", async () => {
    const deps = baseDeps();
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "executed", detail: "0xdigest" }]);
    expect(deps.executeOrder).toHaveBeenCalledTimes(1);
  });

  it("does not execute when the vendor price exceeds target", async () => {
    const deps = baseDeps({ checkVendorPrice: vi.fn(async () => makeQuote({ price_cents: 1500 })) });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "no_match" }]);
    expect(deps.executeOrder).not.toHaveBeenCalled();
  });

  it("skips orders that aren't Locked without touching the network further", async () => {
    const deps = baseDeps({ getOrder: vi.fn(async () => makeOrder({ status: STATUS_FULFILLED })) });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "not_locked" }]);
    expect(deps.checkVendorPrice).not.toHaveBeenCalled();
  });

  it("never treats a vendor failure as price=0 — skips and logs instead of executing", async () => {
    const deps = baseDeps({ checkVendorPrice: vi.fn(async () => { throw new Error("unreachable"); }) });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "vendor_unreachable" }]);
    expect(deps.executeOrder).not.toHaveBeenCalled();
  });

  it("raises onAlert once a vendor's failure streak crosses alertThreshold, not before", async () => {
    const onAlert = vi.fn();
    const deps = baseDeps({
      checkVendorPrice: vi.fn(async () => { throw new Error("timeout"); }),
      onAlert,
      alertThreshold: 3,
    });
    const watcher = createWatcher(deps);
    await watcher.tick();
    await watcher.tick();
    expect(onAlert).not.toHaveBeenCalled();
    await watcher.tick();
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it("does not re-alert on every subsequent tick once already past alertThreshold", async () => {
    // Regression test for a real bug: onAlert fired on every tick once the streak reached
    // alertThreshold, not just the tick it first crossed — one stale test order alerted the
    // owner's Telegram 400+ times in a row for the exact same failure.
    const onAlert = vi.fn();
    const deps = baseDeps({
      checkVendorPrice: vi.fn(async () => { throw new Error("timeout"); }),
      onAlert,
      alertThreshold: 3,
    });
    const watcher = createWatcher(deps);
    await watcher.tick();
    await watcher.tick();
    await watcher.tick(); // crosses the threshold — exactly one alert
    await watcher.tick();
    await watcher.tick();
    await watcher.tick(); // still failing, well past the threshold — must not alert again
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it("clears a vendor's failure streak after a subsequent success", async () => {
    const onAlert = vi.fn();
    let shouldFail = true;
    const deps = baseDeps({
      checkVendorPrice: vi.fn(async () => {
        if (shouldFail) throw new Error("timeout");
        return makeQuote({ price_cents: 1500 }); // above target, so no execute — isolates the streak behavior
      }),
      onAlert,
      alertThreshold: 2,
    });
    const watcher = createWatcher(deps);
    await watcher.tick(); // failure 1
    shouldFail = false;
    await watcher.tick(); // success resets the streak
    shouldFail = true;
    await watcher.tick(); // failure 1 again, not 3rd in a row
    expect(onAlert).not.toHaveBeenCalled();
  });

  it("one order's failure never stops the rest of the tick from running", async () => {
    const deps = baseDeps({
      getActiveOrders: vi.fn(async () => ["0xbad", "0xgood"]),
      getOrder: vi.fn(async (orderId: string) => {
        if (orderId === "0xbad") throw new Error("boom");
        return makeOrder({ id: orderId });
      }),
    });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([
      { orderId: "0xbad", outcome: "error", detail: "boom" },
      { orderId: "0xgood", outcome: "executed", detail: "0xdigest" },
    ]);
  });

  it("retries executeOrder on a transient failure, then succeeds", async () => {
    let calls = 0;
    const executeOrder = vi.fn(async (): Promise<ExecuteOrderResult> => {
      calls += 1;
      if (calls < 2) throw new Error("RPC timeout");
      return { Transaction: { digest: "0xdigest", effects: { status: { success: true } } } };
    });
    const deps = baseDeps({ executeOrder, retryDelaysMs: [1] });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "executed", detail: "0xdigest" }]);
    expect(executeOrder).toHaveBeenCalledTimes(2);
  });

  it("reports execute_failed (without crashing the tick) after exhausting all retries", async () => {
    const executeOrder = vi.fn(async (): Promise<ExecuteOrderResult> => {
      throw new Error("RPC down");
    });
    const deps = baseDeps({ executeOrder, retryDelaysMs: [1, 1] });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "execute_failed", detail: "RPC down" }]);
    expect(executeOrder).toHaveBeenCalledTimes(3);
  });

  it("does not retry a client-side guard rejection (not transient)", async () => {
    const executeOrder = vi.fn(async (): Promise<ExecuteOrderResult> => {
      throw new ExecuteOrderGuardError("price exceeds target");
    });
    const deps = baseDeps({ executeOrder, retryDelaysMs: [1, 1] });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "execute_failed", detail: "price exceeds target" }]);
    expect(executeOrder).toHaveBeenCalledTimes(1);
  });

  it("treats an on-chain revert as a race (not a failure) when the order is already resolved", async () => {
    const getOrder = vi.fn(async () => makeOrder());
    // second call (the post-revert recheck) reports the order already settled by someone else
    getOrder.mockImplementationOnce(async () => makeOrder());
    getOrder.mockImplementationOnce(async () => makeOrder({ status: STATUS_FULFILLED }));
    const executeOrder = vi.fn(async (): Promise<ExecuteOrderResult> => ({
      FailedTransaction: { digest: "0xdigest", effects: { status: { success: false } } },
    }));
    const deps = baseDeps({ getOrder, executeOrder });
    const watcher = createWatcher(deps);
    const results = await watcher.tick();
    expect(results).toEqual([{ orderId: "0xorder1", outcome: "race_already_resolved" }]);
    expect(executeOrder).toHaveBeenCalledTimes(1); // no blind retry on an already-resolved race
  });

  it("re-derives the active order set from scratch every tick (no in-memory order list)", async () => {
    const getActiveOrders = vi.fn(async () => ["0xorder1"]);
    const deps = baseDeps({ getActiveOrders });
    const watcher = createWatcher(deps);
    await watcher.tick();
    await watcher.tick();
    expect(getActiveOrders).toHaveBeenCalledTimes(2);
  });
});
