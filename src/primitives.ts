// Phase 30 slice D — the geometry of the mobile primitives, shared by the
// renderer (which draws them) and the rules (which judge what it draws), so the
// two can never disagree about a button's height or where a tab bar pins.

import type { ElementState, SceneNode, TabItem, TabsItem } from './types.js';
import { DEFAULT_DEVICE, DEVICE_PROFILES, usableSafeArea } from './surfaces.js';

export const BUTTON_HEIGHT = { xs: 24, sm: 32, md: 44, lg: 52 } as const;
export const BUTTON_PADDING = { xs: 8, sm: 12, md: 16, lg: 20 } as const;
export const BUTTON_FONT = { xs: 12, sm: 14, md: 16, lg: 17 } as const;
export const LIST_ROW_HEIGHT = 44;
export const LIST_ROW_SUBTITLE_HEIGHT = 56;
export const NAV_BAR_HEIGHT = 44;
export const NAV_BAR_LARGE_HEIGHT = 96;
/** Every nav-bar action's hit box. */
export const NAV_ACTION = 44;
/** The tab bar's item band (the home-indicator inset sits below it). */
export const TAB_BAND = 49;
export const FAB_SIZE = 56;
/** How far the FAB rises above the band — included in the tab bar's box. */
export const FAB_RAISE = 16;
export const FLOATING_INSET = 16;

export const TAPPABLE_PRIMITIVES = new Set(['button', 'list-row', 'tab-bar', 'nav-bar']);

/** Words and enum names, never style values: the resolver leaves them as
 * written (a price such as "$49" is copy, not a token), and the token census
 * and the unknown-token rule skip them. */
export const COPY_PROPS = new Set([
  'name', 'content', 'text', 'title', 'subtitle', 'label', 'time', 'placeholder', 'value', 'shortcut',
  'error', 'ariaLabel', 'count', 'closeLabel', 'centerValue', 'centerLabel',
  // Enums.
  'variant', 'size', 'detent', 'appearance', 'iconPosition', 'orientation', 'state',
]);

// Phase 31 slice B — the desktop-app vocabulary's geometry, on the 24 / 32 /
// 40 / 48 density ladder.
export const LINK_MIN_HEIGHT = 24;
export const LINK_ICON = 14;
export const LINK_EXTERNAL = 12;
export const NAV_ITEM_HEIGHT = 32;
export const TABS_HEIGHT = { sm: 32, md: 40 } as const;
export const TREE_ROW_HEIGHT = 32;
export const TREE_INDENT = 16;
export const MENU_ROW_HEIGHT = 32;
export const PROPERTY_ROW_HEIGHT = 32;
export const PROPERTY_LABEL_WIDTH = 96;
export const TEXT_INPUT_HEIGHT = { sm: 32, md: 40 } as const;
/** One line of a multi-line text-input (13px type at 20px leading). */
export const TEXT_INPUT_LINE = 20;

/** Every pointer target the web and desktop-app 24px census measures: the
 * phone tappables plus the desktop-app vocabulary. `property-row` and
 * `divider` are not targets (a property-row's value is). */
export const CLICKABLE_PRIMITIVES = new Set([...TAPPABLE_PRIMITIVES, 'link', 'text-input', 'nav-item', 'tabs', 'tree-row', 'menu-row']);

// Phase 31 slice G (FR-G1) — element states.
/** Phase 31 FR-A8 — Material 3's current state-layer and disabled
 * opacities (Flutter gen_defaults token files; an older M3 set used 0.12 for
 * focus and pressed). */
export const STATE_LAYERS = { hover: 0.08, focus: 0.10, pressed: 0.10, disabledContent: 0.38, disabledContainer: 0.12 } as const;

export const ELEMENT_STATES: readonly ElementState[] = ['rest', 'hover', 'focus', 'pressed', 'disabled'];

/** The nodes that take `state` themselves (spec P2). Items of tabs, tab-bar,
 * nav-bar, modal and toast take it on the item instead. */
export const STATEFUL_TYPES = new Set([
  'button', 'link', 'text-input', 'nav-item', 'tree-row', 'menu-row', 'list-row',
  'toggle', 'checkbox', 'radio', 'select',
]);

/** The effective state of a node or an item: `disabled: true` wins, then a
 * known `state`, else rest (an unknown value is ignored). */
export function elementState(n: { state?: unknown; disabled?: unknown } | null | undefined): ElementState {
  if (!n) return 'rest';
  if (n.disabled === true) return 'disabled';
  return typeof n.state === 'string' && (ELEMENT_STATES as readonly string[]).includes(n.state) ? n.state as ElementState : 'rest';
}

/** Disabled by `disabled: true` or `state: "disabled"`. */
export function isDisabled(n: { state?: unknown; disabled?: unknown } | null | undefined): boolean {
  return elementState(n) === 'disabled';
}

/** Rows whose only target, a control directly inside them, is measured by
 * the row's box (no link, input or button beside it). */
export const CONTROL_OWNERS = new Set(['property-row', 'nav-item', 'menu-row', 'list-row']);

/** The desktop-app primitives — on a canvas that never declared desktop-app,
 * their presence asks for a declaration (desktop-app-artboard). */
export const DESKTOP_APP_PRIMITIVES = new Set(['nav-item', 'tabs', 'tree-row', 'menu-row', 'property-row']);
// Phase 31 slice E — overlays. The renderer lifts them into one layer after
// the content; the layer order is fixed by kind (Atlassian's ladder).
export const OVERLAY_TYPES = new Set(['tooltip', 'popover', 'menu', 'modal', 'toast', 'drawer']);
export const OVERLAY_Z = { popover: 400, menu: 400, scrim: 500, modal: 510, drawer: 510, toast: 600, tooltip: 800 } as const;
export const TOOLTIP_MAX_WIDTH = 240;
export const MENU_MIN_WIDTH = 192;
export const POPOVER_WIDTH = { xs: 192, sm: 320, md: 480, lg: 640 } as const;
export const MODAL_WIDTH = { sm: 480, md: 640, lg: 960 } as const;
export const DRAWER_WIDTH = { sm: 320, md: 480 } as const;
/** The modal's header close button and its actions (sm buttons), and a
 * toast's action (an xs button). */
export const MODAL_CONTROL = 32;
export const TOAST_ACTION = 24;

/** A modal's width: a numeric width, else its size (default md). */
export function modalWidth(n: SceneNode): number {
  return isNum(n.width) ? n.width : MODAL_WIDTH[n.size === 'sm' || n.size === 'lg' ? n.size : 'md'];
}

/** A popover's width: a numeric width, else its size (default sm). */
export function popoverWidth(n: SceneNode): number {
  return isNum(n.width) ? n.width : POPOVER_WIDTH[n.size === 'xs' || n.size === 'md' || n.size === 'lg' ? n.size : 'sm'];
}

/** A drawer's width: a numeric width, else its size (default sm). */
export function drawerWidth(n: SceneNode): number {
  return isNum(n.width) ? n.width : DRAWER_WIDTH[n.size === 'md' ? 'md' : 'sm'];
}

/** A modal's actions that render (a blank label is skipped), in rendered
 * order: the non-filled ones (no variant renders secondary) as authored, then
 * the filled ones (primary, destructive), so the filled action is rightmost. */
export function modalActions(n: SceneNode): Array<NonNullable<SceneNode['actions']>[number]> {
  const all = Array.isArray(n.actions) ? n.actions.filter((a) => !!a && typeof a === 'object' && hasText(a.label)) : [];
  const filled = (a: { variant?: string }) => a.variant === 'primary' || a.variant === 'destructive';
  return [...all.filter((a) => !filled(a)), ...all.filter(filled)];
}

/** The pointer targets an overlay renders under its own node id: a modal's
 * close button and actions, a toast's action. */
export function overlayTargets(n: SceneNode): Array<{ what: string; w?: number; h: number; disabled: boolean }> {
  if (n.type === 'modal') {
    return [
      { what: 'modal close button', w: MODAL_CONTROL, h: MODAL_CONTROL, disabled: false },
      ...modalActions(n).map((a) => ({ what: `modal action "${String(a.label).trim()}"`, h: MODAL_CONTROL, disabled: isDisabled(a) })),
    ];
  }
  if (n.type === 'toast' && n.action && typeof n.action === 'object' && hasText(n.action.label)) {
    return [{ what: `toast action "${String(n.action.label).trim()}"`, h: TOAST_ACTION, disabled: isDisabled(n.action) }];
  }
  return [];
}

/** Chrome a pinned position reserves room for, and the edge it pins to. */
export const CHROME_EDGE: Record<string, 'top' | 'bottom'> = { 'status-bar': 'top', 'home-indicator': 'bottom', 'tab-bar': 'bottom' };

const PROFILE = DEVICE_PROFILES[DEFAULT_DEVICE];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A label prop that renders: a non-blank string or a finite number. */
const hasText = (v: unknown): boolean => (typeof v === 'string' && v.trim() !== '') || isNum(v);

/** A node's position as rendered: pinned chrome defaults to `fixed`, a
 * sheet is always `fixed`, and an overlay is `absolute` in the overlay layer. */
export function effectivePosition(n: SceneNode): SceneNode['position'] {
  if (n.type === 'sheet') return 'fixed'; // always an overlay; its position prop is ignored
  // Phase 31 slice E — lifted into the overlay layer, out of flow.
  if (OVERLAY_TYPES.has(n.type)) return 'absolute';
  return n.position ?? (Object.hasOwn(CHROME_EDGE, n.type) ? 'fixed' : undefined);
}

/** The insets the primitives size themselves by: the root's usable safeArea
 * sides, else the default device's (47 / 34). */
export function rootInsets(root: SceneNode): { top: number; bottom: number } {
  const usable = root.type === 'document' ? usableSafeArea(root.safeArea) : {};
  return { top: usable.top ?? PROFILE.safeArea.top, bottom: usable.bottom ?? PROFILE.safeArea.bottom };
}

/** The rendered height of a chrome primitive (undefined for anything else). */
export function chromeHeight(n: SceneNode, insets: { top: number; bottom: number }): number | undefined {
  if (n.type === 'status-bar') return insets.top;
  if (n.type === 'home-indicator') return insets.bottom;
  if (n.type === 'tab-bar') return TAB_BAND + insets.bottom + (n.variant === 'fab' ? FAB_RAISE : 0);
  return undefined;
}

export function buttonHeight(n: SceneNode): number {
  const size = BUTTON_HEIGHT[n.size ?? 'md'] ?? BUTTON_HEIGHT.md;
  return Math.max(isNum(n.height) ? n.height : size, isNum(n.minHeight) ? n.minHeight : 0);
}

/** A button's box: never narrower than tall (min-width = height); an
 * icon-only button is square. Width is the numeric width when there is one. */
export function buttonBox(n: SceneNode): { w: number; h: number } {
  const h = buttonHeight(n);
  const iconOnly = !hasText(n.label);
  return { w: !iconOnly && isNum(n.width) ? Math.max(n.width, h) : h, h };
}

export function listRowMinHeight(n: SceneNode): number {
  return hasText(n.subtitle) ? LIST_ROW_SUBTITLE_HEIGHT : LIST_ROW_HEIGHT;
}

export function navBarHeight(n: SceneNode): number {
  return n.largeTitle ? NAV_BAR_LARGE_HEIGHT : NAV_BAR_HEIGHT;
}

/** The tab items that render (a null entry is skipped). */
export function tabItems(n: SceneNode): TabItem[] {
  return Array.isArray(n.items) ? (n.items as Array<TabItem | null>).filter((it): it is TabItem => !!it && typeof it === 'object') : [];
}

/** Phase 31 — a `tabs` node's items that render. */
export function tabsItems(n: SceneNode): TabsItem[] {
  return Array.isArray(n.items) ? (n.items as Array<TabsItem | null>).filter((it): it is TabsItem => !!it && typeof it === 'object') : [];
}

/** A text-input's line count: whole lines, at least 1. */
export function textInputRows(n: SceneNode): number {
  return isNum(n.rows) && n.rows >= 2 ? Math.floor(n.rows) : 1;
}

export function textInputHeight(n: SceneNode): number {
  const base = TEXT_INPUT_HEIGHT[n.size === 'sm' ? 'sm' : 'md'];
  const rows = textInputRows(n);
  return rows > 1 ? Math.max(base, rows * TEXT_INPUT_LINE + 12) : base;
}

/** A width written as a px string ("10px"). */
function pxWidth(v: unknown): number | undefined {
  const m = typeof v === 'string' ? /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(v) : null;
  return m ? Number(m[1]) : undefined;
}

/** No width, or one that sizes to content. */
const hugsWidth = (v: unknown): boolean => v === undefined || v === null || v === '' || v === 'auto';

/** The width an unlabelled link renders at: its 14px icon and 12px
 * external-link glyph, 4px apart (renderLink). */
export function linkGlyphWidth(n: SceneNode): number {
  const glyphs = [n.icon ? LINK_ICON : 0, n.external ? LINK_EXTERNAL : 0].filter((g) => g > 0);
  return glyphs.reduce((a, g) => a + g, 0) + Math.max(0, glyphs.length - 1) * 4;
}

/** The pointer targets a desktop-app primitive renders, each by its own box
 * (width undefined when it is not known from the scene). `tabs` has one per
 * item; the rest have one. Not for the phone tappables (see evaluate). */
export function desktopTargets(n: SceneNode): Array<{ what: string; w?: number; h: number; disabled: boolean }> {
  const w = isNum(n.width) ? n.width : undefined;
  // The rendered height: these rows take an explicit `height` and ignore
  // `minHeight`, so the census does too (it must judge what renders).
  const h = (fallback: number) => (isNum(n.height) ? n.height : fallback);
  const disabled = isDisabled(n);
  switch (n.type) {
    // A link never renders shorter than 24 (min-height), whatever its height.
    // A px width is its width; without a label and with no width (or "auto")
    // it hugs its glyphs, so its width is known (slice C); a fluid or token
    // width stays unknown.
    case 'link': return [{ what: 'link', w: w ?? pxWidth(n.width) ?? (hugsWidth(n.width) && !hasText(n.label) ? linkGlyphWidth(n) : undefined), h: Math.max(LINK_MIN_HEIGHT, h(LINK_MIN_HEIGHT)), disabled }];
    // A text-input's height comes from its size and rows (the renderer ignores `height`).
    case 'text-input': return [{ what: 'text-input', w, h: textInputHeight(n), disabled }];
    case 'nav-item': return [{ what: 'nav-item', w: n.collapsed ? NAV_ITEM_HEIGHT : w, h: h(NAV_ITEM_HEIGHT), disabled }];
    case 'tree-row': return [{ what: 'tree-row', w, h: h(TREE_ROW_HEIGHT), disabled }];
    case 'menu-row': return [{ what: 'menu-row', w, h: h(MENU_ROW_HEIGHT), disabled }];
    case 'tabs': {
      // The tablist's height comes from its size alone (the renderer ignores
      // `height`); a disabled tabs node disables every tab.
      const th = TABS_HEIGHT[n.size === 'sm' ? 'sm' : 'md'];
      return tabsItems(n).map((it, i) => ({ what: `tab "${typeof it.label === 'string' ? it.label : i + 1}"`, h: th, disabled: disabled || isDisabled(it) }));
    }
    default: return [];
  }
}

/** Slots across the band: one per item, plus the FAB's. */
export function tabSlots(n: SceneNode): number {
  return tabItems(n).length + (n.variant === 'fab' ? 1 : 0);
}

/** One tab item's box: bar width / slots × the band. */
export function tabItemBox(n: SceneNode, rootWidth: number): { w: number; h: number } {
  const bar = (isNum(n.width) ? n.width : rootWidth) - (n.variant === 'floating' ? FLOATING_INSET * 2 : 0);
  return { w: bar / Math.max(1, tabSlots(n)), h: TAB_BAND };
}

/** The nav-bar actions that render: the back action and up to two trailing. */
export function navActions(n: SceneNode): { icon?: string; label?: string; state?: ElementState; disabled?: boolean }[] {
  const trailing = Array.isArray(n.trailing) ? n.trailing.filter((a) => !!a && typeof a === 'object').slice(0, 2) : [];
  return [...(n.leading && typeof n.leading === 'object' ? [n.leading] : []), ...trailing];
}

/** Pinned to the bottom edge: fixed with a `bottom` (or bottom chrome with no
 * offsets) and no `y` — a `y` pins it to the top. */
export const pinsBottom = (n: SceneNode): boolean =>
  effectivePosition(n) === 'fixed' && n.y === undefined && (n.bottom !== undefined || CHROME_EDGE[n.type] === 'bottom');
/** Pinned to the top edge: fixed with a `y`, or top chrome with none. */
export const pinsTop = (n: SceneNode): boolean =>
  effectivePosition(n) === 'fixed' && (n.y !== undefined || (n.bottom === undefined && CHROME_EDGE[n.type] !== 'bottom'));

/** Animations whose end state keeps a transform (fadeIn only fades). */
const TRANSFORMING_ANIMATIONS = new Set(['slideUp', 'slideDown', 'scaleIn']);

/** A node that makes `fixed` descendants pin to it instead of the viewport
 * (CSS: a transform, filter or backdrop filter creates their containing block). */
export function unpinsFixed(n: SceneNode): boolean {
  return !!n.blur || !!n.backdropBlur || n.backdropFilter !== undefined
    || (n.animation !== undefined && TRANSFORMING_ANIMATIONS.has(n.animation.name));
}

/** How far each edge's pinned chrome reaches: the largest chrome height +
 * offset per edge, over every effectively fixed status-bar (top) and tab-bar /
 * home-indicator (bottom) in the tree. A sheet's subtree is skipped. Read it
 * on an expanded tree (src/expand.ts) to see chrome inside instances. */
export function chromeReservation(root: SceneNode): { top: number; bottom: number } {
  const insets = rootInsets(root);
  const out = { top: 0, bottom: 0 };
  (function walk(n: SceneNode) {
    if (n.type === 'sheet') return;
    const edge = CHROME_EDGE[n.type];
    if (edge && effectivePosition(n) === 'fixed') {
      const h = chromeHeight(n, insets) ?? 0;
      if (edge === 'top' && n.bottom === undefined) out.top = Math.max(out.top, h + (isNum(n.y) ? n.y : 0));
      if (edge === 'bottom' && n.y === undefined) out.bottom = Math.max(out.bottom, h + (isNum(n.bottom) ? n.bottom : 0));
    }
    n.children?.forEach(walk);
  })(root);
  return out;
}
