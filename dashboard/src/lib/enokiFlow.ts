"use client";
import { EnokiFlow } from "@mysten/enoki";

let flow: EnokiFlow | null = null;

/**
 * Lazily-constructed singleton `EnokiFlow` client (browser-only — it holds the ephemeral
 * keypair + zkLogin session in browser storage, per Enoki's own session-persistence model).
 *
 * Deliberately using the `EnokiFlow` class directly rather than the currently-recommended
 * `registerEnokiWallets` + `@mysten/dapp-kit` integration: `@mysten/dapp-kit` (as installed,
 * 1.1.17) prints "This package only supports the deprecated Sui JSON-RPC API" on install —
 * it's built on the old `SuiClient`, the exact thing this project migrated off of everywhere
 * else after the public testnet fullnode removed the JSON-RPC method its transaction builder
 * needed (see IMPLEMENTATION_PLAN.md's SDK-migration finding). `EnokiFlow` has no such
 * dependency — it only talks to the Enoki REST API and hands back an `EnokiKeypair`, which
 * implements the same `Signer` interface (`@mysten/sui/cryptography`) as every other keypair in
 * this codebase and works directly with `SuiGrpcClient` (see
 * agent/sui-mcp/src/tools/devSignAndSubmit.ts for the identical pattern with the dev stand-in
 * keypair — swapping that keypair for `await getEnokiFlow().getKeypair(...)` is the intended
 * migration path once real credentials exist, §7 step 6).
 */
export function getEnokiFlow(): EnokiFlow {
  if (typeof window === "undefined") {
    throw new Error("getEnokiFlow() is browser-only");
  }
  if (!flow) {
    const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
    if (!apiKey) {
      throw new Error("NEXT_PUBLIC_ENOKI_API_KEY is not set — see dashboard/.env.example");
    }
    flow = new EnokiFlow({ apiKey });
  }
  return flow;
}

export function getGoogleClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set — see dashboard/.env.example");
  }
  return clientId;
}

export function getEnokiNetwork(): "mainnet" | "testnet" | "devnet" {
  return (process.env.NEXT_PUBLIC_SUI_NETWORK as "mainnet" | "testnet" | "devnet" | undefined) ?? "testnet";
}
