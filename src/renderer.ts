import type { Canvas, FontFace, SceneNode } from './types.js';
import { getIconSvg } from './icons.js';

export function renderToHtml(root: SceneNode, width = 1440, height = 900, canvas?: Canvas): string {
  const body = renderNode(root, canvas);
  const responsiveCss = buildRendererStylesheet(root, canvas);
  // Hoist the root's fill/gradient to <html> so wide viewports show the design
  // background instead of browser-default white on the sidebars.
  const rootBg = rootBackgroundCss(root);
  const { preconnect, fontFaceCss } = buildFontHead(canvas);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${preconnect}<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { min-height: 100vh;${rootBg ? ` ${rootBg};` : ''} }
  body { width: 100%; max-width: ${width}px; min-height: ${height}px; margin: 0 auto; overflow-x: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
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

function buildFontHead(canvas?: Canvas): { preconnect: string; fontFaceCss: string } {
  const fonts = canvas?.fonts;
  if (!fonts?.length) return { preconnect: '', fontFaceCss: '' };

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
  if (root.gradient) {
    const g = root.gradient;
    const stops = g.stops.map((st) => st.position !== undefined ? `${st.color} ${st.position}%` : st.color).join(', ');
    return g.type === 'linear'
      ? `background: linear-gradient(${g.angle ?? 180}deg, ${stops})`
      : `background: radial-gradient(${stops})`;
  }
  if (root.fill) return `background-color: ${root.fill}`;
  return '';
}

function renderNode(node: SceneNode, canvas?: Canvas): string {
  // Resolve instances: clone the component tree and apply overrides
  if (node.type === 'instance' && node.componentId && canvas) {
    const resolved = resolveInstance(node, canvas);
    if (resolved) return renderNode(resolved, canvas);
  }

  const styles = buildStyles(node);
  const styleAttr = styles ? ` style="${styles}"` : '';
  const dataAttr = ` data-node-id="${node.id}"`;

  if (node.type === 'text') {
    return `<p${dataAttr}${styleAttr}>${escapeHtml(node.content ?? '')}</p>`;
  }

  if (node.type === 'image') {
    const imgStyles = buildImageStyles(node);
    return `<div${dataAttr}${styleAttr}><img src="${escapeHtml(node.src ?? '')}" style="${imgStyles}" /></div>`;
  }

  if (node.type === 'icon') {
    const svg = getIconSvg(node.icon ?? '', node.iconSize ?? 24, node.iconColor);
    const iconHtml = svg ?? `<!-- unknown icon: ${escapeHtml(node.icon ?? '')} -->`;
    return `<div${dataAttr}${styleAttr}>${iconHtml}</div>`;
  }

  if (node.type === 'ellipse') {
    // Ensure border-radius: 50% for ellipses
    const ellipseStyles = styles.includes('border-radius') ? styles : styles + '; border-radius: 50%';
    return `<div${dataAttr} style="${ellipseStyles}">${renderChildren(node, canvas)}</div>`;
  }

  return `<div${dataAttr}${styleAttr}>${renderChildren(node, canvas)}</div>`;
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

function renderChildren(node: SceneNode, canvas?: Canvas): string {
  if (!node.children?.length) return '';
  return node.children.map((child) => renderNode(child, canvas)).join('\n');
}

function buildStyles(node: SceneNode): string {
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

  // Visual
  if (node.gradient) {
    const g = node.gradient;
    const stops = g.stops.map((st) => st.position !== undefined ? `${st.color} ${st.position}%` : st.color).join(', ');
    if (g.type === 'linear') {
      s.push(`background: linear-gradient(${g.angle ?? 180}deg, ${stops})`);
    } else {
      s.push(`background: radial-gradient(${stops})`);
    }
  } else if (node.fill) {
    s.push(`background-color: ${node.fill}`);
  }
  if (node.stroke) s.push(`border: ${node.strokeWidth ?? 1}px solid ${node.stroke}`);
  if (node.cornerRadius !== undefined) {
    if (typeof node.cornerRadius === 'number') {
      s.push(`border-radius: ${node.cornerRadius}px`);
    } else {
      s.push(`border-radius: ${node.cornerRadius.map((r) => `${r}px`).join(' ')}`);
    }
  }
  if (node.opacity !== undefined) s.push(`opacity: ${node.opacity}`);
  if (node.overflow) s.push(`overflow: ${node.overflow}`);
  if (node.shadows?.length) {
    const shadowStr = node.shadows.map((sh) =>
      `${sh.inset ? 'inset ' : ''}${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread ?? 0}px ${sh.color}`
    ).join(', ');
    s.push(`box-shadow: ${shadowStr}`);
  } else if (node.shadow) {
    s.push(`box-shadow: ${node.shadow}`);
  }
  if (node.blur) s.push(`filter: blur(${node.blur}px)`);
  const backdrop = composeBackdropFilter(node);
  if (backdrop) {
    // Safari ships the unprefixed property behind a flag; emit both so
    // glassmorphism actually renders in Safari/iOS without extra author effort.
    s.push(`-webkit-backdrop-filter: ${backdrop}`);
    s.push(`backdrop-filter: ${backdrop}`);
  }

  // Text
  if (node.fontSize) s.push(`font-size: ${responsiveFontSize(node.fontSize)}`);
  if (node.fontFamily) s.push(`font-family: ${node.fontFamily}`);
  if (node.fontWeight) s.push(`font-weight: ${node.fontWeight}`);
  if (node.color) s.push(`color: ${node.color}`);
  if (node.textAlign) s.push(`text-align: ${node.textAlign}`);
  if (node.lineHeight !== undefined) {
    s.push(`line-height: ${typeof node.lineHeight === 'number' ? node.lineHeight : node.lineHeight}`);
  }
  if (node.letterSpacing !== undefined) s.push(`letter-spacing: ${node.letterSpacing}px`);
  if (node.textDecoration) s.push(`text-decoration: ${node.textDecoration}`);
  if (node.textTransform) s.push(`text-transform: ${node.textTransform}`);

  return s.join('; ');
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

function buildRendererStylesheet(root: SceneNode, canvas?: Canvas): string {
  const stackIds: string[] = [];
  const relativeIds = new Set<string>();
  collectRendererHints(root, [], canvas, stackIds, relativeIds);

  const parts: string[] = [];

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
): void {
  // Resolve instances so responsive hints inside components are picked up
  const resolved = node.type === 'instance' && node.componentId && canvas
    ? resolveInstance(node, canvas) ?? node
    : node;

  if (resolved.responsive === 'stack' && resolved.layout === 'horizontal') {
    stackIds.push(resolved.id);
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
      collectRendererHints(child, nextAncestors, canvas, stackIds, relativeIds);
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
