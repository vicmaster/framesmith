# Canvas MCP — Open-Source Visual Design Server for AI

An MCP server that gives any AI assistant a visual canvas. Send JSON operations, get screenshots back. Works with Claude Code, Cursor, Windsurf, VS Code + Copilot, or any MCP-compatible client.

---

## Why

- AI coding tools need a way to mockup UI before building code
- No open-source alternative exists for "AI-driven visual design via MCP"
- Pencil.ai proved the workflow works, but it's proprietary and closed
- Every AI assistant should be able to sketch, not just code

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  MCP Client (Claude Code, Cursor, etc.)     │
│  Sends: batch_design(), screenshot(), etc.   │
└────────────────┬────────────────────────────┘
                 │ MCP (stdio or http)
┌────────────────▼────────────────────────────┐
│  Canvas MCP Server (Node.js)                │
│                                             │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Scene Graph   │  │ Operation Engine    │  │
│  │ (JSON tree)   │──│ insert/update/copy  │  │
│  │              │  │ delete/move/replace │  │
│  └──────┬───────┘  └─────────────────────┘  │
│         │                                    │
│  ┌──────▼───────────────────────────────┐   │
│  │ HTML/CSS Renderer                     │   │
│  │ Inline CSS + Flexbox                 │   │
│  │ Renders scene graph → HTML document   │   │
│  └──────┬───────────────────────────────┘   │
│         │                                    │
│  ┌──────▼───────────────────────────────┐   │
│  │ Puppeteer (headless Chromium)         │   │
│  │ Screenshots, export to PNG/PDF        │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

---

## Core Concepts

### Scene Graph
A JSON tree of nodes. Each node has a type, properties, and optional children.

```json
{
  "id": "frame-1",
  "type": "frame",
  "name": "Login Form",
  "width": 400,
  "height": "fit-content",
  "layout": "vertical",
  "gap": 16,
  "padding": 32,
  "fill": "#111111",
  "cornerRadius": 8,
  "children": [
    { "id": "title", "type": "text", "content": "Sign In", "fontSize": 24, "color": "#ffffff" },
    { "id": "email", "type": "frame", "width": "100%", "height": 40, "fill": "#1a1a1a", "cornerRadius": 6 }
  ]
}
```

### Key design decision: HTML/CSS as the rendering engine
Instead of building a custom canvas renderer, we render the scene graph to HTML elements with inline CSS. This gives us:
- Flexbox layout for free (no custom layout engine)
- Text rendering and wrapping for free
- CSS gradients, shadows, borders, opacity — all free
- Puppeteer screenshots of real browser rendering

The tradeoff: we're limited to what CSS can do (no arbitrary vector paths initially). But for UI mockups, CSS handles 95% of use cases.

---

## Node Types

| Type | Description | CSS Mapping |
|------|-------------|-------------|
| `frame` | Container with layout, fill, border | `div` with flexbox |
| `text` | Text content with typography | `p`/`span` with font styles |
| `rectangle` | Simple shape | `div` with dimensions |
| `ellipse` | Circle/oval | `div` with `border-radius: 50%` |
| `image` | Image from URL or base64 | `img` or `background-image` |
| `icon` | Icon from Lucide/Material | SVG inline |
| `component` | Reusable subtree | Cloned with overrides |
| `instance` | Reference to a component | Rendered from source + overrides |

---

## MCP Tools

### `canvas_create()`
Create a new canvas (document). Returns a canvas ID.

### `canvas_list()`
List all open canvases.

### `batch_design(canvasId, operations)`
Execute multiple operations in sequence. Operations:
- `I(parent, nodeData)` — Insert a node
- `U(nodeId, updates)` — Update node properties
- `D(nodeId)` — Delete a node
- `C(nodeId, parent, overrides)` — Copy a node
- `M(nodeId, newParent, index)` — Move a node
- `R(nodeId, newNodeData)` — Replace a node

### `screenshot(canvasId, nodeId?, options?)`
Render the canvas (or a specific node) to a PNG image.
Options: `width`, `height`, `scale`, `format` (png/jpeg/webp).

### `snapshot_layout(canvasId, nodeId?, maxDepth?)`
Return computed bounding boxes for all visible nodes. Useful for understanding spatial relationships.

### `read_nodes(canvasId, nodeIds?, patterns?)`
Read node data from the scene graph. Filter by ID, type, name pattern.

### `get_variables(canvasId)`
Read design tokens/variables defined in the canvas.

### `set_variables(canvasId, variables)`
Set design tokens (colors, spacing, typography scales).

### `export(canvasId, nodeIds?, format, outputPath)`
Export nodes to files (PNG, JPEG, WebP, PDF).

### `list_presets()`
List available style guide presets with descriptions.

### `apply_preset(canvasId, preset)`
Apply a style guide preset (dark, light, material, minimal) to a canvas.

### `screenshot_responsive(canvasId, breakpoints?, scale?)`
Render a canvas at multiple viewport sizes (mobile, tablet, desktop). Returns one screenshot per breakpoint.

### `canvas_diff(canvasId1, canvasId2, width?, height?, scale?)`
Compare two canvases visually. Returns a diff image highlighting changed regions in red, plus a change percentage.

---

## Design Tokens / Variables

Built-in variable system for consistent design:

```json
{
  "colors": {
    "bg-primary": "#0a0a0a",
    "bg-surface": "#111111",
    "text-primary": "#ffffffcc",
    "text-muted": "#ffffff4d",
    "accent": "#3b82f6"
  },
  "spacing": {
    "xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32
  },
  "radius": {
    "sm": 4, "md": 8, "lg": 16
  },
  "typography": {
    "body": { "fontFamily": "Inter", "fontSize": 14 },
    "heading": { "fontFamily": "Inter", "fontSize": 24, "fontWeight": 700 },
    "mono": { "fontFamily": "JetBrains Mono", "fontSize": 13 }
  }
}
```

Reference in nodes: `"color": "$text-primary"`, `"gap": "$spacing.md"`

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ |
| MCP SDK | `@anthropic-ai/sdk` or `@modelcontextprotocol/sdk` |
| Transport | stdio (default) + HTTP/SSE (optional) |
| Rendering | Puppeteer + inline CSS (Flexbox) |
| Icons | Lucide (1,900+ icons via lucide-static) |
| Schema | TypeScript types + JSON Schema for validation |
| Package | `@canvas-mcp/server` on npm |
| License | MIT |

---

## Phases

### Phase 1 — MVP (v0.1)
- [x] Project scaffolding (TypeScript, ESM, npm package)
- [x] Scene graph data model + CRUD operations
- [x] HTML/CSS renderer (frame, text, rectangle, ellipse, image)
- [x] Puppeteer integration for screenshots
- [x] MCP server with `batch_design()` and `screenshot()` tools
- [x] Basic design tokens/variables
- [x] `read_nodes()` and `snapshot_layout()` tools
- [x] README with installation + usage examples

### Phase 2 — Components & Polish (v0.2)
- [x] Reusable components (define once, instance many times with overrides)
- [x] Icon support (Lucide icon set bundled)
- [x] Multiple canvases (parallel design sessions)
- [x] Export to PNG/PDF
- [x] Style guide presets (dark mode, light mode, material, etc.)
- [x] `canvas_list()` and `get_variables()` / `set_variables()` tools

### Phase 3 — Advanced (v0.3)
- [x] Gradients (linear, radial)
- [x] Shadows and blur effects
- [x] Responsive breakpoints (render same design at different widths)
- [x] Diff mode (visual diff between two canvases)

### Phase 4 — Design Systems & Viewer (v0.4)
- [x] DESIGN.md import (`import_design_md` tool) — parse Google Stitch / awesome-design-md format into presets
- [x] Dynamic preset registration — imported design systems become `apply_preset`-able
- [x] Viewer: content no longer cut off by toolbar header
- [x] Viewer: responsive breakpoints reload HTML at target width (content reflows)
- [x] Renderer: `max-width: 100%` on fixed-width elements for viewport adaptation
- [x] Renderer: `overflow-x: hidden` + `min-height` instead of `overflow: hidden` + fixed height

#### Pending improvements
- [x] Responsive padding scaling — `clamp()` so paddings >= 32px shrink on narrow viewports
- [x] Responsive font scaling — `clamp()` so fonts >= 24px shrink on smaller breakpoints
- [x] Viewer navbar adaptation — detail-page toolbar wraps to two rows on viewports <= 640px
- [x] DESIGN.md parser: filter out non-color values (e.g. full box-shadow strings) from colors map
- [x] DESIGN.md parser: extract component patterns (buttons, cards, badges) as reusable canvas components

### Phase 5 — Responsive Layout (v0.5)

Designs must genuinely adapt across breakpoints, not just rescale. Today switching the viewport resizes the iframe, but the scene graph has no rules for reflowing — fixed-width columns clip on mobile and leave dead white space on desktop. Phase 4 added `clamp()` padding/font scaling; this phase makes *layout* itself responsive.

Authoring model: **desktop-first, adapt down.** Responsive behavior is expressed with a single `responsive` enum hint on container nodes (not a verbose per-breakpoint map) — the renderer infers the media queries. A per-breakpoint override map may come later as an optional escape hatch.

- [x] `responsive` hint on containers — `stack` (horizontal → vertical below breakpoint), `wrap` (children wrap instead of overflowing), `fixed` (never reflows, e.g. toolbars)
- [x] Renderer maps the `responsive` hint to CSS (media queries, `flex-wrap`, `flex-direction`)
- [x] Fluid widths — support `minWidth` / `maxWidth` alongside percentage `width` strings so containers shrink within bounds instead of clipping
- [x] Root document fills/centers the viewport cleanly — no dead white canvas on wide screens
- [x] AI guidance — tool descriptions / guidelines steer the assistant toward fluid widths + `responsive` hints instead of hardcoded px
- [x] `screenshot_responsive` + viewer reflect true reflow, not just an iframe resize
- [x] Viewer shows the adaptation clearly — side-by-side breakpoint comparison, not just toggle buttons
- [ ] (Optional / stretch) per-breakpoint override map as an escape hatch for nodes needing precise control

### Phase 6 — Evaluation & AI Loops (v0.6)
- [x] Heuristic design scoring (`canvas_evaluate`) — 5 weighted categories (spacing, color, typography, structure, consistency), 0–100 overall score
- [x] Per-node actionable issues with `nodeId` references for closed-loop fixes
- [x] Two modes: `fast` (JSON-only, <100ms) and `detailed` (Puppeteer-based pixel overlap)
- [x] Category filtering for targeted re-evaluation
- [x] Benchmark suite — track scoring stability across a fixed corpus of designs
- [x] Auto-fix suggestions emitted as ready-to-run `batch_design` operations
- [x] LLM-judge mode (optional secondary evaluator using a vision model on the screenshot)

### Phase 7 — Workspace UI overhaul (v0.7)

A flat dashboard of every canvas works at 5–10 canvases; it breaks down at 20+. Users will run more than one project through canvas-mcp, and today there's no way to group, archive, or visually separate work across projects. Plus the viewer chrome doesn't match the polish of the designs it renders. This phase introduces a `Workspace > Project > Canvas` hierarchy on the MCP side (so the AI can organise work), a Figma-style sidebar in the viewer, and a UI refresh that brings the chrome up to the level of the content.

Authoring intent: **the AI is the primary author**, so hierarchy lands as MCP tools first; the viewer becomes the secondary client that reflects those tools' state.

- [x] Data model — introduce `Workspace` and `Project` entities; auto-migrate existing canvases into a default `Personal` workspace + `Untitled` project on first load (no manual intervention required)
- [x] MCP tools — Workspaces: `workspace_create`, `workspace_list`, `workspace_rename`, `workspace_delete`
- [x] MCP tools — Projects: `project_create`, `project_list`, `project_rename`, `project_delete`
- [x] MCP tools — Canvas lifecycle: `canvas_move` (between projects), `canvas_archive`, `canvas_delete`; `canvas_create` accepts optional `projectId`
- [x] Thumbnails — empty / never-rendered canvases get a distinct placeholder treatment (the current silent-white panel is the dominant visual at >5 canvases)
- [x] Viewer — Figma-style collapsible left sidebar: workspaces → projects, with active-state highlighting
- [x] Viewer — main pane is project-scoped: breadcrumb + canvas grid for the selected project; clear empty-states
- [x] Viewer — archive surface (separate sidebar entry); restore + permadelete actions
- [x] Viewer — premium UI refresh across gallery, detail page, and compare view (typography, spacing, color, micro-interactions)

### Phase 8 — Renderer expressiveness (v0.8)

The slice 5 UI refresh hit ceilings the current renderer can't cross: no `backdrop-filter` (so no real glassmorphism), no custom font loading (typography stuck on the system stack), no SVG path support (custom icons like the archive box / logo mark are approximated with stroked rectangles), and no transitions/animations (state changes feel instant, not crafted). Each of these is what separates "competent dark UI" from "designer says wow." This phase expands the renderer's expressivity vocabulary so future designs aren't bottlenecked by what the scene graph can express.

Surfaced during Phase 7 — every item came from a concrete design moment we wanted but couldn't render.

- [x] `backdrop-filter` support — `blur` / `saturate` / `brightness`; enables glassmorphism on cards, modals, sticky toolbars
- [x] Custom font loading — `fontFamily` URLs (Google Fonts or hosted .woff2) loaded via `@font-face` in the renderer's `<head>`; canvas-level `fonts` array for declarations
- [x] SVG path primitives — `path` node type with `d` attribute support so iconography stops being approximated rectangles
- [x] Transitions + animations — structured `animation` ({ name, duration, delay, easing, iteration }) referencing a built-in keyframe library (`fadeIn`, `slideUp`, `slideDown`, `scaleIn`) auto-emitted only when referenced; structured `transition` ({ property, duration, easing, delay }) with safe identifier validation
- [x] `position: absolute` foot-gun fix — automatic `position: relative` injection on a frame when any descendant uses `position: absolute` without a positioned ancestor (a real bug that bit the slice 5 mock)
- [ ] (Stretch) CSS variables exposed at the node level for token-driven theming inside a canvas (precursor to Phase 9 design systems)

### Phase 9 — Workspace-level design systems (v0.9)

Design tokens already live on `Canvas.variables` (colors / spacing / radius / typography) and the preset system can apply named systems per-canvas. Promote that to **workspace-inherited** tokens: a workspace declares a design system once, all projects + canvases under it inherit by default with explicit per-canvas overrides allowed. Closes the loop on "I'm working on Coide; every Coide canvas should follow Coide's design system."

- [x] `Workspace.designSystem` field (inline `DesignVariables`); symmetric `Project.designSystem` for project-level overrides
- [x] Resolution order at render: canvas variables → project → workspace → built-in defaults (rightmost wins via `mergeDesignTokens`)
- [x] MCP tools: `workspace_set_design_system`, `workspace_get_design_system`, `workspace_apply_preset` (+ symmetric `project_*` trio)
- [x] Preset migration: existing presets are workspace/project-installable via `*_apply_preset` tools
- [x] Guidelines update: when authoring, reach for workspace tokens instead of literal hex codes

### Phase 10 — Canvases that live in the repo (v1.0)

Today every canvas lives in `~/.canvas-mcp/canvases/`, keyed by ID and decoupled from the code it designs for. A design can't travel with the repo, get reviewed in a PR, or be opened by a teammate who clones the project. Proprietary tools solve this with an encrypted project file dropped into the working directory; canvas-mcp can do it better — an open, human-readable, git-committable file checked in alongside the code. Shipping this as the v1.0 headline makes "your design lives in your repo" the story of the 1.0 release.

Authoring intent: this is the open-JSON differentiator made tangible — **design lives in your repo**, diffable in review, not locked in a separate encrypted store. The file **embeds the full scene graph** so a clone is self-contained.

**Source-of-truth rule (decided):** a canvas is *either* repo-bound *or* global, never both — so there is nothing to "reconcile." When a repo has `.canvas/`, it is authoritative; `~/.canvas-mcp` holds no competing copy of a bound canvas.

_Slice 1 (shipped): binding, source-of-truth persistence, deterministic serialization, walk-up auto-detect, `canvas_bind` tool. Slice 2 (shipped): repo registry + viewer aggregation (global + every bound repo). Slice 3 (shipped): external-change safety (mtime reload, no clobber) + `schemaVersion` forward-compat guard + asset externalization (`.canvas/assets/`) + viewer lifecycle write-back. **Phase 10 complete.**_

A repo binds a whole **workspace** (not a single project): `.canvas/workspace.json` plus one subdirectory per project, each holding one open-JSON file per canvas — so a codebase's design system, UI, and release surfaces stay organised as they are in the gallery.

- [x] `.canvas/` dir at the repo root is the source of truth — `workspace.json` (binding + projects[] + `schemaVersion`) and per-project subdirs of slug-named canvas files (full scene graph embedded)
- [x] Self-contained clones — `workspace.json` carries the workspace design system + per-project token overrides so a fresh clone with empty global state resolves tokens identically
- [x] Auto-bind by project-root walk-up — server finds the nearest `.canvas/` / `.git` from cwd and scopes to that virtual workspace; bound entities never register in global `workspaces.json` / `projects.json`
- [x] Global store becomes a read-only cache + repo registry — bound repos record their `.canvas/` in `registry.json`; the standalone viewer rebuilds a read-only mirror of every registered repo on load (and on registry change), keeping its unified cross-project gallery. The cache is derived, never authoritative; the MCP server's own store stays scoped to its context
- [x] Deterministic, text-only serialization — sorted keys / stable indent / trailing newline so diffs stay reviewable and git merges conflict only on the *same* canvas
- [x] Asset externalization — inline `data:` images are extracted to `.canvas/assets/<content-hash>.<ext>` on write (deduped by content) and rehydrated on read, so committed canvas JSON stays small and diff-friendly while the in-memory canvas keeps inline images
- [x] External-change safety — `ensureFresh` reloads a canvas from disk before mutation when its mtime changed (git pull / branch switch / hand-edit), so the agent never clobbers an external edit; a vanished target node then surfaces a not-found error; deleted files drop from the store. `schemaVersion` forward-compat guard on `workspace.json` load (newer files read best-effort with a warning; migration hook in place)
- [x] Round-trip — clone the repo, open the viewer, see the same canvases; the file diffs cleanly in code review
- [x] Viewer lifecycle write-back — archive / delete on a mirrored repo canvas writes to its `.canvas/` file (not the global store), survives reload, and cross-process edits are caught by external-change safety
- [x] Sharpen the Pencil contrast — open JSON you own in the repo vs an encrypted project file

### Phase 11 — Design variety & anti-sameness (v1.1)

Left to their own devices, AI assistants converge on the same handful of layouts — a centered hero, a three-card row, a dark surface with one accent. canvas-mcp hands the agent primitives but no sense of *structure* to choose from, and no memory of what it built last time, so every session drifts toward the same shape. Two levers fix this: a library of named page structures (layout scaffolds the agent stamps down and fills, distinct from color presets), and a per-project build log that records what was made so the next canvas is nudged to differ.

Authoring intent: structures are scene-graph data, not prompt text — the agent applies one, then **renders and verifies** it, an advantage code-only tooling doesn't have.

- [ ] Layout scaffold library — named page structures (e.g. marquee hero, bento grid, stat-led, editorial long-form, split workbench, catalogue) as partial scene trees with placeholder children; distinct from color/token presets
- [ ] `list_structures` / `apply_structure` tools — agent picks a structure, gets a filled-in skeleton to populate, then renders + verifies it
- [ ] Structure taxonomy — each scaffold tagged on independent axes (hero treatment, density, rhythm, alignment) so "differs from last" is computable, not a vibe
- [ ] Per-project build log — record structure + preset + key axes for each canvas authored under a project
- [ ] Diversification signal — on `canvas_create`, surface the last N log entries and steer the agent to differ on ≥ 1 axis from recent work
- [ ] Provenance stamp — canvas metadata records which structure / preset / seed produced it (feeds the log; surfaced in the viewer)

### Phase 12 — Cliché & craft guardrails (v1.2)

`canvas_evaluate` (Phase 6) scores *craft* — contrast, spacing scale, type scale, structure. It says nothing about *cliché*: the visual tells that mark a design as machine-made. Several of these are mechanically detectable on the scene graph, and because canvas-mcp renders, it can confirm them instead of guessing. Add a `cliche` category alongside the craft checks, plus an honest-content rule so mockups stop shipping invented data.

- [ ] `cliche` evaluation category in `canvas_evaluate` — flags the recurring machine-made tells
- [ ] Detectable tells (scene-graph + render): default purple / indigo accent hue, gradient / glow overuse, fake browser / phone / IDE chrome (traffic-light-dot frames), the hanging "tag-left / heading-right" header
- [ ] Honest-content check — flag fabricated-looking metrics / testimonials / logos in placeholder copy; suggest a labeled placeholder convention ("metric to confirm" + neutral block) instead
- [ ] Auto-fix ops where mechanical (swap a default-accent hue, replace a fake-chrome frame), consistent with Phase 6 `canvas_autofix`
- [ ] Genre-aware loosening — some tells are intentional in some styles; let the active preset / design system relax specific gates
- [ ] Guidelines update — tool descriptions steer authoring away from the tells up front, not just catch them after

### Phase 13 — Structured critique & auto-revision (v1.3)

The LLM-judge mode (Phase 6) returns a 0–100 score and free-text strengths / weaknesses — a vibe check, not a reproducible rubric, and nothing closes the loop automatically. Move the judge to a fixed multi-axis rubric with a per-axis floor, and let a low axis trigger a revision pass rather than just reporting it.

- [ ] Fixed critique rubric — score named axes (e.g. hierarchy, execution, specificity, restraint, variety), each 1–5, instead of one opaque number
- [ ] Revision threshold — any axis below a floor flags the canvas as needs-revision, naming the specific axis
- [ ] Closed loop — optional auto-revise pass that feeds the failing axis back as targeted `batch_design` guidance, then re-judges
- [ ] Stamp the verdict — store the rubric result in canvas metadata / provenance so quality is auditable over time and across the build log
- [ ] Keep the rubric pluggable alongside the existing heuristic categories (don't lose the deterministic signal)

### Phase 14 — Ecosystem (v1.4)
- [x] Web-based canvas viewer (read-only UI to browse designs)
- [ ] Image generation integration (placeholder images via AI)
- [ ] HTTP transport for remote access
- [ ] VS Code extension (preview pane)
- [ ] Import from Figma (partial)
- [ ] Community style guide marketplace
- [ ] Plugin system for custom node types

---

## Installation (target)

```bash
# npm
npx @canvas-mcp/server

# Claude Code
claude mcp add canvas-mcp npx @canvas-mcp/server

# Cursor / other MCP clients
# Add to .mcp.json:
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["@canvas-mcp/server"]
    }
  }
}
```

---

## Differentiators vs Pencil

| | Canvas MCP | Pencil |
|---|---|---|
| Open source | MIT | Proprietary |
| Works with any AI | Any MCP client | Claude Code only* |
| Self-hosted | Yes | No |
| Custom rendering | HTML/CSS (extensible) | Custom engine |
| File format | Open JSON | Encrypted .pen |
| Icons | 1,900+ Lucide icons | Built-in icon set |
| Components | Define & instance with overrides | Yes |
| Export | PNG, JPEG, WebP, PDF | PNG, PDF |
| Style presets | dark, light, material, minimal | Unknown |
| Vector paths | Limited (CSS shapes) | Full SVG paths |
| Interactive editor | Not in v1 (AI-only) | Yes |
| Price | Free | Paid |

*Pencil works via MCP so technically any client, but it's distributed as a proprietary binary.
