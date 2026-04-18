// packages/hooks/src/index.ts
//
// The hooks package contains two standalone Node.js scripts that Claude Code
// runs automatically every time it writes or edits a file:
//
//   pre-hook.ts  — runs BEFORE a Write, snapshots the current file content
//   post-hook.ts — runs AFTER a Write/Edit/MultiEdit, diffs and logs the change
//
// These scripts are deployed to ~/.VibeMeter/ by `vibemeter init`.
// They are not imported by other packages — they run as standalone scripts.
//
// This index.ts exists only to satisfy the TypeScript project structure.
