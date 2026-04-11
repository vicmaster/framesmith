#!/usr/bin/env node

/**
 * Standalone canvas viewer — runs independently of the MCP server.
 *
 * Usage:
 *   canvas-viewer              # auto-pick port starting at 3001
 *   canvas-viewer 3004         # use a specific port
 *   CANVAS_VIEWER_PORT=3004 canvas-viewer
 *
 * This watches ~/.canvas-mcp/canvases/ for changes and serves them
 * via the same viewer UI. Run this in a terminal tab and it stays alive
 * regardless of whether a Claude Code session is active.
 */

import { loadPersistedCanvases } from './scene-graph.js';
import { startViewer, getViewerUrl } from './viewer.js';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const CANVAS_DIR = join(homedir(), '.canvas-mcp', 'canvases');

async function main() {
  // Ensure directory exists
  mkdirSync(CANVAS_DIR, { recursive: true });

  // Initial load
  loadPersistedCanvases();

  // Determine port
  const portArg = process.argv[2];
  const port = portArg
    ? parseInt(portArg, 10)
    : parseInt(process.env.CANVAS_VIEWER_PORT ?? '0', 10);

  // Start HTTP viewer
  await startViewer(port);

  const url = getViewerUrl();
  console.log(`\n  Canvas MCP Viewer is running at: ${url}\n`);
  console.log(`  Watching ${CANVAS_DIR} for changes...\n`);
  console.log(`  Press Ctrl+C to stop.\n`);

  // Watch for new/updated canvas files and reload
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  watch(CANVAS_DIR, (_eventType, filename) => {
    if (!filename?.endsWith('.json')) return;
    // Debounce rapid writes
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      loadPersistedCanvases();
    }, 500);
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
