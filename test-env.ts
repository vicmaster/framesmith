// Test isolation. Redirect canvas-mcp persistence to a throwaway tmp dir so
// running any smoke test never touches the real ~/.canvas-mcp store.
//
// Import this FIRST — before any `./src/*` import — in tests that create
// canvases or workspaces:
//
//   import './test-env.js';
//
// ES-module side effects run in import order, so a first-position import
// guarantees CANVAS_MCP_HOME is set before any src module evaluates. The guard
// respects tests that set their own CANVAS_MCP_HOME.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.CANVAS_MCP_HOME) {
  process.env.CANVAS_MCP_HOME = mkdtempSync(join(tmpdir(), 'canvas-mcp-test-'));
}
