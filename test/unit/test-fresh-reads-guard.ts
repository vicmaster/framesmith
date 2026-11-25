// Every MCP tool reads canvases through freshCanvas (ensureFresh, then
// getCanvas) and lists them through freshListing (ensureAllFresh first), so a
// canvas file edited under the server (a hand edit, a git pull, the viewer) is
// what the tool sees. A raw getCanvas or listCanvases call in index.ts is how
// the read tools went stale before; this fails on the next one.
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

/** Lines calling `name(` outside the import and outside the helper that wraps it. */
function rawCalls(name: string, helperName: string): number[] {
  const helper = lines.findIndex((l) => l.startsWith(`function ${helperName}(`));
  const helperEnd = lines.indexOf('}', helper);
  check(`index.ts defines ${helperName}`, helper >= 0 && helperEnd > helper);
  const call = new RegExp(`(?<![\\w.])${name}\\(`);
  return lines
    .map((line, i) => ({ code: line.trimStart().startsWith('//') || line.trimStart().startsWith('*') ? '' : line, n: i + 1 }))
    .filter(({ code, n }) => !code.startsWith('import ') && !(n > helper + 1 && n <= helperEnd + 1) && call.test(code))
    .map(({ n }) => n);
}

const rawGets = rawCalls('getCanvas', 'freshCanvas');
check('no tool calls getCanvas directly (use freshCanvas)', rawGets.length === 0, rawGets.map((n) => `index.ts:${n}`).join(', '));
const rawLists = rawCalls('listCanvases', 'freshListing');
check('no tool calls listCanvases directly (use freshListing)', rawLists.length === 0, rawLists.map((n) => `index.ts:${n}`).join(', '));

process.exit(allPass ? 0 : 1);
