import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { makeSuiClient } from "@/lib/suiClient";

export const dynamic = "force-dynamic";

/**
 * GET /api/balance?address=0x... -> {balanceMist: string}
 *
 * Lets `/auth` check whether an address actually needs faucet funds before requesting them —
 * the auto-faucet call used to fire unconditionally on every sign-in, so a returning owner who
 * was already well-funded (and the public faucet happened to be rate-limited at that moment)
 * saw a scary "funding failed" message for no reason. Checking first means the faucet is only
 * ever called for addresses that genuinely need it.
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address query param is required" }, { status: 400 });
  }

  try {
    const client = makeSuiClient(loadConfig());
    const { balance } = await client.getBalance({ owner: address, coinType: "0x2::sui::SUI" });
    // getBalance's response nests the actual figures one level down (its own `balance` field, not
    // the outer wrapper) — confirmed by direct inspection during tonight's debugging, not assumed.
    return NextResponse.json({ balanceMist: String(balance.balance) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Balance check failed: ${message}` }, { status: 502 });
  }
}
