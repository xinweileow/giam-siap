import { NextResponse } from "next/server";
import { getPendingTx, completePendingTx } from "@/lib/pendingTx";

export const dynamic = "force-dynamic";

/** GET /api/pending-tx/<id> -> the pending record, for the /sign page to fetch what to sign. */
export async function GET(_request: Request, { params }: RouteContext<"/api/pending-tx/[id]">) {
  const { id } = await params;
  const record = getPendingTx(id);
  if (!record) {
    return NextResponse.json({ error: "no pending tx with this id" }, { status: 404 });
  }
  return NextResponse.json(record);
}

/** PATCH /api/pending-tx/<id> {status: "submitted", digest} | {status: "failed", error} -> marks
 * the record resolved once the owner's browser has signed and submitted it (§4.5 step 3). */
export async function PATCH(request: Request, { params }: RouteContext<"/api/pending-tx/[id]">) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  let updated;
  if (body?.status === "submitted" && typeof body?.digest === "string") {
    updated = completePendingTx(id, { status: "submitted", digest: body.digest });
  } else if (body?.status === "failed" && typeof body?.error === "string") {
    updated = completePendingTx(id, { status: "failed", error: body.error });
  } else {
    return NextResponse.json(
      { error: "body must be {status:'submitted', digest} or {status:'failed', error}" },
      { status: 400 },
    );
  }

  if (!updated) {
    return NextResponse.json({ error: "no pending tx with this id" }, { status: 404 });
  }
  return NextResponse.json(updated);
}
