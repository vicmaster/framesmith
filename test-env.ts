// Test isolation. Redirect framesmith persistence to a throwaway tmp dir so
// running any smoke test never touches the real ~/.framesmith store.
//
// Import this FIRST — before any `./src/*` import — in tests that create
// canvases or workspaces:
//
//   import './test-env.js';
//
// ES-module side effects run in import order, so a first-position import
// guarantees FRAMESMITH_HOME is set before any src module evaluates. The guard
// respects tests that set their own FRAMESMITH_HOME.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.FRAMESMITH_HOME) {
  process.env.FRAMESMITH_HOME = mkdtempSync(join(tmpdir(), 'framesmith-test-'));
}
