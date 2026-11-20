// Phase 24 slice B — skeleton node type + state scaffolds. The determinism
// contract matters most: the pulse animation exists ONLY when the caller opts
// in (the live viewer); every screenshot/export/diff render is static and
// byte-comparable.
//
// Usage: npx tsx test/unit/test-skeleton.ts

import '../env.js';
import { createCanvas } from '../../src/scene-graph.js';
import { resolveVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { applyStructure, listStructures } from '../../src/structures.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { parseAndExecute } from '../../src/operations.js';
import type { SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── defaults via resolveVariables ───────────────────────────────────────────
{
  const root: SceneNode = { id: 'doc', type: 'document', children: [{ id: 's1', type: 'skeleton' }] } as SceneNode;
  const resolved = resolveVariables(structuredClone(root), {});
  check('unthemed default fill = translucent neutral', resolved.children![0].fill === 'rgba(127, 127, 127, 0.22)', String(resolved.children![0].fill));

  const themed = resolveVariables(structuredClone(root), { colors: { border: '#2A241A' } });
  check('themed canvas picks up $border tone', themed.children![0].fill === '#2A241A');

  const explicit = resolveVariables(structuredClone(root), { colors: { skeleton: '#333333', border: '#2A241A' } });
  check('explicit skeleton token wins over border', explicit.children![0].fill === '#333333');

  const set: SceneNode = { id: 'doc', type: 'document', children: [{ id: 's1', type: 'skeleton', fill: '#ABCDEF' }] } as SceneNode;
  check('explicit node fill always wins', resolveVariables(set, { colors: { border: '#000' } }).children![0].fill === '#ABCDEF');
}

// ── render + determinism contract ───────────────────────────────────────────
{
  const canvas = createCanvas('Skeleton Render');
  parseAndExecute(canvas.root, `
s1=I("document", { type: "skeleton" })
s2=I("document", { type: "skeleton", width: 120, height: 8, cornerRadius: 4 })
s3=I("document", { type: "skeleton", pulse: false })
`, canvas);
  const resolved = resolveVariables(structuredClone(canvas.root), {});

  const staticHtml = renderToHtml(resolved, 800, 600, canvas);
  check('default render has NO pulse keyframes', !staticHtml.includes('fs-skeleton-pulse'));
  check('skeleton divs render with defaults', staticHtml.includes('width: 100%') && staticHtml.includes('height: 12px') && staticHtml.includes('border-radius: 6px'));
  check('explicit dims render', staticHtml.includes('width: 120px') && staticHtml.includes('height: 8px'));
  check('static render is byte-deterministic', staticHtml === renderToHtml(resolved, 800, 600, canvas));

  const liveHtml = renderToHtml(resolved, 800, 600, canvas, { skeletonPulse: true });
  check('live render emits keyframes + class', liveHtml.includes('fs-skeleton-pulse') && liveHtml.includes('class="fs-skeleton"'));
  check('pulse: false opts a block out of the class', (liveHtml.match(/class="fs-skeleton"/g) ?? []).length === 2, String((liveHtml.match(/class="fs-skeleton"/g) ?? []).length));
}

// ── state scaffolds ─────────────────────────────────────────────────────────
{
  const names = listStructures().map((s) => s.name);
  for (const n of ['empty-state', 'skeleton-table', 'skeleton-card']) {
    const entry = listStructures().find((s) => s.name === n);
    check(`structure "${n}" listed as component kind`, names.includes(n) && entry?.kind === 'component');
  }

  // Stamp each under a target; idMap + re-keyed ids like other components.
  const canvas = createCanvas('Scaffold Test');
  parseAndExecute(canvas.root, `panel=I("document", { type: "frame", layout: "vertical", gap: 24, padding: 32 })`, canvas);
  const panelId = canvas.root.children![0].id;
  for (const n of ['empty-state', 'skeleton-table', 'skeleton-card']) {
    const result = applyStructure(canvas, n, { targetId: panelId });
    check(`"${n}" stamps under a target with an idMap`, Object.keys(result.idMap ?? {}).length > 0);
  }
  const second = applyStructure(canvas, 'skeleton-card', { targetId: panelId });
  check('repeat stamp re-keys (no id collision)', !!second.idMap && Object.values(second.idMap).every((id) => typeof id === 'string'));

  // Taste gate: a stamped empty-state on a plain canvas carries no cliché
  // tells of its own (the "to confirm" guard keeps honest-content quiet).
  const es = createCanvas('Empty State Gate');
  parseAndExecute(es.root, `panel=I("document", { type: "frame", layout: "vertical", padding: 48 })`, es);
  applyStructure(es, 'empty-state', { targetId: es.root.children![0].id });
  const ev = await evaluateCanvas(es, { mode: 'fast', categories: ['cliche'] });
  check('empty-state scaffold: zero cliché tells', ev.issues.length === 0, JSON.stringify(ev.issues.map((i) => i.tell)));

  const skt = createCanvas('Skeleton Table Gate');
  parseAndExecute(skt.root, `panel=I("document", { type: "frame", layout: "vertical", padding: 48 })`, skt);
  applyStructure(skt, 'skeleton-table', { targetId: skt.root.children![0].id });
  const ev2 = await evaluateCanvas(skt, { mode: 'fast', categories: ['cliche'] });
  check('skeleton-table scaffold: zero cliché tells', ev2.issues.length === 0, JSON.stringify(ev2.issues.map((i) => i.tell)));

  // Dogfood regression: state scaffolds must also be ON-SCALE — an off-scale
  // padding (the original [14, 16] rows / [10, 16] CTA) trips the spacing
  // linter every time the scaffold is stamped.
  for (const name of ['skeleton-table', 'empty-state', 'skeleton-card']) {
    const sc = createCanvas(`Scale Gate ${name}`);
    parseAndExecute(sc.root, `panel=I("document", { type: "frame", layout: "vertical", padding: 48 })`, sc);
    applyStructure(sc, name, { targetId: sc.root.children![0].id });
    const evS = await evaluateCanvas(sc, { mode: 'fast', categories: ['spacing'] });
    check(`"${name}" scaffold: on-scale spacing`, evS.issues.length === 0, JSON.stringify(evS.issues.map((i) => i.message)));
  }
}

console.log(allPass ? '\nAll skeleton tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
