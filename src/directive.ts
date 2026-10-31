// Phase 29 slice D (#194) — the presentation gate, as a pure function.
//
// This was inline in the canvas_evaluate handler, which made the single most
// consequential sentence framesmith says to an agent ("is this safe to show the
// user?") the one thing no test could reach. It is small, it has no I/O, and it
// encodes a policy decision worth pinning, so it lives here — the same shape as
// feedback.ts's appendFeedbackDirective, which it composes with.

import type { EvaluationResult } from './evaluate.js';
import { appendFeedbackDirective } from './feedback.js';

/** The bar a design is expected to clear. Not the readiness condition — see
 * below — but still reported in every directive so it can't be forgotten. */
export const SCORE_BAR = 95;

/** The last canvas_stress verdict as the directive sees it. `current` = it ran
 * on the canvas's present versionHash AND under its present type. */
export interface StressState {
  warnings: number;
  current: boolean;
  /** Set when the canvas type changed since the run (Phase 30), so the note
   * says so instead of blaming an edit. */
  ranAsType?: string;
}

export interface DirectiveParts {
  directive: string;
  ready: boolean;
  blocking: number;
  optional: number;
}

/** Blocking = anything the agent is expected to resolve before presenting: an
 * error, a warning, or ANY cliché tell (slop the user notices even at info
 * severity). Everything else is an advisory refinement. */
export function countBlocking(result: EvaluationResult): number {
  return result.issues.filter(
    (i) => i.category === 'cliche' || i.severity === 'error' || i.severity === 'warning',
  ).length;
}

/**
 * Readiness turns on BLOCKING findings, not on the score.
 *
 * The old rule was `blocking === 0 && score > 95`, which could strand a design
 * with no honest move left: the checkout attempt reached zero issues to resolve
 * and fifty-two advisory refinements at 93/100 — every real problem fixed, and
 * the only way to raise the number was to make the design worse. A gate an agent
 * cannot satisfy by improving the design is not a gate.
 *
 * The score is not softened to compensate. It appears in every directive, and
 * when it is at or below the bar with nothing blocking left, the directive says
 * so explicitly and names what is left, so "ready at 93" can never be mistaken
 * for "ready at 100".
 */
export function buildEvaluateDirective(result: EvaluationResult, openFeedback = 0, stress?: StressState): DirectiveParts {
  const blocking = countBlocking(result);
  const optional = result.issues.length - blocking;
  // A FRAGILE stress run blocks until a CLEAN run replaces it — an edit since
  // the run only changes what the agent is told to do, never the verdict.
  const fragile = stress && stress.warnings > 0 ? stress : undefined;
  const ready = blocking === 0 && !fragile;

  const optTail = optional ? ` ${optional} optional refinement(s) noted (info) — address if easy, not required.` : '';
  const belowBar = result.overallScore <= SCORE_BAR
    ? ` Score is ${result.overallScore}, at or below the > ${SCORE_BAR} bar — nothing blocking is left, so the remaining lift is in the ${optional} advisory finding(s) and in craft the heuristics don't measure. Judge the render before presenting.`
    : '';
  const stressNote = !fragile
    ? ''
    : fragile.current
      ? ` The last canvas_stress run on this exact version was FRAGILE (${fragile.warnings} layout break(s)) — fix them with fluid widths / minWidth or minHeight floors / wrapping / textOverflow: "ellipsis", then re-run canvas_stress until CLEAN.`
      : fragile.ranAsType
        ? ` The last canvas_stress run was FRAGILE (${fragile.warnings} layout break(s)) under the canvas's earlier type ("${fragile.ranAsType}") — re-run canvas_stress under the current type; only a CLEAN run clears this.`
        : ` The last canvas_stress run was FRAGILE (${fragile.warnings} layout break(s)) on an earlier version — re-run canvas_stress to confirm your changes fixed them; only a CLEAN run clears this.`;

  let base: string;
  if (ready) {
    base = `READY TO PRESENT — ${result.overallScore}/100, no blocking issues.${optTail}${belowBar}`;
  } else if (blocking > 0) {
    base = `NOT READY — ${result.overallScore}/100 with ${blocking} issue(s) to resolve${optional ? ` (+${optional} optional)` : ''}. Fix them now: canvas_autofix for the mechanical subset, batch_design for the rest (cliché tells included), then re-run canvas_evaluate. Repeat until there are zero warnings and zero cliché tells.${stressNote} Do NOT show this design to the user yet.`;
  } else {
    base = `NOT READY — ${result.overallScore}/100 with no evaluate issues left, but stress is not cleared.${stressNote} Then re-run canvas_evaluate. Do NOT show this design to the user yet.`;
  }

  return { directive: appendFeedbackDirective(base, openFeedback), ready, blocking, optional };
}
