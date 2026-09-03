import { describe, expect, it } from "vitest";
import { buildCreateOrderTx } from "./createOrder.js";

const CONFIG = {
  packageId: "0x" + "1".repeat(64),
  vendorRegistryId: "0x" + "3".repeat(64),
  clockId: "0x6",
};

describe("buildCreateOrderTx", () => {
  it("produces a well-formed create_order call from valid inputs", () => {
    const OWNER = "0x" + "a".repeat(64);
    const tx = buildCreateOrderTx(CONFIG, {
      ownerAddress: OWNER,
      itemId: "coffee",
      vendorUrls: ["https://vendor.example/api/price"],
      targetPriceCents: 1000,
      quantity: 50,
      paymentAmountMist: 5_000_000_000,
    });

    const data = tx.getData();
    const moveCall = data.commands.find((c) => c.$kind === "MoveCall")?.MoveCall;
    expect(moveCall?.module).toBe("procurement");
    expect(moveCall?.function).toBe("create_order");
    expect(moveCall?.arguments).toHaveLength(7);
    expect(data.sender).toBe(OWNER);
  });
});
