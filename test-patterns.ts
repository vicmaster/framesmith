import './test-env.js';
/**
 * Phase 20 Slice A — pattern library quality gate (FR-D1). Every page structure,
 * stamped onto an empty canvas, must score > 95 with ZERO cliché tells across
 * multiple themes. A pattern that ships a tell would *teach* slop, so this is the
 * backstop that keeps the library honest. Pure + fast (no Chrome).
 * Run with: npx tsx test-patterns.ts
 */
import { createCanvas } from './src/scene-graph.js';
import { listStructures, applyStructure } from './src/structures.js';
import { getPreset } from './src/presets.js';
import { evaluateCanvas, contrastRatio, parseColor } from './src/evaluate.js';
import { generateDesignSystem, PERSONALITY_NAMES } from './src/design-language.js';
import { setVariables, applyPresetTokens, getVariables } from './src/variables.js';
import { getCanvasTokens, createWorkspace, createProject, setWorkspaceDesignSystem } from './src/workspaces.js';
import type { Canvas, SceneNode } from './src/types.js';

const BAR = 95; // every pattern must score STRICTLY above this (> 95)
// Neutral default (applyStructure's seeded defaults) + every bundled preset.
// All presets now use designed off-white/off-black (no pure #ffffff/#000000),
// so a pattern must hold up under each without tripping a tell.
const THEMES = ['default', 'dark', 'light', 'material', 'minimal'] as const;
const CATEGORIES = ['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche', 'usability'];

/** The token names a canvas already resolves, as apply_structure passes them. */
function existing(canvas: Canvas): { existingColors: Set<string>; existingTokens: Set<string> } {
  const m = getCanvasTokens(canvas);
  return {
    existingColors: new Set(Object.keys(m.colors ?? {})),
    existingTokens: new Set([
      ...Object.keys(m.spacing ?? {}), ...Object.keys(m.radius ?? {}), ...Object.keys(m.typography ?? {}),
      ...Object.keys(m.elevation ?? {}).map((k) => `elevation.${k}`),
    ]),
  };
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

/** Phase 30 slice E (FR-E4) — a mobile realisation is also held to zero
 * findings from the mobile ruleset, at any severity. */
const mobileFindings = (issues: { rule?: string }[]): string[] =>
  issues.flatMap((i) => (i.rule?.startsWith('mobile-') ? [i.rule] : []));

async function main() {
  // Phase 31 slice D — the desktop-app realisations have their own gate below.
  const pages = listStructures().filter((s) => s.kind === 'page' && s.surface !== 'desktop-app');
  console.log(`\nPattern quality gate — ${pages.length} page structures × ${THEMES.length} themes (bar: > ${BAR}, zero tells)\n`);

  for (const s of pages) {
    const mobile = s.surface === 'mobile';
    for (const theme of THEMES) {
      // A realisation stamps on a canvas of its own surface.
      const canvas = createCanvas(`gate-${s.name}-${theme}`, undefined, {}, mobile ? { type: 'mobile' } : undefined);
      applyStructure(canvas, s.name, { replace: true });
      if (theme !== 'default') {
        const preset = getPreset(theme);
        // On a phone the presets lend colour, spacing, radius and depth but
        // not their type scale: every built-in preset sets a 14–15px body,
        // which mobile-type-floor rightly flags on every phone screen whatever
        // its structure. generate_design_system is the phone type path, and
        // the personalities below hold the realisations to it.
        if (preset) canvas.variables = mobile
          ? { ...structuredClone(preset.variables), typography: canvas.variables.typography }
          : structuredClone(preset.variables);
      }
      // The gate measures the PATTERN's taste/craft — coverage (Phase 24)
      // demands sibling state variants, which is a property of a designed
      // screen in a project, not of a scaffold stamped onto a bare canvas.
      const ev = await evaluateCanvas(canvas, {
        mode: 'fast',
        genre: theme === 'default' ? undefined : theme,
        categories: CATEGORIES,
      });
      const tells = ev.issues.filter((i) => i.category === 'cliche');
      const rules = mobile ? mobileFindings(ev.issues) : [];
      const ok = ev.overallScore > BAR && tells.length === 0 && rules.length === 0;
      const detail = ok ? `${ev.overallScore}` : `${ev.overallScore}${tells.length ? ' · tells: ' + tells.map((t) => t.tell).join(', ') : ''}${rules.length ? ' · mobile: ' + rules.join(', ') : ''}`;
      assert(ok, `${s.name} @ ${theme} — ${detail}`);
    }
  }

  // The phone type path: each personality's generated system on a mobile
  // canvas, stamped after it as an agent would (tokens it already has stay).
  const realisations = pages.filter((s) => s.surface === 'mobile');
  console.log(`\nMobile realisations on generated phone systems — ${realisations.length} × ${PERSONALITY_NAMES.length} personalities\n`);
  for (const s of realisations) {
    for (const personality of PERSONALITY_NAMES) {
      const canvas = createCanvas(`gate-${s.name}-${personality}`, undefined, {}, { type: 'mobile' });
      setVariables(canvas, generateDesignSystem('#166534', personality, { surface: 'mobile' }).variables);
      applyStructure(canvas, s.name, { replace: true, ...existing(canvas) });
      const ev = await evaluateCanvas(canvas, { mode: 'fast', categories: CATEGORIES });
      const tells = ev.issues.filter((i) => i.category === 'cliche');
      const rules = mobileFindings(ev.issues);
      const ok = ev.overallScore > BAR && tells.length === 0 && rules.length === 0;
      assert(ok, `${s.name} @ ${personality} — ${ev.overallScore}${tells.length ? ' · tells: ' + tells.map((t) => t.tell).join(', ') : ''}${rules.length ? ' · mobile: ' + rules.join(', ') : ''}`);
    }
  }

  // Components marked for every type stamp onto a bare phone canvas without a
  // single mobile finding (their score is the web gate's business).
  const anyComponents = listStructures().filter((s) => s.kind === 'component' && s.surface === 'any');
  console.log(`\nComponents marked for every type, on a phone canvas — ${anyComponents.length}\n`);
  for (const s of anyComponents) {
    const canvas = createCanvas(`gate-${s.name}-mobile`, undefined, {}, { type: 'mobile' });
    applyStructure(canvas, s.name);
    const rules = mobileFindings((await evaluateCanvas(canvas, { mode: 'fast' })).issues);
    assert(rules.length === 0, `${s.name} on mobile${rules.length ? ' — ' + rules.join(', ') : ''}`);
  }

  await desktopGate();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
main();

// ── Phase 31 slice D (FR-D3, G2 + G4) — the desktop-app gate ────────────────
// Every desktop-app realisation, and data-table-app / skeleton-table-app,
// stamped on a desktop-app canvas under the inputs the docs promise agents:
// the five themes (presets merged after the stamp, as apply_preset merges),
// each personality × three seeds generated before the stamp, and a web-pivot
// system inherited from the workspace. Pass = score > 95, zero tells, zero
// desktop-app findings at any severity, zero warnings or errors in any gated
// category, and an active nav-item's label legible on $accent-tint.

const SEEDS = ['#166534', '#2563EB', '#B45309'];

/** What each stamp asks of coverage (pinned, and stated in GUIDELINES). */
const COVERAGE_MISSING: Record<string, string[]> = {
  'split-workbench-app': [],
  'list-detail-app': [],
  'editor-inspector-app': ['error'],
  'browser-app': [],
  'dashboard-app': ['empty', 'loading'],
  'settings-app': ['error'],
  'data-table-app': ['empty', 'loading'],
  'skeleton-table-app': ['empty', 'loading'],
};

const blocking = (issues: { severity: string; rule?: string; category: string; tell?: string }[]): string[] =>
  issues.flatMap((i) => (i.severity !== 'info' || i.rule?.startsWith('desktop-app-') || i.category === 'cliche'
    ? [`${i.severity}:${i.rule ?? i.tell ?? i.category}`] : []));

/** `$text-primary` on `$accent-tint`, light and dark, where the canvas has a tint. */
function tintContrast(canvas: Canvas): number[] {
  const merged = getVariables(canvas);
  const ratios: number[] = [];
  for (const colors of [merged.colors, merged.dark?.colors ? { ...merged.colors, ...merged.dark.colors } : undefined]) {
    const tint = colors?.['accent-tint'];
    const ink = colors?.['text-primary'];
    const fg = typeof ink === 'string' ? parseColor(ink) : null;
    const bg = typeof tint === 'string' ? parseColor(tint) : null;
    if (fg && bg) ratios.push(contrastRatio(fg, bg));
  }
  return ratios;
}

/** A desktop-app canvas; a component goes under a root painted as a page is. */
function appCanvas(name: string, component: boolean): Canvas {
  const canvas = createCanvas(name, undefined, {}, { type: 'desktop-app' });
  if (component) canvas.root.fill = '$bg-primary';
  return canvas;
}

async function judge(canvas: Canvas, label: string, structure: string, genre?: string) {
  const ev = await evaluateCanvas(canvas, { mode: 'fast', genre, categories: CATEGORIES });
  const bad = blocking(ev.issues);
  const weak = tintContrast(canvas).filter((r) => r < 4.5);
  const ok = ev.overallScore > BAR && bad.length === 0 && weak.length === 0;
  assert(ok, `${structure} @ ${label} — ${ev.overallScore}${bad.length ? ' · ' + bad.join(', ') : ''}${weak.length ? ' · tint ' + weak.map((r) => r.toFixed(2)).join('/') : ''}`);
}

async function desktopGate() {
  const app = listStructures({ type: 'desktop-app' }).filter((s) => s.surface === 'desktop-app');
  const names = app.map((s) => s.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(Object.keys(COVERAGE_MISSING).sort()), `the desktop-app set is the six realisations and two components (${names.join(', ')})`);
  console.log(`\nDesktop-app gate — ${app.length} structures × (${THEMES.length} themes + ${PERSONALITY_NAMES.length}×${SEEDS.length} generated + 1 inherited)\n`);

  for (const s of app) {
    const component = s.kind === 'component';
    for (const theme of THEMES) {
      const canvas = appCanvas(`gate-${s.name}-${theme}`, component);
      applyStructure(canvas, s.name, { replace: true });
      if (theme !== 'default') applyPresetTokens(canvas, getPreset(theme)!.variables, getVariables(canvas));
      await judge(canvas, theme, s.name, theme === 'default' ? undefined : theme);
    }
    for (const personality of PERSONALITY_NAMES) {
      for (const seed of SEEDS) {
        const canvas = appCanvas(`gate-${s.name}-${personality}`, component);
        setVariables(canvas, generateDesignSystem(seed, personality, { surface: 'desktop-app' }).variables);
        applyStructure(canvas, s.name, { replace: true, ...existing(canvas) });
        await judge(canvas, `${personality} ${seed}`, s.name);
      }
    }

    // A design system generated at workspace scope (the web pivot) and
    // inherited by the desktop-app canvas.
    const ws = createWorkspace(`gate-ws-${s.name}`);
    setWorkspaceDesignSystem(ws.id, generateDesignSystem('#2563EB', 'technical').variables);
    const project = createProject(ws.id, `gate-p-${s.name}`)!;
    const inherited = createCanvas(`gate-${s.name}-inherited`, project.id, {}, { type: 'desktop-app' });
    if (component) inherited.root.fill = '$bg-primary';
    applyStructure(inherited, s.name, { replace: true, ...existing(inherited) });
    await judge(inherited, 'inherited workspace system', s.name);

    // Coverage is outside the score bar, but what a stamp asks for is pinned.
    const covCanvas = appCanvas(`gate-${s.name}-cov`, component);
    applyStructure(covCanvas, s.name, { replace: true });
    const missing = (await evaluateCanvas(covCanvas, { mode: 'fast', categories: ['coverage'] })).coverage?.missing ?? [];
    assert(JSON.stringify([...missing].sort()) === JSON.stringify([...COVERAGE_MISSING[s.name]].sort()), `${s.name} asks coverage for [${missing.join(', ')}]`);
  }

  // Twins: the gate's own predicates must fail on a stamp broken the way a
  // realisation could break.
  const twoActive = appCanvas('twin-active', false);
  applyStructure(twoActive, 'split-workbench-app');
  const navItems = twoActive.root.children![0].children![0].children![1].children!;
  navItems[1].active = true;
  const twoActiveEv = await evaluateCanvas(twoActive, { mode: 'fast', categories: CATEGORIES });
  assert(blocking(twoActiveEv.issues).some((b) => b.includes('desktop-app-current')), 'twin: a second active nav-item fails the gate');
  const unnamed = appCanvas('twin-unnamed', false);
  applyStructure(unnamed, 'split-workbench-app');
  const walk = (n: SceneNode): SceneNode[] => [n, ...(n.children ?? []).flatMap(walk)];
  delete walk(unnamed.root).find((n) => n.id === 'swa-toggle')!.ariaLabel;
  assert(blocking((await evaluateCanvas(unnamed, { mode: 'fast', categories: CATEGORIES })).issues).some((b) => b.includes('desktop-app-icon-label')), 'twin: an icon-only button without ariaLabel fails the gate');
  const darkTint = appCanvas('twin-tint', false);
  applyStructure(darkTint, 'split-workbench-app');
  darkTint.variables.colors = { ...darkTint.variables.colors, 'accent-tint': '#152A47' };
  applyPresetTokens(darkTint, getPreset('light')!.variables, getVariables(darkTint));
  assert(tintContrast(darkTint).some((r) => r < 4.5), 'twin: a dark $accent-tint left under the light preset fails the tint check');

  // Components marked for every type stamp on a bare desktop-app canvas with
  // no desktop-app warning or error (spec change S7: their infos, such as a
  // delta pill read as a small button, are advisories; their score is the
  // web gate's).
  for (const s of listStructures().filter((x) => x.kind === 'component' && x.surface === 'any')) {
    const canvas = appCanvas(`gate-${s.name}-app`, false);
    applyStructure(canvas, s.name);
    const rules = (await evaluateCanvas(canvas, { mode: 'fast' })).issues.flatMap((i) => (i.rule?.startsWith('desktop-app-') && i.severity !== 'info' ? [i.rule] : []));
    assert(rules.length === 0, `${s.name} on desktop-app${rules.length ? ' — ' + rules.join(', ') : ''}`);
  }
}
