// Phase 23 slice B (#148) — structural drift between a canvas (the design of
// record) and the shipped view. canvas_sync_from_url answers "how much does it
// LOOK different" (a pixel percentage); this module answers "WHAT diverged":
// a control the canvas shows that was never built, a column the page dropped,
// a radiogroup the implementation shipped as a select.
//
// Coarse by design (spec C4): the engine compares normalized INVENTORIES —
// text runs, controls (with nearest-label anchoring), table shapes — never
// styles, geometry, or nesting depth, because those are exactly what the
// import pipeline normalizes away. Pure and fixture-testable without Chrome;
// the caller supplies both trees (the canvas side instance-expanded via
// expandInstances, the page side from an ephemeral importUrl).

import type { Canvas, SceneNode } from './types.js';
import { resolveInstance } from './renderer.js';

export type DriftFindingKind = 'missing-in-page' | 'missing-in-canvas' | 'control-mismatch' | 'table-mismatch';

export interface DriftFinding {
  kind: DriftFindingKind;
  /** error/warning = structural drift (blocks inSync); info = context only
   * (row counts, live-data text the canvas's placeholder copy can't match). */
  severity: 'error' | 'warning' | 'info';
  /** The canvas node the finding anchors to, when there is one. */
  canvasNodeId?: string;
  detail: string;
}

export interface InventoryCounts {
  texts: number;
  controls: number;
  tables: number;
  icons: number;
  images: number;
  charts: number;
}

export interface DriftResult {
  /** True when no error/warning finding exists — info findings alone (row
   * counts, unmatched live data) do not count as drift. */
  inSync: boolean;
  findings: DriftFinding[];
  counts: { canvas: InventoryCounts; page: InventoryCounts; unmatchedPageTexts: number; dataLikeSkipped: number };
}

// ── inventory ───────────────────────────────────────────────────────────────

type ControlKind = 'toggle' | 'checkbox' | 'radio-group' | 'select';

interface ControlEntry {
  nodeId: string;
  kind: ControlKind;
  /** radio-group only — how many radios the group holds. */
  options?: number;
  /** Nearest label text (normalized) — the anchor for cross-tree matching. */
  label: string;
}

interface TableEntry {
  nodeId: string;
  name: string;
  columnCount: number;
  /** First row's cell texts, trimmed (display form; compare normalized). */
  headers: string[];
  rowCount: number;
}

interface TextEntry {
  nodeId: string;
  /** Trimmed original — for readable finding details. */
  display: string;
  /** normalize()d form — the matching key. */
  text: string;
}

export interface Inventory {
  texts: TextEntry[];
  controls: ControlEntry[];
  tables: TableEntry[];
  counts: InventoryCounts;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Mostly-numeric strings (money, percentages, dates, counts) are DATA, not
 * structure — live figures won't match placeholder copy and that isn't drift. */
export function isDataLike(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (!/\d/.test(t)) return false;
  // Digits plus data punctuation/currency/units only — no words longer than
  // 3 letters (keeps "$1.52M", "Q3 2026", "12 Jan", "+4.2% MoM" data-like
  // while "Revenue 2026" stays structural).
  return !/[a-zA-Z]{4,}/.test(t) || /^\d[\d\s.,:%/+-]*$/.test(t);
}

const CONTROL_TYPES = new Set(['toggle', 'checkbox', 'radio', 'select']);

/** A frame reads as a table when ≥2 of its children are same-shaped rows
 * (frames with the same ≥2 child count). Import gives tables named
 * Table/Row/Cell frames (Phase 18); hand-built and data-table-structure
 * tables match the generic shape. Divider hairlines (childless frames)
 * are ignored when counting rows. */
function detectTable(node: SceneNode): { columnCount: number; headers: string[]; rowCount: number } | null {
  if (node.type !== 'frame' || !node.children || node.children.length < 2) return null;
  // Phase 26 slice A — a grid container is a COMPOSITION, never a table:
  // bento tiles with inner structure would otherwise pattern-match as
  // rows-of-cells (drift/coverage/stress all share this detector).
  if (node.layout === 'grid') return null;
  // A table ROW is horizontal by nature — cells sit beside each other. A
  // vertical child is a section/group, and a stack of those (a settings
  // column, a sidebar) must never read as a table (Phase 27 dogfood: the
  // sidebar and the sectioned settings column both false-positived here).
  // Import-named Tables keep the trusted loose shape.
  const named0 = node.name === 'Table';
  const rows = node.children.filter((c) => c.type === 'frame' && (c.children?.length ?? 0) >= 2
    && (named0 || c.layout === 'horizontal'));
  // Phase 28 — two stacked rows (a topbar over a greeting) is a LAYOUT; an
  // unnamed table needs three matching rows before it reads as data. The
  // rare real header-plus-one-row table loses detection — accepted trade,
  // recorded in the drift docs. Import-named Tables keep the loose shape.
  if (rows.length < (named0 ? 2 : 3)) return null;
  // Phase 31 FR-A5 — a list whose every row LEADS with a mark (an icon, a
  // dot, a small image) is navigation, not data: a sidebar of projects with
  // an identity dot, a name and a count. A table with a text header row never
  // matches, since its header row leads with text.
  if (!named0 && rows.every((r) => isLeadingMark(r.children![0]))) return null;
  const named = named0;
  // Modal cell count across candidate rows; require it to dominate unless the
  // frame is an import-named Table (trusted shape).
  const countFreq = new Map<number, number>();
  for (const r of rows) {
    const n = r.children!.length;
    countFreq.set(n, (countFreq.get(n) ?? 0) + 1);
  }
  const [modalCount, modalFreq] = [...countFreq.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!named && (modalFreq < rows.length * 2 / 3 || modalCount < 2)) return null;
  const headerRow = rows[0];
  const headers = headerRow.children!.map((cell) => firstText(cell)).filter((t): t is string => !!t);
  // A table without ANY header text is just a stack of same-shaped cards —
  // only claim table when the first row reads as a header (unless import-named).
  if (!named && headers.length < 2) return null;
  return { columnCount: modalCount, headers: headers.map((h) => h.trim()), rowCount: rows.length };
}

/** An icon, a dot (an ellipse, or a childless frame or rectangle whose known
 * dimensions are all 12px or less — import can drop one of them), or an image
 * of 24px or less. */
function isLeadingMark(node: SceneNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'icon' || node.type === 'ellipse') return true;
  const dims = [node.width, node.height].filter((d): d is number => typeof d === 'number');
  if ((node.type === 'frame' || node.type === 'rectangle') && !(node.children?.length)) {
    return dims.length > 0 && dims.every((d) => d <= 12);
  }
  if (node.type === 'image') return dims.length > 0 && dims.every((d) => d <= 24);
  return false;
}

function firstText(node: SceneNode): string | null {
  if (node.type === 'text' && typeof node.content === 'string' && node.content.trim()) return node.content;
  for (const c of node.children ?? []) {
    const t = firstText(c);
    if (t) return t;
  }
  return null;
}

/** Nearest label for a control: the closest preceding text sibling, else the
 * parent's first text descendant outside the control, else ''. Coarse on
 * purpose — it only anchors matching across trees. */
function nearestLabel(parent: SceneNode | null, index: number): string {
  if (!parent?.children) return '';
  for (let i = index - 1; i >= 0; i--) {
    const sib = parent.children[i];
    if (sib.type === 'text' && typeof sib.content === 'string' && sib.content.trim()) return normalize(sib.content);
    const t = firstText(sib);
    if (t) return normalize(t);
  }
  const t = firstText(parent);
  return t ? normalize(t) : '';
}

/** Walk a tree into the comparable inventory. Table SUBTREES are consumed by
 * their TableEntry — cell data and per-row controls are the data plane, not
 * structure, so they never leak into the text/control lists. */
export function extractInventory(root: SceneNode): Inventory {
  const inv: Inventory = {
    texts: [],
    controls: [],
    tables: [],
    counts: { texts: 0, controls: 0, tables: 0, icons: 0, images: 0, charts: 0 },
  };

  // Radios group by their nearest ancestor holding ≥2 radios, so both flat
  // (radio, radio, radio) and wrapped (row[radio+label] × 3) layouts read as
  // ONE control. A lone radio groups at its parent.
  const radioCounts = new Map<SceneNode, number>();
  (function countRadios(node: SceneNode): number {
    let n = node.type === 'radio' ? 1 : 0;
    for (const c of node.children ?? []) n += countRadios(c);
    radioCounts.set(node, n);
    return n;
  })(root);
  const radioGroups = new Map<SceneNode, ControlEntry>();

  function walk(node: SceneNode, parent: SceneNode | null, index: number, ancestors: SceneNode[]): void {
    const table = detectTable(node);
    if (table) {
      inv.tables.push({ nodeId: node.id, name: node.name ?? 'table', ...table });
      inv.counts.tables++;
      return; // the table entry consumes the subtree
    }
    if (node.type === 'text') {
      const content = typeof node.content === 'string' ? node.content : '';
      if (content.trim()) {
        inv.texts.push({ nodeId: node.id, display: content.trim(), text: normalize(content) });
        inv.counts.texts++;
      }
      return;
    }
    if (CONTROL_TYPES.has(node.type)) {
      if (node.type === 'radio') {
        // "canvas has a radio group; page has a select" is the incident shape.
        const container = [...ancestors].reverse().find((a) => (radioCounts.get(a) ?? 0) >= 2) ?? parent ?? node;
        const group = radioGroups.get(container);
        if (group) {
          group.options = (group.options ?? 1) + 1;
          return;
        }
        // Label the GROUP with the field label: the container's preceding
        // text sibling when the radios are wrapped in rows; the radio's own
        // preceding sibling in flat layouts; and when the container holds
        // nothing but radios, look one level up from the container.
        const ci = ancestors.indexOf(container);
        const containerParent = ci > 0 ? ancestors[ci - 1] : null;
        const containerLabel = containerParent
          ? nearestLabel(containerParent, containerParent.children?.indexOf(container) ?? 0)
          : '';
        const label = (container !== parent ? containerLabel : '') || nearestLabel(parent, index) || containerLabel;
        const entry: ControlEntry = { nodeId: node.id, kind: 'radio-group', options: 1, label };
        radioGroups.set(container, entry);
        inv.controls.push(entry);
      } else {
        inv.controls.push({ nodeId: node.id, kind: node.type as ControlKind, label: nearestLabel(parent, index) });
      }
      inv.counts.controls++;
      return;
    }
    if (node.type === 'icon') { inv.counts.icons++; return; }
    if (node.type === 'image') { inv.counts.images++; return; }
    if (node.type === 'chart') { inv.counts.charts++; return; }
    node.children?.forEach((c, i) => walk(c, node, i, [...ancestors, node]));
  }

  walk(root, null, 0, []);
  return inv;
}

/** Expand instance nodes against the canvas's component registry so the
 * inventory sees through stamped components (app shells). Unknown componentIds
 * pass through unexpanded. */
export function expandInstances(root: SceneNode, canvas: Canvas): SceneNode {
  const clone = structuredClone(root);
  function walk(node: SceneNode): SceneNode {
    if (node.type === 'instance' && node.componentId) {
      const resolved = resolveInstance(node, canvas);
      if (resolved) return walk(resolved);
    }
    if (node.children) node.children = node.children.map(walk);
    return node;
  }
  return walk(clone);
}

// ── comparison ──────────────────────────────────────────────────────────────

const controlNoun = (c: ControlEntry): string =>
  c.kind === 'radio-group' ? `radio group (${c.options ?? 1} option${(c.options ?? 1) === 1 ? '' : 's'})` : c.kind;

/** Per-string missing-text findings are capped; the tail collapses into one
 * summary so a fully rewritten page doesn't return 200 findings. */
const TEXT_FINDING_CAP = 20;

export function computeStructuralDrift(canvasRoot: SceneNode, pageRoot: SceneNode): DriftResult {
  const canvas = extractInventory(canvasRoot);
  const page = extractInventory(pageRoot);
  const findings: DriftFinding[] = [];

  // ── tables: match by header overlap, then order ──
  const pageTablesLeft = [...page.tables];
  for (const ct of canvas.tables) {
    let best: TableEntry | null = null;
    let bestOverlap = 0;
    for (const pt of pageTablesLeft) {
      const ch = new Set(ct.headers.map(normalize));
      const overlap = pt.headers.filter((h) => ch.has(normalize(h))).length;
      if (overlap > bestOverlap) { best = pt; bestOverlap = overlap; }
    }
    const match = best ?? pageTablesLeft[0] ?? null;
    if (!match) {
      findings.push({
        kind: 'missing-in-page', severity: 'error', canvasNodeId: ct.nodeId,
        detail: `The canvas has a table (${ct.columnCount} columns: ${ct.headers.join(', ') || 'unlabeled'}) that the page does not have.`,
      });
      continue;
    }
    pageTablesLeft.splice(pageTablesLeft.indexOf(match), 1);
    const cH = ct.headers.map(normalize);
    const pH = match.headers.map(normalize);
    const missing = ct.headers.filter((h) => !pH.includes(normalize(h)));
    const extra = match.headers.filter((h) => !cH.includes(normalize(h)));
    if (missing.length || extra.length) {
      findings.push({
        kind: 'table-mismatch', severity: 'error', canvasNodeId: ct.nodeId,
        detail: `Table columns diverge: ${missing.length ? `the canvas has [${missing.join(', ')}] the page lacks` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `the page has [${extra.join(', ')}] the canvas lacks` : ''}.`,
      });
    } else if (ct.columnCount !== match.columnCount) {
      findings.push({
        kind: 'table-mismatch', severity: 'error', canvasNodeId: ct.nodeId,
        detail: `Table has ${ct.columnCount} columns in the canvas but ${match.columnCount} on the page.`,
      });
    }
    if (ct.rowCount !== match.rowCount) {
      findings.push({
        kind: 'table-mismatch', severity: 'info', canvasNodeId: ct.nodeId,
        detail: `Row counts differ (canvas ${ct.rowCount}, page ${match.rowCount}) — usually data length, not drift.`,
      });
    }
  }
  for (const pt of pageTablesLeft) {
    findings.push({
      kind: 'missing-in-canvas', severity: 'warning',
      detail: `The page has a table (${pt.columnCount} columns: ${pt.headers.join(', ') || 'unlabeled'}) the canvas does not show.`,
    });
  }

  // ── controls: label match → same-kind order match → cross pairing ──
  const canvasCtrls = [...canvas.controls];
  const pageCtrls = [...page.controls];
  // Pass 1 — same label: either a clean match or the sharpest finding we have.
  for (let i = canvasCtrls.length - 1; i >= 0; i--) {
    const cc = canvasCtrls[i];
    if (!cc.label) continue;
    const j = pageCtrls.findIndex((pc) => pc.label === cc.label);
    if (j === -1) continue;
    const pc = pageCtrls[j];
    if (pc.kind !== cc.kind) {
      findings.push({
        kind: 'control-mismatch', severity: 'error', canvasNodeId: cc.nodeId,
        detail: `Control "${cc.label}": the canvas has a ${controlNoun(cc)}; the page has a ${controlNoun(pc)}.`,
      });
    }
    canvasCtrls.splice(i, 1);
    pageCtrls.splice(j, 1);
  }
  // Pass 2 — same kind, document order (labels missing or renamed).
  for (let i = canvasCtrls.length - 1; i >= 0; i--) {
    const j = pageCtrls.findIndex((pc) => pc.kind === canvasCtrls[i].kind);
    if (j !== -1) { canvasCtrls.splice(i, 1); pageCtrls.splice(j, 1); }
  }
  // Pass 3 — leftovers pair in order; differing kinds are the replacement case.
  const paired = Math.min(canvasCtrls.length, pageCtrls.length);
  for (let i = 0; i < paired; i++) {
    const cc = canvasCtrls[i];
    const pc = pageCtrls[i];
    findings.push({
      kind: 'control-mismatch', severity: 'error', canvasNodeId: cc.nodeId,
      detail: `The canvas has a ${controlNoun(cc)}${cc.label ? ` ("${cc.label}")` : ''}; the page has a ${controlNoun(pc)}${pc.label ? ` ("${pc.label}")` : ''} in its place.`,
    });
  }
  for (const cc of canvasCtrls.slice(paired)) {
    findings.push({
      kind: 'missing-in-page', severity: 'error', canvasNodeId: cc.nodeId,
      detail: `The canvas has a ${controlNoun(cc)}${cc.label ? ` ("${cc.label}")` : ''} that the page does not have.`,
    });
  }
  for (const pc of pageCtrls.slice(paired)) {
    findings.push({
      kind: 'missing-in-canvas', severity: 'warning',
      detail: `The page has a ${controlNoun(pc)}${pc.label ? ` ("${pc.label}")` : ''} the canvas does not show.`,
    });
  }

  // ── texts: multiset match on the normalized form ──
  const pageTextPool = new Map<string, number>();
  for (const t of page.texts) pageTextPool.set(t.text, (pageTextPool.get(t.text) ?? 0) + 1);
  let dataLikeSkipped = 0;
  const missingTexts: TextEntry[] = [];
  for (const t of canvas.texts) {
    const n = pageTextPool.get(t.text) ?? 0;
    if (n > 0) { pageTextPool.set(t.text, n - 1); continue; }
    if (isDataLike(t.display)) { dataLikeSkipped++; continue; } // live data ≠ drift
    missingTexts.push(t);
  }
  for (const t of missingTexts.slice(0, TEXT_FINDING_CAP)) {
    findings.push({
      kind: 'missing-in-page', severity: 'warning', canvasNodeId: t.nodeId,
      detail: `Canvas text "${t.display}" does not appear on the page.`,
    });
  }
  if (missingTexts.length > TEXT_FINDING_CAP) {
    findings.push({
      kind: 'missing-in-page', severity: 'warning',
      detail: `…and ${missingTexts.length - TEXT_FINDING_CAP} more canvas text(s) missing from the page.`,
    });
  }
  const unmatchedPageTexts = [...pageTextPool.values()].reduce((a, b) => a + b, 0);
  if (unmatchedPageTexts > 0) {
    // The noisy direction (live data, new copy) — a count, never per-string.
    findings.push({
      kind: 'missing-in-canvas', severity: 'info',
      detail: `${unmatchedPageTexts} page text(s) have no canvas counterpart (live data or copy the canvas predates).`,
    });
  }

  return {
    inSync: !findings.some((f) => f.severity === 'error' || f.severity === 'warning'),
    findings,
    counts: { canvas: canvas.counts, page: page.counts, unmatchedPageTexts, dataLikeSkipped },
  };
}
