// Phase 31 slice H (spec R8) — the analytical state model against the
// renderer's pixels. Each scene is rendered at device scale 1; the colours the
// model computes (state-checks.ts) for a focus ring and the pixels it covers
// unfocused, an active indicator and its fill in rest and hover, a button's
// hover / focus / pressed fill, a disabled toggle track and button container
// with the token pair, and a boundary with the backdrop outside it, must each
// match the rendered pixel within 2/255 per channel, unthemed and under a
// generated system in both themes (and the dark preset's translucent ink).
// Twin: a model whose layer opacity is 0.05 off must fail the same compare.
// Needs Chrome. Run with: npx tsx test-state-model-render.ts

import './test-env.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { generateDesignSystem } from './src/design-language.js';
import { withPage, shutdown } from './src/screenshot.js';
import { boundaryPairs, focusPairs, indicatorPairs, layerAlpha, paint, stateTargets } from './src/state-checks.js';
import type { Rgb } from './src/color-math.js';
import type { DesignVariables, ElementState, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ` — ${extra}` : ''}`);
}

const W = 640;
const H = 420;
const TOLERANCE = 2;

interface Rect { left: number; top: number; right: number; bottom: number }

/** Render, then read each named element's rect and the pixels at `points`. */
async function sample(html: string, points: (rects: Record<string, Rect>) => Array<[number, number]>): Promise<Rgb[]> {
  return withPage(async (page) => {
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const rects: Record<string, Rect> = await page.evaluate(`(() => {
      const out = {};
      const put = (key, el) => { const r = el.getBoundingClientRect(); out[key] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      document.querySelectorAll('[data-node-id]').forEach((el) => put(el.getAttribute('data-node-id'), el));
      document.querySelectorAll('[role=tab]').forEach((el, i) => put('tab' + i, el));
      document.querySelectorAll('[role=textbox]').forEach((el, i) => put('field' + i, el));
      return out;
    })()`);
    const png = Buffer.from(await page.screenshot({ type: 'png' })).toString('base64');
    const pts = points(rects).map(([x, y]) => [Math.round(x), Math.round(y)]);
    return page.evaluate(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${png}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ${JSON.stringify(pts)}.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)));
    })()`) as Promise<Rgb[]>;
  });
}

const off = (a: Rgb, b: Rgb) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function same(name: string, model: Rgb | undefined, pixel: Rgb) {
  check(name, !!model && off(model, pixel) <= TOLERANCE, `model ${model ? hex(model) : 'none'}, pixel ${hex(pixel)}`);
}

const SYSTEM = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
const THEMES: Array<{ name: string; vars: DesignVariables; theme?: 'dark' }> = [
  { name: 'unthemed', vars: {} },
  { name: 'generated light', vars: SYSTEM },
  { name: 'generated dark', vars: SYSTEM, theme: 'dark' },
];

/** One scene: a panel of targets, each element in `state`. */
function scene(state: ElementState, opts: { panelFill?: string; navInk?: string } = {}): SceneNode {
  return {
    id: 'root', type: 'frame', width: W, height: H, fill: '#FFFFFF', layout: 'vertical', padding: 16,
    children: [{
      id: 'panel', type: 'frame', fill: opts.panelFill ?? '$bg-surface', layout: 'vertical', gap: 14, padding: 16, width: 360,
      children: [
        { id: 'b', type: 'button', label: 'Save', size: 'sm', state },
        { id: 'nv', type: 'nav-item', label: 'Home', active: true, state, ...(opts.navInk ? { color: opts.navInk } : {}) },
        { id: 'tl', type: 'tabs', items: [{ label: 'Design', active: true, state }, { label: 'Layout' }] },
        { id: 'tc', type: 'tabs', variant: 'contained', items: [{ label: 'All', active: true, state }, { label: 'Starred' }] },
        { id: 'ti', type: 'text-input', placeholder: 'Search', width: 200 },
        { id: 'cb', type: 'checkbox' },
        { id: 'tg', type: 'toggle', state },
      ],
    }],
  };
}

const resolved = (state: ElementState, vars: DesignVariables, theme?: 'dark', opts?: Parameters<typeof scene>[1]) =>
  resolveVariables(scene(state, opts), vars, theme ? { theme } : {});
const htmlOf = (root: SceneNode) => renderToHtml(root, W, H);
const mid = (r: Rect) => (r.top + r.bottom) / 2;

for (const t of THEMES) {
  const rest = resolved('rest', t.vars, t.theme);
  const targets = stateTargets(rest);
  const find = (id: string, what?: string) => targets.find((x) => x.node.id === id && (!what || x.what === what))!;

  // ── focus: the ring, and the unfocused pixels it covers ──
  const ring = focusPairs(targets);
  const ringOf = (id: string, what?: string) => ring.find((p) => p.target.node.id === id && (!what || p.target.what === what))!;
  const at = (r: Record<string, Rect>) => [
    [r.b.right + 3, mid(r.b)], // outset ring, centre of 2px at a 2px gap
    [r.tab0.left + 1, mid(r.tab0)], // a line tab's inset ring
    [r.tab2.left + 1, mid(r.tab2)], // a contained active tab's inset ring
    [(r.tg.left + r.tg.right) / 2, r.tg.bottom + 3], // a pill: its straight bottom edge
  ] as Array<[number, number]>;
  const focused = await sample(htmlOf(resolved('focus', t.vars, t.theme)), at);
  const unfocused = await sample(htmlOf(rest), at);
  same(`${t.name}: a button's outset ring`, ringOf('b').ringPx, focused[0]);
  same(`${t.name}: the pixels it covers unfocused (the backdrop)`, ringOf('b').reference, unfocused[0]);
  same(`${t.name}: a line tab's inset ring`, ringOf('tl', 'tab "Design"').ringPx, focused[1]);
  same(`${t.name}: what it covers unfocused`, ringOf('tl', 'tab "Design"').reference, unfocused[1]);
  same(`${t.name}: a contained active tab's inset ring`, ringOf('tc', 'tab "All"').ringPx, focused[2]);
  same(`${t.name}: what it covers unfocused (the tab fill)`, ringOf('tc', 'tab "All"').reference, unfocused[2]);
  same(`${t.name}: a toggle's outset ring`, ringOf('tg').ringPx, focused[3]);

  // ── active: the indicator and its fill, rest and hover ──
  const ind = indicatorPairs(rest);
  const nav = ind.find((p) => p.node.id === 'nv')!;
  const tab = ind.find((p) => p.node.id === 'tl')!;
  const marks = (r: Record<string, Rect>) => [
    [r.nv.left + 1, mid(r.nv)], [r.nv.right - 8, r.nv.top + 3],
    [(r.tab0.left + r.tab0.right) / 2, r.tab0.bottom - 1], [(r.tab0.left + r.tab0.right) / 2, r.tab0.top + 3],
  ] as Array<[number, number]>;
  for (const state of ['rest', 'hover'] as const) {
    const px = await sample(htmlOf(resolved(state, t.vars, t.theme)), marks);
    same(`${t.name} ${state}: the nav-item bar`, nav[state].indicator, px[0]);
    same(`${t.name} ${state}: the nav-item fill beside it`, nav[state].fill, px[1]);
    same(`${t.name} ${state}: the line tab underline`, tab[state].indicator, px[2]);
    same(`${t.name} ${state}: the line tab fill above it`, tab[state].fill, px[3]);
  }

  // ── a button's layer in hover, focus and pressed ──
  const btn = find('b');
  const bd = btn.backdrop.kind === 'color' ? btn.backdrop.rgb : ([255, 255, 255] as Rgb);
  for (const state of ['hover', 'focus', 'pressed'] as const) {
    const [px] = await sample(htmlOf(resolved(state, t.vars, t.theme)), (r) => [[r.b.left + 4, mid(r.b)]]);
    const p = layerAlpha(btn.style?.[state] ?? 0);
    same(`${t.name}: a button's ${state} fill`, paint(btn.ink, paint(btn.fill, bd), p), px);
  }

  // ── the boundary and the backdrop outside it ──
  const bounds = boundaryPairs(rest);
  const field = bounds.find((p) => p.node.id === 'ti')!;
  const box = bounds.find((p) => p.node.id === 'cb')!;
  const track = bounds.find((p) => p.node.id === 'tg')!;
  const edge = await sample(htmlOf(rest), (r) => [[r.field0.left, mid(r.field0)], [r.field0.left - 3, mid(r.field0)], [r.cb.left, mid(r.cb)], [r.tg.right - 4, mid(r.tg)]]);
  same(`${t.name}: a text-input border`, field.boundary, edge[0]);
  same(`${t.name}: the backdrop outside it`, field.backdrop, edge[1]);
  same(`${t.name}: a checkbox outline`, box.boundary, edge[2]);
  same(`${t.name}: a toggle track`, track.boundary, edge[3]);
}

// ── disabled with the token pair: a toggle track, a button container ──
for (const theme of [undefined, 'dark'] as const) {
  const name = theme ? 'generated dark' : 'generated light';
  const root = resolved('disabled', SYSTEM, theme);
  const tg = stateTargets(root).find((x) => x.node.id === 'tg')!;
  const b = stateTargets(root).find((x) => x.node.id === 'b')!;
  const s = tg.style!;
  const bdOf = (x: typeof tg) => (x.backdrop.kind === 'color' ? x.backdrop.rgb : ([255, 255, 255] as Rgb));
  const [trackPx, containerPx] = await sample(htmlOf(root), (r) => [[r.tg.right - 4, mid(r.tg)], [r.b.left + 4, mid(r.b)]]);
  same(`${name}: a disabled toggle track (on-surface at disabledContent)`, paint(s.onSurface, bdOf(tg), s.disabledContent!), trackPx);
  // The container takes the on-surface colour at its share, inside the group.
  const share = Math.min(100, Math.round((s.disabledContainer! / s.disabledContent!) * 10000) / 100);
  same(`${name}: a disabled button container (on-surface at disabledContainer)`, paint(s.onSurface, bdOf(b), (share / 100) * s.disabledContent!), containerPx);
}

// ── the dark preset's translucent ink, and the twin ──
{
  const root = resolveVariables(scene('hover', { panelFill: '#121212', navInk: '#ffffffde' }), {});
  const nav = indicatorPairs(root).find((p) => p.node.id === 'nv')!;
  const [px] = await sample(htmlOf(root), (r) => [[r.nv.right - 8, r.nv.top + 3]]);
  same('a #ffffffde ink\'s hover layer (alpha × percent)', nav.hover.fill, px);

  const light = resolveVariables(scene('hover'), {});
  const target = stateTargets(light).find((x) => x.node.id === 'nv')!;
  const bd = target.backdrop.kind === 'color' ? target.backdrop.rgb : ([255, 255, 255] as Rgb);
  const [hoverPx] = await sample(htmlOf(light), (r) => [[r.nv.right - 8, r.nv.top + 3]]);
  const drifted = paint(target.ink, paint(target.fill, bd), layerAlpha(0.08) + 0.05);
  check('twin: a model 0.05 off in layer opacity fails the compare', off(drifted, hoverPx) > TOLERANCE, `drifted ${hex(drifted)}, pixel ${hex(hoverPx)}`);
}

await shutdown();
console.log(allPass ? '\nAll state model render tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
