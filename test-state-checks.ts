// Phase 31 slice H (FR-H1 to FR-H4, spec R1 to R10) — the element states,
// checked without being drawn: the focus ring (desktop-app-focus-visible), the
// active indicator (desktop-app-state-contrast), disabled versus rest
// (desktop-app-disabled), the only-cue boundary (desktop-app-boundary), and
// FR-H3's text-contrast exclusion on every type. Every asserted pass has a
// twin that must fail, every failure a twin that must pass. R9(b): no
// generated system trips them on the backdrops it promises. Fast tier.
//
// Usage: npx tsx test-state-checks.ts

import './test-env.js';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { backdropBehind, parseAlpha, parseColor, contrastRatio } from './src/color-math.js';
import { boundaryPairs, disabledPairs, focusPairs, indicatorPairs, stateTargets, layerAlpha, paint } from './src/state-checks.js';
import { resolveVariables } from './src/variables.js';
import { generateDesignSystem, PERSONALITY_NAMES } from './src/design-language.js';
import type { Canvas, DesignVariables, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ` — ${extra}` : ''}`);
}

type Kind = 'web' | 'mobile' | 'desktop-app';
const FOCUS = 'desktop-app-focus-visible';
const ACTIVE = 'desktop-app-state-contrast';
const DISABLED = 'desktop-app-disabled';
const BOUNDARY = 'desktop-app-boundary';
const STATE_IDS = [FOCUS, ACTIVE, DISABLED, BOUNDARY];

function canvasOf(children: SceneNode[], variables: DesignVariables = {}, type: Kind = 'desktop-app', components: Record<string, SceneNode> = {}): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components, variables, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, children },
    metadata: { surface: type === 'desktop-app' ? { type, device: 'window-1440' } : { type } },
  } as Canvas;
}
async function issues(children: SceneNode[], variables: DesignVariables = {}, type: Kind = 'desktop-app', components: Record<string, SceneNode> = {}): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(canvasOf(children, variables, type, components), { mode: 'fast' });
  return r.issues;
}
const of = (all: EvaluationIssue[], rule: string) => all.filter((i) => i.rule === rule);
const show = (f: EvaluationIssue[]) => JSON.stringify(f.map((i) => `${i.severity}${i.theme ? `/${i.theme}` : ''}: ${i.message} [${(i.nodeIds ?? [i.nodeId]).join(',')}]`));
const panel = (children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id: 'panel', name: 'panel', type: 'frame', fill: '#FFFFFF', layout: 'vertical', gap: 8, padding: 16, width: 320, children, ...extra });
const ids = (i: EvaluationIssue | undefined) => [...(i?.nodeIds ?? [])].sort().join(',');

// ── R1: the shared walk and the percent alpha ─────────────────────────────
check('R1: a percent alpha is read', parseAlpha('rgba(0, 0, 0, 50%)') === 0.5 && parseAlpha('rgba(0,0,0,0.5)') === 0.5);
check('R1: an opaque colour is 1 (twin)', parseAlpha('#000') === 1 && parseAlpha('rgb(0, 0, 0)') === 1 && parseAlpha('rgba(0,0,0,100%)') === 1);
check('R1: #RRGGBBAA alpha', Math.abs(parseAlpha('#00000080') - 128 / 255) < 1e-9);
{
  const node = (fill?: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id: 'n', type: 'frame', fill, ...extra });
  const bd = (chain: SceneNode[]) => backdropBehind(chain);
  const color = (b: ReturnType<typeof bd>) => (b.kind === 'color' ? b.rgb.join(',') : b.kind);
  check('R1: no fill is the white page', color(bd([node()])) === '255,255,255');
  check('R1: a $token, transparent and none are seen through', color(bd([node('$x'), node('transparent'), node('none'), node('#000000')])) === '0,0,0');
  check('R1: a translucent fill composites over the next', color(bd([node('rgba(0, 0, 0, 50%)'), node('#FFFFFF')])) === '128,128,128');
  check('R1: a gradient stops the walk', color(bd([node(undefined, { gradient: { type: 'linear', stops: [] } as SceneNode['gradient'] }), node('#000000')])) === 'gradient');
  check('R1: an unparseable fill is unreadable', color(bd([node('hsl(0, 0%, 0%)'), node('#000000')])) === 'unreadable');
  const stop = (n: SceneNode) => (n.type === 'modal' ? n.fill : undefined);
  check('R1: the walk stops at an opaque overlay', color(backdropBehind([{ id: 'm', type: 'modal', fill: '#000000' }, node('#FFFFFF')], { stop })) === '0,0,0');
  check('R1: a translucent overlay is unreadable', color(backdropBehind([{ id: 'm', type: 'modal', fill: 'rgba(0,0,0,0.5)' }, node('#FFFFFF')], { stop })) === 'unreadable');
}

// ── R3 / FR-H1: desktop-app-focus-visible ─────────────────────────────────
// #8ea2ff is 2.40:1 on white, #7286ff 3.20:1.
const inspector = (): SceneNode[] => [panel([
  { id: 'b', type: 'button', label: 'Save', size: 'sm', fill: '#111111', color: '#FFFFFF' },
  { id: 'ti', type: 'text-input', placeholder: 'Name' },
  { id: 'cb', type: 'checkbox' },
  { id: 'ln', type: 'link', label: 'Docs' },
  { id: 'nv', type: 'nav-item', label: 'Home' },
  { id: 'tb', type: 'tabs', items: [{ label: 'Design', active: true }, { label: 'Layout' }] },
])];
{
  let f = of(await issues(inspector(), { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  const errors = f.filter((i) => i.severity === 'error');
  check('FR-H1: a 2.4:1 ring on the panel is ONE error', errors.length === 1, show(f));
  check('FR-H1: its nodeIds list every target on the panel', ids(errors[0]) === 'b,cb,ln,nv,tb,ti', show(f));
  check('FR-H1: its count is the targets (two tabs)', errors[0]?.count === 7, show(f));
  check('FR-H1: the message names the ring, the backdrop and the ratio', /#8ea2ff measures 2\.40:1 against #ffffff/.test(errors[0]?.message ?? ''), show(f));
  f = of(await issues(inspector(), { colors: { 'focus-ring': '#7286ff' } }), FOCUS);
  check('FR-H1 twin: a 3.2:1 ring raises nothing', f.length === 0, show(f));
  f = of(await issues(inspector(), { colors: { accent: '#8ea2ff' } }), FOCUS);
  check('R3: without $focus-ring the ring is $accent (the chain)', f.length === 1 && /#8ea2ff/.test(f[0].message), show(f));
  f = of(await issues(inspector(), { colors: { accent: '#7286ff', 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3 twin: $focus-ring wins over $accent', f.length === 1 && /#8ea2ff/.test(f[0].message), show(f));
  f = of(await issues(inspector()), FOCUS);
  check('R3: unthemed, the #2563EB fallback clears white', f.length === 0, show(f));

  // An outset ring meets the backdrop, never the target's own fill.
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go', fill: '#1d4ed8', color: '#FFFFFF' }])], { colors: { 'focus-ring': '#1d4ed8' } }), FOCUS);
  check('R3: an outset ring is not measured against the target fill', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go', fill: '#FFFFFF', color: '#111111' }], { fill: '#1d4ed8' })], { colors: { 'focus-ring': '#1d4ed8' } }), FOCUS);
  check('R3 twin: the same ring on a panel of its own colour errors', f.length === 1 && f[0].severity === 'error', show(f));

  // An inset ring (a tab) covers the tab's own rest fill.
  const contained = (variant: 'contained' | 'line') => [panel([{ id: 'tb', type: 'tabs', variant, fill: '#1e3a8a', items: [{ label: 'A', active: true }, { label: 'B' }] }])];
  f = of(await issues(contained('contained'), { colors: { 'focus-ring': '#1d4ed8' } }), FOCUS);
  check('R3: a contained active tab\'s ring meets its fill', f.length === 1 && f[0].count === 1 && /tab "A"/.test(f[0].message), show(f));
  f = of(await issues(contained('line'), { colors: { 'focus-ring': '#1d4ed8' } }), FOCUS);
  check('R3 twin: a line tab paints no fill, so the same ring passes', f.length === 0, show(f));
  // The focus layer is not the reference: a line tab whose ink layer would
  // darken the backdrop does not move the verdict.
  const tabsOnPanel = (ring: string) => issues([panel([{ id: 'tb', type: 'tabs', color: '#000000', items: [{ label: 'A', active: true }] }])], { colors: { 'focus-ring': ring }, state: { focus: 1 } });
  f = of(await tabsOnPanel('#7286ff'), FOCUS);
  check('R3: a tab ring is measured against the unfocused pixels (a full focus layer ignored)', f.length === 0, show(f));

  // Disabled targets draw no ring.
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go', disabled: true }, { id: 'b2', type: 'button', label: 'Go', state: 'disabled' }])], { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3: a disabled target is not measured (both spellings)', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go', disabled: false }])], { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3 twin: an enabled one is', f.length === 1, show(f));
  f = of(await issues([panel([{ id: 'tb', type: 'tabs', disabled: true, items: [{ label: 'A' }] }])], { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3: a disabled tabs node disables its tabs', f.length === 0, show(f));

  // Own opacity dims the ring with the target.
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go', opacity: 0.4 }])], { colors: { 'focus-ring': '#1d4ed8' } }), FOCUS);
  check('R2: a target\'s own opacity dims its ring', f.length === 1, show(f));
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go', opacity: 1 }])], { colors: { 'focus-ring': '#1d4ed8' } }), FOCUS);
  check('R2 twin: at opacity 1 the ring passes', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go' }])], { colors: { 'focus-ring': 'rgba(29, 78, 216, 30%)' } }), FOCUS);
  check('R2: a percent-alpha ring composites (fails)', f.length === 1, show(f));
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go' }])], { colors: { 'focus-ring': 'rgba(29, 78, 216, 100%)' } }), FOCUS);
  check('R2 twin: at 100% it passes', f.length === 0, show(f));

  // Unmeasurable: one info listing them.
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go' }], { fill: undefined, gradient: { type: 'linear', angle: 90, stops: [{ color: '#000000', position: 0 }, { color: '#FFFFFF', position: 1 }] } as SceneNode['gradient'] })]), FOCUS);
  check('R3: a gradient backdrop is one info naming the target', f.length === 1 && f[0].severity === 'info' && ids(f[0]) === 'b', show(f));
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go' }])], { colors: { 'focus-ring': 'hsl(220, 80%, 50%)' } }), FOCUS);
  check('R3: an unparseable ring is the same info', f.length === 1 && f[0].severity === 'info', show(f));

  // Items: modal actions and close report the modal; its fill is the backdrop.
  const modal = (fill: string): SceneNode[] => [panel([], { fill: '#000000' }), {
    id: 'm', name: 'm', type: 'modal', title: 'Delete?', fill, actions: [{ label: 'Cancel' }, { label: 'Delete', variant: 'destructive' }],
  }];
  f = of(await issues(modal('#FFFFFF'), { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3: a modal\'s close and actions are measured on the modal fill', f.length === 1 && f[0].count === 3 && ids(f[0]) === 'm' && /#ffffff/.test(f[0].message), show(f));
  f = of(await issues(modal('rgba(255,255,255,0.6)'), { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3 twin: a translucent modal is unreadable (its tree parent is not behind it)', f.length === 1 && f[0].severity === 'info', show(f));
  f = of(await issues([panel([{ id: 'nb', type: 'nav-bar', title: 'T', fill: '#8ea2ff', leading: { label: 'Back' } }])], { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3: a nav-bar action meets the nav-bar fill', f.length === 1 && f[0].count === 1 && /measures 1\.00:1/.test(f[0].message), show(f));
  f = of(await issues([panel([{ id: 'ts', type: 'toast', text: 'Saved', fill: '#FFFFFF', action: { label: 'Undo', disabled: true } }])], { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('R3: a disabled toast action is not measured', f.length === 0, show(f));

  // Dark theme: the dark layer is checked too, tagged.
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'Go' }], { fill: '$bg' })], { colors: { bg: '#FFFFFF', 'focus-ring': '#1d4ed8' }, dark: { colors: { bg: '#0b1220', 'focus-ring': '#1e3a8a' } } }), FOCUS);
  check('R2: a dark-only failure is tagged dark', f.length === 1 && f[0].theme === 'dark' && /dark token layer/.test(f[0].suggestion ?? ''), show(f));

  // Inside a component: the ring falls back to #2563EB, reported on the instance.
  const comp: SceneNode = { id: 'cc', type: 'frame', fill: '#2563EB', children: [{ id: 'cb1', type: 'button', label: 'Go' }] };
  f = of(await issues([panel([{ id: 'i1', name: 'i1', type: 'instance', componentId: 'cc' }])], { colors: { 'focus-ring': '#000000' } }, 'desktop-app', { cc: comp }), FOCUS);
  check('R2: a target inside a component uses #2563EB and reports the instance', f.length === 1 && ids(f[0]) === 'i1' && /#2563EB/.test(f[0].message), show(f));

  // Desktop-app only.
  for (const type of ['web', 'mobile'] as const) {
    const all = await issues(inspector(), { colors: { 'focus-ring': '#8ea2ff', 'border-strong': '#c1c1c1' }, state: { disabledContent: 1 } }, type);
    check(`R2: a ${type} canvas runs none of the four`, all.every((i) => !STATE_IDS.includes(i.rule ?? '')), show(all.filter((i) => STATE_IDS.includes(i.rule ?? ''))));
  }
}

// ── R4 / FR-H2: desktop-app-state-contrast ────────────────────────────────
{
  const nav = (iconColor: string, extra: Partial<SceneNode> = {}): SceneNode[] => [panel([{ id: 'nv', type: 'nav-item', label: 'Home', active: true, fill: '#EAF0FD', iconColor, ...extra }])];
  let f = of(await issues(nav('#7d91ff')), ACTIVE);
  check('FR-H2: a 2.5:1 nav-item indicator warns', f.length === 1 && f[0].severity === 'warning' && /2\.50:1 at rest/.test(f[0].message), show(f));
  f = of(await issues(nav('#1e3a8a')), ACTIVE);
  check('FR-H2 twin: a strong indicator passes', f.length === 0, show(f));
  // Hover only: an indicator lighter than the fill gets closer under a dark layer.
  const hoverOnly = indicatorPairs(resolveVariables(nav('#FFFFFF', { fill: '#5b6b8c', color: '#FFFFFF' })[0], {}))[0];
  const rest = contrastRatio(hoverOnly.rest.indicator, hoverOnly.rest.fill);
  const hover = contrastRatio(hoverOnly.hover.indicator, hoverOnly.hover.fill);
  check('R4: the hover layer is the ink over the fill (white ink lightens)', hover < rest, `${rest} ${hover}`);
  f = of(await issues(nav('#FFFFFF', { fill: '#6d7a95', color: '#FFFFFF' }), { state: { hover: 0.3 } }), ACTIVE);
  check('R4: a hover-only failure warns naming hover', f.length === 1 && /in hover/.test(f[0].message) && !/at rest/.test(f[0].message), show(f));
  f = of(await issues(nav('#FFFFFF', { fill: '#6d7a95', color: '#FFFFFF' }), { state: { hover: 0 } }), ACTIVE);
  check('R4 twin: with no hover layer it passes', f.length === 0, show(f));
  f = of(await issues(nav('#7d91ff', { active: false })), ACTIVE);
  check('R4: an inactive nav-item draws no indicator', f.length === 0, show(f));
  f = of(await issues(nav('#7d91ff', { disabled: true })), ACTIVE);
  check('R4: a disabled active nav-item is skipped', f.length === 0, show(f));
  const tabs = (variant: 'line' | 'contained', iconColor = '#c9d6f2'): SceneNode[] => [panel([{ id: 'tb', type: 'tabs', variant, iconColor, items: [{ label: 'One', active: true }, { label: 'Two' }] }])];
  f = of(await issues(tabs('line')), ACTIVE);
  check('R4: a line tab underline at 1.4:1 warns, naming the tab', f.length === 1 && /tab "One"/.test(f[0].message), show(f));
  f = of(await issues(tabs('line', '#1e3a8a')), ACTIVE);
  check('R4 twin: a strong underline passes', f.length === 0, show(f));
  f = of(await issues(tabs('contained')), ACTIVE);
  check('R4: a contained tab draws no indicator mark', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'tr', type: 'tree-row', label: 'src', depth: 0, active: true, iconColor: '#c9d6f2', icon: 'folder' }])]), ACTIVE);
  check('R4: a tree-row draws no indicator mark', f.length === 0, show(f));
}

// ── R5 / FR-H3: desktop-app-disabled, and the disabled exclusion (R6) ──────
{
  const sys = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
  let all = await issues([panel([{ id: 'b', type: 'button', label: 'Save', disabled: true }], { fill: '$bg-surface' })], sys);
  check('FR-H3: a disabled button at the generated opacities raises nothing', all.filter((i) => STATE_IDS.includes(i.rule ?? '') || (i.category === 'color' && i.severity !== 'info')).length === 0, show(all.filter((i) => i.category === 'color')));
  const withContent = (c: number): DesignVariables => ({ ...sys, state: { ...sys.state, disabledContent: c } });
  let f = of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'Home' }, { id: 'b', type: 'button', label: 'Save' }], { fill: '$bg-surface' })], withContent(1)), DISABLED);
  check('FR-H3: disabledContent 1 raises the info (both themes)', f.length === 2 && f.every((i) => i.severity === 'info') && f.some((i) => i.theme === 'dark'), show(f));
  check('R5: it names the on-surface targets, not the white-label primary', ids(f[0]) === 'nv', show(f));
  f = of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'Home' }], { fill: '$bg-surface' })], withContent(0.38)), DISABLED);
  check('FR-H3 twin: 0.38 raises nothing', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'Home', opacity: 0.9 }], { fill: '$bg-surface' })], withContent(1)), DISABLED);
  check('R5: an authored opacity is not the tokens\' render', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'Home' }])], { colors: { ...sys.colors } }), DISABLED);
  check('R5: no disabled tokens, no info (the 0.5 render)', f.length === 0, show(f));
  // The modal close button is never disabled and never measured.
  const tgs = stateTargets(resolveVariables({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [{ id: 'm', type: 'modal', title: 'x' }] }, withContent(1)));
  check('R5: the modal close button is not measured', disabledPairs(tgs).every((p) => p.target.kind !== 'modal close') && tgs.some((t) => t.kind === 'modal close'));

  // R6 on web: text under a disabled clickable primitive is exempt.
  const textUnder = (disabled: boolean): SceneNode[] => [panel([{ id: 'b', type: 'button', label: 'x', disabled, children: [{ id: 't', type: 'text', content: 'faint', color: '#EEEEEE' }] }])];
  all = await issues(textUnder(true), {}, 'web');
  check('R6: text inside a disabled primitive raises no contrast error (web)', !all.some((i) => i.category === 'color' && i.nodeId === 't'), show(all.filter((i) => i.category === 'color')));
  all = await issues(textUnder(false), {}, 'web');
  check('R6 twin: inside an enabled one it errors', all.some((i) => i.category === 'color' && i.nodeId === 't' && i.severity === 'error'), show(all.filter((i) => i.category === 'color')));
  all = await issues([panel([{ id: 'tb', type: 'tabs', state: 'disabled', items: [{ label: 'A' }], children: [{ id: 't', type: 'text', content: 'faint', color: '#EEEEEE' }] }])], {}, 'mobile');
  check('R6: a disabled tabs node exempts its text (mobile)', !all.some((i) => i.category === 'color' && i.nodeId === 't'), show(all.filter((i) => i.category === 'color')));
  all = await issues([panel([{ id: 'f', type: 'frame', disabled: true, children: [{ id: 't', type: 'text', content: 'faint', color: '#EEEEEE' }] }])], {}, 'web');
  check('R6 twin: a disabled frame is not a target, its text still errors', all.some((i) => i.category === 'color' && i.nodeId === 't'), show(all.filter((i) => i.category === 'color')));
}

// ── R7 / FR-H4: desktop-app-boundary ──────────────────────────────────────
{
  let f = of(await issues([panel([{ id: 'ti', type: 'text-input', placeholder: 'Name' }])], { colors: { border: '#c1c1c1' } }), BOUNDARY);
  check('FR-H4: a text-input on a 1.8:1 $border warns', f.length === 1 && f[0].severity === 'warning' && /1\.80:1/.test(f[0].message), show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', placeholder: 'Name' }])], { colors: { border: '#c1c1c1', 'border-strong': '#767676' } }), BOUNDARY);
  check('FR-H4 twin: $border-strong at 4.5:1 passes', f.length === 0, show(f));
  const controls = (checked: boolean): SceneNode[] => [panel([
    { id: 'cb', type: 'checkbox', checked }, { id: 'rd', type: 'radio', checked }, { id: 'tg', type: 'toggle', checked },
  ])];
  f = of(await issues(controls(false), { colors: { border: '#c1c1c1', accent: '#c1c1c1' } }), BOUNDARY);
  check('R7: an unchecked checkbox, radio and toggle each warn', f.map((i) => i.nodeId).sort().join(',') === 'cb,rd,tg', show(f));
  f = of(await issues(controls(true), { colors: { border: '#c1c1c1', accent: '#c1c1c1' } }), BOUNDARY);
  check('R7 twin: checked ones are not measured', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', disabled: true }])], { colors: { border: '#c1c1c1' } }), BOUNDARY);
  check('R7: a disabled text-input is not measured', f.length === 0, show(f));
  // A translucent border composites over the field fill, not the panel.
  const translucent = (fill: string) => [panel([{ id: 'ti', type: 'text-input', fill, stroke: 'rgba(255, 255, 255, 0.5)' }])];
  f = of(await issues(translucent('#000000')), BOUNDARY);
  check('R7: a translucent border over a black field is grey, 3.95:1 against the white panel (passes)', f.length === 0, show(f));
  f = of(await issues(translucent('#FFFFFF')), BOUNDARY);
  check('R7 twin: over a white field the same border vanishes (warns)', f.length === 1 && /1\.00:1/.test(f[0].message), show(f));
  const over = boundaryPairs(resolveVariables(translucent('#000000')[0], {}))[0];
  check('R7: the boundary pixel is the stroke over the field fill', over?.boundary.join(',') === '128,128,128', JSON.stringify(over));
  // Inside a component: an unset text-input stroke draws its #D1D5DB fallback;
  // an unset checkbox stroke draws nothing.
  const raw: SceneNode = { id: 'r', type: 'frame', fill: '#FFFFFF', children: [{ id: 'ti', type: 'text-input' }, { id: 'cb', type: 'checkbox' }] };
  const pairs = boundaryPairs(raw);
  check('R7: an unresolved text-input is measured at its fallback', pairs.length === 1 && pairs[0].color === '#D1D5DB', JSON.stringify(pairs));
  const errored = boundaryPairs({ id: 'r', type: 'frame', children: [{ id: 'ti', type: 'text-input', error: 'Required' }] });
  check('R7: with an error the fallback is #DC2626', errored[0]?.color === '#DC2626', JSON.stringify(errored));
  check('R7: a select is not measured (not in FR-H4)', boundaryPairs({ id: 'r', type: 'frame', children: [{ id: 's', type: 'select', stroke: '#EEEEEE' }] }).length === 0);
}

// ── R2: the model's arithmetic ────────────────────────────────────────────
check('R2: layer percent rounds as the render (Q6)', layerAlpha(0.123456) === 0.1235 && layerAlpha(0.08) === 0.08);
check('R2: an ink alpha multiplies the layer (#ffffffde at 8% is 6.96%)', paint('#ffffffde', [0, 0, 0], 0.08).join(',') === '18,18,18', paint('#ffffffde', [0, 0, 0], 0.08).join(','));
check('R2: a token paints nothing', paint('$x', [1, 2, 3]).join(',') === '1,2,3');
{
  const t = stateTargets({ id: 'r', type: 'frame', children: [
    { id: 'tb', type: 'tabs', variant: 'contained', items: [{ label: 'A', active: true }, { label: 'B' }] },
    { id: 'bar', type: 'tab-bar', items: [{ icon: 'home', label: 'Home', active: true }, { icon: 'cog', label: 'S' }] },
    { id: 'ma', type: 'modal', title: 'm', actions: [{ label: 'Go', variant: 'primary' }, { label: 'No', variant: 'ghost' }] },
  ] });
  const byWhat = (w: string) => t.find((x) => x.what === w);
  check('R2: a contained active tab fills #EFF4FF unthemed, inactive none', byWhat('tab "A"')?.fill === '#EFF4FF' && byWhat('tab "B"')?.fill === undefined);
  check('R2: tab inks: active color, else secondary (fallbacks)', byWhat('tab "A"')?.ink === '#111827' && byWhat('tab "B"')?.ink === '#6B7280');
  check('R2: tab-bar item inks: active accent, else color', byWhat('tab-bar item "Home"')?.ink === '#2563EB' && byWhat('tab-bar item "S"')?.ink === '#6B7280');
  check('R2: tabs and tab-bar items are inset, a modal action outset', !!byWhat('tab "A"')?.inset && !!byWhat('tab-bar item "Home"')?.inset && byWhat('modal action "Go"')?.inset === false);
  check('R2: modal action colours as actionButton draws them', byWhat('modal action "Go"')?.ink === '#FFFFFF' && byWhat('modal action "Go"')?.fill === '#2563EB' && byWhat('modal action "No"')?.ink === '#2563EB');
  const ring = focusPairs(t).find((p) => p.target.what === 'tab "A"');
  check('R3: an inset ring\'s reference is the item fill over the backdrop', ring?.reference?.join(',') === parseColor('#EFF4FF')!.join(','), JSON.stringify(ring));
}

// ── R9(b): the generated systems on the backdrops they promise ────────────
const SEEDS = ['#166534', '#2563EB', '#B45309'];
const targetsOn = (key: string): SceneNode => ({
  id: `bd-${key}`, type: 'frame', fill: `$${key}`, layout: 'vertical', gap: 8, padding: 16, width: 360,
  children: [
    { id: `${key}-b1`, type: 'button', label: 'Save', size: 'sm' },
    { id: `${key}-b2`, type: 'button', label: 'Cancel', size: 'sm', variant: 'secondary' },
    { id: `${key}-b3`, type: 'button', label: 'More', size: 'sm', variant: 'ghost' },
    { id: `${key}-b4`, type: 'button', label: 'Delete', size: 'sm', variant: 'destructive' },
    { id: `${key}-ln`, type: 'link', label: 'Docs' },
    { id: `${key}-ti`, type: 'text-input', placeholder: 'Search' },
    { id: `${key}-te`, type: 'text-input', value: 'x', error: 'Required' },
    { id: `${key}-n1`, type: 'nav-item', label: 'Home', active: true },
    { id: `${key}-n2`, type: 'nav-item', label: 'Inbox' },
    { id: `${key}-tr`, type: 'tree-row', label: 'src', depth: 0, active: true, icon: 'folder' },
    { id: `${key}-mr`, type: 'menu-row', label: 'Copy', shortcut: '⌘C' },
    { id: `${key}-lr`, type: 'list-row', title: 'Row' },
    { id: `${key}-tl`, type: 'tabs', items: [{ label: 'One', active: true }, { label: 'Two' }] },
    { id: `${key}-tc`, type: 'tabs', variant: 'contained', items: [{ label: 'One', active: true }, { label: 'Two' }] },
    { id: `${key}-c0`, type: 'checkbox' }, { id: `${key}-c1`, type: 'checkbox', checked: true },
    { id: `${key}-r0`, type: 'radio' }, { id: `${key}-r1`, type: 'radio', checked: true },
    { id: `${key}-g0`, type: 'toggle' }, { id: `${key}-g1`, type: 'toggle', checked: true },
    { id: `${key}-se`, type: 'select', value: 'One' },
  ],
});
for (const personality of PERSONALITY_NAMES) {
  for (const seed of SEEDS) {
    const sys = generateDesignSystem(seed, personality, { surface: 'desktop-app' }).variables;
    const keys = Object.keys(sys.colors!).filter((k) => /^bg-|-tint$/.test(k));
    const all = await issues(keys.map(targetsOn), sys);
    const where = (i: EvaluationIssue) => (i.nodeIds ?? [i.nodeId]).map((id) => id.split('-').slice(0, -1).join('-').replace(/^bd-/, ''));
    const focus = of(all, FOCUS);
    check(`R9(b) ${personality} ${seed}: no focus-ring finding on any bg-* or *-tint, either theme`, focus.length === 0, show(focus));
    const promised = (i: EvaluationIssue) => where(i).some((k) => k === 'bg-primary' || k === 'bg-surface');
    const active = of(all, ACTIVE).filter(promised);
    check(`R9(b) ${personality} ${seed}: no indicator finding on bg-primary / bg-surface`, active.length === 0, show(active));
    const boundary = of(all, BOUNDARY).filter(promised);
    check(`R9(b) ${personality} ${seed}: no boundary finding on bg-primary / bg-surface`, boundary.length === 0, show(boundary));
    const disabled = of(all, DISABLED);
    check(`R9(b) ${personality} ${seed}: no disabled-look finding anywhere`, disabled.length === 0, show(disabled));
    check(`R9(b) ${personality} ${seed}: both themes ran`, !!sys.dark?.colors && Object.keys(sys.dark.colors).length > 0);
  }
}

{
  // R9(b) twin: the same scene trips the rules once the tokens are broken, and
  // the findings land on the frames the filter reads.
  const sys = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
  const c = sys.colors!;
  const broken: DesignVariables = { ...sys, colors: { ...c, 'focus-ring': c['bg-primary'], 'border-strong': c['bg-surface'], accent: c['accent-tint'] }, state: { ...sys.state, disabledContent: 1 } };
  const all = await issues(['bg-primary', 'bg-surface'].map(targetsOn), broken);
  const on = (rule: string, key: string) => of(all, rule).some((i) => (i.nodeIds ?? [i.nodeId]).some((id) => id.startsWith(`${key}-`)));
  check('R9(b) twin: a broken ring is found on bg-primary', on(FOCUS, 'bg-primary'), show(of(all, FOCUS)));
  check('R9(b) twin: a broken boundary is found on bg-surface', on(BOUNDARY, 'bg-surface'), show(of(all, BOUNDARY)));
  check('R9(b) twin: a broken indicator is found', of(all, ACTIVE).length > 0, show(of(all, ACTIVE)));
  check('R9(b) twin: disabledContent 1 is found', of(all, DISABLED).length > 0, show(of(all, DISABLED)));
}

console.log(allPass ? '\nAll state-check tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
