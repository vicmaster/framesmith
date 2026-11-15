// Phase 31 slice F — desktop-app-overlay (FR-F1, spec change S8) in fast
// mode. Every finding has a twin, as close as possible, that must stay silent;
// the rule is shown silent on web and mobile. The detailed-mode clauses
// (rendered boxes, rendered modal widths, sideways scrolling) live in
// test-desktop-app-overlay-detailed.ts.
//
// Usage: npx tsx test-desktop-app-overlay.ts

import './test-env.js';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { checkOverlays } from './src/desktop-app-rules.js';
import { WINDOW_PROFILES } from './src/surfaces.js';
import { createCanvas } from './src/scene-graph.js';
import { applyStructure } from './src/structures.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type Kind = 'web' | 'mobile' | 'desktop-app';
interface Opts { type?: Kind; root?: Partial<SceneNode>; components?: Record<string, SceneNode> }
function canvasOf(children: SceneNode[], o: Opts = {}): Canvas {
  const type = o.type ?? 'desktop-app';
  return {
    id: 'c', name: 'c', projectId: 'p', components: o.components ?? {}, variables: {}, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, children, ...o.root },
    metadata: { surface: type === 'desktop-app' ? { type, device: 'window-1440' } : type === 'mobile' ? { type, device: 'iphone-15' } : { type } },
  } as Canvas;
}
const RULE = 'desktop-app-overlay';
async function findings(children: SceneNode[], o: Opts = {}): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(canvasOf(children, o), { mode: 'fast' });
  const f = r.issues.filter((i) => i.rule === RULE);
  for (const i of f) if (i.category !== 'usability') wrongCategory.push(`${i.nodeId}: ${i.category}`);
  return f;
}
const wrongCategory: string[] = [];
const show = (f: EvaluationIssue[]) => JSON.stringify(f.map((i) => `${i.severity} ${i.nodeId}: ${i.message}`));
const text = (id: string, content: string, extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'text', content, fontSize: 14, color: '#111111', ...extra });
const frame = (id: string, children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'frame', layout: 'vertical', children, ...extra });
const modal = (id: string, children: SceneNode[] = [], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'modal', title: 'Rename', size: 'sm', children, ...extra });
const btn = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id, name: id, type: 'button', label: id, variant: 'secondary', size: 'sm', ...extra });

// ── M4(a): one modal per canvas ────────────────────────────────────────────
{
  let f = await findings([modal('m1'), modal('m2')]);
  check('(a) two modals warn once, on the second', f.length === 1 && f[0].nodeId === 'm2' && f[0].severity === 'warning' && /2 modals/.test(f[0].message), show(f));
  f = await findings([modal('m1')]);
  check('(a) twin: one modal is silent', f.length === 0, show(f));
  // Two instances of a component holding a modal render two modals.
  const comp: SceneNode = frame('dlg', [modal('cm')]);
  f = await findings([{ id: 'i1', name: 'i1', type: 'instance', componentId: 'dlg' }, { id: 'i2', name: 'i2', type: 'instance', componentId: 'dlg' }], { components: { dlg: comp } });
  check('(a) two instances of a modal component warn, on the second instance', f.length === 1 && f[0].nodeId === 'i2' && /inside instance/.test(f[0].message), show(f));
  f = await findings([{ id: 'i1', name: 'i1', type: 'instance', componentId: 'dlg' }], { components: { dlg: comp } });
  check('(a) twin: one instance is silent', f.length === 0, show(f));
  // A modal nested in another modal is still a second modal.
  f = await findings([modal('m1', [modal('m2')])]);
  check('(a) a modal inside a modal warns', f.length === 1 && f[0].nodeId === 'm2', show(f));
}

// ── M4(b): tooltips are text only ──────────────────────────────────────────
{
  const tip = (children?: SceneNode[]): SceneNode => ({ id: 'tip', name: 'tip', type: 'tooltip', text: 'Rename', x: 100, y: 100, ...(children ? { children } : {}) });
  let f = await findings([tip([text('t', 'Rename (F2)')])]);
  check('(b) a tooltip with a child warns', f.length === 1 && f[0].nodeId === 'tip' && /text only/.test(f[0].message), show(f));
  f = await findings([tip()]);
  check('(b) twin: a text-only tooltip is silent', f.length === 0, show(f));
  f = await findings([tip([])]);
  check('(b) twin: an empty children array is silent', f.length === 0, show(f));
}

// ── M4(c): no large tables in a modal ──────────────────────────────────────
{
  const cell = (id: string, s: string, extra: Partial<SceneNode> = {}) => frame(id, [text(`${id}t`, s, extra)], { width: 120 });
  const header = frame('h', [cell('h1', 'Name', { fontWeight: 600 }), cell('h2', 'Owner', { fontWeight: 600 }), cell('h3', 'Status', { fontWeight: 600 })], { layout: 'horizontal', height: 32 });
  const row = (i: number) => frame(`r${i}`, [cell(`r${i}a`, `Project ${i}`), cell(`r${i}b`, 'Ana'), cell(`r${i}c`, 'Active')], { layout: 'horizontal', height: 32 });
  const table = (rows: number, withHeader = true, id = 'tbl') => frame(id, [...(withHeader ? [header] : []), ...Array.from({ length: rows }, (_, i) => row(i))]);
  let f = await findings([modal('m', [table(11)], { size: 'lg' })]);
  check('(c) a header plus 11 body rows in a modal warns', f.length === 1 && f[0].nodeId === 'tbl' && /11 rows/.test(f[0].message), show(f));
  f = await findings([modal('m', [table(10)], { size: 'lg' })]);
  check('(c) twin: a header plus 10 body rows is silent (the header does not count)', f.length === 0, show(f));
  f = await findings([modal('m', [frame('wrap', [frame('deep', [table(11)])])], { size: 'lg' })]);
  check('(c) a table nested deeper in the modal body warns', f.length === 1 && f[0].nodeId === 'tbl', show(f));
  f = await findings([table(20)]);
  check('(c) twin: the same table on the page is silent', f.length === 0, show(f));
  // Row-select rows read as data, not a header (isHeaderRow), so all count.
  const selRow = (i: number) => frame(`s${i}`, [{ id: `s${i}c`, name: 'c', type: 'checkbox' }, cell(`s${i}a`, `File ${i}`), cell(`s${i}b`, 'Ana')], { layout: 'horizontal', height: 32 });
  const selTable = (n: number) => frame('sel', Array.from({ length: n }, (_, i) => selRow(i)));
  f = await findings([modal('m', [selTable(11)], { size: 'lg' })]);
  check('(c) 11 rows with no header row warn', f.length === 1 && f[0].nodeId === 'sel' && /11 rows/.test(f[0].message), show(f));
  f = await findings([modal('m', [selTable(10)], { size: 'lg' })]);
  check('(c) twin: 10 rows with no header row are silent', f.length === 0, show(f));
  // M3: a table in a popover inside a modal belongs to the popover (lifted).
  f = await findings([modal('m', [{ id: 'pop', name: 'pop', type: 'popover', x: 10, y: 10, children: [table(11)] }], { size: 'lg' })]);
  check('(c) a table inside a popover inside a modal is not the modal\'s (only S8 fires, on the popover)', f.length === 1 && f[0].nodeId === 'pop' && /scrim/.test(f[0].message), show(f));
}

// ── M4(d): no sideways scrolling in a modal ────────────────────────────────
{
  const pane = (extra: Partial<SceneNode>) => frame('scroll', [text('s', 'Wide content')], { overflow: 'auto', ...extra });
  let f = await findings([modal('m', [pane({ minWidth: 700 })], { size: 'md' })]);
  check('(d) a 700px minWidth scrolling frame in a 640px modal warns', f.length === 1 && f[0].nodeId === 'scroll' && /700px wide in a 640px modal/.test(f[0].message), show(f));
  f = await findings([modal('m', [pane({ minWidth: 640 })], { size: 'md' })]);
  check('(d) twin: a 640px minWidth in a 640px modal is silent', f.length === 0, show(f));
  f = await findings([modal('m', [pane({ width: 900 })], { size: 'md' })]);
  check('(d) twin: a bare 900px width is squeezed to the modal by the render, so it is silent', f.length === 0, show(f));
  f = await findings([modal('m', [pane({ width: 900, maxWidth: 1000 })], { size: 'md' })]);
  check('(d) a 900px width with a maxWidth keeps its size and warns', f.length === 1 && /900px wide/.test(f[0].message), show(f));
  f = await findings([modal('m', [pane({ width: 900, maxWidth: 600 })], { size: 'md' })]);
  check('(d) twin: a maxWidth below the modal caps it', f.length === 0, show(f));
  f = await findings([modal('m', [pane({ minWidth: 900, overflow: 'hidden' })], { size: 'md' })]);
  check('(d) twin: a wide frame that clips (overflow hidden) is not a scroller', f.length === 0, show(f));
  f = await findings([modal('m', [pane({ minWidth: 900 })], { width: 1000 })]);
  check('(d) twin: a numeric modal width wins over size', f.length === 0, show(f));
  f = await findings([pane({ minWidth: 2000 })]);
  check('(d) twin: a wide scroller on the page is silent', f.length === 0, show(f));
}

// ── M4(e): overlays stay in the viewport ───────────────────────────────────
{
  let f = await findings([modal('m', [], { size: 'lg' })]);
  check('(e) a centred lg modal (960) in 1440 is silent', f.length === 0, show(f));
  f = await findings([modal('m', [], { width: 1409 })]);
  check('(e) a modal wider than the viewport less 32 warns (the render squeezes it)', f.length === 1 && /squeezes it to 1408px/.test(f[0].message), show(f));
  f = await findings([modal('m', [], { width: 1408 })]);
  check('(e) twin: exactly the viewport less 32 is silent', f.length === 0, show(f));
  f = await findings([modal('m', [], { size: 'lg' })], { root: { width: 900 } });
  check('(e) an lg modal in a 900px root warns', f.length === 1 && /900px viewport/.test(f[0].message), show(f));
  f = await findings([modal('m', [], { size: 'md' })], { root: { width: 900 } });
  check('(e) twin: an md modal in a 900px root is silent', f.length === 0, show(f));
  f = await findings([modal('m', [], { width: 1430, x: 0, y: 0 })]);
  check('(e) the clamp applies to a placed modal too', f.length === 1 && /squeezes/.test(f[0].message), show(f));
  // Root width unset: the window profile's 1440.
  f = await findings([modal('m', [], { width: 1420 })], { root: { width: undefined } });
  check('(e) with no root width, the profile width (1440) is the viewport', f.length === 1 && /1440px viewport/.test(f[0].message), show(f));

  const pop = (extra: Partial<SceneNode>): SceneNode => ({ id: 'pop', name: 'pop', type: 'popover', children: [text('p', 'Hi')], ...extra });
  f = await findings([pop({ x: 1300, y: 100, width: 320, height: 200 })]);
  check('(e) a popover past the right edge warns', f.length === 1 && /right edge/.test(f[0].message), show(f));
  f = await findings([pop({ x: 1120, y: 100, width: 320, height: 200 })]);
  check('(e) twin: one that ends at the right edge is silent', f.length === 0, show(f));
  f = await findings([pop({ x: 1300, y: 100, width: 320 })]);
  check('(e) twin: fast mode skips a box with no authored height', f.length === 0, show(f));
  f = await findings([pop({ x: 1300, width: 320, height: 200 })]);
  check('(e) twin: fast mode skips a box with only x', f.length === 0, show(f));
  f = await findings([{ id: 'tip', name: 'tip', type: 'tooltip', text: 'Hi', x: -4, y: 10, width: 60, height: 24 }]);
  check('(e) a tooltip past the left edge warns', f.length === 1 && /left edge/.test(f[0].message), show(f));
  f = await findings([pop({ x: 100, y: 850, width: 320, height: 100 })]);
  check('(e) past the bottom of a 900px root warns', f.length === 1 && /bottom edge/.test(f[0].message), show(f));
  f = await findings([pop({ x: 100, y: 850, width: 320, height: 100 })], { root: { height: 1200 } });
  check('(e) twin: the same box in a 1200px root is silent', f.length === 0, show(f));
  f = await findings([pop({ x: 100, y: 850, width: 320, height: 100 })], { root: { height: undefined } });
  check('(e) with no root height, the profile height (900) is the viewport', f.length === 1 && /bottom edge/.test(f[0].message), show(f));
  f = await findings([{ id: 'dr', name: 'dr', type: 'drawer', x: -200, y: -50, width: 320, height: 2000, children: [text('d', 'Details')] }]);
  check('(e) twin: a drawer ignores x / y (pinned right), so fast mode skips it', f.length === 0, show(f));
  // Root coordinates: a parent's offset is never added.
  f = await findings([frame('bar', [pop({ x: 1100, y: 100, width: 320, height: 200 })], { x: 300, position: 'sticky', top: 0 } as Partial<SceneNode>)]);
  check('(e) twin: inside an offset sticky bar, x / y stay root coordinates', f.length === 0, show(f));
}

// ── verify round 1 fixes: what the render shrinks, modals inside tables ────
{
  const pane = (extra: Partial<SceneNode>) => frame('scroll', [text('s', 'Wide content')], { overflow: 'auto', ...extra });
  let f = await findings([modal('m', [pane({ width: 900, maxWidth: '100%' })], { size: 'md' })]);
  check('R1.1 a width with maxWidth "100%" is squeezed to the modal: silent', f.length === 0, show(f));
  f = await findings([modal('m', [pane({ width: 900, maxWidth: 'calc(100% - 8px)' })], { size: 'md' })]);
  check('R1.1 a width with a calc maxWidth is read as the parent: silent', f.length === 0, show(f));
  f = await findings([modal('m', [pane({ width: 900, maxWidth: '1000px' })], { size: 'md' })]);
  check('R1.1 keep: a width with a px-string maxWidth stays wide and warns', f.length === 1 && /900px wide/.test(f[0].message), show(f));

  // A modal authored in a table-shaped frame (a per-row confirm dialog).
  const cell = (id: string, s: string, extra: Partial<SceneNode> = {}) => frame(id, [text(`${id}t`, s, extra)], { width: 120 });
  const hdr = (p: string) => frame(`${p}h`, [cell(`${p}h1`, 'Name', { fontWeight: 600 }), cell(`${p}h2`, 'Owner', { fontWeight: 600 })], { layout: 'horizontal', height: 32 });
  const row = (p: string, i: number, extra: SceneNode[] = []) => frame(`${p}r${i}`, [cell(`${p}r${i}a`, `Item ${i}`), cell(`${p}r${i}b`, 'Ana'), ...extra], { layout: 'horizontal', height: 32 });
  const inner = (rows: number) => frame('inner', [hdr('i'), ...Array.from({ length: rows }, (_, i) => row('i', i))]);
  const outer = (rows: number) => frame('outer', [hdr('o'), row('o', 0), row('o', 1), row('o', 2, [frame('oc', [modal('m', [inner(rows)], { size: 'lg' })])])]);
  f = await findings([outer(11)]);
  check('R1.2 a modal inside a table-shaped frame still has its 11-row table checked', f.length === 1 && f[0].nodeId === 'inner' && /11 rows/.test(f[0].message), show(f));
  f = await findings([outer(10)]);
  check('R1.2 twin: 10 body rows there are silent', f.length === 0, show(f));

  // Fast boxes as the render caps them (N2).
  const pop = (extra: Partial<SceneNode>): SceneNode => ({ id: 'pop', name: 'pop', type: 'popover', children: [text('p', 'Hi')], ...extra });
  f = await findings([pop({ x: 0, y: 0, width: 2000, height: 100 })]);
  check('R1.3 a 2000px popover at x 0 shrinks to the viewport: silent', f.length === 0, show(f));
  f = await findings([pop({ x: 100, y: 0, width: 2000, height: 100 })]);
  check('R1.3 keep: shrunk to 1440 at x 100 it still leaves the right edge', f.length === 1 && /right edge/.test(f[0].message), show(f));
  const tip = (x: number, width: number): SceneNode => ({ id: 'tip', name: 'tip', type: 'tooltip', text: 'hi', x, y: 10, width, height: 40 });
  f = await findings([tip(1100, 400)]);
  check('R1.3 a tooltip never renders past 240 wide: x 1100 + 400 is silent', f.length === 0, show(f));
  f = await findings([tip(1300, 200)]);
  check('R1.3 keep: a 200px tooltip at x 1300 warns', f.length === 1 && /right edge/.test(f[0].message), show(f));
  f = await findings([modal('m', [], { x: 100, y: 40, width: 400, height: 2000 })]);
  check('R1.3 a placed modal is capped at the viewport less 64 tall: at y 40 it ends at 876, silent', f.length === 0, show(f));
  f = await findings([modal('m', [], { x: 100, y: 100, width: 400, height: 2000 })]);
  check('R1.3 keep: capped at 836, a tall placed modal at y 100 ends at 936 and warns', f.length === 1 && /400×836/.test(f[0].message), show(f));
  f = await findings([modal('m', [], { x: 100, y: 800, width: 400, height: 300 })]);
  check('R1.3 keep: a placed modal at y 800, 300 tall, warns', f.length === 1 && /bottom edge/.test(f[0].message), show(f));
  const toast = (x: number): SceneNode => ({ id: 'to', name: 'to', type: 'toast', text: 'Saved', x, y: 800, width: 600, height: 40 });
  f = await findings([toast(900)]);
  check('R1.3 a toast is at most 480 wide: x 900 + 600 is silent', f.length === 0, show(f));
  f = await findings([toast(1000)]);
  check('R1.3 keep: at x 1000 its 480px box leaves the right edge', f.length === 1 && /right edge/.test(f[0].message), show(f));
}

// ── M4(f) / S8: nothing under a scrim ──────────────────────────────────────
{
  const menu: SceneNode = { id: 'menu', name: 'menu', type: 'menu', x: 40, y: 40, children: [{ id: 'mr', name: 'mr', type: 'menu-row', label: 'Rename' }] };
  let f = await findings([modal('m'), menu]);
  check('(f) a menu beside a modal warns', f.length === 1 && f[0].nodeId === 'menu' && /under the modal's scrim/.test(f[0].message), show(f));
  f = await findings([modal('m', [menu])]);
  check('(f) a menu inside a modal warns', f.length === 1 && f[0].nodeId === 'menu', show(f));
  f = await findings([menu]);
  check('(f) twin: a menu alone is silent', f.length === 0, show(f));
  const pop: SceneNode = { id: 'pop', name: 'pop', type: 'popover', x: 40, y: 40, children: [text('p', 'Hi')] };
  const drawer = (scrim: boolean): SceneNode => ({ id: 'dr', name: 'dr', type: 'drawer', scrim, children: [text('d', 'Details')] });
  f = await findings([drawer(true), pop]);
  check('(f) a popover with a scrimmed drawer warns', f.length === 1 && f[0].nodeId === 'pop' && /drawer's scrim/.test(f[0].message), show(f));
  f = await findings([drawer(false), pop]);
  check('(f) twin: a drawer without a scrim leaves the popover alone', f.length === 0, show(f));
  f = await findings([modal('m'), { id: 'tip', name: 'tip', type: 'tooltip', text: 'Hi', x: 40, y: 40 }, { id: 'to', name: 'to', type: 'toast', text: 'Saved' }]);
  check('(f) twin: a tooltip and a toast sit above the scrim', f.length === 0, show(f));
}

// ── M5(g, h): toasts ───────────────────────────────────────────────────────
{
  const toast = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id, name: id, type: 'toast', text: 'Saved', ...extra });
  let f = await findings([toast('t1'), toast('t2')]);
  check('(g) two toasts are one info, on the second', f.length === 1 && f[0].nodeId === 't2' && f[0].severity === 'info', show(f));
  f = await findings([toast('t1')]);
  check('(g) twin: one toast is silent', f.length === 0, show(f));
  f = await findings([toast('t1', { tone: 'danger', text: 'Could not save' })]);
  check('(h) a danger toast is an info naming an inline error or banner', f.length === 1 && f[0].severity === 'info' && /inline/.test(f[0].suggestion ?? '') && /banner/.test(f[0].suggestion ?? ''), show(f));
  f = await findings([toast('t1', { tone: 'warning' })]);
  check('(h) twin: a warning toast is silent', f.length === 0, show(f));
}

// ── M5(i): anchors ─────────────────────────────────────────────────────────
{
  const tip = (anchor?: unknown): SceneNode => ({ id: 'tip', name: 'tip', type: 'tooltip', text: 'Rename', x: 40, y: 80, ...(anchor !== undefined ? { anchor } : {}) } as SceneNode);
  const page = [btn('save'), frame('card', [text('c', 'Card')]), { id: 'cb', name: 'cb', type: 'checkbox' } as SceneNode,
    { id: 'tabs', name: 'tabs', type: 'tabs', items: [{ label: 'One', active: true }, { label: 'Two' }] } as SceneNode];
  let f = await findings([...page, tip('nope')]);
  check('(i) an anchor naming no node is an info', f.length === 1 && f[0].severity === 'info' && /names no node/.test(f[0].message), show(f));
  f = await findings([...page, tip('card')]);
  check('(i) an anchor naming a frame is an info', f.length === 1 && /a frame/.test(f[0].message), show(f));
  for (const [name, a] of [['a button', 'save'], ['a control', 'cb'], ['a tabs node', 'tabs']] as const) {
    f = await findings([...page, tip(a)]);
    check(`(i) twin: an anchor naming ${name} is silent`, f.length === 0, show(f));
  }
  for (const [name, a] of [['absent', undefined], ['blank', '  ']] as const) {
    f = await findings([...page, tip(a)]);
    check(`(i) twin: an ${name} anchor is silent`, f.length === 0, show(f));
  }
  // Inside an instance, an anchor resolves within that instance first.
  const comp: SceneNode = frame('cardc', [btn('b'), { id: 'ctip', name: 'ctip', type: 'tooltip', text: 'More', x: 0, y: 0, anchor: 'b' } as SceneNode]);
  const inst = (id: string): SceneNode => ({ id, name: id, type: 'instance', componentId: 'cardc' });
  f = await findings([inst('i1'), inst('i2')], { components: { cardc: comp } });
  check('(i) an anchor between two nodes of one component resolves in each instance', f.length === 0, show(f));
  const stray: SceneNode = frame('strayc', [{ id: 'ctip', name: 'ctip', type: 'tooltip', text: 'More', x: 0, y: 0, anchor: 'missing' } as SceneNode]);
  f = await findings([{ id: 'i1', name: 'i1', type: 'instance', componentId: 'strayc' }], { components: { strayc: stray } });
  check('(i) twin: an unresolvable anchor inside an instance is reported on the instance', f.length === 1 && f[0].nodeId === 'i1' && /names no node/.test(f[0].message), show(f));
  // An anchor naming the instance itself reads its resolved root (a frame).
  f = await findings([inst('i1'), tip('i1')], { components: { cardc: frame('cardc', [btn('b')]) } });
  check('(i) an anchor naming an instance of a frame component is an info', f.length === 1 && /a frame/.test(f[0].message), show(f));
}

// ── M4(e): a detailed run whose overlay has no rect falls back to fast ─────
{
  const root = canvasOf([{ id: 'pop', name: 'pop', type: 'popover', x: 1300, y: 100, width: 320, height: 200, children: [] } as SceneNode]).root;
  const rootRect = { nodeId: 'document', x: 0, y: 0, width: 1440, height: 900 };
  const profile = WINDOW_PROFILES['window-1440'];
  let f = checkOverlays({ root, profile, rects: new Map([['document', rootRect]]) }, new Set());
  check('(e) detailed with no rect for the overlay uses its authored box', f.length === 1 && /right edge/.test(f[0].message), show(f));
  f = checkOverlays({ root, profile, rects: new Map([['document', rootRect], ['pop', { nodeId: 'pop', x: 1000, y: 100, width: 320, height: 200 }]]) }, new Set());
  check('(e) twin: a rendered rect inside the viewport wins over the authored box', f.length === 0, show(f));
  f = checkOverlays({ root, profile, rects: new Map([['document', rootRect], ['pop', { nodeId: 'pop', x: 1121, y: 100, width: 320, height: 200 }]]) }, new Set());
  check('(e) twin: 1px past the edge is rounding (tolerance)', f.length === 0, show(f));
  f = checkOverlays({ root, profile, rects: new Map([['document', rootRect], ['pop', { nodeId: 'pop', x: 1122, y: 100, width: 320, height: 200 }]]) }, new Set());
  check('(e) 2px past the edge in a rendered rect warns', f.length === 1, show(f));
  f = checkOverlays({ root, profile, rects: new Map([['document', { ...rootRect, x: 100, y: 50 }], ['pop', { nodeId: 'pop', x: 1200, y: 150, width: 320, height: 200 }]]) }, new Set());
  check('(e) rendered rects are read relative to the root rect', f.length === 0, show(f));
}

// ── verify round 1: boundaries, severities and fallbacks (mutation survivors) ─
{
  const pop = (extra: Partial<SceneNode>): SceneNode => ({ id: 'pop', name: 'pop', type: 'popover', children: [text('p', 'Hi')], ...extra });
  let f = await findings([pop({ x: 0, y: 0, width: 320, height: 200 })]);
  check('B: a box at exactly x 0, y 0 is inside', f.length === 0, show(f));
  f = await findings([pop({ x: 100, y: 700, width: 320, height: 200 })]);
  check('B: a box ending exactly at the bottom (900) is inside', f.length === 0, show(f));
  f = await findings([pop({ x: 100, y: -2, width: 320, height: 200 })]);
  check('B: a box at y -2 leaves the top edge', f.length === 1 && /top edge/.test(f[0].message), show(f));
  f = await findings([pop({ x: -1, y: 10, width: 320, height: 200 })]);
  check('B: fast mode has no tolerance: x -1 leaves the left edge', f.length === 1 && /left edge/.test(f[0].message), show(f));
  f = await findings([pop({ x: 1121, y: 10, width: 320, height: 200 })]);
  check('B: fast mode has no tolerance: 1px past the right edge warns', f.length === 1 && /right edge/.test(f[0].message), show(f));
  f = await findings([pop({ y: 850, width: 320, height: 100 })]);
  check('B: fast mode skips a box with no x', f.length === 0, show(f));
  f = await findings([modal('m', [], { x: 1300, y: 100, width: 400, height: 300 })]);
  check('B: a placed modal past the right edge warns', f.length === 1 && /right edge/.test(f[0].message), show(f));

  // Detailed rects, injected: root origin y, the fallbacks, the sideways clauses.
  const profile = WINDOW_PROFILES['window-1440'];
  const rect = (nodeId: string, x: number, y: number, width: number, height: number, extra = {}) => ({ nodeId, x, y, width, height, ...extra });
  const popRoot = canvasOf([pop({ x: 100, y: 800, width: 320, height: 100 })]).root;
  f = checkOverlays({ root: popRoot, profile, rects: new Map([['document', rect('document', 0, 100, 1440, 900)], ['pop', rect('pop', 100, 900, 320, 100)]]) }, new Set());
  check('B: rendered y is read from the root rect\'s top (ends at 900 relative)', f.length === 0, show(f));
  f = checkOverlays({ root: popRoot, profile, rects: new Map([['document', rect('document', 0, 100, 1440, 900)], ['pop', rect('pop', 100, 902, 320, 100)]]) }, new Set());
  check('B: twin: 2px further it leaves the bottom', f.length === 1 && /bottom edge/.test(f[0].message), show(f));
  f = checkOverlays({ root: popRoot, profile, rects: new Map([['pop', rect('pop', 100, 0, 320, 100)]]) }, new Set());
  check('B: with no root rect the authored box is used (it fits)', f.length === 0, show(f));
  const tallRoot = canvasOf([pop({ x: 100, y: 850, width: 320, height: 100 })]).root;
  f = checkOverlays({ root: tallRoot, profile, rects: new Map([['pop', rect('pop', 100, 0, 320, 100)]]) }, new Set());
  check('B: twin: with no root rect a leaving authored box warns', f.length === 1 && /bottom edge/.test(f[0].message), show(f));

  const scrollRoot = (extra: Partial<SceneNode>) => canvasOf([modal('m', [frame('scroll', [text('s', 'x')], { overflow: 'auto', ...extra })], { size: 'md' })]).root;
  const modalRect = rect('m', 400, 300, 640, 300);
  const sideways = (frameRect: object | undefined, extra: Partial<SceneNode> = {}) => checkOverlays({
    root: scrollRoot(extra), profile,
    rects: new Map<string, ReturnType<typeof rect>>([['document', rect('document', 0, 0, 1440, 900)], ['m', modalRect], ...(frameRect ? [['scroll', frameRect] as [string, ReturnType<typeof rect>]] : [])]),
  }, new Set());
  f = sideways(rect('scroll', 400, 340, 641, 20));
  check('B: a rendered scroller 1px wider than the modal is rounding', f.length === 0, show(f));
  f = sideways(rect('scroll', 400, 340, 642, 20));
  check('B: 2px wider warns', f.length === 1 && /642px wide in a 640px modal/.test(f[0].message), show(f));
  f = sideways(rect('scroll', 400, 340, 600, 20, { scrollWidth: 601, clientWidth: 600 }));
  check('B: content 1px past the scroller is rounding', f.length === 0, show(f));
  f = sideways(rect('scroll', 400, 340, 600, 20, { scrollWidth: 602, clientWidth: 600 }));
  check('B: content 2px past it scrolls sideways', f.length === 1 && /scrolls sideways/.test(f[0].message), show(f));
  f = sideways(rect('scroll', 400, 340, 500, 20), { minWidth: 900 });
  check('B: a rendered rect wins over an authored minWidth', f.length === 0, show(f));
  f = sideways(undefined, { minWidth: 900 });
  check('B: twin: with no rect for the scroller its minWidth is read', f.length === 1 && /900px wide/.test(f[0].message), show(f));

  f = await findings([modal('m', [{ id: 'box', name: 'box', type: 'rectangle', overflow: 'auto', minWidth: 900, height: 40 } as SceneNode], { size: 'md' })]);
  check('B: only a frame is a scroller (a wide rectangle is not)', f.length === 0, show(f));
  // A navigation list of icon rows is not a table (FR-A5), whatever its length.
  const navRows = Array.from({ length: 12 }, (_, i) => frame(`nr${i}`, [{ id: `ni${i}`, name: 'i', type: 'icon', icon: 'folder' } as SceneNode, text(`nt${i}`, `Folder ${i}`)], { layout: 'horizontal', height: 32 }));
  f = await findings([modal('m', [frame('folders', navRows)], { size: 'lg' })]);
  check('B: 12 icon-led rows in a modal are a list, not a table: silent', f.length === 0, show(f));

  // Every warning and info at its severity.
  const sev = new Map<string, string>();
  const all = await findings([
    { id: 'tip', name: 'tip', type: 'tooltip', text: 'x', x: 10, y: 10, children: [text('tc', 'child')] } as SceneNode,
    modal('m', [frame('tbl', [frame('h', [text('h1', 'A', { fontWeight: 600 }), text('h2', 'B', { fontWeight: 600 })], { layout: 'horizontal' }),
      ...Array.from({ length: 11 }, (_, i) => frame(`r${i}`, [text(`a${i}`, 'a'), text(`b${i}`, 'b')], { layout: 'horizontal' }))]),
      frame('scroll', [text('s', 'x')], { overflow: 'auto', minWidth: 2000 })], { size: 'lg' }),
    { id: 'menu', name: 'menu', type: 'menu', x: 10, y: 10, children: [] } as SceneNode,
    pop({ id: 'off', x: 1300, y: 10, width: 320, height: 100, anchor: 'tbl' }),
  ]);
  for (const i of all) sev.set(`${i.nodeId}:${/text only/.test(i.message) ? 'tip' : /scrim/.test(i.message) ? 'scrim' : /viewport/.test(i.message) ? 'view' : /rows inside/.test(i.message) ? 'table' : /sideways|wide in a/.test(i.message) ? 'scroll' : /anchored/.test(i.message) ? 'anchor' : 'other'}`, i.severity);
  const want: Record<string, string> = { 'tip:tip': 'warning', 'tbl:table': 'warning', 'scroll:scroll': 'warning', 'menu:scrim': 'warning', 'off:scrim': 'warning', 'off:view': 'warning', 'off:anchor': 'info' };
  const got = Object.fromEntries(sev);
  check('B: each finding at its severity (tooltip, table, scroller, scrim, viewport warn; anchor info)', JSON.stringify(got, Object.keys(want).sort()) === JSON.stringify(want, Object.keys(want).sort()) && sev.size === Object.keys(want).length, JSON.stringify(got));

  // Twins for earlier passes.
  f = await findings([{ id: 'i1', name: 'i1', type: 'instance', componentId: 'bc' }, { id: 'tip', name: 'tip', type: 'tooltip', text: 'x', x: 10, y: 80, anchor: 'i1' } as SceneNode],
    { components: { bc: btn('bc') } });
  check('B: an anchor naming an instance of a button component is silent', f.length === 0, show(f));
  const r = await evaluateCanvas(canvasOf([modal('m1'), modal('m2')]), { mode: 'fast', categories: ['usability'] });
  check('B: twin: the categories filter with usability raises it', r.issues.some((i) => i.rule === RULE));
}

// ── only desktop-app runs it; the categories filter ────────────────────────
{
  const bad = [modal('m1'), modal('m2'), { id: 'to', name: 'to', type: 'toast', text: 'x', tone: 'danger' } as SceneNode];
  for (const type of ['web', 'mobile'] as const) {
    const f = await findings(bad, { type });
    check(`the rule is silent on ${type}`, f.length === 0, show(f));
  }
  check('twin: the same canvas on desktop-app raises it', (await findings(bad)).length === 2);
  const r = await evaluateCanvas(canvasOf(bad), { mode: 'fast', categories: ['structure', 'color'] });
  check('the categories filter without usability skips it', r.issues.every((i) => i.rule !== RULE));
}

// ── M7: the acceptance stand-ins ───────────────────────────────────────────
async function standIn(overlay: (c: Canvas) => SceneNode[]): Promise<{ overlay: EvaluationIssue[]; blocking: EvaluationIssue[] }> {
  const c = createCanvas('accept', undefined, {}, { type: 'desktop-app' });
  applyStructure(c, 'list-detail');
  c.root.children = [...(c.root.children ?? []), ...overlay(c)];
  const r = await evaluateCanvas(c, { mode: 'fast' });
  return { overlay: r.issues.filter((i) => i.rule === RULE), blocking: r.issues.filter((i) => i.severity !== 'info') };
}
{
  const confirm = await standIn(() => [{
    id: 'confirm', name: 'Confirm delete', type: 'modal', title: 'Delete project?', size: 'sm',
    actions: [{ label: 'Cancel' }, { label: 'Delete', variant: 'destructive' }],
    children: [{ id: 'confirm-body', name: 'Body', type: 'text', content: 'This removes the project and its 12 canvases. You cannot undo this.', fontSize: 14, color: '$text-secondary' }],
  } as SceneNode]);
  check('M7: confirm-delete raises no desktop-app-overlay finding (fast)', confirm.overlay.length === 0, show(confirm.overlay));
  console.log(`      confirm-delete blocking findings (any rule): ${confirm.blocking.length} ${show(confirm.blocking)}`);
  const comment = await standIn(() => [
    { id: 'comment-btn', name: 'Comment', type: 'button', label: 'Comment', variant: 'secondary', size: 'sm', icon: 'message-square', position: 'absolute', x: 1200, y: 120 } as SceneNode,
    {
      id: 'comment', name: 'Comment', type: 'popover', anchor: 'comment-btn', x: 1000, y: 160, size: 'sm', gap: 8,
      children: [
        { id: 'comment-input', name: 'Comment', type: 'text-input', label: 'Comment', placeholder: 'Add a comment' } as SceneNode,
        frame('comment-actions', [btn('Cancel', { variant: 'ghost' }), btn('Post', { variant: 'primary' })], { layout: 'horizontal', gap: 8, justifyContent: 'flex-end' }),
      ],
    } as SceneNode,
  ]);
  check('M7: comment-open raises no desktop-app-overlay finding (fast)', comment.overlay.length === 0, show(comment.overlay));
  console.log(`      comment-open blocking findings (any rule): ${comment.blocking.length} ${show(comment.blocking)}`);
}

// M7 failing twins: the same stand-ins broken on one axis.
{
  const twice = await standIn(() => ['a', 'b'].map((k) => ({ id: `confirm-${k}`, name: 'Confirm', type: 'modal', title: 'Delete project?', size: 'sm', actions: [{ label: 'Cancel' }, { label: 'Delete', variant: 'destructive' }] } as SceneNode)));
  check('M7 twin: confirm-delete with a second modal warns', twice.overlay.length === 1 && twice.overlay[0].severity === 'warning', show(twice.overlay));
  const toFrame = await standIn((c) => [{ id: 'comment', name: 'Comment', type: 'popover', anchor: c.root.children![0].id, x: 1000, y: 160, size: 'sm', children: [] } as SceneNode]);
  check('M7 twin: comment-open anchored to a frame is an info', toFrame.overlay.length === 1 && toFrame.overlay[0].severity === 'info' && /anchored/.test(toFrame.overlay[0].message), show(toFrame.overlay));
}

check('every desktop-app-overlay finding is category usability', wrongCategory.length === 0, wrongCategory.join(', '));

console.log(allPass ? '\nAll desktop-app-overlay tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
