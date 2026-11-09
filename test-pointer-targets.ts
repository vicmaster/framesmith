// Phase 31 FR-A4 — the WCAG 2.5.8 spacing exception in detailed mode. A target
// below 24px passes when a 24px circle centred on it reaches no other target's
// box and no other undersized target's circle; touching passes, nested and
// disabled targets never count. Needs Chrome (detailed mode lays out).
//
// Usage: npx tsx test-pointer-targets.ts

import './test-env.js';
import { evaluateCanvas } from './src/evaluate.js';
import { shutdown } from './src/screenshot.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const btn = (id: string, size: number, extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'button', icon: 'x', size: 'sm', width: size, height: size, ...extra });
const row = (gap: number, children: SceneNode[]): SceneNode =>
  ({ id: 'row', name: 'row', type: 'frame', layout: 'horizontal', alignItems: 'center', gap, children });

function canvasOf(type: 'web' | 'desktop-app', children: SceneNode[]): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables: {}, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 40, children },
    metadata: { surface: type === 'web' ? { type } : { type, device: 'window-1440' } },
  } as Canvas;
}

async function targetFindings(type: 'web' | 'desktop-app', children: SceneNode[]) {
  const r = await evaluateCanvas(canvasOf(type, children), { mode: 'detailed', categories: ['usability'] });
  return r.issues.filter((i) => /24px floor/.test(i.message));
}

for (const type of ['web', 'desktop-app'] as const) {
  // Centres 24px apart: the two circles touch, and each circle stops 2px short
  // of the neighbour's box. Passes.
  let f = await targetFindings(type, [row(4, [btn('a', 20), btn('b', 20)])]);
  check(`${type}: two 20px buttons with centres 24px apart pass`, f.length === 0, JSON.stringify(f.map((i) => i.message)));

  f = await targetFindings(type, [row(0, [btn('a', 20), btn('b', 20)])]);
  check(`${type}: the same buttons touching fail, as errors naming the neighbour`, f.length === 2 && f.every((i) => i.severity === 'error' && /24px circle/.test(i.message) && /reaches/.test(i.message)), JSON.stringify(f.map((i) => [i.severity, i.message])));

  // A 20px button 2px from a 32px one: its circle reaches 12px, the box is 12
  // away — touching, so it passes. At 1px the circle reaches into the box.
  f = await targetFindings(type, [row(2, [btn('a', 20), btn('big', 32)])]);
  check(`${type}: a circle that only touches a neighbour's box passes`, f.length === 0, JSON.stringify(f.map((i) => i.message)));
  f = await targetFindings(type, [row(1, [btn('a', 20), btn('big', 32)])]);
  check(`${type}: a circle reaching into a neighbour's box fails`, f.length === 1 && f[0].nodeId === 'a' && f[0].severity === 'error', JSON.stringify(f.map((i) => i.message)));

  f = await targetFindings(type, [row(0, [btn('a', 20), btn('b', 20, { disabled: true })])]);
  check(`${type}: a disabled neighbour is not in the way`, f.length === 0, JSON.stringify(f.map((i) => i.message)));

  f = await targetFindings(type, [row(40, [btn('a', 20), btn('b', 20)])]);
  check(`${type}: well-spaced small targets pass`, f.length === 0);

  // Boxes 13px apart but centres 23px apart: only the circle-vs-circle test
  // catches it (each circle reaches 12, the other box is 13 away).
  f = await targetFindings(type, [row(3, [btn('a', 20), btn('b', 20)])]);
  check(`${type}: two undersized circles that overlap fail even when neither reaches the other box`, f.length === 2 && f.every((i) => i.severity === 'error'), JSON.stringify(f.map((i) => i.message)));

  // A tab-bar narrower than 24px a tab: every tab shares the bar's node id, so
  // detailed mode cannot place one tab — the tabs stay blocking warnings.
  f = await targetFindings(type, [{ id: 'tb', name: 'tb', type: 'tab-bar', width: 60, position: 'relative', items: ['A', 'B', 'C', 'D', 'E'].map((l) => ({ icon: 'home', label: l })) } as SceneNode]);
  check(`${type}: a too-narrow tab-bar's tabs stay blocking in detailed mode`, f.length === 5 && f.every((i) => i.severity === 'warning' && /could not place/.test(i.message)), JSON.stringify(f.map((i) => [i.severity, i.message.slice(0, 90)])));

  // A neighbour nested past the layout walker's depth cannot be placed, so the
  // spacing exception is unproven and the small target stays blocking.
  let deep: SceneNode = btn('deep', 32);
  for (let d = 0; d < 28; d++) deep = { id: `w${d}`, name: `w${d}`, type: 'frame', children: [deep] };
  f = await targetFindings(type, [row(0, [btn('a', 20), deep])]);
  const a = f.find((i) => i.nodeId === 'a');
  check(`${type}: a neighbour the layout cannot place keeps the small target blocking`, !!a && a.severity === 'warning' && /could not place/.test(a.message), JSON.stringify(f.map((i) => [i.nodeId, i.severity, i.message])));
}

await shutdown();
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
