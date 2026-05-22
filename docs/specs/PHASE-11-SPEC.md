# Phase 11 — Design Variety & Anti-Sameness (v1.1)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-05-22.

---

## 1. SPECIFY

### Problem
Left to defaults, AI assistants converge on the same handful of layouts — centered hero, three-card row, one accent on a dark surface. framesmith hands the agent primitives but no *structures* to choose from and no *memory* of what it built last, so every session drifts to the same shape. Two levers fix this: a library of named page structures the agent stamps and fills, and a per-project build log that nudges the next canvas to differ.

**Authoring intent (from VISION):** structures are scene-graph *data*, not prompt text — the agent applies one, then **renders and verifies** it, an advantage code-only tooling lacks.

### Goals
- Give the agent a deliberate menu of page *shapes* (distinct from color/token presets).
- Make "differs from last time" *computable*, not a vibe.
- Record what was built per project; surface it at create-time to steer variety.

### User stories
- **US1** — As the authoring agent, I can list available layout structures with their taxonomy axes, so I choose a deliberate page shape instead of defaulting.
- **US2** — As the authoring agent, I can apply a structure to a canvas and get a filled-in placeholder skeleton I then populate, render, and verify.
- **US3** — As the authoring agent, when I create a canvas in a project, I see what was recently built there and a hint to differ on ≥1 taxonomy axis.
- **US4** — As the maintainer/viewer, each canvas records its provenance (structure, preset, axes) — stored in a per-project build log and visible in the viewer.

### Functional requirements
| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-1 | **Structure library** — registry of named structures; each = partial scene tree of placeholder children + taxonomy tags. Distinct from presets (presets carry tokens/components; structures carry layout skeleton). | A structure resolves to `SceneNode[]` placeholder children + an `axes` object. |
| FR-2 | **`list_structures` tool** — returns `name`, `description`, `axes` per structure. | Mirrors `list_presets` shape; callable with no args. |
| FR-3 | **`apply_structure` tool** — given `canvasId` + `structure`, inserts the scaffold into the canvas root, stamps provenance, returns a **populate instruction**: each placeholder node `{ id, role }` + a one-line "fill with …" label per role. | Empty canvas → scaffold inserted; provenance stamped; per-placeholder `{id, role}` list returned. |
| FR-4 | **Taxonomy** — four fixed independent axes, each with enumerated values; every structure tagged on all four: **`heroTreatment`** (none\|marquee\|split\|stat-led\|editorial), **`density`** (airy\|balanced\|dense), **`rhythm`** (uniform\|alternating\|asymmetric), **`alignment`** (centered\|left\|split). | Two structures are comparable axis-by-axis; "differs" is a set diff over these four. |
| FR-5 | **Provenance stamp** — canvas records `{ structure, preset, axes, seed?, at }` (`seed` *reserved*, see C6); survives persistence + repo round-trip. | Stamp present after `apply_structure`; survives bind + reload (deterministic serialization). |
| FR-6 | **Per-project build log** — append-only log of provenance entries, written in *both* backends (global + repo-bound). | Entry appended on `apply_structure`; preset updated on `apply_preset`; readable per project. |
| FR-7 | **Diversification signal** — `canvas_create` (and `list_structures`) surface the last **N = 5** build-log entries for the target project + a computed "axes to differ on" hint. | Return payload includes recent entries + hint; advisory, never blocking. |

**Authoring expectation (non-functional, A-S3):** after `apply_structure`, the agent is expected to `screenshot` and verify the scaffold before populating. This is steered by tool-description guidance, not enforced by a tool gate (see CON-2).

### Non-goals (explicit scope cuts)
- **No content generation** — scaffolds carry labeled placeholders only (see C8); honest-content rules are Phase 12.
- **No variety *enforcement*** — FR-7 is an advisory signal, not a gate. Scored critique is Phase 13.
- **No viewer redesign** — provenance display is a minimal addition (its own optional slice).
- **No per-breakpoint scaffolds** — structures are desktop-first, reusing Phase 5 `responsive` hints.

---

## 2. CLARIFY  (forks — all resolved 2026-05-22)

- **C1 — Structure ⟂ Preset.** *Decided:* orthogonal. Structures carry **no colors**; they reference tokens via existing `$token` resolution so an applied preset themes them. A canvas can have both.
- **C2 — `apply_structure` on a non-empty canvas.** ✅ *Decided:* **refuse-by-default + explicit `replace: true` flag** (clears root children first). Insert-alongside rejected (silent layout soup).
- **C3 — Where provenance lives.** ✅ *Decided:* **general `metadata?` bag** on `Canvas` with `provenance` inside. Resolves CON-1 + XP-1 in one migration; Phases 12 (cliché) and 13 (rubric verdict) reuse the same bag. *Back-compat:* the field is **optional**, so existing canvases load unchanged and serialize it only when present — no migration step.
- **C4 — Build-log write trigger.** *Decided:* write/append on `apply_structure` (structure + axes known then); update the `preset` field on `apply_preset`; a `canvas_create` with no structure logs a minimal entry.
- **C5 — Diversification strictness.** *Decided:* advisory hint only; compute "recently repeated axes," recommend differing on ≥1, never block. (Enforcement would belong to Phase 13's revision threshold.)
- **C6 — "seed".** VISION says "structure / preset / **seed**." *Decided:* reserve an optional `seed` for a future "pick a structure for me" auto-selector; record the chosen structure now, defer auto-pick.
- **C7 — Initial roster size.** ✅ *Decided:* ship **all 6** in Slice A (marquee-hero, bento-grid, stat-led, editorial-longform, split-workbench, catalogue).
- **C8 — Placeholder content convention.** *(added by analyze A-C1)* *Decided:* placeholders are **labeled neutral blocks**, never fabricated data — `text` nodes carry their role as content ("Headline", "Body copy", "Metric — to confirm"); `frame` / `image` placeholders are plain surfaces. Anticipates Phase 12 honest-content; makes a freshly-applied scaffold render meaningfully for verification.
- **C9 — Page width.** *(added by analyze A-C2)* *Decided:* a structure sets `root` width (desktop default **1280**) and relies on Phase 5 fluid widths + `responsive` hints for adaptation; child nodes avoid hardcoded px so the scaffold reflows.

---

## 3. PLAN  (technical — mapped to real symbols)

### New module: `src/structures.ts` (mirrors `src/presets.ts:139–156`)
```ts
export type StructureAxes = {
  heroTreatment: 'none' | 'marquee' | 'split' | 'stat-led' | 'editorial';
  density:       'airy' | 'balanced' | 'dense';
  rhythm:        'uniform' | 'alternating' | 'asymmetric';
  alignment:     'centered' | 'left' | 'split';
};
export interface Structure {
  name: string;
  description: string;
  axes: StructureAxes;
  nodes: SceneNode[];          // placeholder children inserted under canvas.root
}
const structureMap = new Map<string, Structure>();
export function listStructures(): { name; description; axes }[] { ... }
export function getStructure(name: string): Structure | undefined { ... }
export function registerStructure(s: Structure): void { ... }   // keeps the DESIGN.md-style dynamic door open
```
Placeholder children use existing node props + Phase 5 `responsive` hints. **Theming split (A-P4):** geometry (width/gap/padding/cornerRadius/fontSize) is **literal numbers** (crash-safe on unthemed canvases); fills/colors/strokes are **`$color` token refs** (themeable). Text content is labeled roles per C8.

### Types: `src/types.ts`
- Add `StructureAxes` (or import).
- Add to `Canvas` (line 137–156) per **C3**:
  ```ts
  metadata?: { provenance?: Provenance; [k: string]: unknown };
  ```
  ```ts
  interface Provenance { structure?: string; preset?: string; axes?: Partial<StructureAxes>; seed?: string; at: string; }
  interface BuildLogEntry extends Provenance { canvasId: string; canvasName: string; }
  ```

### Tools: `src/index.ts`
- `list_structures` — mirror `list_presets` (700–707): `server.tool('list_structures', desc, {}, async () => json(listStructures()))`.
- `apply_structure` — mirror `apply_preset` (709–737):
  - input `{ canvasId: z.string(), structure: z.string(), replace: z.boolean().optional() }`
  - get structure → if root non-empty: refuse unless `replace:true`, which sets `canvas.root.children = []` first (A-P3) → insert `structure.nodes` under `canvas.root` (reuse `operations.parseAndExecute` `I` ops, or direct push) → stamp `canvas.metadata.provenance` → `appendBuildLog(...)` → `touchCanvas(id)` → return **node IDs + populate instruction only** (no diversification context — that lives in `canvas_create`/`list_structures`, per A-P2).
  - **seed default colors (A-P4):** after insert, for any `$color` token the structure references that is still unresolved under `getCanvasTokens(canvas)`, write a neutral default into `canvas.variables.colors`. This guarantees an unthemed canvas renders; a later `apply_preset`/design-system merges over it.
- `canvas_create` handler (42–71) — append recent build-log + `diversificationHint` to the returned JSON (hook before line 56).

### Persistence: `src/repo-store.ts` (+ `src/scene-graph.ts` routing)
- Add `readBuildLog(projectId)` / `appendBuildLog(projectId, entry)` routed by `isRepoBound()` — mirror the `persistWorkspaces` switch at `src/workspaces.ts:46–47` (not a per-canvas path):
  - repo-bound → `.framesmith/<projectDir>/build-log.json` (the repo layout *has* per-project subdirs)
  - global → **`~/.framesmith/build-logs.json`**, a single file keyed by `projectId` (matches the flat global convention `workspaces.json` / `projects.json` at `workspaces.ts:34–35`; **the global store has no per-project subdirs** — corrected by analyze A-P1). Write via `writeAtomic` (`workspaces.ts:41`) + `stableStringify`.
- Serialize with `stableStringify` (`repo-store.ts:123`) so log + provenance stay diff-clean. **Append per-canvas entries in stable order** to minimize git merge conflicts.
- `Canvas.metadata` flows through existing `writeCanvasToDir` (197–212) unchanged (it serializes the whole canvas) — verify in round-trip test.

### Diversification helper (new, small)
`computeDiversificationHint(recent: BuildLogEntry[]): { repeatedAxes: string[]; suggestion: string }` — tally axis values across last N, return the most-repeated + a "differ on ≥1 of …" suggestion string.

### Viewer (optional slice C)
- `src/aggregate.ts` / `src/viewer.ts` — show `provenance` on the canvas detail page. Read-only.

### Conventions (CLAUDE.md)
- Register tools in `src/index.ts`; document in `README.md` Tools section; tick VISION.md checklist.
- Tool descriptions steer toward picking a structure + differing on an axis.
- Tests redirect storage via `FRAMESMITH_HOME` / `import './test-env.js'`.

---

## 4. TASKS  (atomic, PR-sized — one PR per task, per the PR-flow rule)

**Build order (A-T4):** T1 → everything; T2a/T2b → T3, T4; T4 → T7; T6 → T7 → T9.

### Slice A — Structure library + apply (core value)
- **T1** — `src/types.ts`: add `StructureAxes`, `Structure`, `Provenance`, `BuildLogEntry`; add `metadata?` to `Canvas`.
- **T2a** — `src/structures.ts`: registry + `list/get/registerStructure` + **2 reference structures** (marquee-hero, bento-grid) as labeled-placeholder trees (C8) w/ root width (C9), `responsive` hints + `$token` refs.
- **T2b** — remaining **4 structures** (stat-led, editorial-longform, split-workbench, catalogue). *(Split from T2 by analyze A-T1 — 6 hand-authored trees is too big for one review; still all 6 in Slice A per C7.)*
- **T3** — `src/index.ts`: register `list_structures` (mirror `list_presets`).
- **T4** — `src/index.ts`: register `apply_structure` (insert scaffold, refuse-non-empty unless `replace`, stamp `metadata.provenance`, return node IDs + populate instruction).
- **T5** — Docs: README Tools section + VISION boxes (FR-1/2/3 + taxonomy) + tool-description guidance. Tests (`FRAMESMITH_HOME` tmp): smoke (`apply_structure` → `read_nodes` shows scaffold) **+ C2 assertion** (apply on non-empty root errors without `replace`, succeeds with it — A-T2).

### Slice B — Build log + provenance persistence
- **T6** — `src/repo-store.ts`: `readBuildLog`/`appendBuildLog` for both backends (repo subdir vs global `build-logs.json`) via `stableStringify`; routing helper mirroring `workspaces.ts:46–47`.
- **T7** — Wire `apply_structure` (append entry) + `apply_preset` (update `preset` on the latest entry; **if none exists, create a minimal entry** — don't silently drop, A-T3).
- **T8** — Round-trip test (`FRAMESMITH_HOME` tmp): provenance + build-log survive `canvas_bind` + reload; deterministic diff.

### Slice C — Diversification signal + viewer
- **T9** — `computeDiversificationHint`; surface last-5 entries + hint in `canvas_create` and `list_structures` returns.
- **T10** — *(optional)* viewer shows provenance on canvas detail.
- **T11** — Final VISION ticks + README polish (all 6 structures already shipped in T2a/T2b).

---

## 5. ANALYZE  (read-only pass over **every** stage, not just a closing gate)

Spec-kit's `analyze` audits each artifact for internal defects **and** drift between stages. Findings below are per-stage; severity in brackets. Fixes were folded back into the upstream sections (see §5.7).

### 5.1 Analyze — SPECIFY
- **A-S1 [med]** FR-4 (taxonomy) is untestable from Specify alone — the axis *values* only appear in §3 Plan. A requirement should be verifiable where it's stated. → Enumerate the axes in §1. *(fixed)*
- **A-S2 [med]** FR-7 says "last **N** entries" but never gives N. → Pin **N = 5** in the requirement. *(fixed)*
- **A-S3 [low]** US2's "renders + verifies" maps to no FR. It can't be a code requirement (see CON-2), but Specify should state it as an explicit *authoring expectation* so it isn't lost. → Added as a noted non-functional expectation. *(fixed)*
- **A-S4 [med]** FR-3 acceptance names a "populate instruction" with no defined shape. → Specify it minimally: the return lists each placeholder node ID + a one-line "fill with …" label. *(fixed in §3)*
- **A-S5 [low]** `seed` appears in FR-5's provenance but no requirement defines it. → Mark it explicitly *reserved* (C6) in Specify so a reviewer doesn't expect a working selector.

### 5.2 Analyze — CLARIFY
- **A-C1 [HIGH]** Missing decision: **placeholder content convention.** "Placeholder children" is undefined — empty frames render blank, which breaks "renders + verifies" and pre-bakes the Phase-12 honest-content problem. → New **C8**: placeholders are *labeled neutral blocks* — `text` nodes carrying their role ("Headline", "Body copy", "Metric — to confirm"), `frame`/`image` placeholders as plain surfaces. No fabricated data. *(added)*
- **A-C2 [med]** Missing decision: **does a structure set the page width?** A "page structure" implies a target viewport; today undefined. → New **C9**: structures set `root` width (desktop default, e.g. 1280) and rely on Phase 5 fluid widths + `responsive` hints; child nodes avoid hardcoded px. *(added)*
- **A-C3 [low]** C3 changes the `Canvas` shape — Clarify never states the back-compat story. → Note: `metadata?` is optional, so existing canvases load unchanged and the repo round-trip serializes it when present. No migration needed. *(noted in C3)*

### 5.3 Analyze — PLAN
- **A-P1 [HIGH — factual error]** The Plan's global build-log path `~/.framesmith/projects/<id>/build-log.json` **does not match reality.** The global store is *flat*: `~/.framesmith/canvases/<id>.json` plus index files `workspaces.json` / `projects.json` (verified `src/workspaces.ts:34–35`). There are **no** per-project subdirs globally. → Fix: global → **`~/.framesmith/build-logs.json`** (single file keyed by `projectId`, matching the index-file convention; write via `writeAtomic` + `stableStringify`); repo-bound → `.framesmith/<projectDir>/build-log.json` (the repo layout *does* have per-project subdirs). Routing mirrors `persistWorkspaces`' `isRepoBound()` switch (`src/workspaces.ts:46–47`). *(fixed in §3)*
- **A-P2 [med — Plan↔Tasks drift]** Plan had `apply_structure` returning "diversification context," but FR-7 + Tasks place that signal in `canvas_create` / `list_structures` (Slice C / T9). `apply_structure` shouldn't carry it. → Trim `apply_structure`'s return to node IDs + populate instruction. *(fixed in §3)*
- **A-P3 [low]** The `replace` flag (C2) needs an explicit mechanism. → Specify: `replace:true` sets `canvas.root.children = []` before inserting, then re-stamps provenance. *(noted in §3)*
- **A-P4 [HIGH — corrected during T2a build]** ~~Phase 9 `mergeDesignTokens` falls back to built-in defaults~~ — **FALSE.** `getCanvasTokens` (`src/workspaces.ts:309–313`) merges only workspace → project → canvas variables; **there is no built-in default layer**, and unresolved `$token` refs stay as literal strings — which the renderer note at `workspaces.ts:305–307` warns can *crash* on numeric fields (`node.cornerRadius.map is not a function`). → **Resolution:** (1) structures use **literal geometry** (width/gap/padding/cornerRadius/fontSize as numbers) so they never crash unthemed; (2) structures use **`$color` token refs** for fills/colors/strokes (themeable per C1); (3) **`apply_structure` (T4) seeds a neutral default color palette** for any color token missing after inheritance, so an unthemed canvas still renders — presets/design-systems still override since they merge over the seed.

### 5.4 Analyze — TASKS
- **A-T1 [med]** **T2 is too large for one reviewable PR** — registry + 6 hand-authored scene trees. C7 keeps all 6 in Slice A, but task *granularity* can still split. → Split into **T2a** (registry + `list/get/register` + 2 reference structures) and **T2b** (remaining 4). *(fixed in §4)*
- **A-T2 [med]** **No test for C2** (refuse-on-non-empty + `replace`). → Add the assertion to T5. *(fixed in §4)*
- **A-T3 [low]** T7 edge case: `apply_preset` "updates the latest build-log entry," but a canvas may have *no* entry (preset applied to a hand-built canvas). → Define: if none exists, `apply_preset` creates a minimal entry (don't silently drop it). *(noted in §4)*
- **A-T4 [low]** Dependency order isn't stated. → **T1 → everything; T2a/b → T3,T4; T4 → T7; T6 → T7 → T9.** Added as a build-order note. *(fixed in §4)*

### 5.5 Cross-artifact
**Coverage matrix** — every FR maps to ≥1 task; reverse-checked, no orphan tasks:

| VISION bullet | FR | Tasks |
|---|---|---|
| Layout scaffold library | FR-1 | T2a, T2b, T11 |
| `list_structures` / `apply_structure` | FR-2, FR-3 | T3, T4 |
| Structure taxonomy | FR-4 | T1, T2a |
| Per-project build log | FR-6 | T6, T7, T8 |
| Diversification signal | FR-7 | T9 |
| Provenance stamp (+ viewer) | FR-5 | T1, T4, T7, T10 |
| "renders + verifies" (expectation) | A-S3 | T5 smoke + agent screenshot loop |

**Contradictions:** CON-1 (provenance vs no metadata field) and CON-2 ("verifies" can't be a tool gate) — both resolved (C3; tool-description guidance).
**Cross-phase:** XP-1 metadata bag serves Phases 12/13 (avoids 2 migrations); XP-2 taxonomy axes feed Phase 13's "variety" rubric axis — keep names stable; XP-3 repo build-log is git-committed → append-only + `stableStringify` keeps merges additive.
**Test coverage:** FR-1/2/3 → T5 smoke; FR-4 → T2a unit (all axes present); FR-5/6 → T8 round-trip; FR-7 → T9 unit; **C2 → T5** (new). All tests redirect storage via `FRAMESMITH_HOME` / `test-env.js`.

### 5.6 Severity roll-up
- **2 HIGH:** A-C1 (placeholder convention) and A-P1 (wrong global path — a real factual error caught only by checking `workspaces.ts`).
- **5 med, 5 low.** All folded back upstream; none blocks the build after the fixes.

### 5.7 Verdict
After the analyze pass, the chain is consistent and the one factual error (A-P1) is corrected against verified source. Decisions locked (C2/C3/C7) plus the two analyze-driven additions (C8 placeholder convention, C9 page width). No orphan tasks; every FR + C2 has a test. **Ready to build Slice A**, starting T1.
