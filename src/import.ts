// Phase 17 — import from implementation (issue #78, spec docs/specs/PHASE-17-SPEC.md).
//
// HTML (later: a live URL) → editable scene graph. The pipeline has a thin
// Chrome side and a fat pure side:
//   1. DOM_WALKER_SOURCE runs in page.evaluate (string function — the tsx
//      __name workaround, same as computeDiff) and emits RawDomNode JSON:
//      tag, classes, a fixed whitelist of computed styles, rect, text, attrs.
//   2. domToSceneGraph / flattenTree map that JSON to SceneNodes in Node —
//      pure, fixture-testable without Chrome.
//
// Lossy BY DESIGN: pseudo-elements, background images, grid intricacies and
// friends degrade with warnings. The ImportReport is the contract — what
// mapped, what stayed literal, what was dropped — never a pixel-perfect claim.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { DesignVariables, SceneNode } from './types.js';
import { withPage, withIsolatedPage } from './screenshot.js';
import { classesToProps } from './tailwind-map.js';

// ── walker output ────────────────────────────────────────────────────────────

export interface RawDomNode {
  tag: string;
  classes: string[];
  rect: { x: number; y: number; w: number; h: number };
  /** Whitelisted computed styles, camelCase keys. */
  styles: Record<string, string>;
  /** The element's OWN text content (direct text-node children, trimmed). */
  text?: string;
  attrs: {
    type?: string;
    checked?: boolean;
    role?: string;
    ariaChecked?: string;
    ariaHidden?: boolean;
    src?: string;
    alt?: string;
    selectValue?: string;
  };
  /** Inline <svg> only: the d attribute of each path child + the viewBox. */
  svgPaths?: string[];
  svgViewBox?: string;
  children: RawDomNode[];
}

/** Computed properties the walker captures. Long-stable CSSOM names — the
 * Node side never touches a browser, so this list is the whole coupling. */
const STYLE_WHITELIST = [
  'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent',
  'rowGap', 'columnGap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'backgroundColor', 'backgroundImage',
  'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius',
  'boxShadow', 'opacity', 'overflow', 'visibility', 'position',
  'color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight',
  'letterSpacing', 'textTransform', 'textAlign', 'textDecorationLine',
] as const;

/** The page.evaluate walker, as a string function (tsx/esbuild injects a
 * __name helper into closures, which doesn't exist in the page context — the
 * same reason computeDiff in screenshot.ts uses a string). Receives the root
 * selector and the whitelist; returns RawDomNode JSON or null. */
export const DOM_WALKER_SOURCE = `(function (rootSelector, whitelist) {
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, META: 1, LINK: 1, HEAD: 1, TITLE: 1, NOSCRIPT: 1, TEMPLATE: 1, BR: 1 };

  function ownText(el) {
    var out = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) out += n.textContent;
    }
    out = out.replace(/\\s+/g, ' ').trim();
    return out || undefined;
  }

  function walk(el) {
    if (SKIP_TAGS[el.tagName]) return null;
    var cs = getComputedStyle(el);
    var styles = {};
    for (var i = 0; i < whitelist.length; i++) styles[whitelist[i]] = cs[whitelist[i]];
    var rect = el.getBoundingClientRect();

    var node = {
      tag: el.tagName.toLowerCase(),
      classes: typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean) : [],
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      styles: styles,
      text: ownText(el),
      attrs: {},
      children: []
    };

    if (el.tagName === 'INPUT') {
      node.attrs.type = el.getAttribute('type') || 'text';
      node.attrs.checked = !!el.checked;
    }
    if (el.tagName === 'SELECT') {
      var opt = el.options && el.options[el.selectedIndex];
      node.attrs.selectValue = opt ? opt.textContent.trim() : undefined;
    }
    if (el.tagName === 'IMG') {
      // currentSrc/src are URL-resolved against the page (absolute on live
      // pages; empty for unresolvable snippet-relative paths) — fall back to
      // the raw attribute so the report can still name the source.
      node.attrs.src = el.currentSrc || el.src || el.getAttribute('src') || undefined;
      node.attrs.alt = el.getAttribute('alt') || undefined;
    }
    var role = el.getAttribute('role');
    if (role) node.attrs.role = role;
    var ac = el.getAttribute('aria-checked');
    if (ac !== null) node.attrs.ariaChecked = ac;
    if (el.getAttribute('aria-hidden') === 'true') node.attrs.ariaHidden = true;

    if (el.tagName === 'svg' || el.tagName === 'SVG') {
      var paths = el.querySelectorAll('path');
      var ds = [];
      for (var p = 0; p < paths.length; p++) {
        var d = paths[p].getAttribute('d');
        if (d) ds.push(d);
      }
      node.svgPaths = ds;
      node.svgViewBox = el.getAttribute('viewBox') || undefined;
      return node; // never descend into svg internals
    }

    for (var c = 0; c < el.children.length; c++) {
      var child = walk(el.children[c]);
      if (child) node.children.push(child);
    }
    return node;
  }

  var root = document.querySelector(rootSelector);
  return root ? walk(root) : null;
})`;

// ── report ───────────────────────────────────────────────────────────────────

export interface ImportReport {
  counts: { nodes: number; frames: number; text: number; maxDepth: number; dropped: number };
  /** Color values rewritten to $token refs (Tailwind intent or nearest-match snapping). */
  snapped: { nodeId: string; prop: string; from: string; token: string }[];
  /** Concrete color values that found no token — flagged for review. */
  literals: { nodeId: string; prop: string; value: string }[];
  /** Numeric values that EQUAL a scale token (gap 16 ≙ $md) — informational;
   * number-typed props aren't rewritten to refs. */
  scaleMatches: { nodeId: string; prop: string; value: number; token: string }[];
  unmatchedFonts: string[];
  unmatchedIcons: string[];
  warnings: string[];
}

function emptyReport(): ImportReport {
  return { counts: { nodes: 0, frames: 0, text: 0, maxDepth: 0, dropped: 0 }, snapped: [], literals: [], scaleMatches: [], unmatchedFonts: [], unmatchedIcons: [], warnings: [] };
}

// ── icon recognition (spec C5: exact path-hash match, no false positives) ────

let iconHashIndex: Map<string, { ref: string }> | null = null;

function normalizeD(d: string): string {
  return d.replace(/\s+/g, ' ').trim();
}

function hashPaths(paths: string[]): string {
  return createHash('sha256').update(paths.map(normalizeD).join('|')).digest('hex').slice(0, 16);
}

/** Lazily index the bundled icon sets by path-data hash. Lucide icons that use
 * non-path primitives (circle/line/…) are skipped — exact-match only is the
 * point. ~5,700 file reads once per process, mirroring the Material loader's
 * lazy philosophy. */
function getIconHashIndex(): Map<string, { ref: string }> {
  if (iconHashIndex) return iconHashIndex;
  iconHashIndex = new Map();

  const addSet = (dir: string, refOf: (name: string) => string) => {
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.svg')); } catch { return; }
    for (const file of files) {
      const svg = readFileSync(join(dir, file), 'utf-8');
      // Only index icons that are purely <path>-based (and nothing else drawable).
      const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
      if (!paths.length) continue;
      if (/<(circle|line|rect|polyline|polygon|ellipse)[\s>]/.test(svg)) continue;
      const name = file.replace(/\.svg$/, '');
      const key = hashPaths(paths);
      if (!iconHashIndex!.has(key)) iconHashIndex!.set(key, { ref: refOf(name) });
    }
  };

  try {
    const lucideDir = join(dirname(fileURLToPath(import.meta.resolve('lucide-static'))), '..', '..', 'icons');
    addSet(lucideDir, (n) => n);
  } catch { /* set unavailable — recognition just misses */ }
  try {
    const materialRoot = dirname(fileURLToPath(import.meta.resolve('@material-symbols/svg-400/package.json')));
    addSet(join(materialRoot, 'outlined'), (n) => `material:${n}`);
  } catch { /* ditto */ }

  return iconHashIndex;
}

/** Exposed for tests: match inline-SVG path data to a bundled icon ref. */
export function matchIcon(svgPaths: string[]): string | null {
  if (!svgPaths.length) return null;
  return getIconHashIndex().get(hashPaths(svgPaths))?.ref ?? null;
}

// ── style parsing helpers (pure) ─────────────────────────────────────────────

function px(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? Math.round(parseFloat(m[1])) : undefined;
}

/** Sub-pixel values matter for tracking (0.4px letter-spacing is real). */
function pxFloat(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? parseFloat(m[1]) : undefined;
}

/** Computed colors come back as rgb()/rgba(). Transparent → undefined. */
function cssColor(value: string | undefined): string | undefined {
  if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return undefined;
  return value;
}

const ALIGN_MAP: Record<string, SceneNode['alignItems']> = {
  'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', stretch: undefined as never, normal: undefined as never,
};
const JUSTIFY_MAP: Record<string, SceneNode['justifyContent']> = {
  'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end',
  'space-between': 'space-between', 'space-around': 'space-around', normal: undefined as never,
};

// ── DOM → scene graph (pure) ─────────────────────────────────────────────────

export interface FlattenOptions {
  collapseWrappers?: boolean;
  mergeTextRuns?: boolean;
  dropInvisible?: boolean;
  maxDepth?: number;
}

const MAX_NODES = 2000;

export interface DomToSceneOptions {
  flatten?: FlattenOptions;
  /** Width of the import container — drives the '100%' width strategy (C4). */
  containerWidth?: number;
  /** Flat { name: value } map from the project's Tailwind @theme — widens
   * which class names the intent mapper treats as $tokens (spec FR-B1). */
  tailwindTheme?: Record<string, string>;
}

export function domToSceneGraph(raw: RawDomNode, opts: DomToSceneOptions = {}): { root: SceneNode; report: ImportReport } {
  const report = emptyReport();
  const flatten: Required<FlattenOptions> = {
    collapseWrappers: opts.flatten?.collapseWrappers ?? true,
    mergeTextRuns: opts.flatten?.mergeTextRuns ?? true,
    dropInvisible: opts.flatten?.dropInvisible ?? true,
    maxDepth: opts.flatten?.maxDepth ?? 24,
  };

  let counter = 0;
  const nextId = (kind: string) => `imp-${kind}-${++counter}`;

  const convert = (node: RawDomNode, depth: number, parent: RawDomNode | null): SceneNode | null => {
    if (report.counts.nodes >= MAX_NODES) return null;
    if (depth > flatten.maxDepth) {
      report.counts.dropped++;
      if (!report.warnings.some((w) => w.includes('maxDepth'))) {
        report.warnings.push(`Subtrees deeper than maxDepth (${flatten.maxDepth}) were truncated.`);
      }
      return null;
    }
    if (flatten.dropInvisible) {
      if (node.styles.display === 'none' || node.styles.visibility === 'hidden' || node.attrs.ariaHidden
        || (node.rect.w <= 0 && node.rect.h <= 0)) {
        report.counts.dropped++;
        return null;
      }
    }
    if (node.styles.opacity === '0') {
      report.warnings.push(`A fully transparent element (${node.tag}) was kept — it still occupies layout.`);
    }

    report.counts.maxDepth = Math.max(report.counts.maxDepth, depth);

    // ── controls (FR-A2) ──
    if (node.tag === 'input' && node.attrs.type === 'checkbox') {
      // role="switch" on a checkbox input is the most common toggle markup.
      const type = node.attrs.role === 'switch' ? 'toggle' : 'checkbox';
      return count({ id: nextId(type), type, ...(node.attrs.checked ? { checked: true } : {}) });
    }
    if (node.tag === 'input' && node.attrs.type === 'radio') {
      return count({ id: nextId('radio'), type: 'radio', ...(node.attrs.checked ? { checked: true } : {}) });
    }
    if (node.attrs.role === 'switch' || node.attrs.ariaChecked !== undefined) {
      return count({ id: nextId('toggle'), type: 'toggle', ...(node.attrs.ariaChecked === 'true' ? { checked: true } : {}) });
    }
    if (node.tag === 'select') {
      return count({
        id: nextId('select'), type: 'select',
        ...(node.attrs.selectValue ? { value: node.attrs.selectValue } : {}),
        ...(widthFor(node, parent) !== undefined ? { width: widthFor(node, parent) } : {}),
      });
    }

    // ── media ──
    if (node.tag === 'img') {
      const out: SceneNode = { id: nextId('image'), type: 'image', width: node.rect.w, height: node.rect.h };
      if (node.attrs.src && /^(https?:|data:)/.test(node.attrs.src)) out.src = node.attrs.src;
      else {
        out.fill = '#E5E7EB';
        report.warnings.push(`Image "${node.attrs.src ?? node.attrs.alt ?? 'unnamed'}" has a non-absolute src — imported as a placeholder fill.`);
        out.type = 'frame';
      }
      return count(out);
    }
    if (node.tag === 'svg') {
      const ref = node.svgPaths?.length ? matchIcon(node.svgPaths) : null;
      const size = Math.max(node.rect.w, node.rect.h) || 24;
      if (ref) {
        return count({ id: nextId('icon'), type: 'icon', icon: ref, iconSize: size, ...(cssColor(node.styles.color) ? { iconColor: node.styles.color } : {}) });
      }
      if (node.svgPaths?.length) {
        report.unmatchedIcons.push(node.svgPaths[0].slice(0, 40) + '…');
        return count({
          id: nextId('path'), type: 'path', width: node.rect.w || size, height: node.rect.h || size,
          d: node.svgPaths[0], ...(node.svgViewBox ? { viewBox: node.svgViewBox } : {}),
          fill: cssColor(node.styles.color) ?? 'currentColor',
        });
      }
      report.counts.dropped++;
      return null;
    }

    // ── text vs frame ──
    const childNodes: SceneNode[] = [];
    const isTextOnly = !!node.text && node.children.length === 0;
    const intent = node.classes.length ? classesToProps(node.classes, opts.tailwindTheme) : null;

    // A chip/badge is "text-only" in the DOM but visually a frame — keep the
    // background/border/radius by wrapping the text instead of dropping them.
    const hasVisualBox = !!cssColor(node.styles.backgroundColor)
      || (px(node.styles.borderTopWidth) ?? 0) > 0
      || (node.styles.boxShadow && node.styles.boxShadow !== 'none')
      || (px(node.styles.borderTopLeftRadius) ?? 0) > 0
      || intent?.props.fill !== undefined || intent?.props.cornerRadius !== undefined;

    if (isTextOnly && !hasVisualBox) {
      return count(mergeIntent({ id: nextId('text'), type: 'text', content: node.text!, ...textProps(node) }, node));
    }

    // Mixed content: synthesize a text child for the element's own text.
    if (node.text) {
      childNodes.push(count({ id: nextId('text'), type: 'text', content: node.text, ...textProps(node) }));
    }
    for (const child of node.children) {
      const c = convert(child, depth + 1, node);
      if (c) childNodes.push(c);
    }

    const frame: SceneNode = { id: nextId('frame'), type: 'frame', ...frameProps(node, parent), ...(childNodes.length ? { children: childNodes } : {}) };
    return count(mergeIntent(frame, node));
  };

  /** Tailwind intent (spec FR-B1/C1): geometry + typography utilities FILL
   * GAPS the computed styles didn't provide (a bare snippet has no Tailwind
   * runtime, so they provide everything); custom-name color utilities OVERRIDE
   * computed literals with their $token ref — the class name carries intent a
   * computed value can't. Recorded under report.snapped. */
  const mergeIntent = (scene: SceneNode, raw: RawDomNode): SceneNode => {
    if (!raw.classes.length) return scene;
    const { props, tokenRefs } = classesToProps(raw.classes, opts.tailwindTheme);
    const record = scene as unknown as Record<string, unknown>;
    const refProps = new Set(tokenRefs.map((t) => t.prop));
    for (const [key, value] of Object.entries(props)) {
      if (refProps.has(key)) {
        const from = record[key];
        if (from !== value) {
          report.snapped.push({ nodeId: scene.id, prop: key, from: typeof from === 'string' ? from : '(unstyled)', token: value as string });
        }
        record[key] = value;
      } else if (record[key] === undefined) {
        record[key] = value;
      }
    }
    return scene;
  };

  const count = (n: SceneNode): SceneNode => {
    report.counts.nodes++;
    if (n.type === 'text') report.counts.text++;
    if (n.type === 'frame') report.counts.frames++;
    return n;
  };

  /** Width strategy (C4): ≈ parent content width → '100%'; small fixed boxes
   * keep pixels; everything else stays content-driven (no width). */
  const widthFor = (node: RawDomNode, parent: RawDomNode | null): number | string | undefined => {
    if (!node.rect.w) return undefined;
    if (parent) {
      const parentContent = parent.rect.w - (px(parent.styles.paddingLeft) ?? 0) - (px(parent.styles.paddingRight) ?? 0);
      if (parentContent > 0 && Math.abs(node.rect.w - parentContent) <= 2) return '100%';
    }
    if (node.rect.w <= 64) return node.rect.w;
    return undefined;
  };

  const textProps = (node: RawDomNode): Partial<SceneNode> => {
    const out: Partial<SceneNode> = {};
    const fs = px(node.styles.fontSize);
    if (fs) out.fontSize = fs;
    const fw = parseInt(node.styles.fontWeight, 10);
    if (!Number.isNaN(fw) && fw !== 400) out.fontWeight = fw;
    if (cssColor(node.styles.color)) out.color = node.styles.color;
    if (node.styles.lineHeight && node.styles.lineHeight !== 'normal') out.lineHeight = node.styles.lineHeight;
    const ls = node.styles.letterSpacing;
    if (ls && ls !== 'normal') {
      const v = pxFloat(ls);
      if (v !== undefined && v !== 0) out.letterSpacing = v;
    }
    if (node.styles.textTransform && node.styles.textTransform !== 'none') out.textTransform = node.styles.textTransform;
    if (node.styles.textAlign === 'center' || node.styles.textAlign === 'right') out.textAlign = node.styles.textAlign;
    if (node.styles.textDecorationLine && node.styles.textDecorationLine !== 'none') out.textDecoration = node.styles.textDecorationLine;
    if (node.styles.fontFamily) out.fontFamily = node.styles.fontFamily;
    return out;
  };

  const frameProps = (node: RawDomNode, parent: RawDomNode | null): Partial<SceneNode> => {
    const out: Partial<SceneNode> = {};
    const s = node.styles;

    if (s.display === 'flex' || s.display === 'inline-flex') {
      out.layout = s.flexDirection?.startsWith('column') ? 'vertical' : 'horizontal';
      if (s.flexWrap === 'wrap') out.wrap = true;
      const ai = ALIGN_MAP[s.alignItems];
      if (ai) out.alignItems = ai;
      const jc = JUSTIFY_MAP[s.justifyContent];
      if (jc) out.justifyContent = jc;
      const gap = px(s.rowGap) ?? px(s.columnGap);
      if (gap) out.gap = gap;
    } else if (s.display === 'grid' || s.display === 'inline-grid') {
      out.layout = 'vertical';
      const gap = px(s.rowGap) ?? px(s.columnGap);
      if (gap) out.gap = gap;
      if (!report.warnings.some((w) => w.includes('grid'))) {
        report.warnings.push('CSS grid containers were imported as vertical frames (grid has no scene-graph analog).');
      }
    } else if (node.children.length > 1 || node.text) {
      out.layout = 'vertical'; // block flow ≈ vertical stack
    }

    const pt = px(s.paddingTop) ?? 0, pr = px(s.paddingRight) ?? 0, pb = px(s.paddingBottom) ?? 0, pl = px(s.paddingLeft) ?? 0;
    if (pt || pr || pb || pl) {
      out.padding = pt === pb && pr === pl ? (pt === pr ? pt : [pt, pr]) : [pt, pr, pb, pl];
    }

    const bg = cssColor(s.backgroundColor);
    if (bg) out.fill = bg;
    if (s.backgroundImage && s.backgroundImage !== 'none') {
      report.warnings.push(`A background-image was dropped (${node.tag}.${node.classes[0] ?? ''}) — no scene-graph analog for arbitrary background images.`);
    }

    const bw = px(s.borderTopWidth);
    if (bw && s.borderTopStyle !== 'none' && cssColor(s.borderTopColor)) {
      out.stroke = s.borderTopColor;
      out.strokeWidth = bw;
    }

    const radius = px(s.borderTopLeftRadius);
    if (radius) out.cornerRadius = radius;
    else if (/%$/.test(s.borderTopLeftRadius ?? '') && node.rect.h > 0) out.cornerRadius = Math.round(node.rect.h / 2);

    if (s.boxShadow && s.boxShadow !== 'none') out.shadows = s.boxShadow as unknown as SceneNode['shadows']; // renderer accepts a CSS string (Phase 15)
    const op = parseFloat(s.opacity);
    if (!Number.isNaN(op) && op < 1) out.opacity = op;
    if (s.overflow === 'hidden') out.overflow = 'hidden';

    const w = widthFor(node, parent);
    if (w !== undefined) out.width = w;

    return out;
  };

  let root = convert(raw, 0, null);
  if (!root) {
    root = { id: nextId('frame'), type: 'frame' };
    report.warnings.push('The import root was invisible or empty — produced an empty frame.');
  }
  if (report.counts.nodes >= MAX_NODES) {
    report.warnings.push(`Node cap (${MAX_NODES}) reached — the tree was truncated.`);
  }

  root = flattenTree(root, flatten, report);
  return { root, report };
}

// ── flatten (pure) ───────────────────────────────────────────────────────────

const VISUAL_PROPS: (keyof SceneNode)[] = ['fill', 'stroke', 'shadows', 'cornerRadius', 'opacity', 'gap', 'padding', 'overflow', 'gradient'];

function isPlainWrapper(node: SceneNode): boolean {
  if (node.type !== 'frame' || (node.children?.length ?? 0) !== 1) return false;
  return VISUAL_PROPS.every((p) => node[p] === undefined);
}

function sameTextStyle(a: SceneNode, b: SceneNode): boolean {
  const keys: (keyof SceneNode)[] = ['fontSize', 'fontWeight', 'color', 'fontFamily', 'letterSpacing', 'textTransform', 'lineHeight', 'textAlign', 'textDecoration'];
  return keys.every((k) => a[k] === b[k]);
}

export function flattenTree(root: SceneNode, opts: Required<FlattenOptions>, report: ImportReport): SceneNode {
  const walk = (node: SceneNode): SceneNode => {
    if (node.children) {
      node.children = node.children.map(walk);

      if (opts.mergeTextRuns) {
        const merged: SceneNode[] = [];
        for (const child of node.children) {
          const prev = merged[merged.length - 1];
          if (prev && prev.type === 'text' && child.type === 'text' && sameTextStyle(prev, child)) {
            prev.content = `${prev.content} ${child.content}`.trim();
            report.counts.nodes--;
            report.counts.text--;
          } else {
            merged.push(child);
          }
        }
        node.children = merged;
      }
    }

    if (opts.collapseWrappers && isPlainWrapper(node)) {
      const child = node.children![0];
      // Preserve the wrapper's layout-relevant width when the child has none.
      if (node.width !== undefined && child.width === undefined) child.width = node.width;
      report.counts.nodes--;
      report.counts.frames--;
      return child;
    }
    return node;
  };
  return walk(root);
}

// ── token snapping (spec FR-B2) ──────────────────────────────────────────────

/** #hex (3/6) or rgb()/rgba() → [r,g,b], null for anything else or alpha < 1
 * (tokens are opaque — snapping a translucent overlay to one would lie). */
export function parseCssColor(value: string): [number, number, number] | null {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) < 1) return null;
    return [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)];
  }
  return null;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = (a[0] - b[0]) / 255, dg = (a[1] - b[1]) / 255, db = (a[2] - b[2]) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const COLOR_PROPS = ['fill', 'color', 'stroke', 'iconColor'] as const;
const EXACT = 0.004;       // sub-rounding-error — always snap
const TIE_MARGIN = 0.02;   // two candidates this close → report, don't guess
const LITERAL_CAP = 100;

export interface SnapOptions {
  /** Max normalized RGB distance to snap (default 0.08 ≈ a close shade). */
  tolerance?: number;
}

/** Snap concrete values back to design-system refs, in place:
 *  - color props → `$token` on exact or nearest-within-tolerance match
 *    (near-ties are reported and left literal — never guessed);
 *  - pre-existing `$refs` (Tailwind intent) that DON'T resolve in the given
 *    tokens → warning, so an agent knows to set_variables;
 *  - gap/padding/cornerRadius/fontSize that EQUAL a scale token → reported
 *    under scaleMatches (number-typed props aren't rewritten);
 *  - remaining literal colors → report.literals (capped). */
export function snapToTokens(root: SceneNode, vars: DesignVariables, report: ImportReport, opts: SnapOptions = {}): void {
  const tolerance = opts.tolerance ?? 0.08;

  const tokenColors: { name: string; rgb: [number, number, number] }[] = [];
  for (const [name, value] of Object.entries(vars.colors ?? {})) {
    const rgb = parseCssColor(value);
    if (rgb) tokenColors.push({ name, rgb });
  }
  const scaleEntries = (cat: Record<string, number> | undefined) => Object.entries(cat ?? {});
  const unresolvedRefs = new Set<string>();

  const snapColor = (node: SceneNode, prop: string, value: string): void => {
    const rgb = parseCssColor(value);
    if (!rgb) return;
    let best: { name: string; d: number } | null = null;
    let second: { name: string; d: number } | null = null;
    for (const t of tokenColors) {
      const d = colorDistance(rgb, t.rgb);
      if (!best || d < best.d) { second = best; best = { name: t.name, d }; }
      else if (!second || d < second.d) second = { name: t.name, d };
    }
    if (best && (best.d <= EXACT || best.d <= tolerance)) {
      if (best.d > EXACT && second && second.d <= tolerance && second.d - best.d < TIE_MARGIN) {
        report.warnings.push(`Color ${value} (${node.id}.${prop}) is near both $${best.name} and $${second.name} — left literal, snap it yourself.`);
        report.literals.push({ nodeId: node.id, prop, value });
        return;
      }
      report.snapped.push({ nodeId: node.id, prop, from: value, token: `$${best.name}` });
      (node as unknown as Record<string, unknown>)[prop] = `$${best.name}`;
      return;
    }
    if (report.literals.length < LITERAL_CAP) report.literals.push({ nodeId: node.id, prop, value });
  };

  const matchScale = (node: SceneNode, prop: string, value: number, cat: Record<string, number> | undefined): void => {
    for (const [name, v] of scaleEntries(cat)) {
      if (Math.abs(v - value) <= 1) {
        report.scaleMatches.push({ nodeId: node.id, prop, value, token: `$${name}` });
        return;
      }
    }
  };

  const walk = (node: SceneNode): void => {
    for (const prop of COLOR_PROPS) {
      const value = node[prop];
      if (typeof value !== 'string') continue;
      if (value.startsWith('$')) {
        const name = value.slice(1);
        if (vars.colors?.[name] === undefined) unresolvedRefs.add(name);
        continue;
      }
      snapColor(node, prop, value);
    }
    if (typeof node.gap === 'number') matchScale(node, 'gap', node.gap, vars.spacing);
    if (typeof node.padding === 'number') matchScale(node, 'padding', node.padding, vars.spacing);
    if (typeof node.cornerRadius === 'number') matchScale(node, 'cornerRadius', node.cornerRadius, vars.radius);
    if (typeof node.fontSize === 'number') {
      for (const [name, t] of Object.entries(vars.typography ?? {})) {
        if (Math.abs(t.fontSize - node.fontSize) <= 1) {
          report.scaleMatches.push({ nodeId: node.id, prop: 'fontSize', value: node.fontSize, token: `$${name}` });
          break;
        }
      }
    }
    node.children?.forEach(walk);
  };
  walk(root);

  if (report.literals.length >= LITERAL_CAP) {
    report.warnings.push(`More than ${LITERAL_CAP} literal colors — list truncated.`);
  }
  for (const name of unresolvedRefs) {
    report.warnings.push(`Token $${name} (from Tailwind class intent) is not defined in the matched design system — define it via set_variables or it will render unresolved.`);
  }
}

// ── Chrome side ──────────────────────────────────────────────────────────────

export interface ImportHtmlOptions {
  css?: string;
  selector?: string;
  flatten?: FlattenOptions;
  /** Container width percentage layouts resolve against. Default 1440. */
  width?: number;
  /** Tailwind @theme map for the intent mapper (FR-B1). */
  tailwindTheme?: Record<string, string>;
}

const IMPORT_ROOT_ID = '__framesmith_import_root';

export async function importHtml(html: string, opts: ImportHtmlOptions = {}): Promise<{ root: SceneNode; report: ImportReport; contentHeight: number }> {
  const width = opts.width ?? 1440;
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${opts.css ?? ''}</style></head>
<body style="margin:0"><div id="${IMPORT_ROOT_ID}" style="width:${width}px">${html}</div></body></html>`;

  return withPage(async (page) => {
    await page.setViewport({ width, height: 900 });
    await page.setContent(doc, { waitUntil: 'domcontentloaded' });

    const rootSelector = opts.selector ?? `#${IMPORT_ROOT_ID}`;
    const raw = (await page.evaluate(
      `(${DOM_WALKER_SOURCE})(${JSON.stringify(rootSelector)}, ${JSON.stringify(STYLE_WHITELIST)})`,
    )) as RawDomNode | null;
    if (!raw) throw new Error(`Selector "${rootSelector}" matched nothing in the provided HTML.`);

    const { root, report } = domToSceneGraph(raw, { flatten: opts.flatten, containerWidth: width, tailwindTheme: opts.tailwindTheme });
    if (opts.selector === undefined && root.type === 'frame') {
      // The synthetic container div is not part of the user's markup.
      root.width = '100%';
    }
    return { root, report, contentHeight: raw.rect.h };
  });
}

export interface ImportUrlOptions {
  viewport?: { width?: number; height?: number };
  selector?: string;
  /** CSS selector to await (JS-rendered pages), or a delay in ms. */
  waitFor?: string | number;
  /** Auth lives ONLY in the throwaway browser context — never persisted to
   * the canvas, provenance, or report (spec FR-C2). */
  auth?: {
    headers?: Record<string, string>;
    cookies?: { name: string; value: string; domain?: string; path?: string }[];
  };
  flatten?: FlattenOptions;
  tailwindTheme?: Record<string, string>;
}

/** Import a live page (spec FR-C1). Same walk as importHtml; the page loads in
 * an isolated context with optional headers/cookies, waits for networkidle (+
 * an explicit waitFor for client-rendered UI), then walks `selector` or body. */
export async function importUrl(url: string, opts: ImportUrlOptions = {}): Promise<{ root: SceneNode; report: ImportReport; contentHeight: number }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('canvas_import_url requires an http(s):// URL.');
  const width = opts.viewport?.width ?? 1440;
  const height = opts.viewport?.height ?? 900;

  return withIsolatedPage(async (page) => {
    await page.setViewport({ width, height });
    if (opts.auth?.headers) await page.setExtraHTTPHeaders(opts.auth.headers);
    if (opts.auth?.cookies?.length) {
      await page.setCookie(...opts.auth.cookies.map((c) => ({
        name: c.name, value: c.value,
        ...(c.domain ? { domain: c.domain, path: c.path ?? '/' } : { url }),
      })));
    }

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    if (typeof opts.waitFor === 'number') await new Promise((r) => setTimeout(r, Math.min(opts.waitFor as number, 15_000)));
    else if (typeof opts.waitFor === 'string') await page.waitForSelector(opts.waitFor, { timeout: 15_000 });

    const rootSelector = opts.selector ?? 'body';
    const raw = (await page.evaluate(
      `(${DOM_WALKER_SOURCE})(${JSON.stringify(rootSelector)}, ${JSON.stringify(STYLE_WHITELIST)})`,
    )) as RawDomNode | null;
    if (!raw) throw new Error(`Selector "${rootSelector}" matched nothing at ${url}.`);

    const { root, report } = domToSceneGraph(raw, { flatten: opts.flatten, containerWidth: width, tailwindTheme: opts.tailwindTheme });
    if (opts.selector === undefined && root.type === 'frame') root.width = '100%';
    return { root, report, contentHeight: raw.rect.h };
  });
}
