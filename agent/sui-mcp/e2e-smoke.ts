/**
 * One-off manual smoke test against the real deployed testnet contract (§7 step 2a).
 * Not part of the Vitest suite — run with `npx tsx e2e-smoke.ts` after sourcing .env.
 * Uses the same account as both owner and AgentCap holder, which is fine for this
 * dev-only check (see §3 build checklist step 5's stand-in-signer note).
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { loadConfig } from "./src/config.js";
import { makeSuiClient, makeAgentKeypair } from "./src/suiClient.js";
import { buildCreateOrderTx } from "./src/tools/createOrder.js";
import { executeOrder } from "./src/tools/executeOrder.js";
import { getOrder } from "./src/tools/getOrder.js";
import { getActiveOrders } from "./src/tools/getActiveOrders.js";
import { buildVendorMessage } from "./src/vendorMessage.js";

const config = loadConfig();
const client = makeSuiClient(config);
const ownerKeypair = makeAgentKeypair(config); // same account, dev-only
const ownerAddress = ownerKeypair.getPublicKey().toSuiAddress();

const devVendorKeypair = Ed25519Keypair.fromSecretKey(process.env.DEV_VENDOR_PRIVATE_KEY!);
const supplierKeypair = new Ed25519Keypair();
const supplierAddress = supplierKeypair.getPublicKey().toSuiAddress();

const ITEM_ID = "coffee";
const TARGET_PRICE_CENTS = 1000; // RM10.00/kg
const QUANTITY = 5; // kg
const RATE_MIST_PER_CENT = 1000; // matches VendorRegistry.rate_mist_per_cent set on-chain
const PAYMENT_MIST = QUANTITY * TARGET_PRICE_CENTS * RATE_MIST_PER_CENT; // exact escrow-sufficiency boundary

async function main() {
  console.log(`Owner/Agent address: ${ownerAddress}`);
  console.log(`Supplier address:    ${supplierAddress}`);

  console.log("\n1) Building + submitting create_order...");
  const createTx = buildCreateOrderTx(config, {
    ownerAddress,
    itemId: ITEM_ID,
    vendorUrls: ["https://vendor.example/api/price"],
    targetPriceCents: TARGET_PRICE_CENTS,
    quantity: QUANTITY,
    paymentAmountMist: PAYMENT_MIST,
  });
  const createResult = await client.signAndExecuteTransaction({
    signer: ownerKeypair,
    transaction: createTx,
    include: { effects: true, events: true },
  });
  const created = createResult.Transaction ?? createResult.FailedTransaction;
  if (!created) throw new Error(`Unexpected result shape: ${JSON.stringify(createResult)}`);
  await client.waitForTransaction({ digest: created.digest });

  const createdEvent = created.events?.find((e: any) => (e.type ?? e.eventType ?? "").endsWith("::OrderCreated"));
  if (!createdEvent) throw new Error(`OrderCreated event not found: ${JSON.stringify(created.events)}`);
  const orderId = (createdEvent.json as Record<string, unknown>).order_id as string;
  console.log(`   ProcurementOrder created: ${orderId}`);
  console.log(`   tx: https://suiscan.xyz/testnet/tx/${created.digest}`);

  console.log("\n2) Reading order back via getOrder()...");
  const order = await getOrder(client, orderId);
  console.log(`   status=${order.status} (expect 1=Locked) target=${order.targetPrice} escrow=${order.escrowValue}`);
  if (order.status !== 1) throw new Error("Order not Locked after create_order");

  console.log("\n3) Confirming getActiveOrders() includes it (event indexing can trail slightly)...");
  await new Promise((r) => setTimeout(r, 5000));
  const active = await getActiveOrders(client, config.packageId);
  console.log(`   active orders: ${JSON.stringify(active)}`);
  if (!active.includes(orderId)) throw new Error("New order missing from getActiveOrders()");

  console.log("\n4) Building a signed vendor quote at RM9.50/kg (below target)...");
  const priceCents = 950;
  // Back off a few seconds: the on-chain Clock object can trail wall-clock time slightly,
  // and execute_order asserts ts <= on-chain now (E_STALE_TIMESTAMP otherwise).
  const ts = Math.floor(Date.now() / 1000) - 10;
  const message = buildVendorMessage(ITEM_ID, priceCents, ts, supplierAddress);
  const sig = await devVendorKeypair.sign(message);
  const sigHex = Buffer.from(sig).toString("hex");

  console.log("\n5) Submitting execute_order with the AgentCap keypair...");
  const execResult = await executeOrder(
    client,
    ownerKeypair, // also the AgentCap holder in this dev setup
    config,
    { orderId, priceCents, supplierAddress, ts, sigHex },
    TARGET_PRICE_CENTS,
  );
  const executed = execResult.Transaction ?? execResult.FailedTransaction;
  if (!executed) throw new Error(`Unexpected result shape: ${JSON.stringify(execResult)}`);
  if (!executed.effects?.status?.success) {
    throw new Error(`execute_order failed on-chain: ${JSON.stringify(executed.effects?.status)}`);
  }
  await client.waitForTransaction({ digest: executed.digest });
  console.log(`   tx: https://suiscan.xyz/testnet/tx/${executed.digest}`);

  console.log("\n6) Reading order back after settlement...");
  const settled = await getOrder(client, orderId);
  console.log(`   status=${settled.status} (expect 2=Fulfilled) supplier=${settled.supplier}`);
  if (settled.status !== 2) throw new Error("Order not Fulfilled after execute_order");
  if (settled.supplier?.toLowerCase() !== supplierAddress.toLowerCase()) {
    throw new Error(`supplier mismatch: expected ${supplierAddress}, got ${settled.supplier}`);
  }

  console.log("\n7) Confirming supplier actually received the payout...");
  const { balance: supplierBalance } = await client.getBalance({ owner: supplierAddress });
  console.log(`   supplier SUI balance: ${supplierBalance.balance} MIST`);
  if (BigInt(supplierBalance.balance) === 0n) throw new Error("Supplier balance is still zero");

  console.log("\nALL GOOD — full create_order -> execute_order loop confirmed live on testnet.");
}

main().catch((err) => {
  console.error("\nSMOKE TEST FAILED:", err);
  process.exit(1);
});
