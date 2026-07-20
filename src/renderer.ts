import type { Canvas, FontFace, SceneNode } from './types.js';
import { getIconSvg } from './icons.js';
import { aliasFamilyStack } from './fonts.js';

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
}

// Registered canvas.fonts family names (lowercased) — a generic shorthand
// ("mono"/"sans") explicitly registered under that label must reach its own
// @font-face rule instead of being aliased away. undefined (not an empty set)
// when canvas.fonts is empty, so aliasFamilyStack's `registered?.has` short-circuits.
function registeredFamilies(canvas?: Canvas): ReadonlySet<string> | undefined {
  const fonts = canvas?.fonts;
  return fonts?.length ? new Set(fonts.map((f) => f.family.toLowerCase())) : undefined;
}

export function renderToHtml(root: SceneNode, width = 1440, height = 900, canvas?: Canvas, opts?: RenderOptions): string {
  const registered = registeredFamilies(canvas);
  const body = renderNode(root, canvas, registered);
  const responsiveCss = buildRendererStylesheet(root, canvas);
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
${preconnect}<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { min-height: 100vh;${rootBg ? ` ${rootBg};` : ''} }
  body { width: 100%; max-width: ${width}px; min-height: ${height}px; margin: 0 auto; overflow-x: hidden; font-family: ${bodyFont}; }
  img { display: block; max-width: 100%; }
  p { overflow-wrap: break-word; word-wrap: break-word; }
${fontFaceCss}${responsiveCss}
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
const CSS_IDENT = /^[a-zA-Z][a-zA-Z0-9-]*$/;

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

  const padLeft = node.yLabels?.length ? 44 : 0;
  const padBottom = node.xLabels?.length ? 22 : 0;
  const padTop = 4;
  const plotW = Math.max(1, boxW - padLeft - 4);
  const plotH = Math.max(1, boxH - padTop - padBottom);

  const [dx0, dx1] = node.xDomain ?? [0, Math.max(1, maxLen - 1)];
  const values = series.flatMap((s) => s.data);
  let [dy0, dy1] = node.yDomain ?? [Math.min(...values), Math.max(...values)];
  if (!node.yDomain && node.kind === 'bar') dy0 = Math.min(0, dy0);
  if (dy1 === dy0) dy1 = dy0 + 1;

  const xSpan = dx1 - dx0 || 1;
  return {
    x0: padLeft, y0: padTop, plotW, plotH,
    x: (index) => padLeft + ((index - dx0) / xSpan) * plotW,
    y: (value) => padTop + (1 - (value - dy0) / (dy1 - dy0)) * plotH,
  };
}

/** Sanitized series: finite numbers only, empty series dropped, colors defaulted. */
function chartSeriesData(node: SceneNode): Array<{ data: number[]; stroke: string; strokeWidth: number; dash: string | null; area: boolean; points: boolean }> {
  return (node.series ?? [])
    .filter((s) => s && Array.isArray(s.data))
    .map((s, i) => ({
      data: s.data.filter((v) => typeof v === 'number' && isFinite(v)),
      stroke: s.stroke ?? CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length],
      strokeWidth: s.strokeWidth ?? 2,
      dash: dasharrayValue(s.strokeDasharray),
      area: s.area === true,
      points: s.points === true,
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

function renderChartSvg(node: SceneNode): string {
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
  if (node.kind === 'bar') {
    const maxLen = Math.max(...series.map((s) => s.data.length));
    const band = geom.plotW / maxLen;
    const inner = band * 0.8;
    const barW = Math.max(1, (inner - 2 * (series.length - 1)) / series.length);
    series.forEach((s, si) => {
      const clampY = (y: number) => Math.min(Math.max(y, geom.y0), geom.y0 + geom.plotH);
      const zeroY = clampY(geom.y(0)); // bars grow from the zero line (clamped into the plot)
      s.data.forEach((v, i) => {
        const yv = clampY(geom.y(v));
        const top = Math.min(yv, zeroY);
        const h = Math.max(1, Math.abs(zeroY - yv));
        const bx = geom.x0 + i * band + (band - inner) / 2 + si * (barW + 2);
        parts.push(`<rect x="${round2(bx)}" y="${round2(top)}" width="${round2(barW)}" height="${round2(h)}" fill="${escapeAttr(s.stroke)}" rx="2" />`);
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

  // Tick labels: spread evenly along the bottom / left edges.
  const labelColor = escapeAttr(node.color ?? CHART_LABEL_COLOR);
  for (const [i, label] of (node.xLabels ?? []).entries()) {
    const n = node.xLabels!.length;
    const lx = round2(geom.x0 + (n === 1 ? 0.5 : i / (n - 1)) * geom.plotW);
    parts.push(`<text x="${lx}" y="${round2(baselineY + 16)}" font-size="${CHART_LABEL_SIZE}" fill="${labelColor}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${escapeHtml(label)}</text>`);
  }
  for (const [i, label] of (node.yLabels ?? []).entries()) {
    const n = node.yLabels!.length;
    const ly = round2(geom.y0 + geom.plotH - (n === 1 ? 0.5 : i / (n - 1)) * geom.plotH);
    parts.push(`<text x="${geom.x0 - 8}" y="${ly + 4}" font-size="${CHART_LABEL_SIZE}" fill="${labelColor}" text-anchor="end">${escapeHtml(label)}</text>`);
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

function renderNode(node: SceneNode, canvas?: Canvas, registered?: ReadonlySet<string>): string {
  // Resolve instances: clone the component tree and apply overrides
  if (node.type === 'instance' && node.componentId && canvas) {
    const resolved = resolveInstance(node, canvas);
    if (resolved) return renderNode(resolved, canvas, registered);
  }

  const styles = buildStyles(node, registered);
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
  if (node.type === 'toggle') return renderToggle(node, dataAttr);
  if (node.type === 'checkbox') return renderCheckbox(node, dataAttr);
  if (node.type === 'radio') return renderRadio(node, dataAttr);
  if (node.type === 'select') return renderSelect(node, dataAttr);

  if (node.type === 'ellipse') {
    // Ensure border-radius: 50% for ellipses
    const ellipseStyles = styles.includes('border-radius') ? styles : styles + '; border-radius: 50%';
    return `<div${dataAttr} style="${escapeStyleValue(ellipseStyles)}">${renderChildren(node, canvas, registered)}</div>`;
  }

  return `<div${dataAttr}${styleAttr}>${renderChildren(node, canvas, registered)}</div>`;
}

function resolveInstance(instance: SceneNode, canvas: Canvas): SceneNode | null {
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

function renderChildren(node: SceneNode, canvas?: Canvas, registered?: ReadonlySet<string>): string {
  if (!node.children?.length) return '';
  return node.children.map((child) => renderNode(child, canvas, registered)).join('\n');
}

function buildStyles(node: SceneNode, registered?: ReadonlySet<string>): string {
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
  if (node.maxWidth !== undefined) s.push(`max-width: ${cssLength(node.maxWidth)}`);
  if (node.height !== undefined) s.push(`height: ${cssLength(node.height)}`);

  // Layout
  if (node.layout === 'horizontal') {
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

  if (node.gap !== undefined) s.push(`gap: ${node.gap}px`);
  if (node.wrap || node.responsive === 'wrap') s.push('flex-wrap: wrap');
  if (node.alignItems) s.push(`align-items: ${cssFlexAlign(node.alignItems)}`);
  if (node.justifyContent) s.push(`justify-content: ${cssFlexJustify(node.justifyContent)}`);

  // Padding
  if (node.padding !== undefined) {
    if (typeof node.padding === 'number') {
      s.push(`padding: ${responsivePadding(node.padding)}`);
    } else if (Array.isArray(node.padding)) {
      if (node.padding.length === 2) {
        s.push(`padding: ${responsivePadding(node.padding[0])} ${responsivePadding(node.padding[1])}`);
      } else {
        s.push(`padding: ${node.padding.map(responsivePadding).join(' ')}`);
      }
    }
  }

  // Position
  if (node.position) s.push(`position: ${node.position}`);
  if (node.x !== undefined) s.push(`left: ${node.x}px`);
  if (node.y !== undefined) s.push(`top: ${node.y}px`);

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
    } else {
      s.push(`border-radius: ${node.cornerRadius.map((r) => `${r}px`).join(' ')}`);
    }
  }
  if (node.opacity !== undefined) s.push(`opacity: ${node.opacity}`);
  if (node.overflow) s.push(`overflow: ${node.overflow}`);
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
  if (node.transition && typeof node.transition.duration === 'number') {
    const t = node.transition;
    const prop = t.property && CSS_IDENT.test(t.property) ? t.property : 'all';
    const easing = ALLOWED_EASINGS.has(t.easing ?? '') ? t.easing : 'ease';
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

function controlSize(node: SceneNode, defW: number, defH: number): { w: number; h: number } {
  return {
    w: typeof node.width === 'number' ? node.width : defW,
    h: typeof node.height === 'number' ? node.height : defH,
  };
}

function controlOpacity(node: SceneNode): string[] {
  return node.opacity !== undefined ? [`opacity: ${node.opacity}`] : [];
}

function renderToggle(node: SceneNode, dataAttr: string): string {
  const { w, h } = controlSize(node, 44, 24);
  const inset = Math.max(Math.round(h * 0.125), 2);
  const knob = h - inset * 2;
  const left = node.checked ? w - knob - inset : inset;
  const track = [
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
  const fontSize = node.fontSize ?? 14;
  const isPlaceholder = !node.value;
  const textColor = isPlaceholder ? '#9CA3AF' : node.color;
  const frame = [
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
  const relativeIds = new Set<string>();
  const keyframes = new Set<string>();
  collectRendererHints(root, [], canvas, stackIds, relativeIds, keyframes);

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

  return parts.join('\n');
}

function collectRendererHints(
  node: SceneNode,
  ancestors: SceneNode[],
  canvas: Canvas | undefined,
  stackIds: string[],
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
      collectRendererHints(child, nextAncestors, canvas, stackIds, relativeIds, keyframes);
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

function responsivePadding(value: number): string {
  if (value < PADDING_SCALE_MIN) return `${value}px`;
  const min = Math.max(8, Math.round(value * 0.25));
  const fluid = ((value / DESIGN_WIDTH) * 100).toFixed(2);
  return `clamp(${min}px, ${fluid}vw, ${value}px)`;
}

function responsiveFontSize(value: number): string {
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
