# Phase 12 — Cliché & Craft Guardrails (v1.2)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-05-24.

---

## 1. SPECIFY

### Problem
`canvas_evaluate` (Phase 6, `src/evaluate.ts`) scores **craft** — contrast, spacing scale, type scale, structure, consistency. It says nothing about **cliché**: the visual tells that mark a design as machine-made. Several of these are mechanically detectable on the scene graph, and because framesmith *renders*, it can confirm them instead of guessing. This phase adds a `cliche` category alongside the craft checks, plus an honest-content rule so mockups stop shipping invented data.

**Authoring intent (from VISION + memory `feedback_visual_design_bar`):** the bar is "designers say *wow*," not "competent." The recurring AI tells — default purple/indigo, gradient/glow/bloom, fake browser chrome, the hanging eyebrow header, fabricated metrics — are exactly what reads as machine-made. Catch them mechanically *and* steer authoring away from them up front.

### Goals
- Add a **`cliche`** category to `canvas_evaluate` that flags the recurring machine-made tells, each with a `nodeId` reference.
- Make "this is a tell" **computable** (scene-graph + render), not a vibe — every flag is a deterministic rule.
- Where a fix is mechanical, emit a ready-to-run `batch_design` op (consistent with Phase 6 `canvas_autofix`).
- Let the active genre (preset / design system) **relax** specific gates so intentional choices aren't punished.
- Steer authoring away from the tells in tool descriptions + guidelines, not just catch them after.

### User stories
- **US1** — As the authoring agent, I run `canvas_evaluate` and get a `cliche` category score + per-node tells, so I can de-cliché before showing the user.
- **US2** — As the authoring agent, I run `canvas_autofix` and get ready-to-paste ops for the *mechanical* tells (swap a default-purple accent, delete a fake-chrome row).
- **US3** — As the authoring agent working in a genre where a tell is intentional (e.g. the `material` preset is legitimately purple), the relevant gate is relaxed so I'm not nagged.
- **US4** — As the authoring agent, I read the guidelines / tool descriptions and avoid the tells *before* drawing — the catch-after is the safety net, not the primary mechanism.

### Functional requirements
| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-1 | **`cliche` category** in `evaluateCanvas` — a `checkCliche` returning `CheckResult` (score + issues), registered alongside the 5 craft checks; selectable via the `categories` filter; folded into `overallScore` via `CATEGORY_WEIGHTS`. | `evaluateCanvas` returns a `cliche` entry in `categories`; `categories: ['cliche']` runs it alone. |
| FR-2 | **Tell: default purple / indigo accent** — flag an accent color whose HSL hue is in the violet/indigo band with meaningful saturation, used as an accent (not a large background). | A canvas accented with `#6366f1` flags; a slate/blue accent does not. |
| FR-3 | **Tell: gradient / glow overuse** — flag when gradients exceed a threshold count/ratio, or a shadow reads as a colored glow/bloom (large blur + saturated/low-alpha color). | A design with 3+ gradients or a `blur:40` colored glow flags; one tasteful flat shadow does not. |
| FR-4 | **Tell: fake browser / phone / IDE chrome** — flag a traffic-light-dot cluster (≥3 small circles in a row, optionally red/yellow/green). | A card with three `#ff5f56/#ffbd2e/#27c93f` dots flags the chrome row. |
| FR-5 | **Tell: hanging "tag-left / heading-right" header** — flag a horizontal frame whose first child is a small eyebrow/pill and second is a large heading, not vertically reconciled. | The eyebrow-beside-heading arrangement flags (info); a stacked eyebrow-over-heading does not. |
| FR-6 | **Honest-content check** — flag fabricated-looking metrics / testimonials / logos in placeholder copy; suggest the labeled-placeholder convention (Phase 11 C8 "Metric — to confirm"). | `"99.9% uptime"`, `"— Jane Doe, CEO"`, a "TechCrunch" logo line flag with a placeholder suggestion. |
| FR-7 | **Auto-fix where mechanical** — tells with a deterministic fix carry an `AutoFix` (`op` + `rationale`), surfaced by `canvas_autofix`: swap a *known-default* accent hue; delete a fake-chrome row. | `canvas_autofix` returns those ops; taste-dependent tells (gradient, hanging header) carry a suggestion but **no** `fix`. |
| FR-8 | **Genre-aware loosening** — the active genre (from `canvas.metadata.provenance.preset`, overridable by a `genre` option) relaxes specific tells via a `RELAXED_BY_GENRE` map. | `material` genre suppresses the purple-accent tell; an explicit `genre: 'material'` does the same on an unstamped canvas. |
| FR-9 | **Guidelines + tool-description steering** — a "Cliché & craft" section in `docs/GUIDELINES.md`; `canvas_evaluate` / `canvas_autofix` descriptions name the `cliche` category and the tells. | GUIDELINES has the section; both tool descriptions add `cliche` to their category enum + prose. |

### Non-goals (explicit scope cuts)
- **No scored multi-axis rubric** — the structured critique with per-axis floors is Phase 13. This phase stays in the deterministic heuristic lane.
- **No content *generation*** — honest-content flags + suggests a labeled placeholder; it does not write replacement copy.
- **No new LLM call** — every tell is computable from the scene graph (+ existing render for `detailed`). The `llm` mode is untouched.
- **No taste enforcement** — taste-dependent tells (gradient, hanging header) are advisory; only the unambiguous mechanical ones autofix.

---

## 2. CLARIFY  (forks — resolved 2026-05-24)

- **C1 — One category or two (cliché vs honest-content)?** *Decided:* **one `cliche` category** with multiple sub-checks, including honest-content. Each issue carries a `tell` discriminator (`'accent-hue' | 'gradient-glow' | 'fake-chrome' | 'hanging-header' | 'honest-content'`) so they stay filterable/queryable. Rationale: avoids a second enum + a second `CATEGORY_WEIGHTS` re-balance, and honest-content *is* a machine-made tell. (See A-C1 for the `tell` field addition.)
- **C2 — Does `cliche` fold into `overallScore`, and at what weight/strictness?** *Decided (user-confirmed 2026-05-24):* **scored category, weight 15**, but tells default to `warning`/`info` severity (only fake-chrome is `warning`-leaning; none are hard `error`). So a single tell dents but never craters the category, and the headline score stays meaningful. The benchmark baselines are regenerated (`benchmark/run.ts --update`) since adding a weighted category shifts every corpus `overallScore` — that's an expected, reviewed delta, not a regression.
- **C3 — Where does "genre" come from?** *Decided:* primary signal is `canvas.metadata.provenance.preset` (Phase 11 stamp), with an explicit `genre?: string` option on `canvas_evaluate` / `canvas_autofix` to override (covers hand-built canvases with no provenance). A `RELAXED_BY_GENRE` map declares which tells each genre relaxes; today the only concrete entry is `material → ['accent-hue']` (Material Design is legitimately purple — verified `src/presets.ts:86`).
- **C4 — Purple/indigo detection precision + autofix target.** *Decided:* detect HSL **hue ∈ [255, 290]** with **saturation ≥ 0.35** used as an *accent* (a `stroke`, or a `fill` on a non-background node, or the `accent`/`accent-hover` token value) — *not* a full-bleed background (avoids flagging an intentional purple brand surface, which reads differently). **Autofix only for the canonical unconfigured defaults** (Tailwind `#6366f1`, `#818cf8`, `#8b5cf6`, `#7c3aed`, `#a855f7`, `#4f46e5`) → swap to a neutral recommended accent (`#2563EB`, blue-600); near-but-not-exact purples get a suggestion only (taste call). (See A-C2.)
- **C5 — Honest-content false-positive containment.** *Decided:* only inspect **short text** nodes (`content.length ≤ 60`); patterns: percentages (`\d+(\.\d+)?\s?%`), money (`[$€£]\s?\d`), multipliers (`\b\d+(\.\d+)?x\b`), star ratings (`\b[0-5]\.\d\s?★?\b` near rating words), large counts (`\d[\d,]*\+|\b\d+[KMB]\+?\b`), and testimonial attributions (`^[—–-]\s?\p{Lu}`). Logos: `image`/`text` nodes named/contented with a recognizable brand wordmark from a small curated list (TechCrunch, Forbes, Google, etc.) or generic "As seen in"/"Trusted by" rows. **Severity `info`** (advisory; mockups legitimately need *some* numbers). Suggestion points at the Phase 11 C8 convention. (See A-C3, A-C4.)
- **C6 — Fake-chrome autofix scope.** *Decided:* detect a cluster of **≥3 small circular nodes** (`type: 'ellipse'`, or `frame`/`rectangle` with `cornerRadius ≥ width/2`, `width ≤ 20`) that are **direct siblings in a horizontal-ish row**; bonus confidence if their fills are the mac traffic-light triad. Autofix = **`D(rowId)`** deleting the dots' *parent row* (the chrome strip), not the whole card. (See A-C5 on choosing the row vs the dots.)
- **C7 — Hanging-header confidence.** *Decided:* **info severity, no autofix.** Detect a `layout: 'horizontal'` frame with exactly 2 visible children where child[0] is a small eyebrow (`text` with `fontSize ≤ 14`, or a small badge frame with one short text) and child[1] is a heading (`text` with `fontSize ≥ 28`), and `alignItems` is not `center`/`baseline`. Suggest stacking vertically, left-aligned. Layout restructure is a judgment call → suggestion only. (See A-C6.)
- **C8 — Gradient/glow thresholds + autofix.** *Decided:* **gradient overuse** = more than **2** nodes with a `gradient`, *or* gradients on **> 25%** of frame/rectangle nodes (whichever triggers; min 2 frames to avoid div-by-small). **Glow** = a `shadows[]` entry (or `shadow` string) with `blur ≥ 24` **and** a chromatic color (parsed saturation > 0.25) **or** an alpha < 1 colored shadow. Severity `warning`. **No autofix** — flattening a gradient or removing a glow changes design intent; emit a suggestion ("use a flat `$surface` fill" / "drop the colored glow") instead. (See A-C7.)
- **C9 — CSS-string gradient/shadow forms.** *(added by analyze A-C7)* *Decided:* the gradient/glow check must also recognize the **CSS-string escape hatches** the renderer accepts (Phase 15: a raw string on `gradient`/`shadows`). Count a string `gradient` as one gradient; parse a string `shadow`/`shadows` for a glow heuristic best-effort (large px blur + a non-grey color token). Don't crash on a malformed string.

---

## 3. PLAN  (technical — mapped to real symbols)

### Color math: `src/evaluate.ts` (extend the existing color utils, lines 74–103)
Add an HSL helper next to `parseColor` / `contrastRatio`:
```ts
// returns { h: 0-360, s: 0-1, l: 0-1 } or null
export function rgbToHsl(rgb: [number, number, number]): { h: number; s: number; l: number };
// parse alpha too, for glow detection (#RRGGBBAA / rgba())
function parseAlpha(str: string): number; // default 1
```
`parseColor` already handles `#RGB`, `#RRGGBB(AA)`, `rgb()/rgba()`. HSL is derived from its output; no new parser needed.

### New checker: `checkCliche(entries, canvas, opts)` in `src/evaluate.ts`
Mirrors the existing `checkSpacing` / `checkColorContrast` shape (returns `{ score, issues }`). Internally runs the sub-checks and concatenates issues, each tagged `category: 'cliche'` + a new `tell` field:
- `tellAccentHue(entries, tokens, relaxed)` → FR-2 / C4 (skip if `'accent-hue'` relaxed by genre)
- `tellGradientGlow(entries)` → FR-3 / C8 / C9
- `tellFakeChrome(entries)` → FR-4 / C6 (with `D(...)` autofix)
- `tellHangingHeader(entries)` → FR-5 / C7
- `tellHonestContent(entries)` → FR-6 / C5

Scoring: start 100; each tell subtracts a per-severity penalty (`error` −25 reserved/unused, `warning` −12, `info` −6), clamp 0–100 (same pattern as `checkTypography`).

### Types: `src/evaluate.ts` `EvaluationIssue`
Add an optional discriminator so issues stay queryable without parsing the message:
```ts
export interface EvaluationIssue {
  category: string;
  tell?: 'accent-hue' | 'gradient-glow' | 'fake-chrome' | 'hanging-header' | 'honest-content';
  severity: IssueSeverity;
  // …unchanged…
}
```
(Optional → the 5 craft checks are unaffected; only `cliche` issues set it.)

### Wiring: `evaluateCanvas` (lines 607–705)
- Add `'cliche'` to `CATEGORY_WEIGHTS` (line 599) with weight **15**.
- Extend the options type: `{ mode; categories?; genre?: string }`.
- In the activeCategories block, add:
  ```ts
  if (activeCategories.includes('cliche')) {
    const genre = options.genre ?? canvas.metadata?.provenance?.preset;
    const relaxed = new Set(RELAXED_BY_GENRE[genre ?? ''] ?? []);
    results.set('cliche', checkCliche(entries, canvas, { relaxed }));
  }
  ```
  Use the **resolved** `entries` (post-`resolveVariables`) so `$accent` → real hex for hue math; cross-check token values too via `mergedTokens`.
- `RELAXED_BY_GENRE: Record<string, Tell[]> = { material: ['accent-hue'] }`.

### Tools: `src/index.ts`
- `canvas_evaluate` (913–953): add `'cliche'` to the `categories` z.enum (923); add optional `genre: z.string().optional()`; pass `genre` into `evaluateCanvas`; extend the description (FR-9).
- `canvas_autofix` (956–988): add `'cliche'` to its `categories` z.enum (961); add optional `genre`; pass it through. The fix-filtering loop is generic (`issue.fix`), so mechanical cliché fixes flow through unchanged.

### Constants: known-default accents + brand wordmarks
Small module-level consts in `evaluate.ts`:
```ts
const DEFAULT_AI_ACCENTS = new Set(['#6366f1','#818cf8','#8b5cf6','#7c3aed','#a855f7','#4f46e5']); // lowercased
const RECOMMENDED_ACCENT = '#2563EB';
const BRAND_WORDMARKS = ['techcrunch','forbes','the verge','google','microsoft','wired','product hunt']; // honest-content logos
```

### Docs / conventions (CLAUDE.md rules)
- `README.md` Tools section — note the `cliche` category + `genre` option under `canvas_evaluate` / `canvas_autofix`.
- `docs/GUIDELINES.md` — new "Cliché & craft" subsection under (or beside) "After designing": list the tells + the de-cliché moves; cross-link `feedback_visual_design_bar` ethos (flat color, restraint).
- `VISION.md` — tick the Phase 12 checklist boxes.
- Tests redirect storage via `import './test-env.js'` (per CLAUDE.md) — though evaluate is pure, tests that persist canvases still need it.

### Benchmark: `benchmark/`
Adding a weighted category changes every corpus `overallScore` and adds a `cliche` category line → run `npx tsx benchmark/run.ts --update` to regenerate `baselines.json`; **review the diff** (expected: new `cliche` lines + shifted overall scores; no unexpected craft-issue churn). Optionally add one corpus entry exhibiting tells so the cliché checks have benchmark coverage.

---

## 4. TASKS  (atomic, PR-sized — one PR per task, per the PR-flow rule)

**Build order (A-T3):** T0 → T1 → {T2,T3,T4,T5,T6} → T7 → T8 → T9 → T10.

### Slice A — `cliche` category + scene-graph tells
- **T0** — `src/evaluate.ts`: add `rgbToHsl` + `parseAlpha` color utils (+ unit assertions in the test). Add the `tell?` field to `EvaluationIssue`. *(foundation; no behavior change yet)*
- **T1** — `src/evaluate.ts`: scaffold `checkCliche` returning `{score:100, issues:[]}`, register it in `evaluateCanvas` + `CATEGORY_WEIGHTS` (weight 15) + the `RELAXED_BY_GENRE` map + `genre` option plumbing. `src/index.ts`: add `'cliche'` to both tool enums + `genre` param. *(category exists, scores 100, nothing flags yet — keeps the diff reviewable)*
- **T2** — `tellAccentHue` (FR-2, C4) + genre relax for `material` + known-default autofix.
- **T3** — `tellGradientGlow` (FR-3, C8, C9) — structured + CSS-string forms; suggestion only.
- **T4** — `tellFakeChrome` (FR-4, C6) + `D(rowId)` autofix.
- **T5** — `tellHangingHeader` (FR-5, C7) — info, suggestion only.
- **T6** — Slice-A test (`test-cliche.ts`): one fixture per tell asserts it flags + the genre-relax suppresses purple + a clean design flags nothing. *(can fold T2–T5 asserts incrementally)*

### Slice B — honest-content + autofix surfacing
- **T7** — `tellHonestContent` (FR-6, C5) — metrics/testimonial/logo patterns, `info`, placeholder suggestion. Extend `test-cliche.ts`.
- **T8** — Verify `canvas_autofix` surfaces the mechanical cliché fixes (accent swap, fake-chrome delete) and *omits* the suggestion-only tells; add the assertion to the test. *(mostly a test + description task — the autofix loop is already generic.)*

### Slice C — steering + docs + benchmark
- **T9** — `docs/GUIDELINES.md` "Cliché & craft" section; `canvas_evaluate` / `canvas_autofix` tool-description prose (FR-9); `README.md` Tools updates.
- **T10** — `benchmark/run.ts --update` regenerate `baselines.json` (review diff); optional tell-exhibiting corpus fixture; tick `VISION.md` Phase 12 boxes.

---

## 5. ANALYZE  (read-only pass over every stage; findings folded upstream)

### 5.1 Analyze — SPECIFY
- **A-S1 [med]** FR-2..FR-6 named tells but Specify didn't pin the *acceptance* discriminators (what flags vs what doesn't). → Added a concrete "flags X, not Y" acceptance to each FR. *(fixed)*
- **A-S2 [med]** "Honest-content" risks high false positives on legitimate mockup numbers — Specify must state it's advisory. → FR-6 + non-goals state `info` severity / suggest-not-rewrite. *(fixed in §1, C5)*
- **A-S3 [low]** FR-8 genre source was unstated in Specify. → Named `provenance.preset` + `genre` override in the FR. *(fixed)*

### 5.2 Analyze — CLARIFY
- **A-C1 [HIGH]** Without a discriminator, downstream code (autofix filtering, genre relax, the viewer) would have to **string-match issue messages** to know which tell fired — brittle. → New **`tell` field** on `EvaluationIssue` (C1), set by every cliché sub-check. *(added)*
- **A-C2 [HIGH]** A blanket "purple is a tell" gate would flag **legitimate purple brands** and the `material` preset. → C4 narrows to *accent usage* (not backgrounds) + C3 genre-relax for `material`; autofix only for *exact unconfigured defaults*, near-matches get a suggestion. *(fixed in C3/C4)*
- **A-C3 [med]** Honest-content "fabricated metric" is undefined → unfalsifiable. → C5 enumerates the regex families + the ≤60-char short-text gate. *(fixed)*
- **A-C4 [med]** Honest-content "logos" had no detection path on a scene graph (images are opaque). → C5: match node *name*/*content* against a small brand-wordmark list + "As seen in / Trusted by" row labels; accept this is partial (images themselves stay opaque) and note it as a known limit. *(fixed; limit noted)*
- **A-C5 [low]** Fake-chrome autofix: delete the *dots* or the *row*? Deleting 3 dot nodes leaves an empty strip. → C6: delete the **parent row** (the chrome strip). *(fixed)*
- **A-C6 [med]** Hanging-header detection could fire on *any* horizontal eyebrow+heading, including intentional ones. → C7 requires the misalignment signal (`alignItems` not center/baseline) + `info` severity + no autofix, so it's a gentle nudge. *(fixed)*
- **A-C7 [HIGH — factual]** The gradient/glow check, if it only reads the **structured** `gradient`/`shadows`, **misses the CSS-string forms** the renderer now accepts (Phase 15 fix; memory ⭐ + `index.ts` gotchas). A design using `gradient: "linear-gradient(...)"` would slip the gate. → New **C9**: recognize the string escape hatches; parse best-effort, never crash. *(added)*

### 5.3 Analyze — PLAN
- **A-P1 [HIGH — factual]** Hue math must run on **resolved** colors. The plan must use the post-`resolveVariables` `entries`, not `rawEntries` — `checkColorContrast` already does (line 640 passes `entries`), but `checkSpacing`/`checkStructure` use `rawEntries`. → Plan pins `checkCliche` to `entries` (resolved) *and* cross-checks `mergedTokens` for the `accent` token value directly (an accent defined only in tokens but referenced via `$accent` resolves in `entries` anyway; checking the token too covers an unused-but-defined default). *(fixed in §3)*
- **A-P2 [med]** Adding `'cliche'` to `CATEGORY_WEIGHTS` silently changes **every** existing canvas's `overallScore` (normalized weighted avg over 6 not 5 categories) and breaks **every benchmark baseline**. → Plan calls out `benchmark/run.ts --update` as a required, reviewed step (T10); C2 states the score shift is expected. *(fixed)*
- **A-P3 [med]** The `genre` option threads through two tools + `evaluateCanvas`; if `provenance.preset` is set but the user passes no `genre`, the *stamped* preset must win as the default (don't ignore it). → §3 pins `options.genre ?? canvas.metadata?.provenance?.preset`. *(fixed)*
- **A-P4 [low]** `canvas_autofix`'s category enum + the `evaluateCanvas` call both need `'cliche'`; missing either makes `--categories cliche` on autofix silently empty. → Tasks T1 + T8 cover both; T6/T8 assert it. *(noted)*

### 5.4 Analyze — TASKS
- **A-T1 [med]** T1 bundling "category exists but scores 100" before any tell lands is deliberate — it isolates the **weighting/benchmark churn** (A-P2) into its own reviewable PR, separate from detection logic. Confirmed as a feature, not a smell. *(kept)*
- **A-T2 [low]** No task explicitly regenerated the benchmark; it was implied. → Added as **T10**. *(fixed in §4)*
- **A-T3 [low]** Build order unstated. → Added: T0 → T1 → {T2–T6} → T7 → T8 → T9 → T10. *(fixed)*
- **A-T4 [low]** T6 (Slice-A test) depends on T2–T5; safe to write asserts incrementally as each tell lands rather than one big test PR. → Noted in T6. *(noted)*

### 5.5 Cross-artifact
**Coverage matrix** — every FR maps to ≥1 task; no orphan tasks:

| VISION bullet | FR | Tasks |
|---|---|---|
| `cliche` category | FR-1 | T1, T6 |
| Detectable tells (purple / gradient-glow / fake-chrome / hanging header) | FR-2..FR-5 | T2, T3, T4, T5, T6 |
| Honest-content check | FR-6 | T7 |
| Auto-fix where mechanical | FR-7 | T2 (accent), T4 (chrome), T8 |
| Genre-aware loosening | FR-8 | T1, T2, T6 |
| Guidelines update | FR-9 | T9 |

**Contradictions:** none unresolved. The tension between "flag tells" and "don't punish intent" is resolved by genre-relax (FR-8/C3) + accent-vs-background narrowing (C4) + advisory severities (C2).
**Cross-phase:** XP-1 — reuses Phase 11's `metadata.provenance.preset` for genre (no new field); XP-2 — the `tell` discriminator + honest-content placeholder convention align with Phase 11 C8 and feed Phase 13's "restraint/specificity" rubric axes (keep tell names stable); XP-3 — relies on Phase 15's CSS-string gradient/shadow tolerance (C9) so the gate isn't bypassed by the escape hatch.
**Test coverage:** FR-1 → T1/T6; FR-2..FR-5 → T6 (one fixture per tell + a clean-design negative + genre-relax); FR-6 → T7; FR-7 → T8; FR-8 → T6.

### 5.6 Severity roll-up
- **3 HIGH:** A-C1 (`tell` discriminator), A-C2 (purple over-flagging), A-C7 (CSS-string gradient/shadow blind spot), A-P1 (resolved-color hue math). *(A-P1 counted with the HIGHs as a correctness item.)*
- **6 med, 6 low.** All folded upstream; none blocks the build after the fixes.

### 5.7 Verdict
After the analyze pass the chain is consistent. The two real correctness traps — flagging legitimate purple/`material` (A-C2) and missing the CSS-string gradient escape hatch (A-C7) — are closed by genre-relax + the accent-vs-background narrowing and by C9. One scoring decision (C2: weight 15 + advisory severities + benchmark regen) is surfaced for user confirmation in §6 before T1 lands, since it shifts the headline score. **Ready to build Slice A after §6 confirmation, starting T0.**

---

## 6. DECISIONS (user-confirmed 2026-05-24)
1. **Scoring model** — ✅ **Weighted, advisory severities.** `cliche` folds into `overallScore` at weight 15; tells are `warning`/`info`; benchmark baselines regenerated.
2. **Autofix aggressiveness** — ✅ **Mechanical fixes on.** Autofix swaps *known-default* purple accents + deletes fake-chrome rows; gradient/glow + hanging-header stay suggestion-only.
3. **Honest-content default** — ✅ **On by default at `info` severity.** Advisory; suggests the labeled-placeholder convention, never blocks.

All three match the spec's recommended path; nothing in §1–§5 changes. **Ready to build, starting T0.**
