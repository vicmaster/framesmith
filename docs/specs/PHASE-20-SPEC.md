# Phase 20 — Generative Taste (pattern library + craft guidance + relentless loop)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-06-26.
> Builds on the cliché guardrails (Phase 12, v1.6.0) and the existing structures system
> (Phase 11/16, `src/structures.ts` + `list_structures`/`apply_structure`).

---

## 1. SPECIFY

### Problem
framesmith is good at catching slop — the `cliche` tells, `canvas_evaluate`, the viewer Quality panel — but weak at **proactively producing taste**. From a blank canvas the agent invents layout from nothing and often lands on a generic or poor result. The honest workaround today is corrective: bring in an external reference (a pasted snippet via `canvas_import_html`) to anchor the agent's intent. That works, but it means framesmith can't yet stand on its own as a design tool — it has the **judge** half (evaluate / autofix / revise) without a strong **generate** half.

The seed of the fix already exists: the structures system stamps starting layouts (`list_structures` / `apply_structure`, 6 page archetypes + 5 component scaffolds in `src/structures.ts`). But the set is small, utilitarian, and not vetted to a quality bar — so the agent doesn't reliably reach for it, and what it stamps isn't guaranteed to be good.

**North star:** a from-scratch request ("design a pricing page") produces a non-slop design **without leaving framesmith** — the agent starts from a genuinely excellent, vetted pattern, adapts it with explicit craft rules, and self-corrects against the score before showing anything.

### Goals
- **A. Pattern library** — expand and elevate `src/structures.ts` into a curated set of real page archetypes that each pass the cliché/quality bar out of the box.
- **B. Craft guidance (the "do's")** — positive design rules (hierarchy, rhythm, type scale, focal point, restraint) on the agent surfaces, as the complement to the anti-slop "don'ts" the cliché tells already encode.
- **C. Relentless loop** — make generate → evaluate → revise the *default* path so the agent doesn't surface sub-bar designs.
- **D. Quality gate on the library itself** — every shipped pattern is regression-tested to score ≥ a bar with zero cliché tells. The library must not ship slop.

### User stories
- **US1** — From "design a pricing page," the agent stamps a vetted pricing pattern, adapts copy/tokens, and the result scores ≥ 90 with no cliché tells — no external reference needed.
- **US2** — The agent picks a brief-appropriate pattern from a richer catalogue (auth, dashboard, settings, landing, data screen, onboarding…), not just the original six.
- **US3** — The agent applies craft rules (one focal point, a consistent type scale, generous spacing) because the guidelines teach the do's, not only the don'ts.
- **US4** — The agent auto-revises until the score clears the bar before presenting the design.
- **US5 (maintainer)** — A benchmark proves every library pattern scores ≥ bar with zero tells; CI fails if a pattern degrades.

### Functional requirements

| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-A1 | **Elevate existing structures.** The current page archetypes are re-vetted so each, stamped onto an empty canvas, scores ≥ the bar (C3) with zero cliché tells. | Each existing structure passes the FR-D1 benchmark. |
| FR-A2 | **Expand the catalogue.** Add the highest-frequency archetypes missing today (C2) — e.g. auth, dashboard, settings, pricing, onboarding/empty-state — built from `$tokens`, each vetted to the bar. | `list_structures` returns the expanded set; each new one passes FR-D1. |
| FR-A3 | **Adaptable, not stamped-and-done.** Each pattern returns its `idMap` (already the contract) and its content is placeholder-but-honest (labeled, no fabricated metrics) so the agent customizes rather than ships boilerplate. | Stamped patterns carry no `honest-content` / `slop-copy` tells. |
| FR-B1 | **"Designing with taste" guidance.** A positive-craft section in `docs/GUIDELINES.md` (hierarchy, type scale, spacing rhythm, one focal point, restraint, when to reach for a pattern) — paired with the existing cliché "don'ts". | GUIDELINES has the section; it references the pattern-first workflow. |
| FR-B2 | **Surface the do's where the agent reads them.** Fold the key rules into `INSTRUCTIONS` / `GOTCHAS` and the relevant tool docstrings (the standing discoverability rule). | An agent learns "start from a pattern, adapt, evaluate→revise" on connect, zero tool calls. |
| FR-C1 | **Default the loop.** Guidance (INSTRUCTIONS + GUIDELINES) makes generate → `canvas_evaluate` → fix/`canvas_revise` the documented default, not an afterthought; the agent targets ≥ bar before presenting. | The core-loop text on every surface includes the evaluate-and-revise step with a target score. |
| FR-D1 | **Library quality gate.** A benchmark stamps each pattern onto an empty canvas and asserts overall ≥ bar (C3) AND zero `cliche` issues, across ≥ 2 presets (C-tokens). | `npx tsx benchmark/*` (or a new `test-patterns.ts`) is green; a deliberately degraded pattern fails it. |
| FR-E1 | **Discoverability** (standing rule): new structures named in README; `test-discoverability` already enforces structures↔README — keep green and extend lists. | An MCP agent can enumerate the catalogue via `list_structures`; README names them all. |

### Non-goals (explicit scope cuts)
- **No magic generator.** framesmith renders + guides; the agent still authors the scene graph. This phase makes that authoring *start from taste*, not replace it.
- **No image generation** (separate Phase 14 item) — patterns use labeled placeholder media frames.
- **No homogenizing templates.** Patterns are adaptable scaffolds; the Phase 11 diversification signal stays, and guidance says adapt-don't-stamp.
- **No new rendering primitives** — patterns compose existing node types.
- **No forced paid API calls** — the relentless loop is guidance-first; `canvas_revise` (which costs calls) stays opt-in.

---

## 2. CLARIFY  (forks — recommendations; ★ = confirm in spec-PR review)

- **C1 — Form of the library.** ★ *Recommend elevating the existing structures system* (`src/structures.ts` + `list_structures`/`apply_structure`) rather than a new parallel "reference" system: agents already know it, `apply_structure` already re-keys IDs + returns an idMap, and the discoverability guard already covers structures↔README. A second system would fragment the surface.
- **C2 — Which archetypes first.** ★ *Recommend depth over breadth*: a focused set of the highest-frequency screens — **auth, dashboard, settings, pricing, landing, a data-table screen, an onboarding/empty state** — each excellent, over a long shallow list. Expand later.
- **C3 — The bar.** ★ *Recommend overall ≥ 90 AND zero `cliche` issues* for every shipped pattern, enforced by FR-D1. 90 matches the "aim ≥ 90" already in the core-loop guidance; zero tells is the non-negotiable (a pattern with a tell would *teach* slop).
- **C4 — Craft-guidance home.** ★ *Recommend `docs/GUIDELINES.md` as the canonical "Designing with taste" section*, with one-line distillations in `INSTRUCTIONS`/`GOTCHAS`. Mirrors how the cliché "don'ts" are documented.
- **C5 — How relentless is the loop.** ★ *Recommend guidance-first*: make evaluate→revise the documented default and target a score, but don't force `canvas_revise` (it costs API calls). A future convenience could chain generate→evaluate→autofix in one call; noted, not taken here.
- **C6 — Variety vs templates.** Keep the diversification signal (Phase 11) and state in guidance that patterns are *starting points to adapt* — vary copy, structure, and which pattern, so successive screens don't converge.
- **C7 — Theme-robustness.** Patterns must look good beyond one palette → FR-D1 tests across ≥ 2 presets; patterns reference `$tokens`, never hardcoded brand colors.

---

## 3. PLAN  (technical — mapped to real symbols)

### Slice A — library expansion + elevation (`src/structures.ts`)
- Re-vet the existing page archetypes (marquee-hero, bento-grid, stat-led, editorial-longform, split-workbench, catalogue) against the bar; fix any that carry tells (e.g. eyebrow rhythm, fabricated copy).
- Add the C2 archetypes as new `kind: 'page'` structures, composed from `$tokens` + existing node types (incl. Phase 16 controls/components where apt). Each returns an idMap via the existing `apply_structure` path.
- Keep content honest (labeled placeholders) so stamps carry no `honest-content`/`slop-copy` tells (FR-A3).

### Slice B — craft guidance (`docs/GUIDELINES.md`, `src/index.ts`)
- New "Designing with taste" section: the do's (hierarchy, type scale, spacing rhythm, one focal point, restraint, pattern-first), paired with the existing "Cliché & craft" don'ts.
- Fold one-liners into `INSTRUCTIONS` + `GOTCHAS` + the `apply_structure`/`canvas_create` docstrings (start-from-a-pattern; adapt; evaluate→revise to ≥ 90).

### Slice C — quality gate (`benchmark/`, new `test-patterns.ts`)
- A test that, for each structure × ≥ 2 presets: stamps onto an empty canvas, runs `evaluateCanvas` fast mode, asserts overall ≥ 90 and zero `cliche` issues.
- Add the patterns to `benchmark/` corpus; regenerate `baselines.json`.

### Slice D — relentless loop (guidance + optional convenience)
- Make the core-loop text on all surfaces include "evaluate → autofix → revise until ≥ 90 before presenting."
- (Optional, flagged) a convenience that chains generate→evaluate→autofix; only if guidance proves insufficient.

### Tests
- `test-patterns.ts` (FR-D1) — the library quality gate, pure (fast eval, no Chrome).
- `test-structures.ts` (if present) / `test-discoverability.ts` — extend lists for new structures.
- `test-cliche.ts` — unaffected (no tell changes).

---

## 4. TASKS  (slice-ordered; each independently PR-able)

**Slice A — library**
- [ ] A1: re-vet + fix existing page archetypes to the bar
- [ ] A2: add the C2 archetypes (auth / dashboard / settings / pricing / landing / data-screen / onboarding)
- [ ] A3: honest placeholder content; idMap parity; README names them

**Slice B — craft guidance**
- [ ] B1: GUIDELINES "Designing with taste" section
- [ ] B2: INSTRUCTIONS / GOTCHAS / docstring one-liners (pattern-first + loop)

**Slice C — quality gate**
- [ ] C1: `test-patterns.ts` — every pattern ≥ 90, zero tells, ≥ 2 presets
- [ ] C2: benchmark corpus + baselines regen

**Slice D — relentless loop**
- [ ] D1: default-loop guidance everywhere; (optional) chained convenience if needed

**Close-out**
- [ ] Dogfood: "design X from scratch" for a few briefs, confirm ≥ 90 with no external reference; VISION Phase 20 ticks; release is Victor's call

---

## 5. ANALYZE  (risks & edge cases)

- **The hard part is taste, not code.** A pattern that ships with a tell *teaches* slop — worse than no pattern. FR-D1's gate (≥ 90, zero tells, multi-preset) is the backstop; curation is the real work, done by eye + the benchmark.
- **Homogenization.** A pattern library risks every screen looking the same. Mitigated by the diversification signal + adapt-don't-stamp guidance + enough archetype variety. Watch the build-log variety hint.
- **Theme fragility.** A pattern tuned to one palette can fall apart on another. FR-D1 tests ≥ 2 presets; patterns must use `$tokens` only (no hardcoded brand colors), reusing the cliché tells' own color discipline.
- **Guidance adherence.** Telling the agent "start from a pattern + revise to ≥ 90" doesn't guarantee it does. The Quality panel (Phase 19 A) is the human safety net; if adherence is poor, escalate to the chained convenience (Slice D optional).
- **Scope creep into breadth.** Resist a 30-archetype catalogue; depth on the C2 set first. A shallow-but-wide library that's mostly mediocre defeats the purpose.
- **No benchmark drift from evaluator.** This phase doesn't change `evaluate.ts`; baselines move only because new corpus entries are added, not because scoring changed (the standing Phase 12 lesson).
