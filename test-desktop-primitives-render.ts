// Phase 31 slice B — the desktop-app vocabulary as rendered (Chrome): sizes on
// the 24/32/40 ladder, indents, aligned shortcut and value columns, a 1px
// full-height pane divider, both themes, and long text that truncates by
// design instead of clipping or overflowing.
//
// Usage: npx tsx test-desktop-primitives-render.ts

import './test-env.js';
import { computeLayout, shutdown, type LayoutRect } from './src/screenshot.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { applyPerturbation, compareLayouts } from './src/stress.js';
import { generateDesignSystem } from './src/design-language.js';
import type { Canvas, DesignVariables, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const inspector: SceneNode[] = [
  { id: 'xs', name: 'xs', type: 'button', icon: 'x', size: 'xs', ariaLabel: 'Close' },
  { id: 'lnk', name: 'lnk', type: 'link', label: 'View all' },
  { id: 'nav', name: 'nav', type: 'nav-item', label: 'Projects', icon: 'folder', active: true, count: 12, width: 240 },
  { id: 'rail', name: 'rail', type: 'nav-item', label: 'Projects', icon: 'folder', collapsed: true },
  { id: 'tsm', name: 'tsm', type: 'tabs', size: 'sm', items: [{ label: 'Quality', active: true }, { label: 'Design system' }] },
  { id: 'tmd', name: 'tmd', type: 'tabs', items: [{ label: 'All', active: true }, { label: 'Archived', count: 3 }], variant: 'contained' },
  { id: 'tr0', name: 'tr0', type: 'tree-row', label: 'src', depth: 0, expanded: true, width: 300 },
  { id: 'tr1', name: 'tr1', type: 'tree-row', label: 'components', depth: 1, expanded: false, width: 300 },
  { id: 'tr2', name: 'tr2', type: 'tree-row', label: 'button.ts', depth: 2, width: 300 },
  { id: 'menu', name: 'menu', type: 'frame', layout: 'vertical', width: 260, children: [
    { id: 'm1', name: 'm1', type: 'menu-row', label: 'Rename', shortcut: 'F2' },
    { id: 'm2', name: 'm2', type: 'menu-row', label: 'Duplicate', shortcut: '⌘D' },
    { id: 'm3', name: 'm3', type: 'menu-row', label: 'Delete', shortcut: '⌘⌫', destructive: true },
  ] },
  { id: 'props', name: 'props', type: 'frame', layout: 'vertical', width: 320, children: [
    { id: 'p1', name: 'p1', type: 'property-row', label: 'Width', children: [{ id: 'v1', name: 'v1', type: 'text-input', value: '1440', size: 'sm' }] },
    { id: 'p2', name: 'p2', type: 'property-row', label: 'Visible', children: [{ id: 'v2', name: 'v2', type: 'toggle', checked: true }] },
    { id: 'p3', name: 'p3', type: 'property-row', label: 'Name', children: [{ id: 'v3', name: 'v3', type: 'text', content: 'Dashboard', textOverflow: 'ellipsis' }] },
  ] },
  { id: 'in-sm', name: 'in-sm', type: 'text-input', size: 'sm', placeholder: 'Search', icon: 'search', width: 240 },
  { id: 'in-md', name: 'in-md', type: 'text-input', placeholder: 'Name', width: 240 },
  { id: 'in-3', name: 'in-3', type: 'text-input', rows: 3, placeholder: 'Comment', width: 320 },
  { id: 'in-err', name: 'in-err', type: 'text-input', value: 'taken', error: 'Name is taken', width: 240 },
  { id: 'panes', name: 'panes', type: 'frame', layout: 'horizontal', height: 120, width: 600, children: [
    { id: 'left', name: 'left', type: 'frame', width: 200, height: '100%' },
    { id: 'dv', name: 'dv', type: 'divider', orientation: 'vertical' },
    { id: 'right', name: 'right', type: 'frame', width: 200, height: '100%' },
  ] },
];

function canvasOf(children: SceneNode[], variables: DesignVariables): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'D', width: 1440, height: 900, fill: '$bg-primary', layout: 'vertical', padding: 24, gap: 12, children },
    metadata: { surface: { type: 'desktop-app', device: 'window-1440' } },
  } as Canvas;
}

function index(rects: LayoutRect[]): Map<string, LayoutRect> {
  const m = new Map<string, LayoutRect>();
  const walk = (r: LayoutRect) => { m.set(r.nodeId, r); r.children?.forEach(walk); };
  rects.forEach(walk);
  return m;
}

const system = generateDesignSystem('#0E7490', 'technical', { surface: 'desktop-app' }).variables;
const themes: Array<[string, DesignVariables]> = [
  ['unthemed', {}],
  ['light', system],
  ['dark', { ...system, colors: { ...system.colors, ...system.dark?.colors } }],
];

for (const [label, vars] of themes) {
  const c = canvasOf(inspector, vars);
  const html = renderToHtml(resolveVariables(structuredClone(c.root), vars), 1440, 900, c);
  const r = index(await computeLayout(html, undefined, 25, { width: 1440, height: 900 }));
  const h = (id: string) => r.get(id)?.height;
  const w = (id: string) => r.get(id)?.width;
  check(`${label}: xs button is 24×24`, h('xs') === 24 && w('xs') === 24, `${w('xs')}×${h('xs')}`);
  check(`${label}: a link is at least 24 tall`, (h('lnk') ?? 0) >= 24, String(h('lnk')));
  check(`${label}: nav-item 32 tall; collapsed 32×32`, h('nav') === 32 && h('rail') === 32 && w('rail') === 32, `${h('nav')} ${w('rail')}×${h('rail')}`);
  check(`${label}: tabs 32 at sm, 40 at md`, h('tsm') === 32 && h('tmd') === 40, `${h('tsm')} ${h('tmd')}`);
  check(`${label}: tree-rows 32 tall`, ['tr0', 'tr1', 'tr2'].every((id) => h(id) === 32));
  check(`${label}: menu-rows 32 tall`, ['m1', 'm2', 'm3'].every((id) => h(id) === 32));
  check(`${label}: property-rows at least 32 tall`, ['p1', 'p2', 'p3'].every((id) => (h(id) ?? 0) >= 32));
  check(`${label}: every property value starts at one left edge`, new Set(['v1', 'v2', 'v3'].map((id) => r.get(id)?.x)).size === 1, ['v1', 'v2', 'v3'].map((id) => r.get(id)?.x).join(' '));
  check(`${label}: text-input 32 at sm, 40 at md, 72 at three rows`, h('in-sm') === 32 && h('in-md') === 40 && h('in-3') === 72, `${h('in-sm')} ${h('in-md')} ${h('in-3')}`);
  check(`${label}: an error adds its message below the field`, (h('in-err') ?? 0) > 40, String(h('in-err')));
  check(`${label}: the vertical divider is 1px wide and as tall as its panes`, w('dv') === 1 && h('dv') === 120, `${w('dv')}×${h('dv')}`);
}

// Shortcuts right-align to one column (checked in the rendered DOM).
{
  const c = canvasOf(inspector, system);
  const html = renderToHtml(resolveVariables(structuredClone(c.root), system), 1440, 900, c);
  const { withPage } = await import('./src/screenshot.js');
  const rights = await withPage(async (page) => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return page.$$eval('[data-node-id^="m"] kbd', (els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  });
  check('every menu shortcut right-aligns to one column', rights.length === 3 && new Set(rights).size === 1, rights.join(' '));
}

// Long text and i18n: designed truncation only, never a clip or an overflow.
for (const name of ['long-text', 'i18n'] as const) {
  const c = canvasOf(inspector, system);
  const base = resolveVariables(structuredClone(c.root), system);
  const baseline = await computeLayout(renderToHtml(base, 1440, 900, c), undefined, 25, { width: 1440, height: 900 });
  const { root, touched } = applyPerturbation(name, structuredClone(c.root));
  const pert = await computeLayout(renderToHtml(resolveVariables(root, system), 1440, 900, c), undefined, 25, { width: 1440, height: 900 });
  const findings = compareLayouts(baseline, pert, touched, 1440);
  const warnings = findings.filter((f) => f.severity === 'warning');
  check(`${name}: no clip or overflow warnings on the desktop-app primitives`, warnings.length === 0, JSON.stringify(warnings.slice(0, 4)));
  if (name === 'long-text') check(`${name}: labels report designed truncation`, findings.some((f) => f.severity === 'info'), `${findings.length} findings`);
}

await shutdown();
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
