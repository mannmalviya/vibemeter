# AI Code Attribution Tracker -- VibeMeter

## Context
The user wants to build a tool that tracks, at runtime, what percentage and number of lines of code in a project were written by Claude Code, the human developer, or existed as starter/scaffold code. No commercial solution exists for this. The tool uses Claude Code's hook system for exact Claude attribution and a baseline snapshot at init time for starter code. Data is stored locally per user — never cloud-hosted.

---

## Architecture Overview

A TypeScript monorepo (`pnpm` workspaces) with four packages:

```
VibeMeter/
├── packages/
│   ├── core/      # Shared types, .jsonl log format, read/write/query logic
│   ├── cli/       # `VibeMeter` CLI (init, stats, export, serve)
│   ├── hooks/     # Claude Code Pre/PostToolUse hook scripts
│   └── vscode/    # VS Code extension (status bar + sidebar + web dashboard)
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

---

## Data Storage

**No cloud, no shared DB.** All data lives locally at `~/.VibeMeter/`.

**Format: append-only `.jsonl` files** (one per project, newline-delimited JSON). Chosen over SQLite to avoid native binary dependencies in the VS Code extension.

```
~/.VibeMeter/
├── projects.json          # registry: { "project-id": { path, name, initAt } }
└── events/
    └── <project-id>.jsonl # one event per line
```

**Event shape:**
```json
{ "source": "claude", "file": "src/foo.ts", "added": 12, "removed": 3, "ts": 1712600000000 }
```

**Sources:**
- `"starter"` — lines present at `init` time (baseline snapshot)
- `"scaffold"` — lines from known scaffolding tools (detected at `init`)
- `"claude"` — lines written by Claude Code (from hooks, exact)
- `"human"` — all other changes (residual)

**Stats are computed at read time** by summing `added - removed` per source from the `.jsonl` file.

---

## Sources & Attribution Strategy

| Source | Method | Accuracy |
|--------|--------|----------|
| `starter` | Line count snapshot of all files at `init` time | Exact |
| `scaffold` | Detect known scaffold patterns in git log + `package.json` scripts at `init` | Heuristic |
| `claude` | PostToolUse hook receives exact old/new content → diff | Exact |
| `human` | All changes not attributed to Claude Code | Residual |

### How Claude Code contribution is detected (exact)

Claude Code always modifies files through one of three tools: `Write`, `Edit`, or `MultiEdit`. VibeMeter registers two hooks in `~/.claude/settings.json`:

1. **PreToolUse (`Write` only)** — Before Claude overwrites a file, the hook reads and snapshots the current file content to `~/.VibeMeter/tmp/<session>-<filehash>.txt`.
2. **PostToolUse (`Write | Edit | MultiEdit`)** — After Claude finishes, the hook receives the exact payload Claude used:
   - For `Edit`/`MultiEdit`: the payload contains `old_string` and `new_string` directly — no snapshot needed, just diff them.
   - For `Write`: diff the pre-hook snapshot against the new file content.
   - The diff is counted (lines added, lines removed) and written as a `{ source: "claude", ... }` event to the `.jsonl` log.

This is **exact** — Claude literally tells us what it changed via the hook payload. No guessing.

### How Human contribution is detected (residual)

The VS Code extension subscribes to `workspace.onDidChangeTextDocument`, which fires on every file change regardless of source. The extension determines if a change is human as follows:

1. It watches the project `.jsonl` file for new entries (via `chokidar`).
2. It maintains a `Map<filePath, expectedHash>` (`claudeExpectedHash`) — keyed per file. When the PostToolUse hook fires, it writes the SHA-256 hash of the expected post-edit file content to `~/.VibeMeter/tmp/<filehash>.expected`. The extension reads this and stores it in the map.
3. When a `TextDocumentChangeEvent` fires for a file that has an entry in `claudeExpectedHash`:
   - Compute the SHA-256 of the current file content.
   - **Hash matches expected** → file is exactly what Claude produced, nothing extra. Skip — already logged by the hook. Clear the entry from the map.
   - **Hash does not match** → the file has diverged from Claude's output (human edited the same file during or just after Claude's write). Diff Claude's expected content against the actual content. The delta lines are attributed to `human`.
4. If the file has no entry in `claudeExpectedHash` → log the change as `{ source: "human", ... }` directly.

This approach is **content-based, not timing-based**, so it handles the race condition where a human edits the same file Claude is writing to. A human editing a different file is unaffected — `claudeExpectedHash` only has entries for files Claude recently touched.

Because the map is **per file**, a human editing `src/bar.ts` while Claude is simultaneously writing to `src/foo.ts` is handled correctly — `bar.ts` has no entry in `claudeExpectedHash`, so the human's change is attributed to `human` without interference.

### Deletion accounting

When lines are deleted, the event records `removed > 0`. To know *whose* lines were deleted, the extension maintains a **line ownership map** per file (`~/.VibeMeter/ownership/<project-id>/<filehash>.json`) — a flat array where each entry is the source (`"claude"` or `"human"`) that wrote that line.

- When Claude adds lines → ownership map updated with `"claude"` for those line indices.
- When a human adds lines → ownership map updated with `"human"`.
- When lines are deleted → the ownership map is consulted to find who originally wrote them, and the deletion is attributed to that source (e.g. human deleting Claude's lines reduces Claude's net count, not human's).

---

## Package Details

### `packages/core`
- `types.ts` — `Source`, `Event`, `ProjectStats`, `LineOwnershipMap` types
- `log.ts` — `appendEvent(projectId, event)`, `readEvents(projectId)`, `computeStats(projectId)`
- `ownership.ts` — `getOwnership(projectId, file)`, `applyEdit(map, added, removed, source)` (updates the line ownership array)
- `projects.ts` — `registerProject(path)`, `getProjectId(path)`, `listProjects()`
- `detect-root.ts` — walk up from cwd to find project root via `.git` / `package.json`

### `packages/hooks`

Two Node.js scripts deployed to `~/.VibeMeter/`:

**`pre-hook.js`** (PreToolUse, fires before `Write`):
- Reads current file contents and stores to `~/.VibeMeter/tmp/<session>-<file-hash>.txt`

**`post-hook.js`** (PostToolUse, fires after `Write | Edit | MultiEdit`):
- For `Edit`/`MultiEdit`: diffs `old_string` vs `new_string` directly from the payload
- For `Write`: diffs the pre-hook snapshot against the new file content
- Computes `lines_added` / `lines_removed`
- Appends `{ source: "claude", ... }` event
- Updates the line ownership map via `core/ownership`

**Hook registration** (written to `~/.claude/settings.json` by `VibeMeter init`):
```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Write", "hooks": [{ "type": "command", "command": "node ~/.VibeMeter/pre-hook.js" }] }],
    "PostToolUse": [{ "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "node ~/.VibeMeter/post-hook.js" }] }]
  }
}
```

### `packages/cli`

Commands (via `commander`):

- **`VibeMeter init [--path <dir>]`**
  1. Detects project root
  2. Registers project in `projects.json`
  3. Counts lines in all source files → logs a `starter` event
  4. Inspects git log for "initial commit" messages and `package.json` for known scaffold scripts (`create-react-app`, `vite`, `next`, `nest`, etc.) → logs a `scaffold` event if detected
  5. Installs hooks into `~/.claude/settings.json`
  6. Copies `pre-hook.js` / `post-hook.js` to `~/.VibeMeter/`

- **`VibeMeter stats [--project <path>]`** — prints attribution table to terminal:
  ```
  Source    Lines    %
  ────────────────────
  Starter   4,201   52%
  Claude    2,840   35%
  Human       959   13%
  ```

- **`VibeMeter export [--format json|csv] [--out <file>]`** — exports full stats + per-file breakdown for sharing

- **`VibeMeter serve [--port 3456]`** — serves web dashboard locally

- **`VibeMeter projects`** — lists all tracked projects with summary stats

### `packages/vscode`

**VS Code Extension:**

1. **Status bar item** — polls `core.computeStats()` every 3s, shows `☁ Claude 35% · Starter 52% · ✍ Human 13%`

2. **Sidebar webview panel** — React + Recharts:
   - Pie chart: current attribution breakdown
   - Bar chart: attribution over time (daily)
   - Project switcher for multi-project view

3. **Change tracker** (`tracker.ts`):
   - Subscribes to `workspace.onDidChangeTextDocument`
   - Watches the project `.jsonl` file for new Claude hook events (via `chokidar`)
   - Uses content-hash matching (not timing) to distinguish Claude vs human changes
   - Everything not attributed to Claude → `human` event appended + ownership map updated

4. **Export command** — `VibeMeter.export` command in command palette, opens save dialog

---

## Testing

### Framework & Structure

**Vitest** — TypeScript-native, fast, works across all packages in the monorepo.

```
packages/tests/
├── unit/
│   ├── core/           # log.ts, ownership.ts, projects.ts, detect-root.ts
│   └── hooks/          # diff logic in post-hook.ts
├── integration/
│   ├── hooks/          # run actual hook scripts with mock payloads
│   └── vscode/         # tracker.ts with mocked VS Code API
├── e2e/
│   └── sessions/       # full workflows: init → writes → stats
├── stress/
│   └── concurrent/     # simultaneous Claude + human on same file
└── fixtures/
    ├── projects/        # minimal temp project directories
    └── payloads/        # mock Claude hook JSON payloads
```

---

### Unit Tests (`packages/tests/unit/`)

**`core/log.test.ts`**
- `appendEvent()` writes a valid JSON line to the `.jsonl` file
- `readEvents()` parses all lines correctly, handles malformed lines gracefully
- `computeStats()` returns correct `added`/`removed`/`%` per source
- Empty log returns zeroed stats, not an error

**`core/ownership.test.ts`**
- `applyEdit()` inserts `"claude"` ownership for newly added lines at correct indices
- `applyEdit()` inserts `"human"` ownership for human-added lines
- Deleting lines shifts remaining line indices correctly in the map
- Deleting Claude-written lines returns `{ source: "claude", removed: N }`
- Deleting human-written lines returns `{ source: "human", removed: N }`
- Deleting a range spanning both Claude and human lines splits the attribution correctly

**`core/projects.test.ts`**
- `registerProject()` creates entry in `projects.json` with correct path and `initAt`
- `getProjectId()` returns stable ID for the same path
- `listProjects()` returns all registered projects

**`hooks/diff.test.ts`** (pure diff logic, no file I/O)
- `Edit` payload: `old_string` 3 lines → `new_string` 5 lines → `added: 2, removed: 0`
- `Edit` payload: replacing 4 lines with 1 → `added: 1, removed: 4`
- `Write` with pre-snapshot: new file adds 10 lines → `added: 10, removed: 0`
- Empty `old_string` (new file) handled without error

---

### Integration Tests (`packages/tests/integration/`)

**`hooks/post-hook.test.ts`**
- Pipe a mock `Edit` payload JSON to stdin of `post-hook.js` → verify a `claude` event is appended to the correct `.jsonl` file with correct line counts
- Pipe a mock `Write` payload (with pre-snapshot on disk) → verify event logged correctly
- Pipe a mock `MultiEdit` payload (multiple edits in one call) → verify each edit is summed correctly
- Hook exits with code 0 on success, non-zero on malformed input

**`vscode/tracker.test.ts`** (VS Code API mocked via `@vscode/test-electron` mocks)
- `TextDocumentChangeEvent` fires for a file with no entry in `claudeExpectedHash` → `human` event logged
- `TextDocumentChangeEvent` fires for a file whose hash matches `claudeExpectedHash` → skipped, no duplicate event
- `TextDocumentChangeEvent` fires for a file whose hash differs from `claudeExpectedHash` → delta attributed to `human`, Claude's expected lines attributed to `claude`

---

### E2E Tests (`packages/tests/e2e/`)

Each test creates a real temp directory, runs `VibeMeter init`, manipulates files, and asserts on `computeStats()`.

**`session-claude-only.test.ts`**
- Init a temp project (10 files, ~200 lines total)
- Fire PostToolUse hook payloads simulating Claude writing 50 new lines across 3 files
- Assert stats: `starter ~200 lines`, `claude 50 lines`, `human 0 lines`

**`session-human-only.test.ts`**
- Init a temp project
- Emit simulated `TextDocumentChangeEvent`s for human typing (small single-line insertions)
- Assert stats: `starter N lines`, `human M lines`, `claude 0 lines`

**`session-mixed.test.ts`**
- Init a temp project
- Interleave Claude hook payloads and human `TextDocumentChangeEvent`s on different files
- Assert each source's line count is correct and totals are consistent

**`session-deletions.test.ts`**
- Claude writes 20 lines → human deletes 5 of those lines
- Assert `claude` net lines = 15, ownership map updated, deletion correctly attributed

**`session-scaffold-detection.test.ts`**
- Init a temp project with a `package.json` containing `"create-react-app"` in scripts
- Assert `scaffold` source is detected and logged at init

---

### Stress Tests (`packages/tests/stress/`)

**`concurrent-same-file.test.ts`**
- Simulate Claude hook firing for `src/foo.ts` AND a human `TextDocumentChangeEvent` on `src/foo.ts` at the same millisecond
- Assert: Claude's lines attributed to `claude`, human delta attributed to `human`, no lines double-counted or lost
- Run 100 iterations with randomized line counts to confirm stability

**`rapid-alternation.test.ts`**
- 200 events interleaved: alternating Claude hook payloads and human change events across 5 files
- Assert final stats match the sum of all individual events
- Assert ownership map is internally consistent (no index drift)

**`large-file.test.ts`**
- Claude writes a 5,000-line file
- Human makes 50 small edits scattered throughout
- Assert line counts correct, ownership map handles 5,000 entries without performance degradation (complete in < 500ms)

---

### Test Helpers (`packages/tests/fixtures/`)

- **`makePayload(type, opts)`** — constructs mock Claude hook JSON payloads for `Write`/`Edit`/`MultiEdit`
- **`makeChangeEvent(file, insertedText, range)`** — constructs a mock VS Code `TextDocumentChangeEvent`
- **`makeTempProject(files)`** — creates a temp directory with given files, runs `VibeMeter init`, returns project ID and cleanup function
- **`readStats(projectId)`** — shorthand for `computeStats()` in tests

---

### Test Dependencies (dev only)

| Package | Use |
|---------|-----|
| `vitest` | Test runner |
| `@vitest/coverage-v8` | Code coverage |
| `tmp` | Temp directory creation/cleanup in e2e tests |

---

## Implementation Steps

1. **Scaffold monorepo** — `pnpm init`, workspace config, shared `tsconfig.base.json`, `esbuild` for builds
2. **`core` package** — log append/read, stats compute, ownership map, project registry
3. **Unit tests for `core`** — all functions covered before moving on
4. **`hooks` package** — pre-hook (snapshot) + post-hook (diff + log)
5. **Integration tests for `hooks`** — verify real hook scripts process payloads correctly
6. **`cli` package** — `init`, `stats`, `export`, `serve`
7. **E2E tests** — full session workflows using temp projects
8. **`vscode` package** — extension scaffold → change tracker → status bar → sidebar webview
9. **Integration tests for `vscode/tracker`** — content-hash matching, human attribution
10. **Stress tests** — concurrent same-file, rapid alternation, large files

---

## Critical Files

| Path | Purpose |
|------|---------|
| `packages/core/src/types.ts` | All shared types |
| `packages/core/src/log.ts` | Append/read/query `.jsonl` events |
| `packages/core/src/ownership.ts` | Line ownership map (for deletion attribution) |
| `packages/core/src/projects.ts` | Project registry |
| `packages/hooks/src/pre-hook.ts` | Snapshot file before Write |
| `packages/hooks/src/post-hook.ts` | Diff and log after Write/Edit/MultiEdit |
| `packages/cli/src/commands/init.ts` | Baseline snapshot + scaffold detection + hook install |
| `packages/cli/src/commands/export.ts` | JSON/CSV export |
| `packages/vscode/src/tracker.ts` | Human change tracker |
| `packages/vscode/src/statusbar.ts` | Live status bar updater |
| `packages/vscode/src/webview.ts` | Sidebar dashboard panel |

---

## Dependencies

| Package | Use |
|---------|-----|
| `commander` | CLI argument parsing |
| `diff` | Unified diff / line count in hooks |
| `glob` | File enumeration for baseline snapshot |
| `chokidar` | Watch `.jsonl` for changes in VS Code extension |
| `@vscode/vsce` | VS Code extension packaging |
| `esbuild` | Fast TypeScript bundling |
| `react` + `recharts` | Webview dashboard charts |

No native binary dependencies (no `better-sqlite3`) to keep the VS Code extension portable.

---

## Verification

1. `VibeMeter init` in a project → confirm `projects.json` has entry, `starter` event in `.jsonl`, hooks in `~/.claude/settings.json`
2. Ask Claude to write a file → confirm `claude` event appended, `VibeMeter stats` shows updated %
3. Manually type in VS Code → confirm `human` events logged
4. Delete Claude-written lines → confirm ownership map consulted and deletion attributed to `claude`
5. `VibeMeter export --format csv` → open file, confirm correct columns and values
6. `VibeMeter serve` → `localhost:3456` → charts render with real data
7. VS Code status bar updates within 3s of any change
