import './test-env.js';
/**
 * Phase 31 slice D — the pieces around the desktop-app realisations, each pass
 * with a twin that must fail:
 *   - spec change S5: `many` / `empty` act on desktop-app rows and card grids
 *     on a desktop-app canvas only, and a tripled list keeps one active row;
 *   - a property-row's label names its control (and only its own label does);
 *   - the coverage loading hint names skeleton-table-app on desktop-app.
 * No Chrome. Run with: npx tsx test-desktop-structures.ts
 */
import { applyPerturbation } from './src/stress.js';
import { createCanvas } from './src/scene-graph.js';
import { applyStructure } from './src/structures.js';
import { evaluateCanvas } from './src/evaluate.js';
import type { SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const doc = (children: SceneNode[]): SceneNode => ({ id: 'document', type: 'document', children });
const count = (root: SceneNode, pred: (n: SceneNode) => boolean): number =>
  (pred(root) ? 1 : 0) + (root.children ?? []).reduce((sum, c) => sum + count(c, pred), 0);

// ── S5: desktop-app stress runs ─────────────────────────────────────────────
{
  const nav: SceneNode = {
    id: 'nav', type: 'frame', layout: 'vertical', children: [
      { id: 'a', type: 'nav-item', label: 'A', active: true },
      { id: 'b', type: 'nav-item', label: 'B' },
      { id: 'c', type: 'nav-item', label: 'C' },
    ],
  };
  const app = applyPerturbation('many', doc([nav]), { type: 'desktop-app' });
  check('many triples a run of nav-items on desktop-app', count(app.root, (n) => n.type === 'nav-item') === 9 && app.touched.includes('nav'));
  check('a tripled nav keeps exactly one active item', count(app.root, (n) => n.active === true) === 1);
  const web = applyPerturbation('many', doc([nav]), { type: 'web' });
  check('twin: web leaves nav-items alone', count(web.root, (n) => n.type === 'nav-item') === 3 && web.touched.length === 0);
  const empty = applyPerturbation('empty', doc([nav]), { type: 'desktop-app' });
  check('empty removes the run on desktop-app', count(empty.root, (n) => n.type === 'nav-item') === 0);

  for (const t of ['tree-row', 'menu-row', 'property-row'] as const) {
    const run = doc([{ id: 'r', type: 'frame', children: [{ id: 'r1', type: t, label: 'x' }, { id: 'r2', type: t, label: 'y' }] }]);
    check(`many triples a run of ${t}`, count(applyPerturbation('many', run, { type: 'desktop-app' }).root, (n) => n.type === t) === 6);
  }
  const mixed = doc([{ id: 'm', type: 'frame', children: [{ id: 'm1', type: 'nav-item', label: 'x' }, { id: 'm2', type: 'tree-row', label: 'y', depth: 0 }] }]);
  check('twin: two rows of different types are no run', applyPerturbation('many', mixed, { type: 'desktop-app' }).touched.length === 0);

  const card = (id: string): SceneNode => ({ id, type: 'frame', children: [{ id: `${id}-t`, type: 'text', content: 'Title' }] });
  const grid = doc([{ id: 'g', type: 'frame', layout: 'grid', children: [card('k1'), card('k2'), card('k3')] }]);
  const tripled = applyPerturbation('many', grid, { type: 'desktop-app' });
  check('many triples a card grid on desktop-app', tripled.root.children?.[0].children?.length === 9 && tripled.touched.includes('g'));
  check('twin: web leaves the card grid alone', applyPerturbation('many', grid, { type: 'web' }).root.children?.[0].children?.length === 3);
  const two = doc([{ id: 'g2', type: 'frame', layout: 'grid', children: [card('k1'), card('k2')] }]);
  check('twin: a grid of two cards is not a card grid', applyPerturbation('many', two, { type: 'desktop-app' }).touched.length === 0);
  const odd = doc([{ id: 'g3', type: 'frame', layout: 'grid', children: [card('k1'), card('k2'), { id: 'k3', type: 'text', content: 'x' }] }]);
  check('twin: a grid with a differently shaped child is not a card grid', applyPerturbation('many', odd, { type: 'desktop-app' }).touched.length === 0);
}

// ── a property-row's label names its control ────────────────────────────────
{
  const unlabeled = async (rows: SceneNode[]) => {
    const c = createCanvas('pr', undefined, {}, { type: 'desktop-app' });
    c.root.children = [{ id: 'group', type: 'frame', layout: 'vertical', children: rows }];
    return (await evaluateCanvas(c, { mode: 'fast', categories: ['usability'] })).issues.filter((i) => /has no text label/.test(i.message)).map((i) => i.nodeId);
  };
  check('a toggle in a labelled property-row is labelled', (await unlabeled([{ id: 'r', type: 'property-row', label: 'Visible', children: [{ id: 't', type: 'toggle' }] }])).length === 0);
  check('twin: a toggle in a blank-labelled property-row is not',
    (await unlabeled([{ id: 'r', type: 'property-row', label: ' ', children: [{ id: 't', type: 'toggle' }] }])).includes('t'));
  check('twin: a sibling row\'s label does not rescue a blank one', (await unlabeled([
    { id: 'r1', type: 'property-row', label: 'Name', children: [{ id: 'v', type: 'text', content: 'Value' }] },
    { id: 'r2', type: 'property-row', label: '', children: [{ id: 't', type: 'toggle' }] },
  ])).includes('t'));
}

// ── the coverage loading hint names the desktop-app skeleton ───────────────
{
  const hint = async (type: 'web' | 'desktop-app', structure: string) => {
    const c = createCanvas('cov', undefined, {}, type === 'web' ? undefined : { type });
    applyStructure(c, structure);
    return (await evaluateCanvas(c, { mode: 'fast', categories: ['coverage'] })).issues.find((i) => /"loading"/.test(i.message))?.suggestion ?? '';
  };
  check('on desktop-app the loading hint names skeleton-table-app', /skeleton-table-app/.test(await hint('desktop-app', 'data-table')));
  const web = await hint('web', 'data-table');
  check('twin: on web it names skeleton-table', /skeleton-table \(/.test(web) && !/skeleton-table-app/.test(web), web);
}

console.log(allPass ? '\nAll desktop-structure tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
