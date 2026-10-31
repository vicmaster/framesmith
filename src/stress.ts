// Phase 24 slice D (#spec FR-D1/D2) — content stress testing. A design that's
// beautiful with ideal data clips with "Dr. Alexandria Konstantinopoulos-
// Whitfield", wraps ugly in German, and blows the badge at "999+". Nothing
// renders those cases until the shipped app does — so framesmith renders them
// first: named perturbations transform a tree copy, the result renders through
// the normal pipeline, and layout comparison reports exactly what broke.
//
// Pure by design: perturbations and compareLayouts are fixture-testable with
// no Chrome; the tool handler owns rendering. Table discovery reuses the drift
// inventory — drift, coverage, and stress share one vocabulary for "a table".

import type { SceneNode } from './types.js';
import type { LayoutRect } from './screenshot.js';
import type { SurfaceType } from './surfaces.js';
import { extractInventory, isDataLike } from './drift.js';

export type PerturbationName = 'long-text' | 'i18n' | 'big-numbers' | 'empty' | 'many';
export const PERTURBATION_NAMES: PerturbationName[] = ['long-text', 'i18n', 'big-numbers', 'empty', 'many'];

export interface PerturbationResult {
  root: SceneNode;
  /** Node ids whose CONTENT the perturbation changed (their growth is
   * expected; compareLayouts exempts them and their ancestors from
   * layout-shift findings). */
  touched: string[];
}

export interface StressFinding {
  kind: 'clip' | 'overflow-x' | 'layout-shift';
  /** info = designed truncation (ellipsis) doing its job under pressure. */
  severity: 'warning' | 'info';
  nodeId: string;
  detail: string;
}

/** A long unbroken token — the classic wrap-breaker (German compound). */
const LONG_TOKEN = 'Rindfleischetikettierungsüberwachung';

/** Phase 30 slice C — the text props of primitives that carry their own copy,
 * as paths into the node (`[]` walks an array). `fixed` marks a fixed
 * vocabulary (tab and nav action labels): on mobile, long-text leaves it alone
 * while i18n still perturbs it, since those labels really are localised. Read
 * generically, so a new primitive is one row. */
export const PRIMITIVE_TEXT_PROPS: { type: string; path: string; fixed?: boolean }[] = [
  { type: 'button', path: 'label' },
  { type: 'list-row', path: 'title' },
  { type: 'list-row', path: 'subtitle' },
  { type: 'list-row', path: 'trailing.text' },
  { type: 'tab-bar', path: 'items[].label', fixed: true },
  { type: 'nav-bar', path: 'title' },
  { type: 'nav-bar', path: 'leading.label', fixed: true },
  { type: 'nav-bar', path: 'trailing[].label', fixed: true },
];

/** One perturbable string: a text node's content or a primitive's prop. */
interface TextSlot {
  node: SceneNode;
  value: string;
  fixed: boolean;
  set: (value: string) => void;
}

/** Every non-blank string at `path` under `obj` (`a.b`, `items[].label`). */
function propSlots(obj: unknown, path: string[], out: Array<{ value: string; set: (v: string) => void }>): void {
  if (!obj || typeof obj !== 'object' || path.length === 0) return;
  const [head, ...rest] = path;
  const isArray = head.endsWith('[]');
  const key = isArray ? head.slice(0, -2) : head;
  const record = obj as Record<string, unknown>;
  const value = record[key];
  if (isArray) {
    if (Array.isArray(value)) value.forEach((item) => propSlots(item, rest, out));
    return;
  }
  if (rest.length > 0) { propSlots(value, rest, out); return; }
  if (typeof value === 'string' && value.trim()) out.push({ value, set: (v) => { record[key] = v; } });
}

function walkTexts(root: SceneNode, visit: (slot: TextSlot) => void): void {
  if (root.type === 'text' && typeof root.content === 'string' && root.content.trim()) {
    visit({ node: root, value: root.content, fixed: false, set: (v) => { root.content = v; } });
  }
  for (const prop of PRIMITIVE_TEXT_PROPS) {
    if (prop.type !== root.type) continue;
    const found: Array<{ value: string; set: (v: string) => void }> = [];
    propSlots(root, prop.path.split('.'), found);
    for (const f of found) visit({ node: root, value: f.value, fixed: prop.fixed === true, set: f.set });
  }
  root.children?.forEach((c) => walkTexts(c, visit));
}

/** Runs of two or more consecutive sibling `list-row`s — a list, for the
 * empty and many perturbations. Lives here, not in the drift inventory, which
 * coverage, typography and drift share and which must not change. */
function listRuns(root: SceneNode): Array<{ container: SceneNode; start: number; length: number }> {
  const runs: Array<{ container: SceneNode; start: number; length: number }> = [];
  (function walk(n: SceneNode) {
    const kids = n.children ?? [];
    for (let i = 0; i < kids.length;) {
      let j = i;
      while (j < kids.length && (kids[j].type as string) === 'list-row') j++; // slice D adds the node type
      if (j - i >= 2) runs.push({ container: n, start: i, length: j - i });
      i = j > i ? j : i + 1;
    }
    kids.forEach(walk);
  })(root);
  return runs;
}

/** Repeat `base` (space-joined) until it reaches `factor` × its own length. */
function stretch(base: string, factor: number): string {
  const target = Math.ceil(base.length * factor);
  let out = base;
  while (out.length < target) out += ` ${base}`;
  return out;
}

/** Widest realistic form of a data-like string; null = leave untouched. */
export function widenNumber(s: string): string | null {
  const t = s.trim();
  if (/%/.test(t)) return '+123.45%';
  if (/^\$/.test(t)) return '$1,520,847.33';
  if (/^\d+\+?$/.test(t)) return '999+';
  if (/^[\d,.]+\s?[KMB]$/i.test(t)) return '1,520,847.33';
  return null;
}

/** Candidate data rows of a table container — same shape detectTable counts. */
function tableRows(container: SceneNode): SceneNode[] {
  return (container.children ?? []).filter((c) => c.type === 'frame' && (c.children?.length ?? 0) >= 2);
}

function cloneWithSuffix(node: SceneNode, suffix: string): SceneNode {
  const clone: SceneNode = { ...node, id: `${node.id}${suffix}` };
  if (node.children) clone.children = node.children.map((c) => cloneWithSuffix(c, suffix));
  return clone;
}

/** Apply one named perturbation to a COPY of the tree. A perturbation that
 * finds nothing to touch returns touched: [] — the caller skips rendering it.
 * On a `mobile` canvas long-text leaves alone strings of three characters or
 * fewer (monograms, short labels) and fixed-vocabulary primitive labels. */
export function applyPerturbation(name: PerturbationName, root: SceneNode, opts: { type?: SurfaceType } = {}): PerturbationResult {
  const clone = structuredClone(root);
  const touched: string[] = [];
  const touch = (id: string) => { if (!touched.includes(id)) touched.push(id); };
  const mobile = opts.type === 'mobile';

  if (name === 'long-text' || name === 'i18n') {
    walkTexts(clone, (slot) => {
      if (isDataLike(slot.value)) return; // live figures get big-numbers instead
      if (name === 'long-text') {
        if (mobile && (slot.fixed || slot.value.trim().length <= 3)) return;
        slot.set(`${stretch(slot.value, 2.2)} ${LONG_TOKEN}`);
      } else {
        // ~1.4× — the German/Finnish expansion rule, no unbroken token.
        slot.set(stretch(slot.value, 1.4));
      }
      touch(slot.node.id);
    });
    return { root: clone, touched };
  }

  if (name === 'big-numbers') {
    walkTexts(clone, (slot) => {
      if (!isDataLike(slot.value)) return;
      const widened = widenNumber(slot.value);
      if (widened === null || widened === slot.value) return;
      slot.set(widened);
      touch(slot.node.id);
    });
    return { root: clone, touched };
  }

  // empty / many — operate on detected tables (drift inventory vocabulary).
  const tables = extractInventory(clone).tables;
  for (const t of tables) {
    const container = findById(clone, t.nodeId);
    if (!container?.children) continue;
    const rows = tableRows(container);
    if (rows.length < 2) continue; // header only — nothing to remove/multiply
    if (name === 'empty') {
      // Keep the header (first candidate row), drop the data rows.
      const drop = new Set(rows.slice(1).map((r) => r.id));
      container.children = container.children.filter((c) => !drop.has(c.id));
    } else {
      // many — the data-row set ×3 (two suffixed copies appended).
      const dataRows = rows.slice(1);
      for (let i = 1; i <= 2; i++) container.children.push(...dataRows.map((r) => cloneWithSuffix(r, `-x${i}`)));
    }
    touched.push(container.id);
  }
  // Runs of list-rows, last run first so earlier indices stay valid.
  for (const run of listRuns(clone).reverse()) {
    const kids = run.container.children!;
    const rows = kids.slice(run.start, run.start + run.length);
    if (name === 'empty') kids.splice(run.start, run.length);
    else kids.splice(run.start + run.length, 0, ...[1, 2].flatMap((i) => rows.map((r) => cloneWithSuffix(r, `-x${i}`))));
    touch(run.container.id);
  }
  return { root: clone, touched };
}

function findById(root: SceneNode, id: string): SceneNode | null {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return null;
}

// ── layout comparison ───────────────────────────────────────────────────────

interface FlatRect extends LayoutRect {
  parentId?: string;
}

function flatten(rects: LayoutRect[]): Map<string, FlatRect> {
  const out = new Map<string, FlatRect>();
  function walk(r: LayoutRect, parentId?: string): void {
    out.set(r.nodeId, { ...r, parentId });
    r.children?.forEach((c) => walk(c, r.nodeId));
  }
  rects.forEach((r) => walk(r));
  return out;
}

const TOLERANCE = 1.5;
const FINDING_CAP = 20;

/** Compare a perturbed layout against the baseline. Only NEW breakage counts:
 * a clip or overflow already present at baseline is the design's standing
 * state, not something this perturbation caused. Nodes the perturbation
 * touched — and their ancestors, which legitimately grow to contain them —
 * are exempt from layout-shift. */
export function compareLayouts(
  baseline: LayoutRect[],
  perturbed: LayoutRect[],
  touched: string[],
  canvasWidth: number,
): StressFinding[] {
  const base = flatten(baseline);
  const pert = flatten(perturbed);
  const findings: StressFinding[] = [];

  // touched + every ancestor in the perturbed tree (id suffixes from `many`
  // resolve to their source rows via prefix match).
  const exempt = new Set<string>();
  for (const id of touched) {
    let cur: FlatRect | undefined = pert.get(id);
    while (cur) {
      exempt.add(cur.nodeId);
      cur = cur.parentId ? pert.get(cur.parentId) : undefined;
    }
  }

  const clips = (r: FlatRect): boolean =>
    (r.scrollWidth !== undefined && r.clientWidth !== undefined && r.scrollWidth > r.clientWidth + 1) ||
    (r.scrollHeight !== undefined && r.clientHeight !== undefined && r.scrollHeight > r.clientHeight + 1);

  for (const [id, r] of pert) {
    if (findings.length >= FINDING_CAP) break;
    const b = base.get(id);

    // clip — content cut off that wasn't cut off at baseline.
    if (clips(r) && !(b && clips(b as FlatRect))) {
      // Report the axis that actually overflows (vertical clip on a fixed-
      // height box is the common wrap case).
      const vertical = r.scrollHeight !== undefined && r.clientHeight !== undefined && r.scrollHeight > r.clientHeight + 1;
      const scroll = vertical ? r.scrollHeight : r.scrollWidth;
      const box = vertical ? r.clientHeight : r.clientWidth;
      // The page outgrowing its fixed artboard vertically is scrolling, not
      // breakage — every dashboard on a fixed-height artboard would otherwise
      // fail `many` by construction. Horizontal root clip stays a warning.
      const rootGrowsTaller = vertical && !r.parentId;
      findings.push({
        kind: 'clip',
        severity: r.ellipsis || rootGrowsTaller ? 'info' : 'warning',
        nodeId: id,
        detail: r.ellipsis
          ? `Content truncates with its designed ellipsis under this content (${vertical ? 'height' : 'width'} ${scroll}px vs box ${box}px).`
          : rootGrowsTaller
            ? `The page grows taller than the fixed artboard (${scroll}px vs ${box}px) — a real page scrolls here; raise the artboard height if you want the full content reviewable.`
            : `Content is cut off (${vertical ? 'height' : 'width'} ${scroll}px vs box ${box}px) with no designed truncation.`,
      });
      continue;
    }

    // overflow-x — escapes the parent box or the canvas, newly.
    const parent = r.parentId ? pert.get(r.parentId) : undefined;
    const bParent = b?.parentId ? base.get(b.parentId) : undefined;
    const escapesParent = parent ? r.x + r.width > parent.x + parent.width + TOLERANCE || r.x < parent.x - TOLERANCE : false;
    const escapedAtBase = b && bParent ? b.x + b.width > bParent.x + bParent.width + TOLERANCE || b.x < bParent.x - TOLERANCE : false;
    const escapesCanvas = r.x + r.width > canvasWidth + TOLERANCE;
    const escapedCanvasAtBase = b ? b.x + b.width > canvasWidth + TOLERANCE : false;
    if ((escapesParent && !escapedAtBase) || (escapesCanvas && !escapedCanvasAtBase)) {
      findings.push({
        kind: 'overflow-x',
        severity: 'warning',
        nodeId: id,
        detail: escapesCanvas
          ? `Node extends past the canvas width (${r.x + r.width}px vs ${canvasWidth}px).`
          : `Node escapes its parent's box (right edge ${r.x + r.width}px vs parent ${parent!.x + parent!.width}px).`,
      });
      continue;
    }

    // layout-shift — an untouched node ballooning is collateral damage.
    if (b && b.height >= 8 && r.height > b.height * 2 && !exempt.has(id)) {
      // A stretch-sibling is not ballooning: when its parent legitimately grew
      // (ancestor of a touched node) and this node's height merely followed
      // that growth with no width change, it is align-stretch doing its job —
      // the full-height sidebar next to a growing content column.
      const parentGrowth = parent && bParent ? parent.height - bParent.height : 0;
      const stretchFollow = parent !== undefined && exempt.has(parent.nodeId)
        && Math.abs(r.width - b.width) <= TOLERANCE
        && r.height - b.height <= parentGrowth + TOLERANCE;
      if (!stretchFollow) {
        findings.push({
          kind: 'layout-shift',
          severity: 'warning',
          nodeId: id,
          detail: `Node height grew ${b.height}px → ${r.height}px under content it doesn't contain — check wrapping/min-height.`,
        });
      }
    }
  }

  return findings;
}

/** The last canvas_stress verdict per canvas, kept for canvas_evaluate's
 * directive so "READY TO PRESENT" can't contradict a FRAGILE stress run. In
 * memory only: one server process. */
export interface StressRecord {
  versionHash: string;
  warnings: number;
  /** The canvas type the run used (Phase 30): a type change makes the
   * record stale for the directive's note, never for the verdict. */
  type: SurfaceType;
}

const lastStressRuns = new Map<string, StressRecord>();

/** A FRAGILE run always counts; only a full run can record CLEAN, so a
 * narrower re-run that happens to pass never hides a known break. */
export function recordStressRun(canvasId: string, record: StressRecord, fullRun: boolean): void {
  if (record.warnings === 0 && !fullRun) return;
  lastStressRuns.set(canvasId, record);
}

export function lastStressRun(canvasId: string): StressRecord | undefined {
  return lastStressRuns.get(canvasId);
}
