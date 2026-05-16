#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvas, getCanvas, listCanvases, findNode, touchCanvas, loadPersistedCanvases } from './scene-graph.js';
import { parseAndExecute } from './operations.js';
import { resolveVariables, setVariables, getVariables } from './variables.js';
import { renderToHtml } from './renderer.js';
import { takeScreenshot, computeLayout, exportToFile, takeResponsiveScreenshots, computeDiff, shutdown } from './screenshot.js';
import { listPresets, getPreset, registerPreset } from './presets.js';
import { parseDesignMd } from './design-md-parser.js';
import { startViewer, getViewerUrl, setExternalViewerUrl } from './viewer.js';
import { evaluateCanvas } from './evaluate.js';
import { judgeCanvas, LLMJudgeUnavailableError } from './llm-judge.js';
import type { SceneNode } from './types.js';

const server = new McpServer({
  name: 'canvas-mcp',
  version: '0.5.0',
});

const GUIDELINES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'GUIDELINES.md');

server.resource(
  'guidelines',
  'canvas-mcp://guidelines',
  { description: 'Authoring guidelines: when to use fluid widths, responsive hints, and common patterns vs. anti-patterns.', mimeType: 'text/markdown' },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readFile(GUIDELINES_PATH, 'utf-8') }],
  })
);

// --- canvas_create ---
server.tool(
  'canvas_create',
  'Create a new design canvas. Returns the canvas ID, root node ID, and viewer URL. Always share the viewer URL with the user so they can see the design live in their browser.',
  { name: z.string().optional().describe('Name for the canvas') },
  async ({ name }) => {
    const canvas = createCanvas(name);
    const viewerUrl = getViewerUrl();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            canvasId: canvas.id,
            rootId: canvas.root.id,
            name: canvas.name,
            viewerUrl: viewerUrl ? `${viewerUrl}/canvas/${canvas.id}` : null,
            galleryUrl: viewerUrl,
          }, null, 2),
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
Properties: fill, gradient, stroke, strokeWidth, cornerRadius, width, height, minWidth, maxWidth, layout ("horizontal"|"vertical"), gap, padding, alignItems, justifyContent, fontSize, fontFamily, fontWeight, color, content, src, objectFit, opacity, shadow, shadows, blur, backdropBlur, overflow, wrap, position, x, y, icon, iconSize, iconColor, componentId, overrides, responsive

Responsive layout (author desktop-first, adapt down):
  - responsive: "stack" — on a horizontal container, flips to vertical below 768px (multi-column layouts that should stack on mobile)
  - responsive: "wrap" — children wrap to the next line instead of overflowing (card grids, tag rows)
  - responsive: "fixed" — never reflows (toolbars, fixed-position headers)
Prefer fluid widths (percentages, "fit-content") + a "responsive" hint over hardcoded pixel widths. width/minWidth/maxWidth accept numbers (px) or strings ("100%", "50vw", "fit-content"). Combine a percentage width with a maxWidth ceiling for content that fills the row but caps on wide screens (e.g. width: "100%", maxWidth: 600).

Read the canvas-mcp://guidelines resource for common patterns (pricing tiers, two-column hero, tag list, toolbar), anti-patterns, and width-strategy guidance.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    operations: z.string().describe('Operations to execute, one per line'),
  },
  async ({ canvasId, operations }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const results = parseAndExecute(canvas.root, operations, canvas);
    touchCanvas(canvasId);
    const viewerUrl = getViewerUrl();
    return {
      content: [
        { type: 'text', text: JSON.stringify(results, null, 2) },
        ...(viewerUrl ? [{ type: 'text' as const, text: `View live: ${viewerUrl}/canvas/${canvasId}` }] : []),
      ],
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
    touchCanvas(canvasId);
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

    // True reflow: render HTML per breakpoint so the body scaffold matches the
    // viewport. The viewport change alone would let @media rules fire, but
    // matching the scaffold avoids min-height inflated to the largest breakpoint.
    const results = await takeResponsiveScreenshots(
      (bp) => renderToHtml(resolved, bp.width, bp.height, canvas),
      bps,
      scale,
    );

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
  'Apply a style guide preset to a canvas. Merges preset design tokens into the canvas variables, and copies in any reusable components (button, card, badge) the preset defines.',
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

    const components: string[] = [];
    if (p.components) {
      for (const [key, node] of Object.entries(p.components)) {
        canvas.components[key] = structuredClone(node);
        components.push(key);
      }
    }

    touchCanvas(canvasId);
    return { content: [{ type: 'text', text: JSON.stringify({ applied: preset, variables: result, components }, null, 2) }] };
  }
);

// --- import_design_md ---
server.tool(
  'import_design_md',
  `Import a DESIGN.md file as a design system preset. Parses the Google Stitch / awesome-design-md format and extracts colors, typography, spacing, border radius, and reusable component skeletons (button, card, badge) into a preset. After importing, use apply_preset to apply it to any canvas. Accepts either a file path or raw DESIGN.md content.`,
  {
    content: z.string().optional().describe('Raw DESIGN.md content. Provide this OR filePath.'),
    filePath: z.string().optional().describe('Absolute path to a DESIGN.md file. Provide this OR content.'),
    name: z.string().optional().describe('Override the preset name (default: extracted from DESIGN.md header)'),
  },
  async ({ content, filePath, name }) => {
    let markdown: string;

    if (content) {
      markdown = content;
    } else if (filePath) {
      try {
        const { readFile } = await import('node:fs/promises');
        markdown = await readFile(filePath, 'utf-8');
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: Could not read file "${filePath}": ${(err as Error).message}` }], isError: true };
      }
    } else {
      return { content: [{ type: 'text', text: 'Error: Provide either "content" or "filePath"' }], isError: true };
    }

    const preset = parseDesignMd(markdown, name);
    registerPreset(preset);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          imported: preset.name,
          description: preset.description,
          tokens: {
            colors: Object.keys(preset.variables.colors || {}),
            typography: Object.keys(preset.variables.typography || {}),
            spacing: Object.keys(preset.variables.spacing || {}),
            radius: Object.keys(preset.variables.radius || {}),
          },
          components: Object.keys(preset.components || {}),
          usage: `Use apply_preset with preset="${preset.name}" to apply this design system (tokens + components) to a canvas.`,
        }, null, 2),
      }],
    };
  }
);

// --- canvas_evaluate ---
server.tool(
  'canvas_evaluate',
  `Auto-score a design canvas against quality criteria. Returns an overall score (0-100), category scores (spacing, color, typography, structure, consistency), and actionable issues referencing specific node IDs. Modes:
  - "fast": JSON-only, <100ms, deterministic heuristics only.
  - "detailed": adds Puppeteer-based pixel overlap detection in the consistency category.
  - "llm": fast-mode heuristics plus a vision-model critique (provider picked from CANVAS_LLM_PROVIDER env var, or whichever of ANTHROPIC_API_KEY / OPENAI_API_KEY is set). Adds an "llmCritique" field with { score, summary, strengths, weaknesses, suggestions }. Cost: one paid API call per invocation.
Designed for generator-evaluator loops: generate with batch_design, evaluate with canvas_evaluate, fix issues targeting the returned nodeIds (canvas_autofix handles the mechanical subset).`,
  {
    canvasId: z.string().describe('Canvas ID to evaluate'),
    mode: z.enum(['fast', 'detailed', 'llm']).default('fast').describe('"fast" = JSON-only (<100ms), "detailed" = + Puppeteer layout checks, "llm" = fast + vision-model critique'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency']))
      .optional()
      .describe('Specific categories to evaluate (default: all)'),
  },
  async ({ canvasId, mode, categories }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const result = await evaluateCanvas(canvas, { mode, categories });

    if (mode === 'llm') {
      try {
        const resolved = resolveVariables(canvas.root, canvas.variables);
        const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
        const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
        const html = renderToHtml(resolved, w, h, canvas);
        const screenshotPng = await takeScreenshot(html, { width: w, height: h, scale: 1 });
        result.llmCritique = await judgeCanvas(screenshotPng);
      } catch (err) {
        const msg = err instanceof LLMJudgeUnavailableError
          ? err.message
          : `LLM critique failed: ${(err as Error).message}`;
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- canvas_autofix ---
server.tool(
  'canvas_autofix',
  `Run canvas_evaluate in fast mode and return the subset of issues that have a mechanically derived fix (off-scale spacing → snap to scale; missing layout on multi-child frame → set vertical; recoverable WCAG contrast failure → switch text to #000 or #FFF, whichever wins). Each fix carries a ready-to-paste \`batch_design\` Update op string and a one-line rationale. Closes the generator-evaluator loop: generate with batch_design → autofix → re-evaluate. Issues without a fix are not returned here; call canvas_evaluate to see the full set.`,
  {
    canvasId: z.string().describe('Canvas ID to autofix'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency']))
      .optional()
      .describe('Restrict to fixes from these categories (default: all)'),
  },
  async ({ canvasId, categories }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const result = await evaluateCanvas(canvas, { mode: 'fast', categories });
    const fixes = result.issues
      .filter((issue) => issue.fix)
      .map((issue) => ({
        nodeId: issue.nodeId,
        category: issue.category,
        op: issue.fix!.op,
        rationale: issue.fix!.rationale,
        message: issue.message,
      }));

    return {
      content: [{ type: 'text', text: JSON.stringify({
        totalIssues: result.issues.length,
        fixableCount: fixes.length,
        fixes,
      }, null, 2) }],
    };
  }
);

// --- viewer_url ---
server.tool(
  'viewer_url',
  'Get the URL of the web-based canvas viewer. The viewer runs automatically and shows a gallery of all canvases with live auto-refresh. Share this URL with the user so they can open it in their browser.',
  {},
  async () => {
    const url = getViewerUrl();
    if (!url) return { content: [{ type: 'text', text: 'Viewer is not running' }], isError: true };

    const canvases = listCanvases();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          url,
          gallery: url,
          canvases: canvases.map((c) => ({
            name: c.name,
            viewer: `${url}/canvas/${c.id}`,
          })),
        }, null, 2),
      }],
    };
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
/** Check if a standalone viewer is already running on the given port. */
async function probeViewer(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/canvases`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  // Load any canvases persisted from previous sessions
  loadPersistedCanvases();

  // If CANVAS_VIEWER_URL is set, use that external viewer (skip starting our own)
  const externalUrl = process.env.CANVAS_VIEWER_URL;
  if (externalUrl) {
    setExternalViewerUrl(externalUrl.replace(/\/$/, ''));
    process.stderr.write(`Using external viewer at ${externalUrl}\n`);
  } else {
    // Check common ports for a standalone viewer already running
    const viewerPort = parseInt(process.env.CANVAS_VIEWER_PORT ?? '0', 10);
    const portsToProbe = viewerPort > 0 ? [viewerPort] : Array.from({ length: 20 }, (_, i) => 3001 + i);

    let foundExisting = false;
    for (const p of portsToProbe) {
      if (await probeViewer(p)) {
        setExternalViewerUrl(`http://localhost:${p}`);
        process.stderr.write(`Found standalone viewer at http://localhost:${p}, using it\n`);
        foundExisting = true;
        break;
      }
    }

    if (!foundExisting) {
      try {
        await startViewer(viewerPort);
      } catch (err) {
        process.stderr.write(`Warning: Could not start viewer: ${(err as Error).message}\n`);
      }
    }
  }

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
