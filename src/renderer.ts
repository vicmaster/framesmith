import type { Canvas, FontFace, SceneNode } from './types.js';
import { getIconSvg } from './icons.js';
import { aliasFamilyStack } from './fonts.js';
import { usableSafeArea } from './surfaces.js';
import {
  BUTTON_FONT, BUTTON_PADDING, CHROME_EDGE, FAB_RAISE, FAB_SIZE, FLOATING_INSET, NAV_ACTION, NAV_BAR_HEIGHT, NAV_BAR_LARGE_HEIGHT, TAB_BAND,
  buttonHeight, chromeHeight, chromeReservation, effectivePosition, listRowMinHeight, navBarHeight, rootInsets,
} from './primitives.js';

/** Build a `background: …` declaration from a node's `gradient`.
 *
 * The documented form is structured (`{ type, angle?, stops: [...] }`), but
 * agents frequently pass a raw CSS string (e.g. `"linear-gradient(...)"`).
 * Previously that crashed `screenshot` on `g.stops.map` — here we accept the
 * string as-is and treat a structured value missing `stops` as absent (the
 * caller falls back to `fill`) rather than throwing. Returns `null` when there
 * is nothing renderable. Typed `unknown` because the runtime value may not
 * match the `SceneNode.gradient` declared type. */
function gradientBackgroundCss(g: unknown): string | null {
  if (typeof g === 'string') {
    const v = g.trim();
    return v ? `background: ${v}` : null;
  }
  if (!g || typeof g !== 'object') return null;
  const grad = g as { type?: string; angle?: number; stops?: Array<{ color: string; position?: number }> };
  if (!Array.isArray(grad.stops) || grad.stops.length === 0) return null;
  const stops = grad.stops.map((st) => (st.position !== undefined ? `${st.color} ${st.position}%` : st.color)).join(', ');
  return grad.type === 'linear'
    ? `background: linear-gradient(${grad.angle ?? 180}deg, ${stops})`
    : `background: radial-gradient(${stops})`;
}

/** Build a `box-shadow` value from a node's `shadows` (structured array) /
 * `shadow` (CSS string). Like gradients, a CSS string handed to `shadows`
 * (instead of the `[{ x, y, blur, color }]` form) previously crashed on
 * `.map`; here it's accepted as a raw value. Returns `null` when neither field
 * yields anything. */
function boxShadowCss(shadows: unknown, shadow: unknown): string | null {
  if (Array.isArray(shadows) && shadows.length > 0) {
    return shadows
      .map((sh) => `${sh.inset ? 'inset ' : ''}${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread ?? 0}px ${sh.color}`)
      .join(', ');
  }
  if (typeof shadows === 'string' && shadows.trim()) return shadows.trim();
  if (typeof shadow === 'string' && shadow.trim()) return shadow.trim();
  return null;
}

const SYSTEM_FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export interface RenderOptions {
  /** Render-ephemeral @font-face entries (Phase 16 — cached families as data:
   * URIs from ensureFontsForRender). Appended after canvas.fonts; never
   * persisted onto the canvas. */
  extraFonts?: FontFace[];
  /** Document-default family (Phase 16 — typography.body token). Prepended to
   * the system stack on <body>. */
  bodyFontFamily?: string;
  /** Phase 24 slice B — emit the skeleton pulse animation. ONLY the live
   * viewer sets this; screenshots/exports/diffs stay static so consecutive
   * renders are byte-comparable (canvas_diff / visual baselines never
   * flicker). */
  skeletonPulse?: boolean;
}

// Registered canvas.fonts family names (lowercased) — a generic shorthand
// ("mono"/"sans") explicitly registered under that label must reach its own
// @font-face rule instead of being aliased away. undefined (not an empty set)
// when canvas.fonts is empty, so aliasFamilyStack's `registered?.has` short-circuits.
function registeredFamilies(canvas?: Canvas): ReadonlySet<string> | undefined {
  const fonts = canvas?.fonts;
  return fonts?.length ? new Set(fonts.map((f) => f.family.toLowerCase())) : undefined;
}

/** What every node's render may read about the document: the canvas (for
 * instances), registered font families, and — Phase 30 slice D — the root's
 * width, the insets the chrome primitives size by, and how far pinned chrome
 * reaches at each edge. All of it comes from the hashed scene. */
interface RenderCtx {
  canvas?: Canvas;
  registered?: ReadonlySet<string>;
  /** The body's max width (the capture width): pinned offsets measure from
   * its left edge, which is where the root starts. */
  bodyWidth: number;
  /** The width pinned elements are capped at: the root's own width when it
   * sets one, never wider than the body. */
  columnWidth: number;
  insets: { top: number; bottom: number };
  reservation: { top: number; bottom: number };
  /** Rendering a direct child of a column document root. */
  rootChild?: boolean;
  /** Rendering a direct child of a sheet, whose panel scrolls: it never shrinks. */
  sheetChild?: boolean;
}

export function renderToHtml(root: SceneNode, width = 1440, height = 900, canvas?: Canvas, opts?: RenderOptions): string {
  const registered = registeredFamilies(canvas);
  const expand = (n: SceneNode) => (n.type === 'instance' && n.componentId && canvas ? resolveInstance(n, canvas) ?? n : n);
  const columnWidth = Math.min(typeof root.width === 'number' ? root.width : width, width);
  const rc: RenderCtx = { canvas, registered, bodyWidth: width, columnWidth, insets: rootInsets(root), reservation: chromeReservation(root, expand) };
  const body = renderNode(root, rc);
  const responsiveCss = buildRendererStylesheet(root, canvas);
  // Phase 24 slice B — the pulse keyframes exist ONLY when the caller opts in
  // (the live viewer). Without them the fs-skeleton class is inert, so every
  // screenshot/export/diff render is static and deterministic.
  const skeletonCss = opts?.skeletonPulse
    ? `  @keyframes fs-skeleton-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
  .fs-skeleton { animation: fs-skeleton-pulse 1.6s ease-in-out infinite; }
`
    : '';
  // Hoist the root's fill/gradient to <html> so wide viewports show the design
  // background instead of browser-default white on the sidebars.
  const rootBg = rootBackgroundCss(root);
  const { preconnect, fontFaceCss } = buildFontHead(canvas, opts?.extraFonts);
  // typography.body token becomes the document default; quote a bare multi-word
  // family, pass a full stack through as-is. Unsafe values fall back silently.
  let bodyFont = SYSTEM_FONT_STACK;
  const tokenFamily = opts?.bodyFontFamily ? aliasFamilyStack(opts.bodyFontFamily, registered).trim() : undefined;
  if (tokenFamily && isSafeFamily(tokenFamily)) {
    const lead = tokenFamily.includes(',') ? tokenFamily : /\s/.test(tokenFamily) ? `"${tokenFamily}"` : tokenFamily;
    bodyFont = `${lead}, ${SYSTEM_FONT_STACK}`;
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${preconnect}<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { min-height: 100vh;${rootBg ? ` ${rootBg};` : ''} }
  body { width: 100%; max-width: ${width}px; min-height: ${height}px; margin: 0 auto; overflow-x: hidden; font-family: ${bodyFont}; }
  img { display: block; max-width: 100%; }
  p { overflow-wrap: break-word; word-wrap: break-word; }
  [data-focusable]:focus-visible { outline: 2px solid var(--fs-ring, #2563EB); outline-offset: 2px; }
${fontFaceCss}${responsiveCss}${skeletonCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

const FONT_FORMAT_BY_EXT: Array<[RegExp, string]> = [
  [/\.woff2(\?|$|#)/i, 'woff2'],
  [/\.woff(\?|$|#)/i, 'woff'],
  [/\.ttf(\?|$|#)/i, 'truetype'],
  [/\.otf(\?|$|#)/i, 'opentype'],
];

// Family is interpolated inside `font-family: "..."` — disallow any char that
// could escape the quoted string or close the declaration.
const ALLOWED_EASINGS = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear']);
// Motion tokens carry custom curves (Phase 25 slice E) — allow the safe shape.
const SAFE_CUBIC_BEZIER = /^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/;
const CSS_IDENT = /^[a-zA-Z][a-zA-Z0-9-]*$/;

// Phase 26 slice A — grid template + placement sanitization. Entries and
// templates that fail the safe shapes are replaced with equal columns /
// dropped — never escaped, never injected (house policy).
const SAFE_GRID_ENTRY = /^([\d.]+(px|fr|%|em|rem)|auto|min-content|max-content|minmax\([\d.]+(px|fr|%|em|rem)?\s*,\s*[\d.]+(px|fr|%|em|rem)?\))$/;
const SAFE_GRID_TEMPLATE = /^[\w\s(),.%-]+$/;
const SAFE_GRID_PLACEMENT = /^(span\s+\d+|\d+(\s*\/\s*(span\s+)?-?\d+)?)$/;

/** Normalize gridColumns to a safe grid-template-columns value. minmax(0, Nfr)
 * instead of bare Nfr so long content can't blow a track past its share. */
function gridTemplateValue(cols: SceneNode['gridColumns'], childCount: number): string {
  const equal = (n: number): string => `repeat(${Math.max(1, Math.round(n))}, minmax(0, 1fr))`;
  if (cols === undefined) return equal(Math.max(1, childCount));
  if (typeof cols === 'number') return equal(cols);
  if (Array.isArray(cols)) {
    const entries = cols.map((c) => (typeof c === 'number' ? `minmax(0, ${c}fr)` : c.trim()));
    const allSafe = cols.every((c, i) => typeof c === 'number' || SAFE_GRID_ENTRY.test(entries[i]));
    return allSafe && entries.length > 0 ? entries.join(' ') : equal(cols.length || childCount);
  }
  return SAFE_GRID_TEMPLATE.test(cols.trim()) ? cols.trim() : equal(childCount);
}

/** Normalize gridColumn/gridRow: a number means "span N". Unsafe → null. */
function gridPlacementValue(v: number | string | undefined): string | null {
  if (v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? `span ${v}` : null;
  const t = v.trim();
  return SAFE_GRID_PLACEMENT.test(t) ? t : null;
}

// Permissive but escape-proof: allow standard SVG path data chars
// (letters that name commands, digits, dots, signs, whitespace, commas)
// while rejecting anything that could break out of the attribute or inject
// SVG/HTML markup.
const SAFE_PATH_D = /^[a-zA-Z0-9\s.,\-+eE]+$/;
const SAFE_VIEWBOX = /^[\d\s.\-]+$/;
// SVG dash patterns: numbers separated by spaces/commas ("6 4", "2,3.5").
const SAFE_DASHARRAY = /^[\d\s.,]+$/;

/** Normalize a strokeDasharray value ("6 4" or [6, 4]) to a safe attribute
 * string, or null when absent/unsafe (unsafe input is dropped, not escaped —
 * same policy as SAFE_PATH_D). */
export function dasharrayValue(v: string | number[] | undefined): string | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    return v.length && v.every((n) => typeof n === 'number' && isFinite(n) && n >= 0) ? v.join(' ') : null;
  }
  return SAFE_DASHARRAY.test(v) ? v : null;
}

function renderPathSvg(node: SceneNode): string {
  if (!node.d || !SAFE_PATH_D.test(node.d)) return '<!-- invalid path d -->';
  const viewBox = node.viewBox && SAFE_VIEWBOX.test(node.viewBox)
    ? node.viewBox
    : `0 0 ${typeof node.width === 'number' ? node.width : 24} ${typeof node.height === 'number' ? node.height : 24}`;

  const pathAttrs: string[] = [`d="${node.d}"`];
  pathAttrs.push(`fill="${escapeAttr(node.fill ?? 'currentColor')}"`);
  if (node.stroke) pathAttrs.push(`stroke="${escapeAttr(node.stroke)}"`);
  if (node.strokeWidth !== undefined) pathAttrs.push(`stroke-width="${node.strokeWidth}"`);
  if (node.strokeLinecap) pathAttrs.push(`stroke-linecap="${node.strokeLinecap}"`);
  if (node.strokeLinejoin) pathAttrs.push(`stroke-linejoin="${node.strokeLinejoin}"`);
  const dash = dasharrayValue(node.strokeDasharray);
  if (dash) pathAttrs.push(`stroke-dasharray="${dash}"`);

  return `<svg width="100%" height="100%" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" style="display: block"><path ${pathAttrs.join(' ')} /></svg>`;
}

// ── chart (Phase 22 slice F, #129) ───────────────────────────────────────────
// Data in, SVG out: the node owns the value→coordinate math so "change one
// data point" is a one-prop edit, not a hand-recomputed path. X positions are
// data indexes; a shorter series stops early against a longer one's range.

/** Neutral categorical ramp for series without an explicit stroke — no purple
 * (the cliché guard is right about defaults). */
const CHART_SERIES_COLORS = ['#2563EB', '#0D9488', '#DC2626', '#D97706', '#64748B'];
const CHART_GRID_COLOR = 'rgba(0, 0, 0, 0.08)';
const CHART_LABEL_COLOR = '#6B7280';
const CHART_LABEL_SIZE = 11;

interface ChartGeom {
  x0: number; y0: number; plotW: number; plotH: number;
  x: (index: number) => number;
  y: (value: number) => number;
}

/** Pure scale math for a chart node — exported for tests. Returns null when
 * there is nothing plottable (no series with >= 1 finite point). */
export function chartGeometry(node: SceneNode, boxW: number, boxH: number): ChartGeom | null {
  const series = chartSeriesData(node);
  if (!series.length) return null;
  const maxLen = Math.max(...series.map((s) => s.data.length));

  const spark = node.kind === 'sparkline';
  const padLeft = !spark && node.yLabels?.length ? 44 : 0;
  const padBottom = !spark && node.xLabels?.length ? 22 : 0;
  const padTop = 4;
  const plotW = Math.max(1, boxW - padLeft - 4);
  const plotH = Math.max(1, boxH - padTop - padBottom);

  const [dx0, dx1] = node.xDomain ?? [0, Math.max(1, maxLen - 1)];
  const values = series.flatMap((s) => s.data);
  let [dy0, dy1] = node.yDomain ?? [Math.min(...values), Math.max(...values)];
  if (!node.yDomain && (node.kind === 'bar' || node.kind === 'sparkline')) dy0 = Math.min(0, dy0);
  if (dy1 === dy0) dy1 = dy0 + 1;

  const xSpan = dx1 - dx0 || 1;
  return {
    x0: padLeft, y0: padTop, plotW, plotH,
    x: (index) => padLeft + ((index - dx0) / xSpan) * plotW,
    y: (value) => padTop + (1 - (value - dy0) / (dy1 - dy0)) * plotH,
  };
}

/** Highlight indices: a single finite number is shorthand for `[n]`; anything
 * else non-array means no emphasis (batch_design warns — see operations.ts). */
function chartHighlight(value: unknown): number[] | null {
  if (typeof value === 'number' && isFinite(value)) return [value];
  if (!Array.isArray(value)) return null;
  return value.filter((n): n is number => typeof n === 'number' && isFinite(n));
}

/** Sanitized series: finite numbers only, empty series dropped, colors defaulted. */
function chartSeriesData(node: SceneNode): Array<{ data: number[]; stroke: string; strokeWidth: number; dash: string | null; area: boolean; points: boolean; highlight: number[] | null; barGradient: boolean }> {
  return (node.series ?? [])
    .filter((s) => s && Array.isArray(s.data))
    .map((s, i) => ({
      data: s.data.filter((v) => typeof v === 'number' && isFinite(v)),
      stroke: s.stroke ?? CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length],
      strokeWidth: s.strokeWidth ?? 2,
      dash: dasharrayValue(s.strokeDasharray),
      area: s.area === true,
      points: s.points === true,
      highlight: chartHighlight(s.highlight),
      barGradient: s.barGradient === true,
    }))
    .filter((s) => s.data.length > 0);
}

/** Catmull-Rom → cubic bezier path through the points (tension 1/6). */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round2(x)} ${round2(y)}`).join(' ');
  let d = `M${round2(pts[0][0])} ${round2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${round2(c1[0])} ${round2(c1[1])}, ${round2(c2[0])} ${round2(c2[1])}, ${round2(p2[0])} ${round2(p2[1])}`;
  }
  return d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Annular-sector path (a donut slice): outer arc, line to inner radius,
 * inner arc back, close. Angles in degrees, 0 = 12 o'clock, clockwise. */
function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const pt = (r: number, deg: number): [number, number] => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [round2(cx + r * Math.cos(rad)), round2(cy + r * Math.sin(rad))];
  };
  const large = a1 - a0 > 180 ? 1 : 0;
  const [ox0, oy0] = pt(rOuter, a0);
  const [ox1, oy1] = pt(rOuter, a1);
  const [ix1, iy1] = pt(rInner, a1);
  const [ix0, iy0] = pt(rInner, a0);
  return `M${ox0} ${oy0} A${rOuter} ${rOuter} 0 ${large} 1 ${ox1} ${oy1} L${ix1} ${iy1} A${rInner} ${rInner} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

/** Phase 28 — the donut kind: data-bound slices + center value/label slots.
 * Legends stay agent-composed frames (layout is design, not charting). */
function renderDonutSvg(node: SceneNode): string {
  const boxW = typeof node.width === 'number' ? node.width : 200;
  const boxH = typeof node.height === 'number' ? node.height : 200;
  const segs = (node.segments ?? []).filter((s) => s && typeof s.value === 'number' && isFinite(s.value) && s.value > 0 && typeof s.color === 'string');
  if (!segs.length) return '<!-- donut: no segments -->';
  const total = segs.reduce((sum, s) => sum + s.value, 0);
  const cx = boxW / 2;
  const cy = boxH / 2;
  const rOuter = Math.min(boxW, boxH) / 2;
  const ratio = typeof node.innerRatio === 'number' && node.innerRatio > 0 && node.innerRatio < 1 ? node.innerRatio : 0.72;
  const rInner = rOuter * ratio;
  const parts: string[] = [];
  let angle = 0;
  for (const s of segs) {
    const sweep = (s.value / total) * 360;
    // A full-circle slice degenerates as one arc — split it in two halves.
    if (sweep >= 359.99) {
      parts.push(`<path d="${donutSlicePath(cx, cy, rOuter, rInner, 0, 180)}" fill="${escapeAttr(s.color)}" />`);
      parts.push(`<path d="${donutSlicePath(cx, cy, rOuter, rInner, 180, 360)}" fill="${escapeAttr(s.color)}" />`);
    } else {
      parts.push(`<path d="${donutSlicePath(cx, cy, rOuter, rInner, angle, angle + sweep)}" fill="${escapeAttr(s.color)}" />`);
    }
    angle += sweep;
  }
  if (typeof node.centerValue === 'string' && node.centerValue) {
    const valueSize = Math.max(12, Math.round(rInner * 0.42));
    const valueColor = escapeAttr(node.color ?? '#111827');
    const hasLabel = typeof node.centerLabel === 'string' && node.centerLabel;
    const vy = hasLabel ? cy - valueSize * 0.12 : cy + valueSize * 0.35;
    parts.push(`<text x="${round2(cx)}" y="${round2(vy)}" font-size="${valueSize}" font-weight="700" fill="${valueColor}" text-anchor="middle" style="font-variant-numeric: tabular-nums">${escapeHtml(node.centerValue)}</text>`);
    if (hasLabel) {
      const labelSize = Math.max(10, Math.round(rInner * 0.18));
      parts.push(`<text x="${round2(cx)}" y="${round2(cy + valueSize * 0.55 + labelSize * 0.6)}" font-size="${labelSize}" fill="${CHART_LABEL_COLOR}" text-anchor="middle">${escapeHtml(node.centerLabel!)}</text>`);
    }
  }
  return `<svg width="100%" height="100%" viewBox="0 0 ${boxW} ${boxH}" xmlns="http://www.w3.org/2000/svg" style="display: block">${parts.join('')}</svg>`;
}

function renderChartSvg(node: SceneNode): string {
  if (node.kind === 'donut') return renderDonutSvg(node);
  const boxW = typeof node.width === 'number' ? node.width : 600;
  const boxH = typeof node.height === 'number' ? node.height : 240;
  const geom = chartGeometry(node, boxW, boxH);
  if (!geom) return '<!-- chart: no plottable series -->';
  const series = chartSeriesData(node);
  const parts: string[] = [];

  // Gridlines: n horizontal hairlines spread evenly, baseline to top inclusive.
  const gridCount = typeof node.gridlines === 'number' && node.gridlines >= 2 ? Math.min(24, Math.floor(node.gridlines)) : 0;
  for (let i = 0; i < gridCount; i++) {
    const gy = round2(geom.y0 + geom.plotH - (i / (gridCount - 1)) * geom.plotH);
    parts.push(`<line x1="${geom.x0}" y1="${gy}" x2="${round2(geom.x0 + geom.plotW)}" y2="${gy}" stroke="${CHART_GRID_COLOR}" stroke-width="1" />`);
  }

  const baselineY = round2(geom.y0 + geom.plotH);
  const spark = node.kind === 'sparkline';
  const barForm = node.kind === 'bar' || (spark && (node.sparkKind ?? 'bar') === 'bar');
  if (barForm) {
    // SVG ids are document-global — scope gradient defs to this node.
    const idBase = `fs-grad-${String(node.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const maxLen = Math.max(...series.map((s) => s.data.length));
    const band = geom.plotW / maxLen;
    const inner = band * (spark ? 0.7 : 0.8);
    const barW = Math.max(1, (inner - 2 * (series.length - 1)) / series.length);
    series.forEach((s, si) => {
      if (s.barGradient) {
        parts.push(`<defs><linearGradient id="${idBase}-${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${escapeAttr(s.stroke)}" stop-opacity="0.85" /><stop offset="100%" stop-color="${escapeAttr(s.stroke)}" stop-opacity="0.15" /></linearGradient></defs>`);
      }
      // Emphasis: explicit highlight indices render solid, the rest muted.
      // A sparkline defaults to emphasizing its latest point.
      const highlight = s.highlight ?? (spark ? [s.data.length - 1] : null);
      const clampY = (y: number) => Math.min(Math.max(y, geom.y0), geom.y0 + geom.plotH);
      const zeroY = clampY(geom.y(0)); // bars grow from the zero line (clamped into the plot)
      s.data.forEach((v, i) => {
        const yv = clampY(geom.y(v));
        const top = Math.min(yv, zeroY);
        const h = Math.max(1, Math.abs(zeroY - yv));
        const bx = geom.x0 + i * band + (band - inner) / 2 + si * (barW + 2);
        const hot = highlight === null || highlight.includes(i);
        const fill = !hot && s.barGradient ? `url(#${idBase}-${si})` : escapeAttr(s.stroke);
        const mute = hot || s.barGradient ? '' : ' fill-opacity="0.3"';
        parts.push(`<rect x="${round2(bx)}" y="${round2(top)}" width="${round2(barW)}" height="${round2(h)}" fill="${fill}"${mute} rx="${spark ? 1 : 2}" />`);
      });
    });
  } else {
    for (const s of series) {
      const pts: Array<[number, number]> = s.data.map((v, i) => [geom.x(i), geom.y(v)]);
      const d = node.curve === 'smooth' ? smoothPath(pts) : pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round2(x)} ${round2(y)}`).join(' ');
      if (s.area && pts.length >= 2) {
        const areaD = `${d} L${round2(pts[pts.length - 1][0])} ${baselineY} L${round2(pts[0][0])} ${baselineY} Z`;
        parts.push(`<path d="${areaD}" fill="${escapeAttr(s.stroke)}" fill-opacity="0.12" stroke="none" />`);
      }
      parts.push(`<path d="${d}" fill="none" stroke="${escapeAttr(s.stroke)}" stroke-width="${s.strokeWidth}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round" />`);
      if (s.points) {
        for (const [px, py] of pts) {
          parts.push(`<circle cx="${round2(px)}" cy="${round2(py)}" r="${s.strokeWidth + 1.5}" fill="${escapeAttr(s.stroke)}" />`);
        }
      }
    }
  }

  // Tick labels: spread evenly along the bottom / left edges (never on sparklines).
  const labelColor = escapeAttr(node.color ?? CHART_LABEL_COLOR);
  for (const [i, label] of ((spark ? [] : node.xLabels) ?? []).entries()) {
    const n = node.xLabels!.length;
    const lx = round2(geom.x0 + (n === 1 ? 0.5 : i / (n - 1)) * geom.plotW);
    parts.push(`<text x="${lx}" y="${round2(baselineY + 16)}" font-size="${CHART_LABEL_SIZE}" fill="${labelColor}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" style="font-variant-numeric: tabular-nums">${escapeHtml(label)}</text>`);
  }
  for (const [i, label] of ((spark ? [] : node.yLabels) ?? []).entries()) {
    const n = node.yLabels!.length;
    const ly = round2(geom.y0 + geom.plotH - (n === 1 ? 0.5 : i / (n - 1)) * geom.plotH);
    parts.push(`<text x="${geom.x0 - 8}" y="${ly + 4}" font-size="${CHART_LABEL_SIZE}" fill="${labelColor}" text-anchor="end" style="font-variant-numeric: tabular-nums">${escapeHtml(label)}</text>`);
  }

  return `<svg width="100%" height="100%" viewBox="0 0 ${boxW} ${boxH}" xmlns="http://www.w3.org/2000/svg" style="display: block" preserveAspectRatio="none">${parts.join('')}</svg>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// CSS values can legitimately contain `"` (e.g. font-family: "Inter") and `&`
// in url() encoded params. Escaping just those two keeps the inline `style`
// attribute well-formed without mangling legitimate CSS syntax. `<`/`>` are
// not escaped because they appear in CSS comparison/feature contexts and
// browsers tolerate them in attribute values.
function escapeStyleValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function composeBackdropFilter(node: SceneNode): string | undefined {
  const bf = node.backdropFilter;
  if (bf) {
    const parts: string[] = [];
    if (typeof bf.blur === 'number') parts.push(`blur(${bf.blur}px)`);
    if (typeof bf.saturate === 'number') parts.push(`saturate(${bf.saturate}%)`);
    if (typeof bf.brightness === 'number') parts.push(`brightness(${bf.brightness}%)`);
    if (typeof bf.contrast === 'number') parts.push(`contrast(${bf.contrast}%)`);
    if (parts.length) return parts.join(' ');
  }
  if (typeof node.backdropBlur === 'number' && node.backdropBlur) {
    return `blur(${node.backdropBlur}px)`;
  }
  return undefined;
}

function isSafeFamily(value: string): boolean {
  return !/["';{}\n\r<>]/.test(value);
}

// URL is interpolated inside `url("...")`. Only chars that would break out of
// that context are dangerous; `;` is legitimate inside data: URIs.
function isSafeUrl(value: string): boolean {
  return !/["\n\r<>]/.test(value);
}

function isValidFontFace(f: FontFace | undefined | null): f is FontFace {
  if (!f || typeof f.family !== 'string' || typeof f.url !== 'string') return false;
  if (!f.family.trim() || !f.url.trim()) return false;
  if (!isSafeFamily(f.family) || !isSafeUrl(f.url)) return false;
  if (!/^(https?:\/\/|data:)/i.test(f.url)) return false;
  return true;
}

function guessFontFormat(url: string): string | undefined {
  for (const [re, fmt] of FONT_FORMAT_BY_EXT) {
    if (re.test(url)) return fmt;
  }
  if (/^data:(font|application)\/(woff2|font-woff2)/i.test(url)) return 'woff2';
  if (/^data:(font|application)\/(woff|font-woff)/i.test(url)) return 'woff';
  return undefined;
}

function buildFontHead(canvas?: Canvas, extraFonts?: FontFace[]): { preconnect: string; fontFaceCss: string } {
  const fonts = [...(canvas?.fonts ?? []), ...(extraFonts ?? [])];
  if (!fonts.length) return { preconnect: '', fontFaceCss: '' };

  const valid = fonts.filter(isValidFontFace);
  if (!valid.length) return { preconnect: '', fontFaceCss: '' };

  // Preconnect to unique remote origins so the TLS handshake overlaps with
  // HTML parsing. Data URIs and same-origin URLs skip this.
  const origins = new Set<string>();
  for (const f of valid) {
    if (!/^https?:\/\//i.test(f.url)) continue;
    try { origins.add(new URL(f.url).origin); } catch {}
  }
  const preconnect = [...origins]
    .map((o) => `<link rel="preconnect" href="${o}" crossorigin>`)
    .join('\n') + (origins.size ? '\n' : '');

  const faces = valid.map((f) => {
    const fmt = guessFontFormat(f.url);
    const src = fmt ? `url("${f.url}") format("${fmt}")` : `url("${f.url}")`;
    const lines = [
      `    font-family: "${f.family}"`,
      `    src: ${src}`,
      `    font-display: swap`,
    ];
    if (f.weight !== undefined) {
      const w = typeof f.weight === 'number' ? f.weight : String(f.weight);
      if (typeof w === 'number' || isSafeFamily(w)) lines.push(`    font-weight: ${w}`);
    }
    if (f.style) lines.push(`    font-style: ${f.style}`);
    return `  @font-face {\n${lines.join(';\n')};\n  }`;
  }).join('\n');

  return { preconnect, fontFaceCss: faces + '\n' };
}

function rootBackgroundCss(root: SceneNode): string {
  const grad = gradientBackgroundCss(root.gradient);
  if (grad) return grad;
  if (root.fill) return `background-color: ${root.fill}`;
  return '';
}

function renderNode(node: SceneNode, rc: RenderCtx): string {
  const { canvas } = rc;
  // Resolve instances: clone the component tree and apply overrides
  if (node.type === 'instance' && node.componentId && canvas) {
    const resolved = resolveInstance(node, canvas);
    if (resolved) return renderNode(resolved, rc);
  }

  // Phase 30 slice D — mobile primitives: fixed anatomy, own builders.
  const primitive = renderPrimitive(node, rc);
  if (primitive !== undefined) return primitive;

  const styles = buildStyles(node, rc);
  const styleAttr = styles ? ` style="${escapeStyleValue(styles)}"` : '';
  const dataAttr = ` data-node-id="${node.id}"`;

  if (node.type === 'text') {
    return `<p${dataAttr}${styleAttr}>${escapeHtml(node.content ?? '')}</p>`;
  }

  if (node.type === 'image') {
    const imgStyles = buildImageStyles(node);
    return `<div${dataAttr}${styleAttr}><img src="${escapeHtml(node.src ?? '')}" style="${escapeStyleValue(imgStyles)}" /></div>`;
  }

  if (node.type === 'icon') {
    const svg = getIconSvg(node.icon ?? '', node.iconSize ?? 24, node.iconColor, node.iconStyle);
    const iconHtml = svg ?? `<!-- unknown icon: ${escapeHtml(node.icon ?? '')} -->`;
    return `<div${dataAttr}${styleAttr}>${iconHtml}</div>`;
  }

  if (node.type === 'path') {
    return `<div${dataAttr}${styleAttr}>${renderPathSvg(node)}</div>`;
  }

  if (node.type === 'chart') {
    return `<div${dataAttr}${styleAttr}>${renderChartSvg(node)}</div>`;
  }

  // Phase 16 — input primitives. Static, deterministic control renders; colors
  // arrive pre-defaulted by resolveVariables (token-aware with neutral
  // fallbacks), so the builders just consume node.fill / stroke / color.
  if (node.type === 'skeleton') return renderSkeleton(node, dataAttr);
  // Phase 27 slice C — controls are focusable in the live viewer, with an
  // accent-derived focus ring (:focus-visible only, so static screenshots
  // are pixel-identical: nothing is focused in a capture).
  // Phase 27 slice C — controls are focusable in the live viewer, with an
  // accent-derived focus ring (:focus-visible only, so static screenshots
  // are pixel-identical: nothing is focused in a capture). The ring color
  // rides a CSS var on the control's own style, keeping one style attribute.
  if (node.type === 'toggle' || node.type === 'checkbox' || node.type === 'radio' || node.type === 'select') {
    const focusAttr = `${dataAttr} tabindex="0" data-focusable`;
    if (node.type === 'toggle') return renderToggle(node, focusAttr);
    if (node.type === 'checkbox') return renderCheckbox(node, focusAttr);
    if (node.type === 'radio') return renderRadio(node, focusAttr);
    return renderSelect(node, focusAttr);
  }

  if (node.type === 'ellipse') {
    // Ensure border-radius: 50% for ellipses
    const ellipseStyles = styles.includes('border-radius') ? styles : styles + '; border-radius: 50%';
    return `<div${dataAttr} style="${escapeStyleValue(ellipseStyles)}">${renderChildren(node, rc)}</div>`;
  }

  return `<div${dataAttr}${styleAttr}>${renderChildren(node, rc)}</div>`;
}

// Exported for drift.ts (Phase 23 slice B): the structural inventory must see
// through instances — an app shell stamped as a component still has controls
// and text the shipped page either has or hasn't.
export function resolveInstance(instance: SceneNode, canvas: Canvas): SceneNode | null {
  const component = canvas.components[instance.componentId!];
  if (!component) return null;

  // Deep clone the component tree
  const clone = structuredClone(component);
  // Give the clone the instance's ID so it's targetable
  clone.id = instance.id;

  // Apply instance-level style overrides to the root
  const { type: _, id: _id, componentId: _cid, overrides: _ov, children: _ch, ...rootOverrides } = instance;
  Object.assign(clone, rootOverrides);

  // Apply named child overrides
  if (instance.overrides) {
    applyOverrides(clone, instance.overrides);
  }

  return clone;
}

function applyOverrides(node: SceneNode, overrides: Record<string, Partial<SceneNode>>): void {
  // Match overrides by node name
  if (node.name && overrides[node.name]) {
    const { type: _, id: _id, children: _ch, ...props } = overrides[node.name];
    Object.assign(node, props);
  }

  if (node.children) {
    for (const child of node.children) {
      applyOverrides(child, overrides);
    }
  }
}

function renderChildren(node: SceneNode, rc: RenderCtx): string {
  if (!node.children?.length) return '';
  const rootChild = node.type === 'document' && node.layout !== 'horizontal' && node.layout !== 'grid';
  const sheetChild = node.type === 'sheet';
  const childRc = rootChild === !!rc.rootChild && sheetChild === !!rc.sheetChild ? rc : { ...rc, rootChild, sheetChild };
  return node.children.map((child) => renderNode(child, childRc)).join('\n');
}

function buildStyles(node: SceneNode, rc: RenderCtx): string {
  const { registered } = rc;
  const s: string[] = [];

  // Dimensions
  if (node.width !== undefined) {
    s.push(`width: ${cssLength(node.width)}`);
    // Auto-shrink fixed-pixel widths to the viewport unless the author opted into
    // an explicit bound — author intent (maxWidth) always wins.
    if (typeof node.width === 'number' && node.maxWidth === undefined) {
      s.push('max-width: 100%');
    }
  }
  if (node.minWidth !== undefined) s.push(`min-width: ${cssLength(node.minWidth)}`);
  if (node.minHeight !== undefined) s.push(`min-height: ${cssLength(node.minHeight)}`);
  if (node.maxWidth !== undefined) s.push(`max-width: ${cssLength(node.maxWidth)}`);
  // Phase 30 slice D — a root child filling the column (`height: "100%"`)
  // takes the space its siblings leave, as it did when the fixed-height root
  // squeezed it; with taller content it grows instead of clipping.
  const fillsRoot = rc.rootChild && node.height === '100%' && node.position !== 'absolute' && node.position !== 'fixed';
  if (fillsRoot) s.push('flex: 1 1 auto', ...(node.minHeight === undefined ? ['min-height: 0'] : []));
  else if (node.height !== undefined) s.push(`height: ${cssLength(node.height)}`);
  if (rc.sheetChild) s.push('flex-shrink: 0');
  // Phase 30 slice D — the root's box is the viewport, and content may be
  // taller: the root grows to its content (keeping its end padding past it,
  // and its children their sizes) while `height: 100%` children still resolve
  // against the artboard. An authored overflow keeps the plain fixed height,
  // and an authored minHeight is the author's own floor.
  if (node.type === 'document' && typeof node.height === 'number' && node.minHeight === undefined
    && (node.overflow === undefined || node.overflow === 'visible')) {
    s.push('min-height: max-content');
  }

  // Layout
  if (node.layout === 'grid') {
    s.push('display: grid', `grid-template-columns: ${gridTemplateValue(node.gridColumns, node.children?.length ?? 1)}`);
    if (typeof node.rowGap === 'number') s.push(`row-gap: ${node.rowGap}px`);
  } else if (node.layout === 'horizontal') {
    s.push('display: flex', 'flex-direction: row');
  } else if (node.layout === 'vertical') {
    s.push('display: flex', 'flex-direction: column');
  } else if (node.type === 'icon') {
    s.push('display: inline-flex', 'align-items: center', 'justify-content: center');
  } else if (node.type === 'document' || node.type === 'frame' || node.type === 'component') {
    // Default to flex column for containers without explicit layout
    if (node.children?.length) {
      s.push('display: flex', 'flex-direction: column');
    }
  }

  if (typeof node.gap === 'number') s.push(`gap: ${node.gap}px`);  // unresolved $refs degrade to no gap
  if (node.wrap || node.responsive === 'wrap') s.push('flex-wrap: wrap');
  if (node.alignItems) s.push(`align-items: ${cssFlexAlign(node.alignItems)}`);
  if (node.justifyContent) s.push(`justify-content: ${cssFlexJustify(node.justifyContent)}`);
  const gridCol = gridPlacementValue(node.gridColumn);
  if (gridCol) s.push(`grid-column: ${gridCol}`);
  const gridRow = gridPlacementValue(node.gridRow);
  if (gridRow) s.push(`grid-row: ${gridRow}`);

  // Padding
  if (node.padding !== undefined) {
    if (typeof node.padding === 'number') {
      s.push(`padding: ${responsivePadding(node.padding)}`);
    } else if (Array.isArray(node.padding) && node.padding.every((p) => typeof p === 'number')) {
      if (node.padding.length === 2) {
        s.push(`padding: ${responsivePadding(node.padding[0] as number)} ${responsivePadding(node.padding[1] as number)}`);
      } else {
        s.push(`padding: ${(node.padding as number[]).map(responsivePadding).join(' ')}`);
      }
    }
  }
  if (node.type === 'document') s.push(...safeAreaPadding(node, rc));

  s.push(...positionStyles(node, rc));

  // Visual. For path nodes, `fill`/`stroke` are SVG path attributes (applied
  // in renderPathSvg) — skip the wrapper-level background/border so the path
  // isn't backed by a colored rectangle.
  const isPath = node.type === 'path';
  const gradCss = gradientBackgroundCss(node.gradient);
  if (gradCss) {
    s.push(gradCss);
  } else if (node.fill && !isPath) {
    s.push(`background-color: ${node.fill}`);
  }
  if (node.stroke && !isPath) s.push(`border: ${node.strokeWidth ?? 1}px ${node.strokeStyle ?? 'solid'} ${node.stroke}`);
  // Per-side borders after the shorthand so each side wins over `stroke` per
  // CSS cascade order (row rules, accent bars — Phase 22 slice A).
  if (!isPath) {
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      const b = node[`border${side}`];
      if (b && typeof b.width === 'number' && b.color) {
        s.push(`border-${side.toLowerCase()}: ${b.width}px ${b.style ?? 'solid'} ${b.color}`);
      }
    }
  }
  if (node.cornerRadius !== undefined) {
    if (typeof node.cornerRadius === 'number') {
      s.push(`border-radius: ${node.cornerRadius}px`);
    } else if (Array.isArray(node.cornerRadius) && node.cornerRadius.every((v) => typeof v === 'number')) {
      s.push(`border-radius: ${(node.cornerRadius as number[]).map((r) => `${r}px`).join(' ')}`);
    }
    // a bare string here is an unresolved $ref — skip rather than emit junk
  }
  if (node.opacity !== undefined) s.push(`opacity: ${node.opacity}`);
  if (node.overflow) s.push(`overflow: ${node.overflow}`);
  if (node.textOverflow === 'ellipsis') {
    // min-width 0 lets flex rows shrink the text below content size so the
    // ellipsis actually engages; max-width caps it in stretch-less columns.
    s.push('white-space: nowrap', 'overflow: hidden', 'text-overflow: ellipsis', 'min-width: 0', 'max-width: 100%');
  }
  const shadowCss = boxShadowCss(node.shadows, node.shadow);
  if (shadowCss) s.push(`box-shadow: ${shadowCss}`);
  if (node.blur) s.push(`filter: blur(${node.blur}px)`);

  // Animation: emit shorthand only if the keyframe name is in the built-in
  // library; unknown names are silently ignored (defense in depth on top of
  // the literal-union type).
  if (node.animation && isValidKeyframeName(node.animation.name)) {
    const a = node.animation;
    const duration = typeof a.duration === 'number' ? a.duration : 300;
    const delay = typeof a.delay === 'number' ? a.delay : 0;
    const easing = ALLOWED_EASINGS.has(a.easing ?? '') ? a.easing : 'ease-out';
    const iter = a.iteration === 'infinite' || typeof a.iteration === 'number' ? a.iteration : 1;
    s.push(`animation: ${a.name} ${duration}ms ${easing} ${delay}ms ${iter} normal both`);
  }

  // Transition: validate property name + easing; ignore the field entirely if
  // anything looks suspicious.
  if (node.transition && typeof node.transition === 'object' && typeof node.transition.duration === 'number') {
    const t = node.transition;
    const prop = t.property && CSS_IDENT.test(t.property) ? t.property : 'all';
    const easing = ALLOWED_EASINGS.has(t.easing ?? '') || SAFE_CUBIC_BEZIER.test(t.easing ?? '') ? t.easing : 'ease';
    const delay = typeof t.delay === 'number' ? `${t.delay}ms` : '0ms';
    s.push(`transition: ${prop} ${t.duration}ms ${easing} ${delay}`);
  }

  const backdrop = composeBackdropFilter(node);
  if (backdrop) {
    // Safari ships the unprefixed property behind a flag; emit both so
    // glassmorphism actually renders in Safari/iOS without extra author effort.
    s.push(`-webkit-backdrop-filter: ${backdrop}`);
    s.push(`backdrop-filter: ${backdrop}`);
  }

  // Text
  if (node.fontSize) s.push(`font-size: ${responsiveFontSize(node.fontSize)}`);
  if (node.fontFamily) s.push(`font-family: ${aliasFamilyStack(node.fontFamily, registered)}`); // "mono"/"sans" → CSS generics unless registered under that label (#134)
  if (node.fontWeight) s.push(`font-weight: ${node.fontWeight}`);
  if (node.color) s.push(`color: ${node.color}`);
  if (node.textAlign) s.push(`text-align: ${node.textAlign}`);
  if (node.lineHeight !== undefined) {
    s.push(`line-height: ${typeof node.lineHeight === 'number' ? node.lineHeight : node.lineHeight}`);
  }
  if (node.letterSpacing !== undefined) s.push(`letter-spacing: ${node.letterSpacing}px`);
  if (node.tabularNums) s.push('font-variant-numeric: tabular-nums');
  if (node.textDecoration) s.push(`text-decoration: ${node.textDecoration}`);
  if (node.textTransform) s.push(`text-transform: ${node.textTransform}`);
  if (node.fontVariationSettings) s.push(`font-variation-settings: ${node.fontVariationSettings}`);

  return s.join('; ');
}

// ── input primitives (Phase 16) ──────────────────────────────────────────────
// Hand-rolled style strings: controls are leaf nodes with fixed internal
// anatomy, so the generic buildStyles pipeline (layout/gap/padding) doesn't
// apply. Shared bits: numeric width/height with control-appropriate defaults,
// opacity passthrough (resolveVariables sets 0.5 for disabled).

/** Focus-ring color for a control: its strongest own color, accent-flavored
 * when checked. Consumed by the [data-focusable]:focus-visible rule. */
function focusRing(node: SceneNode): string {
  const ring = (node.checked ? node.fill : undefined) ?? node.stroke ?? node.fill ?? '#2563EB';
  return `--fs-ring: ${ring}`;
}

function controlSize(node: SceneNode, defW: number, defH: number): { w: number; h: number } {
  return {
    w: typeof node.width === 'number' ? node.width : defW,
    h: typeof node.height === 'number' ? node.height : defH,
  };
}

function controlOpacity(node: SceneNode): string[] {
  return node.opacity !== undefined ? [`opacity: ${node.opacity}`] : [];
}

// Phase 24 slice B — loading-placeholder block. Leaf node, hand-rolled styles
// (generic buildStyles doesn't apply); fill arrives pre-defaulted by
// resolveVariables (skeleton → border → translucent neutral). The fs-skeleton
// class only animates when the document opted into the pulse keyframes.
function renderSkeleton(node: SceneNode, dataAttr: string): string {
  const dim = (v: number | string | undefined, fallback: string): string =>
    v === undefined ? fallback : typeof v === 'number' ? `${v}px` : v;
  const radius = node.cornerRadius === undefined
    ? '6px'
    : typeof node.cornerRadius === 'number' ? `${node.cornerRadius}px` : String(node.cornerRadius);
  const cls = node.pulse === false ? '' : ' class="fs-skeleton"';
  const s = [
    'flex-shrink: 0',
    `width: ${dim(node.width, '100%')}`,
    `height: ${dim(node.height, '12px')}`,
    `border-radius: ${radius}`,
    `background-color: ${node.fill}`,
    ...(node.opacity !== undefined ? [`opacity: ${node.opacity}`] : []),
  ].join('; ');
  return `<div${dataAttr}${cls} style="${escapeStyleValue(s)}"></div>`;
}

function renderToggle(node: SceneNode, dataAttr: string): string {
  const { w, h } = controlSize(node, 44, 24);
  const inset = Math.max(Math.round(h * 0.125), 2);
  const knob = h - inset * 2;
  const left = node.checked ? w - knob - inset : inset;
  const track = [
    focusRing(node),
    'position: relative', 'flex-shrink: 0',
    `width: ${w}px`, `height: ${h}px`, `border-radius: ${h / 2}px`,
    `background-color: ${node.fill}`,
    'transition: background-color 0.15s ease',
    ...controlOpacity(node),
  ].join('; ');
  const knobStyle = [
    'position: absolute', `top: ${inset}px`, `left: ${left}px`,
    `width: ${knob}px`, `height: ${knob}px`, 'border-radius: 50%',
    'background-color: #FFFFFF', 'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25)',
  ].join('; ');
  return `<div${dataAttr} style="${escapeStyleValue(track)}"><div style="${escapeStyleValue(knobStyle)}"></div></div>`;
}

function renderCheckbox(node: SceneNode, dataAttr: string): string {
  const { w, h } = controlSize(node, 18, 18);
  const radius = node.cornerRadius !== undefined && typeof node.cornerRadius === 'number' ? node.cornerRadius : 4;
  const box = [
    focusRing(node),
    'flex-shrink: 0', 'display: flex', 'align-items: center', 'justify-content: center',
    `width: ${w}px`, `height: ${h}px`, `border-radius: ${radius}px`,
    `border: 1.5px solid ${node.stroke}`, `background-color: ${node.fill}`,
    ...controlOpacity(node),
  ].join('; ');
  const mark = node.checked ? (getIconSvg('check', Math.round(Math.min(w, h) * 0.78), '#FFFFFF') ?? '') : '';
  return `<div${dataAttr} style="${escapeStyleValue(box)}">${mark}</div>`;
}

function renderRadio(node: SceneNode, dataAttr: string): string {
  const { w, h } = controlSize(node, 18, 18);
  const ring = [
    focusRing(node),
    'flex-shrink: 0', 'display: flex', 'align-items: center', 'justify-content: center',
    `width: ${w}px`, `height: ${h}px`, 'border-radius: 50%',
    `border: 1.5px solid ${node.stroke}`, 'background-color: transparent',
    ...controlOpacity(node),
  ].join('; ');
  const dotSize = Math.max(Math.round(Math.min(w, h) * 0.45), 4);
  const dot = node.checked
    ? `<div style="${escapeStyleValue(`width: ${dotSize}px; height: ${dotSize}px; border-radius: 50%; background-color: ${node.fill}`)}"></div>`
    : '';
  return `<div${dataAttr} style="${escapeStyleValue(ring)}">${dot}</div>`;
}

function renderSelect(node: SceneNode, dataAttr: string): string {
  const width = node.width !== undefined ? cssLength(node.width) : 'fit-content';
  const radius = node.cornerRadius !== undefined && typeof node.cornerRadius === 'number' ? node.cornerRadius : 8;
  const fontSize = typeof node.fontSize === 'number' ? node.fontSize : 14;
  const isPlaceholder = !node.value;
  const textColor = isPlaceholder ? '#9CA3AF' : node.color;
  const frame = [
    focusRing(node),
    'display: flex', 'flex-direction: row', 'align-items: center', 'justify-content: space-between',
    'gap: 8px', 'padding: 8px 12px', `width: ${width}`,
    ...(typeof node.height === 'number' ? [`height: ${node.height}px`] : []),
    `border-radius: ${radius}px`, `border: 1px solid ${node.stroke}`,
    `background-color: ${node.fill}`,
    ...controlOpacity(node),
  ].join('; ');
  const label = `<span style="${escapeStyleValue(`font-size: ${fontSize}px; color: ${textColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`)}">${escapeHtml(node.value ?? 'Select…')}</span>`;
  const chevron = getIconSvg('chevron-down', Math.round(fontSize * 1.15), textColor) ?? '';
  return `<div${dataAttr} style="${escapeStyleValue(frame)}">${label}${chevron}</div>`;
}

// ── mobile primitives (Phase 30 slice D) ─────────────────────────────────────
// Fixed anatomy like the controls: each builder hand-rolls its styles from
// src/primitives.ts geometry, and colours arrive pre-defaulted by
// resolveVariables (the fallbacks below only serve a primitive that skipped
// it, such as one inside a component). Every primitive refuses to
// flex-shrink, so it keeps its size in a fixed-height column. Labels sit in
// `data-fs-label` elements that truncate to one line — canvas_stress reads
// their overflow as designed truncation.

const FALLBACK = { accent: '#2563EB', text: '#111827', secondary: '#6B7280', border: '#D1D5DB', surface: '#FFFFFF', danger: '#DC2626' } as const;

function renderPrimitive(node: SceneNode, rc: RenderCtx): string | undefined {
  const dataAttr = ` data-node-id="${node.id}" data-fs-primitive`;
  switch (node.type) {
    case 'status-bar': return renderStatusBar(node, rc, dataAttr);
    case 'home-indicator': return renderHomeIndicator(node, rc, dataAttr);
    case 'nav-bar': return renderNavBar(node, rc, dataAttr);
    case 'tab-bar': return renderTabBar(node, rc, dataAttr);
    case 'button': return renderButton(node, rc, `${dataAttr} tabindex="0" data-focusable`);
    case 'list-row': return renderListRow(node, rc, dataAttr);
    case 'sheet': return renderSheet(node, rc, dataAttr);
    default: return undefined;
  }
}

/** Join style declarations, dropping the absent ones. */
const css = (parts: Array<string | false | undefined>): string =>
  escapeStyleValue(parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('; '));

/** A prop as text: agents send numbers for labels and badges. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Plain-object entries of an array prop (a null entry is skipped). */
function entries<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((v): v is T => !!v && typeof v === 'object') : [];
}

const LABEL_CSS = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 100%';

function labelHtml(value: string, style: string): string {
  return `<span data-fs-label style="${escapeStyleValue(`${LABEL_CSS}; ${style}`)}">${escapeHtml(value)}</span>`;
}

function iconHtml(name: unknown, size: number, color: string | undefined): string {
  const ref = text(name);
  if (!ref) return '';
  return getIconSvg(ref, size, color) ?? `<!-- unknown icon: ${escapeHtml(ref)} -->`;
}

/** A badge shows unless it is empty or zero. */
function badgeText(value: unknown): string {
  const t = text(value);
  return t === '0' ? '' : t;
}

/** Chrome glyph colour: appearance wins, else the defaulted `color`. */
function chromeColor(node: SceneNode): string {
  return node.appearance === 'dark' ? '#000000' : node.appearance === 'light' ? '#FFFFFF' : node.color ?? FALLBACK.text;
}

// Status-bar glyphs (bundled — no dependency): cellular bars, wifi, battery.
const SIGNAL_SVG = (c: string) => `<svg width="18" height="12" viewBox="0 0 18 12" xmlns="http://www.w3.org/2000/svg" style="display: block"><rect x="0" y="8" width="3" height="4" rx="1" fill="${c}"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="${c}"/><rect x="10" y="3" width="3" height="9" rx="1" fill="${c}"/><rect x="15" y="0" width="3" height="12" rx="1" fill="${c}"/></svg>`;
const WIFI_SVG = (c: string) => `<svg width="16" height="12" viewBox="0 0 16 12" xmlns="http://www.w3.org/2000/svg" style="display: block"><path d="M8 2.6c2.2 0 4.2.8 5.7 2.2l1.2-1.3C13.1 1.8 10.7.8 8 .8S2.9 1.8 1.1 3.5l1.2 1.3C3.8 3.4 5.8 2.6 8 2.6z" fill="${c}"/><path d="M8 6c1.3 0 2.5.5 3.4 1.3l1.2-1.3C11.4 4.9 9.8 4.2 8 4.2S4.6 4.9 3.4 6l1.2 1.3C5.5 6.5 6.7 6 8 6z" fill="${c}"/><path d="M8 9.4c.5 0 .9.2 1.2.5L8 11.2 6.8 9.9c.3-.3.7-.5 1.2-.5z" fill="${c}"/></svg>`;
const BATTERY_SVG = (c: string) => `<svg width="27" height="13" viewBox="0 0 27 13" xmlns="http://www.w3.org/2000/svg" style="display: block"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="${c}" stroke-opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="${c}"/><path d="M25 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2z" fill="${c}" fill-opacity="0.4"/></svg>`;

function renderStatusBar(node: SceneNode, rc: RenderCtx, dataAttr: string): string {
  const c = escapeAttr(chromeColor(node));
  const box = css([
    ...positionStyles(node, rc), 'flex-shrink: 0', 'width: 100%', `height: ${chromeHeight(node, rc.insets)}px`,
    'display: flex', 'align-items: center', 'justify-content: space-between', 'padding: 0 26px 0 32px',
    `color: ${chromeColor(node)}`, node.fill ? `background-color: ${node.fill}` : undefined,
  ]);
  const time = `<span style="font-size: 15px; font-weight: 600; letter-spacing: -0.2px; font-variant-numeric: tabular-nums">${escapeHtml(text(node.time) || '9:41')}</span>`;
  return `<div${dataAttr} style="${box}">${time}<span style="display: flex; align-items: center; gap: 6px">${SIGNAL_SVG(c)}${WIFI_SVG(c)}${BATTERY_SVG(c)}</span></div>`;
}

function renderHomeIndicator(node: SceneNode, rc: RenderCtx, dataAttr: string): string {
  const box = css([
    ...positionStyles(node, rc), 'flex-shrink: 0', 'width: 100%', `height: ${chromeHeight(node, rc.insets)}px`,
    'display: flex', 'align-items: flex-end', 'justify-content: center', 'padding-bottom: 8px', 'pointer-events: none',
    node.fill ? `background-color: ${node.fill}` : undefined,
  ]);
  return `<div${dataAttr} style="${box}"><div style="${css(['width: 134px', 'height: 5px', 'border-radius: 3px', `background-color: ${chromeColor(node)}`])}"></div></div>`;
}

function navAction(action: { icon?: unknown; label?: unknown }, color: string, back: boolean): string {
  const glyph = iconHtml(action.icon ?? (back ? 'chevron-left' : undefined), 24, color);
  const words = text(action.label) ? labelHtml(text(action.label), 'font-size: 17px') : '';
  return `<div style="${css([
    'display: flex', 'align-items: center', 'justify-content: center', 'gap: 2px', 'flex-shrink: 0',
    `min-width: ${NAV_ACTION}px`, `height: ${NAV_ACTION}px`, words ? 'padding: 0 8px' : undefined, `color: ${color}`,
  ])}">${glyph}${words}</div>`;
}

function renderNavBar(node: SceneNode, rc: RenderCtx, dataAttr: string): string {
  const action = node.iconColor ?? FALLBACK.accent;
  const leading = node.leading && typeof node.leading === 'object' ? node.leading : undefined;
  const trailing = entries<{ icon?: unknown; label?: unknown }>(node.trailing).slice(0, 2);
  const title = text(node.title);
  const box = css([
    ...positionStyles(node, rc), 'flex-shrink: 0', node.width !== undefined ? `width: ${cssLength(node.width)}` : 'width: 100%',
    `height: ${navBarHeight(node)}px`, 'display: flex', 'flex-direction: column',
    `color: ${node.color ?? FALLBACK.text}`, node.fill ? `background-color: ${node.fill}` : undefined,
  ]);
  // Equal-flex sides keep the title centred; it truncates before it can
  // collide with a wide action.
  const side = (justify: string, inner: string) =>
    `<div style="${css(['flex: 1 1 0', 'min-width: 0', 'display: flex', 'align-items: center', `justify-content: ${justify}`])}">${inner}</div>`;
  const centred = !node.largeTitle && title
    ? `<div style="${css(['flex: 0 1 auto', 'min-width: 0', 'display: flex', 'justify-content: center', 'padding: 0 4px'])}">${labelHtml(title, 'font-size: 17px; font-weight: 600')}</div>`
    : '';
  const row = `<div style="${css(['display: flex', 'align-items: center', `height: ${NAV_ACTION}px`, 'padding: 0 4px'])}">`
    + side('flex-start', leading ? navAction(leading, action, true) : '')
    + centred
    + side('flex-end', trailing.map((a) => navAction(a, action, false)).join('')) + '</div>';
  const large = node.largeTitle
    ? `<div style="${css([`height: ${NAV_BAR_LARGE_HEIGHT - NAV_BAR_HEIGHT}px`, 'display: flex', 'align-items: center', 'padding: 0 16px'])}">${labelHtml(title, 'font-size: 34px; font-weight: 700; letter-spacing: -0.4px')}</div>`
    : '';
  return `<div${dataAttr} style="${box}">${row}${large}</div>`;
}

function tabItem(item: { icon?: unknown; label?: unknown; active?: unknown; badge?: unknown }, node: SceneNode): string {
  const color = item.active ? node.iconColor ?? FALLBACK.accent : node.color ?? FALLBACK.secondary;
  const count = badgeText(item.badge);
  const badge = count
    ? `<span style="${css(['position: absolute', 'top: -4px', 'left: 16px', 'min-width: 16px', 'height: 16px', 'padding: 0 4px', 'border-radius: 8px', `background-color: ${node.badgeColor ?? FALLBACK.danger}`, 'color: #FFFFFF', 'font-size: 11px', 'font-weight: 600', 'line-height: 16px', 'text-align: center'])}">${escapeHtml(count)}</span>`
    : '';
  const words = text(item.label);
  return `<div style="${css(['flex: 1 1 0', 'min-width: 0', 'display: flex', 'flex-direction: column', 'align-items: center', 'justify-content: center', 'gap: 2px', `color: ${color}`])}">`
    + `<span style="position: relative; display: flex">${iconHtml(item.icon, 24, color)}${badge}</span>`
    + `${words ? labelHtml(words, 'font-size: 11px; font-weight: 500; line-height: 13px') : ''}</div>`;
}

function renderTabBar(node: SceneNode, rc: RenderCtx, dataAttr: string): string {
  const items = entries<Parameters<typeof tabItem>[0]>(node.items);
  const fill = node.fill ?? FALLBACK.surface;
  const border = node.stroke ?? FALLBACK.border;
  const variant = node.variant === 'floating' || node.variant === 'fab' ? node.variant : 'standard';
  const slots = items.map((it) => tabItem(it, node));
  if (variant === 'fab') {
    const accent = node.iconColor ?? FALLBACK.accent;
    // The row starts below the band's 1px top border, so the FAB rises one
    // more pixel to sit FAB_RAISE above the band's edge.
    const fab = `<div style="${css(['flex: 1 1 0', 'min-width: 0', 'position: relative'])}"><div style="${css([
      'position: absolute', 'left: 50%', `top: -${FAB_RAISE + 1}px`, `margin-left: -${FAB_SIZE / 2}px`, `width: ${FAB_SIZE}px`, `height: ${FAB_SIZE}px`,
      'border-radius: 50%', `background-color: ${accent}`, 'display: flex', 'align-items: center', 'justify-content: center',
      'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18)',
    ])}">${iconHtml(node.fab?.icon ?? 'plus', 24, '#FFFFFF')}</div></div>`;
    slots.splice(Math.ceil(items.length / 2), 0, fab);
  }
  const row = `<div style="${css(['display: flex', `height: ${TAB_BAND}px`, 'align-items: stretch'])}">${slots.join('')}</div>`;
  const outer = [...positionStyles(node, rc), 'flex-shrink: 0', node.width !== undefined ? `width: ${cssLength(node.width)}` : 'width: 100%', `height: ${chromeHeight(node, rc.insets)}px`];
  if (variant === 'floating') {
    const pill = css([`height: ${TAB_BAND}px`, `border-radius: ${TAB_BAND / 2}px`, `background-color: ${fill}`, `border: 1px solid ${border}`, 'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12)', 'overflow: hidden']);
    return `<div${dataAttr} style="${css([...outer, `padding: 0 ${FLOATING_INSET}px`])}"><div style="${pill}">${row}</div></div>`;
  }
  const band = [`background-color: ${fill}`, `border-top: 1px solid ${border}`];
  if (variant === 'fab') {
    return `<div${dataAttr} style="${css([...outer, `padding-top: ${FAB_RAISE}px`])}"><div style="${css([...band, 'height: 100%'])}">${row}</div></div>`;
  }
  return `<div${dataAttr} style="${css([...outer, ...band])}">${row}</div>`;
}

function renderButton(node: SceneNode, rc: RenderCtx, attrs: string): string {
  const size = node.size === 'sm' || node.size === 'lg' ? node.size : 'md';
  const h = buttonHeight(node);
  const words = text(node.label) ? labelHtml(text(node.label), '') : '';
  // Unthemed (a button inside a component skips resolveVariables): the
  // primary look, so it is never an invisible white-on-transparent label.
  const fill = node.fill ?? (node.variant === 'secondary' || node.variant === 'ghost' ? 'transparent' : node.variant === 'destructive' ? FALLBACK.danger : FALLBACK.accent);
  const color = node.color ?? (fill === 'transparent' ? FALLBACK.accent : '#FFFFFF');
  const glyph = iconHtml(node.icon, size === 'sm' ? 16 : 20, color);
  const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 8;
  const box = css([
    `--fs-ring: ${fill !== 'transparent' ? fill : color}`,
    ...positionStyles(node, rc), 'display: inline-flex', 'flex-shrink: 0', 'align-items: center', 'justify-content: center', 'gap: 8px',
    `height: ${h}px`, `min-height: ${h}px`, `min-width: ${h}px`,
    words ? (node.width !== undefined ? `width: ${cssLength(node.width)}` : 'width: fit-content') : `width: ${h}px`,
    // A long label truncates inside the column instead of running past it.
    words && node.maxWidth === undefined ? 'max-width: 100%' : undefined,
    words ? `padding: 0 ${BUTTON_PADDING[size]}px` : 'padding: 0',
    `border-radius: ${radius}px`, `background-color: ${fill}`,
    node.stroke ? `border: 1px solid ${node.stroke}` : undefined,
    `color: ${color}`, `font-size: ${BUTTON_FONT[size]}px`, 'font-weight: 600', 'white-space: nowrap',
    node.opacity !== undefined ? `opacity: ${node.opacity}` : undefined,
  ]);
  const parts = node.iconPosition === 'trailing' ? `${words}${glyph}` : `${glyph}${words}`;
  return `<div${attrs} style="${box}">${parts}</div>`;
}

function listRowTrailing(node: SceneNode): string {
  const t = node.trailing;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return '';
  const secondary = node.secondaryColor ?? FALLBACK.secondary;
  // A short accessory keeps its width; only a long one truncates (at half the row).
  if (text(t.text)) return `<div style="flex: 0 1 auto; min-width: 0; max-width: 50%; display: flex">${labelHtml(text(t.text), `font-size: 15px; color: ${secondary}`)}</div>`;
  if (t.chevron) return `<div style="flex-shrink: 0; display: flex">${iconHtml('chevron-right', 18, secondary)}</div>`;
  if (typeof t.toggle === 'boolean') {
    const track = t.toggle ? node.iconColor ?? FALLBACK.accent : node.stroke ?? FALLBACK.border;
    return `<div style="${css(['position: relative', 'flex-shrink: 0', 'width: 44px', 'height: 24px', 'border-radius: 12px', `background-color: ${track}`])}"><div style="${css(['position: absolute', 'top: 3px', `left: ${t.toggle ? 23 : 3}px`, 'width: 18px', 'height: 18px', 'border-radius: 50%', 'background-color: #FFFFFF', 'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25)'])}"></div></div>`;
  }
  const count = badgeText(t.badge);
  if (count) {
    return `<span style="${css(['flex-shrink: 0', 'min-width: 20px', 'height: 20px', 'padding: 0 6px', 'border-radius: 10px', `background-color: ${node.badgeColor ?? node.iconColor ?? FALLBACK.accent}`, 'color: #FFFFFF', 'font-size: 12px', 'font-weight: 600', 'line-height: 20px', 'text-align: center'])}">${escapeHtml(count)}</span>`;
  }
  return '';
}

function listRowLeading(node: SceneNode): string {
  const l = node.leading;
  if (!l || typeof l !== 'object') return '';
  // Every leading kind takes the same 32px slot, so titles align down a list.
  const slot = ['flex-shrink: 0', 'width: 32px', 'height: 32px'];
  if (text(l.icon)) return `<div style="${css([...slot, 'display: flex', 'align-items: center', 'justify-content: center'])}">${iconHtml(l.icon, 22, node.iconColor)}</div>`;
  const circle = [...slot, 'border-radius: 50%'];
  if (text(l.image)) return `<img src="${escapeHtml(text(l.image))}" style="${css([...circle, 'object-fit: cover', 'display: block'])}" />`;
  if (text(l.initials)) {
    return `<div style="${css([...circle, 'display: flex', 'align-items: center', 'justify-content: center', `background-color: ${node.stroke ?? FALLBACK.border}`, 'font-size: 13px', 'font-weight: 600'])}">${escapeHtml(text(l.initials).slice(0, 3))}</div>`;
  }
  return '';
}

function renderListRow(node: SceneNode, rc: RenderCtx, dataAttr: string): string {
  const position = effectivePosition(node);
  const box = css([
    ...positionStyles(node, rc), position ? undefined : 'position: relative',
    'display: flex', 'flex-direction: row', 'align-items: center', 'gap: 12px', 'flex-shrink: 0',
    `min-height: ${listRowMinHeight(node)}px`, typeof node.height === 'number' ? `height: ${node.height}px` : undefined,
    'padding: 6px 16px', node.width !== undefined ? `width: ${cssLength(node.width)}` : 'align-self: stretch',
    node.fill ? `background-color: ${node.fill}` : undefined, `color: ${node.color ?? FALLBACK.text}`,
    node.opacity !== undefined ? `opacity: ${node.opacity}` : undefined,
  ]);
  const subtitle = text(node.subtitle);
  const words = `<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px">`
    + labelHtml(text(node.title), 'font-size: 16px; line-height: 1.3')
    + (subtitle ? labelHtml(subtitle, `font-size: 14px; line-height: 1.3; color: ${node.secondaryColor ?? FALLBACK.secondary}`) : '')
    + '</div>';
  const divider = node.divider
    ? `<div style="${css(['position: absolute', 'left: 16px', 'right: 0', 'bottom: 0', 'height: 1px', `background-color: ${node.stroke ?? FALLBACK.border}`])}"></div>`
    : '';
  return `<div${dataAttr} style="${box}">${listRowLeading(node)}${words}${listRowTrailing(node)}${divider}</div>`;
}

/** The four authored padding sides as CSS (fluid like every padding). */
function paddingCss(padding: SceneNode['padding']): [string, string, string, string] {
  const px = (v: unknown) => (typeof v === 'number' ? responsivePadding(v) : '0px');
  if (typeof padding === 'number') { const v = px(padding); return [v, v, v, v]; }
  if (!Array.isArray(padding) || !padding.length || !padding.every((p) => typeof p === 'number')) return ['0px', '0px', '0px', '0px'];
  const [a, b = a, c = a, d = b] = padding;
  return [px(a), px(b), px(c), px(d)];
}

function renderSheet(node: SceneNode, rc: RenderCtx, dataAttr: string): string {
  const column = [`left: max(0px, (100% - ${rc.bodyWidth}px) / 2)`, 'width: 100%', `max-width: ${rc.columnWidth}px`, 'z-index: 30'];
  const scrim = `<div style="${css(['position: fixed', 'top: 0', 'bottom: 0', ...column, 'background-color: rgba(0, 0, 0, 0.4)'])}"></div>`;
  const [pt, pr, pb, pl] = paddingCss(node.padding);
  const grabber = node.grabber !== false;
  const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 12;
  const reach = rc.insets.top + 10;
  const detent = node.detent === 'medium' ? 'height: 50%' : node.detent === 'large' ? `top: ${reach}px` : `max-height: calc(100% - ${reach}px)`;
  const panel = css([
    'position: fixed', 'bottom: 0', ...column, detent, 'display: flex', 'flex-direction: column',
    typeof node.gap === 'number' ? `gap: ${node.gap}px` : undefined,
    `padding: ${grabber ? `calc(${pt} + 16px)` : pt} ${pr} calc(${pb} + ${rc.insets.bottom}px) ${pl}`,
    `background-color: ${node.fill ?? FALLBACK.surface}`, `border-radius: ${radius}px ${radius}px 0 0`, 'overflow-y: auto',
  ]);
  const grab = grabber
    ? `<div style="${css(['position: absolute', 'top: 6px', 'left: 50%', 'margin-left: -18px', 'width: 36px', 'height: 5px', 'border-radius: 3px', `background-color: ${node.stroke ?? 'rgba(127, 127, 127, 0.4)'}`])}"></div>`
    : '';
  // Its children never shrink (renderChildren marks them), so when they
  // outgrow the panel it scrolls instead of squeezing them.
  return `${scrim}<div${dataAttr} data-fs-scroll style="${panel}">${grab}${renderChildren(node, rc)}</div>`;
}

function buildImageStyles(node: SceneNode): string {
  const s: string[] = ['width: 100%', 'height: 100%'];
  if (node.objectFit) s.push(`object-fit: ${node.objectFit}`);
  else s.push('object-fit: cover');
  return s.join('; ');
}

function cssLength(v: number | string): string {
  return typeof v === 'number' ? `${v}px` : v;
}

// Canonical design width — matches the default screenshot viewport.
// Used to express padding/font as a fraction of viewport so narrower
// breakpoints shrink the value proportionally.
const DESIGN_WIDTH = 1440;
const PADDING_SCALE_MIN = 32;
const FONT_SCALE_MIN = 24;

// Mobile breakpoint for the `responsive: 'stack'` hint. 767 = one below the
// tablet preset of 768, matching Bootstrap/Tailwind where 768 is the start of
// the desktop band. `@media (max-width: 767px)` is inclusive of 767 and below,
// so the tablet preset at exactly 768 stays in the row layout.
const MOBILE_BREAKPOINT = 767;

// Built-in keyframes library. Emitted only when a node references the name.
// Each ends at opacity:1 + identity transform; pair with `animation-fill-mode:
// both` (set inline by buildStyles) so the start state applies pre-animation
// and the end state sticks after.
const KEYFRAME_LIBRARY: Record<string, string> = {
  fadeIn: `  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }`,
  slideUp: `  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }`,
  slideDown: `  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }`,
  scaleIn: `  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }`,
};

export function isValidKeyframeName(name: string): name is keyof typeof KEYFRAME_LIBRARY {
  return name in KEYFRAME_LIBRARY;
}

function buildRendererStylesheet(root: SceneNode, canvas?: Canvas): string {
  const stackIds: string[] = [];
  const gridStackIds: string[] = [];
  const relativeIds = new Set<string>();
  const keyframes = new Set<string>();
  collectRendererHints(root, [], canvas, stackIds, gridStackIds, relativeIds, keyframes);

  const parts: string[] = [];

  for (const name of keyframes) {
    const block = KEYFRAME_LIBRARY[name];
    if (block) parts.push(block);
  }

  if (relativeIds.size > 0) {
    // Auto-inject position: relative on the nearest container ancestor of any
    // node with position: absolute that lacks a positioned ancestor. External
    // CSS only applies when the inline style doesn't set `position`, so this
    // never overrides an explicit author choice.
    const sel = [...relativeIds].map((id) => `[data-node-id="${id}"]`).join(', ');
    parts.push(`  ${sel} { position: relative; }`);
  }

  if (stackIds.length > 0) {
    // !important is required because inline styles (flex-direction: row) would
    // otherwise win over the @media rule regardless of selector specificity.
    const sel = stackIds.map((id) => `[data-node-id="${id}"]`).join(', ');
    parts.push(`  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    ${sel} { flex-direction: column !important; }
  }`);
  }

  if (gridStackIds.length > 0) {
    // Grid collapse: one column, spans reset — same !important rationale.
    const sel = gridStackIds.map((id) => `[data-node-id="${id}"]`).join(', ');
    const childSel = gridStackIds.map((id) => `[data-node-id="${id}"] > *`).join(', ');
    parts.push(`  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    ${sel} { grid-template-columns: minmax(0, 1fr) !important; }
    ${childSel} { grid-column: auto !important; grid-row: auto !important; }
  }`);
  }

  return parts.join('\n');
}

function collectRendererHints(
  node: SceneNode,
  ancestors: SceneNode[],
  canvas: Canvas | undefined,
  stackIds: string[],
  gridStackIds: string[],
  relativeIds: Set<string>,
  keyframes: Set<string>,
): void {
  // Resolve instances so responsive hints inside components are picked up
  const resolved = node.type === 'instance' && node.componentId && canvas
    ? resolveInstance(node, canvas) ?? node
    : node;

  if (resolved.responsive === 'stack' && resolved.layout === 'horizontal') {
    stackIds.push(resolved.id);
  }
  // Phase 26 slice A — a grid with responsive: "stack" collapses to a single
  // column on mobile (spans reset so tiles flow naturally).
  if (resolved.responsive === 'stack' && resolved.layout === 'grid') {
    gridStackIds.push(resolved.id);
  }

  if (resolved.animation?.name && isValidKeyframeName(resolved.animation.name)) {
    keyframes.add(resolved.animation.name);
  }

  if (resolved.position === 'absolute') {
    const hasPositionedAncestor = ancestors.some((a) => a.position === 'relative' || a.position === 'absolute');
    if (!hasPositionedAncestor) {
      const container = findNearestContainer(ancestors);
      if (container && !container.position) {
        relativeIds.add(container.id);
      }
    }
  }

  if (resolved.children) {
    const nextAncestors = [...ancestors, resolved];
    for (const child of resolved.children) {
      collectRendererHints(child, nextAncestors, canvas, stackIds, gridStackIds, relativeIds, keyframes);
    }
  }
}

function findNearestContainer(ancestors: SceneNode[]): SceneNode | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'frame' || a.type === 'document' || a.type === 'component') return a;
  }
  return undefined;
}

/** Phase 30 slice B — the root's safeArea insets ride on top of its authored
 * top/bottom padding, at exact px (insets never scale fluidly). Each side is
 * honoured only when it is a finite non-negative number. Slice D — pinned
 * chrome raises its edge to at least the chrome's reach (CSS max()), so
 * content never starts or ends under it. */
function safeAreaPadding(node: SceneNode, rc: RenderCtx): string[] {
  const insets = usableSafeArea(node.safeArea);
  const sides = paddingSides(node.padding);
  const out: string[] = [];
  for (const edge of ['top', 'bottom'] as const) {
    const inset = insets[edge];
    const reach = rc.reservation[edge];
    const base = inset !== undefined ? `calc(${sides[edge]} + ${inset}px)` : sides[edge];
    if (reach > 0) out.push(`padding-${edge}: max(${base}, ${reach}px)`);
    else if (inset !== undefined) out.push(`padding-${edge}: ${base}`);
  }
  return out;
}

/** Position and offsets. `fixed` pins to the viewport, with horizontal
 * offsets measured from the root's edges (centred column in a wider window)
 * and a width capped at the root's; `fixed` / `sticky` with no vertical
 * offset stick to the top, and pinned chrome to its own edge. */
function positionStyles(node: SceneNode, rc: RenderCtx): string[] {
  const s: string[] = [];
  const position = effectivePosition(node);
  if (position) s.push(`position: ${position}`);
  if (position === 'fixed') {
    const edge = `max(0px, (100% - ${rc.bodyWidth}px) / 2)`;
    if (node.x !== undefined || node.right === undefined) s.push(`left: calc(${edge} + ${node.x ?? 0}px)`);
    // With no horizontal offset and no width, span the root's column — like an
    // in-flow frame stretching — instead of shrinking to fit.
    const span = node.x === undefined && node.right === undefined && node.width === undefined;
    if (node.right !== undefined || span) s.push(`right: calc(${edge} + ${node.right ?? 0}px)`);
    if (node.maxWidth === undefined) s.push(`max-width: ${rc.columnWidth}px`);
  } else {
    if (node.x !== undefined) s.push(`left: ${node.x}px`);
    if (node.right !== undefined) s.push(`right: ${node.right}px`);
  }
  if (node.y !== undefined) s.push(`top: ${node.y}px`);
  if (node.bottom !== undefined) s.push(`bottom: ${node.bottom}px`);
  if (node.y === undefined && node.bottom === undefined) {
    const chromeEdge = CHROME_EDGE[node.type];
    if (chromeEdge && position) s.push(`${chromeEdge}: 0`);
    else if (position === 'fixed' || position === 'sticky') s.push('top: 0');
  }
  if (position === 'fixed') s.push('z-index: 10');
  else if (position === 'sticky') s.push('z-index: 5');
  return s;
}

/** The authored top/bottom padding as buildStyles emits it (0px when absent or
 * not numeric). */
function paddingSides(padding: SceneNode['padding']): { top: string; bottom: string } {
  const px = (v: unknown) => (typeof v === 'number' ? responsivePadding(v) : '0px');
  if (typeof padding === 'number') return { top: px(padding), bottom: px(padding) };
  // CSS shorthand order: one or two values share top/bottom; three or four
  // put bottom third.
  if (Array.isArray(padding) && padding.length && padding.every((p) => typeof p === 'number')) {
    return { top: px(padding[0]), bottom: px(padding[padding.length >= 3 ? 2 : 0]) };
  }
  return { top: '0px', bottom: '0px' };
}

/** The px a padding value renders at on a viewport `viewportWidth` wide —
 * responsivePadding's clamp() evaluated. Phase 30 slice C: the mobile rules
 * measure rendered padding, since a 48px padding on a 390 artboard renders 13. */
export function renderedPaddingPx(value: number, viewportWidth: number): number {
  if (value < PADDING_SCALE_MIN) return value;
  const min = Math.max(8, Math.round(value * 0.25));
  return Math.min(value, Math.max(min, (value / DESIGN_WIDTH) * viewportWidth));
}

function responsivePadding(value: number): string {
  if (value < PADDING_SCALE_MIN) return `${value}px`;
  const min = Math.max(8, Math.round(value * 0.25));
  const fluid = ((value / DESIGN_WIDTH) * 100).toFixed(2);
  return `clamp(${min}px, ${fluid}vw, ${value}px)`;
}

// CSS length expressions (clamp()/calc()/rem strings from fluid scale tokens)
// pass through when they match a safe character set; anything else is dropped.
const SAFE_CSS_LENGTH = /^[a-zA-Z0-9\s().,%*+\/-]+$/;

function responsiveFontSize(value: number | string): string {
  if (typeof value === 'string') {
    return SAFE_CSS_LENGTH.test(value) ? value : '14px';
  }
  if (value < FONT_SCALE_MIN) return `${value}px`;
  const min = Math.max(16, Math.round(value * 0.6));
  const fluid = ((value / DESIGN_WIDTH) * 100).toFixed(2);
  return `clamp(${min}px, ${fluid}vw, ${value}px)`;
}

function cssFlexAlign(v: string): string {
  if (v === 'start') return 'flex-start';
  if (v === 'end') return 'flex-end';
  return v;
}

function cssFlexJustify(v: string): string {
  if (v === 'start') return 'flex-start';
  if (v === 'end') return 'flex-end';
  return v;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
