// scripts/run-tests.ts must survive a hung test. Its timeout used to SIGKILL
// only the `npx` wrapper; the `tsx` process under it was orphaned, kept the
// output pipes open, and the runner waited on them forever (a Chrome hang in
// test-text-props.ts stalled a full-tier run for 25 minutes). This runs the
// real runner in a temp dir holding one hanging test and one passing test,
// with a 3s timeout, and checks it reports the timeout, finishes, and leaves
// no process of the hung test behind.
//
// Usage: npx tsx test-runner-timeout.ts

import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const dir = mkdtempSync(join(tmpdir(), 'framesmith-runner-timeout-'));
symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
writeFileSync(join(dir, 'test-hang.ts'), 'setInterval(() => {}, 1_000);\n');
writeFileSync(join(dir, 'test-quick.ts'), "console.log('PASS  quick');\n");

/** PIDs of processes still running the hung test. */
const leftovers = (): number[] => {
  try {
    return execFileSync('pgrep', ['-f', 'tsx test-hang\\.ts'], { encoding: 'utf-8' }).split('\n').filter(Boolean).map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
};

const started = Date.now();
const runner = spawn(resolve('node_modules/.bin/tsx'), [resolve('scripts/run-tests.ts')], {
  cwd: dir,
  env: { ...process.env, FRAMESMITH_TEST_TIMEOUT_MS: '3000' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let out = '';
runner.stdout.on('data', (d) => { out += d; });
runner.stderr.on('data', (d) => { out += d; });

// Our own guard: a runner that never finishes must not hang this test too.
const finished = await new Promise<boolean>((done) => {
  const guard = setTimeout(() => done(false), 45_000);
  runner.on('close', () => { clearTimeout(guard); done(true); });
});
const secs = (Date.now() - started) / 1000;

check('the runner finishes despite a hung test', finished, `${secs.toFixed(1)}s`);
check('the hung test is reported as timed out', /FAIL {2}test-hang\.ts {2}timed out after 3s/.test(out), out.split('\n').find((l) => l.includes('test-hang')));
check('the other test still runs and passes', /ok {4}test-quick\.ts/.test(out) && /1\/2 passed/.test(out));
check('no process of the hung test is left running', leftovers().length === 0, leftovers().join(', '));

// Clean up whatever the old behaviour left behind, by exact PID.
if (!finished) { try { process.kill(-runner.pid!, 'SIGKILL'); } catch { /* already gone */ } }
for (const pid of leftovers()) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }

console.log(allPass ? '\nAll runner-timeout checks passed.' : '\nSome runner-timeout checks FAILED.');
process.exit(allPass ? 0 : 1);
