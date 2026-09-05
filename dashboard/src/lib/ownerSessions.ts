import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "./dataDir";

/**
 * `{telegramUserId -> zkLoginAddress}` persistence (§4.5 step 2's acceptance criterion, §8.4:
 * "The owner-session store survives a full restart of the agent process — a returning owner
 * doesn't need to redo Google OAuth just because the container restarted"). A flat JSON file is
 * enough at this project's single-owner-per-demo scale (§0.5's non-goals rule out multi-tenant
 * complexity) — Enoki's own client-side SDK separately handles *not re-prompting Google*, this
 * file only needs to answer "does this Telegram user already have an address".
 */
export interface OwnerSession {
  address: string;
  createdAt: number;
}

function filePath(): string {
  return path.join(getDataDir(), "owner-sessions.json");
}

function readAll(): Record<string, OwnerSession> {
  const file = filePath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function getOwnerSession(telegramUserId: string): OwnerSession | null {
  return readAll()[telegramUserId] ?? null;
}

export function setOwnerSession(telegramUserId: string, address: string): OwnerSession {
  const all = readAll();
  const session: OwnerSession = { address, createdAt: all[telegramUserId]?.createdAt ?? Date.now() };
  all[telegramUserId] = session;
  writeFileSync(filePath(), JSON.stringify(all, null, 2));
  return session;
}
