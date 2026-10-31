// Phase 27 slice A — the personality gate: every personality's generated
// system must clear the full evaluator (both themes) and the cliché tells on
// a real stamped structure, resolve its elevation refs, and be visibly
// distinct from the others. No Chrome, no network (fast mode; fonts are
// checked as token values, not resolved binaries).
//
// Usage: npx tsx test-design-language.ts

import './test-env.js';
import { generateDesignSystem, typeBase, PERSONALITY_NAMES, type PersonalityName } from './src/design-language.js';
import { createCanvas } from './src/scene-graph.js';
import { applyStructure } from './src/structures.js';
import { evaluateCanvas } from './src/evaluate.js';
import { resolveVariables, setVariables } from './src/variables.js';
import type { SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const SEED = '#0E7490';

for (const personality of PERSONALITY_NAMES) {
  console.log(`\n── ${personality} ──`);
  const system = generateDesignSystem(SEED, personality);
  const vars = system.variables;

  // ── structure of the output ────────────────────────────────────────────
  check('roles present', ['display', 'heading', 'body', 'label', 'caption'].every((r) => vars.typography?.[r] !== undefined));
  check('display role carries the pairing', vars.typography!['display'].fontFamily === system.fonts.display);
  check('body role carries the body face', vars.typography!['body'].fontFamily === system.fonts.body);
  check('body family is the document default convention', typeof vars.typography!['body'].fontFamily === 'string');
  check('radius stance present', ['radius-sm', 'radius-md', 'radius-lg'].every((k) => typeof vars.radius?.[k] === 'number'));
  check('elevation semantic names', ['flat', 'raised', 'floating', 'overlay'].every((k) => Array.isArray(vars.elevation?.[k])));
  check('dark elevation re-states every depth', ['flat', 'raised', 'floating', 'overlay'].every((k) => Array.isArray(vars.dark?.elevation?.[k])));
  check('motion defaults', ['fast', 'base', 'slow'].every((k) => vars.motion?.[k] !== undefined));

  const sizes = Object.values(vars.typography!).map((t) => t.fontSize).filter((s): s is number => typeof s === 'number');
  check('no token below the 11px UI floor', Math.min(...sizes) >= 11, `min ${Math.min(...sizes)}`);
  check('body and label roles at 12px+', (vars.typography!['body'].fontSize as number) >= 12 && (vars.typography!['label'].fontSize as number) >= 12);

  // ── elevation resolution, both themes ──────────────────────────────────
  const node: SceneNode = { id: 'card', type: 'frame', width: 400, shadow: '$elevation.raised' };
  const light = resolveVariables(node, vars);
  const dark = resolveVariables(node, vars, { theme: 'dark' });
  check('$elevation.raised resolves to shadows[]', Array.isArray(light.shadows) && light.shadow === undefined);
  check('dark theme re-states the depth', JSON.stringify(dark.shadows) !== JSON.stringify(light.shadows));

  // explicit shadows win over the ref
  const explicit = resolveVariables({ id: 'x', type: 'frame', shadow: '$elevation.raised', shadows: [{ x: 0, y: 0, blur: 1, color: '#000' }] }, vars);
  check('explicit shadows beat the elevation ref', explicit.shadows!.length === 1 && explicit.shadows![0].blur === 1);

  // ── the gate: stamped structure + full evaluator, both themes ──────────
  const canvas = createCanvas(`gate-${personality}`);
  applyStructure(canvas, 'dashboard', { replace: true, existingColors: new Set() });
  setVariables(canvas, vars);
  // Coverage is excluded like test-patterns does: a freshly stamped canvas
  // has no state variants yet, and this gate measures craft, not workflow.
  const result = await evaluateCanvas(canvas, { mode: 'fast', genre: 'dashboard', categories: ['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche', 'usability'] });
  const errors = result.issues.filter((i) => i.severity === 'error');
  const cliche = result.issues.filter((i) => i.category === 'cliche');
  check('stamped dashboard: zero errors both themes', errors.length === 0, errors.slice(0, 2).map((i) => `[${i.category}] ${i.message.slice(0, 80)}`).join('; '));
  check('stamped dashboard: cliché-clean', cliche.length === 0, cliche.slice(0, 2).map((i) => i.message.slice(0, 80)).join('; '));
  // Slice B tightened this back to the presentation bar: archetypes read
  // their density from the personality's tokens, so every personality's
  // stamp clears the same gate the pattern library holds.
  check('score above the presentation bar', result.overallScore > 95, String(result.overallScore));
}

// ── personalities are visibly distinct ────────────────────────────────────
{
  console.log('\n── differentiation ──');
  const tech = generateDesignSystem(SEED, 'technical').variables;
  const soft = generateDesignSystem(SEED, 'soft').variables;
  const editorial = generateDesignSystem(SEED, 'editorial').variables;
  const dense = generateDesignSystem(SEED, 'data-dense').variables;

  check('radius stances differ', tech.radius!['radius-md'] !== soft.radius!['radius-md']);
  check('display faces differ', tech.typography!['display'].fontFamily !== editorial.typography!['display'].fontFamily);
  check('density differs (space-md)', dense.spacing!['space-md'] !== editorial.spacing!['space-md']);
  check('data-dense pivots small', (dense.typography!['body'].fontSize as number) < (editorial.typography!['body'].fontSize as number));
  check('data-dense ships a figures role', dense.typography!['figures']?.fontFamily === 'JetBrains Mono');
  check('same colors from the same seed', JSON.stringify(tech.colors) === JSON.stringify(soft.colors));
}

// ── options + errors ──────────────────────────────────────────────────────
{
  console.log('\n── options ──');
  const custom = generateDesignSystem(SEED, 'technical', { baseSize: 18, ratio: 'major-third' });
  check('baseSize override respected', custom.variables.typography!['body'].fontSize === 18);
  let err = '';
  try { generateDesignSystem(SEED, 'brutalist' as PersonalityName); } catch (e) { err = (e as Error).message; }
  check('unknown personality throws with the roster', err.includes('technical') && err.includes('data-dense'), err.slice(0, 80));
}

// ── Phase 30 slice B: the mobile type scale (FR-B4) ───────────────────────
{
  console.log('\n── mobile type scale ──');
  for (const personality of PERSONALITY_NAMES) {
    const sys = generateDesignSystem(SEED, personality, { surface: 'mobile' });
    const typo = sys.variables.typography!;
    const body = typo['body'].fontSize as number;
    const want = personality === 'data-dense' ? 16 : 17;
    check(`${personality}: mobile body is ${want}`, body === want, String(body));
    check(`${personality}: mobile body ≥ 16 (the mobile floor)`, body >= 16);
    const small = Object.entries(typo).filter(([, spec]) => typeof spec.fontSize === 'number' && (spec.fontSize as number) < 11);
    check(`${personality}: no role or step below 11 on mobile`, small.length === 0, small.map(([k, v]) => `${k}=${v.fontSize}`).join(', '));
    const base = typeBase(personality, { surface: 'mobile' });
    check(`${personality}: typeBase reports the mobile source`, base.source === 'mobile' && base.size === want);
  }
  const explicit = generateDesignSystem(SEED, 'soft', { surface: 'mobile', baseSize: 15 });
  check('explicit baseSize wins over the mobile pivot', explicit.variables.typography!['body'].fontSize === 15);
  check('typeBase: explicit source', typeBase('soft', { surface: 'mobile', baseSize: 15 }).source === 'explicit');
  const web = generateDesignSystem(SEED, 'technical', { surface: 'web' });
  check('web keeps the personality pivot', web.variables.typography!['body'].fontSize === generateDesignSystem(SEED, 'technical').variables.typography!['body'].fontSize);
  check('typeBase: personality source on web', typeBase('data-dense', { surface: 'web' }).source === 'personality' && typeBase('data-dense').size === 13);
}

console.log(allPass ? '\nAll design-language tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
