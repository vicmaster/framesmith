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

/** Fixed-vocabulary mobile chrome primitives (slice D adds the node types). */
const CHROME_TYPES = new Set(['status-bar', 'home-indicator', 'nav-bar', 'tab-bar', 'sheet']);
const CONTENT_TYPES = new Set(['icon', 'toggle', 'checkbox', 'radio', 'select', 'button', 'list-row', 'instance']);
const POSITIONED = new Set(['absolute']);

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

const isPositioned = (n: SceneNode): boolean => n.position !== undefined && POSITIONED.has(n.position);

/** Content per the spec's Terms: text, icons, controls, the tappable
 * primitives, instances (opaque — they may hold content), and images narrower
 * than the artboard. Everything else is background. */
function isContent(n: SceneNode, ancestors: SceneNode[], ctx: MobileContext): boolean {
  if (n.type === 'text') return textOf(n) !== undefined;
  if (CONTENT_TYPES.has(n.type)) return true;
  if (n.type !== 'image') return false;
  if (isNum(n.width)) return n.width < ctx.width;
  // A non-numeric width spans the artboard only if nothing above it insets it.
  return ancestors.some((a) => { const p = paddingSides(a, ctx.width); return p.left + p.right > 0; });
}

/** Whether any in-flow content sits beneath `n` (positioned subtrees are
 * placed on their own). */
function holdsFlowContent(n: SceneNode, ancestors: SceneNode[], ctx: MobileContext): boolean {
  const next = [...ancestors, n];
  return (n.children ?? []).some((c) => !isPositioned(c) && (isContent(c, next, ctx) || holdsFlowContent(c, next, ctx)));
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
function firstContent(container: SceneNode, offset: number, edge: 'top' | 'bottom', ancestors: SceneNode[], ctx: MobileContext): Hit | null {
  const next = [...ancestors, container];
  const children = (container.children ?? []).filter((c) => !isPositioned(c));
  const ordered = edge === 'top' ? children : [...children].reverse();
  const visit = (child: SceneNode, at: number): Hit | null => {
    if (isContent(child, next, ctx)) return { node: child, offset: at };
    if (!holdsFlowContent(child, next, ctx)) return null;
    const pad = paddingSides(child, ctx.width);
    return firstContent(child, at + (edge === 'top' ? pad.top : pad.bottom), edge, next, ctx);
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
    // A spacer: background, or a frame with nothing in flow beneath it.
    const pad = paddingSides(child, ctx.width);
    at += Math.max(isNum(child.height) ? child.height : 0, isNum(child.minHeight) ? child.minHeight : 0, pad.top + pad.bottom) + gap;
  }
  return null;
}

function textHeight(n: SceneNode): number {
  if (isNum(n.height)) return n.height;
  const size = fontPx(n.fontSize) ?? 16;
  const lh = isNum(n.lineHeight) ? (n.lineHeight <= 3 ? n.lineHeight * size : n.lineHeight) : 1.2 * size;
  return lh;
}

const SAFE_AREA_OP = (p: DeviceProfile) => `U("document", { safeArea: { top: ${p.safeArea.top}, bottom: ${p.safeArea.bottom} } })`;

/** Fast mode: the root's reservation (structural walk on each side without a
 * usable safeArea) plus every positioned node fast mode can place. */
export function checkSafeAreaFast(ctx: MobileContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const insets = insetsFor(ctx);
  const rootPad = paddingSides(ctx.root, ctx.width);
  const rule = 'mobile-safe-area';

  for (const edge of ['top', 'bottom'] as const) {
    if (edge === 'top' ? insets.topReserved : insets.bottomReserved) continue;
    const inset = insets[edge];
    const hit = firstContent(ctx.root, edge === 'top' ? rootPad.top : rootPad.bottom, edge, [], ctx);
    if (hit && hit.offset < inset) {
      issues.push(issue('usability', rule, 'warning', hit.node,
        `"${hit.node.name ?? hit.node.id}" sits about ${Math.round(hit.offset)}px from the ${edge} of the screen — inside the ${inset}px ${edge === 'top' ? 'status-bar' : 'home-indicator'} inset.`,
        `Reserve the insets on the root: ${SAFE_AREA_OP(ctx.profile)} (the renderer adds them to the root's padding). For a deliberate full-bleed screen, pad the ${edge} so content clears ${inset}px — padding of 32px or more scales down on a phone, so use a spacer frame of that height.`));
    }
  }

  // Positioned content, placed through a chain of absolute ancestors with a
  // numeric y up to the root. Anything else has an in-flow containing block
  // whose position fast mode doesn't know.
  let unplaceable = false;
  const visit = (n: SceneNode, ancestors: SceneNode[], placedY: Map<SceneNode, number>): void => {
    if (isPositioned(n)) {
      const parent = ancestors[ancestors.length - 1];
      const base = parent === ctx.root ? 0 : placedY.get(parent);
      const y = base !== undefined && isNum(n.y) ? base + n.y : undefined;
      if (y === undefined) {
        if (isContent(n, ancestors, ctx) || holdsFlowContent(n, ancestors, ctx)) unplaceable = true;
      } else {
        placedY.set(n, y);
        checkPlaced(n, y, ancestors);
      }
    }
    for (const c of n.children ?? []) visit(c, [...ancestors, n], placedY);
  };

  const checkPlaced = (n: SceneNode, y: number, ancestors: SceneNode[]): void => {
    const bottomEdge = ctx.height - insets.bottom;
    if (isContent(n, ancestors, ctx)) {
      const h = n.type === 'text' ? textHeight(n) : isNum(n.height) ? n.height : 0;
      if (y < insets.top || y + h > bottomEdge) {
        const edge = y < insets.top ? 'top' : 'bottom';
        issues.push(issue('usability', rule, 'warning', n,
          `Positioned "${n.name ?? n.id}" sits in the ${edge} ${edge === 'top' ? insets.top : insets.bottom}px inset (y ${Math.round(y)}${h ? `, ${Math.round(h)}px tall` : ''} on a ${ctx.height}px screen) — under the ${edge === 'top' ? 'status bar' : 'home indicator'}.`,
          `Move it to y ≥ ${insets.top}${edge === 'bottom' ? ` and keep its bottom above ${bottomEdge}` : ''}.`));
      }
      return;
    }
    if (!holdsFlowContent(n, ancestors, ctx)) return;
    const pad = paddingSides(n, ctx.width);
    const top = firstContent(n, y + pad.top, 'top', ancestors, ctx);
    const bottom = isNum(n.height) ? firstContent(n, ctx.height - (y + n.height) + pad.bottom, 'bottom', ancestors, ctx) : null;
    for (const [hit, edge, inset] of [[top, 'top', insets.top], [bottom, 'bottom', insets.bottom]] as const) {
      if (hit && hit.offset < inset) {
        issues.push(issue('usability', rule, 'warning', hit.node,
          `"${hit.node.name ?? hit.node.id}" inside positioned "${n.name ?? n.id}" sits about ${Math.round(hit.offset)}px from the ${edge} of the screen — inside the ${inset}px ${edge === 'top' ? 'status-bar' : 'home-indicator'} inset.`,
          `Pad "${n.name ?? n.id}" so its content clears ${inset}px from the ${edge} (a spacer frame keeps its size; padding of 32px or more scales down on a phone).`));
      }
    }
  };

  visit(ctx.root, [], new Map());
  if (unplaceable) {
    issues.push(issue('usability', rule, 'info', ctx.root,
      'Some positioned content sits inside an in-flow frame, so fast mode cannot place it against the safe areas.',
      'Run canvas_evaluate with mode: "detailed" — it checks rendered positions.'));
  }
  return issues;
}

/** Detailed mode: the rendered rects. Content in the top inset at scroll 0,
 * positioned content in the artboard's bottom inset, and in-flow content in
 * the last bottom-inset px of the document (a fixed-height root does not
 * carry its end padding past overflowing content). */
export function checkSafeAreaDetailed(ctx: MobileContext, layout: LayoutRect[]): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const insets = insetsFor(ctx);
  const rects = new Map<string, LayoutRect>();
  (function flat(list: LayoutRect[]) { for (const r of list) { rects.set(r.nodeId, r); if (r.children) flat(r.children); } })(layout);
  let docBottom = ctx.height;
  for (const r of rects.values()) docBottom = Math.max(docBottom, r.y + r.height);

  const visit = (n: SceneNode, positioned: boolean): void => {
    const r = rects.get(n.id);
    const content = n.type === 'image'
      ? r !== undefined && r.width < ctx.width - 1
      : n.type === 'text' ? textOf(n) !== undefined : CONTENT_TYPES.has(n.type);
    if (content) {
      if (r && r.width > 0 && r.height > 0) {
        const bottom = r.y + r.height;
        let where: string | undefined;
        if (r.y < insets.top && bottom > 0) where = `the top ${insets.top}px inset (y ${r.y})`;
        else if (positioned && bottom > ctx.height - insets.bottom && r.y < ctx.height) where = `the bottom ${insets.bottom}px inset of the screen (bottom edge ${bottom} on a ${ctx.height}px screen)`;
        else if (!positioned && bottom > docBottom - insets.bottom) where = `the bottom ${insets.bottom}px inset at the end of the scroll (bottom edge ${bottom} of a ${docBottom}px document)`;
        if (where) {
          issues.push(issue('usability', 'mobile-safe-area', 'warning', n,
            `"${n.name ?? n.id}" renders in ${where} — under the ${where.startsWith('the top') ? 'status bar' : 'home indicator'}.`,
            insets.topReserved && insets.bottomReserved
              ? 'Keep positioned content inside the safe area, and end long screens with bottom padding or a spacer of the inset height.'
              : `Reserve the insets on the root: ${SAFE_AREA_OP(ctx.profile)}.`));
        }
      }
      return; // a content node's own descendants are part of it
    }
    for (const c of n.children ?? []) visit(c, positioned || isPositioned(c));
  };
  visit(ctx.root, false);
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
    (function walk(x: SceneNode, ancestors: SceneNode[]) {
      for (const c of x.children ?? []) {
        if (c.type === 'icon') icons.push(c);
        else if (textOf(c) !== undefined) texts.push(c);
        else if (isContent(c, [...ancestors, x], ctx)) other = true;
        walk(c, [...ancestors, x]);
      }
    })(n, []);
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
            `If it is tappable, make it at least ${floor}×${floor}px. If it is decorative, ignore this.`));
        }
        return; // the outermost tap-shaped frame is the target
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
