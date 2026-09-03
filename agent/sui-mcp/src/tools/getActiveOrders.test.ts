import { describe, expect, it, vi } from "vitest";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { getActiveOrders } from "./getActiveOrders.js";

const PACKAGE_ID = "0xpkg";

function eventType(name: string) {
  return `${PACKAGE_ID}::procurement::${name}`;
}

/** Builds a fake listEvents that pages through `pages` (one array of order_ids per page) for
 * whichever event type is requested, per the pagination pattern §4.2/§5.2 require. */
function makeMockClient(byEventType: Record<string, string[][]>): SuiGrpcClient {
  const listEvents = vi.fn(
    async ({ filter, after }: { filter: { eventType: string }; after?: string }) => {
      const pages = byEventType[filter.eventType] ?? [[]];
      const pageIndex = after == null ? 0 : Number(after);
      const page = pages[pageIndex] ?? [];
      const hasNextPage = pageIndex + 1 < pages.length;
      return {
        events: page.map((order_id) => ({ json: { order_id } })),
        endCursor: hasNextPage ? String(pageIndex + 1) : null,
        hasNextPage,
      };
    },
  );
  return { listEvents } as unknown as SuiGrpcClient;
}

describe("getActiveOrders", () => {
  it("excludes Fulfilled and Cancelled IDs from the Created set", async () => {
    const client = makeMockClient({
      [eventType("OrderCreated")]: [["0x1", "0x2", "0x3"]],
      [eventType("OrderFulfilled")]: [["0x2"]],
      [eventType("OrderCancelled")]: [["0x3"]],
    });

    const active = await getActiveOrders(client, PACKAGE_ID);
    expect(active).toEqual(["0x1"]);
  });

  it("pages through multi-page event responses via cursor", async () => {
    const client = makeMockClient({
      [eventType("OrderCreated")]: [["0x1", "0x2"], ["0x3", "0x4"]],
      [eventType("OrderFulfilled")]: [[]],
      [eventType("OrderCancelled")]: [[]],
    });

    const active = await getActiveOrders(client, PACKAGE_ID);
    expect(active.sort()).toEqual(["0x1", "0x2", "0x3", "0x4"]);
  });

  it("re-derives the full set from scratch every call (no reliance on prior state)", async () => {
    const client = makeMockClient({
      [eventType("OrderCreated")]: [["0x1"]],
      [eventType("OrderFulfilled")]: [[]],
      [eventType("OrderCancelled")]: [[]],
    });

    const first = await getActiveOrders(client, PACKAGE_ID);
    const second = await getActiveOrders(client, PACKAGE_ID);
    expect(first).toEqual(second);
  });
});
