import { describe, expect, it, vi, afterEach } from "vitest";
import { requestOwnerSignature } from "./requestOwnerSignature.js";

describe("requestOwnerSignature", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the unsigned tx to the dashboard and returns a /sign link built from the returned id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc-123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOwnerSignature("http://localhost:3000", {
      kind: "createOrder",
      ownerAddress: "0xowner",
      unsignedTxBytesBase64: "dGVzdA==",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/pending-tx",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "createOrder",
          ownerAddress: "0xowner",
          unsignedTxBytesBase64: "dGVzdA==",
        }),
      }),
    );
    expect(result).toEqual({ signUrl: "http://localhost:3000/sign?tx=abc-123" });
  });

  it("throws with the response body when the dashboard rejects the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad input",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestOwnerSignature("http://localhost:3000", {
        kind: "cancelOrder",
        ownerAddress: "0xowner",
        unsignedTxBytesBase64: "dGVzdA==",
      }),
    ).rejects.toThrow(/400.*bad input/);
  });
});
