// Phase 33 slice A — the cached fast evaluation every viewer page shows.
import type { Canvas } from '../types.js';
import { listCanvases, type CanvasSummary } from '../scene-graph.js';
import { getCanvasTokens } from '../workspaces.js';
import { evaluateCanvas, resolveGenre, type EvaluationResult } from '../evaluate.js';
import { resolveSurface } from '../surfaces.js';

/* ── Phase 19 Slice A — Quality panel ─────────────────────────────────────
 * The viewer surfaces the heuristic (fast, Chrome-free) canvas_evaluate so a
 * human reviewer sees the same score + cliché tells the agent sees over MCP.
 * Read-only: computed for display, never written back to the scene graph. */

// Cache fast-eval by a content hash of everything the evaluation actually
// reads — the node tree, the merged tokens, the genre and preset,
// and the component registry. NOT lastModified: metadata edits and hand-edits
// of a repo-bound file don't reliably bump it (issue #150), and a stale score
// that survives a legitimate fix makes the fix look broken. Bounded — drop
// the oldest when it grows past a cap.
const scoreCache = new Map<string, EvaluationResult>();

/** FNV-1a over the evaluation's actual inputs. Exported for tests. */
/** The state variants designed for a canvas (sibling lookup, non-archived).
 *
 * `listing` exists because this is called once per canvas while rendering a
 * gallery, and `listCanvases()` version-hashes every canvas in the store on
 * every call — so looking it up per card made a page render quadratic (a
 * 43-canvas project did ~7,600 whole-canvas hashes and spent 2s of a 2.2s
 * response inside this one line). Pass the listing the caller already has. */
export function designedStatesFor(canvasId: string, listing?: CanvasSummary[]): string[] {
  return (listing ?? listCanvases()).find((r) => r.id === canvasId)?.variants?.map((v) => v.state) ?? [];
}

export function evalCacheKey(canvas: Canvas, states?: string[]): string {
  // Phase 30: type, genre and preset are separate axes, and each changes the
  // score (they select the rulesets that run).
  const prov = canvas.metadata?.provenance;
  const surface = resolveSurface(canvas);
  const genre = `${resolveGenre(canvas).genre ?? ''}/${prov?.preset ?? ''}/${surface.type}/${surface.device ?? ''}`;
  let tokens = '';
  try { tokens = JSON.stringify(getCanvasTokens(canvas)); } catch { /* mirrored canvas with no live project — tree + genre still key it */ }
  // Phase 24 slice C — the coverage check reads the canvas's designed state
  // variants, so adding/removing a variant must invalidate the base's score.
  const stateKey = (states ?? designedStatesFor(canvas.id)).slice().sort().join(',');
  const payload = `${JSON.stringify(canvas.root)}|${tokens}|${genre}|${JSON.stringify(canvas.components ?? {})}|${stateKey}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${canvas.id}:${(h >>> 0).toString(36)}`;
}

export async function evalFor(canvas: Canvas, states?: string[]): Promise<EvaluationResult | null> {
  if (!canvas.root.children || canvas.root.children.length === 0) return null; // empty → no score
  const designed = states ?? designedStatesFor(canvas.id);
  const key = evalCacheKey(canvas, designed);
  const hit = scoreCache.get(key);
  if (hit) return hit;
  try {
    // Match the agent: evaluateCanvas resolves the canvas's own genre and preset.
    const result = await evaluateCanvas(canvas, { mode: 'fast', designedStates: designed });
    if (scoreCache.size > 200) scoreCache.delete(scoreCache.keys().next().value as string);
    scoreCache.set(key, result);
    return result;
  } catch {
    return null; // a scoring failure must never break the page
  }
}
