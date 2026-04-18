// build.js — esbuild script for the VibeMeter monorepo.
//
// Run with: node build.js
// Or via:   pnpm build
//
// esbuild handles TypeScript natively — no separate `tsc` step needed for builds.
// (We still use `tsc` for type-checking, but not for emitting files.)

import { build } from 'esbuild';

// Shared options applied to every package build
const shared = {
  bundle: true,         // Inline all imports into one output file
  platform: 'node',    // Target Node.js (not the browser)
  format: 'cjs',       // CommonJS output (require/module.exports)
  sourcemap: true,     // Generate .js.map for readable stack traces
  logLevel: 'info',    // Print what was built and how long it took
};

// Build all packages in parallel
await Promise.all([

  // --- core ---
  // Library package — exported as CommonJS for other packages to import
  build({
    ...shared,
    entryPoints: ['packages/core/src/index.ts'],
    outfile: 'packages/core/dist/index.js',
    // `external` tells esbuild NOT to bundle these — the consumer's node_modules provides them
    external: ['diff', 'glob'],
  }),

  // --- hooks ---
  // Two standalone Node.js scripts dropped into ~/.VibeMeter/ and run by Claude Code.
  // diff is not listed as external here because hooks use it via @vibemeter/core's
  // countLineDiff() utility — they never import diff directly.
  build({
    ...shared,
    entryPoints: ['packages/hooks/src/pre-hook.ts'],
    outfile: 'packages/hooks/dist/pre-hook.js',
  }),
  build({
    ...shared,
    entryPoints: ['packages/hooks/src/post-hook.ts'],
    outfile: 'packages/hooks/dist/post-hook.js',
  }),

  // --- cli ---
  // Single entry point; `commander` handles the sub-commands
  build({
    ...shared,
    entryPoints: ['packages/cli/src/index.ts'],
    outfile: 'packages/cli/dist/index.js',
    external: ['commander', 'glob', 'chokidar'],
  }),

  // Note: packages/vscode is built by @vscode/vsce, not esbuild directly.
  // Run `pnpm --filter @vibemeter/vscode package` to produce the .vsix.

]);
