// Phase 30 slice D — the geometry of the mobile primitives, shared by the
// renderer (which draws them) and the rules (which judge what it draws), so the
// two can never disagree about a button's height or where a tab bar pins.

import type { SceneNode } from './types.js';
import { DEFAULT_DEVICE, DEVICE_PROFILES, usableSafeArea } from './surfaces.js';

export const BUTTON_HEIGHT = { sm: 32, md: 44, lg: 52 } as const;
export const BUTTON_PADDING = { sm: 12, md: 16, lg: 20 } as const;
export const BUTTON_FONT = { sm: 14, md: 16, lg: 17 } as const;
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
/** Chrome a pinned position reserves room for, and the edge it pins to. */
export const CHROME_EDGE: Record<string, 'top' | 'bottom'> = { 'status-bar': 'top', 'home-indicator': 'bottom', 'tab-bar': 'bottom' };

const PROFILE = DEVICE_PROFILES[DEFAULT_DEVICE];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A node's position as rendered: pinned chrome defaults to `fixed`, and a
 * sheet is always `fixed`. */
export function effectivePosition(n: SceneNode): SceneNode['position'] {
  if (n.type === 'sheet') return 'fixed'; // always an overlay; its position prop is ignored
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
  const iconOnly = !n.label?.trim();
  return { w: !iconOnly && isNum(n.width) ? Math.max(n.width, h) : h, h };
}

export function listRowMinHeight(n: SceneNode): number {
  return n.subtitle?.trim() ? LIST_ROW_SUBTITLE_HEIGHT : LIST_ROW_HEIGHT;
}

export function navBarHeight(n: SceneNode): number {
  return n.largeTitle ? NAV_BAR_LARGE_HEIGHT : NAV_BAR_HEIGHT;
}

export function tabItems(n: SceneNode): SceneNode['items'] & object {
  return Array.isArray(n.items) ? n.items : [];
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

export function navActions(n: SceneNode): { icon?: string; label?: string }[] {
  const trailing = Array.isArray(n.trailing) ? n.trailing.slice(0, 2) : [];
  return [...(n.leading ? [n.leading] : []), ...trailing];
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
 * home-indicator (bottom) in the tree. A sheet's subtree is skipped. `expand`
 * resolves an instance to the tree it renders. */
export function chromeReservation(
  root: SceneNode,
  expand: (n: SceneNode) => SceneNode = (n) => n,
): { top: number; bottom: number } {
  const insets = rootInsets(root);
  const out = { top: 0, bottom: 0 };
  (function walk(raw: SceneNode) {
    const n = expand(raw);
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
