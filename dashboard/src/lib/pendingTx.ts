import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getDataDir } from "./dataDir";

/**
 * A pending unsigned transaction awaiting the owner's real per-order browser signature (§4.5
 * step 3 — "create_order signing happens at EVERY order, not just first login"). `sui-mcp`'s
 * `createOrder`/`cancelOrder` would register one of these here and hand the owner a
 * `/sign?tx=<id>` link, instead of (or alongside) returning raw bytes directly — that wiring
 * isn't live yet (dev-only `devSignAndSubmitTx` is the working path today, see
 * agent/sui-mcp/src/tools/devSignAndSubmit.ts); this store exists so the `/sign` page itself is
 * real and testable the moment real credentials + that wiring land.
 */
export interface PendingTx {
  id: string;
  kind: "createOrder" | "cancelOrder";
  ownerAddress: string;
  unsignedTxBytesBase64: string;
  status: "pending" | "submitted" | "failed";
  createdAt: number;
  digest?: string;
  error?: string;
}

function filePath(): string {
  return path.join(getDataDir(), "pending-tx.json");
}

function readAll(): Record<string, PendingTx> {
  const file = filePath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, PendingTx>): void {
  writeFileSync(filePath(), JSON.stringify(all, null, 2));
}

export function createPendingTx(input: {
  kind: PendingTx["kind"];
  ownerAddress: string;
  unsignedTxBytesBase64: string;
}): PendingTx {
  const all = readAll();
  const record: PendingTx = {
    id: randomUUID(),
    kind: input.kind,
    ownerAddress: input.ownerAddress,
    unsignedTxBytesBase64: input.unsignedTxBytesBase64,
    status: "pending",
    createdAt: Date.now(),
  };
  all[record.id] = record;
  writeAll(all);
  return record;
}

export function getPendingTx(id: string): PendingTx | null {
  return readAll()[id] ?? null;
}

export function completePendingTx(
  id: string,
  result: { status: "submitted"; digest: string } | { status: "failed"; error: string },
): PendingTx | null {
  const all = readAll();
  const existing = all[id];
  if (!existing) return null;
  const updated: PendingTx = { ...existing, ...result };
  all[id] = updated;
  writeAll(all);
  return updated;
}
