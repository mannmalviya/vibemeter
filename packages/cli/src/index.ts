// packages/cli/src/index.ts
//
// Entry point for the VibeMeter CLI.
// Uses the `commander` library to wire up sub-commands.
//
// Commands (added one at a time as we build):
//   vibemeter init     — register project, snapshot baseline, install hooks
//   vibemeter stats    — print attribution table
//   vibemeter export   — export stats as JSON or CSV
//   vibemeter serve    — serve web dashboard locally
//   vibemeter projects — list all tracked projects

import { program } from 'commander';

program
  .name('vibemeter')
  .description('Track what percentage of your code was written by Claude Code vs you')
  .version('0.1.0');

// Sub-commands will be registered here as we implement them:
// program.addCommand(initCommand);
// program.addCommand(statsCommand);
// program.addCommand(exportCommand);
// program.addCommand(serveCommand);
// program.addCommand(projectsCommand);

/**
 * Below line is what actually runs the CLI
 * 
 * It reads the command-line arguments from Node’s process.
 * argv, matches them against the configured command 
 * structure, and then either executes the relevant 
 * command or prints help/version info.
 */
program.parse(process.argv);
