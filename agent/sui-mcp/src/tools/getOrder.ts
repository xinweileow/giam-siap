import type { SuiGrpcClient } from "@mysten/sui/grpc";

export const STATUS_LOCKED = 1;
export const STATUS_FULFILLED = 2;
export const STATUS_CANCELLED = 3;

export interface OrderView {
  id: string;
  owner: string;
  itemId: string;
  vendorUrls: string[];
  targetPrice: number;
  quantity: number;
  escrowValue: number;
  supplier: string | null;
  status: number;
}

export async function getOrder(client: SuiGrpcClient, orderId: string): Promise<OrderView> {
  const { object } = await client.getObject({ objectId: orderId, include: { json: true } });
  if (!object.json) {
    throw new Error(`Order ${orderId} not found or has no content`);
  }
  const fields = object.json as Record<string, unknown>;
  return {
    id: orderId,
    owner: fields.owner as string,
    itemId: fields.item_id as string,
    vendorUrls: fields.vendor_urls as string[],
    targetPrice: Number(fields.target_price),
    quantity: Number(fields.quantity),
    escrowValue: Number(fields.escrow),
    supplier: parseOptionAddress(fields.supplier),
    status: Number(fields.status),
  };
}

/** In the `include: { json: true }` shape, `Option<address>` is the address string when Some,
 * or null/undefined when None — not wrapped in an array. */
function parseOptionAddress(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}
