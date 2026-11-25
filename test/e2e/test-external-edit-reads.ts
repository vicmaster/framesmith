// A canvas file in a bound repo edited outside the server (a hand edit, a git
// pull) must reach every tool that reads the canvas, not only the ones that
// change it. Before this test only the mutating tools called ensureFresh, so
// screenshot, read_nodes and the other read tools served the server's old
// copy. The write checks pin that tools which change a canvas keep building on
// the edit. Each check edits the file first, so one tool's reload never hides
// another's staleness.
//
// Usage: npx tsx test/e2e/test-external-edit-reads.ts

import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const home = mkdtempSync(join(tmpdir(), 'framesmith-ext-home-'));
const repo = mkdtempSync(join(tmpdir(), 'framesmith-ext-repo-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd: repo,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: repo, FRAMESMITH_VIEWER_URL: 'http://127.0.0.1:9' } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-external-edit-reads', version: '0' });
await client.connect(transport);
type Content = Array<{ type: string; text?: string; data?: string }>;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 }) as { content: Content }).content;
const text = async (name: string, args: Record<string, unknown>) => (await call(name, args)).map((c) => c.text ?? '').join('\n');
/** The first text item: the JSON result, without the "View live" line after it. */
const json = async (name: string, args: Record<string, unknown>) => JSON.parse((await call(name, args)).find((c) => c.type === 'text')?.text ?? '{}');
const image = async (name: string, args: Record<string, unknown>) => (await call(name, args)).filter((c) => c.type === 'image').map((c) => c.data).join('|');

// A canvas and a second one to diff against, then bind the repo.
const made = JSON.parse(await text('canvas_create', { name: 'probe' }));
const id = made.canvasId as string;
await text('batch_design', { canvasId: id, operations: 'card=I("document", { type: "frame", name: "Card", width: 400, height: 200, fill: "#FFFFFF", padding: 24 })\nI(card, { type: "text", name: "Label", content: "original", fontSize: 16, color: "#111111" })' });
const other = JSON.parse(await text('canvas_create', { name: 'other' })).canvasId as string;
const bound = JSON.parse(await text('canvas_bind', { dir: repo }));
check('the repo is bound', !!bound.canvasDir, JSON.stringify(bound).slice(0, 200));
const targetProject = JSON.parse(await text('project_create', { workspaceId: Object.values(bound.idMap.workspace)[0], name: 'Elsewhere' })).id as string;

/** The canvas's file in the repo, wherever it lives now. */
function fileOf(canvasId: string, dir = join(repo, '.framesmith')): string | null {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { const hit = fileOf(canvasId, p); if (hit) return hit; continue; }
    if (entry.endsWith('.json') && entry !== 'workspace.json') {
      try { if (JSON.parse(readFileSync(p, 'utf-8')).id === canvasId) return p; } catch { /* not a canvas */ }
    }
  }
  return null;
}

let n = 0;
/** Edit the canvas file the way a person or git would: new label text, a new
 * card width, a new probe colour and a new name. Returns the marker. */
function editOnDisk(): { marker: string; width: number; color: string } {
  n++;
  const marker = `edited-${n}`;
  const width = 400 + n * 10;
  const color = `#${(0x100000 + n).toString(16).toUpperCase()}`;
  const file = fileOf(id)!;
  const canvas = JSON.parse(readFileSync(file, 'utf-8'));
  const card = canvas.root.children[0];
  card.width = width;
  card.children[0].content = marker;
  canvas.name = marker;
  canvas.variables = { ...(canvas.variables ?? {}), colors: { ...(canvas.variables?.colors ?? {}), probe: color } };
  writeFileSync(file, JSON.stringify(canvas, null, 2));
  const later = new Date(Date.now() + n * 2000);
  utimesSync(file, later, later);
  return { marker, width, color };
}
const onDisk = () => readFileSync(fileOf(id)!, 'utf-8');

// ── reads ────────────────────────────────────────────────────────────────────
let e = editOnDisk();
check('read_nodes reads the edit', (await text('read_nodes', { canvasId: id, maxDepth: 3 })).includes(e.marker));
e = editOnDisk();
check('get_variables reads the edit', (await text('get_variables', { canvasId: id })).includes(e.color));
e = editOnDisk();
check('canvas_list reads the edit', (await text('canvas_list', {})).includes(e.marker));
e = editOnDisk();
check('snapshot_layout reads the edit', (await text('snapshot_layout', { canvasId: id })).includes(`"width": ${e.width}`) || (await text('snapshot_layout', { canvasId: id })).includes(`"width":${e.width}`));

const shot = async () => image('screenshot', { canvasId: id });
const before = await shot();
editOnDisk();
check('screenshot renders the edit', (await shot()) !== before);
const respBefore = await image('screenshot_responsive', { canvasId: id });
editOnDisk();
check('screenshot_responsive renders the edit', (await image('screenshot_responsive', { canvasId: id })) !== respBefore);
const diffBefore = await text('canvas_diff', { canvasId1: id, canvasId2: other });
editOnDisk();
check('canvas_diff compares the edit', (await text('canvas_diff', { canvasId1: id, canvasId2: other })) !== diffBefore);
const exportBytes = async () => {
  const out = mkdtempSync(join(tmpdir(), 'framesmith-ext-export-'));
  await text('export', { canvasId: id, format: 'png', outputPath: out, scale: 1 });
  return readdirSync(out).map((f) => readFileSync(join(out, f)).toString('base64')).join('|');
};
const exportBefore = await exportBytes();
editOnDisk();
check('export renders the edit', (await exportBytes()) !== exportBefore);

// ── writes must build on the edit, never write the old copy back ────────────
e = editOnDisk();
await text('canvas_set_genre', { canvasId: id, genre: 'data' });
check('canvas_set_genre keeps the edit on disk', onDisk().includes(e.marker));
e = editOnDisk();
await text('canvas_set_type', { canvasId: id, type: 'web' });
check('canvas_set_type keeps the edit on disk', onDisk().includes(e.marker));
e = editOnDisk();
const variant = await json('canvas_add_variant', { canvasId: id, state: 'empty' });
const variantId = (variant.canvasId ?? variant.variantId ?? variant.id) as string;
check('canvas_add_variant clones the edit', !!variantId && readFileSync(fileOf(variantId)!, 'utf-8').includes(e.marker), JSON.stringify(variant).slice(0, 160));
e = editOnDisk();
await text('canvas_archive', { canvasId: id });
check('canvas_archive keeps the edit on disk', onDisk().includes(e.marker) && JSON.parse(onDisk()).archived === true);
await text('canvas_unarchive', { canvasId: id });
e = editOnDisk();
await text('canvas_move', { canvasId: id, projectId: targetProject });
check('canvas_move carries the edit', onDisk().includes(e.marker) && fileOf(id)!.includes('elsewhere'), fileOf(id) ?? '(no file)');

await client.close();
process.exit(allPass ? 0 : 1);
