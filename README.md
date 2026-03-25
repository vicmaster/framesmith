# canvas-mcp

An open-source MCP server that gives any AI assistant a visual design canvas. Uses HTML/CSS as the rendering engine — flexbox layout, text wrapping, and styling come for free.

```
MCP Client → stdio → canvas-mcp server
                        ↓
              Scene Graph (in-memory JSON tree)
                        ↓
              HTML/CSS Renderer (inline styles)
                        ↓
              Puppeteer (headless Chromium → PNG)
```

## Installation

### With Claude Code

```bash
claude mcp add canvas-mcp -- node /path/to/canvas-mcp/dist/index.js
```

### With npx (after publishing)

```bash
npx @canvas-mcp/server
```

### Manual

```bash
git clone https://github.com/vicmaster/canvas-mcp.git
cd canvas-mcp
npm install
npm run build
node dist/index.js
```

## Tools

### `canvas_create`

Create a new canvas.

| Param | Type | Description |
|-------|------|-------------|
| `name` | string? | Canvas name |

### `canvas_list`

List all canvases. No params.

### `batch_design`

Execute operations on the scene graph. Operations are line-separated strings:

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

# Move a node
M("nodeId", "newParentId", 0)

# Replace a node entirely
R("nodeId", { type: "text", content: "Replaced" })
```

**Node types:** `frame`, `text`, `rectangle`, `ellipse`, `image`, `icon`, `component`, `instance`

**Properties:** `fill`, `gradient`, `stroke`, `strokeWidth`, `cornerRadius`, `width`, `height`, `layout` (`"horizontal"` | `"vertical"`), `gap`, `padding`, `alignItems`, `justifyContent`, `fontSize`, `fontFamily`, `fontWeight`, `color`, `content`, `src`, `objectFit`, `opacity`, `shadow`, `shadows`, `blur`, `backdropBlur`, `overflow`, `wrap`, `position`, `x`, `y`, `icon`, `iconSize`, `iconColor`, `componentId`, `overrides`

### `screenshot`

Render canvas to PNG (returned as base64 image).

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `nodeId` | string? | Specific node to capture |
| `width` | number? | Viewport width (default 1440) |
| `height` | number? | Viewport height (default 900) |
| `scale` | number? | Device scale (default 2) |

### `read_nodes`

Read node data from the scene graph.

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

### `get_variables` / `set_variables`

Read and write design tokens (colors, spacing, radius, typography). Use `$tokenName` in node properties to reference variables.

```json
{
  "colors": { "primary": "#e94560", "bg": "#1a1a2e" },
  "spacing": { "sm": 8, "md": 16, "lg": 24 },
  "radius": { "sm": 4, "md": 8 }
}
```

Then use in nodes: `{ fill: "$primary", padding: "$md", cornerRadius: "$sm" }`

### `export`

Export a canvas or specific nodes to files on disk.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `format` | string | `"png"`, `"jpeg"`, `"webp"`, or `"pdf"` |
| `outputPath` | string | Directory to save files |
| `nodeIds` | string[]? | Specific nodes to export (default: full canvas) |
| `width` | number? | Viewport width (default 1440) |
| `height` | number? | Viewport height (default 900) |
| `scale` | number? | Device scale (default 2) |

### `list_presets`

List available style guide presets. No params. Returns preset names and descriptions.

### `apply_preset`

Apply a style guide preset to a canvas. Merges preset design tokens into the canvas variables.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `preset` | string | Preset name: `"dark"`, `"light"`, `"material"`, `"minimal"` |

### `screenshot_responsive`

Render a canvas at multiple viewport sizes. Defaults to mobile (390x844), tablet (768x1024), and desktop (1440x900).

| Param | Type | Description |
|-------|------|-------------|
| `canvasId` | string | Canvas ID |
| `breakpoints` | array? | `[{label, width, height}]` — custom breakpoints |
| `scale` | number? | Device scale (default 2) |

### `canvas_diff`

Compare two canvases visually. Returns a diff image with changed regions highlighted in red.

| Param | Type | Description |
|-------|------|-------------|
| `canvasId1` | string | First canvas ID |
| `canvasId2` | string | Second canvas ID |
| `width` | number? | Viewport width (default 1440) |
| `height` | number? | Viewport height (default 900) |
| `scale` | number? | Device scale (default 1) |

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

# Backdrop blur (frosted glass effect)
I("parent", { type: "frame", fill: "rgba(255,255,255,0.5)", backdropBlur: 8 })
```

The legacy `shadow` string property still works for simple cases.

## Icons

1,900+ icons from [Lucide](https://lucide.dev) are available via the `icon` node type:

```
I("parent", { type: "icon", icon: "search", iconSize: 24, iconColor: "#888" })
I("parent", { type: "icon", icon: "heart", iconSize: 32, iconColor: "#ef4444" })
```

Icons render as inline SVGs with configurable size and color.

## Components

Define reusable components and create instances with overrides:

```
# Define a component (a frame subtree that gets registered)
card=I("document", { type: "component", name: "Card", width: 300, fill: "#1a1a1a", cornerRadius: 12, layout: "vertical", padding: 16, gap: 8 })
I(card, { type: "text", name: "title", content: "Default Title", fontSize: 20, color: "#fff" })
I(card, { type: "text", name: "subtitle", content: "Default subtitle", fontSize: 14, color: "#888" })

# Create instances with overrides (matched by child name)
I("document", { type: "instance", componentId: card, overrides: { title: { content: "My Card" }, subtitle: { content: "Custom text" } } })
```

## Usage Example

Here's a complete session building a login card:

**1. Create a canvas and set design tokens**

```
canvas_create({ name: "Login" })
→ { canvasId: "abc123" }

set_variables({
  canvasId: "abc123",
  variables: {
    colors: { bg: "#0a0a0a", surface: "#1a1a2e", accent: "#e94560", text: "#ffffff" },
    spacing: { sm: 8, md: 16, lg: 24, xl: 32 },
    radius: { md: 8, lg: 16 }
  }
})
```

**2. Build the layout with `batch_design`**

```
batch_design({
  canvasId: "abc123",
  operations: `
    page=I("document", { type: "frame", width: 1440, height: 900, fill: "$bg", layout: "vertical", alignItems: "center", justifyContent: "center" })
    card=I(page, { type: "frame", width: 400, fill: "$surface", cornerRadius: "$lg", padding: [32, 32, 32, 32], layout: "vertical", gap: 24 })
    I(card, { type: "text", content: "Sign In", fontSize: 28, fontWeight: 700, color: "$text" })
    I(card, { type: "frame", width: "100%", height: 44, fill: "#ffffff10", cornerRadius: "$md", padding: [0, 16, 0, 16], layout: "horizontal", alignItems: "center" })
    I(card, { type: "frame", width: "100%", height: 44, fill: "#ffffff10", cornerRadius: "$md", padding: [0, 16, 0, 16], layout: "horizontal", alignItems: "center" })
    btn=I(card, { type: "frame", width: "100%", height: 44, fill: "$accent", cornerRadius: "$md", layout: "horizontal", alignItems: "center", justifyContent: "center" })
    I(btn, { type: "text", content: "Continue", fontSize: 16, fontWeight: 600, color: "$text" })
  `
})
```

**3. Take a screenshot to see the result**

```
screenshot({ canvasId: "abc123" })
→ returns base64 PNG image
```

**4. Iterate — update the button color and verify**

```
batch_design({
  canvasId: "abc123",
  operations: `U("btn-id", { fill: "#3b82f6" })`
})

screenshot({ canvasId: "abc123" })
```

## Web Viewer

The server includes a built-in web viewer that starts automatically on port **3001** (or the next available port if 3001 is in use — supports multiple sessions).

- **Gallery** (`/`) — Browse all canvases as clickable cards with thumbnails
- **Canvas detail** (`/canvas/:id`) — Full rendered design in an iframe with responsive viewport buttons (Mobile / Tablet / Desktop), fit-to-screen toggle, and JSON inspector
- **Live auto-refresh** — The viewer polls for changes every 2 seconds. As you `batch_design` via your MCP client, the browser updates automatically
- **Raw HTML** (`/canvas/:id/html`) — The rendered HTML for embedding or inspection
- **JSON API** (`/api/canvases`, `/api/canvas/:id/meta`) — Programmatic access

## Workflow

1. `canvas_create` → get canvas ID
2. Open the viewer URL (returned by `canvas_create`) in your browser for live preview
3. `apply_preset` or `set_variables` → set up design tokens
4. `batch_design` → build the UI with frames, text, icons, components, gradients
5. Watch the viewer auto-refresh as you design
6. `screenshot_responsive` → preview at mobile/tablet/desktop sizes
7. `canvas_diff` → compare before/after changes visually
8. `export` → save final designs to PNG/PDF files

## License

MIT
