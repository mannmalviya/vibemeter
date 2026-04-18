# VibeMeter: Attribution Strategy & Data Storage

---

## 1. The Four Sources

Every line of code in your project gets tagged with exactly one of four sources:

| Source | What it means |
|---|---|
| `starter` | Lines that existed when you ran `VibeMeter init` (your baseline) |
| `scaffold` | A subset of starter lines that came from a scaffolding tool (CRA, Vite, Next, Nest, etc.) |
| `claude` | Lines written or modified by Claude Code via its tool hooks |
| `human` | Everything else — lines you typed yourself |

The key principle: **attribution is content-based, not timing-based.** The system does not rely on timestamps to decide who wrote what. It uses SHA-256 hashes of actual file content.

---

## 2. Data Storage

Everything lives locally at `~/.VibeMeter/`. Nothing is ever sent to a cloud.

```
~/.VibeMeter/
├── projects.json              # Project registry
├── projects/
│   └── <project-id>/
│       ├── events.jsonl       # One JSON event per line, append-only
│       └── ownership.json     # Line ownership map: { "src/foo.ts": ["claude", "human", ...] }
└── tmp/
    ├── <session>-<filehash>.txt      # Pre-Write snapshot
    └── <filehash>.expected           # Expected post-Claude hash
```

### `projects.json` — the registry

A plain JSON object mapping a stable project ID to metadata:

```json
{
  "abc123": { "path": "/home/mann/myapp", "name": "myapp", "initAt": 1712600000000 }
}
```

### `projects/<project-id>/events.jsonl` — the source of truth

This is an **append-only newline-delimited JSON file**. One JSON object per line. Never rewritten, only appended to. Stats are **always computed at read time** by summing up all events — nothing is cached.

Each event looks like:

```json
{ "source": "claude", "file": "src/foo.ts", "added": 12, "removed": 3, "ts": 1712600000000 }
```

Why `.jsonl` over SQLite? SQLite requires a native binary (`better-sqlite3`) which would break the VS Code extension on different OS/arch combinations. `.jsonl` is pure text — zero native dependencies.

### `projects/<project-id>/ownership.json` — the line ownership map

A JSON object keyed by file path, where each value is a flat array representing who wrote each line:

```json
{ "src/foo.ts": ["starter", "starter", "claude", "claude", "human", "claude"] }
```

This is how the system knows *whose* lines were deleted (covered in detail below).

---

## 3. The `init` Command — Establishing the Baseline

When you run `VibeMeter init`, the following happens in order:

**Step 1 — Detect project root.**
Walk up from the current directory looking for `.git` or `package.json`. This finds the real root of the project.

**Step 2 — Register in `projects.json`.**
Generate a stable project ID (a hash of the absolute path), write the entry.

**Step 3 — Snapshot all source files → log a `starter` event.**
Use `glob` to enumerate every source file. Count total lines. Write:
```json
{ "source": "starter", "file": "*", "added": 4201, "removed": 0, "ts": ... }
```
This is the baseline. Every line that exists right now is tagged `starter`.

**Step 4 — Scaffold detection → optionally log a `scaffold` event.**
Inspect:
- The git log for "initial commit" patterns
- `package.json` scripts for known tool fingerprints: `create-react-app`, `vite`, `next`, `nest`, etc.

If detected, log a `scaffold` event covering the estimated lines those tools generated. This is a **heuristic** — not exact — but it gives you the meaningful split between "lines I chose to write" vs "lines a generator dumped into the project."

**Step 5 — Install hooks.**
Copy `pre-hook.js` and `post-hook.js` to `~/.VibeMeter/`, then write into `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse":  [{ "matcher": "Write",                "hooks": [{ "type": "command", "command": "node ~/.VibeMeter/pre-hook.js" }] }],
    "PostToolUse": [{ "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "node ~/.VibeMeter/post-hook.js" }] }]
  }
}
```

From this point, Claude Code will automatically invoke these scripts every time it writes or edits a file.

---

## 4. Claude Attribution — Exact, Via Hooks

Claude Code modifies files through exactly three tools: `Write`, `Edit`, and `MultiEdit`. VibeMeter intercepts both sides of every one of these operations.

### Pre-hook (fires before `Write` only)

Claude is about to **overwrite** an entire file. Before it does, the pre-hook:
1. Reads the current file content from disk.
2. Saves it to `~/.VibeMeter/tmp/<session>-<filehash>.txt`.

This snapshot is the "before" state that the post-hook will diff against.

Why only `Write`? Because `Edit` and `MultiEdit` include the old content directly in their payloads — no snapshot needed.

### Post-hook (fires after `Write`, `Edit`, `MultiEdit`)

The hook receives the Claude tool payload via stdin. The logic branches by tool type:

**For `Edit` / `MultiEdit`:**
The payload contains `old_string` and `new_string` directly. The hook diffs them using the `diff` library — this gives exact lines added and lines removed. No file I/O needed for the "before" state.

**For `Write`:**
The hook loads the pre-hook snapshot from `~/.VibeMeter/tmp/`, diffs it against the new file content on disk, and counts lines added/removed.

After diffing, the post-hook:
1. Appends a `{ source: "claude", file: "...", added: N, removed: M, ts: ... }` event to the `.jsonl` file.
2. Updates the **line ownership map** for that file (marks the newly added line indices as `"claude"`).
3. Writes the SHA-256 hash of the expected post-edit file content to `~/.VibeMeter/tmp/<filehash>.expected`. This is used by the VS Code extension to detect whether a human modified the same file right after Claude.

This attribution is **exact** — Claude literally hands us `old_string` and `new_string` in its tool payload.

---

## 5. Human Attribution — Content-Hash Based (Residual)

The VS Code extension (`tracker.ts`) handles human attribution. It subscribes to VS Code's `workspace.onDidChangeTextDocument` event, which fires on every file save or edit regardless of what caused it.

The problem: when Claude writes a file, that write also triggers `onDidChangeTextDocument`. The extension must not double-count Claude's write as a human change.

### The `claudeExpectedHash` map

The extension maintains an in-memory `Map<filePath, expectedHash>`. When the post-hook writes a `.expected` file, the extension (which is watching `~/.VibeMeter/tmp/` via `chokidar`) reads it and stores the hash:

```
claudeExpectedHash["src/foo.ts"] = "sha256:abc..."
```

### Decision logic on every `TextDocumentChangeEvent`

When a file-change event fires for `src/foo.ts`:

1. **Is there an entry in `claudeExpectedHash` for this file?**

   - **No entry** — This file was not recently touched by Claude. The change is entirely human. Log `{ source: "human", ... }` and update the ownership map.

   - **Entry exists** — Claude recently touched this file. Compute SHA-256 of the current file content.
     - **Hash matches** — The file is exactly what Claude produced. This event is just VS Code reflecting Claude's write. Skip it — already logged by the post-hook. Remove the entry from the map.
     - **Hash does not match** — The file diverged from what Claude produced. The human edited the same file during or just after Claude's write. Diff Claude's expected content against the actual current content. The delta lines are attributed to `human`.

This is why it's **content-based, not timing-based**: it doesn't matter if the human edit happened 10ms or 10 seconds after Claude's write — the hash tells you definitively whether anything changed beyond what Claude intended.

### Per-file isolation

Because the map is keyed per file path, a human editing `src/bar.ts` while Claude is writing `src/foo.ts` is handled cleanly. `bar.ts` has no entry in `claudeExpectedHash`, so its change is immediately attributed to `human`. No interference between files.

---

## 6. Deletion Accounting — The Ownership Map

When lines are deleted, it matters *whose* lines were deleted. Deleting Claude's lines should reduce Claude's net count. Deleting your own lines should reduce your count.

The ownership map (`ownership.ts`) solves this. It's a flat array stored per file where each index is a line number and the value is the source that wrote it:

```json
["starter", "starter", "claude", "human", "claude", "claude"]
```

### `applyEdit(map, addedLines, removedAt, source)`

This function is called every time lines are added or removed:

- **Adding lines** — Insert `source` at the correct indices, shift everything after them down.
- **Removing lines** — Look up the ownership of each deleted line index, attribute the deletion to that source (e.g. if you delete line 4 which is `"claude"`, the event logs `{ source: "claude", removed: 1 }`), then remove those indices from the array.
- **Mixed range** — If you delete lines 3–6 and they span both `"claude"` and `"human"` ownership, the deletion is split into two separate events.

The net line count per source is always: `sum(added) - sum(removed)` across all events for that source.

---

## 7. Stats Computation

At any point, `computeStats(projectId)` reads the entire `.jsonl` file and folds all events:

```
for each event:
  stats[event.source].lines += event.added - event.removed

total = sum of all sources
stats[each].percent = stats[each].lines / total * 100
```

This runs at read time every time — no caching, no stale state. The `.jsonl` file is the single source of truth.

---

## 8. Complete Workflow, End to End

```
VibeMeter init
    │
    ├─ Snapshot all files → starter event in .jsonl
    ├─ Detect scaffold tools → scaffold event (if found)
    └─ Install pre-hook + post-hook into ~/.claude/settings.json

── Claude writes src/foo.ts ──────────────────────────────────────────
    │
    ├─ [PreToolUse] pre-hook.js fires
    │       └─ Saves snapshot to ~/.VibeMeter/tmp/<hash>.txt
    │
    ├─ Claude actually writes the file
    │
    └─ [PostToolUse] post-hook.js fires
            ├─ Diffs snapshot vs new content → added: 12, removed: 3
            ├─ Appends { source: "claude", added: 12, removed: 3 } to .jsonl
            ├─ Updates ownership map: lines 45–56 → "claude"
            └─ Writes SHA-256 of new content to ~/.VibeMeter/tmp/<hash>.expected

── VS Code fires TextDocumentChangeEvent for src/foo.ts ──────────────
    │
    ├─ tracker.ts sees the event
    ├─ Looks up claudeExpectedHash["src/foo.ts"] → hash exists
    ├─ Computes SHA-256 of current file
    ├─ Hash matches expected → Claude's write, already logged → SKIP
    └─ Clears entry from map

── Human edits src/bar.ts ────────────────────────────────────────────
    │
    ├─ VS Code fires TextDocumentChangeEvent for src/bar.ts
    ├─ tracker.ts sees event
    ├─ No entry in claudeExpectedHash for bar.ts
    ├─ Appends { source: "human", added: 2, removed: 0 } to .jsonl
    └─ Updates ownership map: new lines → "human"

── Human deletes Claude's lines in src/foo.ts ────────────────────────
    │
    ├─ VS Code fires TextDocumentChangeEvent
    ├─ tracker.ts calls applyEdit(ownershipMap, 0, [45,46,47], ...)
    ├─ Ownership map says lines 45–47 are "claude"
    ├─ Appends { source: "claude", added: 0, removed: 3 } to .jsonl
    └─ Removes indices 45–47 from ownership map, shifts remaining

── VibeMeter stats ───────────────────────────────────────────────────
    │
    └─ Reads entire .jsonl, sums added-removed per source
       ┌──────────────────────────────┐
       │ Source    Lines    %         │
       │ ──────────────────────────── │
       │ Starter   4,201   52%        │
       │ Claude    2,840   35%        │
       │ Human       959   13%        │
       └──────────────────────────────┘
```

---

## 9. Key Design Decisions

| Decision | Reason |
|---|---|
| `.jsonl` not SQLite | No native binary deps — VS Code extension works on all platforms |
| Append-only log | Simple, crash-safe, auditable. Stats computed at read time |
| Content-hash matching (not timing) | Immune to race conditions between Claude writes and human edits |
| Ownership map as flat array | O(1) lookup by line index, straightforward index shifting on insert/delete |
| Pre-hook only for `Write` | `Edit`/`MultiEdit` payloads already contain `old_string` — no snapshot needed |
| All data local | Privacy, no auth, no network, works offline |
