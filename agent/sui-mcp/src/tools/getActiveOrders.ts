import type { SuiGrpcClient } from "@mysten/sui/grpc";

/**
 * Re-derives the currently-Locked order set from on-chain events every call — never held only in
 * memory, so a watcher restart never silently stops monitoring an order created before the crash
 * (§9.1).
 */
export async function getActiveOrders(client: SuiGrpcClient, packageId: string): Promise<string[]> {
  const [created, fulfilled, cancelled] = await Promise.all([
    queryAllOrderIds(client, packageId, "OrderCreated"),
    queryAllOrderIds(client, packageId, "OrderFulfilled"),
    queryAllOrderIds(client, packageId, "OrderCancelled"),
  ]);
  const resolved = new Set([...fulfilled, ...cancelled]);
  return created.filter((id) => !resolved.has(id));
}

async function queryAllOrderIds(client: SuiGrpcClient, packageId: string, eventName: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await client.listEvents({
      filter: { eventType: `${packageId}::procurement::${eventName}` },
      order: "ascending",
      after,
    });
    for (const event of page.events) {
      const parsed = event.json as Record<string, unknown>;
      ids.push(parsed.order_id as string);
    }
    after = page.endCursor ?? undefined;
    hasNextPage = page.hasNextPage;
  }

  return ids;
}
