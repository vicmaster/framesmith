// Phase 30 slice C — the mobile ruleset's checks. Each runs only when its rule
// id is in the composed rulesOn (src/surfaces.ts RULESETS): the type `mobile`
// row turns most of them on, the `base` row turns on mobile-artboard for every
// type. Everything here measures what the renderer draws on a phone: padding
// at its rendered (fluid) size, insets from the root's safeArea or the device
// profile, sizes from the resolved tree.

import type { SceneNode } from './types.js';
import type { EvaluationIssue } from './evaluate.js';
import type { LayoutRect } from './screenshot.js';
import { renderedPaddingPx } from './renderer.js';
import { usableSafeArea, type DeviceProfile, type SurfaceDeclaration } from './surfaces.js';
import {
  buttonHeight, chromeHeight, chromeReservation, effectivePosition, listRowMinHeight, navBarHeight, pinsBottom, pinsTop,
  rootInsets, unpinsFixed,
} from './primitives.js';

/** Fixed-vocabulary mobile chrome primitives. */
const CHROME_TYPES = new Set(['status-bar', 'home-indicator', 'nav-bar', 'tab-bar', 'sheet']);
/** A nav-bar holds a title and actions, so it must clear the insets too. */
const CONTENT_TYPES = new Set(['icon', 'toggle', 'checkbox', 'radio', 'select', 'button', 'list-row', 'nav-bar', 'instance']);
const POSITIONED = new Set(['absolute', 'fixed', 'sticky']);
/** Chrome that sits in an inset by design and renders its own reservation. */
const PINNED_CHROME = new Set(['status-bar', 'home-indicator', 'tab-bar', 'sheet']);
/** The controls' render defaults (renderer controlSize / select). */
const CONTROL_HEIGHT: Record<string, number> = { toggle: 24, checkbox: 18, radio: 18, select: 36 };

/** A phone-width artboard: narrower than this reads as a phone screen. */
export const PHONE_WIDTH = 500;
const PROSE_FLOOR = 13;
const PROSE_WORDS = 5;
const LONG_COPY_WORDS = 12;
const COLUMN_WORDS = 8;
const LABEL_WORDS = 3;
/** What the renderer draws for a font-size it can't use (responsiveFontSize). */
const FALLBACK_FONT_PX = 14;
const SAFE_CSS_LENGTH = /^[a-zA-Z0-9\s().,%*+\/-]+$/;

export interface MobileContext {
  /** The resolved tree ($tokens substituted). */
  root: SceneNode;
  profile: DeviceProfile;
  /** Artboard size (root width × height, else the 1440 × 900 render defaults). */
  width: number;
  height: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function issue(category: string, rule: string, severity: EvaluationIssue['severity'], node: SceneNode, message: string, suggestion?: string): EvaluationIssue {
  return { category, rule, severity, nodeId: node.id, nodeName: node.name, message, ...(suggestion ? { suggestion } : {}) };
}

// ── measurement ────────────────────────────────────────────────────────────

/** Rendered padding per side at the artboard width (CSS shorthand order). */
export function paddingSides(node: SceneNode, viewportWidth: number): { top: number; right: number; bottom: number; left: number } {
  const p = node.padding;
  const px = (v: unknown) => (isNum(v) ? renderedPaddingPx(v, viewportWidth) : 0);
  if (isNum(p)) { const v = px(p); return { top: v, right: v, bottom: v, left: v }; }
  if (!Array.isArray(p) || p.length === 0) return { top: 0, right: 0, bottom: 0, left: 0 };
  const [a, b = a, c = a, d = b] = p;
  return { top: px(a), right: px(b), bottom: px(c), left: px(d) };
}

/** A text's rendered size in px, or undefined when it has none (the document
 * default applies). Unusable strings — an unresolved $ref among them — render
 * at the renderer's 14px fallback; a clamp() reads as its minimum, the size it
 * takes on a phone; any other CSS expression can't be read. */
export function fontPx(size: SceneNode['fontSize']): number | undefined {
  if (size === undefined) return undefined;
  if (isNum(size)) return size;
  const s = String(size).trim();
  if (!SAFE_CSS_LENGTH.test(s)) return FALLBACK_FONT_PX;
  const clamp = /^clamp\(\s*([^,]+),/.exec(s);
  const length = (clamp ? clamp[1] : s).trim();
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(length);
  if (!m) return undefined;
  return m[2] === 'rem' || m[2] === 'em' ? Number(m[1]) * 16 : Number(m[1]);
}

/** Prose words: whitespace tokens holding a letter and no digit, plus one word
 * per two CJK characters (CJK prose has no spaces). Figures and their glued
 * units ("1h", "12m") are data, so "5.2 mi · 1h 12m · 340 ft" is two words. */
export function proseWords(content: string): number {
  let words = 0;
  for (const token of content.trim().split(/\s+/)) {
    const cjk = token.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    if (cjk > 0) words += Math.ceil(cjk / 2);
    else if (/\p{L}/u.test(token) && !/\d/.test(token)) words += 1;
  }
  return words;
}

const textOf = (n: SceneNode): string | undefined =>
  n.type === 'text' && typeof n.content === 'string' && n.content.trim() ? n.content : undefined;

const isPositioned = (n: SceneNode): boolean => {
  const position = effectivePosition(n);
  return position !== undefined && POSITIONED.has(position);
};

/** Parent links and the in-flow-content answer per node, built once per
 * evaluated tree: the walks below ask about the same subtrees repeatedly, and
 * recomputing would be cubic in nesting depth. */
interface TreeIndex { parentOf: Map<SceneNode, SceneNode>; flow: Map<SceneNode, boolean>; unpinned: Map<SceneNode, boolean> }
const indexes = new WeakMap<SceneNode, TreeIndex>();

function indexFor(ctx: MobileContext): TreeIndex {
  let index = indexes.get(ctx.root);
  if (!index) {
    const parentOf = new Map<SceneNode, SceneNode>();
    (function link(n: SceneNode) { for (const c of n.children ?? []) { parentOf.set(c, n); link(c); } })(ctx.root);
    index = { parentOf, flow: new Map(), unpinned: new Map() };
    indexes.set(ctx.root, index);
  }
  return index;
}

/** Inside a sheet (a modal overlay the renderer pads): skipped by the
 * safe-area checks in both modes. */
function inSheet(n: SceneNode, ctx: MobileContext): boolean {
  const { parentOf } = indexFor(ctx);
  for (let a: SceneNode | undefined = n; a; a = parentOf.get(a)) if (a.type === 'sheet') return true;
  return false;
}

/** A `fixed` node whose ancestor sets a transform, filter or backdrop filter
 * pins to that ancestor, not the viewport — fast mode can't place it. */
function fixedUnpinned(n: SceneNode, ctx: MobileContext): boolean {
  const { parentOf, unpinned } = indexFor(ctx);
  const parent = parentOf.get(n);
  if (!parent) return false;
  let held = unpinned.get(parent);
  if (held === undefined) {
    held = unpinsFixed(parent) || fixedUnpinned(parent, ctx);
    unpinned.set(parent, held);
  }
  return held;
}

/** Content per the spec's Terms: text, icons, controls, the tappable
 * primitives, instances (opaque — they may hold content), and images narrower
 * than the artboard. Everything else is background. */
function isContent(n: SceneNode, ctx: MobileContext): boolean {
  if (n.type === 'text') return textOf(n) !== undefined;
  if (CONTENT_TYPES.has(n.type)) return true;
  if (n.type !== 'image') return false;
  if (isNum(n.width)) return n.width < ctx.width;
  // A non-numeric width spans the artboard only if nothing above it insets it.
  // A positioned image's percentage width is of its containing block's padding
  // box: the root's, or a positioned frame's, spans the artboard; anything
  // else fast mode can't size, so it counts as content.
  const { parentOf } = indexFor(ctx);
  if (isPositioned(n)) {
    const block = parentOf.get(n);
    return !(block === ctx.root || (block && isPositioned(block) && isNum(block.width) && block.width >= ctx.width));
  }
  for (let a = parentOf.get(n); a; a = parentOf.get(a)) {
    const p = paddingSides(a, ctx.width);
    if (p.left + p.right > 0) return true;
  }
  return false;
}

/** Whether any in-flow content sits beneath `n` (positioned subtrees are
 * placed on their own). */
function holdsFlowContent(n: SceneNode, ctx: MobileContext): boolean {
  const { flow } = indexFor(ctx);
  let held = flow.get(n);
  if (held === undefined) {
    held = (n.children ?? []).some((c) => !isPositioned(c) && (isContent(c, ctx) || holdsFlowContent(c, ctx)));
    flow.set(n, held);
  }
  return held;
}

// ── mobile-safe-area ───────────────────────────────────────────────────────

interface Insets { top: number; bottom: number; topReserved: boolean; bottomReserved: boolean }

function insetsFor(ctx: MobileContext): Insets {
  const usable = ctx.root.type === 'document' ? usableSafeArea(ctx.root.safeArea) : {};
  return {
    top: usable.top ?? ctx.profile.safeArea.top,
    bottom: usable.bottom ?? ctx.profile.safeArea.bottom,
    topReserved: usable.top !== undefined,
    bottomReserved: usable.bottom !== undefined,
  };
}

interface Hit { node: SceneNode; offset: number }

/** The structural walk: the first in-flow content from one edge of
 * `container`, and its offset from that edge. `offset` is where the
 * container's content box starts (padding already added). Alignment inside
 * fixed-height frames is ignored, so offsets are under-counted, never over. */
function firstContent(container: SceneNode, offset: number, edge: 'top' | 'bottom', ctx: MobileContext): Hit | null {
  const children = (container.children ?? []).filter((c) => !isPositioned(c));
  const ordered = edge === 'top' ? children : [...children].reverse();
  const visit = (child: SceneNode, at: number): Hit | null => {
    if (isContent(child, ctx)) return { node: child, offset: at };
    if (!holdsFlowContent(child, ctx)) return null;
    const pad = paddingSides(child, ctx.width);
    return firstContent(child, at + (edge === 'top' ? pad.top : pad.bottom), edge, ctx);
  };

  if (container.layout === 'horizontal' || container.layout === 'grid') {
    let best: Hit | null = null;
    for (const child of ordered) {
      const hit = visit(child, offset);
      if (hit && (!best || hit.offset < best.offset)) best = hit;
    }
    return best;
  }

  const gap = isNum(container.gap) ? container.gap : 0;
  let at = offset;
  for (const child of ordered) {
    const hit = visit(child, at);
    if (hit) return hit;
    // A spacer: background, or a frame with nothing in flow beneath it. In-flow
    // chrome (a status bar, a home indicator) spaces by its rendered height.
    const pad = paddingSides(child, ctx.width);
    const chrome = chromeHeight(child, rootInsets(ctx.root)) ?? 0;
    at += Math.max(isNum(child.height) ? child.height : 0, isNum(child.minHeight) ? child.minHeight : 0, pad.top + pad.bottom, chrome) + gap;
  }
  return null;
}

function textHeight(n: SceneNode): number {
  if (isNum(n.height)) return n.height;
  const size = fontPx(n.fontSize) ?? 16;
  const lh = isNum(n.lineHeight) ? (n.lineHeight <= 3 ? n.lineHeight * size : n.lineHeight) : 1.2 * size;
  return lh;
}

/** A primitive's or control's own height, as the renderer draws it. */
function fixedHeight(n: SceneNode): number | undefined {
  if (n.type === 'button') return buttonHeight(n);
  if (n.type === 'list-row') return Math.max(isNum(n.height) ? n.height : 0, listRowMinHeight(n));
  if (n.type === 'nav-bar') return navBarHeight(n);
  if (isNum(n.height)) return n.height;
  return CONTROL_HEIGHT[n.type];
}

/** A leaf's height for placement: text estimated from its size, primitives
 * their own, anything else its numeric height or 0. */
function leafHeight(n: SceneNode): number {
  return n.type === 'text' ? textHeight(n) : fixedHeight(n) ?? 0;
}

/** A pinned element's height when the tree fixes it: numeric height, else
 * padding plus its in-flow children (the tallest across a row, the sum down a
 * column); a child counts by its numeric height, a primitive's own height, or
 * recursively. Any unknown → undefined. */
function resolvedHeight(n: SceneNode, ctx: MobileContext): number | undefined {
  const own = fixedHeight(n);
  if (own !== undefined) return own;
  if (n.type !== 'frame' && n.type !== 'component') return undefined;
  const kids = (n.children ?? []).filter((c) => !isPositioned(c));
  const heights = kids.map((c) => resolvedHeight(c, ctx));
  if (heights.some((h) => h === undefined)) return undefined;
  const hs = heights as number[];
  const pad = paddingSides(n, ctx.width);
  const row = n.layout === 'horizontal' || n.layout === 'grid';
  const gap = isNum(n.gap) ? n.gap : 0;
  const inner = row ? Math.max(0, ...hs) : hs.reduce((a, b) => a + b, 0) + gap * Math.max(0, hs.length - 1);
  return pad.top + pad.bottom + inner;
}

const SAFE_AREA_OP = (p: DeviceProfile) => `U("document", { safeArea: { top: ${p.safeArea.top}, bottom: ${p.safeArea.bottom} } })`;

/** Where each edge's in-flow content starts: the root's rendered padding (+
 * its usable safeArea side), raised to the pinned chrome's reach — the
 * renderer's max(). */
function flowStart(ctx: MobileContext): { top: number; bottom: number } {
  const pad = paddingSides(ctx.root, ctx.width);
  const usable = ctx.root.type === 'document' ? usableSafeArea(ctx.root.safeArea) : {};
  const reach = chromeReservation(ctx.root);
  return {
    top: Math.max(pad.top + (usable.top ?? 0), reach.top),
    bottom: Math.max(pad.bottom + (usable.bottom ?? 0), reach.bottom),
  };
}

/** Fast mode: the root's reservation (structural walk on each side without a
 * usable safeArea), every positioned node fast mode can place, and the pinned
 * bars' two conditions. */
export function checkSafeAreaFast(ctx: MobileContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const insets = insetsFor(ctx);
  const start = flowStart(ctx);
  const rule = 'mobile-safe-area';

  for (const edge of ['top', 'bottom'] as const) {
    if (edge === 'top' ? insets.topReserved : insets.bottomReserved) continue;
    const inset = insets[edge];
    const hit = firstContent(ctx.root, start[edge], edge, ctx);
    if (hit && hit.offset < inset) {
      issues.push(issue('usability', rule, 'warning', hit.node,
        `"${hit.node.name ?? hit.node.id}" sits about ${Math.round(hit.offset)}px from the ${edge} of the screen — inside the ${inset}px ${edge === 'top' ? 'status-bar' : 'home-indicator'} inset.`,
        `Reserve the insets on the root: ${SAFE_AREA_OP(ctx.profile)} (the renderer adds them to the root's padding), or pin a ${edge === 'top' ? 'status-bar' : 'home-indicator'} (the renderer reserves its height). For a deliberate full-bleed screen, put a ${inset}px spacer frame at the ${edge} of your content frame (padding of 32px or more scales down on a phone).`));
    }
  }

  // Positioned content. fixed / sticky place in the artboard frame directly
  // (sticky at its stuck position); absolute through a chain of placed
  // ancestors with a numeric y up to the root. Anything else has a containing
  // block whose position fast mode doesn't know.
  let unplaceable = false;
  const placedY = new Map<SceneNode, number>();
  const holds = (n: SceneNode) => isContent(n, ctx) || holdsFlowContent(n, ctx);
  const visit = (n: SceneNode, parent: SceneNode | undefined): void => {
    if (n.type === 'sheet') return;
    if (parent && isPositioned(n) && !PINNED_CHROME.has(n.type)) {
      const position = effectivePosition(n);
      if (position === 'fixed' && fixedUnpinned(n, ctx)) {
        if (holds(n)) unplaceable = true;
      } else if (position === 'fixed' || position === 'sticky') {
        if (isNum(n.y) || !isNum(n.bottom)) {
          const y = isNum(n.y) ? n.y : 0;
          placedY.set(n, y);
          checkPlaced(n, y, isNum(n.height) ? ctx.height - (y + n.height) : undefined);
        } else {
          const h = isContent(n, ctx) ? leafHeight(n) : resolvedHeight(n, ctx);
          if (h !== undefined) placedY.set(n, ctx.height - n.bottom - h);
          checkPlaced(n, h !== undefined ? ctx.height - n.bottom - h : undefined, n.bottom);
        }
      } else {
        const base = parent === ctx.root ? 0 : placedY.get(parent);
        const y = base !== undefined && isNum(n.y) ? base + n.y : undefined;
        if (y === undefined) {
          if (holds(n)) unplaceable = true;
        } else {
          placedY.set(n, y);
          checkPlaced(n, y, isNum(n.height) ? ctx.height - (y + n.height) : undefined);
        }
      }
    }
    for (const c of n.children ?? []) visit(c, n);
  };

  /** `top` = its top in the artboard, `fromBottom` = its bottom edge's
   * distance from the artboard's bottom (each when known). */
  const checkPlaced = (n: SceneNode, top: number | undefined, fromBottom: number | undefined): void => {
    if (isContent(n, ctx)) {
      const h = leafHeight(n);
      const bottomGap = fromBottom ?? (top !== undefined ? ctx.height - (top + h) : undefined);
      const inTop = top !== undefined && top < insets.top;
      const inBottom = bottomGap !== undefined && bottomGap < insets.bottom;
      if (inTop || inBottom) {
        const edge = inTop ? 'top' : 'bottom';
        const where = top !== undefined ? `y ${Math.round(top)}${h ? `, ${Math.round(h)}px tall` : ''}` : `${Math.round(bottomGap as number)}px from the bottom`;
        issues.push(issue('usability', rule, 'warning', n,
          `Positioned "${n.name ?? n.id}" sits in the ${edge} ${edge === 'top' ? insets.top : insets.bottom}px inset (${where} on a ${ctx.height}px screen) — under the ${edge === 'top' ? 'status bar' : 'home indicator'}.`,
          edge === 'top' ? `Move it to y ≥ ${insets.top}.` : `Keep its bottom at least ${insets.bottom}px above the screen's bottom edge (bottom: ${insets.bottom} or more).`));
      }
      return;
    }
    if (!holdsFlowContent(n, ctx)) return;
    const pad = paddingSides(n, ctx.width);
    const topHit = top !== undefined ? firstContent(n, top + pad.top, 'top', ctx) : null;
    const bottomHit = fromBottom !== undefined ? firstContent(n, fromBottom + pad.bottom, 'bottom', ctx) : null;
    for (const [hit, edge, inset] of [[topHit, 'top', insets.top], [bottomHit, 'bottom', insets.bottom]] as const) {
      if (hit && hit.offset < inset) {
        issues.push(issue('usability', rule, 'warning', hit.node,
          `"${hit.node.name ?? hit.node.id}" inside positioned "${n.name ?? n.id}" sits about ${Math.round(hit.offset)}px from the ${edge} of the screen — inside the ${inset}px ${edge === 'top' ? 'status-bar' : 'home-indicator'} inset.`,
          `Pad "${n.name ?? n.id}" so its content clears ${inset}px from the ${edge} — a spacer frame of that height at its ${edge} is exact (padding of 32px or more scales down on a phone).`));
      }
    }
  };

  visit(ctx.root, undefined);

  // Pinned bars: the scroll's start and end must clear them, or a bar hides
  // the first or last content for good.
  let unresolved = false;
  (function bars(n: SceneNode) {
    if (n.type === 'sheet') return;
    if (n !== ctx.root && effectivePosition(n) === 'fixed' && !PINNED_CHROME.has(n.type) && !fixedUnpinned(n, ctx) && holds(n)) {
      const bottomBar = pinsBottom(n);
      const topBar = !bottomBar && pinsTop(n);
      if (bottomBar || topBar) {
        const h = isContent(n, ctx) ? leafHeight(n) : resolvedHeight(n, ctx);
        if (h === undefined) {
          unresolved = true;
        } else {
          const edge = bottomBar ? 'bottom' : 'top';
          const need = h + (bottomBar ? (isNum(n.bottom) ? n.bottom : 0) : (isNum(n.y) ? n.y : 0));
          const hit = firstContent(ctx.root, start[edge], edge, ctx);
          if (hit && hit.offset < need - 0.5) {
            const more = Math.ceil(need - hit.offset);
            issues.push(issue('usability', rule, 'warning', hit.node,
              `"${hit.node.name ?? hit.node.id}" ends up under pinned "${n.name ?? n.id}" at the ${edge === 'bottom' ? 'end' : 'start'} of the scroll — it clears ${Math.round(hit.offset)}px of the ${Math.round(need)}px the bar covers.`,
              `Add a ${more}px spacer frame at the ${edge === 'bottom' ? 'end' : 'start'} of the frame that holds your content (${edge === 'bottom' ? 'after' : 'before'} "${hit.node.name ?? hit.node.id}"); root padding of 32px or more renders scaled down on a phone.`));
          }
        }
      }
    }
    n.children?.forEach(bars);
  })(ctx.root);

  if (unplaceable || unresolved) {
    issues.push(issue('usability', rule, 'info', ctx.root,
      unplaceable && !unresolved
        ? 'Some positioned content sits where fast mode cannot place it against the safe areas (inside an in-flow frame, or a fixed element under a blurred or animated ancestor, which pins to that ancestor instead of the screen).'
        : 'Fast mode cannot work out the height of a pinned bar (it holds text or a frame with no fixed height), so it cannot check that the scroll clears it.',
      'Run canvas_evaluate with mode: "detailed" — it checks rendered positions.'));
  }
  return issues;
}

/** Detailed mode: the rendered rects. Content in the top inset at scroll 0,
 * positioned content in the artboard's bottom inset, in-flow content in the
 * last bottom-inset px of the document, sticky content at its stuck position,
 * and in-flow content under a pinned bar at the scroll's start or end. */
export function checkSafeAreaDetailed(ctx: MobileContext, layout: LayoutRect[]): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const insets = insetsFor(ctx);
  const rule = 'mobile-safe-area';
  const rects = new Map<string, LayoutRect>();
  (function flat(list: LayoutRect[]) { for (const r of list) { rects.set(r.nodeId, r); if (r.children) flat(r.children); } })(layout);
  let docBottom = ctx.height;
  for (const r of rects.values()) docBottom = Math.max(docBottom, r.y + r.height);
  // A root that scrolls inside itself (an authored overflow) reports its full
  // scroll height, which carries its end padding.
  const rootRect = rects.get(ctx.root.id);
  if (rootRect?.scrollHeight !== undefined) docBottom = Math.max(docBottom, rootRect.y + rootRect.scrollHeight);
  const reserved = insets.topReserved && insets.bottomReserved;
  const remedy = (stuck: boolean) => stuck
    ? 'Give the sticky element a y (or bottom) offset that clears the inset, or pad its content past it.'
    : reserved
      ? 'Keep positioned content inside the safe area; on a long screen, end the frame that holds the content with a spacer frame of the inset height.'
      : `Reserve the insets on the root: ${SAFE_AREA_OP(ctx.profile)}.`;
  const isContentNode = (n: SceneNode, r: LayoutRect | undefined) => n.type === 'image'
    ? r !== undefined && r.width < ctx.width - 1
    : n.type === 'text' ? textOf(n) !== undefined : CONTENT_TYPES.has(n.type);
  const flowContent: Array<{ node: SceneNode; rect: LayoutRect }> = [];
  const sticky: Array<{ node: SceneNode; rect: LayoutRect; content: Array<{ node: SceneNode; rect: LayoutRect }> }> = [];

  const visit = (n: SceneNode, positioned: boolean, stuck: typeof sticky[number] | undefined): void => {
    if (n.type === 'sheet') return;
    const r = rects.get(n.id);
    if (isContentNode(n, r)) {
      if (r && r.width > 0 && r.height > 0) {
        if (stuck) stuck.content.push({ node: n, rect: r });
        if (!positioned) flowContent.push({ node: n, rect: r });
        const bottom = r.y + r.height;
        let where: string | undefined;
        if (r.y < insets.top && bottom > 0) where = `the top ${insets.top}px inset (y ${r.y})`;
        else if (positioned && bottom > ctx.height - insets.bottom && r.y < ctx.height) where = `the bottom ${insets.bottom}px inset of the screen (bottom edge ${bottom} on a ${ctx.height}px screen)`;
        else if (!positioned && bottom > docBottom - insets.bottom) where = `the bottom ${insets.bottom}px inset at the end of the scroll (bottom edge ${bottom} of a ${docBottom}px document)`;
        if (where) {
          issues.push(issue('usability', rule, 'warning', n,
            `"${n.name ?? n.id}" renders in ${where} — under the ${where.startsWith('the top') ? 'status bar' : 'home indicator'}.`, remedy(false)));
        }
      }
      return; // a content node's own descendants are part of it
    }
    for (const c of n.children ?? []) {
      const position = effectivePosition(c);
      const cr = rects.get(c.id);
      const own = position === 'sticky' && cr ? { node: c, rect: cr, content: [] } : undefined;
      if (own) sticky.push(own);
      visit(c, positioned || position === 'absolute' || position === 'fixed', own ?? stuck);
    }
  };
  visit(ctx.root, false, undefined);

  // Sticky content where it sticks: its offset from the viewport edge.
  for (const s of sticky) {
    const toBottom = !isNum(s.node.y) && isNum(s.node.bottom);
    const shift = toBottom ? (ctx.height - (s.node.bottom as number)) - (s.rect.y + s.rect.height) : (isNum(s.node.y) ? s.node.y : 0) - s.rect.y;
    for (const c of s.content) {
      const top = c.rect.y + shift;
      const bottom = top + c.rect.height;
      if (toBottom ? bottom > ctx.height - insets.bottom : top < insets.top) {
        issues.push(issue('usability', rule, 'warning', c.node,
          `"${c.node.name ?? c.node.id}" sits in the ${toBottom ? `bottom ${insets.bottom}` : `top ${insets.top}`}px inset when sticky "${s.node.name ?? s.node.id}" sticks (${toBottom ? `bottom edge ${Math.round(bottom)}` : `y ${Math.round(top)}`}).`, remedy(true)));
      }
    }
  }

  // Pinned bars: in-flow content under one at the scroll's end (bottom bars,
  // moved to maximum scroll) or start (top bars).
  const overlaps = (a: LayoutRect, top: number, b: LayoutRect) =>
    a.y < top + b.height && a.y + a.height > top && a.x < b.x + b.width && a.x + a.width > b.x;
  const scroll = docBottom - ctx.height;
  (function bars(n: SceneNode) {
    if (n.type === 'sheet') return;
    const r = rects.get(n.id);
    if (r && n !== ctx.root && effectivePosition(n) === 'fixed' && n.type !== 'home-indicator' && n.type !== 'status-bar') {
      const bottomBar = pinsBottom(n);
      if (bottomBar || pinsTop(n)) {
        const top = bottomBar ? r.y + scroll : r.y;
        for (const c of flowContent) {
          if (overlaps(c.rect, top, r)) {
            issues.push(issue('usability', rule, 'warning', c.node,
              `"${c.node.name ?? c.node.id}" renders under pinned "${n.name ?? n.id}" at the ${bottomBar ? 'end' : 'start'} of the scroll.`,
              `Add a spacer frame at the ${bottomBar ? 'end' : 'start'} of the frame that holds your content, as tall as the bar plus its offset.`));
          }
        }
      }
    }
    n.children?.forEach(bars);
  })(ctx.root);
  return issues;
}

// ── mobile-type-floor ──────────────────────────────────────────────────────

/** `rawById` maps node id → unresolved node, so a `$body` reference is
 * visible after resolution substituted it. */
export function checkTypeFloor(ctx: MobileContext, rawById: Map<string, SceneNode>): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const { smallestText, bodyFloor } = ctx.profile;
  const rule = 'mobile-type-floor';
  (function walk(n: SceneNode) {
    const content = textOf(n);
    const size = content !== undefined ? fontPx(n.fontSize) : undefined;
    if (content !== undefined && size !== undefined) {
      const words = proseWords(content);
      const label = `"${content.length > 40 ? `${content.slice(0, 37)}…` : content}"`;
      if (size < smallestText) {
        issues.push(issue('typography', rule, 'warning', n, `${label} is ${size}px — below the ${smallestText}px smallest text on a phone.`, `Raise it to at least ${smallestText}px.`));
      } else if (rawById.get(n.id)?.fontSize === '$body' && size < bodyFloor) {
        issues.push(issue('typography', rule, 'warning', n, `${label} uses the body role at ${size}px — below the ${bodyFloor}px body floor on a phone.`, `Raise $body to at least ${bodyFloor}px (generate_design_system on a mobile canvas gives 17, or 16 for data-dense).`));
      } else if (size < PROSE_FLOOR && words >= PROSE_WORDS) {
        issues.push(issue('typography', rule, 'warning', n, `${label} sets ${words} words at ${size}px — prose below ${PROSE_FLOOR}px (iOS Footnote) is hard to read on a phone.`, `Set prose at ${PROSE_FLOOR}px or more; keep sub-${PROSE_FLOOR}px sizes for short labels.`));
      } else if (size < bodyFloor && words >= LONG_COPY_WORDS) {
        issues.push(issue('typography', rule, 'info', n, `${label} sets ${words} words at ${size}px — long copy below the ${bodyFloor}px body size.`, 'Long copy reads better at body size.'));
      }
    }
    n.children?.forEach(walk);
  })(ctx.root);
  return issues;
}

// ── mobile-one-column ──────────────────────────────────────────────────────

export function checkOneColumn(ctx: MobileContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const holdsProse = (n: SceneNode): boolean =>
    (textOf(n) !== undefined && proseWords(n.content as string) >= COLUMN_WORDS) || (n.children ?? []).some(holdsProse);
  (function walk(n: SceneNode) {
    if (n.type === 'frame' && (n.layout === 'horizontal' || n.layout === 'grid')
      && (n.children ?? []).filter(holdsProse).length >= 2) {
      issues.push(issue('usability', 'mobile-one-column', 'info', n,
        `"${n.name ?? n.id}" sets prose side by side — a phone screen reads as one column.`,
        'Stack these blocks vertically (layout: "vertical").'));
    }
    n.children?.forEach(walk);
  })(ctx.root);
  return issues;
}

// ── mobile-handbuilt-target ────────────────────────────────────────────────

/** Frames shaped like a tap target (one icon, or one icon plus a short label)
 * whose known box is below the touch floor. Info only: a frame cannot say it
 * is decorative, so gating it would leave no honest fix. */
export function checkHandbuiltTargets(ctx: MobileContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const floor = ctx.profile.touchTarget;
  const shape = (n: SceneNode): { icon: SceneNode } | null => {
    const icons: SceneNode[] = [];
    const texts: SceneNode[] = [];
    let other = false;
    // Stops as soon as the frame can no longer be tap-shaped.
    (function walk(x: SceneNode) {
      for (const c of x.children ?? []) {
        if (other || icons.length > 1 || texts.length > 1) return;
        if (c.type === 'icon') icons.push(c);
        else if (textOf(c) !== undefined) texts.push(c);
        else if (isContent(c, ctx)) other = true;
        walk(c);
      }
    })(n);
    if (other || icons.length !== 1 || texts.length > 1) return null;
    if (texts.length === 1 && proseWords(texts[0].content as string) > LABEL_WORDS) return null;
    return { icon: icons[0] };
  };
  const dim = (n: SceneNode, axis: 'width' | 'height', icon: SceneNode, iconOnly: boolean): number | undefined => {
    const v = n[axis];
    if (isNum(v)) return v;
    if (v !== undefined || !iconOnly) return undefined;
    const pad = paddingSides(n, ctx.width);
    return (isNum(icon.iconSize) ? icon.iconSize : 24) + (axis === 'width' ? pad.left + pad.right : pad.top + pad.bottom);
  };
  (function walk(n: SceneNode) {
    if (n.type === 'frame' && n !== ctx.root) {
      const s = shape(n);
      if (s) {
        const iconOnly = !(n.children ?? []).some(function hasText(c: SceneNode): boolean { return textOf(c) !== undefined || (c.children ?? []).some(hasText); });
        const w = dim(n, 'width', s.icon, iconOnly);
        const h = dim(n, 'height', s.icon, iconOnly);
        if ((w !== undefined && w < floor) || (h !== undefined && h < floor)) {
          issues.push(issue('usability', 'mobile-handbuilt-target', 'info', n,
            `"${n.name ?? n.id}" looks like a hand-built tap target (${w ?? '?'}×${h ?? '?'}px) — below the ${floor}px touch floor if it is tappable, and the touch-target rule can't check a frame.`,
            `If it is tappable, rebuild it as a \`button\` (size "md" is ${floor}px tall; an icon-only button is square), or as a \`list-row\` / \`tab-bar\` item when that is what it is. If it is decorative, ignore this.`));
        }
        return; // the outermost tap-shaped frame is the target
      }
    }
    n.children?.forEach(walk);
  })(ctx.root);
  return issues;
}

// ── mobile-tab-bar ─────────────────────────────────────────────────────────

/** A phone tab bar: 2–5 labeled tabs (the FAB is not a tab), pinned to the
 * bottom. One warning per broken condition per bar. */
export function checkTabBars(ctx: MobileContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const { min, max } = ctx.profile.tabCount;
  const rule = 'mobile-tab-bar';
  (function walk(n: SceneNode) {
    if (n.type === 'tab-bar') {
      const name = n.name ?? n.id;
      const items = Array.isArray(n.items) ? n.items : undefined;
      const count = items?.length ?? 0;
      if (count < min || count > max) {
        issues.push(issue('usability', rule, 'warning', n,
          `Tab bar "${name}" has ${count} tab${count === 1 ? '' : 's'} — a phone tab bar holds ${min}–${max} (3–5 recommended).`,
          count > max ? 'Move the extra destinations into a "More" tab or a screen of their own.' : 'Give it at least two destinations, or drop the tab bar.'));
      }
      const unlabeled = (items ?? []).flatMap((it, i) => (typeof it?.label === 'string' && it.label.trim() ? [] : [i + 1]));
      if (unlabeled.length) {
        issues.push(issue('usability', rule, 'warning', n,
          `Tab bar "${name}": tab${unlabeled.length === 1 ? '' : 's'} ${unlabeled.join(', ')} ${unlabeled.length === 1 ? 'has' : 'have'} no label — every tab needs one (an icon alone is a guess).`,
          'Give every item a short label (one word).'));
      }
      if (effectivePosition(n) !== 'fixed' || n.y !== undefined) {
        issues.push(issue('usability', rule, 'warning', n,
          `Tab bar "${name}" is not pinned to the bottom of the screen${n.y !== undefined ? ' (its y pins it to the top)' : ` (position "${effectivePosition(n)}")`} — in flow it falls below the fold on a long screen.`,
          'Remove its position, x and y overrides: a tab-bar pins to the bottom by default (position "fixed", bottom 0).'));
      }
    }
    n.children?.forEach(walk);
  })(ctx.root);
  return issues;
}

// ── mobile-artboard ────────────────────────────────────────────────────────

export function checkArtboard(ctx: MobileContext, surface: SurfaceDeclaration): EvaluationIssue[] {
  const { width, height, profile, root } = ctx;
  const rule = 'mobile-artboard';
  if (surface.type === 'mobile') {
    if (width >= PHONE_WIDTH) {
      return [issue('structure', rule, 'warning', root,
        `This canvas is declared mobile but its artboard is ${width}px wide — a phone screen is ${profile.width}px.`,
        `Resize it: U("document", { width: ${profile.width}, height: ${profile.height} }) — or canvas_set_type({ type: "web" }) if it is a web page.`)];
    }
    if (width !== profile.width || height !== profile.height) {
      return [issue('structure', rule, 'info', root,
        `The artboard is ${width}×${height}; the ${profile.id} device is ${profile.width}×${profile.height}.`,
        `U("document", { width: ${profile.width}, height: ${profile.height} }) matches the device.`)];
    }
    return [];
  }
  let chrome: SceneNode | undefined;
  (function walk(n: SceneNode) { if (!chrome && CHROME_TYPES.has(n.type)) chrome = n; n.children?.forEach(walk); })(root);
  if (width >= PHONE_WIDTH && !chrome) return [];
  const why = chrome ? `it contains mobile chrome ("${chrome.name ?? chrome.type}")` : `its artboard is ${width}px wide`;
  if (surface.source === 'default') {
    return [issue('structure', rule, 'warning', root,
      `This canvas looks like a phone screen (${why}) but never declared its type, so it is judged as a web page.`,
      'Declare it: canvas_set_type({ type: "mobile" }) for a phone app screen (then add the safe-area insets its hint names), or canvas_set_type({ type: "web" }) for a responsive web page designed at this width.')];
  }
  return [issue('structure', rule, 'info', root,
    `Declared web, but ${why}. A phone app screen should declare mobile so the mobile ruleset judges it.`,
    'canvas_set_type({ type: "mobile" }) if this is a phone app screen.')];
}
