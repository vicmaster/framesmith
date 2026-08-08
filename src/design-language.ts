// Phase 27 slice A — the design language generator.
//
// `generateDesignSystem` is the one-call story: a seed color plus a named
// PERSONALITY produces the full token stack — the color system (color-system.ts
// engine), a modular type + space scale (scales.ts engine), and everything the
// engines never had an opinion about: a curated font pairing, per-role
// tracking/leading, a radius stance, a density stance, an elevation (shadow)
// scale with a dark-theme treatment, and motion defaults.
//
// Personalities are CURATED, not computed (the pattern-library philosophy:
// taste is hand-built, gates verify it). Every choice below is a reviewed
// design decision with its intent stated; test-design-language.ts locks every
// personality's output against the evaluator and the cliché tells.

import { generateColorSystem } from './color-system.js';
import { generateTypeScale, generateSpaceScale, type RatioName } from './scales.js';
import type { DesignVariables, ShadowSpec } from './types.js';

export type PersonalityName = 'technical' | 'editorial' | 'soft' | 'data-dense';
export const PERSONALITY_NAMES: PersonalityName[] = ['technical', 'editorial', 'soft', 'data-dense'];

interface Personality {
  /** One-line intent, surfaced in the tool result and docs. */
  intent: string;
  /** Curated Google Fonts pairing — resolved by the existing font pipeline. */
  fonts: { display: string; body: string; mono?: string };
  /** Scale stance: where the type ladder pivots and how fast it grows. */
  type: { baseSize: number; ratio: RatioName; stepsDown?: number };
  /** Role treatments layered over the scale steps. */
  roles: {
    displayWeight: number;
    displayTracking: number;   // px at display sizes — negative = tighter
    headingWeight: number;
    labelTracking: number;     // px at label sizes — slight positive reads crisp
  };
  /** Radius stance (sm/md/lg tokens). */
  radius: { sm: number; md: number; lg: number };
  /** Space-scale base — density lives in the existing spacing namespace. */
  spaceBase: number;
  /** Shadow scales. Light wears soft ink-tinted layers; dark re-states depth
   * with stronger black (light-tuned shadows vanish on dark surfaces). */
  elevation: { light: Record<string, ShadowSpec[]>; dark: Record<string, ShadowSpec[]> };
  /** Motion defaults (duration ms + easing). */
  motion: Record<string, { duration: number; easing: string }>;
}

/** Layered shadows at four semantic depths. `ink` is the shadow color family;
 * intensity scales the alpha so personalities can whisper or speak. */
function elevationScale(ink: string, intensity: number): Record<string, ShadowSpec[]> {
  const a = (base: number): string => ink.replace('ALPHA', String(Math.round(base * intensity * 100) / 100));
  return {
    flat: [{ x: 0, y: 1, blur: 2, spread: 0, color: a(0.05) }],
    raised: [
      { x: 0, y: 1, blur: 2, spread: 0, color: a(0.06) },
      { x: 0, y: 2, blur: 4, spread: -1, color: a(0.08) },
    ],
    floating: [
      { x: 0, y: 4, blur: 6, spread: -2, color: a(0.06) },
      { x: 0, y: 12, blur: 16, spread: -4, color: a(0.11) },
    ],
    overlay: [
      { x: 0, y: 8, blur: 10, spread: -4, color: a(0.06) },
      { x: 0, y: 20, blur: 25, spread: -5, color: a(0.14) },
    ],
  };
}

const LIGHT_INK = 'rgba(16, 24, 40, ALPHA)';   // deep blue-black — never pure black
const DARK_INK = 'rgba(0, 0, 0, ALPHA)';        // on dark surfaces black is the only ink that reads

const PERSONALITIES: Record<PersonalityName, Personality> = {
  // Crisp, engineered, product-tool energy. Geometric display over the
  // product-UI workhorse; tight display tracking; compact-but-not-cramped
  // density; controlled radii; quick motion.
  technical: {
    intent: 'Crisp and engineered — a precision product tool.',
    fonts: { display: 'Space Grotesk', body: 'Inter' },
    type: { baseSize: 16, ratio: 'minor-third' },
    roles: { displayWeight: 600, displayTracking: -1, headingWeight: 600, labelTracking: 0.25 },
    radius: { sm: 6, md: 10, lg: 14 },
    spaceBase: 16,
    elevation: { light: elevationScale(LIGHT_INK, 1), dark: elevationScale(DARK_INK, 4) },
    motion: {
      fast: { duration: 120, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      base: { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      slow: { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    },
  },
  // Confident serif voice over a quiet humanist body; generous scale
  // contrast and whitespace; near-sharp radii; unhurried motion.
  editorial: {
    intent: 'A confident editorial voice — serif display, generous air.',
    fonts: { display: 'Fraunces', body: 'Source Sans 3' },
    type: { baseSize: 17, ratio: 'major-third' },
    roles: { displayWeight: 600, displayTracking: -0.5, headingWeight: 600, labelTracking: 0.5 },
    radius: { sm: 2, md: 4, lg: 8 },
    spaceBase: 20,
    elevation: { light: elevationScale(LIGHT_INK, 0.8), dark: elevationScale(DARK_INK, 3.5) },
    motion: {
      fast: { duration: 160, easing: 'ease-out' },
      base: { duration: 240, easing: 'ease-out' },
      slow: { duration: 340, easing: 'ease-out' },
    },
  },
  // Friendly and approachable without going toy-like: rounded pairing,
  // fuller radii, slightly springy motion, softer shadows.
  soft: {
    intent: 'Warm and approachable — rounded, friendly, human.',
    fonts: { display: 'Plus Jakarta Sans', body: 'Inter' },
    type: { baseSize: 16, ratio: 'minor-third' },
    roles: { displayWeight: 700, displayTracking: -0.5, headingWeight: 600, labelTracking: 0.25 },
    radius: { sm: 12, md: 16, lg: 20 },
    spaceBase: 16,
    elevation: { light: elevationScale(LIGHT_INK, 1.2), dark: elevationScale(DARK_INK, 4) },
    motion: {
      fast: { duration: 150, easing: 'cubic-bezier(0.34, 1.2, 0.64, 1)' },
      base: { duration: 220, easing: 'cubic-bezier(0.34, 1.2, 0.64, 1)' },
      slow: { duration: 320, easing: 'ease-in-out' },
    },
  },
  // Instrument-panel density: small pivot, tight ladder (one step down keeps
  // the floor at 12px), a mono role for figures, minimal radii and near-flat
  // depth — the data is the decoration.
  'data-dense': {
    intent: 'Instrument-panel density — the data is the decoration.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    type: { baseSize: 13, ratio: 'major-second', stepsDown: 1 },
    roles: { displayWeight: 700, displayTracking: -0.75, headingWeight: 600, labelTracking: 0.25 },
    radius: { sm: 4, md: 6, lg: 8 },
    spaceBase: 12,
    elevation: { light: elevationScale(LIGHT_INK, 0.7), dark: elevationScale(DARK_INK, 3) },
    motion: {
      fast: { duration: 100, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      base: { duration: 150, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      slow: { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    },
  },
};

export function getPersonality(name: PersonalityName): Personality {
  return PERSONALITIES[name];
}

export interface DesignSystemResult {
  personality: PersonalityName;
  intent: string;
  fonts: { display: string; body: string; mono?: string };
  /** Everything, ready to write to one token layer. */
  variables: DesignVariables;
  /** The color engine's full report (ramps + semantics + dark), passed through. */
  colorSystem: ReturnType<typeof generateColorSystem>;
}

export interface DesignSystemOptions {
  /** Override the personality's type pivot (10–24). */
  baseSize?: number;
  /** Override the personality's scale ratio. */
  ratio?: RatioName | number;
}

/** One seed + one personality → the full token stack. Pure — writing to a
 * layer (and preserving inherited tokens) is the tool handler's job. */
export function generateDesignSystem(
  seedHex: string,
  personalityName: PersonalityName,
  opts: DesignSystemOptions = {},
): DesignSystemResult {
  const p = PERSONALITIES[personalityName];
  if (!p) {
    throw new Error(`Unknown personality "${personalityName}". Personalities: ${PERSONALITY_NAMES.join(', ')}.`);
  }

  // Colors — the existing engine, unchanged.
  const colorSystem = generateColorSystem(seedHex);
  const colors: Record<string, string> = {};
  for (const [step, hex] of Object.entries(colorSystem.primary)) colors[`primary-${step}`] = hex;
  for (const [step, hex] of Object.entries(colorSystem.neutral)) colors[`neutral-${step}`] = hex;
  Object.assign(colors, colorSystem.status, colorSystem.light);

  // Type scale — the existing engine, pivoted by the personality.
  const baseSize = opts.baseSize ?? p.type.baseSize;
  const steps = generateTypeScale({
    ratio: opts.ratio ?? p.type.ratio,
    baseSize,
    ...(p.type.stepsDown !== undefined ? { stepsDown: p.type.stepsDown } : {}),
  });
  // UI floor: a generated DESIGN LANGUAGE never hands out sub-11px text —
  // print-scale captions read as noise on screens. (generate_scale alone is
  // unchanged; the floor is this call's opinion.)
  for (const step of Object.values(steps)) {
    if (typeof step.fontSize === 'number' && step.fontSize < 11) step.fontSize = 11;
  }

  // Roles — the personality's voice layered over the scale. Structures speak
  // roles ($display / $heading / $body / $label / $caption — and $figures
  // when a mono face exists); the text-* steps stay for direct use.
  const typography: NonNullable<DesignVariables['typography']> = { ...steps };
  const stepOr = (name: string, fallback: string) => steps[name] ?? steps[fallback];
  const display = stepOr('text-3xl', 'text-2xl') ?? stepOr('text-2xl', 'text-xl');
  const heading = stepOr('text-xl', 'text-lg');
  const body = steps['text-base'];
  const label = stepOr('text-sm', 'text-base');
  typography['display'] = {
    ...display, fontFamily: p.fonts.display, fontWeight: p.roles.displayWeight, letterSpacing: p.roles.displayTracking,
  };
  typography['heading'] = { ...heading, fontFamily: p.fonts.display, fontWeight: p.roles.headingWeight };
  typography['body'] = { ...body, fontFamily: p.fonts.body };
  // Reading roles hold a 12px floor even on tight ladders (the 11px floor is
  // for captions/annotations; body and labels are read continuously).
  const labelSize = typeof label.fontSize === 'number' ? Math.max(12, label.fontSize) : label.fontSize;
  typography['label'] = { ...label, fontSize: labelSize, fontFamily: p.fonts.body, fontWeight: 500, letterSpacing: p.roles.labelTracking };
  typography['caption'] = { ...stepOr('text-xs', 'text-sm'), fontFamily: p.fonts.body };
  if (p.fonts.mono) {
    typography['figures'] = { ...body, fontFamily: p.fonts.mono };
  }

  // Space, radius, elevation, motion — the personality's stances.
  const spacing = generateSpaceScale(p.spaceBase);
  const radius = { 'radius-sm': p.radius.sm, 'radius-md': p.radius.md, 'radius-lg': p.radius.lg };

  const variables: DesignVariables = {
    colors,
    typography,
    spacing,
    radius,
    elevation: p.elevation.light,
    motion: p.motion,
    dark: { colors: { ...colorSystem.dark }, elevation: p.elevation.dark },
  };

  return { personality: personalityName, intent: p.intent, fonts: p.fonts, variables, colorSystem };
}
