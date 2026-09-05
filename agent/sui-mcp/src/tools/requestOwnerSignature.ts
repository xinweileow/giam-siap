/**
 * Registers an unsigned createOrder/cancelOrder transaction with the dashboard's pending-tx
 * store (dashboard/src/app/api/pending-tx/route.ts) and returns a /sign?tx=<id> link for the
 * owner to open in their browser — the real per-order zkLogin signing step (§4.5 step 3),
 * replacing the dev-only devSignAndSubmitTx bridge (§7 step 6, TODOS.md).
 */
export interface RequestOwnerSignatureInput {
  kind: "createOrder" | "cancelOrder";
  ownerAddress: string;
  unsignedTxBytesBase64: string;
}

export async function requestOwnerSignature(
  dashboardUrl: string,
  input: RequestOwnerSignatureInput,
): Promise<{ signUrl: string }> {
  const res = await fetch(`${dashboardUrl}/api/pending-tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to register pending transaction with dashboard (${res.status}): ${await res.text()}`);
  }
  const { id } = (await res.json()) as { id: string };
  return { signUrl: `${dashboardUrl}/sign?tx=${id}` };
}
