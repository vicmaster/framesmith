import './test-env.js';
// Smoke for Phase 6c canvas_autofix. Asserts:
//   1. Spacing off-scale values emit a fix op snapping to the nearest scale value.
//   2. Padding given as an array does NOT emit a fix (ambiguous which index).
//   3. Missing layout on a multi-child frame emits `layout: "vertical"`.
//   4. WCAG contrast failures emit `color: "#000000" | "#FFFFFF"` based on bg.
//   5. End-to-end loop: bad-contrast canvas → evaluate → apply autofix ops via
//      parseAndExecute → re-evaluate → color category recovers (issueCount: 0).
//
// Usage: npx tsx test-autofix.ts

import { evaluateCanvas } from './src/evaluate.js';
import { parseAndExecute } from './src/operations.js';
import type { Canvas, SceneNode } from './src/types.js';
import { badContrastRoot } from './benchmark/corpus/bad-contrast.js';

function fakeCanvas(root: SceneNode): Canvas {
  return {
    id: 'test-canvas',
    name: 'autofix-smoke',
    root,
    variables: {},
    components: {},
    createdAt: '1970-01-01T00:00:00Z',
    lastModified: '1970-01-01T00:00:00Z',
  };
}

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ---- 1. Spacing off-scale → fix snaps to scale --------------------------
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#1E293B',
    padding: 18, // off-scale (nearest: 16)
    gap: 13,     // off-scale (nearest: 12)
    children: [{ id: 'c1', type: 'frame', fill: '#FFF', width: 100, height: 100 }],
  };
  const r = await evaluateCanvas(fakeCanvas(root), { mode: 'fast' });
  const padIssue = r.issues.find((i) => i.message.startsWith('padding:'));
  const gapIssue = r.issues.find((i) => i.message.startsWith('gap:'));
  check('spacing: padding off-scale gets fix', !!padIssue?.fix?.op.includes('padding: 16'));
  check('spacing: gap off-scale gets fix', !!gapIssue?.fix?.op.includes('gap: 12'));
}

// ---- 2. Padding as array → no fix --------------------------------------
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#1E293B',
    padding: [18, 22], // both off-scale, but array → ambiguous
    children: [{ id: 'c1', type: 'frame', fill: '#FFF', width: 100, height: 100 }],
  };
  const r = await evaluateCanvas(fakeCanvas(root), { mode: 'fast' });
  const padIssues = r.issues.filter((i) => i.message.startsWith('padding:'));
  check('spacing: array padding emits issues but no fix', padIssues.length >= 1 && padIssues.every((i) => !i.fix));
}

// ---- 3. Missing layout on multi-child frame → fix sets vertical --------
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#1E293B',
    children: [
      {
        id: 'multikid', type: 'frame', fill: '#fff',
        // no `layout`
        children: [
          { id: 'a', type: 'text', content: 'a', color: '#000' },
          { id: 'b', type: 'text', content: 'b', color: '#000' },
        ],
      },
    ],
  };
  const r = await evaluateCanvas(fakeCanvas(root), { mode: 'fast' });
  const layoutIssue = r.issues.find((i) => i.message.includes('no layout property'));
  check('consistency: missing-layout gets layout=vertical fix', !!layoutIssue?.fix?.op.includes('layout: "vertical"'));
}

// ---- 4. Contrast failure → fix picks white or black -------------------
{
  // White text on white bg → autofix should pick #000000 (bg is light)
  const lightBg: SceneNode = {
    id: 'doc', type: 'document', fill: '#FFFFFF',
    children: [{ id: 't', type: 'text', content: 'invisible', color: '#FFFFFF', fontSize: 16 }],
  };
  const rLight = await evaluateCanvas(fakeCanvas(lightBg), { mode: 'fast' });
  const tIssueLight = rLight.issues.find((i) => i.nodeId === 't');
  check('color: white-on-white → fix picks #000000', !!tIssueLight?.fix?.op.includes('color: "#000000"'));

  // Near-black text on near-black bg → autofix should pick #FFFFFF
  const darkBg: SceneNode = {
    id: 'doc2', type: 'document', fill: '#111111',
    children: [{ id: 't2', type: 'text', content: 'invisible', color: '#222222', fontSize: 16 }],
  };
  const rDark = await evaluateCanvas(fakeCanvas(darkBg), { mode: 'fast' });
  const tIssueDark = rDark.issues.find((i) => i.nodeId === 't2');
  check('color: dark-on-dark → fix picks #FFFFFF', !!tIssueDark?.fix?.op.includes('color: "#FFFFFF"'));
}

// ---- 5. End-to-end loop: bad-contrast → apply fixes → recover ----------
{
  const canvas = fakeCanvas(structuredClone(badContrastRoot));
  const before = await evaluateCanvas(canvas, { mode: 'fast' });
  const colorCatBefore = before.categories.find((c) => c.name === 'color');
  const fixesToApply = before.issues
    .filter((i) => i.category === 'color' && i.fix)
    .map((i) => i.fix!.op);

  check('loop: bad-contrast starts with color issues', (colorCatBefore?.issueCount ?? 0) > 0);
  check('loop: at least one color fix is available', fixesToApply.length > 0);

  if (fixesToApply.length > 0) {
    parseAndExecute(canvas.root, fixesToApply.join('\n'), canvas);
    const after = await evaluateCanvas(canvas, { mode: 'fast' });
    const colorCatAfter = after.categories.find((c) => c.name === 'color');
    check(
      'loop: applying color fixes drops color issueCount',
      (colorCatAfter?.issueCount ?? 999) < (colorCatBefore?.issueCount ?? 0),
      `${colorCatBefore?.issueCount} → ${colorCatAfter?.issueCount}`,
    );
  }
}

process.exit(allPass ? 0 : 1);