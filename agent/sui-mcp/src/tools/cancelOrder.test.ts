import { describe, expect, it } from "vitest";
import { buildCancelOrderTx } from "./cancelOrder.js";

describe("buildCancelOrderTx", () => {
  it("produces a well-formed cancel_order call", () => {
    const OWNER = "0x" + "a".repeat(64);
    const ORDER_ID = "0x" + "b".repeat(64);
    const PACKAGE_ID = "0x" + "1".repeat(64);
    const tx = buildCancelOrderTx({ packageId: PACKAGE_ID }, { ownerAddress: OWNER, orderId: ORDER_ID });
    const data = tx.getData();
    const moveCall = data.commands.find((c) => c.$kind === "MoveCall")?.MoveCall;
    expect(moveCall?.module).toBe("procurement");
    expect(moveCall?.function).toBe("cancel_order");
    expect(moveCall?.arguments).toHaveLength(1);
    expect(data.sender).toBe(OWNER);
  });
});
