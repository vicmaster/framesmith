// Correctness fixes for issue #64 (PR 4a):
//   1. canvas_evaluate flagged a contrast ratio that rounds to exactly the WCAG
//      threshold (a true 4.49…:1 shown as "4.5:1"). Now the ratio is rounded to
//      2 decimals before comparison + display, so a value that rounds to 4.50
//      passes and the message never contradicts itself.
//   2. apply_preset clobbered tokens the canvas only inherited from the
//      workspace/project design system. Now those are preserved + reported;
//      new tokens and canvas-own tokens still apply.
//
// Usage: npx tsx test-correctness-fixes.ts

import './test-env.js';
import { contrastRatio, parseColor, evaluateCanvas } from './src/evaluate.js';
import { applyPresetTokens, mergeDesignTokens } from './src/variables.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function textOnBg(textColor: string, bg: string): Canvas {
  const root: SceneNode = {
    id: 'root', name: 'root', type: 'frame', width: 400, height: 200, fill: bg,
    children: [{ id: 't1', name: 'label', type: 'text', content: 'Sample copy', color: textColor, fontSize: 16 }],
  };
  return { id: 'c1', name: 'c', projectId: 'p', root, components: {}, variables: {}, createdAt: '', lastModified: '' } as Canvas;
}
const colorIssue = (r: { issues: Array<{ category: string; nodeId?: string }> }) => r.issues.find((i) => i.category === 'color' && i.nodeId === 't1');

// ── 1. Contrast rounding ──────────────────────────────────────────────────────
// Find a near-gray-on-white pair whose TRUE ratio sits just under 4.5 but rounds
// to 4.50 — the boundary the old strict `< 4.5` mis-flagged while displaying it
// as "4.5:1". Integer grays skip the ~0.005-wide window, so scan an RGB cube.
const white = parseColor('#ffffff')!;
const hx = (n: number) => n.toString(16).padStart(2, '0');
let boundaryHex: string | null = null;
let trueRatio = 0;
outer: for (let r = 110; r <= 128 && !boundaryHex; r++) {
  for (let g = 110; g <= 128; g++) {
    for (let b = 110; b <= 128; b++) {
      const ratio = contrastRatio([r, g, b], white);
      if (Math.round(ratio * 100) / 100 === 4.5 && ratio < 4.5) {
        boundaryHex = `#${hx(r)}${hx(g)}${hx(b)}`;
        trueRatio = ratio;
        break outer;
      }
    }
  }
}
check('contrast: found a boundary color (rounds to 4.50, true < 4.5)', !!boundaryHex, boundaryHex ? `${boundaryHex} → ${trueRatio.toFixed(4)}` : 'none');

if (boundaryHex) {
  const r = await evaluateCanvas(textOnBg(boundaryHex, '#ffffff'), { mode: 'fast', categories: ['color'] });
  check('contrast: ratio rounding to 4.50 is NOT flagged', !colorIssue(r));
}

// A genuinely failing pair IS still flagged, with a 2-decimal message.
const rFail = await evaluateCanvas(textOnBg('#aaaaaa', '#ffffff'), { mode: 'fast', categories: ['color'] }); // ~2.3:1
const failIssue = colorIssue(rFail);
check('contrast: a real failure is still flagged', !!failIssue);
check('contrast: message uses a 2-decimal ratio', !!failIssue && /ratio \d+\.\d{2}:1/.test(failIssue!.message), failIssue?.message);

// High-contrast pair passes (sanity).
const rPass = await evaluateCanvas(textOnBg('#000000', '#ffffff'), { mode: 'fast', categories: ['color'] });
check('contrast: black on white passes', !colorIssue(rPass));

// ── 2. apply_preset conservative merge ────────────────────────────────────────
function freshCanvas(ownVars: Canvas['variables'] = {}): Canvas {
  return {
    id: 'c2', name: 'c2', projectId: 'p', components: {}, variables: ownVars,
    root: { id: 'r', name: 'r', type: 'frame' }, createdAt: '', lastModified: '',
  } as Canvas;
}

// Workspace design system sets a custom spacing rhythm + a brand color.
const inherited = mergeDesignTokens({ spacing: { md: 12, lg: 18 }, colors: { brand: '#ff0000' } });
const presetVars = {
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  colors: { brand: '#0000ff', accent: '#00ff00' },
};

const canvas = freshCanvas();
const res = applyPresetTokens(canvas, presetVars, inherited);

// Inherited md/lg/brand are preserved (not written onto the canvas layer).
check('preset: inherited spacing.md not overwritten', canvas.variables.spacing?.md === undefined, `md=${canvas.variables.spacing?.md}`);
check('preset: inherited spacing.lg not overwritten', canvas.variables.spacing?.lg === undefined);
check('preset: inherited color brand not overwritten', canvas.variables.colors?.brand === undefined);
// New tokens are applied.
check('preset: new spacing.xs applied', canvas.variables.spacing?.xs === 4);
check('preset: new spacing.xl applied', canvas.variables.spacing?.xl === 32);
check('preset: new color accent applied', canvas.variables.colors?.accent === '#00ff00');
// The conflicts are reported.
const preservedKeys = res.preserved.map((p) => `${p.category}.${p.key}`).sort();
check('preset: preserved list names md, lg, brand', preservedKeys.join(',') === 'colors.brand,spacing.lg,spacing.md', preservedKeys.join(','));
check('preset: preserved entry carries kept + preset values', res.preserved.some((p) => p.key === 'md' && p.kept === '12' && p.preset === '16'));

// A canvas that already overrides a token on its OWN layer: the preset DOES
// overwrite it (presets operate on the canvas layer; only inheritance is spared).
const canvas2 = freshCanvas({ spacing: { md: 99 } });
applyPresetTokens(canvas2, presetVars, inherited);
check('preset: canvas-own token IS overwritten by preset', canvas2.variables.spacing?.md === 16, `md=${canvas2.variables.spacing?.md}`);

// No inheritance → preset applies fully (the common no-design-system case).
const canvas3 = freshCanvas();
const res3 = applyPresetTokens(canvas3, presetVars, {});
check('preset: with no design system, everything applies', canvas3.variables.spacing?.md === 16 && canvas3.variables.colors?.brand === '#0000ff' && res3.preserved.length === 0);

console.log(allPass ? '\nCORRECTNESS FIXES TEST PASSED ✅' : '\nCORRECTNESS FIXES TEST FAILED ✗');
process.exit(allPass ? 0 : 1);
