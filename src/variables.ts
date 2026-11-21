import type { Canvas, DesignVariables, SceneNode, ShadowSpec, StateStyle } from './types.js';
import { COPY_PROPS, STATE_LAYERS, STATEFUL_TYPES } from './primitives.js';
import { composite, contrastRatio, parseAlpha } from './color-math.js';
import { tintFor } from './color-system.js';

export function resolveVariables(node: SceneNode, variables: DesignVariables, opts?: { theme?: 'light' | 'dark' }): SceneNode {
  return deepResolve(structuredClone(node), withDerivedColors(themeTokens(variables, opts?.theme)));
}

/** The tokens a theme renders with. Phase 25 slice D — dark is a sparse
 * override layer merged over colors and elevation. Theme is a pure
 * RENDER/EVALUATE parameter, never canvas state (versionHash and drift
 * baselines must not fork on it). */
export function themeTokens(variables: DesignVariables, theme?: 'light' | 'dark'): DesignVariables {
  return theme === 'dark' && (variables.dark?.colors || variables.dark?.elevation)
    ? {
        ...variables,
        colors: { ...variables.colors, ...variables.dark?.colors },
        elevation: { ...variables.elevation, ...variables.dark?.elevation },
      }
    : variables;
}

// Phase 32 slice C (FR-C5, contract M7) — the tint layer and `danger` derive
// when the design system does not define them, so a scaffold never needs a
// seed that a later preset cannot replace.
export const DERIVED_COLORS = ['accent-tint', 'success-tint', 'warning-tint', 'danger-tint', 'neutral-tint', 'danger'] as const;
const DERIVED_NAMES = new Set<string>(DERIVED_COLORS);

/** The colours a scaffold used to seed (structures.ts) before they derived.
 * A canvas-layer colour holding one counts as unset (FR-C6). */
export const RETIRED_SEEDS = new Map<string, string>([
  ['accent-tint', '#152A47'], ['success-tint', '#0F2E1B'], ['warning-tint', '#33260A'],
  ['danger-tint', '#3A1715'], ['neutral-tint', '#25282D'], ['danger', '#F87171'],
]);

export function isRetiredSeed(name: string, value: unknown): boolean {
  const seed = RETIRED_SEEDS.get(name);
  return seed !== undefined && typeof value === 'string' && value.trim().toLowerCase() === seed.toLowerCase();
}

/** A token layer without the retired seeds in its colours; a colour layer
 * that held nothing else is dropped, as if it had never been set. */
export function withoutRetiredSeeds<T extends DesignVariables | undefined>(v: T): T {
  const colors = v?.colors;
  if (!colors || !Object.entries(colors).some(([k, val]) => isRetiredSeed(k, val))) return v;
  const kept = Object.entries(colors).filter(([k, val]) => !isRetiredSeed(k, val));
  const { colors: _colors, ...rest } = v!;
  return (kept.length ? { ...rest, colors: Object.fromEntries(kept) } : rest) as T;
}

/** The tokens with every missing derived colour filled in. */
export function withDerivedColors(v: DesignVariables): DesignVariables {
  const c = v.colors ?? {};
  if (DERIVED_COLORS.every((name) => c[name] !== undefined)) return v;
  return { ...v, colors: { ...deriveColors(c), ...c } };
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];
const hexOf = (rgb: [number, number, number]) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

/** The surface names, in the order every default reads them. */
export const SURFACE_CHAIN = ['bg-surface', 'surface', 'bg-primary', 'background'] as const;

/** The surface tints sit on: the first of SURFACE_CHAIN that parses, else
 * white; a translucent one laid over the next opaque one in that chain. */
function tintSurface(c: Record<string, string>): [number, number, number] {
  const chain = SURFACE_CHAIN.map((n) => c[n]).filter((x): x is string => typeof x === 'string' && rgbOf(x) !== undefined);
  const opaque = (from: number): [number, number, number] => {
    const next = chain.slice(from).find((x) => parseAlpha(x) >= 1);
    return next ? rgbOf(next)! : WHITE;
  };
  if (!chain.length) return WHITE;
  const alpha = parseAlpha(chain[0]);
  return alpha >= 1 ? rgbOf(chain[0])! : composite(rgbOf(chain[0])!, alpha, opaque(1));
}

function deriveColors(c: Record<string, string>): Record<string, string> {
  const surface = tintSurface(c);
  const mode = contrastRatio(surface, WHITE) > contrastRatio(surface, BLACK) ? 'dark' : 'light';
  // An ink as opaque hex over the surface; its literal when it does not parse.
  const ink = (value: string | undefined, literal: string): string => {
    const rgb = value === undefined ? undefined : rgbOf(value);
    if (!rgb) return literal;
    const alpha = parseAlpha(value!);
    return hexOf(alpha < 1 ? composite(rgb, alpha, surface) : rgb);
  };
  const danger = c.danger ?? c.error ?? (mode === 'dark' ? '#F87171' : '#DC2626');
  const tint = (value: string | undefined, literal: string) => tintFor(ink(value, literal), mode, { grey: true });
  return {
    danger,
    'accent-tint': tint(c.accent ?? c.primary, '#2563EB'),
    'success-tint': tint(c.success, '#16A34A'),
    'warning-tint': tint(c.warning, '#D97706'),
    'danger-tint': tint(danger, mode === 'dark' ? '#F87171' : '#DC2626'),
    'neutral-tint': tint(c['text-secondary'], '#6B7280'),
  };
}

/** Where a token ref sits on a node: a top-level prop (`key`), optionally an
 * array entry (`at`) and/or a field of an object (`sub`). */
export interface RefSite { key: string; at?: number; sub?: string }

export function refPath(site: RefSite): string {
  return `${site.key}${site.at !== undefined ? `[${site.at}]` : ''}${site.sub ? `.${site.sub}` : ''}`;
}

/** Every `$ref` on a node the resolver resolves (contract M2), in the order
 * `deepResolve` visits them. */
export function tokenRefs(node: SceneNode): Array<RefSite & { ref: string }> {
  const out: Array<RefSite & { ref: string }> = [];
  const isRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith('$');
  const rec = node as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'id' || key === 'type' || key === 'children' || COPY_PROPS.has(key)) continue;
    if (isRef(value)) out.push({ key, ref: value });
  }
  for (const key of ['padding', 'cornerRadius']) {
    const arr = rec[key];
    if (Array.isArray(arr)) arr.forEach((v, at) => { if (isRef(v)) out.push({ key, at, ref: v }); });
  }
  for (const key of NESTED_TOKEN_PROPS) {
    const obj = rec[key] as Record<string, unknown> | undefined;
    if (obj && typeof obj === 'object' && isRef(obj.color)) out.push({ key, sub: 'color', ref: obj.color });
  }
  const each = (key: string, subs: string[]) => {
    const arr = rec[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((item, at) => {
      if (!item || typeof item !== 'object') return;
      for (const sub of subs) { const v = (item as Record<string, unknown>)[sub]; if (isRef(v)) out.push({ key, at, sub, ref: v }); }
    });
  };
  each('series', ['stroke']);
  each('actions', ['fill', 'color', 'stroke']);
  const action = rec.action as Record<string, unknown> | undefined;
  if (action && typeof action === 'object' && isRef(action.color)) out.push({ key: 'action', sub: 'color', ref: action.color });
  each('segments', ['color']);
  return out;
}

export type TokenKind = 'color' | 'number' | 'typography' | 'elevation' | 'motion' | 'object';

/** What a token name resolves to, in `lookupToken`'s order (contract M3);
 * undefined when it resolves to nothing. The derived colours always count. */
export function tokenKind(name: string, v: DesignVariables): TokenKind | undefined {
  const has = (cat: object | undefined) => !!cat && Object.hasOwn(cat, name) && (cat as Record<string, unknown>)[name] !== undefined;
  if (has(v.colors)) return 'color';
  if (has(v.spacing) || has(v.radius)) return 'number';
  if (has(v.typography)) return 'typography';
  const dot = name.indexOf('.');
  if (dot > 0) {
    const category = name.slice(0, dot);
    const cat = (v as Record<string, unknown>)[category];
    if (category === 'colors' && DERIVED_NAMES.has(name.slice(dot + 1))) return 'color';
    if (cat && typeof cat === 'object' && Object.hasOwn(cat, name.slice(dot + 1))) {
      if (category === 'colors') return 'color';
      if (category === 'spacing' || category === 'radius' || category === 'state') return 'number';
      if (category === 'elevation') return 'elevation';
      if (category === 'motion') return 'motion';
      return 'object';
    }
  }
  return DERIVED_NAMES.has(name) ? 'color' : undefined;
}

const NESTED_TOKEN_PROPS = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;

function deepResolve(node: SceneNode, variables: DesignVariables): SceneNode {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'type' || key === 'children' || COPY_PROPS.has(key)) continue;

    if (typeof value === 'string' && value.startsWith('$')) {
      const tokenName = value.slice(1);
      // Phase 25 slice A (FR-A1) — a typography token referenced from
      // fontSize applies its FULL spec (size + weight/family/lineHeight/
      // letterSpacing), not just the size. Explicit node props always win —
      // only gaps are filled. This retires the long-documented quirk where
      // declaring a type system only half-applied it.
      const typo = key === 'fontSize' ? variables.typography?.[tokenName] : undefined;
      if (typo) {
        node.fontSize = typo.fontSize;
        if (node.fontWeight === undefined && typo.fontWeight !== undefined) node.fontWeight = typo.fontWeight;
        if (node.fontFamily === undefined && typo.fontFamily !== undefined) node.fontFamily = typo.fontFamily;
        if (node.lineHeight === undefined && typo.lineHeight !== undefined) node.lineHeight = typo.lineHeight;
        if (node.letterSpacing === undefined && typo.letterSpacing !== undefined) node.letterSpacing = typo.letterSpacing;
        continue;
      }
      const resolved = lookupToken(tokenName, variables);
      if (resolved !== undefined) {
        // Phase 27 — an elevation ref on `shadow` resolves to the structured
        // shadows array (the renderer's plural path); explicit `shadows` wins.
        if (key === 'shadow' && Array.isArray(resolved)) {
          if (node.shadows === undefined) node.shadows = resolved as ShadowSpec[];
          delete node.shadow;
          continue;
        }
        (node as unknown as Record<string, unknown>)[key] = resolved;
      }
    }
  }

  // Phase 27 slice B — padding / cornerRadius arrays can mix numbers with
  // "$space-*" / "$radius-*" refs; resolve each entry.
  for (const key of ['padding', 'cornerRadius'] as const) {
    const arr = node[key];
    if (Array.isArray(arr)) {
      (node as unknown as Record<string, unknown>)[key] = arr.map((entry) => {
        if (typeof entry !== 'string' || !entry.startsWith('$')) return entry;
        const resolved = lookupToken(entry.slice(1), variables);
        return resolved !== undefined ? resolved : entry;
      });
    }
  }

  // Phase 22 slice A — object-valued props hold colors the top-level walk
  // above can't see. Resolve $refs one level in (extend this list when a new
  // structured prop carries tokens).
  for (const key of NESTED_TOKEN_PROPS) {
    const obj = node[key];
    if (obj && typeof obj === 'object' && typeof obj.color === 'string' && obj.color.startsWith('$')) {
      const resolved = lookupToken(obj.color.slice(1), variables);
      if (resolved !== undefined) obj.color = resolved as string;
    }
  }
  // Phase 22 slice F — chart series carry their own stroke colors.
  if (Array.isArray(node.series)) {
    for (const s of node.series) {
      if (s && typeof s.stroke === 'string' && s.stroke.startsWith('$')) {
        const resolved = lookupToken(s.stroke.slice(1), variables);
        if (resolved !== undefined) s.stroke = resolved as string;
      }
    }
  }
  // Phase 31 slice E — a modal's actions and a toast's action carry colours.
  const tokenIn = (obj: Record<string, unknown>, key: string) => {
    const value = obj[key];
    if (typeof value !== 'string' || !value.startsWith('$')) return;
    const resolved = lookupToken(value.slice(1), variables);
    if (resolved !== undefined) obj[key] = resolved;
  };
  if (Array.isArray(node.actions)) {
    for (const a of node.actions) if (a && typeof a === 'object') for (const k of ['fill', 'color', 'stroke']) tokenIn(a as unknown as Record<string, unknown>, k);
  }
  if (node.action && typeof node.action === 'object') tokenIn(node.action as unknown as Record<string, unknown>, 'color');
  // Phase 28 slice B — donut segments carry their own colors ($chart-* refs).
  if (Array.isArray(node.segments)) {
    for (const s of node.segments) {
      if (s && typeof s.color === 'string' && s.color.startsWith('$')) {
        const resolved = lookupToken(s.color.slice(1), variables);
        if (resolved !== undefined) s.color = resolved as string;
      }
    }
  }

  applyControlDefaults(node, variables);

  if (node.children) {
    node.children = node.children.map((child) => deepResolve(child, variables));
  }

  return node;
}

// Phase 16 — input primitives default their colors from the design system
// (the structures token vocabulary) AFTER explicit $refs resolve, so an
// unthemed canvas still renders (neutral fallbacks — same never-crash rule as
// structure scaffolds) and a themed one picks up the brand automatically.
// Explicit fill / stroke / color on the node always wins.
const CONTROL_FALLBACK = { accent: '#2563EB', border: '#D1D5DB', surface: '#FFFFFF', text: '#111827' } as const;

// Phase 31 slice G (spec P2, P3) — every node that draws an element state
// gets its ring colour and layer opacities resolved here, so the renderer
// never reads tokens. Items of tabs / tab-bar / nav-bar / modal / toast use
// their host's.
const STATE_HOSTS = new Set([...STATEFUL_TYPES, 'tabs', 'tab-bar', 'nav-bar', 'modal', 'toast']);

/** An opacity token: a number in [0, 1], else undefined. */
function unit(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 ? x : undefined;
}

/** Whether the design system sets either disabled opacity (spec P3). */
function hasDisabledTokens(v: DesignVariables): boolean {
  return unit(v.state?.disabledContent) !== undefined || unit(v.state?.disabledContainer) !== undefined;
}

/** The ring, the colours and the opacities a stateful node renders with. */
function resolveStateStyle(v: DesignVariables): StateStyle {
  const c = v.colors ?? {};
  const s = v.state ?? {};
  const out: StateStyle = {
    // FR-H1's chain: the renderer and the check never disagree.
    ring: c['focus-ring'] ?? c.accent ?? c.primary ?? CONTROL_FALLBACK.accent,
    onSurface: c['text-primary'] ?? CONTROL_FALLBACK.text,
    surface: SURFACE_CHAIN.map((n) => c[n]).find((x) => x !== undefined) ?? CONTROL_FALLBACK.surface,
    hover: unit(s.hover) ?? STATE_LAYERS.hover,
    focus: unit(s.focus) ?? STATE_LAYERS.focus,
    pressed: unit(s.pressed) ?? STATE_LAYERS.pressed,
  };
  if (hasDisabledTokens(v)) {
    out.disabledContent = unit(s.disabledContent) ?? STATE_LAYERS.disabledContent;
    out.disabledContainer = unit(s.disabledContainer) ?? STATE_LAYERS.disabledContainer;
  }
  return out;
}

/** A disabled node renders at today's 0.5 opacity (unless authored), except
 * where the renderer draws the token pair instead (P4): a type that takes
 * `state` on a canvas with disabled tokens. Truthiness matches the pre-slice
 * check, so `disabled: "true"` still dims (P5). */
function legacyDisabled(node: SceneNode, v: DesignVariables): void {
  const stateful = STATEFUL_TYPES.has(node.type);
  const disabled = !!node.disabled || (stateful && node.state === 'disabled');
  if (disabled && node.opacity === undefined && !(stateful && hasDisabledTokens(v))) node.opacity = 0.5;
}

function applyControlDefaults(node: SceneNode, v: DesignVariables): void {
  const t = node.type;
  if (STATE_HOSTS.has(t)) node.stateStyle = resolveStateStyle(v);
  if (t === 'skeleton') {
    // Phase 24 slice B — loading placeholder: a themed canvas picks up its
    // own border tone (or an explicit `skeleton` token); unthemed canvases
    // get a translucent neutral that reads on light AND dark surfaces.
    if (node.fill === undefined) node.fill = v.colors?.skeleton ?? v.colors?.border ?? 'rgba(127, 127, 127, 0.22)';
    return;
  }
  if (PRIMITIVES.has(t)) { applyPrimitiveDefaults(node, v); return; }
  if (t !== 'toggle' && t !== 'checkbox' && t !== 'radio' && t !== 'select') return;

  const accent = v.colors?.accent ?? v.colors?.primary ?? CONTROL_FALLBACK.accent;
  const border = v.colors?.border ?? CONTROL_FALLBACK.border;
  // Phase 31 FR-B8 — an unchecked box, ring or track is the control's only
  // boundary: it takes $border-strong (3:1) when the design system has it.
  // Without the token the render is unchanged.
  const boundary = v.colors?.['border-strong'] ?? border;

  legacyDisabled(node, v);

  if (t === 'toggle') {
    // fill = track color; the knob is always white.
    if (node.fill === undefined) node.fill = node.checked ? accent : boundary;
  } else if (t === 'checkbox') {
    // fill = box background (transparent when unchecked so dark surfaces work).
    if (node.fill === undefined) node.fill = node.checked ? accent : 'transparent';
    if (node.stroke === undefined) node.stroke = node.checked ? accent : boundary;
  } else if (t === 'radio') {
    // stroke = ring, fill = dot (drawn only when checked).
    if (node.stroke === undefined) node.stroke = node.checked ? accent : boundary;
    if (node.fill === undefined) node.fill = accent;
  } else {
    // select
    if (node.fill === undefined) node.fill = v.colors?.['bg-surface'] ?? v.colors?.surface ?? CONTROL_FALLBACK.surface;
    if (node.stroke === undefined) node.stroke = border;
    if (node.color === undefined) node.color = v.colors?.['text-primary'] ?? CONTROL_FALLBACK.text;
  }
}

// Phase 30 slice D — the mobile primitives default the same way: tokens when
// the canvas has them, neutral fallbacks when it doesn't, explicit props win.
// Phase 31 slice B — the desktop-app vocabulary joins them.
const PRIMITIVES = new Set([
  'status-bar', 'home-indicator', 'nav-bar', 'tab-bar', 'button', 'list-row', 'sheet',
  'link', 'text-input', 'nav-item', 'tabs', 'tree-row', 'menu-row', 'property-row', 'divider',
  'tooltip', 'popover', 'menu', 'modal', 'toast', 'drawer',
]);

function applyPrimitiveDefaults(node: SceneNode, v: DesignVariables): void {
  const c = v.colors ?? {};
  const accent = c.accent ?? c.primary ?? CONTROL_FALLBACK.accent;
  const border = c.border ?? CONTROL_FALLBACK.border;
  const surface = c['bg-surface'] ?? c.surface ?? CONTROL_FALLBACK.surface;
  const text = c['text-primary'] ?? CONTROL_FALLBACK.text;
  const secondary = c['text-secondary'] ?? '#6B7280';
  // Both derive when the design system has neither (withDerivedColors): the
  // tint from the accent, in the surface's mode.
  const danger = c.danger;
  const tint = c['accent-tint'];
  const set = <K extends keyof SceneNode>(key: K, value: SceneNode[K]) => { if (node[key] === undefined) node[key] = value; };
  legacyDisabled(node, v);

  switch (node.type) {
    // Phase 31 slice B — the desktop-app vocabulary.
    case 'link':
      set('color', accent);
      break;
    case 'text-input':
      set('fill', surface);
      // An error colours the boundary and the message below it.
      set('stroke', text_(node.error) ? danger : c['border-strong'] ?? border);
      set('color', text);
      set('secondaryColor', secondary);
      break;
    case 'nav-item':
    case 'tree-row':
      set('color', text);
      set('secondaryColor', secondary);
      set('iconColor', accent);
      if (node.active) set('fill', tint);
      break;
    case 'tabs':
      set('color', text);
      set('secondaryColor', secondary);
      set('iconColor', accent);
      set('stroke', border);
      // The contained variant's active tab sits on the tint.
      set('fill', tint);
      break;
    case 'menu-row':
      set('color', node.destructive ? danger : text);
      set('secondaryColor', secondary);
      set('iconColor', accent);
      break;
    case 'property-row':
      set('color', text);
      set('secondaryColor', secondary);
      break;
    case 'divider':
      set('stroke', border);
      break;
    // Phase 31 slice E — overlays: a surface panel at overlay depth.
    case 'tooltip':
      // Inverted, so it reads against whatever it floats over.
      set('fill', text);
      set('color', surface);
      if (node.cornerRadius === undefined) node.cornerRadius = 4;
      setOverlayShadow(node, v);
      break;
    case 'popover':
    case 'menu':
    case 'modal':
    case 'toast':
    case 'drawer': {
      set('fill', surface);
      set('stroke', border);
      set('color', text);
      set('secondaryColor', secondary);
      if (node.cornerRadius === undefined) {
        node.cornerRadius = node.type === 'modal' ? v.radius?.['radius-lg'] ?? 12 : node.type === 'drawer' ? 0 : v.radius?.['radius-md'] ?? 8;
      }
      setOverlayShadow(node, v);
      if (node.type === 'toast') {
        const tone = node.tone;
        set('iconColor', tone === 'success' ? c.success ?? '#16A34A' : tone === 'warning' ? c.warning ?? '#D97706' : tone === 'danger' ? danger : secondary);
        if (node.action && typeof node.action === 'object' && node.action.color === undefined) node.action.color = accent;
      }
      if (node.type === 'modal' && Array.isArray(node.actions)) {
        for (const a of node.actions) {
          if (!a || typeof a !== 'object') continue;
          const variant = a.variant ?? 'secondary';
          if (variant === 'primary' || variant === 'destructive') {
            if (a.fill === undefined) a.fill = variant === 'destructive' ? danger : accent;
            if (a.color === undefined) a.color = onFill(a.fill);
          } else {
            if (a.fill === undefined) a.fill = 'transparent';
            if (a.color === undefined) a.color = variant === 'ghost' ? accent : text;
            if (variant === 'secondary' && a.stroke === undefined) a.stroke = border;
          }
        }
      }
      break;
    }
    case 'status-bar':
    case 'home-indicator':
      set('color', text);
      break;
    case 'nav-bar':
      set('color', text);
      set('iconColor', accent);
      break;
    case 'tab-bar':
      set('fill', surface);
      set('stroke', border);
      set('iconColor', accent);
      set('color', secondary);
      set('badgeColor', danger);
      break;
    case 'list-row':
      set('color', text);
      set('secondaryColor', secondary);
      set('iconColor', accent);
      set('stroke', border);
      break;
    case 'sheet':
      set('fill', surface);
      set('stroke', border);
      if (node.cornerRadius === undefined) node.cornerRadius = v.radius?.['radius-lg'] ?? 12;
      break;
    case 'button': {
      const variant = node.variant;
      if (variant === 'secondary') {
        set('fill', 'transparent');
        set('stroke', border);
        set('color', text);
      } else if (variant === 'ghost') {
        set('fill', 'transparent');
        set('color', accent);
      } else {
        set('fill', variant === 'destructive' ? danger : accent);
        set('color', onFill(node.fill));
      }
      if (node.cornerRadius === undefined) node.cornerRadius = v.radius?.['radius-md'] ?? 8;
      break;
    }
  }
}

/** An overlay's depth: the design system's `$elevation.overlay` when it has
 * one; an explicit shadow or shadows win. (Without the token the renderer
 * draws its own fallback shadow.) */
function setOverlayShadow(node: SceneNode, v: DesignVariables): void {
  if (node.shadows !== undefined || node.shadow !== undefined) return;
  const overlay = v.elevation?.overlay;
  if (Array.isArray(overlay) && overlay.length) node.shadows = structuredClone(overlay);
}

/**
 * An opaque colour as [r, g, b]: #RGB, #RRGGBB(AA), rgb()/rgba() and hsl()/hsla(),
 * alpha ignored. Named colours return undefined. (evaluate.ts has its own
 * parseColor; it imports this module, so this one can't import it.)
 */
function rgbOf(color: string): [number, number, number] | undefined {
  const c = color.trim();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return [m[1], m[2], m[3]].map((d) => parseInt(d + d, 16)) as [number, number, number];
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(c);
  if (m) return [m[1], m[2], m[3]].map((d) => parseInt(d, 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)\s*(?:[,/][^)]*)?\)$/i.exec(c);
  if (m) return [m[1], m[2], m[3]].map((v) => Math.min(255, Math.round(+v))) as [number, number, number];
  m = /^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%\s*(?:[,/][^)]*)?\)$/i.exec(c);
  if (!m) return undefined;
  const h = (((+m[1] % 360) + 360) % 360) / 360;
  const sat = Math.min(1, +m[2] / 100);
  const l = Math.min(1, +m[3] / 100);
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number];
}

/** A prop as text, for "is it set?" checks. */
function text_(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** White or near-black (#111827), whichever contrasts more with a hex fill. */
function onFill(fill: string | undefined): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill ?? '');
  if (!m) return '#FFFFFF';
  const lum = (hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => {
      const ch = parseInt(hex.slice(i, i + 2), 16) / 255;
      return ch <= 0.03928 ? ch / 12.92 : ((ch + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l = lum(m[1]);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (lum('111827') + 0.05) ? '#FFFFFF' : '#111827';
}

export function lookupToken(name: string, variables: DesignVariables): unknown {
  // Check each category
  if (variables.colors?.[name] !== undefined) return variables.colors[name];
  if (variables.spacing?.[name] !== undefined) return variables.spacing[name];
  if (variables.radius?.[name] !== undefined) return variables.radius[name];
  if (variables.typography?.[name] !== undefined) {
    // For typography, return the fontSize as a simple value
    return variables.typography[name].fontSize;
  }

  // Support dotted paths: colors.primary
  const dotIdx = name.indexOf('.');
  if (dotIdx > 0) {
    const category = name.substring(0, dotIdx) as keyof DesignVariables;
    const key = name.substring(dotIdx + 1);
    const cat = variables[category];
    if (cat && typeof cat === 'object' && key in cat) {
      return (cat as Record<string, unknown>)[key];
    }
  }

  return undefined;
}

export function setVariables(canvas: Canvas, vars: Partial<DesignVariables>): DesignVariables {
  if (vars.colors) canvas.variables.colors = { ...canvas.variables.colors, ...vars.colors };
  if (vars.spacing) canvas.variables.spacing = { ...canvas.variables.spacing, ...vars.spacing };
  if (vars.radius) canvas.variables.radius = { ...canvas.variables.radius, ...vars.radius };
  if (vars.typography) canvas.variables.typography = { ...canvas.variables.typography, ...vars.typography };
  if (vars.dark?.colors || vars.dark?.elevation) {
    canvas.variables.dark = {
      ...(canvas.variables.dark?.colors || vars.dark?.colors ? { colors: { ...canvas.variables.dark?.colors, ...vars.dark?.colors } } : {}),
      ...(canvas.variables.dark?.elevation || vars.dark?.elevation ? { elevation: { ...canvas.variables.dark?.elevation, ...vars.dark?.elevation } } : {}),
    };
  }
  if (vars.motion) canvas.variables.motion = { ...canvas.variables.motion, ...vars.motion };
  if (vars.elevation) canvas.variables.elevation = { ...canvas.variables.elevation, ...vars.elevation };
  if (vars.state) canvas.variables.state = { ...canvas.variables.state, ...vars.state };
  return canvas.variables;
}

export function getVariables(canvas: Canvas): DesignVariables {
  return canvas.variables;
}

export interface PresetApplyResult {
  variables: DesignVariables;
  /** Tokens left to inheritance instead of being overwritten by the preset.
   * `filledFromPreset` names the sub-fields the preset contributed to a
   * partially-specified token (Phase 29 FR-B1) — when present, the canvas got a
   * MERGED value rather than pure inheritance. */
  preserved: Array<{ category: string; key: string; kept: string; preset: string; filledFromPreset?: string[] }>;
}

export interface PresetApplyOptions {
  /** Phase 29 FR-B3 — write every preset token, ignoring inheritance. A caller
   * asking for a whole new design language usually means it. */
  preserveInherited?: boolean;
}

/** Apply a preset's tokens to a canvas WITHOUT silently clobbering tokens the
 * canvas only resolves through inheritance (workspace / project design system).
 *
 * A preset writes to the canvas layer, which wins over inheritance — so a key
 * the canvas doesn't set itself but inherits would silently diverge from the
 * design system (e.g. preset `md: 16` shadowing a workspace `md: 12`). Those are
 * preserved (left to inheritance) and reported. Keys that are new everywhere, or
 * already set on the canvas's own layer, are written normally. */
export function applyPresetTokens(
  canvas: Canvas,
  presetVars: Partial<DesignVariables>,
  inherited: DesignVariables,
  options: PresetApplyOptions = {},
): PresetApplyResult {
  const preserved: PresetApplyResult['preserved'] = [];
  const cats = ['colors', 'spacing', 'radius', 'typography'] as const;
  for (const cat of cats) {
    const pv = presetVars[cat];
    if (!pv) continue;
    if (!canvas.variables[cat]) (canvas.variables as Record<string, unknown>)[cat] = {};
    const own = canvas.variables[cat] as Record<string, unknown>;
    const inh = (inherited[cat] ?? {}) as Record<string, unknown>;
    for (const [key, val] of Object.entries(pv)) {
      // A retired scaffold seed is not the canvas's own choice (FR-C6).
      const hasOwn = own[key] !== undefined && !(cat === 'colors' && isRetiredSeed(key, own[key]));
      const inhVal = inh[key];
      if (options.preserveInherited === false || hasOwn || inhVal === undefined || tokenEquals(inhVal, val)) {
        own[key] = val;
        continue;
      }

      // Phase 29 FR-B1 — a token is not all-or-nothing. An inherited typography
      // token that carries only a size ({ fontSize: 13 }) used to shadow the
      // preset's whole spec, so the role kept the inherited size AND silently
      // lost the personality's fontFamily/weight/tracking — it still resolved,
      // so nothing errored, and the text rendered in the fallback stack. Merge
      // field-wise instead: inherited fields win, the preset fills the gaps.
      const merged = mergeTokenFields(inhVal, val);
      if (merged) {
        own[key] = merged.value;
        preserved.push({ category: cat, key, kept: fmtToken(cat, inhVal), preset: fmtToken(cat, val), filledFromPreset: merged.filled });
        continue;
      }

      preserved.push({ category: cat, key, kept: fmtToken(cat, inhVal), preset: fmtToken(cat, val) });
    }
  }
  return { variables: canvas.variables, preserved };
}

/** Field-wise merge of a partially-specified inherited token over a fully
 * specified preset one. Inherited fields win (the design system set them on
 * purpose); the preset contributes only what inheritance left undefined.
 * Returns null when there is nothing to contribute — the inherited token is
 * complete, or either side isn't a plain object — so the caller falls back to
 * plain preservation. */
function mergeTokenFields(inhVal: unknown, presetVal: unknown): { value: Record<string, unknown>; filled: string[] } | null {
  if (!isPlainRecord(inhVal) || !isPlainRecord(presetVal)) return null;
  const filled = Object.keys(presetVal).filter((f) => inhVal[f] === undefined);
  if (filled.length === 0) return null;
  return { value: { ...presetVal, ...inhVal }, filled };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tokenEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function fmtToken(cat: string, val: unknown): string {
  if (cat === 'typography' && val && typeof val === 'object' && 'fontSize' in (val as object)) {
    const fs = (val as { fontSize: number | string }).fontSize;
    return typeof fs === 'number' ? `${fs}px` : String(fs);
  }
  return String(val);
}

/** Phase 9 — merge three layers of design tokens with rightmost winning:
 * canvas.variables overrides project.designSystem overrides workspace.designSystem.
 * Per category, keys are merged (not replaced wholesale), so a canvas can
 * override a single color without losing the workspace's full color palette. */
export function mergeDesignTokens(...layers: Array<DesignVariables | undefined>): DesignVariables {
  const out: DesignVariables = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.colors) out.colors = { ...(out.colors ?? {}), ...layer.colors };
    if (layer.spacing) out.spacing = { ...(out.spacing ?? {}), ...layer.spacing };
    if (layer.radius) out.radius = { ...(out.radius ?? {}), ...layer.radius };
    if (layer.typography) out.typography = { ...(out.typography ?? {}), ...layer.typography };
    if (layer.dark?.colors || layer.dark?.elevation) {
      out.dark = {
        ...(out.dark?.colors || layer.dark?.colors ? { colors: { ...(out.dark?.colors ?? {}), ...layer.dark?.colors } } : {}),
        ...(out.dark?.elevation || layer.dark?.elevation ? { elevation: { ...(out.dark?.elevation ?? {}), ...layer.dark?.elevation } } : {}),
      };
    }
    if (layer.motion) out.motion = { ...(out.motion ?? {}), ...layer.motion };
    if (layer.elevation) out.elevation = { ...(out.elevation ?? {}), ...layer.elevation };
    if (layer.state) out.state = { ...(out.state ?? {}), ...layer.state };
  }
  return out;
}
