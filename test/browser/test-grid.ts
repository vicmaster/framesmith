// Phase 26 slice A — grid authoring: template forms, span placement,
// sanitization, responsive collapse (string + real Chrome geometry), and the
// table-detector guard. The bento taste gate itself lives in test-patterns.
//
// Usage: npx tsx test/browser/test-grid.ts   (the collapse geometry checks need Chrome)

import '../env.js';
import { renderToHtml } from '../../src/renderer.js';
import { resolveVariables } from '../../src/variables.js';
import { computeLayout, shutdown } from '../../src/screenshot.js';
import { extractInventory } from '../../src/drift.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import type { SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const render = (children: SceneNode[], extra: Partial<SceneNode> = {}): string =>
  renderToHtml({ id: 'doc', type: 'document', children: [{ id: 'g', type: 'frame', layout: 'grid', ...extra, children }] } as SceneNode, 800, 600);
const tile = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id, type: 'frame', height: 100, ...extra } as SceneNode);

// ── template forms ──────────────────────────────────────────────────────────
{
  check('count → equal minmax columns', render([tile('a')], { gridColumns: 3 }).includes('grid-template-columns: repeat(3, minmax(0, 1fr))'));
  check('array mixes fr weights and px', render([tile('a')], { gridColumns: [2, 1, '240px'] }).includes('grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) 240px'));
  check('safe string passes through', render([tile('a')], { gridColumns: 'repeat(2, 1fr) 200px' }).includes('grid-template-columns: repeat(2, 1fr) 200px'));
  check('no template → one column per child', render([tile('a'), tile('b')]).includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  check('unsafe string → equal-column fallback, never injected', (() => {
    const html = render([tile('a')], { gridColumns: 'url(x); background: red' });
    return html.includes('repeat(1, minmax(0, 1fr))') && !html.includes('url(x)');
  })());
  check('unsafe array entry → equal-column fallback', render([tile('a')], { gridColumns: [1, '"><script>'] as never }).includes('repeat(2, minmax(0, 1fr))'));
}

// ── placement ───────────────────────────────────────────────────────────────
{
  const html = render([
    tile('a', { gridColumn: 3 }),
    tile('b', { gridColumn: 'span 2', gridRow: '1 / 3' }),
    tile('c', { gridColumn: '2; inject: bad' }),
  ], { gridColumns: 4, rowGap: 12 });
  check('numeric placement means span', html.includes('grid-column: span 3'));
  check('span/line strings pass through', html.includes('grid-column: span 2') && html.includes('grid-row: 1 / 3'));
  check('unsafe placement dropped', !html.includes('inject'));
  check('rowGap renders', html.includes('row-gap: 12px'));
}

// ── responsive collapse ─────────────────────────────────────────────────────
{
  const html = render([tile('a', { gridColumn: 2 }), tile('b')], { gridColumns: 3, responsive: 'stack' });
  check('stack emits the grid collapse media rule', html.includes('grid-template-columns: minmax(0, 1fr) !important'));
  check('stack resets child spans', html.includes('grid-column: auto !important'));

  const canvas = createCanvas('Grid Collapse');
  canvas.root.width = 800; canvas.root.height = 600;
  parseAndExecute(canvas.root, `
g=I("document", { type: "frame", layout: "grid", gridColumns: 2, gap: 16, responsive: "stack", width: "100%" })
a=I(g, { type: "frame", height: 80, fill: "#EEE" })
b=I(g, { type: "frame", height: 80, fill: "#DDD" })
`, canvas);
  const resolved = resolveVariables(structuredClone(canvas.root), {});
  const wide = renderToHtml(resolved, 800, 600, canvas);
  const layoutWide = await computeLayout(wide, undefined, 10, { width: 800, height: 600 });
  const layoutNarrow = await computeLayout(wide, undefined, 10, { width: 390, height: 600 });
  const flat = (rects: typeof layoutWide): Map<string, { x: number; y: number; width: number }> => {
    const out = new Map();
    (function walk(rs: typeof layoutWide) { for (const r of rs) { out.set(r.nodeId, r); if (r.children) walk(r.children); } })(rects);
    return out;
  };
  const w = flat(layoutWide);
  const n = flat(layoutNarrow);
  const [aId, bId] = [canvas.root.children![0].children![0].id, canvas.root.children![0].children![1].id];
  check('desktop: tiles side by side', w.get(aId)!.y === w.get(bId)!.y && w.get(bId)!.x > w.get(aId)!.x);
  check('mobile: tiles stacked full-width', n.get(bId)!.y > n.get(aId)!.y && Math.abs(n.get(aId)!.x - n.get(bId)!.x) < 2);
}

// ── detector + evaluator interplay ──────────────────────────────────────────
{
  // A grid whose tiles would pattern-match as table rows (same-shaped frames
  // with header-ish first texts) must NOT read as a table.
  const gridDoc: SceneNode = { id: 'doc', type: 'document', children: [{
    id: 'g', type: 'frame', layout: 'grid', gridColumns: 2,
    children: [
      { id: 't1', type: 'frame', children: [{ id: 't1a', type: 'text', content: 'REVENUE' }, { id: 't1b', type: 'text', content: 'Details' }] },
      { id: 't2', type: 'frame', children: [{ id: 't2a', type: 'text', content: 'GROWTH' }, { id: 't2b', type: 'text', content: 'Details' }] },
    ],
  }] } as SceneNode;
  check('grid container is never a table', extractInventory(gridDoc).tables.length === 0);

  const c = createCanvas('Grid Layout Check');
  parseAndExecute(c.root, `
g=I("document", { type: "frame", layout: "grid", gridColumns: 2, gap: 16 })
I(g, { type: "frame", height: 80 })
I(g, { type: "frame", height: 80 })
`, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['consistency'] });
  check('grid satisfies the missing-layout check', !r.issues.some((i) => i.message.includes('no layout')), JSON.stringify(r.issues));
}

await shutdown();
console.log(allPass ? '\nAll grid tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
