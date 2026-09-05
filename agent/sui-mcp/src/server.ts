import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { makeSuiClient, makeAgentKeypair } from "./suiClient.js";
import { buildCreateOrderTx } from "./tools/createOrder.js";
import { buildCancelOrderTx } from "./tools/cancelOrder.js";
import { executeOrder as runExecuteOrder, ExecuteOrderGuardError } from "./tools/executeOrder.js";
import { getOrder } from "./tools/getOrder.js";
import { getActiveOrders } from "./tools/getActiveOrders.js";
import { checkVendorPrice, VendorPriceError } from "./tools/checkVendorPrice.js";
import { devSignAndSubmitTx } from "./tools/devSignAndSubmit.js";
import { requestOwnerSignature } from "./tools/requestOwnerSignature.js";
import { getOwnerAddress } from "./tools/getOwnerAddress.js";

const config = loadConfig();
const client = makeSuiClient(config);
const agentKeypair = makeAgentKeypair(config);

const server = new McpServer({ name: "sui-tools", version: "0.1.0" });

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

server.tool(
  "createOrder",
  "Builds an unsigned create_order transaction (base64 tx bytes) for the owner to sign. " +
    "Never signs on the owner's behalf — this is their money.",
  {
    ownerAddress: z.string(),
    itemId: z.string(),
    vendorUrls: z.array(z.string()),
    targetPriceCents: z.number().int().positive(),
    quantity: z.number().int().positive(),
    paymentAmountMist: z.number().int().positive(),
  },
  async (input) => {
    try {
      const tx = buildCreateOrderTx(config, input);
      // Transaction-KIND-only bytes (no gas-selection at all) — required, not just an
      // optimization: `coinWithBalance({useGasCoin:false})` (see buildCreateOrderTx) resolves its
      // intent by sweeping EVERY coin the owner owns into the payment split (confirmed by reading
      // @mysten/sui's CoinWithBalance intent resolver — it doesn't stop early once "enough" is
      // gathered, it takes the whole first page of listCoins), leaving nothing eligible for the
      // separate automatic gas-selection step a full build() would also require. A real,
      // freshly-funded owner address hits this immediately regardless of how much SUI they hold
      // in total. Kind-only bytes skip gas selection entirely — correct anyway, since real gas
      // always comes from Enoki's sponsorship at /sign time, never the owner's own coins.
      // Reconstructed downstream via `Transaction.fromKind()` (NOT `.from()`, which only accepts
      // full TransactionData and throws a BCS parse error on kind-only input — confirmed by
      // direct testing) in both dashboard/src/app/api/sponsor-transaction/route.ts and
      // devSignAndSubmit.ts's dev-only fallback.
      const bytes = await tx.build({ client, onlyTransactionKind: true });
      return json({ unsignedTxBytesBase64: Buffer.from(bytes).toString("base64") });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "cancelOrder",
  "Builds an unsigned cancel_order transaction (base64 tx bytes) for the owner to sign.",
  { ownerAddress: z.string(), orderId: z.string() },
  async (input) => {
    try {
      const tx = buildCancelOrderTx(config, input);
      // Same kind-only reasoning as createOrder above.
      const bytes = await tx.build({ client, onlyTransactionKind: true });
      return json({ unsignedTxBytesBase64: Buffer.from(bytes).toString("base64") });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "getOrder",
  "Reads on-chain status/target/escrow/vendor_urls for a known order ID.",
  { orderId: z.string() },
  async ({ orderId }) => {
    try {
      return json(await getOrder(client, orderId));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "getActiveOrders",
  "Derives the currently-Locked order ID set from on-chain events. Restart-safe: never relies on " +
    "in-memory state.",
  {},
  async () => {
    try {
      return json(await getActiveOrders(client, config.packageId));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "checkVendorPrice",
  "Fetches and verifies a signed price quote from a vendor URL. Throws (never returns a silent " +
    "0/null) on an unreachable, malformed, or invalidly-signed endpoint.",
  { url: z.string(), itemId: z.string(), vendorPubkeyHex: z.string() },
  async (input) => {
    try {
      return json(await checkVendorPrice(input));
    } catch (err) {
      if (err instanceof VendorPriceError) {
        return errorResult(err);
      }
      throw err;
    }
  },
);

server.tool(
  "devSignAndSubmitTx",
  "FALLBACK ONLY — real zkLogin signing now works via requestOwnerSignature; use that instead by " +
    "default. This tool auto-signs with the dev stand-in keypair (same address as " +
    "AGENT_PRIVATE_KEY) and submits immediately, skipping the owner's real approval entirely. " +
    "Only use this if the owner explicitly asks to skip browser signing, or the /sign flow is " +
    "broken — and always tell them plainly that this bypasses their real approval step.",
  { unsignedTxBytesBase64: z.string() },
  async (input) => {
    try {
      return json(await devSignAndSubmitTx(client, agentKeypair, input));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "getOwnerAddress",
  "Looks up a Telegram owner's real zkLogin Sui address from the dashboard's owner-session " +
    "store. Returns null if they haven't signed in via /auth yet. ALWAYS call this before " +
    "createOrder/cancelOrder and use the result as ownerAddress — if it's null, send the owner " +
    "the /auth link instead of building an order with a guessed address.",
  { telegramUserId: z.string() },
  async ({ telegramUserId }) => {
    try {
      return json({ address: await getOwnerAddress(config.dashboardUrl, telegramUserId) });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "requestOwnerSignature",
  "Registers an unsigned createOrder/cancelOrder transaction with the dashboard and returns a " +
    "real /sign?tx=<id> link for the owner to open in their browser and approve via zkLogin — " +
    "this IS the real per-order signing flow. Send this link to the owner; do not sign on their " +
    "behalf.",
  {
    kind: z.enum(["createOrder", "cancelOrder"]),
    ownerAddress: z.string(),
    unsignedTxBytesBase64: z.string(),
  },
  async (input) => {
    try {
      return json(await requestOwnerSignature(config.dashboardUrl, input));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "executeOrder",
  "Signs and submits execute_order with the AgentCap keypair. Called only by the deterministic " +
    "watcher, never directly by the LLM.",
  {
    orderId: z.string(),
    priceCents: z.number().int().nonnegative(),
    supplierAddress: z.string(),
    ts: z.number().int().nonnegative(),
    sigHex: z.string(),
    targetPriceCents: z.number().int().positive(),
  },
  async ({ targetPriceCents, ...input }) => {
    try {
      const result = await runExecuteOrder(client, agentKeypair, config, input, targetPriceCents);
      return json(result);
    } catch (err) {
      if (err instanceof ExecuteOrderGuardError) {
        return errorResult(err);
      }
      throw err;
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
