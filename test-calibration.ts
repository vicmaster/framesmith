import './test-env.js';
// Phase 22 slice C (#135) — evaluator calibration for data-dense screens:
//   1. genre "dashboard" (alias "data") relaxes the honest-content tell —
//      explicitly and via provenance; default behavior unchanged.
//   2. Type-scale pinning: adjacent-size pairs where BOTH sizes are declared
//      as typography tokens skip the ratio check; undeclared sizes still flag.
//   3. The ratio message matches the code threshold (1.1-2.0).
//   4. End-to-end: the #135 shape (money figures + a dense app scale) reaches
//      zero honest-content flags and zero ratio warnings once calibrated.
//
// Usage: npx tsx test-calibration.ts

import { evaluateCanvas } from './src/evaluate.js';
import type { Canvas, SceneNode } from './src/types.js';

function fakeCanvas(root: SceneNode, extras: Partial<Canvas> = {}): Canvas {
  return {
    id: 'cal-test', name: 'calibration', root, variables: {}, components: {},
    createdAt: '1970-01-01T00:00:00Z', lastModified: '1970-01-01T00:00:00Z',
    projectId: 'default-project',
    ...extras,
  };
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const honestFlags = (issues: { tell?: string }[]) => issues.filter((i) => i.tell === 'honest-content');
const ratioFlags = (issues: { message: string }[]) => issues.filter((i) => i.message.includes('have ratio'));

// The #135 shape: a results-and-pace screen — money figures, percentages, and
// a deliberately dense 14/13/12/11 type scale matching an existing app.
const dashboardRoot = (): SceneNode => ({
  id: 'doc', type: 'document', fill: '#FAFAFA', layout: 'vertical', gap: 16, padding: 24,
  children: [
    { id: 'v1', type: 'text', content: '$2.70M', fontSize: 14, color: '#111827' },
    { id: 'v2', type: 'text', content: '56% of annual goal', fontSize: 13, color: '#111827' },
    { id: 'v3', type: 'text', content: '$1.52M booked', fontSize: 12, color: '#111827' },
    { id: 'v4', type: 'text', content: 'Q3 run-rate 1.4x', fontSize: 11, color: '#111827' },
  ],
});

// ── 1. genre relax ───────────────────────────────────────────────────────────
{
  const def = await evaluateCanvas(fakeCanvas(dashboardRoot()), { mode: 'fast' });
  check('default: money/percent copy flags honest-content', honestFlags(def.issues).length >= 3, `got ${honestFlags(def.issues).length}`);
  check('default: suggestion names the genre escape hatch', honestFlags(def.issues).every((i: { suggestion?: string }) => i.suggestion?.includes('genre: "dashboard"')));

  const dash = await evaluateCanvas(fakeCanvas(dashboardRoot()), { mode: 'fast', genre: 'dashboard' });
  check('genre "dashboard": zero honest-content flags', honestFlags(dash.issues).length === 0, `got ${honestFlags(dash.issues).length}`);

  const data = await evaluateCanvas(fakeCanvas(dashboardRoot()), { mode: 'fast', genre: 'data' });
  check('alias "data": zero honest-content flags', honestFlags(data.issues).length === 0);

  const viaProv = await evaluateCanvas(
    fakeCanvas(dashboardRoot(), { metadata: { provenance: { preset: 'dashboard', at: '1970-01-01T00:00:00Z' } } }),
    { mode: 'fast' },
  );
  check('provenance preset "dashboard" relaxes too', honestFlags(viaProv.issues).length === 0);

  const material = await evaluateCanvas(fakeCanvas(dashboardRoot()), { mode: 'fast', genre: 'material' });
  check('genre "material" does NOT relax honest-content', honestFlags(material.issues).length >= 3);
}

// ── 2. type-scale pinning ────────────────────────────────────────────────────
{
  const unpinned = await evaluateCanvas(fakeCanvas(dashboardRoot()), { mode: 'fast', genre: 'dashboard' });
  check('unpinned dense scale flags ratio warnings', ratioFlags(unpinned.issues).length === 3, `got ${ratioFlags(unpinned.issues).length}`);
  check('ratio message matches the code threshold', ratioFlags(unpinned.issues).every((i) => i.message.includes('expected 1.1-2.0')), ratioFlags(unpinned.issues)[0]?.message);
  check('ratio suggestion names token pinning', ratioFlags(unpinned.issues).every((i: { suggestion?: string }) => i.suggestion?.includes('typography tokens')));

  const pinnedVars = {
    typography: {
      body: { fontSize: 14 }, secondary: { fontSize: 13 },
      caption: { fontSize: 12 }, micro: { fontSize: 11 },
    },
  };
  const pinned = await evaluateCanvas(fakeCanvas(dashboardRoot(), { variables: pinnedVars }), { mode: 'fast', genre: 'dashboard' });
  check('declaring the scale as tokens clears the ratio warnings', ratioFlags(pinned.issues).length === 0, `got ${ratioFlags(pinned.issues).length}`);

  // A pair with only ONE side pinned still flags (15 is undeclared).
  const partial = fakeCanvas(dashboardRoot(), { variables: pinnedVars });
  partial.root.children!.push({ id: 'v5', type: 'text', content: 'footnote', fontSize: 15, color: '#111827' });
  const partialR = await evaluateCanvas(partial, { mode: 'fast', genre: 'dashboard' });
  check('an undeclared size still flags against a pinned neighbor', ratioFlags(partialR.issues).length >= 1, `got ${ratioFlags(partialR.issues).length}`);
}

// ── 3. calibrated end-to-end: no honest-content / ratio blockers left ────────
{
  const calibrated = await evaluateCanvas(
    fakeCanvas(dashboardRoot(), {
      variables: { typography: { body: { fontSize: 14 }, secondary: { fontSize: 13 }, caption: { fontSize: 12 }, micro: { fontSize: 11 } } },
    }),
    { mode: 'fast', genre: 'dashboard' },
  );
  const leftover = [...honestFlags(calibrated.issues), ...ratioFlags(calibrated.issues)];
  check('calibrated dashboard has zero #135-class flags', leftover.length === 0, leftover.map((i: { message: string }) => i.message).join(' | '));
  const cliche = calibrated.categories.find((c) => c.name === 'cliche');
  check('cliche category recovers (no longer zeroed)', (cliche?.score ?? 0) === 100, String(cliche?.score));
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
