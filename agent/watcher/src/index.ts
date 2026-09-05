import { loadWatcherConfig } from "./config.js";
import { createWatcher, type OrderCheckResult } from "./loop.js";
import { startCheckNowServer } from "./httpServer.js";
import { sendTelegramMessage } from "./telegram.js";
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

/** Fire-and-forget Telegram notification — a delivery failure here must never affect what the
 * watcher already decided on-chain (§4.1's determinism note applies to notifications too: they're
 * a side effect of a tick's result, not part of the decision itself). */
function notifyTelegram(message: string): void {
  sendTelegramMessage(config.telegram, message).catch((err) => {
    console.error(`[watcher] failed to send Telegram notification: ${err instanceof Error ? err.message : err}`);
  });
}

const watcher = createWatcher({
  getActiveOrders: () => getActiveOrders(client, config.packageId),
  getOrder: (orderId) => getOrder(client, orderId),
  checkVendorPrice: (input) => checkVendorPrice(input),
  executeOrder: (input, targetPriceCents) => executeOrder(client, agentKeypair, config, input, targetPriceCents),
  vendorPubkeyHex: config.vendorPubkeyHex,
  alertThreshold: config.alertThreshold,
  onAlert: (message) => {
    console.error(`[watcher] ALERT: ${message}`);
    notifyTelegram(`⚠️ Giam Siap watcher alert (not the owner — this is a self-alert per §9.1): ${message}`);
  },
  log: (message) => console.log(`[watcher] ${message}`),
});

let tickInFlight = false;

/**
 * Runs one tick immediately, outside the timer. Exported (and exposed over HTTP via
 * httpServer.ts) so the Telegram "check now" trigger (§4.3 point 2) can run it on demand instead
 * of waiting for the poll interval. Returns the per-order results, or `null` if a tick was already
 * in flight (so a caller — e.g. the HTTP handler — can report that back instead of silently no-op'ing).
 */
export async function checkNow(): Promise<OrderCheckResult[] | null> {
  if (tickInFlight) {
    console.log("[watcher] tick already in progress, skipping overlapping trigger");
    return null;
  }
  tickInFlight = true;
  try {
    const results = await watcher.tick();
    for (const result of results) {
      console.log(`[watcher] order ${result.orderId}: ${result.outcome}${result.detail ? ` (${result.detail})` : ""}`);
      if (result.outcome === "executed") {
        notifyTelegram(
          `🎉 Order ${result.orderId} executed! Tx: https://suiscan.xyz/testnet/tx/${result.detail}`,
        );
      }
    }
    return results;
  } catch (err) {
    // A tick should never throw (loop.ts already isolates per-order failures), but if
    // getActiveOrders itself fails (e.g. RPC down), don't let it kill the process — the next
    // timer tick gets another chance. Never rethrow: this runs unhandled off both the timer and
    // an HTTP request handler, and either caller treating a failed tick as an unhandled
    // rejection would be worse than just reporting "no results" for this trigger.
    console.error("[watcher] tick failed unexpectedly:", err);
    return null;
  } finally {
    tickInFlight = false;
  }
}

console.log(`[watcher] starting — polling every ${config.pollIntervalMs}ms against package ${config.packageId}`);
void checkNow();
const timer = setInterval(() => void checkNow(), config.pollIntervalMs);
const httpServer = startCheckNowServer(config.httpPort, checkNow, (message) => console.log(`[watcher] ${message}`));

function shutdown(): void {
  clearInterval(timer);
  httpServer.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
