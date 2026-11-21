import '../env.js';
// Phase 32 slice C (FR-C5, FR-C6; contracts M7, M8, M10): the tint layer and
// `danger` derive from the inks and the surface when the design system does
// not define them, and a canvas still holding an old scaffold seed renders as
// if it were unset. Every asserted pass has a twin that must fail.
//
// Usage: npx tsx test/unit/test-derived-tints.ts

import { createCanvas } from '../../src/scene-graph.js';
import { applyStructure } from '../../src/structures.js';
import { getPreset } from '../../src/presets.js';
import { expandTree } from '../../src/expand.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { applyPresetTokens, resolveVariables, withoutRetiredSeeds } from '../../src/variables.js';
import { contrastRatio, parseColor } from '../../src/color-math.js';
import { tintFor, tintLayer } from '../../src/color-system.js';
import { generateDesignSystem } from '../../src/design-language.js';
import { canvasVersionHash } from '../../src/version.js';
import { createProject, createWorkspace, getCanvasTokens, getInheritedTokens, setWorkspaceDesignSystem } from '../../src/workspaces.js';
import type { Canvas, DesignVariables, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!);
/** A colour's mode: dark when it contrasts more with white than with black. */
const modeOf = (hex: string) => (ratio(hex, '#FFFFFF') > ratio(hex, '#000000') ? 'dark' : 'light');
const isGrey = (hex: string) => { const [r, g, b] = parseColor(hex)!; return r === g && g === b; };

/** Resolve one token through the resolver, as a fill. */
function resolveFill(ref: string, vars: DesignVariables, theme?: 'light' | 'dark'): string {
  return resolveVariables({ id: 'x', type: 'frame', fill: ref } as SceneNode, vars, { theme }).fill as string;
}

/** The resolved node whose authored prop was `ref`, in a canvas's one tree. */
function resolvedBy(canvas: Canvas, prop: 'fill' | 'color' | 'stroke', ref: string, theme?: 'light' | 'dark'): SceneNode | undefined {
  const raw = expandTree(canvas.root, canvas).root;
  let id: string | undefined;
  (function find(n: SceneNode) { if (!id && n[prop] === ref) id = n.id; n.children?.forEach(find); })(raw);
  const resolved = expandTree(canvas.root, canvas, getCanvasTokens(canvas), { theme }).root;
  let out: SceneNode | undefined;
  (function find(n: SceneNode) { if (n.id === id) out = n; n.children?.forEach(find); })(resolved);
  return out;
}

function stamped(structure: string, preset?: string, type?: 'desktop-app'): Canvas {
  const canvas = createCanvas(`dt-${structure}-${preset ?? 'unthemed'}`, undefined, {}, type ? { type } : undefined);
  applyStructure(canvas, structure);
  if (preset) applyPresetTokens(canvas, getPreset(preset)!.variables, getInheritedTokens(canvas));
  return canvas;
}

// ── FR-C5: tints follow the surface ───────────────────────────────────────────
{
  const light = resolvedBy(stamped('status-chip', 'light'), 'fill', '$success-tint')?.fill as string;
  check('status-chip then apply_preset light: a light-mode tint', !!light && modeOf(light) === 'light', light);
  const dark = resolvedBy(stamped('status-chip', 'dark'), 'fill', '$success-tint')?.fill as string;
  check('...under apply_preset dark: a dark-mode tint', !!dark && modeOf(dark) === 'dark', dark);
  const unthemed = resolvedBy(stamped('status-chip'), 'fill', '$success-tint')?.fill as string;
  check('...unthemed: a dark-mode tint (the scaffold palette is dark)', !!unthemed && modeOf(unthemed) === 'dark', unthemed);
  // Twin: a hand-set dark tint that is NOT the old seed survives the light
  // preset, as any canvas token does.
  const kept = stamped('status-chip');
  kept.variables.colors = { ...kept.variables.colors, 'success-tint': '#0F2E1C' };
  applyPresetTokens(kept, getPreset('light')!.variables, getInheritedTokens(kept));
  check('twin: a non-seed dark tint is kept under the light preset', resolvedBy(kept, 'fill', '$success-tint')?.fill === '#0F2E1C');
}
{
  // A generated system's inks on tints derived from them clear 4.5:1 in both
  // themes (seed #2563EB; the generator's own light accent-tint cap makes
  // some seeds miss, contract M7).
  const sys = generateDesignSystem('#2563EB', 'technical').variables;
  const strip = (c: Record<string, string> | undefined) => Object.fromEntries(Object.entries(c ?? {}).filter(([k]) => !k.endsWith('-tint')));
  const vars: DesignVariables = { ...sys, colors: strip(sys.colors), dark: { ...sys.dark, colors: strip(sys.dark?.colors) } };
  for (const theme of ['light', 'dark'] as const) {
    for (const [ink, tint] of [['$success', '$success-tint'], ['$accent', '$accent-tint'], ['$danger', '$danger-tint']]) {
      const node = resolveVariables({ id: 'x', type: 'text', content: 'x', fill: tint, color: ink } as SceneNode, vars, { theme });
      const r = ratio(node.color as string, node.fill as string);
      check(`generated system, ${theme}: ${ink} on a derived ${tint} clears 4.5:1`, r >= 4.5, r.toFixed(2));
    }
  }
}
{
  const light = stamped('settings-app', 'light', 'desktop-app');
  const resolved = expandTree(light.root, light, getCanvasTokens(light)).root;
  let deleteFill: string | undefined;
  (function find(n: SceneNode) { if (n.id === 'sta-delete') deleteFill = n.fill as string; n.children?.forEach(find); })(resolved);
  check('settings-app then apply_preset light: the danger action draws the preset\'s error', deleteFill?.toLowerCase() === '#ef4444', deleteFill);
  const unthemed = stamped('settings-app', undefined, 'desktop-app');
  const ev = await evaluateCanvas(unthemed, { mode: 'fast', categories: ['structure'] });
  check('...unthemed, it resolves with no unknown-token finding', !ev.issues.some((i) => i.rule === 'unknown-token'));
  const unthemedFill = resolvedBy(unthemed, 'stroke', '$danger')?.stroke;
  check('...and unthemed, danger is #F87171 (the dark-mode fallback on the dark scaffold surface)', unthemedFill === '#F87171', unthemedFill as string);
}
{
  check('danger: an explicit error wins', resolveFill('$danger', { colors: { error: '#B00020' } }) === '#B00020');
  check('danger: no token on a light surface is #DC2626', resolveFill('$danger', { colors: { 'bg-surface': '#FFFFFF' } }) === '#DC2626');
  check('twin: on a dark surface it is #F87171', resolveFill('$danger', { colors: { 'bg-surface': '#111111' } }) === '#F87171');
  check('a defined danger is never replaced', resolveFill('$danger', { colors: { danger: '#123456', error: '#B00020' } }) === '#123456');
}

// ── M7: the surface, alpha and grey inks ──────────────────────────────────────
{
  check('M10: a #777777 surface derives light tints', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#777777' } })) === 'light');
  check('M10 twin: a #757575 surface derives dark tints', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#757575' } })) === 'dark');
  check('a translucent surface lies over bg-primary: a glass card on a dark page is dark', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#ffffff0a', 'bg-primary': '#0a0a0a' } })) === 'dark');
  check('twin: the same glass over a light page is light', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#ffffff0a', 'bg-primary': '#fafafa' } })) === 'light');
  check('an hsl() surface parses (dark)', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': 'hsl(222 47% 11%)' } })) === 'dark');
  check('the `surface` alias is a surface too (a design.md import names it so)', modeOf(resolveFill('$accent-tint', { colors: { surface: '#1C1C1E', background: '#000000' } })) === 'dark');
  check('twin: and `background` behind a translucent surface', modeOf(resolveFill('$accent-tint', { colors: { surface: '#ffffff10', background: '#000000' } })) === 'dark' && modeOf(resolveFill('$accent-tint', { colors: { surface: '#ffffff10', background: '#fafafa' } })) === 'light');
  {
    const c = createCanvas('dt-alias-stamp');
    c.variables = { colors: { surface: '#FAFAFA' } };
    const r = applyStructure(c, 'status-chip', { existingColors: new Set(['surface']) });
    check('a stamp on a canvas naming its surface `surface` does not seed a dark bg-surface over it', !r.seededColors.includes('bg-surface'), r.seededColors.join(', '));
  }
  check('an unparseable surface falls to bg-primary', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': 'var(--x)', 'bg-primary': '#0a0a0a' } })) === 'dark');
  const neutral = resolveFill('$neutral-tint', { colors: { 'bg-surface': '#111111', 'text-secondary': '#ffffffa0' } });
  check('a grey ink with alpha (composited over the surface) gets a grey tint', isGrey(neutral) && modeOf(neutral) === 'dark', neutral);
  check('twin: the generator\'s tintLayer is unchanged and gives that ink a hue', !isGrey(tintLayer({ 'accent-tint': '#a5a5a5', 'success-tint': '#a5a5a5', 'warning-tint': '#a5a5a5', 'danger-tint': '#a5a5a5', 'neutral-tint': '#a5a5a5' }, 'dark')['neutral-tint']));
  check('tintLayer output matches its pre-slice value (#1d4ed8 light → #DDE8FF)', tintLayer({ 'accent-tint': '#1d4ed8', 'success-tint': '#1d4ed8', 'warning-tint': '#1d4ed8', 'danger-tint': '#1d4ed8', 'neutral-tint': '#1d4ed8' }, 'light')['accent-tint'] === '#DDE8FF');
  check('a defined tint is never replaced', resolveFill('$accent-tint', { colors: { 'accent-tint': '#ABCDEF' } }) === '#ABCDEF');
  check('a dark render derives from the dark layer', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#FFFFFF' }, dark: { colors: { 'bg-surface': '#111111' } } }, 'dark')) === 'dark');
  check('twin: the same tokens in light derive light', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#FFFFFF' }, dark: { colors: { 'bg-surface': '#111111' } } })) === 'light');
  check('the derived accent-tint is tintFor of the accent', resolveFill('$accent-tint', { colors: { accent: '#0E7490', 'bg-surface': '#FFFFFF' } }) === tintFor('#0E7490', 'light'));
}

// ── FR-C6 and M8: old seeds count as unset ────────────────────────────────────
{
  const seeded = stamped('status-chip');
  seeded.variables.colors = { ...seeded.variables.colors, 'success-tint': '#0f2e1b' };
  applyPresetTokens(seeded, getPreset('light')!.variables, getInheritedTokens(seeded));
  const fill = resolvedBy(seeded, 'fill', '$success-tint')?.fill as string;
  check('a canvas stored with success-tint "#0f2e1b" renders the derived tint under a light preset', modeOf(fill) === 'light', fill);
  check('...and its stored JSON is not rewritten', seeded.variables.colors?.['success-tint'] === '#0f2e1b');

  const ws = createWorkspace('dt-ws');
  setWorkspaceDesignSystem(ws.id, { colors: { 'success-tint': '#DAF8DF' } });
  const project = createProject(ws.id, 'dt-p')!;
  const inherits = createCanvas('dt-inherits', project.id);
  applyStructure(inherits, 'status-chip');
  inherits.variables.colors = { ...inherits.variables.colors, 'success-tint': '#0F2E1B' };
  check('a seed under a workspace that generated success-tint renders the workspace\'s value', resolvedBy(inherits, 'fill', '$success-tint')?.fill === '#DAF8DF');
  inherits.variables.colors['success-tint'] = '#0F2E1C';
  check('twin: a non-seed canvas value still wins over the workspace', resolvedBy(inherits, 'fill', '$success-tint')?.fill === '#0F2E1C');

  // apply_preset / generate at canvas scope preserve the inherited tint
  // instead of overwriting the dead seed.
  inherits.variables.colors['success-tint'] = '#0F2E1B';
  const merge = applyPresetTokens(inherits, { colors: { 'success-tint': '#E0FFE0' } }, getInheritedTokens(inherits));
  check('a canvas-scope system preserves the inherited tint over a seed', merge.preserved.some((p) => p.key === 'success-tint') && inherits.variables.colors['success-tint'] === '#0F2E1B');
  inherits.variables.colors['success-tint'] = '#0F2E1C';
  const merge2 = applyPresetTokens(inherits, { colors: { 'success-tint': '#E0FFE0' } }, getInheritedTokens(inherits));
  check('twin: over a non-seed own value it writes', !merge2.preserved.some((p) => p.key === 'success-tint') && inherits.variables.colors['success-tint'] === '#E0FFE0');

  check('danger "#F87171" counts as a seed too', !getCanvasTokens({ ...seeded, variables: { colors: { danger: '#F87171' } } }).colors?.danger);
  check('get_variables omits the seeds', !withoutRetiredSeeds({ colors: { 'accent-tint': '#152a47', accent: '#2563EB' } }).colors?.['accent-tint']);
  check('...and keeps everything else', withoutRetiredSeeds({ colors: { 'accent-tint': '#152a48', accent: '#2563EB' } }).colors?.['accent-tint'] === '#152a48');
  check('a seed value under another name is kept (matched by name and value)', getCanvasTokens({ ...seeded, variables: { colors: { error: '#F87171' } } }).colors?.error === '#F87171');
}
{
  // The version hash reads the tokens getCanvasTokens returns.
  const plain = createCanvas('dt-hash');
  plain.variables = { colors: { accent: '#2563EB' } };
  const withSeed = structuredClone(plain);
  withSeed.variables.colors!['accent-tint'] = '#152A47';
  check('a canvas holding a seed hashes as if it were unset', canvasVersionHash(withSeed) === canvasVersionHash(plain));
  const withOther = structuredClone(plain);
  withOther.variables.colors!['accent-tint'] = '#152A48';
  check('twin: any other value moves the hash', canvasVersionHash(withOther) !== canvasVersionHash(plain));
}

// ── Verify round 1: a canvas without variables, and a seed-only colour layer ──
{
  const bare = createCanvas('dt-bare');
  delete (bare as { variables?: unknown }).variables;
  let threw = '';
  try { getCanvasTokens(bare); } catch (e) { threw = (e as Error).message; }
  check('a stored canvas with no variables key still resolves its tokens', !threw, threw);
  const seedOnly = createCanvas('dt-seed-only');
  seedOnly.variables = { colors: { 'accent-tint': '#152A47' } };
  const none = structuredClone(seedOnly);
  none.variables = {};
  check('a colour layer holding only a seed hashes as if it had no colours', canvasVersionHash(seedOnly) === canvasVersionHash(none));
  const empty = structuredClone(seedOnly);
  empty.variables = { colors: { 'accent-tint': '#152A48' } };
  check('twin: a non-seed value does not', canvasVersionHash(empty) !== canvasVersionHash(none));
}

// ── Verify round 1 (mutation): fallbacks, surface order, each seed ────────────
{
  check('danger-tint derives from danger, not error', resolveFill('$danger-tint', { colors: { 'bg-surface': '#FFFFFF', danger: '#7C2D12', error: '#B00020' } }) === tintFor('#7C2D12', 'light'));
  check('accent-tint derives from primary when there is no accent', resolveFill('$accent-tint', { colors: { 'bg-surface': '#FFFFFF', primary: '#0E7490' } }) === tintFor('#0E7490', 'light'));
  const empty = { colors: { 'bg-surface': '#FFFFFF' } };
  const lit: Array<[string, string]> = [['$accent-tint', '#2563EB'], ['$success-tint', '#16A34A'], ['$warning-tint', '#D97706'], ['$danger-tint', '#DC2626'], ['$neutral-tint', '#6B7280']];
  const wrong = lit.filter(([ref, ink]) => resolveFill(ref, empty) !== tintFor(ink, 'light', { grey: true }));
  check('with no inks each tint derives from its literal ink', wrong.length === 0, wrong.map(([r]) => r).join(', '));
  check('bg-surface wins over bg-primary', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#FFFFFF', 'bg-primary': '#111111' } })) === 'light');
  check('twin: bg-primary alone decides', modeOf(resolveFill('$accent-tint', { colors: { 'bg-primary': '#111111' } })) === 'dark');
  check('a translucent surface with nothing behind it lies over white', modeOf(resolveFill('$accent-tint', { colors: { 'bg-surface': '#00000010' } })) === 'light');
  const { hexToOklch } = await import('../../src/color-system.js');
  check('an ink of chroma 0.003 counts as grey', hexToOklch('#808082').c < 0.005 && isGrey(resolveFill('$neutral-tint', { colors: { 'bg-surface': '#FFFFFF', 'text-secondary': '#808082' } })));
  check('twin: #6B7280 (chroma 0.023) keeps its hue', !isGrey(resolveFill('$neutral-tint', { colors: { 'bg-surface': '#FFFFFF', 'text-secondary': '#6B7280' } })));
  check('a pure grey ink in light mode gets a grey tint', isGrey(resolveFill('$neutral-tint', { colors: { 'bg-surface': '#FFFFFF', 'text-secondary': '#808080' } })));
  const dark = resolveVariables({ id: 'x', type: 'frame', shadow: '$elevation.raised' } as SceneNode, { elevation: { raised: [{ x: 0, y: 1, blur: 2, spread: 0, color: '#000' }] }, dark: { elevation: { raised: [{ x: 0, y: 9, blur: 9, spread: 0, color: '#fff' }] } } }, { theme: 'dark' });
  check('a dark render merges dark.elevation too', dark.shadows?.[0]?.y === 9, JSON.stringify(dark.shadows));
}
{
  const seeds: Array<[string, string]> = [['accent-tint', '#152A47'], ['success-tint', '#0F2E1B'], ['warning-tint', '#33260A'], ['danger-tint', '#3A1715'], ['neutral-tint', '#25282D'], ['danger', '#F87171']];
  const kept = seeds.filter(([name, value]) => withoutRetiredSeeds({ colors: { [name]: value.toLowerCase() } }).colors?.[name] !== undefined);
  check('each of the six retired seeds counts as unset', kept.length === 0, kept.map(([n]) => n).join(', '));
  const near = seeds.filter(([name, value]) => withoutRetiredSeeds({ colors: { [name]: value.slice(0, 6) + 'F' } }).colors?.[name] === undefined);
  check('twin: one digit off, each is kept', near.length === 0, near.map(([n]) => n).join(', '));
  check('a seed with surrounding spaces still counts', withoutRetiredSeeds({ colors: { 'accent-tint': ' #152A47 ' } }).colors === undefined);
}
{
  const c = createCanvas('dt-primary-stamp');
  c.variables = { colors: { 'bg-primary': '#FAFAFA' } };
  const r = applyStructure(c, 'status-chip', { existingColors: new Set(['bg-primary']) });
  check('a stamp on a canvas with bg-primary does not seed bg-surface', !r.seededColors.includes('bg-surface'), r.seededColors.join(', '));
}

// ── No stamp reads badly on a derived tint ─────────────────────────────────────
// Every structure, unthemed and under each preset whose inks clear on its own
// surface (the light preset's success and error do not: FR-C5's last
// sentence), has no contrast error against a tint it derived. This sweep
// caught a lone status-chip deriving a light tint under its dark-tuned ink
// before stamps seeded the surface the derivation reads.
{
  const { listStructures } = await import('../../src/structures.js');
  const misses: string[] = [];
  for (const theme of [undefined, 'dark', 'material', 'minimal']) {
    for (const s of listStructures()) {
      const type = s.surface === 'mobile' || s.surface === 'desktop-app' ? s.surface : undefined;
      const canvas = createCanvas(`dt-sweep-${s.name}-${theme}`, undefined, {}, type ? { type } : undefined);
      applyStructure(canvas, s.name, { replace: true });
      if (theme) applyPresetTokens(canvas, getPreset(theme)!.variables, getInheritedTokens(canvas));
      const tokens = getCanvasTokens(canvas);
      const tints = ['accent-tint', 'success-tint', 'warning-tint', 'danger-tint', 'neutral-tint']
        .filter((t) => !tokens.colors?.[t])
        .map((t) => resolveFill(`$${t}`, tokens).toUpperCase());
      const ev = await evaluateCanvas(canvas, { mode: 'fast', categories: ['color'] });
      for (const i of ev.issues) {
        const against = /against (#[0-9A-Fa-f]{6})/.exec(i.message)?.[1]?.toUpperCase();
        if (i.severity !== 'info' && against && tints.includes(against)) misses.push(`${s.name} @ ${theme ?? 'unthemed'}: ${i.message.slice(0, 80)}`);
      }
    }
  }
  check('no stamp has a contrast error against a derived tint (unthemed, dark, material, minimal)', misses.length === 0, misses.slice(0, 4).join(' ;; '));
  // Twin: a light tint under a dark-tuned ink (the bug the seeding fixed) is caught.
  const chip = createCanvas('dt-sweep-twin');
  applyStructure(chip, 'status-chip');
  chip.variables.colors = { ...chip.variables.colors, 'bg-surface': '#FFFFFF' };
  const twin = await evaluateCanvas(chip, { mode: 'fast', categories: ['color'] });
  const lightTint = resolveFill('$success-tint', getCanvasTokens(chip)).toUpperCase();
  check('twin: a dark-tuned ink on a light derived tint is a contrast error the sweep sees', twin.issues.some((i) => i.severity === 'error' && i.message.toUpperCase().includes(`AGAINST ${lightTint}`)), lightTint);
}

if (!allPass) {
  console.log('\nSOME CHECKS FAILED');
  process.exit(1);
}
console.log('\nAll checks passed.');
process.exit(0);
