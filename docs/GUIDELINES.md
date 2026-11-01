# Authoring Guidelines

How to design with framesmith so the result holds up across breakpoints.

## Organizing work

Canvases live inside a `Workspace > Project > Canvas` hierarchy. The built-in `Personal` workspace + `Untitled` project always exist as a default home; create more once you're running multiple projects.

- **`workspace_create({ name })`** — top-level container (e.g. "Client work", "Personal").
- **`project_create({ workspaceId, name })`** — group related canvases inside a workspace.
- **`canvas_create({ name, projectId, width?, height?, type?, device? })`** — drops the canvas in the given project (defaults to Untitled). The artboard is 1440×900 unless you pass `width`/`height` (positive integers, each defaulting on its own). For a phone app screen pass `type: "mobile"` instead of sizing it by hand (see [Declaring the medium](#declaring-the-medium-web-or-mobile)).
- **`canvas_move({ canvasId, projectId })`** — reassign a canvas between projects.
- **`canvas_archive` / `canvas_unarchive`** — soft-delete: canvas stays on disk but hides from default listings. Reach for this when iterating; reach for `canvas_delete` (permanent) only when sure.

`workspace_delete` and `project_delete` refuse to remove non-empty containers. Clear the contents first or `canvas_move` them out.

## Two-line summary

1. **Author desktop-first at one design width.** Pick a width (1200 or 1440 is typical for a web page; a phone app screen is its own artboard, `canvas_create({ type: "mobile" })`), compose the design there.
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
| Height floor (`minHeight` instead of `height`) | A card or row whose content can grow under hostile-length text | A stat card that must hold its rest-state rhythm without clipping a long value |

**Default to fluid.** Reach for fixed pixel widths only when the content genuinely shouldn't scale.

**Artboard height is a viewport, not a limit.** The root's `height` sizes the default `screenshot` capture, but content taller than it is normal: it scrolls on a real page, and the root grows to hold it, keeping its own bottom padding past the last child and leaving every child its authored size. A root child with `height: "100%"` fills whatever its siblings leave of the artboard, and grows past it with taller content. (A root that sets `overflow` keeps the plain fixed height and clips or scrolls inside itself, per its value; a root `minHeight` is your own floor and replaces the growth.) Because the root grows, an `absolute` node with `bottom` set against the root measures from the end of the document, not the screen: use `position: "fixed"` to pin to the screen. To actually see past the artboard (a long page, a design that grew under stress content), pass `fullPage: true` to `screenshot` — or to `export`, which takes the same option — instead of editing the root height by hand.

## Declaring the medium (web or mobile)

A canvas declares what medium it is on, separately from its genre (what it is for) and its preset (what style it uses). The declaration selects a ruleset and the defaults the generators use. The declaration itself never changes a pixel: what renders comes only from the scene, so the artboard size and `safeArea` that `canvas_create` writes into the root are what change the render.

- **A phone app screen is `canvas_create({ type: "mobile" })`**, not a 390px-wide web canvas. It gets the device artboard (390×844 for the default `device: "iphone-390"`, the only profile today) and the root reserves the device's insets as `safeArea: { top: 47, bottom: 34 }`. An explicit `width` or `height` wins for that side; the insets and the device stay the profile's. Passing `device` without `type: "mobile"`, or an unknown device, is an error. `canvas_create` reports `type`, `typeSource` (`"declared"` or `"default"`), `device` and `safeArea`.
- **The renderer adds the insets to the root's own top and bottom padding**, at exact pixels even when the authored padding scales fluidly (padding of 32px or more), and the root's fill paints the bands, so in-flow content never sits under the status bar or the home indicator, on a short screen or a long one (the root grows with its content and keeps its bottom padding past it). A root with `padding: 24` starts its first child 71px down (24 + 47). `safeArea` is part of the root, so changing it moves the `versionHash`.
- **`type: "web"` is the default.** An undeclared canvas is judged as web and its evaluate result says `source: "default"`.
- **`canvas_set_type` re-declares an existing canvas** (`"web"`, `"mobile"`, or `null` to clear). It writes the declaration only, so it never moves the `versionHash`. It never resizes the artboard and never writes or removes `safeArea`, because either would reflow what you placed; clearing the type leaves the root as it is. When a mobile result has a `hint`, follow it: it names `U("document", { safeArea: { top: 47, bottom: 34 } })` when the root doesn't reserve both insets, and `U("document", { width: 390, height: 844 })` when the root is another size. Both ops change the render, so re-check the layout after them. State variants keep the type they were created with, so re-declaring a base does not reach them: the result's `variantsOutOfSync` lists each variant whose type now differs (`{ state, canvasId, type }`); declare those too.
- **`generate_design_system` on a mobile canvas** pivots the type scale on the device body size: 17px for every personality except `data-dense`, which uses 16px. An explicit `baseSize` wins. The result reports the generated pivot as `baseSize` and `baseSizeSource` (`"mobile"` for both mobile pivots, `"explicit"`, or `"personality"` on web). A `$body` inherited from a workspace or project design system is preserved by default and listed in `designSystemConflicts`; pass `preserveInherited: false` to take the mobile body.
- **Every evaluate result carries a `surface` report**: `{ type, device, source, rulesOn, rulesOff, conflicts }`. Each axis value (type, genre, preset) contributes a ruleset, and the active rules are their union. `rulesOn` and `rulesOff` name the rule ids the rulesets turned on and off. A rule both enabled and disabled stays on: it is listed in `rulesOn` and in `conflicts`, so composing declarations can never switch a guardrail off. On a web canvas `rulesOn` is `["mobile-artboard"]`; on a mobile canvas it lists every rule in [the mobile ruleset](#the-mobile-ruleset). No ruleset turns a rule off today.

## The mobile ruleset

On a `mobile` canvas these rules run. Each finding names its rule in a `rule` field, and the `surface` report lists the rules in `rulesOn`. Errors and warnings from these rules block the directive like any other finding, on every type; infos never do. Fast mode (`canvas_evaluate` with the default `mode: "fast"`) is what you run in the loop; before presenting a phone screen, also run `canvas_evaluate({ canvasId, mode: "detailed" })`, which checks rendered positions.

- **`mobile-touch-target`** (usability, **error**, −25 per target). A tap target below 44px in either dimension.
  - A control (toggle, checkbox, radio, select): the target extends to the control's row only when that row is a horizontal frame holding this one tappable (no other control or tappable primitive). A toggle in a 56px settings row passes; a lone checkbox inside a padded card is measured at its own size. To fix one, grow the control or put it alone in a horizontal row at least 44px tall.
  - The tappable primitives, each by its own box (an ancestor's padding never counts): a `button` (32 / 44 / 52 by `size`, or a larger `height` / `minHeight`; never narrower than tall), so `size: "sm"` is an error on a phone by design; a `list-row` (44, or 56 with a subtitle; a trailing toggle or chevron is part of the row, so the row is the target); each `tab-bar` tab (bar width ÷ slots × 49, where the bar width is its `width` or the artboard's, less 32 for `floating`, and the slots are the tabs plus one for a FAB) and the FAB (56); each `nav-bar` action (44×44). The defaults all pass.
  - Nodes inside a component instance are judged as they render, and the finding names the instance.
  - On web canvases the 24px error and the 44px phone-width info are unchanged, and primitives are not measured.
- **`mobile-handbuilt-target`** (usability, info). A frame shaped like a tap target (one icon, or one icon and a label of three words or fewer) whose box is below 44px. It never blocks, because a frame can't say it is decorative. If it is tappable, rebuild it as a `button` (or a `list-row` / `tab-bar` item when that is what it is).
- **`mobile-tab-bar`** (usability, warning, −10 per condition, one finding each). A `tab-bar` with fewer than 2 or more than 5 tabs (the FAB is not a tab; 2 is allowed, 3–5 is the comfortable range), a tab with no label, or a bar not pinned to the bottom (a `position` override, or any `y`).
- **`mobile-safe-area`** (usability, warning). Content under the status bar or the home indicator, or left under a pinned bar.
  - With `safeArea` on the root, the renderer reserves both insets. Pinned chrome (a `fixed` `status-bar`, `tab-bar` or `home-indicator`) can raise that reservation: each edge reserves the larger of (authored padding + inset) and the chrome's height plus its offset. The chrome's height already includes the inset, so with `safeArea` and a tab bar the bottom reservation is 83 (49 + 34), not 117; without `safeArea` the chrome still counts the default 47 / 34 insets. So in-flow content is safe, and fast mode checks positioned content only: `absolute`, `fixed`, and `sticky` (at its stuck `y`). A `fixed` node's `y` / `bottom` are measured from the screen's edges: keep its content at 47 or more from the top and 34 or more from the bottom.
  - Without `safeArea` (a canvas made mobile by `canvas_set_type`), the first content must clear 47px from the top and the last content 34px from the bottom, through padding, spacer frames, pinned chrome, or an in-flow `status-bar` (which spaces by its height). Content means text, icons, controls, buttons, list rows, nav bars, component instances, and images narrower than the artboard; a full-width image or a filled frame can sit under the status bar. So a full-bleed header is a frame whose fill runs to the top and whose first child is a 47px spacer frame. With root `safeArea` the root's fill paints the inset bands instead, so a header colour can't reach under the status bar.
  - A pinned bar you build (a `fixed` frame or button that is not chrome) must keep its own content out of the inset, and the scroll must clear it: the last content's clearance from the bottom of the document must reach the bar's height plus its `bottom` offset (for a bar pinned at a `y`, the first content's offset must reach its `y` plus its height). The finding names the spacer height to add at the end (or start) of the frame that holds your content, for the bar as it is: change the bar (its padding, its spacer) and re-evaluate, because the height it needs changes with it. Fast mode needs the bar's height: a numeric `height`, or padding plus primitives and fixed-height frames; a bar holding text gets an info that says to run detailed mode.
  - Padding of 32px or more scales down on a phone: it renders at its value × 390 / 1440, but never below a quarter of its value (min 8). So 48 renders 13 and 64 renders 17. A spacer frame of the inset's height is the exact way to clear an inset by hand.
  - A `sheet`'s content is never judged: it is an overlay the renderer pads past the home indicator.
  - Detailed mode checks rendered positions and is the authority: content in the top inset, positioned content in the screen's bottom inset, in-flow content in the last 34px of the document, sticky content where it sticks, and in-flow content under a bottom bar at the end of the scroll or under a top bar at the start. Fast mode cannot place absolute content inside an in-flow frame, or a `fixed` node inside a frame with `blur`, `backdropBlur`, `backdropFilter` or a slideUp / slideDown / scaleIn `animation` (CSS pins it to that frame, not the screen); it adds an info that says to run detailed mode.
- **`mobile-type-floor`** (typography, warning). Text below 11px; a text whose `fontSize` is `$body` and resolves below 16px; prose of five or more words below 13px. Long copy of twelve or more words at 13–15px is an info. Each text gets at most one finding, the first of these that applies. Words hold letters and no digits: figures and their units are not words, so a metrics line such as `5.2 mi · 1h 12m` is fine at 12px.
- **`mobile-one-column`** (usability, info). A horizontal or grid frame that sets prose side by side: two or more children each holding a text of eight or more words.
- **`mobile-artboard`** (structure; on for every type). A mobile canvas 500px or wider warns, and any other size than the device's is an info. An undeclared canvas narrower than 500px warns until you declare it, either way: `canvas_set_type({ type: "mobile" })` for a phone app screen (then follow its `hint`, which adds the root `safeArea`; for a new screen, `canvas_create({ type: "mobile" })` does both at once), or `canvas_set_type({ type: "web" })` for a web page designed at that width. A canvas declared `web` and narrower than 500px gets an info instead.

None of these rules has a mechanical fix, so `canvas_autofix` never proposes one. On a mobile canvas `canvas_stress` leaves strings of three characters or fewer (monograms, short labels) and the tab and nav-bar action labels (fixed vocabulary) out of `long-text`; `i18n` still lengthens tab and action labels, and a label hitting its designed ellipsis reports an `info`. Stress perturbs the primitives' own copy (`button.label`, `list-row.title` / `subtitle` / `trailing.text`, `nav-bar.title` and action labels, `tab-bar.items[].label`), and treats two or more consecutive sibling `list-row`s as a list for `empty` and `many`. It records the type it ran under; after a type change the evaluate result's `stress.current` is false. A `FRAGILE` verdict keeps blocking and the directive asks for a re-run; a stale `CLEAN` one just reads `current: false`.

## Mobile vocabulary (primitives and pinning)

Build phone screens from the mobile primitives, not hand-built frames. Each one carries its own size, hit area and colours (from `$accent`, `$border`, `$bg-surface`, `$text-primary`, `$text-secondary` and `$danger`, with neutral fallbacks on an unthemed canvas; `fill`, `stroke`, `color`, `iconColor`, `secondaryColor` and `badgeColor` override). None takes children except `sheet`. Labels truncate to one line with an ellipsis.

| Primitive | Props | Renders |
|---|---|---|
| `status-bar` | `time` (`"9:41"`), `appearance` (`"dark"` glyphs for a light screen, `"light"` for a dark one; default `color`) | Device chrome, pinned (`fixed`) to the top, as tall as the root's `safeArea.top` (47 without one) |
| `home-indicator` | `appearance` | The 134×5 pill, pinned to the bottom, as tall as `safeArea.bottom` (34) |
| `nav-bar` | `title`, `leading` (`{ icon?, label? }`, icon defaults to `chevron-left`), `trailing` (up to two `{ icon }` / `{ label }`), `largeTitle` | 44 tall in flow (96 with `largeTitle`: the 44px action row plus a 52px row holding a 34px bold title); every action is a 44×44 target |
| `tab-bar` | `items: [{ icon, label, active?, badge? }]`, `variant` (`standard` / `floating` / `fab`), `fab: { icon }` | Pinned to the bottom, 49 plus the bottom inset (`safeArea.bottom`, 34 without one); `floating` is an inset pill; `fab` adds a raised 56px centre action (16px more box), which is not a tab |
| `button` | `label`, `icon`, `iconPosition`, `variant` (`primary` / `secondary` / `ghost` / `destructive`), `size` (`sm` 32 / `md` 44 / `lg` 52), `disabled` | Never narrower than tall; icon-only is square; `width: "100%"` for a full-width CTA. `sm` is for pointer surfaces and is an error on a phone |
| `list-row` | `title`, `subtitle`, `leading` (`{ icon }` / `{ initials }` / `{ image }`), `trailing` (`{ text }` / `{ chevron: true }` / `{ toggle: true }` / `{ badge }`), `divider` | 44 tall (56 with a subtitle), spanning its list. Repeated rows count as reuse |
| `sheet` | `detent` (`medium` / `large` / `auto`), `grabber` (default true), `padding`, `gap`, children | A bottom sheet over a dimmed scrim, padded past the home indicator; its children scroll inside it |

**Pinning.** `position: "fixed"` pins a node to the screen: the root's width × height is the viewport, and content taller than it scrolls. `y` / `bottom` measure from the screen's top / bottom, `x` / `right` from the root's edges. A fixed node with no `x`, `right` or `width` spans the root's column; with no `y` or `bottom` it sticks to the top. `position: "sticky"` sticks at its `y` (or `bottom`) while its container scrolls. The chrome primitives default to fixed; override their `position` only for a deliberate composition (a `status-bar` set to `absolute` lets a full-bleed hero image run under it). The renderer raises the root's top and bottom padding to at least the reach of any pinned `status-bar`, `tab-bar` or `home-indicator`, so content never starts or ends under chrome. A fixed node inside a frame with `blur`, `backdropBlur`, `backdropFilter` or a slideUp / slideDown / scaleIn `animation` pins to that frame instead (CSS), so keep pinned bars out of them. `fullPage` captures grow to the content, so a bottom-pinned bar lands at the end of the image.

**A pinned CTA bar** is not chrome, so it reserves nothing by itself. Build it as a `fixed` frame at `bottom: 0` with padding under 32 (larger padding renders smaller on a phone) and a 34px spacer frame as its last child, so its button clears the home indicator. Then end the frame that holds your content with a spacer as tall as the bar, so the last row scrolls clear of it. `mobile-safe-area` names the height when it is short:

```
list=I("document", { type: "frame", layout: "vertical" })
I(list, { type: "list-row", title: "Subtotal", trailing: { text: "$42.00" } })
I(list, { type: "frame", name: "Bar spacer", height: 68 })
bar=I("document", { type: "frame", position: "fixed", bottom: 0, layout: "vertical", padding: [12, 16, 12, 16], fill: "$bg-surface" })
I(bar, { type: "button", label: "Pay", width: "100%" })
I(bar, { type: "frame", height: 34 })
```

The bar is 12 + 44 + 34 + 12 = 102px tall; the root's `safeArea` reserves 34, so the content frame's spacer adds the other 68.

## Starting a phone screen (mobile realisations)

A structure realises an **anatomy** (a screen kind) for one canvas type. On a mobile canvas, `apply_structure` resolves an anatomy name to its mobile realisation, so `apply_structure({ canvasId, structure: "dashboard" })` stamps `dashboard-mobile`; the result's `applied`, `anatomy` and `surface` say what was stamped. Six anatomies have a mobile realisation:

| Anatomy | Mobile realisation | Shape |
|---|---|---|
| `dashboard` | `dashboard-mobile` | Large-title nav bar, a headline metric card, a two-up stat row, a recent list of rows, a pinned four-tab bar |
| `settings` | `settings-mobile` | Grouped list rows (toggles, values, chevrons) and a destructive sign-out button |
| `auth` | `auth-mobile` | Title, two fields, and the primary and secondary buttons held at the bottom of the screen |
| `onboarding` | `onboarding-mobile` | One page of a paged flow: skip, glyph, heading, body, page dots, a full-width continue |
| `feed` | `feed-mobile` | A full-bleed list of rows (monogram, title, preview, time) and a pinned four-tab bar |
| `detail` | `detail-mobile` | Back nav bar, media slot, title, body, an attribute list, and a primary action pinned over the home indicator |

Every one starts with a `status-bar`, ends with a `home-indicator` or a pinned `tab-bar`, and builds every tap target from a primitive, so it passes the mobile ruleset in fast and detailed mode and survives `canvas_stress`. Adapt it like any scaffold: the result's `placeholders` include each primitive's copy, with `prop` naming the field (`U("dm-row-1", { title: "Morning run" })`, `U("amb-submit", { label: "Sign in" })`).

- **Use `generate_design_system` for a phone's type**, then stamp. The built-in presets set a 14–15px `$body`, which `mobile-type-floor` flags on a phone whatever the layout.
- **`list_structures({ canvasId })`** lists what stamps on that canvas: on a phone, the six realisations and the components marked for every type (`form-field`, `stat-card`, `empty-state`, `skeleton-card`, `skeleton-stat-card`, `kpi-card`, `status-chip`, `initials-avatar`). Each entry names its `anatomy`, its `surface` (`web`, `mobile` or `any`) and `surfaces`, the types its anatomy is realised on.
- **A name with no realisation for the canvas's type is refused**, with the anatomies that have one: `pricing` on a phone, or a web-only component such as `data-table` (its 28px pager buttons are hand-built). `realisation: "web"` stamps the web one anyway, and `realisation: "mobile"` stamps a mobile one on a web canvas.
- **The realisations never write `safeArea`.** Their pinned chrome makes the renderer reserve the insets, so they are also correct on a canvas made mobile with `canvas_set_type`.

## Responsive hints

Set `responsive` on **container nodes** (frames with `layout: "horizontal"` or `layout: "grid"` and children). The renderer emits the right media-query rules — flex-wrap for horizontal containers, a single-column collapse with spans reset for grid.

| Hint | Effect | Use when |
|---|---|---|
| `responsive: "stack"` | Horizontal container flips to vertical below 768px; a `grid` container collapses to one column (spans reset) | Multi-column rows that should become a single column on mobile. **This is the most common case** — almost every card row, hero with side-by-side panels, footer link group |
| `responsive: "wrap"` | Children wrap to the next line instead of overflowing | Tag clouds, badge groups, card grids that can have an irregular last row |

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

**Bento grid** (real CSS grid — spans make the asymmetric rhythm; stacks on mobile):

```js
grid=I("document", { type: "frame", layout: "grid", gridColumns: 4, gap: 24, responsive: "stack" })
hero=I(grid, { type: "frame", gridColumn: 3, height: 280, width: "100%", padding: 24, fill: "$bg-surface", cornerRadius: 16 })
side=I(grid, { type: "frame", height: 280, width: "100%", padding: 24, fill: "$bg-surface", cornerRadius: 16 })
// ...three more tiles; a gridColumn: 2 tile closes the second row
```

`gridColumns` takes a count, an array of fr weights / lengths (`[2, 1, "240px"]`), or a template string; a numeric `gridColumn`/`gridRow` means "span N". Prefer grid over nested-flex approximation whenever tiles span columns — the `bento-grid` structure stamps this shape ready-made.

**Toolbar** (never reflows):

```js
bar=I("document", { type: "frame", layout: "horizontal", gap: 16, padding: 16, alignItems: "center" })
```

### Charts (data in, SVG out)

The `chart` node owns the value→coordinate math — give it data and domains, never hand-computed path `d` strings or absolutely-positioned tick labels:

- **One node per chart, multi-series inside.** `series: [{ data, stroke, strokeDasharray?, area?, points? }]` — the 4-series pace-to-goal chart is one node with a shared scale.
- **Dash is the convention for projected vs actual.** Solid accent line + `strokeDasharray: "6 4"` reference/forecast lines — don't differentiate similar lines by colour alone.
- **X positions are data indexes.** A 7-point booked series against a 12-point target series stops at 7/12 of the width automatically; `xDomain`/`yDomain` default from the data (bars floor at 0).
- **Furniture is opt-in props**: `gridlines: 4`, `xLabels`/`yLabels` (spread evenly; empty strings skip intermediate ticks), `curve: "smooth"`, `kind: "bar"` for grouped bars.
- **Editing a data point is a one-prop edit** — update the series array, done.
- **Bar emphasis is a prop, not a rebuild.** `highlight: [11]` (or just `highlight: 11`) on a bar series renders the selected bar solid while the rest go muted (~30%) — an entry that isn't an index into `data` emphasizes nothing, and the `batch_design` op result warns about it; add `barGradient: true` and the muted bars fade vertically inside the SVG — invisible to the gradient-overuse tell by construction. The floating tooltip card stays your composition (`position: "absolute"` frame with `$elevation.floating`).
- **Donuts are data-bound.** `kind: "donut"` + `segments: [{ value: 385, color: "$chart-1", label: "North" }, …]` + `innerRatio?` + `centerValue`/`centerLabel` — slices run clockwise from 12 o'clock, the center figure renders tabular and bold. Compose the legend yourself: rows of `$chart-*` dots + labels + values (legend layout is design, not charting). Never fake a ring with conic gradients.
- **Sparklines are the KPI-card mini-trend.** `kind: "sparkline"` (+ `sparkKind: "bar" | "line"`) — axis-free, tick-free, latest point emphasized by default (`series.highlight` overrides). Never hand-place 4px bars.

## Anti-patterns

- **Three fixed-pixel cards in a horizontal row.** `width: 360` × 3 in a row without `responsive: "stack"` clips on a 390px mobile viewport instead of reflowing. Either set `responsive: "stack"` or use `width: "100%", maxWidth: 360`.
- **Setting `margin` on every node.** Use `gap` on the parent flex container and `padding` on the child. The renderer doesn't surface `margin`.
- **Setting `fontFamily` on every text node.** The renderer defaults to a system sans-serif stack at the body level. Only set `fontFamily` when you want a *different* face — and prefer `system-ui, -apple-system, sans-serif`-style stacks; if you need quoted multi-word names (`'Segoe UI'`), they're supported, but keep them inside the double-quoted value.
- **Hardcoding pixel font sizes everywhere.** Large sizes get a `clamp()` treatment by the renderer to scale down on small viewports — only set `fontSize` to the *desktop* value and let the renderer handle the rest.
- **Unicode glyphs as icon stand-ins.** `✓ ● ▾ ○` read as unfinished. Use the `icon` node type — two sets render by name as inline SVG: 1,900+ [Lucide](https://lucide.dev) (`icon: "check"`) and 3,800+ [Material Symbols](https://fonts.google.com/icons) (`icon: "material:check"`, `iconStyle: "outlined" | "rounded" | "sharp"`, `-fill` suffix for filled variants). `I("parent", { type: "icon", icon: "material:check", iconSize: 16, iconColor: "$primary" })`. For Material-style design systems, prefer the Material set.
- **Spelling an icon in the other set's style.** Lucide hyphenates multi-word names (`chevron-right`); Material Symbols keeps underscores and needs the prefix (`material:chevron_right`, `material:chevron_right-fill`). A bare `chevron_right` is looked up in Lucide and renders nothing. A name that resolves in neither set renders an empty slot, so `canvas_evaluate` reports it as a `structure` warning naming the spellings that do resolve — and `canvas_autofix` rewrites it when exactly one does.
- **Baking uppercase into `content`.** Use `textTransform: "uppercase"` (with `letterSpacing` for tracking) so the underlying copy stays editable and case-styling lives in the design, not the data.
- **Faking form controls from frames + ellipses.** `toggle`, `checkbox`, `radio`, and `select` are real node types: `I("parent", { type: "toggle", checked: true })`. They style themselves from `$accent`/`$border`/`$bg-surface` tokens (neutral fallbacks when unthemed) and stay pixel-consistent; `fill`/`stroke`/`color` override.
- **Faking loading states from plain gray rectangles.** Use `{ type: "skeleton" }` — token-derived fill, correct default radius, and it pulses in the live viewer (always static in screenshots/exports so diffs stay deterministic). Stamp `skeleton-table` / `skeleton-card` / `skeleton-stat-card` instead of hand-placing bars — and skeleton EVERY data surface: the coverage check flags a loading variant that leaves live metric values beside skeletoned regions (a half-designed loading screen flashes real-looking data next to placeholders).
- **Hand-building app furniture node by node.** A data table, form field, toolbar, stat card, or settings row is one `apply_structure` stamp: component-kind structures insert under any `targetId` with re-keyed IDs and return an `idMap` for populating. Stamp `data-table`, fill the placeholders, copy rows with `C()` — don't place ~90 nodes by hand.

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
- **Start the look with one call — `generate_design_system`.** `generate_design_system({ seed: "#0E7490", personality: "technical", workspaceId })` writes the complete design language: the color system, a curated font pairing (real faces load from the first screenshot), typography **roles** (`$display` / `$heading` / `$title` / `$body` / `$label` / `$caption`, plus `$figures` with a mono face), a radius and density stance, `$elevation.flat|raised|floating|overlay` depth tokens (the dark layer re-states each depth so it reads on dark surfaces — reference as `shadow: "$elevation.raised"`), and `$motion` defaults. The personality is **required** and is a real design stance: `technical` (crisp product tool), `editorial` (serif voice, generous air), `soft` (rounded, warm), `data-dense` (instrument-panel density). Same seed, different personality = visibly different product. The two generators below regenerate just one part.
- **Don't hand-pick a type scale — generate one.** `generate_scale({ ratio: "major-third", workspaceId })` derives a full `text-xs`…`text-3xl` scale plus a paired `space-3xs`…`space-3xl` scale from a named ratio (`minor-second` 1.125, `major-second` 1.2, `minor-third` 1.25, `major-third` 1.333, `perfect-fourth` 1.5, `golden` 1.618 — or any number), with the craft defaults (line-height bands, display tracking) baked in and sizes pinned against the ratio check. Pass `fluid: {}` for Utopia-style `clamp()` sizes that interpolate between viewports instead of static px.
- **Don't eyeball a palette from ten hexes — generate one.** `generate_color_system({ seed: "#2563EB", workspaceId })` derives OKLCH `primary-50`…`900` + a matched neutral ramp + status colors + the `bg-surface`/`text-primary`/`accent`/… semantic tokens the structures already speak, with every text/surface pair AA-clean by construction. Status colors (`success`/`warning`/`danger`) are tuned as TEXT — each is darkened from its hue's band until it clears AA (4.5:1) against white, so a `$danger` validation message is legible, not just legible-adjacent. It also derives the color range — a `$chart-1`…`$chart-6` categorical series palette and the `-tint` layer for chips/tiles/badges — see "Designing with character" below.
- **It ships a dark theme too.** The dark mapping lands in a sparse `dark.colors` override layer alongside the light tokens (or set one by hand via `set_variables`, which also accepts `dark.elevation` for depth-token overrides) — status colors get a second, dark-specific pass here so they clear AA against the dark surface as well. Render it with `theme: "dark"` on `screenshot` / `screenshot_responsive` / `export`; `canvas_evaluate`'s `color` category then contrast-checks both themes automatically and scores the worse one — dark-run failures point at the dark token layer (a node literal would break light). WCAG 2.2 is the gate; **APCA** Lc values appear as info-only advisories on perceptually weak pairs (APCA is a candidate method, not a standard — it never blocks).
- **Give motion the same treatment as color and type.** Declare `motion` tokens via `set_variables` (`{ fast: { duration: 150, easing: "ease-out" } }`) and reference them as `transition: "$motion.<name>"` — ad-hoc duration/easing pairs sprawling across a canvas with no declared motion tokens get an advisory.

Merge semantics are per-category: a project that only sets `colors` doesn't reset the workspace's `spacing`/`radius`/`typography`. A canvas that only overrides `colors.primary` keeps every other workspace color.

## Designing with character

A design language is a set of COMMITTED choices, and `generate_design_system` makes them for you — your job is to spend them well.

**Pick the personality like a genre, not a mood.** `technical` for developer tools, admin panels, and B2B products (crisp geometry, tight tracking, quick motion). `editorial` for marketing and content (a serif display voice, generous air, near-sharp corners). `soft` for consumer products and onboarding (rounded, warm, springy). `data-dense` for dashboards, tables, and monitoring (a 13px pivot, a mono `$figures` role for numbers, near-flat depth). Same seed, different personality = a visibly different product — so choose deliberately and stay with it across the project.

**Spend the accent in one confident moment per screen.** The generated system keeps the accent AA-safe everywhere, but discipline is what makes it read as designed: one primary action, one active nav item, one focal chart series. If the accent appears in more than a few places, everything reads as equally important, which is the same as nothing being important. (The accent-consistency tell catches competing hues; restraint within ONE hue is on you.) Status colours are exempt when referenced as tokens: `$success` / `$warning` / `$danger` are the system's status vocabulary, not competing accents, so a screen can show savings in green, a destructive action in red and a low-stock note in amber without flagging (the same literals still count — nothing declares a raw `#22c55e` to be a status colour).

**Use elevation as meaning, not decoration.** `$elevation.flat` for resting cards, `raised` for the one surface that should come forward (the active card, a dropdown), `floating` for menus and popovers, `overlay` for modals. A screen where everything is raised is flat again. The dark layer re-states each depth automatically — never hand-tune shadows per theme.

**Let the roles do the typography.** `$title` for the screen title, `$heading` for section heads, `$body` for prose, `$label` for control and form labels, `$caption` for metadata, `$figures` (when the personality ships one) for numbers that deserve tabular alignment. The roles carry the personality's face, weight, and tracking — a screen that references roles re-voices itself when the personality changes; a screen full of literal font sizes doesn't.

**Stamp the micro-patterns, don't hand-build them.** `kpi-card`, `status-chip`, `segmented-control`, `breadcrumb`, and `initials-avatar` are component structures — one stamp each, already on the tint pair and the chart vocabulary, customized via the returned idMap. The dashboard structure's stat cards ARE kpi-cards.

**Chips, tiles, and pills use the tint pair.** Every soft-colored surface — a status chip, a KPI card's icon tile, a pill badge, an initials avatar — is `fill: "$success-tint"` (or `accent-tint` / `warning-tint` / `danger-tint` / `neutral-tint`) with its BASE color as the ink: `color: "$success"`. The pair is AA by construction in both themes; hand-mixed pastel + hex ink combinations are exactly the thing this layer exists to end. Chart series and legend dots take `$chart-1`…`$chart-6` — hue-walked from the seed, distinct, and safe on both surfaces. The cliché tells recognize this vocabulary: a violet referenced through `$chart-*` or `$*-tint` never flags (a literal violet still does), and uppercase KPI labels beside big tabular figures don't count as eyebrows — the evaluator knows a metric label from a section eyebrow.

**Motion comes from tokens.** `transition: "$motion.fast"` for hover/focus feedback, `"$motion.base"` for state changes, `"$motion.slow"` for surfaces entering/leaving. The personality sets the temperament; scattering literal millisecond values breaks it.

## Components & reuse

**Shared chrome is a component, not a copy-paste.** When the same chunk exists (or is about to exist) twice — an app shell, a stat card, a table row — promote it and instance it instead of re-authoring:

1. Build it once, **name the parts you'll vary** (`name: "Title"`, `name: "ActiveNav"`).
2. `create_component({ canvasId, nodeId })` — the subtree becomes a component and an `instance` replaces it, render-identical. The result's `overridableChildren` lists what you can override.
3. Stamp more copies: `I("parent", { type: "instance", componentId, overrides: { "Title": { content: "Settings" } } })` — overrides match def children **by name**; instance-level props (width, opacity) override the def root.
4. Cross-canvas: `copy_nodes({ fromCanvasId, nodeIds: [instanceId], toCanvasId })` — the component def travels with the copy, so 15 sibling screens share one shell definition.

`canvas_evaluate`'s "no component instances found" advisory is the nudge; these two tools are the action. Current sharp edge: `batch_design` ops address the **tree**, so they can't edit a def after promotion — a def child's id no longer resolves (those nodes left the tree), and `U(instanceId, ...)` sets instance-level props, not the def. To revise a component: build the new version as a plain subtree, `create_component` it, point instances at the new `componentId` with `U()`, and delete the scaffold.

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
- **`"mono"` and `"sans"` are generic shorthands.** They render as CSS `monospace` / `sans-serif` — no registration, no network, never warned. Upgrade one to a real face anytime: `set_fonts({ fonts: [{ family: "mono", url: "<JetBrains Mono css2 URL>" }] })` — the label you pass is what gets registered, so existing `fontFamily: "mono"` nodes pick up the real face with no edits.
- **`set_fonts` is for everything else:** non-Google sources (direct `.woff2`/`.ttf` binary URLs, `data:` URIs), explicit registration by name (`families: ["Inter"]`), or pasting a Google Fonts stylesheet URL (`fonts.googleapis.com/css2?...` — faces are extracted automatically and registered under **your** `family` label; the result's `aliased` field shows the mapping).
- **Typos surface at write time.** `batch_design` warns when a call writes a `fontFamily` that is neither cached, registered, nor a system/generic family — don't wait three renders to notice `"JetBrans Mono"`.
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
- After importing: `screenshot` to review fidelity, fix what the report flagged, then the canvas is the design-of-record — the next section is how it stays one.

## Keeping the design honest (gate integrity)

A canvas that describes a shipped screen is a **contract**, and contracts rot silently: the code evolves, nobody re-compares, and one day the canvas shows a column that no longer exists or a radio group that shipped as a select. If approved canvases can silently stop describing reality, "approved" stops meaning anything. Three tools keep the contract falsifiable — split by the question they answer:

| Question | Tool |
|---|---|
| *What* structurally diverged? | `canvas_check_drift` — findings in words: `missing-in-page`, `missing-in-canvas`, `control-mismatch`, `table-mismatch` |
| *How much* does it look different? | `canvas_sync_from_url` — pixel diff + `changePercent` |
| Is a recorded approval still true? | `canvas_version` — content `versionHash` + `expectedHash` check |

**Before designing on an existing canvas that describes a shipped view, run `canvas_check_drift` against the live route.** Designing on a drifted canvas means faithfully restyling a fiction. On findings, reconcile **deliberately** — one of three moves, never a fourth:

1. **The page is right** → update the canvas (`batch_design`, or re-import the changed region with `canvas_import_url`).
2. **The canvas is right** → flag the implementation gap to the user; don't "fix" the canvas to match a bug.
3. **Unclear which** → surface the difference and ask.

Never silently annotate the difference away — that's how a select shipped against an approved radio group and the approval stayed green.

**Approvals bind to a hash, not a name.** Record `{ canvasId, versionHash }` (from `canvas_version` or any `canvas_list` row) wherever your approval records live — a YAML file, a PR comment; the workflow is yours. The hash covers design content only (tree + the **whole resolved token set** — workspace → project → canvas — + components + fonts), so feedback arriving, critique stamps, and provenance changes never invalidate an approval; an actual design change does. Because the token set is hashed whole, **any** edit to an inherited workspace/project design system invalidates the approval of every canvas under it, even a token that canvas doesn't use (only a token the canvas overrides itself is exempt). That errs on the safe side on purpose — some tokens are read without being named on the canvas — so expect a design-system edit to mean re-recording approvals. Check later with `expectedHash`, or headlessly from a hook:

```bash
npx framesmith verify kpi-revenue-driver-control --hash sha256r:3f9a1c7e5b2d8046 --project-dir .
```

**A gate must treat a missing hash — `verify` exits 2 without `--hash` — as a failure, never a skip:** "never approved" is not "approved and unchanged". A legacy `sha256:` hash still checks but carries a `warning` (it covered only the canvas's own tokens, so it can't see inherited design-system edits) — re-record it as the current `sha256r:` `versionHash`.

**Make CI demand the comparison** — drift that waits for a human to notice is drift that ships. A post-deploy job per route ↔ canvas pair:

```bash
npx framesmith check-drift admin-stream-types --url "$STAGING_URL/admin/stream_types" --project-dir . --json
```

Exit codes are gate-friendly for both commands: `0` pass, `1` drift/mismatch, `2` error. `verify` is Chrome-free (pre-commit fast); `check-drift` needs Chrome and takes `--viewport WxH` / `--selector` / `--wait-for` for JS-rendered pages. Gated pages (auth) stay on the MCP tool — credentials don't belong in shell history.

## After designing

- **`canvas_evaluate`** scores the design on 8 categories (spacing, color, typography, structure, consistency, cliche, coverage, usability) and surfaces actionable issues with `nodeId` references — see "Design every state" below for what `coverage` demands. The `usability` category holds the mechanical UX floors beyond contrast: a control below the 24px hit-target floor is an **error** (WCAG 2.5.8 — a lone control inherits its padded row's box, so real settings rows pass; on a canvas declared mobile the floor is 44px instead, `mobile-touch-target` in [the mobile ruleset](#the-mobile-ruleset)), an unlabeled control is a warning, and vague action copy ("Click here") is an info. The `structure` category also warns — directive-blocking — on unknown icon names (an empty slot in the render). Controls also render with accent-derived `:focus-visible` rings in the live viewer — screenshots stay byte-identical because nothing is focused in a static capture. Use it in a generator-evaluator loop: `batch_design` → `canvas_evaluate` → fix the returned nodeIds.
- **`canvas_autofix`** runs `canvas_evaluate` internally and returns just the subset of issues that have a mechanically derived fix — off-scale spacing snaps to scale (`gap`, scalar padding, and array padding via a whole-array snap), missing layout becomes `vertical`, recoverable WCAG contrast failures get `#000` or `#FFF` based on background luminance, and an unknown icon name with exactly one resolving spelling is rewritten to it. Pass `apply: true` to write every fix in the same call (the result reports applied/failed per op), or run the returned ops via `batch_design` yourself — either way, re-evaluate after. Closes the loop without judgment calls on your part.
- **`canvas_evaluate` with `mode: "llm"`** runs fast-mode heuristics plus a vision-model critique against a **fixed rubric** (Claude or GPT-4.1, picked from env). Returns the heuristic result with an extra `llmCritique` field: five axes — **hierarchy, execution, specificity, restraint, variety** — each scored 1–5 with a rationale, plus a derived overall, `summary`, `suggestions`, and `needsRevision` / `failingAxes` (any axis below the `floor`, default 3). The verdict is stamped on the canvas + build log so quality is auditable over time. Use this for the "is this visually well-designed?" question heuristics can't answer — composition, hierarchy, polish. Costs one API call per run; reach for it after the heuristic score plateaus.
- **`canvas_revise`** closes the loop: it judges, and for any failing axis asks the model for targeted `batch_design` ops, applies them, and re-judges — up to `maxIterations` passes (1–3). It **mutates the canvas**, reverts any pass that doesn't improve the overall, and stops on pass / cap / no-improvement. Opt-in and costly (≥2 API calls per pass); reach for it when you want the model to act on its own critique instead of you hand-translating it. It never gates presenting: if it stops with axes still failing, present and name them.
- **`screenshot_responsive`** renders the same scene at mobile / tablet / desktop. Inspect all three; if `responsive` hints are set correctly the mobile layout will look right with no extra work.
- **`snapshot_layout`** returns computed bounding boxes — useful for asserting alignment or detecting overflow programmatically.
- **The human can point.** The user leaves comments by toggling Comment mode in the viewer and clicking any element — no prose archaeology about which card they meant. `get_feedback` returns those comments (each with a node snapshot — type / name / text — so you can act without extra lookups; `orphaned: true` means the node is gone but the concern likely still applies to its replacement). Check it whenever you pick up an existing canvas — feedback may have arrived while you were away, and the running server picks up viewer-written comments automatically. **Open feedback blocks presenting**, exactly like open inspector comments: address every item, then close each with `resolve_feedback` and a one-line note saying what changed — the note is your reply to the user, shown in the viewer's Feedback tab. You won't miss waiting comments: `canvas_list` rows and `canvas_evaluate` results carry an `openFeedback` count (the evaluate directive stays blocking while any are open), and `init` reports the workspace total at session start.

## Design every state (and survive every string)

The happy path of one static frame with ideal data is half a design. Real UX lives in the empty table, the loading skeleton, the failed form — and in the name that's too long for its cell. framesmith makes both halves enforceable.

**States are sibling canvases, one call each.** `canvas_add_variant({ canvasId, state })` clones the screen into a linked variant (`<base> · empty`), returning an `idMap` so you can immediately target the cloned nodes: delete the data rows, stamp the matching scaffold, adjust copy. The scaffolds make each state a stamp, not a rebuild:

| State | Scaffold | Notes |
|---|---|---|
| `empty` | `empty-state` | Icon + title + one-line hint + CTA — an empty screen is a first-run experience, never a bare void |
| `loading` | `skeleton-table` / `skeleton-card` / `skeleton-stat-card` | Real header + `skeleton` blocks matching the loaded geometry, so content lands without layout shift. Skeletons pulse only in the live viewer — screenshots stay static |
| `error` | — | The form's validation-failure treatment: field messages + a summary. Design it; there's no generic scaffold because error copy is the design |

**The evaluator demands them.** The `coverage` category warns — directive-blocking — when a base canvas carries data-bearing content with no designed states: a detected table demands `empty` + `loading`; a form (3+ input controls) demands `error`. (Table detection requires three matching horizontal rows — two stacked rows are a layout, not data — so the rare header-plus-one-row table goes undetected; name the frame `Table` to claim the shape explicitly.) Variant canvases and non-data screens are silent. The result's `coverage: { dataBearing, states, missing }` tells you where you stand, and `canvas_list` shows the designed states per screen.

**Then stress it.** `canvas_stress` re-renders the canvas under hostile-but-realistic content — `long-text` (×2.2 + an unbroken German compound), `i18n` (×1.4), `big-numbers` (`9` → `999+`, `$1.5M` → `$1,520,847.33`), `empty`, `many` (rows ×3) — and reports what broke, by node id: `clip` (info when a designed ellipsis is doing its job, or when it's a primitive's label hitting its designed ellipsis, or a root with an authored `overflow` clipping or scrolling inside itself; a sheet's own vertical overflow scrolls and is never a clip; warning otherwise), `overflow-x`, `layout-shift` (an untouched node ballooning — perturbed nodes, their ancestors, and a stretch sibling that merely follows a legitimately growing parent, like a full-height sidebar next to a growing table, are all exempt). Only *new* breakage counts. Fix findings with the [width strategies](#width-strategies) above — fluid widths, `minWidth` or `minHeight` floors, wrapping — or give a must-stay-single-line label `textOverflow: "ellipsis"` (the designed-truncation property: the clip downgrades to info because truncating is the design) — and re-run until `CLEAN`. A data screen goes to the user with its states designed and a `CLEAN` stress verdict, the same way it goes with a >95 score. `canvas_evaluate` holds you to it: once stress has recorded a verdict, the evaluate result carries a `stress` field (`{ verdict, warnings, type, current }` — `current` is false after an edit or a type change since the run), and a `FRAGILE` verdict keeps the directive `NOT READY` until a full `CLEAN` run (all five perturbations) replaces it — a subset run can record `FRAGILE` but never clear it. The verdict lives in server memory, so a restart forgets it.

## Reviewing the set

A product is a set of screens, and two whole classes of quality only exist at that level. When a multi-screen module feels done, review it as one:

**`project_evaluate({ projectId })`** rolls up per-screen scores (with designed/missing states and token adoption) plus the cross-screen findings no single canvas can see:

| Finding | What it means | The fix path |
|---|---|---|
| `radius-drift` | One screen runs a different corner-radius system than the rest | Align to the shared scale, or declare radius tokens |
| `accent-drift` | One screen's accent hue sits far from the project's dominant one | Point it at the shared `$accent` (or `generate_color_system` once at the workspace) |
| `token-adoption` | One screen styles by hand while the rest reference tokens | The consistency lint lists the exact literals; `canvas_autofix` re-attaches unique matches |
| `copied-chrome` | The same shell hand-copied across screens instead of component instances | `create_component` on one, stamp instances, `copy_nodes` to siblings |
| `state-coverage` | The aggregated missing empty/loading/error table | `canvas_add_variant` + the state scaffolds, one screen at a time |

**This roll-up is advisory — it never gates.** Only the per-canvas directives (score, coverage, feedback) block presenting; the roll-up reviews coherence and names its evidence (which canvases, which values) so a human can overrule any finding at a glance.

**`mode: "llm"` adds the flow critique**: up to 8 screens rendered and judged *together* against four flow axes — navigation-consistency, terminology-consistency, state-visibility, hierarchy-consistency — with per-screen notes naming the canvas. Screens past the cap land in `flowSkipped` (pass `canvasIds` to pick the flow); without an API key the full heuristic roll-up still returns with a `flowNote`. One paid multi-image call per invocation, same cost posture as `canvas_evaluate`'s llm mode.

The rhythm for a module: design each screen to its own READY directive → design the states → stress the data screens → then `project_evaluate` before calling the set done.

## Designing with taste

The bar is "designers say *wow*," not "competent." The cliché tells below are the *don'ts*; these are the *do's*. Apply them up front — the evaluator is the safety net, not the plan.

- **Start from a pattern, don't start blank.** `list_structures` → `apply_structure` stamps a taste-vetted page scaffold (every one is regression-tested to > 95 with zero cliché tells across themes, built from type-role tokens rather than literal pixel sizes, and stress-hardened to survive hostile-length content). Adapt it — swap copy, set `$tokens`, vary the structure — rather than inventing layout from nothing. A blank canvas is where slop comes from.
- **Use the whole toolkit — a real UI uses these, so your design must too.** Icons (`{ type: "icon", icon: "search" }` — Lucide or `material:`), fonts by name, real controls (`toggle`/`checkbox`/`radio`/`select`), components, and `$tokens`. Never fake them (no Unicode-glyph icons, no ellipse "toggles") and never omit them where a real UI has them: nav rows get a leading icon, metrics get an icon, feature lists get check icons, empty states get a glyph, forms use real controls. Starting from a pattern gives you all of this — don't strip it out.
- **One focal point per screen.** Decide what the eye hits first (usually the headline or the primary action) and make everything else quieter. Two competing focal points = no focal point.
- **Build real hierarchy.** Size, weight, and color should encode importance in steps you can see — a display heading, a clearly smaller subhead, body, then muted captions. Avoid near-equal sizes (a 16→15→14 ramp reads as one blurry tier); aim for ~1.2–1.6× jumps.
- **Keep one type scale and one spacing scale.** Pick a small set of sizes and a spacing rhythm (e.g. 8 / 16 / 24 / 32 / 48) and reuse them. Off-scale one-offs are the most common craft tell.
- **Let it breathe.** Generous, consistent padding and whitespace read as designed; cramped, uneven spacing reads as machine-filled. Restraint beats density.
- **One accent, flat color, no effects.** A single accent hue plus neutrals. Flat `$surface` fills over gradients; a subtle near-black shadow over any glow. Off-black/off-white over pure `#000`/`#fff`.
- **Honest content.** Labeled placeholders (`"Metric — to confirm"`) over invented numbers, names, or logos.

### Before you present (the hard rule)

Polishing the design to the bar is **your** job, not the user's — they should never have to point out a missing icon, an off-scale gap, or a low score. So the loop is part of designing, not an afterthought:

1. `canvas_evaluate` the canvas.
2. **Resolve every warning and every cliché tell** — `canvas_autofix` for the mechanical subset (spacing/contrast/known-default accent/misspelled icon), `batch_design` for the rest. (Cliché tells are info/warning but they're the slop signal — always fix them.) Pure advisories like "consider extracting components" are optional refinements that don't block.
3. Re-run `canvas_evaluate`.
4. Repeat until there are **zero errors, zero warnings, and zero cliché tells**.

`canvas_evaluate`'s result includes a `directive` field — it says `READY TO PRESENT` or `NOT READY` with what's left. **Only present a design once it says READY.** On a data screen that includes stress: after a `FRAGILE` `canvas_stress` run the directive stays NOT READY until a full CLEAN run replaces it. Don't ship the first attempt; ship the one that passes the bar.

**Readiness turns on blocking findings, not the score.** `READY` means step 4 is done — zero errors, zero warnings, zero cliché tells — and no unresolved `FRAGILE` stress verdict; nothing more. The score (aim for **> 95**) is always reported alongside the directive and is still the quality bar you're climbing toward, but it no longer withholds readiness by itself: a design with nothing left to resolve is `READY` even sitting at or below the bar, and the directive says so explicitly, pointing at the remaining advisory findings as the lever. (Before Phase 29 slice D, readiness also required score > 95, which could strand a design with every real problem fixed and no honest move left to raise the number — a gate that can't be satisfied by improving the design isn't a gate.)

**Which number is the gate?** The heuristic directive (fast mode) is the presentation gate — always available, no API key. `mode: "llm"` adds a vision-model rubric critique (composition, hierarchy, polish) on top; it needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` and degrades gracefully without one — when it's unavailable, the heuristic directive alone decides. With a key the heuristic directive still decides, and a `needsRevision: true` verdict never blocks presenting. Run the critique loop as the standard last step (judge, `canvas_revise`, re-judge). If `canvas_revise` stops (`max-iterations` or `no-improvement`) with axes still failing, present the design and tell the user which axes fail rather than looping. And calibrate the evaluator to what the screen *is*: a screen whose figures are the user's own data evaluated without `genre: "data"` — or a checkout without `genre: "commerce"` — will flag its own figures as fabricated and pin the score below the bar with no path up — that's a miscalibrated gate, not a bad design (see Cliché & craft below).

## Cliché & craft

`canvas_evaluate` scores craft (contrast, scale, structure) **and** a `cliche` category — the visual tells that read as machine-made. The bar is "designers say *wow*," not "competent": flat color and restraint beat effects. Steer away from these *before* you draw; the evaluator is the safety net, not the plan.

| Tell | What flags | Do this instead |
|---|---|---|
| **Default purple / indigo accent** | An accent (button, stroke, icon, accent text) in the indigo→violet band — especially the Tailwind defaults `#6366f1` / `#8b5cf6` / `#7c3aed` | Pick an accent that fits the brand — a considered blue, green, or warm hue. Set it once as a `$accent` token. |
| **Gradient / glow overuse** | 3+ gradient nodes, or a colored glow/bloom shadow (large blur + a saturated or translucent-white color) | Flat `$surface` fills. Reserve a gradient for at most one deliberate focal moment; use a subtle near-black low-alpha shadow, not a halo. |
| **Fake browser / OS chrome** | A row of ≥3 small circular dots (mac traffic lights) wrapping content | Frame the content directly. Skip the fake window — it adds nothing and dates the mockup. |
| **Hanging eyebrow header** | A small eyebrow/tag *beside* a large heading in a horizontal row | Stack the eyebrow **above** the heading (`layout: "vertical"`, left-aligned). |
| **Fabricated content** | Invented metrics / testimonials / brand logos in placeholder copy (`"99.9% uptime"`, `"— Jane Doe, CEO"`, `"TechCrunch"`) | Use a labeled placeholder until real data exists: `"Uptime — to confirm"` + a neutral block. Don't ship invented numbers. **Exception:** on a screen whose figures are the user's own data (a dashboard, activity, finance, fitness or logistics screen) the realistic figures ARE the design — declare `genre: "data"` (alias `"dashboard"`) so they aren't flagged; on a transactional screen (cart, checkout, order confirmation, billing history) the money is the design — pass `genre: "commerce"` (alias `"checkout"`). A pricing page gets neither: its numbers are claims. |
| **Eyebrow rhythm** | More eyebrow labels than ~1 per 3 sections — an eyebrow above nearly every heading. An eyebrow is small text that is uppercase (via `textTransform` **or** typed in capitals) or tracked at `letterSpacing` ≥ 1 | Keep eyebrows rare (≤ `ceil(sections / 3)`). Let most headings stand alone; reserve the eyebrow for sections that genuinely need a kicker. A form label with the light tracking a type role sets (0.25–0.6) is not an eyebrow and doesn't count. |
| **Slop copy** | Stock AI phrasing in short copy — filler verbs (`"Elevate"`, `"Seamless"`, `"Unleash"`), scroll cues (`"Scroll to explore"`), placeholder names (`"Jane Doe"`), hype labels (`"BETA"`, `"Early access"`), section-number eyebrows (`"01 / Index"`) | Write specific, branded copy that names the concrete benefit. A numeral bound to a unit noun by a tight hyphen is a compound modifier, not an eyebrow — `"30-day returns"`, `"2-year warranty"` and `"24/7 support"` are ordinary product copy and pass. |
| **Radius consistency** | 4+ distinct corner radii across the page — no single radius system (full pills, `cornerRadius: 999`+, are a shape choice and never count toward the census) | Consolidate to one small radius scale (e.g. `8` / `12`, plus `999` for pills). Define it as a `$token` and reuse. |
| **Pure black / white** | `#000000` ink (text / icon / stroke / fill) or a `#ffffff` page background | Use a designed off-black (`#0A0A0A`) for ink and an off-white (`#FAFAFA`) for the page surface. |
| **Accent consistency** | 3+ competing saturated accent hues (excludes neutrals + the page background) | Pick **one** accent hue — plus neutrals and at most one status color. Set it once as `$accent`. |

- **`cliche` tells are `warning`/`info`, never a hard error — but every one blocks the directive.** They dent the score and they hold back `READY` until each is resolved; they're the slop signal, so fix them rather than reading "info" as optional.
- **`canvas_autofix` fixes the mechanical ones** — it swaps a *known-default* purple accent, deletes a fake-chrome strip, and softens pure black (`#000000`) ink to off-black, and corrects a misspelled icon name when exactly one spelling resolves. Gradient/glow, the hanging header, fabricated copy, eyebrow rhythm, slop copy, mixed radius systems, and competing accents carry a suggestion but no op (taste/judgment calls).
- **Genre relaxes intentional tells** — stamp the canvas once with `canvas_set_genre` (no token churn; `null` clears; the stamp never moves the `versionHash`, so approvals stay valid), or pass `genre` per evaluate/autofix call, so a style that legitimately uses a tell isn't nagged. `genre: "material"` allows the purple accent **and** white elevated surfaces (both are intentional in Material Design); `genre: "data"` (alias `"dashboard"`) allows realistic figures on any screen whose numbers are the user's own data — dashboards, activity, finance, fitness, logistics — and `genre: "commerce"` (alias `"checkout"`) allows the money on a transactional screen — cart, checkout, order confirmation, billing history (both relax `honest-content`). Declare the genre the screen actually **is** — don't use it to dodge flags on a marketing page.
- **Genre and preset are separate fields.** `canvas_set_genre` writes `metadata.provenance.genre`; `apply_preset` writes `metadata.provenance.preset` and never changes the genre, so styling a declared canvas can't undo its declaration. Aliases fold: `genre.active` and `canvas_set_genre`'s `canonical` report `"data"` for a `"dashboard"` stamp and `"commerce"` for `"checkout"` (the stored value stays as you wrote it).
- **The material preset relaxes on its own.** A canvas styled with `apply_preset("material")` skips the accent-hue and pure-black-white tells whatever its genre, even under an explicit `genre` param (which replaces only the genre). The evaluate result's `genre.byPreset` (`{ preset, relaxed }`) shows when that happened, and `canvas_set_genre`'s `presetRelaxes` says so at stamp time. Clearing the genre doesn't remove a preset's relaxation; applying another preset does.
- **Older canvases migrate on the first write.** A canvas stamped by an older framesmith (genre stored in the preset field) keeps its score; the first `canvas_set_genre` or `apply_preset` moves the genre to its own field. Run one framesmith version per repo: an older version writes the genre into the preset field, which this one ignores once a canvas has been migrated.
- **Genre follows what the screen is FOR, not what it contains.** "It shows figures → `data`" is the intuitive heuristic and it's wrong: a *targets editor* stamped `data` clears one figure tell while leaving the white-surface tells that `material` would have relaxed. Read screens presenting the user's own figures → `data`; a screen you complete a purchase on → `commerce`; editors and admin forms → `material`. A **pricing page is marketing**, not commerce: its numbers are claims about a product, not the arithmetic of a transaction, so it keeps the fabricated-content gate. The evaluate result's `genre` field makes this checkable: it reports the active genre (canonical), its source (`explicit` param vs `provenance` stamp), the tells it `relaxed`, and `notRelaxed` (`[{ tell, relaxedBy }]`) — tells still flagging that a *different* genre would relax. If your score is pinned by tells listed in `notRelaxed`, you likely declared the wrong genre. (`honest-content` is effectively the ceiling for any financial UI — declare `data` on read screens, `commerce` on transactional ones, or the design's own figures cap the score.)

## Sharp edges

A few operational details that aren't obvious from the tool schemas:

- **Scope to a repo with `init` (or `canvas_bind`) — binding re-keys IDs.** Binding rewrites the workspace ID and every project ID to `repo-*` form, so workspace/project IDs captured before the bind stop resolving. Canvas IDs are kept. `canvas_bind` returns an `idMap` (`{ workspace: { old: new }, projects: { old: new } }`) to retarget from, and `init` binds and returns the fresh project list in one call. In a bound repo, if a workspace/project write is refused with "Can't save: … can't be read", `.framesmith/workspace.json` is unparseable (unresolved git merge conflict or an in-progress write) — tell the user and let them resolve the conflict (or wait for the write to finish), then retry. Don't pick a side of a design-system conflict yourself, and don't work around it.
- **Same change across many nodes? Use `replace_matching_properties`, not N `U()` ops.** It applies one `set` to every node matching a property/value predicate (AND across keys; token refs like `"$surface"` match literally), with `scope` (subtree) and `type` filters. Preview wide matches with `dryRun: true` first — a common value like `width: 150` can match more nodes than intended (making a 17-row table fill its container is one call, not 68 `U()` ops).
- **`batch_design` ops can span lines and carry comments.** Keep one op per line, but an op may continue across lines while its `(`, `{` or `[` brackets are open, so a chart's `series` array can be laid out readably. A line starting with `#` between ops is a comment (inside an open bracket use `//` instead), and `//` comments out the rest of a line. Neither marker counts inside a quoted string, so `"#RRGGBB"` fills and `https://` URLs are safe.
- **Record `batch_design`'s `nodeIds` map.** `batch_design` returns `{ ok, nodeIds, results }` where `nodeIds` maps each bound variable (`header=I(...)`) to the node ID it created. Bindings only live within a single call, so keep that map and target the real IDs in later calls rather than re-deriving them. Lost track anyway? `find_nodes` recovers ids by property/text/name with a readable path per match — use it instead of eyeballing `read_nodes` trees; editing a guessed id is how the wrong node gets restyled.
- **Matching an existing app's type scale? Pin it with typography tokens.** The type-scale check flags adjacent sizes at a ratio below 1.1, which a deliberately dense scale (14/13/12/11) trips by design. Declare those sizes as typography tokens (`set_variables`) — a pair where **both** sizes are token-declared is pinned and skips the ratio check; undeclared one-offs still flag. Declaring the scale is the intentionality signal.
- **Spacing variety is measured against your *declared* scale, not a flat count.** The `spacing` category only counts values that AREN'T on the canvas's declared spacing scale (`set_variables`/`generate_scale`) toward sprawl — a design drawing exclusively from a nine-step generated scale (`space-3xs`…`space-3xl`) isn't penalized for using all nine. No declared scale falls back to the old total-unique-values count, and the message tells you to declare one. Declaring the scale is the intentionality signal here too.
- **The eyebrow-rhythm cliché check reads type-role thresholds off your declared scale.** "Small text" (an eyebrow candidate) and "large text" (a heading) are relative to your typography tokens when you declare `label`/`caption`/`heading` roles — a `soft`-personality section head at 25px or a `data-dense` one at 19px still reads as a heading. Canvases without declared roles fall back to the fixed 14px / 28px constants.
- **Typography `$tokens` resolve the FULL spec.** A `fontSize: "$heading"` reference applies the token's size **and** its `fontWeight` / `fontFamily` / `lineHeight` / `letterSpacing` — explicit node props always win, so overrides behave as expected. (Before v1.12 only `.fontSize` resolved; that quirk is dead — declare the type system on tokens and it actually applies.)
- **Row rules and accent bars are per-side borders, not layout hacks.** `borderTop: { width: 1, color: "$border" }` on each table row gives hairline separators with `gap: 0` (always on-scale — flush stacks never trip the spacing check); `borderLeft: { width: 3, color: "$primary" }` marks the active row. `style: "dashed" | "dotted"` (and `strokeStyle` for the all-sides `stroke`) is the convention for forecast/placeholder/draft; `strokeDasharray: "6 4"` dashes SVG paths — the projected-vs-actual convention in charts. Never simulate hairlines with `gap: 1` + background bleed-through — it couples separation to spacing and fights the spacing linter.
- **Prefer the structured form for gradients & shadows.** `gradient: { type, angle?, stops: [...] }` and `shadows: [{ x, y, blur, spread?, color, inset? }]`. A raw CSS string is accepted too, but the structured form is canonical and diffs cleanly.
- **`shadows` (plural) always beats `shadow` (singular).** Writing `shadow` on a node that already has `shadows` does nothing at render time — the plural form wins. `batch_design` and `replace_matching_properties` flag this with a `warning` in the op result; when you see it, put the value in `shadows` (array or CSS string) or clear `shadows` first.
- **`import_design_md` is best-effort.** It reads tokens per heading section in list / table / `name: value` form (see the tool description for the exact accepted schema) and silently skips what it can't parse — colors deliberately reject shadow/gradient strings. Set anything it misses with `set_variables`. It honors explicit named spacing values and only synthesizes a scale from a stated `Base unit:` — it won't fabricate one otherwise.
- **Approvals should record a `versionHash`, not just a canvas name.** A name says which design was approved; the hash says which *version* of it — see "Keeping the design honest (gate integrity)" above for the full workflow, `canvas_version` shape, and CLI recipes.
- **`apply_preset`, `generate_design_system`, and `generate_color_system` all respect an inherited design system, canvas scope only.** A token the canvas already resolves through the workspace/project layers is kept rather than silently overwritten. Typography preservation is **field-wise**: a partially-specified inherited token (say `{ fontSize: 13 }`) is merged with the generated role rather than shadowing it whole, so the personality's font/weight/tracking still land — `preservedFromDesignSystem` entries carry a `filledFromPreset` list naming what the preset contributed. If the kept token lands on a name the generator itself owns (the surface/ink/border/accent semantics, the **status colours** and their paired `-tint` layer, the `$chart-*` range, and the type roles), it's split out into `designSystemConflicts` instead, with `why`/`fix` — that's two design languages on one screen, not a routine preservation, and it's worth reading even when the score is fine. Take the generated value explicitly with `set_variables`, or pass `preserveInherited: false` on the two generators to write the new language whole and skip preservation entirely.
- **A literal that happens to match a token is flagged, not silently trusted.** `canvas_evaluate`'s `consistency` category catches a raw `fill`/`stroke`/`color`/`cornerRadius` value that exactly equals a token's — it's drift-in-waiting since the literal won't move when the token does. `canvas_autofix` re-points it to `$token` when the match is unique; a value shared by multiple tokens is reported with candidates and left for you to pick — it never guesses.
