# Codex Session Janitor

Codex Session Janitor is a small TypeScript project that prototypes automatic
retention cleanup for local Codex session transcripts. It is designed as a
small core module that could be embedded into Codex later, plus a CLI and a
guided terminal UI for manual management.

The design borrows the useful parts of Claude Code cleaner tools: scan first,
adjust retention, preview before cleaning, dry-run by default, show readable
session labels where possible, and never touch configuration or authentication
files.

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

Screens:

- `1 Scan`: overview and recent files
- `2 Select`: retention days, archived inclusion, dry-run toggle
- `3 Preview`: exact plan before cleaning
- `4 Clean`: result screen

Scan and Preview display the saved session title/summary when available. If a
transcript does not have a dedicated title or summary field, the tool falls
back to the first user message, then to the session id. File path, cwd, age, and
size remain visible for final confirmation.

In dry-run mode, pressing Enter from Preview only simulates the cleanup. It
shows the result that a real run would produce without removing, trashing, or
modifying files.

Keys:

- `Left` / `Right`: adjust retention days on Select
- `a`: include/exclude archived sessions
- `d`: toggle dry-run
- `Enter`: run from Preview
- `r`: rescan
- `q`: quit

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
npm test
npm run build
```

Covered behavior:

- Scanning active and archived session roots
- Retention cutoff behavior
- Excluding archived sessions
- Dry-run behavior
- Real deletion inside a temporary Codex home
- Refusing to delete paths outside session roots
- Startup cleanup interval marker

## Design References

This project was motivated by Claude Code's documented session cleanup setting
and by existing Claude cleanup tools:

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

## License

MIT
