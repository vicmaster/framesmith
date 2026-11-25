// Every MCP tool reads canvases through freshCanvas (ensureFresh, then
// getCanvas), so a canvas file edited under the server (a hand edit, a git
// pull, the viewer) is what the tool sees. A raw getCanvas call in index.ts is
// how the read tools went stale before; this fails on the next one.
// test/e2e/test-external-edit-reads.ts checks the behaviour end to end.
//
// Usage: npx tsx test/unit/test-fresh-reads-guard.ts

import { readFileSync } from 'node:fs';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf-8');
const lines = source.split('\n');
const helper = lines.findIndex((l) => l.startsWith('function freshCanvas('));
const helperEnd = lines.indexOf('}', helper);
check('index.ts defines freshCanvas', helper >= 0 && helperEnd > helper);

const raw = lines
  .map((line, i) => ({ line: line.replace(/\/\/.*$/, ''), n: i + 1 }))
  .filter(({ line, n }) => !line.startsWith('import ') && !(n > helper && n <= helperEnd + 1) && /(?<![\w.])getCanvas\(/.test(line));
check('no tool calls getCanvas directly (use freshCanvas)', raw.length === 0, raw.map((r) => `index.ts:${r.n}`).join(', '));

process.exit(allPass ? 0 : 1);
