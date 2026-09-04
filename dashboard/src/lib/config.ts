function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/** Same shape as agent/sui-mcp/src/config.ts, minus anything signing-related — this dashboard
 * is a read-only public view, it never holds a private key. */
export function loadConfig() {
  return {
    rpcUrl: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443",
    network: (process.env.SUI_NETWORK ?? "testnet") as "mainnet" | "testnet" | "devnet" | "localnet",
    packageId: requireEnv("SUI_PACKAGE_ID"),
    vendorRegistryId: requireEnv("SUI_VENDOR_REGISTRY_ID"),
    pollIntervalMs: Number(process.env.DASHBOARD_POLL_INTERVAL_MS ?? 5000),
  };
}

export type Config = ReturnType<typeof loadConfig>;
