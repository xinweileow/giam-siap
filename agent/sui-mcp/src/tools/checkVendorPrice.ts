import { buildVendorMessage, verifyVendorSignature } from "../vendorMessage.js";

/** GET <url> -> this shape, per the vendor interface spec in IMPLEMENTATION_PLAN.md §4.2. */
export interface VendorQuote {
  item: string;
  price_cents: number;
  unit: string;
  ts: number;
  supplier_address: string;
  sig: string;
}

/**
 * Thrown on any failure — unreachable endpoint, malformed body, or an invalid/missing signature.
 * Callers must never treat a caught error as "price = 0"; a false settlement is worse than a
 * skipped poll cycle (§9.1).
 */
export class VendorPriceError extends Error {}

export interface CheckVendorPriceDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function checkVendorPrice(
  input: { url: string; itemId: string; vendorPubkeyHex: string },
  deps: CheckVendorPriceDeps = {},
): Promise<VendorQuote> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(input.url, { signal: controller.signal });
  } catch (err) {
    throw new VendorPriceError(`Vendor endpoint unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new VendorPriceError(`Vendor endpoint returned HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new VendorPriceError("Vendor endpoint returned malformed JSON");
  }

  const quote = parseQuote(body);
  if (quote.item !== input.itemId) {
    throw new VendorPriceError(`Vendor quote item mismatch: expected ${input.itemId}, got ${quote.item}`);
  }

  const message = buildVendorMessage(quote.item, quote.price_cents, quote.ts, quote.supplier_address);
  if (!verifyVendorSignature(input.vendorPubkeyHex, message, quote.sig)) {
    throw new VendorPriceError("Vendor quote signature is invalid");
  }

  return quote;
}

function parseQuote(body: unknown): VendorQuote {
  if (typeof body !== "object" || body === null) {
    throw new VendorPriceError("Vendor endpoint returned malformed JSON");
  }
  const b = body as Record<string, unknown>;
  if (
    typeof b.item !== "string" ||
    typeof b.price_cents !== "number" ||
    !Number.isInteger(b.price_cents) ||
    typeof b.unit !== "string" ||
    typeof b.ts !== "number" ||
    typeof b.supplier_address !== "string" ||
    typeof b.sig !== "string"
  ) {
    throw new VendorPriceError("Vendor endpoint returned an incomplete or malformed quote");
  }
  return b as unknown as VendorQuote;
}
