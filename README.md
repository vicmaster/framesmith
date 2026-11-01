# framesmith

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Release](https://img.shields.io/github/v/release/vicmaster/framesmith)](https://github.com/vicmaster/framesmith/releases) [![MCP](https://img.shields.io/badge/MCP-compatible-1f4838)](https://modelcontextprotocol.io) [![CI](https://github.com/vicmaster/framesmith/actions/workflows/ci.yml/badge.svg)](https://github.com/vicmaster/framesmith/actions/workflows/ci.yml)

An open-source MCP server that turns your AI coding agent into a capable UI designer. It gives the agent a visual canvas, a library of vetted design patterns, and a quality bar it must clear before showing you anything — so you review a real, non-slop design in the browser and agree on it *before* any framework code is written.

**Contents:** [What it does](#what-framesmith-does) · [Capabilities](#capabilities-at-a-glance) · [Viewer](#viewer) · [Installation](#installation) · [Tools](#tools) · [Usage Example](#usage-example) · [Workflow](#workflow) · [Development](#development)

![framesmith viewer — workspace sidebar on the left, and the Pattern library project on the right showing the 11 vetted page patterns (auth, bento-grid, catalogue, dashboard, editorial-longform, marquee-hero, onboarding, pricing, settings, split-workbench, stat-led) as live thumbnails on a generated design system, each with a green quality-score badge, and state chips (default / loading / empty / error) under every data-bearing pattern.](https://raw.githubusercontent.com/vicmaster/framesmith/master/docs/framesmith-dashboard.png?v=2.0)

> Above: the framesmith viewer, showing the built-in **pattern library** — 11 vetted page archetypes an agent starts from, each carrying its live quality score and its designed state variants. Workspaces and projects sit in the sidebar; you browse canvases like design files.

### What an agent actually ships

Every screen below was built end-to-end by an agent with framesmith's own vocabulary — one `generate_design_system` call each (a seed color + a personality), stamped patterns, real controls, and every quality gate cleared (score ≥ 95, states designed, stress-tested, both themes):

![A customer-support dashboard built by an agent in framesmith, light theme: sidebar with grouped navigation and an account row, four KPI cards (tickets resolved, first reply, SLA breaches, CSAT) with sparklines and tinted delta pills, a tickets-per-day bar chart with a highlighted day and a floating tooltip, a data-bound tickets-by-channel donut with a center total and legend, an agent-workload table with tinted status chips, and a top-performers panel. Generated from one seed (#2563EB) on the "technical" personality.](https://raw.githubusercontent.com/vicmaster/framesmith/master/docs/framesmith-support-dashboard.png?v=2.0)

![An API platform console built by the same toolkit, dark theme: teal design system on the "data-dense" personality with JetBrains Mono figures — request/error-rate/latency KPI cards with sparklines, a requests-per-day bar chart with a highlighted day, a traffic-by-endpoint donut, a deployments table with Live/Rolling/Degraded status chips, and a top-consumers panel.](https://raw.githubusercontent.com/vicmaster/framesmith/master/docs/framesmith-api-console.png?v=2.0)

> Same machinery, different seed + personality: a light ops dashboard and a dark API console. Every color pair is AA by construction, every chart is data-bound (edit a value, not an SVG path), and the dark theme is generated — not inverted.

![A specialty-coffee checkout built by an agent in framesmith, light theme: a masthead with the store mark and a secure-checkout note, a form column with Contact, Delivery and Payment sections — real radio, checkbox and input controls, a two-option delivery-speed selector — beside a sticky order summary listing two line items, subtotal, free delivery, a first-order credit, the total, and a Place order button, with a gift-code card beneath. Generated from one seed (#A24B1E) on the "soft" personality and stamped with the commerce genre.](https://raw.githubusercontent.com/vicmaster/framesmith/master/docs/framesmith-checkout.png?v=2.1)

> Not every screen is a dashboard. This checkout carries the `commerce` genre — the transactional counterpart to `data` — so the evaluator reads its line prices and total as the design rather than as fabricated data. It still cleared the same bar as the two screens above, including designed **empty-basket** and **loading** states.

```
MCP Client → stdio → framesmith server
                        ↓
              Scene Graph (in-memory JSON tree)
                        ↓
              HTML/CSS Renderer (inline styles)
                        ↓
              Puppeteer (headless Chromium → PNG)
```

## What framesmith does

Left to itself, an AI agent tends to produce UI that *looks* AI-generated — generic spacing, no icons, a purple gradient by default, placeholder text that reads like placeholder text. framesmith closes that gap by moving design **before** code and holding it to a bar:

1. **Start from taste, not a blank canvas.** The agent stamps one of **11 vetted page patterns** (dashboard, auth, pricing, settings, onboarding, and more), or on a phone canvas one of **6 mobile realisations** built from the mobile primitives — each regression-tested to score **> 95 with zero cliché tells** under the neutral default theme and all four presets (a mobile realisation takes the presets' colours over a phone type scale, is also held to every personality's generated phone system, and raises no mobile-ruleset finding), and every structure (page and component alike) built entirely from type-role tokens so it re-voices under a generated design system instead of injecting stray pixel sizes, and hardened to survive hostile-length content (`canvas_stress` CLEAN) — then adapts it. A blank canvas is where slop comes from; a pattern is a non-slop starting point. *(`list_structures` / `apply_structure`)*
2. **Use the whole toolkit — like a real UI does.** Real icons (Lucide + Material Symbols), fonts resolved by name, real input controls (`toggle` / `checkbox` / `radio` / `select`), data-driven charts (line/bar/donut/sparkline, multi-series, bar emphasis), reusable components, and layered design tokens — never faked with Unicode glyphs, stray ellipses, or hand-drawn SVG paths standing in for a chart.
3. **Evaluate, then self-correct.** `canvas_evaluate` scores the design across five craft categories plus a **cliché-tell** detector, a **state-coverage** check (a data screen without designed empty/loading states isn't done), and a **usability** layer (hit-target floor, label association, honest action copy), and returns a **`READY` / `NOT READY` directive**. The agent resolves every warning and tell and only presents once it's `READY` — polishing to the bar is the agent's job, not yours.
4. **Review in the browser, own the output.** You browse canvases like design files, with a live **quality inspector** and **design-system panel**. Designs persist as **open JSON checked into your repo** — no proprietary format, no lock-in — and can be re-imported from shipped HTML to keep the design honest.

## Capabilities at a glance

| Area | What you get |
|------|--------------|
| **Rendering** | Scene graph → HTML/CSS → Puppeteer PNG · responsive breakpoints · real CSS grid (`layout: "grid"` + spans) for bento/editorial compositions · gradients, shadows, blur, glassmorphism · SVG paths · animations · data-driven charts (line/bar/donut/sparkline, multi-series, bar emphasis + in-SVG gradients) |
| **Pattern library** | 11 vetted page archetypes + 6 mobile realisations + 14 component scaffolds, all scoring > 95 with zero cliché tells, typography built from type-role tokens (not literal pixel sizes), and stress-hardened to survive hostile-length content; taxonomy axes + a diversification signal so successive screens vary |
| **Quality & taste** | `canvas_evaluate` (8 categories incl. cliché tells, state coverage + usability floors) with a `READY`/`NOT READY` directive · `canvas_autofix` (mechanical fixes) · optional vision-model rubric critique + `canvas_revise` · `canvas_add_variant` clones a screen into a linked empty/loading/error state · `canvas_stress` content-perturbation testing (long text, i18n, big numbers, empty/many rows) · `project_evaluate` rolls up a project's screens for cross-screen consistency (radius/accent drift, token adoption, hand-copied chrome, state coverage) plus an optional multi-screen flow critique — advisory, never a gate |
| **Design systems** | `generate_design_system`: one seed + one personality (`technical` / `editorial` / `soft` / `data-dense`) → the complete design language — colors, curated font pairing, typography roles, radius/density stances, `$elevation` depth tokens (dark-aware), `$motion` defaults · layered `$token`s (workspace ▸ project ▸ canvas) · style presets · `DESIGN.md` import · `generate_scale` derives a modular type + spacing scale from a named ratio (optional fluid `clamp()` sizes) · `generate_color_system` turns one seed color into OKLCH ramps + AA-checked semantic tokens, a categorical chart palette, and a tint layer for chips/tiles/badges, dark theme included · dual-theme rendering + evaluation (`theme: "dark"` on screenshot/export, both-theme contrast in `canvas_evaluate` with APCA advisory) · token-detachment lint re-attaches literals that drift from a token |
| **Primitives** | Lucide + Material Symbols icons · Google Fonts by name · real form controls · components with instance overrides — `create_component` promotes existing work, `copy_nodes` carries subtrees (and their component defs) across canvases |
| **Import from code** | `canvas_import_html` / `canvas_import_url` — token-mapped, structure-reconstructed · `canvas_sync_from_url` pixel drift · `canvas_check_drift` structural drift · `framesmith verify` / `check-drift` CLI for CI/pre-commit gates, no MCP client needed |
| **Viewer** | Browser gallery + detail view · quality inspector (score, issues, click-to-highlight) · design-system token panel · point-and-tell feedback (Comment mode + Feedback tab) |
| **Open by design** | MIT · plain HTML/CSS · open JSON you own in your repo · content-hash versioning (`canvas_version`) so approvals reference an exact design, not just a name · works with any MCP-compatible client |

## Viewer

Run `npx -p framesmith framesmith-viewer` to start the standalone browser viewer (it takes the first free port from 3001 up; pass a port to pin one). Open any canvas to review it at multiple breakpoints, compare them side-by-side, inspect the underlying JSON, or archive / delete.

![framesmith canvas detail view — the dashboard pattern rendered (grouped sidebar navigation with an account row, KPI cards with sparklines and delta pills, a real multi-series line chart with an area fill and a dashed reference line beside a recent-activity feed) with the Quality inspector open on the right: a 99/100 "Excellent" score, per-category bars (spacing, color, typography, structure, consistency, usability, coverage, cliche), and honest APCA advisories in the issue list. The toolbar shows the canvas's designed states (default / loading / empty), theme and viewport toggles, and a Comment toggle.](https://raw.githubusercontent.com/vicmaster/framesmith/master/docs/framesmith-canvas.png?v=2.0)

> Above: a canvas in the detail view with the **Quality inspector** on the right — the same `canvas_evaluate` score the agent sees, with per-category bars and the issue list; the tabs along the top switch to the **Design-system** and **Feedback** panels. The toolbar exposes breakpoint previews, Compare, Fit, JSON, a **Comment** toggle for point-and-tell feedback, and lifecycle actions.

**Quality panel.** The canvas detail view shows a read-only **quality inspector** on the right: the heuristic `canvas_evaluate` score (0–100), per-category bars, and the issue list — each cliché tell with its `category · tell` badge, severity, and suggestion. Issues that `canvas_autofix` can resolve carry an **auto-fixable** tag, and clicking any issue **highlights its node** in the live preview. Every gallery card also shows a color-coded score badge so weak canvases stand out at a glance. The score matches what your agent sees over MCP (same fast-mode evaluation, relaxed by the canvas's stored genre and applied preset) — it's computed for display only and never written back.

![framesmith point-and-tell feedback — a newsletter signup card in the detail view with Comment mode active: a popover anchored to the clicked paragraph shows breadcrumb chips (Body · Signup Card · Document · whole page) and a typed note, while the Feedback inspector tab on the right lists one open comment on "Fine Print" and one resolved comment with the agent's reply beneath it.](https://raw.githubusercontent.com/vicmaster/framesmith/master/docs/framesmith-feedback.png?v=1.8)

> Above: **point-and-tell** in action — Comment mode is on, the clicked element is outlined, the popover's breadcrumb re-scopes the anchor, and the Feedback tab tracks open comments plus the agent's replies to resolved ones.

**Feedback panel.** Point-and-tell: toggle **Comment** in the toolbar and click any element in the preview to leave a note for the agent — a breadcrumb in the popover re-scopes the anchor from the exact element up to its card, section, or the whole page. The **Feedback** tab lists open comments (badge = open count) with click-to-highlight, lets you resolve or delete them, and shows the agent's resolution note as a reply once it has addressed the item. Comments persist on the canvas itself (`metadata.feedback` — git-diffable in bound repos) and the agent reads them over MCP via `get_feedback`; open feedback blocks the agent from presenting, same as open quality issues.

**Design-system panel.** A second inspector tab shows the canvas's effective design tokens — color swatches, type scale, spacing, and radius — resolved through the full workspace ▸ project ▸ canvas inheritance chain. Each section notes its dominant source layer, and any token resolving from a *different* layer is tagged (`canvas` / `project` / `workspace`) so you can see at a glance what a given canvas customized versus inherited.

Designs are authored through MCP tool calls from your AI assistant — in the viewer you review, comment, and manage lifecycle; you don't edit nodes. Unbound canvases persist to `~/.framesmith/canvases/` (canvases in a [bound repo](#canvas_bind) live in its `.framesmith/` instead) so the viewer keeps showing them across sessions.

## Installation

No clone or build needed — register framesmith with your MCP client via `npx` (requires Node 20+).

### Claude Code

```bash
claude mcp add framesmith -- npx -y framesmith
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.framesmith]
command = "npx"
args = ["-y", "framesmith"]
```

### Cursor

Add to `~/.cursor/mcp.json` (or per-project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "framesmith": {
      "command": "npx",
      "args": ["-y", "framesmith"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "framesmith": {
      "command": "npx",
      "args": ["-y", "framesmith"]
    }
  }
}
```

### VS Code + MCP extension

Add to `.vscode/mcp.json` (project-scoped) or your global MCP settings:

```json
{
  "servers": {
    "framesmith": {
      "command": "npx",
      "args": ["-y", "framesmith"]
    }
  }
}
```

### Any other MCP-compatible client

framesmith speaks standard stdio MCP. Point your client at `npx -y framesmith` using whatever config shape your client expects.

> **Optional:** set `FRAMESMITH_VIEWER_URL=http://localhost:3001` in the MCP server env to pin it to a long-lived standalone viewer process — see [Running the viewer](#running-the-viewer).

### Build from source (for development)

```bash
git clone https://github.com/vicmaster/framesmith.git
cd framesmith
npm install
npm run build
# then point your client at: node /path/to/framesmith/dist/index.js
```

## Tools

### `init`

One-call onboarding — **the recommended first call each session**, and safe to run repeatedly (idempotent). Binds the current repo if it isn't already (canvases become checked-in JSON under `.framesmith/`), ensures the convention projects exist, and returns the live state you need to start working.

| Param | Type | Description |
|-------|------|-------------|
| `dir` | string? | Directory to bind / detect. Defaults to the nearest git repo root above the server working directory. |
| `workspaceName` | string? | Name for the workspace when binding fresh. Defaults to the repo folder name. |
| `projects` | string[]? | Projects to ensure exist (default: `["Foundations", "UI"]`). Existing projects are never removed, so it's safe for adding feature/area projects like `Onboarding`. |

Returns the bound workspace + project IDs (binding **re-keys** workspace and project IDs to `repo-*` — use the ones `init` returns; canvas IDs are kept), the on-disk layout, the workspace-layer token count, a workflow cheatsheet, the current gotchas, the `framesmith://guidelines` URI, and the viewer URL. If any canvas in the workspace has open point-and-tell comments, the result also carries `openFeedback: { total, note }` — a nudge to run `get_feedback` before doing anything else. It does **not** seed design tokens — set those at the workspace layer with `workspace_set_design_system`. The default `Foundations` project is just a canvas that visualizes the workspace tokens (which is where the design system actually lives).

### `canvas_create`

Create a new canvas. If `projectId` is omitted, it lands in the built-in `Untitled` project of the `Personal` workspace.

| Param | Type | Description |
|-------|------|-------------|
| `name` | string? | Canvas name |
| `projectId` | string? | Target project. Defaults to the built-in Untitled project. See `project_list`. |
| `width` | number? | Artboard width in px, a positive integer (default 1440, or the device width for `type: "mobile"`). |
| `height` | number? | Artboard height in px, a positive integer (default 900, or the device height for `type: "mobile"`). Each dimension defaults on its own. |
| `type` | `"web"` \| `"mobile"`? | What medium the canvas is on. `"mobile"` declares a phone app screen: the artboard defaults to the device size and the root gets the device's safe-area insets as `safeArea: { top, bottom }`, which the renderer adds to the root's top and bottom padding. Omitted, the canvas is undeclared and judged as web. On a mobile canvas `apply_structure` stamps the mobile realisations (`dashboard`, `settings`, `auth`, `onboarding`, `feed`, `detail`). |
| `device` | string? | Device profile for `type: "mobile"` (default `"iphone-390"`, the only profile today: 390×844, insets 47 top and 34 bottom). Passing it without `type: "mobile"`, or naming an unknown device, is an error. An explicit `width`/`height` overrides the profile's size for that side; the insets stay the profile's. |

The response also carries the artboard `width`/`height`, `type`, `typeSource` (`"declared"` or `"default"`), `device` and `safeArea` for a mobile canvas, and a `diversification` signal for the target project: the recently-built structures (newest first) and a hint to differ on at least one taxonomy axis, so successive canvases don't converge on the same layout. It's advisory — never blocking.

### `canvas_list`

List canvases. Excludes archived canvases by default. A row carrying `openFeedback: n` has open point-and-tell comments waiting — read them with `get_feedback` before working on that canvas.

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | string? | Scope to one project |
| `includeArchived` | bool? | Include archived canvases (default false) |

Returns `[{ id, name, createdAt, lastModified, versionHash, projectId, archived, openFeedback?, variant?, variants? }]` — `openFeedback` (a count) is present only when > 0; `versionHash` is the design-content hash `canvas_version` checks approvals against. `variant: { of, state }` is present on a state-variant row; `variants: [{ state, canvasId }]` rolls the designed states onto a base row (see `canvas_add_variant`).

### `canvas_add_variant`

Clone a screen into a linked **state variant** — the empty / loading / error version of a canvas, as its own sibling canvas. The clone gets re-keyed node IDs, the same project, copied tokens/components/fonts, and carries the provenance/genre stamp (feedback and critique stay behind); it's named `<base> · <state>` and linked via `metadata.variant = { of, state }`.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | The base canvas (a variant id also works — it resolves to the root base; variants never nest) |
| `state` | string | The state this variant designs — `empty` / `loading` / `error` recommended; free string accepted |

Returns `{ canvasId, name, state, of, idMap }` — `idMap` maps every base node id to its clone, so follow-up edits target the right nodes immediately. One canvas per state per base (a duplicate state errors). The viewer shows a screen and its variants as one card with state chips; `canvas_list` rolls designed states onto the base row.

### `canvas_move` / `canvas_archive` / `canvas_unarchive` / `canvas_delete`

Canvas lifecycle. `canvas_move` reassigns a canvas to a different project. `canvas_archive` sets a soft-delete flag (canvas stays on disk, hidden from default `canvas_list`); `canvas_unarchive` clears it. `canvas_delete` removes the canvas and its file permanently — irreversible.

### `viewer_url`

Get the URL of the live viewer plus per-canvas URLs. Share these with the user so they can open the design in their browser. No params.

```json
{
  "url": "http://localhost:3001",
  "gallery": "http://localhost:3001",
  "canvases": [
    { "name": "Login", "viewer": "http://localhost:3001/canvas/abc123" }
  ]
}
```

`canvas_create` already returns the per-canvas viewer URL in its response; reach for `viewer_url` when you want the gallery URL or to enumerate every existing canvas's URL in one call.

### `workspace_create` / `workspace_list` / `workspace_rename` / `workspace_delete`

Top-level container CRUD. The built-in `Personal` workspace cannot be deleted, and `workspace_delete` refuses if the workspace still contains projects (move or delete them first).

### `project_create` / `project_list` / `project_rename` / `project_delete`

Mid-level container CRUD inside a workspace. The built-in `Untitled` project cannot be deleted. `project_delete` refuses if the project still contains any canvases (archived ones still count — move or delete them first).

### `canvas_bind`

Bind a workspace to the current project directory so its canvases live **in the repo** as open JSON — a `.framesmith/` directory checked in alongside the code, instead of the global `~/.framesmith` store. Run it once per repo.

| Param | Type | Description |
|-------|------|-------------|
| `workspaceId` | string? | Workspace whose projects + canvases migrate into the repo. Defaults to the built-in Personal workspace. |
| `dir` | string? | Directory to bind. Defaults to the nearest git repo root above the server's working directory. |

It creates `.framesmith/workspace.json` (the binding plus the design system, so a fresh clone resolves tokens identically) and one subdirectory per project holding one slug-named file per canvas:

```
.framesmith/
  workspace.json     # workspace + projects[] + design system
  design-system/
    design-tokens.json
  ui/
    bloom-landing.json
    login-form.json
```

It migrates the workspace's projects + canvases in and makes the repo the source of truth for the rest of the session. A canvas is either repo-bound or global, never both.

**Binding re-keys the workspace and project IDs.** Both become `repo-*` IDs (`repo-ws-…`, `repo-proj-…`), and the old ones stop resolving. Canvas IDs are kept, and each canvas's `projectId` is updated to its new project. The result carries the mapping, so you can retarget without re-listing:

```json
{ "bound": true, "repoRoot": "…", "canvasDir": "…/.framesmith", "workspace": "Acme",
  "projectsMigrated": 2, "canvasesMigrated": 3,
  "idMap": { "workspace": { "a1B2c3D4e5": "repo-ws-Xy7…" },
             "projects":  { "Qr5Tu7Vw9x": "repo-proj-K3m…" } } }
```

Starting fresh? Prefer [`init`](#init): it binds and returns the whole project list with live IDs. Afterwards the server auto-detects `.framesmith/` on startup (walking up from its working directory). **Commit `.framesmith/`** so designs travel with the code and diff cleanly in review.

The bind also records the repo in `~/.framesmith/registry.json`, so the standalone viewer shows bound repos alongside your global workspaces in one gallery (it rebuilds that read-only mirror on launch and whenever the registry changes).

### `batch_design`

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas to edit. |
| `operations` | string | The op script described below. |

Execute operations on the scene graph. Write one op per line. An op may span several lines while its `(`, `{` or `[` brackets are still open, which is how the chart examples below are written. A line starting with `#` between ops is a comment (inside an open bracket use `//` instead), and `//` comments out the rest of a line. Neither marker counts inside a quoted string, so `"#RRGGBB"` fills and `https://` URLs are safe:

```
# Insert a frame into the document root
header=I("document", { type: "frame", layout: "horizontal", fill: "#1a1a2e", padding: 24, gap: 16, width: 1440, height: 80 })

# Insert text into the header
I(header, { type: "text", content: "My App", fontSize: 24, fontWeight: 700, color: "#ffffff" })

# Update a node
U("nodeId", { fill: "#e94560" })

# Delete a node
D("nodeId")

# Copy a node to a new parent
copy=C("sourceId", "parentId", { fill: "#0f3460" })

# Move a node (the third argument is its index among the new parent's children)
M("nodeId", "newParentId", 0)

# Replace a node entirely
R("nodeId", { type: "text", content: "Replaced" })
```

**Returns** `{ ok, nodeIds, results }`. `nodeIds` maps each bound variable to the node ID it created — e.g. `{ "header": "n_a1b2" }` — so you can target those nodes in later calls (bindings only live within a single call). `results` lists each op's outcome in order; an op that succeeded but will not fully take effect carries a `warning` (a `shadow` beside an active `shadows`, a chart `highlight` entry outside the series data). If the call wrote a `fontFamily` nothing can serve yet (not cached, registered, or system/generic), a `Font warnings` content item names it — a cache-only check with no network call, so it's a heads-up, not exhaustive.

**Node types:** `frame`, `text`, `rectangle`, `ellipse`, `image`, `icon`, `path`, `component`, `instance`, `toggle`, `checkbox`, `radio`, `select`, `chart`, `skeleton` (loading-placeholder block — token-derived neutral fill; pulses subtly in the live viewer, always static in screenshots/exports so diffs stay deterministic; `pulse: false` opts a block out), and the mobile primitives `status-bar`, `home-indicator`, `nav-bar`, `tab-bar`, `button`, `list-row`, `sheet` (see [Mobile primitives](#mobile-primitives))

**Properties:** `fill`, `gradient`, `stroke`, `strokeWidth`, `strokeStyle`, `borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `cornerRadius`, `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `layout` (`"horizontal"` | `"vertical"` | `"grid"`), `gap`, `rowGap`, `gridColumns`, `gridColumn`, `gridRow`, `padding`, `alignItems`, `justifyContent`, `fontSize`, `fontFamily`, `fontWeight`, `color`, `content`, `textAlign`, `lineHeight`, `letterSpacing` (px), `textDecoration`, `textTransform`, `textOverflow` (`"ellipsis"` — designed single-line truncation; `canvas_stress` reports clips behind it as info), `tabularNums`, `fontVariationSettings`, `src`, `objectFit`, `opacity`, `shadow` (CSS string, or `"$elevation.<name>"` referencing an elevation token), `shadows`, `blur`, `backdropBlur`, `backdropFilter`, `overflow`, `wrap`, `position` (`"absolute"` | `"relative"` | `"fixed"` | `"sticky"`), `x`, `y`, `bottom`, `right`, `icon`, `iconSize`, `iconColor`, `iconStyle`, `checked`, `disabled`, `value`, `d`, `viewBox`, `strokeLinecap`, `strokeLinejoin`, `strokeDasharray`, `animation`, `transition` (object, or `"$motion.<name>"` referencing a motion token), `kind`, `series`, `segments`, `innerRatio`, `centerValue`, `centerLabel`, `sparkKind`, `xDomain`, `yDomain`, `curve`, `gridlines`, `xLabels`, `yLabels`, `componentId`, `overrides`, `safeArea` (`{ top, bottom }`, document root only — insets the renderer adds to the root's top and bottom padding; `canvas_create` with `type: "mobile"` writes the device's), `name` (a readable label — `find_nodes` and component overrides match on it), `pulse` (skeleton only), `responsive` (`"stack"` | `"wrap"`)

Chart `series` entries take their own keys: `data`, `stroke`, `strokeWidth`, `strokeDasharray`, `area`, `points`, `highlight`, `barGradient`.

Use `textTransform: "uppercase"` for uppercase labels (don't bake casing into `content`), `letterSpacing` for tracking, and `fontVariationSettings` (e.g. `'"wght" 650'`) for variable-font axes.

`minHeight` is the vertical analog of `minWidth`: a floor, not a cap. Prefer it over a fixed `height` on any node whose content can grow (a card, a table row) — it holds the design's rest-state rhythm while still letting the box expand under hostile-length content instead of clipping. See [Width strategies](docs/GUIDELINES.md#width-strategies) for the same idea applied on the horizontal axis.

Charts are data-driven — the `chart` node does the value→coordinate math:

```
I(panel, { type: "chart", kind: "line", width: 600, height: 220, curve: "smooth", gridlines: 4,
  series: [
    { data: [210, 450, 648, 903, 1133, 1338, 1518], stroke: "$accent", strokeWidth: 2.5, area: true },   // actual
    { data: [225, 450, 675, 900, 1125, 1350, 1575, 1800, 2025, 2250, 2475, 2700], stroke: "$border", strokeDasharray: "6 4" }  // target
  ],
  xLabels: ["Jan", "", "", "", "", "", "", "", "", "", "", "Dec"] })
```

The dashboard kinds: a **donut** is data-bound segments plus a center figure — the legend stays your composition:

```
I(panel, { type: "chart", kind: "donut", width: 176, height: 176, centerValue: "1,204", centerLabel: "forms",
  segments: [
    { value: 385, color: "$chart-1", label: "North" },
    { value: 289, color: "$chart-2", label: "Highlands" },
    { value: 217, color: "$chart-3", label: "River delta" }
  ] })
```

A **bar chart with a selected day** is `highlight: [11]` (or `highlight: 11`; `null` clears it) on the series (selected bar solid, the rest muted; `barGradient: true` fades the muted bars inside the SVG, invisible to the gradient-overuse tell). An entry that isn't an index within the series `data` emphasizes nothing, and the `batch_design` op result warns about it. A **sparkline** is `kind: "sparkline"` — axis-free, latest point emphasized by default, sized for a KPI card corner. `segments[].color` and series `stroke` both take `$chart-1`…`$chart-6` refs.

Multi-series in one node; x positions are data indexes (a shorter series stops early against a longer one — booked months vs a full-year target); `xDomain`/`yDomain` default from the data (bars floor at 0); `kind: "bar"` renders grouped bars from the same series model. Dash the projected series, solid the actuals. Editing one value is a one-prop edit — never hand-compute path `d` strings for a chart.

Borders: `stroke` + `strokeWidth` draw all four sides (`strokeStyle: "dashed" | "dotted"` for forecast/placeholder outlines); per-side borders take an object — `borderTop: { width: 1, color: "$border", style? }` for table row rules, `borderLeft: { width: 3, color: "$primary" }` for accent edges. Paths dash via `strokeDasharray: "6 4"` (or `[6, 4]`).

Grid: `layout: "grid"` + `gridColumns` (a count → equal columns; an array of fr weights / CSS lengths like `[2, 1, "240px"]`; or a raw template string) gives real CSS grid for bento/editorial compositions that flex can only approximate. Children place with `gridColumn` / `gridRow` — a number means "span N", strings accept `"span 2"` or `"1 / 3"`. `gap` covers both axes, `rowGap` overrides the row axis; `responsive: "stack"` collapses the grid to one column on mobile with spans reset. Tracks render as `minmax(0, Nfr)` so long content can't blow a column past its share. Values outside the supported forms never reach the DOM. A `gridColumns` that isn't a count, an array of numbers / CSS lengths (`px`, `fr`, `%`, `em`, `rem`, `auto`, `min-content`, `max-content`, `minmax(…)`) or a plain template string falls back to equal columns. A `gridColumn` / `gridRow` that isn't a number, `"span N"` or `"A / B"` is dropped.

#### Mobile primitives

Phone screens are built from seven primitives that carry their own sizes, 44px hit areas and token colours (`$accent`, `$border`, `$bg-surface`, `$text-primary`, `$text-secondary`, `$danger`; neutral fallbacks unthemed). Labels truncate to one line with an ellipsis.

| Type | Key props | What it is |
|---|---|---|
| `status-bar` | `time`, `appearance` | Device chrome pinned to the top, as tall as the root's `safeArea.top` (47 without one) |
| `home-indicator` | `appearance` | The home pill pinned to the bottom, as tall as `safeArea.bottom` (34) |
| `nav-bar` | `title`, `leading`, `trailing` (≤2), `largeTitle` | 44 tall (96 large), in flow; every action a 44×44 target |
| `tab-bar` | `items: [{ icon, label, active?, badge? }]`, `variant` (`standard` / `floating` / `fab`), `fab` | Pinned to the bottom, 49 + the inset; 2–5 labeled tabs; `fab` adds a raised 56px centre action |
| `button` | `label`, `icon`, `iconPosition`, `variant`, `size` (`sm` 32 / `md` 44 / `lg` 52), `disabled` | `md` meets the phone floor; `sm` is a mobile error by design |
| `list-row` | `title`, `subtitle`, `leading`, `trailing` (`text` / `chevron` / `toggle` / `badge`), `divider` | 44 tall (56 with a subtitle); repeated rows count as reuse |
| `sheet` | `detent`, `grabber`, children | A bottom sheet over a scrim, padded past the home indicator |

`fill`, `stroke`, `color`, `iconColor`, `secondaryColor` (list-row subtitle and trailing) and `badgeColor` (badges) override the token defaults.

`position: "fixed"` pins a node to the screen (the root's width × height is the viewport; content taller than it scrolls and the root grows with it, keeping its bottom padding), `"sticky"` sticks at its `y` while its container scrolls; `bottom` and `right` join `x` / `y`. The renderer raises the root's padding to at least the reach of any pinned `status-bar`, `tab-bar` or `home-indicator`, so content never starts or ends under chrome:

```
I("document", { type: "status-bar" })
I("document", { type: "nav-bar", title: "Settings", largeTitle: true })
list=I("document", { type: "frame", layout: "vertical" })
I(list, { type: "list-row", title: "Notifications", leading: { icon: "bell" }, trailing: { toggle: true }, divider: true })
I(list, { type: "list-row", title: "Account", subtitle: "ada@example.com", leading: { initials: "AL" }, trailing: { chevron: true } })
I("document", { type: "tab-bar", items: [{ icon: "house", label: "Home" }, { icon: "settings", label: "Settings", active: true }] })
I("document", { type: "home-indicator" })
```

The mobile ruleset judges them (see [`canvas_evaluate`](#canvas_evaluate)); [GUIDELINES](docs/GUIDELINES.md#mobile-vocabulary-primitives-and-pinning) has the pinned-CTA-bar idiom.

### `find_nodes`

Find nodes by what they are — property values, text content, or name — instead of hand-tracking ids. Read-only; the query twin of `replace_matching_properties`.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `match` | object? | Property/value predicate, AND across keys — e.g. `{ "fontSize": 30 }` (token refs match literally, structured values by shape) |
| `text` | string? | Case-insensitive substring match on text content — e.g. `"$1.52M"` |
| `name` | string? | Exact match on the node name — e.g. `"YearTable"` |
| `scope` | string? | Node ID — limit the search to this subtree (inclusive) |
| `type` | string? | Only match nodes of this type (`text`, `frame`, …) |

All provided filters AND together (at least one is required). **Returns** `{ count, matches }` where each match is `{ id, type, name?, path }` — `path` is the named ancestor chain (`"Document / Table / Row 2 / text"`), so you can tell which match you want before editing it.

### `replace_matching_properties`

Bulk property edit: find every node whose properties equal **all** the `match` entries and apply the `set` properties to each — one call instead of one `U()` op per node.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `match` | object | Property/value predicate, AND across keys — e.g. `{ "width": 110 }` or `{ "fill": "$secondary-container" }` (token refs match literally; structured values like `shadows` match by shape) |
| `set` | object | Properties to write on every matched node — e.g. `{ "width": "100%" }`. Can't change `id`/`type` |
| `scope` | string? | Node ID — limit matching to this subtree (inclusive). Default: whole document |
| `type` | string? | Only match nodes of this type (`text`, `frame`, …) |
| `dryRun` | bool? | Preview the matched nodes + count without writing |

**Returns** `{ ok, count, matches, dryRun? }` where `matches` is `[{ id, type, name? }]`; `dryRun: true` is present only on preview calls. Preview with `dryRun: true` before wide matches — a value like `width: 150` can match more nodes than intended.

### `create_component`

Promote an existing subtree to a reusable component — the subtree moves into the canvas's component registry and an `instance` node takes its place, render-identical. Answers the evaluator's "no component instances found" advisory with a one-call action.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `nodeId` | string | Root of the subtree to promote (not the document root, not an existing instance) |
| `name` | string? | Component name (default: the node's name, then type); seeds the componentId slug |

**Returns** `{ componentId, instanceId, name, overridableChildren }` — `overridableChildren` lists the named descendants that instance `overrides` can target (overrides match children **by name**). Stamp more copies via `batch_design`: `I("parent", { type: "instance", componentId, overrides: { "Title": { content: "…" } } })`.

### `copy_nodes`

Copy subtrees from one canvas into another (or duplicate within one) — the cross-canvas reuse `C()` can't do. Component definitions referenced by the copied trees travel along automatically.

| Param | Type | Description |
|-------|------|-------------|
| `fromCanvasId` | string | Source canvas |
| `nodeIds` | string[] | Roots of the subtrees to copy |
| `toCanvasId` | string | Target canvas (may equal the source to duplicate) |
| `parentId` | string? | Target parent (default: the target document root) |
| `index` | number? | Insert position (default: append) |

**Returns** `{ ok, copied, idMap, rootIds, copiedComponents }` — `idMap` maps every source node id to its new id; a componentId collision with a *different* def re-keys the incoming def and remaps the copied instances.

### `screenshot`

Render canvas to PNG (returned as base64 image).

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `nodeId` | string? | Specific node to capture |
| `width` | number? | Viewport width (default: the canvas's artboard width) |
| `height` | number? | Viewport height (default: the canvas's artboard height) |
| `fullPage` | boolean? | Capture the whole design instead of one viewport — default false, so existing captures (diffs, responsive sets, the pattern gate) are byte-identical. A canvas taller than its artboard otherwise cuts off at the artboard height. The capture grows to the content, so `position: "fixed"` elements land at its ends (a bottom-pinned tab bar at the bottom of the image). `export` takes the same option (ignored for PDF, which paginates) |
| `scale` | number? | Device scale (default 2) |
| `theme` | string? | `"dark"` renders the design system's dark token layer (`dark.colors`/`dark.elevation` overrides); default light — a no-op without a dark layer |

### `read_nodes`

Read node data from the scene graph. Already know the id(s)? This is the tool. If you don't — you're hunting for a node by what's on it — use `find_nodes` instead of eyeballing this tree.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `nodeIds` | string[]? | Node IDs to read (default: root) |
| `maxDepth` | number? | Max traversal depth (default 5) |

### `snapshot_layout`

Get computed bounding boxes via browser rendering.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `nodeId` | string? | Root node to start from |
| `maxDepth` | number? | Max depth (default 10) |

Returns `{ nodeId, x, y, width, height, children? }` per node — plus, on any node whose content exceeds its box, overflow data (`scrollWidth`/`clientWidth`/`scrollHeight`/`clientHeight` and an `ellipsis` flag for designed truncation): the same capture `canvas_stress` uses to detect clipping.

### `generate_scale`

Derive, don't hand-pick: a named ratio + a base size → a full modular **type scale** (`text-xs` … `text-3xl` typography tokens) and a paired **space scale** (`space-3xs` … `space-3xl`, `md` = 1× base), written to the workspace / project / canvas token layer of your choice. Craft defaults are baked into every step — line-height bands (1.5 body / 1.35 subhead / 1.2 display) and negative display tracking — so the tracking advisory and the type-scale ratio check are satisfied by construction (generated sizes are declared as tokens, which pins them). Usage-dependent typography checks — measure, unique-size count, tabular numerals — still depend on how you apply the scale.

| Param | Type | Description |
|-------|------|-------------|
| `ratio` | string \| number | `minor-second` (1.125), `major-second` (1.2), `minor-third` (1.25), `major-third` (1.333), `perfect-fourth` (1.5), `golden` (1.618) — or a number in (1, 2.2] |
| `baseSize` | number? | Body size the scale pivots on (default 16) |
| `stepsDown` / `stepsUp` | number? | Steps below/above base (defaults 2 / 4) |
| `fluid` | object? | `{ minViewport?, maxViewport? }` — emit Utopia-style `clamp()` type sizes interpolating from ~85% at the small viewport to full size at the large (space stays static by design) |
| `canvasId` / `projectId` / `workspaceId` | string? | Exactly one — the token layer written to |

Returns the generated tokens plus `overwrote` (existing names replaced). Reference results as `fontSize: "$text-lg"` (the full token spec applies through the ref) and `gap: "$space-md"`. Fluid `clamp()` sizes render as-is and are exempt from the numeric scale checks.

### `generate_design_system`

The headline call for a new project's look: **one seed color + one personality → the complete design language**, deterministic, no API key. It composes `generate_color_system` and `generate_scale`, then adds everything those engines have no opinion about:

- **A curated font pairing**, loaded through the font pipeline so the first screenshot renders real faces — `technical` = Space Grotesk + Inter, `editorial` = Fraunces + Source Sans 3, `soft` = Plus Jakarta Sans + Inter, `data-dense` = Inter + a JetBrains Mono `figures` role.
- **Typography roles** the structures speak — `$display`, `$heading`, `$title` (page/screen titles — one step below `$display`), `$text-lg` / `$text-sm` (untracked in-between sizes for card titles, nav, prose, and metadata), `$body`, `$label`, `$caption` (+ `$figures` with a mono face) — with per-role weight and tracking, alongside the `text-xs`…`text-3xl` steps. `$label` is the one *tracked* role (it carries `letterSpacing`), so structures reserve it for genuine control/CTA/table-header labels and use `$text-sm` for ordinary prose — labeling prose as `$label` reads as a section eyebrow to the cliché census.
- **A radius stance** (`radius-sm/md/lg` — e.g. 6/10/14 for `technical`, 12/16/20 for `soft`) and a **density stance** (the space scale pivots on the personality).
- **`chart-1`…`chart-6`** — a categorical series palette hue-walked from the seed (≥ 30° apart, purple band avoided unless the seed itself is purple, each ≥ 3:1 on both themes' surfaces per WCAG 1.4.11) for chart segments, series, and legend dots. Near-neutral seeds anchor at a stable blue and say so in the result (`rangeNote`).
- **`accent-tint` / `success-tint` / `warning-tint` / `danger-tint` / `neutral-tint`** — the tint layer: soft same-hue surfaces for status chips, icon tiles, pill badges, and initials avatars. One pairing rule: tint as the fill, base color as the ink (`fill: "$success-tint"` + `color: "$success"`) — AA by construction, dark layer included.
- **`$elevation.flat` / `raised` / `floating` / `overlay`** — layered soft shadow tokens referenced from any node as `shadow: "$elevation.raised"`. The dark layer **re-states** each depth (stronger black ink) so elevation reads on dark surfaces instead of vanishing.
- **`$motion` defaults** (`fast` / `base` / `slow`) tuned to the personality's temperament.

| Param | Type | Description |
|-------|------|-------------|
| `seed` | string | The brand color everything derives from (`#RRGGBB`) |
| `personality` | string | **Required** — `technical`, `editorial`, `soft`, or `data-dense`. Dashboards → `data-dense`/`technical`, marketing/content → `editorial`, consumer → `soft` |
| `baseSize` / `ratio` | number? | Override the type pivot / scale ratio. On a canvas declared `type: "mobile"` the pivot defaults to the device body size (17px; 16px for `data-dense`); `baseSize` still wins. The result reports the pivot as `baseSize` + `baseSizeSource` (`"explicit"`, `"personality"` or `"mobile"`). |
| `canvasId` / `projectId` / `workspaceId` | string? | Exactly one — the token layer written to |
| `preserveInherited` | boolean? | Canvas scope only. Default `true` — see "Inherited tokens" below. Pass `false` to write the generated language whole. |

Same seed, different personality = a visibly different product. The two single-purpose generators below stay for targeted regeneration (just the palette, just the scale).

**Inherited tokens (canvas scope).** A token the canvas already resolves through an inherited workspace/project design system is kept instead of silently overwritten, and reported back so you can act on it rather than guess:

- `preservedFromDesignSystem` — ordinary preserved tokens. For typography, preservation is **field-wise**: an inherited token that's only partially specified (e.g. `{ fontSize: 13 }`) is merged with the generated role rather than shadowing it whole, so the personality's `fontFamily`/`fontWeight`/`tracking` still land; the entry's `filledFromPreset` names which fields the preset contributed. A fully-specified inherited token is preserved as-is.
- `designSystemConflicts` — preservations that land on a token in the semantic vocabulary this call itself defines (the surface/ink/border/accent semantics, the **status colours** and their paired `-tint` layer, the `$chart-*` range, and the type roles). Keeping an inherited value there means two design languages on one screen — e.g. a near-black `border` surviving onto a freshly generated light-green system. Status colours matter as much as surfaces: they are AA-tuned against the generated page, and the tint layer is paired with them, so an inherited `success` keeps pairing with the **generated** `success-tint` and fails contrast. Each entry adds `why` and `fix`.
- Pass `preserveInherited: false` to skip all of this and write the generated language whole (the right call when this canvas should *be* the new system, not a blend of two). The response's `typographyRoles` always reports what the canvas actually resolves, which differs from the generated values exactly when preservation fired.

Same contract, same field names, as `apply_preset` and `generate_color_system`.

### `generate_color_system`

One seed color → a full perceptual color system, written to the workspace / project / canvas token layer of your choice:

- **`primary-50` … `primary-900`** — an OKLCH ramp with perceptually even lightness steps and chroma tapered at the extremes; out-of-gamut colors clip toward lower chroma, never hue-shift. (The hand-rolled conversions are validated against Chrome's own `oklch()` parsing.)
- **`neutral-50` … `neutral-900`** — a matched neutral carrying a whisper of the seed's hue: never dead grey, never visibly tinted.
- **`success` / `warning` / `danger`** — status colors, hue held, each darkened from the shared band until it clears WCAG AA (4.5:1) **as text on the generated light page surface** (the off-white `bg-primary`, not pure white — the stricter target, so passing there implies passing on white too) — the invariant is shared contrast, not shared lightness (a raw shared-lightness danger red can read under 4:1).
- **Semantic tokens** — `bg-primary`, `bg-surface`, `bg-elevated`, `text-primary`, `text-secondary`, `border`, `accent`: the same vocabulary the structure scaffolds already use. Text and accent steps are picked by **measured contrast** — every semantic text/surface pair clears WCAG AA *by construction*.
- **`chart-1` … `chart-6`** — the categorical series palette: a deterministic hue walk from the seed, ≥ 30° apart pairwise, purple band skipped unless the seed itself is purple, each color pushed until it clears the 3:1 graphical-object floor (WCAG 1.4.11) on both themes' surfaces. A near-neutral seed (no meaningful hue) anchors the walk at a stable blue instead of amplifying noise, and the response's `rangeNote` says so.
- **`accent-tint` / `success-tint` / `warning-tint` / `danger-tint` / `neutral-tint`** — the tint layer: soft same-hue washes for status chips, icon tiles, pill badges, and initials avatars, each backed off until its paired base color (`accent`, `success`, …) clears AA text contrast on it. Pairing rule: tint as the fill, base color as the ink.

| Param | Type | Description |
|-------|------|-------------|
| `seed` | string | The brand color everything derives from (`#RRGGBB`) |
| `canvasId` / `projectId` / `workspaceId` | string? | Exactly one — the token layer written to |
| `preserveInherited` | boolean? | Canvas scope only. Default `true` — see "Inherited tokens" under `generate_design_system` above. Pass `false` to write the generated palette whole. |

The **dark theme ships in the same call**: the semantic dark mapping (Radix pattern: a reversed walk of the same ramps, AA-checked against its own surfaces) is written to the layer's `dark.colors` override — `theme: "dark"` on screenshot/export renders it, and `canvas_evaluate` contrast-checks both themes from then on. The status colors get a second pass here too: the light-tuned `success`/`warning`/`danger` are re-lit (hue held) until each clears AA against `bg-elevated` (the lightest dark surface — the stricter target), so a `$danger` message reads in both themes. The categorical and tint layers get dark counterparts too (`dark.colors` carries `chart-1`…`chart-6` and the `-tint` tokens re-lit for the dark surfaces), written in the same call. Canvas scope honors the inherited-design-system contract, same as `apply_preset` and `generate_design_system`: ordinary preservations report as `preservedFromDesignSystem`, and a preserved value that lands on a token this call's own semantic vocabulary (`bg-surface`/`text-primary`/`border`/`accent`) reports as `designSystemConflicts` with a `why`/`fix` instead.

### `get_variables` / `set_variables`

Read and write design tokens (colors, spacing, radius, typography — plus `elevation` shadow tokens, a `dark` override layer, and `motion` tokens: `{ duration, easing }` pairs referenced from nodes as `transition: "$motion.<name>"`). Use `$tokenName` in node properties to reference variables. The `dark` layer is SPARSE, keyed by token name: anything not overridden inherits the light value — colors AND elevation can both carry a dark override; it drives `theme: "dark"` renders and the dual-theme contrast check.

```json
{
  "colors": { "primary": "#e94560", "bg": "#1a1a2e" },
  "spacing": { "sm": 8, "md": 16, "lg": 24 },
  "radius": { "sm": 4, "md": 8 },
  "elevation": { "raised": [{ "x": 0, "y": 2, "blur": 4, "spread": -1, "color": "rgba(16,24,40,0.08)" }] },
  "motion": { "fast": { "duration": 150, "easing": "ease-out" } }
}
```

Reference an elevation token from a node as `shadow: "$elevation.raised"` (resolves to the layered `shadows` array; an explicit `shadows` on the node wins).

Then use in nodes: `{ fill: "$primary", padding: "$md", cornerRadius: "$sm", transition: "$motion.fast" }`

### `workspace_set_design_system` / `workspace_get_design_system` / `workspace_apply_preset`

Set tokens at the workspace level — every project + canvas under the workspace inherits them. Resolution order at render is `canvas.variables` (override) → `project.designSystem` → `workspace.designSystem` → built-in defaults, with the rightmost layer winning. Per-category merge: setting only `colors` doesn't reset `spacing`.

```json
workspace_set_design_system({
  workspaceId: "...",
  variables: {
    colors: { primary: "#f59e0b", bg: "#0a0a0a" },
    spacing: { sm: 8, md: 16, lg: 24 }
  }
})
```

`workspace_apply_preset({ workspaceId, preset })` is a shortcut that copies a named preset (`"dark"`, `"light"`, `"material"`, `"minimal"`) into the workspace.

### `project_set_design_system` / `project_get_design_system` / `project_apply_preset`

Same shape, but at the project layer between workspace and canvas. Use for sub-brand overrides (e.g., a `Marketing` project that overrides one color while inheriting everything else from the workspace).

### `get_fonts` / `set_fonts`

**Fonts load by name automatically** — naming a `fontFamily` in a typography token (or on a node) resolves it from Google Fonts at token-write time, with a render-time backstop catching anything else. Binaries are cached under `~/.framesmith/fonts/`, so renders are offline and deterministic after the first resolve; `typography.body.fontFamily` becomes the document default. `"mono"` / `"sans"` are generic shorthands that render as CSS `monospace` / `sans-serif` — no registration, no network. An unresolvable family renders in the fallback stack **and** adds a `Font warnings` item to the screenshot/export result; `batch_design` additionally warns at write time when a call sets a `fontFamily` that nothing can serve yet.

`set_fonts` covers explicit registration. Three forms, combinable — with a stylesheet URL, the faces register under **your** `family` label (so `{ "family": "mono", "url": "<css2 URL>" }` upgrades every `fontFamily: "mono"` node to the real face; the result's `aliased` field shows the mapping):

```json
{
  "families": ["Inter", "JetBrains Mono"],
  "fonts": [
    { "family": "Inter", "url": "https://fonts.googleapis.com/css2?family=Inter:wght@400;700" },
    { "family": "Brand Face", "url": "https://example.com/brand.woff2", "weight": 400 }
  ]
}
```

- `families` — resolve by name from Google Fonts and merge into the existing declarations.
- `fonts` with a Google Fonts CSS URL (`fonts.googleapis.com/css2?...`) — faces are extracted from the stylesheet automatically.
- `fonts` with a direct binary URL (`.woff2` / `.woff` / `.ttf` / `.otf` or a `data:` URI) — for non-Google sources.

`fonts` replaces declarations wholesale (pass `[]` to clear); `families` merges. The renderer emits `@font-face` blocks plus `<link rel="preconnect">` per remote origin, with `font-display: swap`.

### `export`

Export a canvas or specific nodes to files on disk.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `format` | string | `"png"`, `"jpeg"`, `"webp"`, or `"pdf"` |
| `outputPath` | string | Directory to save files |
| `nodeIds` | string[]? | Specific nodes to export (default: full canvas) |
| `width` | number? | Viewport width (default: the canvas's artboard width) |
| `height` | number? | Viewport height (default: the canvas's artboard height) |
| `scale` | number? | Device scale (default 2) |
| `theme` | string? | `"dark"` renders the design system's dark token layer (`dark.colors`/`dark.elevation` overrides); default light — a no-op without a dark layer |

Returns `{ exported: string[], versionHash }` — the exported file paths plus the canvas's design-content hash at export time (see `canvas_version`), so an exported artifact can be tied back to the exact design that produced it.

### `list_presets`

List available style guide presets. No params. Returns preset names and descriptions.

### `apply_preset`

Apply a style guide preset to a canvas. Merges preset design tokens into the canvas variables, and copies in any reusable components (`button`, `card`, `badge`) the preset defines so they can be instanced. The preset is recorded in `metadata.provenance.preset` and the per-project build log. It never changes the canvas's genre (`canvas_set_genre` owns that); a genre an older framesmith stored in the preset field is moved to `provenance.genre` first. The material preset relaxes the accent-hue and pure-black-white tells on its own, whatever the genre. Tokens the canvas already resolves through an inherited workspace/project design system are kept rather than overwritten and reported as `preservedFromDesignSystem` — for typography this merge is field-wise (a partially-specified inherited token, e.g. just `fontSize`, is filled out with the preset's other fields rather than shadowing the whole role); set them explicitly with `set_variables` if you want the preset's values instead.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `preset` | string | Preset name: `"dark"`, `"light"`, `"material"`, `"minimal"` |

### `list_structures`

List available layout structures — named scaffolds you stamp onto a canvas and then populate — for one canvas type. Returns each structure's name, `kind`, description, (for pages) taxonomy axes, its `anatomy` (the screen kind it realises), its `surface` (`web`, `mobile`, or `any` for a component that stamps on every type), and `surfaces` (the types its anatomy is realised on). Distinct from presets: structures define **layout skeleton**, presets define **color/token theme** — they compose.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string? | List what stamps on this canvas: its declared type picks the realisations (an undeclared canvas lists web). Passing it with `type` is an error. |
| `type` | `"web"` \| `"mobile"`? | List for this canvas type instead. With neither, the web listing. |
| `projectId` | string? | If given, also return a `diversification` signal for the project (recently-built structures + a hint to differ on ≥ 1 axis), so you pick a shape that contrasts with recent work. Omit it to get just the structure list. |

Two kinds:

- **`page`** — whole-page scaffolds stamped once at the canvas root: `marquee-hero`, `bento-grid`, `stat-led`, `editorial-longform`, `split-workbench`, `catalogue`, `dashboard`, `auth`, `pricing`, `settings`, `onboarding`. Each is tagged on four independent axes — `heroTreatment`, `density`, `rhythm`, `alignment` — so you can deliberately vary page shape instead of defaulting to the same layout. Every page scaffold is regression-tested to score **> 95 with zero cliché tells** under the neutral default theme and all four presets (the pattern library's taste bar) and to pass `canvas_stress` CLEAN under long-text and i18n content, so it's a non-slop starting point you adapt, not boilerplate.
- **`component`** — reusable fragments stamped under **any** node via `targetId`, repeatably: `data-table` (header + 3 rows with avatar/name/email, role chip, status dot, right-aligned numeric cell, actions, and a pagination footer), `form-field`, `toolbar`, `stat-card` (the original name for the KPI-card anatomy below, kept as an alias), `toggle-row`, plus the state scaffolds `empty-state` (icon + title + hint + CTA — an empty screen is a first-run experience, not a void), `skeleton-table` (real header + skeleton rows matching `data-table` geometry, so the loaded table lands without layout shift), `skeleton-card`, and `skeleton-stat-card` (so a loading dashboard skeletons every data surface — the coverage check warns when a loading variant leaves a live region beside skeletoned ones). The dashboard micro-patterns: `kpi-card` (tinted icon tile + uppercase metric label + big tabular value + live sparkline + tinted delta pill — the dashboard structure stamps these), `status-chip` (the tint pair: `$success-tint` fill + `$success` ink), `segmented-control`, `breadcrumb`, and `initials-avatar`. A high-fidelity table costs one stamp instead of ~90 hand-placed nodes; a reference-grade KPI card costs one.

**Mobile realisations.** Each structure realises an anatomy for one canvas type. Six page anatomies have a mobile realisation for a `type: "mobile"` canvas, built from the mobile primitives (status bar, nav bar, list rows, buttons, a pinned tab bar or home indicator) and gated like the web set: > 95 with zero cliché tells and zero mobile-ruleset findings in fast mode (the default theme, the four presets' colours over a phone type scale, and every personality's generated phone system), zero mobile-ruleset findings in detailed mode (as stamped and with every list tripled), and a CLEAN full `canvas_stress` run unthemed and under every personality: `dashboard-mobile`, `settings-mobile`, `auth-mobile`, `onboarding-mobile`, and two mobile-first anatomies, `feed-mobile` (a list of rows) and `detail-mobile` (an item with a pinned primary action). Of the components, `form-field`, `stat-card`, `empty-state`, `skeleton-card`, `skeleton-stat-card`, `kpi-card`, `status-chip` and `initials-avatar` stamp on every type; the rest are web-only. The other web pages (`marquee-hero`, `bento-grid`, `stat-led`, `editorial-longform`, `split-workbench`, `catalogue`, `pricing`) have no mobile realisation.

### `apply_structure`

Stamp a layout structure onto a canvas and return the placeholder node IDs to populate. Scaffolds are token-driven, not hard-coded: every scaffold's spacing, radius, elevation, and typography — all of it, every text node's `fontSize`, not just titles — reference `$space-*` / `$radius-*` / `$elevation.*` / the type-role tokens (`$display`/`$title`/`$heading`/`$text-lg`/`$text-sm`/`$body`/`$label`/`$caption`, plus the usual `$color` tokens), so once a project has a generated design system, stamping a pattern already reads in its density, depth, and voice — no re-theming pass needed, and no scaffold can inject a size the generated scale doesn't have. `apply_structure` seeds neutral defaults (the pre-generator literal values) for any of those tokens the canvas can't already resolve, so an unthemed canvas still renders correctly; the result's `seededColors` / `seededTokens` list exactly which names got seeded. Populate the placeholders with `batch_design` `U` ops, then `screenshot` to verify.

- **Page scaffolds** insert at the canvas root (refusing on a non-empty canvas unless `replace`), record provenance (`metadata.provenance`), and append to the **per-project build log** that feeds the `diversification` signal.
- **Component scaffolds** insert under `targetId` (default root), repeatably — every stamp re-keys its node IDs (`form-field-1-…`, `form-field-2-…`) and returns an `idMap` (template ID → live ID) for follow-up ops. Component stamps don't touch provenance or the build log: they don't shape the page.
- **The name resolves by the canvas's declared type.** An anatomy name stamps that anatomy's realisation for the type: `dashboard` on a mobile canvas stamps `dashboard-mobile`. A realisation name is used as is. A name with no realisation for the type is refused with the anatomies of the same kind that have one (`pricing` on a phone; a web-only component too, whose anatomy is its own name); `realisation` stamps another type's realisation anyway. Resolution reads the *declared* type (`canvas_create({ type: "mobile" })` or `canvas_set_type`): an undeclared canvas is web, whatever its width. The result names the `anatomy` and `surface` it stamped, and its `placeholders` include every copy field of its primitives, with `prop` the field's path (`title`, `subtitle`, `label`, `trailing.text`, `leading.initials`, `leading.label`, `items[0].label`); set a nested one by writing its whole object (`U(id, { trailing: { text: "2h" } })`). A stamp holding a primitive also seeds the colours the primitives read by default (`$text-primary`, `$text-secondary`, `$border`, and `$accent` / `$bg-surface` / `$danger` unless the canvas resolves `$primary` / `$surface` / `$error`), so `seededColors` can list names no node mentions.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `structure` | string | Structure name (use `list_structures`, e.g. `"marquee-hero"`, `"data-table"`) |
| `replace` | boolean? | Page scaffolds: if the root already has children, clear them before stamping. Default `false` (refuses on a non-empty canvas) |
| `targetId` | string? | Component scaffolds: node to stamp under (default `"document"`) |
| `realisation` | `"web"` \| `"mobile"`? | Stamp the realisation for this type instead of the canvas's own (e.g. `"web"` for the web dashboard on a phone canvas) |

### `canvas_import_html`

Import an HTML snippet (+ optional CSS) as an editable canvas — the reverse of `export`. The markup renders headlessly and a computed-style DOM walk maps it to the scene graph:

| Source | → Scene graph |
|--------|---------------|
| flex/block container | `frame` + `layout`/`gap`/`padding`/`alignItems`/`justifyContent`/`wrap` |
| `display: grid` | rows of proportional columns from the computed track template (`grid-column` spans honored — numeric spans win, else the box width decides); irregular templates degrade to a stack with a warning. Recorded in `report.layout` |
| centered content (`margin: auto`, `max-width`, flex-center) | the parent centers (`alignItems`) and the child keeps its real width — `max-width` becomes the fluid `width: "100%"` + `maxWidth` idiom. Recorded in `report.layout` |
| floats / inline-block / unmodeled multi-column CSS | **geometry clustering**: children's computed boxes group into row bands (≥50% vertical overlap, consistent column counts) → rows of proportional columns. Conservative by design — anything that looks multi-column but doesn't cluster consistently imports as an honest stack with a `stack-fallback` entry + warning |
| `<table>` / `<tr>` / `<td>`/`<th>` | a vertical frame of horizontal **row frames** with proportional percentage cell widths (from the computed boxes — colspan handled free); `thead`/`tbody` unwrap, `<caption>` becomes a text node, bottom borders become hairline divider frames. Recorded in `report.layout` |
| text run | `text` (size, weight, color, family, line-height, letter-spacing, transform, align) |
| `<img>` (absolute/data URL) | `image` |
| inline `<svg>` | `icon` when the path data matches a bundled Lucide/Material glyph; else `path` |
| checkbox / radio / `role="switch"` / `<select>` | the input-primitive node types, with live `checked`/selected state |
| background / border / radius / shadow / opacity / overflow | `fill` / `stroke`+`strokeWidth` / `cornerRadius` / `shadows` / `opacity` / `overflow` |

**Lossy by design.** Every import returns a `report` — counts, warnings (dropped background images, grid containers, truncations), unmatched icons/fonts — and that report is the contract; the goal is an *editable, honest* starting point, not a pixel-perfect clone. Single-child wrapper divs collapse, same-style text runs merge, invisible nodes drop (all tunable via `flatten`).

| Param | Type | Description |
|-------|------|-------------|
| `html` | string | The snippet to import |
| `css` | string? | CSS to apply — e.g. the compiled Tailwind stylesheet. A bare Tailwind snippet has no runtime, so classes render unstyled without this |
| `projectId` | string? | Project to create the canvas in (default project if omitted) |
| `name` | string? | Canvas name (default `"Imported HTML"`) |
| `selector` | string? | Import only the first match within the snippet |
| `width` | number? | Container width layouts resolve against (default 1440) |
| `flatten` | object? | `{ collapseWrappers, mergeTextRuns, dropInvisible, maxDepth }` |
| `tokenMatch` | object? | `{ source: "workspace" \| "designMd" \| "tailwind" \| "none", tolerance?, designMd? }` — snap concrete values back to `$token` refs (default: the target project's merged design system) |
| `tailwind` | object? | `{ theme: { name: value } }` — the project's `@theme` map; widens which class names map to `$tokens` |

**Token re-mapping** makes the import a token-driven design instead of a pile of hex:

- **Tailwind intent first** — class names carry intent a computed value can't: `bg-surface` → `fill: "$surface"`, `gap-4` → `16`, `rounded-xl` → `12`, `text-sm font-semibold uppercase` → typography props. Custom utilities resolve via `tailwind.theme`; palette classes (`bg-red-500`) map to the **bundled v4 palette** as hex literals (generated from the official oklch values by Chrome itself — see `scripts/generate-tailwind-palette.ts`), so a bare snippet styles without compiled CSS; arbitrary values and unknowns fall through to computed styles. Geometry intent and palette literals only fill gaps the CSS didn't set; token-ref colors override computed literals.
- **Nearest-color snapping second** — remaining literal colors snap to the matched design system within `tolerance` (exact matches always; near-ties between two tokens are *reported and left literal*, never guessed). Spacing/radius/fontSize values that equal a scale token are reported under `report.scaleMatches`.
- Fonts seen in computed styles feed the font-by-name resolver, so the imported canvas renders in the same faces.

Returns `{ canvasId, rootId, report }` — `report.snapped` / `literals` / `scaleMatches` / `warnings` are the contract.

### `canvas_import_url`

Import a **live page** as an editable, token-mapped canvas — point at a running app and the screen becomes the design-of-record without redrawing. Same engine and token re-mapping as `canvas_import_html`, plus live-page controls:

| Param | Type | Description |
|-------|------|-------------|
| `url` | string | The page to import (http/https only) |
| `viewport` | object? | `{ width, height }` — the width layouts resolve against (default 1440×900) |
| `selector` | string? | Import one component instead of the whole page (default `body`) |
| `waitFor` | string \| number? | CSS selector to await, or a delay in ms — for client-rendered UI |
| `auth` | object? | `{ headers?, cookies? }` for gated pages — used in a **throwaway browser context**, never persisted to the canvas, provenance, or report |
| `projectId` / `name` / `flatten` / `tokenMatch` / `tailwind` | — | Same as `canvas_import_html` |

Relative image URLs resolve against the page; fonts seen in computed styles load through the font-by-name resolver so the canvas renders in the same faces. The source URL (never auth) is recorded in `metadata.provenance.importedFrom`.

### `canvas_sync_from_url`

Drift detection — the design-of-record as a **living contract**. Re-imports a live page *ephemerally* (no canvas created, nothing mutated) and pixel-diffs it against an existing canvas at the same viewport:

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | The canvas that is the design-of-record |
| `url` | string | The live page to compare (http/https) |
| `viewport` | object? | Compare size (defaults to the canvas root size) |
| `selector` / `waitFor` / `auth` | — | Same as `canvas_import_url` (auth in a throwaway context, never persisted) |

Returns the diff image (changed regions in red), `changePercent`, `changedPixels`/`totalPixels`, and the import report. Both sides render at scale 1, so the percentage is comparable run-to-run — an unchanged page diffs at ~0%.

**CI pattern** (a pattern, not a shipped feature — pixel thresholds are workload-specific): after deploy, call `canvas_sync_from_url` for each route ↔ canvas pair and fail the job when `changePercent` exceeds your threshold — design ↔ code divergence becomes a build failure instead of a surprise. For structural drift, the check below has a shipped CLI form, so you don't have to wire this pattern yourself.

Pixel-level only — it tells you *how much* changed, not *what*. For that, see `canvas_check_drift` below.

### `canvas_check_drift`

Structural drift detection — where `canvas_sync_from_url` answers *"how much does it **look** different"* (a pixel percentage), this answers *"**what** diverged"*, in words. Re-imports the live page ephemerally (no canvas created, nothing mutated) and compares normalized inventories of both trees — text runs, controls, table shapes; never styles or geometry:

| Finding kind | Meaning |
|---|---|
| `missing-in-page` | The canvas shows something the page doesn't have — a phantom column, a control that was never built |
| `missing-in-canvas` | The page grew something the canvas doesn't show |
| `control-mismatch` | e.g. *the canvas has a radio group ("Notification type"); the page has a select* |
| `table-mismatch` | Column/header divergence (row-count differences are info-only — data length isn't drift) |

Mostly-numeric texts are treated as data, not structure, so live figures don't false-flag; unmatched page text is reported as a count, never per-string noise. Takes the same params as `canvas_sync_from_url` (`canvasId`, `url`, `viewport`, `selector`, `waitFor`, `auth`). Returns `{ inSync, findings, counts, versionHash, verdict }` — `inSync` is true only with zero error/warning findings.

Run it when picking up a canvas that describes a shipped view — designing on a drifted canvas means faithfully restyling a fiction. On findings, reconcile deliberately: update the canvas, fix the implementation, or flag the difference — never silently annotate it away.

### CLI: `framesmith check-drift` / `framesmith verify`

The same two gate checks, runnable where they fail loudly — CI or a pre-commit hook, no MCP client involved:

```bash
npx framesmith verify kpi-revenue-driver-control --hash sha256r:3f9a1c7e5b2d8046
```

```bash
npx framesmith check-drift admin-stream-types --url https://staging.example.com/admin/stream_types
```

- **`verify <canvasIdOrName> --hash <sha256r:…>`** — exit `0` when the recorded hash still matches, `1` when the design changed since it was recorded, `2` on error. A missing `--hash` is exit `2` (an error, never a skip) — a gate must treat "never approved" as a failure, not as "approved and unchanged". A legacy `sha256:` hash is still checked (with the legacy algorithm) but prints `WARNING — …` to stderr (`--json` gains a `warning` field): it can't see inherited-token edits, so re-record it with the current `sha256r:` hash. Chrome-free and fast enough for a pre-commit hook.
- **`check-drift <canvasIdOrName> --url <url>`** — structural drift against the live page; exit `0` in sync / `1` drifted / `2` error. Needs Chrome. Extra flags: `--viewport WxH`, `--selector <css>`, `--wait-for <selector|ms>`.
- Shared: `--project-dir <dir>` (where the `.framesmith/` discovery walk starts, default cwd — in CI, point it at the checkout) and `--json` for machine-readable output. Canvases resolve by id or exact name; an ambiguous name is an error — a gate must never check the wrong canvas.
- Gated pages (auth headers/cookies) are the MCP tool's job — credentials don't belong in shell history.

`npx framesmith` with no arguments still starts the MCP server; only these exact subcommands (plus `help`) are intercepted.

### `canvas_version`

The falsifiable half of a design-approval gate: a stable **content hash** of the design itself (`sha256r:<16 hex>` over the node tree, the **whole resolved token set** the canvas inherits — workspace → project → canvas — components, and fonts). The token set is hashed whole, whether or not the canvas uses each token, so **any** edit to a workspace or project design system (including by hand in a bound repo's `.framesmith/workspace.json`, and including adding a token no screen uses yet) moves the hash of every canvas that inherits from it. The one exception is a token the canvas overrides itself: an inherited edit to it changes nothing in the resolved set, so that canvas's hash stays put. Deliberate: some tokens are read without being named on the canvas (the default body font, the control-colour fallback, the dark layer), so hashing only the tokens a canvas names could miss a real change. A sibling project's design system never affects this canvas. Metadata never moves it — feedback arriving or being resolved, critique stamps, and provenance changes all leave the hash unchanged — so an approval recorded against a hash survives everything except an actual design change. The hash is process- and machine-independent: the same checked-in repo canvas hashes identically everywhere.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas to hash |
| `expectedHash` | string? | A previously recorded `versionHash` — the result gains `matches: true/false` |

Returns `{ canvasId, name, versionHash, lastModified, matches?, warning? }`. A recorded hash with the older `sha256:` prefix (which covered only the canvas's own tokens) is still checked with the legacy algorithm, and the result carries a `warning` that it can't see inherited-token edits — re-record it with the current `versionHash`. Record `{ canvasId, versionHash }` wherever your approvals live (a YAML file, a PR comment — the workflow is yours); check it later with `expectedHash`. `canvas_list` rows and `export` results carry the same `versionHash`.

### `import_design_md`

Import a [DESIGN.md](https://github.com/VoltAgent/awesome-design-md) file as a design system preset. Parses the Google Stitch format and extracts colors, typography, spacing, and border radius. It also extracts reusable component skeletons (`button`, `card`, `badge`) from the "Component Styling" section — `apply_preset` then makes them available as instanceable components on the canvas. After importing, use `apply_preset` to apply it to any canvas.

| Param | Type | Description |
|-------|------|-------------|
| `content` | string? | Raw DESIGN.md content (provide this OR `filePath`) |
| `filePath` | string? | Absolute path to a DESIGN.md file |
| `name` | string? | Override the preset name |

Compatible with the 55+ design systems in [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (Stripe, Notion, Figma, Vercel, Linear, etc.).

**Accepted token formats.** Each category is read from a loosely-matched heading section (`Colors` / `Color Palette`, `Spacing`, `Border Radius` / `Radius`, `Typography`). Within a section, tokens may be written as a list item (`- name: value`), a 2-column table row (`| name | value |`), or a `name: value` / `**name** (\`value\`)` line — where value is a color (`#hex`, `rgba(...)`) for colors, `Npx` for spacing/radius, and `Npx` (optionally `/ weight`, e.g. `16px / 600`) for typography. Named spacing tokens (`md: 12px`) are honored verbatim; a scale is synthesized **only** when no named tokens are given and a `Base unit: Npx` is stated — otherwise nothing is fabricated. Radius accepts the scale names `sm`/`md`/`lg`/`xl`/`full`/`pill`.

### `screenshot_responsive`

Render a canvas at multiple viewport sizes. Defaults to mobile (390x844), tablet (768x1024), and desktop (1440x900).

The renderer emits `clamp()` for paddings ≥ 32px and font sizes ≥ 24px, so headlines and large spacing shrink proportionally at narrower viewports (assuming a 1440px design width). Smaller values stay static.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `breakpoints` | array? | `[{label, width, height}]` — custom breakpoints |
| `scale` | number? | Device scale (default 2) |
| `theme` | string? | `"dark"` renders the design system's dark token layer (`dark.colors`/`dark.elevation` overrides); default light — a no-op without a dark layer |

### `canvas_diff`

Compare two canvases visually. Returns a diff image with changed regions highlighted in red.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId1` | string | First canvas ID |
| `canvasId2` | string | Second canvas ID |
| `width` | number? | Viewport width (default: the first canvas's artboard width) |
| `height` | number? | Viewport height (default: the first canvas's artboard height) |
| `scale` | number? | Device scale (default 1) |

### `get_feedback` / `resolve_feedback`

Point-and-tell feedback: comments anchored to a specific node (or to the canvas as a whole), stored on the canvas at `metadata.feedback` — plain JSON that travels with the canvas and is git-diffable in bound repos. `get_feedback` returns open entries, each with the comment, the anchor `nodeId`, and a **node snapshot** (`{ type, name, text }`) captured at comment time, so the agent can act without extra lookups; `orphaned: true` marks a comment whose node no longer exists (it stays open — the concern usually applies to the node's replacement). Omit `canvasId` to sweep every canvas in the current context. `resolve_feedback` closes entries with an optional one-line note saying what changed. **Open feedback blocks presenting**, same as open inspector comments — `canvas_list` rows and `canvas_evaluate` results surface an `openFeedback` count (and `init` reports the workspace total) so waiting comments are visible at every checkpoint.

Comments are authored in the viewer: toggle **Comment** in the detail-page toolbar, click any element in the preview (a breadcrumb lets you re-scope from the exact element to its card, section, or the whole page), and type the note. The **Feedback** inspector tab lists open and resolved comments with click-to-highlight, and shows the agent's resolution note as a reply. Entries added any other way (hand-edited JSON, a teammate's `git pull`) reach the running server just the same.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string? (`get`) / string (`resolve`) | Canvas ID; omit on `get_feedback` to sweep the current context |
| `includeResolved` | boolean? | `get_feedback`: also return resolved entries (default false) |
| `feedbackIds` | string[] | `resolve_feedback`: entry ids (`fb-...`) to mark resolved |
| `note` | string? | `resolve_feedback`: reply shown next to the user's comment — what you changed |

`get_feedback` with `canvasId` returns `{ canvasId, openCount, entries }`; omitted, it sweeps and returns `{ canvasesWithFeedback, canvases: [{ canvasId, name, openCount, entries }] }` (only canvases that have feedback). `resolve_feedback` returns `{ resolved: string[], notFound: string[], openCount }` — unknown or already-resolved ids land in `notFound` instead of throwing.

### `canvas_set_genre`

Durably declare what a canvas *is* — writes the evaluation genre to `metadata.provenance.genre` without the token/component churn of `apply_preset`, so an already-styled canvas can be calibrated in one call. Genre and preset are separate fields: `apply_preset` never changes the genre, and a genre an older framesmith stored in the preset field moves to its own field on the first write. The stamp is what `canvas_evaluate` / `canvas_autofix` / the viewer's quality panel read when no explicit `genre` param is passed.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas to stamp |
| `genre` | string \| null | Genre to stamp (`"data"`, `"commerce"`, `"material"`, …) — `null` clears the stamp |

Returns `{ canvasId, genre, canonical, previous, relaxes, presetRelaxes?, note?, versionHashUnchanged }` — `canonical` is the genre with its alias folded (`"dashboard"` → `"data"`, `"checkout"` → `"commerce"`, what evaluate reports); `relaxes` lists the cliché tells the stamp relaxes; `presetRelaxes` (`{ preset, relaxed }`) appears when the canvas's preset relaxes tells on its own (the material preset), which a genre clear doesn't remove; an unknown genre is stored but relaxes nothing, and the `note` says so immediately. Other provenance facts (structure, `importedFrom`) are preserved, and the stamp never moves the canvas's `versionHash` (the hash covers design content only) — recorded approvals stay valid.

### `canvas_set_type`

Declare what medium an existing canvas is on. Writes `metadata.surface` only: it never resizes the artboard and never writes the root's `safeArea`, because either would reflow what is already placed. For a new phone screen, `canvas_create({ type: "mobile" })` does all of it at once.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas to declare |
| `type` | `"web"` \| `"mobile"` \| null | The medium; `null` clears the declaration (the canvas reads as undeclared web again) |
| `device` | string? | Device profile for `"mobile"` (default `"iphone-390"`). Only valid with `"mobile"`. |

Returns `{ canvasId, type, device, source, previous, artboard, hint?, variantsOutOfSync?, versionHashUnchanged }`. `previous` is the declaration it replaced (or `null`); `artboard` is the root's unchanged size. State variants keep the type they were created with, so `variantsOutOfSync` lists each variant (`{ state, canvasId, type }`) whose type now differs from the base's; declare those too. Clearing the type leaves the root, including any `safeArea`, as it is. On a mobile result whose root doesn't reserve both insets or has a size other than the device's, `hint` names the ops that finish the job: `U("document", { safeArea: { top: 47, bottom: 34 } })` and `U("document", { width: 390, height: 844 })`. Those ops change the root, so they move the `versionHash`; the declaration alone is metadata and doesn't. It changes the evaluate result's `surface` report and which rules run, so re-evaluate after it.

### `canvas_evaluate`

Auto-score a design against quality heuristics. Returns an overall score (0–100), per-category scores, per-node actionable issues, and a **`directive`** — a present/keep-working verdict. Designed for generator-evaluator loops: build with `batch_design`, score with `canvas_evaluate`, fix the issues targeting the returned `nodeId`s, repeat until the directive says `READY`.

The **`directive`** is the operating contract that keeps unfinished work off the user's screen. Readiness turns on **blocking findings, not the score**: it reads `READY TO PRESENT` when there are zero errors, zero warnings, **and** zero cliché tells (and no `FRAGILE` stress verdict, see below); otherwise `NOT READY` with what to resolve. (Cliché tells block even at info severity — they're the slop signal; pure advisories like "consider extracting components" are optional.) The score is always reported alongside the directive and remains the quality bar to aim for (**> 95**) — but it no longer withholds readiness on its own: once nothing blocking is left, a design at or below the bar still reads `READY`, and the directive says so explicitly, naming the advisory findings as the remaining lever. Resolve everything blocking and re-evaluate until it says `READY` before showing the design to the user.

Open point-and-tell comments block too: when the canvas has any, the result carries `openFeedback: n` and the directive stays blocking even at a READY score — the human's note outranks the heuristics. Read them with `get_feedback`, address each, close them with `resolve_feedback`.

A `FRAGILE` stress run blocks too. Once `canvas_stress` has recorded a verdict for the canvas, the result carries **`stress`**: `{ verdict, warnings, type, current }`, where `type` is the canvas type the run used and `current` says whether that run was on the canvas's present `versionHash` and type. A `FRAGILE` verdict keeps the directive `NOT READY` even with zero evaluate issues, until a full `CLEAN` run (all five perturbations) replaces it; a subset run can record `FRAGILE` but never clear it. When a `FRAGILE` run's `current` is false the directive tells you to re-run stress, naming whether an edit or a type change made it stale; the verdict still blocks. A stale `CLEAN` run only reads `current: false`. The verdict lives in server memory, so a restart forgets it. `canvas_evaluate` never runs stress itself.

Whenever the `cliche` category runs, the result also carries a **`genre`** field auditing the genre decision: `{ active, source, relaxed, notRelaxed, byPreset? }` — the genre in effect (canonical: a `"dashboard"` stamp reports `"data"`, a `"checkout"` one `"commerce"`), whether it came from the `genre` param or the canvas's provenance stamp, the tells relaxed, `notRelaxed` (`[{ tell, relaxedBy }]`) — tells still flagging that a *different* genre would relax — and `byPreset` (`{ preset, relaxed }`), present when the applied preset relaxed tells on its own (the material preset relaxes accent-hue and pure-black-white whatever the genre). A score pinned by tells listed in `notRelaxed` usually means the wrong genre was declared.

Every result also carries a **`surface`** field: `{ type, device, source, rulesOn, rulesOff, conflicts }` — the canvas type (`"web"` or `"mobile"`), its device profile (`null` on web), whether the type was `"declared"` (by `canvas_create` or `canvas_set_type`) or is the `"default"` web of an undeclared canvas, and the rule ids the composed type, genre and preset rulesets turned on (`rulesOn`) and off (`rulesOff`). A rule both enabled and disabled stays on: it is listed in `rulesOn` and in `conflicts`. `canvas_autofix` returns the same field. Every finding from a rule carries its id in a **`rule`** field. On a web canvas `rulesOn` is `["mobile-artboard"]`; a mobile canvas runs the whole mobile ruleset:

| Rule | Category | Severity | Fires on |
|---|---|---|---|
| `mobile-touch-target` | usability | error | A tap target below 44px: a control (its target extends to its row only when the row is a horizontal frame holding that one tappable), a `button` (`size: "sm"` is 32), a `list-row`, each `tab-bar` tab and FAB, or each `nav-bar` action. Primitives are measured by their own box; nodes inside an instance are judged as rendered and reported on the instance. |
| `mobile-tab-bar` | usability | warning | A `tab-bar` with fewer than 2 or more than 5 tabs (the FAB is not a tab), a tab with no label, or a bar not pinned to the bottom (a `position` override or any `y`). |
| `mobile-handbuilt-target` | usability | info | A frame shaped like a tap target (one icon, or an icon plus a label of up to three words) whose box is below 44px; rebuild it as a `button` if it is tappable. |
| `mobile-safe-area` | usability | warning | Content under the 47px status-bar or 34px home-indicator inset, or left under a pinned bar. With the root's `safeArea` or pinned chrome the renderer reserves the insets, so fast mode checks positioned content (`absolute`, `fixed`, `sticky` at its stuck `y`) and pinned bars: the scroll's end (or start) must clear a bar you pinned, and the finding names the spacer height to add to your content frame. Without `safeArea`, the first and last content must clear the insets. Padding of 32px or more scales down on a phone, so clear an inset with a spacer frame. A `sheet`'s content is never judged. Detailed mode checks rendered positions and is authoritative. |
| `mobile-type-floor` | typography | warning | Text below 11px, `$body` below 16px, or prose of five or more words below 13px (copy of twelve or more words at 13–15px is an info). |
| `mobile-one-column` | usability | info | Prose set side by side in a horizontal or grid frame: two or more children each holding eight or more words. |
| `mobile-artboard` | structure | warning / info | Runs on every type. A mobile canvas 500px or wider warns, and any other size than the device's is an info. An undeclared canvas narrower than 500px warns until `canvas_set_type` declares it; one declared `web` gets an info. |

Whenever the `coverage` category runs on a **base** canvas, the result also carries a **`coverage`** field: `{ dataBearing, states, missing }` — whether the screen carries data-bearing content, which state variants (`canvas_add_variant`) already exist, and which demanded states are missing. It's absent on variant canvases (a variant *is* a designed state, so it doesn't demand states of itself).

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID to evaluate |
| `mode` | `"fast"` \| `"detailed"` \| `"llm"` | `"fast"` = JSON-tree analysis only (<100ms). `"detailed"` adds Puppeteer-based pixel-level overlap checks, laid out at the canvas's artboard size. `"llm"` runs fast-mode heuristics plus a vision-model critique (provider picked from `FRAMESMITH_LLM_PROVIDER` or whichever of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set — costs one paid API call per invocation). Default `"fast"`. |
| `categories` | string[]? | Subset of `spacing`, `color`, `typography`, `structure`, `consistency`, `cliche`, `coverage`, `usability`. Defaults to all. |
| `genre` | string? | Style that relaxes specific `cliche` gates — `"material"` allows purple and white elevated surfaces; `"data"` (alias `"dashboard"`) allows realistic figures on a screen whose numbers are the user's own data (dashboards, activity, finance, fitness, logistics); `"commerce"` (alias `"checkout"`) allows the money on a transactional screen — cart, checkout, order confirmation, billing history. Defaults to the canvas's stored genre (`canvas_set_genre` stamps it durably, no token churn; `apply_preset` never changes it). Replaces only the genre: a material-preset canvas keeps the material relaxation. Pick by what the screen is *for* (read screens with the user's own figures → `data`; a screen you complete a purchase on → `commerce`; editors/admin forms → `material`; a pricing page is marketing and gets none of them), not what it contains — the result's `genre` field audits the choice. |

**Categories and what they check**

| Category | Weight | Checks |
|----------|--------|--------|
| `spacing` | 20 | Off-scale padding/gap values (`gap: 0`, a flush stack, is never flagged), plus spacing variety measured against the canvas's **declared** scale (`set_variables`/`generate_scale` spacing tokens) — only values *not* on that scale count toward sprawl, so a design built entirely from its own multi-step scale (framesmith's generated scale ships nine: `space-3xs`…`space-3xl`) isn't penalized for using it. No declared scale falls back to the old total-unique-values count, with a suggestion to declare one |
| `color` | 25 | WCAG AA contrast ratios for text against nearest background — checked in BOTH themes when a `dark` token layer exists (dark-run issues carry `theme: "dark"`, score takes the worse theme, and dark failures point at the dark layer instead of carrying a literal fix). WCAG-passing pairs that are perceptually weak by **APCA** get an info advisory (Lc vs ~75 body / ~60 large) — APCA is a candidate method, not a standard; it never blocks |
| `typography` | 20 | Type-scale ratios (1.1–2.0; adjacent sizes both declared as typography tokens are pinned and skip the check), font-family count, weight variation — plus score-neutral craft advisories: measure (prose past ~75 characters per line; warning past 90), tracking (display text ≥28px without negative letter-spacing, autofixable), and tabular numerals (numeric table columns without `tabularNums`, autofixable) On a mobile canvas `mobile-type-floor` adds −10 per warning. |
| `structure` | 15 | Tree depth, naming coverage, design-token usage %, component reuse, unknown icon names (an icon node, or a mobile primitive's icon prop — `button.icon`, `leading.icon`, nav-bar `trailing[].icon`, `tab-bar` `items[].icon` (required) and `fab.icon` — that resolves in neither set renders an empty slot: a directive-blocking warning, −10 structure score each; autofixable for icon nodes and `button.icon` when one spelling resolves) `mobile-artboard` adds −10 per warning, on every type. |
| `consistency` | 20 | Frames missing `layout`, sibling overlap (detailed mode; positioned siblings that content scrolls under — absolute, sticky, pinned chrome, a sheet, a bar pinned to the bottom — are exempt, while a bar pinned to the top still counts) — plus score-neutral advisories: **token detachment** (a literal `fill`/`stroke`/`color`/`cornerRadius` that exactly equals a token's value flags with a mechanical `$ref` autofix; ambiguous matches list candidates and never guess) and **ad-hoc motion** (3+ distinct duration/easing combos with no motion tokens declared) |
| `cliche` | 15 | Machine-made tells: default purple/indigo accent, gradient/glow overuse, fake browser/OS chrome (traffic-light dots), the hanging eyebrow-beside-heading header, fabricated metrics/testimonials/logos, eyebrow rhythm (an eyebrow above nearly every section), slop copy (stock AI phrasing — filler verbs, scroll cues, placeholder names, hype labels), radius consistency (too many distinct corner radii), pure black/white (`#000000` ink / `#ffffff` page vs off-black/off-white), accent consistency (multiple competing accent hues — the `$success`/`$warning`/`$danger` status vocabulary is exempt when referenced as tokens, since those are semantics rather than a second accent; the same hues as literals still count). Each issue carries a `tell` discriminator. Tells are warning or info severity, but **every tell blocks the directive**, whatever its severity (see the `directive` above). Relaxable per `genre`. The tells know dashboard vocabulary: a violet reached only through a `$chart-*` or `$*-tint` token doesn't count as the default-purple tell (a literal violet, or one through any other token, still does), a gradient reached through a `$token` doesn't count toward gradient overuse, thin rounded sparkline bars aren't mistaken for traffic-light dots (fake-chrome now requires a near-square shape), and an uppercase label sitting beside a large tabular figure reads as a KPI-card metric, not an eyebrow. It also knows retail copy: a numeral bound to a unit noun by a tight hyphen (`"30-day returns"`, `"2-year warranty"`, `"24/7 support"`) is a compound modifier, not a numbered section eyebrow. |
| `coverage` | 10 | State coverage on **base** canvases with data-bearing content: a detected table demands designed `empty` + `loading` variants, a form (3+ input controls) demands `error` — each missing state is a directive-blocking warning whose suggestion names the `canvas_add_variant` + scaffold path. Variant canvases and non-data screens get no findings. Table detection needs three matching horizontal rows to read as data (two stacked rows are treated as a layout, e.g. a topbar over a greeting); an import-named `Table` frame keeps the looser two-row shape. On a **`loading`** variant itself, a warning fires per data surface (a detected table, or a frame with 2+ large tabular/numeric texts) that still shows live values while a sibling region is skeletoned — "Loading state is half-designed" — naming the region and suggesting the matching skeleton scaffold. The result's `coverage` field reports `{ dataBearing, states, missing }`. |
| `usability` | 20 | The mechanical UX floors beyond contrast. A control below the **24px hit-target floor** is an **error** (WCAG 2.5.8) — the effective target counts a lone control's padded row, so a well-padded settings row passes while two small controls sharing a row are measured bare; phone-width web artboards additionally get a 44px touch-first info, and a canvas declared `mobile` makes 44px an error instead (`mobile-touch-target`, see the mobile ruleset above). A control with **no text label** in its row or group is a warning (selects carry their own value text). **Vague action copy** — "Click here", "Learn more", "Read more", or "Submit" as the exact label — is an info: name the action. Controls also render with accent-derived `:focus-visible` rings in the live viewer; screenshots stay byte-identical (nothing is focused in a static capture). |

The weights are relative, not points out of 100. Each category scores 0–100, and `overallScore` is their weighted mean: the sum of score × weight over the categories that ran, divided by the sum of their weights.

**Return shape**

```json
{
  "overallScore": 87,
  "categories": [{ "name": "spacing", "score": 90, "issueCount": 1, "weight": 20 }],
  "issues": [
    {
      "category": "color",
      "severity": "error",
      "nodeId": "abc123",
      "message": "Text \"Sign In\" has contrast ratio 2.8:1 against #1a1a2e. WCAG AA requires 4.5:1.",
      "suggestion": "Increase contrast by darkening/lightening the text or background."
    }
  ],
  "summary": "Overall quality: Good (87/100). Strongest: spacing (90/100). Weakest: color (75/100)...",
  "stats": { "totalNodes": 14, "textNodes": 5, "frameNodes": 8, "maxDepth": 4, "tokenUsagePercent": 61, "componentReusePercent": 0 },
  "mode": "fast",
  "surface": { "type": "web", "device": null, "source": "default", "rulesOn": ["mobile-artboard"], "rulesOff": [], "conflicts": [] },
  "genre": { "active": null, "source": null, "relaxed": [], "notRelaxed": [{ "tell": "accent-hue", "relaxedBy": ["material"] }] },
  "coverage": { "dataBearing": true, "states": [], "missing": ["empty", "loading"] },
  "directive": "NOT READY — 87/100 with 1 issue(s) to resolve. Fix them now: canvas_autofix for the mechanical subset, batch_design for the rest (cliché tells included), then re-run canvas_evaluate. Repeat until there are zero warnings and zero cliché tells. Do NOT show this design to the user yet."
}
```

An issue produced by a ruleset rule also carries `rule` (its id, e.g. `"mobile-touch-target"`).

**With `mode: "llm"`**, the vision model scores a **fixed rubric** — five axes, each 1–5 with a rationale — instead of one opaque number. The verdict is stamped on the canvas (`metadata.critique`) and the per-project build log so quality is auditable over time. Add `floor` (1–5, default 3, or `FRAMESMITH_CRITIQUE_FLOOR`) to set the per-axis threshold that trips `needsRevision`. **Without an `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, the call doesn't fail** — the full heuristic result still returns with an `llmNote` explaining the critique was skipped, and the heuristic directive alone decides whether the design is ready.

**The critique never gates presenting, with or without a key.** The heuristic `directive` is the only presentation gate. With a key, the critique loop is the standard last step: judge, run `canvas_revise` on the failing axes, and re-judge. If `canvas_revise` stops (`max-iterations` or `no-improvement`) and `needsRevision` is still `true`, present the design anyway and tell the user which axes still fail. A judge the agent can't satisfy by improving the design would strand it, and a model verdict varies from run to run.

```json
{
  "llmCritique": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "rubric": {
      "hierarchy":   { "score": 4, "rationale": "clear primary metric, secondary stats recede" },
      "execution":   { "score": 4, "rationale": "tidy alignment and consistent spacing" },
      "specificity": { "score": 3, "rationale": "reads a touch generic for a dashboard" },
      "restraint":   { "score": 5, "rationale": "flat surfaces, no gratuitous effects" },
      "variety":     { "score": 2, "rationale": "the default centered three-card row" }
    },
    "score": 72,
    "summary": "Clean, restrained dashboard; layout is conventional.",
    "suggestions": ["break the symmetric three-card row with an asymmetric feature tile"],
    "needsRevision": true,
    "failingAxes": [{ "axis": "variety", "score": 2, "rationale": "the default centered three-card row" }]
  }
}
```

Axes: **hierarchy** (focal order), **execution** (craft — alignment/spacing/contrast), **specificity** (designed-for-purpose vs generic), **restraint** (no overdone effects — the LLM sibling of the `cliche` category), **variety** (avoids same-shape sameness). `score` is **derived**: `round(mean(axisScores) / 5 * 100)`. To close the loop automatically, see `canvas_revise`.

Provider selection: `FRAMESMITH_LLM_PROVIDER` env var (`anthropic` | `openai`), else falls back to whichever of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set. Default models: `claude-sonnet-4-6` / `gpt-4.1` (override via `FRAMESMITH_LLM_ANTHROPIC_MODEL` / `FRAMESMITH_LLM_OPENAI_MODEL`). Adding a third provider is one entry in the `judges` table in `src/llm-judge.ts`.

**Example generator-evaluator loop**

```
batch_design({ canvasId, operations: "..." })
const r = canvas_evaluate({ canvasId, mode: "fast" })
// r.issues[].nodeId points to exactly what to fix
batch_design({ canvasId, operations: `U("${r.issues[0].nodeId}", { color: "#ffffff" })` })
canvas_evaluate({ canvasId })  // re-score
```

Issues that have a mechanical fix come back with an extra `fix: { op, rationale }` field — see `canvas_autofix` below.

### `canvas_autofix`

Runs `canvas_evaluate` in fast mode and returns just the subset of issues with a mechanically derived fix — no judgement calls. By default it proposes: each fix carries a ready-to-paste `batch_design` Update op string. With `apply: true` it writes the fixes in the same call and reports applied/failed per op. Closes the generator-evaluator loop without a second AI hop.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas to autofix |
| `categories` | string[]? | Restrict to fixes from these categories (default: all) |
| `genre` | string? | Style that relaxes specific `cliche` gates — `"material"` allows purple and white elevated surfaces; `"data"` (alias `"dashboard"`) allows realistic figures on a screen whose numbers are the user's own data (dashboards, activity, finance, fitness, logistics); `"commerce"` (alias `"checkout"`) allows the money on a transactional screen — cart, checkout, order confirmation, billing history. Defaults to the canvas's stored genre (`canvas_set_genre` stamps it durably, no token churn; `apply_preset` never changes it). Replaces only the genre: a material-preset canvas keeps the material relaxation. |
| `apply` | bool? | Write the fixes to the canvas in this call (default `false`: propose only) |

**What gets auto-fixed**

- **Spacing** — off-scale `gap` or scalar `padding` snaps to the nearest scale value; array `padding` gets one fix per node that writes the complete snapped array (e.g. `[9, 0, 9, 18]` → `[8, 0, 8, 16]`).
- **Consistency** — frames with multiple children but no `layout` get `layout: "vertical"`; a literal `fill`/`stroke`/`color`/`cornerRadius` that exactly equals a single token's value gets re-pointed to `$token` (a value shared by multiple tokens is reported with candidates but never auto-fixed — no guessing).
- **Color** — recoverable WCAG contrast failures get `color: "#000000"` or `"#FFFFFF"`, whichever wins against the resolved background. Failures so bad that neither black nor white meets the threshold are not auto-fixed (the background also needs to change).
- **Cliché** — a *known-default* purple/indigo accent (`#6366f1` and friends) written literally on a node swaps to a neutral accent; a dedicated fake-chrome strip (a row that is just traffic-light dots) gets a `D(...)` delete; pure-black ink (`#000000` text/icon/stroke) softens to off-black. Taste-dependent tells (gradient/glow overuse, the hanging header, fabricated copy, eyebrow rhythm, slop copy, mixed radius systems, competing accents) are reported by `canvas_evaluate` with a suggestion but carry **no** auto-fix op.
- **Structure** — an unknown icon name with exactly one spelling that resolves (hyphen ↔ underscore, or a missing `material:` prefix; if several resolve, the one matching the icon set the rest of the canvas uses) is rewritten via `U(id, { icon: "<name>" })`. Icons inside component definitions are flagged but carry no fix op — edit the component. A name with no resolving spelling is reported with a suggestion only.
- **Coverage** — missing state variants (empty/loading/error) have no mechanical fix either — designing a state is a judgment call. `canvas_evaluate` reports the gap with a suggestion naming the `canvas_add_variant` + scaffold path.

**Return shape**

```json
{
  "totalIssues": 18,
  "fixableCount": 5,
  "fixes": [
    {
      "nodeId": "abc123",
      "category": "color",
      "op": "U(\"abc123\", { color: \"#000000\" })",
      "rationale": "Switch text color to #000000 for WCAG AA contrast against #F8FAFC",
      "message": "Text \"Sign In\" has contrast ratio 2.8:1 against #F8FAFC. WCAG AA requires 4.5:1."
    }
  ]
}
```

Apply the ops by joining them with newlines and passing to `batch_design`, then re-evaluate.

### `canvas_stress`

Content stress test — does the design survive real data? Re-renders the canvas under hostile-but-realistic content perturbations and reports exactly what broke, by node id. Never mutates the canvas. The verdict is remembered for `canvas_evaluate`, with the canvas type it ran under: any run with warnings records `FRAGILE` (its directive then stays `NOT READY`), and only a run of the full default set records `CLEAN`, so a passing subset never clears an earlier `FRAGILE`. On a `mobile` canvas `long-text` leaves strings of three characters or fewer alone (monograms, short labels), and the tab and nav-bar action labels (fixed vocabulary; `i18n` still lengthens them). The mobile primitives' own copy is perturbed (`button` label, `list-row` title / subtitle / trailing text, `nav-bar` title and actions, `tab-bar` labels), and a label hitting its designed ellipsis reports an *info*.

| Perturbation | What it does |
|---|---|
| `long-text` | Non-data text ×2.2 plus one long unbroken token (the wrap-breaker) |
| `i18n` | Text ×1.4 — the German/Finnish expansion rule |
| `big-numbers` | Data-like text to its widest realistic form: `9` → `999+`, `$1.5M` → `$1,520,847.33` |
| `empty` | Detected tables lose their data rows (and runs of two or more consecutive `list-row`s are emptied) |
| `many` | Data rows ×3 (and `list-row` runs ×3) |

Finding kinds: `clip` (content cut off — *info* when a designed `text-overflow: ellipsis` is doing its job, or when it's a primitive's label hitting its designed ellipsis, or a root with an authored `overflow` clipping or scrolling inside itself; a sheet's own vertical overflow scrolls and is never a clip; *warning* otherwise), `overflow-x` (a node escapes its parent box or the canvas), `layout-shift` (an **untouched** node ballooning — perturbed nodes, their ancestors, and a stretch sibling that merely follows a legitimately growing parent are exempt). Only **new** breakage counts: anything already clipping at baseline is the design's standing state. Tables are found with the same inventory drift and coverage use; component instances are expanded first.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas to stress |
| `perturbations` | string[]? | Subset of the five (default: all) |
| `screenshots` | bool? | Attach a render of each perturbation that produced warnings |

Returns `{ canvasId, versionHash, perturbations: [{ name, touchedCount, findings } | { name, skipped }], counts, verdict }` — `CLEAN` only with zero warnings. Fix findings with fluid widths, `minWidth` or `minHeight` floors, and wrapping (see [Width strategies](docs/GUIDELINES.md#width-strategies) in the authoring guidelines), then re-run. Chrome required (~1 render per perturbation).

### `project_evaluate`

The set-level review no single canvas can give: per-screen score summaries plus checks that only exist **across** screens. Run it when a multi-screen module feels done.

| Finding kind | What it catches |
|---|---|
| `radius-drift` | A screen whose corner-radius set shares nothing with the project's common scale |
| `accent-drift` | An accent hue more than 30° from the project's dominant one |
| `token-adoption` | A screen styling by hand while the rest of the project references tokens |
| `copied-chrome` | The same substantial top-level shape hand-copied on 2+ screens instead of component instances — named with the `create_component` + `copy_nodes` fix path |
| `state-coverage` | The aggregated missing empty/loading/error table across screens |

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | string | The project whose screens to roll up |
| `canvasIds` | string[]? | Restrict to specific canvases (e.g. one flow); default: every non-variant canvas |
| `mode` | string? | `"fast"` (default — heuristic roll-up, Chrome-free, keyless) or `"llm"` — adds the **flow critique** |

Returns `{ canvases: [{ canvasId, name, score, blocking, states, missingStates, tokenUsagePercent }], findings, counts, verdict }`. **Advisory, not a gate**: only the per-canvas directives block presenting — this reviews coherence and points at fixes. Every finding names its evidence (which canvases, which values). Variants are excluded from the rows and feed their base's states column. The default mode is Chrome-free and needs no API key.

**`mode: "llm"` — the flow critique.** Up to 8 screens are rendered and judged *together* (one multi-image call) against a fixed flow rubric — `navigation-consistency`, `terminology-consistency`, `state-visibility`, `hierarchy-consistency` — each 1–5 with a rationale, plus per-screen notes naming the canvas (notes naming unknown screens are dropped in parsing; anchoring stays honest). Screens past the cap are listed in `flowSkipped` — pass `canvasIds` to pick the flow yourself; nothing is silently dropped. Needs Chrome and an `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; **without a key the full heuristic roll-up still returns, with a `flowNote` instead of an error** — same contract as `canvas_evaluate`'s llm mode.

### `canvas_revise`

Closes the critique loop. Judges the canvas against the rubric; if any axis is below the floor, asks an LLM for targeted `batch_design` ops that raise the failing axes, applies them, re-renders, and re-judges — up to `maxIterations` passes. **Mutates the canvas.** Opt-in and bounded; it never runs implicitly.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas to revise |
| `maxIterations` | number? | Revise passes, 1–3 (default 1) |
| `floor` | number? | Per-axis rubric floor 1–5 (default 3 / `FRAMESMITH_CRITIQUE_FLOOR`) |
| `provider` | `"anthropic"` \| `"openai"`? | Force an LLM provider (default auto-detect) |

**Loop & safety**

- Each pass: render → judge → if `needsRevision`, revise the failing axes → apply (validated through `batch_design`) → re-render → re-judge.
- **Stops** when the canvas passes (`passed`), at the cap (`max-iterations`), when a pass doesn't improve the overall (`no-improvement` — the regressing edit is **reverted**), when the reviser returns nothing (`no-ops`), or when an op fails to apply (`apply-error` — the partial edit is reverted).
- Every **accepted** pass re-stamps `metadata.critique` + the build log. Costs ≥2 paid API calls per pass (one judge + one revise) and renders between passes (Chrome required).
- **It never gates presenting.** The heuristic `directive` does. If the loop stops (`max-iterations`, `no-improvement`) with `needsRevision` still `true`, present the design and name the failing axes (see [`canvas_evaluate`](#canvas_evaluate)).

**Return shape**

```json
{
  "iterations": [
    { "pass": 1, "overallBefore": 72, "failingAxes": ["variety"],
      "opsApplied": "U(\"cards\", { ... })", "overallAfter": 84 }
  ],
  "finalVerdict": { "rubric": { "...": {} }, "score": 84, "needsRevision": false, "failingAxes": [] },
  "stoppedReason": "passed"
}
```

## Resources

- **`framesmith://guidelines`** — markdown authoring guide: width strategies (fixed / percentage / fluid+cap / floor / fit-content), responsive hint semantics (`stack` / `wrap`), common patterns (pricing tiers, two-column hero, tag list, toolbar), and anti-patterns. Source: [`docs/GUIDELINES.md`](docs/GUIDELINES.md).

## Benchmark

`npm run bench` runs `canvas_evaluate` over a fixed corpus of canvases (a high-quality dashboard hero, a minimal well-formed canvas, an intentional-contrast-failure canvas) and diffs the result against [`benchmark/baselines.json`](benchmark/baselines.json). Catches drift in scoring across renderer / evaluator changes — exit code is nonzero on any score, issue-count, or issue-message change. Re-baseline with `npx tsx benchmark/run.ts --update` after intentional evaluator rewrites.

## Gradients

Nodes support linear and radial gradients via the `gradient` property:

```
# Linear gradient (angle in degrees)
I("parent", { type: "frame", width: 400, height: 200, gradient: { type: "linear", angle: 135, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}] } })

# Radial gradient
I("parent", { type: "frame", width: 200, height: 200, gradient: { type: "radial", stops: [{color: "#fff", position: 0}, {color: "#000", position: 100}] } })
```

When `gradient` is set, it takes precedence over `fill`. Both can coexist (`fill` as fallback).

## Shadows & Blur

Structured shadows, blur filters, and backdrop blur:

```
# Structured shadow (supports multiple shadows)
I("parent", { type: "frame", fill: "#fff", shadows: [{x: 0, y: 4, blur: 12, spread: 0, color: "rgba(0,0,0,0.15)"}] })

# Blur filter
I("parent", { type: "frame", fill: "#3b82f6", blur: 4 })

# Backdrop blur (single-function shorthand for `blur`)
I("parent", { type: "frame", fill: "rgba(255,255,255,0.5)", backdropBlur: 8 })

# Glassmorphism (composable backdrop-filter: blur + saturate + brightness + contrast)
I("parent", {
  type: "frame",
  fill: "rgba(255, 255, 255, 0.4)",
  backdropFilter: { blur: 12, saturate: 180, brightness: 110 }
})
```

The structured `backdropFilter` form takes precedence over `backdropBlur` when both are set. The renderer also emits the `-webkit-backdrop-filter` prefix so glass effects render in Safari/iOS without extra work.

The legacy `shadow` string property still works for simple cases.

## Icons

Two bundled sets are available via the `icon` node type, rendering as inline SVGs with configurable size and color:

**Lucide** (1,900+, stroke style) — unprefixed names, [browse here](https://lucide.dev):

```
I("parent", { type: "icon", icon: "search", iconSize: 24, iconColor: "#888" })
I("parent", { type: "icon", icon: "heart", iconSize: 32, iconColor: "#ef4444" })
```

**Material Symbols** (3,800+, fill style) — `material:` prefix, [browse here](https://fonts.google.com/icons):

```
I("parent", { type: "icon", icon: "material:check", iconSize: 24, iconColor: "#b71421" })
I("parent", { type: "icon", icon: "material:settings", iconStyle: "rounded" })
I("parent", { type: "icon", icon: "material:star-fill" })   # "-fill" suffix = filled variant
I("parent", { type: "icon", icon: "material:chevron_right" })   # multi-word names keep Material's underscores
```

Spelling differs by set: Lucide hyphenates (`chevron-right`), Material keeps underscores and needs the prefix (`material:chevron_right`). An icon name that resolves in neither set renders an empty slot, so `canvas_evaluate` warns on it (structure category; the mobile primitives' icon props too) and `canvas_autofix` rewrites it on an icon node or `button.icon` when exactly one spelling resolves.

`iconStyle` picks the Material variant (`"outlined"` default, `"rounded"`, `"sharp"`); it's ignored for Lucide.

## Input controls

`toggle`, `checkbox`, `radio`, and `select` are first-class node types — static renders with a `checked` / `value` / `disabled` state, so app UI doesn't have to be faked from frames and ellipses:

```
I("parent", { type: "toggle", checked: true })
I("parent", { type: "checkbox", checked: true })
I("parent", { type: "radio" })
I("parent", { type: "select", value: "Administrator", width: 220 })
I("parent", { type: "select" })                      # renders a muted "Select…" placeholder
I("parent", { type: "toggle", checked: true, disabled: true })   # 50% opacity
```

Colors default from the design system — `$accent` (falling back to `$primary`) for active states, `$border` for outlines, `$bg-surface` / `$text-primary` for the select — with neutral fallbacks on unthemed canvases. Explicit `fill` / `stroke` / `color` override. Defaults: toggle 44×24, checkbox/radio 18×18, select `fit-content` (give it a `width` for form layouts).

All four controls are keyboard-focusable in the live viewer (`tabindex="0"`, an accent-derived `:focus-visible` ring) — that's a live-viewer-only affordance and never changes a screenshot, since nothing is focused in a static capture. `canvas_evaluate`'s `usability` category checks the things the renderer can't guarantee on its own: hit-target size, label association, and honest action copy — see the categories table below.

## SVG Paths

For custom shapes and brand marks beyond the Lucide library, use the `path` node type with a raw SVG `d` attribute:

```
I("parent", { type: "path", width: 24, height: 24,
  d: "M 12 2 L 22 22 L 2 22 Z", fill: "#f59e0b" })

# With stroke + viewBox (defaults to `0 0 width height`)
I("parent", { type: "path", width: 48, height: 48, viewBox: "0 0 24 24",
  d: "M 12 2 L 22 22 L 2 22 Z",
  fill: "none", stroke: "#000", strokeWidth: 2,
  strokeLinecap: "round", strokeLinejoin: "round" })
```

`fill`/`stroke`/`strokeWidth` apply to the path itself (not the wrapper). `d` and `viewBox` are validated for safe characters — anything that could break out of the attribute is rejected.

## Animations & Transitions

Reference a built-in keyframe to make a node animate in on page load. The renderer auto-emits the `@keyframes` block only when referenced.

```
I("hero", { type: "frame", animation: { name: "fadeIn", duration: 400 } })
I("title", { type: "text", animation: { name: "slideUp", duration: 300, delay: 100 } })
```

Built-in keyframe names: `fadeIn`, `slideUp`, `slideDown`, `scaleIn`. All end at the natural resting state with `animation-fill-mode: both`, so the start state applies pre-animation and the end state sticks after.

`animation`: `{ name, duration?: 300ms, delay?: 0ms, easing?: "ease-out", iteration?: 1 | "infinite" }`. Easing is whitelisted: `ease`, `ease-in`, `ease-out`, `ease-in-out`, `linear` (anything else falls back to `ease-out`).

`transition`: `{ property?: "all", duration, easing?: "ease", delay?: 0ms }`. Transitions only fire on state change, so they're inert until interactive states exist in the renderer — included today so a future hover/focus PR has a place to land.

## Components

The usual path is `create_component` (see [Tools](#create_component)): build the subtree once, promote it, then stamp instances. Promoting is preferred over hand-authoring a `type: "component"` node from scratch because it keeps ids stable and reports back exactly which children are overridable:

```
create_component({ canvasId: "abc123", nodeId: "card-1", name: "Card" })
→ { "componentId": "cmp-card", "instanceId": "card-1", "overridableChildren": ["title", "subtitle"] }

I("document", { type: "instance", componentId: "cmp-card", overrides: { title: { content: "My Card" }, subtitle: { content: "Custom text" } } })
```

You can also define a component from scratch with `batch_design` (a frame subtree that gets registered directly, without an existing node to promote):

```
# Define a component
card=I("document", { type: "component", name: "Card", width: 300, fill: "#1a1a1a", cornerRadius: 12, layout: "vertical", padding: 16, gap: 8 })
I(card, { type: "text", name: "title", content: "Default Title", fontSize: 20, color: "#fff" })
I(card, { type: "text", name: "subtitle", content: "Default subtitle", fontSize: 14, color: "#888" })

# Create instances with overrides (matched by child name)
I("document", { type: "instance", componentId: card, overrides: { title: { content: "My Card" }, subtitle: { content: "Custom text" } } })
```

`copy_nodes` (see [Tools](#copy_nodes)) copies an instance — and the component def it references — into another canvas, so a shared shell is authored once and reused across sibling screens.

## Usage Example

A complete session designing a sign-in screen — the framesmith way: **start from a pattern, adapt it, and let the evaluator gate the result** (rather than building from a blank canvas and faking controls out of frames).

**1. Start from a vetted pattern, not a blank canvas**

```
canvas_create({ name: "Sign in" })
→ { "canvasId": "abc123", "viewerUrl": "http://localhost:3001/canvas/abc123", ... }

apply_structure({ canvasId: "abc123", structure: "auth" })
→ returns the placeholder node IDs to populate (au-title, au-sub, au-email, au-password, au-submit, ...)
```

The `auth` pattern already scores > 95 — a centered card with real form fields, a real submit button, honest placeholder copy, and an accent that isn't the default purple. You're adapting a good design, not inventing one.

**2. Adapt it — set the brand accent and the copy**

```
project_set_design_system({ projectId: "<the projectId from canvas_list / init>", variables: { colors: { accent: "#2563EB" } } })

batch_design({
  canvasId: "abc123",
  operations: `
    U("au-title", { content: "Welcome back" })
    U("au-sub", { content: "Sign in to continue to your workspace." })
  `
})
```

**3. Evaluate — and only present when the directive says READY**

```
canvas_evaluate({ canvasId: "abc123", mode: "fast" })
→ {
    "overallScore": 98,
    "issues": [],
    "directive": "READY TO PRESENT — 98/100, no blocking issues."
  }
```

If it came back `NOT READY`, you'd apply `canvas_autofix` (mechanical fixes) / `batch_design` (the rest) and re-evaluate until it clears — then `screenshot` and share the viewer URL. The directive is what keeps an unfinished design off the user's screen.

**4. Verify across breakpoints**

```
screenshot_responsive({ canvasId: "abc123" })   // renders mobile / tablet / desktop
```

## Running the viewer

The viewer runs in one of two modes — embedded (auto-starts inside the MCP server process) or standalone (long-lived in its own terminal). Standalone is recommended; the embedded mode stops the moment your MCP session ends, so any viewer URL you shared becomes unreachable.

### Standalone (recommended)

```bash
# In a separate terminal tab — stays alive independently of any MCP session
npx -p framesmith framesmith-viewer

# Or on a specific port
npx -p framesmith framesmith-viewer 3004
```

> Working from a clone instead of npm? Run `npm run viewer` (or `npm run viewer -- 3004`) from the repo root — same standalone viewer, run from source.

The standalone viewer:

- **Persists across sessions** — URLs keep working after Claude / Cursor / Windsurf finishes
- **Shared across projects** — multiple MCP sessions (from different projects) all use the same viewer
- **Auto-detects new canvases** — watches `~/.framesmith/canvases/` and every registered repo's `.framesmith/` for changes and picks them up immediately
- **Auto-detected by MCP** — when the MCP server starts, it probes for a running standalone viewer and uses it instead of starting its own

### Routes & API

- **Gallery** (`/`) — browse all canvases as clickable cards with live thumbnails
- **Project** (`/project/:id`) — same gallery but scoped to one project
- **Archive** (`/archive`) — soft-deleted canvases with restore / permadelete actions
- **Canvas detail** (`/canvas/:id`) — full rendered design with responsive viewport buttons (Mobile / Tablet / Desktop), Compare mode, Fit toggle, and JSON inspector
- **Raw HTML** (`/canvas/:id/html`) — the rendered HTML for embedding or inspection
- **JSON API** (`/api/canvases`, `/api/canvas/:id/meta`) — programmatic access
- **Live auto-refresh** — the viewer polls for changes every 2 seconds, so the browser updates automatically as your agent runs `batch_design`

Unbound canvases persist to `~/.framesmith/canvases/` as JSON files, and canvases in a bound repo persist to that repo's `.framesmith/` (see [`canvas_bind`](#canvas_bind)). Both survive process restarts, and the viewer shows both: the global store plus every repo registered in `~/.framesmith/registry.json`. Set `FRAMESMITH_VIEWER_URL` in the MCP server env to point at a viewer running on a non-default port.

## Workflow

The loop framesmith is built around — start from taste, adapt, and polish to the bar before anyone sees it:

1. Start the standalone viewer in a terminal tab: `npx -p framesmith framesmith-viewer`, and open its URL for live preview.
2. `canvas_create` → get a canvas ID (share the viewer URL).
3. Set the design system once — `generate_design_system` (seed + personality → the whole language: colors, fonts, type roles, radius/density, elevation, motion) is the fastest start; `workspace_set_design_system` / `apply_preset` / `set_variables` hand-author or adjust individual `$token`s.
4. **`apply_structure`** → stamp a vetted page pattern (on a phone canvas, the mobile realisation of the same name), then adapt it with `batch_design` (real icons, controls, and components — not faked from frames). This is the starting point; a blank canvas is the slow, sloppy path.
5. Watch the viewer auto-refresh as you design; `screenshot` to check the render.
6. **`canvas_evaluate`** → read the `directive`. Resolve every warning and cliché tell (`canvas_autofix` for the mechanical subset, `batch_design` for the rest), then re-evaluate. Repeat until it says `READY` — only then present the design.
7. **Final polish, when an LLM API key is configured:** `canvas_evaluate({ mode: "llm" })` scores the render on the fixed five-axis rubric, `canvas_revise` addresses the failing axes, re-judge until it passes or `canvas_revise` stops. The heuristic gate is the floor; the critique loop is the ceiling. Treat it as the standard last step, not an optional extra. It never blocks presenting: if axes still fail when `canvas_revise` stops, present the design and name the failing axes. No key on hand? The heuristic directive decides readiness either way, and the result says the critique was skipped.
8. `screenshot_responsive` → confirm it holds at mobile / tablet / desktop.
9. `canvas_diff` / `canvas_sync_from_url` / `canvas_check_drift` → compare versions, or check the shipped app hasn't drifted from the approved design — pixel-level or structural.
10. `export` → save final designs to PNG/PDF.

## Development

```bash
git clone https://github.com/vicmaster/framesmith.git
cd framesmith
npm install
npm run build
```

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run build` | Compile TypeScript to `dist/`. Required before the installed MCP server picks up changes — it loads `dist/index.js`. |
| `npm run dev` | Run the server directly via `tsx` for local iteration. Does not affect the registered MCP server. |
| `npm run viewer [port]` | Start the standalone viewer (default auto-picks from 3001). |
| `npm test` | Run every test that needs only Node (~2 min). Alias for `test:fast`. |
| `npm run test:full` | The above plus the browser-driven tests. Needs Chrome — `npx puppeteer browsers install chrome`. |
| `npx tsx scripts/run-tests.ts <substring>` | Run just the tests whose filename matches. |
| `npx tsx test-*.ts` | Run a single test script directly. |

### Env vars

| Variable | Purpose |
|----------|---------|
| `FRAMESMITH_VIEWER_URL` | Point the MCP server at an external viewer (skips starting an embedded one). |
| `FRAMESMITH_VIEWER_PORT` | Override the standalone viewer's port. |
| `FRAMESMITH_CHROME_PATH` | Chrome binary for screenshots/exports (falls back to `PUPPETEER_EXECUTABLE_PATH`, then the Puppeteer-managed Chrome). Set it in the MCP server's env config — clients often launch servers with a minimal env. |

### Conventions

- ESM only (`"type": "module"`). Imports in TypeScript source use `.js` extensions even when the source file is `.ts`.
- Don't edit `dist/` — it's regenerated by `tsc`.
- New MCP tool? Register it in `src/index.ts`, document it in the Tools section above, and update `VISION.md`'s phase checklist.

## Who built this

Built by [Victor Velázquez](https://victorvelazquez.dev) — COO at [MagmaLabs](https://www.magmalabs.io) and author of [*The Agentic Engineer*](https://leanpub.com/theagenticengineer).

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 Victor Velazquez.
