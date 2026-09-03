import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

export interface ExecuteOrderConfig {
  packageId: string;
  agentCapId: string;
  vendorRegistryId: string;
  clockId: string;
}

export interface ExecuteOrderInput {
  orderId: string;
  priceCents: number;
  supplierAddress: string;
  ts: number;
  sigHex: string;
}

/** Refuses to build a doomed on-chain call — the contract enforces this too, but checking here
 * first avoids wasting gas and a failed-transaction log entry on every price miss (§8.2). */
export class ExecuteOrderGuardError extends Error {}

export function buildExecuteOrderTx(
  config: ExecuteOrderConfig,
  input: ExecuteOrderInput,
  targetPriceCents: number,
): Transaction {
  if (input.priceCents > targetPriceCents) {
    throw new ExecuteOrderGuardError(
      `Refusing to execute: quoted price ${input.priceCents} exceeds target ${targetPriceCents}`,
    );
  }

  const sigBytes = Array.from(Buffer.from(input.sigHex.replace(/^0x/i, ""), "hex"));

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::procurement::execute_order`,
    arguments: [
      tx.object(input.orderId),
      tx.object(config.agentCapId),
      tx.object(config.vendorRegistryId),
      tx.pure.u64(input.priceCents),
      tx.pure.address(input.supplierAddress),
      tx.pure.u64(input.ts),
      tx.pure.vector("u8", sigBytes),
      tx.object(config.clockId),
    ],
  });
  return tx;
}

/** Signs and submits with the AgentCap keypair directly — called only by the deterministic
 * watcher (§4.3), never by the LLM. */
export async function executeOrder(
  client: SuiGrpcClient,
  signer: Ed25519Keypair,
  config: ExecuteOrderConfig,
  input: ExecuteOrderInput,
  targetPriceCents: number,
) {
  const tx = buildExecuteOrderTx(config, input, targetPriceCents);
  return client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: { effects: true, events: true },
  });
}
