// Phase 32 slice D (FR-D4) — canvas_stress widens counts. A desktop-app canvas
// holds a nav-item with a numeric count and a tabs node whose item count is a
// string; big-numbers touches both, through the real tool handler over MCP
// stdio. Twin: the same canvas with word counts touches nothing.
// Needs Chrome. Run with: npx tsx test/e2e/test-stress-counts.ts

import '../env.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ` — ${extra}` : ''}`);
}

const home = mkdtempSync(join(tmpdir(), 'framesmith-stress-counts-'));
const cwd = mkdtempSync(join(tmpdir(), 'framesmith-stress-counts-cwd-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-stress-counts', version: '0' });
await client.connect(transport);

async function tool(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
  const text = r.content[0]?.text ?? '';
  try { return { ...JSON.parse(text), isError: r.isError }; } catch { return { text, isError: r.isError }; }
}

interface Run { name: string; touchedCount?: number; skipped?: string }

async function bigNumbers(nav: string, tab: string): Promise<Run | undefined> {
  const c = await tool('canvas_create', { name: 'Counts', type: 'desktop-app' });
  await tool('batch_design', {
    canvasId: c.canvasId,
    operations: `p=I("document", { type: "frame", layout: "vertical", width: 400, padding: 16, gap: 8 })
I(p, { type: "nav-item", label: "Inbox", count: ${nav}, width: 240 })
I(p, { type: "tabs", items: [{ label: "Open", count: ${tab}, active: true }, { label: "Done" }] })`,
  });
  const st = await tool('canvas_stress', { canvasId: c.canvasId, perturbations: ['big-numbers'] });
  return (st.perturbations as Run[] | undefined)?.find((p) => p.name === 'big-numbers');
}

try {
  const run = await bigNumbers('42', '"7"');
  check('FR-D4: canvas_stress big-numbers touches the nav-item and the tabs (touchedCount 2)', run?.touchedCount === 2, JSON.stringify(run));
  const words = await bigNumbers('"New"', '"Beta"');
  check('FR-D4 twin: word counts give big-numbers nothing to widen', !words?.touchedCount, JSON.stringify(words));
} finally {
  await client.close();
}

console.log(allPass ? '\nAll stress count checks passed.' : '\nSOME STRESS COUNT CHECKS FAILED');
process.exit(allPass ? 0 : 1);
