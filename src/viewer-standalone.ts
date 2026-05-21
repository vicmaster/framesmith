#!/usr/bin/env node

/**
 * Standalone canvas viewer — runs independently of the MCP server.
 *
 * Usage:
 *   canvas-viewer              # auto-pick port starting at 3001
 *   canvas-viewer 3004         # use a specific port
 *   CANVAS_VIEWER_PORT=3004 canvas-viewer
 *
 * This watches ~/.canvas-mcp/ for changes and serves them via the same viewer
 * UI, showing the global store plus every repo bound with `canvas_bind`
 * (registered in registry.json). Run it in a terminal tab and it stays alive
 * regardless of whether a Claude Code session is active.
 */

import { loadGlobalAndRegisteredRepos } from './aggregate.js';
import { startViewer, getViewerUrl } from './viewer.js';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

// Match the env-overridable data dir scene-graph.ts uses, so CANVAS_MCP_HOME
// relocates the watcher too.
const DATA_DIR = process.env.CANVAS_MCP_HOME ?? join(homedir(), '.canvas-mcp');
const CANVAS_DIR = join(DATA_DIR, 'canvases');

async function main() {
  // Ensure directory exists
  mkdirSync(CANVAS_DIR, { recursive: true });

  // Load the global store plus every registered repo's `.canvas/` (read-only).
  loadGlobalAndRegisteredRepos();

  // Determine port
  const portArg = process.argv[2];
  const port = portArg
    ? parseInt(portArg, 10)
    : parseInt(process.env.CANVAS_VIEWER_PORT ?? '0', 10);

  // Start HTTP viewer
  await startViewer(port);

  const url = getViewerUrl();
  console.log(`\n  Canvas MCP Viewer is running at: ${url}\n`);
  console.log(`  Watching ${DATA_DIR} for changes...\n`);
  console.log(`  Press Ctrl+C to stop.\n`);

  // Re-aggregate (global + registered repos) on any change. Debounced.
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  const reload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadGlobalAndRegisteredRepos(), 500);
  };
  // Global canvas writes.
  watch(CANVAS_DIR, (_eventType, filename) => {
    if (filename?.endsWith('.json')) reload();
  });
  // New / removed repo bindings (registry.json lives at the data-dir root).
  watch(DATA_DIR, (_eventType, filename) => {
    if (filename === 'registry.json') reload();
  });

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\nShutting down viewer...');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start canvas viewer:', err);
  process.exit(1);
});
