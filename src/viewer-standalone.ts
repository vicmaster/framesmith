#!/usr/bin/env node

/**
 * Standalone canvas viewer — runs independently of the MCP server.
 *
 * Usage:
 *   framesmith-viewer              # auto-pick port starting at 3001
 *   framesmith-viewer 3004         # use a specific port
 *   FRAMESMITH_VIEWER_PORT=3004 framesmith-viewer
 *
 * This watches ~/.framesmith/ for changes and serves them via the same viewer
 * UI, showing the global store plus every repo bound with `canvas_bind`
 * (registered in registry.json). Run it in a terminal tab and it stays alive
 * regardless of whether a Claude Code session is active.
 */

import { loadGlobalAndRegisteredRepos, watchAggregateSources } from './aggregate.js';
import { migrateLegacyHome, readRegistry } from './repo-store.js';
import { startViewer, getViewerUrl } from './viewer.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

// Match the env-overridable data dir scene-graph.ts uses, so FRAMESMITH_HOME
// relocates the watcher too.
const DATA_DIR = process.env.FRAMESMITH_HOME ?? process.env.CANVAS_MCP_HOME ?? join(homedir(), '.framesmith');
const CANVAS_DIR = join(DATA_DIR, 'canvases');

async function main() {
  // Migrate the pre-rebrand global store before anything creates the new dir.
  migrateLegacyHome();

  // Ensure directory exists
  mkdirSync(CANVAS_DIR, { recursive: true });

  // Load the global store plus every registered repo's `.framesmith/` (read-only).
  loadGlobalAndRegisteredRepos();

  // Determine port
  const portArg = process.argv[2];
  const port = portArg
    ? parseInt(portArg, 10)
    : parseInt(process.env.FRAMESMITH_VIEWER_PORT ?? process.env.CANVAS_VIEWER_PORT ?? '0', 10);

  // Start HTTP viewer
  await startViewer(port);

  const url = getViewerUrl();
  const repoDirs = readRegistry();
  console.log(`\n  Framesmith Viewer is running at: ${url}\n`);
  console.log(`  Watching ${DATA_DIR} for changes...`);
  for (const dir of repoDirs) console.log(`  Watching bound repo ${dir} for changes...`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  // Re-aggregate on any change to ANY source: global canvases, registry.json,
  // and every bound repo's .framesmith/ (a repo bound while the viewer runs
  // starts updating live too — its watcher attaches on the registry reload).
  watchAggregateSources(DATA_DIR, ({ repos, canvases }) => {
    console.log(`  Reloaded: ${canvases} canvas(es) from ${repos} bound repo(s) + the global store`);
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
