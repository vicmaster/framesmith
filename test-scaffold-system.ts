import './test-env.js';
/**
 * Phase 29 slice C (#194) — every scaffold belongs to the system it is stamped
 * into, and survives hostile content.
 *
 * Two properties, asserted for EVERY structure in the library:
 *
 *   1. No node carries a font size absent from the canvas's type scale. Before
 *      this slice the scaffolds hardcoded 92 literal sizes across 14 distinct
 *      values — stamping `empty-state` onto a generated system dropped a 14px
 *      CTA label onto a scale that had no 14, so the stamp itself tripped the
 *      type-scale ratio check and the agent spent a round fixing framesmith's
 *      own output.
 *
 *   2. `canvas_stress` comes back CLEAN. The page shells were hardened in
 *      Phase 27; the Phase 28 micro-patterns never got the same pass, and the
 *      checkout attempt hit both misses live (`initials-avatar` clipped a 36px
 *      monogram into a 32px box, `empty-state`'s title overflowed).
 *
 * Needs Chrome (stress measures real layout). Run with:
 *   npx tsx test-scaffold-system.ts
 */
import { listStructures, applyStructure } from './src/structures.js';
import { createCanvas, getCanvas } from './src/scene-graph.js';
import { generateDesignSystem } from './src/design-language.js';
import { setVariables, resolveVariables, getVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { expandInstances } from './src/drift.js';
import { computeLayout, takeScreenshot, shutdown } from './src/screenshot.js';
import { applyPerturbation, compareLayouts, PERTURBATION_NAMES, type PerturbationName } from './src/stress.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const SEED = '#166534';
const PERSONALITY = 'soft';

/** Every fontSize the canvas's own type system can produce. */
function scaleOf(canvas: Canvas): Set<number> {
  const sizes = new Set<number>();
  for (const spec of Object.values(getVariables(canvas).typography ?? {})) {
    const fs = (spec as { fontSize?: number | string }).fontSize;
    if (typeof fs === 'number') sizes.add(fs);
  }
  return sizes;
}

/** structures.ts keeps its walker private; a three-line local one is cheaper
 * than widening that module's surface for a test. */
function walkNodes(node: SceneNode, visit: (n: SceneNode) => void): void {
  visit(node);
  node.children?.forEach((c) => walkNodes(c, visit));
}

/** Resolved font sizes actually present on nodes after a stamp. */
function usedSizes(canvas: Canvas): Map<number, string[]> {
  const merged = getVariables(canvas);
  const out = new Map<number, string[]>();
  walkNodes(resolveVariables(structuredClone(canvas.root), merged), (n: SceneNode) => {
    const fs = (n as unknown as Record<string, unknown>).fontSize;
    if (typeof fs === 'number') out.set(fs, [...(out.get(fs) ?? []), n.id]);
  });
  return out;
}

const structures = listStructures();

/** A structure stamps on a canvas of its own surface (Phase 30 slice E):
 * mobile realisations on a phone canvas, everything else on web as before. */
const typeOf = (surface: string): 'web' | 'mobile' => (surface === 'mobile' ? 'mobile' : 'web');
const canvasFor = (name: string, surface: string) =>
  createCanvas(name, undefined, {}, surface === 'mobile' ? { type: 'mobile' } : undefined);
check('structure library is non-empty', structures.length > 0, `${structures.length} structures`);

// ── 1. on the generated scale ────────────────────────────────────────────────
console.log('\n── every scaffold lands on the generated type scale ──');
for (const { name, kind, surface } of structures) {
  const canvas = canvasFor(`scale-${name}`, surface);
  setVariables(canvas, generateDesignSystem(SEED, PERSONALITY, { surface: typeOf(surface) }).variables);
  applyStructure(canvas, name, { targetId: 'document' });
  const cv = getCanvas(canvas.id)!;

  const scale = scaleOf(cv);
  const offScale = [...usedSizes(cv).entries()].filter(([px]) => !scale.has(px));
  check(`${kind}/${name}: no off-scale font size`, offScale.length === 0,
    offScale.map(([px, ids]) => `${px}px on ${ids.slice(0, 3).join(', ')}`).join(' | '));
}

// ── 2. stress-clean ──────────────────────────────────────────────────────────
console.log('\n── every scaffold survives hostile content ──');
for (const { name, kind, surface } of structures) {
  const canvas = canvasFor(`stress-${name}`, surface);
  const type = typeOf(surface);
  setVariables(canvas, generateDesignSystem(SEED, PERSONALITY, { surface: type }).variables);
  applyStructure(canvas, name, { targetId: 'document' });
  const cv = getCanvas(canvas.id)!;

  const w = typeof cv.root.width === 'number' ? cv.root.width : 1440;
  const h = typeof cv.root.height === 'number' ? cv.root.height : 900;
  const merged = getVariables(cv);
  const base = expandInstances(cv.root, cv);
  const baseline = await computeLayout(
    renderToHtml(resolveVariables(structuredClone(base), merged), w, h, cv), undefined, 25, { width: w, height: h });

  const offenders: string[] = [];
  for (const p of PERTURBATION_NAMES as PerturbationName[]) {
    const { root, touched } = applyPerturbation(p, base, { type });
    if (touched.length === 0) continue;
    const layout = await computeLayout(
      renderToHtml(resolveVariables(structuredClone(root), merged), w, h, cv), undefined, 25, { width: w, height: h });
    for (const f of compareLayouts(baseline, layout, touched, w)) {
      if (f.severity === 'warning') offenders.push(`${p}:${f.kind}@${f.nodeId}`);
    }
  }
  check(`${kind}/${name}: stress CLEAN`, offenders.length === 0, offenders.slice(0, 4).join(' | '));
}

console.log(allPass ? '\nAll scaffold-system tests passed.' : '\nSOME TESTS FAILED');
await shutdown();
process.exit(allPass ? 0 : 1);
