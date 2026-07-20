import type { Canvas, SceneNode, DesignVariables } from './types.js';
import { resolveVariables } from './variables.js';
import { getCanvasTokens } from './workspaces.js';
import { renderToHtml } from './renderer.js';
import { computeLayout, type LayoutRect } from './screenshot.js';

// --- Types ---

export type IssueSeverity = 'error' | 'warning' | 'info';

/** Phase 12 — discriminator for `cliche`-category issues so downstream code
 * (autofix filtering, genre relax, the viewer) keys off a field instead of
 * string-matching the message. Only set on `category: 'cliche'` issues. */
export type ClicheTell =
  | 'accent-hue'
  | 'gradient-glow'
  | 'fake-chrome'
  | 'hanging-header'
  | 'honest-content'
  | 'eyebrow-rhythm'
  | 'slop-copy'
  | 'radius-consistency'
  | 'pure-black-white'
  | 'accent-consistency';

export interface EvaluationIssue {
  category: string;
  /** Present only on `cliche` issues — which machine-made tell fired. */
  tell?: ClicheTell;
  severity: IssueSeverity;
  nodeId: string;
  nodeName?: string;
  message: string;
  suggestion?: string;
  /**
   * Mechanically derived fix the AI / user can apply by running `op` through
   * the `batch_design` tool. Only present when the check can fix the issue
   * without a judgement call (off-scale spacing, missing layout on a
   * multi-child frame, recoverable contrast failure).
   */
  fix?: AutoFix;
}

export interface AutoFix {
  /** Ready-to-run batch_design Update op, e.g. `U("foo", { color: "#000000" })`. */
  op: string;
  /** One-line human-readable explanation of what this fix changes and why. */
  rationale: string;
}

export interface CategoryScore {
  name: string;
  score: number;
  issueCount: number;
  weight: number;
}

export interface EvaluationResult {
  overallScore: number;
  categories: CategoryScore[];
  issues: EvaluationIssue[];
  summary: string;
  stats: {
    totalNodes: number;
    textNodes: number;
    frameNodes: number;
    maxDepth: number;
    tokenUsagePercent: number;
    componentReusePercent: number;
  };
  mode: 'fast' | 'detailed' | 'llm';
  /**
   * Present only when mode is 'llm'. The heuristic categories above still run
   * (so you don't lose the deterministic signal); this field carries the
   * vision-model's holistic critique on top.
   */
  llmCritique?: import('./llm-judge.js').LLMJudgeResult;
}

interface NodeEntry {
  node: SceneNode;
  parent: SceneNode | null;
  depth: number;
}

interface CheckResult {
  score: number;
  issues: EvaluationIssue[];
}

// --- Color utilities ---

export function parseColor(str: string): [number, number, number] | null {
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

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(
    (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)),
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(...fg);
  const l2 = relativeLuminance(...bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Phase 12 — HSL conversion for hue-based tells (default purple/indigo accent,
// chromatic-glow detection). `h` in [0,360), `s`/`l` in [0,1].
export function rgbToHsl(rgb: [number, number, number]): { h: number; s: number; l: number } {
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s, l };
}

// Phase 12 — alpha channel for glow detection (a low-alpha colored shadow reads
// as a bloom). Handles #RRGGBBAA and rgba(); everything else is opaque.
export function parseAlpha(str: string): number {
  if (!str || typeof str !== 'string') return 1;
  const hex8 = str.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i);
  if (hex8) return parseInt(hex8[1], 16) / 255;
  const rgba = str.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i);
  if (rgba) return Math.max(0, Math.min(1, parseFloat(rgba[1])));
  return 1;
}

// --- Tree walking ---

function buildTreeContext(root: SceneNode): NodeEntry[] {
  const entries: NodeEntry[] = [];

  function walk(node: SceneNode, parent: SceneNode | null, depth: number) {
    entries.push({ node, parent, depth });
    if (node.children) {
      for (const child of node.children) {
        walk(child, node, depth + 1);
      }
    }
  }

  walk(root, null, 0);
  return entries;
}

// --- AutoFix helpers ---

// Format a batch_design Update op string. JSON.stringify handles primitive
// values correctly: strings become quoted (`"#FFF"`), numbers stay bare (`16`).
function formatUpdateOp(nodeId: string, props: Record<string, unknown>): string {
  const entries = Object.entries(props).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `U("${nodeId}", { ${entries.join(', ')} })`;
}

// Pick #FFFFFF or #000000 — whichever has higher contrast against the given
// background. Returns null if neither meets the WCAG threshold required for
// the text size, signaling that the bg also has to change (out of scope here).
function pickHighContrastColor(bg: [number, number, number], required: number): string | null {
  const whiteRatio = contrastRatio([255, 255, 255], bg);
  const blackRatio = contrastRatio([0, 0, 0], bg);
  const best = whiteRatio >= blackRatio ? '#FFFFFF' : '#000000';
  const bestRatio = Math.max(whiteRatio, blackRatio);
  return bestRatio >= required ? best : null;
}

// --- Checkers ---

const DEFAULT_SPACING_SCALE = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64];

function checkSpacing(entries: NodeEntry[], variables: DesignVariables): CheckResult {
  const issues: EvaluationIssue[] = [];
  const scale = variables.spacing
    ? Object.values(variables.spacing).sort((a, b) => a - b)
    : DEFAULT_SPACING_SCALE;

  // Scalar padding and gap are single-property fixes. Array-form padding gets
  // ONE combined issue per node whose fix writes the complete snapped array —
  // per-entry ops would clobber each other (Phase 22 slice B, #133). Array
  // members still enter `allValues` for the score math, but `arrayMember`
  // routes their reporting to the combined issue below.
  const allValues: { value: number; nodeId: string; nodeName?: string; prop: string; fixable: boolean; arrayMember?: boolean }[] = [];
  const arrayPaddings: { nodeId: string; nodeName?: string; padding: number[] }[] = [];

  for (const { node } of entries) {
    if (node.gap !== undefined && typeof node.gap === 'number') {
      allValues.push({ value: node.gap, nodeId: node.id, nodeName: node.name, prop: 'gap', fixable: true });
    }
    if (node.padding !== undefined) {
      if (typeof node.padding === 'number' && node.padding > 0) {
        allValues.push({ value: node.padding, nodeId: node.id, nodeName: node.name, prop: 'padding', fixable: true });
      } else if (Array.isArray(node.padding) && node.padding.every((p) => typeof p === 'number')) {
        arrayPaddings.push({ nodeId: node.id, nodeName: node.name, padding: node.padding as number[] });
        for (const p of node.padding) {
          if (p > 0) {
            allValues.push({ value: p, nodeId: node.id, nodeName: node.name, prop: 'padding', fixable: false, arrayMember: true });
          }
        }
      }
    }
  }

  if (allValues.length === 0) return { score: 100, issues };

  const nearestOnScale = (value: number) => scale.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));

  let offScaleCount = 0;
  for (const v of allValues) {
    if (!scale.includes(v.value)) {
      offScaleCount++;
      if (v.arrayMember) continue; // reported as one combined issue per node below
      const nearest = nearestOnScale(v.value);
      const issue: EvaluationIssue = {
        category: 'spacing',
        severity: 'warning',
        nodeId: v.nodeId,
        nodeName: v.nodeName,
        message: `${v.prop}: ${v.value}px is not on the spacing scale.`,
        suggestion: `Use ${nearest}px instead.`,
      };
      if (v.fixable) {
        issue.fix = {
          op: formatUpdateOp(v.nodeId, { [v.prop]: nearest }),
          rationale: `Snap ${v.prop} to ${nearest}px on the spacing scale`,
        };
      }
      issues.push(issue);
    }
  }

  // Array-form padding: one issue per node, fix = the complete snapped array
  // (zero/negative entries pass through untouched — they were never flagged).
  for (const ap of arrayPaddings) {
    const offScale = ap.padding.filter((p) => p > 0 && !scale.includes(p));
    if (offScale.length === 0) continue;
    const snapped = ap.padding.map((p) => (p > 0 && !scale.includes(p) ? nearestOnScale(p) : p));
    issues.push({
      category: 'spacing',
      severity: 'warning',
      nodeId: ap.nodeId,
      nodeName: ap.nodeName,
      message: `padding: [${ap.padding.join(', ')}] has off-scale entries (${offScale.join(', ')}).`,
      suggestion: `Use [${snapped.join(', ')}] instead.`,
      fix: {
        op: formatUpdateOp(ap.nodeId, { padding: snapped }),
        rationale: `Snap padding to [${snapped.join(', ')}] on the spacing scale`,
      },
    });
  }

  const uniqueValues = new Set(allValues.map((v) => v.value)).size;
  if (uniqueValues > 6) {
    issues.push({
      category: 'spacing',
      severity: 'info',
      nodeId: entries[0].node.id,
      message: `Design uses ${uniqueValues} unique spacing values. Consider consolidating to 4-6 values.`,
    });
  }

  let score = 100 - (offScaleCount / allValues.length) * 60;
  if (uniqueValues > 6) score -= 15;
  if (uniqueValues > 10) score -= 10;
  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

function checkColorContrast(entries: NodeEntry[]): CheckResult {
  const issues: EvaluationIssue[] = [];
  const textNodes = entries.filter((e) => e.node.type === 'text');

  if (textNodes.length === 0) return { score: 100, issues };

  let failCount = 0;

  for (const { node, parent } of textNodes) {
    const fgStr = node.color ?? '#000000';
    const fg = parseColor(fgStr);
    if (!fg) continue;

    // Walk up to find nearest background fill
    let bgStr: string | null = null;
    let current = parent;
    const allEntries = entries;
    while (current) {
      if (current.gradient) {
        issues.push({
          category: 'color',
          severity: 'info',
          nodeId: node.id,
          nodeName: node.name,
          message: `Text "${(node.content ?? '').slice(0, 30)}" is on a gradient background. Cannot compute contrast automatically.`,
        });
        bgStr = null;
        break;
      }
      if (current.fill && !current.fill.startsWith('$')) {
        bgStr = current.fill;
        break;
      }
      // Find parent of current
      const parentEntry = allEntries.find((e) => e.node.children?.includes(current!));
      current = parentEntry?.node ?? null;
    }

    if (!bgStr) continue;
    const bg = parseColor(bgStr);
    if (!bg) continue;

    // Round to 2 decimals — the precision contrast is conventionally reported at
    // (WebAIM et al.). Comparing the rounded value stops a ratio that rounds to
    // exactly the WCAG threshold (a true 4.499 shown as "4.5:1") from being
    // flagged, and keeps the displayed number honest (no 1-decimal "4.5" for a
    // value that actually failed at 4.46).
    const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
    const fontSize = node.fontSize ?? 16;
    const fontWeight = typeof node.fontWeight === 'number' ? node.fontWeight : 400;
    const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
    const required = isLargeText ? 3 : 4.5;

    if (ratio < required) {
      failCount++;
      const issue: EvaluationIssue = {
        category: 'color',
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `Text "${(node.content ?? '').slice(0, 30)}" has contrast ratio ${ratio.toFixed(2)}:1 against ${bgStr}. WCAG AA requires ${required}:1.`,
        suggestion: `Increase contrast by darkening/lightening the text or background.`,
      };
      const recoverColor = pickHighContrastColor(bg, required);
      if (recoverColor) {
        issue.fix = {
          op: formatUpdateOp(node.id, { color: recoverColor }),
          rationale: `Switch text color to ${recoverColor} for WCAG AA contrast against ${bgStr}`,
        };
      }
      issues.push(issue);
    }
  }

  const score = Math.max(0, Math.round(100 - (failCount / textNodes.length) * 100));
  return { score, issues };
}

function checkTypography(entries: NodeEntry[]): CheckResult {
  const issues: EvaluationIssue[] = [];
  const textNodes = entries.filter((e) => e.node.type === 'text');

  if (textNodes.length === 0) return { score: 100, issues };

  const fontSizes = textNodes.map((e) => e.node.fontSize).filter((s): s is number => s !== undefined);
  const uniqueSizes = [...new Set(fontSizes)].sort((a, b) => b - a);
  const fontFamilies = new Set(textNodes.map((e) => e.node.fontFamily).filter(Boolean));
  const fontWeights = new Set(textNodes.map((e) => e.node.fontWeight).filter((w) => w !== undefined));

  let score = 100;

  // Check type scale ratios
  if (uniqueSizes.length >= 2) {
    for (let i = 0; i < uniqueSizes.length - 1; i++) {
      const ratio = uniqueSizes[i] / uniqueSizes[i + 1];
      if (ratio < 1.1 || ratio > 2.0) {
        score -= 10;
        issues.push({
          category: 'typography',
          severity: 'warning',
          nodeId: textNodes.find((e) => e.node.fontSize === uniqueSizes[i])?.node.id ?? entries[0].node.id,
          message: `Font sizes ${uniqueSizes[i]}px → ${uniqueSizes[i + 1]}px have ratio ${ratio.toFixed(2)} (expected 1.15-1.75).`,
          suggestion: `Adjust to create a cleaner type scale.`,
        });
      }
    }
  }

  if (uniqueSizes.length > 6) {
    score -= 15;
    issues.push({
      category: 'typography',
      severity: 'info',
      nodeId: entries[0].node.id,
      message: `Design uses ${uniqueSizes.length} unique font sizes. A clean type scale typically has 4-6.`,
    });
  }

  if (fontFamilies.size > 3) {
    score -= 10;
    issues.push({
      category: 'typography',
      severity: 'warning',
      nodeId: entries[0].node.id,
      message: `Design uses ${fontFamilies.size} font families. Consider limiting to 2-3 for consistency.`,
    });
  }

  if (fontWeights.size <= 1 && textNodes.length > 3) {
    score -= 10;
    issues.push({
      category: 'typography',
      severity: 'info',
      nodeId: entries[0].node.id,
      message: `All text uses the same font weight. Vary weights to establish visual hierarchy.`,
    });
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

function checkStructure(entries: NodeEntry[], canvas: Canvas): CheckResult {
  const issues: EvaluationIssue[] = [];
  let score = 100;

  const maxDepth = Math.max(...entries.map((e) => e.depth));
  const totalNodes = entries.length;
  const instanceNodes = entries.filter((e) => e.node.type === 'instance').length;
  const nonLeafNodes = entries.filter((e) => e.node.children && e.node.children.length > 0);
  const namedNonLeaf = nonLeafNodes.filter((e) => e.node.name);

  // Depth check
  if (maxDepth > 12) {
    score -= 20;
    const deepNode = entries.find((e) => e.depth === maxDepth);
    issues.push({
      category: 'structure',
      severity: 'error',
      nodeId: deepNode?.node.id ?? entries[0].node.id,
      nodeName: deepNode?.node.name,
      message: `Tree depth is ${maxDepth} levels. Consider flattening (recommended max: 8).`,
    });
  } else if (maxDepth > 8) {
    score -= 5 * (maxDepth - 8);
    const deepNode = entries.find((e) => e.depth === maxDepth);
    issues.push({
      category: 'structure',
      severity: 'warning',
      nodeId: deepNode?.node.id ?? entries[0].node.id,
      nodeName: deepNode?.node.name,
      message: `Tree depth is ${maxDepth} levels (recommended max: 8).`,
    });
  }

  // Naming coverage
  if (nonLeafNodes.length > 0) {
    const namingPercent = Math.round((namedNonLeaf.length / nonLeafNodes.length) * 100);
    if (namingPercent < 50) {
      score -= 10;
      issues.push({
        category: 'structure',
        severity: 'info',
        nodeId: entries[0].node.id,
        message: `Only ${namingPercent}% of container nodes have names. Naming improves maintainability.`,
      });
    }
  }

  // Token usage
  const hasVariables = canvas.variables && (
    Object.keys(canvas.variables.colors ?? {}).length > 0 ||
    Object.keys(canvas.variables.spacing ?? {}).length > 0
  );
  if (hasVariables) {
    let tokenRefs = 0;
    let totalProps = 0;
    for (const { node } of entries) {
      for (const [key, val] of Object.entries(node)) {
        if (['id', 'type', 'name', 'children'].includes(key)) continue;
        if (typeof val === 'string') {
          totalProps++;
          if (val.startsWith('$')) tokenRefs++;
        }
      }
    }
    if (totalProps > 0) {
      const tokenPercent = Math.round((tokenRefs / totalProps) * 100);
      if (tokenPercent < 30) {
        score -= 10;
        issues.push({
          category: 'structure',
          severity: 'warning',
          nodeId: entries[0].node.id,
          message: `Only ${tokenPercent}% of values use design tokens ($variables). Using tokens improves consistency.`,
        });
      }
    }
  }

  // Component reuse
  if (totalNodes > 10 && instanceNodes === 0) {
    issues.push({
      category: 'structure',
      severity: 'info',
      nodeId: entries[0].node.id,
      message: `No component instances found in ${totalNodes} nodes. Consider extracting repeated patterns into components.`,
    });
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

function checkConsistency(entries: NodeEntry[]): CheckResult {
  const issues: EvaluationIssue[] = [];
  let score = 100;

  // Frames with children but no layout
  for (const { node } of entries) {
    if (
      ['frame', 'component'].includes(node.type) &&
      node.children &&
      node.children.length > 1 &&
      !node.layout
    ) {
      score -= 5;
      // Default to vertical — matches the renderer's implicit fallback for
      // containers without `layout` set, and is the more common authoring intent.
      issues.push({
        category: 'consistency',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `Frame "${node.name ?? node.id}" has ${node.children.length} children but no layout property.`,
        suggestion: `Set layout to "horizontal" or "vertical".`,
        fix: {
          op: formatUpdateOp(node.id, { layout: 'vertical' }),
          rationale: 'Set layout to "vertical" (matches renderer default for multi-child frames)',
        },
      });
    }
  }

  // Sibling padding uniformity
  for (const { node } of entries) {
    if (!node.children || node.children.length < 2) continue;
    const childPaddings = node.children
      .map((c) => (typeof c.padding === 'number' ? c.padding : Array.isArray(c.padding) ? JSON.stringify(c.padding) : null))
      .filter(Boolean);
    if (childPaddings.length >= 2) {
      const unique = new Set(childPaddings.map(String));
      if (unique.size > 1) {
        score -= 5;
        issues.push({
          category: 'consistency',
          severity: 'info',
          nodeId: node.id,
          nodeName: node.name,
          message: `Sibling nodes in "${node.name ?? node.id}" have inconsistent padding values.`,
          suggestion: `Unify padding across sibling elements.`,
        });
      }
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

function checkConsistencyDetailed(entries: NodeEntry[], layoutRects: LayoutRect[]): CheckResult {
  const baseResult = checkConsistency(entries);
  const issues = [...baseResult.issues];
  let score = baseResult.score;

  // Build lookup of layout rects by nodeId
  const rectMap = new Map<string, LayoutRect>();
  function indexRects(rects: LayoutRect[]) {
    for (const r of rects) {
      rectMap.set(r.nodeId, r);
      if (r.children) indexRects(r.children);
    }
  }
  indexRects(layoutRects);

  // Check sibling pixel alignment
  for (const { node } of entries) {
    if (!node.children || node.children.length < 2) continue;

    const childRects = node.children
      .map((c) => ({ node: c, rect: rectMap.get(c.id) }))
      .filter((c): c is { node: SceneNode; rect: LayoutRect } => !!c.rect);

    if (childRects.length < 2) continue;

    // Check if non-absolute siblings overlap
    for (let i = 0; i < childRects.length; i++) {
      for (let j = i + 1; j < childRects.length; j++) {
        const a = childRects[i];
        const b = childRects[j];
        if (a.node.position === 'absolute' || b.node.position === 'absolute') continue;

        const overlapX = Math.max(0, Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x));
        const overlapY = Math.max(0, Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y));
        if (overlapX > 2 && overlapY > 2) {
          score -= 10;
          issues.push({
            category: 'consistency',
            severity: 'error',
            nodeId: a.node.id,
            nodeName: a.node.name,
            message: `"${a.node.name ?? a.node.id}" overlaps with "${b.node.name ?? b.node.id}" by ${Math.round(overlapX)}x${Math.round(overlapY)}px.`,
            suggestion: `Adjust spacing or layout to prevent overlap.`,
          });
        }
      }
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

// --- Phase 12: Cliché tells ---
//
// Mechanically detectable signals that mark a design as machine-made. Distinct
// from the craft checks: those score *competence* (contrast, scale, structure);
// these score *taste* — the recurring AI tells (default purple, gradient/glow,
// fake browser chrome, the hanging eyebrow header, fabricated data). Advisory
// by design (warning/info, never a hard error); genre can relax a gate.

/** Genre (active preset / design system) → tells it relaxes because they're
 * intentional in that style. Material Design is legitimately purple. */
const RELAXED_BY_GENRE: Record<string, ClicheTell[]> = {
  // Material Design legitimately uses a purple accent AND white elevated
  // surfaces (cards on an off-white background), so both are intentional here.
  material: ['accent-hue', 'pure-black-white'],
};

/** Canonical unconfigured AI accents — Tailwind indigo/violet/purple defaults,
 * lowercased. An exact match gets a mechanical autofix; a near-purple literal
 * or a $token-resolved purple gets a suggestion only. */
const DEFAULT_AI_ACCENTS = new Set([
  '#6366f1', '#818cf8', '#4f46e5', // indigo 500 / 400 / 600
  '#8b5cf6', '#7c3aed', '#a78bfa', // violet 500 / 600 / 400
  '#a855f7', '#9333ea',            // purple 500 / 600
]);
/** Neutral intentional accent the autofix swaps a default purple to. */
const RECOMMENDED_ACCENT = '#2563EB'; // blue-600

/** Wordmarks that, in placeholder copy, read as a fabricated "as seen in" wall. */
const BRAND_WORDMARKS = [
  'techcrunch', 'forbes', 'the verge', 'wired', 'product hunt',
  'google', 'microsoft', 'apple', 'amazon', 'meta', 'netflix', 'stripe',
];

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toLowerCase();
}

// A hue in the indigo→violet→purple band with real saturation — the "AI purple"
// tell. Floor 230 catches indigo-500 (#6366f1 ≈ h239); a considered blue like
// #2563EB (≈ h221) or #3b82f6 (≈ h217) stays below it.
function isPurpleHue(rgb: [number, number, number]): boolean {
  const { h, s } = rgbToHsl(rgb);
  return h >= 230 && h <= 290 && s >= 0.35;
}

interface ClicheCtx {
  entries: NodeEntry[];          // resolved ($tokens → real values)
  rawById: Map<string, SceneNode>; // raw node lookup (literal vs $token)
  tokens: DesignVariables;
  relaxed: Set<ClicheTell>;
}

// FR-2 / C4 — default purple/indigo accent. Flags accent usage (stroke, small-
// element fill, text/icon color, accent token), not full-bleed backgrounds.
function tellAccentHue(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('accent-hue')) return [];
  const issues: EvaluationIssue[] = [];
  const rootId = ctx.entries[0]?.node.id;

  const isAccentFill = (node: SceneNode): boolean => {
    if (node.id === rootId) return false; // page background, not an accent
    if (node.type === 'ellipse' || node.type === 'rectangle' || node.icon) return true;
    const w = node.width;
    if (typeof w === 'number') return w < 600;        // big surface → background
    if (typeof w === 'string') return false;           // "100%"/"50%" → section
    return (node.children?.length ?? 0) <= 3;          // undefined width: leaf-ish = element
  };

  for (const { node } of ctx.entries) {
    const raw = ctx.rawById.get(node.id);
    const props: { prop: 'fill' | 'stroke' | 'color' | 'iconColor'; accent: boolean }[] = [
      { prop: 'fill', accent: isAccentFill(node) },
      { prop: 'stroke', accent: true },
      { prop: 'color', accent: node.type === 'text' },
      { prop: 'iconColor', accent: !!node.icon },
    ];
    for (const { prop, accent } of props) {
      if (!accent) continue;
      const resolved = node[prop];
      if (typeof resolved !== 'string') continue;
      const rgb = parseColor(resolved);
      if (!rgb || !isPurpleHue(rgb)) continue;

      const rawVal = raw?.[prop];
      const fromToken = typeof rawVal === 'string' && rawVal.startsWith('$');
      const hex = rgbToHex(rgb);
      const issue: EvaluationIssue = {
        category: 'cliche',
        tell: 'accent-hue',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `${prop} ${resolved} is a default-looking purple/indigo accent — the most common machine-made tell.`,
        suggestion: fromToken
          ? `This resolves from a $token; set an intentional accent via set_variables instead of the default purple.`
          : `Pick an accent that fits the brand (a considered blue, green, or warm hue) instead of the default purple.`,
      };
      // Mechanical fix only for an exact unconfigured default written literally
      // on the node — a $token-sourced purple is fixed at the token, not here.
      if (!fromToken && DEFAULT_AI_ACCENTS.has(hex)) {
        issue.fix = {
          op: formatUpdateOp(node.id, { [prop]: RECOMMENDED_ACCENT }),
          rationale: `Swap the default indigo ${hex} for a neutral accent ${RECOMMENDED_ACCENT}`,
        };
      }
      issues.push(issue);
    }
  }

  // Token-level default accent (defined but maybe unused) — suggest-only since
  // tokens are changed via set_variables, not batch_design.
  const accentTok = ctx.tokens.colors?.accent;
  if (typeof accentTok === 'string') {
    const rgb = parseColor(accentTok);
    if (rgb && isPurpleHue(rgb) && !issues.some((i) => i.tell === 'accent-hue')) {
      issues.push({
        category: 'cliche',
        tell: 'accent-hue',
        severity: 'warning',
        nodeId: rootId,
        message: `The "accent" design token (${accentTok}) is a default-looking purple.`,
        suggestion: `Set an intentional accent via set_variables / *_set_design_system.`,
      });
    }
  }
  return issues;
}

// FR-3 / C8 / C9 — gradient & glow/bloom overuse. Recognizes both the
// structured forms and the CSS-string escape hatches the renderer accepts.
function tellGradientGlow(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('gradient-glow')) return [];
  const issues: EvaluationIssue[] = [];

  const gradientNodes = ctx.entries.filter((e) => e.node.gradient != null);
  const fillableCount = ctx.entries.filter((e) =>
    ['frame', 'rectangle', 'ellipse', 'component'].includes(e.node.type),
  ).length;
  const overuseByRatio = fillableCount >= 4 && gradientNodes.length / fillableCount > 0.25;
  if (gradientNodes.length > 2 || overuseByRatio) {
    issues.push({
      category: 'cliche',
      tell: 'gradient-glow',
      severity: 'warning',
      nodeId: gradientNodes[0].node.id,
      nodeName: gradientNodes[0].node.name,
      message: `${gradientNodes.length} nodes use gradients — gradient overuse is a machine-made tell.`,
      suggestion: `Prefer flat $surface fills; reserve a gradient for at most one deliberate focal moment.`,
    });
  }

  // Glow / bloom: a big-blur, chromatic (or translucent-white) shadow.
  const isGlow = (color: string, blur: number): boolean => {
    if (blur < 24) return false;
    const rgb = parseColor(color);
    if (!rgb) return false;
    const { s, l } = rgbToHsl(rgb);
    if (s > 0.25) return true;                       // colored glow
    if (l > 0.85 && parseAlpha(color) < 1) return true; // white bloom / halo
    return false;
  };
  for (const { node } of ctx.entries) {
    let glow = false;
    if (Array.isArray(node.shadows)) {
      glow = node.shadows.some((s) => isGlow(s.color, s.blur));
    }
    if (!glow && typeof node.shadow === 'string') {
      // Best-effort on the CSS string: a large px blur + a chromatic color token.
      const blurs = [...node.shadow.matchAll(/(\d+)px/g)].map((m) => +m[1]);
      const colorM = node.shadow.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/i);
      const blur = blurs.length >= 3 ? blurs[2] : Math.max(0, ...blurs);
      if (colorM && blur >= 24) glow = isGlow(colorM[0], blur);
    }
    if (glow) {
      issues.push({
        category: 'cliche',
        tell: 'gradient-glow',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `"${node.name ?? node.id}" has a colored glow/bloom shadow — a halo tell.`,
        suggestion: `Drop the colored glow; use a subtle neutral shadow (low blur, near-black, low alpha) or none.`,
      });
    }
  }
  return issues;
}

// FR-4 / C6 — fake browser/phone/IDE chrome: a row of ≥3 small circular dots
// (mac traffic lights). Autofix deletes the chrome strip when the dots are the
// whole row; otherwise suggest-only (deleting a shared parent is unsafe).
const MAC_TRAFFIC_LIGHTS = new Set(['#ff5f56', '#ffbd2e', '#27c93f', '#febc2e', '#28c840', '#ff5f57']);
function tellFakeChrome(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('fake-chrome')) return [];
  const issues: EvaluationIssue[] = [];

  const isSmallCircle = (n: SceneNode): boolean => {
    const w = typeof n.width === 'number' ? n.width : Infinity;
    if (w > 20) return false;
    if (n.type === 'ellipse') return true;
    if ((n.type === 'frame' || n.type === 'rectangle') && typeof n.cornerRadius === 'number') {
      return n.cornerRadius >= w / 2; // circular
    }
    return false;
  };

  for (const { node } of ctx.entries) {
    if (!node.children || node.children.length < 3) continue;
    const dots = node.children.filter(isSmallCircle);
    if (dots.length < 3) continue;
    const macColored = dots.filter((d) => {
      const rgb = d.fill ? parseColor(d.fill) : null;
      return rgb && MAC_TRAFFIC_LIGHTS.has(rgbToHex(rgb));
    }).length;
    const dotsAreTheRow = dots.length >= node.children.length - 1; // strip, not a card
    const issue: EvaluationIssue = {
      category: 'cliche',
      tell: 'fake-chrome',
      severity: 'warning',
      nodeId: node.id,
      nodeName: node.name,
      message: `"${node.name ?? node.id}" looks like fake window chrome — ${dots.length} small dots${macColored >= 2 ? ' in traffic-light colors' : ''}. Fake browser/OS chrome is a machine-made tell.`,
      suggestion: `Drop the fake chrome; frame the content directly or use an honest, minimal container.`,
    };
    if (dotsAreTheRow) {
      issue.fix = {
        op: `D("${node.id}")`,
        rationale: `Delete the fake-chrome strip "${node.name ?? node.id}"`,
      };
    }
    issues.push(issue);
  }
  return issues;
}

// FR-5 / C7 — the hanging "tag-left / heading-right" header: a small eyebrow
// beside a big heading, not vertically reconciled. Info + suggestion only.
function tellHangingHeader(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('hanging-header')) return [];
  const issues: EvaluationIssue[] = [];

  const isEyebrow = (n: SceneNode): boolean => {
    if (n.type === 'text') return (n.fontSize ?? 16) <= 14;
    if (n.type === 'frame') {
      const w = typeof n.width === 'number' ? n.width : (n.width === 'fit-content' ? 0 : Infinity);
      const oneShortText = (n.children?.length ?? 0) === 1 && n.children![0].type === 'text';
      return w <= 200 && oneShortText && typeof n.cornerRadius === 'number';
    }
    return false;
  };
  const isHeading = (n: SceneNode): boolean => n.type === 'text' && (n.fontSize ?? 16) >= 28;

  for (const { node } of ctx.entries) {
    if (node.layout !== 'horizontal' || !node.children || node.children.length !== 2) continue;
    const [a, b] = node.children;
    if (!isEyebrow(a) || !isHeading(b)) continue;
    if (node.alignItems === 'center' || node.alignItems === 'end') continue; // vertically reconciled
    issues.push({
      category: 'cliche',
      tell: 'hanging-header',
      severity: 'info',
      nodeId: node.id,
      nodeName: node.name,
      message: `"${node.name ?? node.id}" places a small eyebrow beside a large heading (the hanging tag-left/heading-right header).`,
      suggestion: `Stack the eyebrow above the heading (layout: "vertical", left-aligned) for a cleaner hierarchy.`,
    });
  }
  return issues;
}

// FR-6 / C5 — honest-content: flag fabricated-looking metrics / testimonials /
// logos in short placeholder copy; suggest the labeled-placeholder convention.
const HONEST_CONTENT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'a percentage', re: /\b\d+(\.\d+)?\s?%/ },
  { name: 'a money figure', re: /[$€£]\s?\d/ },
  { name: 'a multiplier', re: /\b\d+(\.\d+)?x\b/i },
  { name: 'a large count', re: /\b\d{1,3}(,\d{3})+\+?\b|\b\d+(\.\d+)?[KMB]\+?\b|\b\d+\+\b/ },
  { name: 'a star rating', re: /\b[0-5](\.\d)\s?(★|stars?\b|\/\s?5)/i },
  { name: 'a testimonial attribution', re: /^\s*[—–-]\s*\p{Lu}[\p{L}\s.]+,/u },
  { name: 'an "as seen in" claim', re: /\b(as seen (in|on)|trusted by|featured (in|on)|used by)\b/i },
];
const HONEST_PLACEHOLDER_GUARD = /\b(to confirm|placeholder|tbd|sample|lorem|example|xx+)\b/i;
function tellHonestContent(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('honest-content')) return [];
  const issues: EvaluationIssue[] = [];

  for (const { node } of ctx.entries) {
    if (node.type !== 'text' || typeof node.content !== 'string') continue;
    const text = node.content.trim();
    if (text.length === 0 || text.length > 60) continue;       // only short copy
    if (HONEST_PLACEHOLDER_GUARD.test(text)) continue;          // already a labeled placeholder

    let reason: string | null = null;
    const lower = text.toLowerCase();
    if (BRAND_WORDMARKS.some((b) => lower.includes(b))) {
      reason = 'a real brand wordmark (fabricated logo wall)';
    } else {
      const hit = HONEST_CONTENT_PATTERNS.find((p) => p.re.test(text));
      if (hit) reason = hit.name;
    }
    if (!reason) continue;

    issues.push({
      category: 'cliche',
      tell: 'honest-content',
      severity: 'info',
      nodeId: node.id,
      nodeName: node.name,
      message: `"${text.slice(0, 40)}" looks like fabricated data (${reason}).`,
      suggestion: `Use a labeled placeholder until real data exists, e.g. "<Label> — to confirm" + a neutral block.`,
    });
  }
  return issues;
}

// FR-7 — eyebrow rhythm: an eyebrow (small uppercase/letterspaced label) above
// *every* section is the template-rhythm tell. Distinct from hanging-header,
// which scores one eyebrow's placement; this scores their global count vs the
// section count. Cap: at most ceil(sectionCount / 3) — ~1 eyebrow per 3 sections.
function tellEyebrowRhythm(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('eyebrow-rhythm')) return [];

  const isEyebrowText = (n: SceneNode): boolean => {
    if (n.type !== 'text' || typeof n.content !== 'string' || n.content.trim().length === 0) return false;
    if ((n.fontSize ?? 16) > 14) return false;
    // The signature: small text that is uppercased or letter-spaced (a label,
    // not body copy). Either property qualifies; both is the canonical eyebrow.
    return n.textTransform === 'uppercase' || (typeof n.letterSpacing === 'number' && n.letterSpacing > 0);
  };
  const isHeading = (n: SceneNode): boolean => n.type === 'text' && (n.fontSize ?? 16) >= 28;

  const eyebrowCount = ctx.entries.filter((e) => isEyebrowText(e.node)).length;
  const sectionCount = ctx.entries.filter((e) => isHeading(e.node)).length;
  if (sectionCount < 2) return [];                      // too small to have a rhythm

  const allowed = Math.ceil(sectionCount / 3);
  if (eyebrowCount <= allowed) return [];

  return [{
    category: 'cliche',
    tell: 'eyebrow-rhythm',
    severity: 'warning',
    nodeId: ctx.entries[0]?.node.id,
    message: `${eyebrowCount} eyebrow labels across ${sectionCount} sections — an eyebrow above (nearly) every heading reads as template rhythm.`,
    suggestion: `Keep eyebrows to ~1 per 3 sections (≤${allowed} here). Drop most; let the headings carry the structure.`,
  }];
}

// FR-8 — slop copy: stock AI phrasings in text content. Pure string audit,
// mirrors honest-content. Suggestion only — wording is a judgment call.
const SLOP_COPY_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'a filler verb', re: /\b(elevate|seamless(ly)?|unleash|next[-\s]?gen|revolutioni[sz]e|supercharge|empower)\b/i },
  { name: 'a scroll cue', re: /(^|\s)(↓\s*)?scroll(\s+(down|to explore))?\s*$/i },
  { name: 'a placeholder name', re: /\b(jane|john)\s+doe\b/i },
  { name: 'a hype status label', re: /\b(beta|alpha|early access|invite[-\s]?only|coming soon)\b/i },
  { name: 'a section-number eyebrow', re: /^\s*0*\d{1,3}\s*[/·.\-—]\s*\p{L}/u },
];
function tellSlopCopy(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('slop-copy')) return [];
  const issues: EvaluationIssue[] = [];

  for (const { node } of ctx.entries) {
    if (node.type !== 'text' || typeof node.content !== 'string') continue;
    const text = node.content.trim();
    if (text.length === 0 || text.length > 80) continue;        // short copy only
    if (HONEST_PLACEHOLDER_GUARD.test(text)) continue;          // labeled placeholder

    const hit = SLOP_COPY_PATTERNS.find((p) => p.re.test(text));
    if (!hit) continue;

    issues.push({
      category: 'cliche',
      tell: 'slop-copy',
      severity: 'info',
      nodeId: node.id,
      nodeName: node.name,
      message: `"${text.slice(0, 40)}" reads as stock AI copy (${hit.name}).`,
      suggestion: `Write specific, branded copy — name the concrete benefit instead of reaching for stock phrasing.`,
    });
  }
  return issues;
}

// FR-9 — radius consistency: one corner-radius system per page. A pile of
// distinct radii (sharp here, 6 there, 14 elsewhere) reads as unsystematic.
// A considered scale is small — flag only a genuine sprawl. Suggest-only.
function tellRadiusConsistency(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('radius-consistency')) return [];

  const radii = new Set<number>();
  for (const { node } of ctx.entries) {
    const r = node.cornerRadius;
    if (typeof r === 'number') { if (r > 0) radii.add(r); }
    else if (Array.isArray(r)) for (const v of r) if (typeof v === 'number' && v > 0) radii.add(v);
  }
  if (radii.size < 4) return [];                         // a 1–3 step scale is fine

  const list = [...radii].sort((a, b) => a - b).join(', ');
  return [{
    category: 'cliche',
    tell: 'radius-consistency',
    severity: 'info',
    nodeId: ctx.entries[0]?.node.id,
    message: `${radii.size} distinct corner radii in use (${list}px) — mixed radius systems read as inconsistent.`,
    suggestion: `Consolidate to one small radius scale (e.g. 8 / 12 / 999 for pills). Define it as $tokens and reuse.`,
  }];
}

// FR-10 — pure black / white: #000000 ink and a #ffffff page reads as harsh
// and undesigned; off-black / off-white is the craft move. Black ink (text /
// icon / stroke) carries a mechanical off-black swap; a black surface fill or a
// white page background is suggest-only (could be a deliberate choice).
function tellPureBlackWhite(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('pure-black-white')) return [];
  const issues: EvaluationIssue[] = [];
  const OFF_BLACK = '#0A0A0A';
  const rootId = ctx.entries[0]?.node.id;

  const exactHex = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const rgb = parseColor(v);
    return rgb ? rgbToHex(rgb) : null;
  };
  // A translucent color isn't "stark" — a 10%-alpha white hairline reads as a
  // faint rule, not a pure-white surface. Only opaque pure black/white counts.
  const isOpaque = (v: unknown): boolean => typeof v === 'string' && parseAlpha(v) >= 0.9;
  // A full-bleed background surface (page / section), not a small card or a
  // hairline rule. The document root is excluded — it defaults to white, so
  // flagging it would nag every canvas that never overrode the default.
  const isBackgroundSurface = (n: SceneNode): boolean => {
    if (n.type !== 'frame' || n.id === rootId) return false;
    if (typeof n.height === 'number' && n.height < 24) return false; // divider / hairline, not a surface
    if (typeof n.width === 'number') return n.width >= 600;
    return typeof n.width === 'string';                   // "100%" / "50%" → section
  };

  for (const { node } of ctx.entries) {
    // Pure-black INK (text / icon / stroke) — mechanical off-black swap.
    for (const prop of ['color', 'iconColor', 'stroke'] as const) {
      if (exactHex(node[prop]) !== '#000000' || !isOpaque(node[prop])) continue;
      issues.push({
        category: 'cliche',
        tell: 'pure-black-white',
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `${prop} is pure black (#000000) — reads harsher than a designed off-black.`,
        suggestion: `Use an off-black like ${OFF_BLACK} for ink.`,
        fix: {
          op: formatUpdateOp(node.id, { [prop]: OFF_BLACK }),
          rationale: `Soften pure black ${prop} to off-black ${OFF_BLACK}`,
        },
      });
    }
    // Pure-black / pure-white BACKGROUND surface — suggest-only (deliberate?).
    if (isBackgroundSurface(node)) {
      const fillHex = isOpaque(node.fill) ? exactHex(node.fill) : null;
      if (fillHex === '#000000') {
        issues.push({
          category: 'cliche', tell: 'pure-black-white', severity: 'info',
          nodeId: node.id, nodeName: node.name,
          message: `the background fill is pure black (#000000) — an off-black surface reads softer.`,
          suggestion: `Prefer a near-black like #0B0B0C over pure #000000 for the surface.`,
        });
      } else if (fillHex === '#ffffff') {
        issues.push({
          category: 'cliche', tell: 'pure-black-white', severity: 'info',
          nodeId: node.id, nodeName: node.name,
          message: `the background fill is pure white (#ffffff) — reads starker than a designed off-white.`,
          suggestion: `Use an off-white like #FAFAFA / #F8FAFC for the page surface.`,
        });
      }
    }
  }
  return issues;
}

// FR-11 — accent consistency: one accent hue per page (+ neutrals, at most one
// status color). Three or more competing saturated hues read as unfocused.
// Suggest-only — which hue is canonical is a judgment call. Neutrals, near-
// black/white, and the page background are excluded; gradients (non-parseable
// CSS strings) fall through to null and are skipped.
function tellAccentConsistency(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('accent-consistency')) return [];
  const rootId = ctx.entries[0]?.node.id;
  const hues = new Map<number, string>();               // coarse hue bucket → example hex

  const consider = (v: unknown): void => {
    if (typeof v !== 'string') return;
    const rgb = parseColor(v);
    if (!rgb) return;
    const { h, s, l } = rgbToHsl(rgb);
    if (s < 0.4 || l < 0.2 || l > 0.85) return;          // neutral / too dark / too light
    const bucket = (Math.round(h / 30) * 30) % 360;
    if (!hues.has(bucket)) hues.set(bucket, rgbToHex(rgb));
  };
  const isSmallEl = (n: SceneNode): boolean =>
    n.type === 'ellipse' || n.type === 'rectangle' || !!n.icon ||
    (typeof n.width === 'number' && n.width < 600);

  for (const { node } of ctx.entries) {
    if (node.id === rootId) continue;                    // page background isn't an accent
    consider(node.color);
    consider(node.stroke);
    consider(node.iconColor);
    if (isSmallEl(node)) consider(node.fill);
  }
  if (hues.size < 3) return [];

  return [{
    category: 'cliche',
    tell: 'accent-consistency',
    severity: 'info',
    nodeId: rootId,
    message: `${hues.size} competing accent hues in use (${[...hues.values()].join(', ')}) — multiple accents read as unfocused.`,
    suggestion: `Pick one accent hue (plus neutrals, and at most one status color). Set it as $accent and reuse.`,
  }];
}

function checkCliche(
  entries: NodeEntry[],
  rawEntries: NodeEntry[],
  tokens: DesignVariables,
  opts: { relaxed: Set<ClicheTell> },
): CheckResult {
  const rawById = new Map(rawEntries.map((e) => [e.node.id, e.node]));
  const ctx: ClicheCtx = { entries, rawById, tokens, relaxed: opts.relaxed };

  const issues = [
    ...tellAccentHue(ctx),
    ...tellGradientGlow(ctx),
    ...tellFakeChrome(ctx),
    ...tellHangingHeader(ctx),
    ...tellHonestContent(ctx),
    ...tellEyebrowRhythm(ctx),
    ...tellSlopCopy(ctx),
    ...tellRadiusConsistency(ctx),
    ...tellPureBlackWhite(ctx),
    ...tellAccentConsistency(ctx),
  ];

  const penalty = { error: 25, warning: 12, info: 6 } as const;
  let score = 100;
  for (const i of issues) score -= penalty[i.severity];
  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

// --- Scoring & Summary ---

function aggregateScores(results: Map<string, CheckResult>, weights: Map<string, number>): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [category, result] of results) {
    const w = weights.get(category) ?? 1;
    weightedSum += result.score * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;
}

function generateSummary(overall: number, categories: CategoryScore[], issues: EvaluationIssue[]): string {
  if (categories.length === 0) return 'Canvas is empty — nothing to evaluate.';

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const grade = overall >= 90 ? 'Excellent' : overall >= 75 ? 'Good' : overall >= 60 ? 'Needs improvement' : 'Poor';

  let summary = `Overall quality: ${grade} (${overall}/100). `;

  const weakest = categories.reduce((a, b) => (a.score < b.score ? a : b));
  const strongest = categories.reduce((a, b) => (a.score > b.score ? a : b));
  summary += `Strongest: ${strongest.name} (${strongest.score}/100). Weakest: ${weakest.name} (${weakest.score}/100). `;

  if (errors.length > 0) {
    summary += `${errors.length} critical issue(s). Top priority: ${errors[0].message} `;
  }
  if (warnings.length > 0) {
    summary += `${warnings.length} warning(s). `;
  }

  if (weakest.score < 80) {
    summary += `Focus on ${weakest.name}: `;
    const weakIssues = issues.filter((i) => i.category === weakest.name).slice(0, 2);
    summary += weakIssues.map((i) => i.message).join(' ');
  }

  return summary;
}

// --- Main orchestrator ---

const CATEGORY_WEIGHTS = new Map([
  ['spacing', 20],
  ['color', 25],
  ['typography', 20],
  ['structure', 15],
  ['consistency', 20],
  ['cliche', 15],
]);

export async function evaluateCanvas(
  canvas: Canvas,
  options: { mode: 'fast' | 'detailed' | 'llm'; categories?: string[]; genre?: string },
): Promise<EvaluationResult> {
  // Resolve variables so $tokens become actual values for contrast checks.
  // Tokens flow through workspace → project → canvas inheritance (Phase 9),
  // so contrast checks evaluate the actual rendered colors even when the
  // canvas itself has empty `variables` and inherits everything from the
  // workspace design system.
  const mergedTokens = getCanvasTokens(canvas);
  const resolvedRoot = resolveVariables(canvas.root, mergedTokens);
  const entries = buildTreeContext(resolvedRoot);
  // Also walk the unresolved tree for token usage stats
  const rawEntries = buildTreeContext(canvas.root);

  if (entries.length <= 1) {
    return {
      overallScore: 100,
      categories: [],
      issues: [],
      summary: 'Canvas is empty — nothing to evaluate.',
      stats: { totalNodes: entries.length, textNodes: 0, frameNodes: 0, maxDepth: 0, tokenUsagePercent: 0, componentReusePercent: 0 },
      mode: options.mode,
    };
  }

  const activeCategories = options.categories ?? [...CATEGORY_WEIGHTS.keys()];
  const results = new Map<string, CheckResult>();

  // Fast checks (all use JSON tree only)
  if (activeCategories.includes('spacing')) {
    results.set('spacing', checkSpacing(rawEntries, mergedTokens));
  }
  if (activeCategories.includes('color')) {
    results.set('color', checkColorContrast(entries));
  }
  if (activeCategories.includes('typography')) {
    results.set('typography', checkTypography(entries));
  }
  if (activeCategories.includes('structure')) {
    results.set('structure', checkStructure(rawEntries, canvas));
  }
  if (activeCategories.includes('consistency')) {
    if (options.mode === 'detailed') {
      const html = renderToHtml(resolvedRoot, 1440, 900, canvas);
      const layout = await computeLayout(html);
      results.set('consistency', checkConsistencyDetailed(entries, layout));
    } else {
      results.set('consistency', checkConsistency(entries));
    }
  }
  if (activeCategories.includes('cliche')) {
    // Genre comes from the explicit option, else the Phase 11 provenance stamp.
    const genre = options.genre ?? canvas.metadata?.provenance?.preset;
    const relaxed = new Set(RELAXED_BY_GENRE[genre ?? ''] ?? []);
    // Resolved entries → $accent becomes a real hex for hue math; rawEntries →
    // distinguish a literal default purple (autofixable) from a $token one.
    results.set('cliche', checkCliche(entries, rawEntries, mergedTokens, { relaxed }));
  }

  const overallScore = aggregateScores(results, CATEGORY_WEIGHTS);
  const allIssues = [...results.values()].flatMap((r) => r.issues);
  const categories: CategoryScore[] = [];
  for (const [name, result] of results) {
    categories.push({
      name,
      score: result.score,
      issueCount: result.issues.length,
      weight: CATEGORY_WEIGHTS.get(name) ?? 1,
    });
  }

  // Stats
  const totalNodes = entries.length;
  const textNodes = entries.filter((e) => e.node.type === 'text').length;
  const frameNodes = entries.filter((e) => ['frame', 'component'].includes(e.node.type)).length;
  const maxDepth = Math.max(...entries.map((e) => e.depth));
  const instanceNodes = entries.filter((e) => e.node.type === 'instance').length;

  let tokenRefs = 0;
  let totalStringProps = 0;
  for (const { node } of rawEntries) {
    for (const [key, val] of Object.entries(node)) {
      if (['id', 'type', 'name', 'children'].includes(key)) continue;
      if (typeof val === 'string') {
        totalStringProps++;
        if (val.startsWith('$')) tokenRefs++;
      }
    }
  }

  return {
    overallScore,
    categories,
    issues: allIssues,
    summary: generateSummary(overallScore, categories, allIssues),
    stats: {
      totalNodes,
      textNodes,
      frameNodes,
      maxDepth,
      tokenUsagePercent: totalStringProps > 0 ? Math.round((tokenRefs / totalStringProps) * 100) : 0,
      componentReusePercent: totalNodes > 0 ? Math.round((instanceNodes / totalNodes) * 100) : 0,
    },
    mode: options.mode,
  };
}
