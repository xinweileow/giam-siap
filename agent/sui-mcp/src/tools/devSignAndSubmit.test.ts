import { describe, expect, it, vi, afterEach } from "vitest";
import { devSignAndSubmitTx } from "./devSignAndSubmit.js";

const { setSender, build, fromKind } = vi.hoisted(() => {
  const setSender = vi.fn();
  const build = vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9]));
  const fromKind = vi.fn((_bytes: Uint8Array) => ({ setSender, build }));
  return { setSender, build, fromKind };
});

vi.mock("@mysten/sui/transactions", () => ({
  Transaction: { fromKind },
}));

describe("devSignAndSubmitTx", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reconstructs a full transaction from kind-only bytes (setting the signer as sender), signs the resulting full build, and submits it", async () => {
    // createOrder/cancelOrder now hand out transaction-KIND-only bytes (no sender/gas attached —
    // real gas comes from Enoki sponsorship at /sign time). This dev-only fallback bypasses
    // sponsorship entirely, so it must attach a sender and let a real full build resolve gas from
    // the dev keypair's own coins before there's anything actually signable.
    const kindBytes = new Uint8Array([1, 2, 3, 4]);
    const unsignedTxBytesBase64 = Buffer.from(kindBytes).toString("base64");

    const signTransaction = vi.fn((_bytes: Uint8Array) => Promise.resolve({ signature: "sig-base64", bytes: "unused" }));
    const signer = { signTransaction, toSuiAddress: () => "0xdev" } as any;

    const executeTransaction = vi.fn().mockResolvedValue({ Transaction: { digest: "abc123" } });
    const client = { executeTransaction } as any;

    const result = await devSignAndSubmitTx(client, signer, { unsignedTxBytesBase64 });

    expect(fromKind).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(fromKind.mock.calls[0]![0] as Uint8Array)).toEqual(kindBytes);
    expect(setSender).toHaveBeenCalledWith("0xdev");
    expect(build).toHaveBeenCalledWith({ client });

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(signTransaction.mock.calls[0]![0] as Uint8Array)).toEqual(new Uint8Array([9, 9, 9]));

    expect(executeTransaction).toHaveBeenCalledWith({
      transaction: expect.any(Uint8Array),
      signatures: ["sig-base64"],
      include: { effects: true, events: true },
    });
    const executedArg = executeTransaction.mock.calls[0]![0] as { transaction: Uint8Array };
    expect(new Uint8Array(executedArg.transaction)).toEqual(new Uint8Array([9, 9, 9]));
    expect(result).toEqual({ Transaction: { digest: "abc123" } });
  });
});
