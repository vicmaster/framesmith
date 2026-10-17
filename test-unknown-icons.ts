import './test-env.js';
// Issue #214 — icon names that resolve in neither bundled set render an empty
// slot (only an HTML comment), invisible in screenshots. Covers: underscored
// Material Symbols names resolving, path-like names still rejected, and the
// structure-category "unknown icon" warning — candidates, the mechanical fix
// when exactly one spelling resolves, the set tie-break, component icons, and
// empty icon names.
//
// Usage: npx tsx test-unknown-icons.ts

import { getIconSvg } from './src/icons.js';
import { createCanvas } from './src/scene-graph.js';
import { evaluateCanvas } from './src/evaluate.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

async function iconIssues(children: SceneNode[], components: Record<string, SceneNode> = {}) {
  const canvas = createCanvas('Icons');
  canvas.root.children = [{ id: 'wrap', type: 'frame', name: 'Wrap', layout: 'horizontal', gap: 8, children }];
  canvas.components = components;
  const result = await evaluateCanvas(canvas, { mode: 'fast', categories: ['structure'] });
  return {
    issues: result.issues.filter((i) => /icon/i.test(i.message)),
    score: result.categories.find((c) => c.name === 'structure')?.score,
  };
}

// ── 1. resolution ────────────────────────────────────────────────────────────
expect('material:chevron_right resolves', getIconSvg('material:chevron_right', 24) !== null);
expect('material:group_off resolves', getIconSvg('material:group_off', 24) !== null);
expect('material:chevron_right-fill resolves', getIconSvg('material:chevron_right-fill', 24) !== null);
expect('material:refresh still resolves', getIconSvg('material:refresh', 24) !== null);
expect('material:../x rejected', getIconSvg('material:../x') === null);
expect('material:a/b rejected', getIconSvg('material:a/b') === null);

// ── 2. resolving icons are silent ────────────────────────────────────────────
{
  const { issues, score } = await iconIssues([
    { id: 'a', type: 'icon', icon: 'chevron-right' },
    { id: 'b', type: 'icon', icon: 'material:chevron_right' },
    { id: 'c', type: 'icon', icon: 'material:check-fill', iconStyle: 'rounded' },
  ]);
  expect('valid icons raise no finding', issues.length === 0, JSON.stringify(issues));
  expect('structure score unaffected', score === 100, String(score));
}

// ── 3. one resolving spelling → warning + mechanical fix ─────────────────────
{
  const { issues, score } = await iconIssues([
    { id: 'm', type: 'icon', icon: 'material:chevron-right' },
  ]);
  const i = issues[0];
  expect('hyphenated material name flagged', issues.length === 1 && i.nodeId === 'm' && i.severity === 'warning', JSON.stringify(issues));
  expect('fix rewrites to the underscored name', i?.fix?.op === 'U("m", { icon: "material:chevron_right" })', i?.fix?.op);
  expect('unknown icon costs structure score', (score ?? 100) < 100, String(score));
}
{
  const { issues } = await iconIssues([{ id: 'f', type: 'icon', icon: 'material:chevron-right-fill' }]);
  expect('-fill suffix kept when underscoring', issues[0]?.fix?.op === 'U("f", { icon: "material:chevron_right-fill" })', issues[0]?.fix?.op);
}
{
  // group_off exists only in Material; Lucide spells it users-round-x etc.
  const { issues } = await iconIssues([{ id: 'g', type: 'icon', icon: 'group_off' }]);
  expect('bare Material name → material: prefix fix', issues[0]?.fix?.op === 'U("g", { icon: "material:group_off" })', JSON.stringify(issues));
}

// ── 4. two spellings resolve → tie-break by the canvas's icon set ────────────
{
  // cloud_off: Lucide has cloud-off, Material has cloud_off.
  const ambiguous = await iconIssues([{ id: 'x', type: 'icon', icon: 'cloud_off' }]);
  const a = ambiguous.issues[0];
  expect('ambiguous name flagged without a fix', ambiguous.issues.length === 1 && !a.fix, JSON.stringify(a));
  expect('suggestion lists both spellings', !!a?.suggestion?.includes('"cloud-off"') && !!a?.suggestion?.includes('"material:cloud_off"'), a?.suggestion);

  const lucideCanvas = await iconIssues([
    { id: 'x', type: 'icon', icon: 'cloud_off' },
    { id: 'y', type: 'icon', icon: 'search' },
  ]);
  expect('Lucide canvas → Lucide spelling', lucideCanvas.issues[0]?.fix?.op === 'U("x", { icon: "cloud-off" })', lucideCanvas.issues[0]?.fix?.op);

  const materialCanvas = await iconIssues([
    { id: 'x', type: 'icon', icon: 'cloud_off' },
    { id: 'y', type: 'icon', icon: 'material:search' },
  ]);
  expect('Material canvas → Material spelling', materialCanvas.issues[0]?.fix?.op === 'U("x", { icon: "material:cloud_off" })', materialCanvas.issues[0]?.fix?.op);
}

// ── 5. nothing resolves → warning, no candidates, no fix ─────────────────────
{
  const { issues } = await iconIssues([{ id: 'n', type: 'icon', icon: 'definitely-not-an-icon' }]);
  expect('typo flagged', issues.length === 1 && issues[0].message.includes('"definitely-not-an-icon"'));
  expect('typo carries no fix', !issues[0]?.fix);
}

// ── 6. empty icon name ───────────────────────────────────────────────────────
{
  const { issues } = await iconIssues([{ id: 'e', type: 'icon' }]);
  expect('icon node without a name flagged', issues.length === 1 && issues[0].message.includes('no icon name'), JSON.stringify(issues));
}

// ── 7. icons inside component instances ──────────────────────────────────────
{
  const components: Record<string, SceneNode> = {
    btn: { id: 'btn', type: 'component', name: 'Btn', children: [{ id: 'btn-icon', type: 'icon', name: 'Glyph', icon: 'material:arrow-back' }] },
  };
  const { issues } = await iconIssues([
    { id: 'i1', type: 'instance', componentId: 'btn' },
    { id: 'i2', type: 'instance', componentId: 'btn' },
  ], components);
  expect('component icon reported once', issues.length === 1, JSON.stringify(issues));
  expect('message points at the component definition', !!issues[0]?.message.includes('component definition'));
  expect('no fix op for an id outside the canvas tree', !issues[0]?.fix);
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.ok ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
