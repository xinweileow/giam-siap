import { describe, expect, it, vi, afterEach } from "vitest";
import { getOwnerAddress } from "./getOwnerAddress.js";

describe("getOwnerAddress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the address when a session exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ address: "0xowner", createdAt: 1 }) }),
    );
    await expect(getOwnerAddress("http://localhost:3000", "12345")).resolves.toBe("0xowner");
  });

  it("returns null (not an error) when no session exists yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(getOwnerAddress("http://localhost:3000", "12345")).resolves.toBeNull();
  });

  it("throws on an unexpected error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    await expect(getOwnerAddress("http://localhost:3000", "12345")).rejects.toThrow(/500.*boom/);
  });
});
