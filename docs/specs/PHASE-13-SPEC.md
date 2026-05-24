# Phase 13 — Structured Critique & Auto-Revision (v1.3)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-05-24.

---

## 1. SPECIFY

### Problem
The LLM-judge mode (Phase 6, `src/llm-judge.ts`) returns a 0–100 `score` plus free-text `strengths` / `weaknesses` / `suggestions` — a **vibe check, not a reproducible rubric**, and nothing closes the loop automatically. Two consecutive runs can disagree on the number with no axis-level accountability, and a weak design is *reported* but never *revised*. Move the judge to a fixed multi-axis rubric with a per-axis floor, and let a low axis optionally trigger a revision pass instead of just reporting it.

**Authoring intent (from VISION):** keep the deterministic heuristic signal (Phase 6 categories + Phase 12 cliché) — the rubric sits *alongside* it, it doesn't replace it. The win is a *named, comparable* quality signal that's auditable over time (build log) and can drive a closed revise→re-judge loop.

### Goals
- Replace the judge's opaque number with a **fixed rubric**: named axes, each scored 1–5 with a one-line rationale.
- Flag **needs-revision** when any axis is below a floor, naming the specific axis.
- Offer an **optional, bounded closed loop**: feed the failing axis back as targeted `batch_design` guidance, apply, re-judge.
- **Stamp the verdict** on canvas metadata + the per-project build log so quality is auditable across sessions.
- **Keep the deterministic signal** — heuristic categories (incl. Phase 12 `cliche`) still run unchanged in `llm` mode.

### User stories
- **US1** — As the authoring agent, I run `canvas_evaluate mode:"llm"` and get axis scores (1–5) with rationale, not one opaque number, so I know *what* to fix.
- **US2** — As the authoring agent, I see `needsRevision` + the specific failing axes when any axis is below the floor.
- **US3** — As the authoring agent, I can optionally run a closed loop that revises the canvas against the failing axis and re-judges, bounded by a max-iteration cap, so I'm not stuck hand-translating critique into ops.
- **US4** — As the maintainer/viewer, each judged canvas records its rubric verdict (in metadata + build log) so I can audit quality over time and across the build log.

### Functional requirements
| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-1 | **Fixed rubric** — the judge returns `rubric` = a map of fixed axes, each `{ score: 1–5, rationale: string }`. Axes: **hierarchy, execution, specificity, restraint, variety** (C1). | `judgeCanvas` result carries all 5 axes, each 1–5 + rationale; out-of-range scores clamped. |
| FR-2 | **Derived overall + summary** — keep a back-compat `score` (0–100) derived from the rubric and a `summary`; `suggestions[]` retained. (C2 decides the exact back-compat shape.) | `llmCritique.score` is present and equals the rubric-derived value; `summary` non-empty. |
| FR-3 | **Revision threshold** — `needsRevision: boolean` + `failingAxes: [{ axis, score, rationale }]` for every axis `< floor` (default **3**, overridable). | An axis at 2 with floor 3 → `needsRevision: true` and that axis in `failingAxes`. |
| FR-4 | **Verdict stamping** — write the rubric verdict to `canvas.metadata.critique` (`{ rubric, overall, needsRevision, at, model }`) and a compact entry to the per-project build log, so it's auditable. | After a critique, `canvas.metadata.critique` is set + survives persistence; build log carries the overall + needsRevision. |
| FR-5 | **Closed loop (opt-in)** — a `canvas_revise` tool: judge → if `needsRevision`, ask a pluggable **reviser** for targeted `batch_design` ops addressing the failing axes → apply → re-judge; repeat up to `maxIterations` (default **1**, cap **3**) or until it passes. Returns an iteration log + final verdict. (C3 / C4.) | With stubbed judge+reviser, a failing canvas runs N passes, applies ops, and the result reports each pass's verdict + the final state. |
| FR-6 | **Pluggability** — rubric judging + revising are pluggable per provider (mirror the existing `judges` table) and the rubric parsing is a pure, unit-testable function. The deterministic heuristic categories are untouched. | A stubbed judge/reviser redirects dispatch (as `test-llm-judge.ts` already does for `judges`); heuristic categories identical to pre-Phase-13. |

### Non-goals (explicit scope cuts)
- **No heuristic rubric** — the rubric is the *LLM's* structured output; the deterministic lane stays the Phase 6/12 categories. (Restraint/variety overlap cliché/build-log, but we don't fold them into a computed score here.)
- **No new provider** — reuse anthropic/openai; adding a third stays a one-table-entry change.
- **No unbounded autonomy** — the loop is opt-in, capped (≤3), and every pass is stamped; it does not run inside `canvas_evaluate`.
- **No viewer redesign** — showing the verdict on the detail page is a minimal optional add (its own task), not a redesign.

---

## 2. CLARIFY  (forks — recommendations; ★ = needs user confirm, see §6)

- **C1 — The axes.** *Recommend:* the VISION-named five — **hierarchy** (clear focal order / scan path), **execution** (craft: alignment, spacing, consistency, contrast), **specificity** (feels designed for a real purpose, not a generic template), **restraint** (no overdone effects — the Phase 12 ethos), **variety** (avoids same-shape sameness — ties to Phase 11 axes). Each 1–5. Stable names (XP: Phase 12 `tell`s + Phase 11 axes feed restraint/variety). ★ confirmable.
- **C2 — Rubric result shape vs back-compat.** ★ *Recommend:* **evolve** `LLMJudgeResult`: add `rubric` (the 5 axes) + `needsRevision` + `failingAxes`; **keep** `score` (now *derived* from the rubric: `round(mean(axes) / 5 * 100)`), `summary`, `suggestions`; **drop** the free-text `strengths`/`weaknesses` (subsumed by per-axis rationale). This is a breaking change to the documented `llmCritique` shape — acceptable because `llm` mode is opt-in/experimental and costs an API call. Alternative: keep strengths/weaknesses too (no break, but redundant with rationale).
- **C3 — Auto-revise surface.** ★ *Recommend:* a **new opt-in `canvas_revise` tool**, *not* a flag on `canvas_evaluate` (evaluate must stay read-only + cheap; revise mutates + costs ≥2 API calls/iteration). The loop never runs implicitly.
- **C4 — Reviser mechanism + safety.** *Recommend:* a pluggable **`revisers` table** (mirrors `judges`). A reviser takes `(screenshotBase64, sceneGraphJson, failingAxes)` → returns a `batch_design` ops **string**; the tool validates/executes it via the existing `parseAndExecute`, re-renders, re-judges. Safety: `maxIterations` default **1**, hard cap **3**; **stop early** once `needsRevision` is false or a pass fails to improve the overall (no oscillation); each applied pass **re-stamps** `metadata.critique`; the tool reports every pass so the mutation is transparent. (A-C3 adds the no-improvement stop.)
- **C5 — Floor default + override.** *Recommend:* floor **3** (of 5); overridable via a `floor` param on `canvas_evaluate`/`canvas_revise` and `FRAMESMITH_CRITIQUE_FLOOR` env.
- **C6 — Verdict storage location.** *Recommend:* `canvas.metadata.critique` (distinct from `metadata.provenance`, which is *what produced* the canvas; the verdict is *how good it is*). Build log gets a **compact** verdict (`critiqueOverall`, `needsRevision`) on the canvas's latest entry (or a minimal new entry), reusing the `recordPresetInBuildLog` update-latest pattern. (A-C2.)
- **C7 — Does the rubric require a screenshot?** *Decided:* yes — same as today's judge (vision model on the render). `canvas_revise` re-renders between passes (Chrome required). With no provider/key, both degrade with the existing `LLMJudgeUnavailableError`.

---

## 3. PLAN  (technical — mapped to real symbols)

### `src/llm-judge.ts` — rubric types + parsing (extend, keep the `judges` table shape)
```ts
export const RUBRIC_AXES = ['hierarchy','execution','specificity','restraint','variety'] as const;
export type RubricAxis = typeof RUBRIC_AXES[number];
export interface AxisScore { score: number; rationale: string; } // score 1–5
export type Rubric = Record<RubricAxis, AxisScore>;

export interface LLMJudgeResult {
  provider: Provider; model: string;
  rubric: Rubric;
  score: number;            // 0–100 derived = round(mean(axisScores)/5*100)
  summary: string;
  suggestions: string[];
  needsRevision: boolean;   // any axis < floor
  failingAxes: { axis: RubricAxis; score: number; rationale: string }[];
}
```
- New `SYSTEM_PROMPT` instructs STRICT JSON with the 5 axes (each `{score 1-5, rationale}`) + `summary` + `suggestions`. Drop the old free-text strengths/weaknesses prompt.
- `parseRubric(text, floor)` (pure, replaces/extends `parseJudgement`): strip fences, JSON.parse, clamp each axis to 1–5, default a missing axis to a neutral 3 with an empty rationale (never throw on a missing axis — only throw on non-JSON, mirroring current behavior), derive `score`, compute `needsRevision`/`failingAxes`.
- `judgeCanvas(png, { provider?, floor? })` — signature gains `floor`; both adapters call `parseRubric`. **Back-compat:** the two provider adapters change their `parseJudgement` call to `parseRubric`.

### `src/reviser.ts` — NEW, mirrors `llm-judge.ts`
```ts
export type Reviser = (args: { screenshotBase64: string; sceneGraphJson: string; failingAxes: ...; }) => Promise<string>; // returns batch_design ops
export const revisers: Record<Provider, Reviser> = { anthropic, openai };
export async function reviseCanvas(args, providerOverride?): Promise<string>;
```
- Reviser prompt: "Here is a rendered design, its scene graph JSON, and the failing rubric axes with rationale. Return ONLY a batch_design op script (newline-separated U/I/D/M ops) that improves the failing axes. Reference real node ids from the JSON. No prose." Dynamic SDK import (same pattern). Reuse `Provider`/`pickProvider` from `llm-judge.ts`.

### `src/index.ts`
- **`canvas_evaluate`** (913–953): in `mode:'llm'`, call `judgeCanvas(png, { floor })`; add a `floor` param; **stamp** `canvas.metadata.critique` + `touchCanvas` + record compact verdict in build log (new helper). Update the tool description + the `llmCritique` doc.
- **`canvas_revise`** (NEW, opt-in): input `{ canvasId, maxIterations?(≤3, default 1), floor?, provider? }`. Loop: render → `judgeCanvas` → if `!needsRevision` stop → `reviseCanvas` → `parseAndExecute(canvas.root, ops)` (guard parse errors) → `touchCanvas` → re-judge; stop on pass, cap, or no-improvement. Stamp `metadata.critique` each accepted pass. Return `{ iterations: [{ pass, overallBefore, failingAxes, opsApplied, overallAfter }], finalVerdict, stoppedReason }`.

### `src/types.ts` — verdict on the metadata bag (no migration; optional)
```ts
// in Canvas.metadata: critique?: CritiqueVerdict
export interface CritiqueVerdict {
  rubric: Record<string, { score: number; rationale: string }>;
  overall: number; needsRevision: boolean; model: string; at: string;
}
```
`BuildLogEntry` gains optional `critiqueOverall?: number; needsRevision?: boolean` (back-compat optional).

### Build-log: `src/repo-store.ts`
- Add `recordCritiqueInBuildLog(projectId, canvasId, canvasName, { overall, needsRevision })` — mirror `recordPresetInBuildLog` (update-latest-or-append). Serialize via existing `stableStringify`/`writeAtomic`.

### Viewer (optional task)
- `src/viewer.ts:694` already shows provenance; add a small verdict badge (overall + needs-revision) when `metadata.critique` is present. Read-only.

### Docs / conventions (CLAUDE.md)
- README Tools: rewrite the `mode:"llm"` return block (rubric shape) + add `canvas_revise`. `docs/GUIDELINES.md`: a short "Structured critique & revision" note under "After designing". VISION Phase 13 ticks.
- Tests redirect storage via `import './test-env.js'`; LLM paths use stubbed `judges`/`revisers` (no network), mirroring `test-llm-judge.ts`.

---

## 4. TASKS  (atomic, PR-sized; build order T1 → T2 → {T3,T4} → T5 → T6 → T7)

### Slice A — Rubric (deterministic-to-test core)
- **T1** — `src/llm-judge.ts`: rubric types, `RUBRIC_AXES`, new prompt, `parseRubric(text, floor)` (clamp/derive/needsRevision), `judgeCanvas` gains `floor`; adapters call `parseRubric`. Update `test-llm-judge.ts` for the new shape (parse well-formed rubric, fences, clamping, missing-axis default, floor threshold).
- **T2** — `src/index.ts` + `src/types.ts` + `src/repo-store.ts`: `CritiqueVerdict` type; `canvas_evaluate mode:'llm'` stamps `metadata.critique` + `recordCritiqueInBuildLog`; add `floor` param + env. README `mode:"llm"` block rewrite.

### Slice B — Closed loop (opt-in, bounded)
- **T3** — `src/reviser.ts`: `revisers` table + `reviseCanvas` + prompt (NEW module, no network in tests).
- **T4** — `src/index.ts`: `canvas_revise` tool (bounded loop, parse-guarded apply, per-pass stamp, iteration log, stop reasons).
- **T5** — `test-critique.ts`: stubbed judge+reviser; asserts rubric→needsRevision→revise loop applies ops, re-judges, stops on pass/cap/no-improvement; verdict stamped + in build log; round-trips.

### Slice C — Surface + docs
- **T6** — `docs/GUIDELINES.md` note + `canvas_revise` README section + VISION Phase 13 ticks.
- **T7** — *(optional)* viewer verdict badge on the canvas detail page.

---

## 5. ANALYZE  (read-only pass over every stage; findings folded upstream)

### 5.1 Analyze — SPECIFY
- **A-S1 [med]** FR-1 named axes but Specify must pin that they're a *fixed closed set* (else "rubric" drifts to free-form). → FR-1 enumerates the 5 + C1 marks them stable. *(fixed)*
- **A-S2 [med]** "Closed loop" is the riskiest item (autonomous mutation + cost) — Specify must bound it. → FR-5 + non-goals state opt-in, capped ≤3, never inside evaluate. *(fixed)*
- **A-S3 [low]** "Keep deterministic signal" needs a concrete acceptance. → FR-6: heuristic categories byte-identical to pre-Phase-13. *(fixed)*

### 5.2 Analyze — CLARIFY
- **A-C1 [HIGH]** Dropping `strengths`/`weaknesses` (C2) **breaks the documented `llmCritique` shape** + the `test-llm-judge.ts` assertions on those arrays. → C2 flags it as a deliberate breaking change (llm mode is opt-in); T1 rewrites the test. Surface to user (§6) since README is user-facing. *(noted; user-confirm)*
- **A-C2 [med]** Verdict in the build log risks **bloating** an append-only, git-committed file with full rubrics. → C6: store the *full* rubric only on `metadata.critique`; the build log gets a **compact** `{ overall, needsRevision }` via update-latest (not a fat per-pass append). *(fixed)*
- **A-C3 [HIGH]** The revise loop can **oscillate or regress** — a reviser pass might lower the overall. → C4: stop when overall doesn't improve (and never auto-accept a worse canvas; keep the better state). Bounded by maxIterations≤3 regardless. *(fixed)*
- **A-C4 [med]** A reviser returning malformed/destructive ops could corrupt the canvas. → C4: ops go through `parseAndExecute` which already validates op syntax + node existence; on a parse/exec error, that pass is **skipped + reported**, the canvas left as-is. (Phase 10 `ensureFresh` also guards external edits.) *(fixed)*

### 5.3 Analyze — PLAN
- **A-P1 [HIGH — correctness]** `canvas_revise` mutates a possibly **repo-bound** canvas. It must `touchCanvas` after each accepted pass (persists through the bound backend) and respect `ensureFresh` like other mutating tools. → §3 pins `touchCanvas` per pass; reuse the standard mutate path. *(fixed)*
- **A-P2 [med]** Deriving `score` as `mean/5*100` must be **stable + documented** so the build log + viewer agree. → §3 fixes the formula `round(mean(axisScores)/5*100)`; FR-2 asserts it. *(fixed)*
- **A-P3 [med]** The reviser needs the scene graph to reference real node ids — passing the *whole* canvas JSON could be huge/expensive. → Pass a **pruned** tree (ids, types, names, key props) via the existing `read_nodes`-style projection, not the raw JSON with inline assets. *(added to §3 reviser args)*
- **A-P4 [low]** `parseRubric` defaulting a missing axis to 3 could **mask** a model that omitted axes. → Acceptable (never throw mid-eval), but flag the defaulted axis with an empty rationale so it's visible; don't let a defaulted-3 trip `needsRevision` falsely (3 ≥ floor 3). *(noted)*

### 5.4 Analyze — TASKS
- **A-T1 [med]** T1 changes the public `LLMJudgeResult` → every consumer (index.ts llm block, README, test) must move in lockstep or the build breaks. → Build order T1→T2 keeps them in one reviewable sweep; `tsc` enforces it. *(noted)*
- **A-T2 [low]** No test covers the *no-improvement* + *cap* stop reasons. → T5 explicitly asserts all three stop reasons (pass / cap / no-improvement). *(fixed)*
- **A-T3 [low]** Build order unstated. → T1 → T2 → {T3,T4} → T5 → T6 → T7. *(fixed)*

### 5.5 Cross-artifact
**Coverage matrix:**

| VISION bullet | FR | Tasks |
|---|---|---|
| Fixed critique rubric | FR-1, FR-2 | T1 |
| Revision threshold | FR-3 | T1, T2 |
| Closed loop auto-revise | FR-5 | T3, T4, T5 |
| Stamp the verdict | FR-4 | T2, T5, (T7) |
| Keep rubric pluggable + deterministic | FR-6 | T1, T3, T5 |

**Contradictions:** "autonomous revise" vs "safe/cheap" resolved by opt-in tool + caps + no-improvement stop + per-pass transparency (FR-5/C3/C4/A-C3).
**Cross-phase:** XP-1 reuses Phase 11 `metadata` bag + build-log + `recordPresetInBuildLog` pattern (no new persistence layer); XP-2 the **restraint** axis is the LLM-judged sibling of Phase 12's deterministic `cliche` (keep both — one is taste, one is mechanical); **variety** is the LLM sibling of Phase 11's computed axes; XP-3 the reviser emits `batch_design` ops → reuses `parseAndExecute` validation (no new op engine).
**Test coverage:** FR-1/2/3 → T1 unit (parseRubric); FR-4 → T5 (stamp + build log + round-trip); FR-5 → T5 (stubbed loop, 3 stop reasons); FR-6 → T1/T5 (stub redirects dispatch; heuristics unchanged).

### 5.6 Severity roll-up
- **3 HIGH:** A-C1 (breaking `llmCritique` shape), A-C3 (loop oscillation/regression), A-P1 (revise must persist through bound backend). All addressed; A-C1 surfaced to user.
- **5 med, 4 low.** Folded upstream.

### 5.7 Verdict
The chain is consistent after analyze. The riskiest element (the autonomous revise loop) is contained: opt-in tool, ≤3 passes, stop-on-no-improvement, parse-guarded apply, per-pass stamping, repo-bound persistence respected. Two user-facing forks need confirmation before T1 (§6): the auto-revise approach (build now / how) and the breaking rubric shape. **Ready to build Slice A after §6 confirmation, starting T1.**

---

## 6. DECISIONS (user-confirmed 2026-05-24)
1. **Auto-revise scope** — ✅ **Build the bounded loop now** as an opt-in `canvas_revise` tool (≤3 passes, stop-on-no-improvement, parse-guarded, per-pass stamp).
2. **Rubric result shape** — ✅ **Evolve (breaking).** `rubric` axes replace free-text `strengths`/`weaknesses`; keep `summary` + `suggestions` + derived 0–100 `score`; add `needsRevision` + `failingAxes`.
3. **Axes** — ✅ **VISION five:** hierarchy, execution, specificity, restraint, variety (each 1–5 + rationale).

All three match the spec's recommended path; nothing in §1–§5 changes. **Ready to build, starting T1.**
