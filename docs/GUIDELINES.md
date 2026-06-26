# Authoring Guidelines

How to design with framesmith so the result holds up across breakpoints.

## Organizing work

Canvases live inside a `Workspace > Project > Canvas` hierarchy. The built-in `Personal` workspace + `Untitled` project always exist as a default home; create more once you're running multiple projects.

- **`workspace_create({ name })`** — top-level container (e.g. "Client work", "Personal").
- **`project_create({ workspaceId, name })`** — group related canvases inside a workspace.
- **`canvas_create({ name, projectId })`** — drops the canvas in the given project (defaults to Untitled).
- **`canvas_move({ canvasId, projectId })`** — reassign a canvas between projects.
- **`canvas_archive` / `canvas_unarchive`** — soft-delete: canvas stays on disk but hides from default listings. Reach for this when iterating; reach for `canvas_delete` (permanent) only when sure.

`workspace_delete` and `project_delete` refuse to remove non-empty containers. Clear the contents first or `canvas_move` them out.

## Two-line summary

1. **Author desktop-first at one design width.** Pick a width (1200 or 1440 is typical), compose the design there.
2. **Adapt down with `responsive` hints + fluid widths.** The renderer derives the mobile/tablet layout from the same scene graph — you don't author it twice.

## Width strategies

Pick the right `width` per node — this is the single biggest lever for responsive quality.

| Use | When | Example |
|---|---|---|
| Fixed pixels (`width: 360`) | Icons, badges, small chips, fixed UI elements that should *not* reflow | Avatar `width: 40`, badge `width: 80` |
| Percentage string (`width: "50%"`) | Column splits inside a parent — child should be a fraction of available row | Two-column hero, sidebar + main |
| Fluid + cap (`width: "100%", maxWidth: 600`) | Content that should fill the row on narrow viewports but cap on wide screens | Article body, dashboard cards |
| Floor (`width: "50%", minWidth: 240`) | Column splits where the child has a minimum readable size | Card grid where 50% would otherwise become unreadably narrow |
| `width: "fit-content"` | Hugs its content; lets the parent's `gap` and `alignItems` do the spacing | Buttons, pills, link-style text |

**Default to fluid.** Reach for fixed pixel widths only when the content genuinely shouldn't scale.

## Responsive hints

Set `responsive` on **container nodes** (frames with `layout: "horizontal"` and children). The renderer emits the right media-query / flex-wrap rules.

| Hint | Effect | Use when |
|---|---|---|
| `responsive: "stack"` | Horizontal container flips to vertical below 768px | Multi-column rows that should become a single column on mobile. **This is the most common case** — almost every card row, hero with side-by-side panels, footer link group |
| `responsive: "wrap"` | Children wrap to the next line instead of overflowing | Tag clouds, badge groups, card grids that can have an irregular last row |
| `responsive: "fixed"` | Never reflows | Toolbars, navbars, fixed-position headers — anywhere reflow would break the layout intent |

## Common patterns

**Pricing tiers** (3 cards side-by-side → single column on mobile):

```js
row=I("document", { type: "frame", layout: "horizontal", gap: 24, responsive: "stack" })
c1=I(row, { type: "frame", width: "100%", maxWidth: 360, padding: 32, fill: "#0F172A", cornerRadius: 16 })
// ...c2, c3 the same shape
```

**Two-column hero** (text + image, stacks below 768px):

```js
hero=I("document", { type: "frame", layout: "horizontal", gap: 48, responsive: "stack", alignItems: "center" })
text=I(hero, { type: "frame", width: "50%", layout: "vertical", gap: 16 })
img=I(hero, { type: "image", src: "...", width: "50%" })
```

**Tag list** (wraps to next line as the row narrows):

```js
tags=I("document", { type: "frame", layout: "horizontal", gap: 8, responsive: "wrap" })
// each tag: width: "fit-content", padding: [4, 12], cornerRadius: 999
```

**Toolbar** (never reflows):

```js
bar=I("document", { type: "frame", layout: "horizontal", gap: 16, responsive: "fixed", padding: 16, alignItems: "center" })
```

## Anti-patterns

- **Three fixed-pixel cards in a horizontal row.** `width: 360` × 3 in a row without `responsive: "stack"` clips on a 390px mobile viewport instead of reflowing. Either set `responsive: "stack"` or use `width: "100%", maxWidth: 360`.
- **Setting `margin` on every node.** Use `gap` on the parent flex container and `padding` on the child. The renderer doesn't surface `margin`.
- **Setting `fontFamily` on every text node.** The renderer defaults to a system sans-serif stack at the body level. Only set `fontFamily` when you want a *different* face — and prefer `system-ui, -apple-system, sans-serif`-style stacks; if you need quoted multi-word names (`'Segoe UI'`), they're supported, but keep them inside the double-quoted value.
- **Hardcoding pixel font sizes everywhere.** Large sizes get a `clamp()` treatment by the renderer to scale down on small viewports — only set `fontSize` to the *desktop* value and let the renderer handle the rest.
- **Unicode glyphs as icon stand-ins.** `✓ ● ▾ ○` read as unfinished. Use the `icon` node type — two sets render by name as inline SVG: 1,900+ [Lucide](https://lucide.dev) (`icon: "check"`) and 3,800+ [Material Symbols](https://fonts.google.com/icons) (`icon: "material:check"`, `iconStyle: "outlined" | "rounded" | "sharp"`, `-fill` suffix for filled variants). `I("parent", { type: "icon", icon: "material:check", iconSize: 16, iconColor: "$primary" })`. For Material-style design systems, prefer the Material set.
- **Baking uppercase into `content`.** Use `textTransform: "uppercase"` (with `letterSpacing` for tracking) so the underlying copy stays editable and case-styling lives in the design, not the data.
- **Faking form controls from frames + ellipses.** `toggle`, `checkbox`, `radio`, and `select` are real node types: `I("parent", { type: "toggle", checked: true })`. They style themselves from `$accent`/`$border`/`$bg-surface` tokens (neutral fallbacks when unthemed) and stay pixel-consistent; `fill`/`stroke`/`color` override.
- **Hand-building app furniture node by node.** A data table, form field, toolbar, stat card, or settings row is one `apply_structure` stamp: component-kind structures insert under any `targetId` with re-keyed IDs and return an `idMap` for populating. Stamp `data-table`, fill the placeholders, copy rows with `C()` — don't place ~80 nodes by hand.

## Design systems (workspace + project inheritance)

Design tokens (colors, spacing, radius, typography) can live at three levels — workspace, project, and canvas. At render time the renderer merges them with **the rightmost layer winning**:

```
workspace.designSystem ──┐
                         ├─→ merged tokens used to resolve $name references
project.designSystem    ──┤
                         │
canvas.variables        ──┘  (override layer)
```

Authoring rules:

- **Reach for workspace tokens before hex codes.** If you're working inside the `Coide` workspace, set the brand palette once via `workspace_set_design_system({ workspaceId, variables: { colors: { primary: "..." } } })`. Every canvas under that workspace can then reference `fill: "$primary"` and resolve to the brand value — no per-canvas redefinition.
- **Project layer is for sub-brand overrides.** A `Coide → Marketing` project might override `primary` with the marketing accent while inheriting everything else from the workspace.
- **Canvas-level variables are escape hatches**, not the primary surface. Use them when one canvas legitimately diverges from the design system; otherwise leave them empty and let the workspace tokens flow through.
- **Presets work at every layer.** `workspace_apply_preset({ workspaceId, preset: "dark" })` copies the dark-preset tokens into the workspace; `project_apply_preset` and the existing `apply_preset` (canvas-level) do the same at their respective layers.

Merge semantics are per-category: a project that only sets `colors` doesn't reset the workspace's `spacing`/`radius`/`typography`. A canvas that only overrides `colors.primary` keeps every other workspace color.

## Custom fonts

**Name the family and it loads.** Set `fontFamily` in a typography token (or on a node) and the renderer resolves it from Google Fonts automatically — at token-write time and again as a render-time backstop. Binaries are cached under `~/.framesmith/fonts/`, so after the first resolve, rendering is offline and deterministic. A family that can't be resolved degrades to the system fallback stack **with a warning in the tool result** — if a screenshot reports a font warning, act on it; the render is not showing the face you asked for.

```js
// This is the whole happy path — no set_fonts call needed:
workspace_set_design_system({
  workspaceId,
  variables: { typography: { body: { fontSize: 16, fontFamily: 'Inter' }, code: { fontSize: 13, fontFamily: 'JetBrains Mono' } } },
});
```

- **`typography.body.fontFamily` is the document default** (alias: `base`). Text nodes without an explicit `fontFamily` render in it — set it once at the workspace and the whole canvas follows.
- **`set_fonts` is for everything else:** non-Google sources (direct `.woff2`/`.ttf` binary URLs, `data:` URIs), explicit registration by name (`families: ["Inter"]`), or pasting a Google Fonts stylesheet URL (`fonts.googleapis.com/css2?...` — faces are extracted automatically).
- **`font-display: swap` is automatic.** Paint isn't blocked on slow fonts.
- **System families never resolve** (`system-ui`, `Roboto`, `Arial`, …) — they're already on every render's fallback stack. Only the first non-system family of a stack is loaded.

## Importing from implementation

A screen that already ships doesn't need redrawing — `canvas_import_html` (snippet + optional CSS) and `canvas_import_url` (live page) turn it into an editable, token-mapped canvas, and `canvas_sync_from_url` pixel-diffs the canvas against the live page later to catch drift.

**The report is the contract.** Imports are lossy by design; what makes them trustworthy is that they say exactly what happened. After every import, read:

- `report.snapped` — values rewritten to `$token` refs (Tailwind class intent like `bg-surface`, plus nearest-color matches against your design system). `literals` lists colors that found no token; near-ties are reported and left literal, never guessed. `scaleMatches` notes numbers that equal a scale token (gap 16 ≙ `$md`) — informational, since number-typed props can't hold refs.
- `report.layout` — how each container's **structure** was reconstructed: `table` (rows of proportional columns), `grid` (rows from the computed track template), `centered` (auto-margin/max-width content kept centered at its real width), `geometry` (multi-column CSS clustered from bounding boxes). A **`stack-fallback`** entry is your to-do list: that one container looked multi-column but couldn't be reconstructed confidently — fix it by hand; everything else arrived structurally correct, so **don't rebuild imported tables or grids node-by-node**.
- `report.warnings` / `unmatchedFonts` / `unmatchedIcons` — dropped background images, truncations, fonts and SVGs that didn't resolve.

Practical notes:

- **A bare Tailwind snippet has no Tailwind runtime.** The intent mapper covers the common utilities + the bundled v4 palette; pass the compiled stylesheet via `css` for everything else. Live URLs always have real CSS, so this only matters for pasted snippets.
- **Token snapping defaults to the target project's merged design system** — import into the right project and `tokenMatch` needs no configuration. Pass `tailwind: { theme }` to map custom utility names.
- **Auth for gated pages** (`auth.headers`/`cookies`) lives in a throwaway browser context and is never persisted.
- After importing: `screenshot` to review fidelity, fix what the report flagged, then the canvas is the design-of-record — wire `canvas_sync_from_url` into your workflow to keep it honest.

## After designing

- **`canvas_evaluate`** scores the design on 5 categories (spacing, color, typography, structure, consistency) and surfaces actionable issues with `nodeId` references. Use it in a generator-evaluator loop: `batch_design` → `canvas_evaluate` → fix the returned nodeIds.
- **`canvas_autofix`** runs `canvas_evaluate` internally and returns just the subset of issues that have a mechanically derived fix — off-scale spacing snaps to scale, missing layout becomes `vertical`, recoverable WCAG contrast failures get `#000` or `#FFF` based on background luminance. Each fix is a ready-to-paste `batch_design` Update op. Run those ops via `batch_design`, then re-evaluate — closes the loop without judgment calls on your part.
- **`canvas_evaluate` with `mode: "llm"`** runs fast-mode heuristics plus a vision-model critique against a **fixed rubric** (Claude or GPT-4.1, picked from env). Returns the heuristic result with an extra `llmCritique` field: five axes — **hierarchy, execution, specificity, restraint, variety** — each scored 1–5 with a rationale, plus a derived overall, `summary`, `suggestions`, and `needsRevision` / `failingAxes` (any axis below the `floor`, default 3). The verdict is stamped on the canvas + build log so quality is auditable over time. Use this for the "is this visually well-designed?" question heuristics can't answer — composition, hierarchy, polish. Costs one API call per run; reach for it after the heuristic score plateaus.
- **`canvas_revise`** closes the loop: it judges, and for any failing axis asks the model for targeted `batch_design` ops, applies them, and re-judges — up to `maxIterations` passes (1–3). It **mutates the canvas**, reverts any pass that doesn't improve the overall, and stops on pass / cap / no-improvement. Opt-in and costly (≥2 API calls per pass); reach for it when you want the model to act on its own critique instead of you hand-translating it.
- **`screenshot_responsive`** renders the same scene at mobile / tablet / desktop. Inspect all three; if `responsive` hints are set correctly the mobile layout will look right with no extra work.
- **`snapshot_layout`** returns computed bounding boxes — useful for asserting alignment or detecting overflow programmatically.

## Cliché & craft

`canvas_evaluate` scores craft (contrast, scale, structure) **and** a `cliche` category — the visual tells that read as machine-made. The bar is "designers say *wow*," not "competent": flat color and restraint beat effects. Steer away from these *before* you draw; the evaluator is the safety net, not the plan.

| Tell | What flags | Do this instead |
|---|---|---|
| **Default purple / indigo accent** | An accent (button, stroke, icon, accent text) in the indigo→violet band — especially the Tailwind defaults `#6366f1` / `#8b5cf6` / `#7c3aed` | Pick an accent that fits the brand — a considered blue, green, or warm hue. Set it once as a `$accent` token. |
| **Gradient / glow overuse** | 3+ gradient nodes, or a colored glow/bloom shadow (large blur + a saturated or translucent-white color) | Flat `$surface` fills. Reserve a gradient for at most one deliberate focal moment; use a subtle near-black low-alpha shadow, not a halo. |
| **Fake browser / OS chrome** | A row of ≥3 small circular dots (mac traffic lights) wrapping content | Frame the content directly. Skip the fake window — it adds nothing and dates the mockup. |
| **Hanging eyebrow header** | A small eyebrow/tag *beside* a large heading in a horizontal row | Stack the eyebrow **above** the heading (`layout: "vertical"`, left-aligned). |
| **Fabricated content** | Invented metrics / testimonials / brand logos in placeholder copy (`"99.9% uptime"`, `"— Jane Doe, CEO"`, `"TechCrunch"`) | Use a labeled placeholder until real data exists: `"Uptime — to confirm"` + a neutral block. Don't ship invented numbers. |
| **Eyebrow rhythm** | More eyebrow labels (small uppercase / letter-spaced text) than ~1 per 3 sections — an eyebrow above nearly every heading | Keep eyebrows rare (≤ `ceil(sections / 3)`). Let most headings stand alone; reserve the eyebrow for sections that genuinely need a kicker. |
| **Slop copy** | Stock AI phrasing in short copy — filler verbs (`"Elevate"`, `"Seamless"`, `"Unleash"`), scroll cues (`"Scroll to explore"`), placeholder names (`"Jane Doe"`), hype labels (`"BETA"`, `"Early access"`), section-number eyebrows (`"01 / Index"`) | Write specific, branded copy that names the concrete benefit. |
| **Radius consistency** | 4+ distinct corner radii across the page — no single radius system | Consolidate to one small radius scale (e.g. `8` / `12` / `999` for pills). Define it as a `$token` and reuse. |
| **Pure black / white** | `#000000` ink (text / icon / stroke / fill) or a `#ffffff` page background | Use a designed off-black (`#0A0A0A`) for ink and an off-white (`#FAFAFA`) for the page surface. |
| **Accent consistency** | 3+ competing saturated accent hues (excludes neutrals + the page background) | Pick **one** accent hue — plus neutrals and at most one status color. Set it once as `$accent`. |

- **`cliche` is advisory** — tells are `warning`/`info`, never a hard error; they dent the score, they don't block.
- **`canvas_autofix` fixes the mechanical ones** — it swaps a *known-default* purple accent, deletes a fake-chrome strip, and softens pure black (`#000000`) ink to off-black. Gradient/glow, the hanging header, fabricated copy, eyebrow rhythm, slop copy, mixed radius systems, and competing accents carry a suggestion but no op (taste/judgment calls).
- **Genre relaxes intentional tells** — pass `genre` (or stamp a preset via provenance) so a style that legitimately uses a tell isn't nagged. Today `genre: "material"` allows the purple accent **and** white elevated surfaces (both are intentional in Material Design).

## Sharp edges

A few operational details that aren't obvious from the tool schemas:

- **Scope to a repo with `init` (or `canvas_bind`) — binding re-keys IDs.** Binding rewrites every project/canvas ID to `repo-*` form, so IDs captured before the bind stop resolving. `init` binds and returns the fresh IDs in one call (prefer it); after a bare `canvas_bind`, re-list with `project_list` / `canvas_list`.
- **Record `batch_design`'s `nodeIds` map.** `batch_design` returns `{ ok, nodeIds, results }` where `nodeIds` maps each bound variable (`header=I(...)`) to the node ID it created. Bindings only live within a single call, so keep that map and target the real IDs in later calls rather than re-deriving them.
- **Typography `$tokens` resolve `.fontSize` only.** A `$heading` reference substitutes the token's font size; `fontWeight` / `fontFamily` / `lineHeight` on the token are *not* applied through the reference. Set those explicitly on the node alongside the `$token`.
- **Prefer the structured form for gradients & shadows.** `gradient: { type, angle?, stops: [...] }` and `shadows: [{ x, y, blur, spread?, color, inset? }]`. A raw CSS string is accepted too, but the structured form is canonical and diffs cleanly.
- **`import_design_md` is best-effort.** It reads tokens per heading section in list / table / `name: value` form (see the tool description for the exact accepted schema) and silently skips what it can't parse — colors deliberately reject shadow/gradient strings. Set anything it misses with `set_variables`. It honors explicit named spacing values and only synthesizes a scale from a stated `Base unit:` — it won't fabricate one otherwise.
- **`apply_preset` respects an inherited design system.** It won't overwrite tokens a canvas resolves through the workspace/project layers; those are reported as `preservedFromDesignSystem`. Pass them explicitly via `set_variables` if you actually want the preset's values.
