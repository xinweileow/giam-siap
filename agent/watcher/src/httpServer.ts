import { createServer, type Server } from "node:http";
import type { OrderCheckResult } from "./loop.js";

/**
 * The watcher's local "check now" control endpoint (§4.3 point 2). Hermes, on recognizing a
 * "check now" intent from the owner in Telegram, hits this with the terminal tool instead of
 * waiting for the next scheduled tick — but it runs the exact same deterministic `tick()` as the
 * timer does (§4.1's architecture note: no LLM anywhere in the settlement path itself, this is
 * just an alternate trigger for it). Loopback-only, no auth: it never does anything a scheduled
 * tick wouldn't already do on its own, so there's nothing here worth protecting beyond not being
 * reachable from outside this machine.
 */
export function startCheckNowServer(
  port: number,
  runCheckNow: () => Promise<OrderCheckResult[] | null>,
  log: (message: string) => void,
): Server {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/check-now") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found — POST /check-now is the only route" }));
      return;
    }
    runCheckNow()
      .then((results) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        if (results === null) {
          res.end(
            JSON.stringify({
              skipped: true,
              reason: "no results — a tick may already have been in progress, or this tick failed; check watcher logs",
            }),
          );
        } else {
          res.end(JSON.stringify({ results }));
        }
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
  });

  server.listen(port, "127.0.0.1", () => {
    log(`check-now control endpoint listening on http://127.0.0.1:${port}/check-now`);
  });
  return server;
}
