// Phase 31 slice F — desktop-app-overlay (FR-F1) in detailed mode, on
// rendered rects: overlays with no authored size that leave the viewport, a
// drawer wider than the window, sideways scrolling inside a modal, and the
// two acceptance stand-ins (M7). Each detailed finding has a fast-mode twin
// that stays silent, and each pass a failing twin. Needs Chrome.
//
// Usage: npx tsx test-desktop-app-overlay-detailed.ts

import './test-env.js';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { createCanvas } from './src/scene-graph.js';
import { shutdown } from './src/screenshot.js';
import { applyStructure } from './src/structures.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function canvasOf(children: SceneNode[]): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables: {}, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, children },
    metadata: { surface: { type: 'desktop-app', device: 'window-1440' } },
  } as Canvas;
}
const RULE = 'desktop-app-overlay';
async function findings(children: SceneNode[], mode: 'fast' | 'detailed' = 'detailed'): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(canvasOf(children), { mode });
  return r.issues.filter((i) => i.rule === RULE);
}
const show = (f: EvaluationIssue[]) => JSON.stringify(f.map((i) => `${i.severity} ${i.nodeId}: ${i.message}`));
const text = (id: string, content: string, extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'text', content, fontSize: 14, color: '#111111', ...extra });
const frame = (id: string, children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, name: id, type: 'frame', layout: 'vertical', children, ...extra });
const LONG = 'Rename this canvas; the new name shows in the gallery and in every link that points at it';

// ── M4(e): rendered boxes ──────────────────────────────────────────────────
{
  const tip = (x: number): SceneNode => ({ id: 'tip', name: 'tip', type: 'tooltip', text: LONG, x, y: 100 });
  let f = await findings([tip(1300)]);
  check('(e) a wrapped tooltip placed at x 1300 leaves the right edge (rendered)', f.length === 1 && f[0].nodeId === 'tip' && /right edge/.test(f[0].message), show(f));
  f = await findings([tip(1300)], 'fast');
  check('(e) twin: fast mode cannot size it, so it is silent', f.length === 0, show(f));
  f = await findings([tip(1100)]);
  check('(e) twin: at x 1100 the 240px tooltip fits', f.length === 0, show(f));

  const pop = (y: number): SceneNode => ({ id: 'pop', name: 'pop', type: 'popover', x: 200, y, children: Array.from({ length: 8 }, (_, i) => text(`p${i}`, `Option ${i + 1}`)) });
  f = await findings([pop(780)]);
  check('(e) a popover whose content runs past the bottom warns (rendered height)', f.length === 1 && /bottom edge/.test(f[0].message), show(f));
  f = await findings([pop(200)]);
  check('(e) twin: placed higher it fits', f.length === 0, show(f));

  f = await findings([{ id: 'dr', name: 'dr', type: 'drawer', minWidth: 1600, children: [text('d', 'Details')] }]);
  check('(e) a drawer with a minWidth past the window leaves its left edge (rendered)', f.length === 1 && /left edge/.test(f[0].message), show(f));
  f = await findings([{ id: 'dr', name: 'dr', type: 'drawer', width: 1600, children: [text('d', 'Details')] }]);
  check('(e) twin: a bare 1600px drawer width is squeezed to the window, so it is silent', f.length === 0, show(f));

  f = await findings([{ id: 'm', name: 'm', type: 'modal', title: 'Rename', width: 1420, children: [text('b', 'Body')] }]);
  check('(e) a modal wider than the viewport less 32 warns in detailed mode too', f.length === 1 && /squeezes it to 1408px/.test(f[0].message), show(f));
  f = await findings([{ id: 'm', name: 'm', type: 'modal', title: 'Rename', size: 'lg', children: [text('b', 'Body')] }, { id: 'to', name: 'to', type: 'toast', text: 'Saved' }]);
  check('(e) twin: a centred modal and a default toast sit inside the viewport (scrim not judged)', f.length === 0, show(f));
}

// ── verify round 2: what fast mode leaves to detailed, and agreement ───────
{
  let f = await findings([{ id: 'tip', name: 'tip', type: 'tooltip', text: LONG, x: -4, y: 100 }]);
  check('R2 a tooltip past the left edge warns in detailed mode', f.length === 1 && /left edge/.test(f[0].message), show(f));
  f = await findings([{ id: 'to', name: 'to', type: 'toast', text: LONG, x: 1200, y: 800 }]);
  check('R2 a placed toast hugging long text past the right edge warns in detailed mode', f.length === 1 && /right edge/.test(f[0].message), show(f));
  f = await findings([{ id: 'to', name: 'to', type: 'toast', text: 'Saved', x: 1200, y: 800 }]);
  check('R2 twin: a short toast there fits', f.length === 0, show(f));
  const body = (n: number) => Array.from({ length: n }, (_, i) => text(`b${i}`, `Paragraph ${i} of the dialog body, long enough to take a line.`));
  f = await findings([{ id: 'm', name: 'm', type: 'modal', title: 'Tall', size: 'sm', x: 100, y: 100, children: body(60) }]);
  check('R2 a placed modal with tall content at y 100 leaves the bottom (capped at 836)', f.length === 1 && /bottom edge/.test(f[0].message), show(f));
  f = await findings([{ id: 'm', name: 'm', type: 'modal', title: 'Short', size: 'sm', x: 100, y: 700, height: 300, children: body(1) } as SceneNode]);
  check('R2 twin: a short placed modal at y 700 fits whatever its authored height', f.length === 0, show(f));

  // Fast and detailed agree wherever fast mode boxes an overlay.
  const scenes: Array<[string, SceneNode]> = [
    ['popover in', { id: 'o', name: 'o', type: 'popover', x: 1120, y: 100, width: 320, height: 200, children: [] }],
    ['popover out', { id: 'o', name: 'o', type: 'popover', x: 1200, y: 100, width: 320, height: 200, children: [] }],
    ['popover shrunk', { id: 'o', name: 'o', type: 'popover', x: 0, y: 0, width: 2000, height: 100, children: [] }],
    ['popover none', { id: 'o', name: 'o', type: 'popover', x: 0, y: 0, width: 2000, height: 100, maxWidth: 'none', children: [] }],
    ['popover 50%', { id: 'o', name: 'o', type: 'popover', x: 700, y: 0, width: 2000, height: 100, maxWidth: '50%', children: [] }],
    ['popover minWidth', { id: 'o', name: 'o', type: 'popover', x: 0, y: 0, width: 300, height: 100, minWidth: 1500, children: [] }],
    ['menu floor', { id: 'o', name: 'o', type: 'menu', x: 1300, y: 10, width: 100, height: 100, children: [] }],
    ['menu fits', { id: 'o', name: 'o', type: 'menu', x: 1248, y: 10, width: 100, height: 100, children: [] }],
    ['popover bottom', { id: 'o', name: 'o', type: 'popover', x: 100, y: 850, width: 320, height: 100, children: [] }],
    ['modal right', { id: 'o', name: 'o', type: 'modal', title: 'x', size: 'sm', x: 1100, y: 100, children: [text('mb', 'Body')] }],
  ];
  for (const [name, node] of scenes) {
    const [fast, det] = [await findings([node], 'fast'), await findings([node])];
    check(`R2 fast and detailed agree: ${name}`, fast.length === det.length, `fast ${show(fast)} detailed ${show(det)}`);
  }
}

// ── M4(d): sideways scrolling inside a modal ───────────────────────────────
{
  const strip = (w: number) => frame('scroll', [frame('row', [text('r', 'Wide row')], { minWidth: w, height: 40, layout: 'horizontal' })], { overflow: 'auto', width: '100%' } as Partial<SceneNode>);
  const m = (child: SceneNode): SceneNode => ({ id: 'm', name: 'm', type: 'modal', title: 'Columns', size: 'md', children: [child] });
  let f = await findings([m(strip(900))]);
  check('(d) a full-width scroller whose content is 900px scrolls sideways in a 640px modal', f.length === 1 && f[0].nodeId === 'scroll' && /scrolls sideways/.test(f[0].message), show(f));
  f = await findings([m(strip(900))], 'fast');
  check('(d) twin: fast mode has no numeric width to compare, so it is silent', f.length === 0, show(f));
  f = await findings([m(strip(400))]);
  check('(d) twin: 400px of content does not scroll', f.length === 0, show(f));
  f = await findings([m(frame('scroll', [text('w', 'x')], { overflow: 'auto', minWidth: 900 }))]);
  check('(d) a 900px minWidth scroller renders wider than the modal', f.length === 1 && /900px wide in a 640px modal/.test(f[0].message), show(f));
  f = await findings([m(frame('scroll', [text('w', 'x')], { overflow: 'auto', width: 900 }))]);
  check('(d) twin: a bare 900px width renders squeezed to the modal, so it is silent', f.length === 0, show(f));
}

// ── M7: the acceptance stand-ins, detailed ─────────────────────────────────
async function standIn(overlay: SceneNode[]): Promise<{ overlay: EvaluationIssue[]; blocking: EvaluationIssue[] }> {
  const c = createCanvas('accept', undefined, {}, { type: 'desktop-app' });
  applyStructure(c, 'list-detail');
  c.root.children = [...(c.root.children ?? []), ...overlay];
  const r = await evaluateCanvas(c, { mode: 'detailed' });
  return { overlay: r.issues.filter((i) => i.rule === RULE), blocking: r.issues.filter((i) => i.severity !== 'info') };
}
{
  const confirm = await standIn([{
    id: 'confirm', name: 'Confirm delete', type: 'modal', title: 'Delete project?', size: 'sm',
    actions: [{ label: 'Cancel' }, { label: 'Delete', variant: 'destructive' }],
    children: [{ id: 'confirm-body', name: 'Body', type: 'text', content: 'This removes the project and its 12 canvases. You cannot undo this.', fontSize: 14, color: '$text-secondary' }],
  } as SceneNode]);
  check('M7: confirm-delete raises no desktop-app-overlay finding (detailed)', confirm.overlay.length === 0, show(confirm.overlay));
  console.log(`      confirm-delete blocking findings (any rule): ${confirm.blocking.length} ${show(confirm.blocking)}`);
  const comment = await standIn([
    { id: 'comment-btn', name: 'Comment', type: 'button', label: 'Comment', variant: 'secondary', size: 'sm', icon: 'message-square', position: 'absolute', x: 1200, y: 120 } as SceneNode,
    {
      id: 'comment', name: 'Comment', type: 'popover', anchor: 'comment-btn', x: 1000, y: 160, size: 'sm', gap: 8,
      children: [
        { id: 'comment-input', name: 'Comment', type: 'text-input', label: 'Comment', placeholder: 'Add a comment' } as SceneNode,
        frame('comment-actions', [
          { id: 'cancel', name: 'Cancel', type: 'button', label: 'Cancel', variant: 'ghost', size: 'sm' } as SceneNode,
          { id: 'post', name: 'Post', type: 'button', label: 'Post', variant: 'primary', size: 'sm' } as SceneNode,
        ], { layout: 'horizontal', gap: 8, justifyContent: 'flex-end' }),
      ],
    } as SceneNode,
  ]);
  check('M7: comment-open raises no desktop-app-overlay finding (detailed)', comment.overlay.length === 0, show(comment.overlay));
  console.log(`      comment-open blocking findings (any rule): ${comment.blocking.length} ${show(comment.blocking)}`);
}

await shutdown();
console.log(allPass ? '\nAll desktop-app-overlay detailed tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
