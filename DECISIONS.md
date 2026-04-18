
# Design Decisions made while building VibeMeter

1. Why Monorepo (containing 4 packages) ?

The four packages (`core`, `cli`, `hooks`, `vscode`) all share the same data format (`.jsonl` events, ownership map, project registry) and types. A monorepo lets them import directly from `core` without publishing it to npm, so a change to the event schema updates every consumer atomically in one commit. Splitting into separate repos would mean version-bumping `core`, republishing, and updating dependents for every schema tweak — overhead with no benefit since all four packages are developed and released together.

---

2. Why have a dedicated `build.js`?

Most TypeScript projects just run `tsc` (the official compiler) with a `tsconfig.json` and call it a day. VibeMeter uses a custom `build.js` with `esbuild` for two reasons:

- **Speed:** `tsc` is slow because it does full type-checking while compiling. `esbuild` (written in Go) skips type-checking and just strips the type syntax, which is dramatically faster. We still run `tsc` separately for type-checking — it just doesn't emit files.
- **Monorepo control:** With four packages, a custom script lets us define per-package bundling rules (entry points, externals, output format) and build them all in parallel via `Promise.all`, which would be awkward to express with `tsc` alone.

In short: `tsc` is the default for simple projects, frameworks (Vite, Next.js) hide the build for frontend apps, and custom `esbuild` scripts are for cases like this one where speed and monorepo bundling matter.

---

3. Why use `commander` as the library for the CLI?

`commander` is one of the two de-facto standards for Node.js CLIs (the other being `yargs`). Both handle argument parsing, subcommands, help text, and validation so we don't hand-roll `process.argv` parsing.

(Basically what `commander` library does: You write code to describe your command line interface. Commander looks after parsing the arguments into options and command-arguments, displays usage errors for problems, and implements a help system.)

Quick landscape:
- **commander** — most popular, simple API, good for straightforward CLIs like `VibeMeter init`, `stats`, `serve`. Used by Vue CLI, create-react-app.
- **yargs** — more features (middleware, richer validation), heavier API. Used by Jest, Mocha.
- **oclif** — full framework (plugins, auto-generated docs). Overkill unless you're building something like the Heroku or Salesforce CLI.
- **clipanion, cac, sade** — lighter modern alternatives, less mainstream.

For VibeMeter's handful of subcommands, `commander` hits the sweet spot: standard, well-documented, and no feature bloat.

useful links:
- https://www.npmjs.com/package/commander#quick-start
- 

---
