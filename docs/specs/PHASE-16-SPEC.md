# Phase 16 — Faithful Parity (from issue #77)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-06-10.
> Source: issue #77 (real design-first dogfooding on a Rails 8 + Tailwind v4 app). The
> discoverability slice of #77 already shipped in PR #79; this phase covers the genuine gaps.

---

## 1. SPECIFY

### Problem
A hand-built canvas can't reproduce what a real app ships: the declared font silently
falls back to the system stack (typography tokens name a family but nothing loads it),
the bundled icon set doesn't cover Material-style design systems, form controls have to
be faked from frames + ellipses, and a single data table costs ~80 hand-placed nodes.
The result reads as "the right idea" — a look-alike — so the canvas can't serve as the
team's exact design reference, which is the whole pitch of design-first.

**North star:** an agent that declares `fontFamily: "Inter"` in a typography token and
places `icon: "material:settings"` gets a render that matches the shipped app — with
zero extra steps and no network surprises at render time.

### Goals
- **A. Fonts by name** — a family named anywhere (typography token, node `fontFamily`,
  or explicit registration) renders in that face. Google Fonts resolution is automatic,
  cached on disk, and never blocks or breaks a render.
- **B. Material Symbols** — a second bundled icon set addressable as `icon: "material:<name>"`,
  alongside the existing Lucide set (unprefixed names unchanged).
- **C. Input primitives** — `toggle`, `checkbox`, `radio`, `select` as first-class node
  types with token-aware default styling.
- **D. Component-level structures** — `apply_structure` can stamp *component* scaffolds
  (data table, form field, toolbar, stat card) into an existing canvas, not just
  page skeletons into an empty one.

### User stories
- **US1** — As the authoring agent, I set `workspace_set_design_system` typography with
  `fontFamily: "Inter"` and every subsequent screenshot renders in Inter — I never
  hand-locate a gstatic binary URL.
- **US2** — As the authoring agent building a Material-style app, I place
  `{ type: "icon", icon: "material:check" }` and get the real Material Symbols glyph.
- **US3** — As the authoring agent, I place `{ type: "toggle", checked: true }` and get
  a pixel-consistent control styled from the design system, instead of assembling a
  frame + ellipse by hand.
- **US4** — As the authoring agent, I stamp a `data-table` component structure under an
  existing frame, get labeled placeholder rows/cells with live re-keyed IDs, and only
  fill in content — instead of placing ~80 nodes.
- **US5** — As the maintainer, renders stay deterministic: after a family resolves once,
  rendering works offline; a family that *can't* resolve degrades to the fallback stack
  with an explicit warning in the tool result, never a silent look-alike.

### Functional requirements

| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-A1 | **Resolve by family name.** `resolveFamily(family)` fetches Google Fonts CSS (`css2`) with a woff2-capable UA, extracts `@font-face` blocks (family, weight/range, style, gstatic binary URL), downloads the binaries, and caches them under `~/.framesmith/fonts/` (content-hashed files + `registry.json`). | After `resolveFamily("Inter")`, the cache holds woff2 binaries + registry entry; a second call is a cache hit with no network. |
| FR-A2 | **Write-time resolution.** `set_fonts` gains `families?: string[]`; setting a typography token with a `fontFamily` (via `set_variables` / `project_` / `workspace_set_design_system` / `import_design_md`) triggers background resolution of that family. Failures don't fail the write — they surface in the response as a warning. | `workspace_set_design_system` with `typography.body.fontFamily: "Inter"` warms the cache; the response notes resolved/failed families. |
| FR-A3 | **Render-time backstop.** Before rendering, `ensureFontsForRender(canvas, merged)` collects families referenced by nodes + merged typography tokens (minus system families, minus already-declared `canvas.fonts`), resolves them cache-first, and injects `@font-face` rules (data: URIs from cached binaries) into the render. Unresolvable families render with the fallback stack + a `warnings` entry in the screenshot/export result. | A canvas whose only Inter reference is a workspace token renders in Inter on first screenshot (network) and offline thereafter (cache); with network down and a cold cache, the render succeeds and the result carries a warning naming the family. |
| FR-A4 | **Workspace default font.** When the merged typography tokens define a `body` entry with `fontFamily`, the document body's font-family becomes that family (+ system fallback tail) instead of the bare system stack. | Set `typography.body.fontFamily: "Inter"` at the workspace → text nodes without explicit `fontFamily` render in Inter. |
| FR-A5 | **Stylesheet URLs accepted.** `set_fonts` accepts a `fonts.googleapis.com/css2` URL in `url` and extracts the binary faces from it (same extractor as FR-A1), instead of rejecting it. | A css2 URL registers N faces with gstatic binary URLs; `get_fonts` shows them. |
| FR-B1 | **Material Symbols set.** `icon: "material:<name>"` renders the Material Symbols SVG; optional `iconStyle: "outlined" \| "rounded" \| "sharp"` (default `outlined`). Unprefixed names remain Lucide (back-compat). Unknown names keep today's `<!-- unknown icon -->` comment + degrade. | `material:settings` renders the glyph at `iconSize`/`iconColor`; `search` still resolves to Lucide; `material:nope` renders the unknown-icon comment. |
| FR-B2 | **Color/size fidelity per set.** Material SVGs are fill-based (Lucide is stroke-based) — `iconColor` must recolor both correctly. | Both sets respect `iconSize` + `iconColor` in computed output. |
| FR-C1 | **New node types.** `toggle`, `checkbox`, `radio`, `select` join the `NodeType` union with props: `checked?: boolean` (toggle/checkbox/radio), `value?: string` (select's displayed value), `disabled?: boolean`. Sensible default sizes (toggle 44×24, checkbox/radio 18×18, select fit-content), overridable via `width`/`height`. | Each type renders a deterministic control; `checked` flips the visual state. |
| FR-C2 | **Token-aware styling.** Controls default to design-system tokens (`$accent` for the active state, `$border`, `$bg-surface`) with hardcoded neutral fallbacks when unthemed; `fill`/`stroke` override. | On a preset-themed canvas the checked toggle uses the preset accent; on a bare canvas it renders with neutral defaults (never crashes on unresolved tokens — same rule as structures). |
| FR-D1 | **Component structures.** `Structure` gains `kind: 'page' \| 'component'` (default `'page'`); new component scaffolds: `data-table`, `form-field`, `toolbar`, `stat-card`, `toggle-row`. `list_structures` reports kind. | `list_structures` shows both kinds; each component scaffold stamps labeled placeholders only (C8 rule: no fabricated data). |
| FR-D2 | **Targeted, repeatable stamping.** `apply_structure` gains `targetId?` (default `"document"`). Component structures insert under the target *without* the empty-canvas guard, re-key every node ID to a unique form, and return the old→new ID map (like `batch_design`'s `nodeIds`). Page structures keep today's behavior exactly. | Stamping `form-field` twice under the same frame yields two non-colliding subtrees, each with its ID map; `marquee-hero` still requires an empty canvas (or `replace: true`). |
| FR-E1 | **Discoverability (the Phase-15 lesson).** Every new capability lands in the `batch_design`/`set_fonts`/`apply_structure` docstrings, the server `instructions`, `init` GOTCHAS where relevant, README, and GUIDELINES — in the same PR as the feature. | An MCP-connected agent can discover fonts-by-name, `material:` icons, primitives, and component structures without reading the README. |

### Non-goals (explicit scope cuts)
- **No import path** — HTML/Tailwind/URL → canvas is issue #78 / Phase 17 (it consumes B + C from this phase).
- **No Tailwind-aware export** — ties to #78's token mapping; deferred with it.
- **No font foundries beyond Google Fonts** — direct binary URLs already cover self-hosted faces; Adobe/etc. resolution is out.
- **No icon sets beyond Lucide + Material Symbols** — Heroicons/Phosphor wait for demand (the `set:` prefix leaves the namespace open).
- **No interactive states** — primitives are static renders (`checked` is a prop, not a behavior); hover/focus/open-menu states are out (relevant again in #78).
- **No new Phase 14 items** — image gen, HTTP transport, VS Code ext stay where they are.

---

## 2. CLARIFY  (forks — ★ decided with Victor 2026-06-10)

- **C1 — Font loading behavior.** ★ *Decided:* **hybrid** — resolve at write-time
  (FR-A2, warms the cache when tokens/fonts are set) **plus** a render-time backstop
  (FR-A3, cache-first) so a family referenced any other way still renders correctly.
  Rationale: warn-only repeats the original failure (agent misses the warning → fallback
  font ships — the "single biggest why-doesn't-it-look-like-the-app factor" per #77);
  pure render-time fetching puts the network in every render. The disk cache makes
  renders deterministic and offline after first resolve; failure degrades to today's
  behavior + an explicit warning. Victor's directive: pick what actually fixes fidelity.
- **C2 — Icon addressing.** ★ *Decided:* prefix syntax `icon: "material:check"`;
  unprefixed = Lucide (back-compat). Optional `iconStyle` for the Material variant.
- **C3 — Primitive surface.** ★ *Decided:* real **node types**, not component templates —
  pixel-consistent, one schema addition, and #78's importer can map `<input>`/toggles
  onto them directly.
- **C4 — Where resolved fonts live.** *Recommend:* cached binaries are **not** written
  into `canvas.fonts` by the render backstop (a read path must not dirty the canvas —
  same principle as `rehydrateAssets`). Explicit registration (`set_fonts families:`)
  *does* persist `FontFace` entries (with gstatic URLs, not data URIs, to keep repo JSON
  small/diffable). The render injects cached data-URI faces ephemerally.
- **C5 — Which weights to resolve.** *Recommend:* request the css2 variable-font default
  plus `wght@400;500;600;700` (the weights structures/presets actually use); variable
  fonts come back as a single face with a weight range (`FontFace.weight` already allows
  a string — `"100 900"` works in `@font-face`). Per-family axes beyond `wght` are out.
- **C6 — System-family skip list.** *Recommend:* a conservative `SYSTEM_FAMILIES` set
  (`system-ui`, `-apple-system`, `sans-serif`, `serif`, `monospace`, `ui-*`, `Segoe UI`,
  `Helvetica*`, `Arial`, `Georgia`, `Times*`, `Courier*`, `SF Pro*`, `Roboto`) — only the
  *first* non-system family of a stack is resolved.
- **C7 — Default-font token name.** *Recommend:* `typography.body` (matches the
  existing token vocabulary used by presets); `typography.base` accepted as alias.
- **C8 — Material dependency.** *Decided by measurement:* bundle `@material-symbols/svg-400`
  (~13 MB unpacked — smaller than the existing `lucide-static` at ~46 MB); one weight
  (400) ships, other weights are out of scope (`fontVariationSettings` does not apply to
  SVG icons; weight variants wait for demand).
- **C9 — Component-structure provenance.** *Recommend:* component stamps do **not**
  overwrite `metadata.provenance.structure` (that names the *page* shape feeding the
  Phase 11 diversification signal + Phase 13 "variety" axis). Component usage is recorded
  in the build log entry detail instead.

---

## 3. PLAN  (technical — mapped to real symbols)

### Slice A — fonts by name

**New `src/fonts.ts`** (testable core, no MCP imports):
```ts
export const SYSTEM_FAMILIES: ReadonlySet<string>;           // C6
export function firstResolvableFamily(stack: string): string | null;  // "Inter, system-ui" → "Inter"
export function collectReferencedFamilies(root: SceneNode, merged: DesignVariables): string[];
export interface ResolvedFamily { family: string; faces: FontFace[]; fetchedAt: string; }
export function resolveFamily(family: string, opts?: { fetchImpl?: typeof fetch }): Promise<ResolvedFamily>;
export function ensureFontsForRender(canvas: Canvas, merged: DesignVariables):
  Promise<{ extraFonts: FontFace[]; warnings: string[] }>;
```
- `resolveFamily`: GET `https://fonts.googleapis.com/css2?family=<Family>:wght@400;500;600;700&display=swap`
  with a Chrome UA (so Google serves woff2). Extract `@font-face` blocks with a regex
  (`/@font-face\s*{[^}]*}/g` + per-block property regexes) — **no CSS parser dependency**.
  Download each binary, content-hash (reuse the hashing approach from `src/assets.ts`),
  write to `<FRAMESMITH_HOME>/fonts/<hash>.woff2`, append to `fonts/registry.json`.
  `fetchImpl` injectable for tests (no network in CI).
- Cache layout honors `FRAMESMITH_HOME` (test isolation — same contract as `test-env.ts`).
- `ensureFontsForRender` returns cached faces as `data:` URIs (`isValidFontFace` at
  `src/renderer.ts:143` already accepts `data:`); on cache miss it tries `resolveFamily`
  once with a short timeout; on failure → warning, never throws.

**Touch points:**
- `src/index.ts` — the async handlers around each `renderToHtml` call site
  (screenshot ~486, export ~545, evaluate ~651, responsive ~698, diff ~736/737, autofix ~949,
  revise ~1024): insert `const { extraFonts, warnings } = await ensureFontsForRender(canvas, merged)`
  and render with `{ ...canvas, fonts: [...(canvas.fonts ?? []), ...extraFonts] }`;
  append `warnings` to the tool result. `renderToHtml` itself stays sync and untouched.
- `set_fonts` handler — new `families?: string[]` param → `resolveFamily` each, persist
  the resolved `FontFace[]` (gstatic URLs) into `canvas.fonts`; css2 URLs in `url`
  routed through the same extractor (FR-A5: relax the docstring + `isValidFontFace`
  rejection path by converting, not by allowing stylesheet URLs into `@font-face src`).
- `set_variables` / `project_set_design_system` / `workspace_set_design_system` /
  `import_design_md` handlers — after a successful write, fire-and-await resolution for
  any new `typography.*.fontFamily`; report `{ fontsResolved, fontsFailed }`.
- `buildFontHead` (`src/renderer.ts:160`) — unchanged (it already renders whatever
  `canvas.fonts` carries; data-URI faces skip preconnect naturally).
- Body default font (FR-A4): `renderToHtml` already receives `canvas`; thread the merged
  `typography.body.fontFamily` through the existing body style (where the system stack
  default lives), emitting `font-family: "<family>", <system tail>`.

### Slice B — Material Symbols

- **Dep:** `@material-symbols/svg-400` (icons at `<pkg>/outlined|rounded|sharp/<name>.svg`).
- `src/icons.ts`: generalize to per-set caches —
  `parseIconRef(ref): { set: 'lucide' | 'material', name: string }` (split on `:`,
  default lucide); `getIconSvg(ref, size, color, style?)` keeps its signature plus
  optional style. Material SVGs are **fill-based** `0 0 24 24` with `width/height="24"`:
  recolor by injecting `fill="<color>"` on the root `<svg>` (they ship `fill` unset →
  inherits; explicitly setting it is deterministic), resize same as Lucide.
- `src/renderer.ts:224` icon branch — pass `node.iconStyle`.
- `src/types.ts` — `iconStyle?: 'outlined' | 'rounded' | 'sharp'`.
- Lazy-load each set's directory listing on first use (same `iconCache` pattern) so the
  13 MB set costs nothing until a `material:` ref appears.

### Slice C — input primitives

- `src/types.ts` — `NodeType` += `'toggle' | 'checkbox' | 'radio' | 'select'`;
  props `checked?: boolean; disabled?: boolean; value?: string;`.
- `src/renderer.ts` — new branches in `renderNode` (before the generic frame fallback),
  each a small pure builder:
  - `toggle`: track `div` (radius = height/2, fill = `checked ? accent : neutral`) +
    knob `div` (absolute, side by `checked`). Default 44×24.
  - `checkbox`: rounded 18×18 box (`checked`: accent fill + inline Lucide `check` SVG
    via `getIconSvg('check', …)`; unchecked: `$border` stroke).
  - `radio`: 18×18 circle + 8px dot when checked.
  - `select`: `fit-content` horizontal frame — `value` text (or muted "Select…" when
    unset) + Lucide `chevron-down` at 16px. Respects `width` for full-width fields.
  - `disabled`: `opacity: 0.5` on the control root.
- Token defaults resolve through the existing `resolveVariables` pass
  (`src/variables.ts:3`) — the builders emit `$accent`/`$border`/`$bg-surface` literals
  the same way structures do, with the structures' neutral-fallback rule (geometry
  literal, color tokenized; `applyStructure`'s `existingColors` seeding pattern at
  `src/structures.ts:547` is the precedent for never crashing unthemed).
- `canvas_evaluate` interaction: rendered primitives are *node types*, not ellipse
  trees — `checkCliche`'s fake-chrome tell (≥3 small circles) keys off `ellipse`
  nodes, so radio groups don't false-positive (verify in tests).

### Slice D — component structures

- `src/types.ts` — `Structure.kind?: 'page' | 'component'` (absent = `'page'`).
- `src/structures.ts`:
  - `applyStructure(canvas, name, opts)` gains `targetId?: string`. `kind: 'component'`:
    locate target (reuse the scene-graph node lookup), **no** empty-canvas guard, no
    root-background seeding, clone + **re-key** all IDs (`<structName>-<n>-` prefix from
    a per-canvas counter — collision-checked against existing IDs), return
    `{ idMap: Record<templateId, liveId> }` alongside today's result. Provenance: C9 —
    don't touch `provenance.structure`; add the component name to the build-log detail.
  - New scaffolds (reusing the `card`/`button`/`stat` helper idiom, `$color` tokens +
    literal geometry, placeholder copy with "— to confirm"):
    `data-table` (toolbar slot, header row, 3 rows × [avatar+name+email cell, role chip,
    status cell, actions icon], divider strokes), `form-field` (label + input frame +
    help text), `toolbar` (search field + 2 filter buttons + primary action),
    `stat-card` (promote the existing `stat()` helper), `toggle-row` (label + `toggle`
    primitive — **depends on Slice C**).
- `src/index.ts` — `apply_structure` docstring + `targetId` param; `list_structures`
  output grouped by kind; diversification signal continues to read *page* structures only.

### Docs (every slice, same PR — FR-E1)
`batch_design`/`set_fonts`/`apply_structure` docstrings, server `INSTRUCTIONS` +
`GOTCHAS` (`src/index.ts:32/66`), README Tools + Icons + env-var sections, GUIDELINES
(Custom fonts section rewrite — "by name" is now the happy path; primitives pattern;
component-structure pattern).

---

## 4. TASKS  (slice-ordered; each slice is independently PR-able)

**Slice A — fonts by name** *(highest fidelity leverage — first)*
- [ ] A1: `src/fonts.ts` core — `SYSTEM_FAMILIES`, `firstResolvableFamily`, `collectReferencedFamilies`, css2 extractor, disk cache (FRAMESMITH_HOME-aware), `resolveFamily` with injectable fetch
- [ ] A2: `ensureFontsForRender` + wire into the 7 `renderToHtml` call-site handlers; warnings in tool results
- [ ] A3: `set_fonts` `families:` param + css2-URL extraction; persist resolved faces
- [ ] A4: token-write hooks (`set_variables`/project/workspace/`import_design_md`) + body default font (C7)
- [ ] A5: tests — `test-fonts-by-name.ts` (stubbed fetch: extractor, cache hit/miss, skip-list, warning path, body default; one optional live-network smoke gated behind an env flag)
- [ ] A6: docs per FR-E1

**Slice B — Material Symbols**
- [ ] B1: dep + `parseIconRef` + per-set loading + fill-based recolor; `iconStyle` prop
- [ ] B2: tests — `test-material-icons.ts` (both sets, size/color, unknown-name degrade, style variants)
- [ ] B3: docs per FR-E1 (incl. the `material:` prefix in the `batch_design` docstring)

**Slice C — input primitives**
- [ ] C1: types + 4 renderer builders + token-default styling
- [ ] C2: tests — `test-primitives.ts` (checked/unchecked computed styles, token theming vs neutral fallback, disabled, no fake-chrome false-positive on a radio group)
- [ ] C3: docs per FR-E1

**Slice D — component structures** *(after C — `toggle-row` consumes the primitive)*
- [ ] D1: `Structure.kind` + `targetId` + re-keying + idMap; provenance rule (C9)
- [ ] D2: 5 component scaffolds
- [ ] D3: tests — `test-component-structures.ts` (repeat-stamp non-collision, idMap, page-structure behavior unchanged, build-log detail)
- [ ] D4: docs per FR-E1

**Close-out**
- [ ] VISION Phase 16 ticks; comment on #77 mapping shipped slices to its gaps; release is Victor's call

---

## 5. ANALYZE  (risks & edge cases)

- **Google Fonts CSS shape drift.** The css2 response is informally stable but not an
  API contract. Mitigation: the extractor is regex-on-`@font-face`-blocks (resilient to
  ordering/whitespace), tests pin a captured fixture, and extraction failure is a
  *warning*, never a render failure.
- **Async resolution vs sync renderer.** `renderToHtml` stays sync; all resolution
  happens in the already-async tool handlers. No render path acquires a new failure mode
  — worst case is exactly today's behavior plus a warning.
- **Cache poisoning / staleness.** Registry entries carry `fetchedAt`; no TTL eviction in
  v1 (fonts are immutable-ish; a `family@hash` mismatch just re-fetches). Corrupt cache
  file → treated as cold cache.
- **Repo-store size.** Persisted `FontFace`s use gstatic URLs (small JSON); data URIs are
  render-ephemeral only (C4) — consistent with the asset-externalization philosophy.
- **Material recolor correctness.** Material SVGs may contain multiple `path`s; setting
  `fill` on the root `<svg>` relies on inheritance — verify against a sample across all
  three styles in tests (a path with an explicit `fill` attribute would need a broader
  replace).
- **Primitive defaults on unthemed canvases.** Follow the structures rule (geometry
  literal, color tokens with neutral fallback) — acceptance in FR-C2 explicitly covers
  the bare-canvas case.
- **ID re-keying collisions.** Component stamping must collision-check against the live
  tree (an agent may have copied a previous stamp via `C()`); the per-canvas counter +
  existence check covers it; test covers stamp-copy-stamp.
- **`ensureFresh` interplay.** `apply_structure` with `targetId` mutates — it already
  goes through the mutating-tool path (`ensureFresh` at `src/index.ts:443` pattern);
  keep that for the new param.
- **Benchmark baselines.** Slices C/D add node types + scaffolds but don't change
  heuristic scoring; `benchmark/baselines.json` should be unaffected — verify, don't
  regenerate blindly (Phase 12's lesson).
