import { createPublicKey, verify } from "node:crypto";

/**
 * Mirrors giam_siap::procurement::build_message exactly: "item|price_cents|ts|supplier_address",
 * where supplier_address matches sui::address::to_string — 64 lowercase hex chars, no "0x" prefix.
 */
export function buildVendorMessage(
  itemId: string,
  priceCents: number,
  ts: number,
  supplierAddress: string,
): Uint8Array {
  const normalizedAddr = supplierAddress.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  const message = `${itemId}|${priceCents}|${ts}|${normalizedAddr}`;
  return new TextEncoder().encode(message);
}

export function verifyVendorSignature(pubkeyHex: string, message: Uint8Array, sigHex: string): boolean {
  const pubKeyBytes = Buffer.from(pubkeyHex.replace(/^0x/i, ""), "hex");
  const sigBytes = Buffer.from(sigHex.replace(/^0x/i, ""), "hex");
  if (pubKeyBytes.length !== 32 || sigBytes.length !== 64) {
    return false;
  }
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: pubKeyBytes.toString("base64url") },
    format: "jwk",
  });
  try {
    return verify(null, Buffer.from(message), publicKey, sigBytes);
  } catch {
    return false;
  }
}
