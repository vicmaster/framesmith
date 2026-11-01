// The project's test runner.
//
// Every test in this repo is a plain script: it prints PASS/FAIL lines and
// exits 0 or 1. That convention works and this runner does not change it — it
// just discovers the scripts, runs them, and reports. Before it existed the 102
// test files could only be run one at a time by hand, which is how two of them
// came to be failing at the v2.0.0 tag without anyone noticing.
//
// Tiers exist so the common case is fast. Roughly a third of the suite drives a
// real browser; those tests are worth having but they should not stand between
// you and finding out that a pure-logic change broke something.
//
//   npm run test:fast   — everything that needs nothing but Node
//   npm run test:full   — the above plus the browser tests
//   npm test            — test:fast
//
// Pass names or substrings to run a subset: `npx tsx scripts/run-tests.ts cliche`
import { readdirSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

/** Tests that never terminate on their own and are not batch-runnable. */
const INTERACTIVE = new Set([
  // Starts a viewer server and waits for a human to look at it. Running it
  // here would hang the suite forever, and it also collides with a live viewer
  // on the same port.
  'test-viewer.ts',
  // Expects a viewer already serving on a port passed as argv (its header says
  // `npx tsx test-viewer-navbar.ts <port>`) and writes screenshots for a human
  // to look at. Nothing here can supply that, so it stays a manual check.
  'test-viewer-navbar.ts',
]);

/** Tests that need a browser but don't say so in their imports. */
const CHROME_ANYWAY = new Set([
  // Shells out to the CLI, whose check-drift path launches Chrome. Nothing in
  // this file's own imports reveals that.
  'test-cli.ts',
  // Drives the MCP server over stdio, and the server renders in Chrome for
  // detailed evaluate, canvas_stress and screenshots.
  'test-ridgeline.ts',
]);

/** Direct use of the browser is the honest signal — these are the entry points
 * in screenshot.ts that every browser-driven test reaches for. */
const CHROME_MARKERS = /takeScreenshot|computeLayout|withPage|withIsolatedPage|puppeteer|from '\.\/src\/screenshot\.js'/;

// FRAMESMITH_TEST_TIMEOUT_MS overrides it (test-runner-timeout.ts uses 3s).
const TIMEOUT_MS = Number(process.env.FRAMESMITH_TEST_TIMEOUT_MS) || 180_000;

type Tier = 'fast' | 'full';
const tier: Tier = process.argv.includes('--full') ? 'full' : 'fast';
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const needsChrome = (file: string): boolean =>
  CHROME_ANYWAY.has(file) || CHROME_MARKERS.test(readFileSync(file, 'utf-8'));

const all = readdirSync('.')
  .filter((f) => f.startsWith('test-') && f.endsWith('.ts') && f !== 'test-env.ts')
  .filter((f) => !INTERACTIVE.has(f))
  .sort();

const selected = all
  .filter((f) => tier === 'full' || !needsChrome(f))
  .filter((f) => filters.length === 0 || filters.some((q) => f.includes(q)));

/** The test running now. Its own process group doesn't get the terminal's
 * Ctrl-C, so the runner passes an interrupt on before exiting. */
let current: ChildProcess | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (current?.pid) { try { process.kill(-current.pid, 'SIGKILL'); } catch { /* already gone */ } }
    process.exit(130);
  });
}

function run(file: string): Promise<{ file: string; ok: boolean; why: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    // Its own process group, so a timeout kills npx AND the tsx under it.
    // Killing npx alone orphaned tsx, which kept the pipes open, and 'close'
    // never fired: one hung test stalled the whole run.
    const child = spawn('npx', ['tsx', file], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    current = child;
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => process.kill(-child.pid!, 'SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (signal === 'SIGKILL') return resolve({ file, ok: false, why: `timed out after ${TIMEOUT_MS / 1000}s`, ms });
      if (code === 0) return resolve({ file, ok: true, why: '', ms });
      const first = out.split('\n').filter((l) => /^FAIL|Error|error TS/.test(l))[0] ?? `exit ${code}`;
      resolve({ file, ok: false, why: first.trim().slice(0, 160), ms });
    });
  });
}

console.log(`${selected.length} tests (${tier} tier)${filters.length ? ` matching ${filters.join(', ')}` : ''}\n`);

const failures: { file: string; why: string }[] = [];
let passed = 0;
for (const file of selected) {
  const r = await run(file);
  if (r.ok) { passed++; console.log(`  ok    ${file}  ${(r.ms / 1000).toFixed(1)}s`); }
  else { failures.push(r); console.log(`  FAIL  ${file}  ${r.why}`); }
}

console.log(`\n${passed}/${selected.length} passed`);
if (tier === 'fast') {
  const skipped = all.filter(needsChrome).length;
  console.log(`${skipped} browser tests not run in this tier — use npm run test:full`);
}
if (INTERACTIVE.size) console.log(`${[...INTERACTIVE].join(', ')} excluded (interactive)`);

if (failures.length) {
  console.log(`\n${failures.length} failing:`);
  for (const f of failures) console.log(`  ${f.file}  ${f.why}`);
  process.exit(1);
}
