// Phase 26 slice B — the project roll-up: per-screen summaries plus the
// checks that only make sense ACROSS screens. "Wow" products are consistent
// as a set — same radius system, one accent, shared chrome as components —
// and no per-canvas check can see any of that.
//
// ADVISORY BY DESIGN: findings are info/warning and there is NO new gate —
// the per-canvas directive (score, coverage, feedback) remains the only
// presentation gate. Every threshold here is a first guess that dogfooding
// will tune; the findings name their evidence (which canvases, which values)
// so a human can overrule them at a glance. Chrome-free.

import type { Canvas } from './types.js';
import type { SceneNode } from './types.js';
import { evaluateCanvas, rgbToHsl, parseColor } from './evaluate.js';
import { getCanvasTokens } from './workspaces.js';
import { shapeHash } from './shape-hash.js';

export type ProjectFindingKind = 'radius-drift' | 'accent-drift' | 'token-adoption' | 'copied-chrome' | 'state-coverage';

export interface ProjectFinding {
  kind: ProjectFindingKind;
  severity: 'warning' | 'info';
  /** The canvases this finding names — always populated (evidence, not vibes). */
  canvasIds: string[];
  detail: string;
  suggestion?: string;
}

export interface ProjectCanvasRow {
  canvasId: string;
  name: string;
  score: number;
  /** Directive-blocking issue count (same rule as canvas_evaluate). */
  blocking: number;
  states: string[];
  missingStates: string[];
  tokenUsagePercent: number;
}

export interface ProjectEvaluation {
  canvases: ProjectCanvasRow[];
  findings: ProjectFinding[];
  counts: { screens: number; warnings: number; infos: number };
  verdict: string;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Radius values used on a canvas (raw tree). Pills (≥999) are a shape
 * convention, not a scale member. */
function radiusSet(root: SceneNode): Set<number> {
  const out = new Set<number>();
  (function walk(n: SceneNode) {
    if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0 && n.cornerRadius < 999) out.add(n.cornerRadius);
    n.children?.forEach(walk);
  })(root);
  return out;
}

/** Dominant accent hue for a canvas from its merged tokens (accent → primary).
 * Neutral/near-grey accents return null — hue is meaningless there. */
function accentHue(canvas: Canvas): number | null {
  const tokens = getCanvasTokens(canvas);
  const hex = tokens.colors?.accent ?? tokens.colors?.primary;
  if (!hex) return null;
  const rgb = parseColor(hex);
  if (!rgb) return null;
  const { h, s } = rgbToHsl(rgb);
  return s < 0.15 ? null : h;
}

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function subtreeSize(node: SceneNode): number {
  return 1 + (node.children?.reduce((a, c) => a + subtreeSize(c), 0) ?? 0);
}

// ── the roll-up ─────────────────────────────────────────────────────────────

export async function evaluateProject(
  canvases: Canvas[],
  statesByCanvas: Map<string, string[]>,
): Promise<ProjectEvaluation> {
  const findings: ProjectFinding[] = [];
  const rows: ProjectCanvasRow[] = [];

  for (const c of canvases) {
    const r = await evaluateCanvas(c, { mode: 'fast', designedStates: statesByCanvas.get(c.id) ?? [] });
    const blocking = r.issues.filter((i) => i.category === 'cliche' || i.severity === 'error' || i.severity === 'warning').length;
    rows.push({
      canvasId: c.id,
      name: c.name,
      score: r.overallScore,
      blocking,
      states: statesByCanvas.get(c.id) ?? [],
      missingStates: r.coverage?.missing ?? [],
      tokenUsagePercent: r.stats.tokenUsagePercent,
    });
  }

  // ── radius drift: a canvas whose radius set is DISJOINT from the shared
  // pool (values used by ≥2 canvases) runs a different system.
  const radiusByCanvas = new Map(canvases.map((c) => [c.id, radiusSet(c.root)]));
  const usage = new Map<number, number>();
  for (const set of radiusByCanvas.values()) for (const v of set) usage.set(v, (usage.get(v) ?? 0) + 1);
  const sharedPool = new Set([...usage.entries()].filter(([, n]) => n >= 2).map(([v]) => v));
  if (sharedPool.size > 0) {
    for (const c of canvases) {
      const set = radiusByCanvas.get(c.id)!;
      if (set.size === 0) continue;
      if ([...set].every((v) => !sharedPool.has(v))) {
        findings.push({
          kind: 'radius-drift',
          severity: 'warning',
          canvasIds: [c.id],
          detail: `"${c.name}" uses radius values [${[...set].sort((a, b) => a - b).join(', ')}] that no other screen shares — the project's common scale is [${[...sharedPool].sort((a, b) => a - b).join(', ')}].`,
          suggestion: 'Align to the shared radius scale (or declare radius tokens so the system is explicit).',
        });
      }
    }
  }

  // ── accent drift: majority hue ±30°; outliers flagged.
  const hues = canvases
    .map((c) => ({ id: c.id, name: c.name, hue: accentHue(c) }))
    .filter((x): x is { id: string; name: string; hue: number } => x.hue !== null);
  if (hues.length >= 2) {
    let dominant: number | null = null;
    let best = 1;
    for (const { hue } of hues) {
      const peers = hues.filter((o) => hueDistance(o.hue, hue) <= 30).length;
      if (peers > best) { best = peers; dominant = hue; }
    }
    if (dominant !== null && best >= 2) {
      for (const { id, name, hue } of hues) {
        if (hueDistance(hue, dominant) > 30) {
          findings.push({
            kind: 'accent-drift',
            severity: 'warning',
            canvasIds: [id],
            detail: `"${name}"'s accent hue (${Math.round(hue)}°) sits ${Math.round(hueDistance(hue, dominant))}° from the project's dominant accent (${Math.round(dominant)}°) — one product, one accent.`,
            suggestion: 'Point the screen at the shared $accent token (or generate_color_system once at the workspace and inherit).',
          });
        }
      }
    }
  }

  // ── token adoption: a screen far below the others' norm is styling by hand.
  const adopters = rows.filter((r) => r.tokenUsagePercent > 0);
  if (adopters.length >= 3) {
    for (const row of rows) {
      const others = adopters.filter((r) => r.canvasId !== row.canvasId);
      if (others.length < 2) continue;
      const mean = others.reduce((a, r) => a + r.tokenUsagePercent, 0) / others.length;
      // Real trees dilute the ratio with content/layout strings — a healthy
      // token-referencing screen sits around ~30-40%, so the outlier rule is
      // relative: the rest average ≥25% and this screen reaches under 40% of
      // that norm.
      if (mean >= 25 && row.tokenUsagePercent <= mean * 0.4) {
        findings.push({
          kind: 'token-adoption',
          severity: 'info',
          canvasIds: [row.canvasId],
          detail: `"${row.name}" references tokens in ${row.tokenUsagePercent}% of string props while the rest of the project averages ${Math.round(mean)}% — hand-picked values drift from the system.`,
          suggestion: 'The consistency lint lists the exact literals that equal existing tokens; canvas_autofix re-attaches the unique matches.',
        });
      }
    }
  }

  // ── copied chrome: the same substantial top-level shape on ≥2 screens,
  // not as component instances.
  const shells = new Map<string, { canvasId: string; canvasName: string; nodeId: string; nodeName?: string }[]>();
  for (const c of canvases) {
    for (const top of c.root.children ?? []) {
      if (top.type === 'instance') continue; // instances ARE the solution
      if (!['frame', 'component'].includes(top.type)) continue;
      if (subtreeSize(top) < 4) continue; // trivial frames collide meaninglessly
      const hash = shapeHash(top);
      shells.set(hash, [...(shells.get(hash) ?? []), { canvasId: c.id, canvasName: c.name, nodeId: top.id, nodeName: top.name }]);
    }
  }
  for (const carriers of shells.values()) {
    const distinctCanvases = [...new Set(carriers.map((x) => x.canvasId))];
    if (distinctCanvases.length < 2) continue;
    const label = carriers[0].nodeName ?? 'a top-level frame';
    findings.push({
      kind: 'copied-chrome',
      severity: 'warning',
      canvasIds: distinctCanvases,
      detail: `"${label}" appears hand-copied on ${distinctCanvases.length} screens (${carriers.map((x) => x.canvasName).join(', ')}) — copies drift apart edit by edit.`,
      suggestion: `Promote one to a component (create_component on ${carriers[0].nodeId}) and stamp instances; copy_nodes carries the definition to sibling canvases.`,
    });
  }

  // ── state coverage, aggregated (the per-canvas warnings already exist;
  // this is the project view of the same fact).
  const uncovered = rows.filter((r) => r.missingStates.length > 0);
  if (uncovered.length > 0) {
    findings.push({
      kind: 'state-coverage',
      severity: 'info',
      canvasIds: uncovered.map((r) => r.canvasId),
      detail: `${uncovered.length} screen(s) still missing designed states: ${uncovered.map((r) => `"${r.name}" (${r.missingStates.join(', ')})`).join('; ')}.`,
      suggestion: 'canvas_add_variant + the empty-state / skeleton-table scaffolds — one clone plus one stamp each.',
    });
  }

  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;
  const notReady = rows.filter((r) => r.blocking > 0).length;
  const verdict = findings.length === 0 && notReady === 0
    ? `COHERENT — ${rows.length} screen(s), no cross-screen drift, every screen presentable.`
    : `REVIEW — ${warnings} cross-screen warning(s), ${infos} advisory note(s)${notReady ? `, ${notReady} screen(s) not yet presentable by their own directives` : ''}. This roll-up is ADVISORY: only the per-canvas directives gate presenting.`;

  return { canvases: rows, findings, counts: { screens: rows.length, warnings, infos }, verdict };
}
