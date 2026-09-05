import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Where the zkLogin scaffold's small persisted-state files live (owner-session mappings, pending
 * unsigned-tx records — §4.5 steps 2-3). Override with DASHBOARD_DATA_DIR to point at a mounted
 * volume in deployment (§4.6 already documents a persistent `/data` mount for the agent side;
 * the dashboard needs the same treatment once it holds this state) — defaults to a repo-local,
 * gitignored `.data/` directory for local dev.
 */
export function getDataDir(): string {
  const dir = process.env.DASHBOARD_DATA_DIR ?? path.join(process.cwd(), ".data");
  mkdirSync(dir, { recursive: true });
  return dir;
}
