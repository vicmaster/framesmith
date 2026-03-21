#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvas, getCanvas, listCanvases, findNode } from './scene-graph.js';
import { parseAndExecute } from './operations.js';
import { resolveVariables, setVariables, getVariables } from './variables.js';
import { renderToHtml } from './renderer.js';
import { takeScreenshot, computeLayout, exportToFile, takeResponsiveScreenshots, computeDiff, shutdown } from './screenshot.js';
import { listPresets, getPreset } from './presets.js';
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

Node types: frame, text, rectangle, ellipse, image, icon, component, instance
Properties: fill, gradient, stroke, strokeWidth, cornerRadius, width, height, layout ("horizontal"|"vertical"), gap, padding, alignItems, justifyContent, fontSize, fontFamily, fontWeight, color, content, src, objectFit, opacity, shadow, shadows, blur, backdropBlur, overflow, wrap, position, x, y, icon, iconSize, iconColor, componentId, overrides`,
  {
    canvasId: z.string().describe('Canvas ID'),
    operations: z.string().describe('Operations to execute, one per line'),
  },
  async ({ canvasId, operations }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const results = parseAndExecute(canvas.root, operations, canvas);
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
    const html = renderToHtml(resolved, w, h, canvas);
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
    const html = renderToHtml(resolved, w, h, canvas);
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

// --- export ---
server.tool(
  'export',
  'Export a canvas or specific nodes to files (PNG, JPEG, WebP, PDF). Writes files to the specified output directory.',
  {
    canvasId: z.string().describe('Canvas ID'),
    format: z.enum(['png', 'jpeg', 'webp', 'pdf']).describe('Export format'),
    outputPath: z.string().describe('Directory path to save exported files'),
    nodeIds: z.array(z.string()).optional().describe('Specific node IDs to export (exports each separately). Defaults to full canvas.'),
    width: z.number().optional().describe('Viewport width in pixels (default 1440)'),
    height: z.number().optional().describe('Viewport height in pixels (default 900)'),
    scale: z.number().optional().describe('Device scale factor (default 2 for retina)'),
  },
  async ({ canvasId, format, outputPath, nodeIds, width, height, scale }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const resolved = resolveVariables(canvas.root, canvas.variables);
    const w = width ?? (typeof canvas.root.width === 'number' ? canvas.root.width : 1440);
    const h = height ?? (typeof canvas.root.height === 'number' ? canvas.root.height : 900);
    const html = renderToHtml(resolved, w, h, canvas);

    const exportedFiles: string[] = [];

    if (nodeIds?.length) {
      for (const nodeId of nodeIds) {
        const filePath = await exportToFile(html, { width: w, height: h, scale, format, outputPath, nodeId, fileName: nodeId });
        exportedFiles.push(filePath);
      }
    } else {
      const filePath = await exportToFile(html, { width: w, height: h, scale, format, outputPath, fileName: canvas.name.replace(/\s+/g, '-').toLowerCase() });
      exportedFiles.push(filePath);
    }

    return { content: [{ type: 'text', text: JSON.stringify({ exported: exportedFiles }, null, 2) }] };
  }
);

// --- screenshot_responsive ---
server.tool(
  'screenshot_responsive',
  'Render a canvas at multiple viewport sizes (responsive breakpoints). Returns one screenshot per breakpoint. Defaults to mobile (390x844), tablet (768x1024), and desktop (1440x900).',
  {
    canvasId: z.string().describe('Canvas ID'),
    breakpoints: z.array(z.object({
      label: z.string().describe('Breakpoint label (e.g. "mobile", "tablet", "desktop")'),
      width: z.number().describe('Viewport width in pixels'),
      height: z.number().describe('Viewport height in pixels'),
    })).optional().describe('Breakpoints to render. Defaults to mobile/tablet/desktop.'),
    scale: z.number().optional().describe('Device scale factor (default 2)'),
  },
  async ({ canvasId, breakpoints, scale }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const resolved = resolveVariables(canvas.root, canvas.variables);
    const defaultBreakpoints = [
      { label: 'mobile', width: 390, height: 844 },
      { label: 'tablet', width: 768, height: 1024 },
      { label: 'desktop', width: 1440, height: 900 },
    ];
    const bps = breakpoints ?? defaultBreakpoints;

    // Render HTML at the largest breakpoint width for the base HTML
    const maxWidth = Math.max(...bps.map((b) => b.width));
    const maxHeight = Math.max(...bps.map((b) => b.height));
    const html = renderToHtml(resolved, maxWidth, maxHeight, canvas);

    const results = await takeResponsiveScreenshots(html, bps, scale);

    return {
      content: results.map((r) => ({
        type: 'image' as const,
        data: r.data,
        mimeType: 'image/png' as const,
      })),
    };
  }
);

// --- canvas_diff ---
server.tool(
  'canvas_diff',
  'Compare two canvases visually. Returns a diff image highlighting changed regions in red, plus a change percentage.',
  {
    canvasId1: z.string().describe('First canvas ID'),
    canvasId2: z.string().describe('Second canvas ID'),
    width: z.number().optional().describe('Viewport width (default 1440)'),
    height: z.number().optional().describe('Viewport height (default 900)'),
    scale: z.number().optional().describe('Device scale factor (default 1 for diff accuracy)'),
  },
  async ({ canvasId1, canvasId2, width, height, scale }) => {
    const canvas1 = getCanvas(canvasId1);
    if (!canvas1) return { content: [{ type: 'text', text: `Error: Canvas "${canvasId1}" not found` }], isError: true };
    const canvas2 = getCanvas(canvasId2);
    if (!canvas2) return { content: [{ type: 'text', text: `Error: Canvas "${canvasId2}" not found` }], isError: true };

    const w = width ?? 1440;
    const h = height ?? 900;
    const s = scale ?? 1;

    const resolved1 = resolveVariables(canvas1.root, canvas1.variables);
    const resolved2 = resolveVariables(canvas2.root, canvas2.variables);
    const html1 = renderToHtml(resolved1, w, h, canvas1);
    const html2 = renderToHtml(resolved2, w, h, canvas2);

    const diff = await computeDiff(html1, html2, w, h, s);

    return {
      content: [
        {
          type: 'image',
          data: diff.diffImage,
          mimeType: 'image/png',
        },
        {
          type: 'text',
          text: JSON.stringify({
            changedPixels: diff.changedPixels,
            totalPixels: diff.totalPixels,
            changePercent: diff.changePercent,
          }, null, 2),
        },
      ],
    };
  }
);

// --- list_presets ---
server.tool(
  'list_presets',
  'List available style guide presets (e.g. dark, light, material, minimal).',
  {},
  async () => {
    return { content: [{ type: 'text', text: JSON.stringify(listPresets(), null, 2) }] };
  }
);

// --- apply_preset ---
server.tool(
  'apply_preset',
  'Apply a style guide preset to a canvas. Merges preset design tokens into the canvas variables.',
  {
    canvasId: z.string().describe('Canvas ID'),
    preset: z.string().describe('Preset name (dark, light, material, minimal)'),
  },
  async ({ canvasId, preset }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const p = getPreset(preset);
    if (!p) return { content: [{ type: 'text', text: `Error: Preset "${preset}" not found. Use list_presets to see available presets.` }], isError: true };

    const result = setVariables(canvas, p.variables);
    return { content: [{ type: 'text', text: JSON.stringify({ applied: preset, variables: result }, null, 2) }] };
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
