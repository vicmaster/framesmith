// Phase 31 slice H (spec R1) — the colour arithmetic the contrast checks
// share: parsing, WCAG luminance and ratio, source-over compositing, and the
// walk that finds what a node is painted over. The text-contrast check and
// the analytical state checks (state-checks.ts) read the same walk, so they
// never disagree about a backdrop.

import type { SceneNode } from './types.js';

export type Rgb = [number, number, number];

export function parseColor(str: string): Rgb | null {
  if (!str || typeof str !== 'string') return null;
  // #RGB
  let m = str.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  // #RRGGBB or #RRGGBBAA
  m = str.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  // rgb(r,g,b) / rgba(r,g,b,a)
  m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

// Phase 12 — alpha channel for glow detection (a low-alpha colored shadow reads
// as a bloom). Handles #RRGGBBAA and rgba(), the alpha as a number or a
// percent (slice H: `rgba(0, 0, 0, 50%)` is 0.5); everything else is opaque.
export function parseAlpha(str: string): number {
  if (!str || typeof str !== 'string') return 1;
  const hex8 = str.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i);
  if (hex8) return parseInt(hex8[1], 16) / 255;
  const rgba = str.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)(%?)\s*\)/i);
  if (rgba) return Math.max(0, Math.min(1, parseFloat(rgba[1]) / (rgba[2] ? 100 : 1)));
  return 1;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(
    (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)),
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(...fg);
  const l2 = relativeLuminance(...bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** A contrast ratio at the two decimals it is reported (and judged) at. */
export const roundedRatio = (a: Rgb, b: Rgb): number => Math.round(contrastRatio(a, b) * 100) / 100;

/** Source-over blend of `top` at `alpha` onto an opaque `base`. */
export function composite(top: Rgb, alpha: number, base: Rgb): Rgb {
  if (alpha >= 1) return top;
  return [0, 1, 2].map((i) => Math.round(alpha * top[i] + (1 - alpha) * base[i])) as Rgb;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toLowerCase();
}

export const WHITE: Rgb = [255, 255, 255];

/** What a node is painted over: a composited colour (with the fills that made
 * it, nearest first), a gradient, or something the walk cannot read. */
export type Backdrop =
  | { kind: 'color'; rgb: Rgb; layers: string[] }
  | { kind: 'gradient' }
  | { kind: 'unreadable' };

/** A fill that paints nothing: unset, the keywords, an unresolved $token or
 * a value that is not a string (the renderer emits those as invalid CSS, so
 * the browser draws nothing). */
export function paintsNothing(fill: unknown): boolean {
  return typeof fill !== 'string' || !fill || fill === 'transparent' || fill === 'none' || fill.startsWith('$');
}

/** A colour the model can draw: one that paints nothing, or one that parses.
 * Anything else (a named colour, hsl()) still paints, so it cannot be skipped
 * as transparent. */
export const readable = (color: unknown): boolean => paintsNothing(color) || parseColor(color as string) !== null;

/**
 * The backdrop behind a node, from its ancestors nearest first. A gradient
 * stops the walk; a fill that paints nothing is seen through; an unparseable
 * fill stops it (unreadable); a translucent fill is a layer composited over
 * what is behind it; with no opaque fill the white page shows. `stop`, when
 * given, ends the walk at a node it returns a fill for (the state checks stop
 * at an overlay, whose tree parents are not behind it): an opaque fill is the
 * backdrop, anything else unreadable. `fillOf` reads a node's painted fill
 * (default: its `fill`).
 */
export function backdropBehind(
  chain: Iterable<SceneNode>,
  opts: { stop?: (n: SceneNode) => string | undefined | null; fillOf?: (n: SceneNode) => string | undefined } = {},
): Backdrop {
  const layers: string[] = [];
  const fillOf = opts.fillOf ?? ((n: SceneNode) => n.fill);
  for (const node of chain) {
    const stop = opts.stop?.(node);
    if (stop !== undefined && stop !== null) {
      const rgb = parseColor(stop);
      if (!rgb || paintsNothing(stop) || parseAlpha(stop) < 1) return { kind: 'unreadable' };
      layers.push(stop);
      return finish(layers);
    }
    if (node.gradient) return { kind: 'gradient' };
    const fill = fillOf(node);
    if (paintsNothing(fill)) continue;
    // A fill we cannot parse (hsl(), a named color) still paints: stop here
    // rather than measure against what is behind it.
    if (!parseColor(fill!)) return { kind: 'unreadable' };
    const alpha = parseAlpha(fill!);
    if (alpha > 0) layers.push(fill!);
    if (alpha >= 1) break;
  }
  return finish(layers);
}

function finish(layers: string[]): Backdrop {
  const backmost = layers[layers.length - 1];
  let rgb: Rgb = backmost !== undefined && parseAlpha(backmost) >= 1 ? parseColor(backmost)! : WHITE;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (parseAlpha(layers[i]) < 1) rgb = composite(parseColor(layers[i])!, parseAlpha(layers[i]), rgb);
  }
  return { kind: 'color', rgb, layers };
}
