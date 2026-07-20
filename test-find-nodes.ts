import './test-env.js';
// Phase 22 slice B (#136) — find_nodes: locate nodes by property/text/name.
// Pure scene-graph level (no server boot, no Chrome).
//
// Usage: npx tsx test-find-nodes.ts

import { createCanvas, insertNode, findNodesDetailed } from './src/scene-graph.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

// A pace-card fixture mirroring the #136 bug report: a big value text next to
// an icon, inside named containers, plus decoys elsewhere.
const canvas = createCanvas('find-nodes-test');
const root = canvas.root;
const card = insertNode(root, root.id, { type: 'frame', name: 'PaceCard', layout: 'vertical' });
const row = insertNode(root, card.id, { type: 'frame', layout: 'horizontal' });
const icon = insertNode(root, row.id, { type: 'icon', icon: 'trending-up', iconSize: 30 });
const value = insertNode(root, row.id, { type: 'text', content: '$1.52M', fontSize: 30, name: 'Value' });
const caption = insertNode(root, card.id, { type: 'text', content: 'of $2.7M goal', fontSize: 13 });
const table = insertNode(root, root.id, { type: 'frame', name: 'YearTable', layout: 'vertical' });
const cell = insertNode(root, table.id, { type: 'text', content: 'Row $1.52m total', fontSize: 13 });

// ── the #136 bug, solved ─────────────────────────────────────────────────────
{
  const hits = findNodesDetailed(root, { match: { fontSize: 30 }, type: 'text' });
  check('match + type isolates the value text (not the size-30 icon)',
    hits.length === 1 && hits[0].node.id === value.id, `got ${hits.length}`);
  check('path names the ancestor chain',
    hits[0]?.path === 'Document / PaceCard / frame / Value', hits[0]?.path);
}

// ── predicates ───────────────────────────────────────────────────────────────
{
  const byText = findNodesDetailed(root, { text: '$1.52M' });
  check('text match is case-insensitive substring', byText.length === 2
    && byText.some((h) => h.node.id === value.id) && byText.some((h) => h.node.id === cell.id), `got ${byText.length}`);

  const byTextScoped = findNodesDetailed(root, { text: '$1.52M', scopeId: card.id });
  check('scope narrows a text match', byTextScoped.length === 1 && byTextScoped[0].node.id === value.id);

  const byName = findNodesDetailed(root, { name: 'YearTable' });
  check('name is exact match', byName.length === 1 && byName[0].node.id === table.id);
  check('name does not substring-match', findNodesDetailed(root, { name: 'Year' }).length === 0);

  const anded = findNodesDetailed(root, { match: { fontSize: 13 }, text: 'goal' });
  check('match + text AND together', anded.length === 1 && anded[0].node.id === caption.id);

  const byType = findNodesDetailed(root, { type: 'icon' });
  check('type-only query works', byType.length === 1 && byType[0].node.id === icon.id);

  check('text never matches non-content nodes', findNodesDetailed(root, { text: 'trending' }).length === 0);

  const scopeSelf = findNodesDetailed(root, { name: 'PaceCard', scopeId: card.id });
  check('scope is inclusive of the scope node', scopeSelf.length === 1 && scopeSelf[0].node.id === card.id);
  check('scoped path is relative to the scope root', scopeSelf[0]?.path === 'PaceCard', scopeSelf[0]?.path);

  let threw = false;
  try { findNodesDetailed(root, { text: 'x', scopeId: 'nope' }); } catch { threw = true; }
  check('missing scope node throws', threw);

  check('document order preserved', (() => {
    const all = findNodesDetailed(root, { type: 'text' });
    return all.map((h) => h.node.id).join(',') === [value.id, caption.id, cell.id].join(',');
  })());
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
