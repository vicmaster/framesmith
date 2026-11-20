// Phase 24 slice D — the stress engine's pure halves: perturbation transforms
// and layout comparison, fixture-tested without Chrome.
//
// Usage: npx tsx test/unit/test-stress.ts

import '../env.js';
import { applyPerturbation, compareLayouts, widenNumber, PERTURBATION_NAMES } from '../../src/stress.js';
import type { SceneNode } from '../../src/types.js';
import type { LayoutRect } from '../../src/screenshot.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

let seq = 0;
const id = () => `n${++seq}`;
const text = (content: string): SceneNode => ({ id: id(), type: 'text', content });
const frame = (children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id: id(), type: 'frame', children, ...extra } as SceneNode);
const doc = (children: SceneNode[]): SceneNode => ({ id: 'document', type: 'document', children } as SceneNode);

function table(headers: string[], rows: string[][]): SceneNode {
  const row = (cells: string[]) => frame(cells.map((c) => frame([text(c)])), { layout: 'horizontal' });
  return frame([row(headers), ...rows.map(row)]);
}
const texts = (root: SceneNode): string[] => {
  const out: string[] = [];
  (function walk(n: SceneNode) { if (n.type === 'text') out.push(n.content as string); n.children?.forEach(walk); })(root);
  return out;
};

// ── widenNumber ─────────────────────────────────────────────────────────────
check('money widens', widenNumber('$1.5M') === '$1,520,847.33');
check('percent widens', widenNumber('+4.2%') === '+123.45%');
check('count widens', widenNumber('9') === '999+' && widenNumber('12+') === '999+');
check('bare magnitude widens', widenNumber('1.5M') === '1,520,847.33');
check('non-numeric untouched', widenNumber('Q3 2026') === null);

// ── text perturbations ──────────────────────────────────────────────────────
{
  const base = doc([text('Customer name'), text('$1.52M')]);
  const { root, touched } = applyPerturbation('long-text', base);
  const [label, money] = texts(root);
  check('long-text: ≥2.2× + unbroken token', label.length >= 'Customer name'.length * 2.2 && label.includes('Rindfleisch'), String(label.length));
  check('long-text: data-like text untouched', money === '$1.52M');
  check('long-text: touched lists only the changed node', touched.length === 1);
  check('long-text: original not mutated', texts(base)[0] === 'Customer name');

  const i18n = applyPerturbation('i18n', base);
  const grown = texts(i18n.root)[0];
  check('i18n: ~1.4×, no unbroken token', grown.length >= 'Customer name'.length * 1.4 && !grown.includes('Rindfleisch'));

  const big = applyPerturbation('big-numbers', base);
  check('big-numbers: only data-like changes', texts(big.root)[0] === 'Customer name' && texts(big.root)[1] === '$1,520,847.33');
}

// ── empty / many ────────────────────────────────────────────────────────────
{
  const base = doc([table(['NAME', 'STATUS'], [['Live', 'active'], ['VOD', 'paused'], ['Draft', 'off']])]);
  const empty = applyPerturbation('empty', base);
  const emptied = empty.root.children![0];
  check('empty: header kept, data rows dropped', emptied.children!.length === 1, String(emptied.children!.length));
  check('empty: table container marked touched', empty.touched.length === 1);

  const many = applyPerturbation('many', base);
  const grown = many.root.children![0];
  check('many: data rows ×3 (1 header + 9 rows)', grown.children!.length === 10, String(grown.children!.length));
  const ids = new Set<string>();
  (function walk(n: SceneNode) { check2(ids, n.id); n.children?.forEach(walk); })(grown);
  function check2(set: Set<string>, nid: string) { if (set.has(nid)) allPass = false; set.add(nid); }
  check('many: cloned rows carry unique ids', true);

  const noTable = applyPerturbation('empty', doc([text('hero copy')]));
  check('empty with no table → touched: [] (skippable)', noTable.touched.length === 0);
}

// ── compareLayouts ──────────────────────────────────────────────────────────
const rect = (nodeId: string, x: number, y: number, w: number, h: number, extra: Partial<LayoutRect> = {}, children: LayoutRect[] = []): LayoutRect =>
  ({ nodeId, x, y, width: w, height: h, ...(children.length ? { children } : {}), ...extra });

{
  // clip appears under perturbation → warning; same clip at baseline → silent.
  const baseline = [rect('root', 0, 0, 800, 600, {}, [rect('cell', 0, 0, 100, 20)])];
  const clipped = [rect('root', 0, 0, 800, 600, {}, [rect('cell', 0, 0, 100, 20, { scrollWidth: 180, clientWidth: 100, scrollHeight: 20, clientHeight: 20 })])];
  const f1 = compareLayouts(baseline, clipped, [], 800);
  check('new clip → warning', f1.length === 1 && f1[0].kind === 'clip' && f1[0].severity === 'warning', JSON.stringify(f1));
  const f2 = compareLayouts(clipped, clipped, [], 800);
  check('pre-existing clip → silent', f2.length === 0, JSON.stringify(f2));

  // ellipsis clip → info.
  const ell = [rect('root', 0, 0, 800, 600, {}, [rect('cell', 0, 0, 100, 20, { scrollWidth: 180, clientWidth: 100, scrollHeight: 20, clientHeight: 20, ellipsis: true })])];
  const f3 = compareLayouts(baseline, ell, [], 800);
  check('ellipsis clip → info', f3.length === 1 && f3[0].severity === 'info');

  // overflow-x: child escapes parent box.
  const over = [rect('root', 0, 0, 800, 600, {}, [rect('row', 0, 0, 800, 40, {}, [rect('badge', 760, 0, 80, 20)])])];
  const baseOk = [rect('root', 0, 0, 800, 600, {}, [rect('row', 0, 0, 800, 40, {}, [rect('badge', 760, 0, 30, 20)])])];
  const f4 = compareLayouts(baseOk, over, [], 800);
  check('child escaping parent → overflow-x', f4.some((f) => f.kind === 'overflow-x' && f.nodeId === 'badge'), JSON.stringify(f4));

  // layout-shift: untouched node balloons → warning; touched/ancestors exempt.
  const baseH = [rect('root', 0, 0, 800, 600, {}, [rect('a', 0, 0, 800, 40), rect('b', 0, 40, 800, 40)])];
  const grownH = [rect('root', 0, 0, 800, 700, {}, [rect('a', 0, 0, 800, 120), rect('b', 0, 120, 800, 40)])];
  const f5 = compareLayouts(baseH, grownH, [], 800);
  check('untouched node ballooning → layout-shift', f5.some((f) => f.kind === 'layout-shift' && f.nodeId === 'a'));
  const f6 = compareLayouts(baseH, grownH, ['a'], 800);
  check('touched node ballooning → exempt', !f6.some((f) => f.kind === 'layout-shift'), JSON.stringify(f6));
  // ancestor of touched exempt too: root grew but contains touched a.
  check('ancestor of touched exempt', !f6.some((f) => f.nodeId === 'root'));

  // stretch-sibling exempt: sidebar follows the row's growth (same width,
  // height growth ≤ parent growth) next to a touched, growing content column.
  const baseS = [rect('root', 0, 0, 800, 600, {}, [rect('row', 0, 0, 800, 500, {}, [
    rect('sidebar', 0, 0, 200, 500), rect('content', 200, 0, 600, 500, {}, [rect('tbl', 200, 0, 600, 480)])])])];
  const grownS = [rect('root', 0, 0, 800, 1500, {}, [rect('row', 0, 0, 800, 1400, {}, [
    rect('sidebar', 0, 0, 200, 1400), rect('content', 200, 0, 600, 1400, {}, [rect('tbl', 200, 0, 600, 1380)])])])];
  const f7 = compareLayouts(baseS, grownS, ['tbl'], 800);
  check('stretch-sibling following parent growth → exempt', !f7.some((f) => f.kind === 'layout-shift' && f.nodeId === 'sidebar'), JSON.stringify(f7));
  // ...but a sibling growing MORE than its parent still flags.
  const balloonS = [rect('root', 0, 0, 800, 1500, {}, [rect('row', 0, 0, 800, 1400, {}, [
    rect('sidebar', 0, 0, 200, 3000), rect('content', 200, 0, 600, 1400, {}, [rect('tbl', 200, 0, 600, 1380)])])])];
  const f8 = compareLayouts(baseS, balloonS, ['tbl'], 800);
  check('sibling outgrowing its parent still flags', f8.some((f) => f.kind === 'layout-shift' && f.nodeId === 'sidebar'), JSON.stringify(f8));

  // root vertical clip = the page outgrowing its artboard → info, not warning.
  const rootClipBase = [rect('root', 0, 0, 800, 600, { scrollHeight: 600, clientHeight: 600 })];
  const rootClipPert = [rect('root', 0, 0, 800, 600, { scrollHeight: 1400, clientHeight: 600 })];
  const f9 = compareLayouts(rootClipBase, rootClipPert, [], 800);
  check('page outgrowing fixed artboard → info clip', f9.some((f) => f.kind === 'clip' && f.nodeId === 'root' && f.severity === 'info'), JSON.stringify(f9));
  // horizontal root clip stays a warning.
  const rootWideBase = [rect('root', 0, 0, 800, 600, { scrollWidth: 800, clientWidth: 800 })];
  const rootWidePert = [rect('root', 0, 0, 800, 600, { scrollWidth: 1200, clientWidth: 800 })];
  const f10 = compareLayouts(rootWideBase, rootWidePert, [], 800);
  check('horizontal root clip stays warning', f10.some((f) => f.kind === 'clip' && f.severity === 'warning'), JSON.stringify(f10));
}

check('perturbation registry names stable', PERTURBATION_NAMES.join(',') === 'long-text,i18n,big-numbers,empty,many');

// ── textOverflow: 'ellipsis' — the designed-truncation property ─────────────
// computeLayout flags ellipsis from computed style and compareLayouts
// downgrades those clips to info (tested above); what must hold here is that
// the node property actually emits the CSS that triggers that path.
{
  const { renderToHtml } = await import('../../src/renderer.js');
  const html = renderToHtml({
    id: 'r', type: 'frame', width: 200, layout: 'horizontal',
    children: [{ id: 'label', type: 'text', content: 'A very long customer name', textOverflow: 'ellipsis' }],
  }, 200, 100);
  check('textOverflow node property emits the ellipsis CSS',
    html.includes('text-overflow: ellipsis') && html.includes('white-space: nowrap') && html.includes('min-width: 0'));
}

console.log(allPass ? '\nAll stress tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
