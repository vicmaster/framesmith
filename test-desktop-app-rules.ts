// Phase 31 slice C — the desktop-app rules in fast mode (FR-C1 to FR-C8) and
// form coverage counting text-inputs (FR-C10). Every asserted pass has a twin
// that must fail, and every rule is shown silent on web. The detailed-mode
// clauses (the circle test on links, rendered row heights, column edges,
// short truncations, crowded tablists) live in test-desktop-app-rules-detailed.ts.
//
// Usage: npx tsx test-desktop-app-rules.ts

import './test-env.js';
import { readFileSync } from 'node:fs';
import { evaluateCanvas, foldIssues, type EvaluationIssue } from './src/evaluate.js';
import { linkGlyphWidth } from './src/primitives.js';
import { renderToHtml } from './src/renderer.js';
import { DESKTOP_APP_RULES } from './src/surfaces.js';
import { extractInventory } from './src/drift.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type Kind = 'web' | 'mobile' | 'desktop-app';
function canvasOf(children: SceneNode[], type: Kind = 'desktop-app', variables: Canvas['variables'] = {}): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, children },
    metadata: { surface: type === 'desktop-app' ? { type, device: 'window-1440' } : { type } },
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

// ── Round-1 fixes and the gaps the mutation pass found ─────────────────────
{
  // One tree that trips every desktop-app rule in fast mode, judged on each
  // type: every rule fires on desktop-app, in its category; none but the
  // artboard rule fires on web or mobile.
  const cells = (id: string, extra: Partial<SceneNode> = {}) => [text(`${id}a`, 'Name', 13, extra), text(`${id}b`, 'Role', 13), text(`${id}c`, 'Status', 13)];
  const everything: SceneNode[] = [
    { id: 'x', name: 'x', type: 'button', icon: 'x', size: 'sm', width: 20, height: 20 } as SceneNode,
    frame('gear', [{ id: 'gi', name: 'gi', type: 'icon', icon: 'settings', iconSize: 16 }], { width: 24, height: 24 }),
    frame('side', [nav('a', { active: true }), nav('b', { active: true })], { overflow: 'auto' }),
    text('big', 'Title', 36), text('small', 'Label', 13),
    frame('users', [frame('head', cells('h', { textOverflow: 'ellipsis' }), { layout: 'horizontal', height: 40 }), ...[0, 1, 2].map((i) => frame(`r${i}`, cells(`r${i}`), { layout: 'horizontal', height: 32 }))]),
    frame('bar', [{ id: 'p1', name: 'p1', type: 'button', label: 'Save', variant: 'primary' }, { id: 'p2', name: 'p2', type: 'button', label: 'Publish', variant: 'primary' }], { layout: 'horizontal' }),
  ];
  const expected: Record<string, string> = {
    'desktop-app-target': 'usability', 'desktop-app-handbuilt-target': 'usability', 'desktop-app-icon-label': 'usability',
    'desktop-app-current': 'usability', 'desktop-app-type-ladder': 'typography', 'desktop-app-row-rhythm': 'consistency',
    'desktop-app-truncation': 'usability', 'desktop-app-primary-count': 'structure',
  };
  check('the combined tree covers every registered desktop-app rule', JSON.stringify(Object.keys(expected).sort()) === JSON.stringify([...DESKTOP_APP_RULES].sort()));
  const app = (await evaluateCanvas(canvasOf(everything), { mode: 'fast' })).issues;
  for (const [rule, category] of Object.entries(expected)) {
    const f = app.filter((i) => i.rule === rule);
    check(`F9: ${rule} fires on desktop-app, under ${category}`, f.length > 0 && f.every((i) => i.category === category), show(f));
  }
  for (const type of ['web', 'mobile'] as const) {
    const r = (await evaluateCanvas(canvasOf(everything, type), { mode: 'fast' })).issues;
    const leaked = r.filter((i) => i.rule?.startsWith('desktop-app-') && i.rule !== 'desktop-app-artboard');
    check(`${type} runs none of the desktop-app rules but the artboard`, leaked.length === 0, show(leaked));
  }
}
{
  // Severities the first round left unasserted.
  const sev = async (rule: string, children: SceneNode[]) => (await findings(rule, children)).map((i) => i.severity);
  check('FR-C5: a ladder pair is a warning', JSON.stringify(await sev('desktop-app-type-ladder', [text('a', 'A', 13), text('b', 'B', 36)])) === '["warning"]');
  check('FR-C5: the 11px floor is a warning', JSON.stringify(await sev('desktop-app-type-ladder', [text('a', 'Tag', 10), text('b', 'Body', 12)])) === '["warning"]');
  check('FR-C4: none active is a warning', JSON.stringify(await sev('desktop-app-current', [frame('s', [nav('a'), nav('b')], { overflow: 'auto' })])) === '["warning"]');
  check('FR-C4: tabs with none active is a warning', JSON.stringify(await sev('desktop-app-current', [{ id: 't', name: 't', type: 'tabs', items: [{ label: 'A' }, { label: 'B' }] } as SceneNode])) === '["warning"]');
  check('FR-C3: a nameless collapsed nav-item is a warning', JSON.stringify(await sev('desktop-app-icon-label', [nav('n', { collapsed: true, label: '', icon: 'home', active: true })])) === '["warning"]');
}
{
  // FR-C2 boundaries, and the fast-mode estimate fixes (round 1).
  const iconFrame = (size: number, extra: Partial<SceneNode> = {}) => frame('f', [{ id: 'fi', name: 'fi', type: 'icon', icon: 'settings', iconSize: 16 }], { width: size, height: size, ...extra });
  const hb = (children: SceneNode[]) => findings('desktop-app-handbuilt-target', children);
  check('FR-C2: a 31px icon frame is named', (await hb([iconFrame(31)])).length === 1);
  const labelled = (words: string) => frame('f', [{ id: 'fi', name: 'fi', type: 'icon', icon: 'x', iconSize: 14 }, text('ft', words, 13)], { layout: 'horizontal', height: 24 });
  check('FR-C2: an icon with a three-word label is named', (await hb([labelled('Open the file')])).length === 1);
  check('FR-C2: an icon with a four-word label is not', (await hb([labelled('Open the file now')])).length === 0);
  const bordered = (extra: Partial<SceneNode>) => frame('f', [text('ft', 'Archive', 13)], { padding: [6, 14], stroke: '#D1D5DB', ...extra });
  check('S2: strokeWidth 0 is no border', (await hb([bordered({ strokeWidth: 0 })])).length === 0);
  check('S2: stroke "none" is no border', (await hb([bordered({ stroke: 'none' })])).length === 0);
  check('FR-C2: minWidth/minHeight 32 lift an unsized icon frame out of range', (await hb([frame('f', [{ id: 'fi', name: 'fi', type: 'icon', icon: 'x', iconSize: 16 }], { minWidth: 32, minHeight: 32 })])).length === 0);
  check('FR-C2: minHeight alone leaves a 16px-wide icon frame named', (await hb([frame('f', [{ id: 'fi', name: 'fi', type: 'icon', icon: 'x', iconSize: 16 }], { minHeight: 32 })])).length === 1);
  const stacked = (iconSize: number, font: number, padding: number) => frame('f', [{ id: 'fi', name: 'fi', type: 'icon', icon: 'house', iconSize }, text('ft', 'Home', font)], { layout: 'vertical', padding });
  check('FR-C2: a stacked icon and caption add up (20 + 13 + 8 = 41px, silent)', (await hb([stacked(20, 11, 4)])).length === 0);
  check('FR-C2: a small stacked icon and caption still count (12 + 12 + 4 = 28px, named)', (await hb([stacked(12, 10, 2)])).length === 1);
}
{
  // FR-C3 and S3: an icon-only link needs a name too.
  const link = (extra: Partial<SceneNode>): SceneNode => ({ id: 'l', name: 'l', type: 'link', icon: 'arrow-left', ...extra });
  let f = await findings('desktop-app-icon-label', [link({})]);
  check('S3: an icon-only link without ariaLabel warns', f.length === 1 && f[0].severity === 'warning' && /Icon-only link/.test(f[0].message), show(f));
  f = await findings('desktop-app-icon-label', [link({ ariaLabel: 'Back' })]);
  check('S3: an ariaLabel clears it', f.length === 0, show(f));
  f = await findings('desktop-app-icon-label', [link({ label: 'Back' })]);
  check('S3: a labelled link is not icon-only', f.length === 0, show(f));
  const c = canvasOf([link({ ariaLabel: 'Back' })]);
  const html = renderToHtml(c.root, 1440, 900, c);
  check('S3: a link renders its ariaLabel as aria-label and title, never as text', /aria-label="Back" title="Back"/.test(html) && !/>Back</.test(html));
  f = await findings('desktop-app-icon-label', [{ id: 'b', name: 'b', type: 'button', size: 'xs' } as SceneNode]);
  check('FR-C3: a button with neither label nor icon is not icon-only', f.length === 0, show(f));
  const ten = (await evaluateCanvas(canvasOf(Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, name: `b${i}`, type: 'button', icon: 'trash-2', size: 'sm', variant: 'ghost' } as SceneNode))), { mode: 'fast', categories: ['usability'] })).issues;
  const folded = foldIssues(ten).filter((i) => i.rule === 'desktop-app-icon-label');
  check('round 1: ten nameless icon buttons fold into one entry', folded.length === 1 && folded[0].count === 10, show(folded));
}
{
  // F1: the glyph width, and a non-numeric width staying unknown (round 1).
  check('F1: linkGlyphWidth is 14 / 12 / 30 / 0', [linkGlyphWidth({ id: 'a', type: 'link', icon: 'x' }), linkGlyphWidth({ id: 'b', type: 'link', external: true }), linkGlyphWidth({ id: 'c', type: 'link', icon: 'x', external: true }), linkGlyphWidth({ id: 'd', type: 'link' })].join() === '14,12,30,0');
  let f = await findings('desktop-app-target', [frame('w', [{ id: 'l', name: 'l', type: 'link', icon: 'arrow-left', width: 'fill_container' } as SceneNode], { width: 300 })]);
  check('F1: an icon-only link with a fluid width is not measured at its glyph', f.length === 0, show(f));
  f = await findings('desktop-app-target', [{ id: 'l', name: 'l', type: 'link', icon: 'arrow-left', width: 20 } as SceneNode]);
  check('F1: a numeric 20px width still is', f.length === 1, show(f));
  f = await findings('desktop-app-target', [{ id: 'l', name: 'l', type: 'link', icon: 'arrow-left' } as SceneNode], 'web');
  check('F1: on web an icon-only link is measured too (unnamed)', (await evaluateCanvas(canvasOf([{ id: 'l', name: 'l', type: 'link', icon: 'arrow-left' } as SceneNode], 'web'), { mode: 'fast', categories: ['usability'] })).issues.some((i) => /14×24px/.test(i.message) && i.rule === undefined));
}
{
  // FR-C5 boundaries.
  const ladder = (...sizes: Array<number | string>) => findings('desktop-app-type-ladder', sizes.map((s, i) => text(`t${i}`, 'Label', s as number)));
  check('FR-C5: 16→17 passes (a 1px step from 16)', (await ladder(16, 17)).length === 0);
  check('FR-C5: 17→18 warns (above 16 a step needs 1.1)', (await ladder(17, 18)).length === 1);
  check('FR-C5: 20→22 passes (1.1)', (await ladder(20, 22)).length === 0);
  check('FR-C5: "14px" and 40 are read as sizes (2.86 warns)', (await ladder('14px', 40)).length === 1);
  const four = await findings('desktop-app-type-ladder', [text('t', 'Hint sets four words', 11), text('u', 'Body', 13)]);
  check('FR-C5: four words at 11px pass the prose floor', four.length === 0, show(four));
  const one = await findings('desktop-app-type-ladder', [text('t', 'This hint sets five words', 10), text('u', 'Body', 13)]);
  check('F3: a text tripping two floors gets one finding (the first)', one.length === 1 && /below the 11px/.test(one[0].message), show(one));
  const half = await findings('desktop-app-type-ladder', [text('a', 'A', 13), text('b', 'B', 36)], 'desktop-app', { typography: { a: { fontSize: 13 } } } as Canvas['variables']);
  check('FR-C5: pinning one size of a pair does not skip it', half.length === 1, show(half));
}
{
  // FR-C6 / FR-C7 with a select-all header (round 1), and the tolerance edge.
  const row = (id: string, h: number, cells: SceneNode[]) => frame(id, cells, { layout: 'horizontal', height: h });
  const table = (headerH: number, headerExtra: Partial<SceneNode> = {}) => frame('users', [
    row('head', headerH, [{ id: 'hc', name: 'hc', type: 'checkbox' }, text('h1', 'Name', 13, { fontWeight: 600, ...headerExtra }), text('h2', 'Role', 13, { fontWeight: 600 })]),
    ...[0, 1, 2].map((i) => row(`r${i}`, 32, [{ id: `c${i}`, name: `c${i}`, type: 'checkbox' }, text(`r${i}a`, `Ada ${i}`, 13), text(`r${i}b`, 'Admin', 13)])),
  ]);
  let f = await findings('desktop-app-row-rhythm', [table(40)]);
  check('round 1: a header with a select-all checkbox is still a header (40 over 32 warns)', f.length === 1 && f[0].severity === 'warning' && f[0].nodeId === 'head', show(f));
  f = await findings('desktop-app-row-rhythm', [table(34)]);
  check('FR-C6: 2px off warns', f.length === 1, show(f));
  f = await findings('desktop-app-truncation', [table(32, { textOverflow: 'ellipsis' })]);
  check('round 1: a truncating header beside a select-all checkbox warns', f.length === 1 && f[0].severity === 'warning', show(f));
  // Round 2: a table with NO header whose rows each lead with a row-select
  // checkbox — the first data row is styled like the rest, so it is data.
  const headerless = (firstH: number, firstExtra: Partial<SceneNode> = {}) => frame('users', [0, 1, 2].map((i) =>
    row(`r${i}`, i === 0 ? firstH : 32, [{ id: `c${i}`, name: `c${i}`, type: 'checkbox' }, text(`r${i}a`, `Ada ${i}`, 13, i === 0 ? firstExtra : {}), text(`r${i}b`, 'Admin', 13)])));
  f = await findings('desktop-app-row-rhythm', [headerless(40)]);
  check('round 2: a headerless row-select table compares its first row as a body row (info, not a header warning)', f.length === 1 && f[0].severity === 'info', show(f));
  f = await findings('desktop-app-truncation', [headerless(32, { textOverflow: 'ellipsis' })]);
  check('round 2: a truncating first data cell is no column header (info, not a warning)', f.length === 1 && f[0].severity === 'info', show(f));
}
{
  // Round 2: the stacked estimate sums only an icon and caption that are both
  // in-flow children of the frame.
  const icon20 = (): SceneNode => ({ id: 'si', name: 'si', type: 'icon', icon: 'house', iconSize: 20 });
  let f = await findings('desktop-app-handbuilt-target', [frame('f', [frame('w', [icon20(), text('st', 'Home', 11)], { layout: 'horizontal' })], { layout: 'vertical', padding: 4 })]);
  check('round 2: an icon and caption side by side in a nested row are not stacked (28px, named)', f.length === 1, show(f));
  f = await findings('desktop-app-handbuilt-target', [frame('f', [icon20(), text('st', 'Home', 11, { position: 'absolute' })], { layout: 'vertical', padding: 4 })]);
  check('round 2: an absolutely positioned caption is not stacked (28px, named)', f.length === 1, show(f));
}
{
  // Round 2: link widths that size to content, or are written in px, are known.
  const link = (width: unknown): SceneNode => ({ id: 'l', name: 'l', type: 'link', icon: 'arrow-left', width } as unknown as SceneNode);
  for (const [width, expect] of [['auto', /14×24px/], [null, /14×24px/], ['', /14×24px/], ['10px', /10×24px/]] as const) {
    const f = await findings('desktop-app-target', [link(width)]);
    check(`round 2: an icon-only link with width ${JSON.stringify(width)} is measured`, f.length === 1 && expect.test(f[0].message), show(f));
  }
  const f = await findings('desktop-app-target', [link('$link-width')]);
  check('round 2: a token width stays unknown (not measured at the glyph)', f.length === 0, show(f));
}
{
  // Round 2: S3 edges.
  const c = canvasOf([{ id: 'l', name: 'l', type: 'link', icon: 'arrow-left', ariaLabel: 'a"b<c>&d', disabled: true } as SceneNode]);
  const html = renderToHtml(c.root, 1440, 900, c);
  check('round 2: a disabled link keeps its escaped name', /aria-disabled="true"/.test(html) && html.includes('aria-label="a&quot;b&lt;c&gt;&amp;d"'), html.match(/aria-label="[^"]*"/)?.[0]);
  const f = await findings('desktop-app-icon-label', [{ id: 'l', name: 'l', type: 'link', icon: 'arrow-left', ariaLabel: '   ' } as SceneNode]);
  check('round 2: a blank ariaLabel is no name', f.length === 1, show(f));
  const tok = await findings('desktop-app-type-ladder', [text('a', 'A', '$missing' as unknown as number), text('b', 'B', 36)]);
  check('round 2: an unresolved size reads as the 14px fallback (14 → 36 warns, no crash)', tok.length === 1 && /14px → 36px/.test(tok[0].message), show(tok));
}
{
  // FR-C8 edges (round 1: a primary is whatever renders filled).
  const btn = (id: string, variant?: unknown): SceneNode => ({ id, name: id, type: 'button', label: id, size: 'sm', ...(variant === undefined ? {} : { variant: variant as SceneNode['variant'] }) });
  let f = await findings('desktop-app-primary-count', [frame('bar', [btn('A', 'outline'), btn('B', 'primary')], { layout: 'horizontal' })]);
  check('round 1: an unknown variant renders filled and counts', f.length === 1, show(f));
  f = await findings('desktop-app-primary-count', [frame('bar', [btn('A', 'destructive'), btn('B', 'primary')], { layout: 'horizontal' })]);
  check('FR-C8: a destructive button is not a primary', f.length === 0, show(f));
  const card = (i: number) => frame('Card', [text(`ct${i}`, `Plan ${i}`), btn(`Choose ${i}`, 'primary')], { width: 200 });
  f = await findings('desktop-app-primary-count', [frame('grid', [1, 2, 3].map(card), { layout: 'horizontal' })]);
  check('FR-C8: exactly three same-shaped cards are a repeat', f.length === 0, show(f));
}
{
  // FR-C10: text-inputs inside a table are its data plane.
  const row = (id: string) => frame(id, [text(`${id}t`, `Item ${id}`, 13), { id: `${id}i`, name: `${id}i`, type: 'text-input', value: 'x' } as SceneNode, text(`${id}s`, 'Open', 13)], { layout: 'horizontal' });
  const tableOnly = (await evaluateCanvas(canvasOf([frame('t', [frame('head', [text('h1', 'Item', 13), text('h2', 'Qty', 13), text('h3', 'State', 13)], { layout: 'horizontal' }), row('a'), row('b'), row('c')])]), { mode: 'fast', categories: ['coverage'] })).issues;
  check('FR-C10: text-inputs inside a table do not make a form', !tableOnly.some((i) => /"error"/.test(i.message)) && tableOnly.some((i) => /"empty"/.test(i.message)), show(tableOnly));
}

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
