/**
 * Looks up a Telegram owner's real zkLogin Sui address from the dashboard's owner-session store
 * (dashboard/src/lib/ownerSessions.ts, populated by /auth). Returns null if the owner hasn't
 * signed in yet — callers should send them the /auth link and hold off on createOrder/cancelOrder
 * until an address exists, rather than falling back to a dev stand-in address (§4.5 step 2,
 * TODOS.md "give Hermes the owner's real address").
 */
export async function getOwnerAddress(dashboardUrl: string, telegramUserId: string): Promise<string | null> {
  const res = await fetch(`${dashboardUrl}/api/owner-session?telegramUserId=${encodeURIComponent(telegramUserId)}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to look up owner session (${res.status}): ${await res.text()}`);
  }
  const { address } = (await res.json()) as { address: string };
  return address;
}
