import { describe, expect, it } from "vitest";
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { checkVendorPrice, VendorPriceError } from "./checkVendorPrice.js";
import { buildVendorMessage } from "../vendorMessage.js";

function makeVendorKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const pubkeyHex = Buffer.from(pubJwk.x, "base64url").toString("hex");
  return { privateKey, pubkeyHex };
}

function signQuote(privateKey: KeyObject, quote: {
  item: string;
  price_cents: number;
  ts: number;
  supplier_address: string;
}) {
  const message = buildVendorMessage(quote.item, quote.price_cents, quote.ts, quote.supplier_address);
  return sign(null, Buffer.from(message), privateKey).toString("hex");
}

function fakeFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  return async () => response as Response;
}

describe("checkVendorPrice", () => {
  it("returns a verified quote on the happy path", async () => {
    const { privateKey, pubkeyHex } = makeVendorKeypair();
    const quoteBody = {
      item: "coffee",
      price_cents: 950,
      unit: "kg",
      ts: 1_700_000_000,
      supplier_address: "0x000000000000000000000000000000000000000000000000000000000000000b",
    };
    const sig = signQuote(privateKey, quoteBody);

    const quote = await checkVendorPrice(
      { url: "https://vendor.example/api/price", itemId: "coffee", vendorPubkeyHex: pubkeyHex },
      { fetchImpl: fakeFetch({ ok: true, json: async () => ({ ...quoteBody, sig }) }) },
    );

    expect(quote.price_cents).toBe(950);
    expect(quote.sig).toBe(sig);
  });

  it("throws (never resolves to 0) when the fetch never resolves before the timeout", async () => {
    const slowFetch = () =>
      new Promise<Response>((_resolve, reject) => {
        // never resolves; rely on AbortController firing via the short timeout below
        setTimeout(() => reject(new Error("aborted")), 20);
      });

    await expect(
      checkVendorPrice(
        { url: "https://vendor.example/api/price", itemId: "coffee", vendorPubkeyHex: "00".repeat(32) },
        { fetchImpl: slowFetch as unknown as typeof fetch, timeoutMs: 5 },
      ),
    ).rejects.toBeInstanceOf(VendorPriceError);
  });

  it("throws on malformed JSON", async () => {
    await expect(
      checkVendorPrice(
        { url: "https://vendor.example/api/price", itemId: "coffee", vendorPubkeyHex: "00".repeat(32) },
        {
          fetchImpl: async () =>
            ({ ok: true, json: async () => { throw new Error("bad json"); } }) as unknown as Response,
        },
      ),
    ).rejects.toBeInstanceOf(VendorPriceError);
  });

  it("throws on an unreachable endpoint (non-2xx)", async () => {
    await expect(
      checkVendorPrice(
        { url: "https://vendor.example/api/price", itemId: "coffee", vendorPubkeyHex: "00".repeat(32) },
        { fetchImpl: fakeFetch({ ok: false, status: 503 }) },
      ),
    ).rejects.toBeInstanceOf(VendorPriceError);
  });

  it("throws when the signature does not verify", async () => {
    const { pubkeyHex } = makeVendorKeypair();
    const { privateKey: wrongKey } = makeVendorKeypair();
    const quoteBody = {
      item: "coffee",
      price_cents: 950,
      unit: "kg",
      ts: 1_700_000_000,
      supplier_address: "0x000000000000000000000000000000000000000000000000000000000000000b",
    };
    const sig = signQuote(wrongKey, quoteBody); // signed with a DIFFERENT key than pubkeyHex

    await expect(
      checkVendorPrice(
        { url: "https://vendor.example/api/price", itemId: "coffee", vendorPubkeyHex: pubkeyHex },
        { fetchImpl: fakeFetch({ ok: true, json: async () => ({ ...quoteBody, sig }) }) },
      ),
    ).rejects.toBeInstanceOf(VendorPriceError);
  });

  it("throws when the quote is missing required fields", async () => {
    await expect(
      checkVendorPrice(
        { url: "https://vendor.example/api/price", itemId: "coffee", vendorPubkeyHex: "00".repeat(32) },
        { fetchImpl: fakeFetch({ ok: true, json: async () => ({ item: "coffee" }) }) },
      ),
    ).rejects.toBeInstanceOf(VendorPriceError);
  });
});
