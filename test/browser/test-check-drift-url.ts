import '../env.js';
// Phase 23 slice B (#148) — canvas_check_drift end-to-end: a real page served
// from a local http server (no external network), imported ephemerally and
// structurally compared against a canvas. Covers the in-sync path (a canvas
// built to match the page) and the drifted path (the radiogroup-vs-select
// incident against live HTML).
//
// Usage: npx tsx test/browser/test-check-drift-url.ts   (needs Chrome)

import { createServer, type Server } from 'node:http';
import { importUrl } from '../../src/import.js';
import { shutdown } from '../../src/screenshot.js';
import { computeStructuralDrift } from '../../src/drift.js';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

const PAGE = `<!DOCTYPE html><html><head><style>
  body { margin: 0; font-family: Arial; padding: 24px; }
  .field { display: flex; flex-direction: column; gap: 8px; width: 360px; }
  label { font-size: 13px; color: #334155; }
</style></head><body>
  <div class="field">
    <label>Control type</label>
    <select><option selected>Manual</option><option>Computed</option></select>
  </div>
  <div class="field">
    <label>Email alerts</label>
    <input type="checkbox" checked>
  </div>
</body></html>`;

const server: Server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const url = `http://127.0.0.1:${port}/`;

try {
  const imported = await importUrl(url, { viewport: { width: 800, height: 600 } });

  // A canvas that MATCHES the page structurally → in sync.
  const matching = createCanvas('drift-in-sync');
  parseAndExecute(matching.root, `
f1=I("document", { type: "frame", layout: "vertical", gap: 8 })
I(f1, { type: "text", content: "Control type", fontSize: 13 })
I(f1, { type: "select", value: "Manual" })
f2=I("document", { type: "frame", layout: "vertical", gap: 8 })
I(f2, { type: "text", content: "Email alerts", fontSize: 13 })
I(f2, { type: "checkbox", checked: true })
`, matching);
  const inSync = computeStructuralDrift(matching.root, imported.root);
  expect('matching canvas → inSync', inSync.inSync, JSON.stringify(inSync.findings));

  // The incident canvas: a radio group where the page shipped a select.
  const drifted = createCanvas('drift-radio-vs-select');
  parseAndExecute(drifted.root, `
f1=I("document", { type: "frame", layout: "vertical", gap: 8 })
I(f1, { type: "text", content: "Control type", fontSize: 13 })
opts=I(f1, { type: "frame", layout: "vertical", gap: 4 })
I(opts, { type: "radio", checked: true })
I(opts, { type: "radio" })
f2=I("document", { type: "frame", layout: "vertical", gap: 8 })
I(f2, { type: "text", content: "Email alerts", fontSize: 13 })
I(f2, { type: "checkbox", checked: true })
`, drifted);
  const r = computeStructuralDrift(drifted.root, imported.root);
  const mm = r.findings.filter((f) => f.kind === 'control-mismatch');
  expect('radiogroup canvas vs live select page → drifted', !r.inSync);
  expect('exactly one control-mismatch against live HTML', mm.length === 1, JSON.stringify(r.findings));
  expect('finding names both control kinds', !!mm[0] && /radio group/.test(mm[0].detail) && /select/.test(mm[0].detail), mm[0]?.detail);
  expect('checkbox side stays clean', !r.findings.some((f) => f.detail.includes('checkbox')), JSON.stringify(r.findings));
} finally {
  server.close();
  await shutdown();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(allPass ? '\nAll check-drift-url tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
