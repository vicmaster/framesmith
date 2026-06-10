# Phase 17 — Import from Implementation (from issue #78)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-06-10.
> Source: issue #78 (split out of #77 as the highest-leverage gap). Issue #78 already proposes the
> API surface — this spec adopts it, resolves the open implementation forks, and slices the work.
> Depends on Phase 16 (shipped): icon sets (slice B) and input primitives (slice C) are import targets.

---

## 1. SPECIFY

### Problem
A screen that already ships has no path into framesmith: to make it a *design*, it must be
hand-redrawn node by node (~80 nodes for one data table), which is never pixel-exact and is
itself the reverse-engineering that design-first is supposed to kill. Add the reverse of
`export`: **HTML/Tailwind snippet or live URL → editable, token-mapped canvas**, plus a
drift check that keeps the design-of-record honest as the app evolves.

**North star:** paste a shipped component's HTML (or point at a route) → get a canvas whose
values are `$token` references where the design system has them, with an honest report of
what mapped, what stayed literal, and what was dropped.

### Goals
- **A. `canvas_import_html`** — snippet (+ optional CSS) → editable canvas. No network.
- **B. Token re-mapping** — snap concrete values back to `$token` refs (nearest-color within
  tolerance, spacing/radius/font-size scale snapping) and map Tailwind utility classes to
  *intent* directly. Every import returns a **mapping report**.
- **C. `canvas_import_url`** — live page (viewport, `selector`, `waitFor`, `auth`) → canvas.
- **D. `canvas_sync_from_url`** — re-import + `canvas_diff` against the existing canvas →
  drift percentage + report (the design-of-record as a living contract).

### User stories
- **US1** — As the authoring agent, I paste a Tailwind component's HTML and get a canvas
  where `bg-surface` became `fill: "$surface"` and `gap-4` became `gap: 16` — editable
  design, not a pile of hex.
- **US2** — As the authoring agent, I import `https://app.local/users` at 1440×900 and get
  the User Management screen as a canvas — table rows, chips, toggles — without redrawing.
- **US3** — As the maintainer, the import report tells me exactly which values snapped to
  tokens, which stayed literal (flagged for review), and which CSS had no scene-graph analog
  — the import never pretends to be lossless.
- **US4** — As the maintainer, `canvas_sync_from_url` tells me the shipped page drifted 4.2%
  from its approved canvas, so design ↔ code divergence is a number, not a vibe.

### Functional requirements

| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-A1 | **DOM → scene graph via computed styles.** The import renders markup in the bundled Puppeteer Chrome and walks the DOM in `page.evaluate`, emitting one scene node per visible element with computed `display`/flex props → `frame` (+`layout`/`gap`/`padding`/`alignItems`/`justifyContent`/`wrap`), text runs → `text` (fontSize/Weight/Family, color, lineHeight, letterSpacing, textTransform, textAlign), `<img>` → `image`, inline `<svg>` → `path` (first path's `d`) or placeholder frame, `background`/`border`/`border-radius`/`box-shadow`/`opacity`/`overflow` → `fill`/`stroke`+`strokeWidth`/`cornerRadius`/`shadows`/`opacity`/`overflow`. **No jsdom/parse5 dependency.** | A flex card snippet imports to a frame tree whose `screenshot` visually matches the source render; `npm ls` gains no HTML-parser package. |
| FR-A2 | **Control & icon recognition.** `<input type="checkbox/radio">`, `role="switch"`/common toggle markup → Phase 16 primitives (`checked` from the DOM state); `<select>` → `select` (value from selected option); inline SVGs that match a known Lucide/Material glyph by path data → `icon` node; otherwise degrade to `path`/frame and note it in the report. | A form snippet yields `checkbox`/`toggle`/`select` nodes, not styled-div approximations; unrecognized SVGs are listed in the report. |
| FR-A3 | **Flatten knobs.** `flatten: { collapseWrappers (default true), mergeTextRuns (default true), dropInvisible (default true), maxDepth (default 24) }` — single-child wrapper divs with no visual props collapse; adjacent text runs with identical style merge; `display:none`/zero-size nodes drop. | The default import of real-world Tailwind markup produces a tree ≤ ~60% of the raw DOM node count; knobs verifiably change the output. |
| FR-A4 | **`canvas_import_html` tool.** `{ html, css?, projectId?, name?, selector?, tokenMatch?, tailwind?, flatten? }` → `{ canvasId, rootId, report }`. Snippet only — no network fetches from the page (external images become placeholder fills noted in the report). | Importing a snippet creates a persisted canvas in the target project; the response carries the report. |
| FR-B1 | **Tailwind intent mapping.** When class names are present, map utilities directly to props/tokens *before* computed-style snapping: spacing (`p-*`, `gap-*`, `m-*` → report-only), `rounded*`, `text-*`/`font-*`, `bg-*`/`text-*`/`border-*` colors, `flex`/`grid`/`items-*`/`justify-*`, `w-*`/`max-w-*`. Custom utilities resolve through `tailwind: { theme }` (a parsed `@theme`/config object) when provided; unknown classes fall through to computed style. | `bg-surface` + `tailwind.theme` mapping surface→#... yields `fill: "$surface"` when the workspace has that token; `gap-4` → `16` with no theme needed. |
| FR-B2 | **Token snapping (`tokenMatch`).** `{ source: "workspace" \| "designMd" \| "tailwind", tolerance? }` (default workspace, tolerance ΔE-ish nearest-color within a conservative threshold): colors snap to the nearest design-system token (ties reported, not guessed); spacing/radius/fontSize snap to scale tokens on exact-or-±1px match. Unsnapped values stay literal and are flagged. | Importing against the magma-core design system: `#b71421` → `$primary`; `17px` padding stays literal and appears under `report.literals`. |
| FR-B3 | **Mapping report.** `{ counts: { nodes, text, frames, maxDepth }, snapped: [{ nodeId, prop, from, token }], literals: [{ nodeId, prop, value }], unmatchedFonts: [], unmatchedIcons: [], warnings: [] }` — same honesty contract as `apply_preset`'s `preservedFromDesignSystem`. | Every import response includes the report; warnings cover dropped pseudo-elements, background images, unsupported CSS. |
| FR-C1 | **`canvas_import_url` tool.** `{ url, projectId?, name?, viewport?, selector?, waitFor?, auth?, tokenMatch?, flatten? }` — renders the live page (Chrome already bundled), optional `selector` imports a sub-tree, `waitFor` (selector or ms) for JS-rendered pages, `auth.headers`/`cookies` for gated pages. Fonts seen in computed styles feed Phase 16's resolver (`warmFamilies`) so the canvas renders in the same faces. | Importing a live local route yields a canvas; `selector` imports just the component; the page's `Inter` renders in the canvas via the Phase 16 cache. |
| FR-C2 | **Network safety.** `canvas_import_url` fetches exactly the user-named URL in a throwaway page context; no auth values are persisted to the canvas or report. | Auth headers don't appear in any persisted JSON. |
| FR-D1 | **`canvas_sync_from_url` tool.** `{ canvasId, url, viewport?, selector?, waitFor?, auth? }` → re-import (ephemeral), render both, `computeDiff` (`src/screenshot.ts:243`) → `{ diffImage, changePercent, report }`. Does NOT mutate the canvas. | A drifted page reports changePercent > 0 with the diff image; an unchanged page reports ~0. |
| FR-E1 | **Discoverability** (the Phase 15/16 rule): tools land in docstrings + server `instructions` + GOTCHAS + README + GUIDELINES in the same PR as the feature, including the honesty framing ("lossy by design — read the report"). | An MCP-connected agent discovers the import path without the README. |

### Non-goals (explicit scope cuts)
- **No pixel-perfect promise** — DOM → design tree is lossy and heuristic; the contract is
  *editable + token-mapped + honestly reported*, not lossless. Pseudo-elements, background
  images, filters, grid-template intricacies degrade with warnings.
- **No interactive states** — hover/open-menu/modal capture beyond `waitFor` is out (the
  issue's "script step" idea waits for demand).
- **No CI runner** — `canvas_sync_from_url` returns the number; wiring it into CI is the
  user's pipeline (documented as a pattern, not shipped as a feature).
- **No full Tailwind engine** — the intent mapper covers the common utility families +
  user-supplied theme; it does not reimplement Tailwind's compiler. Unknown classes fall
  through to computed styles (URL imports) or are reported (snippet imports without CSS).
- **No Figma import** — stays in Phase 14's ecosystem bucket.

---

## 2. CLARIFY  (forks — recommendations; ★ = confirm in spec-PR review)

- **C1 — Snippet imports and Tailwind classes don't self-render.** A bare snippet with
  Tailwind classes has no Tailwind runtime, so computed styles won't reflect the classes.
  ★ *Decided approach:* the **intent mapper is the primary path for Tailwind snippets**
  (classes → props/tokens directly, no CSS execution), and the **computed-style walk is the
  primary path when real CSS exists** (snippet + `css`, or any URL import). The two compose:
  intent mapping wins where it recognizes a class; computed style fills the rest. Bundling a
  Tailwind runtime (play CDN / `@tailwindcss/browser`) is rejected — network dependency +
  heavyweight for marginal gain over the mapper.
- **C2 — Where the import engine lives.** New `src/import.ts` (pure-ish core: the
  `page.evaluate` walker source, style→prop mapping, flatten, snapping) + the browser
  plumbing reuses `src/screenshot.ts`'s singleton — export its private `getBrowser` (or a
  narrow `withPage(fn)` helper) rather than spawning a second Chrome.
- **C3 — What "visible" means.** `dropInvisible` drops `display:none`, `visibility:hidden`,
  zero-area boxes, and `aria-hidden` decorative wrappers; `opacity:0` is kept (it occupies
  layout) with a warning.
- **C4 — Width strategy on import.** Computed pixel widths convert to the renderer's idiom:
  the root gets the viewport/selector width as canvas size; children whose computed width
  ≈ parent content width become `width: "100%"`; true fixed-size elements (icons, avatars)
  keep pixels. Avoids importing a wall of hardcoded widths that can't reflow (GUIDELINES
  width-strategy rule).
- **C5 — Icon recognition fidelity.** Matching inline SVG path data against ~5,700 bundled
  glyphs: normalize + hash the `d` attribute(s) and compare against a lazily-built index of
  Lucide + Material path hashes; exact-match only (no fuzzy geometry). Misses degrade to
  `path` nodes — honest, cheap, no false positives.
- **C6 — Color snapping distance.** Compare in HSL via the exported `rgbToHsl`
  (`src/evaluate.ts:119`) with a conservative combined threshold (hue-weighted); exact hex
  matches snap unconditionally; near-ties (two tokens within threshold) are *reported* under
  `report.warnings` and left literal. Tolerance overridable via `tokenMatch.tolerance`.
- **C7 — Where imported canvases land.** `projectId` optional → default project (same as
  `canvas_create`); name defaults to `Imported — <selector | hostname>`. Bound repos work
  unchanged (the canvas persists through the normal repo-store path, assets externalized by
  `externalizeAssets` — imported `<img>`s referenced by URL stay URLs; only data: URIs
  externalize).
- **C8 — `canvas_sync_from_url` diff target.** Diff the *renders* (existing canvas render vs
  fresh-import render) via `computeDiff`, not the scene trees — pixel drift is the honest
  signal (tree diffs over-report on harmless re-keying). Scene-level diffing can come later
  if pixel diff proves too coarse.

---

## 3. PLAN  (technical — mapped to real symbols)

### Slice A — import core + `canvas_import_html`

**New `src/import.ts`:**
```ts
export interface FlattenOptions { collapseWrappers?: boolean; mergeTextRuns?: boolean; dropInvisible?: boolean; maxDepth?: number; }
export interface ImportReport { counts: {...}; snapped: [...]; literals: [...]; unmatchedFonts: string[]; unmatchedIcons: string[]; warnings: string[]; }
export interface RawDomNode { /* the page.evaluate output: tag, classes, computed-style subset, rect, text, attrs, children */ }

export const DOM_WALKER_SOURCE: string;            // string-form page.evaluate fn (the tsx __name workaround, like computeDiff)
export function domToSceneGraph(raw: RawDomNode, opts): { root: SceneNode; report: ImportReport };   // pure, unit-testable without Chrome
export function flattenTree(root: SceneNode, opts: FlattenOptions, report): SceneNode;               // pure
export async function importHtml(html: string, css: string | undefined, opts): Promise<{ root, report }>;  // Chrome side
```
- The walker runs as a **string function** in `page.evaluate` (the established `__name`
  workaround, `src/screenshot.ts:249`), capturing per element: tagName, class list, a fixed
  whitelist of computed styles, boundingRect, direct text content, and `checked`/`selected`/
  `role` attrs. Output is plain JSON → all mapping logic lives in Node (`domToSceneGraph`),
  unit-testable with fixture JSON, no Chrome in most tests.
- `screenshot.ts`: export `withPage<T>(fn: (page) => Promise<T>)` wrapping the existing
  singleton `getBrowser` (keeps the launch hardening + `FRAMESMITH_CHROME_PATH` path in one
  place).
- Snippet page: `page.setContent` with the html + optional `<style>${css}</style>`; the
  body wrapped in a fixed-width container (default 1440, overridable) so percentage layouts
  resolve.
- Tool handler in `src/index.ts`: create canvas via `createCanvas(name, projectId)`
  (`src/scene-graph.ts:110`), set `canvas.root.children` from the import, stamp
  `metadata.provenance = { importedFrom: 'html', at }` (new optional field — the open
  metadata bag absorbs it), `touchCanvas`, return `{ canvasId, rootId, report }`.

### Slice B — Tailwind intent mapping + token snapping
- `src/tailwind-map.ts`: a table-driven mapper for the common utility families (FR-B1) —
  pure functions `classToProps(cls, theme?)`; the Tailwind v4 default scale (4px base) is a
  small static table, not a dependency. `tailwind.theme` is a flat `{ name: value }` object
  (the user pastes/derives it from their `@theme`); custom color utilities resolve through it.
- `src/import.ts` `snapToTokens(root, tokens: DesignVariables, tolerance, report)`:
  - colors: exact-hex map first; else nearest via `rgbToHsl` (`src/evaluate.ts:119`)
    + `parseAlpha` (`:138`); ties → warning, keep literal. Snapped value becomes `"$name"`.
  - spacing/radius/fontSize: exact or ±1px against the token scales from
    `getCanvasTokens`-shaped `DesignVariables` (`mergeDesignTokens`, `src/variables.ts:119`).
  - `tokenMatch.source`: `workspace` (default — tokens from the target project's merged
    layers), `designMd` (run `parseDesignMd` on a provided string), `tailwind` (snap against
    the provided theme's values, emitting theme-derived `$names`).
- Fonts: computed `font-family` stacks → `firstResolvableFamily` (`src/fonts.ts`) →
  `warmFamilies` so the imported canvas renders in the real faces; unresolvable families →
  `report.unmatchedFonts`.

### Slice C — `canvas_import_url`
- Same engine; `page.goto(url, { waitUntil: 'networkidle2' })` + optional `waitFor`
  (selector → `page.waitForSelector`, number → delay), `viewport` (default 1440×900),
  `selector` → walk only that sub-tree, `auth.headers` via `page.setExtraHTTPHeaders`,
  `auth.cookies` via `browserContext.setCookie` — all in a fresh **incognito context** so
  nothing leaks between imports (FR-C2); context closed in `finally`.
- Provenance: `{ importedFrom: url, at }` (URL recorded; auth never).

### Slice D — `canvas_sync_from_url`
- Ephemeral import (no canvas created) → render both trees at the same viewport via
  `renderToHtml` + the Phase 16 `prepareRender` font path → `computeDiff`
  (`src/screenshot.ts:243`) → `{ diffImage, changePercent, report }`. Document the CI
  pattern (fail when `changePercent > threshold`) in README — pattern, not feature.

### Tests (per slice, stubbed-first)
- `test-import-core.ts` — fixture `RawDomNode` JSON → `domToSceneGraph`/`flattenTree`/
  `snapToTokens`: mapping table, wrapper collapse, text merge, control recognition, snapping
  + tie-reporting, report shape. **No Chrome.**
- `test-import-html.ts` — real Chrome: snippet (+css) end-to-end, screenshot-vs-source
  sanity, width-strategy conversion, provenance stamp.
- `test-tailwind-map.ts` — utility families, theme resolution, unknown-class fallthrough.
- `test-import-url.ts` — `data:`/`file://` page (no external network in CI), selector,
  waitFor, auth-header injection (asserted via a local echo, gated if needed).
- `test-sync-drift.ts` — import → mutate canvas → sync reports drift; unchanged → ~0%.

---

## 4. TASKS  (slice-ordered; each independently PR-able)

**Slice A — core + import_html**
- [ ] A1: `withPage` export in screenshot.ts; `src/import.ts` walker source + `RawDomNode`
- [ ] A2: `domToSceneGraph` mapping table + `flattenTree` knobs + report skeleton + control/icon recognition (FR-A2, icon-hash index per C5)
- [ ] A3: `canvas_import_html` tool + provenance + docs (FR-E1)
- [ ] A4: test-import-core.ts (fixtures) + test-import-html.ts (Chrome)

**Slice B — Tailwind + tokens**
- [ ] B1: `src/tailwind-map.ts` + theme resolution
- [ ] B2: `snapToTokens` (+ designMd/tailwind sources) + font warm-up tie-in
- [ ] B3: report wiring + tests (test-tailwind-map.ts, extend test-import-core.ts) + docs

**Slice C — import_url**
- [ ] C1: goto/viewport/selector/waitFor/auth in an incognito context; provenance; docs
- [ ] C2: test-import-url.ts (local pages only)

**Slice D — sync/drift**
- [ ] D1: `canvas_sync_from_url` (ephemeral import + computeDiff); README CI pattern; docs
- [ ] D2: test-sync-drift.ts

**Close-out**
- [ ] VISION Phase 17 ticks; close #78 with a gap→PR map; then the release train: fix
      test-responsive (parked chip), version-bump PR, Victor publishes

---

## 5. ANALYZE  (risks & edge cases)

- **Lossiness expectations.** The single biggest product risk is overpromising. Every
  surface (docstrings, README, GUIDELINES) frames the import as *editable + token-mapped +
  reported*, never "pixel-perfect"; the report is the contract.
- **DOM walker drift across Chrome versions.** The walker reads a fixed whitelist of
  computed properties — all long-stable CSSOM names. Fixture-JSON tests keep the Node-side
  logic pinned regardless of Chrome.
- **Deep/odd DOMs.** `maxDepth` guard + node-count cap (warn + truncate at ~2,000 nodes)
  so a pathological page can't OOM the scene graph or the repo JSON.
- **Grid layouts.** CSS grid has no scene-graph analog; grid containers import as vertical
  frames with a warning (children keep their computed sizes). Documented limitation.
- **External images.** `<img src="https://...">` imports as `image` with the URL (renders
  fine — the renderer already loads remote images); relative URLs resolve against the
  page URL for imports, or become placeholder fills + warning for snippets.
- **Auth hygiene.** Headers/cookies live only in the incognito context; assert in tests
  that no persisted artifact (canvas JSON, provenance, report) contains them.
- **Icon-hash index cost.** Building the path-hash index lazily on first icon-bearing
  import (~5,700 file reads once, cached) — same lazy philosophy as the Material loader.
- **`canvas_diff` scale sensitivity.** Sync renders both sides at the same viewport +
  scale 1 (the existing diff default) to keep changePercent comparable run-to-run.
- **Benchmark baselines.** Import adds no evaluator changes; baselines untouched (the
  Phase 12 lesson: verify, don't regenerate).
