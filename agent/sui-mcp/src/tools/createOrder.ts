import { Transaction, coinWithBalance } from "@mysten/sui/transactions";

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
  // Source the escrow payment coin from the owner's own balance, independent of `tx.gas` — NOT
  // `tx.splitCoins(tx.gas, ...)`. That used to be harmless (the owner paid their own gas from the
  // same coin anyway), but now that `/sign` submits via Enoki's gas-station sponsorship
  // (dashboard/src/app/sign/page.tsx), `tx.gas` resolves to the SPONSOR's gas coin, not the
  // owner's — splitting the escrow amount off it would have Enoki's wallet fund the entire order,
  // not just network gas. `useGasCoin: false` sources this coin from the owner's own address
  // balance instead, however that ends up funded (faucet, real transfer, whatever).
  const payment = tx.add(coinWithBalance({ balance: input.paymentAmountMist, useGasCoin: false }));
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
