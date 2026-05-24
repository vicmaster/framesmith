// Phase 13 — the critique-loop core, extracted from the MCP handler so it's
// testable without booting the server (mirrors Phase 15's initWorkspace in
// bind.ts). Holds: verdict stamping, the scene-graph projection the reviser
// reads, and the bounded judge→revise→re-judge loop. The network/Chrome pieces
// (render / judge / revise) are injected so tests can stub them.

import type { Canvas, SceneNode, CritiqueVerdict } from './types.js';
import type { LLMJudgeResult } from './llm-judge.js';
import type { ReviseArgs } from './reviser.js';
import { parseAndExecute } from './operations.js';
import { touchCanvas } from './scene-graph.js';
import { recordCritiqueInBuildLog } from './repo-store.js';

/** Stamp a rubric verdict onto the canvas metadata + the per-project build log
 * so quality is auditable across sessions. The full rubric lives on the canvas;
 * the build log keeps only a compact { overall, needsRevision }. */
export function stampCritique(canvas: Canvas, critique: LLMJudgeResult): CritiqueVerdict {
  const verdict: CritiqueVerdict = {
    rubric: critique.rubric,
    overall: critique.score,
    needsRevision: critique.needsRevision,
    model: critique.model,
    at: new Date().toISOString(),
  };
  canvas.metadata = { ...canvas.metadata, critique: verdict };
  recordCritiqueInBuildLog(canvas.projectId, canvas.id, canvas.name, {
    overall: verdict.overall,
    needsRevision: verdict.needsRevision,
  });
  return verdict;
}

/** Project the scene graph to ids / types / names + key visual props (no inline
 * assets) so the reviser can reference real node ids without a huge payload. */
export function pruneTree(node: SceneNode): Record<string, unknown> {
  const keep: (keyof SceneNode)[] = ['width', 'height', 'layout', 'gap', 'padding', 'alignItems', 'justifyContent', 'fill', 'stroke', 'cornerRadius', 'fontSize', 'fontWeight', 'color', 'textAlign'];
  const out: Record<string, unknown> = { id: node.id, type: node.type };
  if (node.name) out.name = node.name;
  for (const k of keep) if (node[k] !== undefined) out[k] = node[k];
  if (node.gradient) out.gradient = true;
  if (node.shadows || node.shadow) out.shadow = true;
  if (typeof node.content === 'string') out.content = node.content.slice(0, 60);
  if (node.children?.length) out.children = node.children.map(pruneTree);
  return out;
}

export interface ReviseLoopDeps {
  /** Render the current canvas → PNG base64. */
  render: () => Promise<string>;
  /** Judge a PNG → rubric verdict (carries needsRevision/failingAxes). */
  judge: (png: string) => Promise<LLMJudgeResult>;
  /** Ask for targeted batch_design ops that raise the failing axes. */
  revise: (args: ReviseArgs) => Promise<string>;
}

export interface ReviseLoopResult {
  iterations: Record<string, unknown>[];
  finalVerdict: LLMJudgeResult;
  stoppedReason: string;
}

/** Bounded closed loop: judge → if needsRevision, revise the failing axes,
 * apply, re-render, re-judge — up to maxIter passes. Stops early on pass,
 * no-improvement (the regressing edit is reverted), no-ops, or apply-error.
 * Every accepted pass re-stamps the verdict + persists via touchCanvas. */
export async function runReviseLoop(
  canvas: Canvas,
  opts: { maxIter: number },
  deps: ReviseLoopDeps,
): Promise<ReviseLoopResult> {
  const maxIter = Math.max(1, Math.min(3, opts.maxIter));

  let png = await deps.render();
  let current = await deps.judge(png);
  stampCritique(canvas, current);
  touchCanvas(canvas.id);

  const iterations: Record<string, unknown>[] = [];
  let stoppedReason = current.needsRevision ? 'max-iterations' : 'passed';

  for (let pass = 1; current.needsRevision && pass <= maxIter; pass++) {
    const overallBefore = current.score;
    const failingAxes = current.failingAxes.map((a) => a.axis);
    const snapshot = structuredClone(canvas.root);

    let ops = '';
    try {
      ops = await deps.revise({
        screenshotBase64: png,
        sceneGraph: JSON.stringify(pruneTree(canvas.root)),
        failingAxes: current.failingAxes,
        suggestions: current.suggestions,
      });
    } catch (err) {
      iterations.push({ pass, overallBefore, failingAxes, error: `reviser failed: ${(err as Error).message}` });
      stoppedReason = 'reviser-error';
      break;
    }
    if (!ops.trim()) {
      iterations.push({ pass, overallBefore, failingAxes, note: 'reviser returned no ops' });
      stoppedReason = 'no-ops';
      break;
    }

    // parseAndExecute doesn't throw — it reports per-line failures (and stops at
    // the first). Treat any failed op as an apply-error: revert the partial edit
    // and stop, so the reviser can't half-mutate or corrupt the canvas.
    let opError: string | undefined;
    try {
      const opResults = parseAndExecute(canvas.root, ops);
      opError = opResults.find((r) => !r.ok)?.error ?? undefined;
    } catch (err) {
      opError = (err as Error).message;
    }
    if (opError) {
      canvas.root = snapshot; // revert a malformed/partial edit
      iterations.push({ pass, overallBefore, failingAxes, opsApplied: ops, error: `ops did not apply: ${opError}` });
      stoppedReason = 'apply-error';
      break;
    }

    png = await deps.render();
    const after = await deps.judge(png);
    const entry: Record<string, unknown> = { pass, overallBefore, failingAxes, opsApplied: ops, overallAfter: after.score };

    if (after.score <= overallBefore) {
      canvas.root = snapshot; // keep the better previous state — never accept a regression
      entry.reverted = true;
      iterations.push(entry);
      stoppedReason = 'no-improvement';
      break;
    }

    iterations.push(entry);
    current = after;
    stampCritique(canvas, current);
    touchCanvas(canvas.id);
    if (!current.needsRevision) { stoppedReason = 'passed'; break; }
    if (pass === maxIter) { stoppedReason = 'max-iterations'; }
  }

  return { iterations, finalVerdict: current, stoppedReason };
}
