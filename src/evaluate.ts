import type { Canvas, SceneNode, DesignVariables } from './types.js';
import { resolveVariables } from './variables.js';
import { getCanvasTokens } from './workspaces.js';
import { renderToHtml, resolveInstance } from './renderer.js';
import { computeLayout, type LayoutRect } from './screenshot.js';
import { extractInventory, expandInstances, isDataLike } from './drift.js';
import { getIconSvg, parseIconRef } from './icons.js';
import { storedGenre } from './genre.js';
import { relaxedByPreset, relaxedByGenre, canonicalGenre, genreRulesets, activeRulesets, composeRulesets, resolveSurface, deviceProfile, DEVICE_PROFILES, DEFAULT_DEVICE, MOBILE_RULES, type SurfaceType } from './surfaces.js';
import { checkArtboard, checkHandbuiltTargets, checkOneColumn, checkSafeAreaDetailed, checkSafeAreaFast, checkTabBars, checkTypeFloor, paddingSides, type MobileContext } from './mobile-rules.js';
import { FAB_SIZE, NAV_ACTION, TAPPABLE_PRIMITIVES, buttonBox, effectivePosition, listRowMinHeight, navActions, tabItemBox, tabItems } from './primitives.js';

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
  /** Phase 30 — the ruleset rule that produced this issue (e.g.
   * "mobile-touch-target"); one of the surface report's rulesOn. Absent on
   * the checks that have no rule id. */
  rule?: string;
  /** Phase 25 slice D — set on issues from the DARK-theme evaluation pass
   * (color category dual-runs when a dark token layer exists). Absent =
   * light/default. */
  theme?: 'dark';
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
   * Present whenever the cliche category ran (issue #152). Genre choice is
   * consequential — the relaxation table decides whether a canvas can score at
   * all — so the result says which genre was active, where it came from, what
   * it relaxed, and which tells a DIFFERENT genre would have relaxed. That last
   * list surfaces the tradeoff at decision time instead of after a wasted
   * evaluation cycle.
   */
  genre?: GenreReport;
  /**
   * Phase 30 slice B — always present: the canvas's declared type (or the
   * `web` default) and the rule ids the composed type + genre + preset
   * rulesets turned on and off. A rule both enabled and disabled stays on and
   * is listed in `conflicts`.
   */
  surface: SurfaceReport;
  /**
   * Phase 24 slice C — present when the coverage category ran on a BASE
   * canvas: whether the screen carries data-bearing content (tables / forms),
   * which state variants are designed, and which demanded states are missing
   * (each missing state is also a warning issue). Absent on variant canvases.
   */
  coverage?: { dataBearing: boolean; states: string[]; missing: string[] };
  /**
   * Present only when mode is 'llm'. The heuristic categories above still run
   * (so you don't lose the deterministic signal); this field carries the
   * vision-model's holistic critique on top.
   */
  llmCritique?: import('./llm-judge.js').LLMJudgeResult;
}

export interface GenreReport {
  /** The genre the cliche checks ran under (canonical: an alias like
   * "dashboard" reports as "data"), or null when none was set. */
  active: string | null;
  /** Where the active genre came from: the explicit `genre` option, the canvas
   * provenance stamp (metadata.provenance.genre, or a legacy genre stored in
   * provenance.preset), or null when unset. */
  source: 'explicit' | 'provenance' | null;
  /** Tells skipped entirely, by the genre and by the applied preset. Empty
   * when neither relaxes anything — for a genre stamp, a signal the stamp
   * isn't doing what the author may think. */
  relaxed: ClicheTell[];
  /** Tells that stayed ACTIVE but would be relaxed by some other genre —
   * e.g. under "data", accent-hue/pure-black-white still flag but
   * "material" would relax them. */
  notRelaxed: Array<{ tell: ClicheTell; relaxedBy: string[] }>;
  /** Phase 30 — present when the canvas's applied preset relaxed tells on its
   * own (the material preset), so `relaxed` is explained even when `active`
   * is null. */
  byPreset?: { preset: string; relaxed: ClicheTell[] };
}

export interface SurfaceReport {
  type: SurfaceType;
  /** The device profile a mobile canvas targets; null on web. */
  device: string | null;
  /** 'declared' when canvas_create / canvas_set_type set the type; 'default'
   * when nobody did (the canvas is judged as web). */
  source: 'declared' | 'default';
  rulesOn: string[];
  rulesOff: string[];
  conflicts: string[];
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

// Phase 25 slice D — APCA (Accessible Perceptual Contrast Algorithm,
// 0.0.98G-4g constants). ADVISORY ONLY: APCA sits outside the normative
// WCAG 3 draft, so Lc values inform (info severity) and never gate — WCAG 2.2
// remains the blocking check. Notably better than WCAG 2 ratios at predicting
// legibility on dark backgrounds, which is exactly where the dual-theme pass
// needs a second opinion.
export function apcaLc(fg: [number, number, number], bg: [number, number, number]): number {
  const y = (rgb: [number, number, number]): number => {
    const ys = 0.2126729 * Math.pow(rgb[0] / 255, 2.4)
      + 0.7151522 * Math.pow(rgb[1] / 255, 2.4)
      + 0.072175 * Math.pow(rgb[2] / 255, 2.4);
    return ys < 0.022 ? ys + Math.pow(0.022 - ys, 1.414) : ys; // black soft-clamp
  };
  const yTxt = y(fg);
  const yBg = y(bg);
  if (Math.abs(yBg - yTxt) < 0.0005) return 0;
  if (yBg > yTxt) {
    // normal polarity: dark text on light background
    const s = (Math.pow(yBg, 0.56) - Math.pow(yTxt, 0.57)) * 1.14;
    return s < 0.1 ? 0 : Math.round((s - 0.027) * 1000) / 10;
  }
  // reverse polarity: light text on dark background (negative Lc)
  const s = (Math.pow(yBg, 0.65) - Math.pow(yTxt, 0.62)) * 1.14;
  return s > -0.1 ? 0 : Math.round((s + 0.027) * 1000) / 10;
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
    // gap: 0 is a deliberate flush stack (divider-separated rows, tab bars),
    // never an off-scale value — the same reason padding ≤ 0 is skipped below.
    if (typeof node.gap === 'number' && node.gap !== 0) {
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

  // Phase 29 slice D (#194) — variety is measured against the DECLARED scale,
  // not in the abstract. The old check asked every design to live on 4–6 unique
  // spacing values, which contradicted framesmith's own generated scale: nine
  // steps ship in space-3xs…space-3xl, so a design drawing exclusively from its
  // own system could be told to consolidate for using the system. On the checkout
  // attempt it still reported nine values after the authored set had been
  // collapsed to six, with the residue coming from the scaffolds — a finding with
  // no action behind it.
  //
  // Declaring the scale is the intentionality signal (the same precedent the
  // type-scale check already uses for pinned sizes). Values drawn FROM the scale
  // are disciplined by construction however many there are; only values outside
  // it count toward sprawl.
  const declared = new Set(Object.values(variables.spacing ?? {}).filter((v): v is number => typeof v === 'number'));
  const uniqueValues = new Set(allValues.map((v) => v.value)).size;
  const undeclared = new Set(allValues.map((v) => v.value).filter((v) => !declared.has(v)));
  const sprawl = declared.size > 0 ? undeclared.size : uniqueValues;
  if (sprawl > 6) {
    issues.push({
      category: 'spacing',
      severity: 'info',
      nodeId: entries[0].node.id,
      message: declared.size > 0
        ? `Design uses ${sprawl} spacing values that are not on its declared scale (${uniqueValues} unique in total). Consolidate onto the scale.`
        : `Design uses ${uniqueValues} unique spacing values and declares no spacing scale. Consider consolidating to 4-6 values, or declare a scale with set_variables.`,
    });
  }

  let score = 100 - (offScaleCount / allValues.length) * 60;
  if (sprawl > 6) score -= 15;
  if (sprawl > 10) score -= 10;
  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

function checkColorContrast(entries: NodeEntry[], theme?: 'dark'): CheckResult {
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
    const fontSize = typeof node.fontSize === 'number' ? node.fontSize : 16; // clamp strings: treat as body size for the contrast threshold
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
      // A dark-run fix would write a LIGHT-theme literal onto the node and
      // break the other theme — dark failures point at the dark token layer
      // instead of carrying a mechanical fix.
      if (recoverColor && theme !== 'dark') {
        issue.fix = {
          op: formatUpdateOp(node.id, { color: recoverColor }),
          rationale: `Switch text color to ${recoverColor} for WCAG AA contrast against ${bgStr}`,
        };
      }
      if (theme === 'dark') {
        issue.theme = 'dark';
        issue.suggestion = 'Fix it in the dark token layer (dark.colors override for the token this text/background resolves through) — a literal node color would break the light theme.';
      }
      issues.push(issue);
    } else {
      // Phase 25 slice D — APCA advisory (info, NEVER blocking): the pair
      // passes the WCAG 2.2 gate, but perceptual contrast is weak by APCA —
      // most common with light-on-dark pairs where WCAG 2 ratios flatter.
      const lc = Math.abs(apcaLc(fg, bg));
      const apcaBand = isLargeText ? 60 : 75;
      if (lc > 0 && lc < apcaBand) {
        issues.push({
          category: 'color',
          severity: 'info',
          nodeId: node.id,
          nodeName: node.name,
          ...(theme === 'dark' ? { theme: 'dark' } : {}),
          message: `APCA advisory: Lc ${lc} (guideline ~${apcaBand} for this size) against ${bgStr}${theme === 'dark' ? ' in the dark theme' : ''} — passes WCAG 2.2 (the gate), but perceptual contrast is weak.`,
          suggestion: 'Consider a step more contrast. APCA is a candidate method, not a standard — this never blocks.',
        });
      }
    }
  }

  const score = Math.max(0, Math.round(100 - (failCount / textNodes.length) * 100));
  return { score, issues };
}

/** Phase 25 slice A — craft-depth context for checkTypography: canvas width
 * (fast-mode measure estimate), real rects when detailed mode already
 * computed them, and the drift-inventory tables for the numeric-column
 * nudge. All three new checks are SCORE-NEUTRAL advisories — the teeth stay
 * with contrast/coverage; these raise craft, not gates (measure's >90ch case
 * is the one warning, and warnings block the directive on their own). */
interface TypographyContext {
  rootWidth?: number;
  layout?: LayoutRect[];
  tables?: { nodeId: string }[];
}

function checkTypography(entries: NodeEntry[], variables: DesignVariables = {}, ctx: TypographyContext = {}): CheckResult {
  const issues: EvaluationIssue[] = [];
  const textNodes = entries.filter((e) => e.node.type === 'text');

  if (textNodes.length === 0) return { score: 100, issues };

  const fontSizes = textNodes.map((e) => e.node.fontSize).filter((s): s is number => s !== undefined);
  const uniqueSizes = [...new Set(fontSizes)].sort((a, b) => b - a);
  const fontFamilies = new Set(textNodes.map((e) => e.node.fontFamily).filter(Boolean));
  const fontWeights = new Set(textNodes.map((e) => e.node.fontWeight).filter((w) => w !== undefined));

  // Phase 22 slice C (#135) — sizes declared as typography tokens are a PINNED
  // scale: declaring them is the intentionality signal (e.g. matching an
  // existing app's 14/13/12/11). An adjacent pair where BOTH sizes are pinned
  // is compliant by definition; pairs involving an undeclared size still flag.
  const pinnedSizes = new Set(Object.values(variables.typography ?? {}).map((t) => t.fontSize));

  let score = 100;

  // Check type scale ratios
  if (uniqueSizes.length >= 2) {
    for (let i = 0; i < uniqueSizes.length - 1; i++) {
      if (pinnedSizes.has(uniqueSizes[i]) && pinnedSizes.has(uniqueSizes[i + 1])) continue;
      const ratio = uniqueSizes[i] / uniqueSizes[i + 1];
      if (ratio < 1.1 || ratio > 2.0) {
        score -= 10;
        issues.push({
          category: 'typography',
          severity: 'warning',
          nodeId: textNodes.find((e) => e.node.fontSize === uniqueSizes[i])?.node.id ?? entries[0].node.id,
          message: `Font sizes ${uniqueSizes[i]}px → ${uniqueSizes[i + 1]}px have ratio ${ratio.toFixed(2)} (expected 1.1-2.0).`,
          suggestion: `Adjust to create a cleaner type scale — or, if these sizes deliberately match an existing app's scale, declare them as typography tokens to pin them.`,
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

  // ── Phase 25 slice A — craft-depth advisories (all score-neutral) ──

  // Measure (FR-A3): prose running past ~75 characters per line is hard to
  // read. Fast mode estimates chars-per-line from the nearest fixed width
  // (width ÷ fontSize×0.5); detailed mode uses the real rendered rect.
  const layoutWidth = new Map<string, number>();
  if (ctx.layout) {
    (function walk(rects: LayoutRect[]) {
      for (const r of rects) {
        layoutWidth.set(r.nodeId, r.width);
        if (r.children) walk(r.children);
      }
    })(ctx.layout);
  }
  const entryByNode = new Map<SceneNode, NodeEntry>();
  for (const e of entries) entryByNode.set(e.node, e);
  const nearestFixedWidth = (e: NodeEntry): number | undefined => {
    let cur: NodeEntry | undefined = e;
    while (cur) {
      if (typeof cur.node.width === 'number') return cur.node.width;
      if (typeof cur.node.maxWidth === 'number') return cur.node.maxWidth;
      cur = cur.parent ? entryByNode.get(cur.parent) : undefined;
    }
    return undefined;
  };
  for (const e of textNodes) {
    const content = typeof e.node.content === 'string' ? e.node.content : '';
    if (typeof e.node.fontSize === 'string') continue; // fluid/clamp — real size unknown, never guess
    const size = typeof e.node.fontSize === 'number' ? e.node.fontSize : 14;
    if (content.length <= 120 || size >= 18) continue;
    const width = layoutWidth.get(e.node.id) ?? nearestFixedWidth(e) ?? ctx.rootWidth ?? 1440;
    const charsPerLine = width / (size * 0.5);
    if (charsPerLine <= 75) continue;
    const cap = Math.round(75 * size * 0.5);
    issues.push({
      category: 'typography',
      severity: charsPerLine > 90 ? 'warning' : 'info',
      nodeId: e.node.id,
      nodeName: e.node.name,
      message: `Prose runs ~${Math.round(charsPerLine)} characters per line (readable measure is 45–75ch).`,
      suggestion: `Cap the measure — maxWidth: ${cap} keeps this ~75ch at ${size}px.`,
    });
  }

  // Tracking-by-size (FR-A4): display text reads tighter with negative
  // letter-spacing. Token-declared tracking resolves onto the node (Phase 25
  // full typography resolution), so a typed system is never nagged; tracked-
  // out uppercase (eyebrows) is intentional and exempt.
  for (const e of textNodes) {
    const size = typeof e.node.fontSize === 'number' ? e.node.fontSize : 0;
    if (size < 28 || e.node.textTransform === 'uppercase') continue;
    if (e.node.letterSpacing !== undefined && e.node.letterSpacing < 0) continue;
    const tracking = size <= 40 ? -0.5 : -1;
    issues.push({
      category: 'typography',
      severity: 'info',
      nodeId: e.node.id,
      nodeName: e.node.name,
      message: `Display text at ${size}px with default tracking — large sizes read tighter with slight negative letter-spacing.`,
      suggestion: `letterSpacing: ${tracking} (or declare it on the typography token so the whole scale carries it).`,
      fix: { op: formatUpdateOp(e.node.id, { letterSpacing: tracking }), rationale: `Tighten display tracking at ${size}px (${tracking}px).` },
    });
  }

  // Tabular numerals (FR-A2): data-like text in detected table columns
  // without tabularNums wobbles vertically as digits vary in width.
  if (ctx.tables?.length) {
    const byId = new Map(entries.map((e) => [e.node.id, e.node]));
    for (const t of ctx.tables) {
      const container = byId.get(t.nodeId);
      if (!container?.children) continue;
      const rows = container.children.filter((c) => c.type === 'frame' && (c.children?.length ?? 0) >= 2);
      for (const row of rows.slice(1)) { // data rows — the header is labels
        (function walkCells(n: SceneNode): void {
          if (n.type === 'text' && typeof n.content === 'string' && isDataLike(n.content) && !n.tabularNums) {
            issues.push({
              category: 'typography',
              severity: 'info',
              nodeId: n.id,
              message: `Numeric cell "${n.content.trim()}" uses proportional figures — columns of numbers wobble without tabular numerals.`,
              suggestion: 'Set tabularNums: true (the table scaffolds carry it by default).',
              fix: { op: formatUpdateOp(n.id, { tabularNums: true }), rationale: 'Align digit columns with tabular figures.' },
            });
          }
          n.children?.forEach(walkCells);
        })(row);
      }
    }
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

  // Token usage (copy and variant names on the mobile primitives are not
  // style values — they could never be tokens)
  const hasVariables = canvas.variables && (
    Object.keys(canvas.variables.colors ?? {}).length > 0 ||
    Object.keys(canvas.variables.spacing ?? {}).length > 0
  );
  if (hasVariables) {
    let tokenRefs = 0;
    let totalProps = 0;
    for (const { node } of entries) {
      for (const [key, val] of Object.entries(node)) {
        if (['id', 'type', 'name', 'children'].includes(key) || PRIMITIVE_COPY_PROPS.has(key)) continue;
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

  // Unknown icons — an icon name that resolves in neither set renders an
  // empty slot (the renderer emits only an HTML comment), invisible in
  // screenshots. Warning severity: a blank icon is a shipped defect.
  const iconFindings = checkUnknownIcons(canvas);
  score -= 10 * iconFindings.length;
  issues.push(...iconFindings);

  // Component reuse. Phase 30 slice D — a repeated primitive (list rows,
  // buttons, tab bars) is reuse too: the primitive is the component.
  const primitiveCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.node.type === 'button' || e.node.type === 'list-row' || e.node.type === 'tab-bar') {
      primitiveCounts.set(e.node.type, (primitiveCounts.get(e.node.type) ?? 0) + 1);
    }
  }
  const repeatsPrimitive = [...primitiveCounts.values()].some((n) => n >= 2);
  if (totalNodes > 10 && instanceNodes === 0 && !repeatsPrimitive) {
    issues.push({
      category: 'structure',
      severity: 'info',
      nodeId: entries[0].node.id,
      message: `No component instances found in ${totalNodes} nodes. Consider extracting repeated patterns into components.`,
      suggestion: `Promote a repeated subtree with create_component, then stamp copies via batch_design ({ type: "instance", componentId, overrides }).`,
    });
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

/** Every icon reference in a tree: icon nodes' `icon`, and the mobile
 * primitives' icon props (a blank glyph in a tab bar is the same defect). */
function iconSlots(root: SceneNode): Array<{ node: SceneNode; path: string; ref: string; flat: boolean; required: boolean }> {
  const out: Array<{ node: SceneNode; path: string; ref: string; flat: boolean; required: boolean }> = [];
  const add = (node: SceneNode, path: string, ref: unknown, flat: boolean, required: boolean) => {
    if (typeof ref === 'string' || required) out.push({ node, path, ref: typeof ref === 'string' ? ref : '', flat, required });
  };
  (function walk(n: SceneNode) {
    if (n.type === 'icon') add(n, 'icon', n.icon, true, true);
    else if (n.type === 'button') add(n, 'icon', n.icon, true, false);
    else if (n.type === 'list-row' || n.type === 'nav-bar') {
      add(n, 'leading.icon', n.leading?.icon, false, false);
      if (n.type === 'nav-bar' && Array.isArray(n.trailing)) n.trailing.slice(0, 2).forEach((a, i) => add(n, `trailing[${i}].icon`, a?.icon, false, false));
    } else if (n.type === 'tab-bar') {
      (Array.isArray(n.items) ? n.items : []).forEach((it, i) => add(n, `items[${i}].icon`, it?.icon, false, true));
      if (n.variant === 'fab') add(n, 'fab.icon', n.fab?.icon, false, false);
    }
    n.children?.forEach(walk);
  })(root);
  return out;
}

/** Phase 30 slice D — the mobile primitives' copy and enum props: words and
 * variant names, never style values, so the token census skips them. */
const PRIMITIVE_COPY_PROPS = new Set(['title', 'subtitle', 'label', 'time', 'variant', 'size', 'detent', 'appearance', 'iconPosition']);

/** Spellings worth trying for an icon name that didn't resolve: Material
 * Symbols names multi-word icons with `_` (chevron_right), Lucide with `-`
 * (chevron-right), and Material needs the `material:` prefix. Each candidate
 * is checked against the bundled sets — only names that actually render. */
function iconCandidates(ref: string, style: SceneNode['iconStyle']): string[] {
  const { set, name } = parseIconRef(ref);
  const lower = name.toLowerCase();
  const out = new Set<string>();
  if (set === 'lucide') {
    const hyphenated = lower.replace(/_/g, '-');
    if (hyphenated !== name && getIconSvg(hyphenated)) out.add(hyphenated);
    if (getIconSvg(`material:${lower}`, 24, undefined, style)) out.add(`material:${lower}`);
  } else {
    // Keep the -fill suffix; the base name is what takes underscores.
    const [, base, fill = ''] = lower.match(/^(.*?)(-fill)?$/)!;
    const underscored = `${base.replace(/-/g, '_')}${fill}`;
    if (underscored !== name && getIconSvg(`material:${underscored}`, 24, undefined, style)) out.add(`material:${underscored}`);
  }
  return [...out];
}

function checkUnknownIcons(canvas: Canvas): EvaluationIssue[] {
  // Instance-expanded so icons inside stamped components are checked too;
  // ids that aren't in the canvas tree itself live in a component definition.
  const expanded = expandInstances(canvas.root, canvas);
  const ownIds = new Set<string>();
  (function walk(n: SceneNode) { ownIds.add(n.id); n.children?.forEach(walk); })(canvas.root);

  // Every icon reference: icon nodes, and (Phase 30 slice D) the primitives'
  // icon props. `flat` = the prop is the node's own `icon`, so a one-prop
  // update fixes it; `required` = a missing name is itself a defect.
  const icons = iconSlots(expanded);

  // Tie-break between candidates by the icon set the rest of the canvas uses:
  // mixing stroke (Lucide) and fill (Material) glyphs is its own inconsistency.
  const resolvedSets = new Set(icons
    .filter((sl) => sl.ref && getIconSvg(sl.ref, 24, undefined, sl.node.iconStyle))
    .map((sl) => parseIconRef(sl.ref).set));
  const canvasSet = resolvedSets.size === 1 ? [...resolvedSets][0] : null;

  const issues: EvaluationIssue[] = [];
  const seen = new Set<string>();
  for (const { node, path, ref: rawRef, flat, required } of icons) {
    const key = `${node.id}\u0000${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = rawRef.trim();
    if (ref && getIconSvg(ref, 24, undefined, node.iconStyle)) continue;
    if (!ref && !required) continue;

    const where = (ownIds.has(node.id) ? '' : ' (inside a component — fix it in the component definition)')
      + (node.type === 'icon' ? '' : ` (${node.type} ${path})`);
    if (!ref) {
      issues.push({
        category: 'structure',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `${node.type === 'icon' ? 'Icon node has' : 'Tab item has'} no icon name${where} — it renders as an empty slot.`,
        suggestion: 'Set icon to a Lucide name ("chevron-right") or a Material Symbols name with the material: prefix ("material:chevron_right"), or delete the node.',
      });
      continue;
    }

    const candidates = iconCandidates(ref, node.iconStyle);
    const preferred = canvasSet ? candidates.filter((c) => parseIconRef(c).set === canvasSet) : [];
    const pick = candidates.length === 1 ? candidates[0] : preferred.length === 1 ? preferred[0] : null;
    const issue: EvaluationIssue = {
      category: 'structure',
      severity: 'warning',
      nodeId: node.id,
      nodeName: node.name,
      message: `Unknown icon "${ref}"${where} — it matches no bundled icon and renders as an empty slot.`,
      suggestion: candidates.length > 0
        ? `Did you mean ${candidates.map((c) => `"${c}"`).join(' or ')}? Lucide names use hyphens (chevron-right); Material Symbols names use underscores and need the material: prefix (material:chevron_right).`
        : 'Lucide names use hyphens (chevron-right); Material Symbols names use underscores and need the material: prefix (material:chevron_right). Check the spelling against lucide.dev or fonts.google.com/icons.',
    };
    if (pick && flat && ownIds.has(node.id)) {
      issue.fix = {
        op: formatUpdateOp(node.id, { icon: pick }),
        rationale: `"${ref}" doesn't exist; "${pick}" is the spelling that resolves${candidates.length > 1 ? ' in the icon set this canvas already uses' : ''}.`,
      };
    }
    issues.push(issue);
  }
  return issues;
}

/** Phase 25 slice E — raw entries + merged tokens power the token-detachment
 * lint and the motion nudge. Both are SCORE-NEUTRAL info advisories. */
interface ConsistencyContext {
  rawEntries?: NodeEntry[];
  tokens?: DesignVariables;
}

function checkConsistency(entries: NodeEntry[], ctx: ConsistencyContext = {}): CheckResult {
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

  // Phase 29 slice D (#194) — the sibling-padding uniformity check is GONE, and
  // deliberately so; this note exists to stop it being reinvented from first
  // principles. It fired on correct designs and could not be satisfied.
  //
  // Evidence from the checkout attempt: fixing it at one level of the tree moved
  // the complaint to another, because each fix changed which siblings differed —
  // document root → left column → summary rail → basket card → order options, in
  // a loop. The premise is wrong twice over. A page's structural bands are
  // SUPPOSED to differ (a thin utility strip, a taller header, a padded main
  // region), and a card's internal padding is a per-component decision, not
  // something that should match the card next to it. It also cost 5 points per
  // occurrence, so it materially pinned scores on designs with nothing wrong.
  //
  // Nothing replaced it: no defect case was found that this caught and no other
  // check does. Real padding problems surface through the spacing scale (off-scale
  // values) and through stress (a box that cannot hold its content).

  // ── Phase 25 slice E — token-detachment lint (score-neutral, cap 20) ──
  // A literal that EQUALS a token's value is drift-in-waiting: the token
  // changes, the literal doesn't. Exact equality only (spec C8) — nearest-
  // match suggestions belong to import-time snapping; the evaluator never
  // guesses. Checked on RAW nodes ($refs already look literal after resolve).
  if (ctx.rawEntries && ctx.tokens) {
    const colorToTokens = new Map<string, string[]>();
    for (const [name, value] of Object.entries(ctx.tokens.colors ?? {})) {
      const key = value.trim().toLowerCase();
      colorToTokens.set(key, [...(colorToTokens.get(key) ?? []), name]);
    }
    const radiusToTokens = new Map<number, string[]>();
    for (const [name, value] of Object.entries(ctx.tokens.radius ?? {})) {
      radiusToTokens.set(value, [...(radiusToTokens.get(value) ?? []), name]);
    }
    let detached = 0;
    for (const { node } of ctx.rawEntries) {
      if (detached >= 20) break;
      if (node.type === 'document') continue; // createCanvas's default white fill is not an authored literal
      let found: { prop: string; literal: string; tokens: string[] } | null = null;
      for (const prop of ['fill', 'stroke', 'color'] as const) {
        const v = node[prop];
        if (typeof v !== 'string' || v.startsWith('$')) continue;
        const names = colorToTokens.get(v.trim().toLowerCase());
        if (names?.length) { found = { prop, literal: v, tokens: names }; break; }
      }
      if (!found && typeof node.cornerRadius === 'number') {
        const names = radiusToTokens.get(node.cornerRadius);
        if (names?.length) found = { prop: 'cornerRadius', literal: String(node.cornerRadius), tokens: names };
      }
      if (!found) continue;
      detached++;
      const unique = found.tokens.length === 1;
      issues.push({
        category: 'consistency',
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `Literal ${found.prop}: ${found.literal} equals ${unique ? `the $${found.tokens[0]} token` : `${found.tokens.length} tokens (${found.tokens.map((t) => '$' + t).join(', ')})`} — detached literals drift when the token changes.`,
        suggestion: unique
          ? `Reference the token: ${found.prop}: "$${found.tokens[0]}".`
          : 'Reference whichever token carries the INTENT here — multiple tokens share this value, so no automatic fix (never guess).',
        ...(unique ? { fix: { op: formatUpdateOp(node.id, { [found.prop]: `$${found.tokens[0]}` }), rationale: `Re-attach the literal to $${found.tokens[0]} so it follows the design system.` } } : {}),
      });
    }

    // ── motion nudge — ad-hoc timing sprawl without motion tokens ──
    if (!ctx.tokens.motion || Object.keys(ctx.tokens.motion).length === 0) {
      const combos = new Set<string>();
      for (const { node } of ctx.rawEntries) {
        if (node.transition && typeof node.transition === 'object' && typeof node.transition.duration === 'number') {
          combos.add(`${node.transition.duration}|${node.transition.easing ?? 'ease'}`);
        }
        if (node.animation?.duration !== undefined || node.animation?.easing !== undefined) {
          combos.add(`${node.animation.duration ?? 300}|${node.animation.easing ?? 'ease'}`);
        }
      }
      if (combos.size >= 3) {
        issues.push({
          category: 'consistency',
          severity: 'info',
          nodeId: entries[0].node.id,
          message: `${combos.size} distinct ad-hoc duration/easing combinations and no motion tokens — timing drifts apart without a motion language.`,
          suggestion: 'Declare motion tokens (set_variables motion: { fast: { duration: 150, easing: "ease-out" }, … }) and reference them as transition: "$motion.fast".',
        });
      }
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), issues };
}

function checkConsistencyDetailed(entries: NodeEntry[], layoutRects: LayoutRect[], ctx: ConsistencyContext = {}): CheckResult {
  const baseResult = checkConsistency(entries, ctx);
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

    // Check if in-flow siblings overlap. Positioned nodes overlap by design:
    // absolute, and (Phase 30 slice D) pinned ones — a tab bar over the
    // scrolling list, the home indicator over the tab bar, a sheet over all.
    const layered = (n: SceneNode) => {
      const position = effectivePosition(n);
      return position === 'absolute' || position === 'fixed' || position === 'sticky';
    };
    for (let i = 0; i < childRects.length; i++) {
      for (let j = i + 1; j < childRects.length; j++) {
        const a = childRects[i];
        const b = childRects[j];
        if (layered(a.node) || layered(b.node)) continue;

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

// Phase 30 slice B — the genre/preset relaxation tables moved into the
// axis-keyed ruleset table in surfaces.ts (RULESETS); these re-exports keep
// their callers unchanged.
export { canonicalGenre, relaxedByGenre, relaxedByPreset, knownGenres } from './surfaces.js';

/** canvas_set_genre's result fields for a stamp on a canvas with `preset`:
 * the canonical genre, what the genre relaxes, and what the preset relaxes on
 * its own (a genre clear never removes the latter). */
export function describeGenreStamp(genre: string | null, preset: string | undefined): {
  canonical: string | null;
  relaxes: ClicheTell[];
  presetRelaxes?: { preset: string; relaxed: ClicheTell[] };
} {
  const presetRelaxed = relaxedByPreset(preset);
  return {
    canonical: genre === null ? null : canonicalGenre(genre),
    relaxes: genre === null ? [] : relaxedByGenre(genre),
    ...(presetRelaxed.length ? { presetRelaxes: { preset: preset!, relaxed: presetRelaxed } } : {}),
  };
}

/** Phase 30 — the one genre resolution every evaluator shares (canvas_evaluate,
 * canvas_autofix, the viewer): the explicit option, else the canvas's stored
 * genre (incl. the legacy read of `preset`), folded to its canonical name. */
export function resolveGenre(canvas: Canvas, explicit?: string): { genre: string | undefined; source: GenreReport['source'] } {
  if (explicit !== undefined) return { genre: canonicalGenre(explicit), source: 'explicit' };
  const stored = storedGenre(canvas.metadata?.provenance);
  return stored !== undefined ? { genre: canonicalGenre(stored), source: 'provenance' } : { genre: undefined, source: null };
}

/** Issue #152 — make the genre decision visible in the evaluate result: which
 * genre ran, where it came from, what it relaxed, and which tells a DIFFERENT
 * genre would have relaxed (the tradeoff that's otherwise only discoverable by
 * watching the score move). Aliases (`dashboard`, `checkout`) are folded into
 * their canonical genre in relaxedBy so they don't read as separate options. */
function buildGenreReport(
  resolved: { genre: string | undefined; source: GenreReport['source'] },
  relaxed: Set<ClicheTell>,
  preset: string | undefined,
): GenreReport {
  const notRelaxed = new Map<ClicheTell, string[]>();
  for (const [g, ruleset] of genreRulesets()) {
    for (const tell of ruleset.relax ?? []) {
      if (relaxed.has(tell)) continue;
      const by = notRelaxed.get(tell) ?? [];
      if (!by.includes(g)) by.push(g);
      notRelaxed.set(tell, by);
    }
  }
  const byPreset = relaxedByPreset(preset);
  return {
    active: resolved.genre ?? null,
    source: resolved.source,
    relaxed: [...relaxed],
    notRelaxed: [...notRelaxed].map(([tell, relaxedBy]) => ({ tell, relaxedBy })),
    ...(byPreset.length ? { byPreset: { preset: preset!, relaxed: byPreset } } : {}),
  };
}

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
  /** Phase 26 dogfood fix — descendants of detected tables: header cells are
   * small uppercase labels by convention, NOT section eyebrows. */
  tableDescendantIds?: Set<string>;
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
      // Phase 28 — the dataviz vocabulary is sanctioned by construction: a
      // categorical series color or a tint surface referenced through its
      // token may legitimately be violet. Literal purples still flag.
      if (fromToken && /^\$(chart-\d+|[a-z-]+-tint)$/.test(rawVal as string)) continue;
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

  // A gradient referenced through a $token is a design-system decision (the
  // accent-hue precedent); chart-internal fades never appear here at all —
  // they live inside the chart SVG, not on a node's gradient prop.
  const gradientNodes = ctx.entries.filter((e) => {
    if (e.node.gradient == null) return false;
    const raw = ctx.rawById.get(e.node.id)?.gradient as unknown;
    return !(typeof raw === 'string' && raw.startsWith('$'));
  });
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
    // Phase 28 — a dot is ROUND: near-square aspect required. Tall thin
    // rounded bars (a hand-drawn sparkline) are not traffic lights.
    const h = typeof n.height === 'number' ? n.height : w;
    if (h > 20 || Math.max(w, h) / Math.max(1, Math.min(w, h)) > 1.5) return false;
    if (n.type === 'ellipse') return true;
    if ((n.type === 'frame' || n.type === 'rectangle') && typeof n.cornerRadius === 'number') {
      return n.cornerRadius >= Math.min(w, h) / 2; // circular
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
    if (n.type === 'text') return (typeof n.fontSize === 'number' ? n.fontSize : 16) <= 14;
    if (n.type === 'frame') {
      const w = typeof n.width === 'number' ? n.width : (n.width === 'fit-content' ? 0 : Infinity);
      const oneShortText = (n.children?.length ?? 0) === 1 && n.children![0].type === 'text';
      return w <= 200 && oneShortText && typeof n.cornerRadius === 'number';
    }
    return false;
  };
  const isHeading = (n: SceneNode): boolean => n.type === 'text' && (typeof n.fontSize === 'number' ? n.fontSize : 16) >= 28;

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
      suggestion: `Use a labeled placeholder until real data exists, e.g. "<Label> — to confirm" + a neutral block. If the figures are the user's own data and ARE the design (a dashboard, activity, finance or fitness screen), declare genre: "data" instead — it relaxes this tell.`,
    });
  }
  return issues;
}

// FR-7 — eyebrow rhythm: an eyebrow (small uppercase/letterspaced label) above
// *every* section is the template-rhythm tell. Distinct from hanging-header,
// which scores one eyebrow's placement; this scores their global count vs the
// section count. Cap: at most ceil(sectionCount / 3) — ~1 eyebrow per 3 sections.
/** Letter-spacing at or above this reads as a deliberate eyebrow treatment
 * rather than a type role's default tracking. See the census in
 * tellEyebrowRhythm for how it was chosen. */
const EYEBROW_TRACKING_MIN = 1;

/** Text already typed in capitals — the authored equivalent of textTransform.
 * Needs at least two letters so an acronym-free string ("12 / 24") or a single
 * initial doesn't read as a label. */
function readsUppercase(content: string): boolean {
  const letters = content.replace(/[^\p{L}]/gu, '');
  return letters.length >= 2 && content === content.toUpperCase();
}

function tellEyebrowRhythm(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('eyebrow-rhythm')) return [];

  // Phase 29 slice D (#194) — these were hard pixel constants (an eyebrow ≤ 14px,
  // a heading ≥ 28px), which only held while designs carried literal sizes. Once
  // a screen references type ROLES the same design lands wherever the
  // personality's scale puts it: `soft` sets section heads at 25px and
  // `data-dense` at 19px, so a fixed 28 stopped recognising sections at all and
  // the eyebrow-to-section ratio collapsed on a design that had not changed.
  // Read the thresholds off the canvas's OWN scale when it declares one; keep the
  // constants as the fallback for canvases that don't.
  const roleSize = (role: string): number | undefined => {
    const spec = ctx.tokens.typography?.[role] as { fontSize?: number | string } | undefined;
    return typeof spec?.fontSize === 'number' ? spec.fontSize : undefined;
  };
  const eyebrowMax = Math.max(roleSize('label') ?? 0, roleSize('caption') ?? 0) || 14;
  const headingMin = roleSize('heading') ?? 28;

  const isEyebrowText = (n: SceneNode): boolean => {
    if (n.type !== 'text' || typeof n.content !== 'string' || n.content.trim().length === 0) return false;
    if ((typeof n.fontSize === 'number' ? n.fontSize : 16) > eyebrowMax) return false;
    // The signature: small text that reads as a designed LABEL rather than as
    // cramped body copy. Three ways to qualify, and the third is the calibrated
    // one:
    //   - textTransform: 'uppercase' — the explicit form
    //   - content already typed in capitals ("MODULES", "YEAR TO DATE") — the
    //     same thing authored differently, and the most common form in practice
    //   - tracking heavy enough to be a deliberate styling choice
    //
    // Any tracking at all used to qualify, and that was the bug: a personality
    // can set letterSpacing on its `label` type role, so every small label in a
    // design inherited an eyebrow signal it never asked for. Eleven ordinary
    // form fields ("Email", "Full name", "City") were counted as eyebrows on the
    // v2.1.0 checkout example.
    //
    // The threshold is measured, not guessed. Across the 112-canvas corpus the
    // tell counted 393 texts: 154 by textTransform, 221 by capitalised content,
    // and 18 by tracking alone — and every one of those 18 was a form label or a
    // tab. Their tracking runs 0.3 to 0.6, inherited from a type role. Tracking
    // that is a deliberate eyebrow choice sits at 1 to 2 (the genuine
    // capitalised labels reach 1.5, the fixtures below use 2). A floor of 1
    // separates the two classes with margin on both sides and changed no
    // canvas's verdict in the corpus.
    if (n.textTransform === 'uppercase') return true;
    const tracking = typeof n.letterSpacing === 'number' ? n.letterSpacing : 0;
    if (tracking <= 0) return false;
    return readsUppercase(n.content) || tracking >= EYEBROW_TRACKING_MIN;
  };
  const isHeading = (n: SceneNode): boolean => n.type === 'text' && (typeof n.fontSize === 'number' ? n.fontSize : 16) >= headingMin;

  // Phase 28 — the KPI-card signature: an uppercase/tracked label that sits
  // beside a large tabular figure labels a METRIC, not a section. Detected
  // structurally (an ancestor within two hops contains a ≥20px tabular-nums
  // text), so it works on any screen without a genre stamp.
  const parentOf = new Map<string, SceneNode | null>();
  for (const en of ctx.entries) parentOf.set(en.node.id, en.parent);
  const hasStatValue = (n: SceneNode): boolean =>
    (n.type === 'text' && typeof n.fontSize === 'number' && n.fontSize >= 20 && n.tabularNums === true)
    || (n.children ?? []).some(hasStatValue);
  // Climb to the containing CARD within three hops — a KPI card may nest its
  // label a row deeper than its value. The guard at the third hop is
  // COMPACTNESS: a KPI card is a small container (label + value + trim); a
  // marketing section holding a stat card somewhere inside it is large, so
  // its genuine eyebrows keep counting.
  const descendantCount = (n: SceneNode): number =>
    1 + (n.children ?? []).reduce((sum, ch) => sum + descendantCount(ch), 0);
  const labelsAStat = (n: SceneNode): boolean => {
    let cur = parentOf.get(n.id) ?? null;
    for (let hop = 0; hop < 3 && cur; hop++) {
      if (hasStatValue(cur) && (hop < 2 || descendantCount(cur) <= 20)) return true;
      cur = parentOf.get(cur.id) ?? null;
    }
    return false;
  };
  const eyebrowCount = ctx.entries.filter((e) => isEyebrowText(e.node) && !ctx.tableDescendantIds?.has(e.node.id) && !labelsAStat(e.node)).length;
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
  // Phase 29 slice A (#194) — a section-number eyebrow is a numeral SEPARATED
  // from a word ("01 — Introduction", "1. Overview", "03 / Process"). An
  // unspaced hyphen binding a numeral to a unit noun is a compound modifier,
  // not an eyebrow: "30-day plant guarantee", "2-year warranty", "12-month
  // plan" are ordinary product copy and flagging them taught agents to reword
  // correct text. So the bare hyphen only counts with whitespace on one side;
  // the separators that never appear in compound modifiers (/ · . —) still
  // match tight. ("24/7 support" was already safe: the pattern needs a LETTER
  // after the separator, and 7 is a digit.)
  { name: 'a section-number eyebrow', re: /^\s*0*\d{1,3}(?:\s*[/·.—]\s*|\s+-\s*|\s*-\s+)\p{L}/u },
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
    // A full pill (≥999) is a SHAPE choice (badge, avatar, pill button), not a
    // member of the radius scale — exclude it from the census.
    if (typeof r === 'number') { if (r > 0 && r < 999) radii.add(r); }
    else if (Array.isArray(r)) for (const v of r) if (typeof v === 'number' && v > 0 && v < 999) radii.add(v);
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
    // A fill referenced through a $token is a design-system decision by
    // construction (the accent-hue precedent) — only literal hex flags.
    const rawFill = ctx.rawById.get(node.id)?.fill;
    const viaToken = typeof rawFill === 'string' && rawFill.startsWith('$');
    if (isBackgroundSurface(node) && !viaToken) {
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

// FR-11 — accent consistency: one accent hue per page, plus neutrals and the
// design system's status vocabulary. Three or more competing saturated hues
// read as unfocused. Suggest-only — which hue is canonical is a judgment call.
// Neutrals, near-black/white, and the page background are excluded; gradients
// (non-parseable CSS strings) fall through to null and are skipped.
function tellAccentConsistency(ctx: ClicheCtx): EvaluationIssue[] {
  if (ctx.relaxed.has('accent-consistency')) return [];
  const rootId = ctx.entries[0]?.node.id;
  const hues = new Map<number, string>();               // coarse hue bucket → example hex

  // Phase 29 follow-up — a colour reached through $success / $warning / $danger
  // is the system's STATUS vocabulary, not a competing accent. This check used
  // to count them, so a screen using savings-green, remove-red and low-stock
  // amber together read as three competing accents. Because every cliché tell
  // is directive-BLOCKING regardless of severity, that made a correct design
  // unpresentable, and the only suggestion on offer was to delete legitimate
  // semantics — the same "gate you cannot satisfy by improving the design"
  // that slice D removed from the score.
  //
  // The token reference is the intentionality signal, exactly as in the
  // accent-hue tell's $chart-* / $*-tint exemption: a LITERAL #22c55e still
  // counts as an accent, because nothing declares it to be a status colour.
  const STATUS_TOKEN = /^\$(success|warning|danger)$/;

  const consider = (v: unknown, raw: unknown): void => {
    if (typeof raw === 'string' && STATUS_TOKEN.test(raw)) return;
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
    const raw = ctx.rawById.get(node.id);
    consider(node.color, raw?.color);
    consider(node.stroke, raw?.stroke);
    consider(node.iconColor, raw?.iconColor);
    if (isSmallEl(node)) consider(node.fill, raw?.fill);
  }
  if (hues.size < 3) return [];

  return [{
    category: 'cliche',
    tell: 'accent-consistency',
    severity: 'info',
    nodeId: rootId,
    message: `${hues.size} competing accent hues in use (${[...hues.values()].join(', ')}) — multiple accents read as unfocused.`,
    suggestion: `Pick one accent hue and reuse it as $accent — neutrals and the status vocabulary ($success / $warning / $danger, referenced as tokens) don't count against this.`,
  }];
}

function checkCliche(
  entries: NodeEntry[],
  rawEntries: NodeEntry[],
  tokens: DesignVariables,
  opts: { relaxed: Set<ClicheTell>; tableDescendantIds?: Set<string> },
): CheckResult {
  const rawById = new Map(rawEntries.map((e) => [e.node.id, e.node]));
  const ctx: ClicheCtx = { entries, rawById, tokens, relaxed: opts.relaxed, tableDescendantIds: opts.tableDescendantIds };

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

// ── Phase 27 slice C — usability beyond contrast ────────────────────────────
// Mechanically checkable UX floors: controls big enough to hit (WCAG 2.5.8,
// gated as ERROR — same standing as contrast), labels associated with their
// controls (warning), and honest action copy (info). Runs on the RESOLVED
// tree so padding/dimensions are numbers.

const CONTROL_TYPES = new Set(['toggle', 'checkbox', 'radio', 'select']);
/** Renderer defaults (controlSize + select's padding-derived height). */
const CONTROL_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  toggle: { w: 44, h: 24 },
  checkbox: { w: 18, h: 18 },
  radio: { w: 18, h: 18 },
  select: { w: 200, h: 36 },
};

function paddingBox(n: SceneNode): { v: number; h: number } {
  const p = n.padding;
  if (typeof p === 'number') return { v: p * 2, h: p * 2 };
  if (Array.isArray(p) && p.every((x) => typeof x === 'number')) {
    const a = p as number[];
    if (a.length === 2) return { v: a[0] * 2, h: a[1] * 2 };
    if (a.length === 4) return { v: a[0] + a[2], h: a[1] + a[3] };
  }
  return { v: 0, h: 0 };
}

/** Phase 30 slice C — the width a node renders at, when the tree alone says:
 * a numeric width; or a full or stretching width, which takes its parent's
 * content width (parent width minus its rendered padding), up to the root.
 * A stretch needs a vertical (or layout-less) parent that does not set
 * cross-axis alignment, and an in-flow node. Undefined when the width hugs
 * content or depends on something the tree doesn't fix. */
function knownWidth(n: SceneNode, parentOf: Map<string, SceneNode | null>, rootWidth: number): number | undefined {
  if (typeof n.width === 'number') return n.width;
  const parent = parentOf.get(n.id) ?? null;
  if (!parent) return rootWidth;
  if (n.position === 'absolute') return undefined;
  const columnParent = parent.layout !== 'horizontal' && parent.layout !== 'grid';
  const stretches = n.width === undefined && columnParent && (parent.alignItems === undefined || parent.alignItems === 'stretch');
  const full = n.width === '100%' || (n.width === 'fill_container' && columnParent);
  if (!stretches && !full) return undefined;
  const outer = knownWidth(parent, parentOf, rootWidth);
  if (outer === undefined) return undefined;
  const pad = paddingSides(parent, rootWidth);
  return outer - pad.left - pad.right;
}

/** Phase 30 slice C — a control's touch target on a mobile canvas: its own
 * box, extended through up to two ancestors that are ROWS (horizontal frames
 * holding exactly one control). A row's box per dimension is its known size
 * or min size (a full or stretching width takes its host's width), else the
 * control plus the row's rendered padding. Unlike the web rule this never
 * extends through a card that merely holds one control. */
function mobileTarget(
  node: SceneNode, w: number, h: number, parentOf: Map<string, SceneNode | null>,
  countControls: (n: SceneNode) => number, rootWidth: number,
): { w: number; h: number } {
  let tw = w;
  let th = h;
  let cur = parentOf.get(node.id) ?? null;
  for (let hop = 0; hop < 2 && cur; hop++) {
    if (cur.type === 'frame' && cur.layout === 'horizontal' && countControls(cur) === 1) {
      const pad = paddingSides(cur, rootWidth);
      const min = (v: SceneNode['minWidth']) => (typeof v === 'number' ? v : 0);
      tw = Math.max(tw, knownWidth(cur, parentOf, rootWidth) ?? w + pad.left + pad.right, min(cur.minWidth));
      th = Math.max(th, typeof cur.height === 'number' ? cur.height : h + pad.top + pad.bottom, min(cur.minHeight));
    }
    cur = parentOf.get(cur.id) ?? null;
  }
  return { w: tw, h: th };
}

/** Phase 30 slice D — the touch targets a tappable primitive carries, each
 * its own rendered box (never extended by an ancestor). A width the tree
 * doesn't fix is left undefined and not judged. */
function primitiveTargets(
  node: SceneNode, parentOf: Map<string, SceneNode | null>, rootWidth: number,
): Array<{ what: string; w?: number; h: number; fix: string }> {
  if (node.type === 'button') {
    const b = buttonBox(node);
    return [{ what: 'button', ...b, fix: 'Use size "md" (44px) or "lg" (52px) — "sm" is for pointer surfaces — and drop any smaller height.' }];
  }
  if (node.type === 'list-row') {
    const h = Math.max(typeof node.height === 'number' ? node.height : 0, listRowMinHeight(node));
    return [{ what: 'list-row', w: knownWidth(node, parentOf, rootWidth), h, fix: 'Let the row span its list (no width), or widen it.' }];
  }
  if (node.type === 'tab-bar') {
    const box = tabItemBox(node, rootWidth);
    const items = tabItems(node).map((it, i) => ({ what: `tab "${it?.label ?? i + 1}"`, ...box, fix: 'Widen the tab bar (drop its width) or move a destination out of it.' }));
    return node.variant === 'fab' ? [...items, { what: 'tab-bar FAB', w: FAB_SIZE, h: FAB_SIZE, fix: '' }] : items;
  }
  if (node.type === 'nav-bar') {
    return navActions(node).map((a) => ({ what: `nav-bar action "${a.label ?? a.icon ?? 'back'}"`, w: NAV_ACTION, h: NAV_ACTION, fix: '' }));
  }
  return [];
}

function checkUsability(entries: NodeEntry[], rootWidth: number, touch?: { floor: number }): CheckResult {
  const issues: EvaluationIssue[] = [];
  let score = 100;

  const parentOf = new Map<string, SceneNode | null>();
  for (const en of entries) parentOf.set(en.node.id, en.parent);
  // On a phone a row holds "one control" only when no tappable primitive
  // shares it either — a checkbox beside a button doesn't own the row.
  const countControls = (n: SceneNode): number => {
    let c = CONTROL_TYPES.has(n.type) || (touch !== undefined && TAPPABLE_PRIMITIVES.has(n.type)) ? 1 : 0;
    for (const ch of n.children ?? []) c += countControls(ch);
    return c;
  };
  const hasText = (n: SceneNode): boolean =>
    (n.type === 'text' && typeof n.content === 'string' && n.content.trim().length > 0)
    || (n.children ?? []).some(hasText);

  const touchFirst = rootWidth > 0 && rootWidth < 500;   // a phone-width artboard

  for (const { node } of entries) {
    if (touch && TAPPABLE_PRIMITIVES.has(node.type)) {
      for (const t of primitiveTargets(node, parentOf, rootWidth)) {
        if ((t.w !== undefined && t.w < touch.floor) || t.h < touch.floor) {
          score -= 25;
          issues.push({
            category: 'usability',
            rule: 'mobile-touch-target',
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `${t.what} has a ${t.w === undefined ? '?' : Math.round(t.w)}×${Math.round(t.h)}px touch target — below the ${touch.floor}px floor on a phone (Apple HIG; WCAG 2.5.5).`,
            ...(t.fix ? { suggestion: t.fix } : {}),
          });
        }
      }
    }

    if (CONTROL_TYPES.has(node.type)) {
      const def = CONTROL_DEFAULT_SIZE[node.type];
      let w = typeof node.width === 'number' ? node.width : def.w;
      let h = typeof node.height === 'number' ? node.height : def.h;

      if (touch) {
        const t = mobileTarget(node, w, h, parentOf, countControls, rootWidth);
        if (Math.min(t.w, t.h) < touch.floor) {
          score -= 25;
          issues.push({
            category: 'usability',
            rule: 'mobile-touch-target',
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `${node.type} has a ${Math.round(t.w)}×${Math.round(t.h)}px touch target — below the ${touch.floor}px floor on a phone (Apple HIG; WCAG 2.5.5).`,
            suggestion: `Grow the control, or put it alone in a row (a horizontal frame) at least ${touch.floor}px tall — a lone control's row is its target.`,
          });
        }
      } else {
        // The effective target extends to a padded ancestor row when the
        // control is the only control inside it (the whole row is tappable by
        // convention) — the WCAG 2.5.8 spacing model, applied structurally.
        let cur = parentOf.get(node.id) ?? null;
        for (let hop = 0; hop < 2 && cur && Math.min(w, h) < 24; hop++) {
          if (countControls(cur) === 1) {
            const pad = paddingBox(cur);
            w += pad.h;
            h += pad.v;
          }
          cur = parentOf.get(cur.id) ?? null;
        }

        if (Math.min(w, h) < 24) {
          score -= 25;
          issues.push({
            category: 'usability',
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `${node.type} has a ${Math.round(w)}×${Math.round(h)}px effective hit target — below the 24px floor (WCAG 2.5.8).`,
            suggestion: 'Grow the control, or give its row enough padding that the whole row is the target (a lone control inherits its padded row\'s box).',
          });
        } else if (touchFirst && Math.min(w, h) < 44) {
          issues.push({
            category: 'usability',
            severity: 'info',
            nodeId: node.id,
            nodeName: node.name,
            message: `${node.type} has a ${Math.round(w)}×${Math.round(h)}px effective hit target — fine for pointer input, but this looks like a touch-first screen (44px is the comfortable floor there).`,
          });
        }
      }

      // Label association: a control the user can't name is a guess. The
      // label may sit anywhere in the padded row/group around the control
      // (label-beside and label-above both count). Selects carry their own
      // value/placeholder text.
      if (node.type !== 'select') {
        let scope = parentOf.get(node.id) ?? null;
        let labeled = false;
        for (let hop = 0; hop < 2 && scope && !labeled; hop++) {
          labeled = hasText(scope);
          scope = parentOf.get(scope.id) ?? null;
        }
        if (!labeled) {
          score -= 10;
          issues.push({
            category: 'usability',
            severity: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `${node.type} has no text label in its row or group — screen readers and scanning users get a bare control.`,
            suggestion: 'Put a text label in the control\'s row (label-beside) or directly above it (label-above).',
          });
        }
      }
    }

    // Vague action copy — exact matches only, so body prose never flags.
    if (node.type === 'text' && typeof node.content === 'string') {
      const copy = node.content.trim().toLowerCase();
      if (copy === 'click here' || copy === 'learn more' || copy === 'read more' || copy === 'submit') {
        issues.push({
          category: 'usability',
          severity: 'info',
          nodeId: node.id,
          nodeName: node.name,
          message: `"${node.content.trim()}" is vague action copy — the label should name what happens.`,
          suggestion: 'Name the action: "Export report", "Create project", "Save changes".',
        });
      }
    }
  }

  return { score: Math.max(0, score), issues };
}

/** Fold ruleset findings into a category result: −10 per warning (errors
 * score themselves inside their check), infos free. */
function withRuleIssues(result: CheckResult, extra: EvaluationIssue[]): CheckResult {
  if (extra.length === 0) return result;
  const warnings = extra.filter((i) => i.severity === 'warning').length;
  return { score: Math.max(0, result.score - warnings * 10), issues: [...result.issues, ...extra] };
}

const CATEGORY_WEIGHTS = new Map([
  ['spacing', 20],
  ['color', 25],
  ['typography', 20],
  ['structure', 15],
  ['consistency', 20],
  ['cliche', 15],
  ['coverage', 10],
  ['usability', 20],
]);

// ── Phase 24 slice C — state coverage ───────────────────────────────────────
// A data-bearing screen isn't done when the happy path looks good: the empty
// table, the loading skeleton, and the form error are designed surfaces too,
// and "the three states AI always forgets" is how they get skipped. This
// check DEMANDS them (warning severity — directive-blocking) on base
// canvases whose content carries data; non-data screens and variant canvases
// themselves are silent. Detection reuses the drift inventory so drift,
// coverage, and (slice D) stress share one vocabulary for "a table".
// Deliberately conservative: header-less card lists aren't detected yet —
// a false negative is today's status quo, a false positive is friction.

/** What each kind of data-bearing content demands (spec C4). */
const COVERAGE_DEMANDS: { kind: string; demands: string[]; detect: (inv: ReturnType<typeof extractInventory>) => boolean; noun: string }[] = [
  { kind: 'table', demands: ['empty', 'loading'], detect: (inv) => inv.tables.length > 0, noun: 'a data table' },
  { kind: 'form', demands: ['error'], detect: (inv) => inv.counts.controls >= 3, noun: 'a form (3+ input controls)' },
];

/** Scaffold hint per demanded state — the cheap way to comply (slice B). */
const COVERAGE_HINTS: Record<string, string> = {
  empty: 'canvas_add_variant with state "empty", delete the data rows, stamp the empty-state scaffold where they were.',
  loading: 'canvas_add_variant with state "loading", replace the data rows with the skeleton-table (or skeleton-card) scaffold.',
  error: 'canvas_add_variant with state "error", show the form\'s validation-failure treatment (field messages + summary).',
};

function checkCoverage(canvas: Canvas, designedStates: string[]): { result: CheckResult; report?: EvaluationResult['coverage'] } {
  // A variant IS a designed state — demanding states of it would recurse.
  // But a LOADING variant that skeletons one data surface while sibling data
  // surfaces still show live values is half-designed (Phase 27 FR-B4): the
  // shipped loading screen flashes real-looking data next to placeholders.
  if (canvas.metadata?.variant) {
    if (canvas.metadata.variant.state === 'loading') {
      const root = expandInstances(canvas.root, canvas);
      const hasSkeleton = (n: SceneNode): boolean =>
        n.type === 'skeleton' || (n.children ?? []).some(hasSkeleton);
      if (hasSkeleton(root)) {
        // A "data surface" shows live values: a detected table, or a frame
        // holding ≥2 large (≥20px) numeric-capable texts (tabularNums or
        // digits) — the stat-row shape. Chrome (nav, titles) never matches.
        const issues: EvaluationIssue[] = [];
        const inv = extractInventory(root);
        const tableIds = new Set(inv.tables.map((t) => t.nodeId));
        const visit = (n: SceneNode): void => {
          if (hasSkeletonDescendant(n)) { (n.children ?? []).forEach(visit); return; }
          const isTable = tableIds.has(n.id);
          const metricTexts = countMetricTexts(n);
          if (isTable || metricTexts >= 2) {
            issues.push({
              category: 'coverage',
              severity: 'warning',
              nodeId: n.id,
              nodeName: n.name,
              message: `Loading state is half-designed: "${n.name ?? n.id}" still shows live ${isTable ? 'table rows' : 'metric values'} while sibling regions are skeletoned.`,
              suggestion: 'Skeleton every data surface — stamp skeleton-stat-card / skeleton-table / skeleton-card over the remaining live regions.',
            });
            return; // one finding per region, don't descend further
          }
          (n.children ?? []).forEach(visit);
        };
        const hasSkeletonDescendant = (n: SceneNode): boolean =>
          n.type === 'skeleton' || (n.children ?? []).some(hasSkeletonDescendant);
        const countMetricTexts = (n: SceneNode): number => {
          let count = 0;
          const walk = (x: SceneNode): void => {
            if (x.type === 'text' && typeof x.fontSize === 'number' && x.fontSize >= 20
              && (x.tabularNums === true || /\d/.test(String(x.content ?? '')))) count++;
            (x.children ?? []).forEach(walk);
          };
          walk(n);
          return count;
        };
        visit(root);
        return { result: { score: Math.max(0, 100 - issues.length * 35), issues } };
      }
    }
    return { result: { score: 100, issues: [] } };
  }

  const inv = extractInventory(expandInstances(canvas.root, canvas));
  const demanded = new Map<string, string>(); // state → noun that demanded it
  for (const d of COVERAGE_DEMANDS) {
    if (!d.detect(inv)) continue;
    for (const state of d.demands) if (!demanded.has(state)) demanded.set(state, d.noun);
  }
  const dataBearing = demanded.size > 0;
  const missing = [...demanded.keys()].filter((s) => !designedStates.includes(s));
  const issues: EvaluationIssue[] = missing.map((state) => ({
    category: 'coverage',
    severity: 'warning',
    nodeId: canvas.root.id,
    message: `This screen has ${demanded.get(state)} but no "${state}" state variant is designed — the shipped UI will improvise it.`,
    suggestion: COVERAGE_HINTS[state],
  }));
  return {
    result: { score: Math.max(0, 100 - missing.length * 35), issues },
    report: { dataBearing, states: designedStates, missing },
  };
}

/** Phase 30 slice D — the tree with every instance expanded into what it
 * renders, for the mobile rules. Nodes inside an instance get ids prefixed by
 * the instance path (`inst/child`), so two instances of one component never
 * share an id, and `owners` maps each such id to the outermost instance. */
function expandForRules(root: SceneNode, canvas: Canvas): { root: SceneNode; owners: Map<string, SceneNode> } {
  const owners = new Map<string, SceneNode>();
  const walk = (node: SceneNode, owner: SceneNode | undefined, prefix: string): SceneNode => {
    const id = owner ? prefix + node.id : node.id;
    if (owner) owners.set(id, owner);
    const resolved = node.type === 'instance' && node.componentId ? resolveInstance(node, canvas) : null;
    if (resolved) {
      const childPrefix = `${prefix}${node.id}/`;
      return { ...resolved, id, children: resolved.children?.map((c) => walk(c, owner ?? node, childPrefix)) };
    }
    return { ...node, id, children: node.children?.map((c) => walk(c, owner, prefix)) };
  };
  return { root: walk(root, undefined, ''), owners };
}

/** Re-point findings on nodes inside an instance at the instance (the
 * component holds the node), naming the inner node. */
function reportOnInstances(issues: EvaluationIssue[], owners: Map<string, SceneNode>): EvaluationIssue[] {
  return issues.map((i) => {
    const owner = i.nodeId ? owners.get(i.nodeId) : undefined;
    if (!owner) return i;
    return { ...i, nodeId: owner.id, nodeName: owner.name, message: `${i.message} (inside instance "${owner.name ?? owner.id}" — fix it in its component)` };
  });
}

export async function evaluateCanvas(
  canvas: Canvas,
  options: { mode: 'fast' | 'detailed' | 'llm'; categories?: string[]; genre?: string; designedStates?: string[] },
): Promise<EvaluationResult> {
  // Resolve variables so $tokens become actual values for contrast checks.
  // Tokens flow through workspace → project → canvas inheritance (Phase 9),
  // so contrast checks evaluate the actual rendered colors even when the
  // canvas itself has empty `variables` and inherits everything from the
  // workspace design system.
  const mergedTokens = getCanvasTokens(canvas);
  const resolvedRoot = resolveVariables(canvas.root, mergedTokens);
  // Phase 30 slice B — one composition of the type, genre and preset rulesets
  // serves the cliche relaxation and the surface report.
  const declared = resolveSurface(canvas);
  const resolvedGenre = resolveGenre(canvas, options.genre);
  const preset = canvas.metadata?.provenance?.preset;
  const rules = composeRulesets(activeRulesets({ type: declared.type, genre: resolvedGenre.genre, preset }));
  const surface: SurfaceReport = { ...declared, rulesOn: rules.on, rulesOff: rules.off, conflicts: rules.conflicts };
  const ruleOn = new Set(rules.on);
  // Phase 30 slice D — the mobile rules judge what the renderer draws, so they
  // read the tree with instances expanded (a tab bar inside a component is
  // still a tab bar). Findings inside an instance report the instance.
  const { root: expandedRaw, owners } = expandForRules(canvas.root, canvas);
  const mobileRoot = resolveVariables(expandedRaw, mergedTokens);
  const mobileTypeRules = MOBILE_RULES.some((id) => ruleOn.has(id));
  const mobile: MobileContext = {
    root: mobileRoot,
    profile: deviceProfile(declared.device ?? DEFAULT_DEVICE) ?? DEVICE_PROFILES[DEFAULT_DEVICE],
    width: typeof resolvedRoot.width === 'number' ? resolvedRoot.width : 1440,
    height: typeof resolvedRoot.height === 'number' ? resolvedRoot.height : 900,
  };
  const entries = buildTreeContext(resolvedRoot);
  // Also walk the unresolved tree for token usage stats
  const rawEntries = buildTreeContext(canvas.root);

  if (entries.length <= 1) {
    // A blank document is not a presentable design. This used to return 100
    // with the emptiness only mentioned in the summary — so a canvas whose
    // content never landed (or was wiped) sailed through every gate and the
    // project roll-up called it coherent (release-dogfood finding: a blank
    // screen was presented at score 100). Score 0 + a blocking error make
    // emptiness impossible to mistake for perfection.
    return {
      overallScore: 0,
      categories: [{ name: 'structure', score: 0, issueCount: 1, weight: 100 }],
      issues: [{
        category: 'structure',
        severity: 'error',
        nodeId: canvas.root.id,
        message: 'The canvas is empty — nothing has been designed yet. Stamp a structure (list_structures → apply_structure) or add content before evaluating.',
      }],
      summary: 'Canvas is empty — nothing has been designed yet.',
      stats: { totalNodes: entries.length, textNodes: 0, frameNodes: 0, maxDepth: 0, tokenUsagePercent: 0, componentReusePercent: 0 },
      mode: options.mode,
      surface,
    };
  }

  const activeCategories = options.categories ?? [...CATEGORY_WEIGHTS.keys()];
  const results = new Map<string, CheckResult>();

  // Fast checks (all use JSON tree only)
  if (activeCategories.includes('spacing')) {
    results.set('spacing', checkSpacing(rawEntries, mergedTokens));
  }
  if (activeCategories.includes('color')) {
    const light = checkColorContrast(entries);
    // Phase 25 slice D — a dark token layer means the design ships in two
    // themes; contrast is checked in BOTH, dark issues tagged. Score takes
    // the worse theme: a dark-only failure must hurt.
    const darkLayer = mergedTokens.dark?.colors;
    if (darkLayer && Object.keys(darkLayer).length > 0) {
      const darkEntries = buildTreeContext(resolveVariables(canvas.root, mergedTokens, { theme: 'dark' }));
      const dark = checkColorContrast(darkEntries, 'dark');
      results.set('color', { score: Math.min(light.score, dark.score), issues: [...light.issues, ...dark.issues] });
    } else {
      results.set('color', light);
    }
  }
  // Phase 25 slice A — detailed-mode layout is computed ONCE and shared by
  // the consistency and typography (measure) checks.
  // Phase 30 slice C — mobile-safe-area reads rendered rects too, deeper.
  let detailedLayout: LayoutRect[] | undefined;
  const safeAreaDetailed = activeCategories.includes('usability') && ruleOn.has('mobile-safe-area');
  if (options.mode === 'detailed' && (activeCategories.includes('consistency') || activeCategories.includes('typography') || safeAreaDetailed)) {
    const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
    const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
    // On a mobile canvas render the tree the mobile rules read: instances
    // expanded with their own ids (so the rects are unambiguous) and their
    // tokens resolved. Web keeps the canvas render.
    const html = mobileTypeRules ? renderToHtml(mobileRoot, w, h, canvas) : renderToHtml(resolvedRoot, w, h, canvas);
    detailedLayout = await computeLayout(html, undefined, ruleOn.has('mobile-safe-area') ? 25 : 10, { width: w, height: h });
  }
  if (activeCategories.includes('typography')) {
    const typography = checkTypography(entries, mergedTokens, {
      rootWidth: typeof canvas.root.width === 'number' ? canvas.root.width : undefined,
      layout: detailedLayout,
      tables: extractInventory(resolvedRoot).tables,
    });
    const rawById = new Map(buildTreeContext(expandedRaw).map((en) => [en.node.id, en.node]));
    results.set('typography', withRuleIssues(typography, ruleOn.has('mobile-type-floor') ? reportOnInstances(checkTypeFloor(mobile, rawById), owners) : []));
  }
  if (activeCategories.includes('structure')) {
    results.set('structure', withRuleIssues(checkStructure(rawEntries, canvas), ruleOn.has('mobile-artboard') ? reportOnInstances(checkArtboard(mobile, declared), owners) : []));
  }
  if (activeCategories.includes('consistency')) {
    const consistencyCtx = { rawEntries, tokens: mergedTokens };
    if (options.mode === 'detailed' && detailedLayout) {
      results.set('consistency', checkConsistencyDetailed(entries, detailedLayout, consistencyCtx));
    } else {
      results.set('consistency', checkConsistency(entries, consistencyCtx));
    }
  }
  if (activeCategories.includes('usability')) {
    const touch = ruleOn.has('mobile-touch-target') ? { floor: mobile.profile.touchTarget } : undefined;
    // On a mobile canvas the whole usability check reads the expanded tree;
    // web keeps the unexpanded one.
    const usability = mobileTypeRules
      ? (({ score, issues }) => ({ score, issues: reportOnInstances(issues, owners) }))(checkUsability(buildTreeContext(mobileRoot), mobile.width, touch))
      : checkUsability(entries, mobile.width, touch);
    const extra = reportOnInstances([
      ...(ruleOn.has('mobile-handbuilt-target') ? checkHandbuiltTargets(mobile) : []),
      ...(ruleOn.has('mobile-safe-area') ? (detailedLayout ? checkSafeAreaDetailed(mobile, detailedLayout) : checkSafeAreaFast(mobile)) : []),
      ...(ruleOn.has('mobile-one-column') ? checkOneColumn(mobile) : []),
      ...(ruleOn.has('mobile-tab-bar') ? checkTabBars(mobile) : []),
    ], owners);
    results.set('usability', withRuleIssues(usability, extra));
  }

  let coverageReport: EvaluationResult['coverage'];
  if (activeCategories.includes('coverage')) {
    const { result, report } = checkCoverage(canvas, options.designedStates ?? []);
    results.set('coverage', result);
    coverageReport = report;
  }

  let genreReport: GenreReport | undefined;
  if (activeCategories.includes('cliche')) {
    // Genre comes from the explicit option, else the canvas's stored genre;
    // the applied preset contributes its own relaxation on top (composed above).
    const relaxed = new Set(rules.relaxed);
    // Resolved entries → $accent becomes a real hex for hue math; rawEntries →
    // distinguish a literal default purple (autofixable) from a $token one.
    // Table header cells are small uppercase labels by convention — exclude
    // their subtrees from the eyebrow census (a skeleton-table's 4 headers
    // are not 4 section eyebrows).
    const tableDescendantIds = new Set<string>();
    for (const t of extractInventory(resolvedRoot).tables) {
      const container = entries.find((en) => en.node.id === t.nodeId)?.node;
      // Only horizontal row frames — a stack of vertical sections can satisfy
      // the loose table shape, and its labels ARE eyebrows.
      for (const row of container?.children ?? []) {
        if (row.type === 'frame' && row.layout === 'horizontal') {
          (function walk(n: SceneNode) { tableDescendantIds.add(n.id); n.children?.forEach(walk); })(row);
        }
      }
    }
    results.set('cliche', checkCliche(entries, rawEntries, mergedTokens, { relaxed, tableDescendantIds }));
    genreReport = buildGenreReport(resolvedGenre, relaxed, preset);
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
      if (['id', 'type', 'name', 'children'].includes(key) || PRIMITIVE_COPY_PROPS.has(key)) continue;
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
    ...(coverageReport ? { coverage: coverageReport } : {}),
    ...(genreReport ? { genre: genreReport } : {}),
    surface,
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
