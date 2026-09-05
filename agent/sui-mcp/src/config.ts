import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load this package's own .env before anything reads process.env, so the server is
// self-sufficient however it's launched (`hermes mcp add`, a bare `node dist/server.js`, or a
// deployed process per §4.6) without relying on the launcher to inject env vars itself. Resolved
// relative to this file, not process.cwd(), so it works regardless of the caller's working
// directory. Never overrides a var already set in the environment (dotenv's default).
// `quiet: true` is load-bearing, not cosmetic: this server speaks MCP over stdio, and dotenv's
// default "injected env (N) from ..." banner goes to stdout, which corrupts the JSON-RPC stream
// the second an MCP host (e.g. Hermes) spawns this as a child process.
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"), quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function loadConfig() {
  return {
    rpcUrl: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443",
    network: (process.env.SUI_NETWORK ?? "testnet") as "mainnet" | "testnet" | "devnet" | "localnet",
    packageId: requireEnv("SUI_PACKAGE_ID"),
    agentCapId: requireEnv("SUI_AGENT_CAP_ID"),
    vendorRegistryId: requireEnv("SUI_VENDOR_REGISTRY_ID"),
    clockId: process.env.SUI_CLOCK_ID ?? "0x6",
    agentPrivateKey: requireEnv("AGENT_PRIVATE_KEY"),
    // Where the dashboard's /api/pending-tx + /sign live (§4.5 step 3, §7 step 6's remaining
    // wiring). requestOwnerSignature posts unsigned tx bytes here instead of the dev-signer
    // bridge signing them itself.
    dashboardUrl: process.env.DASHBOARD_URL ?? "http://localhost:3000",
  };
}

export type Config = ReturnType<typeof loadConfig>;
