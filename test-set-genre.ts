// Issue #162 — canvas_set_genre: stamp (or clear) the evaluation genre
// durably without apply_preset's token churn. Phase 30 slice A: the genre has
// its own field (provenance.genre), apply_preset never touches it, and a
// legacy genre stored in provenance.preset is read and migrated. The stamp drives provenance-
// sourced evaluation, survives alongside other provenance facts, bumps
// lastModified (so caches invalidate), and NEVER moves the versionHash
// (so recorded approvals stay valid).
//
// Usage: npx tsx test-set-genre.ts

import './test-env.js';
import { createCanvas, setCanvasGenre, getCanvas } from './src/scene-graph.js';
import { applyStructure } from './src/structures.js';
import { parseAndExecute } from './src/operations.js';
import { canvasVersionHash } from './src/version.js';
import { evaluateCanvas, relaxedByGenre, relaxedByPreset, canonicalGenre, knownGenres } from './src/evaluate.js';
import { stampPreset, isPresetName } from './src/genre.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const canvas = createCanvas('Set Genre Test');
parseAndExecute(canvas.root, `
f=I("document", { type: "frame", layout: "vertical", gap: 16, padding: 24 })
I(f, { type: "text", content: "Revenue targets", fontSize: 20 })
`, canvas);

// Stamp on a canvas with no provenance at all.
const h0 = canvasVersionHash(canvas);
const lm0 = canvas.lastModified;
const r1 = setCanvasGenre(canvas.id, 'dashboard');
check('stamp returns previous null', r1?.previous === null);
check('provenance.genre written verbatim', canvas.metadata?.provenance?.genre === 'dashboard');
check('provenance.preset untouched', canvas.metadata?.provenance?.preset === undefined);
check('provenance.at stamped', typeof canvas.metadata?.provenance?.at === 'string');
check('lastModified bumped', canvas.lastModified !== lm0);
check('versionHash NOT moved by the stamp', canvasVersionHash(canvas) === h0);

// Evaluation picks the stamp up as provenance-sourced, alias folded.
const ev = await evaluateCanvas(canvas, { mode: 'fast' });
check('evaluate reads the stamp as canonical "data"', ev.genre?.active === 'data' && ev.genre?.source === 'provenance', JSON.stringify(ev.genre));

// Restamp preserves other provenance facts.
canvas.metadata!.provenance = { ...canvas.metadata!.provenance!, structure: 'dashboard-scaffold', importedFrom: 'https://x.test' };
const r2 = setCanvasGenre(canvas.id, 'material');
check('restamp returns prior genre (raw)', r2?.previous === 'dashboard');
check('other provenance facts preserved', canvas.metadata?.provenance?.structure === 'dashboard-scaffold' && canvas.metadata?.provenance?.importedFrom === 'https://x.test');

// Clear sets genre to null (the key stays: the canvas is migrated).
const r3 = setCanvasGenre(canvas.id, null);
check('clear returns prior genre', r3?.previous === 'material');
check('genre null, rest intact', canvas.metadata?.provenance?.genre === null && canvas.metadata?.provenance?.structure === 'dashboard-scaffold');
const evCleared = await evaluateCanvas(canvas, { mode: 'fast' });
check('cleared stamp → evaluate sees no genre', evCleared.genre?.active === null && evCleared.genre?.source === null);

// Clearing an already-clear canvas is a no-op that doesn't dirty the file.
const lm1 = canvas.lastModified;
const r4 = setCanvasGenre(canvas.id, null);
check('double clear → previous null, lastModified untouched', r4?.previous === null && canvas.lastModified === lm1);

// Unknown genre: stored, relaxes nothing (the tool surfaces a note from this).
setCanvasGenre(canvas.id, 'brutalist');
check('unknown genre stored', getCanvas(canvas.id)?.metadata?.provenance?.genre === 'brutalist');
check('relaxedByGenre: unknown → []', relaxedByGenre('brutalist').length === 0);
check('relaxedByGenre: material → accent-hue + pure-black-white', relaxedByGenre('material').sort().join(',') === 'accent-hue,pure-black-white');
// Pinned on purpose: adding a relax-genre is a deliberate act (it opens a hole
// in a guardrail), so it should have to be written down here too.
check('knownGenres lists the relax table', knownGenres().sort().join(',') === 'checkout,commerce,dashboard,data,material', knownGenres().join(','));
check('relaxedByGenre: commerce → honest-content', relaxedByGenre('commerce').join(',') === 'honest-content');
check('relaxedByGenre: checkout aliases commerce', relaxedByGenre('checkout').join(',') === 'honest-content');
check('canonicalGenre folds dashboard → data, checkout → commerce', canonicalGenre('dashboard') === 'data' && canonicalGenre('checkout') === 'commerce' && canonicalGenre('fitness') === 'fitness');

// Missing canvas → undefined.
check('unknown canvas → undefined', setCanvasGenre('nope', 'dashboard') === undefined);

// ── Phase 30 slice A: genre and preset are separate fields ───────────────────
function freshCanvas(name: string, provenance?: Record<string, unknown>) {
  const c = createCanvas(name);
  parseAndExecute(c.root, `
f=I("document", { type: "frame", layout: "vertical", gap: 16, padding: 24, fill: "#F8FAFC" })
I(f, { type: "text", content: "Revenue this quarter", fontSize: 20, color: "#1E293B" })
I(f, { type: "text", content: "$2,481,330.17", fontSize: 32, color: "#1E293B" })
I(f, { type: "text", content: "Up 12.4% from 2,218 orders", fontSize: 14, color: "#475569" })
I(f, { type: "text", content: "Updated hourly", fontSize: 14, color: "#000000" })
`, c);
  if (provenance) c.metadata = { ...c.metadata, provenance: { at: '2026-01-01T00:00:00.000Z', ...provenance } as never };
  return c;
}
const prov = (id: string) => getCanvas(id)?.metadata?.provenance as Record<string, unknown> | undefined;
const applyPreset = (id: string, preset: string) => {
  const c = getCanvas(id)!;
  c.metadata = { ...c.metadata, provenance: stampPreset(c.metadata?.provenance, preset) };
};

{
  // AC1 — the clobber this slice exists to fix (US4).
  const c = freshCanvas('ac1');
  setCanvasGenre(c.id, 'commerce');
  const h = canvasVersionHash(c);
  applyPreset(c.id, 'dark');
  check('AC1: apply_preset after set_genre keeps the genre', prov(c.id)?.genre === 'commerce' && prov(c.id)?.preset === 'dark', JSON.stringify(prov(c.id)));
  const r = await evaluateCanvas(c, { mode: 'fast' });
  check('AC1: report still commerce', r.genre?.active === 'commerce');
  check('AC17: metadata writes never move versionHash', canvasVersionHash(c) === h);
}
{
  // AC2–AC4 — a stored legacy dashboard stamp.
  const c = freshCanvas('ac2', { preset: 'dashboard' });
  const legacy = await evaluateCanvas(c, { mode: 'fast' });
  const twin = freshCanvas('ac2-twin');
  const explicit = await evaluateCanvas(twin, { mode: 'fast', genre: 'dashboard' });
  const bare = await evaluateCanvas(freshCanvas('ac2-bare'), { mode: 'fast' });
  check('AC2: legacy dashboard keeps its score', legacy.overallScore === explicit.overallScore, `${legacy.overallScore} vs ${explicit.overallScore}`);
  check('AC2: fixture sanity — without a genre the figures flag', bare.issues.some((i) => i.tell === 'honest-content') && !legacy.issues.some((i) => i.tell === 'honest-content'));
  check('AC2: legacy dashboard reports data from provenance', legacy.genre?.active === 'data' && legacy.genre?.source === 'provenance');
  check('AC2: honest-content relaxed', legacy.genre?.relaxed.includes('honest-content') === true);
  applyPreset(c.id, 'dark');
  check('AC3: apply_preset migrates the legacy genre verbatim', prov(c.id)?.genre === 'dashboard' && prov(c.id)?.preset === 'dark', JSON.stringify(prov(c.id)));
  const r = setCanvasGenre(c.id, null);
  const after = await evaluateCanvas(c, { mode: 'fast' });
  check('AC4: clear leaves no genre', prov(c.id)?.genre === null && after.genre?.active === null && r?.previous === 'dashboard');
  check('AC4: honest-content no longer relaxed', !after.genre?.relaxed.includes('honest-content'));
}
{
  // AC5 — material preset over a legacy commerce stamp.
  const c = freshCanvas('ac5', { preset: 'commerce' });
  applyPreset(c.id, 'material');
  check('AC5: legacy commerce moves to genre, preset is material', prov(c.id)?.genre === 'commerce' && prov(c.id)?.preset === 'material', JSON.stringify(prov(c.id)));
  const r = await evaluateCanvas(c, { mode: 'fast' });
  const relaxed = r.genre!.relaxed.slice().sort().join(',');
  check('AC5: both axes relax', r.genre?.active === 'commerce' && relaxed === 'accent-hue,honest-content,pure-black-white', relaxed);
}
{
  // AC6 — an unknown legacy genre survives the negative read.
  const r = await evaluateCanvas(freshCanvas('ac6', { preset: 'fitness' }), { mode: 'fast' });
  check('AC6: legacy fitness still reports fitness', r.genre?.active === 'fitness');
}
{
  // AC7 — a stored preset name reads as the preset, relaxation kept.
  const c = freshCanvas('ac7', { preset: 'material' });
  const r = await evaluateCanvas(c, { mode: 'fast' });
  const twin = await evaluateCanvas(freshCanvas('ac7-twin'), { mode: 'fast', genre: 'material' });
  check('AC7: preset material → no genre, material tells relaxed',
    r.genre?.active === null && r.genre!.relaxed.slice().sort().join(',') === 'accent-hue,pure-black-white' && r.genre?.byPreset?.preset === 'material', JSON.stringify(r.genre));
  const tellsOf = (res: typeof r) => res.issues.filter((i) => i.category === 'cliche').map((i) => i.tell).sort().join(',');
  check('AC7: score and tells unchanged vs genre material', r.overallScore === twin.overallScore && tellsOf(r) === tellsOf(twin), `${r.overallScore}/${tellsOf(r)} vs ${twin.overallScore}/${tellsOf(twin)}`);
  check('AC7: the pure-black ink is actually relaxed (fixture sanity)', !tellsOf(r).includes('pure-black-white'));
  // AC8 — an explicit genre replaces only the genre axis.
  const e = await evaluateCanvas(c, { mode: 'fast', genre: 'commerce' });
  check('AC8: explicit commerce on a material preset relaxes all three',
    e.genre!.relaxed.slice().sort().join(',') === 'accent-hue,honest-content,pure-black-white', e.genre!.relaxed.join(','));
}
{
  // AC12 — an imported preset name is a preset once the canvas is migrated,
  // with no dependence on the runtime preset registry.
  const c = freshCanvas('ac12');
  applyPreset(c.id, 'acme');
  check('AC12: apply_preset marks the canvas migrated', prov(c.id)?.genre === null && prov(c.id)?.preset === 'acme', JSON.stringify(prov(c.id)));
  const r = await evaluateCanvas(c, { mode: 'fast' });
  check('AC12: imported preset is not read as a genre', r.genre?.active === null);
  setCanvasGenre(c.id, 'commerce');
  check('AC12: set_genre keeps the imported preset', prov(c.id)?.preset === 'acme' && prov(c.id)?.genre === 'commerce', JSON.stringify(prov(c.id)));
}
{
  // AC13 — clearing a legacy genre removes it.
  const c = freshCanvas('ac13', { preset: 'commerce' });
  const r = setCanvasGenre(c.id, null);
  check('AC13: legacy genre cleared', r?.previous === 'commerce' && prov(c.id)?.preset === undefined && prov(c.id)?.genre === null, JSON.stringify(prov(c.id)));
}
{
  // AC14 — clearing on a stored material preset: nothing to clear, the
  // preset (and its relaxation) stays. The tool reports presetRelaxes.
  const c = freshCanvas('ac14', { preset: 'material' });
  const r = setCanvasGenre(c.id, null);
  check('AC14: material preset is not a genre to clear', r?.previous === null && prov(c.id)?.preset === 'material');
  check('AC14: the preset relaxation is still reported', relaxedByPreset(prov(c.id)?.preset as string).length === 2);
}
{
  // AC15 — genre is free text; own-key lookups only.
  const c = freshCanvas('ac15');
  setCanvasGenre(c.id, 'constructor');
  let threw = false;
  let r: Awaited<ReturnType<typeof evaluateCanvas>> | undefined;
  try { r = await evaluateCanvas(c, { mode: 'fast' }); } catch { threw = true; }
  check('AC15: "constructor" genre evaluates', !threw && r?.genre?.active === 'constructor' && r.genre.relaxed.length === 0);
  check('AC15: relaxedByGenre("__proto__") → []', relaxedByGenre('__proto__').length === 0);
}
{
  // Built-in preset names come from presets.ts, captured before imports.
  check('isPresetName: built-ins only', ['dark', 'light', 'material', 'minimal'].every(isPresetName) && !isPresetName('commerce') && !isPresetName('acme'));
}

// ── stamping a page structure must not erase the genre ───────────────────────
{
  // Found by building the v2.1.0 checkout example. `canvas_set_genre` writes
  // metadata.provenance.preset; `applyStructure` then recorded its own
  // provenance by REPLACING the object, so declaring a genre and then stamping
  // a layout — the order the docs encourage — silently dropped the genre and
  // the screen's prices went back to being flagged as fabricated. It failed
  // silently: nothing errored, the evaluation just reported genre.active null.
  const canvas = createCanvas('genre-then-structure');
  setCanvasGenre(canvas.id, 'commerce');
  applyStructure(canvas, 'settings');
  const after = getCanvas(canvas.id)!;
  const stamp = after.metadata?.provenance;

  check('the genre survives a page-structure stamp', stamp?.genre === 'commerce', `genre=${stamp?.genre}`);
  check('...and the structure is recorded alongside it', stamp?.structure === 'settings', `structure=${stamp?.structure}`);

  // The evaluator is what actually consumes it — assert the end effect, not
  // just the metadata shape.
  const r = await evaluateCanvas(after, { mode: 'fast', categories: ['cliche'] });
  check('...so the evaluator still sees the genre', r.genre?.active === 'commerce', JSON.stringify(r.genre?.active));
}

console.log(allPass ? '\nAll set-genre tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
