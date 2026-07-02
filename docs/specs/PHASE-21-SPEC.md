# Phase 21 — Point-and-Tell Feedback (v1.8)

> Spec-driven breakdown, borrowing spec-kit's flow: **Specify → Clarify → Plan → Tasks → Analyze**.
> This is a planning artifact, not code. File/symbol references verified against `src/` on 2026-07-02.

---

## 1. SPECIFY

### Problem
The weakest link in the design loop is the human describing visual changes in prose: *"the third card — no, the other one — make the top part tighter."* Machine critique already flows to the agent as structured data (`canvas_evaluate` comments, the Phase 13 rubric); **human critique doesn't** — it arrives as chat text the agent must re-ground against the scene graph by guessing. Meanwhile the viewer renders every canvas as live HTML where **every element already carries `data-node-id`** (renderer.ts:233) in a **same-origin iframe** the page can reach into (the Phase 19 `highlightNode` does exactly this, viewer.ts:1262–1295). The viewer knows which node every pixel belongs to; the human just has no way to say so.

Let the user click any element in the viewer, type a note, and have it land as structured feedback — `{ nodeId, comment }` — that the agent picks up through a tool on its next turn. The inverse of `canvas_evaluate`: point-and-tell instead of describe-and-hope.

**Why this is on-axis:** it only works because the design is an open scene graph rendered as real HTML (pixel → element → node is a lookup, not ML), and because the agent — not the human — is the one editing. In direct-manipulation tools the human fixes it themselves; here the human directs and the agent executes, so pointing is the natural input.

### Goals
- **Comment mode in the viewer detail page**: click an element → resolve its node → popover → save a comment anchored to that `nodeId` (or to the canvas as a whole).
- **Comments persist on the canvas** (both backends: global store + bound repo `.framesmith/` files) so they're git-diffable and survive restarts; the running MCP server picks them up **without restart** via the existing `ensureFresh` mtime reload.
- **Agent surface**: a tool to read open feedback (with enough node context to act without extra lookups) and a tool to resolve items after addressing them.
- **Loop integration**: open feedback is visible at the natural checkpoints (`canvas_list`, `canvas_evaluate`) and the operating contract says *never present a canvas with open feedback* — same bar as open inspector comments.
- **Viewer surface**: a Feedback tab in the Phase 19 inspector listing open/resolved comments, with click-to-highlight (reuse `highlightNode`) and user-side resolve/delete.

### User stories
- **US1** — As the user, I click the misaligned card in the viewer, type "tighter — the eyebrow is floating", and I'm done. No prose archaeology about which card I meant.
- **US2** — As the authoring agent, I call `get_feedback(canvasId)` and receive `[{ id, nodeId, comment, node: { type, name, text? } }]` — enough context to translate each note into `batch_design` ops immediately.
- **US3** — As the authoring agent, after applying changes I call `resolve_feedback(canvasId, ids, note?)` so the loop converges and the user sees what was addressed.
- **US4** — As the user, I open the viewer's Feedback tab, see open comments pinned to their nodes, click one to flash the element, and can resolve or delete stale ones myself.
- **US5** — As the user on a bound repo, my comments are plain JSON in `.framesmith/` — I can review them in a git diff, and a teammate's `git pull` delivers them to *their* agent.

### Functional requirements
| ID | Requirement | Acceptance |
|----|-------------|-----------|
| FR-1 | **Anchored comments** — clicking an element in the detail-page iframe resolves the nearest ancestor with `data-node-id` and opens a popover; saving POSTs `{ nodeId, comment }`. A breadcrumb in the popover lets the user re-scope to an ancestor (leaf vs card vs section). | Click a text inside a card → popover shows `text ‹ frame "Card" ‹ frame "Grid"` chain; saving stores the chosen node's id. |
| FR-2 | **Canvas-level comments** — a comment can omit `nodeId` (general note: "whole thing feels cramped"). | Feedback entry with `nodeId: undefined` round-trips and renders in the Feedback tab without a pin. |
| FR-3 | **Persistence on the canvas** — comments live at `canvas.metadata.feedback[]`; writes go through the correct backend (global: mutate + `touchCanvas`; repo-mirrored: write-back to the repo file like `archiveRepoCanvas`). | Comment on a bound canvas appears in the repo JSON; comment on a global canvas survives viewer restart. |
| FR-4 | **Server picks up viewer writes live** — a comment added while the MCP server is running is visible to the next `get_feedback` call without restart. | `ensureFresh` reloads the repo canvas on mtime change (existing behavior — verify it fires for the metadata-only write). |
| FR-5 | **`get_feedback(canvasId?)`** — returns open (default) or all feedback; each anchored entry carries a **node summary snapshot** `{ type, name?, text? }` captured at comment time, plus `orphaned: true` when the node no longer exists. Omitting `canvasId` sweeps the current context's canvases and returns per-canvas counts + entries. | Entry on a since-deleted node still returns with its snapshot and `orphaned: true`; never throws. |
| FR-6 | **`resolve_feedback(canvasId, feedbackIds, note?)`** — marks entries resolved (`resolvedAt`, `resolvedBy: 'agent'`, optional note); unknown ids reported per-id, not thrown. Viewer resolve sets `resolvedBy: 'user'`. | Mixed valid/unknown ids → `{ resolved: [...], notFound: [...] }`. |
| FR-7 | **Checkpoint visibility** — `canvas_list` rows and `canvas_evaluate` results include an `openFeedback` count when > 0; the server `INSTRUCTIONS` + `GOTCHAS` state the contract: open feedback blocks "present", same as open inspector comments. | Evaluate on a canvas with 2 open comments reports `openFeedback: 2`; discoverability surfaces updated in the same PR (the #77 lesson). |
| FR-8 | **Feedback tab in the viewer inspector** — third tab beside Quality / Design system: open + resolved lists, click-to-highlight via `highlightNode`, resolve/delete buttons calling JSON endpoints. Open-count badge on the tab. | Tab renders both states; clicking an entry outlines its node in the iframe; resolve updates without a full reload. |

### Non-goals (explicit scope cuts)
- **No threads, no identity, no realtime** — flat single-author notes; `resolvedBy` is just `'agent' | 'user'`. Multi-user attribution needs auth the viewer doesn't have.
- **No pixel-coordinate pins** — anchoring is node-id only. A coords fallback for orphaned comments is a stretch item, not v1.
- **No agent push/notification** — the agent reads feedback at its natural checkpoints; no long-poll or wakeup channel. (An MCP notification is a possible future slice; nothing in this design blocks it.)
- **No comment-driven auto-revision** — feedback feeds the *agent's* judgment, not `canvas_revise`'s reviser table. The human's note deserves the full model, not a template.
- **No build-log coupling** — resolving feedback doesn't stamp the build log in v1 (provenance is about what *produced* the design).

---

## 2. CLARIFY  (forks — recommendations; ★ = needs user confirm)

- **C1 — Storage location.** ★ **Decided 2026-07-02: on-canvas.** *Recommend:* **on the canvas**, `metadata.feedback[]` — travels with the canvas across bind/move/export, git-diffable in bound repos, `ensureFresh` delivers it to the running server for free, and the viewer's file-watcher re-aggregates on the same write. Alternative (separate `.framesmith/feedback.json`): keeps canvas files pristine but adds a second sync/watch/write-back surface and breaks the "one canvas = one file" model. Con of on-canvas: comment writes churn the canvas mtime → server reload; acceptable (reload is cheap and correctness-preserving).
- **C2 — Tool surface.** ★ **Decided 2026-07-02: two tools.** *Recommend:* **two tools, `get_feedback` + `resolve_feedback`** — matches the `get_variables`/`set_variables` naming pattern and keeps read vs mutate separate. Alternative (one `canvas_feedback(action)`): fewer tools but an enum-action grab-bag, unlike every other tool on the server. The agent never *writes* comments — authoring is the human's side; agent replies live in the resolve `note`.
- **C3 — Hit-test granularity.** *Recommend:* default to the **deepest** node under the click, with an **ancestor breadcrumb in the popover** to re-scope (hover a crumb → outline preview via the `highlightNode` mechanics). Deepest-only frustrates "this whole card" notes; ancestor-only loses precision. The chain is cheap: walk `closest('[data-node-id]')` parents in the iframe DOM.
- **C4 — Orphan handling.** *Recommend:* snapshot `{ type, name?, text? (≤80 chars) }` into the entry at comment time; at read time, if `findNode` misses, keep the entry **open** but flag `orphaned: true`. Never auto-resolve — the concern may still apply to the node's replacement ("the CTA is too loud" survives the CTA being rebuilt).
- **C5 — Where checkpoint counts surface.** *Recommend:* `canvas_list` + `canvas_evaluate` only (plus `init`'s workspace summary if trivial). NOT on every `batch_design` result — noise on the hot path; the contract line in `GOTCHAS` covers behavior.
- **C6 — Feedback on aggregate-mirrored canvases from *other* repos.** *Recommend:* viewer allows commenting on any canvas it shows (that's the point — the human reviews in one place); the MCP server's `get_feedback` stays scoped to its own context (bound repo or global), same isolation rule as Phase 10 slice 2. A comment on another repo's canvas waits for *that* repo's agent.
- **C7 — Comment editing.** *Recommend:* v1 = delete + re-add (entries are short). Edit-in-place is viewer-only sugar, deferrable.

---

## 3. PLAN  (technical — mapped to real symbols)

### `src/types.ts` — data model
```ts
/** Phase 21 — a point-and-tell comment anchored to a node (or the canvas). */
export interface FeedbackEntry {
  id: string;                      // "fb-" + short random suffix, unique within the canvas
  nodeId?: string;                 // absent = canvas-level note
  comment: string;
  at: string;                      // ISO timestamp
  node?: { type: string; name?: string; text?: string };  // snapshot at comment time (C4)
  resolvedAt?: string;
  resolvedBy?: 'agent' | 'user';
  resolutionNote?: string;
}
// Canvas.metadata gains: feedback?: FeedbackEntry[];
```

### `src/feedback.ts` — NEW, pure testable core (the Phase 13 `critique.ts` pattern)
- `addFeedback(canvas, { nodeId?, comment })` — validates node exists (when anchored), captures the snapshot, generates the id, appends. Pure mutation; caller persists.
- `listFeedback(canvas, { includeResolved? })` — computes `orphaned` per entry via `findNode` at read time.
- `resolveFeedback(canvas, ids, by, note?)` → `{ resolved, notFound }`.
- `openFeedbackCount(canvas)` — the checkpoint helper for FR-7.

### `src/aggregate.ts` — generic repo write-back
- Refactor: extract `updateRepoCanvas(id, mutate: (c: Canvas) => boolean)` from the load→mutate→`writeCanvasToDir` shape shared by `archiveRepoCanvas`/`deleteRepoCanvas`; both become thin wrappers.
- `feedbackRepoCanvas(id, mutate)` = `updateRepoCanvas` with a feedback mutator (add / resolve / delete).

### `src/viewer.ts` — comment mode + Feedback tab + JSON API
- **API**: `POST /api/canvas/:id/feedback` (add), `POST /api/canvas/:id/feedback/:fbId/resolve` (`resolvedBy: 'user'`), `DELETE /api/canvas/:id/feedback/:fbId`. Route by backend like the archive endpoints (viewer.ts:140): `getRepoLocation(id) ? feedbackRepoCanvas(...) : mutate via scene-graph + touchCanvas`. Comment text runs through the existing `esc()` on render (XSS).
- **Comment mode** (detail page): toolbar toggle → main iframe gets a capture-phase click listener on its `contentDocument` (same-origin, as `highlightNode` proves); `closest('[data-node-id]')` resolves the anchor; walk parents for the breadcrumb chain (node names come from the scene graph JSON already embedded for the inspector). Popover = positioned div in the parent page; Esc/blur cancels. Compare-mode cells stay non-interactive in v1 (main frame only).
- **Feedback tab**: third `insp-tab` (Phase 19 slice B pattern, viewer.ts:1297); entries clickable → `highlightNode(nodeId)`; badge = open count; resolved section collapsed.

### `src/index.ts` — tools + discoverability (same PR, per the #77 lesson)
- `get_feedback` / `resolve_feedback` tools — thin handlers over `src/feedback.ts` + `touchCanvas` / repo-store persistence; `ensureFresh(id)` before reads AND writes (comments may have just arrived from the viewer).
- `canvas_list` rows + `canvas_evaluate` result gain `openFeedback` (only when > 0).
- `INSTRUCTIONS` + `GOTCHAS`: "check `get_feedback` when picking up a canvas; open feedback blocks present — resolve every comment via `resolve_feedback` after addressing it."

### Docs & tests
- README Tools rows ×2, `docs/GUIDELINES.md` workflow section ("the human can point: read feedback first"), VISION Phase 21.
- `test-feedback.ts` — pure core: add/snapshot/orphan/resolve/notFound/canvas-level; both persistence backends via `FRAMESMITH_HOME` tmp redirect (`import './test-env.js'` first).
- `test-viewer-feedback.ts` — ephemeral server, JSON API round-trip on both backends (no Chrome needed; iframe interaction is manually verified).
- `test-discoverability.ts` — extend tool + report-field lists (`get_feedback`, `resolve_feedback`, `openFeedback`).

---

## 4. TASKS  (slices — each independently PR-able)

- **Slice A — model + core + tools.** `FeedbackEntry`, `src/feedback.ts`, persistence on both backends (incl. the `updateRepoCanvas` refactor), `get_feedback`/`resolve_feedback`, `test-feedback.ts`, discoverability surfaces. *Agent-usable end-to-end via hand-written JSON before the viewer UI exists.*
- **Slice B — viewer.** JSON API endpoints, comment mode (hit-test + breadcrumb + popover), Feedback inspector tab, `test-viewer-feedback.ts`.
- **Slice C — loop integration + polish.** `openFeedback` on `canvas_list`/`canvas_evaluate`, `init` summary line, GUIDELINES workflow section, docs-steward pass, screenshots for README if the viewer UI is hero-worthy.

## 5. ANALYZE  (risks / open questions)

- **Concurrent write races** (viewer writes while the server holds the canvas): server side is covered by `ensureFresh` before every feedback op; the reverse (server writes, viewer holds stale) is covered by the existing watcher re-aggregation. The unguarded window is a simultaneous write — last-writer-wins on a metadata array; acceptable for a single-human tool, noted in GUIDELINES.
- **mtime granularity**: `ensureFresh` relies on mtime change; a same-millisecond write could be missed. Verify `mtimeById` uses `mtimeMs`; if coarse, compare size+mtime or bump a `metadata.feedbackRev` counter.
- **Iframe scaling**: detail-page zoom/fit transforms could skew click coords — but the listener lives *inside* the iframe document, so coordinates are native; only the popover position in the parent needs the transform math.
- **`data-node-id` coverage**: leaf builders (`renderToggle` etc.) are hand-rolled — verify every node type emits the attribute; add to `test-discoverability.ts` if cheap.
- **★ user confirms**: C1 (on-canvas storage) and C2 (two-tool surface) — both **confirmed as recommended, 2026-07-02**. Everything else has a recommended default that a review comment can flip.
