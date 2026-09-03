import { loadWatcherConfig } from "./config.js";
import { createWatcher } from "./loop.js";
import { makeSuiClient, makeAgentKeypair } from "@giam-siap/sui-mcp/dist/suiClient.js";
import { getActiveOrders } from "@giam-siap/sui-mcp/dist/tools/getActiveOrders.js";
import { getOrder } from "@giam-siap/sui-mcp/dist/tools/getOrder.js";
import { checkVendorPrice } from "@giam-siap/sui-mcp/dist/tools/checkVendorPrice.js";
import { executeOrder } from "@giam-siap/sui-mcp/dist/tools/executeOrder.js";

/**
 * The deterministic watcher process (§4.1, §4.3, §4.6) — its own long-running Node process,
 * deployed separately from the Hermes gateway (never through `hermes cron`, which would route
 * settlement back through an LLM loop and reintroduce the nondeterminism the eng review removed).
 *
 * Imports the exact same sui-mcp tool functions Hermes uses for intent parsing (§4.1's structure
 * note), just called directly here instead of over the MCP stdio transport.
 */
const config = loadWatcherConfig();
const client = makeSuiClient(config);
const agentKeypair = makeAgentKeypair(config);

const watcher = createWatcher({
  getActiveOrders: () => getActiveOrders(client, config.packageId),
  getOrder: (orderId) => getOrder(client, orderId),
  checkVendorPrice: (input) => checkVendorPrice(input),
  executeOrder: (input, targetPriceCents) => executeOrder(client, agentKeypair, config, input, targetPriceCents),
  vendorPubkeyHex: config.vendorPubkeyHex,
  alertThreshold: config.alertThreshold,
  onAlert: (message) => {
    // TODO(§7 step 3): wire this to a real "alert yourself, not the owner" Telegram message once
    // Hermes/Telegram wiring exists. Until then, this is the loudest signal available.
    console.error(`[watcher] ALERT: ${message}`);
  },
  log: (message) => console.log(`[watcher] ${message}`),
});

let tickInFlight = false;

/**
 * Runs one tick immediately, outside the timer — this is what the Telegram "check now" trigger
 * (§4.3 point 2) should call once that wiring exists, so a live demo doesn't have to wait on the
 * poll interval. Exported so it can be imported directly by that future caller.
 */
export async function checkNow(): Promise<void> {
  if (tickInFlight) {
    console.log("[watcher] tick already in progress, skipping overlapping trigger");
    return;
  }
  tickInFlight = true;
  try {
    const results = await watcher.tick();
    for (const result of results) {
      console.log(`[watcher] order ${result.orderId}: ${result.outcome}${result.detail ? ` (${result.detail})` : ""}`);
    }
  } catch (err) {
    // A tick should never throw (loop.ts already isolates per-order failures), but if
    // getActiveOrders itself fails (e.g. RPC down), don't let it kill the process — the next
    // timer tick gets another chance.
    console.error("[watcher] tick failed unexpectedly:", err);
  } finally {
    tickInFlight = false;
  }
}

console.log(`[watcher] starting — polling every ${config.pollIntervalMs}ms against package ${config.packageId}`);
void checkNow();
const timer = setInterval(() => void checkNow(), config.pollIntervalMs);

function shutdown(): void {
  clearInterval(timer);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
