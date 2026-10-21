// Phase 23 slice A (#149) — a stable content hash per canvas so approvals are
// falsifiable. The hash covers design content ONLY (root tree, resolved tokens,
// components, fonts); metadata (feedback, critique, provenance), timestamps,
// and store identity never move it. #217: tokens are resolved through the
// workspace → project → canvas chain (sha256r:); legacy sha256: hashes are
// still checked with the old algorithm, with a warning.
//
// Usage: npx tsx test-version-hash.ts

import './test-env.js';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { canonicalSerialize, canvasVersionHash, legacyCanvasVersionHash, checkVersionHash } from './src/version.js';
import { createWorkspace, createProject, ensureDefaultWorkspaceAndProject, setWorkspaceDesignSystem, setProjectDesignSystem } from './src/workspaces.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── canonicalSerialize ──────────────────────────────────────────────────────
check('key order does not matter', canonicalSerialize({ b: 1, a: 2 }) === canonicalSerialize({ a: 2, b: 1 }));
check('array order DOES matter', canonicalSerialize([1, 2]) !== canonicalSerialize([2, 1]));
check('nested objects sorted', canonicalSerialize({ x: { b: 1, a: [{ d: 1, c: 2 }] } }) === '{"x":{"a":[{"c":2,"d":1}],"b":1}}');
check('undefined members dropped like JSON.stringify', canonicalSerialize({ a: 1, b: undefined }) === '{"a":1}');
check('undefined in arrays → null like JSON.stringify', canonicalSerialize([1, undefined, 2]) === '[1,null,2]');
check('primitives/null', canonicalSerialize('a') === '"a"' && canonicalSerialize(3) === '3' && canonicalSerialize(null) === 'null' && canonicalSerialize(true) === 'true');

// ── canvasVersionHash ───────────────────────────────────────────────────────
function makeCanvas() {
  const canvas = createCanvas('Version Hash Test');
  parseAndExecute(canvas.root, `
card=I("document", { type: "frame", layout: "vertical", gap: 16, padding: 24, fill: "$surface" })
t=I(card, { type: "text", content: "Revenue targets", fontSize: 20 })
`, canvas);
  return canvas;
}

const canvas = makeCanvas();
const h0 = canvasVersionHash(canvas);
check('format sha256r:<16 hex>', /^sha256r:[0-9a-f]{16}$/.test(h0), h0);
check('legacy format sha256:<16 hex>', /^sha256:[0-9a-f]{16}$/.test(legacyCanvasVersionHash(canvas)));
check('deterministic', canvasVersionHash(canvas) === h0);

// Metadata must never move the hash — the #149 contract: an approval survives
// feedback arriving/resolving, critique stamps, and provenance changes.
canvas.metadata = {
  ...canvas.metadata,
  provenance: { preset: 'dashboard', at: new Date().toISOString() },
  feedback: [{ id: 'fb-1', note: 'nudge left', createdAt: 'x' }],
  critique: { overall: 88 },
} as typeof canvas.metadata;
canvas.lastModified = new Date(Date.now() + 60_000).toISOString();
check('metadata + lastModified changes → hash unchanged', canvasVersionHash(canvas) === h0);

// Identity fields don't participate — the same design in another store slot
// hashes identically (process/machine independence).
const twin = makeCanvas();
twin.root = structuredClone(canvas.root);
twin.variables = structuredClone(canvas.variables);
twin.components = structuredClone(canvas.components);
check('same content, different canvas id/name → same hash', canvasVersionHash(twin) === h0, `${canvasVersionHash(twin)} vs ${h0}`);

// Design edits move it.
const c2 = makeCanvas();
const base = canvasVersionHash(c2);
parseAndExecute(c2.root, `U("${c2.root.children![0].id}", { fill: "#0F172A" })`, c2);
const afterTree = canvasVersionHash(c2);
check('tree edit → new hash', afterTree !== base);

c2.variables = { ...c2.variables, colors: { surface: '#F8FAFC' } };
const afterTokens = canvasVersionHash(c2);
check('token edit → new hash', afterTokens !== afterTree);

c2.components['cmp-x'] = { id: 'cmp-x', type: 'frame' } as (typeof c2.components)[string];
const afterComponents = canvasVersionHash(c2);
check('component registry edit → new hash', afterComponents !== afterTokens);

c2.fonts = [{ family: 'Inter', css: '' } as NonNullable<typeof c2.fonts>[number]];
check('fonts edit → new hash', canvasVersionHash(c2) !== afterComponents);

// fonts absent vs [] is normalized — a canvas that never touched fonts hashes
// the same before/after the field first appears empty.
const c3 = makeCanvas();
const noFonts = canvasVersionHash(c3);
c3.fonts = [];
check('fonts undefined vs [] → same hash', canvasVersionHash(c3) === noFonts);

// ── #217: inherited workspace/project tokens ────────────────────────────────
// The canvas renders through workspace → project → canvas tokens, so an edit
// at either inherited layer must move the hash (it didn't before #217).
ensureDefaultWorkspaceAndProject();
const ws = createWorkspace('Hash WS');
const proj = createProject(ws.id, 'Hash Project')!;
setWorkspaceDesignSystem(ws.id, { colors: { primary: '#2563EB', surface: '#FFFFFF' } });
function makeInheritingCanvas() {
  const c = createCanvas('Inherits', proj.id);
  parseAndExecute(c.root, `b=I("document", { type: "frame", fill: "$primary", padding: 16 })`, c);
  return c;
}
const inh = makeInheritingCanvas();
const i0 = canvasVersionHash(inh);
const legacy0 = legacyCanvasVersionHash(inh);

setWorkspaceDesignSystem(ws.id, { colors: { primary: '#DC2626' } });
const i1 = canvasVersionHash(inh);
check('workspace token edit → new hash', i1 !== i0, `${i0} → ${i1}`);
check('workspace token edit leaves the LEGACY hash unchanged (the #217 bug)', legacyCanvasVersionHash(inh) === legacy0);

setProjectDesignSystem(proj.id, { colors: { primary: '#16A34A' } });
const i2 = canvasVersionHash(inh);
check('project token edit → new hash', i2 !== i1, `${i1} → ${i2}`);

// A canvas-level override shadows the inherited value — an inherited edit to
// a token the canvas overrides changes nothing rendered, so nothing moves.
inh.variables = { ...inh.variables, colors: { ...(inh.variables.colors ?? {}), primary: '#000000' } };
const i3 = canvasVersionHash(inh);
setWorkspaceDesignSystem(ws.id, { colors: { primary: '#7C3AED' } });
setProjectDesignSystem(proj.id, { colors: { primary: '#EA580C' } });
check('inherited edit to a token the canvas overrides → hash unchanged', canvasVersionHash(inh) === i3);

// Metadata still never moves it on an inheriting canvas.
inh.metadata = { ...inh.metadata, critique: { overall: 91 } } as typeof inh.metadata;
check('metadata change on an inheriting canvas → hash unchanged', canvasVersionHash(inh) === i3);

// Two canvases with identical own content in projects with different design
// systems render differently, so they must hash differently.
const otherProj = createProject(ws.id, 'Other Project')!;
setProjectDesignSystem(otherProj.id, { colors: { surface: '#0F172A' } });
const a = makeInheritingCanvas();
const b = createCanvas('Inherits (other project)', otherProj.id);
b.root = structuredClone(a.root);
b.variables = structuredClone(a.variables);
check('same own content, different inherited tokens → different hash', canvasVersionHash(a) !== canvasVersionHash(b));
check('…but the same legacy hash', legacyCanvasVersionHash(a) === legacyCanvasVersionHash(b));

// ── checkVersionHash: dispatch on the recorded hash's prefix ────────────────
{
  const c = makeInheritingCanvas();
  const cur = canvasVersionHash(c);
  const leg = legacyCanvasVersionHash(c);
  const r1 = checkVersionHash(c, cur);
  check('current hash → matches, no warning', r1.matches && r1.warning === undefined && r1.versionHash === cur);
  const r2 = checkVersionHash(c, 'sha256r:0000000000000000');
  check('wrong current hash → no match', !r2.matches && r2.warning === undefined);
  const r3 = checkVersionHash(c, leg);
  check('legacy hash → checked with the legacy algorithm (matches) + warning', r3.matches && typeof r3.warning === 'string' && r3.versionHash === cur);
  const r4 = checkVersionHash(c, 'sha256:0000000000000000');
  check('wrong legacy hash → no match + warning', !r4.matches && typeof r4.warning === 'string');
  setProjectDesignSystem(proj.id, { colors: { primary: '#0891B2' } }); // the project layer wins over the workspace here
  check('after an inherited edit: current hash goes stale', !checkVersionHash(c, cur).matches);
  check('after an inherited edit: legacy hash still matches (warned)', checkVersionHash(c, leg).matches && checkVersionHash(c, leg).warning !== undefined);
}

console.log(allPass ? '\nAll version-hash tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
