// scripts/run-tests.ts runs every test/unit file with Chrome made unlaunchable,
// so a unit test that launches a browser fails instead of passing on a machine
// that happens to have Chrome. This runs the real runner over a temp root whose
// unit/ folder holds one test that renders through src/screenshot.ts, one that
// calls puppeteer.launch itself, and one that fails for another reason. The
// first two must fail with the line that sends them to test/browser; the third
// must fail without it.
//
// Usage: npx tsx test/unit/test-runner-guard.ts

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const dir = mkdtempSync(join(tmpdir(), 'framesmith-runner-guard-'));
mkdirSync(join(dir, 'unit'));
// So `import puppeteer from 'puppeteer'` resolves from the temp root.
symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
// ESM, as in the repo, so the temp tests can await at the top level.
writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');

const screenshot = resolve('src/screenshot.ts');
writeFileSync(join(dir, 'unit/test-shot.ts'), [
  `import { takeScreenshot, shutdown } from ${JSON.stringify(screenshot)};`,
  `await takeScreenshot('<p>hi</p>', { width: 100, height: 100 });`,
  `await shutdown();`,
].join('\n'));
writeFileSync(join(dir, 'unit/test-launch.ts'), [
  `import puppeteer from 'puppeteer';`,
  `const browser = await puppeteer.launch({ headless: true });`,
  `await browser.close();`,
].join('\n'));
writeFileSync(join(dir, 'unit/test-plain.ts'), `console.log('FAIL  plain'); process.exit(1);\n`);

const run = spawnSync(resolve('node_modules/.bin/tsx'), [resolve('scripts/run-tests.ts'), '--root', dir], { encoding: 'utf-8', timeout: 120_000 });
const out = `${run.stdout}${run.stderr}`;
const MOVE = 'this test launches Chrome: move it to test/browser';

/** The runner's report for one test: its FAIL line and the hint line under it, if any. */
const report = (name: string): string => {
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`  FAIL  ${name}`));
  return at < 0 ? '' : `${lines[at]}\n${lines[at + 1] ?? ''}`;
};

check('the runner exits non-zero', run.status === 1, `status ${run.status}`);
check('a unit test rendering through src/screenshot.ts fails', report('unit/test-shot.ts') !== '');
check('…with the line that sends it to test/browser', report('unit/test-shot.ts').includes(MOVE), report('unit/test-shot.ts'));
check('a unit test calling puppeteer.launch fails', report('unit/test-launch.ts') !== '');
check('…with the line that sends it to test/browser', report('unit/test-launch.ts').includes(MOVE), report('unit/test-launch.ts'));
check('a unit test failing for another reason gets no such line', report('unit/test-plain.ts') !== '' && !report('unit/test-plain.ts').includes(MOVE), report('unit/test-plain.ts'));

console.log(allPass ? '\nAll runner-guard checks passed.' : '\nSome runner-guard checks FAILED.');
process.exit(allPass ? 0 : 1);
