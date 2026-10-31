// Phase 30 slice A — the genre/preset split through the REAL tool handlers.
// test-set-genre covers the scene-graph and genre.ts functions; this drives
// canvas_set_genre / apply_preset / canvas_evaluate / import_design_md over
// MCP stdio, so a handler that stopped calling stampPreset (the AC1 clobber)
// or dropped a result field fails here.
//
// Usage: npx tsx test-genre-mcp.ts

import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const home = mkdtempSync(join(tmpdir(), 'framesmith-genre-mcp-'));
const cwd = mkdtempSync(join(tmpdir(), 'framesmith-genre-mcp-cwd-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-genre-mcp', version: '0' });
await client.connect(transport);

async function tool(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[] };
  const text = r.content[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return text; }
}

async function canvasWithFigures(name: string): Promise<string> {
  const c = await tool('canvas_create', { name });
  await tool('batch_design', { canvasId: c.canvasId, operations: `
f=I("document", { type: "frame", layout: "vertical", gap: 16, padding: 24, fill: "#F8FAFC" })
I(f, { type: "text", content: "$2,481,330.17", fontSize: 32, color: "#1E293B" })
I(f, { type: "text", content: "Updated hourly", fontSize: 14, color: "#000000" })
` });
  return c.canvasId;
}

try {
  // AC1 — apply_preset after canvas_set_genre keeps the genre (US4).
  const a = await canvasWithFigures('mcp-ac1');
  await tool('canvas_set_genre', { canvasId: a, genre: 'commerce' });
  await tool('apply_preset', { canvasId: a, preset: 'dark' });
  const e1 = await tool('canvas_evaluate', { canvasId: a });
  check('AC1: apply_preset leaves the genre at commerce', e1.genre?.active === 'commerce' && e1.genre?.source === 'provenance', JSON.stringify(e1.genre));

  // AC11 — canonical folds the alias; the report names data.
  const s = await tool('canvas_set_genre', { canvasId: a, genre: 'dashboard' });
  check('AC11: set_genre result has canonical "data" and previous "commerce"', s.canonical === 'data' && s.previous === 'commerce' && s.genre === 'dashboard', JSON.stringify(s));
  const e2 = await tool('canvas_evaluate', { canvasId: a });
  check('AC11: evaluate reports data', e2.genre?.active === 'data');

  // AC14 — clearing on a material-preset canvas reports what the preset still relaxes.
  await tool('apply_preset', { canvasId: a, preset: 'material' });
  const cleared = await tool('canvas_set_genre', { canvasId: a, genre: null });
  check('AC14: clear reports presetRelaxes for the material preset',
    cleared.canonical === null && cleared.previous === 'dashboard' && cleared.presetRelaxes?.preset === 'material' && cleared.presetRelaxes.relaxed.length === 2, JSON.stringify(cleared));
  const e3 = await tool('canvas_evaluate', { canvasId: a });
  check('AC14: evaluate shows byPreset, no genre', e3.genre?.active === null && e3.genre?.byPreset?.preset === 'material', JSON.stringify(e3.genre));

  // AC12 — an imported preset stays a preset, even one named like a genre.
  const imported = await tool('import_design_md', { name: 'commerce', content: '# Commerce\n\n## Colors\n- primary: #1E3A8A\n' });
  check('import_design_md registered a preset named "commerce"', imported.imported === 'commerce', JSON.stringify(imported).slice(0, 120));
  const b = await canvasWithFigures('mcp-ac12');
  await tool('apply_preset', { canvasId: b, preset: 'commerce' });
  const e4 = await tool('canvas_evaluate', { canvasId: b });
  check('AC12: an applied imported preset is not read as a genre', e4.genre?.active === null, JSON.stringify(e4.genre));
  await tool('canvas_set_genre', { canvasId: b, genre: 'data' });
  const e5 = await tool('canvas_evaluate', { canvasId: b });
  check('AC12: set_genre after an imported preset reads data', e5.genre?.active === 'data');

  // A hand-edit / git pull on disk is picked up before apply_preset writes
  // (ensureFresh), and a legacy genre found there is migrated, not clobbered.
  const d = await canvasWithFigures('mcp-fresh');
  await tool('canvas_set_genre', { canvasId: d, genre: 'material' });
  const file = join(home, 'canvases', `${d}.json`);
  const onDisk = JSON.parse(readFileSync(file, 'utf-8'));
  onDisk.metadata.provenance = { preset: 'commerce', at: '2026-01-01T00:00:00.000Z' }; // what an older framesmith wrote
  writeFileSync(file, JSON.stringify(onDisk, null, 2));
  const later = new Date(Date.now() + 5000);
  utimesSync(file, later, later);
  await tool('apply_preset', { canvasId: d, preset: 'dark' });
  const saved = JSON.parse(readFileSync(file, 'utf-8')).metadata.provenance;
  check('apply_preset reloads from disk and migrates the legacy genre there', saved.genre === 'commerce' && saved.preset === 'dark', JSON.stringify(saved));
} finally {
  await client.close();
}

console.log(allPass ? '\nAll genre-mcp tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
