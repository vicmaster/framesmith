import './test-env.js';
// Phase 30 slice D — pinned positioning, the root render, and the primitives'
// rendered sizes, measured in Chrome (FR-D1, FR-D2, FR-D4, FR-D5 acceptance).
//
// Usage: npx tsx test-positioning.ts

import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { computeLayout, takeScreenshot, type LayoutRect } from './src/screenshot.js';
import { createCanvas } from './src/scene-graph.js';
import type { DesignVariables, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const LIGHT: DesignVariables = { colors: { accent: '#0B6E4F', border: '#E4E4E7', 'bg-surface': '#FFFFFF', 'text-primary': '#18181B', 'text-secondary': '#52525B' } };
const DARK: DesignVariables = { colors: { accent: '#4ADE80', border: '#3F3F46', 'bg-surface': '#18181B', 'text-primary': '#FAFAFA', 'text-secondary': '#A1A1AA' } };

function doc(children: SceneNode[], extra: Partial<SceneNode> = {}, w = 390, h = 844): SceneNode {
  return { id: 'doc', type: 'document', width: w, height: h, fill: '#FFFFFF', children, ...extra };
}
async function layout(root: SceneNode, vars: DesignVariables = LIGHT): Promise<Map<string, LayoutRect>> {
  const w = root.width as number;
  const h = root.height as number;
  const rects = await computeLayout(renderToHtml(resolveVariables(root, vars), w, h), undefined, 25, { width: w, height: h });
  const out = new Map<string, LayoutRect>();
  (function flat(list: LayoutRect[]) { for (const r of list) { out.set(r.nodeId, r); if (r.children) flat(r.children); } })(rects);
  return out;
}
const rows = (n: number, h = 56, prefix = 'row'): SceneNode[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, type: 'frame', height: h, fill: '#EEE', children: [{ id: `${prefix}${i}t`, type: 'text', content: `Row ${i}` }] }));
const SAFE = { safeArea: { top: 47, bottom: 34 } };

// ── FR-D1: the root render ────────────────────────────────────────────────
{
  console.log('── root render ──');
  const sixty = await layout(doc([{ id: 'list', type: 'frame', layout: 'vertical', children: rows(60) }], SAFE));
  const root = sixty.get('doc')!;
  const last = sixty.get('row59')!;
  check('sixty rows on a safeArea root end 34px above the document bottom', root.y + root.height - (last.y + last.height) === 34, `doc ${root.height}, last bottom ${last.y + last.height}`);
  const sixteen = await layout(doc(rows(16), SAFE));
  check('sixteen 56px rows under the root render 56 tall', [...Array(16).keys()].every((i) => sixteen.get(`row${i}`)!.height === 56), String(sixteen.get('row0')!.height));
  const spacer = await layout(doc([...rows(20), { id: 'sp', type: 'frame', height: 34 }]));
  check('a spacer directly under the root keeps its height on a long screen', spacer.get('sp')!.height === 34, String(spacer.get('sp')!.height));
  const full = await layout(doc([{ id: 'f', type: 'frame', height: '100%', justifyContent: 'space-between', children: [{ id: 'top', type: 'text', content: 'Top' }, { id: 'cta', type: 'text', content: 'CTA' }] }], SAFE));
  check('a height:100% child still resolves against the artboard when content fits', full.get('f')!.height === 844 - 81, String(full.get('f')!.height));
  const first = await layout(doc([{ id: 't', type: 'text', content: 'First' }], SAFE));
  check('a root with safeArea renders its first child 47px down', first.get('t')!.y === 47, String(first.get('t')!.y));
}

// ── FR-D1: fixed / sticky + chrome reservations ───────────────────────────
{
  console.log('\n── pinned ──');
  const bar = await layout(doc([{ id: 'tall', type: 'frame', height: 1600 }, { id: 'bar', type: 'frame', position: 'fixed', bottom: 0, height: 60, fill: '#000' }]));
  check('a fixed bottom:0 frame renders at the bottom of the viewport over 1600px of content', bar.get('bar')!.y === 844 - 60 && bar.get('bar')!.x === 0 && bar.get('bar')!.width === 390, JSON.stringify(bar.get('bar')));
  const status = await layout(doc([{ id: 'sb', type: 'status-bar' }, { id: 't', type: 'text', content: 'Hello' }]));
  check('no safeArea, no padding, fixed status-bar: the text renders at y 47', status.get('t')!.y === 47, String(status.get('t')!.y));
  check('the status-bar is 47 tall at y 0', status.get('sb')!.y === 0 && status.get('sb')!.height === 47 && status.get('sb')!.width === 390);
  const tabbed = await layout(doc([{ id: 'list', type: 'frame', layout: 'vertical', children: rows(30) }, { id: 'tb', type: 'tab-bar', items: [{ icon: 'house', label: 'Home' }, { icon: 'user', label: 'Me' }] }], SAFE));
  const docRect = tabbed.get('doc')!;
  const end = tabbed.get('row29')!;
  check('safeArea + fixed tab-bar: the bottom reservation is 83, not 117', docRect.y + docRect.height - (end.y + end.height) === 83, String(docRect.y + docRect.height - (end.y + end.height)));
  check('the tab-bar pins to the viewport bottom, 83 tall', tabbed.get('tb')!.y === 844 - 83 && tabbed.get('tb')!.height === 83, JSON.stringify(tabbed.get('tb')));
  const hi = await layout(doc([{ id: 'hi', type: 'home-indicator' }], SAFE));
  check('the home-indicator pins to the bottom, 34 tall', hi.get('hi')!.y === 810 && hi.get('hi')!.height === 34);
  const sticky = await layout(doc([...rows(3, 56, 'a'), { id: 'st', type: 'frame', position: 'sticky', y: 47, height: 40, fill: '#ccc' }, ...rows(20, 56, 'b')], SAFE));
  check('a sticky frame renders in flow at scroll position 0', sticky.get('st')!.y === 47 + 3 * 56, String(sticky.get('st')!.y));
}

// ── FR-D2 / FR-D4: primitive sizes at 390 and 1440, both themes ──────────
{
  console.log('\n── primitive sizes ──');
  for (const [theme, vars] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const w of [390, 1440]) {
      const r = await layout(doc([
        { id: 'col', type: 'frame', layout: 'vertical', height: 120, children: [
          { id: 'bsm', type: 'button', label: 'Small', size: 'sm' },
          { id: 'bmd', type: 'button', label: 'Medium' },
          { id: 'blg', type: 'button', label: 'Large', size: 'lg' },
        ] },
        { id: 'r1', type: 'list-row', title: 'One line' },
        { id: 'r2', type: 'list-row', title: 'Two lines', subtitle: 'Subtitle' },
      ], {}, w, 900), vars);
      const hs = ['bsm', 'bmd', 'blg', 'r1', 'r2'].map((id) => r.get(id)!.height);
      check(`${theme} @${w}: buttons 32/44/52 (even in a 120px column), list rows 44/56`, hs.join() === '32,44,52,44,56', hs.join());
    }
  }
}

// ── render invariance: metadata.surface, viewport meta ────────────────────
{
  console.log('\n── invariance ──');
  const web = createCanvas('inv', undefined, { width: 390, height: 844 });
  web.root.children = [{ id: 't', type: 'text', content: 'Same pixels', fontSize: 20 }, { id: 'b', type: 'button', label: 'Go' }];
  const mobile = structuredClone(web);
  mobile.metadata = { ...mobile.metadata, surface: { type: 'mobile', device: 'iphone-390' } };
  const shot = async (c: typeof web) => takeScreenshot(renderToHtml(c.root, 390, 844, c), { width: 390, height: 844, scale: 1 });
  check('changing only metadata.surface leaves the screenshot byte-identical', (await shot(web)) === (await shot(mobile)));
  const html = renderToHtml(web.root, 390, 844, web);
  const noMeta = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">\n', '');
  check('the viewport meta changes no capture', html !== noMeta
    && (await takeScreenshot(html, { width: 390, height: 844, scale: 1 })) === (await takeScreenshot(noMeta, { width: 390, height: 844, scale: 1 })));
  const fits = doc([{ id: 't', type: 'text', content: 'Fits' }]);
  const asMin = renderToHtml(fits, 390, 844);
  const asHeight = asMin.replace('; min-height: max-content', '');
  check('a canvas whose content fits renders byte-identically to the old fixed height', asMin !== asHeight
    && (await takeScreenshot(asMin, { width: 390, height: 844, scale: 1 })) === (await takeScreenshot(asHeight, { width: 390, height: 844, scale: 1 })));
}

// ── fullPage: pinned elements at the image ends ───────────────────────────
{
  console.log('\n── fullPage ──');
  const root = doc([{ id: 'tall', type: 'frame', height: 1600, fill: '#FFFFFF' }, { id: 'bar', type: 'frame', position: 'fixed', bottom: 0, height: 60, fill: '#FF0000' }]);
  const png = Buffer.from(await takeScreenshot(renderToHtml(root, 390, 844), { width: 390, height: 844, scale: 1, fullPage: true }), 'base64');
  const height = png.readUInt32BE(20);
  check('fullPage grows the capture to the content (1600)', height === 1600, String(height));
}

console.log(allPass ? '\nAll positioning checks passed.' : '\nSome positioning checks FAILED.');
process.exit(allPass ? 0 : 1);
