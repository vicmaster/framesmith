// Phase 17 Slice B — Tailwind utility-class → intent mapping (spec FR-B1, C1).
//
// A bare Tailwind snippet has no Tailwind runtime, so computed styles can't
// see the classes — and even when CSS *did* run, the class name carries intent
// a computed value can't: `bg-surface` names a design token, `#111` doesn't.
// This is a table-driven mapper for the common utility families, NOT a
// Tailwind compiler: unknown classes fall through (to computed styles when CSS
// ran, or to the import report otherwise).
//
// Color rules:
//   - `bg-white` / `text-black` / palette classes (`bg-red-500`) → literal/skip
//     (the v4 default palette is oklch; computed styles cover it faithfully)
//   - any other name (`bg-surface`, `text-primary`, theme keys) → a `$name`
//     token ref — intent preserved; snapToTokens/set_variables reconcile later.
//
// Scale: Tailwind v4 defaults (4px base, v4 radius names). `theme` is a flat
// { name: value } map (derived from the project's @theme) and only widens
// which names are treated as tokens.

import type { SceneNode } from './types.js';
import { TAILWIND_PALETTE } from './tailwind-palette.js';

const SCALE = 4; // 1 unit = 0.25rem = 4px

const TEXT_SIZES: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128 };
const FONT_WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const RADII: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, '4xl': 32, full: 9999 };
const LEADING: Record<string, number> = { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 };
const MAX_WIDTHS: Record<string, number> = { xs: 320, sm: 384, md: 448, lg: 512, xl: 576, '2xl': 672, '3xl': 768, '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280 };

/** "4" → 16, "1.5" → 6, "px" → 1, "[13px]" → 13. Null when not a size. */
function sizeValue(token: string): number | null {
  if (token === 'px') return 1;
  const arbitrary = token.match(/^\[(\d+(?:\.\d+)?)px\]$/);
  if (arbitrary) return parseFloat(arbitrary[1]);
  if (/^\d+(\.\d+)?$/.test(token)) return parseFloat(token) * SCALE;
  return null;
}

/** A color utility's value: literal hex for white/black and the v4 default
 * palette (so a bare snippet styles without compiled CSS — palette colors are
 * NOT design tokens, hence literals), null to fall through (arbitrary values —
 * computed styles own those), or a `$name` token ref for custom names. A
 * theme entry always wins over the palette (the project redefined the name). */
function colorValue(name: string, theme?: Record<string, string>): string | null {
  if (name === 'white') return '#FFFFFF';
  if (name === 'black') return '#000000';
  if (name === 'transparent' || name === 'current' || name === 'inherit') return null;
  if (name.startsWith('[')) return null; // arbitrary value — computed styles cover it
  if (name in TAILWIND_PALETTE && !(theme && name in theme)) return TAILWIND_PALETTE[name];
  return `$${name}`;
}

export interface IntentResult {
  props: Partial<SceneNode>;
  /** Color props that mapped to `$token` refs — the import report records these. */
  tokenRefs: { prop: string; token: string; cls: string }[];
}

/** Map one element's class list to scene-node props. Pure; order-independent
 * except later classes win within a family (like CSS source order). */
export function classesToProps(classes: string[], theme?: Record<string, string>): IntentResult {
  const props: Partial<SceneNode> = {};
  const tokenRefs: IntentResult['tokenRefs'] = [];
  // Padding sides accumulate, then compose.
  let pt: number | undefined, pr: number | undefined, pb: number | undefined, pl: number | undefined;

  const setColor = (prop: 'fill' | 'color' | 'stroke', name: string, cls: string) => {
    const v = colorValue(name, theme);
    if (v === null) return;
    (props as Record<string, unknown>)[prop] = v;
    if (v.startsWith('$')) tokenRefs.push({ prop, token: v, cls });
  };

  for (const cls of classes) {
    // ── layout ──
    if (cls === 'flex' || cls === 'inline-flex') { props.layout = props.layout ?? 'horizontal'; continue; }
    if (cls === 'flex-row') { props.layout = 'horizontal'; continue; }
    if (cls === 'flex-col') { props.layout = 'vertical'; continue; }
    if (cls === 'grid' || cls === 'inline-grid') { props.layout = 'vertical'; continue; }
    if (cls === 'flex-wrap') { props.wrap = true; continue; }
    if (cls.startsWith('items-')) {
      const v = { start: 'start', center: 'center', end: 'end', baseline: 'center' }[cls.slice(6)] as SceneNode['alignItems'];
      if (v) props.alignItems = v;
      continue;
    }
    if (cls.startsWith('justify-')) {
      const v = { start: 'start', center: 'center', end: 'end', between: 'space-between', around: 'space-around' }[cls.slice(8)] as SceneNode['justifyContent'];
      if (v) props.justifyContent = v;
      continue;
    }

    // ── spacing ──
    let m = cls.match(/^gap(?:-[xy])?-(.+)$/);
    if (m) { const v = sizeValue(m[1]); if (v !== null) props.gap = v; continue; }
    m = cls.match(/^p([trblxy]?)-(.+)$/);
    if (m) {
      const v = sizeValue(m[2]);
      if (v !== null) {
        const side = m[1];
        if (side === '' ) { pt = pr = pb = pl = v; }
        else if (side === 'x') { pr = pl = v; }
        else if (side === 'y') { pt = pb = v; }
        else if (side === 't') pt = v;
        else if (side === 'r') pr = v;
        else if (side === 'b') pb = v;
        else if (side === 'l') pl = v;
      }
      continue;
    }

    // ── sizing ──
    if (cls === 'w-full') { props.width = '100%'; continue; }
    if (cls === 'w-fit') { props.width = 'fit-content'; continue; }
    m = cls.match(/^w-(.+)$/);
    if (m) { const v = sizeValue(m[1]); if (v !== null) props.width = v; continue; }
    m = cls.match(/^max-w-(.+)$/);
    if (m) { const v = MAX_WIDTHS[m[1]] ?? sizeValue(m[1]); if (v !== null && v !== undefined) props.maxWidth = v; continue; }
    m = cls.match(/^h-(.+)$/);
    if (m) { const v = sizeValue(m[1]); if (v !== null) props.height = v; continue; }

    // ── radius ──
    if (cls === 'rounded') { props.cornerRadius = 4; continue; }
    m = cls.match(/^rounded-(.+)$/);
    if (m) {
      const v = RADII[m[1]] ?? sizeValue(`[${m[1].replace(/^\[|\]$/g, '')}]`);
      if (v !== null && v !== undefined) props.cornerRadius = v;
      continue;
    }

    // ── borders ──
    if (cls === 'border') { props.strokeWidth = 1; continue; }
    m = cls.match(/^border-([248])$/);
    if (m) { props.strokeWidth = parseInt(m[1], 10); continue; }
    m = cls.match(/^border-(.+)$/);
    if (m && !/^[xytrbl](-|$)/.test(m[1])) { setColor('stroke', m[1], cls); continue; }

    // ── typography ──
    m = cls.match(/^text-(.+)$/);
    if (m) {
      const rest = m[1];
      if (rest in TEXT_SIZES) { props.fontSize = TEXT_SIZES[rest]; continue; }
      if (rest === 'center' || rest === 'right' || rest === 'left') {
        if (rest !== 'left') props.textAlign = rest;
        continue;
      }
      setColor('color', rest, cls);
      continue;
    }
    m = cls.match(/^font-(.+)$/);
    if (m && m[1] in FONT_WEIGHTS) { props.fontWeight = FONT_WEIGHTS[m[1]]; continue; }
    m = cls.match(/^leading-(.+)$/);
    if (m && m[1] in LEADING) { props.lineHeight = LEADING[m[1]]; continue; }
    if (cls === 'uppercase' || cls === 'lowercase' || cls === 'capitalize') { props.textTransform = cls; continue; }

    // ── background ──
    m = cls.match(/^bg-(.+)$/);
    if (m) { setColor('fill', m[1], cls); continue; }

    // ── misc ──
    if (cls === 'overflow-hidden') { props.overflow = 'hidden'; continue; }
    m = cls.match(/^opacity-(\d+)$/);
    if (m) { props.opacity = parseInt(m[1], 10) / 100; continue; }
    // everything else: fall through (computed styles or the report own it)
  }

  if (pt !== undefined || pr !== undefined || pb !== undefined || pl !== undefined) {
    const t = pt ?? 0, r = pr ?? 0, b = pb ?? 0, l = pl ?? 0;
    props.padding = t === b && r === l ? (t === r ? t : [t, r]) : [t, r, b, l];
  }

  return { props, tokenRefs };
}
