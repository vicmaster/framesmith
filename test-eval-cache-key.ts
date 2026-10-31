// Issue #150 — the viewer cached evaluations by `${id}:${lastModified}`, so
// any edit that doesn't bump lastModified (stamping metadata.provenance.preset
// by hand, hand-editing a repo-bound JSON) kept serving the stale score — a
// correct fix looked broken from the user's side. evalCacheKey hashes what the
// evaluation actually reads: the tree, the merged tokens, the genre, and the
// component registry.
//
// Usage: npx tsx test-eval-cache-key.ts

import './test-env.js';
import { createCanvas, addVariant, setCanvasGenre } from './src/scene-graph.js';
import { stampPreset } from './src/genre.js';
import { evalCacheKey, evalFor, renderDetailPage } from './src/viewer.js';
import { evaluateCanvas } from './src/evaluate.js';
import { parseAndExecute } from './src/operations.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const canvas = createCanvas('Cache Key Test');
parseAndExecute(canvas.root, `
card=I("document", { type: "frame", fill: "#F8FAFC", padding: 24 })
t=I(card, { type: "text", content: "Revenue", fontSize: 14 })
`, canvas);

const k0 = evalCacheKey(canvas);
check('deterministic — same content, same key', evalCacheKey(canvas) === k0);
check('key is namespaced by canvas id', k0.startsWith(`${canvas.id}:`), k0);

// lastModified alone must NOT move the key — it's a content hash now.
canvas.lastModified = new Date(Date.now() + 60_000).toISOString();
check('lastModified change alone → same key', evalCacheKey(canvas) === k0);

// The #150 incident: stamping the provenance preset (genre) must move the key,
// because genre changes which cliché tells are relaxed. Since Phase 30 this is
// a legacy genre stamp, still read from `preset`.
canvas.metadata = { ...canvas.metadata, provenance: { preset: 'dashboard', at: new Date().toISOString() } };
const k1 = evalCacheKey(canvas);
check('stamping provenance.preset → new key', k1 !== k0);

// Phase 30 — genre and preset are separate fields; both move the key, and a
// write that changes neither (just `at`) doesn't.
{
  const c = createCanvas('Cache Key Axes');
  parseAndExecute(c.root, `I("document", { type: "text", content: "Revenue", fontSize: 14 })`, c);
  c.metadata = { ...c.metadata, provenance: { genre: 'commerce', preset: 'dark', at: 'a' } };
  const base = evalCacheKey(c);
  c.metadata = { ...c.metadata, provenance: { genre: 'commerce', preset: 'dark', at: 'b' } };
  check('only `at` changed → same key', evalCacheKey(c) === base);
  c.metadata = { ...c.metadata, provenance: { genre: 'data', preset: 'dark', at: 'b' } };
  check('genre field change → new key', evalCacheKey(c) !== base);
  c.metadata = { ...c.metadata, provenance: { genre: 'commerce', preset: 'material', at: 'b' } };
  check('preset change with the genre held → new key', evalCacheKey(c) !== base);
}

// Phase 30 — the real writers move the key: canvas_set_genre and apply_preset.
{
  const c = createCanvas('Cache Key Writers');
  parseAndExecute(c.root, `I("document", { type: "text", content: "Revenue", fontSize: 14 })`, c);
  const before = evalCacheKey(c);
  setCanvasGenre(c.id, 'commerce');
  const afterGenre = evalCacheKey(c);
  check('setCanvasGenre → new key', afterGenre !== before);
  c.metadata = { ...c.metadata, provenance: stampPreset(c.metadata?.provenance, 'material') };
  check('stampPreset (apply_preset) → new key', evalCacheKey(c) !== afterGenre);
}

// Phase 30 — the viewer scores through the same genre resolution as the
// agent: its fast score equals evaluateCanvas's for legacy and split stamps.
for (const provenance of [
  { preset: 'dashboard', at: 'x' },
  { genre: 'commerce', preset: 'dark', at: 'x' },
  { preset: 'material', at: 'x' },
]) {
  const c = createCanvas(`Viewer Parity ${JSON.stringify(provenance)}`);
  parseAndExecute(c.root, `
f=I("document", { type: "frame", layout: "vertical", gap: 16, padding: 24, fill: "#F8FAFC" })
I(f, { type: "text", content: "$2,481,330.17", fontSize: 32, color: "#1E293B" })
I(f, { type: "text", content: "Updated hourly", fontSize: 14, color: "#000000" })
`, c);
  c.metadata = { ...c.metadata, provenance } as typeof c.metadata;
  const viewer = await evalFor(c, []);
  const agent = await evaluateCanvas(c, { mode: 'fast', designedStates: [] });
  check(`viewer score = canvas_evaluate score for ${JSON.stringify(provenance)}`,
    viewer?.overallScore === agent.overallScore && JSON.stringify(viewer?.genre) === JSON.stringify(agent.genre),
    `${viewer?.overallScore} vs ${agent.overallScore}`);
}

// Phase 30 — the detail page's provenance chip: a legacy genre shows as the
// genre (canonical), and a migrated canvas shows its preset even when it is
// an imported (non-built-in) name.
for (const [provenance, want, notWant] of [
  [{ structure: 's', preset: 'dashboard', at: 'x' }, 's · data', 'dashboard'],
  [{ structure: 's', preset: 'acme', genre: null, at: 'x' }, 's · acme', null],
  [{ structure: 's', genre: 'checkout', preset: 'dark', at: 'x' }, 's · commerce · dark', null],
] as const) {
  const c = createCanvas('Chip');
  parseAndExecute(c.root, `I("document", { type: "text", content: "Hi", fontSize: 14 })`, c);
  c.metadata = { ...c.metadata, provenance } as typeof c.metadata;
  const html = await renderDetailPage(c, 0);
  const chip = html.match(/<b>◆<\/b>([^<]*)<\/span>/)?.[1] ?? '';
  check(`chip for ${JSON.stringify(provenance)} reads "${want}"`, chip === want && (notWant === null || !chip.includes(notWant)), chip);
}

// Unrelated metadata (feedback) doesn't feed the evaluation → same key.
canvas.metadata = { ...canvas.metadata, feedback: [{ id: 'fb-1', note: 'nudge left', createdAt: 'x' }] } as typeof canvas.metadata;
check('unrelated metadata (feedback) → key unchanged', evalCacheKey(canvas) === k1);

// Tree edits move the key.
parseAndExecute(canvas.root, `U(${JSON.stringify(canvas.root.children![0].id)}, { fill: "#0F172A" })`, canvas);
const k2 = evalCacheKey(canvas);
check('tree edit → new key', k2 !== k1);

// Canvas-level token edits move the key (tokens feed contrast/cliché checks).
canvas.variables = { ...canvas.variables, colors: { accent: '#2563EB' } };
check('token edit → new key', evalCacheKey(canvas) !== k2);

// Phase 24 slice C — designed state variants feed the coverage check, so
// adding one must invalidate the BASE canvas's cached evaluation.
const k3 = evalCacheKey(canvas);
addVariant(canvas.id, 'empty');
check('adding a state variant → base key changes', evalCacheKey(canvas) !== k3);

console.log(allPass ? '\nAll eval-cache-key tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
