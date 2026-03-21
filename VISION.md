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
- [ ] Gradients (linear, radial)
- [ ] Shadows and blur effects
- [ ] Image generation integration (placeholder images via AI)
- [ ] Responsive breakpoints (render same design at different widths)
- [ ] Diff mode (visual diff between two canvases)
- [ ] HTTP transport for remote access

### Phase 4 — Ecosystem (v1.0)
- [ ] Web-based canvas viewer (read-only UI to browse designs)
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
