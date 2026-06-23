# Codex Session Janitor

Codex Session Janitor is a small TypeScript project for browsing and cleaning
local Codex session transcripts. It provides a reusable core cleanup module, a
scriptable CLI, and a full-screen terminal UI that mirrors the Codex-native
session picker style.

The latest TUI is intended to be the external-tool counterpart to Codex's
native `/janitor` command: it offers similar session browsing and manual delete
behavior without requiring users to rebuild Codex itself. The regular CLI still
keeps richer automation-oriented commands such as retention-based cleanup and
startup cleanup.

## What It Cleans

By default, Codex stores local session transcripts under:

- `$CODEX_HOME/sessions`
- `$CODEX_HOME/archived_sessions`

This tool only scans those two directories. It does not scan or remove
`config.toml`, `auth.json`, `history.jsonl`, plugins, MCP config, memories, or
other Codex state.

## Install

```bash
npm install
npm run build
```

During development:

```bash
npm run dev -- scan
npm run dev -- clean --retention-days 30
npm run dev -- tui
```

After build:

```bash
node dist/cli.js scan
node dist/cli.js clean --retention-days 30
node dist/cli.js tui
```

## CLI

Scan current sessions:

```bash
codex-session-janitor scan --retention-days 30
```

Preview cleanup. This is a dry run unless `--confirm` is passed. In dry-run
mode, the tool computes and prints what would be removed but does not remove,
trash, or modify any files. Use it to verify the retention threshold, archived
toggle, path safety, and reclaimable size before running a real cleanup:

```bash
codex-session-janitor clean --retention-days 30
```

Move expired sessions to the system trash:

```bash
codex-session-janitor clean --retention-days 30 --confirm --mode trash
```

Hard-delete expired sessions:

```bash
codex-session-janitor clean --retention-days 30 --confirm --mode delete
```

Simulate the proposed startup integration point. It runs at most once per
interval and records a marker under `$CODEX_HOME`:

```bash
codex-session-janitor startup-clean --retention-days 30 --confirm
```

## TUI

```bash
codex-session-janitor tui
```

The TUI opens in an alternate full-screen terminal view and restores the
previous terminal state when it exits. It scans active Codex sessions, defaults
to the current working directory filter, and starts in dense view.

It is intentionally closer to Codex's built-in `/janitor` picker than to the
retention CLI. Sessions are selected manually and deleted only after an explicit
confirmation. There is no TUI dry-run toggle.

Rows display readable session titles when possible. If a transcript does not
have a dedicated title or summary field, the tool falls back to the first real
user message, skipping internal context records and shell-command noise.

The toolbar supports filtering and sorting:

- `Filter: Cwd | All`
- `Sort: Updated | Created`

Keys:

- `Space`: select or unselect a session for deletion
- `Enter`: request deletion; press Enter again quickly to confirm
- `Esc` / `Ctrl+C`: exit
- `Tab`: switch focus between filter and sort
- `Left` / `Right`: change the focused toolbar option
- `Ctrl+E`: expand the selected session details and recent conversation preview
- `Ctrl+O`: toggle dense and comfortable view
- `Up` / `Down` or `k` / `j`: browse sessions
- Type text: search sessions, including Chinese input

## Proposed Codex Integration Shape

The core module intentionally separates policy from effects:

- `scanSessions`: discovers transcript files under known session roots
- `buildCleanPlan`: applies retention policy and returns candidates
- `executeCleanPlan`: dry-run, trash, or hard-delete
- `runStartupCleanup`: startup-style cleanup with an interval marker

A Codex-native configuration could look like this:

```toml
[sessions.cleanup]
enabled = true
retention_days = 30
include_archived = true
mode = "trash"
interval_hours = 24
```

## Safety

- Dry-run is the default for destructive CLI commands.
- The cleaner refuses to remove paths outside `$CODEX_HOME/sessions` and
  `$CODEX_HOME/archived_sessions`.
- Trash mode is the default when real cleanup is confirmed.
- Tests use hard-delete only inside temporary fixture directories.

## Tests

```bash
npm run lint
npm test
npm run build
```

Covered behavior:

- Scanning active and archived session roots
- Readable metadata extraction from Codex JSONL transcripts
- Skipping internal context and shell-command records when choosing titles
- Retention cutoff behavior
- Excluding archived sessions
- Building a cleanup plan from manually selected TUI sessions
- Dry-run behavior
- Real deletion inside a temporary Codex home
- Refusing to delete paths outside session roots
- Startup cleanup interval marker

## Design References

This project was motivated by Claude Code's documented session cleanup setting
and by existing Claude cleanup tools. The current TUI also borrows interaction
details from Codex's own session picker:

- Codex `/resume`: inspired the full-screen TUI picker, dense/comfortable views,
  selected-row treatment, filter/sort toolbar, and `Ctrl+E` expanded session
  preview behavior.
- Claude Code `cleanupPeriodDays`: Anthropic documents a startup cleanup policy
  that deletes session files older than the configured number of days.
  <https://docs.anthropic.com/en/docs/claude-code/settings>
- Claude Code sessions: Claude Code documents resumable sessions backed by
  saved transcript state. <https://code.claude.com/docs/en/sessions>
- `claude-code-cleaner`: inspired the guided TUI shape, scan/select/preview/clean
  flow, expiry threshold, dry-run mode, protected paths, and per-category
  reporting. <https://github.com/GarrickZ2/claude-code-cleaner>
- `CC-Cleaner`: informed the idea of making local assistant session state
  browseable and cleanable with explicit preview/confirmation UX.
  <https://github.com/tk-425/CC-Cleaner>

## Related Projects

- [`claude-session-janitor`](https://github.com/zzy0222/claude-session-janitor):
  the sibling project for Claude Code sessions. It is a Claude Code port of this
  project and keeps the same CLI commands and TUI controls.

## Support

If this project helps you, you can support its development through:

- GitHub Sponsors: <https://github.com/sponsors/zzy0222>
- PayPal.Me: <https://paypal.me/zzy0222>

Mainland China payment methods:

| Alipay | WeChat Pay |
| --- | --- |
| <img src="donation-qrcodes/alipay_qrcode.jpg" width="220" alt="Alipay QR code"> | <img src="donation-qrcodes/wx_qrcode.jpg" width="220" alt="WeChat Pay QR code"> |

## License

MIT
