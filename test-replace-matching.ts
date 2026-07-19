import './test-env.js';
// Issue #127 — bulk property replace: collectMatchingNodes + replaceMatchingProperties.
// Pure scene-graph level (no server boot, no Chrome).
//
// Usage: npx tsx test-replace-matching.ts

import { createCanvas, insertNode, collectMatchingNodes, replaceMatchingProperties } from './src/scene-graph.js';
import type { SceneNode } from './src/types.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

// A 3-row × 2-col "table" of width-110 text cells, plus decoys.
const canvas = createCanvas('bulk-replace-test');
const root = canvas.root;
const table = insertNode(root, root.id, { type: 'frame', name: 'Table', layout: 'vertical' });
const cellIds: string[] = [];
for (let r = 0; r < 3; r++) {
  const row = insertNode(root, table.id, { type: 'frame', name: `Row ${r}`, layout: 'horizontal' });
  for (let c = 0; c < 2; c++) {
    cellIds.push(insertNode(root, row.id, { type: 'text', content: `cell ${r}.${c}`, width: 110, fill: '$surface' }).id);
  }
}
// Decoys: a width-110 FRAME inside the table, and a width-110 text OUTSIDE it.
const decoyFrame = insertNode(root, table.id, { type: 'frame', name: 'DecoyFrame', width: 110 });
const outsideText = insertNode(root, root.id, { type: 'text', content: 'outside', width: 110 });
// Structured-value node for shape matching.
const shadowed = insertNode(root, root.id, { type: 'frame', name: 'Shadowed', shadows: [{ x: 0, y: 2, blur: 8, color: '#0002' }] });

// ── matching ────────────────────────────────────────────────────────────────
{
  const all = collectMatchingNodes(root, { width: 110 });
  check('bare match finds cells + both decoys', all.length === 8, `got ${all.length}`);

  const typed = collectMatchingNodes(root, { width: 110 }, { type: 'text' });
  check('type filter drops the frame decoy', typed.length === 7, `got ${typed.length}`);

  const scoped = collectMatchingNodes(root, { width: 110 }, { scopeId: table.id, type: 'text' });
  check('scope + type isolates the 6 cells', scoped.length === 6 && scoped.every((n) => cellIds.includes(n.id)), `got ${scoped.length}`);

  const anded = collectMatchingNodes(root, { width: 110, content: 'cell 0.0' });
  check('AND across keys narrows to one node', anded.length === 1 && anded[0].id === cellIds[0], `got ${anded.length}`);

  const byToken = collectMatchingNodes(root, { fill: '$surface' });
  check('token refs match literally', byToken.length === 6, `got ${byToken.length}`);

  const byShape = collectMatchingNodes(root, { shadows: [{ x: 0, y: 2, blur: 8, color: '#0002' }] });
  check('structured values match by shape', byShape.length === 1 && byShape[0].id === shadowed.id, `got ${byShape.length}`);

  const none = collectMatchingNodes(root, { width: 999 });
  check('no-hit predicate returns empty', none.length === 0, `got ${none.length}`);

  const inclusive = collectMatchingNodes(root, { name: 'Table' }, { scopeId: table.id });
  check('scope is inclusive of the scope node itself', inclusive.length === 1 && inclusive[0].id === table.id);

  let threw = false;
  try { collectMatchingNodes(root, { width: 110 }, { scopeId: 'nope' }); } catch { threw = true; }
  check('missing scope node throws', threw);
}

// ── replacing ───────────────────────────────────────────────────────────────
{
  const replaced = replaceMatchingProperties(root, { width: 110 }, { width: '100%' }, { scopeId: table.id, type: 'text' });
  check('replace returns the mutated nodes', replaced.length === 6);
  check('every cell now width 100%', cellIds.every((id) => collectMatchingNodes(root, { width: '100%' }).some((n) => n.id === id)));
  check('decoy frame untouched', decoyFrame.width === 110);
  check('outside text untouched', outsideText.width === 110);

  // id/type in `set` are stripped, matching updateNode's safety rule.
  const before = cellIds[0];
  replaceMatchingProperties(root, { content: 'cell 0.0' }, { id: 'hijack', type: 'frame', fontSize: 13 } as Partial<SceneNode>);
  const cell = collectMatchingNodes(root, { content: 'cell 0.0' })[0];
  check('set cannot change id/type', cell.id === before && cell.type === 'text' && cell.fontSize === 13);
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
