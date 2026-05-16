# Authoring Guidelines

How to design with canvas-mcp so the result holds up across breakpoints.

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

## After designing

- **`canvas_evaluate`** scores the design on 5 categories (spacing, color, typography, structure, consistency) and surfaces actionable issues with `nodeId` references. Use it in a generator-evaluator loop: `batch_design` → `canvas_evaluate` → fix the returned nodeIds.
- **`canvas_autofix`** runs `canvas_evaluate` internally and returns just the subset of issues that have a mechanically derived fix — off-scale spacing snaps to scale, missing layout becomes `vertical`, recoverable WCAG contrast failures get `#000` or `#FFF` based on background luminance. Each fix is a ready-to-paste `batch_design` Update op. Run those ops via `batch_design`, then re-evaluate — closes the loop without judgment calls on your part.
- **`canvas_evaluate` with `mode: "llm"`** runs fast-mode heuristics plus a vision-model critique (Claude or GPT-4.1, picked from env). Returns the heuristic result with an extra `llmCritique` field: holistic score, strengths, weaknesses, suggestions. Use this for the "is this visually well-designed?" question that the heuristics can't answer on their own — composition, hierarchy, polish. Costs one API call per run; reach for it after the heuristic score plateaus.
- **`screenshot_responsive`** renders the same scene at mobile / tablet / desktop. Inspect all three; if `responsive` hints are set correctly the mobile layout will look right with no extra work.
- **`snapshot_layout`** returns computed bounding boxes — useful for asserting alignment or detecting overflow programmatically.
