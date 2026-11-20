// The project's test runner.
//
// Every test in this repo is a plain script: it prints PASS/FAIL lines and
// exits 0 or 1. That convention works and this runner does not change it — it
// just discovers the scripts, runs them, and reports. Before it existed the
// test files could only be run one at a time by hand, which is how two of them
// came to be failing at the v2.0.0 tag without anyone noticing.
//
// The folder a test lives in sets its tier:
//
//   test/unit     Node only. Run with Chrome made unlaunchable, so a unit test
//                 that reaches for a browser fails instead of passing quietly.
//   test/browser  launches Chrome
//   test/e2e      spawns the MCP server or the CLI
//   test/manual   needs a human or a running viewer; never run here
//
//   npm run test:fast   — test/unit
//   npm run test:full   — test/unit, test/browser and test/e2e
//   npm test            — test:fast
//
// Pass substrings of a test's path to run a subset: `npx tsx scripts/run-tests.ts cliche`
// or `unit/` for a folder. `--root <dir>` reads the folders from another directory
// (the runner's own tests use it).
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// FRAMESMITH_TEST_TIMEOUT_MS overrides it (test/unit/test-runner-timeout.ts uses 3s).
const TIMEOUT_MS = Number(process.env.FRAMESMITH_TEST_TIMEOUT_MS) || 180_000;

/** A Chrome path that does not exist. A unit test that launches Chrome, through
 * src/screenshot.ts or puppeteer.launch directly, fails on it. */
const NO_CHROME = join(REPO, 'no-chrome-in-unit-tests');

/** What a failed launch prints: src/screenshot.ts's message, then Puppeteer's own. */
const LAUNCH_FAILURE = /Failed to launch Chrome for rendering|Tried to find the browser at the configured path/;

type Tier = 'fast' | 'full';
const TIER_FOLDERS: Record<Tier, string[]> = { fast: ['unit'], full: ['unit', 'browser', 'e2e'] };

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root = rootAt >= 0 ? resolve(args[rootAt + 1]) : join(REPO, 'test');
if (rootAt >= 0) args.splice(rootAt, 2);
const tier: Tier = args.includes('--full') ? 'full' : 'fast';
const filters = args.filter((a) => !a.startsWith('--'));

// Tests read paths relative to the repo root (`resolve('src/index.ts')`).
process.chdir(REPO);

/** Test paths under the root, as `<folder>/<file>`. */
const discover = (folder: string): string[] => {
  const dir = join(root, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).sort().map((f) => `${folder}/${f}`);
};

const selected = TIER_FOLDERS[tier]
  .flatMap(discover)
  .filter((t) => filters.length === 0 || filters.some((q) => t.includes(q)));

/** The test running now. Its own process group doesn't get the terminal's
 * Ctrl-C, so the runner passes an interrupt on before exiting. */
let current: ChildProcess | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (current?.pid) { try { process.kill(-current.pid, 'SIGKILL'); } catch { /* already gone */ } }
    process.exit(130);
  });
}

type Result = { test: string; ok: boolean; why: string; ms: number };

function run(test: string): Promise<Result> {
  const unit = test.startsWith('unit/');
  const env = unit
    ? { ...process.env, FRAMESMITH_CHROME_PATH: NO_CHROME, PUPPETEER_EXECUTABLE_PATH: NO_CHROME }
    : process.env;
  return new Promise((done) => {
    const started = Date.now();
    // Its own process group, so a timeout kills npx AND the tsx under it.
    // Killing npx alone orphaned tsx, which kept the pipes open, and 'close'
    // never fired: one hung test stalled the whole run.
    const child = spawn('npx', ['tsx', join(root, test)], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
    current = child;
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => process.kill(-child.pid!, 'SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (signal === 'SIGKILL') return done({ test, ok: false, why: `timed out after ${TIMEOUT_MS / 1000}s`, ms });
      if (code === 0) return done({ test, ok: true, why: '', ms });

      const first = out.split('\n').filter((l) => /^FAIL|Error|error TS/.test(l))[0] ?? `exit ${code}`;
      const launched = unit && LAUNCH_FAILURE.test(out)
        ? '\n        this test launches Chrome: move it to test/browser'
        : '';
      done({ test, ok: false, why: first.trim().slice(0, 160) + launched, ms });
    });
  });
}

console.log(`${selected.length} tests (${tier} tier)${filters.length ? ` matching ${filters.join(', ')}` : ''}\n`);

const failures: Result[] = [];
let passed = 0;
for (const test of selected) {
  const r = await run(test);
  if (r.ok) { passed++; console.log(`  ok    ${test}  ${(r.ms / 1000).toFixed(1)}s`); }
  else { failures.push(r); console.log(`  FAIL  ${test}  ${r.why}`); }
}

console.log(`\n${passed}/${selected.length} passed`);
if (tier === 'fast') {
  const skipped = discover('browser').length + discover('e2e').length;
  if (skipped) console.log(`${skipped} browser and e2e tests not run in this tier — use npm run test:full`);
}

if (failures.length) {
  console.log(`\n${failures.length} failing:`);
  for (const f of failures) console.log(`  ${f.test}  ${f.why}`);
  process.exit(1);
}
