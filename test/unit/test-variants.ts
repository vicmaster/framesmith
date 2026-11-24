// Phase 24 slice A — state variants: canvas_add_variant clones a base into a
// linked sibling canvas (re-keyed IDs + idMap), canvas_list rolls designed
// states onto base rows, the viewer folds variants into one card with state
// chips, and variant-of-variant flattens to the root base.
//
// Usage: npx tsx test/unit/test-variants.ts

import '../env.js';
import { createCanvas, addVariant, getCanvas, listCanvases, deleteCanvas, findNode } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { canvasVersionHash } from '../../src/version.js';
import { renderProjectPage, renderDetailPage } from '../../src/viewer.js';
import { DEFAULT_PROJECT_ID } from '../../src/types.js';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject } from '../../src/workspaces.js';

loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Base canvas with content, tokens, a component, a genre stamp, and feedback.
const base = createCanvas('Orders');
parseAndExecute(base.root, `
shell=I("document", { type: "component", name: "Shell", layout: "vertical" })
title=I(shell, { type: "text", content: "Orders", fontSize: 20 })
table=I("document", { type: "frame", layout: "vertical", gap: 0 })
row=I(table, { type: "frame", layout: "horizontal", gap: 16 })
I(row, { type: "text", content: "Order #1042" })
`, base);
base.variables = { colors: { accent: '#2563EB' } };
base.metadata = {
  provenance: { preset: 'dashboard', at: 'x' },
  feedback: [{ id: 'fb1', comment: 'tighten header', at: 'x' }],
  critique: { rubric: {}, overall: 90, needsRevision: false, model: 'm', at: 'x' },
};

// ── clone fidelity ──────────────────────────────────────────────────────────
const { canvas: empty, idMap } = addVariant(base.id, 'empty');
check('variant created + linked', empty.metadata?.variant?.of === base.id && empty.metadata?.variant?.state === 'empty');
check('name convention', empty.name === 'Orders · empty', empty.name);
check('same project', empty.projectId === base.projectId);
check('content hash matches base at clone time? NO — ids re-keyed', canvasVersionHash(empty) !== canvasVersionHash(base));
check('tokens copied', (empty.variables.colors as Record<string, string>)?.accent === '#2563EB');
check('components registry copied', Object.keys(empty.components).length === Object.keys(base.components).length);
check('provenance (genre) carries', empty.metadata?.provenance?.preset === 'dashboard');
check('feedback does NOT carry', empty.metadata?.feedback === undefined);
check('critique does NOT carry', empty.metadata?.critique === undefined);

// idMap: every base node resolves to a distinct clone node.
const baseIds = ((): string[] => {
  const out: string[] = [];
  (function walk(n: typeof base.root) { out.push(n.id); n.children?.forEach(walk); })(base.root);
  return out;
})();
check('idMap covers every base node', baseIds.every((id) => idMap[id]), `${Object.keys(idMap).length}/${baseIds.length}`);
check('idMap targets exist in the variant', baseIds.every((id) => findNode(empty.root, idMap[id]) !== null));
check('base untouched by cloning', findNode(base.root, baseIds[1]) !== null);

// Editing the variant must not touch the base.
parseAndExecute(empty.root, `D("${idMap[baseIds.find((id) => findNode(base.root, id)?.node.name !== 'Shell' && id !== base.root.id) ?? baseIds[2]]}")`, empty);
check('variant edit does not leak into base', findNode(base.root, baseIds[2]) !== null);

// ── duplicate + flattening rules ────────────────────────────────────────────
let dupErr = '';
try { addVariant(base.id, 'empty'); } catch (e) { dupErr = (e as Error).message; }
check('duplicate state rejected', dupErr.includes('already has'), dupErr);

const { canvas: loading } = addVariant(empty.id, 'loading'); // added to a VARIANT
check('variant-of-variant flattens to root base', loading.metadata?.variant?.of === base.id);

// ── canvas_list rollups ─────────────────────────────────────────────────────
const rows = listCanvases();
const baseRow = rows.find((r) => r.id === base.id)!;
const emptyRow = rows.find((r) => r.id === empty.id)!;
check('base row rolls up variants', (baseRow.variants ?? []).map((v) => v.state).sort().join(',') === 'empty,loading', JSON.stringify(baseRow.variants));
check('variant row carries its link', emptyRow.variant?.of === base.id && emptyRow.variant?.state === 'empty');
check('base row has no variant field', baseRow.variant === undefined);

// ── viewer: one card + chips; detail cross-links; orphan-safe ───────────────
const page = await renderProjectPage(DEFAULT_PROJECT_ID, 0);
check('gallery folds variants into base card', page !== null && !page!.includes(`data-canvas-id="${empty.id}"`) && !page!.includes(`data-canvas-id="${loading.id}"`) && page!.includes(`data-canvas-id="${base.id}"`));
// Phase 33 slice B: the card's meta line counts the states; variants never get a card of their own.
const baseCard = page ? page.slice(page.indexOf(`data-canvas-id="${base.id}"`), page.indexOf('</article>', page.indexOf(`data-canvas-id="${base.id}"`))) : '';
check('gallery base card counts its two states', baseCard.includes(' · 2 states'), baseCard.slice(0, 200));

const detailBase = await renderDetailPage(getCanvas(base.id)!, 0);
check('base detail chips: default active + links', detailBase.includes('state-chip--active">default') && detailBase.includes(`/canvas/${empty.id}`));
const detailVariant = await renderDetailPage(getCanvas(empty.id)!, 0);
check('variant detail chips: link back to base + sibling', detailVariant.includes(`/canvas/${base.id}`) && detailVariant.includes(`/canvas/${loading.id}`) && detailVariant.includes('state-chip--active">empty'));

// Orphan: delete the base — variants render standalone, nothing crashes.
deleteCanvas(base.id);
const orphanPage = await renderProjectPage(DEFAULT_PROJECT_ID, 0);
check('orphaned variants render standalone', !!orphanPage && orphanPage.includes('Orders · empty'));
const orphanDetail = await renderDetailPage(getCanvas(empty.id)!, 0);
check('orphaned variant detail renders without chips', !orphanDetail.includes('state-chip--active">empty'));

// addVariant on an orphaned variant errors clearly.
let orphanErr = '';
try { addVariant(empty.id, 'error'); } catch (e) { orphanErr = (e as Error).message; }
check('variant-of-orphan errors', orphanErr.includes('no longer exists'), orphanErr);

console.log(allPass ? '\nAll variant tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
