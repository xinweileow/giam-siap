import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Posts a Telegram message via `hermes send` (§4.3 point 2's "check now"/onAlert wiring, §9.1's
 * "alert yourself, not the owner"). Deliberately does NOT go through Hermes's agent loop or the
 * gateway service — `hermes send` reuses the gateway's platform credentials directly, no LLM, no
 * running gateway required (confirmed via `hermes send --help`). This keeps the watcher's
 * settlement path exactly as deterministic as before (§4.1's architecture note): a notification
 * failure here is a side-effect failure, never a reason to change what the watcher decided.
 */
export interface TelegramNotifyConfig {
  enabled: boolean;
  /** Path to the hermes executable, or a bare name resolved via PATH. */
  hermesBin: string;
  /** Hermes profile holding this project's bot token + home chat id (see agent/hermes.config/). */
  hermesProfile: string;
  /** `hermes send --to` target, e.g. "telegram" (home channel) or "telegram:<chat_id>". */
  target: string;
}

export async function sendTelegramMessage(config: TelegramNotifyConfig, message: string): Promise<void> {
  if (!config.enabled) return;
  await execFileAsync(config.hermesBin, ["send", "--to", config.target, "--quiet", message], {
    env: { ...process.env, HERMES_PROFILE: config.hermesProfile },
    timeout: 15_000,
  });
}
