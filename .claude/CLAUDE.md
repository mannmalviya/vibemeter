
## Project Overview

VibeMeter is a tool that tracks, at runtime, what percentage and number of lines of code in a project were written by Claude Code, the human developer, or existed as starter/scaffold code. Data is stored locally per user — never cloud-hosted.

## Tech Stack

- **Language:** TypeScript
- **Package manager:** pnpm (workspaces monorepo)
- **Build tool:** esbuild
- **Test framework:** Vitest + @vitest/coverage-v8
- **CLI framework:** commander
- **Key libraries:** `diff` (line diffing), `glob` (file enumeration), `chokidar` (file watching)
- **VS Code extension:** React + Recharts (webview dashboard), @vscode/vsce (packaging)
- No native binary dependencies (no `better-sqlite3`) — keeps the VS Code extension portable

## Architecture

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

All data lives locally at `~/.VibeMeter/` — never synced to a cloud.

**Data format:** append-only `.jsonl` files (one per project). Stats are computed at read time by summing `added - removed` per source.

```
~/.VibeMeter/
├── projects.json          # registry: { "project-id": { path, name, initAt } }
├── projects/
│   └── <project-id>/
│       ├── events.jsonl   # one event per line, append-only
│       └── ownership.json # line ownership map: { "src/foo.ts": ["claude", "human", ...] }
└── tmp/
    ├── <session>-<filehash>.txt  # pre-Write snapshot
    └── <filehash>.expected       # expected post-Claude file hash
```

**Attribution sources:**
- `starter` — lines present at `init` time (baseline snapshot, exact)
- `scaffold` — lines from known scaffolding tools detected at `init` (heuristic)
- `claude` — lines written by Claude Code via hooks (exact)
- `human` — all other changes (residual)

**Critical files:**

| Path | Purpose |
|------|---------|
| `packages/core/src/types.ts` | All shared types |
| `packages/core/src/log.ts` | Append/read/query `.jsonl` events |
| `packages/core/src/ownership.ts` | Line ownership map (for deletion attribution) |
| `packages/core/src/projects.ts` | Project registry |
| `packages/hooks/src/pre-hook.ts` | Snapshot file before Write |
| `packages/hooks/src/post-hook.ts` | Diff and log after Write/Edit/MultiEdit |
| `packages/cli/src/commands/init.ts` | Baseline snapshot + scaffold detection + hook install |
| `packages/vscode/src/tracker.ts` | Human change tracker |
| `packages/vscode/src/statusbar.ts` | Live status bar updater |
| `packages/vscode/src/webview.ts` | Sidebar dashboard panel |

## General Rules
- Use kebab case for naming files
- I am new to coding — write lots of comments to help me understand the code.
- Follow Test Driver Development -- Write tests first and then implementation to pass those tests

## Coding Rules

- No cloud, no shared DB — all data is local
- No native binary dependencies
- Stats are always computed at read time from the `.jsonl` log, never cached
- Attribution is content-based, not timing-based (use SHA-256 hashes to match Claude vs human edits)
- Tests live in `tests/` organized by unit / integration / e2e / stress

## Design Rules
- We want a clean simple design

## Commands

- `VibeMeter init [--path <dir>]` — register project, snapshot baseline, install hooks
- `VibeMeter stats [--project <path>]` — print attribution table
- `VibeMeter export [--format json|csv] [--out <file>]` — export stats
- `VibeMeter serve [--port 3456]` — serve web dashboard locally
- `VibeMeter projects` — list all tracked projects

## Command Guard

Before running any command, prefix your response with one of these labels:

- `[READ-ONLY]` — just looking, no harm done
- `[MUTATION]` — changes things, but recoverable
- `[DESTRUCTIVE]` — irreversible, think twice
- `[SYSTEM]` — touching system-level stuff like packages and permissions
