import type { Canvas, SceneNode, DesignVariables } from './types.js';
import { resolveVariables } from './variables.js';
import { renderToHtml } from './renderer.js';
import { computeLayout, type LayoutRect } from './screenshot.js';

// --- Types ---

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface EvaluationIssue {
  category: string;
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
  mode: 'fast' | 'detailed';
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

function parseColor(str: string): [number, number, number] | null {
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

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(...fg);
  const l2 = relativeLuminance(...bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
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

  // `fixable` is false for padding when the source value is an array — the
  // off-scale entry might be any index, so a single Update op would clobber
  // the others. Scalar padding and gap are always single-property fixes.
  const allValues: { value: number; nodeId: string; nodeName?: string; prop: string; fixable: boolean }[] = [];

  for (const { node } of entries) {
    if (node.gap !== undefined && typeof node.gap === 'number') {
      allValues.push({ value: node.gap, nodeId: node.id, nodeName: node.name, prop: 'gap', fixable: true });
    }
    if (node.padding !== undefined) {
      if (typeof node.padding === 'number' && node.padding > 0) {
        allValues.push({ value: node.padding, nodeId: node.id, nodeName: node.name, prop: 'padding', fixable: true });
      } else if (Array.isArray(node.padding)) {
        for (const p of node.padding) {
          if (typeof p === 'number' && p > 0) {
            allValues.push({ value: p, nodeId: node.id, nodeName: node.name, prop: 'padding', fixable: false });
          }
        }
      }
    }
  }

  if (allValues.length === 0) return { score: 100, issues };

  let offScaleCount = 0;
  for (const v of allValues) {
    const nearest = scale.reduce((a, b) => (Math.abs(b - v.value) < Math.abs(a - v.value) ? b : a));
    if (!scale.includes(v.value)) {
      offScaleCount++;
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

    const ratio = contrastRatio(fg, bg);
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
        message: `Text "${(node.content ?? '').slice(0, 30)}" has contrast ratio ${ratio.toFixed(1)}:1 against ${bgStr}. WCAG AA requires ${required}:1.`,
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
]);

export async function evaluateCanvas(
  canvas: Canvas,
  options: { mode: 'fast' | 'detailed'; categories?: string[] },
): Promise<EvaluationResult> {
  // Resolve variables so $tokens become actual values for contrast checks
  const resolvedRoot = resolveVariables(canvas.root, canvas.variables);
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
    results.set('spacing', checkSpacing(rawEntries, canvas.variables));
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
