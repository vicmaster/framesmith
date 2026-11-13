// Phase 31 slice B — the desktop-app vocabulary, without Chrome: the types
// render to the expected markup, colours default from tokens (and fall back
// unthemed), the new primitives join the web/desktop-app 24px census, identity
// dots never count as accents (FR-A6), a canvas holding a desktop-app
// primitive must declare its type (desktop-app-artboard), stress reaches the
// new copy, repeats count as reuse, the breadcrumb is built from links, and
// unthemed stamps seed $accent-tint / $border-strong. Rendered geometry lives
// in test-desktop-primitives-render.ts (Chrome).
//
// Usage: npx tsx test-desktop-primitives.ts

import './test-env.js';
import { readFileSync } from 'node:fs';
import { evaluateCanvas } from './src/evaluate.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { applyPerturbation } from './src/stress.js';
import { getStructure, applyStructure } from './src/structures.js';
import { createCanvas } from './src/scene-graph.js';
import { desktopTargets, CLICKABLE_PRIMITIVES, DESKTOP_APP_PRIMITIVES } from './src/primitives.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type Surface = { type: 'web' | 'mobile' | 'desktop-app'; device?: string };
function canvasWith(children: SceneNode[], surface?: Surface, colors?: Record<string, string>): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, createdAt: '', lastModified: '',
    variables: colors ? { colors } : {},
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, gap: 8, children },
    ...(surface ? { metadata: { surface } } : {}),
  } as Canvas;
}
const app: Surface = { type: 'desktop-app', device: 'window-1440' };
const html = (n: SceneNode, colors?: Record<string, string>) => {
  const c = canvasWith([n], app, colors);
  return renderToHtml(resolveVariables(c.root, c.variables), 1440, 900, c);
};

// ── FR-B1: button xs + ariaLabel ───────────────────────────────────────────
{
  const h = html({ id: 'b', name: 'b', type: 'button', icon: 'x', size: 'xs', ariaLabel: 'Close panel' });
  check('an icon-only xs button renders 24px with aria-label and title', /height: 24px/.test(h) && /aria-label="Close panel"/.test(h) && /title="Close panel"/.test(h));
  check('ariaLabel is never drawn as text', !/>Close panel</.test(h));
  check('xs is one target of 24×24', JSON.stringify(desktopTargets({ id: 'b', name: 'b', type: 'button', size: 'xs' } as SceneNode)) === '[]', 'buttons are phone tappables, measured by buttonBox');
}

// ── FR-B2: link, inline links, text title ──────────────────────────────────
{
  const h = html({ id: 'l', name: 'l', type: 'link', label: 'View all', external: true });
  check('a link renders at least 24 tall with role=link and its label as a title', /min-height: 24px/.test(h) && /role="link"/.test(h) && /title="View all"/.test(h));
  const t = html({ id: 't', name: 't', type: 'text', content: 'Read the guide or ask us.', links: [{ start: 9, end: 14 }, { start: 10, end: 12 }, { start: 30, end: 40 }], title: 'Help copy' });
  check('inline links underline their ranges; overlapping and out-of-range ones are dropped', (t.match(/data-fs-inline-link/g) ?? []).length === 1 && />guide</.test(t) && /Read the /.test(t) && /or ask us\.</.test(t), t.slice(t.indexOf('<p'), t.indexOf('</p>') + 4));
  check('a text node renders its title attribute', /<p[^>]*title="Help copy"/.test(t));
}

// ── FR-B3..B9: markup and defaults ─────────────────────────────────────────
{
  const nav = html({ id: 'n', name: 'n', type: 'nav-item', label: 'Projects', icon: 'folder', active: true, count: 12 });
  check('an active nav-item draws fill, bar and weight, with aria-current', /aria-current="page"/.test(nav) && /width: 2px/.test(nav) && /font-weight: 600/.test(nav) && /background-color: #EFF4FF/.test(nav));
  const rail = html({ id: 'n2', name: 'n2', type: 'nav-item', label: 'Projects', icon: 'folder', collapsed: true });
  check('a collapsed nav-item is 32×32 with its label as the accessible name', /width: 32px/.test(rail) && /aria-label="Projects"/.test(rail) && !/>Projects</.test(rail));
  const themedNav = html({ id: 'n3', name: 'n3', type: 'nav-item', label: 'A', active: true }, { 'accent-tint': '#123456', accent: '#0E7490' });
  check('nav-item reads $accent-tint and $accent when themed', /background-color: #123456/.test(themedNav) && /background-color: #0E7490/.test(themedNav));
  const tabs = html({ id: 'tb', name: 'tb', type: 'tabs', size: 'sm', items: [{ label: 'Quality', active: true }, { label: 'Design system' }, { label: 'Feedback', count: 3, disabled: true }] });
  check('tabs: one tablist, exactly the marked tab selected, 32 tall at sm', /role="tablist"/.test(tabs) && (tabs.match(/aria-selected="true"/g) ?? []).length === 1 && (tabs.match(/role="tab"/g) ?? []).length === 3 && /height: 32px/.test(tabs) && /aria-disabled="true"/.test(tabs));
  const tree = [0, 1, 2].map((d) => html({ id: `r${d}`, name: 'r', type: 'tree-row', label: 'Node', depth: d, ...(d < 2 ? { expanded: d === 0 } : {}) }));
  check('tree-rows indent 0 / 16 / 32 (padding 8 / 24 / 40)', /padding: 0 8px 0 8px/.test(tree[0]) && /padding: 0 8px 0 24px/.test(tree[1]) && /padding: 0 8px 0 40px/.test(tree[2]));
  check('a branch has aria-expanded and a chevron; a leaf has neither', /aria-expanded="true"/.test(tree[0]) && /aria-expanded="false"/.test(tree[1]) && !/aria-expanded/.test(tree[2]));
  const menu = html({ id: 'm', name: 'm', type: 'menu-row', label: 'Delete', shortcut: '⌘⌫', destructive: true, checked: false, submenu: true });
  check('menu-row: right-aligned kbd shortcut, destructive colour, check slot', /<kbd[^>]*margin-left: auto/.test(menu) && /aria-checked="false"/.test(menu) && /color: #DC2626/.test(menu));
  const prop = html({ id: 'p', name: 'p', type: 'property-row', label: 'Width', labelWidth: 80, children: [{ id: 'pv', name: 'pv', type: 'text', content: '1440' }] });
  check('property-row: an 80px label column, then its child', /width: 80px/.test(prop) && /data-node-id="pv"/.test(prop));
  const input = html({ id: 'i', name: 'i', type: 'text-input', placeholder: 'Search canvases', icon: 'search', size: 'sm' });
  check('text-input: 32 tall at sm, a textbox, placeholder shown', /height: 32px/.test(input) && /role="textbox"/.test(input) && />Search canvases</.test(input));
  const strong = html({ id: 'i2', name: 'i2', type: 'text-input', value: 'x' }, { 'border-strong': '#556677', border: '#EEEEEE' });
  const weak = html({ id: 'i3', name: 'i3', type: 'text-input', value: 'x' }, { border: '#EEEEEE' });
  check('text-input border is $border-strong when the token exists, else $border', /border: 1px solid #556677/.test(strong) && /border: 1px solid #EEEEEE/.test(weak));
  const err = html({ id: 'i4', name: 'i4', type: 'text-input', value: 'abc', error: 'Name is taken' }, { danger: '#B91C1C', 'border-strong': '#556677' });
  check('an error turns the border $danger and draws the message with an icon', /border: 1px solid #B91C1C/.test(err) && /aria-invalid="true"/.test(err) && />Name is taken</.test(err) && /<svg/.test(err));
  const multi = html({ id: 'i5', name: 'i5', type: 'text-input', rows: 3 });
  check('a three-row text-input is multi-line', /aria-multiline="true"/.test(multi) && /height: 72px/.test(multi));
  const div = html({ id: 'd', name: 'd', type: 'divider', orientation: 'vertical' });
  check('a vertical divider is 1px wide, a separator', /width: 1px/.test(div) && /role="separator"/.test(div) && /aria-orientation="vertical"/.test(div));
  for (const t of ['link', 'text-input', 'nav-item', 'tabs', 'tree-row', 'menu-row', 'property-row', 'divider']) {
    const c = canvasWith([{ id: 'x', name: 'x', type: t as SceneNode['type'], label: 'L', items: [{ label: 'A' }] } as SceneNode]);
    let ok = true;
    try { renderToHtml(c.root, 1440, 900, c); renderToHtml(resolveVariables(c.root, {}), 1440, 900, c); } catch { ok = false; }
    if (!ok) check(`${t} renders unthemed without throwing`, false);
  }
  check('every new primitive renders unthemed without throwing', true);
}

// ── Checkbox / radio / toggle take $border-strong only when it exists ──────
{
  const ctl = (colors?: Record<string, string>) => html({ id: 'cb', name: 'cb', type: 'checkbox' }, colors);
  check('an unchecked checkbox uses $border-strong when the token exists', /#556677/.test(ctl({ 'border-strong': '#556677', border: '#EEEEEE' })));
  check('…and keeps $border without it (render unchanged)', /#EEEEEE/.test(ctl({ border: '#EEEEEE' })) && !/#556677/.test(ctl({ border: '#EEEEEE' })));
}

// ── D3: the census ─────────────────────────────────────────────────────────
{
  check('the clickable set holds the eight-minus-two desktop primitives', ['link', 'text-input', 'nav-item', 'tabs', 'tree-row', 'menu-row'].every((t) => CLICKABLE_PRIMITIVES.has(t)) && !CLICKABLE_PRIMITIVES.has('divider') && !CLICKABLE_PRIMITIVES.has('property-row'));
  const usab = async (n: SceneNode, surface: Surface = app) => (await evaluateCanvas(canvasWith([n], surface), { mode: 'fast', categories: ['usability'] })).issues.filter((i) => /24px floor/.test(i.message));
  check('default desktop primitives all pass the 24px floor', (await usab({ id: 'w', name: 'w', type: 'frame', layout: 'vertical', children: [
    { id: 'a', name: 'a', type: 'link', label: 'Go' }, { id: 'b', name: 'b', type: 'text-input' }, { id: 'c', name: 'c', type: 'nav-item', label: 'N' },
    { id: 'd', name: 'd', type: 'tabs', size: 'sm', items: [{ label: 'A' }, { label: 'B' }] }, { id: 'e', name: 'e', type: 'tree-row', label: 'T', depth: 0 },
    { id: 'f', name: 'f', type: 'menu-row', label: 'M' }, { id: 'g', name: 'g', type: 'button', icon: 'x', size: 'xs', ariaLabel: 'X' },
  ] })).length === 0);
  for (const type of ['web', 'desktop-app'] as const) {
    const small = await usab({ id: 'l', name: 'l', type: 'link', label: 'Go', height: 16 }, type === 'web' ? { type } : app);
    check(`${type}: a link forced to 16px is measured (fast-mode warning)`, small.length === 1 && small[0].severity === 'warning');
  }
  const tabs = await usab({ id: 't', name: 't', type: 'tabs', height: 20, items: [{ label: 'A' }, { label: 'B', disabled: true }, { label: 'C' }] });
  check('each enabled tab is its own target; a disabled tab is not measured', tabs.length === 2, JSON.stringify(tabs.map((i) => i.message)));
  const menuOff = await usab({ id: 'm', name: 'm', type: 'menu-row', label: 'M', height: 16, disabled: true });
  check('a disabled menu-row is not measured', menuOff.length === 0);
  const inline = await usab({ id: 'tx', name: 'tx', type: 'text', content: 'See the docs', links: [{ start: 8, end: 12 }], fontSize: 12 });
  check('inline text links are exempt', inline.length === 0);
  const owned = await usab({ id: 'pr', name: 'pr', type: 'property-row', label: 'Visible', children: [{ id: 'tg', name: 'tg', type: 'checkbox' }] });
  check('a sole checkbox inside a property-row is measured by the row (passes)', owned.length === 0, JSON.stringify(owned.map((i) => i.message)));
  const two = await usab({ id: 'pr2', name: 'pr2', type: 'property-row', label: 'Flags', children: [{ id: 'f1', name: 'f1', type: 'frame', layout: 'horizontal', children: [{ id: 'c1', name: 'c1', type: 'checkbox' }, { id: 'c2', name: 'c2', type: 'checkbox' }] }] });
  check('two checkboxes in one property-row are measured bare (fast warnings)', two.length === 2);
  const phone = (await evaluateCanvas(canvasWith([{ id: 'l', name: 'l', type: 'link', label: 'Go' }], { type: 'mobile', device: 'iphone-390' }), { mode: 'fast', categories: ['usability'] })).issues;
  check('mobile: desktop primitives are not phone tappables (no touch-target finding)', !phone.some((i) => i.rule === 'mobile-touch-target'));
}

// ── FR-A6: identity dots are not accents ────────────────────────────────────
{
  const dots = ['#3B82F6', '#F59E0B', '#EC4899', '#22C55E'];
  const sidebar = (extra: SceneNode[] = []): SceneNode[] => [
    ...dots.map((d, i) => ({ id: `nv${i}`, name: `Project ${i}`, type: 'nav-item', label: `Project ${i}`, dotColor: d, count: i } as SceneNode)),
    ...extra,
  ];
  const tell = async (children: SceneNode[]) => (await evaluateCanvas(canvasWith(children, app), { mode: 'fast', categories: ['cliche'] })).issues.filter((i) => i.tell === 'accent-consistency');
  check('four nav-item identity dots do not trip accent-consistency', (await tell(sidebar())).length === 0);
  check('the same colours as literal text colours still do', (await tell(dots.map((d, i) => ({ id: `b${i}`, name: 'b', type: 'text', content: 'Go', color: d } as SceneNode)))).length === 1);
  const handDots = dots.map((d, i) => ({ id: `h${i}`, name: 'dot', type: 'ellipse', width: 8, height: 8, fill: d } as SceneNode));
  check('hand-built dots with the same colours still count', (await tell(handDots)).length === 1);
  check('a dot colour reused as a literal elsewhere still counts', (await tell(sidebar([{ id: 'x1', name: 'x', type: 'text', content: 'A', color: dots[1] }, { id: 'x2', name: 'x', type: 'text', content: 'B', color: dots[2] }, { id: 'x3', name: 'x', type: 'text', content: 'C', color: dots[3] }]))).length === 1);
}

// ── FR-C9 (slice B clauses): desktop-app primitives ask for a declaration ───
{
  const art = async (children: SceneNode[], surface?: Surface) => (await evaluateCanvas(canvasWith(children, surface), { mode: 'fast', categories: ['structure'] })).issues.filter((i) => i.rule === 'desktop-app-artboard');
  for (const t of DESKTOP_APP_PRIMITIVES) {
    const n = { id: 'p', name: 'p', type: t, label: 'L', items: [{ label: 'A' }] } as SceneNode;
    const undeclared = await art([n]);
    check(`undeclared canvas with a ${t} warns`, undeclared.length === 1 && undeclared[0].severity === 'warning');
  }
  const nav: SceneNode = { id: 'nv', name: 'Home', type: 'nav-item', label: 'Home' };
  check('declared web with a nav-item → info', (await art([nav], { type: 'web' }))[0]?.severity === 'info');
  check('declared mobile with a nav-item → warning', (await art([nav], { type: 'mobile', device: 'iphone-390' })).some((i) => i.severity === 'warning' && /declared mobile/.test(i.message)));
  check('declared desktop-app with a nav-item → silent', (await art([nav], app)).length === 0);
  check('a link, a text-input or a divider alone never asks', (await art([{ id: 'l', name: 'l', type: 'link', label: 'Go' }, { id: 'i', name: 'i', type: 'text-input' }, { id: 'd', name: 'd', type: 'divider' }])).length === 0);
  const comp = canvasWith([{ id: 'inst', name: 'inst', type: 'instance', componentId: 'side' } as SceneNode]);
  comp.components = { side: { id: 'side', name: 'Side', type: 'component', children: [{ id: 'deep', name: 'Deep', type: 'frame', children: [nav] }] } as SceneNode };
  const inInst = (await evaluateCanvas(comp, { mode: 'fast', categories: ['structure'] })).issues.filter((i) => i.rule === 'desktop-app-artboard');
  check('a nav-item inside an instance counts, reported on the instance', inInst.length === 1 && inInst[0].nodeId === 'inst', JSON.stringify(inInst.map((i) => i.nodeId)));
}

// ── FR-B10: stress copy, reuse, breadcrumb, seeding ─────────────────────────
{
  const root: SceneNode = { id: 'document', type: 'document', name: 'D', children: [
    { id: 'l', name: 'l', type: 'link', label: 'Open' },
    { id: 'n', name: 'n', type: 'nav-item', label: 'Projects' },
    { id: 't', name: 't', type: 'tabs', items: [{ label: 'Quality' }, { label: 'Feedback' }] },
    { id: 'r', name: 'r', type: 'tree-row', label: 'src', depth: 0 },
    { id: 'm', name: 'm', type: 'menu-row', label: 'Rename', shortcut: 'F2' },
    { id: 'p', name: 'p', type: 'property-row', label: 'Width', children: [] },
    { id: 'i', name: 'i', type: 'text-input', value: 'hello' },
  ] };
  const { touched } = applyPerturbation('long-text', root);
  check('long-text reaches every new primitive\'s copy', ['l', 'n', 't', 'r', 'm', 'p', 'i'].every((id) => touched.includes(id)), touched.join(', '));

  const many = canvasWith(Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, name: `n${i}`, type: 'nav-item', label: `Item ${i}` } as SceneNode)), app);
  const reuse = (await evaluateCanvas(many, { mode: 'fast', categories: ['structure'] })).issues.filter((i) => /No component instances/.test(i.message));
  check('repeated nav-items count as reuse (no "extract components" advisory)', reuse.length === 0);

  const crumb = getStructure('breadcrumb')!;
  check('the breadcrumb parent is a link; the current page stays text', crumb.nodes[0].children?.[0].type === 'link' && crumb.nodes[0].children?.[2].type === 'text');

  const c = createCanvas('seed', undefined, {}, { type: 'desktop-app', device: 'window-1440' });
  const seed = applyStructure(c, 'breadcrumb', { existingColors: new Set(), realisation: 'web' });
  check('stamping a structure with a desktop-app primitive on an unthemed canvas seeds $accent-tint and $border-strong', seed.seededColors.includes('accent-tint') && seed.seededColors.includes('border-strong'), seed.seededColors.join(', '));
  check('a desktop-app primitive\'s copy is a placeholder', seed.placeholders.some((p) => p.prop === 'label' && p.role === 'Parent'));
  const m = createCanvas('mob', undefined, {}, { type: 'mobile', device: 'iphone-390' });
  const mob = applyStructure(m, 'settings', { existingColors: new Set() });
  check('a mobile stamp does not seed the desktop-app tokens', !mob.seededColors.includes('border-strong'), mob.seededColors.join(', '));
}

// ── Viewer baseline: the gallery rebuilt with nav-item dots (FR-A6) ─────────
{
  const g = JSON.parse(readFileSync('test-fixtures/viewer-baseline/gallery-pattern-library.json', 'utf-8')) as Canvas;
  const find = (n: SceneNode, id: string): SceneNode | undefined => n.id === id ? n : n.children?.map((ch) => find(ch, id)).find(Boolean);
  const sidebar = find(g.root, 'imp-frame-33')!;
  const rows = (sidebar.children ?? []).filter((r) => r.layout === 'horizontal');
  const rebuilt = rows.map((r, i) => ({ id: `nav-${i}`, name: 'Project', type: 'nav-item', label: String(r.children?.[1]?.content ?? `P${i}`), count: String(r.children?.[2]?.content ?? ''), dotColor: ['#3B82F6', '#F59E0B', '#EC4899', '#22C55E', '#14B8A6', '#A855F7', '#EF4444'][i % 7] } as SceneNode));
  const ev = await evaluateCanvas(canvasWith(rebuilt, app), { mode: 'fast', categories: ['cliche'] });
  check('the baseline sidebar rebuilt with nav-item dots does not trip accent-consistency', !ev.issues.some((i) => i.tell === 'accent-consistency'), `${rebuilt.length} rows`);
}

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
