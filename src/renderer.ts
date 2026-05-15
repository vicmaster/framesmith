import type { Canvas, SceneNode } from './types.js';
import { getIconSvg } from './icons.js';

export function renderToHtml(root: SceneNode, width = 1440, height = 900, canvas?: Canvas): string {
  const body = renderNode(root, canvas);
  const responsiveCss = buildResponsiveStylesheet(root, canvas);
  // Hoist the root's fill/gradient to <html> so wide viewports show the design
  // background instead of browser-default white on the sidebars.
  const rootBg = rootBackgroundCss(root);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { min-height: 100vh;${rootBg ? ` ${rootBg};` : ''} }
  body { width: 100%; max-width: ${width}px; min-height: ${height}px; margin: 0 auto; overflow-x: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  img { display: block; max-width: 100%; }
  p { overflow-wrap: break-word; word-wrap: break-word; }
${responsiveCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
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
  if (node.backdropBlur) s.push(`backdrop-filter: blur(${node.backdropBlur}px)`);

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

// Mobile breakpoint for the `responsive: 'stack'` hint. Matches the viewer's
// tablet preset (768) so the preview buttons demonstrate reflow visibly.
const MOBILE_BREAKPOINT = 768;

function buildResponsiveStylesheet(root: SceneNode, canvas?: Canvas): string {
  const stackIds: string[] = [];
  collectResponsiveStackIds(root, canvas, stackIds);
  if (stackIds.length === 0) return '';

  // !important is required because inline styles (flex-direction: row) would
  // otherwise win over the @media rule regardless of selector specificity.
  const selectors = stackIds.map((id) => `[data-node-id="${id}"]`).join(', ');
  return `  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    ${selectors} { flex-direction: column !important; }
  }`;
}

function collectResponsiveStackIds(node: SceneNode, canvas: Canvas | undefined, out: string[]): void {
  // Resolve instances so responsive hints inside components are picked up
  const resolved = node.type === 'instance' && node.componentId && canvas
    ? resolveInstance(node, canvas) ?? node
    : node;

  if (resolved.responsive === 'stack' && resolved.layout === 'horizontal') {
    out.push(resolved.id);
  }
  if (resolved.children) {
    for (const child of resolved.children) {
      collectResponsiveStackIds(child, canvas, out);
    }
  }
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
