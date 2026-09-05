/**
 * Local stand-in for the mock vendor site (§7 step 2b, teammates' deliverable) so the watcher's
 * full loop can be tested end-to-end before their real endpoint exists — per TODOS.md's watcher
 * ticket. Implements exactly the interface spec from IMPLEMENTATION_PLAN.md §4.2:
 *   GET /api/price?item=<id> -> {item, price_cents, unit, ts, supplier_address, sig}
 * signed with DEV_VENDOR_PRIVATE_KEY, the same dev-only keypair already registered in
 * VendorRegistry (see agent/sui-mcp/.env's DEV_VENDOR_* vars).
 *
 * Not part of the watcher's production build — run with `npm run vendor-stub`.
 */
import { createServer } from "node:http";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildVendorMessage } from "@giam-siap/sui-mcp/dist/vendorMessage.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const PORT = Number(process.env.VENDOR_STUB_PORT ?? 4100);
const vendorKeypair = Ed25519Keypair.fromSecretKey(requireEnv("DEV_VENDOR_PRIVATE_KEY"));
const supplierAddress = requireEnv("STUB_SUPPLIER_ADDRESS");

// Starts above a typical demo target (e.g. RM10.00/kg) so nothing settles until you either pass
// ?price_cents=<n> on a request or POST /api/set-price — the same "flash sale" trigger the
// research doc's supplier story describes (§0.6), under your control for the demo (§9.2).
let currentPriceCents = Number(process.env.STUB_PRICE_CENTS ?? 1200);

async function signQuote(item: string, priceCents: number) {
  // Back off a few seconds: execute_order's on-chain staleness check compares against the shared
  // Clock object, which can trail wall-clock time slightly (§9.1 note carried over from e2e-smoke.ts).
  const ts = Math.floor(Date.now() / 1000) - 10;
  const message = buildVendorMessage(item, priceCents, ts, supplierAddress);
  const sig = await vendorKeypair.sign(message);
  return { item, price_cents: priceCents, unit: "kg", ts, supplier_address: supplierAddress, sig: Buffer.from(sig).toString("hex") };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/price") {
    const item = url.searchParams.get("item");
    if (!item) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing required query param: item" }));
      return;
    }
    const override = url.searchParams.get("price_cents");
    if (override !== null) {
      currentPriceCents = Number(override);
    }
    signQuote(item, currentPriceCents)
      .then((quote) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(quote));
      })
      .catch((err) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/set-price") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}") as { price_cents?: number };
        if (typeof parsed.price_cents !== "number" || !Number.isInteger(parsed.price_cents)) {
          throw new Error("body must be {\"price_cents\": <integer>}");
        }
        currentPriceCents = parsed.price_cents;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ price_cents: currentPriceCents }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[vendor-stub] listening on http://localhost:${PORT}/api/price?item=<id>`);
  console.log(`[vendor-stub] current price: ${currentPriceCents} cents — override with ?price_cents=<n> or POST /api/set-price`);
});
