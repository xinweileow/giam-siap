import { describe, expect, it } from "vitest";
import { buildExecuteOrderTx, ExecuteOrderGuardError } from "./executeOrder.js";

const CONFIG = {
  packageId: "0x" + "1".repeat(64),
  agentCapId: "0x" + "2".repeat(64),
  vendorRegistryId: "0x" + "3".repeat(64),
  clockId: "0x6",
};

const BASE_INPUT = {
  orderId: "0x" + "4".repeat(64),
  priceCents: 950,
  supplierAddress: "0x" + "5".repeat(64),
  ts: 1_700_000_000,
  sigHex: "aa".repeat(64),
};

describe("buildExecuteOrderTx", () => {
  it("produces a well-formed execute_order call when price is within target", () => {
    const tx = buildExecuteOrderTx(CONFIG, BASE_INPUT, 1000);
    const data = tx.getData();
    const moveCall = data.commands.find((c) => c.$kind === "MoveCall")?.MoveCall;
    expect(moveCall?.module).toBe("procurement");
    expect(moveCall?.function).toBe("execute_order");
    expect(moveCall?.arguments).toHaveLength(8);
  });

  it("refuses client-side to build a call when price exceeds target", () => {
    expect(() => buildExecuteOrderTx(CONFIG, { ...BASE_INPUT, priceCents: 1500 }, 1000)).toThrow(
      ExecuteOrderGuardError,
    );
  });
});
