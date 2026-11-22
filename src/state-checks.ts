// Phase 31 slice H (FR-H1 to FR-H4, spec R1 to R7) — the element states,
// checked without being drawn. The model computes, from the resolved tree with
// instances expanded, the colours the renderer draws for a target's focus
// ring, active indicator, disabled content and boundary (slice G P4, S9, S10,
// Q6); the four rules judge them, and test/browser/test-state-model-render.ts holds the
// model to the pixels of a real render so the two cannot drift apart.

import type { EvaluationIssue } from './evaluate.js';
import type { SceneNode, StateStyle } from './types.js';
import { backdropBehind, composite, paintsNothing, parseAlpha, parseColor, readable, rgbToHex, roundedRatio, type Backdrop, type Rgb } from './color-math.js';
import { OVERLAY_TYPES, STATE_LAYERS, STATEFUL_TYPES, isDisabled, modalActions, navActions, tabItems, tabsItems } from './primitives.js';

/** The renderer's fallbacks (renderer.ts FALLBACK), for props the resolver
 * never set (a tree checked without resolution). */
const FALLBACK = { accent: '#2563EB', text: '#111827', secondary: '#6B7280', border: '#D1D5DB', surface: '#FFFFFF', danger: '#DC2626' } as const;
/** A contained tab's active fill without a token (renderTabs). */
const TINT_FALLBACK = '#EFF4FF';
/** WCAG 1.4.11: a focus indicator, a state indicator, a boundary. */
const NON_TEXT_MIN = 3;
/** FR-H3's house threshold: disabled within this ratio of rest looks the same. */
const SAME_LOOK_MAX = 1.1;

export const STATE_RULES = {
  focus: 'desktop-app-focus-visible',
  active: 'desktop-app-state-contrast',
  disabled: 'desktop-app-disabled',
  boundary: 'desktop-app-boundary',
} as const;

// ── the model ────────────────────────────────────────────────────────────

/** One pointer target that draws states: a P2 node, or an item of a tabs,
 * tab-bar, nav-bar, modal or toast (reported by its host), or the modal's
 * close button. */
export interface StateTarget {
  /** The node a finding names: the target, or the host of an item. */
  node: SceneNode;
  what: string;
  /** `button`, `tab`, `tab-bar item`, `nav-bar action`, `modal action`,
   * `modal close`, `toast action`, or the node type. */
  kind: string;
  disabled: boolean;
  /** The ring is drawn inside the target (a tab, a tab-bar item; S9, Q3). */
  inset: boolean;
  /** P4's ink: the colour a hover / focus / pressed layer is made of. */
  ink: string;
  /** The target's own rest fill (what an inset ring covers, what content
   * sits on); undefined when it paints none. */
  fill?: string;
  /** The target's own opacity (a node's authored `opacity`); items have none. */
  opacity?: number;
  style?: StateStyle;
  /** What is behind the target. */
  backdrop: Backdrop;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const label = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? `"${v.trim()}"` : fallback);
const ownOpacity = (n: SceneNode): number | undefined => (isNum(n.opacity) && n.opacity >= 0 && n.opacity <= 1 ? n.opacity : undefined);

/** A 0–1 opacity as the render writes it: a percentage at two decimals (Q6). */
export const layerAlpha = (x: number): number => Math.round(x * 10000) / 100 / 100;

/** `color` painted over an opaque `base`, its own alpha times `alpha`
 * (`color-mix` with transparent multiplies them). A colour that paints
 * nothing leaves the base; callers check `readable` first, since a colour
 * that does not parse still paints. */
export function paint(color: string | undefined, base: Rgb, alpha = 1): Rgb {
  const rgb = color && !paintsNothing(color) ? parseColor(color) : null;
  return rgb ? composite(rgb, alpha * parseAlpha(color!), base) : base;
}

/** A pixel of an element drawn as a group at `opacity` over its backdrop. */
const group = (pixel: Rgb, opacity: number | undefined, backdrop: Rgb): Rgb =>
  (opacity === undefined ? pixel : composite(pixel, opacity, backdrop));

/** An overlay's painted fill (the renderer's fallbacks): the backdrop walk
 * stops there, since the overlay is lifted to the root (R1). */
function overlayFill(n: SceneNode): string | undefined {
  if (!OVERLAY_TYPES.has(n.type)) return undefined;
  return n.fill ?? (n.type === 'tooltip' ? FALLBACK.text : FALLBACK.surface);
}

function parentsOf(root: SceneNode): Map<SceneNode, SceneNode | null> {
  const out = new Map<SceneNode, SceneNode | null>([[root, null]]);
  (function walk(n: SceneNode) { for (const c of n.children ?? []) { out.set(c, n); walk(c); } })(root);
  return out;
}

function* chainFrom(n: SceneNode | null, parentOf: Map<SceneNode, SceneNode | null>): Generator<SceneNode> {
  for (let c = n; c; c = parentOf.get(c) ?? null) yield c;
}

/** The backdrop behind `n`'s box: its ancestors, from the parent up. */
function behind(n: SceneNode, parentOf: Map<SceneNode, SceneNode | null>): Backdrop {
  return backdropBehind(chainFrom(parentOf.get(n) ?? null, parentOf), { stop: overlayFill });
}

/** The backdrop an item of `host` sits on: the host's own painted fill
 * first (`hostFill`), then the host's ancestors. */
function behindItem(host: SceneNode, hostFill: string | undefined, parentOf: Map<SceneNode, SceneNode | null>): Backdrop {
  return backdropBehind(chainFrom(host, parentOf), {
    stop: (n) => (n === host && OVERLAY_TYPES.has(n.type) ? hostFill : overlayFill(n)),
    fillOf: (n) => (n === host ? hostFill : n.fill),
  });
}

/** A button's fill and label colour as renderButton draws them. */
function buttonColors(n: { fill?: string; color?: string; variant?: string }): { fill: string; ink: string } {
  const fill = n.fill ?? (n.variant === 'secondary' || n.variant === 'ghost' ? 'transparent' : n.variant === 'destructive' ? FALLBACK.danger : FALLBACK.accent);
  return { fill, ink: n.color ?? (fill === 'transparent' ? FALLBACK.accent : '#FFFFFF') };
}

/** A P2 node's ink and own fill, as its renderer draws them (P4). */
function nodeInkFill(n: SceneNode): { ink: string; fill?: string } {
  switch (n.type) {
    case 'button': return buttonColors(n);
    case 'link': return { ink: n.color ?? FALLBACK.accent };
    case 'text-input': return { ink: n.color ?? FALLBACK.text, fill: n.fill ?? FALLBACK.surface };
    case 'menu-row': return { ink: n.color ?? (n.destructive ? FALLBACK.danger : FALLBACK.text), fill: n.fill };
    case 'toggle': return { ink: '#FFFFFF', fill: n.fill };
    case 'checkbox': return { ink: n.checked ? '#FFFFFF' : n.stroke ?? '', fill: n.fill };
    case 'radio': return { ink: n.stroke ?? '' };
    case 'select': return { ink: n.color ?? '', fill: n.fill };
    // nav-item, tree-row, list-row
    default: return { ink: n.color ?? FALLBACK.text, fill: n.fill };
  }
}

/** Every target in the tree, with what the model needs to draw it. */
export function stateTargets(root: SceneNode): StateTarget[] {
  const parentOf = parentsOf(root);
  const out: StateTarget[] = [];
  (function walk(n: SceneNode) {
    const style = n.stateStyle;
    if (STATEFUL_TYPES.has(n.type)) {
      out.push({ node: n, what: n.type, kind: n.type, disabled: isDisabled(n), inset: false, ...nodeInkFill(n), opacity: ownOpacity(n), style, backdrop: behind(n, parentOf) });
    } else if (n.type === 'tabs') {
      const contained = n.variant === 'contained';
      const backdrop = behind(n, parentOf);
      tabsItems(n).forEach((it, i) => {
        const active = it.active === true;
        out.push({
          node: n, what: `tab ${label(it.label, String(i + 1))}`, kind: 'tab', disabled: isDisabled(n) || isDisabled(it), inset: true,
          ink: active ? n.color ?? FALLBACK.text : n.secondaryColor ?? FALLBACK.secondary,
          fill: contained && active ? n.fill ?? TINT_FALLBACK : undefined, style, backdrop,
        });
      });
    } else if (n.type === 'tab-bar') {
      const backdrop = behindItem(n, n.fill ?? FALLBACK.surface, parentOf);
      tabItems(n).forEach((it, i) => {
        out.push({
          node: n, what: `tab-bar item ${label(it.label, String(i + 1))}`, kind: 'tab-bar item', disabled: isDisabled(it), inset: true,
          ink: it.active ? n.iconColor ?? FALLBACK.accent : n.color ?? FALLBACK.secondary, style, backdrop,
        });
      });
    } else if (n.type === 'nav-bar') {
      const backdrop = behindItem(n, n.fill, parentOf);
      for (const a of navActions(n)) {
        out.push({ node: n, what: `nav-bar action ${label(a.label ?? a.icon, 'back')}`, kind: 'nav-bar action', disabled: isDisabled(a), inset: false, ink: n.iconColor ?? FALLBACK.accent, style, backdrop });
      }
    } else if (n.type === 'modal') {
      const backdrop = behindItem(n, n.fill ?? FALLBACK.surface, parentOf);
      out.push({ node: n, what: 'modal close button', kind: 'modal close', disabled: false, inset: false, ink: n.secondaryColor ?? FALLBACK.secondary, fill: 'transparent', style, backdrop });
      for (const a of modalActions(n)) {
        const variant = a.variant ?? 'secondary';
        const filled = variant === 'primary' || variant === 'destructive';
        // As renderModal's actionButton builds them.
        const fill = a.fill ?? (filled ? (variant === 'destructive' ? FALLBACK.danger : FALLBACK.accent) : 'transparent');
        const ink = a.color ?? (filled ? '#FFFFFF' : variant === 'ghost' ? FALLBACK.accent : n.color ?? FALLBACK.text);
        out.push({ node: n, what: `modal action ${label(a.label, '')}`, kind: 'modal action', disabled: isDisabled(a), inset: false, ink, fill, style, backdrop });
      }
    } else if (n.type === 'toast' && n.action && typeof n.action === 'object' && typeof n.action.label === 'string' && n.action.label.trim()) {
      out.push({
        node: n, what: `toast action ${label(n.action.label, '')}`, kind: 'toast action', disabled: isDisabled(n.action), inset: false,
        ink: n.action.color ?? FALLBACK.accent, fill: 'transparent', style, backdrop: behindItem(n, n.fill ?? FALLBACK.surface, parentOf),
      });
    }
    n.children?.forEach(walk);
  })(root);
  return out;
}

/** R3 — what a focus ring draws and the pixels it covers unfocused. */
export interface FocusPair { target: StateTarget; ring: string; ringPx?: Rgb; reference?: Rgb }

export function focusPairs(targets: StateTarget[]): FocusPair[] {
  return targets.filter((t) => !t.disabled).map((t) => {
    const ring = t.style?.ring ?? FALLBACK.accent;
    // An inset ring covers the item's own fill, which must be readable too.
    if (t.backdrop.kind !== 'color' || paintsNothing(ring) || !parseColor(ring) || (t.inset && !readable(t.fill))) return { target: t, ring };
    // Outset: the ring sits in the gap past the box, over the backdrop.
    // Inset: over the item's own rest fill (S9, Q3). Either way the reference
    // is what those pixels show when the target is not focused.
    const reference = t.inset ? paint(t.fill, t.backdrop.rgb) : t.backdrop.rgb;
    const ringPx = group(paint(ring, reference), t.inset ? undefined : t.opacity, reference);
    return { target: t, ring, ringPx, reference };
  });
}

/** R4 — an active primitive's indicator and the fill beside it. */
export interface IndicatorPair {
  node: SceneNode;
  what: string;
  indicator: string;
  rest: { indicator: Rgb; fill: Rgb };
  /** Absent when the ink does not parse (its layer cannot be modelled). */
  hover?: { indicator: Rgb; fill: Rgb };
}

export function indicatorPairs(root: SceneNode): IndicatorPair[] {
  const parentOf = parentsOf(root);
  const out: IndicatorPair[] = [];
  const pair = (node: SceneNode, what: string, indicator: string, fill: string | undefined, ink: string, opacity: number | undefined, backdrop: Backdrop) => {
    if (backdrop.kind !== 'color' || paintsNothing(indicator) || !parseColor(indicator) || !readable(fill)) return;
    const bd = backdrop.rgb;
    const hover = layerAlpha(node.stateStyle?.hover ?? STATE_LAYERS.hover);
    const rest = paint(fill, bd);
    const at = (under: Rgb) => ({ indicator: group(paint(indicator, under), opacity, bd), fill: group(under, opacity, bd) });
    out.push({ node, what, indicator, rest: at(rest), ...(readable(ink) ? { hover: at(paint(ink, rest, hover)) } : {}) });
  };
  (function walk(n: SceneNode) {
    if ((n.type === 'nav-item' || n.type === 'tree-row') && n.active && !isDisabled(n)) {
      pair(n, `${n.type} ${label(n.label, n.id)}`, n.iconColor ?? FALLBACK.accent, n.fill, n.color ?? FALLBACK.text, ownOpacity(n), behind(n, parentOf));
    } else if (n.type === 'tabs' && n.variant !== 'contained' && !isDisabled(n)) {
      const backdrop = behind(n, parentOf);
      tabsItems(n).forEach((it, i) => {
        if (it.active === true && !isDisabled(it)) pair(n, `tab ${label(it.label, String(i + 1))}`, n.iconColor ?? FALLBACK.accent, undefined, n.color ?? FALLBACK.text, undefined, backdrop);
      });
    }
    n.children?.forEach(walk);
  })(root);
  return out;
}

/** R5 — the content a target draws at rest and would draw disabled. */
export interface DisabledPair { target: StateTarget; rest: Rgb; disabled: Rgb }

const WHOLE = new Set(['toggle', 'checkbox', 'radio']);

export function disabledPairs(targets: StateTarget[]): DisabledPair[] {
  const out: DisabledPair[] = [];
  for (const t of targets) {
    const s = t.style;
    if (s?.disabledContent === undefined || s.disabledContainer === undefined) continue;
    if (t.opacity !== undefined || t.kind === 'modal close' || t.backdrop.kind !== 'color') continue;
    const bd = t.backdrop.rgb;
    const n = t.node;
    // A control is its own content: the track, the box or the ring.
    const content = WHOLE.has(t.kind) ? (t.kind === 'toggle' || (t.kind === 'checkbox' && n.checked) ? n.fill : n.stroke) : t.ink;
    if (paintsNothing(content) || !parseColor(content!) || !readable(t.fill) || !readable(s.onSurface)) continue;
    const rest = WHOLE.has(t.kind) ? paint(content, bd) : paint(content, paint(t.fill, bd));
    out.push({ target: t, rest, disabled: paint(s.onSurface, bd, s.disabledContent) });
  }
  return out;
}

/** R7 — a boundary that is a control's only cue, and what is outside it. */
export interface BoundaryPair {
  node: SceneNode;
  color: string;
  boundary: Rgb;
  /** The control's own fill as drawn, when it paints one. */
  field?: Rgb;
  backdrop: Rgb;
}

export function boundaryPairs(root: SceneNode): BoundaryPair[] {
  const parentOf = parentsOf(root);
  const out: BoundaryPair[] = [];
  (function walk(n: SceneNode) {
    const field = n.type === 'text-input' || n.type === 'select';
    const measured = !isDisabled(n) && (field || ((n.type === 'checkbox' || n.type === 'toggle' || n.type === 'radio') && !n.checked));
    if (measured) {
      // An unset text-input stroke draws its fallback; the controls' unset
      // boundary is invalid CSS, which draws nothing.
      const color = n.type === 'text-input' ? n.stroke ?? (typeof n.error === 'string' && n.error.trim() ? FALLBACK.danger : FALLBACK.border) : n.type === 'toggle' ? n.fill : n.stroke;
      const backdrop = behind(n, parentOf);
      // The field's own fill (a radio draws none; a toggle's fill is its track).
      // A select's unset fill draws nothing, like its unset stroke.
      const fill = n.type === 'text-input' ? n.fill ?? FALLBACK.surface : n.type === 'checkbox' || n.type === 'select' ? n.fill : undefined;
      // A boundary that draws nothing (unset, an unresolved $token,
      // transparent, none) is measured as what shows there: an invisible
      // outline is the worst boundary, not one to skip.
      if ((paintsNothing(color) || parseColor(color as string)) && backdrop.kind === 'color' && readable(fill)) {
        const bd = backdrop.rgb;
        const under = paint(fill, bd);
        out.push({
          node: n, color: typeof color === 'string' && color ? color : 'none',
          // A border is painted over the control's own fill (R7).
          boundary: group(paint(color as string, under), ownOpacity(n), bd),
          // WCAG 1.4.11 asks the border for 3:1 only when nothing else shows
          // the field: a fill that clears the backdrop does.
          ...(fill !== undefined && !paintsNothing(fill) ? { field: group(under, ownOpacity(n), bd) } : {}),
          backdrop: bd,
        });
      }
    }
    n.children?.forEach(walk);
  })(root);
  return out;
}

// ── the rules ────────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const darkTag = (theme?: 'dark') => (theme === 'dark' ? { theme: 'dark' as const } : {});
const inTheme = (theme?: 'dark') => (theme === 'dark' ? ' in the dark theme' : '');

function grouped(base: Omit<EvaluationIssue, 'nodeId' | 'nodeName'>, nodes: SceneNode[], count: number): EvaluationIssue {
  const ids = [...new Set(nodes.map((n) => n.id))];
  return { ...base, nodeId: ids[0], nodeName: nodes[0].name, nodeIds: ids, count };
}

/** FR-H1 (R3) — `desktop-app-focus-visible`. */
export function checkFocusVisible(targets: StateTarget[], theme?: 'dark'): EvaluationIssue[] {
  const groups = new Map<string, FocusPair[]>();
  const skipped: StateTarget[] = [];
  for (const p of focusPairs(targets)) {
    if (!p.ringPx || !p.reference) { skipped.push(p.target); continue; }
    if (roundedRatio(p.ringPx, p.reference) >= NON_TEXT_MIN) continue;
    const key = `${rgbToHex(p.ringPx)}|${rgbToHex(p.reference)}`;
    const members = groups.get(key);
    if (members) members.push(p);
    else groups.set(key, [p]);
  }
  const issues: EvaluationIssue[] = [];
  for (const members of groups.values()) {
    const { ringPx, reference } = members[0];
    // Members share the drawn ring; name the authored one when they agree.
    const authored = new Set(members.map((m) => m.ring));
    const ring = authored.size === 1 ? members[0].ring : rgbToHex(ringPx!);
    const ratio = roundedRatio(ringPx!, reference!);
    const whats = [...new Set(members.map((m) => m.target.what))];
    issues.push(grouped({
      category: 'color', rule: STATE_RULES.focus, severity: 'error', ...darkTag(theme),
      message: `Focus ring ${ring} measures ${ratio.toFixed(2)}:1 against ${rgbToHex(reference!)}${inTheme(theme)} on ${plural(members.length, 'target')} (${whats.slice(0, 4).join(', ')}${whats.length > 4 ? ', …' : ''}). WCAG 1.4.11 needs 3:1 for a focus indicator, so keyboard users cannot see where they are.`,
      suggestion: theme === 'dark'
        ? `Fix it in the dark token layer: a dark.colors "focus-ring" that clears 3:1 against ${rgbToHex(reference!)} (generate_design_system picks one against every bg-* and *-tint).`
        : `Set a $focus-ring that clears 3:1 against ${rgbToHex(reference!)}: set_variables({ colors: { "focus-ring": … } }) — generate_design_system picks one against every bg-* and *-tint.`,
    }, members.map((m) => m.target.node), members.length));
  }
  if (skipped.length) {
    issues.push(grouped({
      category: 'color', rule: STATE_RULES.focus, severity: 'info', ...darkTag(theme),
      message: `The focus ring of ${plural(skipped.length, 'target')} could not be measured${inTheme(theme)}: the backdrop (or a tab's own fill) is a gradient or a fill the checker cannot read, or the ring colour does not parse.`,
      suggestion: 'Check these focus rings by eye in a focus state screenshot (state: "focus").',
    }, skipped.map((t) => t.node), skipped.length));
  }
  return issues;
}

/** FR-H2 (R4) — `desktop-app-state-contrast`. */
export function checkStateContrast(root: SceneNode, theme?: 'dark'): EvaluationIssue[] {
  return indicatorPairs(root).flatMap((p) => {
    const rest = roundedRatio(p.rest.indicator, p.rest.fill);
    const hover = p.hover ? roundedRatio(p.hover.indicator, p.hover.fill) : undefined;
    const failing = [rest < NON_TEXT_MIN ? `${rest.toFixed(2)}:1 at rest` : '', hover !== undefined && hover < NON_TEXT_MIN ? `${hover.toFixed(2)}:1 in hover` : ''].filter(Boolean);
    if (!failing.length) return [];
    return [{
      category: 'color', rule: STATE_RULES.active, severity: 'warning' as const, nodeId: p.node.id, nodeName: p.node.name, ...darkTag(theme),
      message: `The active ${p.what}'s indicator ${p.indicator} measures ${failing.join(' and ')} against its active fill${inTheme(theme)}. WCAG 1.4.11 needs 3:1, and hover must not hide the selection.`,
      suggestion: theme === 'dark'
        ? 'Fix it in the dark token layer: a dark $accent (the indicator) or $accent-tint (the active fill) a step further apart.'
        : 'Move $accent (the indicator) and $accent-tint (the active fill) further apart, or set iconColor / fill on the node.',
    }];
  });
}

/** FR-H3 (R5) — `desktop-app-disabled`. */
export function checkDisabledLook(targets: StateTarget[], theme?: 'dark'): EvaluationIssue[] {
  const same = disabledPairs(targets).map((p) => ({ ...p, ratio: roundedRatio(p.rest, p.disabled) })).filter((p) => p.ratio <= SAME_LOOK_MAX);
  if (!same.length) return [];
  const closest = Math.min(...same.map((p) => p.ratio));
  const s = same[0].target.style!;
  return [grouped({
    category: 'color', rule: STATE_RULES.disabled, severity: 'info', ...darkTag(theme),
    message: `With state.disabledContent ${s.disabledContent} (disabledContainer ${s.disabledContainer}), ${plural(same.length, 'target')} would draw disabled content within ${SAME_LOOK_MAX}:1 of their enabled content${inTheme(theme)} (closest ${closest.toFixed(2)}:1): disabled would look enabled.`,
    suggestion: 'Lower state.disabledContent with set_variables (Material uses 0.38), so a disabled control reads as unavailable.',
  }, same.map((p) => p.target.node), same.length)];
}

/** FR-H4 (R7) — `desktop-app-boundary`. */
export function checkBoundaries(root: SceneNode, theme?: 'dark'): EvaluationIssue[] {
  return boundaryPairs(root).flatMap((p) => {
    const ratio = roundedRatio(p.boundary, p.backdrop);
    if (ratio >= NON_TEXT_MIN) return [];
    if (p.field && roundedRatio(p.field, p.backdrop) >= NON_TEXT_MIN) return [];
    const field = p.node.type === 'text-input' || p.node.type === 'select';
    const part = p.node.type === 'toggle' ? 'track' : field ? 'border' : 'outline';
    return [{
      category: 'color', rule: STATE_RULES.boundary, severity: 'warning' as const, nodeId: p.node.id, nodeName: p.node.name, ...darkTag(theme),
      message: `This ${p.node.type}'s ${part} ${p.color} measures ${ratio.toFixed(2)}:1 against ${rgbToHex(p.backdrop)}${inTheme(theme)}: nothing else shows the control's edge${field || p.node.type === 'checkbox' ? ' (its fill does not stand out either)' : ''}, and WCAG 1.4.11 needs 3:1.`,
      suggestion: theme === 'dark'
        ? 'Fix it in the dark token layer: a dark $border-strong that clears 3:1 against the surface behind the control.'
        : 'Use $border-strong for the boundary, or set a stronger stroke. A canvas without the token needs it defined first: set_variables({ colors: { "border-strong": … } }), or generate_design_system, which writes one at 3:1 against bg-primary and bg-surface.',
    }];
  });
}

/** The four checks on one theme's tree, each when its rule is on. */
export function checkStates(root: SceneNode, ruleOn: (id: string) => boolean, theme?: 'dark'): EvaluationIssue[] {
  const targets = stateTargets(root);
  return [
    ...(ruleOn(STATE_RULES.focus) ? checkFocusVisible(targets, theme) : []),
    ...(ruleOn(STATE_RULES.active) ? checkStateContrast(root, theme) : []),
    ...(ruleOn(STATE_RULES.disabled) ? checkDisabledLook(targets, theme) : []),
    ...(ruleOn(STATE_RULES.boundary) ? checkBoundaries(root, theme) : []),
  ];
}
