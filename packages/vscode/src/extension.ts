// packages/vscode/src/extension.ts
//
// VS Code extension entry point.
// VS Code calls `activate()` when the extension starts up,
// and `deactivate()` when VS Code shuts down or the extension is disabled.

import * as vscode from 'vscode';

// activate() is called once when the extension is first loaded.
// This is where we set up the status bar, sidebar, and change tracker.
export function activate(context: vscode.ExtensionContext): void {
  console.log('VibeMeter extension activated');

  // Components will be initialized here as we build them:
  // - statusbar.ts  → shows live attribution percentages in the status bar
  // - tracker.ts    → watches for file changes and attributes them to human/claude
  // - webview.ts    → sidebar dashboard with charts
}

// deactivate() is called when the extension is unloaded.
// Clean up timers, watchers, or other resources here.
export function deactivate(): void {
  console.log('VibeMeter extension deactivated');
}
