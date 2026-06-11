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
import type { Canvas, DesignVariables, SceneNode } from './types.js';
import { withPage, withIsolatedPage } from './screenshot.js';
import { classesToProps } from './tailwind-map.js';
import { renderToHtml } from './renderer.js';
import { ensureFontsForRender } from './fonts.js';

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
    /** td/th only, when > 1 — rowspan reconstruction is a non-goal, warned. */
    rowSpan?: number;
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
  // Phase 18 (structural reconstruction) layout signals — consumed by slices
  // B–D: row dividers, centered/max-width containers, grid templates + spans.
  'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor',
  'maxWidth', 'marginLeft', 'marginRight',
  'gridTemplateColumns', 'gridColumnStart', 'gridColumnEnd',
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
    if ((el.tagName === 'TD' || el.tagName === 'TH') && el.rowSpan > 1) {
      node.attrs.rowSpan = el.rowSpan;
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
  /** Phase 18 — how each container's structure was reconstructed: semantic
   * (table/grid/centered), geometric clustering, or an honest stack-fallback. */
  layout: { nodeId: string; source: 'table' | 'grid' | 'centered' | 'geometry' | 'stack-fallback'; detail?: string }[];
  unmatchedFonts: string[];
  unmatchedIcons: string[];
  warnings: string[];
}

function emptyReport(): ImportReport {
  return { counts: { nodes: 0, frames: 0, text: 0, maxDepth: 0, dropped: 0 }, snapped: [], literals: [], scaleMatches: [], layout: [], unmatchedFonts: [], unmatchedIcons: [], warnings: [] };
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

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

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

    // ── table reconstruction (Phase 18 slice B) ──
    if (node.tag === 'table') {
      const built = convertTable(node, depth);
      if (built) return built; // a row-less table falls through to the generic path
    }

    // ── grid reconstruction (Phase 18 slice C) ──
    if ((node.styles.display === 'grid' || node.styles.display === 'inline-grid') && node.children.length) {
      const built = convertGrid(node, depth, parent);
      if (built) return built;
      // Unreconstructable template → vertical stack; slice D's clustering will
      // claim these, until then the degradation is warned, not silent.
      if (!report.warnings.some((w) => w.includes('grid'))) {
        report.warnings.push('A CSS grid container with an irregular template was imported as a vertical stack.');
      }
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

    // Centered-child detection (Phase 18 FR-C2): auto margins and max-width
    // are how the web centers — neither survives as a computed "center" value,
    // so without this the sign-in card spreads full-bleed (#92 repro 2).
    const parentContent = node.rect.w - (px(node.styles.paddingLeft) ?? 0) - (px(node.styles.paddingRight) ?? 0);
    let centeredDetail: string | null = null;

    const pairs: { raw: RawDomNode; scene: SceneNode }[] = [];
    for (const child of node.children) {
      const c = convert(child, depth + 1, node);
      if (!c) continue;

      const mw = px(child.styles.maxWidth); // 'none' / percentages → undefined
      const ml = px(child.styles.marginLeft) ?? 0;
      const mr = px(child.styles.marginRight) ?? 0;
      const narrower = child.rect.w > 0 && child.rect.w < parentContent - 8;
      if (mw !== undefined && (c.type === 'frame' || c.type === 'image')) {
        // The renderer's fluid idiom: fill the row, cap at the real max.
        c.width = '100%';
        c.maxWidth = mw;
        if (narrower) centeredDetail = 'max-width child';
      } else if (ml > 0 && Math.abs(ml - mr) <= 1 && narrower) {
        // margin: auto resolves to equal px in computed styles.
        if (c.width === undefined) c.width = child.rect.w;
        centeredDetail = 'auto-margin child';
      }
      pairs.push({ raw: child, scene: c });
      childNodes.push(c);
    }

    const fp = frameProps(node, parent);

    // Geometry-clustering fallback (Phase 18 FR-D1): block-flow containers
    // whose children's boxes form rows of columns (floats, inline-block,
    // unmodeled CSS). Flex/grid/table never reach this (handled above); a
    // synthesized text child (mixed content) skips it — pairs must map 1:1.
    const isBlockFlow = !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(node.styles.display);
    if (isBlockFlow && !node.text && pairs.length >= 2 && centeredDetail === null) {
      const clustered = clusterIntoRows(pairs);
      if (clustered === 'fallback') {
        const frame: SceneNode = { id: nextId('frame'), type: 'frame', ...fp, children: childNodes };
        report.layout.push({ nodeId: frame.id, source: 'stack-fallback', detail: 'multi-column boxes, inconsistent bands' });
        report.warnings.push('A container looked multi-column but its boxes did not cluster consistently — imported as a vertical stack (see report.layout).');
        return count(mergeIntent(frame, node));
      }
      if (clustered) {
        const frame: SceneNode = {
          id: nextId('frame'), type: 'frame', ...fp,
          layout: 'vertical' as const,
          ...(clustered.rowGap ? { gap: clustered.rowGap } : {}),
          children: clustered.rows,
        };
        report.counts.maxDepth = Math.max(report.counts.maxDepth, depth + 1);
        report.layout.push({ nodeId: frame.id, source: 'geometry', detail: clustered.detail });
        return count(mergeIntent(frame, node));
      }
    }

    const centerable = centeredDetail !== null && fp.layout !== 'horizontal' && fp.alignItems === undefined;
    const frame: SceneNode = {
      id: nextId('frame'), type: 'frame', ...fp,
      ...(centerable ? { alignItems: 'center' as const, ...(fp.layout ? {} : { layout: 'vertical' as const }) } : {}),
      ...(childNodes.length ? { children: childNodes } : {}),
    };
    if (centerable) report.layout.push({ nodeId: frame.id, source: 'centered', detail: centeredDetail! });
    return count(mergeIntent(frame, node));
  };

  /** FR-D1's clustering core. Bands form by ≥50% vertical overlap (against the
   * band's first box); reconstruction requires consistency (spec C3 — a wrong
   * reconstruction is worse than an honest stack): all full bands agree on
   * column count ±1 with a possibly-smaller last band, or a single ≥2-item
   * band of substantial (>64px) boxes. Returns rows-of-columns, 'fallback'
   * (looked multi-column, failed the guards), or null (genuinely vertical). */
  const clusterIntoRows = (pairs: { raw: RawDomNode; scene: SceneNode }[]):
    { rows: SceneNode[]; rowGap: number; detail: string } | 'fallback' | null => {
    const sorted = [...pairs].sort((a, b) => a.raw.rect.y - b.raw.rect.y);
    const bands: { raw: RawDomNode; scene: SceneNode }[][] = [];
    for (const p of sorted) {
      const band = bands[bands.length - 1];
      if (band) {
        const ref = band[0].raw.rect;
        const overlap = Math.min(ref.y + ref.h, p.raw.rect.y + p.raw.rect.h) - Math.max(ref.y, p.raw.rect.y);
        if (overlap >= 0.5 * Math.min(ref.h, p.raw.rect.h)) {
          band.push(p);
          continue;
        }
      }
      bands.push([p]);
    }

    const counts = bands.map((b) => b.length);
    const maxCount = Math.max(...counts);
    if (maxCount < 2) return null; // genuinely vertical

    // Consistency guards (C3).
    let consistent: boolean;
    if (bands.length === 1) {
      consistent = bands[0].every(({ raw }) => raw.rect.w > 64);
    } else {
      const full = counts.slice(0, -1);
      const last = counts[counts.length - 1];
      consistent = full.every((c) => c >= 2 && maxCount - c <= 1) && last <= maxCount;
    }
    if (!consistent) return 'fallback';

    const rows: SceneNode[] = [];
    for (const band of bands) {
      band.sort((a, b) => a.raw.rect.x - b.raw.rect.x);
      if (band.length === 1) {
        rows.push(band[0].scene);
        continue;
      }
      const totalW = band.reduce((s, { raw }) => s + raw.rect.w, 0) || 1;
      const bandGaps: number[] = [];
      let pctUsed = 0;
      band.forEach(({ raw, scene }, i) => {
        const isLast = i === band.length - 1;
        const pct = isLast ? Math.round((100 - pctUsed) * 10) / 10 : Math.round((raw.rect.w / totalW) * 1000) / 10;
        pctUsed += pct;
        scene.width = `${pct}%`;
        if (i > 0) bandGaps.push(Math.max(raw.rect.x - (band[i - 1].raw.rect.x + band[i - 1].raw.rect.w), 0));
      });
      const rowGapX = bandGaps.length ? Math.round(median(bandGaps)) : 0;
      rows.push(count({
        id: nextId('clusterrow'), type: 'frame', name: 'Cluster row',
        layout: 'horizontal', width: '100%',
        ...(rowGapX > 0 ? { gap: rowGapX } : {}),
        children: band.map((p) => p.scene),
      }));
    }

    const yGaps: number[] = [];
    for (let i = 1; i < bands.length; i++) {
      const prev = bands[i - 1][0].raw.rect, cur = bands[i][0].raw.rect;
      yGaps.push(Math.max(cur.y - (prev.y + prev.h), 0));
    }
    return {
      rows,
      rowGap: yGaps.length ? Math.round(median(yGaps)) : 0,
      detail: `${bands.length} rows × ~${maxCount} cols`,
    };
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

  /** Table → vertical frame of horizontal row frames with PERCENTAGE cell
   * widths (spec 18 C1 — fluid, the row is the 100% basis, last cell absorbs
   * rounding). thead/tbody/tfoot unwrap; <caption> becomes a text node above;
   * row/cell bottom borders become hairline divider frames (C2 — exact
   * horizontal rules, no invented side borders). Reconstructed frames carry
   * names (Table/Row/Cell) — semantic, and the wrapper-collapse guard keys on
   * them. Returns null for a row-less table (generic frame path takes over). */
  const convertTable = (table: RawDomNode, depth: number): SceneNode | null => {
    const rows: { raw: RawDomNode; isHeader: boolean }[] = [];
    let caption: RawDomNode | null = null;
    for (const child of table.children) {
      if (child.tag === 'caption') { caption = child; continue; }
      if (child.tag === 'tr') rows.push({ raw: child, isHeader: child.children.some((c) => c.tag === 'th') });
      if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
        for (const tr of child.children) {
          if (tr.tag === 'tr') rows.push({ raw: tr, isHeader: child.tag === 'thead' });
        }
      }
    }
    const visibleRows = rows.filter(({ raw }) => !flatten.dropInvisible || (raw.styles.display !== 'none' && !(raw.rect.w <= 0 && raw.rect.h <= 0)));
    if (!visibleRows.length) return null;

    let warnedRowspan = false;
    let maxCols = 0;
    const children: SceneNode[] = [];

    if (caption?.text) {
      children.push(count({ id: nextId('text'), type: 'text', content: caption.text, ...textProps(caption) }));
    }

    for (const { raw: tr, isHeader } of visibleRows) {
      const cells = tr.children.filter((c) => (c.tag === 'td' || c.tag === 'th')
        && (!flatten.dropInvisible || c.styles.display !== 'none'));
      if (!cells.length) continue;

      const totalW = cells.reduce((sum, c) => sum + c.rect.w, 0) || tr.rect.w || 1;
      const cellFrames: SceneNode[] = [];
      let pctUsed = 0;
      cells.forEach((cell, i) => {
        if (!warnedRowspan && (cell.attrs.rowSpan ?? 1) > 1) {
          warnedRowspan = true;
          report.warnings.push('A rowspan cell was mapped to its first row only — rowspan reconstruction is out of scope.');
        }
        const isLast = i === cells.length - 1;
        const pct = isLast ? Math.round((100 - pctUsed) * 10) / 10 : Math.round((cell.rect.w / totalW) * 1000) / 10;
        pctUsed += pct;

        const cellChildren: SceneNode[] = [];
        if (cell.text) cellChildren.push(count({ id: nextId('text'), type: 'text', content: cell.text, ...textProps(cell) }));
        for (const cc of cell.children) {
          const converted = convert(cc, depth + 3, cell);
          if (converted) cellChildren.push(converted);
        }
        cellFrames.push(count({
          id: nextId('cell'), type: 'frame', name: 'Cell',
          ...frameProps(cell, tr),
          width: `${pct}%`,
          ...(cellChildren.length ? { children: cellChildren } : {}),
        }));
      });
      maxCols = Math.max(maxCols, cellFrames.length);

      const rowProps = frameProps(tr, table);
      children.push(count({
        id: nextId('row'), type: 'frame', name: isHeader ? 'Header row' : 'Row',
        ...rowProps,
        layout: 'horizontal', width: '100%', alignItems: 'center',
        children: cellFrames,
      }));

      // Divider (FR-B2): row or first-cell bottom border → exact horizontal rule.
      const src = (px(tr.styles.borderBottomWidth) ?? 0) > 0 ? tr.styles : cells[0].styles;
      const dw = px(src.borderBottomWidth) ?? 0;
      const dc = cssColor(src.borderBottomColor);
      if (dw > 0 && src.borderBottomStyle !== 'none' && dc) {
        children.push(count({ id: nextId('divider'), type: 'frame', name: 'Divider', width: '100%', height: dw, fill: dc }));
      }
    }
    if (!children.length) return null;

    const tableFrame = count({
      id: nextId('table'), type: 'frame', name: 'Table',
      ...frameProps(table, null),
      layout: 'vertical' as const,
      width: '100%',
      children,
    });
    report.counts.maxDepth = Math.max(report.counts.maxDepth, depth + 2);
    report.layout.push({ nodeId: tableFrame.id, source: 'table', detail: `${visibleRows.length} rows × ${maxCols} cols` });
    return tableFrame;
  };

  /** Grid → rows of proportional columns (spec 18 FR-C1). The computed
   * grid-template-columns of a laid-out grid is a resolved px list — parse it
   * into tracks, chunk children row-major (a child spans k tracks via numeric
   * grid-column or its rect width), and emit horizontal 'Grid row' frames with
   * percentage cell widths. Single-track templates become a faithful vertical
   * frame (no warning — a 1-col grid IS a stack). Returns null when the
   * template doesn't resolve to px tracks (slice D's clustering claims those). */
  const convertGrid = (grid: RawDomNode, depth: number, parent: RawDomNode | null): SceneNode | null => {
    const template = grid.styles.gridTemplateColumns ?? '';
    const tokens = template.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.some((t) => !/^\d+(\.\d+)?px$/.test(t))) return null;
    const tracks = tokens.map((t) => parseFloat(t));
    const colGap = px(grid.styles.columnGap) ?? 0;
    const rowGap = px(grid.styles.rowGap) ?? 0;

    const visible = grid.children.filter((c) => !flatten.dropInvisible
      || (c.styles.display !== 'none' && c.styles.visibility !== 'hidden' && !c.attrs.ariaHidden && !(c.rect.w <= 0 && c.rect.h <= 0)));
    if (!visible.length) return null;

    // Visual props only — layout/gap are set explicitly per the reconstruction.
    const gridFrame: Partial<SceneNode> = frameProps(grid, parent);
    delete (gridFrame as Record<string, unknown>).layout;
    delete (gridFrame as Record<string, unknown>).gap;

    // Single column: a faithful vertical stack.
    if (tracks.length === 1) {
      const children = visible.map((c) => convert(c, depth + 1, grid)).filter((c): c is SceneNode => c !== null);
      const frame = count({ id: nextId('grid'), type: 'frame' as const, name: 'Grid', ...gridFrame, layout: 'vertical' as const, ...(rowGap ? { gap: rowGap } : {}), children });
      report.layout.push({ nodeId: frame.id, source: 'grid', detail: `${children.length} rows × 1 col` });
      return frame;
    }

    const totalW = tracks.reduce((s, t) => s + t, 0) + colGap * (tracks.length - 1);
    const avgTrack = tracks.reduce((s, t) => s + t, 0) / tracks.length;

    /** Tracks a child occupies: numeric grid-column wins; else its rect width. */
    const spanOf = (c: RawDomNode): number => {
      const start = parseInt(c.styles.gridColumnStart ?? '', 10);
      const end = parseInt(c.styles.gridColumnEnd ?? '', 10);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) return Math.min(end - start, tracks.length);
      return Math.max(1, Math.min(Math.round((c.rect.w + colGap) / (avgTrack + colGap)), tracks.length));
    };

    // Row-major auto-placement: a child that doesn't fit the remaining slots wraps.
    const rowFrames: SceneNode[] = [];
    let slot = 0;
    let current: SceneNode[] = [];
    const flushRow = () => {
      if (!current.length) return;
      rowFrames.push(count({
        id: nextId('gridrow'), type: 'frame', name: 'Grid row',
        layout: 'horizontal', width: '100%', ...(colGap ? { gap: colGap } : {}),
        children: current,
      }));
      current = [];
      slot = 0;
    };
    for (const child of visible) {
      const span = spanOf(child);
      if (slot + span > tracks.length) flushRow();
      const converted = convert(child, depth + 2, grid);
      if (!converted) continue;
      const spanW = tracks.slice(slot, slot + span).reduce((s, t) => s + t, 0) + colGap * (span - 1);
      converted.width = `${Math.round((spanW / totalW) * 1000) / 10}%`;
      current.push(converted);
      slot += span;
      if (slot >= tracks.length) flushRow();
    }
    flushRow();
    if (!rowFrames.length) return null;

    const frame = count({
      id: nextId('grid'), type: 'frame' as const, name: 'Grid',
      ...gridFrame, layout: 'vertical' as const, ...(rowGap ? { gap: rowGap } : {}),
      ...(widthFor(grid, parent) !== undefined ? { width: widthFor(grid, parent) } : {}),
      children: rowFrames,
    });
    report.counts.maxDepth = Math.max(report.counts.maxDepth, depth + 1);
    report.layout.push({ nodeId: frame.id, source: 'grid', detail: `${rowFrames.length} rows × ${tracks.length} cols` });
    return frame;
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
      // Parseable grids never reach here (convertGrid claims them); this is
      // the unreconstructable-template fallback. The warning lives at the
      // fallthrough site in convert().
      out.layout = 'vertical';
      const gap = px(s.rowGap) ?? px(s.columnGap);
      if (gap) out.gap = gap;
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

// Props that make a single-child wrapper meaningful: visual styling, or layout
// that positions the child (alignItems/justifyContent center a lone child;
// maxWidth caps it — Phase 18 FR-C2 depends on these surviving the collapse).
// A bare `layout` direction alone says nothing about one child and stays
// collapsible.
const WRAPPER_SUBSTANCE_PROPS: (keyof SceneNode)[] = [
  'fill', 'stroke', 'shadows', 'cornerRadius', 'opacity', 'gap', 'padding', 'overflow', 'gradient',
  'alignItems', 'justifyContent', 'maxWidth',
];

function isPlainWrapper(node: SceneNode): boolean {
  if (node.type !== 'frame' || (node.children?.length ?? 0) !== 1) return false;
  // Named frames are semantic (Phase 18 reconstruction: Table/Row/Cell/Divider)
  // — never collapse them, even when visually bare (a one-column row, say).
  if (node.name !== undefined) return false;
  return WRAPPER_SUBSTANCE_PROPS.every((p) => node[p] === undefined);
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
        if (vars.colors?.[name] === undefined) {
          // Unresolvable intent ref (spec 18 FR-A1). If the intent overrode a
          // real computed value, that value is ground truth — revert to it
          // (the report.snapped entry is the undo log) and re-snap it like any
          // literal. Only refs from unstyled snippets survive (with the
          // warning): there, the class name is the only information we have.
          const snappedIdx = report.snapped.findIndex((s) => s.nodeId === node.id && s.prop === prop && s.token === value);
          const from = snappedIdx >= 0 ? report.snapped[snappedIdx].from : undefined;
          if (from !== undefined && from !== '(unstyled)') {
            (node as unknown as Record<string, unknown>)[prop] = from;
            report.snapped.splice(snappedIdx, 1);
            snapColor(node, prop, from);
          } else {
            unresolvedRefs.add(name);
          }
        }
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

/** Render an imported tree the same way a canvas renders (Phase 16 font
 * backstop included) WITHOUT creating a canvas — canvas_sync_from_url diffs
 * this against the stored design (spec FR-D1: ephemeral, mutates nothing). */
export async function renderImportedTree(root: SceneNode, width: number, height: number): Promise<string> {
  const doc: SceneNode = { id: 'sync-doc', type: 'document', fill: '#FFFFFF', width, height, children: [root] };
  const { extraFonts } = await ensureFontsForRender(doc, { fonts: [] } as unknown as Canvas, undefined);
  return renderToHtml(doc, width, height, undefined, { extraFonts });
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
