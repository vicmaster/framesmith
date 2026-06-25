# Phase 19 — Viewer Refresh (surface the full feature set)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-06-25.
> Motivation: the viewer (`src/viewer.ts`, last meaningfully built around v1.2) predates Phases
> 12–18 + the v1.6.0 cliché expansion. It renders the *output* of all that work but exposes almost
> none of the *intelligence* behind it.

---

## 1. SPECIFY

### Problem
framesmith's pitch is "sketch the UI, **review it in a browser**, agree on the design before code."
The browser viewer is the human half of that loop — but it has fallen ~6 phases behind the engine.
Today `renderDetailPage` (`src/viewer.ts:688`) surfaces only: the render, breakpoint preview /
compare / fit, raw JSON, archive/delete, a small **provenance chip** (`metadata.provenance`), and a
lone **LLM-critique chip** (`metadata.critique`, present only if the agent ran `mode:'llm'` or
`canvas_revise`). Everything else framesmith now produces is invisible to a human reviewer:

- **Quality** — the heuristic `canvas_evaluate` (6 categories, 0–100) and all **10 cliché tells**
  (Phases 6/12/13, v1.6.0) are agent-only over MCP. A person browsing canvases never sees a score
  or a tell fire.
- **Design system** — the layered `$token` system (workspace▸project▸canvas) and imported design
  systems (Phases 4/9) are never shown; you can't see a canvas's palette, type scale, or radius.
- **Import & drift** — `report.layout` (table/grid/centered/geometry/stack-fallback), snapped vs
  literal colors, warnings, and `canvas_sync_from_url` drift (Phases 17/18) are nowhere.
- **Variety & history** — the per-project build log + diversification signal (Phase 11) is reduced
  to a one-line chip.

**North star:** a reviewer opens a canvas and sees, alongside the render, *why it's good or not* —
its score and the specific tells (click a tell, the offending node lights up in the preview), its
design tokens, and (for imported canvases) how it was reconstructed and whether it has drifted. The
gallery flags weak/imported/drifted canvases at a glance. All **read-only** — every canvas is still
authored through MCP; the viewer only reflects.

### Goals
- **A. Quality panel** — run fast (Chrome-free) `canvas_evaluate` in the viewer; show score,
  category bars, and the issue list with `tell` badges + suggestions; click-to-highlight nodes in
  the render. Plus a gallery score badge.
- **B. Design-system panel** — resolved tokens for the canvas (color swatches, type scale,
  spacing, radius) with the inheritance chain (which layer each token came from).
- **C. Import / provenance / variety panel** — `report.layout` map, snapped/literals/warnings,
  import source + drift status, and the project build-log/variety view. (Requires groundwork:
  persist the import report onto the canvas.)

### User stories
- **US1** — As a reviewer, I open a canvas and see "Quality 72/100" with the cliché tells listed
  (e.g. `eyebrow-rhythm ×1`, `slop-copy ×2`), each with its suggestion — no MCP call, no API key.
- **US2** — As a reviewer, I click a `slop-copy` issue and the offending text node outlines in the
  live preview and scrolls into view.
- **US3** — As a reviewer, I see the canvas's palette as swatches and its type scale, and that
  `$accent` was inherited from the *project* design system, not set on the canvas.
- **US4** — As a reviewer of an imported canvas, I see "Imported from `…/users`" with a `report.layout`
  summary (3 tables, 1 centered, 1 stack-fallback) and "Drift: 4%" if it was synced.
- **US5** — As a reviewer, the project gallery shows a score badge on each thumbnail and a marker on
  imported / drifted canvases, so I can spot what needs attention without opening each one.
- **US6** — As the maintainer, every new panel works in the standalone viewer too (the read-only
  mirror of registered repos), not just the MCP-embedded one.

### Functional requirements

| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-A1 | **Heuristic quality panel.** `renderDetailPage` runs `evaluateCanvas(canvas, { mode:'fast', genre: provenance.preset })` and renders overall score, per-category bars (spacing/color/typography/structure/consistency/cliche), and an issue list grouped by category. Cliché issues show their `tell` badge + severity + message + suggestion. | Opening any canvas shows a score and the live issue list; a canvas with cliché tells lists them with badges. No Chrome, no API key. |
| FR-A2 | **Click-to-highlight.** Each issue with a `nodeId` is clickable; clicking outlines the matching `[data-node-id]` element in the rendered preview (overlay box) and scrolls it into view. | Clicking an issue highlights the right node across all breakpoint frames; clicking again clears it. |
| FR-A3 | **Autofix affordance (display only).** Issues carrying a `fix` are marked "auto-fixable" so a reviewer knows `canvas_autofix` would resolve them. No mutation from the viewer (read-only contract). | Pure-black-ink / default-purple / fake-chrome issues show an "auto-fixable" tag; others don't. |
| FR-A4 | **Gallery score badge.** Each canvas card in the project grid shows its fast-eval overall score (computed lazily/cached); imported and never-rendered canvases handled gracefully. | The grid shows a score chip per canvas; an empty canvas shows no misleading score. |
| FR-B1 | **Design-system panel.** Resolve the canvas's effective tokens (server-side via `getCanvasTokens` / `resolveVariables`) and render: color swatches (name + hex), type scale (the `typography` tokens), spacing scale, radius scale. | The panel shows the canvas palette and scales; matches what the renderer actually used. |
| FR-B2 | **Inheritance attribution.** Each token notes which layer it resolved from (canvas / project / workspace / preset default). | A token set only at the project level reads "from project"; an overridden one reads "from canvas". |
| FR-C1 | **Persist the import report (groundwork).** The import tools (`canvas_import_html` / `canvas_import_url`) stamp their `ImportReport` (at least `layout`, `snapped`, `literals`, `warnings`, `importUrl`) onto `metadata.import`. Back-compat: absent on pre-existing canvases → panel hidden. | A freshly imported canvas carries `metadata.import`; the viewer reads it without re-importing. |
| FR-C2 | **Import panel.** When `metadata.import` exists: show the source (URL/snippet), a `report.layout` summary (counts by source, with `stack-fallback` flagged), and snapped/literals/warnings counts (expandable). | An imported canvas shows its layout reconstruction summary and warning count. |
| FR-C3 | **Drift status.** When a sync has run (`canvas_sync_from_url` result stamped on `metadata.import.drift`), show the last drift % and timestamp; a gallery marker when drift > a threshold. | A synced canvas shows "Drift 4%"; a drifted one is flagged in the gallery. |
| FR-C4 | **Build-log / variety panel (project scope).** Read `readBuildLog(projectId)` and show the recent entries + the diversification hint, so a reviewer sees how the project's canvases vary. | The project view lists recent build-log entries; works in both backends. |
| FR-D1 | **Standalone-viewer parity.** Every panel renders in the standalone viewer's mirror of registered repos (`src/aggregate.ts`), not only the MCP-embedded viewer. Pure computations (eval, token resolution) run anywhere; project-scoped reads (build log) resolve per mirrored repo. | A registered repo's canvases show quality + design-system panels in the standalone viewer. |
| FR-E1 | **Discoverability + docs.** README viewer section + screenshots updated; GUIDELINES notes the viewer now surfaces evaluation/tokens/import; this is human-facing (not an MCP surface) so the agent-docs guard doesn't apply, but the README claims must match. | README viewer section describes the panels; `test-discoverability` stays green (no new agent surface). |

### Non-goals (explicit scope cuts)
- **No editing from the viewer.** The read-only contract is load-bearing (positioning + safety).
  No "apply autofix" button, no token editing — display only. (A future authenticated-edit phase
  is out of scope here.)
- **No `mode:'detailed'` or `mode:'llm'` in the viewer.** Detailed needs Chrome per canvas (slow
  in a gallery); llm needs an API key + costs money. The viewer runs **fast** only; the existing
  stamped LLM critique chip stays for when an agent produced one.
- **No live re-import / re-render of node highlights from scratch** — highlighting reuses the
  already-rendered `data-node-id` DOM.
- **No new node types / renderer changes** — this phase is viewer-only (+ the FR-C1 metadata stamp
  in the import handlers).
- **No font-warning persistence** — surfacing font warnings needs a stamp the engine doesn't write
  today; noted as a possible later add, not taken here.

---

## 2. CLARIFY  (forks — recommendations; ★ = confirm in spec-PR review)

- **C1 — Where eval runs for the gallery.** ★ *Recommend lazy + cached*: compute fast-eval on
  detail-page open always; for the gallery, compute on first grid render and cache by canvas
  `id + mtime` (viewer already tracks mtime for live reload). Fast mode is <100ms but a 50-canvas
  grid × every reload would add up. Alternative (compute-on-demand via a tiny `/score/:id` fetch
  the card calls) is cleaner but adds client JS + routes — defer unless the cached path lags.
- **C2 — Highlight mechanism.** ★ *Recommend pure CSS/DOM overlay*: the preview renders inside an
  iframe/srcdoc per breakpoint; clicking an issue posts the `nodeId` to each frame which toggles an
  outline class on `[data-node-id="…"]`. No layout recompute. Cross-frame messaging is the only
  wrinkle (same-origin srcdoc → direct DOM access is fine).
- **C3 — Import report persistence shape.** ★ *Recommend `metadata.import = { source, importedAt,
  layout, snapped, literals, warnings, drift? }`* — a trimmed copy of `ImportReport` (drop the
  bulky `counts`), small + diffable, lives in the open metadata bag like provenance/critique. The
  on-disk asset-externalization already keeps JSON small; this adds little.
- **C4 — Drift storage.** ★ *Recommend stamping `metadata.import.drift = { percent, at }` on each
  `canvas_sync_from_url` run.* sync today computes drift ephemerally and mutates nothing
  (by design); this is the one deliberate write, gated to imported canvases. Keep sync's "never
  mutates the design" property — `drift` is metadata, not design.
- **C5 — Panel layout (UX).** ★ *Recommend a right-hand collapsible inspector* on the detail page
  with tabs/sections (Quality · Design system · Import), preserving the existing toolbar + preview.
  Avoids a redesign of the detail page; the panel is additive and collapsible (default open on
  Quality).
- **C6 — Build-log scope in the standalone viewer.** The build log is per-project per-backend;
  `readBuildLog` resolves against the active store. In the standalone aggregate, each mirrored repo
  has its own `.framesmith/<project>/build-log.json`. *Recommend* the variety panel read the
  mirrored repo's log via the same repo-store path used for the mirror; if not trivially available,
  ship FR-C4 in the MCP-embedded viewer first and follow up for the mirror (documented gap, not a
  silent one).

---

## 3. PLAN  (technical — mapped to real symbols)

### Slice A — Quality panel + gallery score (`src/viewer.ts`, `src/evaluate.ts`)
- Import `evaluateCanvas` into `viewer.ts`. In `renderDetailPage`, call it (fast, genre from
  `canvas.metadata?.provenance?.preset`) and render a **Quality** section: overall score, six
  category bars, grouped issue list. Reuse `EvaluationIssue` fields (`category`, `tell`, `severity`,
  `nodeId`, `nodeName`, `message`, `suggestion`, `fix`).
- Highlight: a small inline script — clicking an issue (`data-issue-node="<id>"`) toggles
  `.fs-highlight` on `[data-node-id="<id>"]` in each preview frame (the render already emits
  `data-node-id`, `src/renderer.ts:233`). Outline via injected CSS.
- Gallery: in the project grid renderer, compute + cache fast-eval per canvas (keyed by id+mtime)
  and render a score chip on each card. Graceful for empty canvases (skip).
- Keep the existing `verdictChip` (LLM) — relabel as "LLM critique" to disambiguate from the new
  heuristic score.

### Slice B — Design-system panel (`src/viewer.ts`, `src/workspaces.ts`, `src/variables.ts`)
- Resolve effective tokens server-side: `getCanvasTokens(canvas)` (+ the layer sources). Render a
  **Design system** section: swatches (colors), type scale (typography tokens — fontSize/weight/
  family), spacing, radius.
- Inheritance: determine each token's origin layer by comparing canvas vs project vs workspace vs
  preset maps (the same precedence `resolveVariables` uses). Label per token.

### Slice C — Import / provenance / variety (`src/import.ts`, `src/index.ts`, `src/viewer.ts`, `src/repo-store.ts`)
- **Groundwork (FR-C1):** in the import handlers (`finishImport` in `src/index.ts`), stamp a trimmed
  report onto `metadata.import` (C3 shape). `canvas_sync_from_url` stamps `metadata.import.drift`
  (C4).
- Viewer **Import** section: render source + `report.layout` summary (counts per source; flag
  `stack-fallback`) + snapped/literals/warnings (collapsible) + drift status.
- Viewer **Variety** (project scope): `readBuildLog(projectId)` → recent entries + diversification
  hint; render in the project view.
- Gallery markers: imported-source icon + drift flag on cards.

### Cross-cutting
- Shared panel CSS in the viewer's existing `<style>` block; collapsible inspector (C5).
- Standalone-viewer parity (FR-D1): panels driven by pure functions render in the
  `aggregate.ts` path unchanged; build-log per mirrored repo per C6.

### Tests
- `test-viewer-panels.ts` (pure, no browser): given a canvas fixture, assert the detail HTML
  contains the score, the expected tell badges, swatch markup, and (with `metadata.import`) the
  layout summary; assert highlight wiring (`data-issue-node` ↔ `data-node-id`) is present.
- Reuse existing cliché fixtures to assert tells render in the panel.
- `test-import-*.ts` extend: assert `metadata.import` is stamped after import; sync stamps `drift`.
- Manual: run the standalone viewer against a bound repo, eyeball each panel (the
  `test-viewer.ts` harness never exits — run standalone, per the harness caveat).

---

## 4. TASKS  (slice-ordered; each independently PR-able)

**Slice A — Quality panel + gallery score**
- [ ] A1: detail-page Quality section (fast eval, score, category bars, grouped issues + tell badges + suggestions + auto-fixable tag)
- [ ] A2: click-to-highlight (issue ↔ `data-node-id`, overlay outline, scroll-into-view)
- [ ] A3: gallery score badge (cached by id+mtime); empty-canvas handling
- [ ] A4: tests (`test-viewer-panels.ts`) + README viewer section/screenshot

**Slice B — Design-system panel**
- [ ] B1: resolve effective tokens + render swatches / type / spacing / radius
- [ ] B2: inheritance attribution per token
- [ ] B3: tests + README

**Slice C — Import / provenance / variety**
- [ ] C1: groundwork — stamp `metadata.import` in import handlers; `drift` on sync
- [ ] C2: Import panel (source, report.layout summary, snapped/warnings, drift)
- [ ] C3: Variety panel (build log + diversification) + gallery markers
- [ ] C4: standalone-viewer parity pass; tests + README

**Close-out**
- [ ] Refresh `docs/framesmith-canvas.png` / `framesmith-dashboard.png` to show the new panels; VISION Phase 19 ticks; release is Victor's call

---

## 5. ANALYZE  (risks & edge cases)

- **Read-only contract is load-bearing.** Every panel is display-only. The one deliberate write is
  FR-C1/C4 metadata stamping, and that happens in the *import/sync engine*, not the viewer — the
  viewer never mutates. Keep `canvas_sync_from_url`'s "never mutates the design" property: `drift`
  is metadata, not a node change.
- **Gallery eval cost.** Fast eval is <100ms but N canvases × frequent live-reloads could add up;
  C1's id+mtime cache bounds it. If it still lags, fall back to on-demand `/score/:id`.
- **Highlight across breakpoints.** The preview shows multiple frames; highlighting must target the
  node in each frame, and the frames are re-rendered HTML — the `data-node-id` is stable, so a class
  toggle suffices. Compare/fit modes must not break the wiring.
- **Stale viewer harness.** `test-viewer.ts` is interactive and never exits, and GET `/` collides
  with the live viewer on :3001 — keep automated panel tests pure (HTML-string assertions); run the
  interactive harness standalone only.
- **Back-compat.** Pre-existing canvases have no `metadata.import`; the Import panel hides cleanly.
  Canvases that were never evaluated still get a live score (eval is computed, not stored).
- **Genre relax consistency.** The viewer must pass the provenance preset as `genre` so the score it
  shows matches what the agent sees from `canvas_evaluate` (else a material canvas would show purple
  tells in the viewer that the agent's run suppressed).
- **Don't regenerate benchmark baselines** — no evaluator logic changes here (the standing lesson);
  the viewer only *calls* `evaluateCanvas`.
- **Scope creep into editing.** The natural next ask after "show me the score + autofixable tag" is
  "fix it from here" — explicitly deferred to a future authenticated-edit phase to keep this one
  read-only and shippable.
