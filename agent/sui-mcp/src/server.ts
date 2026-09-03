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
      const bytes = await tx.build({ client });
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
      const bytes = await tx.build({ client });
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
