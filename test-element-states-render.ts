// Phase 31 slice G (FR-G1 acceptance, spec P8) — a `button` of each variant
// at each of the five states renders deterministically (two renders, the
// same pixels) and distinctly (every pair of states differs) in both themes
// of a generated design system. The capture is a small window around the
// button, so the focus ring (outside the box, S9) is in the frame. PNG bytes
// stand in for pixels: the encoder is lossless and deterministic, so equal
// bytes mean equal pixels and different bytes different ones.
// Needs Chrome. Run with: npx tsx test-element-states-render.ts

import './test-env.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { generateDesignSystem } from './src/design-language.js';
import { takeScreenshot, shutdown } from './src/screenshot.js';
import type { ElementState, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const SYSTEM = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
const STATES: ElementState[] = ['rest', 'hover', 'focus', 'pressed', 'disabled'];
const VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const;
const W = 200;
const H = 96;

function html(variant: string, state: ElementState, theme: 'light' | 'dark'): string {
  const root: SceneNode = {
    id: 'root', type: 'frame', width: W, height: H, fill: '$bg-primary', layout: 'vertical', alignItems: 'center', justifyContent: 'center',
    children: [{ id: 'b', type: 'button', label: 'Save', size: 'sm', variant: variant as SceneNode['variant'], state }],
  };
  return renderToHtml(resolveVariables(root, SYSTEM, { theme }), W, H);
}

const shot = (h: string) => takeScreenshot(h, { width: W, height: H, scale: 1 });

for (const theme of ['light', 'dark'] as const) {
  for (const variant of VARIANTS) {
    const shots: string[] = [];
    let stable = true;
    for (const state of STATES) {
      const h = html(variant, state, theme);
      const [a, b] = [await shot(h), await shot(h)];
      if (a !== b) stable = false;
      shots.push(a);
    }
    check(`${theme} ${variant}: each state renders the same pixels twice`, stable);
    const same: string[] = [];
    for (let i = 0; i < STATES.length; i++) {
      for (let j = i + 1; j < STATES.length; j++) if (shots[i] === shots[j]) same.push(`${STATES[i]}=${STATES[j]}`);
    }
    check(`${theme} ${variant}: every pair of states differs`, same.length === 0, same.join(', '));
  }
}

// Twin: a node that takes no state renders the same pixels in every state.
{
  const frame = (state: ElementState) => renderToHtml(resolveVariables({
    id: 'root', type: 'frame', width: W, height: H, fill: '$bg-primary', layout: 'vertical', alignItems: 'center', justifyContent: 'center',
    children: [{ id: 'f', type: 'frame', width: 80, height: 32, fill: '$accent', cornerRadius: 8, state }],
  }, SYSTEM), W, H);
  const base = await shot(frame('rest'));
  const all = await Promise.all(STATES.slice(1).map((s) => shot(frame(s))));
  check('twin: a frame with state renders as at rest', all.every((s) => s === base));
}

await shutdown();
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
