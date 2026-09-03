import { loadConfig, type Config } from "@giam-siap/sui-mcp/dist/config.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export interface WatcherConfig extends Config {
  /** How often the deterministic loop ticks — §4.3 specifies 15-30s. */
  pollIntervalMs: number;
  /** Pubkey checkVendorPrice verifies quotes against — the registered VendorRegistry key
   * (DEV_VENDOR_PUBKEY_HEX today, teammates' real key once handed over per §7 step 2b). */
  vendorPubkeyHex: string;
  /** Consecutive vendor-check failures (per order+URL) before raising an alert (§9.1). */
  alertThreshold: number;
}

export function loadWatcherConfig(): WatcherConfig {
  const base = loadConfig();
  return {
    ...base,
    pollIntervalMs: Number(process.env.WATCHER_POLL_INTERVAL_MS ?? 20_000),
    vendorPubkeyHex: requireEnv("VENDOR_PUBKEY_HEX"),
    alertThreshold: Number(process.env.WATCHER_ALERT_THRESHOLD ?? 3),
  };
}
