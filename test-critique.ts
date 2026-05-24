import './test-env.js';
/**
 * Phase 13 — structured critique closed loop. Drives runReviseLoop with STUBBED
 * judge + reviser (no network, no Chrome) on a real persisted canvas, asserting
 * the stop reasons, the no-improvement revert, verdict stamping + build log, and
 * the apply-error guard. Run with: npx tsx test-critique.ts
 */
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { runReviseLoop, type ReviseLoopDeps } from './src/critique.js';
import { withVerdict, RUBRIC_AXES, type LLMJudgeResult, type Rubric } from './src/llm-judge.js';
import { readBuildLog } from './src/repo-store.js';

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

// Build a verdict from per-axis scores (missing → 4); floor 3.
function verdict(scores: Partial<Record<string, number>>, model = 'stub'): LLMJudgeResult {
  const rubric = {} as Rubric;
  for (const a of RUBRIC_AXES) rubric[a] = { score: scores[a] ?? 4, rationale: '' };
  const mean = RUBRIC_AXES.reduce((s, a) => s + rubric[a].score, 0) / RUBRIC_AXES.length;
  return withVerdict({ provider: 'anthropic', model, rubric, score: Math.round((mean / 5) * 100), summary: '', suggestions: [] }, 3);
}

function freshCanvas() {
  const canvas = createCanvas('Revise me');
  parseAndExecute(canvas.root, `page=I("document",{type:"frame",width:600,layout:"vertical"})\nt=I(page,{type:"text",content:"Hi",fontSize:16})`);
  const textId = canvas.root.children![0].children![0].id;
  return { canvas, textId };
}

// A judge that returns queued verdicts in order; a reviser returning fixed ops.
function deps(queue: LLMJudgeResult[], ops: string, spy?: { revised: number }): ReviseLoopDeps {
  let i = 0;
  return {
    render: async () => 'PNGSTUB',
    judge: async () => queue[Math.min(i++, queue.length - 1)],
    revise: async () => { if (spy) spy.revised++; return ops; },
  };
}

async function main() {
  // 1. improves → passes
  {
    console.log('\n── improves → passes ──');
    const { canvas, textId } = freshCanvas();
    const r = await runReviseLoop(canvas, { maxIter: 2 },
      deps([verdict({ variety: 2 }), verdict({})], `U("${textId}", { fontSize: 40 })`));
    assert(r.stoppedReason === 'passed', 'stops with reason "passed"');
    assert(r.iterations.length === 1, 'one revise pass recorded');
    assert(canvas.root.children![0].children![0].fontSize === 40, 'op was applied (fontSize 40)');
    assert(canvas.metadata?.critique?.overall === 80 && canvas.metadata.critique.needsRevision === false, 'verdict stamped (overall 80, not needs-revision)');
    const log = readBuildLog(canvas.projectId);
    assert(log.some((e) => e.canvasId === canvas.id && e.critiqueOverall === 80 && e.needsRevision === false), 'compact verdict in build log');
  }

  // 2. no improvement → revert
  {
    console.log('\n── no improvement → revert ──');
    const { canvas, textId } = freshCanvas();
    const r = await runReviseLoop(canvas, { maxIter: 2 },
      deps([verdict({ variety: 2 }), verdict({ variety: 2 })], `U("${textId}", { fontSize: 99 })`));
    assert(r.stoppedReason === 'no-improvement', 'stops with reason "no-improvement"');
    assert((r.iterations[0] as any).reverted === true, 'pass marked reverted');
    assert(canvas.root.children![0].children![0].fontSize === 16, 'regressing edit reverted (fontSize back to 16)');
  }

  // 3. cap (max-iterations)
  {
    console.log('\n── cap (max-iterations) ──');
    const { canvas, textId } = freshCanvas();
    const r = await runReviseLoop(canvas, { maxIter: 2 },
      deps([verdict({ variety: 2 }), verdict({ variety: 2, hierarchy: 5, execution: 5 }), verdict({ variety: 2, hierarchy: 5, execution: 5, specificity: 5 })],
        `U("${textId}", { fontSize: 30 })`));
    assert(r.stoppedReason === 'max-iterations', 'stops at the iteration cap');
    assert(r.iterations.length === 2, 'exactly maxIter passes recorded');
    assert(r.finalVerdict.needsRevision === true, 'final still needs revision (variety stuck)');
  }

  // 4. already passes initially → no revise call
  {
    console.log('\n── already passing ──');
    const { canvas } = freshCanvas();
    const spy = { revised: 0 };
    const r = await runReviseLoop(canvas, { maxIter: 2 }, deps([verdict({})], 'noop', spy));
    assert(r.stoppedReason === 'passed', 'passing canvas stops immediately');
    assert(r.iterations.length === 0 && spy.revised === 0, 'reviser never called');
    assert(canvas.metadata?.critique?.overall === 80, 'verdict still stamped on a passing canvas');
  }

  // 5. reviser returns no ops
  {
    console.log('\n── no-ops ──');
    const { canvas } = freshCanvas();
    const r = await runReviseLoop(canvas, { maxIter: 2 }, deps([verdict({ variety: 2 })], '   '));
    assert(r.stoppedReason === 'no-ops', 'stops when reviser returns no ops');
  }

  // 6. malformed ops → apply-error + revert
  {
    console.log('\n── apply-error ──');
    const { canvas } = freshCanvas();
    const before = JSON.stringify(canvas.root);
    const r = await runReviseLoop(canvas, { maxIter: 2 },
      deps([verdict({ variety: 2 }), verdict({})], `U("does-not-exist", { fontSize: 40 })`));
    assert(r.stoppedReason === 'apply-error', 'a failing op stops with "apply-error"');
    assert(JSON.stringify(canvas.root) === before, 'canvas reverted unchanged after a bad op');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
main();
