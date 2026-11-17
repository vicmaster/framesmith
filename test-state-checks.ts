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
import { backdropBehind, parseAlpha, parseColor, contrastRatio, rgbToHex } from './src/color-math.js';
import { boundaryPairs, checkDisabledLook, checkFocusVisible, checkStates, disabledPairs, focusPairs, indicatorPairs, stateTargets, layerAlpha, paint } from './src/state-checks.js';
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
  const hover = contrastRatio(hoverOnly.hover!.indicator, hoverOnly.hover!.fill);
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
  check('FR-H3: disabledContent 1 raises the info (the dark copy says the same, so it is dropped)', f.length === 1 && f[0].severity === 'info' && !f[0].theme, show(f));
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
  check('R7: an unresolved text-input is measured at its fallback', pairs[0]?.node.id === 'ti' && pairs[0].color === '#D1D5DB', JSON.stringify(pairs));
  check('V4 fix: an unresolved checkbox draws no outline and is measured as the backdrop', pairs[1]?.node.id === 'cb' && pairs[1].boundary.join(',') === '255,255,255', JSON.stringify(pairs));
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

// ── Verify round 1 fixes ──────────────────────────────────────────────────
{
  // An inset ring over a fill that does not parse (a named colour still
  // paints) cannot be measured: the info, never an error against the backdrop.
  const navyTabs = (fill: string) => [panel([{ id: 'tb', type: 'tabs', variant: 'contained', fill, items: [{ label: 'A', active: true }] }])];
  let f = of(await issues(navyTabs('navy'), { colors: { 'focus-ring': '#FFFFFF' } }), FOCUS);
  check('fix: a contained tab with a named fill is unmeasurable (info)', f.length === 1 && f[0].severity === 'info', show(f));
  f = of(await issues(navyTabs('#FFFFFF'), { colors: { 'focus-ring': '#FFFFFF' } }), FOCUS);
  check('fix twin: the same tab with a hex fill errors', f.length === 1 && f[0].severity === 'error', show(f));
  // A named hover ink: the rest verdict still stands, hover is not modelled.
  f = of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'Home', active: true, fill: '#EAF0FD', iconColor: '#7d91ff', color: 'black' }])]), ACTIVE);
  check('fix: a named ink still gets the rest verdict, not a hover one', f.length === 1 && /at rest/.test(f[0].message) && !/in hover/.test(f[0].message), show(f));
  f = of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'Home', active: true, fill: 'lavender', iconColor: '#7d91ff' }])]), ACTIVE);
  check('fix twin: a named active fill skips the pair', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', fill: 'white', stroke: 'rgba(0,0,0,0.1)' }])]), BOUNDARY);
  check('fix: a translucent border over a named field fill is skipped', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', fill: '#FFFFFF', stroke: 'rgba(0,0,0,0.1)' }])]), BOUNDARY);
  check('fix twin: over a hex field fill it warns', f.length === 1, show(f));
  // V1: an explicit transparent / none boundary is invisible, so it warns
  // unless the control's own fill shows the edge.
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', stroke: 'transparent', fill: '#FFFFFF' }, { id: 'rd', type: 'radio', stroke: 'none' }, { id: 'tg', type: 'toggle', fill: 'transparent' }])]), BOUNDARY);
  check('fix: a transparent / none boundary warns at 1.00:1', f.map((i) => i.nodeId).sort().join(',') === 'rd,tg,ti' && f.every((i) => /1\.00:1/.test(i.message)), show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', stroke: 'transparent', fill: '#1F2937' }])]), BOUNDARY);
  check('fix twin: a transparent border on a dark field passes (the fill is the edge)', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', stroke: '$missing' }, { id: 'cb', type: 'checkbox', stroke: '$missing' }, { id: 'tg', type: 'toggle', fill: '$missing' }])]), BOUNDARY);
  check('V4 fix: a typo\'d token boundary draws nothing, so it warns', f.map((i) => i.nodeId).sort().join(',') === 'cb,tg,ti', show(f));
  // V4: a field whose fill clears the backdrop is shown by its fill.
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', fill: '#111827', color: '#FFFFFF', stroke: '#D1D5DB' }, { id: 'cb', type: 'checkbox', fill: '#111827', stroke: '#D1D5DB' }])]), BOUNDARY);
  check('V4 fix: a dark-filled field with a faint border passes (the fill is the edge)', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', fill: '#969696', stroke: '#D1D5DB' }])]), BOUNDARY);
  check('V4 fix twin: a fill at 2.96:1 does not show the field (warns)', f.length === 1, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', fill: '#949494', stroke: '#D1D5DB' }])]), BOUNDARY);
  check('V4 fix: a fill at 3.03:1 shows it (the boundary)', f.length === 0, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', fill: '#F3F4F6', stroke: 'transparent' }])]), BOUNDARY);
  check('V4 fix: a ghost field (faint fill, no border) warns', f.length === 1, show(f));
  // V4: a literal control on a literal frame says the same in both themes:
  // one finding, not a dark copy pointing at the dark layer.
  const sysD = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
  f = of(await issues([{ id: 'lit', type: 'frame', fill: '#FFFFFF', children: [{ id: 'tg', type: 'toggle', fill: '#E5E7EB' }] }], sysD), BOUNDARY);
  check('V4 fix: a literal pair is reported once (no dark copy)', f.length === 1 && !f[0].theme, show(f));
  f = of(await issues([{ id: 'tok', type: 'frame', fill: '$bg-primary', children: [{ id: 'tg', type: 'toggle', fill: '$bg-surface' }] }], sysD), BOUNDARY);
  check('V4 fix twin: a token pair that fails in both themes is reported per theme', f.length === 2 && f.some((i) => i.theme === 'dark'), show(f));
  // V4: inside an instance the suggestion says the tokens never reach it.
  const compI: SceneNode = { id: 'cf', type: 'frame', children: [{ id: 'cbi', type: 'checkbox' }] };
  f = of(await issues([panel([{ id: 'i9', name: 'Field', type: 'instance', componentId: 'cf' }])], sysD, 'desktop-app', { cf: compI }), BOUNDARY);
  check('V4 fix: an instance finding\'s suggestion says the design system never reaches it', f.length > 0 && f.every((i) => /inside a component instance/.test(i.suggestion ?? '')), show(f));
  f = of(await issues([panel([{ id: 'cb', type: 'checkbox', stroke: '#EEEEEE' }])], sysD), BOUNDARY);
  check('V4 fix twin: a direct finding keeps the token suggestion', f.length > 0 && f.every((i) => /border-strong/.test(i.suggestion ?? '')), show(f));
  // Out-of-contract values degrade instead of throwing.
  // (A numeric colour token already throws in checkConsistency, before slice
  // H, so the state model is driven directly here.)
  let threw = false;
  let infos: EvaluationIssue[] = [];
  try {
    infos = checkFocusVisible(stateTargets({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [{ id: 'b', type: 'button', label: 'Go', stateStyle: { ring: 7 as unknown as string, onSurface: '#111111', surface: '#FFFFFF', hover: 0.08, focus: 0.1, pressed: 0.1 } }] }));
  } catch { threw = true; }
  check('fix: a numeric ring does not throw (the info)', !threw && infos.length === 1 && infos[0].severity === 'info', show(infos));
  const numeric = backdropBehind([{ id: 'n', type: 'frame', fill: 5 as unknown as string }, { id: 'm', type: 'frame', fill: '#000000' }]);
  check('fix: a numeric fill paints nothing in the walk (no throw)', numeric.kind === 'color' && numeric.rgb.join(',') === '0,0,0', JSON.stringify(numeric));
  // A grouped finding whose members sit inside instances names them.
  const comp: SceneNode = { id: 'cc', type: 'frame', children: [{ id: 'inner', type: 'button', label: 'Go' }] };
  // A component's button rings in #2563EB; on a #2563EB panel it shares the
  // direct button's failing pair when the token ring is #2563EB too.
  f = of(await issues([panel([{ id: 'direct', type: 'button', label: 'Go' }, { id: 'i1', name: 'Card', type: 'instance', componentId: 'cc' }], { fill: '#2563EB' })], { colors: { 'focus-ring': '#2563EB' } }, 'desktop-app', { cc: comp }), FOCUS);
  check('fix: a group with members in an instance says so by name', f.some((i) => /some inside instances, listed by instance: "Card"/.test(i.message) && (i.nodeIds ?? []).includes('i1')), show(f));
  const plain = of(await issues([panel([{ id: 'd1', type: 'button', label: 'Go' }, { id: 'd2', type: 'button', label: 'Go' }], { fill: '#2563EB' })], { colors: { 'focus-ring': '#2563EB' } }), FOCUS);
  check('fix twin: a group with no instance member says nothing of instances', plain.length === 1 && !/instance/.test(plain[0].message), show(plain));
}


// ── Mutation round: boundaries, gates, inks, the walk ────────────────────
{
  const W = '#FFFFFF';
  // Exact thresholds: 3.00 passes (a raw 2.997 rounds to it), 2.99 fails.
  const ringOn = async (ring: string) => of(await issues([panel([{ id: 'b', type: 'button', label: 'Go' }])], { colors: { 'focus-ring': ring } }), FOCUS);
  check('M: a ring at a raw 2.997:1 rounds to 3.00 and passes', (await ringOn('#9191bf')).length === 0);
  check('M twin: a ring at 2.99:1 fails', (await ringOn('#9191c0')).length === 1);
  const borderOn = async (stroke: string) => of(await issues([panel([{ id: 'ti', type: 'text-input', stroke }])]), BOUNDARY);
  check('M: a border at a raw 2.997:1 passes, at 2.99 warns', (await borderOn('#9191bf')).length === 0 && (await borderOn('#9191c0')).length === 1);
  const barOn = async (iconColor: string) => of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'H', active: true, fill: W, iconColor, color: W }])], { state: { hover: 0 } }), ACTIVE);
  check('M: an indicator at a raw 2.997:1 passes, at 2.99 warns', (await barOn('#9191bf')).length === 0 && (await barOn('#9191c0')).length === 1);
  // Disabled look: #111111 content at 0.956 is 1.10:1 (info), at 0.955 1.11:1 (silent).
  const look = async (c: number) => of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'H', color: '#111111' }], { fill: W })], { colors: { 'text-primary': '#111111' }, state: { disabledContent: c, disabledContainer: 0.12 } }), DISABLED);
  const at110 = await look(0.956);
  check('M: a disabled look at exactly 1.10:1 is the info', at110.length === 1 && /closest 1\.10:1/.test(at110[0].message), show(at110));
  check('M twin: at 1.11:1 it is silent', (await look(0.955)).length === 0);

  // Each rule answers only to its own id.
  const sysG = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
  const broken = resolveVariables({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [
    { id: 'b', type: 'button', label: 'Go' }, { id: 'ti', type: 'text-input' },
    { id: 'nv', type: 'nav-item', label: 'H', active: true, fill: '#FFFFFF', iconColor: '#F0F0F0' },
  ] }, { ...sysG, colors: { ...sysG.colors, 'focus-ring': '#F8F8F8', 'border-strong': '#F8F8F8', 'text-primary': '#111111' }, state: { ...sysG.state, disabledContent: 1 } });
  const all4 = [FOCUS, ACTIVE, DISABLED, BOUNDARY];
  for (const rule of all4) {
    const got = new Set(checkStates(broken, (id) => id === rule).map((i) => i.rule));
    check(`M: with only ${rule} on, only it reports`, got.size === 1 && got.has(rule), [...got].join(','));
    const without = new Set(checkStates(broken, (id) => id !== rule).map((i) => i.rule));
    check(`M twin: with ${rule} off, the other three report`, !without.has(rule) && without.size === 3, [...without].join(','));
  }

  // The grouping key: two backdrops, two errors; one node with two tabs listed once.
  let f = of(await issues([panel([{ id: 'b1', type: 'button', label: 'A' }]), { id: 'p2', type: 'frame', fill: '#F0F0F0', children: [{ id: 'b2', type: 'button', label: 'B' }] }], { colors: { 'focus-ring': '#DDDDDD' } }), FOCUS);
  check('M: two backdrops give two errors', f.length === 2 && f.every((i) => i.count === 1), show(f));
  f = of(await issues([panel([{ id: 'tb', type: 'tabs', items: [{ label: 'A', active: true }, { label: 'B' }, { label: 'C' }] }, { id: 'b', type: 'button', label: 'x' }, { id: 'l', type: 'link', label: 'y' }, { id: 'n', type: 'nav-item', label: 'z' }, { id: 'c', type: 'checkbox' }])], { colors: { 'focus-ring': '#DDDDDD' } }), FOCUS);
  check('M: one tabs node is listed once, its tabs counted each', f.length === 1 && f[0].count === 7 && (f[0].nodeIds ?? []).filter((i) => i === 'tb').length === 1 && f[0].nodeId === 'tb', show(f));
  check('M: the message names four kinds then an ellipsis, plural targets', /on 7 targets \(tab "A", tab "B", tab "C", button, …\)/.test(f[0]?.message ?? ''), f[0]?.message);
  f = of(await issues([panel([{ id: 'b', type: 'button', label: 'x' }])], { colors: { 'focus-ring': '#DDDDDD' } }), FOCUS);
  check('M: one target reads singular', /on 1 target \(button\)\./.test(f[0]?.message ?? ''), f[0]?.message);

  // Backdrops of overlays and item hosts.
  const inPopover = resolveVariables({ id: 'r', type: 'frame', fill: '#000000', children: [{ id: 'po', type: 'popover', fill: '#FAFAFA', children: [{ id: 'b', type: 'button', label: 'Go' }] }] }, {});
  check('M: a target in a popover sits on the popover fill, not the page behind', focusPairs(stateTargets(inPopover))[0].reference?.join(',') === '250,250,250');
  const inMenu = { id: 'r', type: 'frame', fill: '#000000', children: [{ id: 'mn', type: 'menu', children: [{ id: 'mr', type: 'menu-row', label: 'Copy' }] }] } as SceneNode;
  check('M: an unfilled menu draws its #FFFFFF fallback behind its rows', focusPairs(stateTargets(inMenu))[0].reference?.join(',') === '255,255,255');
  const inDrawer = { id: 'r', type: 'frame', fill: '#000000', children: [{ id: 'dr', type: 'drawer', fill: '$x', children: [{ id: 'b', type: 'button', label: 'Go' }] }] } as SceneNode;
  check('M: a drawer whose fill paints nothing is unreadable', stateTargets(inDrawer)[0].backdrop.kind === 'unreadable');
  const bar = (fill?: string) => stateTargets({ id: 'r', type: 'frame', fill: '#000000', children: [{ id: 'tb', type: 'tab-bar', ...(fill ? { fill } : {}), items: [{ icon: 'home', label: 'H' }, { icon: 'x', label: 'X', disabled: true }] }] } as SceneNode);
  const barBd = (fill?: string) => { const b = bar(fill)[0].backdrop; return b.kind === 'color' ? b.rgb.join(',') : b.kind; };
  check('M: a tab-bar with no fill draws #FFFFFF behind its items', barBd() === '255,255,255');
  check('M: a translucent tab-bar fill composites over its ancestors', barBd('rgba(255, 255, 255, 0.5)') === '128,128,128');
  check('M: a disabled tab-bar item is disabled, the other not', bar()[1].disabled && !bar()[0].disabled && bar()[0].inset);
  const nb = stateTargets({ id: 'r', type: 'frame', fill: '#000000', children: [{ id: 'nb', type: 'nav-bar', title: 't', leading: { label: 'Back' }, trailing: [{ icon: 'x', state: 'disabled' }] }] } as SceneNode);
  check('M: a nav-bar with no fill puts its actions on the page behind (#000000)', nb[0].backdrop.kind === 'color' && nb[0].backdrop.rgb.join(',') === '0,0,0' && nb[0].ink === '#2563EB' && !nb[0].inset);
  check('M: a disabled nav-bar action is disabled', nb[1].disabled && !nb[0].disabled);
  const md = stateTargets({ id: 'r', type: 'frame', children: [{ id: 'm', type: 'modal', title: 't', actions: [{ label: 'Go', variant: 'primary', disabled: true }, { label: 'No' }, { label: 'Bye', variant: 'destructive' }] }] } as SceneNode);
  const mWhat = (w: string) => md.find((t) => t.what === w)!;
  check('M: the modal close button: secondary ink, transparent, never disabled', mWhat('modal close button').ink === '#6B7280' && mWhat('modal close button').fill === 'transparent' && !mWhat('modal close button').disabled);
  check('M: a default modal action is secondary (text ink, transparent)', mWhat('modal action "No"').ink === '#111827' && mWhat('modal action "No"').fill === 'transparent');
  check('M: a destructive action fills #DC2626 with white ink', mWhat('modal action "Bye"').fill === '#DC2626' && mWhat('modal action "Bye"').ink === '#FFFFFF');
  check('M: a disabled modal action is disabled', mWhat('modal action "Go"').disabled && !mWhat('modal action "No"').disabled);
  const ts = stateTargets({ id: 'r', type: 'frame', children: [{ id: 't', type: 'toast', text: 'x', action: { label: 'Undo' } }, { id: 't2', type: 'toast', text: 'y', action: { label: '  ' } }] } as SceneNode);
  check('M: a toast action: accent ink, transparent fill, on the toast; a blank one is none', ts.length === 1 && ts[0].ink === '#2563EB' && ts[0].fill === 'transparent' && ts[0].backdrop.kind === 'color' && ts[0].backdrop.rgb.join(',') === '255,255,255');
  f = of(await issues([panel([{ id: 'ts', type: 'toast', text: 'Saved', fill: '#FFFFFF', action: { label: 'Undo' } }])], { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('M twin: an enabled toast action is measured', f.length === 1, show(f));

  // The P4 inks and fills of every node type, unresolved (the renderer's fallbacks).
  const kinds = stateTargets({ id: 'r', type: 'frame', children: [
    { id: 'bp', type: 'button', label: 'a' }, { id: 'bs', type: 'button', label: 'a', variant: 'secondary' }, { id: 'bg', type: 'button', label: 'a', variant: 'ghost' }, { id: 'bd', type: 'button', label: 'a', variant: 'destructive' },
    { id: 'ln', type: 'link', label: 'a' }, { id: 'ti', type: 'text-input' }, { id: 'mr', type: 'menu-row', label: 'a' }, { id: 'md', type: 'menu-row', label: 'a', destructive: true },
    { id: 'tg', type: 'toggle', fill: '#123456' }, { id: 'c0', type: 'checkbox', stroke: '#222222' }, { id: 'c1', type: 'checkbox', checked: true, stroke: '#222222' }, { id: 'rd', type: 'radio', stroke: '#333333' },
    { id: 'se', type: 'select', color: '#444444', fill: '#555555' }, { id: 'tr', type: 'tree-row', label: 'a' }, { id: 'lr', type: 'list-row', title: 'a', fill: '#666666' },
  ] } as SceneNode);
  const k = (id: string) => kinds.find((t) => t.node.id === id)!;
  const row = (id: string) => `${k(id).ink}|${k(id).fill ?? '-'}`;
  const expected: Record<string, string> = {
    bp: '#FFFFFF|#2563EB', bs: '#2563EB|transparent', bg: '#2563EB|transparent', bd: '#FFFFFF|#DC2626', ln: '#2563EB|-', ti: '#111827|#FFFFFF',
    mr: '#111827|-', md: '#DC2626|-', tg: '#FFFFFF|#123456', c0: '#222222|-', c1: '#FFFFFF|-', rd: '#333333|-', se: '#444444|#555555', tr: '#111827|-', lr: '#111827|#666666',
  };
  const wrong = Object.entries(expected).filter(([id, want]) => row(id) !== want).map(([id, want]) => `${id}: ${row(id)} ≠ ${want}`);
  check('M: every node type\'s ink and fill are the renderer\'s', wrong.length === 0, wrong.join('; '));

  // disabledPairs: a control is its own content.
  const ctl = resolveVariables({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [
    { id: 'tg', type: 'toggle', fill: '#000000' }, { id: 'c0', type: 'checkbox', stroke: '#000000', fill: '#FFFFFF' }, { id: 'c1', type: 'checkbox', checked: true, fill: '#000000', stroke: '#FFFFFF' }, { id: 'rd', type: 'radio', stroke: '#000000', fill: '#FFFFFF' },
    { id: 'bt', type: 'button', label: 'x', fill: '#FFFFFF', color: '#000000' },
  ] }, { colors: { 'text-primary': '#000000' }, state: { disabledContent: 1, disabledContainer: 0.12 } });
  const dp = disabledPairs(stateTargets(ctl));
  const dIds = dp.map((p) => `${p.target.node.id}:${p.rest.join(',')}`).sort().join(' ');
  check('M: a toggle, an unchecked checkbox, a checked checkbox and a radio are their own content', dIds === 'bt:0,0,0 c0:0,0,0 c1:0,0,0 rd:0,0,0 tg:0,0,0', dIds);
  check('M: with on-surface #000 at 1 all five look enabled (the info lists them)', checkDisabledLook(stateTargets(ctl)).at(0)?.count === 5);
  const ctlOpacity = resolveVariables({ id: 'r', type: 'frame', children: [{ id: 'a', type: 'nav-item', label: 'x', opacity: 1 }, { id: 'b', type: 'nav-item', label: 'x', opacity: 0 }, { id: 'c', type: 'nav-item', label: 'x' }] }, { state: { disabledContent: 1 } });
  check('M: an authored opacity of 1 or 0 is authored (skipped); none is not', disabledPairs(stateTargets(ctlOpacity)).map((p) => p.target.node.id).join(',') === 'c');

  // indicatorPairs: disabled hosts and items, fallback indicator, own opacity.
  const tabsAt = (extra: Partial<SceneNode>, item: object = {}) => indicatorPairs({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [{ id: 't', type: 'tabs', items: [{ label: 'A', active: true, ...item }], ...extra }] } as SceneNode);
  check('M: a disabled tabs host and a disabled active tab draw no indicator', tabsAt({ disabled: true }).length === 0 && tabsAt({}, { disabled: true }).length === 0 && tabsAt({}).length === 1);
  check('M: an unset tabs indicator is #2563EB', tabsAt({})[0].indicator === '#2563EB');
  const navAt = (opacity?: number) => indicatorPairs({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [{ id: 'n', type: 'nav-item', label: 'x', active: true, ...(opacity !== undefined ? { opacity } : {}) }] } as SceneNode)[0];
  check('M: an unset nav-item bar is #2563EB on its (absent) fill', navAt().indicator === '#2563EB' && navAt().rest.fill.join(',') === '255,255,255');
  check('M: a nav-item at opacity 0.3 draws its bar faded', navAt(0.3).rest.indicator.join(',') !== navAt().rest.indicator.join(','));

  // boundaryPairs: a blank error is no error; own opacity fades the border.
  check('M: a whitespace error keeps the #D1D5DB fallback', boundaryPairs({ id: 'r', type: 'frame', children: [{ id: 't', type: 'text-input', error: '  ' }] } as SceneNode)[0].color === '#D1D5DB');
  const faded = boundaryPairs({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [{ id: 't', type: 'text-input', stroke: '#000000', opacity: 0.4 }] } as SceneNode)[0];
  check('M: a text-input at opacity 0.4 draws a lighter border', faded.boundary.join(',') === '153,153,153', faded.boundary.join(','));
  const track = boundaryPairs({ id: 'r', type: 'frame', fill: '#FFFFFF', children: [{ id: 'g', type: 'toggle', fill: '#000000' }, { id: 'rd', type: 'radio', stroke: '#000000', fill: '#FF0000' }] } as SceneNode);
  check('M: a toggle\'s boundary is its track; a radio\'s ring ignores its (dot) fill', track[0].boundary.join(',') === '0,0,0' && !track[0].field && track[1].boundary.join(',') === '0,0,0' && !track[1].field);

  // Twins the first round lacked.
  f = of(await issues([panel([{ id: 'tb', type: 'tabs', items: [{ label: 'A' }] }])], { colors: { 'focus-ring': '#8ea2ff' } }), FOCUS);
  check('M twin: an enabled tabs node is measured', f.length === 1, show(f));
  f = of(await issues([panel([{ id: 'nv', type: 'nav-item', label: 'x', active: true, iconColor: '#c9d6f2', icon: 'folder' }])]), ACTIVE);
  check('M twin: a nav-item with the tree-row\'s faint colours does warn', f.length === 1, show(f));
  f = of(await issues([panel([{ id: 'ti', type: 'text-input', stroke: '#EEEEEE' }])]), BOUNDARY);
  check('M twin: a text-input with the select\'s faint stroke warns', f.length === 1, show(f));

  // color-math edges.
  check('M: a percent alpha over 100% clamps to 1', parseAlpha('rgba(0,0,0,150%)') === 1);
  const stop = (fill: string) => backdropBehind([{ id: 'o', type: 'modal' }], { stop: () => fill }).kind;
  check('M: a stop that paints nothing or does not parse is unreadable', stop('transparent') === 'unreadable' && stop('hsl(0,0%,0%)') === 'unreadable' && stop('#000000') === 'color');
  const fo = backdropBehind([{ id: 'a', type: 'frame', fill: '#FFFFFF' }], { fillOf: () => '#000000' });
  check('M: fillOf is honoured', fo.kind === 'color' && fo.rgb.join(',') === '0,0,0');
  const clear = backdropBehind([{ id: 'a', type: 'frame', fill: 'rgba(0,0,0,0)' }, { id: 'b', type: 'frame', fill: '#000000' }]);
  check('M: a zero-alpha fill adds no layer', clear.kind === 'color' && clear.layers.join() === '#000000');
  const two = backdropBehind([{ id: 'a', type: 'frame', fill: 'rgba(255,255,255,0.5)' }, { id: 'b', type: 'frame', fill: 'rgba(0,0,0,0.5)' }, { id: 'c', type: 'frame', fill: '#FFFFFF' }]);
  check('M: two translucent layers composite back to front', two.kind === 'color' && two.rgb.join(',') === '192,192,192', two.kind === 'color' ? two.rgb.join(',') : two.kind);
  check('M: rgbToHex pads', rgbToHex([0, 10, 255]) === '#000aff');

  // A dark-layer canvas with an instance: nodeIds map to the instance once.
  const comp: SceneNode = { id: 'cc', type: 'frame', fill: '#2563EB', children: [{ id: 'x1', type: 'button', label: 'a' }, { id: 'x2', type: 'button', label: 'b' }] };
  f = of(await issues([panel([{ id: 'inst', name: 'Bar', type: 'instance', componentId: 'cc' }])], { colors: { bg: '#FFFFFF' }, dark: { colors: { bg: '#000000' } } }, 'desktop-app', { cc: comp }), FOCUS);
  check('M: an instance\'s grouped targets report the instance once, with its note', f.length === 1 && (f[0].nodeIds ?? []).join(',') === 'inst' && /inside instance "Bar"/.test(f[0].message), show(f));
}


// ── 3b fixes ─────────────────────────────────────────────────────────────
{
  const sysR = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
  let f = of(await issues([panel([{ id: 'i1', name: 'Box', type: 'instance', componentId: 'cb' }])], sysR, 'desktop-app', { cb: { id: 'cb', type: 'checkbox' } }), BOUNDARY);
  check('3b: an instance whose root is the target gets the instance advice and note', f.length > 0 && f.every((i) => /inside a component instance/.test(i.suggestion ?? '') && /\(an instance — fix it in its component\)/.test(i.message)), show(f));
  f = of(await issues([panel([{ id: 'c1', type: 'checkbox', stroke: '$nope' }])], sysR), BOUNDARY);
  check('3b twin: the same checkbox placed directly keeps the token advice', f.length > 0 && f.every((i) => /border-strong/.test(i.suggestion ?? '') && !/instance/.test(i.message)), show(f));
  const grad = { gradient: { type: 'linear', angle: 90, stops: [{ color: '#000000', position: 0 }, { color: '#FFFFFF', position: 1 }] } as SceneNode['gradient'], fill: undefined };
  f = of(await issues([panel([{ id: 'ig', name: 'G', type: 'instance', componentId: 'gb' }], grad)], {}, 'desktop-app', { gb: { id: 'gb', type: 'frame', children: [{ id: 'gbb', type: 'button', label: 'x' }] } }), FOCUS);
  check('3b: an info inside an instance keeps its "check by eye" advice and adds the instance one', f.length === 1 && f[0].severity === 'info' && /by eye/.test(f[0].suggestion ?? '') && /inside a component instance/.test(f[0].suggestion ?? ''), show(f));
  f = of(await issues([panel([{ id: 'rd', type: 'radio', stroke: 'none' }, { id: 'tg', type: 'toggle', fill: 'none' }, { id: 'cb', type: 'checkbox', stroke: 'none' }])]), BOUNDARY);
  check('3b: a radio or toggle message never speaks of its fill; a checkbox does', f.filter((i) => /its fill/.test(i.message)).map((i) => i.nodeId).join(',') === 'cb' && f.length === 3, show(f));
  f = of(await issues([panel([{ id: 'tb', type: 'tabs', variant: 'contained', fill: 'navy', items: [{ label: 'A', active: true }] }])]), FOCUS);
  check('3b: the unmeasured info names a tab\'s own fill as a cause', /or a tab's own fill/.test(f[0]?.message ?? ''), show(f));
}

console.log(allPass ? '\nAll state-check tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
