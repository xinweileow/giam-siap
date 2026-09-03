import { Transaction } from "@mysten/sui/transactions";

export interface CreateOrderInput {
  ownerAddress: string;
  itemId: string;
  vendorUrls: string[];
  targetPriceCents: number;
  quantity: number;
  paymentAmountMist: number | bigint;
}

export interface CreateOrderConfig {
  packageId: string;
  vendorRegistryId: string;
  clockId: string;
}

/**
 * Returns an UNSIGNED transaction — the owner's browser signs it via zkLogin (§4.5), or during
 * early development, the throwaway stand-in keypair signs it. This tool never signs on the
 * owner's behalf.
 */
export function buildCreateOrderTx(config: CreateOrderConfig, input: CreateOrderInput): Transaction {
  const tx = new Transaction();
  tx.setSender(input.ownerAddress);
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(input.paymentAmountMist)]);
  tx.moveCall({
    target: `${config.packageId}::procurement::create_order`,
    arguments: [
      payment,
      tx.object(config.vendorRegistryId),
      tx.pure.string(input.itemId),
      tx.pure.vector("string", input.vendorUrls),
      tx.pure.u64(input.targetPriceCents),
      tx.pure.u64(input.quantity),
      tx.object(config.clockId),
    ],
  });
  return tx;
}
