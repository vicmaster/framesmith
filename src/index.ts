#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvas, getCanvas, listCanvases, findNode } from './scene-graph.js';
import { parseAndExecute } from './operations.js';
import { resolveVariables, setVariables, getVariables } from './variables.js';
import { renderToHtml } from './renderer.js';
import { takeScreenshot, computeLayout, shutdown } from './screenshot.js';
import type { SceneNode } from './types.js';

const server = new McpServer({
  name: 'canvas-mcp',
  version: '0.1.0',
});

// --- canvas_create ---
server.tool(
  'canvas_create',
  'Create a new design canvas. Returns the canvas ID and root node ID.',
  { name: z.string().optional().describe('Name for the canvas') },
  async ({ name }) => {
    const canvas = createCanvas(name);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ canvasId: canvas.id, rootId: canvas.root.id, name: canvas.name }, null, 2),
        },
      ],
    };
  }
);

// --- canvas_list ---
server.tool(
  'canvas_list',
  'List all canvases.',
  {},
  async () => {
    const canvases = listCanvases();
    return {
      content: [{ type: 'text', text: JSON.stringify(canvases, null, 2) }],
    };
  }
);

// --- batch_design ---
server.tool(
  'batch_design',
  `Execute design operations on a canvas scene graph. Operations are line-separated strings:
  - Insert: varName=I("parentId", { type: "frame", fill: "#FF0000", width: 200, height: 100 })
  - Update: U("nodeId", { fill: "#00FF00" })
  - Delete: D("nodeId")
  - Copy: varName=C("sourceId", "parentId", { fill: "#0000FF" })
  - Move: M("nodeId", "newParentId", index)
  - Replace: varName=R("nodeId", { type: "text", content: "Hello" })

Use "document" to reference the root node. Bind results to reuse IDs: header=I("document", {...})
Concatenate bindings: U(header+"/childId", {...})

Node types: frame, text, rectangle, ellipse, image
Properties: fill, stroke, strokeWidth, cornerRadius, width, height, layout ("horizontal"|"vertical"), gap, padding, alignItems, justifyContent, fontSize, fontFamily, fontWeight, color, content, src, objectFit, opacity, shadow, overflow, wrap, position, x, y`,
  {
    canvasId: z.string().describe('Canvas ID'),
    operations: z.string().describe('Operations to execute, one per line'),
  },
  async ({ canvasId, operations }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const results = parseAndExecute(canvas.root, operations);
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  }
);

// --- screenshot ---
server.tool(
  'screenshot',
  'Render a canvas (or specific node) to a PNG image. Returns base64-encoded image.',
  {
    canvasId: z.string().describe('Canvas ID'),
    nodeId: z.string().optional().describe('Specific node ID to screenshot (defaults to full canvas)'),
    width: z.number().optional().describe('Viewport width in pixels (default 1440)'),
    height: z.number().optional().describe('Viewport height in pixels (default 900)'),
    scale: z.number().optional().describe('Device scale factor (default 2 for retina)'),
  },
  async ({ canvasId, nodeId, width, height, scale }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const resolved = resolveVariables(canvas.root, canvas.variables);
    const w = width ?? (typeof canvas.root.width === 'number' ? canvas.root.width : 1440);
    const h = height ?? (typeof canvas.root.height === 'number' ? canvas.root.height : 900);
    const html = renderToHtml(resolved, w, h);
    const base64 = await takeScreenshot(html, { width: w, height: h, scale, nodeId });

    return {
      content: [
        {
          type: 'image',
          data: base64,
          mimeType: 'image/png',
        },
      ],
    };
  }
);

// --- read_nodes ---
server.tool(
  'read_nodes',
  'Read node data from the scene graph. Returns JSON representation of nodes.',
  {
    canvasId: z.string().describe('Canvas ID'),
    nodeIds: z.array(z.string()).optional().describe('Specific node IDs to read (defaults to root)'),
    maxDepth: z.number().optional().describe('Max depth to traverse children (default 5)'),
  },
  async ({ canvasId, nodeIds, maxDepth = 5 }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    if (!nodeIds?.length) {
      const trimmed = trimDepth(canvas.root, maxDepth);
      return { content: [{ type: 'text', text: JSON.stringify(trimmed, null, 2) }] };
    }

    const nodes = nodeIds.map((id) => {
      const result = findNode(canvas.root, id);
      if (!result) return { error: `Node "${id}" not found` };
      return trimDepth(result.node, maxDepth);
    });

    return { content: [{ type: 'text', text: JSON.stringify(nodes, null, 2) }] };
  }
);

// --- snapshot_layout ---
server.tool(
  'snapshot_layout',
  'Get computed bounding boxes for all nodes by rendering the canvas in a browser. Returns { nodeId, x, y, width, height } for each node.',
  {
    canvasId: z.string().describe('Canvas ID'),
    nodeId: z.string().optional().describe('Root node ID to start from'),
    maxDepth: z.number().optional().describe('Max depth to traverse (default 10)'),
  },
  async ({ canvasId, nodeId, maxDepth }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const resolved = resolveVariables(canvas.root, canvas.variables);
    const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
    const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
    const html = renderToHtml(resolved, w, h);
    const layout = await computeLayout(html, nodeId, maxDepth);

    return { content: [{ type: 'text', text: JSON.stringify(layout, null, 2) }] };
  }
);

// --- get_variables ---
server.tool(
  'get_variables',
  'Get design variables (tokens) for a canvas.',
  { canvasId: z.string().describe('Canvas ID') },
  async ({ canvasId }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(getVariables(canvas), null, 2) }] };
  }
);

// --- set_variables ---
server.tool(
  'set_variables',
  'Set design variables (tokens) for a canvas. Merges with existing variables.',
  {
    canvasId: z.string().describe('Canvas ID'),
    variables: z.object({
      colors: z.record(z.string()).optional(),
      spacing: z.record(z.number()).optional(),
      radius: z.record(z.number()).optional(),
      typography: z.record(z.object({
        fontSize: z.number(),
        fontWeight: z.union([z.string(), z.number()]).optional(),
        fontFamily: z.string().optional(),
        lineHeight: z.union([z.number(), z.string()]).optional(),
      })).optional(),
    }).describe('Design variables to set'),
  },
  async ({ canvasId, variables }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    const result = setVariables(canvas, variables);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Helpers ---
function trimDepth(node: SceneNode, maxDepth: number, currentDepth = 0): SceneNode {
  const copy = { ...node };
  if (copy.children && currentDepth < maxDepth) {
    copy.children = copy.children.map((c) => trimDepth(c, maxDepth, currentDepth + 1));
  } else if (copy.children && currentDepth >= maxDepth) {
    copy.children = copy.children.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      ...(c.children?.length ? { childCount: c.children.length } : {}),
    })) as SceneNode[];
  }
  return copy;
}

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start canvas-mcp:', err);
  process.exit(1);
});
