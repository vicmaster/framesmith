// Phase 31 slice C — the desktop-app rules' detailed-mode clauses, on rendered
// rects: the 24px circle test on icon-only links (FR-C1), rendered row heights
// and column edges (FR-C6), short truncations and crowded tablists (FR-C7).
// Each detailed finding has a fast-mode twin that must stay silent, and each
// pass a failing twin. Needs Chrome.
//
// Usage: npx tsx test-desktop-app-rules-detailed.ts

import './test-env.js';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { shutdown } from './src/screenshot.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function canvasOf(children: SceneNode[]): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables: {}, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 40, gap: 16, alignItems: 'flex-start', children },
    metadata: { surface: { type: 'desktop-app', device: 'window-1440' } },
  } as Canvas;
}
async function findings(rule: string, children: SceneNode[], mode: 'fast' | 'detailed' = 'detailed'): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(canvasOf(children), { mode });
  return r.issues.filter((i) => i.rule === rule);
}
const show = (f: EvaluationIssue[]) => JSON.stringify(f.map((i) => `${i.severity}: ${i.message}`));
const text = (id: string, content: string, extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'text', content, fontSize: 13, color: '#111111', ...extra });
const frame = (id: string, children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'frame', layout: 'vertical', children, ...extra });

// ── FR-C1: icon-only links and the 24px circle ─────────────────────────────
{
  const link = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id, name: id, type: 'link', icon: 'arrow-left', ...extra });
  const row = (gap: number, children: SceneNode[]) => frame('bar', children, { layout: 'horizontal', alignItems: 'center', gap });
  let f = await findings('desktop-app-target', [row(16, [link('back'), link('fwd', { icon: 'arrow-right' })])]);
  check('FR-C1: a 14px "← Back" link with no other target inside its circle passes', f.length === 0, show(f));
  f = await findings('desktop-app-target', [row(0, [link('back'), link('fwd', { icon: 'arrow-right' })])]);
  check('FR-C1: packed against a neighbouring link it fails, as errors naming the circle', f.length === 2 && f.every((i) => i.severity === 'error' && /24px circle/.test(i.message)), show(f));
  f = await findings('desktop-app-target', [row(0, [link('back', { label: 'Back' }), link('fwd', { label: 'Forward' })])]);
  check('FR-C1: labelled links are no undersized targets, packed or not', f.length === 0, show(f));
}

// ── FR-C6: rendered row heights and column edges ───────────────────────────
{
  const cell = (id: string, content: string, w: number) => text(id, content, { width: w });
  const row = (id: string, pad: number, widths: number[], cells: string[]) =>
    frame(id, cells.map((c, i) => cell(`${id}-${i}`, c, widths[i])), { layout: 'horizontal', padding: [pad, 12] });
  const table = (headerPad: number, firstWidth: (i: number) => number) => frame('users', [
    row('head', headerPad, [120, 120, 120], ['Name', 'Role', 'Status']),
    ...[0, 1, 2, 3].map((i) => row(`r${i}`, 8, [firstWidth(i), 120, 120], [`Ada ${i}`, 'Admin', 'Active'])),
  ]);
  let f = await findings('desktop-app-row-rhythm', [table(14, () => 120)]);
  check('FR-C6: a taller rendered header (no authored heights) warns in detailed mode', f.length === 1 && f[0].severity === 'warning', show(f));
  f = await findings('desktop-app-row-rhythm', [table(14, () => 120)], 'fast');
  check('FR-C6: fast mode, which reads authored heights only, is silent on it', f.length === 0, show(f));
  f = await findings('desktop-app-row-rhythm', [table(8, (i) => (i === 2 ? 123 : 120))]);
  check('FR-C6: one cell 3px off its column is an info in detailed mode', f.length === 1 && f[0].severity === 'info' && /3px off/.test(f[0].message), show(f));
  f = await findings('desktop-app-row-rhythm', [table(8, (i) => (i === 2 ? 123 : 120))], 'fast');
  check('FR-C6: the same table is silent in fast mode', f.length === 0, show(f));
  f = await findings('desktop-app-row-rhythm', [table(8, () => 120)]);
  check('FR-C6: an aligned table with a matching header is silent', f.length === 0, show(f));
}

// ── FR-C7: short truncations and crowded tablists ──────────────────────────
{
  const shortish = (r: EvaluationIssue[]) => r.filter((i) => /visible character|fewer than 4/.test(i.message));
  const cut = (w: number) => text('file', 'Quarterly report final.pdf', { textOverflow: 'ellipsis', title: 'Quarterly report final.pdf', width: w });
  let f = await findings('desktop-app-truncation', [cut(28)]);
  check('FR-C7: an ellipsis leaving under 4 characters is an info in detailed mode', shortish(f).length === 1 && shortish(f)[0].severity === 'info', show(f));
  f = await findings('desktop-app-truncation', [cut(28)], 'fast');
  check('FR-C7: fast mode cannot see it', shortish(f).length === 0, show(f));
  f = await findings('desktop-app-truncation', [cut(120)]);
  check('FR-C7: an ellipsis leaving a readable label is silent', shortish(f).length === 0, show(f));

  const navItem = (w: number): SceneNode => ({ id: 'nav', name: 'nav', type: 'nav-item', label: 'Quarterly planning', icon: 'folder', active: true, width: w });
  f = await findings('desktop-app-truncation', [navItem(60)]);
  check('FR-C7: a primitive label cut to under 4 characters is an info', shortish(f).length === 1, show(f));
  f = await findings('desktop-app-truncation', [navItem(240)]);
  check('FR-C7: the same nav-item with room is silent', f.length === 0, show(f));

  const tabs = (labels: string[], width: number): SceneNode => ({ id: 'tabs', name: 'Inspector tabs', type: 'tabs', width, items: labels.map((label, i) => ({ label, active: i === 0 })) });
  const eight = ['Overview', 'Spacing', 'Typography', 'Color', 'Structure', 'Consistency', 'Coverage', 'Usability'];
  f = await findings('desktop-app-truncation', [tabs(eight, 220)]);
  check('FR-C7: eight tabs in a 220px tablist warn in detailed mode', f.some((i) => i.severity === 'warning' && /Every tab label/.test(i.message)), show(f));
  f = await findings('desktop-app-truncation', [tabs(eight, 220)], 'fast');
  check('FR-C7: fast mode cannot see the crowded tablist', f.length === 0, show(f));
  f = await findings('desktop-app-truncation', [tabs(['Issues', 'Tokens', 'History'], 400)]);
  check('FR-C7: three tabs that fit are silent', f.length === 0, show(f));
}

// ── F8: detailed mode renders the instance-expanded tree ───────────────────
{
  const c = canvasOf([{ id: 'inst', name: 'Sidebar', type: 'instance', componentId: 'side' } as SceneNode]);
  c.components = { side: { id: 'side', name: 'Side', type: 'component', layout: 'vertical', children: [
    { id: 'side-nav', name: 'nav', type: 'nav-item', label: 'Quarterly planning', icon: 'folder', active: true, width: 60 },
  ] } } as Canvas['components'];
  const f = (await evaluateCanvas(c, { mode: 'detailed' })).issues.filter((i) => i.rule === 'desktop-app-truncation');
  check('F8: a short truncation inside an instance is measured and reported on the instance', f.length === 1 && f[0].nodeId === 'inst' && /inside instance/.test(f[0].message), show(f));
}

await shutdown();
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
