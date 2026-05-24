#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvas, getCanvas, listCanvases, findNode, touchCanvas, loadPersistedCanvases, archiveCanvas, unarchiveCanvas, moveCanvas, deleteCanvas, countCanvasesInProject, ensureFresh } from './scene-graph.js';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createWorkspace, listWorkspaces, renameWorkspace, deleteWorkspace, createProject, getProject, getWorkspace, listProjects, renameProject, deleteProject, setWorkspaceDesignSystem, getWorkspaceDesignSystem, setProjectDesignSystem, getProjectDesignSystem, getCanvasTokens, getInheritedTokens, loadRepoWorkspace } from './workspaces.js';
import { DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_ID } from './types.js';
import { detectBinding, projectStartDir, readWorkspaceFile, setRepoBackend, registerRepo, migrateLegacyHome, appendBuildLog, recordPresetInBuildLog, readBuildLog } from './repo-store.js';
import { bindRepo, initWorkspace } from './bind.js';
import { parseAndExecute } from './operations.js';
import { resolveVariables, setVariables, getVariables, applyPresetTokens } from './variables.js';
import { renderToHtml } from './renderer.js';
import { takeScreenshot, computeLayout, exportToFile, takeResponsiveScreenshots, computeDiff, shutdown } from './screenshot.js';
import { listPresets, getPreset, registerPreset } from './presets.js';
import { listStructures, applyStructure, computeDiversificationHint } from './structures.js';
import { parseDesignMd } from './design-md-parser.js';
import { startViewer, getViewerUrl, setExternalViewerUrl } from './viewer.js';
import { evaluateCanvas } from './evaluate.js';
import { judgeCanvas, LLMJudgeUnavailableError } from './llm-judge.js';
import { reviseCanvas } from './reviser.js';
import { stampCritique, runReviseLoop } from './critique.js';
import type { SceneNode } from './types.js';

/** Server `instructions` — sent in the MCP initialize response and loaded into
 * the client's context on connect, so a fresh agent has framesmith's operating
 * model with zero tool calls. Keep it tight: deep guidance lives in the
 * framesmith://guidelines resource; this just orients + flags sharp edges. */
const INSTRUCTIONS = `framesmith turns a scene graph into HTML/CSS and Puppeteer screenshots — a visual design canvas for AI agents.

Read the **framesmith://guidelines** resource before drawing; it covers width strategies, responsive hints, and common patterns vs. anti-patterns.

Organizing model — Workspace > Project > Canvas:
- Canvases live in a project, projects in a workspace. A default "Personal > Untitled" always exists.
- To scope work to a code repo, call **canvas_bind** once: it stores canvases as checked-in JSON under the repo's .framesmith/ and makes that the source of truth. Heads up — bind RE-KEYS every project/canvas ID to repo-* form, so pre-bind IDs stop resolving. Re-list (project_list / canvas_list) right after binding.

Design tokens are a layered system (workspace > project > canvas). Reference them in node properties with $name (e.g. fill: "$surface"); set them with workspace_/project_/set_variables. Lower layers override higher ones — author tokens once at the workspace and inherit down.

Core loop: design at one target width (referencing $tokens) → screenshot → review → iterate → canvas_evaluate (aim ≥ 90) → canvas_autofix for mechanical spacing/contrast fixes.

Gotchas (current sharp edges):
- Prefer STRUCTURED gradient / shadows ({ stops: [...] } and [{ x, y, blur, color }]); a raw CSS string on those fields is accepted too.
- import_design_md reliably imports spacing + component skeletons; colors / typography / radius parsing is lossy — set those explicitly via set_variables.`;

const server = new McpServer({
  name: 'framesmith',
  version: '1.3.0',
}, {
  instructions: INSTRUCTIONS,
});

/** Structured workflow + gotcha lists returned by the `init` tool. Kept in step
 * with the prose in INSTRUCTIONS so an agent gets the same orientation whether
 * it reads the connect-time instructions or calls init. */
const WORKFLOW_CHEATSHEET = [
  'Read the framesmith://guidelines resource before drawing.',
  'Author at one target width; reference tokens with $name (e.g. fill: "$surface").',
  'screenshot → review the render → iterate.',
  'canvas_evaluate (aim ≥ 90) → canvas_autofix for mechanical spacing / contrast fixes.',
  'One canvas per screen / state; let the per-project build log nudge you to vary structure.',
];

const GOTCHAS = [
  'Prefer structured gradient / shadows ({ stops: [...] } and [{ x, y, blur, color }]); a raw CSS string on those fields is accepted too.',
  'import_design_md reliably imports spacing + component skeletons; set colors / typography / radius explicitly via set_variables.',
  'Binding (canvas_bind, or init on first run) re-keys every project / canvas ID to repo-* form — use the IDs init returns, never cache pre-bind IDs.',
];

const GUIDELINES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'GUIDELINES.md');

/** Phase 11 — the advisory diversification signal for a project: the last 5
 * build-log entries (newest first) plus a "differ on >= 1 axis" hint. Surfaced
 * on canvas_create and list_structures so the agent varies page shape instead of
 * defaulting to the same layout. Never throws (readBuildLog returns [] on error). */
function diversificationFor(projectId: string) {
  const recent = readBuildLog(projectId).slice(-5).reverse();
  return computeDiversificationHint(recent);
}

server.resource(
  'guidelines',
  'framesmith://guidelines',
  { description: 'Authoring guidelines: when to use fluid widths, responsive hints, and common patterns vs. anti-patterns.', mimeType: 'text/markdown' },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readFile(GUIDELINES_PATH, 'utf-8') }],
  })
);

// --- canvas_create ---
server.tool(
  'canvas_create',
  'Create a new design canvas. Returns the canvas ID, root node ID, project assignment, viewer URL, and a `diversification` signal — the recently-built structures in this project plus a hint to differ on at least one taxonomy axis, so successive canvases don\'t converge on the same layout. Always share the viewer URL with the user so they can see the design live in their browser. If `projectId` is omitted, the canvas lands in the default Untitled project.',
  {
    name: z.string().optional().describe('Name for the canvas'),
    projectId: z.string().optional().describe('Project to create the canvas in. Defaults to the built-in Untitled project. Use project_list to see available projects.'),
  },
  async ({ name, projectId }) => {
    if (projectId && !getProject(projectId)) {
      return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found. Use project_list to see available projects.` }], isError: true };
    }
    const canvas = createCanvas(name, projectId ?? DEFAULT_PROJECT_ID);
    const viewerUrl = getViewerUrl();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            canvasId: canvas.id,
            rootId: canvas.root.id,
            name: canvas.name,
            projectId: canvas.projectId,
            viewerUrl: viewerUrl ? `${viewerUrl}/canvas/${canvas.id}` : null,
            galleryUrl: viewerUrl,
            diversification: diversificationFor(canvas.projectId),
          }, null, 2),
        },
      ],
    };
  }
);

// --- canvas_list ---
server.tool(
  'canvas_list',
  'List canvases. By default returns all non-archived canvases. Filter by `projectId` to scope to one project. Set `includeArchived: true` to include archived canvases in the result.',
  {
    projectId: z.string().optional().describe('Only list canvases in this project'),
    includeArchived: z.boolean().optional().describe('Include archived canvases in the result (default false)'),
  },
  async ({ projectId, includeArchived }) => {
    let canvases = listCanvases();
    if (projectId) canvases = canvases.filter((c) => c.projectId === projectId);
    if (!includeArchived) canvases = canvases.filter((c) => !c.archived);
    return {
      content: [{ type: 'text', text: JSON.stringify(canvases, null, 2) }],
    };
  }
);

// --- canvas_move ---
server.tool(
  'canvas_move',
  'Move a canvas to a different project. The canvas keeps its ID; only the projectId field changes.',
  {
    canvasId: z.string().describe('Canvas to move'),
    projectId: z.string().describe('Target project. Must already exist (use project_list / project_create).'),
  },
  async ({ canvasId, projectId }) => {
    if (!getCanvas(canvasId)) return { content: [{ type: 'text', text: `Error: Canvas "${canvasId}" not found` }], isError: true };
    if (!getProject(projectId)) return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
    const moved = moveCanvas(canvasId, projectId)!;
    return { content: [{ type: 'text', text: JSON.stringify({ canvasId, projectId: moved.projectId }, null, 2) }] };
  }
);

// --- canvas_archive ---
server.tool(
  'canvas_archive',
  'Soft-delete a canvas: sets `archived: true` and hides it from default canvas_list output. The canvas stays in storage and can be restored with canvas_unarchive. Use canvas_delete for permanent removal.',
  { canvasId: z.string().describe('Canvas to archive') },
  async ({ canvasId }) => {
    const result = archiveCanvas(canvasId);
    if (!result) return { content: [{ type: 'text', text: `Error: Canvas "${canvasId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify({ canvasId, archived: true, archivedAt: result.archivedAt }, null, 2) }] };
  }
);

// --- canvas_unarchive ---
server.tool(
  'canvas_unarchive',
  'Restore an archived canvas (clears the archived flag). The reverse of canvas_archive.',
  { canvasId: z.string().describe('Canvas to unarchive') },
  async ({ canvasId }) => {
    const result = unarchiveCanvas(canvasId);
    if (!result) return { content: [{ type: 'text', text: `Error: Canvas "${canvasId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify({ canvasId, archived: false }, null, 2) }] };
  }
);

// --- canvas_delete ---
server.tool(
  'canvas_delete',
  'Permanently delete a canvas — removes both the in-memory entry and the on-disk JSON file. Irreversible; use canvas_archive for soft deletion.',
  { canvasId: z.string().describe('Canvas to permanently delete') },
  async ({ canvasId }) => {
    if (!getCanvas(canvasId)) return { content: [{ type: 'text', text: `Error: Canvas "${canvasId}" not found` }], isError: true };
    deleteCanvas(canvasId);
    return { content: [{ type: 'text', text: JSON.stringify({ canvasId, deleted: true }, null, 2) }] };
  }
);

// --- workspace_create ---
server.tool(
  'workspace_create',
  'Create a new workspace. Workspaces are top-level containers grouping related projects; the default "Personal" workspace ships built-in.',
  { name: z.string().describe('Workspace name') },
  async ({ name }) => {
    const ws = createWorkspace(name);
    return { content: [{ type: 'text', text: JSON.stringify(ws, null, 2) }] };
  }
);

// --- workspace_list ---
server.tool(
  'workspace_list',
  'List all workspaces. The built-in "Personal" workspace is always present.',
  {},
  async () => {
    return { content: [{ type: 'text', text: JSON.stringify(listWorkspaces(), null, 2) }] };
  }
);

// --- workspace_rename ---
server.tool(
  'workspace_rename',
  'Rename an existing workspace.',
  {
    workspaceId: z.string().describe('Workspace to rename'),
    name: z.string().describe('New workspace name'),
  },
  async ({ workspaceId, name }) => {
    const ws = renameWorkspace(workspaceId, name);
    if (!ws) return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(ws, null, 2) }] };
  }
);

// --- workspace_delete ---
server.tool(
  'workspace_delete',
  'Delete a workspace. Refuses if the workspace still contains projects — move or delete those first. The built-in "Personal" workspace cannot be deleted.',
  { workspaceId: z.string().describe('Workspace to delete') },
  async ({ workspaceId }) => {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      return { content: [{ type: 'text', text: 'Error: the built-in "Personal" workspace cannot be deleted.' }], isError: true };
    }
    const projectsInWorkspace = listProjects(workspaceId);
    if (projectsInWorkspace.length > 0) {
      return { content: [{ type: 'text', text: `Error: workspace "${workspaceId}" still contains ${projectsInWorkspace.length} project(s). Delete or move them before deleting the workspace.` }], isError: true };
    }
    const ok = deleteWorkspace(workspaceId);
    if (!ok) return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify({ workspaceId, deleted: true }, null, 2) }] };
  }
);

// --- project_create ---
server.tool(
  'project_create',
  'Create a new project inside a workspace. Projects group related canvases.',
  {
    workspaceId: z.string().describe('Workspace the project belongs to'),
    name: z.string().describe('Project name'),
  },
  async ({ workspaceId, name }) => {
    const project = createProject(workspaceId, name);
    if (!project) return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
  }
);

// --- project_list ---
server.tool(
  'project_list',
  'List projects. Pass `workspaceId` to scope to one workspace; omit to list all projects across all workspaces.',
  { workspaceId: z.string().optional().describe('Filter by workspace') },
  async ({ workspaceId }) => {
    return { content: [{ type: 'text', text: JSON.stringify(listProjects(workspaceId), null, 2) }] };
  }
);

// --- project_rename ---
server.tool(
  'project_rename',
  'Rename an existing project.',
  {
    projectId: z.string().describe('Project to rename'),
    name: z.string().describe('New project name'),
  },
  async ({ projectId, name }) => {
    const project = renameProject(projectId, name);
    if (!project) return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
  }
);

// --- project_delete ---
server.tool(
  'project_delete',
  'Delete a project. Refuses if the project still contains any canvases (archived or not) — move them to another project (canvas_move) or delete them (canvas_delete) first. The built-in "Untitled" project cannot be deleted.',
  { projectId: z.string().describe('Project to delete') },
  async ({ projectId }) => {
    if (projectId === DEFAULT_PROJECT_ID) {
      return { content: [{ type: 'text', text: 'Error: the built-in "Untitled" project cannot be deleted.' }], isError: true };
    }
    const count = countCanvasesInProject(projectId);
    if (count > 0) {
      return { content: [{ type: 'text', text: `Error: project "${projectId}" still contains ${count} canvas(es). Move or delete them before deleting the project.` }], isError: true };
    }
    const ok = deleteProject(projectId);
    if (!ok) return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify({ projectId, deleted: true }, null, 2) }] };
  }
);

// --- Phase 9: design system inheritance ---
// Workspace-level tokens are inherited by every project + canvas under the
// workspace; project-level tokens override workspace and are themselves
// overridden by canvas.variables. Resolution chain at render is
// workspace → project → canvas (rightmost wins).

const designVariablesSchema = z.object({
  colors: z.record(z.string()).optional(),
  spacing: z.record(z.number()).optional(),
  radius: z.record(z.number()).optional(),
  typography: z.record(z.object({
    fontSize: z.number(),
    fontWeight: z.union([z.string(), z.number()]).optional(),
    fontFamily: z.string().optional(),
    lineHeight: z.union([z.number(), z.string()]).optional(),
  })).optional(),
});

// --- workspace_set_design_system ---
server.tool(
  'workspace_set_design_system',
  'Set the workspace-level design system (inherited by every project + canvas under it). Merges per-category with existing tokens — pass `{ colors: { primary: "#..." } }` to update colors without resetting spacing/radius/typography.',
  {
    workspaceId: z.string().describe('Workspace ID'),
    variables: designVariablesSchema.describe('Design tokens to set'),
  },
  async ({ workspaceId, variables }) => {
    if (!getWorkspace(workspaceId)) return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
    const result = setWorkspaceDesignSystem(workspaceId, variables);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- workspace_get_design_system ---
server.tool(
  'workspace_get_design_system',
  'Get the workspace-level design system tokens.',
  { workspaceId: z.string().describe('Workspace ID') },
  async ({ workspaceId }) => {
    if (!getWorkspace(workspaceId)) return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(getWorkspaceDesignSystem(workspaceId) ?? {}, null, 2) }] };
  }
);

// --- workspace_apply_preset ---
server.tool(
  'workspace_apply_preset',
  'Apply a built-in style guide preset (dark/light/material/minimal) to a workspace. Merges the preset\'s tokens into the workspace design system — every canvas under it inherits them. Components from the preset are NOT copied at the workspace level (component instancing is canvas-scoped). Use list_presets to see options.',
  {
    workspaceId: z.string().describe('Workspace ID'),
    preset: z.string().describe('Preset name (e.g. "dark", "light", "material", "minimal")'),
  },
  async ({ workspaceId, preset }) => {
    if (!getWorkspace(workspaceId)) return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
    const p = getPreset(preset);
    if (!p) return { content: [{ type: 'text', text: `Error: Preset "${preset}" not found. Use list_presets to see options.` }], isError: true };
    const result = setWorkspaceDesignSystem(workspaceId, p.variables);
    return { content: [{ type: 'text', text: JSON.stringify({ workspaceId, preset, designSystem: result }, null, 2) }] };
  }
);

// --- project_set_design_system ---
server.tool(
  'project_set_design_system',
  'Set the project-level design system, which sits between the parent workspace and individual canvases in the resolution chain. Merges per-category with existing project tokens.',
  {
    projectId: z.string().describe('Project ID'),
    variables: designVariablesSchema.describe('Design tokens to set'),
  },
  async ({ projectId, variables }) => {
    if (!getProject(projectId)) return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
    const result = setProjectDesignSystem(projectId, variables);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- project_get_design_system ---
server.tool(
  'project_get_design_system',
  'Get the project-level design system tokens (project-only overrides, not the merged inheritance chain).',
  { projectId: z.string().describe('Project ID') },
  async ({ projectId }) => {
    if (!getProject(projectId)) return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(getProjectDesignSystem(projectId) ?? {}, null, 2) }] };
  }
);

// --- project_apply_preset ---
server.tool(
  'project_apply_preset',
  'Apply a built-in style guide preset (dark/light/material/minimal) to a project. Merges the preset\'s tokens into the project design system. The project sits between workspace and canvas in the resolution chain.',
  {
    projectId: z.string().describe('Project ID'),
    preset: z.string().describe('Preset name (e.g. "dark", "light", "material", "minimal")'),
  },
  async ({ projectId, preset }) => {
    if (!getProject(projectId)) return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
    const p = getPreset(preset);
    if (!p) return { content: [{ type: 'text', text: `Error: Preset "${preset}" not found. Use list_presets to see options.` }], isError: true };
    const result = setProjectDesignSystem(projectId, p.variables);
    return { content: [{ type: 'text', text: JSON.stringify({ projectId, preset, designSystem: result }, null, 2) }] };
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
Returns { ok, nodeIds, results }: nodeIds maps each bound variable to the node ID it created (e.g. { "header": "n_a1b2" }) — record it and use those IDs to target nodes in later calls (bindings only live within a single call). results lists each op's outcome in order.

Node types: frame, text, rectangle, ellipse, image, icon, path, component, instance
Properties: fill, gradient, stroke, strokeWidth, cornerRadius, width, height, minWidth, maxWidth, layout ("horizontal"|"vertical"), gap, padding, alignItems, justifyContent, fontSize, fontFamily, fontWeight, color, content, src, objectFit, opacity, shadow, shadows, blur, backdropBlur, backdropFilter, overflow, wrap, position, x, y, icon, iconSize, iconColor, d, viewBox, strokeLinecap, strokeLinejoin, animation, transition, componentId, overrides, responsive

Responsive layout (author desktop-first, adapt down):
  - responsive: "stack" — on a horizontal container, flips to vertical below 768px (multi-column layouts that should stack on mobile)
  - responsive: "wrap" — children wrap to the next line instead of overflowing (card grids, tag rows)
  - responsive: "fixed" — never reflows (toolbars, fixed-position headers)
Prefer fluid widths (percentages, "fit-content") + a "responsive" hint over hardcoded pixel widths. width/minWidth/maxWidth accept numbers (px) or strings ("100%", "50vw", "fit-content"). Combine a percentage width with a maxWidth ceiling for content that fills the row but caps on wide screens (e.g. width: "100%", maxWidth: 600).

Read the framesmith://guidelines resource for common patterns (pricing tiers, two-column hero, tag list, toolbar), anti-patterns, and width-strategy guidance.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    operations: z.string().describe('Operations to execute, one per line'),
  },
  async ({ canvasId, operations }) => {
    ensureFresh(canvasId); // reload if the file changed on disk (git pull / hand-edit) before we mutate
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const results = parseAndExecute(canvas.root, operations, canvas);
    touchCanvas(canvasId);
    // Map each bound variable to the node ID it created, so the agent can target
    // the right nodes in follow-up U/D/M ops without counting result positions.
    const nodeIds: Record<string, string> = {};
    for (const r of results) if (r.ok && r.binding && r.nodeId) nodeIds[r.binding] = r.nodeId;
    const viewerUrl = getViewerUrl();
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ok: results.every((r) => r.ok), nodeIds, results }, null, 2) },
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

    const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
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

    const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
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
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    const result = setVariables(canvas, variables);
    touchCanvas(canvasId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// --- get_fonts ---
server.tool(
  'get_fonts',
  'Get the custom font face declarations attached to a canvas.',
  { canvasId: z.string().describe('Canvas ID') },
  async ({ canvasId }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(canvas.fonts ?? [], null, 2) }] };
  }
);

// --- set_fonts ---
server.tool(
  'set_fonts',
  'Replace the custom font face declarations on a canvas. Each entry needs `family` (CSS family name, no quotes) and `url` (https://, http://, or data: URI pointing at a .woff2/.woff/.ttf/.otf binary). Google Fonts CSS stylesheet URLs (fonts.googleapis.com/css2) are NOT supported — use the gstatic.com binary URL directly. Pass an empty array to clear.',
  {
    canvasId: z.string().describe('Canvas ID'),
    fonts: z.array(z.object({
      family: z.string().min(1).describe('CSS font-family name (no surrounding quotes)'),
      url: z.string().regex(/^(https?:\/\/|data:)/i).describe('Direct font binary URL'),
      weight: z.union([z.string(), z.number()]).optional().describe('font-weight (e.g. 400, 700, "bold")'),
      style: z.enum(['normal', 'italic']).optional(),
    })).describe('Font declarations. Replaces existing fonts wholesale.'),
  },
  async ({ canvasId, fonts }) => {
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    const unsafeFamily = /["';{}\n\r<>]/;
    const unsafeUrl = /["\n\r<>]/;
    const bad = fonts.find((f) => unsafeFamily.test(f.family) || unsafeUrl.test(f.url));
    if (bad) return { content: [{ type: 'text', text: `Error: Unsafe characters in font ${JSON.stringify(bad)} — family must not contain quotes/semicolons/braces/angle brackets/newlines; url must not contain quotes/newlines/angle brackets.` }], isError: true };
    canvas.fonts = fonts;
    touchCanvas(canvasId);
    return { content: [{ type: 'text', text: JSON.stringify(canvas.fonts, null, 2) }] };
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

    const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
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

    const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
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

    const resolved1 = resolveVariables(canvas1.root, getCanvasTokens(canvas1));
    const resolved2 = resolveVariables(canvas2.root, getCanvasTokens(canvas2));
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

// --- list_structures ---
server.tool(
  'list_structures',
  'List available layout structures — named page scaffolds (e.g. marquee-hero, bento-grid) you stamp onto a canvas and then populate. Each is tagged on four taxonomy axes (heroTreatment, density, rhythm, alignment) so you can deliberately vary page shape rather than defaulting to the same layout. Distinct from presets: structures define layout skeleton, presets define color/token theme. Pass projectId to also get a diversification signal (recently-built structures + a hint to differ) so you pick a shape that contrasts with recent work. Apply one with apply_structure, then screenshot and verify before populating.',
  {
    projectId: z.string().optional().describe('If given, also return a diversification signal for this project: the recently-built structures and a hint to differ on >= 1 taxonomy axis. Use project_list to see projects.'),
  },
  async ({ projectId }) => {
    const structures = listStructures();
    if (!projectId) {
      return { content: [{ type: 'text', text: JSON.stringify(structures, null, 2) }] };
    }
    if (!getProject(projectId)) {
      return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found. Use project_list to see available projects.` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ structures, diversification: diversificationFor(projectId) }, null, 2) }] };
  }
);

// --- apply_structure ---
server.tool(
  'apply_structure',
  'Stamp a layout structure (see list_structures) onto a canvas: inserts the named scaffold of labeled placeholder nodes under the canvas root and records provenance. Refuses if the root already has content unless replace is true (which clears it first). Seeds neutral default colors so the scaffold renders even before a preset is applied. Returns the placeholder node ids to populate — fill them with batch_design U ops, then call screenshot to verify the layout.',
  {
    canvasId: z.string().describe('Canvas ID'),
    structure: z.string().describe('Structure name (use list_structures, e.g. marquee-hero, bento-grid)'),
    replace: z.boolean().optional().describe('If the root already has children, clear them before stamping. Default false (refuses on a non-empty canvas).'),
  },
  async ({ canvasId, structure, replace }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    try {
      const existingColors = new Set(Object.keys(getCanvasTokens(canvas).colors ?? {}));
      const result = applyStructure(canvas, structure, { replace, existingColors });
      // Record provenance in the per-project build log (feeds the diversification
      // signal). applyStructure stamped canvas.metadata.provenance just above.
      const prov = canvas.metadata?.provenance;
      if (prov) appendBuildLog(canvas.projectId, { ...prov, canvasId: canvas.id, canvasName: canvas.name });
      touchCanvas(canvasId);
      return { content: [{ type: 'text', text: JSON.stringify({
        ...result,
        instruction: 'Populate each placeholder by id with batch_design U ops (replace the role-labeled content), then call screenshot to verify the layout before refining.',
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- apply_preset ---
server.tool(
  'apply_preset',
  "Apply a style guide preset to a canvas. Merges the preset's design tokens into the canvas variables and copies in any reusable components (button, card, badge) the preset defines. Tokens the canvas inherits from the workspace/project design system are preserved (and reported as `preservedFromDesignSystem`) instead of being silently overwritten — set them explicitly with set_variables if you want the preset's values.",
  {
    canvasId: z.string().describe('Canvas ID'),
    preset: z.string().describe('Preset name (dark, light, material, minimal)'),
  },
  async ({ canvasId, preset }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const p = getPreset(preset);
    if (!p) return { content: [{ type: 'text', text: `Error: Preset "${preset}" not found. Use list_presets to see available presets.` }], isError: true };

    const merge = applyPresetTokens(canvas, p.variables, getInheritedTokens(canvas));

    const components: string[] = [];
    if (p.components) {
      for (const [key, node] of Object.entries(p.components)) {
        canvas.components[key] = structuredClone(node);
        components.push(key);
      }
    }

    // Record the preset in the canvas provenance stamp + per-project build log.
    // Merges onto any existing structure provenance; creates a minimal entry if
    // the preset lands on a hand-built canvas with no prior provenance (A-T3).
    canvas.metadata = {
      ...canvas.metadata,
      provenance: { ...canvas.metadata?.provenance, preset, at: new Date().toISOString() },
    };
    recordPresetInBuildLog(canvas.projectId, canvas.id, canvas.name, preset);

    touchCanvas(canvasId);
    const out: Record<string, unknown> = { applied: preset, variables: merge.variables, components };
    if (merge.preserved.length) {
      out.preservedFromDesignSystem = merge.preserved;
      out.note = `Kept ${merge.preserved.length} token(s) inherited from the workspace/project design system rather than overwriting them with the preset's. Set them explicitly via set_variables if you do want the preset values.`;
    }
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
);

// --- import_design_md ---
server.tool(
  'import_design_md',
  `Import a DESIGN.md file as a design system preset: extracts colors, typography, spacing, border radius, and reusable component skeletons (button, card, badge). After importing, use apply_preset to apply it to a canvas. Accepts a file path or raw content.

Tokens are read from a heading section per category (heading matched loosely, e.g. "Colors" / "Color Palette", "Spacing", "Border Radius" / "Radius", "Typography"). Within a section each of these token formats is accepted:
- list item — \`- name: value\`
- table row — \`| name | value |\`
- key/value — \`name: value\` or \`**name** (\`value\`)\`
where value is a color (\`#hex\`, \`rgba(...)\`) for colors, \`Npx\` for spacing/radius, and \`Npx\` (optionally \`/ weight\`) for typography. Named spacing tokens (\`md: 12px\`) are honored verbatim; only when none are given AND a "Base unit: Npx" is stated is a scale synthesized — nothing is fabricated otherwise. Radius accepts scale names (sm/md/lg/xl/full/pill).`,
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
  `Auto-score a design canvas against quality criteria. Returns an overall score (0-100), category scores, and actionable issues referencing specific node IDs. Categories: spacing, color, typography, structure, consistency (craft), plus "cliche" — the machine-made tells: default purple/indigo accents, gradient/glow overuse, fake browser/phone chrome (traffic-light dots), the hanging eyebrow-beside-heading header, and fabricated-looking metrics/testimonials/logos. cliche issues carry a "tell" discriminator and are advisory (warning/info). Modes:
  - "fast": JSON-only, <100ms, deterministic heuristics only.
  - "detailed": adds Puppeteer-based pixel overlap detection in the consistency category.
  - "llm": fast-mode heuristics plus a vision-model critique against a FIXED rubric (provider picked from FRAMESMITH_LLM_PROVIDER env var, or whichever of ANTHROPIC_API_KEY / OPENAI_API_KEY is set). Adds an "llmCritique" field: { rubric: { hierarchy, execution, specificity, restraint, variety } each {score 1-5, rationale}, score (0-100 derived), summary, suggestions, needsRevision, failingAxes }. The verdict is stamped on the canvas (metadata.critique) + the per-project build log for auditability. Cost: one paid API call per invocation. To CLOSE the loop and auto-fix failing axes, use canvas_revise.
Designed for generator-evaluator loops: generate with batch_design, evaluate with canvas_evaluate, fix issues targeting the returned nodeIds (canvas_autofix handles the mechanical subset).`,
  {
    canvasId: z.string().describe('Canvas ID to evaluate'),
    mode: z.enum(['fast', 'detailed', 'llm']).default('fast').describe('"fast" = JSON-only (<100ms), "detailed" = + Puppeteer layout checks, "llm" = fast + vision-model rubric critique'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche']))
      .optional()
      .describe('Specific categories to evaluate (default: all)'),
    genre: z.string().optional()
      .describe('Genre/style that relaxes specific cliche gates (e.g. "material" allows purple). Defaults to the canvas provenance preset if stamped.'),
    floor: z.number().min(1).max(5).optional()
      .describe('llm mode only: per-axis rubric floor (1-5). Any axis below it sets needsRevision. Default 3 (or FRAMESMITH_CRITIQUE_FLOOR).'),
  },
  async ({ canvasId, mode, categories, genre, floor }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const result = await evaluateCanvas(canvas, { mode, categories, genre });

    if (mode === 'llm') {
      try {
        const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
        const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
        const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
        const html = renderToHtml(resolved, w, h, canvas);
        const screenshotPng = await takeScreenshot(html, { width: w, height: h, scale: 1 });
        const critique = await judgeCanvas(screenshotPng, { floor });
        result.llmCritique = critique;
        stampCritique(canvas, critique);
        touchCanvas(canvasId);
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
  `Run canvas_evaluate in fast mode and return the subset of issues that have a mechanically derived fix (off-scale spacing → snap to scale; missing layout on multi-child frame → set vertical; recoverable WCAG contrast failure → switch text to #000 or #FFF, whichever wins; default-purple accent → swap to a neutral accent; fake-chrome strip → delete). Each fix carries a ready-to-paste \`batch_design\` op string and a one-line rationale. Taste-dependent cliche tells (gradient/glow overuse, the hanging header, fabricated content) carry a suggestion but no auto-fix — call canvas_evaluate to see those. Closes the generator-evaluator loop: generate with batch_design → autofix → re-evaluate.`,
  {
    canvasId: z.string().describe('Canvas ID to autofix'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche']))
      .optional()
      .describe('Restrict to fixes from these categories (default: all)'),
    genre: z.string().optional()
      .describe('Genre/style that relaxes specific cliche gates (e.g. "material" allows purple). Defaults to the canvas provenance preset if stamped.'),
  },
  async ({ canvasId, categories, genre }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const result = await evaluateCanvas(canvas, { mode: 'fast', categories, genre });
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

// --- canvas_revise ---
server.tool(
  'canvas_revise',
  `Close the critique loop. Judge the canvas against the rubric (the same one canvas_evaluate mode:"llm" uses); if any axis is below the floor, ask an LLM to emit targeted batch_design ops that raise the failing axes, apply them, re-render, and re-judge — up to maxIterations passes. Stops early when the canvas passes, when a pass does not improve the overall score (the worse edit is reverted), or at the iteration cap. MUTATES the canvas; each accepted pass re-stamps metadata.critique + the build log. Costs >=2 paid API calls per pass (one judge + one revise) and renders between passes (Chrome required). Opt-in — never runs implicitly. Returns an iteration log (ops applied + before/after overall per pass), the final verdict, and why it stopped.`,
  {
    canvasId: z.string().describe('Canvas ID to revise'),
    maxIterations: z.number().min(1).max(3).optional().describe('Max revise passes (1-3, default 1).'),
    floor: z.number().min(1).max(5).optional().describe('Per-axis rubric floor (1-5). Default 3 (or FRAMESMITH_CRITIQUE_FLOOR).'),
    provider: z.enum(['anthropic', 'openai']).optional().describe('Force an LLM provider; default auto-detect from env.'),
  },
  async ({ canvasId, maxIterations, floor, provider }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const render = async () => {
      const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
      const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
      const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
      return takeScreenshot(renderToHtml(resolved, w, h, canvas), { width: w, height: h, scale: 1 });
    };

    try {
      const result = await runReviseLoop(canvas, { maxIter: maxIterations ?? 1 }, {
        render,
        judge: (png) => judgeCanvas(png, { floor, provider }),
        revise: (args) => reviseCanvas(args, provider),
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err instanceof LLMJudgeUnavailableError ? err.message : `canvas_revise failed: ${(err as Error).message}`;
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
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

// --- canvas_bind (Phase 10) ---
server.tool(
  'canvas_bind',
  "Bind a workspace to the current project directory so its canvases live in the repo as open JSON — a `.framesmith/` directory checked in alongside the code, instead of the global ~/.framesmith store. Creates `.framesmith/workspace.json` (binding + design system) and one subdirectory per project holding one slug-named file per canvas, migrates the workspace's projects + canvases in, and makes the repo the source of truth for the rest of the session. Heads up: binding RE-KEYS every project and canvas ID to repo-* form, so IDs captured before the bind stop resolving — re-list with project_list / canvas_list afterward (or prefer the `init` tool, which binds and returns the fresh IDs in one call). Run once per repo; afterwards the server auto-detects `.framesmith/` on startup. Commit the `.framesmith/` directory so designs travel with the code and diff in review.",
  {
    workspaceId: z.string().optional().describe('Workspace whose projects + canvases migrate into the repo. Defaults to the built-in Personal workspace. Use workspace_list to see available workspaces.'),
    dir: z.string().optional().describe('Directory to bind. Defaults to the nearest git repo root above the server working directory.'),
  },
  async ({ workspaceId, dir }) => {
    const result = bindRepo({ workspaceId, dir });
    if (!result.ok) return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          bound: true,
          repoRoot: result.root,
          canvasDir: result.dir,
          workspace: result.workspace,
          projectsMigrated: result.projects,
          canvasesMigrated: result.migrated,
          note: 'Repo is now the source of truth. Commit the .framesmith/ directory to share these designs.',
        }, null, 2),
      }],
    };
  }
);

// --- init (Phase 15 — agent onboarding) ---
server.tool(
  'init',
  "One-call onboarding — safe to run first thing every session (idempotent). Binds the current repo if it isn't already (so canvases live as checked-in JSON under .framesmith/), ensures the convention projects exist (default: a Foundations style-guide project + a UI catch-all), and returns the LIVE state the rest of the session needs: resolved workspace + project IDs, the on-disk layout, a workflow cheatsheet, the current gotchas, and the guidelines resource URI. Binding re-keys IDs, so the IDs this returns are the ones to use — don't cache pre-bind IDs. `projects` names the projects to ensure exist (default when omitted: Foundations + UI); existing projects are never removed, so it's safe for adding feature/area projects like Onboarding or Settings. Does not seed design tokens — set those at the workspace layer with workspace_set_design_system.",
  {
    dir: z.string().optional().describe('Directory to bind / detect. Defaults to the nearest git repo root above the server working directory.'),
    workspaceName: z.string().optional().describe('Name for the workspace when binding fresh. Defaults to the repo folder name.'),
    projects: z.array(z.string()).optional().describe('Convention project names to ensure exist. Defaults to ["Foundations", "UI"].'),
  },
  async ({ dir, workspaceName, projects }) => {
    const result = initWorkspace({ dir, workspaceName, projects });
    if (!result.ok) return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          bound: true,
          workspace: result.workspace,
          projects: result.projects,
          projectsCreatedThisCall: result.projectsCreated,
          designSystem: {
            layer: 'workspace',
            tokenCount: result.designSystemTokenCount,
            note: 'Tokens live at the workspace layer (set via workspace_set_design_system) and inherit down to projects/canvases; the Foundations project is just a canvas that visualizes them.',
          },
          workflow: WORKFLOW_CHEATSHEET,
          gotchas: GOTCHAS,
          guidelinesResource: 'framesmith://guidelines',
          viewerUrl: getViewerUrl(),
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
  // One-time migration of the pre-rebrand global store (~/.canvas-mcp → ~/.framesmith).
  migrateLegacyHome();

  // Phase 10: if the working directory (or an ancestor) carries a `.framesmith/`
  // binding, the repo is the source of truth — load its virtual workspace +
  // project and canvases from there, never touching the global store.
  const binding = detectBinding(projectStartDir());
  const repoFile = binding ? readWorkspaceFile(binding.dir) : null;
  if (binding && repoFile) {
    setRepoBackend(binding.root, binding.dir);
    loadRepoWorkspace(repoFile);
    loadPersistedCanvases();
    registerRepo(binding.dir); // self-register so the standalone viewer mirrors this repo
    process.stderr.write(`framesmith bound to repo: ${binding.dir}\n`);
  } else {
    // Phase 7 boot order matters: workspaces+projects load first so the default
    // workspace/project exist, then canvas migration can assign DEFAULT_PROJECT_ID
    // to any pre-Phase-7 canvases that lack a projectId.
    loadPersistedWorkspaces();
    ensureDefaultWorkspaceAndProject();
    loadPersistedCanvases();
  }

  // If FRAMESMITH_VIEWER_URL is set, use that external viewer (skip starting our own)
  const externalUrl = process.env.FRAMESMITH_VIEWER_URL ?? process.env.CANVAS_VIEWER_URL;
  if (externalUrl) {
    setExternalViewerUrl(externalUrl.replace(/\/$/, ''));
    process.stderr.write(`Using external viewer at ${externalUrl}\n`);
  } else {
    // Check common ports for a standalone viewer already running
    const viewerPort = parseInt(process.env.FRAMESMITH_VIEWER_PORT ?? process.env.CANVAS_VIEWER_PORT ?? '0', 10);
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
  console.error('Failed to start framesmith:', err);
  process.exit(1);
});
