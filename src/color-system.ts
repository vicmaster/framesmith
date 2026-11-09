// Phase 25 slice C (FR-C1/C2) — the OKLCH color engine: one seed color →
// perceptual ramps, a matched neutral, status colors, and a dual-theme
// semantic mapping. Hand-rolled conversions (Björn Ottosson's OKLab math,
// zero dependencies — validated against Chrome's own oklch() parsing in
// test-color-system-readback.ts). Pure: token WRITING is the tool's job.
//
// Gamut policy (spec ANALYZE): out-of-gamut colors clip toward LOWER CHROMA
// at fixed lightness and hue — never hue-shift, never lightness-shift.

import { contrastRatio, parseColor } from './evaluate.js';

export interface Oklch {
  l: number; // 0..1
  c: number; // 0..~0.37
  h: number; // degrees 0..360
}

// ── conversions ─────────────────────────────────────────────────────────────

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function rgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb(L: number, a: number, bb: number): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * bb, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * bb, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * bb, 3);
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function hexToOklch(hex: string): Oklch {
  const rgb = parseColor(hex);
  if (!rgb) throw new Error(`"${hex}" is not a parseable color (expected #RGB / #RRGGBB / rgb())`);
  const { L, a, b } = rgbToOklab(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-5 ? 0 : h };
}

/** In-gamut check + raw conversion; NaN-safe (negative cube inputs are fine —
 * Math.pow of a negative base with integer exponent 3 via manual cube). */
function oklchToRgbRaw(o: Oklch): [number, number, number] {
  const hr = (o.h * Math.PI) / 180;
  return oklabToRgb(o.l, o.c * Math.cos(hr), o.c * Math.sin(hr));
}

const inGamut = (rgb: [number, number, number]): boolean => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** OKLCH → hex, clipping toward lower chroma (fixed L and H) when the color
 * falls outside sRGB. Binary search converges well inside 1/255. */
export function oklchToHex(o: Oklch): string {
  let rgb = oklchToRgbRaw(o);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = o.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbRaw({ ...o, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToRgbRaw({ ...o, c: lo });
  }
  const to255 = (c: number): number => Math.max(0, Math.min(255, Math.round(c * 255)));
  return '#' + rgb.map((c) => to255(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ── ramps ───────────────────────────────────────────────────────────────────

export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** OKLab lightness targets: a wash at 50, then perceptually EVEN steps from
 * 100 → 900 (Δ0.075 — asserted in tests). */
const L_TARGETS = [0.975, 0.95, 0.875, 0.8, 0.725, 0.65, 0.575, 0.5, 0.425, 0.35];

/** Chroma envelope relative to the seed's chroma — tapered at the light end
 * (washes stay washes), full through the middle, gently reduced in the
 * shadows (dark steps go muddy at full chroma). */
const C_CURVE = [0.12, 0.25, 0.5, 0.75, 0.92, 1, 1, 0.92, 0.82, 0.72];

export type Ramp = Record<(typeof RAMP_STEPS)[number], string>;

export function generateRamp(seedHex: string): Ramp {
  const seed = hexToOklch(seedHex);
  const c = Math.max(seed.c, 0.03); // a near-grey seed still deserves a usable ramp
  const out = {} as Ramp;
  RAMP_STEPS.forEach((step, i) => {
    out[step] = oklchToHex({ l: L_TARGETS[i], c: c * C_CURVE[i], h: seed.h });
  });
  return out;
}

/** Neutral ramp with a whisper of the seed's hue — never a dead grey, never
 * visibly tinted. */
export function matchedNeutral(seedHex: string): Ramp {
  const seed = hexToOklch(seedHex);
  const out = {} as Ramp;
  RAMP_STEPS.forEach((step, i) => {
    out[step] = oklchToHex({ l: L_TARGETS[i], c: 0.01, h: seed.h });
  });
  return out;
}

/** Status colors at ONE consistent lightness/chroma band (per-hue gamut
 * clipping may reduce chroma, never lightness or hue). */
export const STATUS_HUES = { success: 150, warning: 75, danger: 27 } as const;
const STATUS_L = 0.62;
const STATUS_C = 0.15;

export function statusColors(bgHex = '#FFFFFF'): Record<keyof typeof STATUS_HUES, string> {
  // Status colors are used AS TEXT (validation messages, deltas) — each is
  // darkened from the band until it clears AA against the LIGHT PAGE surface
  // it actually sits on (second dogfood fix: tuning against pure white left
  // danger at 4.29:1 on the off-white bg-primary; the off-white is the
  // harder target, so passing there implies passing on white). Hue held.
  const bg = rgbOf(bgHex);
  const forText = (h: number): string => {
    let o: Oklch = { l: STATUS_L, c: STATUS_C, h };
    for (let i = 0; i < 30 && contrastRatio(rgbOf(oklchToHex(o)), bg) < 4.5; i++) {
      o = { ...o, l: Math.max(0.2, o.l - 0.02) };
    }
    return oklchToHex(o);
  };
  return {
    success: forText(STATUS_HUES.success),
    warning: forText(STATUS_HUES.warning),
    danger: forText(STATUS_HUES.danger),
  };
}

// ── semantic mapping ────────────────────────────────────────────────────────

const rgbOf = (hex: string): [number, number, number] => parseColor(hex)!;

/** First ramp step (searching dark→light for dark themes, light→dark for
 * light themes) whose contrast against `bg` clears `min` — AA by
 * construction instead of by hope. */
function pickStep(ramp: Ramp, bg: string, min: number, direction: 'darker' | 'lighter'): string {
  const steps = direction === 'darker' ? [...RAMP_STEPS] : [...RAMP_STEPS].reverse();
  for (const s of steps) {
    if (contrastRatio(rgbOf(ramp[s]), rgbOf(bg)) >= min) return ramp[s];
  }
  return direction === 'darker' ? ramp[900] : ramp[50];
}

export interface SemanticTheme {
  'bg-primary': string;
  'bg-surface': string;
  'bg-elevated': string;
  'text-primary': string;
  'text-secondary': string;
  border: string;
  accent: string;
}

/** Light + dark mappings from the same ramps — the Radix pattern: dark is a
 * REVERSED walk of the lightness ladder, not inverted hex. Text and accent
 * steps are chosen by measured contrast (AA on their surfaces by
 * construction). */
export function semanticMapping(primary: Ramp, neutral: Ramp): { light: SemanticTheme; dark: SemanticTheme } {
  const light: SemanticTheme = {
    'bg-primary': neutral[50],
    'bg-surface': '#FFFFFF',
    'bg-elevated': neutral[50],
    'text-primary': neutral[900],
    'text-secondary': pickStep(neutral, '#FFFFFF', 4.6, 'darker'),
    border: neutral[200],
    accent: pickStep(primary, '#FFFFFF', 4.6, 'darker'),
  };
  const dark: SemanticTheme = {
    'bg-primary': neutral[900],
    'bg-surface': oklchToHex({ ...hexToOklch(neutral[900]), l: 0.31 }), // one step past 900 — cards sit above the page
    'bg-elevated': oklchToHex({ ...hexToOklch(neutral[900]), l: 0.35 }),
    'text-primary': neutral[50],
    'text-secondary': pickStep(neutral, neutral[900], 4.6, 'lighter'),
    border: neutral[700],
    accent: pickStep(primary, neutral[900], 4.6, 'lighter'),
  };
  // dark surfaces are darker than 900's L target on purpose; recompute the
  // surface-dependent picks against the ACTUAL surface.
  dark['text-secondary'] = pickStep(neutral, dark['bg-surface'], 4.6, 'lighter');
  dark.accent = pickStep(primary, dark['bg-surface'], 4.6, 'lighter');
  return { light, dark };
}

/** Raise a color's lightness (hue and chroma held) until it clears `min`
 * contrast against `bg` — status colors tuned for light surfaces go muddy on
 * dark ones, and a $danger message must read in BOTH themes. */
function raiseForContrast(hex: string, bgHex: string, min = 4.5): string {
  let o = hexToOklch(hex);
  for (let i = 0; i < 30 && contrastRatio(rgbOf(oklchToHex(o)), rgbOf(bgHex)) < min; i++) {
    o = { ...o, l: Math.min(0.95, o.l + 0.02) };
  }
  return oklchToHex(o);
}

// ── Phase 28 slice A — the color range ──────────────────────────────────────

/** The purple band the accent-hue cliché tell polices (kept in sync with
 * evaluate.ts's isPurpleHue). The categorical walk avoids it UNLESS the seed
 * itself lives there — a purple brand's palette must not dodge its own hue. */
const PURPLE_HUE_MIN = 285;   // OKLCH hue, ≈ hsl 230
const PURPLE_HUE_MAX = 330;   // ≈ hsl 290

export type CategoricalPalette = Record<'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6', string>;

/** Categorical series palette: the seed hue first, then a deterministic hue
 * walk with fixed perceptual guardrails — lightness band 0.55–0.65, chroma
 * matched to the seed (floored so near-neutral seeds still yield chromatic
 * series), ≥ 30° separation, and each color pushed until it clears the 3:1
 * graphical-object floor (WCAG 1.4.11) against BOTH themes' surfaces. */
export function categoricalPalette(
  seedHex: string,
  surfaces: { light: string; dark: string },
): { palette: CategoricalPalette; darkPalette: CategoricalPalette; note?: string } {
  const seed = hexToOklch(seedHex);
  const nearNeutral = seed.c < 0.03;
  // A near-neutral seed has no meaningful hue — anchor the walk at a stable
  // blue instead of amplifying noise, and say so (no silent degradation).
  const baseHue = nearNeutral ? 250 : seed.h;
  const seedIsPurple = !nearNeutral && baseHue >= PURPLE_HUE_MIN && baseHue <= PURPLE_HUE_MAX;
  const chroma = Math.max(0.11, Math.min(0.17, nearNeutral ? 0.13 : seed.c));

  const hues: number[] = [];
  for (let k = 0; hues.length < 6 && k < 12; k++) {
    const h = (baseHue + k * 55) % 360;
    if (!seedIsPurple && h >= PURPLE_HUE_MIN && h <= PURPLE_HUE_MAX) continue;
    // 55° steps guarantee ≥ 30° separation except across the wrap — check.
    if (hues.some((prev) => {
      const d = Math.abs(prev - h);
      return Math.min(d, 360 - d) < 30;
    })) continue;
    hues.push(h);
  }

  /** Adjust lightness from the band until ≥ 3:1 on `bg` (direction chosen by
   * the surface: darken for light surfaces, lighten for dark ones). */
  const settle = (h: number, bg: string, dir: 1 | -1, startL: number): string => {
    let o: Oklch = { l: startL, c: chroma, h };
    const bgRgb = rgbOf(bg);
    for (let i = 0; i < 30 && contrastRatio(rgbOf(oklchToHex(o)), bgRgb) < 3; i++) {
      o = { ...o, l: Math.max(0.3, Math.min(0.85, o.l + dir * 0.02)) };
    }
    return oklchToHex(o);
  };

  const entries = hues.map((h, i) => [`chart-${i + 1}`, settle(h, surfaces.light, -1, 0.6)]);
  const darkEntries = hues.map((h, i) => [`chart-${i + 1}`, settle(h, surfaces.dark, 1, 0.66)]);
  return {
    palette: Object.fromEntries(entries) as CategoricalPalette,
    darkPalette: Object.fromEntries(darkEntries) as CategoricalPalette,
    ...(nearNeutral ? { note: 'Seed is near-neutral — the series palette anchors at a stable blue instead of amplifying the seed hue.' } : {}),
    ...(hues.length < 6 ? { note: `Only ${hues.length} guaranteed-distinct series hues from this seed.` } : {}),
  };
}

export type TintLayer = Record<'accent-tint' | 'success-tint' | 'warning-tint' | 'danger-tint' | 'neutral-tint', string>;

/** The tint layer: soft same-hue surfaces for chips, icon tiles, pills, and
 * initials avatars, each PAIRED with its existing text-tuned ink (`accent`,
 * `success`, … — `text-secondary` for neutral). The pair is AA by
 * construction: the tint backs off toward the surface until its ink clears
 * 4.5:1 on it. Dark tints are low-lightness washes paired the same way. */
export function tintLayer(
  inks: Record<'accent-tint' | 'success-tint' | 'warning-tint' | 'danger-tint' | 'neutral-tint', string>,
  mode: 'light' | 'dark',
): TintLayer {
  const out = {} as TintLayer;
  for (const [name, ink] of Object.entries(inks) as Array<[keyof TintLayer, string]>) {
    const hue = hexToOklch(ink).h;
    let tint: Oklch = mode === 'light'
      ? { l: 0.93, c: 0.045, h: hue }
      : { l: 0.3, c: 0.055, h: hue };
    const inkRgb = rgbOf(ink);
    // Back the tint off (lighter in light mode, darker in dark) until the
    // pair reads at AA text contrast.
    for (let i = 0; i < 20 && contrastRatio(inkRgb, rgbOf(oklchToHex(tint))) < 4.5; i++) {
      tint = { ...tint, l: mode === 'light' ? Math.min(0.97, tint.l + 0.01) : Math.max(0.2, tint.l - 0.01) };
    }
    out[name] = oklchToHex(tint);
  }
  return out;
}

export type StatusColors = Record<'success' | 'warning' | 'danger', string>;

/** Phase 31 FR-A8 — the control colors an app needs: a focus ring that reads
 * against every surface and tint it can sit on, and a border strong enough
 * to be a control's only boundary cue (both 3:1, WCAG 1.4.11). */
export type ControlColors = Record<'focus-ring' | 'border-strong', string>;

/** First ramp step clearing `min` against EVERY background. Falls back to
 * the extreme step (900 for light themes, 50 for dark), which clears against
 * the generated surfaces. */
function pickStepAll(ramp: Ramp, bgs: string[], min: number, direction: 'darker' | 'lighter'): string {
  const steps = direction === 'darker' ? [...RAMP_STEPS] : [...RAMP_STEPS].reverse();
  for (const s of steps) {
    if (bgs.every((bg) => contrastRatio(rgbOf(ramp[s]), rgbOf(bg)) >= min)) return ramp[s];
  }
  return direction === 'darker' ? ramp[900] : ramp[50];
}

function controlColors(primary: Ramp, neutral: Ramp, theme: SemanticTheme, tints: Record<string, string>, direction: 'darker' | 'lighter'): ControlColors {
  const surfaces = [theme['bg-primary'], theme['bg-surface'], theme['bg-elevated']];
  return {
    'focus-ring': pickStepAll(primary, [...surfaces, ...Object.values(tints)], 3, direction),
    'border-strong': pickStepAll(neutral, [theme['bg-primary'], theme['bg-surface']], 3, direction),
  };
}

/** The full system from one seed — what generate_color_system writes/reports.
 * The dark layer includes STATUS overrides (dogfood fix): the light-tuned
 * status colors are re-lit for AA against the dark surface. */
export function generateColorSystem(seedHex: string): {
  seed: { hex: string; oklch: Oklch };
  primary: Ramp;
  neutral: Ramp;
  status: StatusColors;
  light: SemanticTheme;
  dark: SemanticTheme & StatusColors;
  /** Phase 28 — categorical series tokens (chart-1…chart-6), light values. */
  categorical: CategoricalPalette;
  /** Phase 28 — the tint layer (accent/success/warning/danger/neutral-tint), light values. */
  tints: TintLayer;
  /** Phase 31 — focus-ring + border-strong, light values. */
  controls: ControlColors;
  /** Dark counterparts for categorical + tints + controls (merged into dark.colors by callers). */
  darkRange: CategoricalPalette & TintLayer & ControlColors;
  /** Present when the palette degraded deliberately (near-neutral seed, fewer hues). */
  rangeNote?: string;
} {
  const primary = generateRamp(seedHex);
  const neutral = matchedNeutral(seedHex);
  // Tune status text against the actual light page surface (neutral-50 =
  // bg-primary), not pure white — the off-white is the stricter target.
  const status = statusColors(neutral['50']);
  const { light, dark } = semanticMapping(primary, neutral);
  // Re-lit against the LIGHTEST dark surface (bg-elevated) — light text
  // contrasts least there, so passing on it implies surface + primary too
  // (third dogfood fix: surface-tuned danger sat at 3.96:1 on elevated).
  const darkStatus = Object.fromEntries(
    Object.entries(status).map(([k, hex]) => [k, raiseForContrast(hex, dark['bg-elevated'] ?? dark['bg-surface'])]),
  ) as StatusColors;
  // Phase 28 — the color range: categorical series + tints, both themes.
  const cat = categoricalPalette(seedHex, { light: light['bg-surface'], dark: dark['bg-surface'] });
  const tints = tintLayer({
    'accent-tint': light.accent,
    'success-tint': status.success,
    'warning-tint': status.warning,
    'danger-tint': status.danger,
    'neutral-tint': light['text-secondary'],
  }, 'light');
  const darkFull = { ...dark, ...darkStatus };
  const darkTints = tintLayer({
    'accent-tint': darkFull.accent,
    'success-tint': darkStatus.success,
    'warning-tint': darkStatus.warning,
    'danger-tint': darkStatus.danger,
    'neutral-tint': darkFull['text-secondary'],
  }, 'dark');
  const controls = controlColors(primary, neutral, light, tints, 'darker');
  const darkControls = controlColors(primary, neutral, darkFull, darkTints, 'lighter');
  return {
    seed: { hex: seedHex, oklch: hexToOklch(seedHex) }, primary, neutral, status, light,
    dark: darkFull,
    categorical: cat.palette,
    tints,
    controls,
    darkRange: { ...cat.darkPalette, ...darkTints, ...darkControls },
    ...(cat.note ? { rangeNote: cat.note } : {}),
  };
}
