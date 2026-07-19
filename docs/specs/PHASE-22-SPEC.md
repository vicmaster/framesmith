# Phase 22 — Data-Dense Product Screens (v1.9)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-07-19.
> Source: issues #129–#136 — all filed from one dogfooding session building a financial results-and-pace dashboard.

---

## 1. SPECIFY

### Problem
A real dogfooding session — a data-dense financial dashboard with an app shell, a 17-row table, and a 4-series pace-to-goal chart — hit eight distinct walls, and they compound into one meta-problem: **framesmith is tuned for marketing-page design, and product screens are where design tooling actually gets used.** Concretely:

- **The chart got cut from the design** because every coordinate had to be hand-computed into `path` `d` strings, and the four series could only be told apart by colour — no dashing (#129, #132).
- **The app shell was rebuilt node-by-node (~35 ops)** despite an identical shell in a sibling canvas; the evaluator simultaneously scolds "no component instances found" while nothing in the authoring surface creates one (#130).
- **Row rules and accent bars aren't expressible** — the `gap: 1` fill-bleed hack renders right but fights the spacing linter (#131).
- **The >95 presentation bar is unreachable by construction**: 53 `honest-content` flags on the screen's own data (every money figure and percentage) zeroed the cliché category and pinned the overall at 70, and each flag — though `info` — is `directive`-blocking (#135).
- **Mechanical work the tools should do stayed manual**: `canvas_autofix` proposes op strings you re-paste and skips array-form padding (#133); nodes can only be addressed by hand-tracked ids, which caused a real wrong-node edit (#136); `fontFamily: "mono"` silently fell back to serif for a full build cycle, and `set_fonts` ignored the caller's family label for stylesheet URLs (#134).

Phase 22 closes the set: rendering primitives a product screen needs, an evaluator that can be calibrated to data-dense genres instead of forcing the marketing-page prior, and authoring ergonomics that scale to 300-node canvases.

### Goals
- **Draw product furniture natively**: per-side borders, dashed/dotted strokes, data-driven charts — no hand-computed `d` strings, no `gap: 1` hacks.
- **Reuse instead of rebuild**: promote a subtree to a component, instantiate it with overrides, copy across canvases.
- **Make the bar reachable for every genre**: realistic data and an app-matched type scale must be able to score >95 without deleting the design's reason to exist — while keeping the anti-slop teeth for marketing pages.
- **Close the mechanical loop**: autofix applies in place and covers all deterministic spacing forms; nodes are findable by property/name/text; font mistakes surface at authoring time.

### User stories
- **US1** — As the authoring agent, I emit `{ type: "chart", series: [...], yDomain: [0, 2700] }` and get a correct 4-series line chart; changing one data point is a one-op edit, and "projected" series are dashed.
- **US2** — As the authoring agent, I give a table row `borderTop: { width: 1, color: "$outline-variant" }` and the current-month row `borderLeft: { width: 3, color: "$primary" }` — no layout hacks, no linter fight.
- **US3** — As the authoring agent, I `create_component` on the app-shell frame once, then stamp `instance` nodes on 15 sibling canvases (via `copy_nodes` for the definition), overriding the active nav item per screen.
- **US4** — As the authoring agent on a dashboard canvas, I pass the genre and the evaluator scores craft — spacing, contrast, hierarchy — without flagging the dashboard's own figures, so >95 is reachable and the directive is trustworthy again.
- **US5** — As the authoring agent, I ask `find_nodes({ match: { fontSize: 30 }, type: "text" })` and get ids + names + paths instead of guessing which id was the value text and editing an icon.
- **US6** — As the authoring agent, `canvas_autofix` with `apply: true` snaps all 136 off-scale spacings — scalar and array — in one call, and tells me what it wrote.
- **US7** — As the authoring agent, `fontFamily: "mono"` renders monospaced, and if I typo a real family, the batch_design result warns me immediately — not three renders later.

### Functional requirements
| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-A1 | **Per-side borders** (#131) — `borderTop/borderRight/borderBottom/borderLeft: { width, color, style? }` on frames, composable with `stroke` (per-side wins on its side). | 17-row table gets 1px top rules per row with `gap: 0`; a row gets a 3px `$primary` left accent; evaluator raises no spacing flags for it. |
| FR-A2 | **Dash control** (#132) — `strokeDasharray` (string or number array, SVG syntax) on `path`; `style: "dashed" \| "dotted"` on per-side borders and a `strokeStyle` for the all-sides `stroke`. | A path with `strokeDasharray: "6 4"` renders dashed; a forecast card renders a dashed outline. |
| FR-B1 | **`find_nodes` tool** (#136) — property predicate (same `match` semantics as `replace_matching_properties`), plus `text` (substring, case-insensitive) and `name` (exact) conveniences, `scope`/`type` filters; returns `[{ id, type, name?, path }]` where `path` is the named ancestor chain. | `find_nodes({ text: "$1.52M" })` returns exactly the value text node with a human-readable path; never mutates. |
| FR-B2 | **Autofix applies** (#133) — `apply: true` on `canvas_autofix` executes the fix ops via the existing op executor and reports applied/failed per op; default `false` keeps today's propose-only behavior. | On a canvas with 25 fixables, `apply: true` leaves zero fixable issues on re-evaluate; result lists the 25 applied ops. |
| FR-B3 | **Array padding fixable** (#133) — array-form `padding` gets a fix op that writes the complete snapped array (every entry snapped to scale), removing the "would clobber the others" gap. | `padding: [9, 0, 9, 18]` yields fix op `U(id, { padding: [8, 0, 8, 16] })`. |
| FR-C1 | **Genre calibration for honest-content** (#135) — a data-genre (e.g. `dashboard`) relaxes the `honest-content` tell via the existing `RELAXED_BY_GENRE` mechanism; reachable via the `genre` param or provenance. | The 53-flag dashboard evaluates with zero honest-content flags under the genre and unchanged under default; marketing-page behavior untouched. |
| FR-C2 | **Type-scale pinning** (#135) — font sizes declared in the merged typography tokens form a pinned scale; the adjacent-ratio check skips pairs where both sizes are pinned. Fix the code/message mismatch (code flags ratio < 1.1, message claims 1.15–1.75). | Declaring 14/13/12/11 as typography tokens clears the ratio warnings; undeclared 16→15 still flags. |
| FR-C3 | **Directive honesty** (#135) — GUIDELINES + tool text state which number gates presentation (heuristic directive) and what `mode: "llm"` adds, incl. the no-provider-key failure mode. | An agent reading only the tool surfaces knows the heuristic directive is the gate and llm mode is optional depth. |
| FR-D1 | **Generic font aliases** (#134) — `mono`, `sans`, `serif` (and the full CSS generic names) pass through as CSS generics: never sent to Google, never warned, render in the browser's generic face. | `fontFamily: "mono"` renders monospaced with no warning and no network. |
| FR-D2 | **Caller's family label honored** (#134) — `set_fonts` with a stylesheet URL + explicit `family` registers the extracted faces under the caller's label (aliasing the stylesheet's name). | `{ family: "mono", url: "<css2 JetBrains Mono URL>" }` makes `fontFamily: "mono"` render JetBrains Mono. |
| FR-D3 | **Authoring-time font warning** (#134) — `batch_design` results warn when an op writes a `fontFamily` that is neither registered, cached, a system/generic family, nor resolvable — at authoring time, not first render. | A `U(id, { fontFamily: "JetBrans Mono" })` (typo) returns a warning content item in the same call. |
| FR-E1 | **Promote to component** (#130) — `create_component({ canvasId, nodeId, name })` moves the subtree into `canvas.components` and replaces the original with an `instance` referencing it; returns the componentId. | Promoting the app shell leaves the canvas rendering identically; the evaluator's instance count goes positive. |
| FR-E2 | **Cross-canvas copy** (#130) — `copy_nodes({ fromCanvasId, nodeIds, toCanvasId, parentId?, index? })` deep-copies subtrees across canvases with re-keyed ids, returning an idMap (the `apply_structure` shape); component definitions referenced by copied instances travel along. | Copying the shell instance to a sibling canvas brings the component definition and renders identically. |
| FR-F1 | **Chart node** (#129) — a data-driven `chart` node: `series: [{ data, stroke?, strokeDasharray?, area?, points?, label? }]`, `yDomain`/`xDomain` (auto from data when omitted), `curve: "linear" \| "smooth"`, rendered as SVG sized by width/height. Multi-series in one node. | The 4-series × 12-month pace chart is ONE node; editing one value is a one-prop edit; series differ by dash + colour. |
| FR-F2 | **Chart furniture** (#129) — optional `gridlines` (y-count), `xLabels`/`yLabels` (rendered tick labels), and a `kind: "line" \| "bar"` switch; bars share the same series/domain model. | A labeled monthly bar chart needs zero absolutely-positioned helper nodes. |

### Non-goals (explicit scope cuts)
- **No donut/gauge/pie in v1** (#129) — line + bar cover the dogfood evidence; radial charts are a follow-up once the series model proves out.
- **No chart interactivity or tooltips** — static renders, same as every other node.
- **No project/workspace-scoped component registry** (#130) — components stay canvas-scoped; `copy_nodes` moves them between canvases. A shared registry rides on the existing designSystem inheritance chain and deserves its own slice when demand is proven. A shell `structure` is the interim answer for new projects.
- **No name-based addressing inside `batch_design` ops** (#136) — `U("@YearTable", ...)` is ambiguous the moment names repeat; `find_nodes` + ids covers the need with an explicit resolution step.
- **No cornerRadius autofix** (#133) — radius consolidation interacts with the `radius-consistency` cliché tell and intent (pills vs cards); it stays a suggestion.
- **No general spacing-opt-out annotation** (#133) — the only motivating case was the `gap: 1` hairline hack, which FR-A1 obsoletes.

---

## 2. CLARIFY  (forks — recommendations; ★ = needs user confirm)

- **C1 — Honest-content calibration mechanism.** ★ **Decided 2026-07-19: genre-relax.** *Recommend:* **genre-relax via the existing `RELAXED_BY_GENRE` table** — add a `dashboard` genre (alias: `data`) relaxing `honest-content`; no new metadata surface, one-line mechanism, reachable via the existing `genre` param and provenance. Alternatives: a `contentMode: "realistic-data"` canvas field (new surface, same effect); downgrading info-severity cliché tells to non-blocking globally (weakens the anti-slop contract for marketing pages — the tells are info but *deliberately* blocking). Con of genre-only: the agent must know to pass it; mitigated by GOTCHAS + the tell's suggestion text pointing at the genre.
- **C2 — Chart node shape.** ★ **Decided 2026-07-19: one `chart` node.** *Recommend:* **one `chart` node type with `kind: "line" | "bar"` and a `series` array** — one node per chart (the 4-series case collapses to one node), domains shared across series, furniture (gridlines/labels) opt-in props. Alternative (issue's sketch): a lower-level `polyline` node per series — more composable but reintroduces per-series alignment bookkeeping (shared scale must be repeated per node) and makes axis labels someone else's problem again. Con of `chart`: a bigger single node schema; acceptable — it's still declarative data-in, SVG-out.
- **C3 — Component scope.** ★ **Decided 2026-07-19: canvas-scoped + copy_nodes.** *Recommend:* **canvas-scoped components + `create_component` + `copy_nodes`** (FR-E1/E2) — builds on machinery that already exists end-to-end (`canvas.components`, instance render resolution, `I()` component registration at operations.ts:211). Project-scoped components are explicitly deferred (non-goal) — revisit with real demand. Alternative: shipping only a shell `structure` — helps new projects but doesn't reuse *this* project's bespoke shell.
- **C4 — Generic-alias target.** ★ **Decided 2026-07-19: CSS generic pass-through.** *Recommend:* **pass generics through as CSS generics** (`mono` → `monospace`, `sans` → `sans-serif`) — honest, zero-network, and the face is then explicitly upgradeable via `set_fonts` + FR-D2 aliasing. Alternative: hard-map generics to designated Google faces (e.g. `mono` → JetBrains Mono) — prettier defaults but bakes taste into the resolver and surprises anyone expecting CSS semantics.
- **C5 — `apply` default.** *Recommend:* `apply: false` default — preserves current behavior, keeps the propose/inspect loop available; `apply: true` is one keystroke for the confident path. Flipping the default breaks the documented contract silently.
- **C6 — Where the authoring-time font check runs.** *Recommend:* in the `batch_design` handler after `parseAndExecute`, checking only families *written by this call* against registry + `SYSTEM_FAMILIES` + generics — cache-only check (no network on the hot path); unresolved families get a warning content item mirroring the render-time wording. A full `warmFamilies` resolve stays render/token-time.
- **C7 — Per-side border vs divider node.** *Recommend:* per-side border properties (FR-A1) only, no `divider` node type — borders express both motivating patterns (row rules, accent bars) without a new node type, and match the CSS mental model the importer already reads (`borderBottom*` is in `STYLE_WHITELIST` from Phase 18 — import can map it straight in).
- **C8 — `find_nodes` vs extending `read_nodes`.** *Recommend:* a separate `find_nodes` tool — `read_nodes` answers "show me this subtree", `find_nodes` answers "which nodes match X"; overloading one tool with a query mode muddies both docstrings. Pairs with `replace_matching_properties` as query-side / write-side of the same predicate semantics (shared `collectMatchingNodes`).

---

## 3. PLAN  (technical — mapped to real symbols)

### Slice A — rendering primitives (#131, #132)
- **types.ts**: `BorderSide = { width: number; color: string; style?: 'solid' | 'dashed' | 'dotted' }`; `borderTop/borderRight/borderBottom/borderLeft?: BorderSide`; `strokeStyle?: 'solid' | 'dashed' | 'dotted'` (all-sides stroke); `strokeDasharray?: string | number[]` (path only).
- **renderer.ts `buildStyles`**: today `stroke` emits the uniform `border` shorthand at renderer.ts:374. Emit `border-<side>: <w>px <style> <color>` after the shorthand so per-side wins per CSS cascade; `strokeStyle` swaps `solid` in the shorthand. Path: append `stroke-dasharray` to `pathAttrs` (renderer.ts:114–119) with a safe-value guard like `SAFE_PATH_D` (renderer.ts:105); number arrays join with spaces.
- **evaluate.ts**: no changes needed — borders don't touch the spacing checks; verify hairline borders don't trip `checkConsistency`.
- **import.ts / tailwind-map.ts**: map imported `borderBottom*` computed styles (already whitelisted, Phase 18 slice A) onto `borderBottom` instead of the Divider-frame reconstruction where both exist — *verify only; behavior change is optional polish, the Divider path stays*.
- **Discoverability**: batch_design docstring property list + README properties row + GUIDELINES; `test-discoverability.ts` needs no new list (properties aren't enumerated) — but the node-type list is untouched, keep green.

### Slice B — query + autofix (#133, #136)
- **find_nodes (index.ts)**: thin handler over `collectMatchingNodes` (scene-graph.ts, from #127) + two new predicate conveniences implemented alongside it: `text` (substring, case-insensitive, `content` only), `name` (exact). `path` = names (fallback type) of ancestors root→node, `" / "`-joined — computed with a parent-tracking walk (a `collectMatchesWithPath` variant; `findNode` gives single-parent only).
- **canvas_autofix (index.ts:1416)**: `apply: z.boolean().optional()`; when true, join fix ops with newlines → `parseAndExecute(canvas.root, ops, canvas)` (operations.ts:14 — stops on first error; report per-op results, `touchCanvas` on any success). Result gains `applied`/`failed` arrays; docstring updated (the "handles the mechanical subset" wording currently over-promises — align it).
- **evaluate.ts `checkSpacing`**: array-padding entries (evaluate.ts:212–218) currently `fixable: false`. Group per node instead: compute the fully-snapped array once and attach `fix: { op: formatUpdateOp(id, { padding: snappedArray }) }` on a single combined issue per node (avoids N conflicting whole-array ops for one node — the current per-entry loop would emit clobbering duplicates).
- **Tests**: `test-find-nodes.ts` (predicates, text/name, path, scope); extend `test-autofix.ts` (apply mode round-trip, array-padding snap, per-node single fix op).

### Slice C — evaluator calibration (#135)
- **evaluate.ts**: `RELAXED_BY_GENRE` (evaluate.ts:612) gains `dashboard: ['honest-content']` (+ alias `data`); genre already resolves as `options.genre ?? provenance.preset` (evaluate.ts:1255). Update `tellHonestContent`'s suggestion text to name the genre escape hatch.
- **Type-scale pinning**: `checkTypography` (evaluate.ts:341) receives the merged `DesignVariables`; collect `variables.typography.*.fontSize` into a pinned set; in the adjacent-ratio walk (evaluate.ts:355–368) skip pairs where **both** sizes are pinned. Fix the threshold/message mismatch (code 1.1 vs message "1.15–1.75") — align message to code (do not tighten the code mid-phase; tightening moves the bar for every existing canvas and needs its own benchmark pass).
- **Benchmark**: `benchmark/baselines.json` re-check — pinning only *removes* flags, so scores move up or stay; regenerate if any baseline shifts.
- **Docs (FR-C3)**: GUIDELINES "Before you present" + Sharp edges: the heuristic directive is the gate; `mode: "llm"` is optional depth and requires `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`; genre list for data-dense screens.

### Slice D — fonts (#134)
- **fonts.ts**: `GENERIC_ALIASES = { mono: 'monospace', sans: 'sans-serif' }` (serif already generic); apply in `firstResolvableFamily` (fonts.ts:55–64) and add the alias keys to the `SYSTEM_FAMILIES` skip-set (fonts.ts:35–44) so they never hit Google or warn. Renderer emits the aliased generic.
- **resolveStylesheetUrl (fonts.ts:310–324)**: accept an optional `label` param; when the caller supplied `family`, register the cached faces under the caller's label (`cacheFaces(label, faces)`) — index.ts:750–752 passes it through. The stylesheet's own name is reported back in the result text so the alias is visible.
- **batch_design handler (index.ts, post-`parseAndExecute`)**: per C6, diff the families written this call; warn on families failing the cache/system/generic check via the existing warning content-item pattern (`fontWarningContent`, index.ts:565).
- **Tests**: extend `test-fonts-by-name.ts` / `test-custom-fonts.ts` (alias render, stylesheet-label honoring, authoring-time warning — cache-only, no network).

### Slice E — components (#130)
- **scene-graph.ts / new `src/components.ts`**: `promoteToComponent(canvas, nodeId, name)` — deep-clone subtree into `canvas.components[newId]` (re-keyed ids), `replaceNode` the original with `{ type: 'instance', componentId: newId }` (render path already resolves this: `resolveInstance`, renderer.ts:271–290; overrides match children **by `name`** — renderer.ts:292–304, so the tool result should nudge naming override targets).
- **`copy_nodes` (index.ts)**: load both canvases (`ensureFresh` both), `deepCloneWithNewIds` (scene-graph.ts:352) per subtree into `toCanvas`, plus copy any `canvas.components` entries referenced by `componentId` within the copied trees (re-keyed, collision-checked — the `apply_structure` re-key pattern); return idMap. Persist only the target canvas.
- **evaluate.ts**: no change — `checkStructure`'s instance advisory (evaluate.ts:483–489) starts passing naturally once instances exist.
- **Tests**: `test-components.ts` — promote render-equivalence (screenshot-free: compare resolved trees), cross-canvas copy w/ component travel, override-by-name after promote.

### Slice F — charts (#129)
- **types.ts**: `'chart'` in `NodeType`; `ChartSeries = { data: number[]; label?: string; stroke?: string; strokeWidth?: number; strokeDasharray?: string | number[]; area?: boolean; points?: boolean }`; node props: `kind: 'line' | 'bar'`, `series: ChartSeries[]`, `xDomain?/yDomain?: [number, number]` (auto = min/max across series, zero-floored for bar), `curve?: 'linear' | 'smooth'`, `gridlines?: number`, `xLabels?/yLabels?: string[]`.
- **renderer.ts**: `renderChartSvg(node)` beside `renderPathSvg` (renderer.ts:108) — pure value→coordinate math (invert y), polyline/`path` per series (smooth = Catmull-Rom→cubic), `<rect>` groups for bars, hairline gridlines, `<text>` tick labels using the node's font context; token refs in series colors already resolve (`resolveVariables` walks all string props — verify arrays of objects are walked; extend the walker if not, same shape as `shadows`).
- **Slice A dependency**: series dashing reuses the `strokeDasharray` guard from Slice A.
- **evaluate.ts**: chart internals are renderer-generated — exclude `chart` children from node-count/spacing walks (it has no children; verify `collectEntries` treats it as a leaf).
- **structures.ts**: refresh the `dashboard` page structure's chart placeholder to a real `chart` node — the pattern library then demos it (keep `test-patterns.ts` > 95 green).
- **Tests**: `test-chart.ts` — coordinate math pure-tested (domain mapping, inversion, auto-domain, bar widths), SVG snapshot-ish string assertions; screenshot smoke behind Chrome availability like existing render tests.

### Cross-cutting (every slice, the #77 lesson)
Tool docstrings + shared `INSTRUCTIONS`/`GOTCHAS` + README + GUIDELINES land in the same PR as each slice; `test-discoverability.ts` lists extended for: new tools (`find_nodes`, `create_component`, `copy_nodes`), new node type (`chart` — docstring + README node-type lines), new properties in the batch_design property line. `docs-steward` dispatched per slice PR.

---

## 4. TASKS  (slices — each independently PR-able, in ship order)

- **Slice A — rendering primitives.** Per-side borders + dash control (FR-A1, FR-A2). First: it kills the active linter-fight and unblocks F.
- **Slice B — query + autofix.** `find_nodes`, autofix `apply` + array padding (FR-B1–B3). Pure ergonomics, no design risk.
- **Slice C — evaluator calibration.** Genre relax, type-scale pinning, directive docs (FR-C1–C3). Small diff, big trust repair; benchmark re-check.
- **Slice D — fonts.** Generic aliases, label honoring, authoring-time warning (FR-D1–D3).
- **Slice E — components.** `create_component` + `copy_nodes` (FR-E1–E2).
- **Slice F — charts.** `chart` node, line + bar, furniture; dashboard structure refresh (FR-F1–F2). Last: biggest surface, depends on A.

## 5. ANALYZE  (risks / open questions)

- **Evaluator loosening is one-way** — a genre that relaxes `honest-content` can be over-applied (agent passes `dashboard` on a marketing page to dodge flags). Mitigation: genre also comes from provenance; GOTCHAS wording frames it as "declare the genre the screen actually is", and the tell stays fully active by default.
- **Type-scale pinning trusts tokens** — an agent could "pin" a bad scale by declaring junk tokens. Acceptable: declaring the scale is exactly the intentionality signal the check lacks today; the >6-unique-sizes check (evaluate.ts:371) still fires.
- **`copy_nodes` id-collision surface** — re-keying must cover `componentId` references *inside* copied trees and override keys matched by name (renderer matches overrides by child `name`, which re-keying must not disturb — names are preserved, only ids re-key).
- **Chart schema creep** — the series model will attract requests (stacked bars, dual axes, log scales). The `kind` enum + non-goals line draw the boundary; anything beyond line/bar/donut is a new phase.
- **`resolveVariables` walk coverage** — token refs inside `series[].stroke` require the resolver to walk object arrays; verify before Slice F lands (same pattern as `shadows` if it already works, small extension if not).
- **Benchmark drift (Slice C)** — pinning/genre only remove flags, but `baselines.json` must be regenerated deliberately (the Phase 12 lesson: don't let baselines absorb changes silently).
- **★ user confirms**: C1 (genre-relax mechanism), C2 (single `chart` node w/ series), C3 (canvas-scoped components + copy_nodes), C4 (generics → CSS generic pass-through) — all four **confirmed as recommended, 2026-07-19**. C5–C8 have recommended defaults a review comment can flip.
