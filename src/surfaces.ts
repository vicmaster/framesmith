// Phase 30 slice B — the canvas TYPE axis (what medium a screen is on) and the
// ruleset table every axis contributes to. A canvas carries three independent
// declarations — type, genre, preset — and each value adds one ruleset; the
// active rules are their union. Adding a type or a genre is one table row.

import type { Canvas } from './types.js';
import type { ClicheTell } from './evaluate.js';

// Phase 31: `desktop-app` is a tool you work in (persistent chrome, panes,
// dense controls, a current selection), in a browser tab or a native window.
// `web` is a page you read and scroll.
export type SurfaceType = 'web' | 'mobile' | 'desktop-app';
export const SURFACE_TYPES: readonly SurfaceType[] = ['web', 'mobile', 'desktop-app'];

/** One device a `mobile` canvas can target. CSS px (1pt = 1px). Apple's HIG
 * confirms the 44pt target and the 17/11 type sizes; the insets come from
 * consistent secondary sources; the bar, row and margin values are house
 * values (see the Phase 30 spec's device profile table). */
export interface DeviceProfile {
  id: string;
  width: number;
  height: number;
  safeArea: { top: number; bottom: number };
  touchTarget: number;
  navBarHeight: number;
  navBarLargeHeight: number;
  tabBarHeight: number;
  tabCount: { min: number; max: number };
  bodySize: number;
  /** The smallest body size the mobile ruleset accepts (the data-dense pivot). */
  bodyFloor: number;
  smallestText: number;
  listRowHeight: number;
  listRowSubtitleHeight: number;
  sideMargin: number;
  homeIndicator: { width: number; height: number };
}

export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  'iphone-390': {
    id: 'iphone-390',
    width: 390,
    height: 844,
    safeArea: { top: 47, bottom: 34 },
    touchTarget: 44,
    navBarHeight: 44,
    navBarLargeHeight: 96,
    tabBarHeight: 49,
    tabCount: { min: 2, max: 5 },
    bodySize: 17,
    bodyFloor: 16,
    smallestText: 11,
    listRowHeight: 44,
    listRowSubtitleHeight: 56,
    sideMargin: 16,
    homeIndicator: { width: 134, height: 5 },
  },
};

export const DEFAULT_DEVICE = 'iphone-390';

/** Phase 31: one window a `desktop-app` canvas targets. CSS px. The research
 * sources and confidence per value are in the Phase 31 spec's window profile
 * table; the smallest-text, prose-floor and data-dense body values are house
 * values. */
export interface WindowProfile {
  id: string;
  width: number;
  height: number;
  /** The WCAG 2.5.8 floor; smaller targets pass only by the spacing exception. */
  targetFloor: number;
  /** Control and row heights a desktop app stacks on (Carbon, Primer). */
  densityLadder: readonly number[];
  bodySize: number;
  /** The `data-dense` personality's body. */
  bodyDense: number;
  smallestText: number;
  /** Text of five or more words below this warns. */
  proseFloor: number;
  /** The narrowest window the desktop-app layouts are built for. */
  minWidth: number;
  /** Detail-view breakpoint widths. */
  breakpoints: readonly number[];
}

export const WINDOW_PROFILES: Record<string, WindowProfile> = {
  'window-1440': {
    id: 'window-1440',
    width: 1440,
    height: 900,
    targetFloor: 24,
    densityLadder: [24, 32, 40, 48, 64],
    bodySize: 14,
    bodyDense: 13,
    smallestText: 11,
    proseFloor: 12,
    minWidth: 1024,
    breakpoints: [1024, 1280, 1440],
  },
};

export const DEFAULT_WINDOW = 'window-1440';

export function isSurfaceType(value: unknown): value is SurfaceType {
  return typeof value === 'string' && (SURFACE_TYPES as readonly string[]).includes(value);
}

export function deviceProfile(id: string): DeviceProfile | undefined {
  return Object.hasOwn(DEVICE_PROFILES, id) ? DEVICE_PROFILES[id] : undefined;
}

export function windowProfile(id: string): WindowProfile | undefined {
  return Object.hasOwn(WINDOW_PROFILES, id) ? WINDOW_PROFILES[id] : undefined;
}

/** The profile table each type draws its `device` from; web has none. */
const PROFILE_TABLES: Partial<Record<SurfaceType, { table: Record<string, unknown>; fallback: string }>> = {
  mobile: { table: DEVICE_PROFILES, fallback: DEFAULT_DEVICE },
  'desktop-app': { table: WINDOW_PROFILES, fallback: DEFAULT_WINDOW },
};

export interface SurfaceDeclaration {
  type: SurfaceType;
  device: string | null;
  source: 'declared' | 'default';
}

/** The canvas's type. Absent (or unreadable) means `web`, source `default` —
 * a canvas nobody declared. A mobile or desktop-app canvas whose stored device
 * is missing, or is not in that type's profile table, targets the type's
 * default profile. */
export function resolveSurface(canvas: Canvas): SurfaceDeclaration {
  const stored = canvas.metadata?.surface;
  if (!stored || !isSurfaceType(stored.type)) return { type: 'web', device: null, source: 'default' };
  const profiles = PROFILE_TABLES[stored.type];
  if (!profiles) return { type: stored.type, device: null, source: 'declared' };
  const known = typeof stored.device === 'string' && Object.hasOwn(profiles.table, stored.device);
  return { type: stored.type, device: known ? stored.device! : profiles.fallback, source: 'declared' };
}

/** The root safeArea sides the renderer honours: each side only when it is a
 * finite non-negative number. One reader for the renderer and for
 * canvas_set_type's hint, so the hint never calls an ignored value reserved. */
export function usableSafeArea(value: unknown): { top?: number; bottom?: number } {
  if (!value || typeof value !== 'object') return {};
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const { top, bottom } = value as Record<string, unknown>;
  return { ...(valid(top) ? { top } : {}), ...(valid(bottom) ? { bottom } : {}) };
}

/** Validate a type + device pair for canvas_create / canvas_set_type. Returns
 * the metadata to store, or an error message. */
export function surfaceFor(type: SurfaceType, device?: string): { surface: { type: SurfaceType; device?: string } } | { error: string } {
  const profiles = PROFILE_TABLES[type];
  if (!profiles) {
    if (device !== undefined) return { error: `device does not apply to type "${type}" (got "${device}").` };
    return { surface: { type } };
  }
  const id = device ?? profiles.fallback;
  if (!Object.hasOwn(profiles.table, id)) {
    return { error: `Unknown ${type} device "${id}". Known for "${type}": ${Object.keys(profiles.table).join(', ')}.` };
  }
  return { surface: { type, device: id } };
}

// --- Rulesets ---

/** What one axis value contributes: cliché tells it relaxes, rule ids it turns
 * on, rule ids it turns off. An opt-in rule runs only when some active ruleset
 * enables it; a default rule runs unless one disables it. */
export interface Ruleset {
  relax?: ClicheTell[];
  enable?: string[];
  disable?: string[];
}

export type RulesetAxis = 'base' | 'type' | 'genre' | 'preset';

/** The mobile ruleset's rule ids (Phase 30 slices C and D), each registered
 * in the same change as the check that honours it. */
export const MOBILE_RULES = [
  'mobile-touch-target',
  'mobile-handbuilt-target',
  'mobile-safe-area',
  'mobile-type-floor',
  'mobile-one-column',
  'mobile-tab-bar',
] as const;

/** Phase 31: the desktop-app ruleset's rule ids, each registered in the same
 * change as the check that honours it. `desktop-app-artboard` lives in the
 * base row (it must run on every type), so it is not listed here. */
export const DESKTOP_APP_RULES: readonly string[] = [];

/** Phase 31: default rules — they run unless an active ruleset disables them.
 * A rule id appears here when some type replaces the check. */
export const DEFAULT_RULES = ['type-scale-ratio'] as const;

/** Keyed by axis, then value. Genre rows are canonical names only; aliases
 * fold through GENRE_ALIASES first. A rule id lands here in the same change as
 * the check that honours it. */
export const RULESETS: Record<RulesetAxis, Record<string, Ruleset>> = {
  // mobile-artboard and desktop-app-artboard are on for every type: their job
  // is to catch canvases whose declaration does not match their artboard.
  base: { all: { enable: ['mobile-artboard', 'desktop-app-artboard'] } },
  // The mobile disable list stays empty until a web-shaped rule is shown to
  // misfire on a correct mobile idiom (FR-C7).
  // desktop-app replaces the adjacent-ratio check (dense apps step 12/13/14
  // on purpose); its own type ladder lands with the app rules.
  type: { web: {}, mobile: { enable: [...MOBILE_RULES] }, 'desktop-app': { enable: [...DESKTOP_APP_RULES], disable: ['type-scale-ratio'] } },
  genre: {
    // Material Design legitimately uses a purple accent AND white elevated
    // surfaces (cards on an off-white background), so both are intentional
    // here. Also a preset row; kept as a genre because agents are told to
    // declare editors and admin forms as "material".
    material: { relax: ['accent-hue', 'pure-black-white'] },
    // Phase 22 slice C (#135) — screens whose figures are the user's own data
    // (dashboards, activity, finance, fitness, logistics): realistic figures
    // ARE the design (they drive column widths, wrapping, $2.7M-vs-$2,700,000
    // legibility), so "fabricated data" flags would zero the category for the
    // screen's whole reason to exist. `data` names what the numbers are, not
    // a layout; `dashboard` is the alias.
    data: { relax: ['honest-content'] },
    // Phase 29 slice A (#194) — transactional commerce screens: a checkout's
    // line prices, subtotal, store credit and total ARE the design. Scope is
    // the TRANSACTION — cart, checkout, order confirmation, billing history.
    // NOT a pricing or marketing page: invented customer counts, savings
    // claims and testimonials are exactly the slop this tell exists to catch.
    // `checkout` is the alias.
    commerce: { relax: ['honest-content'] },
  },
  // Applying the material STYLE relaxes material's tells whatever the genre.
  preset: { material: { relax: ['accent-hue', 'pure-black-white'] } },
};

/** Genres that are aliases of a canonical row — folded before every lookup so
 * an alias never reads as a second option. */
export const GENRE_ALIASES = new Map<string, string>([['dashboard', 'data'], ['checkout', 'commerce']]);

export function canonicalGenre(genre: string): string {
  return GENRE_ALIASES.get(genre) ?? genre;
}

// Own-key lookups only: a stored genre is free text, and "constructor" must
// read as an unknown genre, not Object.prototype.constructor.
function row(axis: RulesetAxis, key: string | undefined): Ruleset | undefined {
  const table = RULESETS[axis];
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

export function relaxedByGenre(genre: string): ClicheTell[] {
  return row('genre', canonicalGenre(genre))?.relax ?? [];
}

export function relaxedByPreset(preset: string | undefined): ClicheTell[] {
  return row('preset', preset)?.relax ?? [];
}

/** Every genre that relaxes something, each canonical name followed by its
 * aliases (material, data, dashboard, commerce, checkout). */
export function knownGenres(): string[] {
  return Object.keys(RULESETS.genre).flatMap((g) => [
    g,
    ...[...GENRE_ALIASES].filter(([, canonical]) => canonical === g).map(([alias]) => alias),
  ]);
}

/** The canonical genre rows, for reports that offer genres as options. */
export function genreRulesets(): Array<[string, Ruleset]> {
  return Object.entries(RULESETS.genre);
}

export function activeRulesets(decl: { type: SurfaceType; genre?: string; preset?: string }): Ruleset[] {
  return [
    row('base', 'all'),
    row('type', decl.type),
    decl.genre === undefined ? undefined : row('genre', canonicalGenre(decl.genre)),
    row('preset', decl.preset),
  ].filter((r): r is Ruleset => r !== undefined);
}

export interface ComposedRules {
  relaxed: ClicheTell[];
  on: string[];
  off: string[];
  conflicts: string[];
}

/** Union across rulesets. A rule both enabled and disabled is ON and reported
 * as a conflict, so a guardrail never disappears through composition. */
export function composeRulesets(rulesets: Ruleset[]): ComposedRules {
  const relaxed = new Set<ClicheTell>();
  const enabled = new Set<string>();
  const disabled = new Set<string>();
  for (const r of rulesets) {
    r.relax?.forEach((t) => relaxed.add(t));
    r.enable?.forEach((id) => enabled.add(id));
    r.disable?.forEach((id) => disabled.add(id));
  }
  return {
    relaxed: [...relaxed], // ruleset order (genre before preset), as the genre report always listed them
    on: [...enabled].sort(),
    off: [...disabled].filter((id) => !enabled.has(id)).sort(),
    conflicts: [...disabled].filter((id) => enabled.has(id)).sort(),
  };
}
