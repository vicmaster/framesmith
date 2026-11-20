import '../env.js';
// Phase 32 slice B (FR-B1): layout reads the one tree. snapshot_layout names a
// node inside an instance by its expanded id (`<instance>/<node>`), so the
// same child in two instances has two ids, and canvas_stress names that node
// the same way. Both trees are built as the tools build them: snapshot_layout
// renders prepareRender's tree (expanded, then resolved); canvas_stress
// perturbs the raw expansion and resolves it.
//
// Usage: npx tsx test/browser/test-one-tree-layout.ts

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { renderToHtml } from '../../src/renderer.js';
import { computeLayout, shutdown, type LayoutRect } from '../../src/screenshot.js';
import { expandTree } from '../../src/expand.js';
import { resolveVariables } from '../../src/variables.js';
import { getCanvasTokens } from '../../src/workspaces.js';
import { applyPerturbation, compareLayouts } from '../../src/stress.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const ids = (rects: LayoutRect[]): string[] => rects.flatMap((r) => [r.nodeId, ...ids(r.children ?? [])]);

const canvas = createCanvas('one tree layout');
const [page, card] = parseAndExecute(canvas.root, `
page=I("document", {type: "frame", name: "page", layout: "horizontal", gap: 16, padding: 24, fill: "#FFFFFF", width: 800})
card=I("document", {type: "component", name: "Card", layout: "vertical", padding: 16, gap: 8, fill: "#F3F4F6", width: 200})
title=I(card, {type: "text", name: "title", content: "Quarterly revenue", fontSize: 16, color: "#111111"})
`, canvas).map((r) => r.nodeId!);
const title = canvas.components[card].children![0].id;
const [a, b] = parseAndExecute(canvas.root, `
a=I("${page}", {type: "instance", name: "card-a", componentId: "${card}"})
b=I("${page}", {type: "instance", name: "card-b", componentId: "${card}"})
`, canvas).map((r) => r.nodeId!);

const w = 800;
const h = 400;
const tokens = getCanvasTokens(canvas);

// snapshot_layout's tree.
const snapshot = ids(await computeLayout(renderToHtml(expandTree(canvas.root, canvas, tokens).root, w, h, canvas), undefined, 25, { width: w, height: h }));
check('snapshot_layout names the child in the first instance by its expanded id', snapshot.includes(`${a}/${title}`));
check('…and in the second by another', snapshot.includes(`${b}/${title}`));
check('…every rect id is unique', new Set(snapshot).size === snapshot.length);

// canvas_stress's tree: the raw expansion, perturbed, then resolved.
const base = expandTree(canvas.root, canvas).root;
const render = (root: typeof base) => renderToHtml(resolveVariables(structuredClone(root), tokens), w, h, canvas);
const baseline = await computeLayout(render(base), undefined, 25, { width: w, height: h });
const run = applyPerturbation('long-text', base);
check('canvas_stress touches the child in each instance under its expanded id', run.touched.includes(`${a}/${title}`) && run.touched.includes(`${b}/${title}`), run.touched.join(', '));
check('…the same ids snapshot_layout gives', run.touched.every((id) => snapshot.includes(id)));
const perturbed = await computeLayout(render(run.root), undefined, 25, { width: w, height: h });
const findings = compareLayouts(baseline, perturbed, run.touched, w);
check('…and any finding it raises names a node snapshot_layout knows', findings.every((f) => snapshot.includes(f.nodeId)), JSON.stringify(findings));

await shutdown();
console.log(allPass ? '\nAll one-tree layout checks passed.' : '\nSome one-tree layout checks FAILED.');
process.exit(allPass ? 0 : 1);
