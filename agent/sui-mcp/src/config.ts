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
  };
}

export type Config = ReturnType<typeof loadConfig>;
