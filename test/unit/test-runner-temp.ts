// Tests must not leave temp folders behind. scripts/run-tests.ts gives each
// test its own temp folder (TMPDIR, TMP, TEMP) and removes it when the test
// ends, however it ends; test/env.ts removes the store it made when its process
// exits, which covers a test run on its own. Before this, every run left a
// store, repo copies and Chrome profiles in the system temp dir: 5 GB of them
// had filled the disk by 2026-11-24.
//
// This runs the real runner over a temp root whose unit/ folder holds a test
// that passes, one that fails and one that hangs past a 10s timeout. Each makes
// folders under os.tmpdir() and records where. Then it runs test/env.ts on its
// own, exiting cleanly and with an error.
//
// Usage: npx tsx test/unit/test-runner-temp.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Under the runner, nested test folders sit beside this test's, in its base.
const base = process.env.FRAMESMITH_RUN_TMP_BASE || tmpdir();
const dir = mkdtempSync(join(tmpdir(), 'framesmith-runner-temp-'));
const marks = join(dir, 'marks');
mkdirSync(join(dir, 'unit'));
mkdirSync(marks);

/** A test body that makes a folder and a file under os.tmpdir() and records
 * where it saw the temp dir, then ends the way `tail` says. */
const body = (name: string, tail: string) => `
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const made = mkdtempSync(join(tmpdir(), 'leftover-'));
writeFileSync(join(made, 'data.json'), '{}');
writeFileSync(join(${JSON.stringify(marks)}, ${JSON.stringify(name)}), JSON.stringify({ tmp: tmpdir(), made }));
${tail}
`;
writeFileSync(join(dir, 'unit/test-a-pass.ts'), body('pass', "console.log('PASS  made temp files');"));
writeFileSync(join(dir, 'unit/test-b-fail.ts'), body('fail', "console.log('FAIL  on purpose'); process.exit(1);"));
writeFileSync(join(dir, 'unit/test-c-hang.ts'), body('hang', 'setInterval(() => {}, 1_000);'));

const runner = spawn(resolve('node_modules/.bin/tsx'), [resolve('scripts/run-tests.ts'), '--root', dir], {
  env: { ...process.env, FRAMESMITH_TEST_TIMEOUT_MS: '10000' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let out = '';
runner.stdout.on('data', (d) => { out += d; });
runner.stderr.on('data', (d) => { out += d; });
const finished = await new Promise<boolean>((done) => {
  const guard = setTimeout(() => done(false), 90_000);
  runner.on('close', () => { clearTimeout(guard); done(true); });
});
if (!finished) { try { process.kill(-runner.pid!, 'SIGKILL'); } catch { /* already gone */ } }

check('the runner finishes', finished);
check('it reports the pass, the failure and the timeout', /ok {4}unit\/test-a-pass\.ts/.test(out) && /FAIL {2}unit\/test-b-fail\.ts/.test(out) && /FAIL {2}unit\/test-c-hang\.ts {2}timed out/.test(out), out.slice(0, 400));

const seen = Object.fromEntries(['pass', 'fail', 'hang'].map((n) => {
  const file = join(marks, n);
  return [n, existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) as { tmp: string; made: string } : null];
}));
check('every test ran and recorded its temp dir', Object.values(seen).every(Boolean), JSON.stringify(seen));
const tmps = Object.values(seen).map((s) => s?.tmp);
check('each test had its own temp dir, not the system one', new Set(tmps).size === 3 && tmps.every((t) => t && t !== base && t !== tmpdir() && t.startsWith(base)), JSON.stringify(tmps));
check('a nested runner puts its folders beside the outer one, not inside it', tmps.every((t) => t && !t.slice(base.length + 1).includes('/')), JSON.stringify(tmps));
for (const [name, s] of Object.entries(seen)) {
  check(`the ${name} test's temp dir is gone after it ends`, !!s && !existsSync(s.tmp) && !existsSync(s.made), s?.tmp);
}
check('the shared caches survive the cleanup', existsSync(join(base, `tsx-${process.getuid?.() ?? ''}`)) && existsSync(join(base, 'node-compile-cache')));
check('no folder of these tests is left in the temp base', !readdirSync(base).some((f) => tmps.includes(join(base, f))));

// test/env.ts on its own: the store it made is removed on exit, clean or not.
for (const [label, code] of [['a clean exit', 0], ['process.exit(1)', 1]] as const) {
  const script = join(dir, `env-${code}.ts`);
  writeFileSync(script, `import ${JSON.stringify(resolve('test/env.ts'))};\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(join(${JSON.stringify(dir)}, 'home-${code}'), process.env.FRAMESMITH_HOME!);\nimport { join } from 'node:path';\nprocess.exit(${code});\n`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.FRAMESMITH_HOME;
  spawnSync(resolve('node_modules/.bin/tsx'), [script], { env, stdio: 'ignore' });
  const home = existsSync(join(dir, `home-${code}`)) ? readFileSync(join(dir, `home-${code}`), 'utf-8') : '';
  check(`env.ts removes its store after ${label}`, home.includes('framesmith-test-') && !existsSync(home), home);
}

rmSync(dir, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
