import './test-env.js';
// Phase 17 Slice D — sync/drift core: import a local page, adopt it as the
// design-of-record, then diff fresh imports against it. In-sync ≈ 0%; a
// changed page (or changed canvas) reports real drift; the sync flow never
// mutates the canvas. Mirrors the canvas_sync_from_url handler's pipeline
// (importUrl → renderImportedTree vs canvas render → computeDiff).
//
// Usage: npx tsx test-sync-drift.ts

import { createServer, type Server } from 'node:http';
import { importUrl, renderImportedTree } from './src/import.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { computeDiff, shutdown } from './src/screenshot.js';
import type { Canvas, SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

const page = (accent: string, label: string) => `<!DOCTYPE html><html><head><style>
  body { margin: 0; }
  .hero { display: flex; flex-direction: column; gap: 16px; padding: 48px; background-color: #0f172a; width: 800px; height: 400px; }
  .hero h1 { margin: 0; font-size: 40px; font-weight: 700; color: #f8fafc; font-family: Arial; }
  .cta { display: inline-flex; padding: 12px 28px; background-color: ${accent}; color: #ffffff; border-radius: 8px; font-size: 16px; font-family: Arial; width: fit-content; }
</style></head><body><div class="hero"><h1>${label}</h1><div class="cta">Get started</div></div></body></html>`;

let accent = '#2563eb';
let label = 'Design of record';
const server: Server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page(accent, label));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const URL_ = `http://127.0.0.1:${port}/`;

const W = 800, H = 400;

/** The handler's pipeline, minus the MCP envelope. */
async function sync(canvas: Canvas): Promise<number> {
  const imported = await importUrl(URL_, { viewport: { width: W, height: H } });
  const liveHtml = await renderImportedTree(imported.root, W, H);
  const resolved = resolveVariables(canvas.root, canvas.variables);
  const canvasHtml = renderToHtml(resolved, W, H, canvas);
  const diff = await computeDiff(canvasHtml, liveHtml, W, H, 1);
  return diff.changePercent;
}

try {
  // Adopt the page as the design-of-record (what canvas_import_url would store).
  const adopted = await importUrl(URL_, { viewport: { width: W, height: H } });
  const canvas = {
    id: 'c1', name: 'Hero', projectId: 'p1',
    root: { id: 'doc', type: 'document', fill: '#FFFFFF', width: W, height: H, children: [adopted.root] } as SceneNode,
    variables: {}, components: {},
  } as unknown as Canvas;
  const frozen = JSON.stringify(canvas.root);

  // ── 1. in sync ≈ 0% ─────────────────────────────────────────────────────
  const inSync = await sync(canvas);
  expect('unchanged page diffs ≈ 0%', inSync < 0.5, `${inSync}%`);

  // ── 2. the app drifts → real signal ─────────────────────────────────────
  accent = '#b71421'; // someone shipped a different CTA color
  const colorDrift = await sync(canvas);
  expect('shipped color change reports drift', colorDrift > 0.2, `${colorDrift}%`);

  label = 'Totally different headline';
  const copyDrift = await sync(canvas);
  expect('copy change adds more drift', copyDrift > colorDrift, `${copyDrift}% vs ${colorDrift}%`);

  // ── 3. sync never mutates the canvas ────────────────────────────────────
  expect('canvas untouched by sync runs', JSON.stringify(canvas.root) === frozen);

  // ── 4. drift is directionally symmetric (canvas edits show up too) ──────
  accent = '#2563eb';
  label = 'Design of record';
  const heading = (function find(n: SceneNode): SceneNode | null {
    if (n.content === 'Design of record') return n;
    for (const c of n.children ?? []) { const hit = find(c); if (hit) return hit; }
    return null;
  })(canvas.root);
  heading!.content = 'Approved copy v2';
  const canvasDrift = await sync(canvas);
  expect('canvas-side edits also surface as drift', canvasDrift > 0.2, `${canvasDrift}%`);
} finally {
  server.close();
  await shutdown();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
