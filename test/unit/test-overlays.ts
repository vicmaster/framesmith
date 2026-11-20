// Phase 31 slice E — overlays without Chrome: the six overlay types are lifted
// out of the tree into one layer after the content (nested ones too, and ones
// inside instances), a canvas without overlays renders no layer, the layer
// ladder's z-indexes by kind, colours default from tokens (and fall back
// unthemed), modal actions render with the filled one rightmost, the deferred
// rule clauses (FR-C9's overlay clause, modal/drawer panes, a modal's primary
// action, the overlay targets in the 24px census), stress reaches the overlay
// copy, and FR-E3: an overlay state variant is listed and never demanded.
// Rendered geometry and stacking live in test/browser/test-overlays-render.ts (Chrome).
//
// Usage: npx tsx test/unit/test-overlays.ts

import '../env.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { renderToHtml } from '../../src/renderer.js';
import { resolveVariables } from '../../src/variables.js';
import { applyPerturbation } from '../../src/stress.js';
import { createCanvas, addVariant, listCanvases, getCanvas } from '../../src/scene-graph.js';
import { OVERLAY_TYPES, OVERLAY_Z, effectivePosition, modalActions, modalWidth, overlayTargets, popoverWidth, drawerWidth } from '../../src/primitives.js';
import { checkCurrent, checkPrimaryCount } from '../../src/desktop-app-rules.js';
import { WINDOW_PROFILES } from '../../src/surfaces.js';
import { generateDesignSystem } from '../../src/design-language.js';
import type { Canvas, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type Surface = { type: 'web' | 'mobile' | 'desktop-app'; device?: string };
const app: Surface = { type: 'desktop-app', device: 'window-1440' };
function canvasWith(children: SceneNode[], surface?: Surface, colors?: Record<string, string>, components: Record<string, SceneNode> = {}): Canvas {
  return {
    id: 'c', name: 'c', projectId: 'p', components, createdAt: '', lastModified: '',
    variables: colors ? { colors } : {},
    root: { id: 'document', type: 'document', name: 'Document', width: 1440, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, gap: 8, children },
    ...(surface ? { metadata: { surface } } : {}),
  } as Canvas;
}
const htmlOf = (c: Canvas, theme?: 'light' | 'dark') => renderToHtml(resolveVariables(c.root, c.variables, { theme }), 1440, 900, c);
const layerOf = (html: string) => {
  const at = html.indexOf('<div data-fs-overlay-layer');
  return at < 0 ? '' : html.slice(at);
};
/** Whether the element with node id `inner` sits inside the one with `outer`
 * (a tag-depth walk from the outer element's opening tag). */
function inside(html: string, outer: string, inner: string): boolean {
  const open = html.lastIndexOf('<', html.indexOf(`data-node-id="${outer}"`));
  const target = html.indexOf(`data-node-id="${inner}"`);
  if (open < 0 || target < 0 || target < open) return false;
  let depth = 0;
  for (const m of html.slice(open, target).matchAll(/<(\/?)(div|p|span|kbd)\b/g)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return false;
  }
  return depth > 0;
}
const contentOf = (html: string) => {
  const at = html.indexOf('<div data-fs-overlay-layer');
  return at < 0 ? html : html.slice(0, at);
};
const TOKENS = {
  'bg-surface': '#FAFAF9', 'bg-primary': '#FFFFFF', border: '#E7E5E4', 'text-primary': '#1C1917', 'text-secondary': '#57534E',
  accent: '#166534', danger: '#B91C1C', success: '#15803D', warning: '#B45309',
};

const modal = (extra: Partial<SceneNode> = {}): SceneNode => ({
  id: 'm', name: 'Confirm', type: 'modal', title: 'Delete canvas?',
  actions: [{ label: 'Delete', variant: 'destructive' }, { label: 'Cancel' }],
  children: [{ id: 'mt', name: 'mt', type: 'text', content: 'This cannot be undone.', fontSize: 14 }], ...extra,
});

// ── K1: the layer ───────────────────────────────────────────────────────────
{
  const plain = htmlOf(canvasWith([{ id: 'b', name: 'b', type: 'button', label: 'Save' }], app));
  check('no overlay: no layer and no body position', !plain.includes('data-fs-overlay-layer') && !plain.includes('body { position: relative; }'));
  const withOne = htmlOf(canvasWith([{ id: 'b', name: 'b', type: 'button', label: 'Save' }, { id: 'tip', name: 'tip', type: 'tooltip', text: 'Saves now', x: 10, y: 20 }], app));
  check('twin: an overlay adds the layer and body position', withOne.includes('data-fs-overlay-layer') && withOne.includes('body { position: relative; }'));
  check('the overlay is lifted out of the content', !contentOf(withOne).includes('data-node-id="tip"') && layerOf(withOne).includes('data-node-id="tip"'));
  check('the button stays in the content', contentOf(withOne).includes('data-node-id="b"') && !layerOf(withOne).includes('data-node-id="b"'));
  check('authored x / y are root coordinates', /data-node-id="tip"[^>]*style="[^"]*left: 10px; top: 20px/.test(withOne));
  check('the layer is the artboard box', /data-fs-overlay-layer style="position: absolute; left: 0; top: 0; width: 100%; max-width: 1440px; height: 900px; pointer-events: none"/.test(withOne));

  // Every kind, each nested somewhere awkward: a sticky bar, a fixed bar, a
  // scrolling and a clipping pane, an animated ancestor, another overlay.
  const deep = canvasWith([
    { id: 'sticky', name: 'sticky', type: 'frame', position: 'sticky', height: 48, children: [
      { id: 'menu', name: 'menu', type: 'menu', x: 16, y: 44, children: [{ id: 'r1', name: 'r1', type: 'menu-row', label: 'Rename' }] },
    ] },
    { id: 'fixed', name: 'fixed', type: 'frame', position: 'fixed', height: 40, children: [{ id: 'tip', name: 'tip', type: 'tooltip', text: 'Hi' }] },
    { id: 'scroll', name: 'scroll', type: 'frame', overflow: 'auto', height: 200, children: [
      { id: 'pop', name: 'pop', type: 'popover', x: 100, y: 100, children: [{ id: 'inner-tip', name: 'inner-tip', type: 'tooltip', text: 'Nested' }] },
    ] },
    { id: 'clip', name: 'clip', type: 'frame', overflow: 'hidden', height: 100, animation: { name: 'slideUp' }, children: [{ id: 'toast', name: 'toast', type: 'toast', text: 'Saved' }] },
    { id: 'drawer', name: 'drawer', type: 'drawer', scrim: true, children: [modal()] },
  ], app);
  const html = htmlOf(deep);
  const layer = layerOf(html);
  const lifted = ['menu', 'tip', 'pop', 'inner-tip', 'toast', 'drawer', 'm'];
  check('every overlay renders in the layer, nested ones too', lifted.every((id) => layer.includes(`data-node-id="${id}"`)), lifted.filter((id) => !layer.includes(`data-node-id="${id}"`)).join(','));
  check('no overlay renders in the content', lifted.every((id) => !contentOf(html).includes(`data-node-id="${id}"`)));
  check('each overlay renders exactly once', lifted.every((id) => html.split(`data-node-id="${id}"`).length === 2));
  check('a menu\'s rows render inside it', /data-node-id="menu"[^]*data-node-id="r1"/.test(layer));
  check('a nested tooltip is its own layer member, not inside the popover', !inside(layer, 'pop', 'inner-tip') && !inside(html, 'sticky', 'menu') && !inside(html, 'scroll', 'pop'));
  check('twin: the menu\'s row is inside the menu', inside(layer, 'menu', 'r1'));
  const z = (id: string) => Number(new RegExp(`data-node-id="${id}"[^>]*z-index: (\\d+)`).exec(layer)?.[1]);
  check('the ladder: menu/popover 400, modal/drawer 510, toast 600, tooltip 800',
    z('menu') === 400 && z('pop') === 400 && z('m') === 510 && z('drawer') === 510 && z('toast') === 600 && z('tip') === 800,
    ['menu', 'pop', 'm', 'drawer', 'toast', 'tip'].map((id) => `${id}=${z(id)}`).join(' '));
  check('scrims at 500 (modal always, drawer with scrim)', /data-fs-scrim="m"[^>]*z-index: 500/.test(layer) && /data-fs-scrim="drawer"[^>]*z-index: 500/.test(layer));
  const noScrim = layerOf(htmlOf(canvasWith([{ id: 'drawer', name: 'drawer', type: 'drawer' }], app)));
  check('twin: a drawer without scrim draws none', !noScrim.includes('data-fs-scrim'));
  check('OVERLAY_Z matches the spec ladder', OVERLAY_Z.popover === 400 && OVERLAY_Z.menu === 400 && OVERLAY_Z.scrim === 500 && OVERLAY_Z.modal === 510 && OVERLAY_Z.drawer === 510 && OVERLAY_Z.toast === 600 && OVERLAY_Z.tooltip === 800);
  check('an overlay ignores its own position prop', !/data-node-id="tip"[^>]*position: fixed/.test(htmlOf(canvasWith([{ id: 'tip', name: 'tip', type: 'tooltip', text: 'x', position: 'fixed', right: 4 } as SceneNode], app))));
  check('effectivePosition: overlays are absolute', [...OVERLAY_TYPES].every((t) => effectivePosition({ id: 'x', type: t as SceneNode['type'], position: 'fixed' }) === 'absolute'));
  check('twin: a frame keeps its position', effectivePosition({ id: 'x', type: 'frame', position: 'fixed' }) === 'fixed');

  // An overlay inside a component instance is lifted from the expanded tree.
  const comp: SceneNode = { id: 'card', name: 'Card', type: 'component', children: [{ id: 'ctip', name: 'ctip', type: 'tooltip', text: 'From a component', x: 5, y: 5 }] };
  const inst = htmlOf(canvasWith([{ id: 'i1', name: 'i1', type: 'instance', componentId: 'card' }], app, undefined, { card: comp }));
  check('an overlay inside an instance renders in the layer', layerOf(inst).includes('From a component') && !contentOf(inst).includes('From a component'));

  // Render never depends on type.
  const types = (['web', 'mobile', 'desktop-app'] as const).map((type) => htmlOf(canvasWith([modal()], { type })));
  check('the layer renders the same on every type', types[0] === types[1] && types[1] === types[2]);

  // A root narrower than the capture width: the layer takes the root's column.
  const narrow = canvasWith([{ id: 'tip', name: 'tip', type: 'tooltip', text: 'x' }], app);
  narrow.root.width = 1100;
  check('the layer is capped at the root\'s column', layerOf(renderToHtml(narrow.root, 1440, 900, narrow)).includes('max-width: 1100px'));
}

// ── K3: anatomy ─────────────────────────────────────────────────────────────
{
  const layer = layerOf(htmlOf(canvasWith([modal()], app)));
  const order = [...layer.matchAll(/<span data-fs-label[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
  check('modal actions: the filled action is rightmost', order.indexOf('Cancel') >= 0 && order.indexOf('Cancel') < order.indexOf('Delete'), order.join(' | '));
  const ordered = modalActions(modal({ actions: [{ label: 'Save', variant: 'primary' }, { label: 'Discard', variant: 'ghost' }, { label: 'Later' }, { label: '  ' }] }));
  check('modalActions: non-filled first in authored order, filled last, blanks skipped', ordered.map((a) => a.label).join(',') === 'Discard,Later,Save');
  check('modal close button: named "Close" by default', /data-fs-modal-close[^>]*aria-label="Close"/.test(layer));
  check('closeLabel names it', /data-fs-modal-close[^>]*aria-label="Dismiss"/.test(layerOf(htmlOf(canvasWith([modal({ closeLabel: 'Dismiss' })], app)))));
  check('modal: role dialog, aria-modal, labelled by its title', /role="dialog" aria-modal="true" aria-label="Delete canvas\?"/.test(layer));
  check('modal: centred unless placed', /data-node-id="m"[^>]*left: 0; right: 0; margin: auto/.test(layer));
  check('twin: a placed modal is not centred', !/data-node-id="m"[^>]*left: 0; right: 0; margin: auto/.test(layerOf(htmlOf(canvasWith([modal({ x: 40, y: 60 })], app)))));
  check('modal widths: sm 480 / md 640 / lg 960 / numeric wins', modalWidth({ id: 'a', type: 'modal', size: 'sm' }) === 480 && modalWidth({ id: 'a', type: 'modal' }) === 640 && modalWidth({ id: 'a', type: 'modal', size: 'lg' }) === 960 && modalWidth({ id: 'a', type: 'modal', width: 500 }) === 500);
  check('popover widths: default 320, xs 192, numeric wins', popoverWidth({ id: 'a', type: 'popover' }) === 320 && popoverWidth({ id: 'a', type: 'popover', size: 'xs' }) === 192 && popoverWidth({ id: 'a', type: 'popover', width: 250 }) === 250);
  check('drawer widths: default 320, md 480', drawerWidth({ id: 'a', type: 'drawer' }) === 320 && drawerWidth({ id: 'a', type: 'drawer', size: 'md' }) === 480);
  check('modal body is a walkable slot', /data-fs-slot[^>]*>[^]*data-node-id="mt"/.test(layer));
  const tipKids = layerOf(htmlOf(canvasWith([{ id: 'tip', name: 'tip', type: 'tooltip', text: 'Hint', children: [{ id: 'kid', name: 'kid', type: 'text', content: 'Child text' }] }], app)));
  check('a tooltip renders its text and never its children', tipKids.includes('Hint') && !tipKids.includes('Child text'));
  const menu = layerOf(htmlOf(canvasWith([{ id: 'menu', name: 'menu', type: 'menu', children: [{ id: 'r', name: 'r', type: 'menu-row', label: 'Open' }] }], app)));
  check('menu: role menu, min width 192, hugs its content', /role="menu"/.test(menu) && /min-width: 192px/.test(menu) && /width: max-content/.test(menu));
  const toastDanger = layerOf(htmlOf(canvasWith([{ id: 't', name: 't', type: 'toast', text: 'Failed', tone: 'danger' }], app)));
  const toastOk = layerOf(htmlOf(canvasWith([{ id: 't', name: 't', type: 'toast', text: 'Saved', tone: 'success', action: { label: 'Undo' } }], app)));
  check('toast: danger is role alert, others role status', /role="alert"/.test(toastDanger) && /role="status"/.test(toastOk) && !/role="alert"/.test(toastOk));
  check('toast: bottom-centre by default', /bottom: 24px; margin: 0 auto/.test(toastOk));
  check('toast: the action renders as a focusable button', /tabindex="0" data-focusable[^>]*>[^]*Undo/.test(toastOk));
}

// ── K4: defaults ────────────────────────────────────────────────────────────
{
  const themed = resolveVariables(canvasWith([
    modal({ actions: [{ label: 'Delete', variant: 'destructive' }, { label: 'Keep', variant: 'primary' }, { label: 'Cancel' }, { label: 'Help', variant: 'ghost' }] }),
    { id: 'tip', name: 'tip', type: 'tooltip', text: 'x' },
    { id: 'toast', name: 'toast', type: 'toast', text: 'x', tone: 'warning', action: { label: 'Undo' } },
    { id: 'pop', name: 'pop', type: 'popover' },
  ], app, TOKENS).root, { colors: TOKENS, elevation: { overlay: [{ x: 0, y: 4, blur: 8, color: 'rgba(0,0,0,0.2)' }] } });
  const byId = (id: string) => themed.children!.find((n) => n.id === id)!;
  const m = byId('m');
  check('modal: surface, border, text from tokens', m.fill === TOKENS['bg-surface'] && m.stroke === TOKENS.border && m.color === TOKENS['text-primary']);
  check('modal: radius-lg fallback 12', m.cornerRadius === 12);
  const acts = Object.fromEntries((m.actions ?? []).map((a) => [a.label, a]));
  check('destructive action: $danger fill', acts.Delete.fill === TOKENS.danger);
  check('primary action: $accent fill', acts.Keep.fill === TOKENS.accent);
  check('no-variant action: transparent, text colour, border', acts.Cancel.fill === 'transparent' && acts.Cancel.color === TOKENS['text-primary'] && acts.Cancel.stroke === TOKENS.border);
  check('ghost action: accent text, no border', acts.Help.color === TOKENS.accent && acts.Help.stroke === undefined);
  check('overlay shadow from $elevation.overlay', JSON.stringify(m.shadows) === JSON.stringify([{ x: 0, y: 4, blur: 8, color: 'rgba(0,0,0,0.2)' }]));
  const tip = byId('tip');
  check('tooltip inverts: text-primary fill, surface text', tip.fill === TOKENS['text-primary'] && tip.color === TOKENS['bg-surface']);
  const toast = byId('toast');
  check('toast: tone colours the glyph; action takes the accent', toast.iconColor === TOKENS.warning && toast.action?.color === TOKENS.accent);
  check('popover: radius-md fallback 8', byId('pop').cornerRadius === 8);
  const explicit = resolveVariables(canvasWith([modal({ fill: '#000000', actions: [{ label: 'Go', variant: 'primary', fill: '$danger' }] })], app, TOKENS).root, { colors: TOKENS });
  check('explicit fill wins; $token refs inside actions resolve', explicit.children![0].fill === '#000000' && explicit.children![0].actions![0].fill === TOKENS.danger);
  const noElevation = resolveVariables(canvasWith([modal()], app, TOKENS).root, { colors: TOKENS });
  check('without $elevation.overlay no shadows are set (renderer fallback)', noElevation.children![0].shadows === undefined);
  // Unthemed, or a raw tree rendered without resolveVariables: neutral fallbacks, never invisible.
  const unthemed = layerOf(renderToHtml(canvasWith([modal(), { id: 'tip', name: 'tip', type: 'tooltip', text: 'x' }]).root, 1440, 900));
  check('unthemed modal: white surface, grey border, dark text', /data-node-id="m"[^>]*background-color: #FFFFFF; border: 1px solid #D1D5DB/.test(unthemed));
  check('unthemed tooltip: dark fill, light text', /data-node-id="tip"[^>]*background-color: #111827; color: #FFFFFF/.test(unthemed));
  check('unthemed destructive action: red fill', /background-color: #DC2626/.test(unthemed));
  check('unthemed overlay: fallback shadow', /data-node-id="m"[^>]*box-shadow: 0 8px 10px/.test(unthemed));
  const dark = htmlOf(canvasWith([modal()], app, TOKENS), 'dark');
  check('dark theme renders without throwing', dark.includes('data-node-id="m"'));
}

// ── K5: the deferred clauses ────────────────────────────────────────────────
{
  const art = async (children: SceneNode[], surface?: Surface) => (await evaluateCanvas(canvasWith(children, surface), { mode: 'fast', categories: ['structure'] })).issues.filter((i) => i.rule === 'desktop-app-artboard');
  const overlayOnly: SceneNode[] = [modal()];
  const undeclared = await art(overlayOnly);
  check('FR-C9: undeclared + overlay warns', undeclared.length === 1 && undeclared[0].severity === 'warning' && /an overlay primitive/.test(undeclared[0].message), undeclared.map((i) => i.message).join(' | '));
  check('FR-C9: explicit web + overlay only raises nothing', (await art(overlayOnly, { type: 'web' })).length === 0);
  check('FR-C9: explicit mobile + overlay only raises nothing', (await art(overlayOnly, { type: 'mobile', device: 'iphone-390' })).length === 0);
  check('FR-C9: desktop-app + overlay raises nothing', (await art(overlayOnly, app)).length === 0);
  check('twin: undeclared without any overlay or app primitive raises nothing', (await art([{ id: 'b', name: 'b', type: 'button', label: 'Go' }])).length === 0);
  const both = await art([{ id: 'nav', name: 'nav', type: 'nav-item', label: 'Home', active: true }, modal()], { type: 'mobile', device: 'iphone-390' });
  check('FR-C9: mobile + nav-item + overlay still warns for the nav-item', both.length === 1 && both[0].nodeId === 'nav');
  const tipOnly = await art([{ id: 'tip', name: 'tip', type: 'tooltip', text: 'x' }]);
  check('FR-C9: every overlay kind trips the undeclared case (tooltip)', tipOnly.length === 1);

  const ctxOf = (children: SceneNode[]) => ({ root: canvasWith(children, app).root, profile: WINDOW_PROFILES['window-1440'] });
  const navs = (prefix: string, activeIdx: number): SceneNode[] => [0, 1].map((i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}`, type: 'nav-item', label: `Item ${i}`, ...(i === activeIdx ? { active: true } : {}) }));
  const inDrawer = checkCurrent(ctxOf([...navs('a', 0), { id: 'dr', name: 'dr', type: 'drawer', children: navs('b', 0) }]));
  check('panes: a drawer\'s nav-items are their own group', inDrawer.length === 0, inDrawer.map((i) => i.message).join(' | '));
  const sameGroup = checkCurrent(ctxOf([...navs('a', 0), { id: 'fr', name: 'fr', type: 'frame', children: navs('b', 0) }]));
  check('twin: the same items in a plain frame share the root\'s group (warns)', sameGroup.length === 1);
  const inModal = checkCurrent(ctxOf([...navs('a', 0), modal({ children: navs('b', 0) })]));
  check('panes: a modal\'s nav-items are their own group', inModal.length === 0);

  const prim = (children: SceneNode[]) => checkPrimaryCount(ctxOf(children));
  const pageAndModal = prim([{ id: 'save', name: 'save', type: 'button', label: 'Save', variant: 'primary' }, modal({ actions: [{ label: 'Confirm', variant: 'primary' }] })]);
  check('FR-C8: one primary on the page and one in a modal\'s actions: silent', pageAndModal.length === 0);
  const twoInModal = prim([modal({ actions: [{ label: 'Confirm', variant: 'primary' }], children: [{ id: 'b2', name: 'b2', type: 'button', label: 'Also', variant: 'primary' }] })]);
  check('twin: a modal action plus a primary in its body is the info', twoInModal.length === 1 && /modal "Confirm"/.test(twoInModal[0].message), twoInModal.map((i) => i.message).join(' | '));
  const twoActions = prim([modal({ actions: [{ label: 'A', variant: 'primary' }, { label: 'B', variant: 'primary' }] })]);
  check('FR-C8: two primary actions in one modal are the info', twoActions.length === 1);
  const destructive = prim([modal({ actions: [{ label: 'Delete', variant: 'destructive' }], children: [{ id: 'b3', name: 'b3', type: 'button', label: 'Go', variant: 'primary' }] })]);
  check('FR-C8: a destructive action is not a primary', destructive.length === 0);
  const inDrawerPrim = prim([{ id: 'p1', name: 'p1', type: 'button', label: 'One' }, { id: 'dr', name: 'dr', type: 'drawer', children: [{ id: 'p2', name: 'p2', type: 'button', label: 'Two' }] }]);
  check('panes: a drawer is its own region for primaries', inDrawerPrim.length === 0);

  check('census: modal close + actions, 32 tall', JSON.stringify(overlayTargets(modal()).map((t) => t.h)) === '[32,32,32]');
  check('census: a toast action is 24 tall; no action, no target', overlayTargets({ id: 't', type: 'toast', action: { label: 'Undo' } })[0]?.h === 24 && overlayTargets({ id: 't', type: 'toast' }).length === 0);
  const usab = (await evaluateCanvas(canvasWith([modal(), { id: 't', name: 't', type: 'toast', text: 'x', action: { label: 'Undo' } }], app), { mode: 'fast', categories: ['usability'] })).issues;
  check('census: overlay targets never fall below the floor', !usab.some((i) => /24px floor/.test(i.message)));
  // A frame in a modal body is still judged by FR-C2 (modal is not a clickable primitive).
  const hand = (await evaluateCanvas(canvasWith([modal({ children: [{ id: 'hb', name: 'hb', type: 'frame', padding: 4, children: [{ id: 'hi', name: 'hi', type: 'icon', icon: 'x', iconSize: 16 }] }] })], app), { mode: 'fast', categories: ['usability'] })).issues.filter((i) => i.rule === 'desktop-app-handbuilt-target');
  check('FR-C2 still names a hand-built icon frame inside a modal body', hand.length === 1);
}

// ── Round 1 fixes ───────────────────────────────────────────────────────────
{
  // The generated overlay elevation is a shadow, not a glow (the halo tell).
  const glow = async (color: string) => (await evaluateCanvas(canvasWith([{ id: 'f', name: 'f', type: 'frame', width: 200, height: 100, shadows: [{ x: 0, y: 20, blur: 25, color }] }], app), { mode: 'fast', categories: ['cliche'] })).issues.filter((i) => i.tell === 'gradient-glow').length;
  check('halo tell: the generated deep-ink overlay shadow is not a glow', await glow('rgba(16, 24, 40, 0.14)') === 0);
  check('twin: a saturated dark red shadow (lightness .31) still is', await glow('rgba(127, 29, 29, 0.5)') === 1);
  check('twin: an indigo glow still is', await glow('rgba(99, 102, 241, 0.5)') === 1);
  const themedModal = canvasWith([modal()], app);
  const ds = generateDesignSystem('#2563EB', 'technical').variables;
  themedModal.variables = ds;
  const tells = (await evaluateCanvas(themedModal, { mode: 'fast', categories: ['cliche'] })).issues.filter((i) => i.tell === 'gradient-glow');
  check('a modal on a generated design system raises no halo tell', tells.length === 0, tells.map((i) => i.nodeId).join(','));

  // A menu's rows belong to the menu: pages and phones open menus too.
  const art = async (children: SceneNode[], surface?: Surface) => (await evaluateCanvas(canvasWith(children, surface), { mode: 'fast', categories: ['structure'] })).issues.filter((i) => i.rule === 'desktop-app-artboard');
  const menu: SceneNode = { id: 'menu', name: 'menu', type: 'menu', children: [{ id: 'r', name: 'r', type: 'menu-row', label: 'Open' }] };
  check('FR-C9: a menu on an explicit web canvas raises nothing', (await art([menu], { type: 'web' })).length === 0);
  check('FR-C9: a menu on an explicit mobile canvas raises nothing', (await art([menu], { type: 'mobile', device: 'iphone-390' })).length === 0);
  const loose = await art([{ id: 'fr', name: 'fr', type: 'frame', children: [{ id: 'r3', name: 'r3', type: 'menu-row', label: 'x' }] }], { type: 'mobile', device: 'iphone-390' });
  check('twin: a menu-row outside a menu on mobile still warns', loose.length === 1 && loose[0].severity === 'warning');
  const navInMenu = await art([{ ...menu, children: [{ id: 'nv', name: 'nv', type: 'nav-item', label: 'x' }] }], { type: 'mobile', device: 'iphone-390' });
  check('twin: a nav-item inside a menu on mobile still warns', navInMenu.length === 1 && navInMenu[0].nodeId === 'nv');
  const undeclaredMenu = await art([menu]);
  check('an undeclared canvas with a menu warns on the menu (the overlay clause)', undeclaredMenu.length === 1 && undeclaredMenu[0].nodeId === 'menu');

  // A popover / menu / drawer falls back to the neutral text colour, as modal and toast do.
  const unthemed = layerOf(renderToHtml(canvasWith([{ id: 'pop', name: 'pop', type: 'popover' }]).root, 1440, 900));
  check('unthemed popover: #111827 text', /data-node-id="pop"[^>]*color: #111827/.test(unthemed));

  // On a phone (safeArea, pinned tab bar) the viewport-anchored overlays keep clear.
  const phone = (children: SceneNode[]) => {
    const c = canvasWith(children, { type: 'mobile', device: 'iphone-390' });
    c.root.width = 390; c.root.height = 844; c.root.safeArea = { top: 47, bottom: 34 };
    return renderToHtml(c.root, 390, 844, c);
  };
  const tab: SceneNode = { id: 'tab', name: 'tab', type: 'tab-bar', items: [{ icon: 'house', label: 'Home', active: true }, { icon: 'user', label: 'Me' }] };
  check('phone: a centred modal clears the insets (top 63, bottom 50)', /data-node-id="m"[^>]*max-height: calc\(100% - 113px\); top: 63px; bottom: 50px/.test(layerOf(phone([modal()]))));
  check('phone: a default toast sits 16px above the tab bar', /data-node-id="t"[^>]*bottom: 99px/.test(layerOf(phone([tab, { id: 't', name: 't', type: 'toast', text: 'Saved' }]))));
  check('phone: a drawer pads past the insets', /data-node-id="d"[^>]*padding-top: calc\([^)]*\+ 47px\); padding-bottom: calc\([^)]*\+ 34px\)/.test(layerOf(phone([{ id: 'd', name: 'd', type: 'drawer' }]))));
  const desk = layerOf(htmlOf(canvasWith([modal(), { id: 't', name: 't', type: 'toast', text: 'Saved' }, { id: 'd', name: 'd', type: 'drawer' }], app)));
  check('twin: on a window they keep the 32 / 24 defaults and no extra padding', /data-node-id="m"[^>]*top: 32px; bottom: 32px/.test(desk) && /data-node-id="t"[^>]*bottom: 24px/.test(desk) && !/data-node-id="d"[^>]*padding-top: calc/.test(desk));
}

// ── Round 1 mutation gaps ───────────────────────────────────────────────────
{
  const un = (children: SceneNode[]) => layerOf(renderToHtml(canvasWith(children).root, 1440, 900));
  // Unthemed modal actions: the renderer's own fallbacks (no resolveVariables).
  const bare = un([modal({ actions: [{ label: 'Later' }] })]);
  check('unthemed bare action: secondary (transparent, bordered, dark text)', /background-color: transparent; border: 1px solid #D1D5DB; color: #111827[^"]*"><span data-fs-label[^>]*>Later/.test(bare), bare.match(/<div tabindex="0" data-focusable style="[^"]*">(<[^>]*>)?Later/)?.[0]?.slice(0, 200));
  const filled = un([modal({ actions: [{ label: 'Go', variant: 'primary' }] })]);
  check('twin: an unthemed primary action is filled, white text, no border', /background-color: #2563EB; color: #FFFFFF[^"]*"><span data-fs-label[^>]*>Go/.test(filled));
  // Scrim, aria-modal, tooltip box, toast anatomy.
  const tip = un([{ id: 'tip', name: 'tip', type: 'tooltip', text: 'x' }]);
  check('tooltip: 4px 8px padding, radius 4', /data-node-id="tip"[^>]*padding: 4px 8px; border-radius: 4px/.test(tip));
  check('scrim: rgba(0, 0, 0, 0.4)', /data-fs-scrim="m"[^>]*background-color: rgba\(0, 0, 0, 0.4\)/.test(un([modal()])));
  const dr = un([{ id: 'd', name: 'd', type: 'drawer', scrim: true }]);
  check('drawer with scrim: aria-modal', /data-node-id="d"[^>]*role="dialog" aria-modal="true"/.test(dr));
  check('twin: drawer without scrim: no aria-modal', !/aria-modal/.test(un([{ id: 'd', name: 'd', type: 'drawer' }])));
  check('drawer: radius 0, a left border only', /data-node-id="d"[^>]*border-radius: 0px[^"]*border-left: 1px solid #D1D5DB/.test(dr) && !/data-node-id="d"[^>]*border: 1px/.test(dr));
  check('default paddings: menu 4, popover 12, drawer 16', /data-node-id="mn"[^>]*padding: 4px/.test(un([{ id: 'mn', name: 'mn', type: 'menu' }]))
    && /data-node-id="pp"[^>]*padding: 12px/.test(un([{ id: 'pp', name: 'pp', type: 'popover' }])) && /data-node-id="d"[^>]*padding: 16px/.test(dr));
  check('popover renders 320 wide by default', /data-node-id="pp"[^>]*width: 320px/.test(un([{ id: 'pp', name: 'pp', type: 'popover' }])));
  check('a root-child popover at height 100% keeps its height (no root flex)', /data-node-id="pp"[^>]*height: 100%/.test(un([{ id: 'pp', name: 'pp', type: 'popover', height: '100%' }])) && !/data-node-id="pp"[^>]*flex: 1 1 auto/.test(un([{ id: 'pp', name: 'pp', type: 'popover', height: '100%' }])));
  const toastPlaced = un([{ id: 't', name: 't', type: 'toast', text: 'x', x: 40, y: 60 }]);
  check('a placed toast sits at its x / y', /data-node-id="t"[^>]*left: 40px; top: 60px/.test(toastPlaced) && !/data-node-id="t"[^>]*bottom: 24px/.test(toastPlaced));
  const withAction = un([{ id: 't', name: 't', type: 'toast', text: 'x', action: { label: 'Undo' } }]);
  check('toast padding: 8 8 8 12 with an action, 8 12 without', /data-node-id="t"[^>]*padding: 8px 8px 8px 12px/.test(withAction) && /data-node-id="t"[^>]*padding: 8px 12px/.test(un([{ id: 't', name: 't', type: 'toast', text: 'x' }])));
  const success = un([{ id: 't', name: 't', type: 'toast', text: 'x', tone: 'success' }]);
  check('success toast: the circle-check glyph in green', success.includes('lucide-circle-check') && /stroke="#16A34A"/.test(success), success.match(/<svg[^>]*>/)?.[0]);
  check('neutral toast: the info glyph', un([{ id: 't', name: 't', type: 'toast', text: 'x' }]).includes('lucide-info'));
  // Census: a toast action with no label is no target.
  check('census: a blank toast action is no target', overlayTargets({ id: 't', type: 'toast', action: { label: '  ' } }).length === 0 && overlayTargets({ id: 't', type: 'toast', action: {} as never }).length === 0);
  // Defaults: tokens inside actions / action, success tone, explicit shadow, pale accent.
  const t2 = resolveVariables(canvasWith([
    modal({ actions: [{ label: 'A', variant: 'secondary', color: '$danger', stroke: '$accent' }] }),
    { id: 'toast', name: 'toast', type: 'toast', text: 'x', tone: 'success', action: { label: 'Undo', color: '$danger' } },
    modal({ id: 'm2', shadows: [{ x: 0, y: 1, blur: 2, color: '#000000' }] }),
  ], app, TOKENS).root, { colors: TOKENS, elevation: { overlay: [{ x: 0, y: 9, blur: 9, color: 'rgba(0,0,0,0.3)' }] } });
  const k = (id: string) => t2.children!.find((n) => n.id === id)!;
  check('$token refs resolve in actions[].color / .stroke and action.color', k('m').actions![0].color === TOKENS.danger && k('m').actions![0].stroke === TOKENS.accent && k('toast').action!.color === TOKENS.danger);
  check('success toast glyph: $success', k('toast').iconColor === TOKENS.success);
  check('an explicit shadow wins over $elevation.overlay', k('m2').shadows!.length === 1 && k('m2').shadows![0].blur === 2);
  const pale = resolveVariables(canvasWith([modal({ actions: [{ label: 'Go', variant: 'primary' }] })], app, { ...TOKENS, accent: '#FDE68A' }).root, { colors: { ...TOKENS, accent: '#FDE68A' } });
  check('a pale accent gives a primary action dark text', pale.children![0].actions![0].color !== '#FFFFFF', pale.children![0].actions![0].color);
  // Drawer as a region: two primaries inside it are the info.
  const ctx = { root: canvasWith([{ id: 'dr', name: 'dr', type: 'drawer', children: [{ id: 'p1', name: 'p1', type: 'button', label: 'A' }, { id: 'p2', name: 'p2', type: 'button', label: 'B' }] }], app).root, profile: WINDOW_PROFILES['window-1440'] };
  check('twin: two primaries inside one drawer are the info', checkPrimaryCount(ctx).length === 1);
  // Every overlay kind ignores its own position.
  const pos = un([...OVERLAY_TYPES].map((t, i) => ({ id: `o${i}`, name: `o${i}`, type: t as SceneNode['type'], text: 'x', position: 'fixed' as const })));
  check('no overlay kind renders its own position: fixed', !/data-fs-overlay[^>]*position: fixed/.test(pos));
}

// ── K7: stress reaches the overlay copy ─────────────────────────────────────
{
  const root = canvasWith([
    modal(), { id: 'tip', name: 'tip', type: 'tooltip', text: 'Copy link' },
    { id: 'toast', name: 'toast', type: 'toast', text: 'Saved', action: { label: 'Undo' } },
  ], app).root;
  const { root: pert, touched } = applyPerturbation('long-text', root, { type: 'desktop-app' });
  const get = (id: string) => pert.children!.find((n) => n.id === id)!;
  check('long-text touches modal, tooltip and toast', ['m', 'tip', 'toast'].every((id) => touched.includes(id)), touched.join(','));
  check('modal title and action labels lengthen', get('m').title!.length > 'Delete canvas?'.length && get('m').actions!.every((a) => a.label.length > 6));
  check('tooltip text and toast text + action lengthen', get('tip').text!.length > 'Copy link'.length && get('toast').text!.length > 5 && get('toast').action!.label.length > 4);
}

// ── K6 / FR-E3: an overlay state is listed and never demanded ───────────────
{
  const base = createCanvas('Detail', undefined, {}, app);
  base.root.children = [{ id: 'body', name: 'body', type: 'text', content: 'Canvas detail' }];
  const { canvas: variant } = addVariant(base.id, 'confirm-delete');
  check('the confirm-delete variant exists', !!getCanvas(variant.id));
  const row = listCanvases().find((r) => r.id === base.id);
  check('canvas_list shows it on the base', !!row?.variants?.some((v) => v.state === 'confirm-delete'));
  const states = row?.variants?.map((v) => v.state) ?? [];
  const r = await evaluateCanvas(getCanvas(base.id)!, { mode: 'fast', designedStates: states });
  check('coverage lists the overlay state', r.coverage?.states.includes('confirm-delete') === true);
  check('coverage raises nothing for missing overlay states', !r.issues.some((i) => i.category === 'coverage'));
  const none = await evaluateCanvas(getCanvas(base.id)!, { mode: 'fast', designedStates: [] });
  check('twin: without the variant coverage still raises nothing (no demand)', !none.issues.some((i) => i.category === 'coverage') && none.coverage?.missing.length === 0);
}

console.log(allPass ? '\nAll checks passed.' : '\nSome checks FAILED.');
process.exit(allPass ? 0 : 1);
