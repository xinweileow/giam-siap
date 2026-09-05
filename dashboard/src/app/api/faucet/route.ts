import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Testnet-only faucet URLs per network, matching `sui client faucet`'s own defaults
 * (docs.sui.io/guides/developer/getting-started/get-coins). */
const FAUCET_URLS: Record<string, string> = {
  testnet: "https://faucet.testnet.sui.io/v2/gas",
  devnet: "https://faucet.devnet.sui.io/v2/gas",
};

/**
 * POST /api/faucet {address} -> requests testnet SUI for a freshly-created zkLogin address
 * (§4.5 step 2: "Backend immediately faucets the new address ... so the owner never has to think
 * about funding before their first order"). Testnet/devnet only — refuses to run against
 * mainnet, matching this project's non-goals (§0.5: no real funds, ever).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const address = body?.address;
  if (typeof address !== "string") {
    return NextResponse.json({ error: "address (string) is required" }, { status: 400 });
  }

  const { network } = loadConfig();
  const faucetUrl = FAUCET_URLS[network];
  if (!faucetUrl) {
    return NextResponse.json(
      { error: `No faucet available for network "${network}" — this project never touches real funds (§0.5)` },
      { status: 400 },
    );
  }

  const res = await fetch(faucetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json({ error: `Faucet request failed (HTTP ${res.status})`, details: data }, { status: 502 });
  }
  return NextResponse.json({ ok: true, faucet: data });
}
