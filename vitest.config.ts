import { defineConfig } from 'vitest/config';

// Vitest configuration for the entire monorepo.
// All tests live under tests/ at the project root, organized by type:
//   tests/unit/        — pure logic tests, no file I/O
//   tests/integration/ — tests that run real hook scripts or the VS Code tracker
//   tests/e2e/         — full workflows (init → write → stats) using temp projects
//   tests/stress/      — concurrent and large-file scenarios
//   tests/fixtures/    — shared helpers and mock data used across test types
export default defineConfig({
  test: {
    // Look for test files anywhere under tests/
    include: ['tests/**/*.test.ts'],

    // Show each individual test name in the output (not just pass/fail summary)
    reporter: 'verbose',

    // Coverage settings — run with `pnpm test:coverage`
    coverage: {
      provider: 'v8',
      // Measure coverage across the actual source packages, not the test files
      include: ['packages/core/src/**', 'packages/cli/src/**', 'packages/hooks/src/**'],
      reporter: ['text', 'html'], // `text` prints to terminal, `html` opens in browser
    },
  },
});
