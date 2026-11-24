// Test isolation. Redirect framesmith persistence to a throwaway tmp dir so
// running any smoke test never touches the real ~/.framesmith store.
//
// Import this FIRST — before any `src/` import — in tests that create
// canvases or workspaces:
//
//   import '../env.js';
//
// ES-module side effects run in import order, so a first-position import
// guarantees FRAMESMITH_HOME is set before any src module evaluates. The guard
// respects tests that set their own FRAMESMITH_HOME, and removes the store it
// made when the process exits (the test runner also removes each test's whole
// temp folder, which covers a test killed before it could exit).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.FRAMESMITH_HOME) {
  const home = mkdtempSync(join(tmpdir(), 'framesmith-test-'));
  process.env.FRAMESMITH_HOME = home;
  process.on('exit', () => {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  });
}
