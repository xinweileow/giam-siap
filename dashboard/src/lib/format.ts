const SUISCAN_TX_BASE = "https://suiscan.xyz/testnet/tx";

export function formatMistAsSui(mist: string, fractionDigits = 4): string {
  let value: bigint;
  try {
    value = BigInt(mist || "0");
  } catch {
    return "0";
  }
  const whole = value / 1_000_000_000n;
  const fraction = value % 1_000_000_000n;
  const fractionStr = fraction.toString().padStart(9, "0").slice(0, fractionDigits);
  return `${whole.toLocaleString("en-US")}.${fractionStr}`;
}

/** Prices in this project are Ringgit Malaysia (RM/MYR), not USD — matching the real mock
 * vendor site (cooking-bistro.vercel.app), which already quotes in RM. `cents` here means sen
 * (1 RM = 100 sen); the on-chain field/param names keep the generic "cents" spelling from the
 * original spec (see IMPLEMENTATION_PLAN.md's currency-convention note). */
export function formatCentsAsMyr(cents: number): string {
  return `RM${(cents / 100).toFixed(2)}`;
}

export function shortAddress(address: string, lead = 6, trail = 4): string {
  if (address.length <= lead + trail + 2) return address;
  return `${address.slice(0, lead)}..${address.slice(-trail)}`;
}

export function suiscanTxUrl(digest: string): string {
  return `${SUISCAN_TX_BASE}/${digest}`;
}
