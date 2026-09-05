import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig, type Config } from "@giam-siap/sui-mcp/dist/config.js";

// Load this package's own .env (agent/watcher/.env) before reading any watcher-specific vars —
// the watcher is deployed as its own process (§4.6), independent of agent/sui-mcp's. Resolved
// relative to this file, not process.cwd(). sui-mcp's loadConfig() below does the same for its
// own .env, but dotenv never overrides a var already set here, so there's no conflict.
// `quiet: true` keeps dotenv's banner out of this process's own console output (see sui-mcp's
// config.ts for why it's load-bearing there — stdout corruption of an MCP stdio stream — here
// it's just to keep the watcher's own logs clean).
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"), quiet: true });

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
  /** Port for the local "check now" control endpoint (§4.3 point 2, agent/hermes.config's
   * watcher.checkNowUrl). Loopback-only — see httpServer.ts. */
  httpPort: number;
  telegram: {
    /** Set to false to fall back to console-only logging (e.g. CI, or no Hermes profile set up
     * on this machine yet) without touching the rest of the watcher's behavior. */
    enabled: boolean;
    /** Path to the hermes executable, or a bare name resolved via PATH. */
    hermesBin: string;
    /** Hermes profile holding this project's bot token + home chat id — see agent/hermes.config/. */
    hermesProfile: string;
    /** `hermes send --to` target. */
    target: string;
  };
}

export function loadWatcherConfig(): WatcherConfig {
  const base = loadConfig();
  return {
    ...base,
    pollIntervalMs: Number(process.env.WATCHER_POLL_INTERVAL_MS ?? 20_000),
    // Falls back to sui-mcp's dev-only vendor pubkey (already loaded above via its own .env) so
    // local dev works with only agent/sui-mcp/.env populated. Set VENDOR_PUBKEY_HEX explicitly
    // once teammates' real vendor key is registered into VendorRegistry (§7 step 2b).
    vendorPubkeyHex: process.env.VENDOR_PUBKEY_HEX ?? requireEnv("DEV_VENDOR_PUBKEY_HEX"),
    alertThreshold: Number(process.env.WATCHER_ALERT_THRESHOLD ?? 3),
    httpPort: Number(process.env.WATCHER_HTTP_PORT ?? 4300),
    telegram: {
      enabled: (process.env.TELEGRAM_NOTIFY_ENABLED ?? "true") !== "false",
      hermesBin: process.env.HERMES_SEND_BIN ?? "hermes",
      hermesProfile: process.env.HERMES_SEND_PROFILE ?? "giam-siap",
      target: process.env.TELEGRAM_NOTIFY_TARGET ?? "telegram",
    },
  };
}
