// Phase 31 slice E — overlays as rendered (Chrome): the layer stacks every
// overlay above content whatever its authored parent (a sticky bar, a fixed
// bar, a scrolling or clipping pane, an animated ancestor), in the ladder's
// order whatever the tree order; nothing is clipped by its authored parent; a
// md modal is 640 wide and centred with a scrim over the viewport (FR-E2's
// acceptance through snapshot_layout's walker); the walker places overlays
// from the document root and from inside an overlay; the detailed overlap
// check skips them; a full-page capture keeps them; long copy stays inside
// the overlays; both themes.
//
// Usage: npx tsx test-overlays-render.ts

import './test-env.js';
import { computeLayout, withPage, takeScreenshot, shutdown, type LayoutRect } from './src/screenshot.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { evaluateCanvas } from './src/evaluate.js';
import { applyPerturbation, compareLayouts } from './src/stress.js';
import { generateDesignSystem } from './src/design-language.js';
import type { Canvas, DesignVariables, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function canvasOf(children: SceneNode[], variables: DesignVariables = {}, root: Partial<SceneNode> = {}): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'D', width: 1440, height: 900, fill: '$bg-primary', layout: 'vertical', children, ...root },
    metadata: { surface: { type: 'desktop-app', device: 'window-1440' } },
  } as Canvas;
}
const htmlOf = (c: Canvas, theme?: 'light' | 'dark', w = 1440, h = 900) => renderToHtml(resolveVariables(c.root, c.variables, { theme }), w, h, c);
function flat(rects: LayoutRect[], out = new Map<string, LayoutRect>()): Map<string, LayoutRect> {
  for (const r of rects) { out.set(r.nodeId, r); if (r.children) flat(r.children, out); }
  return out;
}
/** The node id of the topmost element at each point. */
async function topAt(html: string, points: Array<[number, number]>, w = 1440, h = 900): Promise<string[]> {
  return withPage(async (page) => {
    await page.setViewport({ width: w, height: h });
    await page.setContent(html, { waitUntil: 'load' });
    return page.evaluate((pts: Array<[number, number]>) => pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const owner = el?.closest('[data-node-id],[data-fs-scrim]');
      return owner?.getAttribute('data-node-id') ?? (owner?.hasAttribute('data-fs-scrim') ? `scrim:${owner.getAttribute('data-fs-scrim')}` : 'none');
    }), points);
  });
}

const tech = generateDesignSystem('#2563EB', 'technical').variables;

// ── FR-E1's acceptance: a menu inside a sticky toolbar inside a scrolling
// pane renders above a fixed sibling and is not clipped by the pane. ──────────
{
  const children: SceneNode[] = [
    { id: 'pane', name: 'pane', type: 'frame', overflow: 'auto', height: 200, width: 600, fill: '$bg-surface', children: [
      { id: 'bar', name: 'bar', type: 'frame', position: 'sticky', height: 40, layout: 'horizontal', fill: '$bg-surface', children: [
        { id: 'menu', name: 'menu', type: 'menu', x: 20, y: 150, children: [
          { id: 'r1', name: 'r1', type: 'menu-row', label: 'Rename' },
          { id: 'r2', name: 'r2', type: 'menu-row', label: 'Duplicate' },
          { id: 'r3', name: 'r3', type: 'menu-row', label: 'Delete', destructive: true },
        ] },
      ] },
      { id: 'filler', name: 'filler', type: 'frame', height: 600 },
    ] },
    { id: 'fixed', name: 'fixed', type: 'frame', position: 'fixed', x: 0, y: 140, width: 400, height: 200, fill: '#FDE68A' },
    { id: 'clip', name: 'clip', type: 'frame', overflow: 'hidden', height: 40, width: 100, animation: { name: 'slideUp' }, children: [
      { id: 'pop', name: 'pop', type: 'popover', x: 700, y: 400, children: [{ id: 'pt', name: 'pt', type: 'text', content: 'Popover body', fontSize: 14 }] },
    ] },
  ];
  for (const theme of ['light', 'dark'] as const) {
    const html = htmlOf(canvasOf(children, tech), theme);
    const rects = flat(await computeLayout(html, undefined, 25, { width: 1440, height: 900 }));
    const menu = rects.get('menu');
    check(`${theme}: the menu is placed at its root coordinates`, menu?.x === 20 && menu?.y === 150, JSON.stringify(menu && { x: menu.x, y: menu.y }));
    const r3 = rects.get('r3');
    check(`${theme}: the menu's last row extends past the 200px pane, unclipped`, !!r3 && r3.y + r3.height > 200);
    const top = await topAt(html, [[60, 170], [60, (r3?.y ?? 0) + 16], [720, 420]]);
    check(`${theme}: the menu is above the fixed sibling`, top[0] === 'r1' || top[0] === 'menu', top[0]);
    check(`${theme}: the menu's last row is hit-testable below the pane`, top[1] === 'r3', top[1]);
    check(`${theme}: a popover inside a clipping, animated frame is visible`, top[2] === 'pop' || top[2] === 'pt', top[2]);
  }
  // Twin: the same menu as a plain frame stays clipped by its pane.
  const frameTwin = htmlOf(canvasOf([{ ...children[0], children: [{ ...(children[0].children![0]), children: [{ id: 'menu', name: 'menu', type: 'frame', position: 'absolute', x: 20, y: 150, width: 192, height: 100, fill: '#FFFFFF' }] }, children[0].children![1]] }, children[1]], tech));
  const twinTop = await topAt(frameTwin, [[60, 260]]);
  check('twin: an absolute frame in the same place is clipped by the pane (the fixed bar shows)', twinTop[0] !== 'menu', twinTop[0]);
}

// ── The ladder, whatever the tree order ─────────────────────────────────────
{
  // Tree order is reversed against the ladder: tooltip first, menu last.
  const children: SceneNode[] = [
    { id: 'tip', name: 'tip', type: 'tooltip', text: 'Tooltip on top', x: 640, y: 420 },
    { id: 'toast', name: 'toast', type: 'toast', text: 'A toast over the modal', x: 600, y: 480 },
    { id: 'm', name: 'm', type: 'modal', title: 'Modal', actions: [{ label: 'OK', variant: 'primary' }], children: [{ id: 'mt', name: 'mt', type: 'text', content: 'Body', fontSize: 14 }] },
    { id: 'menu', name: 'menu', type: 'menu', x: 20, y: 20, children: [{ id: 'r1', name: 'r1', type: 'menu-row', label: 'Under the scrim' }] },
    { id: 'content', name: 'content', type: 'frame', position: 'fixed', x: 1200, y: 20, width: 200, height: 100, fill: '#FDE68A' },
  ];
  const html = htmlOf(canvasOf(children, tech));
  const rects = flat(await computeLayout(html, undefined, 25, { width: 1440, height: 900 }));
  const m = rects.get('m')!;
  const tip = rects.get('tip')!;
  const toast = rects.get('toast')!;
  const [atTip, atToast, atModal, atMenu, atContent] = await topAt(html, [
    [tip.x + 4, tip.y + 4], [toast.x + 8, toast.y + toast.height - 6], [m.x + 8, m.y + m.height - 8], [40, 30], [1300, 60],
  ]);
  check('tooltip above modal', atTip === 'tip', atTip);
  check('toast above modal', atToast === 'toast', atToast);
  check('modal above its scrim', atModal === 'm', atModal);
  check('scrim above the menu', atMenu === 'scrim:m', atMenu);
  check('scrim above fixed content', atContent === 'scrim:m', atContent);
  check('FR-E2: a md modal is 640 wide and centred', m.width === 640 && Math.abs(m.x + m.width / 2 - 720) <= 1 && Math.abs(m.y + m.height / 2 - 450) <= 1, JSON.stringify({ x: m.x, y: m.y, w: m.width, h: m.height }));
  check('FR-E2: its scrim covers the viewport', JSON.stringify(m.scrim) === JSON.stringify({ x: 0, y: 0, width: 1440, height: 900 }), JSON.stringify(m.scrim));
  check('the modal body is placed through its slot', rects.has('mt') && rects.get('mt')!.y > m.y && rects.get('mt')!.y < m.y + m.height);
  check('twin: a rect without a scrim records none', rects.get('menu')!.scrim === undefined);
  // Toast default: bottom-centre, 24 above the artboard's bottom.
  const t2 = flat(await computeLayout(htmlOf(canvasOf([{ id: 't', name: 't', type: 'toast', text: 'Saved' }], tech)), undefined, 25, { width: 1440, height: 900 })).get('t')!;
  check('toast: bottom-centre by default', Math.abs(t2.x + t2.width / 2 - 720) <= 1 && t2.y + t2.height === 876, JSON.stringify(t2));
  // Drawer: pinned right, full height.
  const d = flat(await computeLayout(htmlOf(canvasOf([{ id: 'd', name: 'd', type: 'drawer', size: 'md', scrim: true, children: [{ id: 'dt', name: 'dt', type: 'text', content: 'Filters' }] }], tech)), undefined, 25, { width: 1440, height: 900 })).get('d')!;
  check('drawer: right edge, full height, 480 wide, with its scrim', d.x === 960 && d.y === 0 && d.width === 480 && d.height === 900 && d.scrim?.width === 1440, JSON.stringify(d));
}

// ── The walker: from a node inside an overlay; with a narrower root ─────────
{
  const html = htmlOf(canvasOf([{ id: 'pop', name: 'pop', type: 'popover', x: 100, y: 100, children: [{ id: 'pt', name: 'pt', type: 'text', content: 'Inside' }] }], tech));
  const sub = await computeLayout(html, 'pop', 5, { width: 1440, height: 900 });
  check('computeLayout(rootNodeId inside the layer) walks that overlay', sub[0]?.nodeId === 'pop' && sub[0].children?.[0]?.nodeId === 'pt');
  const full = await computeLayout(html, 'document', 5, { width: 1440, height: 900 });
  check('computeLayout(the root\'s own id) still places overlays', full[0]?.children?.some((c) => c.nodeId === 'pop') === true);
  const depth0 = await computeLayout(html, undefined, 0, { width: 1440, height: 900 });
  check('twin: depth 0 places no children', !depth0[0]?.children);
  // A root narrower than the capture: root coordinates follow the root.
  const narrow = canvasOf([{ id: 'tip', name: 'tip', type: 'tooltip', text: 'x', x: 10, y: 10 }], tech, { width: 1000 });
  const rects = flat(await computeLayout(htmlOf(narrow), undefined, 5, { width: 1440, height: 900 }));
  const rootRect = rects.get('document')!;
  check('narrow root: x / y are offsets from the root\'s top-left', rects.get('tip')!.x === rootRect.x + 10 && rects.get('tip')!.y === rootRect.y + 10, JSON.stringify({ root: rootRect.x, tip: rects.get('tip')!.x }));
}

// ── Detailed evaluate: the overlap check skips overlays ─────────────────────
{
  const bar = (extra: SceneNode[]): Canvas => canvasOf([
    { id: 'bar', name: 'bar', type: 'frame', layout: 'horizontal', height: 48, gap: 8, padding: 8, children: [
      { id: 'b1', name: 'b1', type: 'button', label: 'File', variant: 'ghost', size: 'sm' },
      { id: 'b2', name: 'b2', type: 'button', label: 'Edit', variant: 'ghost', size: 'sm' },
      ...extra,
    ] },
  ], tech);
  const overlapOf = async (c: Canvas) => (await evaluateCanvas(c, { mode: 'detailed', categories: ['consistency'] })).issues.filter((i) => /overlaps with/.test(i.message));
  const withMenu = await overlapOf(bar([{ id: 'menu', name: 'menu', type: 'menu', x: 8, y: 20, children: [{ id: 'r1', name: 'r1', type: 'menu-row', label: 'Open' }] }]));
  check('a menu over its toolbar siblings is not an overlap error', withMenu.length === 0, withMenu.map((i) => i.message).join(' | '));
  const grid = await overlapOf(canvasOf([{ id: 'g', name: 'g', type: 'frame', layout: 'grid', gridColumns: 1, children: [
    { id: 'ga', name: 'ga', type: 'frame', height: 40, gridRow: '1 / 2', gridColumn: '1 / 2', fill: '#EEEEEE' },
    { id: 'gb', name: 'gb', type: 'frame', height: 40, gridRow: '1 / 2', gridColumn: '1 / 2', fill: '#DDDDDD' },
  ] }], tech));
  check('twin: two in-flow frames on one grid cell still overlap', grid.length === 1, String(grid.length));
}

// ── Full-page capture keeps the layer ───────────────────────────────────────
{
  const tall = canvasOf([
    { id: 'long', name: 'long', type: 'frame', height: 1800, fill: '$bg-surface' },
    { id: 'tip', name: 'tip', type: 'tooltip', text: 'Far down', x: 100, y: 1500 },
  ], tech, {});
  const html = htmlOf(tall);
  const shotArtboard = await takeScreenshot(html, { width: 1440, height: 900, scale: 1 });
  const shotFull = await takeScreenshot(html, { width: 1440, height: 900, scale: 1, fullPage: true });
  const pngHeight = (b64: string) => Buffer.from(b64, 'base64').readUInt32BE(20);
  check('full page grows to the content and still renders', pngHeight(shotFull) >= 1800 && pngHeight(shotArtboard) === 900, `${pngHeight(shotFull)} / ${pngHeight(shotArtboard)}`);
  const rects = flat(await computeLayout(html, undefined, 5, { width: 1440, height: 900 }));
  check('a tooltip below the artboard sits at its document y', rects.get('tip')?.y === 1500);
}

// ── Stress: long copy stays inside the overlays ─────────────────────────────
{
  const root = canvasOf([
    { id: 'm', name: 'm', type: 'modal', size: 'sm', title: 'Delete canvas?', actions: [{ label: 'Cancel' }, { label: 'Delete', variant: 'destructive' }], children: [{ id: 'mt', name: 'mt', type: 'text', content: 'This cannot be undone.', fontSize: 14 }] },
    { id: 'tip', name: 'tip', type: 'tooltip', text: 'Copy link', x: 40, y: 40 },
    { id: 'toast', name: 'toast', type: 'toast', text: 'Canvas archived', action: { label: 'Undo' } },
    { id: 'menu', name: 'menu', type: 'menu', x: 900, y: 40, children: [{ id: 'r1', name: 'r1', type: 'menu-row', label: 'Rename', shortcut: 'F2' }] },
  ], tech, {}).root;
  const resolve = (r: SceneNode) => resolveVariables(r, tech);
  const baseline = await computeLayout(renderToHtml(resolve(root), 1440, 900), undefined, 25, { width: 1440, height: 900 });
  for (const name of ['long-text', 'i18n'] as const) {
    const { root: pert, touched } = applyPerturbation(name, root, { type: 'desktop-app' });
    const after = await computeLayout(renderToHtml(resolve(pert), 1440, 900), undefined, 25, { width: 1440, height: 900 });
    const warnings = compareLayouts(baseline, after, touched, 1440).filter((f) => f.severity === 'warning');
    check(`${name}: no clip or overflow warnings on the overlays`, warnings.length === 0, JSON.stringify(warnings.slice(0, 4)));
    const r = flat(after);
    check(`${name}: the tooltip wraps within 240`, (r.get('tip')?.width ?? 999) <= 240);
    check(`${name}: the toast stays within the artboard`, (r.get('toast')?.x ?? -1) >= 0 && (r.get('toast')!.x + r.get('toast')!.width) <= 1440);
  }
}

// ── Slice I (V7): a scrolling popover and a drawer read as scrolling ────────
// The comment popover of the viewer rebuild has a fixed height and scrolls its
// body; a drawer always scrolls. Overlays build their own attributes, so they
// missed S4's data-fs-scroll marker and stress read their growth as a clip.
{
  const pop = (overflow: 'auto' | 'hidden'): SceneNode => ({
    id: 'pop', name: 'pop', type: 'popover', x: 600, y: 100, width: 320, height: 170, overflow, children: [
      { id: 'pt', name: 'pt', type: 'text', content: 'Comment on dashboard before it ships to the team', fontSize: 14 },
      { id: 'pi', name: 'pi', type: 'text-input', placeholder: 'Add a comment', rows: 3, width: '100%' },
    ],
  });
  const drawer: SceneNode = { id: 'dr', name: 'dr', type: 'drawer', children: Array.from({ length: 30 }, (_, i) => ({ id: `dl${i}`, name: `dl${i}`, type: 'text' as const, content: `Filter option number ${i + 1}`, fontSize: 14 })) };
  const warningsOn = async (children: SceneNode[], id: string) => {
    const root = canvasOf(children, tech).root;
    const resolve = (r: SceneNode) => resolveVariables(r, tech);
    const baseline = await computeLayout(renderToHtml(resolve(root), 1440, 900), undefined, 25, { width: 1440, height: 900 });
    const { root: pert, touched } = applyPerturbation('long-text', root, { type: 'desktop-app' });
    const after = await computeLayout(renderToHtml(resolve(pert), 1440, 900), undefined, 25, { width: 1440, height: 900 });
    return compareLayouts(baseline, after, touched, 1440).filter((f) => f.severity === 'warning' && f.nodeId === id);
  };
  check('a fixed-height popover with overflow auto scrolls under long-text (no clip)', (await warningsOn([pop('auto')], 'pop')).length === 0);
  const twin = await warningsOn([pop('hidden')], 'pop');
  check('twin: the same popover with overflow hidden still clips', twin.some((f) => f.kind === 'clip'), JSON.stringify(twin));
  check('a drawer scrolls its content under long-text (no clip)', (await warningsOn([drawer], 'dr')).length === 0);
  check('the drawer and a scrolling popover carry data-fs-scroll; a plain popover and a menu do not',
    /data-node-id="dr" data-fs-overlay="drawer" data-fs-scroll/.test(htmlOf(canvasOf([drawer], tech)))
    && /data-node-id="pop" data-fs-overlay="popover" data-fs-scroll/.test(htmlOf(canvasOf([pop('auto')], tech)))
    && !/data-fs-overlay="popover" data-fs-scroll/.test(htmlOf(canvasOf([pop('hidden')], tech)))
    && !/data-fs-overlay="menu" data-fs-scroll/.test(htmlOf(canvasOf([{ id: 'mn', name: 'mn', type: 'menu', x: 10, y: 10, children: [] }], tech))));
  const menuOf = (overflow: 'auto' | 'hidden'): SceneNode => ({ id: 'mn', name: 'mn', type: 'menu', x: 10, y: 10, height: 120, overflow, children: [] });
  check('a menu with overflow auto carries data-fs-scroll; one with overflow hidden does not',
    /data-node-id="mn" data-fs-overlay="menu" data-fs-scroll/.test(htmlOf(canvasOf([menuOf('auto')], tech)))
    && !/data-fs-overlay="menu" data-fs-scroll/.test(htmlOf(canvasOf([menuOf('hidden')], tech))));
  // A scroller that overflows sideways still clips, and says it is the width.
  const wideDrawer: SceneNode = { id: 'dw', name: 'dw', type: 'drawer', children: [
    { id: 'dwt', name: 'dwt', type: 'text', content: 'Filters', fontSize: 14 },
    ...Array.from({ length: 60 }, (_, i) => ({ id: `dwl${i}`, name: `dwl${i}`, type: 'text' as const, content: `Option ${i + 1}`, fontSize: 14 })),
  ] };
  const wideRoot = canvasOf([wideDrawer], tech).root;
  const resolveTech = (r: SceneNode) => resolveVariables(r, tech);
  const wideBase = await computeLayout(renderToHtml(resolveTech(wideRoot), 1440, 900), undefined, 25, { width: 1440, height: 900 });
  const widened: SceneNode = structuredClone(wideRoot);
  widened.children![0].children![0] = { id: 'dwt', name: 'dwt', type: 'frame', width: 600, minWidth: 600, height: 20 };
  const wideAfter = await computeLayout(renderToHtml(resolveTech(widened), 1440, 900), undefined, 25, { width: 1440, height: 900 });
  const sideways = compareLayouts(wideBase, wideAfter, ['dwt'], 1440).filter((f) => f.nodeId === 'dw' && f.kind === 'clip');
  check('a drawer that overflows sideways still clips, reported as width', sideways.length === 1 && sideways[0].severity === 'warning' && /\(width \d+px vs box \d+px\)/.test(sideways[0].detail), JSON.stringify(sideways));
}

// ── Round 1 fixes: neighbours and phones ────────────────────────────────────
{
  // A modal's box is never a 24px-circle neighbour (its scrim covers what is outside).
  const C = (children: SceneNode[]): Canvas => ({ ...canvasOf(children, {}, { layout: 'none', fill: '#FFFFFF' }) });
  const at = (x: number, y: number): SceneNode => ({ id: 'w', name: 'w', type: 'frame', position: 'absolute', x, y, width: 18, height: 18, children: [{ id: 'cb', name: 'cb', type: 'checkbox' }] });
  const small = async (children: SceneNode[]) => (await evaluateCanvas(C(children), { mode: 'detailed', categories: ['usability'] })).issues.filter((i) => /24px/.test(i.message));
  const m: SceneNode = { id: 'm', name: 'm', type: 'modal', title: 'T', actions: [{ label: 'OK', variant: 'primary' }], children: [{ id: 'mt', name: 'mt', type: 'text', content: 'Body' }] };
  check('a small target 11px from a modal\'s box is not blocked by it', (await small([at(382, 420), m])).length === 0);
  const toastNear = await small([at(382, 840), { id: 't', name: 't', type: 'toast', text: 'Saved', action: { label: 'Undo' }, x: 400, y: 830 }]);
  check('twin: the same target beside a toast still errors', toastNear.length === 1 && toastNear[0].severity === 'error');
  const pageNear = await small([at(382, 420), { id: 'wb', name: 'wb', type: 'frame', position: 'absolute', x: 400, y: 410, children: [{ id: 'b', name: 'b', type: 'button', label: 'Go', size: 'sm' }] }]);
  check('twin: the same target beside a page button still errors', pageNear.length === 1 && pageNear[0].severity === 'error');

  // Phones: the anchored overlays keep clear, and the safe-area rule skips them.
  const phone = (children: SceneNode[]): Canvas => ({
    ...canvasOf(children, {}, { width: 390, height: 844, safeArea: { top: 47, bottom: 34 }, fill: '#FFFFFF' }),
    metadata: { surface: { type: 'mobile', device: 'iphone-390' } },
  } as Canvas);
  const safe = async (c: Canvas, mode: 'fast' | 'detailed') => (await evaluateCanvas(c, { mode, categories: ['usability'] })).issues.filter((i) => i.rule === 'mobile-safe-area');
  const tall: SceneNode = { id: 'm', name: 'm', type: 'modal', title: 'Long', children: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `p${i}`, type: 'text', content: `Paragraph ${i} of a long modal body.`, fontSize: 16 })) };
  const tallCanvas = phone([tall]);
  check('phone: a tall centred modal raises no safe-area finding (detailed)', (await safe(tallCanvas, 'detailed')).length === 0);
  const mr = flat(await computeLayout(renderToHtml(tallCanvas.root, 390, 844, tallCanvas), undefined, 5, { width: 390, height: 844 })).get('m')!;
  check('phone: the modal stays 16px past the insets', mr.y === 63 && mr.y + mr.height === 794, JSON.stringify({ y: mr.y, bottom: mr.y + mr.height }));
  // Without a declared safeArea (or pinned chrome) the render keeps only 32px
  // clear, so the rule still judges the overlay against the device insets.
  const undeclared = { ...tallCanvas, root: { ...tallCanvas.root, safeArea: undefined } } as Canvas;
  check('phone without a safeArea: a tall modal still raises the safe-area finding', (await safe(undeclared, 'detailed')).length > 0);
  const bareDrawer = phone([{ id: 'd', name: 'd', type: 'drawer', children: [{ id: 'dt', name: 'dt', type: 'text', content: 'Filters', fontSize: 16 }] }]);
  bareDrawer.root.safeArea = undefined;
  check('phone without a safeArea: a drawer\'s content under the status bar warns', (await safe(bareDrawer, 'detailed')).some((i) => i.nodeId === 'dt'));
  const drawerCanvas = phone([{ id: 'd', name: 'd', type: 'drawer', children: [{ id: 'dt', name: 'dt', type: 'text', content: 'Filters', fontSize: 16 }] }]);
  check('phone: a drawer\'s content clears the status bar, and no safe-area finding', (await safe(drawerCanvas, 'detailed')).length === 0
    && flat(await computeLayout(renderToHtml(drawerCanvas.root, 390, 844, drawerCanvas), undefined, 5, { width: 390, height: 844 })).get('dt')!.y >= 47);
  const tabCanvas = phone([{ id: 'tab', name: 'tab', type: 'tab-bar', items: [{ icon: 'house', label: 'Home', active: true }, { icon: 'user', label: 'Me' }] }, { id: 't', name: 't', type: 'toast', text: 'Saved' }]);
  const tr = flat(await computeLayout(renderToHtml(tabCanvas.root, 390, 844, tabCanvas), undefined, 5, { width: 390, height: 844 }));
  check('phone: a default toast sits above the tab bar', tr.get('t')!.y + tr.get('t')!.height <= tr.get('tab')!.y, JSON.stringify({ toast: tr.get('t')!.y + tr.get('t')!.height, tab: tr.get('tab')!.y }));
  const pop = phone([{ id: 'pop', name: 'pop', type: 'popover', x: 20, y: 10, children: [{ id: 'pt', name: 'pt', type: 'text', content: 'Hi there', fontSize: 16 }] }]);
  check('twin: a popover placed under the status bar warns (fast)', (await safe(pop, 'fast')).some((i) => i.nodeId === 'pt'));
  check('twin: a popover placed under the status bar warns (detailed)', (await safe(pop, 'detailed')).some((i) => i.nodeId === 'pt'));
  const nested = phone([{ id: 'fr', name: 'fr', type: 'frame', position: 'absolute', x: 0, y: 300, width: 390, height: 100, children: [
    { id: 'pop2', name: 'pop2', type: 'popover', x: 20, y: 10, children: [{ id: 'pt2', name: 'pt2', type: 'text', content: 'Hi there', fontSize: 16 }] },
  ] }]);
  check('fast mode reads a nested overlay\'s y as root coordinates (warns at y 10, not 310)', (await safe(nested, 'fast')).some((i) => i.nodeId === 'pt2'));
}

// ── Round 1 mutation gaps (rendered) ────────────────────────────────────────
{
  const long = 'A tooltip with enough words in it to wrap well past its maximum width of two hundred and forty pixels';
  const html = htmlOf(canvasOf([
    { id: 'tip', name: 'tip', type: 'tooltip', text: long, x: 10, y: 10 },
    { id: 'pop', name: 'pop', type: 'popover', x: 400, y: 100, children: [{ id: 'pt', name: 'pt', type: 'text', content: 'In' }] },
  ], tech));
  const r = flat(await computeLayout(html, undefined, 5, { width: 1440, height: 900 }));
  check('a long tooltip wraps at 240 (not narrower)', r.get('tip')!.width >= 236 && r.get('tip')!.width <= 240, String(r.get('tip')!.width));
  const sub = await computeLayout(html, 'pop', 5, { width: 1440, height: 900 });
  check('twin: walking from an overlay does not append the other overlays', !(sub[0]?.children ?? []).some((c) => c.nodeId === 'tip'));
  const narrow = { ...canvasOf([{ id: 'm', name: 'm', type: 'modal', title: 'Narrow', children: [] }], tech, { width: 390, height: 844 }) } as Canvas;
  const m = flat(await computeLayout(renderToHtml(resolveVariables(narrow.root, tech), 390, 844, narrow), undefined, 3, { width: 390, height: 844 })).get('m')!;
  check('a modal wider than the artboard keeps 16px each side', m.x === 16 && m.width === 358, JSON.stringify({ x: m.x, w: m.width }));
}

await shutdown();
console.log(allPass ? '\nAll checks passed.' : '\nSome checks FAILED.');
process.exit(allPass ? 0 : 1);
