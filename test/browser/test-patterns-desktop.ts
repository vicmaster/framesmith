import '../env.js';
/**
 * Phase 31 slice D (FR-D3, spec G3 + G4) — the pattern gate's layout half for
 * the desktop-app realisations and components. test/unit/test-patterns.ts holds them to
 * > 95, zero tells and zero blocking findings in fast mode across themes and
 * generated systems; this runs what fast mode cannot see:
 *
 *   1. detailed mode (a Chrome layout pass) raises no desktop-app finding at
 *      any severity and no warning or error in any gated category, unthemed
 *      and under each personality's generated system, as stamped and with
 *      every list tripled (the `many` perturbation);
 *   2. a full five-perturbation stress run, built the way canvas_stress builds
 *      it (instances expanded, the desktop-app perturbation rules), is CLEAN
 *      unthemed and under each personality; `many` and `empty` each touch
 *      something, so the run is never vacuous;
 *   3. after `many` the root keeps the artboard's height and no node is
 *      shorter than at baseline (rows scroll, they never squash); tripled
 *      twice, the content outgrows its pane, which then scrolls;
 *   4. a stamp on a 1024×768 window raises no desktop-app finding in detailed
 *      mode and no node reaches past the artboard's right edge (stress at the
 *      narrower windows and tables stamped into panes live in
 *      test/browser/test-patterns-desktop-window.ts).
 *
 * Components marked for every type get detailed mode (no desktop-app warning
 * or error, spec change S7) and a CLEAN stress run on a bare desktop-app
 * canvas. Renders use fallback fonts, as test/browser/test-patterns-mobile.ts does: the
 * personalities' faces would need the network to reach the font cache.
 * Needs Chrome. Run with: npx tsx test/browser/test-patterns-desktop.ts
 */
import { listStructures, applyStructure } from '../../src/structures.js';
import { createCanvas } from '../../src/scene-graph.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { getVariables, resolveVariables, setVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { expandInstances } from '../../src/drift.js';
import { computeLayout, shutdown, type LayoutRect } from '../../src/screenshot.js';
import { applyPerturbation, compareLayouts, PERTURBATION_NAMES } from '../../src/stress.js';
import { generateDesignSystem, PERSONALITY_NAMES, type PersonalityName } from '../../src/design-language.js';
import { getCanvasTokens } from '../../src/workspaces.js';
import type { Canvas, SceneNode } from '../../src/types.js';

const CATEGORIES = ['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche', 'usability'];

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** Detailed-mode findings that block a realisation: any desktop-app finding,
 * any tell, any warning or error. `infos` false keeps only desktop-app
 * warnings and errors (the rule for the components marked `any`). */
async function detailedFindings(canvas: Canvas, infos = true): Promise<string[]> {
  const ev = await evaluateCanvas(canvas, { mode: 'detailed', categories: CATEGORIES });
  return ev.issues.flatMap((i) => {
    const app = i.rule?.startsWith('desktop-app-') && (infos || i.severity !== 'info');
    const blocking = infos ? i.severity !== 'info' || i.category === 'cliche' : i.rule?.startsWith('desktop-app-') && i.severity !== 'info';
    return app || blocking ? [`${i.severity}:${i.rule ?? i.tell ?? i.category}@${i.nodeId}`] : [];
  });
}

/** A desktop-app canvas with the structure stamped as apply_structure stamps
 * it, optionally after a generated system; a component goes under a root
 * painted as a page stamp paints it. */
function stamped(name: string, component: boolean, personality?: PersonalityName, size: { width?: number; height?: number } = {}): Canvas {
  const canvas = createCanvas(`gate-${name}-${personality ?? 'plain'}`, undefined, size, { type: 'desktop-app' });
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

function layoutOf(canvas: Canvas, root: SceneNode): Promise<LayoutRect[]> {
  const w = canvas.root.width as number;
  const h = canvas.root.height as number;
  return computeLayout(renderToHtml(resolveVariables(structuredClone(root), getVariables(canvas)), w, h, canvas), undefined, 25, { width: w, height: h });
}

const flatNodes = (n: SceneNode): SceneNode[] => [n, ...(n.children ?? []).flatMap(flatNodes)];

function flat(rects: LayoutRect[]): LayoutRect[] {
  const out: LayoutRect[] = [];
  const walk = (r: LayoutRect) => { out.push(r); r.children?.forEach(walk); };
  rects.forEach(walk);
  return out;
}

/** Warnings from a full stress run, as canvas_stress computes them, and the
 * nodes `many` and `empty` touched. */
async function stress(canvas: Canvas): Promise<{ warnings: string[]; touched: Record<string, number> }> {
  const base = expandInstances(canvas.root, canvas);
  const baseline = await layoutOf(canvas, base);
  const warnings: string[] = [];
  const touched: Record<string, number> = {};
  for (const p of PERTURBATION_NAMES) {
    const run = applyPerturbation(p, base, { type: 'desktop-app' });
    touched[p] = run.touched.length;
    if (run.touched.length === 0) continue;
    for (const f of compareLayouts(baseline, await layoutOf(canvas, run.root), run.touched, canvas.root.width as number)) {
      if (f.severity === 'warning') warnings.push(`${p}:${f.kind}@${f.nodeId}`);
    }
  }
  return { warnings, touched };
}

const app = listStructures({ type: 'desktop-app' }).filter((s) => s.surface === 'desktop-app');
check('six desktop-app realisations and two components', app.filter((s) => s.kind === 'page').length === 6 && app.filter((s) => s.kind === 'component').length === 2, app.map((s) => s.name).join(', '));

for (const s of app) {
  const component = s.kind === 'component';

  for (const personality of [undefined, ...PERSONALITY_NAMES]) {
    const label = personality ?? 'unthemed';
    const findings = await detailedFindings(stamped(s.name, component, personality));
    check(`${s.name}: detailed mode clean (${label})`, findings.length === 0, findings.slice(0, 4).join(' | '));

    const long = stamped(s.name, component, personality);
    long.root = applyPerturbation('many', long.root, { type: 'desktop-app' }).root;
    const longFindings = await detailedFindings(long);
    check(`${s.name}: detailed mode clean with every list tripled (${label})`, longFindings.length === 0, longFindings.slice(0, 4).join(' | '));

    const { warnings, touched } = await stress(stamped(s.name, component, personality));
    check(`${s.name}: full stress run CLEAN (${label})`, warnings.length === 0, warnings.slice(0, 4).join(' | '));
    if (!personality) check(`${s.name}: many and empty touch something`, touched.many > 0 && touched.empty > 0, JSON.stringify(touched));
  }

  // Tripled content scrolls inside its pane: the root keeps the artboard's
  // height and no row squashes to make room.
  const canvas = stamped(s.name, component);
  const base = expandInstances(canvas.root, canvas);
  const before = new Map(flat(await layoutOf(canvas, base)).map((r) => [r.nodeId, r]));
  const after = flat(await layoutOf(canvas, applyPerturbation('many', base, { type: 'desktop-app' }).root));
  const root = after.find((r) => r.nodeId === canvas.root.id);
  check(`${s.name}: the root keeps the window's height after many`, root?.height === canvas.root.height, `${root?.height}`);
  const squashed = after.filter((r) => { const b = before.get(r.nodeId); return b !== undefined && r.height < b.height - 1; });
  check(`${s.name}: no node is shorter after many`, squashed.length === 0, squashed.slice(0, 4).map((r) => `${r.nodeId} ${before.get(r.nodeId)!.height}→${r.height}`).join(' | '));
  if (!component) {
    // Tripled twice (×9), the content outgrows a 900px pane: it must scroll
    // there, with the root and every row still at their own heights.
    const twice = applyPerturbation('many', applyPerturbation('many', base, { type: 'desktop-app' }).root, { type: 'desktop-app' }).root;
    const nine = flat(await layoutOf(canvas, twice));
    const scrolling = nine.filter((r) => r.scrolls && r.scrollHeight !== undefined && r.clientHeight !== undefined && r.scrollHeight > r.clientHeight + 1);
    const grown = nine.find((r) => r.nodeId === canvas.root.id)?.height;
    const crushed = nine.filter((r) => { const b = before.get(r.nodeId); return b !== undefined && r.height < b.height - 1; });
    check(`${s.name}: content tripled twice scrolls inside a pane, the window and rows keep their heights`,
      scrolling.length > 0 && grown === canvas.root.height && crushed.length === 0,
      `scrolling ${scrolling.map((r) => r.nodeId).join(',')} · root ${grown} · ${crushed.slice(0, 3).map((r) => r.nodeId).join(',')}`);
  }

  // A narrower window: still clean, nothing past the right edge.
  const narrow = stamped(s.name, component, undefined, { width: 1024, height: 768 });
  const narrowFindings = (await detailedFindings(narrow)).filter((f) => f.includes('desktop-app-'));
  check(`${s.name}: detailed mode raises no desktop-app finding at 1024×768`, narrowFindings.length === 0, narrowFindings.slice(0, 4).join(' | '));
  const past = flat(await layoutOf(narrow, expandInstances(narrow.root, narrow))).filter((r) => r.x + r.width > 1024 + 1);
  check(`${s.name}: nothing reaches past a 1024px window`, past.length === 0, past.slice(0, 4).map((r) => `${r.nodeId} ${r.x + r.width}`).join(' | '));
}

// Twins: the layout checks must fail on the defects they exist to catch.
{
  const rows = (n: number): SceneNode[] => Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, type: 'list-row' as const, title: 'Item title' }));
  const shellWith = (paneProps: Partial<SceneNode>, rootOverflow: boolean): Canvas => {
    const canvas = createCanvas('twin', undefined, {}, { type: 'desktop-app' });
    if (rootOverflow) canvas.root.overflow = 'hidden';
    canvas.root.children = [{
      id: 'shell', type: 'frame', width: '100%', height: '100%', layout: 'horizontal', children: [
        { id: 'pane', type: 'frame', layout: 'vertical', width: '100%', minHeight: 0, ...paneProps, children: [{ id: 'list', type: 'frame', layout: 'vertical', children: rows(12) }] },
      ],
    }];
    return canvas;
  };
  const manyWarnings = async (canvas: Canvas) => {
    const base = expandInstances(canvas.root, canvas);
    const run = applyPerturbation('many', base, { type: 'desktop-app' });
    return compareLayouts(await layoutOf(canvas, base), await layoutOf(canvas, run.root), run.touched, 1440).filter((f) => f.severity === 'warning');
  };
  check('a scrolling pane (overflow auto) is CLEAN under many', (await manyWarnings(shellWith({ overflow: 'auto' }, true))).length === 0);
  check('twin: the same pane with overflow hidden clips under many', (await manyWarnings(shellWith({ overflow: 'hidden' }, true))).some((f) => f.kind === 'clip' && f.nodeId === 'pane'));

  const rootHeight = async (canvas: Canvas) => {
    const run = applyPerturbation('many', expandInstances(canvas.root, canvas), { type: 'desktop-app' });
    return flat(await layoutOf(canvas, run.root)).find((r) => r.nodeId === canvas.root.id)?.height;
  };
  check('with root overflow hidden the root keeps the window height', (await rootHeight(shellWith({ overflow: 'auto' }, true))) === 900);
  check('twin: without it the root grows with the tripled list', ((await rootHeight(shellWith({ overflow: 'auto' }, false))) ?? 0) > 900);

  // The defect this check caught during the build: a table with `overflow`
  // directly in a scrolling pane may shrink below its rows.
  const squash = async (overflow: 'hidden' | undefined) => {
    const canvas = stamped('dashboard-app', false);
    const table = flatNodes(canvas.root).find((n) => n.id === 'dba-table')!;
    if (overflow) table.overflow = overflow;
    const base = expandInstances(canvas.root, canvas);
    const before = new Map(flat(await layoutOf(canvas, base)).map((r) => [r.nodeId, r.height]));
    const after = flat(await layoutOf(canvas, applyPerturbation('many', base, { type: 'desktop-app' }).root));
    return after.filter((r) => (before.get(r.nodeId) ?? 0) - r.height > 1).map((r) => r.nodeId);
  };
  check('dashboard-app\'s table keeps its height under many', (await squash(undefined)).length === 0);
  check('twin: with overflow hidden it squashes, and the check sees it', (await squash('hidden')).includes('dba-table'));
}

for (const s of listStructures().filter((x) => x.kind === 'component' && x.surface === 'any')) {
  const canvas = stamped(s.name, false);
  const findings = await detailedFindings(canvas, false);
  check(`${s.name} (any): detailed mode raises no desktop-app warning or error`, findings.length === 0, findings.slice(0, 4).join(' | '));
  const { warnings } = await stress(canvas);
  check(`${s.name} (any): full stress run CLEAN on desktop-app`, warnings.length === 0, warnings.slice(0, 4).join(' | '));
}

console.log(allPass ? '\nAll desktop-app pattern-gate tests passed.' : '\nSOME TESTS FAILED');
await shutdown();
process.exit(allPass ? 0 : 1);
