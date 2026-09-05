#!/usr/bin/env node
/**
 * Renders context.json + system-prompt.md (this directory, repo-tracked, the source of truth)
 * into the live, machine-local Hermes profile config that the Telegram gateway actually reads.
 *
 * Why this indirection exists: Hermes profiles are independent, out-of-repo, per-machine state
 * (see README.md in this directory for the full explanation) — a repo-local AGENTS.md is not
 * guaranteed to be auto-injected into a Telegram gateway conversation, but a profile's
 * `gateway-config.yaml` `channel_overrides.<chatId>.system_prompt` reliably is, regardless of
 * the gateway process's working directory. Run this script every time context.json or
 * system-prompt.md changes, then restart the gateway (`hermes gateway restart`, or `hermes
 * gateway install` if it isn't running as a service yet) for the new prompt to take effect.
 *
 * Usage:
 *   node sync-to-hermes-profile.mjs [--profile <name>] [--dry-run]
 *
 * `--profile` defaults to context.json's telegram.hermesProfile ("giam-siap"). `--dry-run`
 * prints the file that would be written instead of writing it.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function parseArgs(argv) {
  const args = { dryRun: false, profile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--profile") args.profile = argv[++i];
  }
  return args;
}

/** Resolves the Hermes home directory the same way hermes_constants.py does for this OS —
 * override with HERMES_HOME if your install lives somewhere non-default. */
function resolveHermesHome() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  if (platform() === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "hermes");
  }
  return path.join(homedir(), ".hermes");
}

/** Indents every line of `text` by `spaces`, preserving blank lines (paragraph breaks) as-is —
 * this is what a YAML folded block scalar (`>-`) expects for multi-paragraph content. */
function indentBlock(text, spaces) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? "" : pad + line))
    .join("\n");
}

function renderItemTable(items) {
  return Object.entries(items)
    .map(([itemId, item]) => {
      const contextOnly = item.priceCheckUrlNote?.toLowerCase().includes("context-only");
      const suffix = contextOnly
        ? " (context-only, no signed price API yet)"
        : item.displayUrl && item.displayUrl !== item.priceCheckUrl
          ? ` (display page: ${item.displayUrl})`
          : "";
      return `  ${itemId} -> ${item.priceCheckUrl}${suffix}`;
    })
    .join("\n");
}

function renderSystemPrompt(context, promptTemplate) {
  return promptTemplate
    .replace(/\{\{WORKDIR\}\}/g, repoRoot.replace(/\\/g, "/"))
    .replace(/\{\{RATE_MIST_PER_CENT\}\}/g, String(context.rateMistPerCent))
    .replace(/\{\{OWNER_TELEGRAM_USER_ID\}\}/g, context.telegram.homeChatId)
    .replace(/\{\{DASHBOARD_URL\}\}/g, context.dashboardUrl)
    .replace(/\{\{ITEM_TABLE\}\}/g, renderItemTable(context.items))
    .replace(/\{\{WATCHER_CHECK_NOW_URL\}\}/g, context.watcher.checkNowUrl)
    .trimEnd();
}

function renderGatewayConfigYaml(chatId, promptText) {
  const promptBlock = indentBlock(promptText, 10);
  return [
    "platforms:",
    "  telegram:",
    "    channel_overrides:",
    `      "${chatId}":`,
    "        system_prompt: >-",
    promptBlock,
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = JSON.parse(readFileSync(path.join(here, "context.json"), "utf8"));
  const promptTemplate = readFileSync(path.join(here, "system-prompt.md"), "utf8");
  const profile = args.profile ?? context.telegram.hermesProfile;

  const promptText = renderSystemPrompt(context, promptTemplate);
  const rendered = renderGatewayConfigYaml(context.telegram.homeChatId, promptText);

  if (args.dryRun) {
    console.log(`--- would write to profile "${profile}" ---\n`);
    console.log(rendered);
    return;
  }

  const profileDir = path.join(resolveHermesHome(), "profiles", profile);
  if (!existsSync(profileDir)) {
    throw new Error(
      `Hermes profile directory not found: ${profileDir}\n` +
        `Create the profile first (e.g. \`hermes profile create ${profile}\`) or pass --profile <name>.`,
    );
  }
  const target = path.join(profileDir, "gateway-config.yaml");
  if (existsSync(target)) {
    const backup = `${target}.bak-${Date.now()}`;
    writeFileSync(backup, readFileSync(target));
    console.log(`Backed up existing gateway-config.yaml -> ${backup}`);
  } else {
    mkdirSync(profileDir, { recursive: true });
  }
  writeFileSync(target, rendered);
  console.log(`Wrote ${target}`);
  console.log('Restart the gateway for this to take effect: `hermes gateway restart` (or `hermes gateway install` if not running as a service).');
}

main();
