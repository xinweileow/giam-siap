import { NextResponse } from "next/server";
import { createPendingTx } from "@/lib/pendingTx";

export const dynamic = "force-dynamic";

/**
 * POST /api/pending-tx {kind, ownerAddress, unsignedTxBytesBase64} -> {id}. Registers a
 * createOrder/cancelOrder unsigned tx for the owner to sign at `/sign?tx=<id>` (§4.5 step 3).
 * Not called by anything live yet — `agent/sui-mcp`'s createOrder/cancelOrder tools still return
 * raw unsigned bytes directly to Hermes, which today are signed by the dev-only
 * `devSignAndSubmitTx` bridge instead (see TODOS.md). Wiring sui-mcp to POST here and hand back a
 * `/sign` link is the remaining step once real Enoki credentials exist (§7 step 6).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { kind, ownerAddress, unsignedTxBytesBase64 } = body ?? {};
  if (
    (kind !== "createOrder" && kind !== "cancelOrder") ||
    typeof ownerAddress !== "string" ||
    typeof unsignedTxBytesBase64 !== "string"
  ) {
    return NextResponse.json(
      { error: "kind ('createOrder'|'cancelOrder'), ownerAddress, and unsignedTxBytesBase64 are required" },
      { status: 400 },
    );
  }
  const record = createPendingTx({ kind, ownerAddress, unsignedTxBytesBase64 });
  return NextResponse.json({ id: record.id });
}
