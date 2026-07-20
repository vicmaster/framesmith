import './test-env.js';
// Phase 22 slice E (#130) — promoteToComponent + copyNodesAcross.
// Render-equivalence via renderToHtml string comparison — no Chrome needed.
//
// Usage: npx tsx test-components.ts

import { createCanvas, insertNode, findNode } from './src/scene-graph.js';
import { promoteToComponent, copyNodesAcross } from './src/components.js';
import { renderToHtml } from './src/renderer.js';
import type { Canvas, SceneNode } from './src/types.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const render = (c: Canvas) => renderToHtml(c.root, 1200, 800, c);

// A mini app shell: sidebar with a title and an active nav item.
function buildShell(canvas: Canvas): SceneNode {
  const root = canvas.root;
  const shell = insertNode(root, root.id, { type: 'frame', name: 'Shell', layout: 'horizontal', fill: '#F9FAFB', gap: 16, padding: 16 });
  const side = insertNode(root, shell.id, { type: 'frame', name: 'Sidebar', layout: 'vertical', gap: 8, width: 220 });
  insertNode(root, side.id, { type: 'text', name: 'Logo', content: 'MagmaCore', fontSize: 18, fontWeight: 700, color: '#111827' });
  insertNode(root, side.id, { type: 'text', name: 'ActiveNav', content: 'Dashboard', fontSize: 14, color: '#2563EB' });
  return shell;
}

// ── promote ──────────────────────────────────────────────────────────────────
{
  const canvas = createCanvas('promote-test');
  const shell = buildShell(canvas);
  const before = render(canvas);

  const result = promoteToComponent(canvas, shell.id);
  check('componentId slugs from the name', result.componentId === 'cmp-shell', result.componentId);
  check('instance keeps the original node id', result.instanceId === shell.id);
  check('overridableChildren lists named descendants in order',
    result.overridableChildren.join(',') === 'Sidebar,Logo,ActiveNav', result.overridableChildren.join(','));
  check('def registered on the canvas', !!canvas.components['cmp-shell'] && canvas.components['cmp-shell'].type === 'frame');
  check('tree now holds an instance node', findNode(canvas.root, shell.id)?.node.type === 'instance');
  check('render is identical after promotion', render(canvas) === before);

  // Second instance with an override by child name.
  insertNode(canvas.root, canvas.root.id, { type: 'instance', componentId: 'cmp-shell', overrides: { ActiveNav: { content: 'Settings' } } });
  const two = render(canvas);
  check('second instance renders the def again', (two.match(/MagmaCore/g) ?? []).length === 2, String((two.match(/MagmaCore/g) ?? []).length));
  check('override by child name applies to one copy only', two.includes('Settings') && (two.match(/Dashboard/g) ?? []).length === 1);

  // Name collisions on the slug get a numeric suffix.
  const extra = insertNode(canvas.root, canvas.root.id, { type: 'frame', name: 'Shell' });
  check('componentId collision gets -2 suffix', promoteToComponent(canvas, extra.id).componentId === 'cmp-shell-2');

  // Errors.
  let rootThrew = false;
  try { promoteToComponent(canvas, canvas.root.id); } catch { rootThrew = true; }
  check('promoting the root throws', rootThrew);
  let instThrew = false;
  try { promoteToComponent(canvas, shell.id); } catch { instThrew = true; }
  check('promoting an instance throws', instThrew);
  let missingThrew = false;
  try { promoteToComponent(canvas, 'nope'); } catch { missingThrew = true; }
  check('unknown node throws', missingThrew);
}

// ── copy across canvases ─────────────────────────────────────────────────────
{
  const a = createCanvas('copy-source');
  const shell = buildShell(a);
  const promoted = promoteToComponent(a, shell.id);
  const loose = insertNode(a.root, a.root.id, { type: 'text', name: 'Loose', content: 'plain copy', fontSize: 14 });

  const b = createCanvas('copy-target');
  const { idMap, rootIds, copiedComponents } = copyNodesAcross(a, b, [promoted.instanceId, loose.id]);

  check('idMap covers every copied node', Object.keys(idMap).length === 2, String(Object.keys(idMap).length));
  check('rootIds are the new subtree roots', rootIds.length === 2 && rootIds.every((id) => findNode(b.root, id)));
  check('all copied ids are fresh', Object.entries(idMap).every(([oldId, newId]) => oldId !== newId));
  check('component def traveled', copiedComponents.includes('cmp-shell') && !!b.components['cmp-shell']);
  check('copied instance renders the shell in the target', render(b).includes('MagmaCore') && render(b).includes('plain copy'));
  check('source canvas untouched', render(a).includes('MagmaCore') && !!a.components['cmp-shell']);

  // Copy again: identical def already present — shared, not duplicated.
  const again = copyNodesAcross(a, b, [promoted.instanceId]);
  check('identical def is shared on re-copy', again.copiedComponents.length === 0 && Object.keys(b.components).length === 1);

  // Collision with a DIFFERENT def under the same id → re-key + remap.
  const c = createCanvas('copy-collision');
  c.components['cmp-shell'] = { id: 'other', type: 'frame', name: 'Different', fill: '#000' };
  const collided = copyNodesAcross(a, c, [promoted.instanceId]);
  check('different def re-keys on collision', collided.copiedComponents.length === 1 && collided.copiedComponents[0] === 'cmp-shell-2');
  const copiedInstance = findNode(c.root, collided.rootIds[0])?.node;
  check('copied instance remapped to the re-keyed def', copiedInstance?.componentId === 'cmp-shell-2');
  check('collision copy still renders the shell', render(c).includes('MagmaCore'));

  // Same-canvas duplication + index positioning.
  const dup = copyNodesAcross(a, a, [loose.id], 'document', 0);
  check('same-canvas duplicate works', (render(a).match(/plain copy/g) ?? []).length === 2);
  check('index positions the copy', a.root.children![0].id === dup.rootIds[0]);

  // Errors.
  let badParent = false;
  try { copyNodesAcross(a, b, [loose.id], 'nope'); } catch { badParent = true; }
  check('unknown target parent throws', badParent);
  let badNode = false;
  try { copyNodesAcross(a, b, ['nope']); } catch { badNode = true; }
  check('unknown source node throws', badNode);
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
