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

**Node types:** `frame`, `text`, `rectangle`, `ellipse`, `image`

**Properties:** `fill`, `stroke`, `strokeWidth`, `cornerRadius`, `width`, `height`, `layout` (`"horizontal"` | `"vertical"`), `gap`, `padding`, `alignItems`, `justifyContent`, `fontSize`, `fontFamily`, `fontWeight`, `color`, `content`, `src`, `objectFit`, `opacity`, `shadow`, `overflow`, `wrap`, `position`, `x`, `y`

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

## Workflow

1. `canvas_create` → get canvas ID
2. `set_variables` → define design tokens
3. `batch_design` → build the UI with frames, text, shapes
4. `screenshot` → see the result as PNG
5. Iterate: `batch_design` to refine → `screenshot` to verify

## License

MIT
