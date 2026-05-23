// batch_design now returns a { varName: nodeId } map (issue #64, #5): each
// node-creating op (I / C / R) tags its result with the variable it bound, so an
// agent can target the right nodes in follow-up ops instead of counting result
// positions (the issue's "mis-mapped once and edited the wrong nodes").
//
// Usage: npx tsx test-batch-design-idmap.ts

import './test-env.js';
import { createCanvas, findNode } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** Mirror the batch_design handler's map assembly. */
function buildNodeIds(results: Array<{ ok: boolean; nodeId?: string; binding?: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of results) if (r.ok && r.binding && r.nodeId) map[r.binding] = r.nodeId;
  return map;
}

const canvas = createCanvas('IdMap Test');
const results = parseAndExecute(canvas.root, `
header=I("document", { type: "frame", layout: "horizontal", gap: 16 })
logo=I(header, { type: "text", content: "Brand" })
I(header, { type: "text", content: "no binding" })
U(logo, { fontSize: 24 })
body=I("document", { type: "frame", layout: "vertical" })
clone=C(header, "document", { gap: 8 })
hero=R(body, { type: "frame", fill: "#101010" })
`, canvas);

check('all ops succeeded', results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));

const nodeIds = buildNodeIds(results);
check('map has every bound var (I, C, R)', Object.keys(nodeIds).sort().join(',') === 'body,clone,header,hero,logo', Object.keys(nodeIds).sort().join(','));

// Bound IDs resolve to the actual nodes.
check('header → a frame', findNode(canvas.root, nodeIds['header'])?.node.type === 'frame');
check('logo → the "Brand" text node', findNode(canvas.root, nodeIds['logo'])?.node.content === 'Brand');
check('U(logo) hit the right node (fontSize 24)', findNode(canvas.root, nodeIds['logo'])?.node.fontSize === 24);

// C binds a distinct copied node.
check('clone → a frame distinct from header', findNode(canvas.root, nodeIds['clone'])?.node.type === 'frame' && nodeIds['clone'] !== nodeIds['header']);

// R rebinds to a fresh id (replaceNode mints one); `hero` is the live node.
check('hero → the replaced frame (fill #101010)', findNode(canvas.root, nodeIds['hero'])?.node.fill === '#101010', `fill=${findNode(canvas.root, nodeIds['hero'])?.node.fill}`);
check('R minted a new id (hero != body)', nodeIds['hero'] !== nodeIds['body']);

// The un-bound I op carries no binding (absent from the map).
check('un-bound insert has a nodeId but no binding', results.some((r) => r.ok && r.nodeId && !r.binding));

// U / D / M never bind: the logo id shows up twice in results (the I that bound
// it + the U that updated it), but only the I carries `binding: "logo"`.
const logoResults = results.filter((r) => r.nodeId === nodeIds['logo']);
check('logo node appears in two results (I + U)', logoResults.length === 2, `count=${logoResults.length}`);
check('only the I result binds logo; the U does not', logoResults.filter((r) => r.binding === 'logo').length === 1 && logoResults.filter((r) => !r.binding).length === 1);

console.log(allPass ? '\nBATCH-DESIGN ID-MAP TEST PASSED ✅' : '\nBATCH-DESIGN ID-MAP TEST FAILED ✗');
process.exit(allPass ? 0 : 1);
