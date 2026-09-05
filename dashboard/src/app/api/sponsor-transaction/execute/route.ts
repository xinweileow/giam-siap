import { NextResponse } from "next/server";
import { completePendingTx, getPendingTx } from "@/lib/pendingTx";
import { getEnokiServerClient } from "@/lib/enokiServer";

export const dynamic = "force-dynamic";

/**
 * POST /api/sponsor-transaction/execute {pendingTxId, digest, signature} -> {digest}
 *
 * Second half of the sponsorship flow (see POST /api/sponsor-transaction's comment for the
 * first). Takes the owner's real zkLogin signature over the sponsored bytes that route returned,
 * and asks Enoki to actually submit the sponsored transaction — Enoki tracks the sponsorship
 * session server-side by `digest`, keyed to the same `ENOKI_SECRET_KEY`, so this route never
 * needs to resend the transaction bytes themselves. On success, marks the pending-tx record
 * submitted (so `/sign` — and a page refresh — shows it as done); on failure, marks it failed so
 * the owner sees an honest error instead of a silently stuck "pending" record.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { pendingTxId, digest, signature } = body ?? {};
  if (typeof pendingTxId !== "string" || typeof digest !== "string" || typeof signature !== "string") {
    return NextResponse.json(
      { error: "pendingTxId, digest, and signature (all strings) are required" },
      { status: 400 },
    );
  }

  const record = getPendingTx(pendingTxId);
  if (!record) {
    return NextResponse.json({ error: "no pending tx with this id" }, { status: 404 });
  }
  // Already resolved (e.g. a double-click/retry after the first call already succeeded or
  // failed) — don't call Enoki a second time with a possibly-stale digest/signature, and don't
  // let a second failed call clobber a real success already recorded.
  if (record.status === "submitted") {
    return NextResponse.json({ digest: record.digest });
  }
  if (record.status === "failed") {
    return NextResponse.json({ error: record.error ?? "This transaction previously failed to submit." }, { status: 409 });
  }

  try {
    const result = await getEnokiServerClient().executeSponsoredTransaction({ digest, signature });
    completePendingTx(pendingTxId, { status: "submitted", digest: result.digest });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    completePendingTx(pendingTxId, { status: "failed", error: message });
    return NextResponse.json({ error: `Enoki sponsored execution failed: ${message}` }, { status: 502 });
  }
}
