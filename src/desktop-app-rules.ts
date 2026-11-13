// Phase 31 — the desktop-app rules. Each check lands in the same change as
// the rule id it honours (see DESKTOP_APP_RULES in surfaces.ts).

import type { EvaluationIssue } from './evaluate.js';
import type { LayoutRect } from './screenshot.js';
import type { SceneNode } from './types.js';
import { CLICKABLE_PRIMITIVES, DESKTOP_APP_PRIMITIVES, tabsItems } from './primitives.js';
import { fontPx, paddingSides, proseWords } from './mobile-rules.js';
import { shapeHash } from './shape-hash.js';
import { windowProfile, DEFAULT_WINDOW, WINDOW_PROFILES, type SurfaceDeclaration, type WindowProfile } from './surfaces.js';

/** `desktop-app-artboard` (base ruleset, every type). A desktop-app canvas
 * narrower than its window's minimum warns (slice A). A canvas that holds a
 * desktop-app primitive (nav-item, tabs, tree-row, menu-row, property-row)
 * must say it is one (slice B): undeclared warns, an explicit `web` gets an
 * info, an explicit `mobile` warns. The overlay clause lands with the
 * overlay primitives (slice E). Reads the tree with instances expanded. */
export function checkDesktopArtboard(root: SceneNode, surface: SurfaceDeclaration): EvaluationIssue[] {
  if (surface.type !== 'desktop-app') return checkAppPrimitivesDeclared(root, surface);
  const profile = windowProfile(surface.device ?? DEFAULT_WINDOW) ?? WINDOW_PROFILES[DEFAULT_WINDOW];
  const width = typeof root.width === 'number' ? root.width : profile.width;
  if (width >= profile.minWidth) return [];
  return [{
    category: 'structure',
    rule: 'desktop-app-artboard',
    severity: 'warning',
    nodeId: root.id,
    nodeName: root.name,
    message: `This canvas is declared desktop-app but its artboard is ${width}px wide — the desktop-app layouts are built for windows of ${profile.minWidth}px and up.`,
    suggestion: `Resize it: U("document", { width: ${profile.width}, height: ${profile.height} }) — or canvas_set_type({ type: "mobile" }) / ({ type: "web" }) if it is a phone screen or a narrow web page.`,
  }];
}

function firstAppPrimitive(root: SceneNode): SceneNode | undefined {
  if (DESKTOP_APP_PRIMITIVES.has(root.type)) return root;
  for (const c of root.children ?? []) {
    const hit = firstAppPrimitive(c);
    if (hit) return hit;
  }
  return undefined;
}

function checkAppPrimitivesDeclared(root: SceneNode, surface: SurfaceDeclaration): EvaluationIssue[] {
  const hit = firstAppPrimitive(root);
  if (!hit) return [];
  const what = `a ${hit.type}${hit.name ? ` ("${hit.name}")` : ''}`;
  const base = { category: 'structure', rule: 'desktop-app-artboard', nodeId: hit.id, nodeName: hit.name } as const;
  if (surface.source === 'default') {
    return [{
      ...base, severity: 'warning',
      message: `This canvas holds ${what}, a desktop-app primitive, but never declared its type, so it is judged as a web page.`,
      suggestion: 'Declare it: canvas_set_type({ type: "desktop-app" }) for an application screen (a tool you work in), or canvas_set_type({ type: "web" }) if it really is a page you read.',
    }];
  }
  if (surface.type === 'mobile') {
    return [{
      ...base, severity: 'warning',
      message: `This canvas is declared mobile but holds ${what}, a desktop-app primitive built for pointer input and dense windows.`,
      suggestion: 'Use the mobile vocabulary on a phone (list-row, tab-bar, nav-bar, button), or canvas_set_type({ type: "desktop-app" }) if this is an application window.',
    }];
  }
  return [{
    ...base, severity: 'info',
    message: `This canvas is declared web but holds ${what}: an application screen should declare desktop-app so the desktop-app ruleset judges it.`,
    suggestion: 'canvas_set_type({ type: "desktop-app" }) if this is a tool you work in.',
  }];
}

// ── Phase 31 slice C — the app rules ───────────────────────────────────────
// Each reads the resolved tree with instances expanded (the caller maps
// findings back to instances). Fast mode reads the tree; detailed mode adds
// the rendered rects of that same tree.

export interface DesktopContext {
  /** The resolved tree, instances expanded. */
  root: SceneNode;
  profile: WindowProfile;
  /** Rendered rects of `root` (detailed mode), by node id. */
  rects?: Map<string, LayoutRect>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hasText = (v: unknown): boolean => (typeof v === 'string' && v.trim() !== '') || isNum(v);
const textOf = (n: SceneNode): string | undefined =>
  n.type === 'text' && typeof n.content === 'string' && n.content.trim() ? n.content : undefined;
const quote = (s: string) => `"${s.length > 40 ? `${s.slice(0, 37)}…` : s}"`;
const nameOf = (n: SceneNode) => n.name ?? n.id;

function issue(category: string, rule: string, severity: EvaluationIssue['severity'], node: SceneNode, message: string, suggestion?: string): EvaluationIssue {
  return { category, rule, severity, nodeId: node.id, nodeName: node.name, message, ...(suggestion ? { suggestion } : {}) };
}

function parents(root: SceneNode): Map<SceneNode, SceneNode | null> {
  const out = new Map<SceneNode, SceneNode | null>([[root, null]]);
  (function walk(n: SceneNode) { for (const c of n.children ?? []) { out.set(c, n); walk(c); } })(root);
  return out;
}

/** A pane: a frame that scrolls on its own (overflow "auto"), or the root.
 * (`modal` and `drawer` join with the overlay primitives, slice E.) */
function paneOf(n: SceneNode, parentOf: Map<SceneNode, SceneNode | null>): SceneNode {
  let cur = parentOf.get(n) ?? null;
  let last = n;
  while (cur) {
    if (cur.type === 'frame' && cur.overflow === 'auto') return cur;
    last = cur;
    cur = parentOf.get(cur) ?? null;
  }
  return last;
}

// ── desktop-app-handbuilt-target (FR-C2) ───────────────────────────────────

/** Below this, a frame shaped like a click target is named (the dense
 * desktop default control height). */
const HANDBUILT_BELOW = 32;
const LABEL_WORDS = 3;
/** What the browser draws for text with no font-size / line-height. */
const DEFAULT_FONT_PX = 16;
const DEFAULT_LINE = 1.2;

/** A stroke that draws: a colour other than none / transparent, width not 0. */
const drawsStroke = (n: SceneNode): boolean =>
  typeof n.stroke === 'string' && n.stroke.trim() !== '' && !/^(none|transparent)$/i.test(n.stroke.trim()) && n.strokeWidth !== 0;

/** A text's line box in px: its size times its line-height (a number is a
 * multiplier, as the renderer emits it). */
function lineBox(t: SceneNode): number {
  const size = fontPx(t.fontSize) ?? DEFAULT_FONT_PX;
  return size * (isNum(t.lineHeight) && t.lineHeight > 0 && t.lineHeight < 4 ? t.lineHeight : DEFAULT_LINE);
}

/** Frames shaped like a click target below 32px in either dimension: one
 * icon, one icon plus a label of three words or fewer, or (spec change S2) a
 * bordered, padded frame holding one such label and nothing else, the shape
 * an imported text button takes. Info only, as on mobile: a frame cannot say
 * it is decorative. A frame inside a clickable primitive or a property-row
 * (its value slot) is never hand-built. Detailed mode measures the rendered box; fast
 * mode reads an authored size, else estimates the height from the icon or
 * the label's line box plus vertical padding (an icon-only frame's width the
 * same way; a labelled frame's width is unknown). */
export function checkHandbuiltTargetsApp(ctx: DesktopContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const shape = (n: SceneNode): { icon?: SceneNode; label?: SceneNode } | null => {
    const icons: SceneNode[] = [];
    const texts: SceneNode[] = [];
    let other = false;
    // Stops as soon as the frame can no longer be click-shaped.
    (function walk(x: SceneNode) {
      for (const c of x.children ?? []) {
        if (other || icons.length > 1 || texts.length > 1) return;
        if (c.type === 'icon') icons.push(c);
        else if (textOf(c) !== undefined) texts.push(c);
        else if (c.type !== 'frame' || c.layout === 'grid') other = true;
        walk(c);
      }
    })(n);
    if (other || icons.length > 1 || texts.length > 1) return null;
    if (texts.length === 1 && proseWords(texts[0].content as string) > LABEL_WORDS) return null;
    if (icons.length === 0) {
      const pad = paddingSides(n, ctx.profile.width);
      const padded = pad.top + pad.right + pad.bottom + pad.left > 0;
      if (texts.length !== 1 || !drawsStroke(n) || !padded) return null;
    }
    return { icon: icons[0], label: texts[0] };
  };
  const dim = (n: SceneNode, axis: 'width' | 'height', s: { icon?: SceneNode; label?: SceneNode }): number | undefined => {
    const rect = ctx.rects?.get(n.id);
    if (rect) return axis === 'width' ? rect.width : rect.height;
    const v = n[axis];
    const min = axis === 'width' ? n.minWidth : n.minHeight;
    const floor = isNum(min) ? min : 0;
    if (isNum(v)) return Math.max(v, floor);
    if (v !== undefined || (axis === 'width' && s.label)) return undefined;
    const pad = paddingSides(n, ctx.profile.width);
    const icon = s.icon ? (isNum(s.icon.iconSize) ? s.icon.iconSize : 24) : 0;
    const label = s.label ? lineBox(s.label) : 0;
    // A frame stacks its children vertically unless it is horizontal, so an
    // icon and caption that are both its in-flow children add up (with the
    // gap between them); nested or positioned, the larger one stands in.
    const direct = (c?: SceneNode) => !!c && (n.children ?? []).includes(c) && c.position !== 'absolute' && c.position !== 'fixed';
    const stacked = axis === 'height' && n.layout !== 'horizontal' && icon > 0 && label > 0 && direct(s.icon) && direct(s.label);
    const content = stacked ? icon + label + (isNum(n.gap) ? n.gap : 0) : Math.max(icon, label);
    return Math.max(floor, Math.round(content + (axis === 'width' ? pad.left + pad.right : pad.top + pad.bottom)));
  };
  (function walk(n: SceneNode) {
    if (CLICKABLE_PRIMITIVES.has(n.type) || n.type === 'property-row') return;
    if (n.type === 'frame' && n !== ctx.root) {
      const s = shape(n);
      if (s) {
        const w = dim(n, 'width', s);
        const h = dim(n, 'height', s);
        if ((w !== undefined && w < HANDBUILT_BELOW) || (h !== undefined && h < HANDBUILT_BELOW)) {
          const label = s.label ? String(s.label.content).trim() : undefined;
          const use = !s.icon
            ? `a \`button\` (label "${label}", size "xs" or "sm") or a \`link\``
            : label
              ? `a \`link\` (label "${label}", icon "${s.icon.icon}") or a \`button\` with size "xs" or "sm"`
              : `an icon-only \`button\` (icon "${s.icon.icon}", size "xs" or "sm", with an ariaLabel)`;
          issues.push(issue('usability', 'desktop-app-handbuilt-target', 'info', n,
            `"${nameOf(n)}" looks like a hand-built click target (${w ?? '?'}×${h ?? '?'}px). If it is clickable, the target rules cannot measure a frame, and it is not keyboard reachable.`,
            `If it is clickable, rebuild it as ${use}. If it is decorative, ignore this.`));
        }
        return; // the outermost click-shaped frame is the target
      }
    }
    n.children?.forEach(walk);
  })(ctx.root);
  return issues;
}

// ── desktop-app-icon-label (FR-C3) ─────────────────────────────────────────

/** An icon-only button or link (blank label, an icon) with no ariaLabel
 * (spec change S3 added the link), or a collapsed nav-item with a blank
 * label: an action with no name. */
export function checkIconLabels(ctx: DesktopContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  (function walk(n: SceneNode) {
    if ((n.type === 'button' || n.type === 'link') && !hasText(n.label) && hasText(n.icon) && !hasText(n.ariaLabel)) {
      issues.push(issue('usability', 'desktop-app-icon-label', 'warning', n,
        `Icon-only ${n.type} "${nameOf(n)}" (icon "${n.icon}") has no name — a screen reader announces nothing, and a hover shows no tooltip.`,
        'Give it an ariaLabel naming the action (U(id, { ariaLabel: "…" })). It renders as aria-label and title, never as visible text.'));
    }
    if (n.type === 'nav-item' && n.collapsed === true && !hasText(n.label)) {
      issues.push(issue('usability', 'desktop-app-icon-label', 'warning', n,
        `Collapsed nav-item "${nameOf(n)}" has no label — in the rail form the label is its only name (aria-label and title).`,
        'Give it the destination\'s name (U(id, { label: "…" })). The rail hides it visually.'));
    }
    n.children?.forEach(walk);
  })(ctx.root);
  return issues;
}

// ── desktop-app-current (FR-C4) ────────────────────────────────────────────

/** Wayfinding: within one pane, the nav-items are one navigation group
 * (depth 0 and 1 together, wherever their section frames sit): two active
 * items at one depth warn, and a group of two or more items with none active
 * warns. A tabs node with no active tab or more than one warns. Tree-rows
 * under one parent are one tree: more than one active row warns, and a tree
 * with a current row that nests past two levels (depth 2+) is an info. */
export function checkCurrent(ctx: DesktopContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const rule = 'desktop-app-current';
  const parentOf = parents(ctx.root);
  const groups = new Map<SceneNode, SceneNode[]>();
  const trees = new Map<SceneNode, SceneNode[]>();
  for (const n of parentOf.keys()) {
    if (n.type === 'nav-item') {
      const pane = paneOf(n, parentOf);
      groups.set(pane, [...(groups.get(pane) ?? []), n]);
    } else if (n.type === 'tree-row') {
      const parent = parentOf.get(n) ?? ctx.root;
      trees.set(parent, [...(trees.get(parent) ?? []), n]);
    } else if (n.type === 'tabs') {
      const items = tabsItems(n);
      const active = items.filter((it) => it.active === true).length;
      if (items.length > 0 && active !== 1) {
        issues.push(issue('usability', rule, 'warning', n,
          active === 0
            ? `Tabs "${nameOf(n)}" mark no tab active — the user cannot tell which view they are on.`
            : `Tabs "${nameOf(n)}" mark ${active} tabs active — exactly one tab is the current view.`,
          'Set active: true on exactly one item.'));
      }
    }
  }
  for (const [pane, items] of groups) {
    const depthOf = (n: SceneNode) => (n.depth === 1 ? 1 : 0);
    const active = items.filter((n) => n.active === true);
    const doubled = [0, 1].map((d) => active.filter((n) => depthOf(n) === d)).find((a) => a.length > 1);
    if (doubled) {
      issues.push(issue('usability', rule, 'warning', doubled[1],
        `${doubled.length} nav-items in ${pane === ctx.root ? 'the screen' : `pane "${nameOf(pane)}"`} are active at depth ${depthOf(doubled[0])} (${doubled.map((n) => `"${n.label ?? nameOf(n)}"`).join(', ')}) — the current location is ambiguous.`,
        'Keep active: true on the one item for the current page (a parent at depth 0 may stay active over its active child).'));
    } else if (items.length >= 2 && active.length === 0) {
      issues.push(issue('usability', rule, 'warning', items[0],
        `None of the ${items.length} nav-items in ${pane === ctx.root ? 'the screen' : `pane "${nameOf(pane)}"`} is active — the user cannot see where they are.`,
        'Set active: true on the nav-item for the current page.'));
    }
  }
  for (const rows of trees.values()) {
    const active = rows.filter((n) => n.active === true);
    if (active.length > 1) {
      issues.push(issue('usability', rule, 'warning', active[1],
        `${active.length} rows of one tree are active (${active.map((n) => `"${n.label ?? nameOf(n)}"`).join(', ')}) — one row is the current selection.`,
        'Keep active: true on one row.'));
    }
    const deepest = Math.max(...rows.map((n) => (isNum(n.depth) ? Math.floor(n.depth) : 0)));
    if (active.length > 0 && deepest >= 2) {
      issues.push(issue('usability', rule, 'info', active[0],
        `This tree marks a current row and nests ${deepest + 1} levels deep — as navigation, more than two levels is hard to keep a place in (Microsoft NavigationView, NN/g).`,
        'If it is navigation, flatten it to two levels; a file or outline tree can nest deeper and may ignore this.'));
    }
  }
  return issues;
}

// ── desktop-app-type-ladder (FR-C5) ────────────────────────────────────────

/** Adjacent sizes a < b step by at most 4px while a ≤ 16, else by a ratio of
 * 1.1 to 2.5 (a house cap: 14→32 passes, 13→36 does not). */
const LADDER_SMALL = 16;
const LADDER_STEP = 4;
const LADDER_RATIO = { min: 1.1, max: 2.5 };
const PROSE_WORDS = 5;

/** The dense type ladder that replaces type-scale-ratio on desktop-app, plus
 * three floors: any text below the smallest size, prose (five words or
 * more) below the prose floor, and the body role below the dense body.
 * `rawById` holds the unresolved nodes, so a `$body` reference is visible;
 * `pinned` holds the typography token sizes (a pinned pair is not judged). */
export function checkTypeLadder(ctx: DesktopContext, rawById: Map<string, SceneNode>, pinned: Set<number>): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const rule = 'desktop-app-type-ladder';
  const { smallestText, proseFloor, bodyDense } = ctx.profile;
  const texts: SceneNode[] = [];
  (function walk(n: SceneNode) { if (textOf(n) !== undefined) texts.push(n); n.children?.forEach(walk); })(ctx.root);
  // A size the renderer can read (a number, "14px", a clamp()'s minimum).
  const px = (n: SceneNode) => fontPx(n.fontSize);
  const sizes = [...new Set(texts.map(px).filter(isNum))].sort((a, b) => a - b);
  for (let i = 0; i < sizes.length - 1; i++) {
    const [a, b] = [sizes[i], sizes[i + 1]];
    if (pinned.has(a) && pinned.has(b)) continue;
    if (a <= LADDER_SMALL && b - a <= LADDER_STEP) continue;
    const ratio = b / a;
    if (ratio >= LADDER_RATIO.min && ratio <= LADDER_RATIO.max) continue;
    const at = texts.find((n) => px(n) === b)!;
    issues.push(issue('typography', rule, 'warning', at,
      `Font sizes ${a}px → ${b}px step by ${ratio.toFixed(2)} — a dense app ladder steps by at most ${LADDER_STEP}px up to ${LADDER_SMALL}px, else by ${LADDER_RATIO.min}–${LADDER_RATIO.max}.`,
      ratio > LADDER_RATIO.max
        ? `Add an intermediate size between ${a}px and ${b}px, or bring ${b}px down — or declare the sizes as typography tokens to pin them.`
        : `Merge ${a}px and ${b}px into one size, or separate them further — or declare the sizes as typography tokens to pin them.`));
  }
  for (const n of texts) {
    const size = fontPx(n.fontSize);
    if (size === undefined) continue;
    const content = textOf(n)!;
    if (size < smallestText) {
      issues.push(issue('typography', rule, 'warning', n,
        `${quote(content)} is ${size}px — below the ${smallestText}px smallest text in a desktop app.`, `Raise it to at least ${smallestText}px.`));
    } else if (rawById.get(n.id)?.fontSize === '$body' && size < bodyDense) {
      issues.push(issue('typography', rule, 'warning', n,
        `${quote(content)} uses the body role at ${size}px — below the ${bodyDense}px body floor in a desktop app.`,
        `Raise $body to at least ${bodyDense}px (generate_design_system on a desktop-app canvas gives 14, or 13 for data-dense).`));
    } else if (size < proseFloor && proseWords(content) >= PROSE_WORDS) {
      issues.push(issue('typography', rule, 'warning', n,
        `${quote(content)} sets ${proseWords(content)} words at ${size}px — prose below ${proseFloor}px is hard to read.`,
        `Set prose at ${proseFloor}px or more; keep ${smallestText}px sizes for short labels.`));
    }
  }
  return issues;
}

// ── tables: rows, header, classes ──────────────────────────────────────────

/** The rows the table detector counted (an import-named Table keeps its
 * loose shape; otherwise horizontal frames with two or more children). */
function rowsOf(table: SceneNode): SceneNode[] {
  return (table.children ?? []).filter((c) => c.type === 'frame' && (c.children?.length ?? 0) >= 2
    && (table.name === 'Table' || c.layout === 'horizontal'));
}

/** The controls a header cell may hold beside its text (a select-all box). */
const CONTROLS = new Set(['checkbox', 'toggle', 'radio', 'select']);

/** The first text in a row, depth first. */
function firstTextIn(row: SceneNode): SceneNode | undefined {
  for (const c of row.children ?? []) {
    if (textOf(c) !== undefined) return c;
    const t = c.type === 'frame' ? firstTextIn(c) : undefined;
    if (t) return t;
  }
  return undefined;
}

/** A header row: its content is text, plus icons and controls (a sort glyph,
 * a select-all checkbox), at least two texts. A first row holding a control
 * reads the same as a row-select data row, so it is a header only when its
 * text is styled apart from the next row's (weight, size, colour, case or
 * tracking). */
function isHeaderRow(row: SceneNode, next?: SceneNode): boolean {
  let texts = 0;
  let controls = 0;
  let other = false;
  (function walk(n: SceneNode) {
    for (const c of n.children ?? []) {
      if (textOf(c) !== undefined) texts++;
      else if (c.type === 'frame') walk(c);
      else if (CONTROLS.has(c.type)) controls++;
      else if (c.type !== 'icon' && c.type !== 'text') other = true;
    }
  })(row);
  if (other || texts < 2) return false;
  if (controls === 0) return true;
  const [a, b] = [firstTextIn(row), next ? firstTextIn(next) : undefined];
  if (!a || !b) return false;
  return (['fontWeight', 'fontSize', 'color', 'textTransform', 'letterSpacing'] as const).some((k) => a[k] !== b[k]);
}

/** A row holding a title over a subtitle: some non-horizontal frame in it
 * stacks two or more texts. */
function isTwoLine(row: SceneNode): boolean {
  let found = false;
  (function walk(n: SceneNode) {
    for (const c of n.children ?? []) {
      if (c.type !== 'frame') continue;
      if (c.layout !== 'horizontal' && (c.children ?? []).filter((x) => textOf(x) !== undefined).length >= 2) found = true;
      walk(c);
    }
  })(row);
  return found;
}

/** The most frequent value (first seen wins a tie). */
function mode(values: number[]): number | undefined {
  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best: number | undefined;
  for (const [v, f] of freq) if (best === undefined || f > freq.get(best)!) best = v;
  return best;
}

// ── desktop-app-row-rhythm (FR-C6) ─────────────────────────────────────────

const ROW_TOLERANCE = 1;

/** Detected tables: a header row whose height differs from the one-line body
 * rows by more than 1px warns (Carbon); body rows that differ from their
 * class (one-line, or title over subtitle) by more than 1px are one info per
 * class; in detailed mode, a cell whose left edge is off its column by more
 * than 1px is one info per table. Fast mode reads authored heights only;
 * detailed mode reads rendered rects. */
export function checkRowRhythm(ctx: DesktopContext, tableIds: Set<string>): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const rule = 'desktop-app-row-rhythm';
  const heightOf = (n: SceneNode): number | undefined => {
    if (ctx.rects) return ctx.rects.get(n.id)?.height;
    return isNum(n.height) ? n.height : undefined;
  };
  (function walk(n: SceneNode) {
    if (!tableIds.has(n.id)) { n.children?.forEach(walk); return; }
    const rows = rowsOf(n);
    const header = rows.length > 0 && isHeaderRow(rows[0], rows[1]) ? rows[0] : undefined;
    const body = header ? rows.slice(1) : rows;
    const classes = [body.filter((r) => !isTwoLine(r)), body.filter(isTwoLine)];
    const oneLine = classes[0].map(heightOf).filter(isNum);
    const bodyH = mode(oneLine);
    const headerH = header ? heightOf(header) : undefined;
    if (header && headerH !== undefined && bodyH !== undefined && Math.abs(headerH - bodyH) > ROW_TOLERANCE) {
      issues.push(issue('consistency', rule, 'warning', header,
        `Table "${nameOf(n)}": the header row is ${headerH}px tall over ${bodyH}px body rows — a table's header row matches its row height (Carbon).`,
        `Make the header row ${bodyH}px tall (the data-table-app scaffold carries the rule).`));
    }
    for (const cls of classes) {
      const known = cls.filter((r) => heightOf(r) !== undefined);
      const ref = mode(known.map((r) => heightOf(r)!));
      const odd = known.filter((r) => Math.abs(heightOf(r)! - ref!) > ROW_TOLERANCE);
      if (ref === undefined || odd.length === 0) continue;
      issues.push(issue('consistency', rule, 'info', odd[0],
        `Table "${nameOf(n)}": ${odd.length} body row${odd.length === 1 ? ' is' : 's are'} not ${ref}px like ${odd.length === 1 ? 'its' : 'their'} siblings (${odd.map((r) => `"${nameOf(r)}" ${heightOf(r)}px`).slice(0, 5).join(', ')}).`,
        'Give every body row the same height; a row with a title over a subtitle is compared only with rows like it.'));
    }
    if (ctx.rects) {
      const width = mode(rows.map((r) => r.children!.length))!;
      const aligned = rows.filter((r) => r.children!.length === width);
      for (let col = 0; col < width; col++) {
        const cells = aligned.map((r) => r.children![col]).filter((c) => ctx.rects!.has(c.id));
        const ref = mode(cells.map((c) => ctx.rects!.get(c.id)!.x));
        const off = cells.find((c) => Math.abs(ctx.rects!.get(c.id)!.x - ref!) > ROW_TOLERANCE);
        if (ref === undefined || !off) continue;
        issues.push(issue('consistency', rule, 'info', off,
          `Table "${nameOf(n)}": column ${col + 1} does not share one left edge — "${nameOf(off)}" starts ${Math.abs(ctx.rects!.get(off.id)!.x - ref)}px off the column.`,
          'Give every row the same column widths (percentages or fixed widths) so cells line up.'));
        break; // one per table
      }
    }
    // A detected table consumes its subtree.
  })(ctx.root);
  return issues;
}

// ── desktop-app-truncation (FR-C7) ─────────────────────────────────────────

/** Fewer visible characters than this before the ellipsis reads as no text. */
const MIN_VISIBLE_CHARS = 4;

/** The characters left visible by an ellipsis (the ellipsis itself takes
 * about one character's width). */
function visibleChars(chars: number, scrollWidth: number, clientWidth: number): number {
  if (scrollWidth <= 0) return chars;
  return Math.max(0, Math.floor((chars * clientWidth) / scrollWidth) - 1);
}

const overflows = (sw: number | undefined, cw: number | undefined) => isNum(sw) && isNum(cw) && sw > cw + 1;

/** A table header text that truncates warns (a column header is never cut);
 * a hand-built text with an ellipsis and no title is an info (the full text
 * must be reachable; primitives add their own title). Detailed mode adds:
 * a tablist whose every label is cut warns; an ellipsis (text or primitive
 * label) leaving fewer than 4 characters is an info. */
export function checkTruncation(ctx: DesktopContext, tableIds: Set<string>): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const rule = 'desktop-app-truncation';
  const headerTexts = new Set<SceneNode>();
  (function findHeaders(n: SceneNode) {
    if (tableIds.has(n.id)) {
      const [first, second] = rowsOf(n);
      if (first && isHeaderRow(first, second)) (function walk(x: SceneNode) { if (x.type === 'text') headerTexts.add(x); x.children?.forEach(walk); })(first);
      return;
    }
    n.children?.forEach(findHeaders);
  })(ctx.root);
  (function walk(n: SceneNode) {
    const content = textOf(n);
    if (content !== undefined && n.textOverflow === 'ellipsis') {
      if (headerTexts.has(n)) {
        issues.push(issue('usability', rule, 'warning', n,
          `Column header ${quote(content)} is set to truncate — a header names its column and is never cut (PatternFly, EUI).`,
          'Remove textOverflow from the header; widen the column, shorten the header, or let it wrap.'));
      } else if (!hasText(n.title)) {
        issues.push(issue('usability', rule, 'info', n,
          `${quote(content)} truncates with an ellipsis but has no title — the full text cannot be read anywhere.`,
          'Give it its full text as a title (U(id, { title: "…" })); a title renders as a tooltip.'));
      }
    }
    const rect = ctx.rects?.get(n.id);
    if (rect && content !== undefined && rect.ellipsis && overflows(rect.scrollWidth, rect.clientWidth)) {
      const visible = visibleChars(content.length, rect.scrollWidth!, rect.clientWidth!);
      if (visible < MIN_VISIBLE_CHARS) {
        issues.push(issue('usability', rule, 'info', n,
          `${quote(content)} truncates to about ${visible} visible character${visible === 1 ? '' : 's'} — too few to recognise.`,
          'Give it more room, or a shorter label.'));
      }
    }
    if (rect?.labels?.length) {
      const cut = rect.labels.filter((l) => overflows(l.scrollWidth, l.clientWidth));
      if (n.type === 'tabs' && cut.length === rect.labels.length) {
        issues.push(issue('usability', rule, 'warning', n,
          `Every tab label in "${nameOf(n)}" is truncated (${rect.labels.length} tabs in ${rect.width}px) — nobody can read the navigation.`,
          'Widen the tablist, shorten the labels, or move some tabs into a menu.'));
      } else {
        const short = cut.filter((l) => visibleChars(l.chars, l.scrollWidth, l.clientWidth) < MIN_VISIBLE_CHARS);
        if (short.length > 0) {
          issues.push(issue('usability', rule, 'info', n,
            `${n.type} "${nameOf(n)}": ${short.length} label${short.length === 1 ? '' : 's'} truncate${short.length === 1 ? 's' : ''} to fewer than ${MIN_VISIBLE_CHARS} visible characters — too few to recognise.`,
            'Give it more room, or a shorter label.'));
        }
      }
    }
    n.children?.forEach(walk);
  })(ctx.root);
  return issues;
}

// ── desktop-app-primary-count (FR-C8) ──────────────────────────────────────

/** A button renders filled with the accent (primary) unless its variant is
 * secondary, ghost or destructive (renderButton). */
const NOT_PRIMARY = new Set(['secondary', 'ghost', 'destructive']);
const isPrimary = (n: SceneNode) => n.type === 'button' && !(typeof n.variant === 'string' && NOT_PRIMARY.has(n.variant));
/** Repeated siblings of one shape (a grid of cards) hold their own primaries. */
const REPEAT_MIN = 3;

/** More than one primary button in one region (the nearest pane) is an info.
 * A primary inside one of three or more same-shaped sibling frames (shape
 * hash without names) is not counted. A modal's primary action joins with the
 * overlays (slice E). */
export function checkPrimaryCount(ctx: DesktopContext): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const parentOf = parents(ctx.root);
  const hashes = new Map<SceneNode, string>();
  // Names are left out: a card grid's copies are often renamed per item.
  const hash = (n: SceneNode) => { if (!hashes.has(n)) hashes.set(n, shapeHash(n, 3, { names: false })); return hashes.get(n)!; };
  const repeated = (n: SceneNode): boolean => {
    for (let cur: SceneNode | null = n, up = parentOf.get(n) ?? null; cur && up; cur = up, up = parentOf.get(up) ?? null) {
      if (cur.type !== 'frame') continue;
      const same = (up.children ?? []).filter((s) => s.type === 'frame' && hash(s) === hash(cur!)).length;
      if (same >= REPEAT_MIN) return true;
    }
    return false;
  };
  const byPane = new Map<SceneNode, SceneNode[]>();
  for (const n of parentOf.keys()) {
    if (!isPrimary(n) || n.disabled === true || repeated(n)) continue;
    const pane = paneOf(n, parentOf);
    byPane.set(pane, [...(byPane.get(pane) ?? []), n]);
  }
  for (const [pane, buttons] of byPane) {
    if (buttons.length < 2) continue;
    issues.push(issue('structure', 'desktop-app-primary-count', 'info', buttons[1],
      `${buttons.length} primary buttons share ${pane === ctx.root ? 'the screen' : `pane "${nameOf(pane)}"`} (${buttons.map((b) => `"${b.label ?? b.ariaLabel ?? nameOf(b)}"`).slice(0, 5).join(', ')}) — one primary per region tells the user what to do next.`,
      'Keep one primary; make the others variant "secondary" or "ghost". A button with no variant renders as primary.'));
  }
  return issues;
}
