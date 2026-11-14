import './test-env.js';
/**
 * Phase 31 slice D (FR-D3, spec G3) — the desktop-app gate at the narrower
 * windows the viewer offers, and the documented move of stamping a table into
 * a realisation's pane. test-patterns-desktop.ts covers the 1440×900 window;
 * this covers what verify round 1 found it missed:
 *
 *   1. a full stress run is CLEAN at 1024×768 (unthemed and under each
 *      personality) and at 1280×800 (unthemed), and detailed mode raises no
 *      desktop-app finding at 1280×800 — long labels must truncate, never push
 *      a bar past the window;
 *   2. `data-table` stamped into each page realisation's wide pane (it
 *      resolves to data-table-app), at 1440, 1100 and 1024 wide, leaves
 *      nothing blocking in fast mode, no desktop-app finding in detailed
 *      mode, and a CLEAN stress run.
 *
 * Fallback fonts, as in test-patterns-desktop.ts. Needs Chrome.
 * Run with: npx tsx test-patterns-desktop-window.ts
 */
import { listStructures, applyStructure } from './src/structures.js';
import { createCanvas } from './src/scene-graph.js';
import { evaluateCanvas } from './src/evaluate.js';
import { getVariables, resolveVariables, setVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { expandInstances } from './src/drift.js';
import { computeLayout, shutdown } from './src/screenshot.js';
import { applyPerturbation, compareLayouts, PERTURBATION_NAMES } from './src/stress.js';
import { generateDesignSystem, PERSONALITY_NAMES, type PersonalityName } from './src/design-language.js';
import { getCanvasTokens } from './src/workspaces.js';
import type { Canvas, SceneNode } from './src/types.js';

const CATEGORIES = ['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche', 'usability'];

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function stamped(name: string, component: boolean, size: { width: number; height: number }, personality?: PersonalityName): Canvas {
  const canvas = createCanvas(`win-${name}`, undefined, size, { type: 'desktop-app' });
  if (component) canvas.root.fill = '$bg-primary';
  if (personality) setVariables(canvas, generateDesignSystem('#166534', personality, { surface: 'desktop-app' }).variables);
  const m = getCanvasTokens(canvas);
  applyStructure(canvas, name, {
    replace: true,
    existingColors: new Set(Object.keys(m.colors ?? {})),
    existingTokens: new Set([...Object.keys(m.spacing ?? {}), ...Object.keys(m.radius ?? {}), ...Object.keys(m.typography ?? {}), ...Object.keys(m.elevation ?? {}).map((k) => `elevation.${k}`)]),
  });
  return canvas;
}

async function stressWarnings(canvas: Canvas): Promise<string[]> {
  const w = canvas.root.width as number;
  const h = canvas.root.height as number;
  const merged = getVariables(canvas);
  const layoutOf = (root: SceneNode) => computeLayout(renderToHtml(resolveVariables(structuredClone(root), merged), w, h, canvas), undefined, 25, { width: w, height: h });
  const base = expandInstances(canvas.root, canvas);
  const baseline = await layoutOf(base);
  const warnings: string[] = [];
  for (const p of PERTURBATION_NAMES) {
    const run = applyPerturbation(p, base, { type: 'desktop-app' });
    if (run.touched.length === 0) continue;
    for (const f of compareLayouts(baseline, await layoutOf(run.root), run.touched, w)) {
      if (f.severity === 'warning') warnings.push(`${p}:${f.kind}@${f.nodeId}`);
    }
  }
  return warnings;
}

const appFindings = async (canvas: Canvas, mode: 'fast' | 'detailed'): Promise<string[]> =>
  (await evaluateCanvas(canvas, { mode, categories: CATEGORIES })).issues.flatMap((i) =>
    (i.rule?.startsWith('desktop-app-') || i.severity !== 'info' || i.category === 'cliche' ? [`${i.severity}:${i.rule ?? i.tell ?? i.category}@${i.nodeId}`] : []));

const SMALL = { width: 1024, height: 768 };
const MEDIUM = { width: 1280, height: 800 };
const app = listStructures({ type: 'desktop-app' }).filter((s) => s.surface === 'desktop-app');

// ── 1. narrower windows ─────────────────────────────────────────────────────
for (const s of app) {
  const component = s.kind === 'component';
  for (const personality of [undefined, ...PERSONALITY_NAMES]) {
    const warnings = await stressWarnings(stamped(s.name, component, SMALL, personality));
    check(`${s.name}: full stress run CLEAN at 1024×768 (${personality ?? 'unthemed'})`, warnings.length === 0, warnings.slice(0, 4).join(' | '));
  }
  const medium = stamped(s.name, component, MEDIUM);
  const warnings = await stressWarnings(medium);
  check(`${s.name}: full stress run CLEAN at 1280×800`, warnings.length === 0, warnings.slice(0, 4).join(' | '));
  const findings = await appFindings(medium, 'detailed');
  check(`${s.name}: detailed mode clean at 1280×800`, findings.length === 0, findings.slice(0, 4).join(' | '));
}

// ── 2. a table stamped into a realisation's wide pane ──────────────────────
const WIDE_PANE: Record<string, string> = {
  'split-workbench-app': 'swa-work',
  'list-detail-app': 'lda-detail',
  'editor-inspector-app': 'eia-work',
  'browser-app': 'bra-grid-pane',
  'dashboard-app': 'dba-content',
  'settings-app': 'sta-content',
};
check('every page realisation names its wide pane', app.filter((s) => s.kind === 'page').every((s) => WIDE_PANE[s.name] !== undefined));
for (const [page, paneId] of Object.entries(WIDE_PANE)) for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 900 }, SMALL]) {
  const at = `${size.width}×${size.height}`;
  const canvas = stamped(page, false, size);
  const stamp = applyStructure(canvas, 'data-table', { targetId: paneId });
  check(`data-table into ${page}'s ${paneId} stamps data-table-app (${at})`, stamp.applied === 'data-table-app');
  const fast = await appFindings(canvas, 'fast');
  check(`${page} + data-table-app: nothing blocking in fast mode (${at})`, fast.length === 0, fast.slice(0, 4).join(' | '));
  const detailed = await appFindings(canvas, 'detailed');
  check(`${page} + data-table-app: detailed mode clean (${at})`, detailed.length === 0, detailed.slice(0, 4).join(' | '));
  const warnings = await stressWarnings(canvas);
  check(`${page} + data-table-app: full stress run CLEAN (${at})`, warnings.length === 0, warnings.slice(0, 4).join(' | '));
}

console.log(allPass ? '\nAll desktop-app window tests passed.' : '\nSOME TESTS FAILED');
await shutdown();
process.exit(allPass ? 0 : 1);
