// Phase 31 slice C — the desktop-app rules in fast mode (FR-C1 to FR-C8) and
// form coverage counting text-inputs (FR-C10). Every asserted pass has a twin
// that must fail, and every rule is shown silent on web. The detailed-mode
// clauses (the circle test on links, rendered row heights, column edges,
// short truncations, crowded tablists) live in test-desktop-app-rules-detailed.ts.
//
// Usage: npx tsx test-desktop-app-rules.ts

import './test-env.js';
import { readFileSync } from 'node:fs';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { extractInventory } from './src/drift.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type Kind = 'web' | 'desktop-app';
function canvasOf(children: SceneNode[], type: Kind = 'desktop-app', variables: Canvas['variables'] = {}): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, children },
    metadata: { surface: type === 'web' ? { type } : { type, device: 'window-1440' } },
  } as Canvas;
}
async function findings(rule: string, children: SceneNode[], type: Kind = 'desktop-app', variables: Canvas['variables'] = {}): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(canvasOf(children, type, variables), { mode: 'fast' });
  return r.issues.filter((i) => i.rule === rule);
}
const show = (f: EvaluationIssue[]) => JSON.stringify(f.map((i) => `${i.severity}: ${i.message}`));
const text = (id: string, content: string, fontSize = 14, extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'text', content, fontSize, color: '#111111', ...extra });
const frame = (id: string, children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'frame', layout: 'vertical', children, ...extra });
const nav = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id, name: id, type: 'nav-item', label: id, ...extra });

// ── FR-C1: desktop-app-target ──────────────────────────────────────────────
{
  const small = [{ id: 'x', name: 'x', type: 'button', icon: 'x', ariaLabel: 'Close', size: 'sm', width: 20, height: 20 } as SceneNode];
  const app = await evaluateCanvas(canvasOf(small), { mode: 'fast', categories: ['usability'] });
  const web = await evaluateCanvas(canvasOf(small, 'web'), { mode: 'fast', categories: ['usability'] });
  const floor = (r: typeof app) => r.issues.filter((i) => /24px floor/.test(i.message));
  check('FR-C1: an undersized target on desktop-app is rule desktop-app-target, a fast-mode warning', floor(app).length === 1 && floor(app)[0].rule === 'desktop-app-target' && floor(app)[0].severity === 'warning', show(floor(app)));
  check('FR-C1: the same target on web keeps the unnamed floor', floor(web).length === 1 && floor(web)[0].rule === undefined, show(floor(web)));

  // The census now knows an unlabelled link's width (it hugs its glyph).
  const back = (extra: Partial<SceneNode>): SceneNode => ({ id: 'back', name: 'Back', type: 'link', icon: 'arrow-left', ...extra });
  let f = await findings('desktop-app-target', [back({ label: '← Back' })]);
  check('FR-C1: a labelled "← Back" link is no undersized target', f.length === 0, show(f));
  f = await findings('desktop-app-target', [back({})]);
  check('FR-C1: an icon-only link (14px wide) is an undersized target in fast mode', f.length === 1 && /14×24px/.test(f[0].message), show(f));
  f = await findings('desktop-app-target', [back({ external: true })]);
  check('FR-C1: an icon-only external link measures both glyphs (30px) and passes', f.length === 0, show(f));
}

// ── FR-C2: desktop-app-handbuilt-target ────────────────────────────────────
{
  const iconFrame = (id: string, size: number, extra: Partial<SceneNode> = {}): SceneNode =>
    frame(id, [{ id: `${id}-i`, name: 'i', type: 'icon', icon: 'settings', iconSize: 16 }], { width: size, height: size, ...extra });
  let f = await findings('desktop-app-handbuilt-target', [iconFrame('gear', 24)]);
  check('FR-C2: a 24px icon frame is named as a possible click target (info)', f.length === 1 && f[0].severity === 'info' && /button/.test(f[0].suggestion ?? ''), show(f));
  f = await findings('desktop-app-handbuilt-target', [iconFrame('gear', 32)]);
  check('FR-C2: the same frame at 32px is silent', f.length === 0, show(f));
  f = await findings('desktop-app-handbuilt-target', [frame('row', [iconFrame('gear', 24)], { type: 'property-row', label: 'Gear' } as Partial<SceneNode>)]);
  check('FR-C2: a frame inside a property-row (a clickable primitive\'s slot) is never hand-built', f.length === 0, show(f));
  f = await findings('desktop-app-handbuilt-target', [frame('back', [{ id: 'bi', name: 'bi', type: 'icon', icon: 'arrow-left', iconSize: 14 }, text('bt', 'Back', 13)], { layout: 'horizontal', padding: [4, 6] })]);
  check('FR-C2: an icon plus a short label, height estimated from its line box (~24px), is named as a link', f.length === 1 && /link/.test(f[0].suggestion ?? ''), show(f));
  f = await findings('desktop-app-handbuilt-target', [frame('back', [{ id: 'bi', name: 'bi', type: 'icon', icon: 'arrow-left', iconSize: 14 }, text('bt', 'Go back to the gallery page', 13)], { layout: 'horizontal', padding: [4, 6] })]);
  check('FR-C2: an icon with a five-word label is not click-shaped', f.length === 0, show(f));

  // Spec change S2 — the bordered text button an import produces.
  const textButton = (extra: Partial<SceneNode>) => frame('archive', [text('at', 'Archive', 13)], { padding: [6, 14], ...extra });
  f = await findings('desktop-app-handbuilt-target', [textButton({ stroke: '#D1D5DB' })]);
  check('S2: a bordered, padded frame with one short label (~28px) is named as a button', f.length === 1 && /×28px/.test(f[0].message) && /button/.test(f[0].suggestion ?? ''), show(f));
  f = await findings('desktop-app-handbuilt-target', [textButton({ fill: '#F3F4F6' })]);
  check('S2: the same frame with a fill and no border (a chip) is silent', f.length === 0, show(f));
  f = await findings('desktop-app-handbuilt-target', [textButton({ stroke: 'transparent' })]);
  check('S2: a transparent stroke is no border', f.length === 0, show(f));
  f = await findings('desktop-app-handbuilt-target', [textButton({ stroke: '#D1D5DB', padding: 0 })]);
  check('S2: an unpadded bordered label is not button-shaped', f.length === 0, show(f));
  f = await findings('desktop-app-handbuilt-target', [textButton({ stroke: '#D1D5DB', padding: [10, 14] })]);
  check('S2: a bordered text button 36px tall is silent', f.length === 0, show(f));

  const fixture = JSON.parse(readFileSync('test-fixtures/viewer-baseline/detail-web-dashboard.json', 'utf8')) as Canvas;
  fixture.metadata = { ...(fixture.metadata ?? {}), surface: { type: 'desktop-app', device: 'window-1440' } };
  const r = await evaluateCanvas(fixture, { mode: 'fast', categories: ['usability'] });
  const named = r.issues.filter((i) => i.rule === 'desktop-app-handbuilt-target');
  const byId = new Map<string, SceneNode>();
  (function walk(n: SceneNode) { byId.set(n.id, n); n.children?.forEach(walk); })(fixture.root);
  const labels = named.map((i) => byId.get(i.nodeId)?.children?.[0]?.content);
  const toolbar = ['Mobile', 'Tablet', 'Desktop', 'Compare', 'Fit', 'JSON', 'Comment', 'Archive', 'Delete'];
  check('FR-C2: the baseline detail fixture reports its hand-built toolbar as infos', toolbar.every((l) => labels.includes(l)) && named.every((i) => i.severity === 'info'), JSON.stringify(labels));
  const web = await findings('desktop-app-handbuilt-target', [iconFrame('gear', 24)], 'web');
  check('FR-C2: silent on web', web.length === 0, show(web));
}

// ── FR-C3: desktop-app-icon-label ──────────────────────────────────────────
{
  const iconBtn = (extra: Partial<SceneNode> = {}): SceneNode => ({ id: 'b', name: 'b', type: 'button', icon: 'trash-2', size: 'xs', variant: 'ghost', ...extra });
  let f = await findings('desktop-app-icon-label', [iconBtn()]);
  check('FR-C3: an icon-only button without ariaLabel warns', f.length === 1 && f[0].severity === 'warning', show(f));
  f = await findings('desktop-app-icon-label', [iconBtn({ ariaLabel: 'Delete' })]);
  check('FR-C3: adding ariaLabel clears it', f.length === 0, show(f));
  f = await findings('desktop-app-icon-label', [iconBtn({ label: 'Delete' })]);
  check('FR-C3: a labelled button with an icon is not icon-only', f.length === 0, show(f));
  f = await findings('desktop-app-icon-label', [nav('n', { collapsed: true, label: '', icon: 'home', active: true })]);
  check('FR-C3: a collapsed nav-item with a blank label warns', f.length === 1, show(f));
  f = await findings('desktop-app-icon-label', [nav('n', { collapsed: true, label: 'Home', icon: 'home', active: true })]);
  check('FR-C3: a collapsed nav-item with a label passes', f.length === 0, show(f));
  f = await findings('desktop-app-icon-label', [iconBtn()], 'web');
  check('FR-C3: silent on web', f.length === 0, show(f));
}

// ── FR-C4: desktop-app-current ─────────────────────────────────────────────
{
  const sidebar = (items: SceneNode[], extra: Partial<SceneNode> = {}) => frame('sidebar', items, { width: 240, overflow: 'auto', ...extra });
  let f = await findings('desktop-app-current', [sidebar([nav('a', { active: true }), nav('b', { active: true }), nav('c')])]);
  check('FR-C4: a sidebar with two active items warns', f.length === 1 && f[0].severity === 'warning' && /ambiguous/.test(f[0].message), show(f));
  f = await findings('desktop-app-current', [sidebar([nav('a'), nav('b'), nav('c')])]);
  check('FR-C4: a sidebar with none warns', f.length === 1 && /None of the 3/.test(f[0].message), show(f));
  f = await findings('desktop-app-current', [sidebar([frame('s1', [nav('a', { active: true }), nav('b')]), frame('s2', [nav('c'), nav('d')])])]);
  check('FR-C4: a sectioned sidebar with one active item in one section passes', f.length === 0, show(f));
  f = await findings('desktop-app-current', [sidebar([frame('s1', [nav('a', { active: true })]), frame('s2', [nav('c', { active: true })])])]);
  check('FR-C4: one active item in EACH section of one pane warns (one group per pane)', f.length === 1, show(f));
  f = await findings('desktop-app-current', [sidebar([nav('a', { active: true }), nav('a1', { depth: 1, active: true }), nav('b')])]);
  check('FR-C4: an active parent over its active child passes', f.length === 0, show(f));
  f = await findings('desktop-app-current', [sidebar([nav('a'), nav('a1', { depth: 1, active: true }), nav('a2', { depth: 1, active: true })])]);
  check('FR-C4: two active children warn', f.length === 1, show(f));
  f = await findings('desktop-app-current', [sidebar([nav('a', { active: true })]), frame('other', [nav('x', { active: true }), nav('y')], { overflow: 'auto' })]);
  check('FR-C4: two panes, each with one active item, pass', f.length === 0, show(f));
  f = await findings('desktop-app-current', [sidebar([nav('a', { active: true }), nav('b')]), nav('settings')]);
  check('FR-C4: a lone item in another pane is not a group', f.length === 0, show(f));

  const tabs = (active: boolean[]): SceneNode => ({ id: 't', name: 'Inspector tabs', type: 'tabs', items: active.map((a, i) => ({ label: `Tab ${i + 1}`, active: a })) });
  f = await findings('desktop-app-current', [tabs([false, true, false])]);
  check('FR-C4: tabs with exactly one active tab pass', f.length === 0, show(f));
  f = await findings('desktop-app-current', [tabs([false, false, false])]);
  check('FR-C4: tabs with no active tab warn', f.length === 1, show(f));
  f = await findings('desktop-app-current', [tabs([true, true, false])]);
  check('FR-C4: tabs with two active tabs warn', f.length === 1, show(f));

  const row = (id: string, depth: number, active = false): SceneNode => ({ id, name: id, type: 'tree-row', label: id, depth, active });
  f = await findings('desktop-app-current', [frame('tree', [row('r1', 0, true), row('r2', 1), row('r3', 1, true)])]);
  check('FR-C4: two active rows in one tree warn', f.some((i) => i.severity === 'warning'), show(f));
  f = await findings('desktop-app-current', [frame('tree', [row('r1', 0), row('r2', 1, true), row('r3', 1)])]);
  check('FR-C4: one active row in a two-level tree passes', f.length === 0, show(f));
  f = await findings('desktop-app-current', [frame('tree', [row('r1', 0), row('r2', 1), row('r3', 2, true)])]);
  check('FR-C4: a current row in a tree nesting three levels is an info', f.length === 1 && f[0].severity === 'info', show(f));
  f = await findings('desktop-app-current', [frame('tree', [row('r1', 0), row('r2', 1), row('r3', 2)])]);
  check('FR-C4: the same tree with no current row is silent (a file tree, not navigation)', f.length === 0, show(f));
  f = await findings('desktop-app-current', [sidebar([nav('a', { active: true }), nav('b', { active: true })])], 'web');
  check('FR-C4: silent on web', f.length === 0, show(f));
}

// ── FR-C5: desktop-app-type-ladder ─────────────────────────────────────────
{
  const sizes = (...px: number[]) => px.map((s, i) => text(`t${i}`, 'Label', s));
  let f = await findings('desktop-app-type-ladder', sizes(12, 13, 14));
  check('FR-C5: 12/13/14 passes', f.length === 0, show(f));
  f = await findings('desktop-app-type-ladder', sizes(14, 32));
  check('FR-C5: 14→32 passes (2.29)', f.length === 0, show(f));
  f = await findings('desktop-app-type-ladder', sizes(13, 36));
  check('FR-C5: 13→36 warns (2.77)', f.length === 1 && /2\.77/.test(f[0].message), show(f));
  f = await findings('desktop-app-type-ladder', sizes(20, 21));
  check('FR-C5: 20→21 warns (above 16px, a step needs 1.1)', f.length === 1, show(f));
  f = await findings('desktop-app-type-ladder', sizes(16, 20));
  check('FR-C5: 16→20 passes (a 4px step from 16)', f.length === 0, show(f));
  f = await findings('desktop-app-type-ladder', sizes(13, 36), 'desktop-app', { typography: { a: { fontSize: 13 }, b: { fontSize: 36 } } } as Canvas['variables']);
  check('FR-C5: a pinned pair is not judged', f.length === 0, show(f));
  f = await findings('desktop-app-type-ladder', [text('t', 'Tag', 10), text('u', 'Body', 14)]);
  check('FR-C5: a 10px label warns', f.some((i) => /10px — below the 11px/.test(i.message)), show(f));
  f = await findings('desktop-app-type-ladder', [text('t', 'Tag', 11), text('u', 'Body', 14)]);
  check('FR-C5: an 11px label passes', f.length === 0, show(f));
  f = await findings('desktop-app-type-ladder', [text('t', 'This hint sets five words', 11), text('u', 'Body', 14)]);
  check('FR-C5: five words at 11px warn', f.length === 1 && /prose below 12px/.test(f[0].message), show(f));
  f = await findings('desktop-app-type-ladder', [text('t', 'This hint sets five words', 12), text('u', 'Body', 14)]);
  check('FR-C5: five words at 12px pass', f.length === 0, show(f));
  const bodyVars = (size: number) => ({ typography: { body: { fontSize: size } } }) as Canvas['variables'];
  f = await findings('desktop-app-type-ladder', [text('t', 'Body', '$body' as unknown as number)], 'desktop-app', bodyVars(12));
  check('FR-C5: the body role at 12px warns', f.length === 1 && /body role at 12px/.test(f[0].message), show(f));
  f = await findings('desktop-app-type-ladder', [text('t', 'Body', '$body' as unknown as number)], 'desktop-app', bodyVars(13));
  check('FR-C5: the body role at 13px passes', f.length === 0, show(f));
  f = await findings('desktop-app-type-ladder', [...sizes(13, 36), text('x', 'Tag', 10)], 'web');
  check('FR-C5: silent on web (web keeps type-scale-ratio)', f.length === 0, show(f));
}

// ── FR-C6: desktop-app-row-rhythm (fast: authored heights) ─────────────────
{
  const cell = (id: string, content: string) => text(id, content, 13);
  const row = (id: string, h: number | undefined, cells: SceneNode[]) => frame(id, cells, { layout: 'horizontal', ...(h === undefined ? {} : { height: h }) });
  const table = (headerH: number | undefined, bodyHs: (number | undefined)[]) => frame('users', [
    row('head', headerH, [cell('h1', 'Name'), cell('h2', 'Role'), cell('h3', 'Status')]),
    ...bodyHs.map((h, i) => row(`r${i}`, h, [cell(`r${i}a`, `Ada ${i}`), cell(`r${i}b`, 'Admin'), cell(`r${i}c`, 'Active')])),
  ]);
  let f = await findings('desktop-app-row-rhythm', [table(40, [32, 32, 32])]);
  check('FR-C6: a 40px header over 32px rows warns', f.length === 1 && f[0].severity === 'warning' && /40px tall over 32px/.test(f[0].message), show(f));
  f = await findings('desktop-app-row-rhythm', [table(32, [32, 32, 32])]);
  check('FR-C6: a header matching its rows passes', f.length === 0, show(f));
  f = await findings('desktop-app-row-rhythm', [table(33, [32, 32, 32])]);
  check('FR-C6: 1px off is within tolerance', f.length === 0, show(f));
  f = await findings('desktop-app-row-rhythm', [table(32, [32, 40, 32, 32])]);
  check('FR-C6: one 40px body row among 32px rows is an info', f.length === 1 && f[0].severity === 'info' && f[0].nodeId === 'r1', show(f));
  f = await findings('desktop-app-row-rhythm', [table(undefined, [undefined, undefined, undefined])]);
  check('FR-C6: fast mode is silent on rows without authored heights', f.length === 0, show(f));
  const twoLine = (id: string, h: number) => frame(id, [frame(`${id}-who`, [cell(`${id}-t`, 'Ada Lovelace'), cell(`${id}-s`, 'ada@example.com')]), cell(`${id}-r`, 'Admin'), cell(`${id}-st`, 'Active')], { layout: 'horizontal', height: h });
  f = await findings('desktop-app-row-rhythm', [frame('users', [row('head', 32, [cell('h1', 'Name'), cell('h2', 'Role'), cell('h3', 'Status')]), row('r0', 32, [cell('a', 'Ada'), cell('b', 'Admin'), cell('c', 'Active')]), row('r1', 32, [cell('d', 'Bo'), cell('e', 'Admin'), cell('f', 'Active')]), twoLine('r2', 48), twoLine('r3', 48)])]);
  check('FR-C6: two-line rows are compared only with each other', f.length === 0, show(f));
  f = await findings('desktop-app-row-rhythm', [table(40, [32, 32, 32])], 'web');
  check('FR-C6: silent on web', f.length === 0, show(f));
}

// ── FR-C7: desktop-app-truncation (fast clauses) ───────────────────────────
{
  const cell = (id: string, content: string, extra: Partial<SceneNode> = {}) => text(id, content, 13, extra);
  const row = (id: string, cells: SceneNode[]) => frame(id, cells, { layout: 'horizontal' });
  const table = (headerExtra: Partial<SceneNode>) => frame('users', [
    row('head', [cell('h1', 'Name', headerExtra), cell('h2', 'Role'), cell('h3', 'Status')]),
    ...[0, 1, 2].map((i) => row(`r${i}`, [cell(`r${i}a`, `Ada ${i}`, { textOverflow: 'ellipsis', title: `Ada ${i}` }), cell(`r${i}b`, 'Admin'), cell(`r${i}c`, 'Active')])),
  ]);
  let f = await findings('desktop-app-truncation', [table({ textOverflow: 'ellipsis' })]);
  check('FR-C7: a truncating column header warns', f.length === 1 && f[0].severity === 'warning' && f[0].nodeId === 'h1', show(f));
  f = await findings('desktop-app-truncation', [table({})]);
  check('FR-C7: a header that does not truncate (and titled body cells) is silent', f.length === 0, show(f));
  f = await findings('desktop-app-truncation', [nav('Projects with a very long name indeed', { active: true, width: 120 })]);
  check('FR-C7: a truncating nav-item label is silent', f.length === 0, show(f));
  f = await findings('desktop-app-truncation', [cell('t', 'A long file name.png', { textOverflow: 'ellipsis', width: 80 })]);
  check('FR-C7: a hand-built ellipsis with no title is an info', f.length === 1 && f[0].severity === 'info', show(f));
  f = await findings('desktop-app-truncation', [cell('t', 'A long file name.png', { textOverflow: 'ellipsis', width: 80, title: 'A long file name.png' })]);
  check('FR-C7: the same text with a title is silent', f.length === 0, show(f));
  f = await findings('desktop-app-truncation', [table({ textOverflow: 'ellipsis' })], 'web');
  check('FR-C7: silent on web', f.length === 0, show(f));
}

// ── FR-C8: desktop-app-primary-count ───────────────────────────────────────
{
  const btn = (id: string, variant?: SceneNode['variant']): SceneNode => ({ id, name: id, type: 'button', label: id, size: 'sm', ...(variant ? { variant } : {}) });
  const toolbar = (buttons: SceneNode[]) => frame('toolbar', buttons, { layout: 'horizontal', gap: 8 });
  let f = await findings('desktop-app-primary-count', [toolbar([btn('Save', 'primary'), btn('Publish', 'primary')])]);
  check('FR-C8: two primary buttons in one toolbar are an info', f.length === 1 && f[0].severity === 'info', show(f));
  f = await findings('desktop-app-primary-count', [toolbar([btn('Save', 'primary'), btn('Cancel', 'secondary')])]);
  check('FR-C8: one primary and a secondary pass', f.length === 0, show(f));
  f = await findings('desktop-app-primary-count', [toolbar([btn('Save', 'primary'), btn('Publish')])]);
  check('FR-C8: a button with no variant renders as primary and counts', f.length === 1, show(f));
  f = await findings('desktop-app-primary-count', [frame('main', [btn('Save', 'primary')], { overflow: 'auto' }), frame('side', [btn('Apply', 'primary')], { overflow: 'auto' })]);
  check('FR-C8: one primary in each of two panes passes', f.length === 0, show(f));
  const card = (i: number) => frame('Card', [text(`ct${i}`, `Plan ${i}`), btn(`Choose ${i}`, 'primary')], { width: 200 });
  f = await findings('desktop-app-primary-count', [frame('grid', [1, 2, 3, 4, 5, 6].map(card), { layout: 'horizontal' })]);
  check('FR-C8: a grid of six same-shaped cards, each with a primary, passes', f.length === 0, show(f));
  f = await findings('desktop-app-primary-count', [frame('grid', [1, 2].map(card), { layout: 'horizontal' })]);
  check('FR-C8: two such cards are not a repeat (fewer than three) and count', f.length === 1, show(f));
  f = await findings('desktop-app-primary-count', [toolbar([btn('Save', 'primary'), { ...btn('Publish', 'primary'), disabled: true }])]);
  check('FR-C8: a disabled primary does not count', f.length === 0, show(f));
  f = await findings('desktop-app-primary-count', [toolbar([btn('Save', 'primary'), btn('Publish', 'primary')])], 'web');
  check('FR-C8: silent on web', f.length === 0, show(f));
}

// ── FR-C10: form coverage counts text-inputs ───────────────────────────────
{
  const input = (id: string): SceneNode => ({ id, name: id, type: 'text-input', placeholder: id });
  const coverage = async (children: SceneNode[], states: string[] = []) =>
    (await evaluateCanvas(canvasOf(children), { mode: 'fast', categories: ['coverage'], designedStates: states })).issues.filter((i) => i.category === 'coverage');
  let f = await coverage([input('a'), input('b'), input('c')]);
  check('FR-C10: three text-inputs demand an error variant', f.length === 1 && /"error"/.test(f[0].message), show(f));
  f = await coverage([input('a'), input('b'), { id: 'cb', name: 'cb', type: 'checkbox' }]);
  check('FR-C10: two text-inputs and a checkbox demand one too', f.length === 1, show(f));
  f = await coverage([input('a'), input('b')]);
  check('FR-C10: two text-inputs alone demand nothing', f.length === 0, show(f));
  f = await coverage([input('a'), input('b'), input('c')], ['error']);
  check('FR-C10: the same form with an error variant is silent', f.length === 0, show(f));
  const web = (await evaluateCanvas(canvasOf([input('a'), input('b'), input('c')], 'web'), { mode: 'fast', categories: ['coverage'] })).issues;
  check('FR-C10: counts on every type (web too)', web.length === 1, show(web));
  check('FR-C10: drift\'s inventory still counts no text-input as a control', extractInventory(canvasOf([input('a'), input('b'), input('c')]).root).counts.controls === 0);
}

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
