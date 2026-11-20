// Phase 31 slice G (FR-G1, spec P1–P9) — element states as a property. The
// renderer draws hover / focus / pressed as a layer of the ink over the fill,
// focus adds a 2px ring at a 2px gap (S9), disabled draws the token pair in
// the on-surface colour (S10) or today's 0.5 without tokens; the 24px census,
// primary count and the overlays' targets read `state: "disabled"` as
// disabled. Every asserted presence has a twin that must not show it.
// Fast tier: HTML assertions, no Chrome.
//
// Usage: npx tsx test/unit/test-element-states.ts

import '../env.js';
import { renderToHtml } from '../../src/renderer.js';
import { resolveVariables } from '../../src/variables.js';
import { evaluateCanvas, pointerTargets } from '../../src/evaluate.js';
import { generateDesignSystem } from '../../src/design-language.js';
import { elementState, isDisabled, desktopTargets, overlayTargets, STATE_LAYERS } from '../../src/primitives.js';
import type { Canvas, DesignVariables, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? ` — ${extra}` : ''}`);
}

const SYSTEM = generateDesignSystem('#2563EB', 'technical', { surface: 'desktop-app' }).variables;
const C = SYSTEM.colors!;
const RING = C['focus-ring'];
const ON = C['text-primary'];
const COLORS_ONLY: DesignVariables = { colors: { ...C } };

function render(children: SceneNode[], vars: DesignVariables = SYSTEM, resolve = true): string {
  const root: SceneNode = { id: 'root', type: 'frame', layout: 'vertical', gap: 8, padding: 16, fill: '#FFFFFF', children };
  return renderToHtml(resolve ? resolveVariables(root, vars) : root, 900, 600);
}

/** From a node's element to the next node's element (its own markup, items included). */
function chunk(html: string, id: string): string {
  const at = html.indexOf(`data-node-id="${id}"`);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const next = html.indexOf('data-node-id="', at + 10);
  return html.slice(start, next < 0 ? undefined : html.lastIndexOf('<', next));
}

/** The opening tag of a node's own element. */
function tag(html: string, id: string): string {
  const c = chunk(html, id);
  return c.slice(0, c.indexOf('>') + 1);
}

const layer = (ink: string, p: number) => `linear-gradient(color-mix(in srgb, ${ink} ${p}%, transparent), color-mix(in srgb, ${ink} ${p}%, transparent))`;
const ringCss = (ring: string, offset = 2) => `outline: 2px solid ${ring}; outline-offset: ${offset}px`;

// ── P1: the effective state ──────────────────────────────────────────────
check('P1: no state is rest', elementState({}) === 'rest');
for (const s of ['rest', 'hover', 'focus', 'pressed', 'disabled'] as const) check(`P1: state "${s}" is ${s}`, elementState({ state: s }) === s);
check('P1: an unknown state is rest', elementState({ state: 'active' }) === 'rest' && elementState({ state: 3 }) === 'rest' && elementState({ state: 'Hover' }) === 'rest');
check('P1: disabled: true beats state hover', elementState({ state: 'hover', disabled: true }) === 'disabled');
check('P1: disabled: false keeps the state', elementState({ state: 'pressed', disabled: false }) === 'pressed');
check('P1: isDisabled reads both spellings', isDisabled({ disabled: true }) && isDisabled({ state: 'disabled' }) && !isDisabled({ state: 'focus' }) && !isDisabled(undefined));

// ── P4: each node type, each layer state, with its ink ──────────────────
/** Each P2 node type, the element id its state lands on (the node's own,
 * except a text-input's, whose field carries it), and its ink once resolved. */
const NODES: Array<{ node: SceneNode; ink: (n: SceneNode) => string; field?: boolean }> = [
  { node: { id: 'n', type: 'button', label: 'Save' }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'button', label: 'Cancel', variant: 'secondary' }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'link', label: 'Docs' }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'text-input', placeholder: 'Search' }, ink: (n) => n.color!, field: true },
  { node: { id: 'n', type: 'nav-item', label: 'Inbox' }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'nav-item', label: 'Inbox', active: true }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'tree-row', label: 'src', expanded: true }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'menu-row', label: 'Rename', checked: true }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'menu-row', label: 'Delete', destructive: true }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'list-row', title: 'Wi-Fi' }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'select', value: 'One' }, ink: (n) => n.color! },
  { node: { id: 'n', type: 'toggle' }, ink: () => '#FFFFFF' },
  { node: { id: 'n', type: 'toggle', checked: true }, ink: () => '#FFFFFF' },
  { node: { id: 'n', type: 'checkbox', checked: true }, ink: () => '#FFFFFF' },
  { node: { id: 'n', type: 'checkbox' }, ink: (n) => n.stroke! },
  { node: { id: 'n', type: 'radio', checked: true }, ink: (n) => n.stroke! },
];
const PCT = { hover: 8, focus: 10, pressed: 10 } as const;

for (const { node, ink, field } of NODES) {
  const label = `${node.type}${node.variant ? `/${node.variant}` : ''}${node.checked ? ' checked' : ''}${node.active ? ' active' : ''}${node.destructive ? ' destructive' : ''}`;
  const resolved = resolveVariables(node, SYSTEM);
  const own = (html: string) => (field ? chunk(html, 'n').match(/<div[^>]*role="textbox"[^>]*>/)?.[0] ?? '' : tag(html, 'n'));
  const rest = own(render([node]));
  check(`P4: ${label} at rest draws no layer and no ring`, rest.length > 0 && !rest.includes('linear-gradient(color-mix') && !rest.includes('outline:'), rest.slice(0, 200));
  for (const s of ['hover', 'focus', 'pressed'] as const) {
    const t = own(render([{ ...node, state: s }]));
    const hasLayer = t.includes(layer(ink(resolved), PCT[s]));
    const hasRing = t.includes(ringCss(RING));
    check(`P4: ${label} ${s} layers its ink at ${PCT[s]}%${s === 'focus' ? ' and draws the ring' : ''}`, hasLayer && hasRing === (s === 'focus'), t.slice(0, 400));
  }
}

// The same states on a node that takes none change nothing (P2).
for (const n of [
  { id: 'n', type: 'frame', width: 40, height: 40, fill: '#EEEEEE' },
  { id: 'n', type: 'text', content: 'Hello' },
  { id: 'n', type: 'property-row', label: 'Name' },
  { id: 'n', type: 'divider' },
] as SceneNode[]) {
  const base = render([n]);
  const same = ['hover', 'focus', 'pressed', 'disabled'].every((s) => render([{ ...n, state: s as SceneNode['state'] }]) === base);
  check(`P2: a ${n.type} ignores state`, same);
}

// Unknown state renders as rest; disabled: true beats a hover state.
check('P1: an unknown state renders as rest', render([{ id: 'n', type: 'button', label: 'S', state: 'glow' as SceneNode['state'] }]) === render([{ id: 'n', type: 'button', label: 'S' }]));
{
  const t = tag(render([{ id: 'n', type: 'button', label: 'S', state: 'hover', disabled: true }]), 'n');
  check('P1: disabled: true with state hover renders disabled, no layer', t.includes('opacity: 0.38') && !t.includes('linear-gradient(color-mix'), t);
}

// A link underlines its label in hover and pressed only.
for (const s of ['rest', 'hover', 'focus', 'pressed'] as const) {
  const c = chunk(render([{ id: 'n', type: 'link', label: 'Docs', state: s }]), 'n');
  const under = /data-fs-label[^>]*text-decoration: underline/.test(c);
  check(`P4: a link ${s === 'hover' || s === 'pressed' ? 'underlines' : 'does not underline'} in ${s}`, under === (s === 'hover' || s === 'pressed'));
}

// ── P3: ring and opacities ───────────────────────────────────────────────
{
  const noRing = { ...SYSTEM, colors: { ...C } };
  delete noRing.colors!['focus-ring'];
  const accent = noRing.colors!.accent ?? noRing.colors!.primary;
  check('P3: the ring is $focus-ring', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'focus' }]), 'n').includes(ringCss(RING)));
  check('P3: without $focus-ring the ring is the accent', !!accent && accent !== RING && tag(render([{ id: 'n', type: 'button', label: 'S', state: 'focus' }], noRing), 'n').includes(ringCss(accent!)));
  const onlyPrimary: DesignVariables = { colors: { primary: '#B45309' } };
  check('P3: then $primary', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'focus' }], onlyPrimary), 'n').includes(ringCss('#B45309')));
  check('P3: then #2563EB', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'focus' }], {}), 'n').includes(ringCss('#2563EB')));
  const unresolved = tag(render([{ id: 'n', type: 'button', label: 'S', state: 'hover', color: '#FFFFFF', fill: '#000000' }], {}, false), 'n');
  check('P3: an unresolved node (inside a component) uses #2563EB and the constant layers', unresolved.includes(layer('#FFFFFF', 8)) && unresolved.includes('--fs-ring: #2563EB'), unresolved);
  const tuned: DesignVariables = { ...SYSTEM, state: { ...SYSTEM.state, hover: 0.2, pressed: 0.3 } };
  const h = tag(render([{ id: 'n', type: 'button', label: 'S', state: 'hover' }], tuned), 'n');
  check('P3: a hover token of 0.2 layers at 20%', h.includes('#FFFFFF 20%'), h);
  check('P3: a pressed token of 0.3 layers at 30%', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'pressed' }], tuned), 'n').includes('#FFFFFF 30%'));
  const bad: DesignVariables = { ...SYSTEM, state: { hover: 1.5, focus: -0.1, pressed: Number.NaN } };
  check('P3: out-of-range layer tokens fall back to the constants', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'hover' }], bad), 'n').includes('#FFFFFF 8%')
    && tag(render([{ id: 'n', type: 'button', label: 'S', state: 'focus' }], bad), 'n').includes('#FFFFFF 10%')
    && tag(render([{ id: 'n', type: 'button', label: 'S', state: 'pressed' }], bad), 'n').includes('#FFFFFF 10%'));
  // The live :focus-visible ring is the same colour on every focusable primitive.
  const all = render([
    { id: 'a', type: 'button', label: 'S' }, { id: 'b', type: 'link', label: 'L' }, { id: 'c', type: 'nav-item', label: 'N' },
    { id: 'd', type: 'tree-row', label: 'T' }, { id: 'e', type: 'menu-row', label: 'M' }, { id: 'f', type: 'checkbox' },
    { id: 'g', type: 'toggle', checked: true }, { id: 'h', type: 'radio' }, { id: 'i', type: 'select' },
  ]);
  const rings = [...all.matchAll(/--fs-ring: ([^;"]+)/g)].map((m) => m[1]);
  check('P4: every focusable primitive carries --fs-ring = the ring', rings.length >= 9 && rings.every((r) => r === RING), JSON.stringify(rings));
  const tin = render([{ id: 'n', type: 'text-input', placeholder: 'x' }]);
  check('P4: a text-input field carries --fs-ring = the ring', /role="textbox"[^>]*--fs-ring: /.test(tin) && tin.includes(`--fs-ring: ${RING}`));
}

// ── P4: disabled ─────────────────────────────────────────────────────────
{
  const share = Math.round((0.12 / 0.38) * 10000) / 100; // 31.58
  const t = tag(render([{ id: 'n', type: 'button', label: 'Save', state: 'disabled' }]), 'n');
  check('S10: a disabled button with tokens renders at 0.38 in the on-surface colour', t.includes('opacity: 0.38') && t.includes(`color: ${ON}`) && t.includes(`background-color: color-mix(in srgb, ${ON} ${share}%, transparent)`), t);
  check('P6: a disabled button leaves the tab order', t.includes('tabindex="-1"') && t.includes('aria-disabled="true"') && !t.includes('data-focusable'));
  const sec = tag(render([{ id: 'n', type: 'button', label: 'Cancel', variant: 'secondary', disabled: true }]), 'n');
  check('S10: a disabled secondary keeps its transparent fill and draws its border in the on-surface share', sec.includes('background-color: transparent') && sec.includes(`border: 1px solid color-mix(in srgb, ${ON} ${share}%, transparent)`), sec);
  const rest = tag(render([{ id: 'n', type: 'button', label: 'Save' }]), 'n');
  check('S10 twin: an enabled button keeps its own colours', !rest.includes('opacity:') && !rest.includes('color-mix') && !rest.includes(`color: ${ON}`), rest);

  const legacy = tag(render([{ id: 'n', type: 'button', label: 'Save', state: 'disabled' }], COLORS_ONLY), 'n');
  check('P4: without disabled tokens a disabled button renders at 0.5 in its own colours', legacy.includes('opacity: 0.5') && !legacy.includes('color-mix') && !legacy.includes(`color: ${ON};`), legacy);
  const legacyFlag = tag(render([{ id: 'n', type: 'button', label: 'Save', disabled: true }], COLORS_ONLY), 'n');
  check('P5: disabled: true without tokens renders exactly as state disabled', legacyFlag === legacy);

  const one: DesignVariables = { ...SYSTEM, state: { disabledContent: 0.5 } };
  const o = tag(render([{ id: 'n', type: 'button', label: 'Save', disabled: true }], one), 'n');
  check('P3: one disabled token pulls in the other\'s constant (0.12 / 0.5 = 24%)', o.includes('opacity: 0.5') && o.includes(`color-mix(in srgb, ${ON} 24%, transparent)`), o);
  const onlyContainer: DesignVariables = { ...SYSTEM, state: { disabledContainer: 0.2 } };
  check('P3: the container token alone pairs with the 0.38 constant', tag(render([{ id: 'n', type: 'button', label: 'S', disabled: true }], onlyContainer), 'n').includes(`color-mix(in srgb, ${ON} 52.63%, transparent)`));
  const zero: DesignVariables = { ...SYSTEM, state: { disabledContent: 0, disabledContainer: 0.12 } };
  check('P4: disabledContent 0 draws the container at 100%', tag(render([{ id: 'n', type: 'button', label: 'S', disabled: true }], zero), 'n').includes(`color-mix(in srgb, ${ON} 100%, transparent)`));
  const over: DesignVariables = { ...SYSTEM, state: { disabledContent: 0.2, disabledContainer: 0.6 } };
  check('P4: a container token above the content caps at 100%', tag(render([{ id: 'n', type: 'button', label: 'S', disabled: true }], over), 'n').includes(`color-mix(in srgb, ${ON} 100%, transparent)`));
  const authored = tag(render([{ id: 'n', type: 'button', label: 'Save', disabled: true, opacity: 0.7 }]), 'n');
  check('P4: an authored opacity wins over the pair', authored.includes('opacity: 0.7') && !authored.includes('opacity: 0.38') && !authored.includes('color-mix'), authored);

  const box = tag(render([{ id: 'n', type: 'checkbox', checked: true, disabled: true }]), 'n');
  check('S10: a disabled checkbox is drawn whole in the on-surface colour at 0.38', box.includes('opacity: 0.38') && box.includes(`background-color: ${ON}`) && box.includes(`border: 1.5px solid ${ON}`) && !box.includes('color-mix'), box);
  const tg = tag(render([{ id: 'n', type: 'toggle', state: 'disabled' }]), 'n');
  check('S10: a disabled toggle track is the on-surface colour at 0.38', tg.includes('opacity: 0.38') && tg.includes(`background-color: ${ON}`), tg);
  const sel = tag(render([{ id: 'n', type: 'select', value: 'A', disabled: true }]), 'n');
  check('S10: a disabled select splits its frame (container share) from its text', sel.includes('opacity: 0.38') && sel.includes(`color-mix(in srgb, ${ON} ${share}%, transparent)`), sel);

  const ti = chunk(render([{ id: 'n', type: 'text-input', value: 'abc', error: 'Bad', disabled: true }]), 'n');
  const outer = ti.slice(0, ti.indexOf('>') + 1);
  const fieldTag = ti.match(/<div[^>]*role="textbox"[^>]*>/)?.[0] ?? '';
  check('S10: a disabled text-input dims the wrapper and draws its field in the on-surface share', outer.includes('opacity: 0.38') && !fieldTag.includes('opacity') && fieldTag.includes(`color-mix(in srgb, ${ON} ${share}%, transparent)`) && fieldTag.includes('tabindex="-1"'), ti.slice(0, 600));

  const nav = chunk(render([{ id: 'n', type: 'nav-item', label: 'Inbox', active: true, dotColor: '#16A34A', state: 'disabled' }]), 'n');
  check('S10: a disabled active nav-item draws its bar, dot and tint in the on-surface colour', !nav.includes(C.accent) && !nav.includes('#16A34A') && nav.includes(`background-color: ${ON}`) && nav.includes('opacity: 0.38'), nav.slice(0, 600));
  const navNoDot = chunk(render([{ id: 'n', type: 'nav-item', label: 'Inbox', state: 'disabled' }]), 'n');
  check('S10 twin: a disabled nav-item with no dot grows no dot', !navNoDot.includes('border-radius: 50%'));
}

// ── Verify round 1 fixes ────────────────────────────────────────────────
{
  // F1: a mark, knob or badge numeral on a disabled container takes the surface
  // colour, so it shows on the on-surface fill in a dark theme.
  const dark = (n: SceneNode) => chunk(renderToHtml(resolveVariables({ id: 'root', type: 'frame', fill: '#000000', children: [n] }, SYSTEM, { theme: 'dark' }), 900, 600), 'n');
  const surfDark = { ...C, ...SYSTEM.dark!.colors }['bg-surface'];
  const onDark = { ...C, ...SYSTEM.dark!.colors }['text-primary'];
  check('F1: dark surface and on-surface differ (the fixture can tell them apart)', !!surfDark && surfDark !== onDark && surfDark !== '#FFFFFF');
  const cb = dark({ id: 'n', type: 'checkbox', checked: true, disabled: true });
  check('F1: a disabled checked checkbox draws its mark in the surface colour (dark)', cb.includes(`stroke="${surfDark}"`) && !cb.includes('stroke="#FFFFFF"'), cb.slice(0, 500));
  check('F1 twin: an enabled checkbox keeps a white mark (dark)', dark({ id: 'n', type: 'checkbox', checked: true }).includes('stroke="#FFFFFF"'));
  const tg = dark({ id: 'n', type: 'toggle', checked: true, state: 'disabled' });
  check('F1: a disabled toggle knob is the surface colour (dark)', tg.includes(`border-radius: 50%; background-color: ${surfDark}`), tg);
  check('F1 twin: an enabled toggle knob stays white', dark({ id: 'n', type: 'toggle', checked: true }).includes('border-radius: 50%; background-color: #FFFFFF'));
  check('F1 twin: without tokens a disabled toggle knob stays white', chunk(render([{ id: 'n', type: 'toggle', disabled: true }], COLORS_ONLY), 'n').includes('border-radius: 50%; background-color: #FFFFFF'));
  const lr = dark({ id: 'n', type: 'list-row', title: 'Inbox', trailing: { badge: 3 }, disabled: true });
  check('F1: a disabled list-row badge numeral is the surface colour', lr.includes(`color: ${surfDark}; font-size: 12px`), lr.slice(0, 900));
  const lrt = dark({ id: 'n', type: 'list-row', title: 'Wi-Fi', trailing: { toggle: true }, disabled: true });
  check('F1: a disabled list-row toggle knob is the surface colour', lrt.includes(`border-radius: 50%; background-color: ${surfDark}`));
  const tb = dark({ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'Home', badge: 5, state: 'disabled' }, { icon: 'search', label: 'Find', badge: 2 }] });
  check('F1: a disabled tab-bar item\'s badge numeral is the surface colour; an enabled one stays white', tb.includes(`color: ${surfDark}; font-size: 11px`) && tb.includes('color: #FFFFFF; font-size: 11px'), tb.slice(0, 900));

  // F2: a truthy non-boolean disabled still dims (pre-slice behaviour); an
  // overlay with disabled keeps its 0.5 when the design system has the pair.
  for (const d of ['true', 1] as unknown[]) {
    const t = tag(render([{ id: 'n', type: 'button', label: 'S', disabled: d as boolean }], COLORS_ONLY), 'n');
    check(`F2: disabled ${JSON.stringify(d)} still dims a button to 0.5 without tokens`, t.includes('opacity: 0.5'), t);
  }
  check('F2 twin: an enabled button has no opacity', !tag(render([{ id: 'n', type: 'button', label: 'S', disabled: false }], COLORS_ONLY), 'n').includes('opacity'));
  for (const type of ['tooltip', 'popover', 'menu', 'modal', 'toast', 'drawer'] as const) {
    const h = render([{ id: 'n', type, text: 'x', title: 'T', disabled: true }]);
    check(`F2: a disabled ${type} keeps 0.5 on a canvas with the token pair`, tag(h, 'n').includes('opacity: 0.5'));
  }
  check('F2 twin: a disabled button on that canvas draws the pair, not 0.5', tag(render([{ id: 'n', type: 'button', label: 'S', disabled: true }]), 'n').includes('opacity: 0.38'));

  // F3: a disabled text-input's error message is content (on-surface), not the
  // border's container share.
  const ti = chunk(render([{ id: 'n', type: 'text-input', value: 'v', error: 'Bad', disabled: true }]), 'n');
  check('F3: a disabled text-input error message takes the on-surface colour', ti.includes(`line-height: 16px; color: ${ON}`) && !/line-height: 16px; color: color-mix/.test(ti), ti.slice(0, 900));
  const tiOn = chunk(render([{ id: 'n', type: 'text-input', value: 'v', error: 'Bad' }]), 'n');
  check('F3 twin: an enabled error message keeps the danger colour', tiOn.includes(`line-height: 16px; color: ${C.danger}`), tiOn.slice(0, 900));

  // F4: a disabled container that paints nothing stays clear, whatever its spelling.
  for (const f of ['transparent', 'none', 'rgba(0,0,0,0)', 'rgba(0, 0, 0, 0.0)', '#00000000', '#0000', 'hsla(0,0%,0%,0)', 'rgb(0 0 0 / 0%)']) {
    const t = tag(render([{ id: 'n', type: 'button', label: 'S', variant: 'ghost', fill: f, state: 'disabled' }]), 'n');
    check(`F4: a disabled ghost with fill ${f} stays clear`, t.includes(`background-color: ${f}`), t);
  }
  // An opaque colour whose last channel is 0 is not clear (3b: the alpha is the fourth argument or after a slash).
  for (const f of ['#2563EB1A', 'rgba(37,99,235,0.5)', 'rgb(10, 20, 30)', '#2563EB', 'rgb(0,0,0)', 'rgb(255, 165, 0)', 'hsl(40, 100%, 0%)', 'rgb(0 0 0 / 0.5)', 'rgba(0,0,0,1)']) {
    const t = tag(render([{ id: 'n', type: 'button', label: 'S', fill: f, state: 'disabled' }]), 'n');
    check(`F4 twin: a disabled button with fill ${f} takes the on-surface share`, t.includes(`background-color: color-mix(in srgb, ${ON}`), t);
  }

  // F5: state is an enum, not a style value: it does not dilute token adoption.
  const sheet = (st?: SceneNode['state']): Canvas => ({
    id: 'c', name: 'c', projectId: 'p', components: {}, createdAt: '', lastModified: '', variables: SYSTEM,
    root: { id: 'document', type: 'document', width: 1440, height: 900, fill: '$bg-primary', layout: 'vertical', padding: 40, gap: 16,
      children: Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, type: 'button', label: 'B', size: 'sm', fill: '$accent', color: '#FFFFFF', stroke: '#EEEEEE', ...(st ? { state: st } : {}) })) },
    metadata: { surface: { type: 'desktop-app', device: 'window-1440' } },
  } as Canvas);
  const tokenWarn = async (st?: SceneNode['state']) => (await evaluateCanvas(sheet(st), { mode: 'fast' })).issues.filter((i) => /use design tokens/.test(i.message)).length;
  check('F5: a states sheet\'s state props do not count against token adoption', (await tokenWarn('hover')) === (await tokenWarn()));
}

// ── Verify round 1: mutation kills ──────────────────────────────────────
{
  const R = (n: SceneNode, v: DesignVariables = SYSTEM) => resolveVariables(n, v);
  // A disabled node with no fill gains no background.
  for (const type of ['menu-row', 'tree-row', 'nav-item', 'list-row'] as const) {
    const t = tag(render([{ id: 'n', type, label: 'x', title: 'x', state: 'disabled' }]), 'n');
    check(`M: a disabled ${type} with no fill draws no background`, !t.includes('background-color'), t);
  }
  // An authored opacity wins on every node type, with and without the pair.
  const OWN: SceneNode[] = [
    { id: 'n', type: 'button', label: 'S' }, { id: 'n', type: 'link', label: 'L' }, { id: 'n', type: 'nav-item', label: 'N' },
    { id: 'n', type: 'tree-row', label: 'T' }, { id: 'n', type: 'menu-row', label: 'M' }, { id: 'n', type: 'list-row', title: 'R' },
    { id: 'n', type: 'checkbox', checked: true }, { id: 'n', type: 'toggle' }, { id: 'n', type: 'radio' }, { id: 'n', type: 'select', value: 'A' },
  ];
  for (const n of OWN) for (const [vn, v] of [['pair', SYSTEM], ['no tokens', COLORS_ONLY]] as const) {
    const t = tag(render([{ ...n, disabled: true, opacity: 0.7 }], v), 'n');
    check(`M: an authored opacity wins on a disabled ${n.type} (${vn})`, t.includes('opacity: 0.7') && !t.includes('opacity: 0.38') && !t.includes('opacity: 0.5') && !t.includes('color-mix'), t);
  }
  {
    const ti = chunk(render([{ id: 'n', type: 'text-input', value: 'v', disabled: true, opacity: 0.7 }]), 'n');
    check('M: an authored opacity wins on a disabled text-input', ti.includes('opacity: 0.7') && !ti.includes('opacity: 0.38') && !ti.includes('color-mix'));
  }
  // Without tokens every disabled node and item dims to 0.5.
  for (const n of OWN) {
    const t = tag(render([{ ...n, state: 'disabled' }], COLORS_ONLY), 'n');
    check(`M: a ${n.type} with state disabled dims to 0.5 without tokens`, t.includes('opacity: 0.5') && !t.includes('color-mix'), t);
  }
  check('M: a disabled nav-bar action dims to 0.5 without tokens', chunk(render([{ id: 'n', type: 'nav-bar', title: 'T', trailing: [{ icon: 'plus', disabled: true }] }], COLORS_ONLY), 'n').includes('opacity: 0.5'));
  check('M: a disabled tab-bar item dims to 0.5 without tokens', chunk(render([{ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'A', state: 'disabled' }, { icon: 'user', label: 'B' }] }], COLORS_ONLY), 'n').includes('opacity: 0.5'));
  check('M: a disabled toast action dims to 0.5 without tokens', /<div tabindex="-1"[^>]*opacity: 0\.5/.test(render([{ id: 'n', type: 'toast', text: 'x', action: { label: 'Undo', state: 'disabled' } }], COLORS_ONLY)));
  // state disabled leaves the tab order on every type.
  for (const n of [...OWN, { id: 'n', type: 'link', label: 'L' }] as SceneNode[]) {
    if (n.type === 'list-row') continue; // never focusable
    const t = tag(render([{ ...n, state: 'disabled' }]), 'n');
    check(`M: a ${n.type} with state disabled leaves the tab order`, t.includes('tabindex="-1"') && t.includes('aria-disabled="true"') && !t.includes('data-focusable'), t);
  }
  {
    const f = chunk(render([{ id: 'n', type: 'text-input', placeholder: 'x', state: 'disabled' }]), 'n').match(/<div[^>]*role="textbox"[^>]*>/)?.[0] ?? '';
    check('M: a text-input with state disabled leaves the tab order', f.includes('tabindex="-1"') && !f.includes('data-focusable'), f);
  }
  // Disabled colours are the on-surface colour, per type.
  for (const n of [{ id: 'n', type: 'link', label: 'L' }, { id: 'n', type: 'tree-row', label: 'T' }, { id: 'n', type: 'menu-row', label: 'M' }, { id: 'n', type: 'nav-item', label: 'N' }, { id: 'n', type: 'list-row', title: 'R' }] as SceneNode[]) {
    const t = tag(render([{ ...n, state: 'disabled' }]), 'n');
    check(`M: a disabled ${n.type} draws its content in the on-surface colour`, t.includes(`color: ${ON}`) && t.includes('opacity: 0.38'), t);
  }
  const radio = tag(render([{ id: 'n', type: 'radio', checked: true, state: 'disabled' }]), 'n');
  check('M: a disabled radio draws its ring solid in the on-surface colour', radio.includes(`border: 1.5px solid ${ON}`) && !radio.includes('color-mix'), radio);
  const dot = chunk(render([{ id: 'n', type: 'nav-item', label: 'N', dotColor: '#16A34A', state: 'disabled' }]), 'n');
  check('M: a disabled nav-item dot is exactly the on-surface colour', dot.includes(`border-radius: 50%; background-color: ${ON}`), dot.slice(0, 700));
  const shortcut = chunk(render([{ id: 'n', type: 'menu-row', label: 'Copy', shortcut: '⌘C', state: 'disabled' }]), 'n');
  check('M: a disabled menu-row shortcut takes the on-surface colour', /<kbd[^>]*color: ([^;"]+)/.exec(shortcut)?.[1] === ON, shortcut.slice(0, 700));
  const share = Math.round((0.12 / 0.38) * 10000) / 100;
  const tabsOff = chunk(render([{ id: 'n', type: 'tabs', items: [{ label: 'A', active: true, count: 3 }], state: 'disabled' }]), 'n');
  check('M: a disabled active tab draws label, indicator and badge in the on-surface colour', tabsOff.includes(`color: ${ON}`) && tabsOff.includes(`bottom: 0; height: 2px; border-radius: 1px; background-color: ${ON}`)
    && tabsOff.includes(`border-radius: 8px; background-color: color-mix(in srgb, ${ON} ${share}%, transparent)`), tabsOff.slice(0, 900));
  const contained = chunk(render([{ id: 'n', type: 'tabs', variant: 'contained', items: [{ label: 'A', active: true, disabled: true }] }]), 'n');
  check('M: a disabled contained tab draws its fill in the on-surface share', contained.includes(`background-color: color-mix(in srgb, ${ON} ${share}%, transparent)`), contained.slice(0, 700));
  const barOff = chunk(render([{ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'A', badge: 2, disabled: true }] }]), 'n');
  check('M: a disabled tab-bar item draws its label and badge in the on-surface colour', barOff.includes(`gap: 2px; color: ${ON}`) && barOff.includes(`border-radius: 8px; background-color: ${ON}`), barOff.slice(0, 700));
  const navOff = chunk(render([{ id: 'n', type: 'nav-bar', title: 'T', trailing: [{ label: 'Edit', state: 'disabled' }] }]), 'n');
  check('M: a disabled nav-bar action draws in the on-surface colour', navOff.includes(`padding: 0 8px; color: ${ON}`), navOff.slice(0, 900));
  // Inks, exactly.
  const nb = R({ id: 'n', type: 'nav-bar', title: 'T' });
  check('M: a hovered nav-bar action layers its own colour (iconColor)', chunk(render([{ id: 'n', type: 'nav-bar', title: 'T', trailing: [{ icon: 'plus', state: 'hover' }] }]), 'n').includes(layer(nb.iconColor!, 8)));
  check('M: a hovered leading nav-bar action layers its own colour', chunk(render([{ id: 'n', type: 'nav-bar', title: 'T', leading: { icon: 'chevron-left', state: 'hover' } }]), 'n').includes(layer(nb.iconColor!, 8)));
  const tbr = R({ id: 'n', type: 'tab-bar', items: [] });
  const bar = chunk(render([{ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'A', active: true, state: 'pressed' }, { icon: 'user', label: 'B', state: 'hover' }] }]), 'n');
  check('M: tab-bar items layer their own colour (active → iconColor, else color)', bar.includes(layer(tbr.iconColor!, 10)) && bar.includes(layer(tbr.color!, 8)), bar.slice(0, 900));
  const tabsR = R({ id: 'n', type: 'tabs', items: [] });
  const tb = chunk(render([{ id: 'n', type: 'tabs', items: [{ label: 'A', active: true, state: 'hover' }, { label: 'B', state: 'pressed' }] }]), 'n');
  check('M: tabs layer the label colour (active → color, else secondaryColor)', tb.includes(layer(tabsR.color!, 8)) && tb.includes(layer(tabsR.secondaryColor!, 10)), tb.slice(0, 900));
  const lk = R({ id: 'n', type: 'link', label: 'L' });
  check('M: a hovered link layers its label colour', tag(render([{ id: 'n', type: 'link', label: 'L', iconColor: '#000000', state: 'hover' }]), 'n').includes(layer(lk.color!, 8)));
  check('M: the link underline sits 2px under the text', chunk(render([{ id: 'n', type: 'link', label: 'L', state: 'hover' }]), 'n').includes('text-decoration: underline; text-underline-offset: 2px'));
  // Token resolution.
  check('M: the ring prefers $accent over $primary', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'focus' }], { colors: { accent: '#111111', primary: '#222222' } }), 'n').includes(ringCss('#111111')));
  check('M: a focus token of 0.2 layers at 20%', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'focus' }], { ...SYSTEM, state: { focus: 0.2 } }), 'n').includes('#FFFFFF 20%'));
  check('M: a hover token of exactly 1 layers at 100%', tag(render([{ id: 'n', type: 'button', label: 'S', state: 'hover' }], { ...SYSTEM, state: { hover: 1 } }), 'n').includes('#FFFFFF 100%'));
  check('M: a lone out-of-range disabled token is no pair (0.5)', tag(render([{ id: 'n', type: 'button', label: 'S', disabled: true }], { ...SYSTEM, state: { disabledContent: 2 } }), 'n').includes('opacity: 0.5'));
  const noText: DesignVariables = { colors: { accent: '#2563EB', 'bg-surface': '#FFFFFF' }, state: { disabledContent: 0.38, disabledContainer: 0.12 } };
  check('M: without $text-primary the on-surface colour is #111827', tag(render([{ id: 'n', type: 'button', label: 'S', disabled: true }], noText), 'n').includes('color: #111827'));
  const noSurface: DesignVariables = { colors: { accent: '#2563EB', 'text-primary': '#222222', surface: '#FAFAFA' }, state: { disabledContent: 0.38, disabledContainer: 0.12 } };
  check('M: without $bg-surface the mark takes $surface', chunk(render([{ id: 'n', type: 'checkbox', checked: true, disabled: true }], noSurface), 'n').includes('stroke="#FAFAFA"'));
  check('M: then $bg-primary / $background (a dark palette with no surface token keeps its mark visible)', chunk(render([{ id: 'n', type: 'checkbox', checked: true, disabled: true }], { colors: { 'text-primary': '#F3F7FE', background: '#111318' }, state: { disabledContent: 0.38, disabledContainer: 0.12 } }), 'n').includes('stroke="#111318"'));
  check('M: and with neither, #FFFFFF', chunk(render([{ id: 'n', type: 'checkbox', checked: true, disabled: true }], { colors: { 'text-primary': '#222222' }, state: { disabledContent: 0.38 } }), 'n').includes('stroke="#FFFFFF"'));
  // Host styles reach the items (tuned tokens differ from the fallback).
  const tuned: DesignVariables = { ...SYSTEM, colors: { ...C, 'focus-ring': '#B45309' }, state: { ...SYSTEM.state, hover: 0.2 } };
  check('M: a tab carries the host ring colour', chunk(render([{ id: 'n', type: 'tabs', items: [{ label: 'A' }] }], tuned), 'n').includes('--fs-ring: #B45309'));
  check('M: a tab-bar item takes the host hover token', chunk(render([{ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'A', state: 'hover' }] }], tuned), 'n').includes(' 20%, transparent'));
  check('M: a modal action takes the host ring', /<div tabindex="0"[^>]*outline: 2px solid #B45309/.test(render([{ id: 'n', type: 'modal', title: 'M', actions: [{ label: 'OK', state: 'focus' }] }], tuned)));
  check('M: a toast action takes the host hover token', render([{ id: 'n', type: 'toast', text: 'x', action: { label: 'Undo', state: 'hover' } }], tuned).includes(' 20%, transparent'));
  // Fallbacks for an unresolved node.
  check('M: an unresolved pressed node layers at 10%', tag(render([{ id: 'n', type: 'button', label: 'S', color: '#FFFFFF', fill: '#000000', state: 'pressed' }], {}, false), 'n').includes(layer('#FFFFFF', 10)));
  check('M: an unresolved focused node layers at 10%', tag(render([{ id: 'n', type: 'button', label: 'S', color: '#FFFFFF', fill: '#000000', state: 'focus' }], {}, false), 'n').includes(layer('#FFFFFF', 10)));
  check('M: an unresolved unchecked checkbox in hover draws no broken layer', !render([{ id: 'n', type: 'checkbox', state: 'hover' }], {}, false).includes('color-mix(in srgb, undefined'));
}

// The census keeps disabled === true: a truthy string is still measured (pre-slice).
{
  const r = await evaluateCanvas(canvasOf('desktop-app', [{ id: 'b', name: 'b', type: 'button', icon: 'x', ariaLabel: 'X', size: 'xs', width: 20, height: 20, disabled: 'true' as unknown as boolean }]), { mode: 'fast', categories: ['usability'] });
  check('M: disabled "true" (a string) is still measured by the 24px census', r.issues.some((i) => /24px floor/.test(i.message)));
}

// ── P2: items ────────────────────────────────────────────────────────────
{
  const tabs = (items: SceneNode['items'], extra: Partial<SceneNode> = {}, vars: DesignVariables = SYSTEM) =>
    [...chunk(render([{ id: 'n', type: 'tabs', items, ...extra }], vars), 'n').matchAll(/<div role="tab"[^>]*>/g)].map((m) => m[0]);
  const t = tabs([{ label: 'A', active: true }, { label: 'B', state: 'hover' }, { label: 'C', state: 'focus' }, { label: 'D', state: 'disabled' }, { label: 'E' }]);
  check('P2: a hovered tab layers its ink; its neighbours do not', t[1]?.includes('linear-gradient(color-mix') && !t[0]?.includes('linear-gradient') && !t[4]?.includes('linear-gradient'), JSON.stringify(t));
  check('S9: a focused tab draws its ring inset', !!t[2]?.includes(ringCss(RING, -2)) && !t[2]?.includes('outline-offset: 2px'));
  check('P2: a tab with state disabled leaves the tab order at 0.38', !!t[3]?.includes('tabindex="-1"') && !!t[3]?.includes('opacity: 0.38') && !t[4]?.includes('opacity'));
  const legacyTabs = tabs([{ label: 'A', disabled: true }, { label: 'B' }], {}, COLORS_ONLY);
  check('P4: a disabled tab without tokens keeps today\'s 0.5', !!legacyTabs[0]?.includes('opacity: 0.5') && !legacyTabs[1]?.includes('opacity'));
  const hostOff = tabs([{ label: 'A' }, { label: 'B' }], { state: 'disabled' });
  check('P2: a tabs node with state disabled disables every tab', hostOff.length === 2 && hostOff.every((x) => x.includes('tabindex="-1"') && x.includes('opacity: 0.38')));
  const hostOffLegacy = tabs([{ label: 'A' }, { label: 'B' }], { disabled: true }, COLORS_ONLY);
  check('P2: a disabled tabs node without tokens dims every tab to 0.5', hostOffLegacy.every((x) => x.includes('opacity: 0.5')));

  const bar = chunk(render([{ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'Home', active: true }, { icon: 'search', label: 'Find', state: 'pressed' }, { icon: 'user', label: 'Me', state: 'disabled' }] }]), 'n');
  check('P2: a pressed tab-bar item layers its ink at 10%', /10%, transparent\), color-mix/.test(bar), bar.slice(0, 300));
  check('P2: a disabled tab-bar item renders at 0.38', bar.includes('opacity: 0.38'));
  const barRest = chunk(render([{ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'Home', active: true }, { icon: 'search', label: 'Find' }] }]), 'n');
  check('P2 twin: a tab-bar with no item state draws neither', !barRest.includes('linear-gradient(color-mix') && !barRest.includes('opacity'));
  const focusBar = chunk(render([{ id: 'n', type: 'tab-bar', items: [{ icon: 'house', label: 'Home', state: 'focus' }, { icon: 'search', label: 'Find' }] }]), 'n');
  check('S9: a focused tab-bar item draws its ring inset', focusBar.includes(ringCss(RING, -2)));

  const nb = chunk(render([{ id: 'n', type: 'nav-bar', title: 'T', leading: { icon: 'chevron-left', state: 'hover' }, trailing: [{ icon: 'plus', state: 'focus' }, { label: 'Edit', disabled: true }] }]), 'n');
  check('P2: nav-bar actions take hover, focus (ring outside) and disabled', nb.includes('8%, transparent') && nb.includes(ringCss(RING)) && nb.includes('opacity: 0.38'), nb.slice(0, 300));

  const modal = render([{ id: 'n', type: 'modal', title: 'Delete?', actions: [{ label: 'Cancel', state: 'hover' }, { label: 'Delete', variant: 'destructive', state: 'disabled' }] }]);
  // The actions render under the modal with no node id of their own (slice E L2).
  const actionTags = [...modal.matchAll(/<div tabindex="[^"]*"[^>]*>/g)].map((m) => m[0]);
  check('P2: a hovered modal action layers its ink', actionTags.some((x) => x.includes('8%, transparent') && x.includes('tabindex="0"')));
  check('P2: a disabled modal action is on-surface at 0.38 and out of the tab order', actionTags.some((x) => x.includes('opacity: 0.38') && x.includes('tabindex="-1"') && x.includes(`color: ${ON}`)));
  const modalLegacy = render([{ id: 'n', type: 'modal', title: 'Delete?', actions: [{ label: 'Delete', variant: 'destructive', disabled: true }] }], COLORS_ONLY);
  check('P4: a disabled modal action without tokens renders at 0.5 inline', /<div tabindex="-1"[^>]*opacity: 0\.5/.test(modalLegacy));
  const close = [...modal.matchAll(/<div[^>]*data-fs-modal-close[^>]*>/g)].map((m) => m[0])[0] ?? '';
  check('P2: the modal close button takes no state and carries the ring colour', !close.includes('linear-gradient') && close.includes(`--fs-ring: ${RING}`), close);

  const toast = render([{ id: 'n', type: 'toast', text: 'Saved', action: { label: 'Undo', state: 'focus' } }]);
  check('P2: a focused toast action draws the ring', toast.includes(ringCss(RING)));
  const toastOff = render([{ id: 'n', type: 'toast', text: 'Saved', action: { label: 'Undo', disabled: true } }]);
  check('P2: a disabled toast action renders at 0.38', toastOff.includes('opacity: 0.38') && toastOff.includes('tabindex="-1"'));
}

// ── P5: a canvas with no state draws no state ────────────────────────────
{
  const plain = render([
    { id: 'a', type: 'button', label: 'S' }, { id: 'b', type: 'link', label: 'L' }, { id: 'c', type: 'nav-item', label: 'N', active: true },
    { id: 'd', type: 'tabs', items: [{ label: 'A', active: true }, { label: 'B' }] }, { id: 'e', type: 'text-input', placeholder: 'x' },
    { id: 'f', type: 'checkbox', checked: true }, { id: 'g', type: 'modal', title: 'M', actions: [{ label: 'OK', variant: 'primary' }] },
  ]);
  check('P5: no state prop, no layer, no ring, no state opacity', !plain.includes('linear-gradient(color-mix') && !/outline: 2px solid/.test(plain.replace('[data-focusable]:focus-visible { outline: 2px solid var(--fs-ring, #2563EB); outline-offset: 2px; }', '')) && !plain.includes('opacity: 0.38'));
}

// ── P6: the census readers ───────────────────────────────────────────────
function canvasOf(type: 'web' | 'desktop-app' | 'mobile', children: SceneNode[]): Canvas {
  const w = type === 'mobile' ? 390 : 1440;
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, variables: {}, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width: w, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 40, children },
    metadata: { surface: type === 'web' ? { type } : type === 'mobile' ? { type, device: 'iphone-390' } : { type, device: 'window-1440' } },
  } as Canvas;
}
async function floorFindings(type: 'web' | 'desktop-app', children: SceneNode[]) {
  const r = await evaluateCanvas(canvasOf(type, children), { mode: 'fast', categories: ['usability'] });
  return r.issues.filter((i) => /24px floor/.test(i.message));
}

for (const type of ['web', 'desktop-app'] as const) {
  const small = (extra: Partial<SceneNode>): SceneNode => ({ id: 'b', name: 'b', type: 'button', icon: 'x', ariaLabel: 'Close', size: 'xs', width: 20, height: 20, ...extra });
  check(`P6 ${type}: an undersized button warns`, (await floorFindings(type, [small({})])).length === 1);
  check(`P6 ${type}: with state disabled it is not measured`, (await floorFindings(type, [small({ state: 'disabled' })])).length === 0);
  check(`P6 ${type}: with state hover it still is`, (await floorFindings(type, [small({ state: 'hover' })])).length === 1);
  const row = (extra: Partial<SceneNode>): SceneNode => ({ id: 'r', name: 'r', type: 'nav-item', label: 'Inbox', height: 20, ...extra });
  check(`P6 ${type}: a 20px nav-item warns; state disabled skips it`, (await floorFindings(type, [row({})])).length === 1 && (await floorFindings(type, [row({ state: 'disabled' })])).length === 0);
}

{
  const tabsT = desktopTargets({ id: 't', type: 'tabs', items: [{ label: 'A', state: 'disabled' }, { label: 'B', state: 'hover' }, { label: 'C', disabled: true }] });
  check('P6: desktopTargets reads a tab\'s state disabled', tabsT.map((t) => t.disabled).join() === 'true,false,true');
  const hostT = desktopTargets({ id: 't', type: 'tabs', state: 'disabled', items: [{ label: 'A' }, { label: 'B' }] });
  check('P6: a tabs node with state disabled disables every target', hostT.every((t) => t.disabled));
  check('P6: desktopTargets reads a row\'s state disabled', desktopTargets({ id: 'm', type: 'menu-row', label: 'X', state: 'disabled' })[0].disabled && !desktopTargets({ id: 'm', type: 'menu-row', label: 'X', state: 'pressed' })[0].disabled);
  const modalT = overlayTargets({ id: 'm', type: 'modal', title: 'T', actions: [{ label: 'A', state: 'disabled' }, { label: 'B' }, { label: 'C', disabled: true }] });
  check('P6: overlayTargets reads a modal action\'s disabled state; the close button stays live', modalT.map((t) => t.disabled).join() === 'false,true,false,true', JSON.stringify(modalT));
  check('P6: overlayTargets reads a toast action\'s state', overlayTargets({ id: 't', type: 'toast', text: 'x', action: { label: 'Undo', state: 'disabled' } })[0].disabled
    && !overlayTargets({ id: 't', type: 'toast', text: 'x', action: { label: 'Undo' } })[0].disabled);

  const entry = (node: SceneNode) => [{ node, parent: null, depth: 0 }];
  const bar: SceneNode = { id: 'tb', type: 'tab-bar', items: [{ icon: 'house', label: 'A', state: 'disabled' }, { icon: 'search', label: 'B' }] };
  check('P6: the 24px census skips a disabled tab-bar item', pointerTargets(entry(bar) as never, 1440).map((t) => t.disabled).join() === 'true,false');
  const barOff: SceneNode = { ...bar, state: 'disabled', items: [{ icon: 'house', label: 'A' }, { icon: 'search', label: 'B' }] };
  check('P2: a tab-bar node ignores its own state (its tabs stay in the census)', pointerTargets(entry(barOff) as never, 1440).every((t) => !t.disabled));
  check('P2 twin: a tab-bar node with disabled: true still disables its tabs', pointerTargets(entry({ ...barOff, state: undefined, disabled: true }) as never, 1440).every((t) => t.disabled));
  const nb: SceneNode = { id: 'nb', type: 'nav-bar', leading: { icon: 'chevron-left', disabled: true }, trailing: [{ icon: 'plus' }, { icon: 'x', state: 'disabled' }] };
  check('P6: the 24px census skips a disabled nav-bar action', pointerTargets(entry(nb) as never, 1440).map((t) => t.disabled).join() === 'true,false,true');
  check('P2: a nav-bar node ignores its own state', pointerTargets(entry({ id: 'nb2', type: 'nav-bar', state: 'disabled', trailing: [{ icon: 'plus' }] }) as never, 1440).every((t) => !t.disabled));
  check('P2: a frame with state disabled is no target', pointerTargets(entry({ id: 'f', type: 'frame', state: 'disabled', width: 10, height: 10 }) as never, 1440).length === 0);
}

// Mobile's 44px census never exempted disabled targets, and still does not.
{
  const r = await evaluateCanvas(canvasOf('mobile', [{ id: 'b', name: 'b', type: 'button', label: 'Go', size: 'sm', state: 'disabled' }]), { mode: 'fast', categories: ['usability'] });
  check('P6: the mobile touch census still measures a disabled sm button', r.issues.some((i) => i.rule === 'mobile-touch-target' && i.nodeId === 'b'));
}

// Primary count: a disabled primary is not a primary.
{
  const count = async (children: SceneNode[]) =>
    (await evaluateCanvas(canvasOf('desktop-app', children), { mode: 'fast', categories: ['structure'] })).issues.filter((i) => i.rule === 'desktop-app-primary-count').length;
  const p = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id, name: id, type: 'button', label: id, size: 'sm', ...extra });
  check('P6: two primaries in one pane raise the info', (await count([p('One'), p('Two')])) === 1);
  check('P6: one of them with state disabled does not', (await count([p('One'), p('Two', { state: 'disabled' })])) === 0);
  check('P6 twin: one of them with state hover still does', (await count([p('One'), p('Two', { state: 'hover' })])) === 1);
  const modal = (a: SceneNode['actions']): SceneNode => ({ id: 'm', name: 'm', type: 'modal', title: 'M', actions: a });
  check('P6: two primary modal actions raise the info', (await count([modal([{ label: 'A', variant: 'primary' }, { label: 'B', variant: 'primary' }])])) === 1);
  check('P6: one disabled modal primary does not', (await count([modal([{ label: 'A', variant: 'primary' }, { label: 'B', variant: 'primary', state: 'disabled' }])])) === 0);
}

check('the constants are Material 3\'s', JSON.stringify(STATE_LAYERS) === JSON.stringify({ hover: 0.08, focus: 0.10, pressed: 0.10, disabledContent: 0.38, disabledContainer: 0.12 }));

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
