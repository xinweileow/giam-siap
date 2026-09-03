import { Transaction } from "@mysten/sui/transactions";

export interface CancelOrderConfig {
  packageId: string;
}

/** Returns an UNSIGNED transaction — owner-signed, same signing path as createOrder (§4.2). */
export function buildCancelOrderTx(
  config: CancelOrderConfig,
  input: { ownerAddress: string; orderId: string },
): Transaction {
  const tx = new Transaction();
  tx.setSender(input.ownerAddress);
  tx.moveCall({
    target: `${config.packageId}::procurement::cancel_order`,
    arguments: [tx.object(input.orderId)],
  });
  return tx;
}
