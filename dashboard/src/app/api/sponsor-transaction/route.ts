import { NextResponse } from "next/server";
import { Transaction } from "@mysten/sui/transactions";
import { loadConfig } from "@/lib/config";
import { getPendingTx } from "@/lib/pendingTx";
import { getEnokiServerClient } from "@/lib/enokiServer";

export const dynamic = "force-dynamic";

/**
 * POST /api/sponsor-transaction {pendingTxId} -> {bytes, digest}
 *
 * First half of real Enoki gas sponsorship (§4.5's "owner never touches gas" promise, TODOS.md's
 * gas-sponsorship item). Takes a pending createOrder/cancelOrder record already registered via
 * POST /api/pending-tx — `agent/sui-mcp`'s `createOrder`/`cancelOrder` MCP tools now build
 * transaction-KIND-only bytes directly (no sender, no gas data attached at all), which is exactly
 * what Enoki's sponsorship API wants so it can attach its own gas-station coin as gas payer.
 *
 * This used to reconstruct a FULL transaction via `Transaction.from()` and re-derive kind-only
 * bytes from it, back when createOrder/cancelOrder still did a full `tx.build({client})`. That
 * full build required the owner to already hold a coin object separate from whatever
 * `coinWithBalance({useGasCoin:false})` uses for the escrow payment — reading @mysten/sui's
 * CoinWithBalance intent resolver directly confirmed it sweeps EVERY coin the owner owns (not
 * just enough to cover the payment) into that resolution, starving the automatic gas-selection
 * step regardless of total balance or coin count. A freshly-funded real owner address (however
 * many separate coins it happens to hold) hits this immediately. Building kind-only from the
 * start sidesteps gas selection entirely — correct anyway, since real gas always comes from
 * sponsorship, never the owner's own coins. The stored bytes are loaded via
 * `Transaction.fromKind()` (NOT `.from()`, which only accepts full TransactionData and throws a
 * BCS parse error on kind-only input — confirmed by direct testing) purely to introspect the
 * MoveCall commands for the allow-list below; the stored bytes themselves are already exactly
 * what Enoki wants, no rebuild needed.
 *
 * The private `ENOKI_SECRET_KEY` this needs never reaches the browser — only this route and its
 * sibling, POST /api/sponsor-transaction/execute, ever construct an `EnokiClient`. `/sign` signs
 * the `bytes` this returns with the owner's real `EnokiKeypair`, then POSTs the resulting
 * signature to /api/sponsor-transaction/execute to actually submit it.
 *
 * A real API surprise found while smoke-testing this against Enoki's live sponsorship endpoint,
 * not documented anywhere in this project's earlier notes: Enoki refuses to sponsor a Move call
 * target it doesn't already know about (`"<target> is not part of an allow-listed move call
 * target"`, HTTP 400) unless the request explicitly lists it via `allowedMoveCallTargets` (the
 * alternative — pre-registering targets in the Enoki Portal's app settings — isn't done here,
 * since only the project owner has portal access). This route derives that allow-list from the
 * transaction's own `MoveCall` commands rather than hardcoding `create_order`/`cancel_order`, so
 * it keeps working if either function's on-chain signature/name ever changes. Also confirmed live:
 * Enoki dry-runs the transaction before sponsoring it, so a real contract-level abort (e.g. this
 * order's escrow payment being short — `E_INSUFFICIENT_ESCROW`) surfaces here as a 400, before the
 * owner is ever asked to sign anything.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pendingTxId = body?.pendingTxId;
  if (typeof pendingTxId !== "string") {
    return NextResponse.json({ error: "pendingTxId (string) is required" }, { status: 400 });
  }

  const record = getPendingTx(pendingTxId);
  if (!record) {
    return NextResponse.json({ error: "no pending tx with this id" }, { status: 404 });
  }
  if (record.status !== "pending") {
    return NextResponse.json({ error: `pending tx is already ${record.status}` }, { status: 409 });
  }

  const config = loadConfig();
  if (config.network !== "testnet" && config.network !== "devnet" && config.network !== "mainnet") {
    return NextResponse.json(
      { error: `Enoki sponsorship doesn't support network "${config.network}"` },
      { status: 400 },
    );
  }

  let kindBytes: Uint8Array;
  let allowedMoveCallTargets: string[];
  try {
    kindBytes = new Uint8Array(Buffer.from(record.unsignedTxBytesBase64, "base64"));
    const tx = Transaction.fromKind(kindBytes);
    // Enoki refuses to sponsor a Move call target it doesn't recognize (see comment above) —
    // allow-list exactly the target(s) this specific transaction actually calls.
    allowedMoveCallTargets = tx
      .getData()
      .commands.filter((c) => c.$kind === "MoveCall")
      .map((c) => `${c.MoveCall!.package}::${c.MoveCall!.module}::${c.MoveCall!.function}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Stored transaction bytes for this pending tx are invalid or unbuildable: ${message}` },
      { status: 400 },
    );
  }

  try {
    const sponsored = await getEnokiServerClient().createSponsoredTransaction({
      network: config.network,
      transactionKindBytes: Buffer.from(kindBytes).toString("base64"),
      sender: record.ownerAddress,
      allowedMoveCallTargets,
    });
    return NextResponse.json(sponsored);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Enoki sponsorship request failed: ${message}` }, { status: 502 });
  }
}
