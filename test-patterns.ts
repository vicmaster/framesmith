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
import { evaluateCanvas } from './src/evaluate.js';
import { generateDesignSystem, PERSONALITY_NAMES } from './src/design-language.js';
import { setVariables } from './src/variables.js';
import { getCanvasTokens } from './src/workspaces.js';
import type { Canvas } from './src/types.js';

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
  const pages = listStructures().filter((s) => s.kind === 'page');
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
main();
