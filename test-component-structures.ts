import './test-env.js';
// Phase 16 Slice D — component-level structures.
// Covers: list kinds, page-scaffold behavior unchanged (guard/provenance/
// page-bg/axes), component stamping under a target, ID re-keying + idMap,
// repeat-stamp non-collision, targetId validation, provenance NOT touched by
// component stamps (spec C9), color seeding without the page background, and
// a full render of the data-table (primitives + icons + tokens together).
//
// Usage: npx tsx test-component-structures.ts

import { applyStructure, listStructures } from './src/structures.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import type { Canvas, SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

function makeCanvas(children: SceneNode[] = []): Canvas {
  return {
    id: 'c1', name: 'Test', projectId: 'p1',
    root: { id: 'doc', type: 'document', fill: '#FFFFFF', width: 1440, height: 900, children } as SceneNode,
    variables: {}, components: {},
  } as unknown as Canvas;
}

const allIds = (root: SceneNode): string[] => {
  const ids: string[] = [];
  const walk = (n: SceneNode) => { ids.push(n.id); n.children?.forEach(walk); };
  walk(root);
  return ids;
};

// ── 1. listStructures kinds ──────────────────────────────────────────────────
{
  const structures = listStructures();
  const pages = structures.filter((s) => s.kind === 'page');
  const components = structures.filter((s) => s.kind === 'component');
  expect('6 page structures', pages.length === 6, `got ${pages.length}`);
  expect('5 component structures', components.length === 5, components.map((c) => c.name).join(','));
  expect('pages carry axes', pages.every((s) => s.axes !== undefined));
  expect('components carry no axes', components.every((s) => s.axes === undefined));
  expect('expected component names', ['data-table', 'form-field', 'toolbar', 'stat-card', 'toggle-row'].every((n) => components.some((c) => c.name === n)));
}

// ── 2. page behavior unchanged ───────────────────────────────────────────────
{
  const canvas = makeCanvas();
  const result = applyStructure(canvas, 'marquee-hero');
  expect('page stamp reports kind page + axes', result.kind === 'page' && result.axes !== undefined);
  expect('page stamp sets provenance', canvas.metadata?.provenance?.structure === 'marquee-hero');
  expect('page stamp sets page background', canvas.root.fill === '$bg-primary');
  expect('page stamp has no idMap', result.idMap === undefined);

  let guard: unknown;
  try { applyStructure(makeCanvas([{ id: 'x', type: 'frame' }]), 'marquee-hero'); } catch (err) { guard = err; }
  expect('non-empty root still refuses without replace', guard instanceof Error && (guard as Error).message.includes('replace'));

  let pageTarget: unknown;
  try { applyStructure(makeCanvas(), 'marquee-hero', { targetId: 'x' }); } catch (err) { pageTarget = err; }
  expect('targetId on a page scaffold errors clearly', pageTarget instanceof Error && (pageTarget as Error).message.includes('page scaffold'));
}

// ── 3. component stamping + re-keying ────────────────────────────────────────
{
  const canvas = makeCanvas([{ id: 'panel', type: 'frame', children: [] }]);
  const first = applyStructure(canvas, 'form-field', { targetId: 'panel' });
  expect('component stamp reports kind + idMap', first.kind === 'component' && first.idMap !== undefined);
  expect('idMap re-keys the template ids', first.idMap!['ff'] === 'form-field-1-ff' && first.idMap!['ff-label'] === 'form-field-1-ff-label', JSON.stringify(first.idMap));

  const panel = canvas.root.children!.find((n) => n.id === 'panel')!;
  expect('nodes landed under the target', panel.children?.length === 1 && panel.children[0].id === 'form-field-1-ff');
  expect('component stamp does NOT touch provenance (C9)', canvas.metadata?.provenance === undefined);
  expect('component stamp does NOT repaint the root', canvas.root.fill === '#FFFFFF');

  // Repeat stamp → next counter, zero collisions.
  const second = applyStructure(canvas, 'form-field', { targetId: 'panel' });
  expect('second stamp gets prefix -2-', second.idMap!['ff'] === 'form-field-2-ff');
  const ids = allIds(canvas.root);
  expect('no duplicate ids after repeat stamps', new Set(ids).size === ids.length);

  // Works on a non-empty canvas without replace (no page guard), default target = root.
  const third = applyStructure(canvas, 'toggle-row');
  expect('component stamps onto a non-empty canvas at the root by default', third.kind === 'component' && canvas.root.children!.some((n) => n.id === third.idMap!['tr']));

  let missing: unknown;
  try { applyStructure(canvas, 'form-field', { targetId: 'nope' }); } catch (err) { missing = err; }
  expect('unknown targetId errors', missing instanceof Error && (missing as Error).message.includes('not found'));
}

// ── 4. color seeding (component scope) ───────────────────────────────────────
{
  const canvas = makeCanvas();
  const result = applyStructure(canvas, 'form-field');
  expect('component seeds its referenced colors', result.seededColors.includes('border') && result.seededColors.includes('bg-elevated'), result.seededColors.join(','));
  expect('component does not seed the page background', !result.seededColors.includes('bg-primary'), result.seededColors.join(','));

  const themed = makeCanvas();
  (themed.variables.colors as Record<string, string> | undefined) ?? (themed.variables.colors = {});
  const inherited = new Set(['border', 'bg-elevated', 'text-primary', 'text-secondary']);
  const r2 = applyStructure(themed, 'form-field', { existingColors: inherited });
  expect('inherited colors are not re-seeded', !r2.seededColors.includes('border'), r2.seededColors.join(','));
}

// ── 5. data-table: stamps, placeholders, and renders end to end ──────────────
{
  const canvas = makeCanvas();
  const result = applyStructure(canvas, 'data-table');
  expect('data-table stamps in one call', result.insertedNodeIds.length === 1);
  expect('data-table exposes fillable placeholders', result.placeholders.length >= 12, `got ${result.placeholders.length}`);
  expect('data-table rows include a status toggle', Object.keys(result.idMap!).some((k) => k === 'dt-row1-status-toggle'));

  const resolved = resolveVariables(canvas.root, { colors: canvas.variables.colors });
  const html = renderToHtml(resolved, 1200, 600, canvas);
  expect('data-table renders: header + rows + toggle + icon', html.includes('text-transform: uppercase') && html.includes('border-radius: 10px') /* toggle track (h20/2) */ && html.includes('<svg'), undefined);
  expect('no unresolved $tokens leak into the render', !html.includes('$bg-') && !html.includes('$text-') && !html.includes('$border'));
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
