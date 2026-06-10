# Phase 18 — Structural Reconstruction (from issue #92)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-06-10.
> Source: issue #92 (dogfooding the v1.4.0 import on a real Rails + Tailwind v4 admin screen).
> Builds directly on Phase 17 (`src/import.ts`): the styling layer is done — this phase is the
> layout layer.

---

## 1. SPECIFY

### Problem
The import's styling fidelity is proven (`literals: []`, fonts/icons fully matched on a real
User Management screen) but **structural layout flattens**: `<table>` loses its columns
(header + cells stack vertically full-width), CSS `grid` degrades to a vertical stack
(a Phase 17 known cut), and centered/`max-width` containers spread full-bleed. App UIs are
dominated by exactly these three shapes — tables, grids, centered cards — so imports of
data-dense screens arrive as "great styling, wrong structure" and need hand-fixing.

Adjacent hygiene bug (same dogfood session): the Tailwind intent mapper misreads
`border-collapse` → a bogus `$collapse` stroke ref and a custom font-size utility
(`text-body-sm`) → a bogus `$body-sm` color ref, each producing a noisy
"token not defined" warning.

**North star:** importing an admin page produces a canvas whose table is a real
column structure, whose grid is rows-of-columns, and whose sign-in card is centered at
its `max-width` — presentable as the design-of-record with only light finishing, and a
`report.layout` that says how each structure was reconstructed.

### Goals
- **A. Hygiene + groundwork** — kill the bogus-ref warning class structurally; extend the
  walker's captured-style whitelist with the layout signals B–D need.
- **B. `<table>` semantics** — table/thead/tbody/tr/th/td → a vertical frame of horizontal
  row frames with proportional cell widths and row dividers.
- **C. Grid + centered containers** — `display: grid` → rows-of-columns from the computed
  template; `max-width`/auto-margin/flex-center → centered frames at their real width.
- **D. Geometry-clustering fallback + `report.layout`** — when the CSS mechanism isn't
  modeled, recover rows/columns from computed bounding boxes; every reconstruction
  decision lands in the report.

### User stories
- **US1** — As the authoring agent, I import the User Management screen and the table comes
  back as 4 columns: header row, then rows of [avatar+name | source chip | status | role
  select] — not a vertical stack of cells.
- **US2** — As the authoring agent, a sign-in page (`flex items-center justify-center` +
  `max-w-md` card) imports as a centered card at ~448px, not a full-width band.
- **US3** — As the authoring agent, a bento dashboard (`grid-cols-12`, `col-span-*`)
  imports as rows of proportional columns.
- **US4** — As the maintainer, `report.layout` tells me which containers were reconstructed
  semantically (table/grid/centered), which by geometry clustering, and which fell back to
  a stack — the same honesty contract as `snapped`/`literals`.
- **US5** — As the authoring agent, importing a Tailwind page never produces a warning
  about a `$token` that was never a design token (`$collapse`, `$body-sm`).

### Functional requirements

| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-A1 | **Revert-to-computed for unresolvable refs.** When `snapToTokens` meets a `$ref` that doesn't resolve AND `report.snapped` records the computed value it overrode (`from !== '(unstyled)'` — CSS ran, ground truth exists), restore the computed value, drop the snapped entry, emit no warning. Speculative refs survive (with the existing warning) only when they came from an unstyled snippet. | The #92 repro import emits zero unresolved-token warnings; a bare-snippet `bg-surface` still keeps its `$surface` ref + warning. |
| FR-A2 | **Border-utility blocklist.** `border-collapse/separate/solid/dashed/dotted/double/hidden/none` and `border-spacing-*` never reach the color branch. | `classesToProps(['border-collapse'])` maps nothing. |
| FR-A3 | **Walker capture extensions.** Add to the style whitelist: `borderBottomWidth/Style/Color` (row dividers), `maxWidth`, `marginLeft/Right` (auto-margin centering resolves to equal px), `gridTemplateColumns`, `gridRowGap`/`gridColumnGap` already covered by row/columnGap, `gridColumnStart/End` (spans). All long-stable CSSOM names; the Node side stays the only consumer. | Fixture walkers carry the new keys; no behavior change yet. |
| FR-B1 | **Table reconstruction.** `<table>` → vertical frame (width `'100%'`); `<thead>/<tbody>/<tfoot>` unwrap (structural noise); each `<tr>` → horizontal frame (width `'100%'`, `alignItems: 'center'`); each `<td>/<th>` → cell frame whose width is the **percentage** of the row's content width its computed box occupies (C1). `<th>` content keeps its computed type styles (the uppercase/tracking header look arrives for free). `<caption>` → a text node above. | The #92 fixture's table imports as header row + N data rows × 4 proportional columns; a re-render visually matches the source columns. |
| FR-B2 | **Row dividers.** A `<tr>`/`<td>` bottom border becomes a 1px-high full-width divider frame between row frames (fill = the border color) — exact horizontal rule, no fake side borders (C2). | Divider frames appear between rows with the source's border color; none after the last row unless the source had one. |
| FR-C1 | **Grid reconstruction.** `display: grid` containers read the computed `grid-template-columns` (a resolved px list) → column count + track widths; children chunk row-major into horizontal row frames (gap = column-gap, rows gap = row-gap); a child spanning k tracks (`grid-column` span or a rect ≈ k track widths) occupies proportional width. Falls back to D when the template is irregular (`auto-fit` leftovers, named lines beyond spans). | A `grid-cols-3` fixture imports as rows of 3 proportional columns; a `col-span-2` child is ~2/3 width; an unparseable template routes to geometry clustering, not a silent stack. |
| FR-C2 | **Centered containers.** Two detections: (1) equal nonzero computed left/right margins + child narrower than parent content → parent gets `alignItems: 'center'` (vertical flow), child keeps its real width; (2) computed `maxWidth` ≠ none → child gets `width: '100%'` + `maxWidth` px (the renderer's fluid idiom). Flex-center parents already map — the fix is the CHILD no longer stretching (today `widthFor` leaves mid-size widths undefined → stretch). | The sign-in fixture imports as a centered ~448px card; the marketing-page `max-w-7xl mx-auto` shell imports centered and fluid. |
| FR-D1 | **Geometry clustering fallback.** For a container whose mapped layout is a single column but whose children's computed rects form ≥2 columns in ≥1 y-band (overlap ≥ 50% of the shorter box), rebuild: sort by y, group into row bands, x-sort within bands → vertical frame of horizontal row frames; infer gaps from rect spacing. Mechanism-agnostic — recovers floats, inline-block grids, odd CSS. Guarded: only when band structure is consistent (≥2 rows agreeing on column count ±1, or a single multi-item band), never inside an already-reconstructed table/grid. | A float-based 3-column fixture (no flex/grid) imports as rows-of-3; a genuinely vertical page is untouched (no false clustering). |
| FR-D2 | **`report.layout`.** Every reconstruction decision: `{ nodeId, source: 'table' \| 'grid' \| 'centered' \| 'geometry' \| 'stack-fallback', detail }`. `stack-fallback` (a multi-column-looking container the engine could NOT reconstruct) also adds a warning. The Phase 17 "grid → vertical + warning" path is replaced by real handling; the warning remains only for the fallback case. | The #92 import's report shows `table` + `centered` entries; a deliberately pathological grid shows `stack-fallback` + warning. |
| FR-E1 | **Discoverability** (the standing rule): docstrings, server instructions, README (the mapping table gains table/grid/centered rows), GUIDELINES — same PR as each slice. | An MCP-connected agent learns tables/grids/centering import structurally, and that `report.layout` is where to look. |

### Non-goals (explicit scope cuts)
- **No `rowspan`, no nested-table refinement** — a rowspan cell maps to its first row (warning); nested tables reconstruct independently.
- **No absolute-position reconstruction** — absolutely-positioned overlays keep Phase 17 behavior (reported, not reconstructed).
- **No per-side borders in the renderer** — row dividers are hairline frames (C2); a renderer `strokeSides` capability is noted as a possible future expressivity item, not taken here.
- **No subgrid / named grid areas / RTL** — degrade through D.
- **No sticky/fixed chrome handling** — sticky headers import at their static position.

---

## 2. CLARIFY  (forks — recommendations; ★ = confirm in spec-PR review)

- **C1 — Cell widths: percentage vs pixels.** ★ *Recommend percentages* (of the row's
  content width, from the computed `<td>` boxes): keeps the imported table fluid at other
  canvas widths — matching both the GUIDELINES width-strategy rule and how the Phase 16
  `data-table` scaffold is built (40/20/25/15%). Pixels would pixel-match the source
  viewport but break reflow. Percentages round to 1 decimal; the row is the 100% basis.
- **C2 — Row dividers: hairline frames vs row stroke.** ★ *Recommend hairline frames*
  (height 1, `width: '100%'`, fill = border color): visually exact — a row `stroke` would
  draw side/top borders that don't exist in the source. Cost: +1 node per row, bounded by
  the existing 2,000-node cap. A renderer `strokeSides` prop would be cleaner long-term;
  out of scope (non-goal) to keep this phase renderer-untouched.
- **C3 — Clustering thresholds.** Band membership = vertical overlap ≥ 50% of the shorter
  rect; reconstruct only when ≥2 bands agree on column count (±1) or a single band has ≥2
  items wider than 64px each. Conservative on purpose — a false row grouping is worse than
  a stack (the fallback is honest, a wrong reconstruction lies). Tunable constants in one
  place, documented in the spec tests.
- **C4 — Where reconstruction runs.** All in the pure side (`domToSceneGraph` /
  post-passes in `src/import.ts`) — rects are already in `RawDomNode`, so every algorithm
  is fixture-testable without Chrome, same as Phase 17.
- **C5 — Order of passes.** Semantic first (table → grid → centered), geometry clustering
  only on containers no semantic pass claimed, flatten last (wrapper collapse must not
  erase a reconstructed row frame — reconstructed frames get layout props, so
  `isPlainWrapper` already spares them; verified in tests).
- **C6 — `$body-sm`-class misreads beyond FR-A1.** The revert rule fixes the *warning*;
  the mapper still can't know `text-body-sm` is a size, not a color. *Recommend leaving
  it* — with FR-A1 the ref self-corrects on URL imports (computed ground truth) and
  custom-theme users can pass `tailwind.theme` for snippet imports. A heuristic
  ("names ending in -sm/-lg are sizes") would guess; we don't guess.

---

## 3. PLAN  (technical — mapped to real symbols)

### Slice A — hygiene + groundwork
- `src/tailwind-map.ts`: `BORDER_NON_COLOR = new Set(['collapse','separate','solid','dashed','dotted','double','hidden','none'])`
  checked before `setColor('stroke', …)`; skip `border-spacing-*`.
- `src/import.ts` `snapToTokens`: on an unresolved `$ref`, look up `report.snapped` for
  `(nodeId, prop)`; if found with `from !== '(unstyled)'` → restore `from` onto the node,
  remove the snapped entry; else keep today's warning. (The snapped entry is the undo log —
  no new bookkeeping.)
- `STYLE_WHITELIST` += `borderBottomWidth`, `borderBottomStyle`, `borderBottomColor`,
  `maxWidth`, `marginLeft`, `marginRight`, `gridTemplateColumns`, `gridColumnStart`,
  `gridColumnEnd` (whitelist is the walker's entire contract — no walker logic change).

### Slice B — tables (`src/import.ts`, pure)
- In `convert()`: `table` branch before the generic frame path. Children pipeline:
  unwrap `thead/tbody/tfoot`, collect `tr`s in document order (header rows first
  naturally). Each `tr` → `{ type:'frame', layout:'horizontal', width:'100%',
  alignItems:'center', gap:0 }`; each `td/th` → cell frame with
  `width: pct(cell.rect.w / rowContentWidth)` (C1), padding from computed cell padding,
  recursing normally for content. Row divider (FR-B2): when the `tr` (or its cells) carry
  `borderBottom*`, append `{ type:'frame', width:'100%', height: borderBottomWidth,
  fill: borderBottomColor }` after the row. `report.layout` entry per table.
- `colspan`: cell `rect.w` already reflects it — proportional width handles it free.

### Slice C — grid + centering (pure)
- Grid branch replaces the Phase 17 "grid → vertical + warning":
  parse computed `gridTemplateColumns` ("150.5px 320px 320px" — resolved px) → tracks.
  Children → row-major chunks (span k = `gridColumnEnd − gridColumnStart` when numeric,
  else `round(rect.w / trackWidth)`); rows → horizontal frames (gap = columnGap), grid →
  vertical frame (gap = rowGap); cell width = sum of its tracks as a percentage.
  Unparseable template (contains `repeat(`-leftovers, fr-mixed irregularity after
  resolution — rare since computed values resolve) → hand off to Slice D clustering.
- Centering pass (runs on every frame after `frameProps`):
  `marginLeft === marginRight` (px, > 0) && child.rect.w < parent content width − 8 →
  parent `alignItems: 'center'` + child width = `rect.w` (or `'100%'` + `maxWidth` when
  FR-C2(2) applies). `maxWidth` ≠ `none` → `width: '100%'`, `maxWidth: px`. Fixes the
  `widthFor` stretch case without touching its '100%'/fixed rules.

### Slice D — clustering + report (pure)
- `clusterChildren(children: RawDomNode[]): RawDomNode[][] | null` — y-sort, band by
  ≥50% overlap, x-sort within band; return null unless C3's consistency guards pass.
- Applied in `convert()` for containers with no flex/grid/table mapping whose children
  cluster into ≥2 columns; emits rows-of-columns frames, `report.layout` `geometry` entry.
  Containers that LOOK multi-column (≥2 children sharing a band) but fail the guards →
  `stack-fallback` entry + warning.
- `ImportReport` += `layout: { nodeId, source, detail }[]` (wired through all three tools —
  import_html, import_url, sync's report passthrough).

### Tests (fixture-first, no Chrome for the algorithms)
- `test-import-structure.ts` — fixtures: the #92 user-table shape (header + rows × 4 cells
  with realistic rects), divider borders, colspan; `grid-cols-3` + `col-span-2`;
  margin-auto card, `max-w-md` inside flex-center; float-based 3-col (clustering); a
  pathological irregular grid (stack-fallback + warning); flatten-doesn't-eat-rows.
- `test-tailwind-map.ts` — extend: `border-collapse` maps nothing; revert-to-computed
  vs keep-for-snippet paths.
- `test-import-html.ts` / `test-import-url.ts` — extend with a real `<table>` +
  centered-card end-to-end (Chrome): re-render and assert column geometry via
  `snapshot_layout`-style rect checks.
- Acceptance fixture: ask Victor for the issue's offered User Management HTML + report
  JSON; commit under `test-fixtures/` as the canonical repro.

---

## 4. TASKS  (slice-ordered; each independently PR-able)

**Slice A — hygiene + groundwork**
- [ ] A1: border-utility blocklist + revert-to-computed unresolved-ref handling
- [ ] A2: STYLE_WHITELIST extensions (walker contract only)
- [ ] A3: tests (tailwind-map extensions; revert paths) + docs touch

**Slice B — tables**
- [ ] B1: table/tr/td branch + proportional cell widths + thead/tbody unwrap + caption
- [ ] B2: divider frames; report.layout entries
- [ ] B3: fixtures + Chrome e2e; docs (README mapping table row)

**Slice C — grid + centering**
- [ ] C1: gridTemplateColumns reconstruction + spans; replace the Phase 17 grid warning path
- [ ] C2: margin-auto / maxWidth / flex-center child sizing
- [ ] C3: fixtures + e2e; docs

**Slice D — clustering + report**
- [ ] D1: clusterChildren + guards + stack-fallback warnings
- [ ] D2: report.layout wiring through all three import tools
- [ ] D3: fixtures (incl. false-positive guards); docs; VISION ticks

**Close-out**
- [ ] Re-import the #92 fixture end-to-end; comment on #92 with the before/after; release is Victor's call

---

## 5. ANALYZE  (risks & edge cases)

- **Wrong reconstruction is worse than no reconstruction.** A table that *looks* right but
  groups cells into the wrong rows actively misleads. Hence C3's conservative guards, the
  honest `stack-fallback`, and `report.layout` as the audit trail. Tests include
  false-positive fixtures (genuinely vertical content that must NOT cluster).
- **Percentage rounding drift.** Cell percentages rounding to 1 decimal can sum to ≠100%;
  the last cell absorbs the remainder.
- **Flatten interaction (C5).** `collapseWrappers` must not collapse reconstructed row
  frames (they carry `layout`, so `isPlainWrapper` spares them) and `mergeTextRuns` must
  not merge across cell boundaries (cells are frames — it can't). Covered by fixtures.
- **Node-count pressure.** Tables add divider frames; a 50-row table ≈ 50 extra nodes —
  fine under the 2,000 cap, but the cap warning should name the table when truncation
  bites mid-table.
- **Computed grid values vary.** `grid-template-columns` computes to resolved px in
  Chrome for laid-out grids — but `auto`/content-sized tracks resolve per actual content,
  which is exactly what we want (the rects agree). `subgrid`/`masonry` → D fallback.
- **`min-h-screen` heights.** The sign-in parent's computed height = viewport; importing
  it as a fixed height is correct for the captured viewport — `report.layout` notes
  `centered` so the finisher knows the intent.
- **Benchmark baselines untouched** — no evaluator changes (the standing Phase 12 lesson).
