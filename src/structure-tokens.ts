// Phase 31 slice D — the token vocabulary every scaffold references, shared by
// the web/mobile scaffolds (structures.ts) and the desktop-app realisations
// (structures-desktop.ts).

/** Standard color tokens these scaffolds reference (the preset vocabulary). */
export const COLOR = {
  bgPrimary: '$bg-primary',
  bgSurface: '$bg-surface',
  bgElevated: '$bg-elevated',
  textPrimary: '$text-primary',
  textSecondary: '$text-secondary',
  accent: '$accent',
  border: '$border',
} as const;

/** Phase 27 slice B — density comes from tokens, not literals. Scaffolds
 * reference the space/radius/elevation vocabulary generate_design_system
 * writes; applyStructure seeds neutral defaults (the pre-27 literal values)
 * for anything not already resolvable, so unthemed canvases render exactly
 * as before and a personality re-densifies every stamp. */
export const SPACE = {
  xxs: '$space-3xs',   // 2
  xs2: '$space-2xs',   // 4
  xs: '$space-xs',     // 8
  sm: '$space-sm',     // 12
  md: '$space-md',     // 16
  lg: '$space-lg',     // 24
  xl: '$space-xl',     // 32
  xl2: '$space-2xl',   // 48
} as const;
export const RADIUS = {
  sm: '$radius-sm',    // 8
  md: '$radius-md',    // 12
  lg: '$radius-lg',    // 16
} as const;
export const ELEV = {
  flat: '$elevation.flat',
  raised: '$elevation.raised',
} as const;
export const TYPE = {
  display: '$display',   // hero headlines — the display face at full size
  title: '$title',       // page/screen titles, one step below display
  heading: '$heading',   // section heads
  textLg: '$text-lg',    // card titles, subheads — the step above body
  textSm: '$text-sm',    // small body text — untracked (nav items, prose, meta)
  body: '$body',         // prose and item text
  label: '$label',       // control, CTA, breadcrumb and table-header text
  caption: '$caption',   // metadata, timestamps, eyebrows
} as const;
/** Phase 28 — the tint pair: tint as the FILL, base color as the INK. */
export const TINT = {
  accent: { bg: '$accent-tint', ink: COLOR.accent },
  success: { bg: '$success-tint', ink: '$success' },
  warning: { bg: '$warning-tint', ink: '$warning' },
  danger: { bg: '$danger-tint', ink: '$danger' },
  neutral: { bg: '$neutral-tint', ink: COLOR.textSecondary },
} as const;
