# agent/hermes.config/

Repo-tracked source of the persistent context Hermes needs to correctly parse a real Telegram
procurement request — the owner's address, the on-chain `rate_mist_per_cent`, and the item→vendor
URL table — without anyone hand-feeding it in a one-off prompt (§4.1 of IMPLEMENTATION_PLAN.md;
this closes the P0 gap tracked in TODOS.md as "Give Hermes persistent project context").

## Files

- `context.json` — the actual facts (addresses, rate, item→URL table, endpoints). Edit this when
  the deployed contract's IDs/rate change, a new item is added, or a vendor URL changes.
- `system-prompt.md` — the prompt template (prose + instructions), with `{{PLACEHOLDER}}` tokens
  filled in from `context.json` by the sync script below.
- `sync-to-hermes-profile.mjs` — renders the two files above into the live Hermes profile config.

## Why this isn't just a repo-local `AGENTS.md`

Hermes's own `--ignore-rules` help text documents that a CWD's `AGENTS.md`/`SOUL.md` is
auto-injected into CLI/chat sessions started in that directory — which is why a repo-root
`AGENTS.md` also exists at `../../AGENTS.md` and is useful for `hermes -z`/`hermes chat` sessions
run from this repo. But a live **Telegram gateway** conversation is not guaranteed to run with
this repo as its working directory — profiles are independent, out-of-repo, per-machine islands
(`%LOCALAPPDATA%\hermes\profiles\<name>\` on Windows, `~/.hermes/profiles/<name>/` elsewhere), and
this machine's `giam-siap` profile's `terminal.cwd` is just `.` (relative to wherever the gateway
process happens to be started), not this repo.

What **is** reliably included in a specific Telegram channel's conversation, regardless of the
process's cwd, is that profile's `gateway-config.yaml`:

```yaml
platforms:
  telegram:
    channel_overrides:
      "<chat_id>":
        system_prompt: >-
          <injected verbatim into that channel's system prompt>
```

That's the actual, proven mechanism this project uses — confirmed live via `hermes -z` runs of
the exact demo phrasing, 5/5 correct (see IMPLEMENTATION_PLAN.md's "Current status"). This
directory is the reviewable, version-controlled source for that file's content; the file itself
lives outside the repo (machine-local Hermes state, same category as its session DB or `.env`),
so it's synced, not committed.

## Usage

After editing `context.json` or `system-prompt.md`:

```bash
node agent/hermes.config/sync-to-hermes-profile.mjs           # writes to the "giam-siap" profile
node agent/hermes.config/sync-to-hermes-profile.mjs --dry-run # preview without writing
node agent/hermes.config/sync-to-hermes-profile.mjs --profile my-other-profile
hermes gateway restart   # or `hermes gateway install` if it isn't running as a service yet
```

The script backs up the previous `gateway-config.yaml` (`.bak-<timestamp>`) before overwriting —
it fully regenerates the file, so anything added to it outside this script (e.g. by
`hermes gateway setup` for a second platform) needs to be re-added to the template if that ever
happens.

## Known gaps, honestly stated

- Only one Telegram chat ID (`context.json`'s `telegram.homeChatId`, the dev/demo owner) gets this
  context today. A real multi-owner product would need this keyed per-owner, not one hardcoded
  channel override — out of scope for the current single-owner demo.
- `sugar` and `rice` in `context.json`'s item table point at real, human-facing vendor pages
  (picked per this session's instructions), not signed price-check endpoints — see each item's
  `priceCheckUrlNote`. Creating an order against either item today will monitor forever and safely
  alert on failure, never falsely settle (§9.1) — it demonstrates the failure path, not the happy
  path. `coffee` is the one item with a real working signed endpoint today
  (`agent/watcher/dev/vendor-stub.ts`, a local stand-in for teammates' `cooking-bistro.vercel.app`
  mock vendor site, which is a real display/catalog page but doesn't expose the signed
  `/api/price` endpoint from §4.2's spec yet).
