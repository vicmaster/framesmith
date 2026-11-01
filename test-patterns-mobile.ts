import './test-env.js';
/**
 * Phase 30 slice E (FR-E4) — the pattern gate's layout half for the mobile
 * realisations. test-patterns.ts holds them to > 95, zero tells and zero
 * mobile findings in fast mode across the themes; this runs what fast mode
 * cannot see, once per realisation (both checks are layout, not colour):
 *
 *   1. detailed mode (a Chrome layout pass) raises no `mobile-*` finding;
 *   2. a full five-perturbation stress run, built the way canvas_stress builds
 *      it (instances expanded, the mobile perturbation rules), is CLEAN.
 *
 * Components marked for every type get the detailed-mode check too.
 * Needs Chrome. Run with: npx tsx test-patterns-mobile.ts
 */
import { listStructures, applyStructure } from './src/structures.js';
import { createCanvas } from './src/scene-graph.js';
import { evaluateCanvas } from './src/evaluate.js';
import { getVariables, resolveVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { expandInstances } from './src/drift.js';
import { computeLayout, shutdown } from './src/screenshot.js';
import { applyPerturbation, compareLayouts, PERTURBATION_NAMES } from './src/stress.js';
import type { Canvas } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

async function mobileFindings(canvas: Canvas): Promise<string[]> {
  const ev = await evaluateCanvas(canvas, { mode: 'detailed' });
  return ev.issues.flatMap((i) => (i.rule?.startsWith('mobile-') ? [`${i.rule}@${i.nodeId}`] : []));
}

/** Warnings from a full stress run, as canvas_stress computes them. */
async function stressWarnings(canvas: Canvas): Promise<string[]> {
  const w = canvas.root.width as number;
  const h = canvas.root.height as number;
  const merged = getVariables(canvas);
  const base = expandInstances(canvas.root, canvas);
  const layoutOf = (root: typeof base) =>
    computeLayout(renderToHtml(resolveVariables(structuredClone(root), merged), w, h, canvas), undefined, 25, { width: w, height: h });
  const baseline = await layoutOf(base);
  const warnings: string[] = [];
  for (const p of PERTURBATION_NAMES) {
    const { root, touched } = applyPerturbation(p, base, { type: 'mobile' });
    if (touched.length === 0) continue;
    for (const f of compareLayouts(baseline, await layoutOf(root), touched, w)) {
      if (f.severity === 'warning') warnings.push(`${p}:${f.kind}@${f.nodeId}`);
    }
  }
  return warnings;
}

const realisations = listStructures({ type: 'mobile' }).filter((s) => s.kind === 'page');
check('six mobile realisations', realisations.length === 6, realisations.map((s) => s.name).join(', '));

for (const s of realisations) {
  const canvas = createCanvas(`gate-${s.name}`, undefined, {}, { type: 'mobile' });
  applyStructure(canvas, s.name);
  const findings = await mobileFindings(canvas);
  check(`${s.name}: detailed mode raises no mobile finding`, findings.length === 0, findings.slice(0, 4).join(' | '));
  const warnings = await stressWarnings(canvas);
  check(`${s.name}: full stress run CLEAN`, warnings.length === 0, warnings.slice(0, 4).join(' | '));
}

for (const s of listStructures().filter((x) => x.kind === 'component' && x.surface === 'any')) {
  const canvas = createCanvas(`gate-${s.name}`, undefined, {}, { type: 'mobile' });
  applyStructure(canvas, s.name);
  const findings = await mobileFindings(canvas);
  check(`${s.name} (any): detailed mode raises no mobile finding on a phone`, findings.length === 0, findings.slice(0, 4).join(' | '));
}

console.log(allPass ? '\nAll mobile pattern-gate tests passed.' : '\nSOME TESTS FAILED');
await shutdown();
process.exit(allPass ? 0 : 1);
