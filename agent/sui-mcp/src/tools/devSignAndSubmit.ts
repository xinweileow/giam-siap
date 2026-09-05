import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Signer } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";

/**
 * DEV-ONLY stand-in for real zkLogin browser-signing (§4.5, §7 step 6). `createOrder` and
 * `cancelOrder` deliberately return unsigned transaction bytes — only the owner should ever sign
 * their own spend — but nothing in the Hermes-triggered path can sign+submit those bytes until
 * the real `/auth`+`/sign` Enoki flow exists (dashboard/ has a scaffold, not yet wired live). This
 * tool closes that gap during development by signing with the same dev stand-in keypair `AGENT_PRIVATE_KEY`
 * already provides (§3 build checklist step 5 — one funded testnet account plays owner + agent
 * today, same as `e2e-smoke.ts`).
 *
 * DELETE this tool (and its MCP registration in server.ts) once §7 step 6 lands — swap Hermes's
 * call to it for a link to the real `/sign?tx=<id>` route instead. It is intentionally named and
 * described so it's impossible to mistake for the real flow.
 */
export interface DevSignAndSubmitInput {
  unsignedTxBytesBase64: string;
}

export async function devSignAndSubmitTx(
  client: SuiGrpcClient,
  signer: Signer,
  input: DevSignAndSubmitInput,
) {
  // createOrder/cancelOrder now return transaction-KIND-only bytes (no sender/gas attached —
  // real gas comes from Enoki sponsorship at /sign time). This dev-only fallback bypasses
  // sponsorship entirely, so it reconstructs via `Transaction.fromKind()` (the loader matched to
  // kind-only bytes — `Transaction.from()` only accepts full TransactionData and throws on this
  // input), attaches a sender, and lets a real full build pick gas from the dev keypair's OWN
  // coins (fine — the dev address funds itself, same as always) before signing.
  const kindBytes = new Uint8Array(Buffer.from(input.unsignedTxBytesBase64, "base64"));
  const tx = Transaction.fromKind(kindBytes);
  tx.setSender(signer.toSuiAddress());
  const bytes = await tx.build({ client });
  const { signature } = await signer.signTransaction(bytes);
  return client.executeTransaction({
    transaction: bytes,
    signatures: [signature],
    include: { effects: true, events: true },
  });
}
