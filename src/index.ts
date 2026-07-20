#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvas, getCanvas, listCanvases, findNode, touchCanvas, loadPersistedCanvases, archiveCanvas, unarchiveCanvas, moveCanvas, deleteCanvas, countCanvasesInProject, ensureFresh, collectMatchingNodes, replaceMatchingProperties, findNodesDetailed } from './scene-graph.js';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createWorkspace, listWorkspaces, renameWorkspace, deleteWorkspace, createProject, getProject, getWorkspace, listProjects, renameProject, deleteProject, setWorkspaceDesignSystem, getWorkspaceDesignSystem, setProjectDesignSystem, getProjectDesignSystem, getCanvasTokens, getInheritedTokens, loadRepoWorkspace } from './workspaces.js';
import { DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_ID } from './types.js';
import { detectBinding, projectStartDir, readWorkspaceFile, setRepoBackend, registerRepo, migrateLegacyHome, appendBuildLog, recordPresetInBuildLog, readBuildLog } from './repo-store.js';
import { bindRepo, initWorkspace } from './bind.js';
import { parseAndExecute } from './operations.js';
import { resolveVariables, setVariables, getVariables, applyPresetTokens } from './variables.js';
import { renderToHtml, type RenderOptions } from './renderer.js';
import { ensureFontsForRender, bodyFontFamilyFromTokens, resolveFamily, warmFamilies, resolveStylesheetUrl, isStylesheetUrl, collectReferencedFamilies } from './fonts.js';
import { takeScreenshot, computeLayout, exportToFile, takeResponsiveScreenshots, computeDiff, shutdown } from './screenshot.js';
import { listPresets, getPreset, registerPreset } from './presets.js';
import { listStructures, applyStructure, computeDiversificationHint } from './structures.js';
import { parseDesignMd } from './design-md-parser.js';
import { listFeedback, resolveFeedback, openFeedbackCount, appendFeedbackDirective } from './feedback.js';
import { importHtml, importUrl, renderImportedTree, snapToTokens } from './import.js';
import { startViewer, getViewerUrl, setExternalViewerUrl } from './viewer.js';
import { evaluateCanvas } from './evaluate.js';
import { judgeCanvas, LLMJudgeUnavailableError } from './llm-judge.js';
import { reviseCanvas } from './reviser.js';
import { stampCritique, runReviseLoop } from './critique.js';
import type { Canvas, FontFace, SceneNode } from './types.js';

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

Your job is to craft beautiful UI with real UX — designs a designer would sign off on — not wireframes. The bar is non-negotiable, and polishing to it is YOUR work, never the user's.

Core loop: start from a taste-vetted pattern (list_structures → apply_structure) — never a blank canvas → adapt at one target width (referencing $tokens), using framesmith's real capabilities below → screenshot → canvas_evaluate → resolve EVERY comment it returns (canvas_autofix for the mechanical subset, batch_design for the rest) → re-evaluate → repeat until the inspector is CLEAN (zero comments) and the score is > 95. ONLY THEN present to the user. Never show a design with open comments or a sub-bar score — the evaluate result tells you when it's safe to present. The "Designing with taste" guidelines cover the do's (one focal point, real hierarchy, one type + spacing scale, restraint); the cliche category catches the don'ts.

Use the whole toolkit by default — a real UI uses these, so a good design must too (not only when asked): icons, fonts, controls, components, $tokens. Don't FAKE them (no Unicode-glyph icons, no ellipse "toggles") and don't OMIT them where a real UI has them — nav rows get a leading icon, metrics get an icon, feature lists get check icons, empty states get a glyph, forms use real controls. Starting from a pattern gives you all of this for free.

Icons & typography: two bundled icon sets render by name via the icon node type — Lucide ({ type: "icon", icon: "search" }) and Material Symbols (icon: "material:check", optional iconStyle outlined/rounded/sharp, "-fill" suffix for filled variants) — never fake icons with Unicode glyphs. Text nodes support letterSpacing / textTransform / fontVariationSettings — use textTransform: "uppercase" instead of baking casing into content. Input controls (toggle / checkbox / radio / select) are real node types ({ type: "toggle", checked: true }) styled from design tokens — never fake a control from frames + ellipses.

Fonts load by name: set fontFamily in a typography token (or on a node) and the renderer resolves it from Google Fonts automatically (cached in ~/.framesmith/fonts/ — offline after first use). typography.body.fontFamily becomes the document default. Heed "Font warnings" in screenshot results — a warned family is rendering in the fallback stack, not the face you named. set_fonts is only needed for non-Google sources.

Structures come in two kinds (list_structures): page scaffolds (marquee-hero, bento-grid, stat-led, editorial-longform, split-workbench, catalogue, dashboard, auth, pricing, settings, onboarding) stamp once at the root — each is taste-vetted (> 95, zero cliché tells) so it's a non-slop starting point to ADAPT, not boilerplate; component scaffolds (data-table, form-field, toolbar, stat-card, toggle-row) stamp under any targetId, repeatably, returning an idMap — a data table is one apply_structure call, not 80 nodes.

Import from implementation: canvas_import_html (snippet + optional CSS) and canvas_import_url (live page — viewport/selector/waitFor/auth) turn shipped UI into an editable, TOKEN-MAPPED canvas — flex→frames, text runs, imgs, recognized SVGs→icons, checkboxes/switches/selects→input primitives; Tailwind classes map to intent (bg-surface → fill "$surface") and literal colors snap to the design system. STRUCTURE reconstructs too: <table> → rows of proportional columns, CSS grid → rows from the computed template, centered/max-width content stays centered, other multi-column CSS clusters by geometry — report.layout records how each container was handled (table|grid|centered|geometry|stack-fallback; a stack-fallback entry = hand-fix that one container, everything else arrived structurally correct). canvas_sync_from_url then keeps the contract honest: ephemeral re-import + pixel diff = "has the app drifted from the approved design?" as a changePercent. Lossy by design: READ the returned report (snapped/literals/layout/warnings) instead of assuming fidelity.

Bulk edits & queries: replace_matching_properties applies one property change to EVERY node matching a value predicate in a single call (scope subtree + node-type filters; dryRun previews the match set first) — reach for it instead of hand-writing one batch_design U() per node when the same change spans many nodes (table cells, repeated cards). find_nodes is its read-only twin: locate nodes by property/text/name ("which node holds $1.52M?") and get ids + readable paths back — use it before targeted edits instead of guessing ids from read_nodes trees. canvas_autofix with apply: true writes every mechanical fix (spacing snaps incl. array padding, contrast, known-default accents) in one call.

Point-and-tell feedback: the user toggles Comment mode in the viewer and clicks any element to leave a note anchored to that node (or to the whole page). Comments are stored on the canvas, git-diffable in bound repos, and reach the running server automatically. Check get_feedback when picking up a canvas — each entry carries the anchor nodeId plus a node snapshot, enough to act on immediately. Open feedback blocks presenting, same as open inspector comments: address every item, then close each via resolve_feedback with a one-line note saying what changed (your note shows up as a reply in the viewer's Feedback tab).

Gotchas (current sharp edges):
- Row rules and accent bars are per-side borders — borderTop: { width: 1, color: "$border" } on each table row, borderLeft: { width: 3, color: "$primary" } for an accent edge (style "dashed"|"dotted" for forecast/draft outlines; strokeDasharray dashes SVG paths). Never fake hairlines with gap: 1 + background bleed-through.
- Prefer STRUCTURED gradient / shadows ({ stops: [...] } and [{ x, y, blur, color }]); a raw CSS string on those fields is accepted too.
- import_design_md reliably imports spacing + component skeletons; colors / typography / radius parsing is lossy — set those explicitly via set_variables.`;

const server = new McpServer({
  name: 'framesmith',
  version: '1.8.0',
}, {
  instructions: INSTRUCTIONS,
});

/** Structured workflow + gotcha lists returned by the `init` tool. Kept in step
 * with the prose in INSTRUCTIONS so an agent gets the same orientation whether
 * it reads the connect-time instructions or calls init. */
const WORKFLOW_CHEATSHEET = [
  'The bar: craft beautiful UI/UX a designer would sign off on. Polishing to it is YOUR job — never show the user an unpolished design.',
  'Start from a taste-vetted pattern: list_structures → apply_structure, then ADAPT it — don\'t start from a blank canvas.',
  'Use the whole toolkit by default — icons, fonts, real controls (toggle/checkbox/radio/select), components, $tokens. Never fake them; never omit them where a real UI has them.',
  'Read the framesmith://guidelines resource before drawing (esp. "Designing with taste": one focal point, real hierarchy, one type + spacing scale, restraint).',
  'Author at one target width; reference tokens with $name (e.g. fill: "$surface").',
  'screenshot → review the render → iterate.',
  'canvas_evaluate → resolve EVERY comment (canvas_autofix apply: true for the mechanical subset / batch_design for the rest) → re-evaluate → repeat until the inspector is CLEAN and the score is > 95. Only then present.',
  'One canvas per screen / state; let the per-project build log nudge you to vary structure.',
  'Picking up an existing canvas? get_feedback first — point-and-tell comments may be waiting (node-anchored or canvas-level). Address every open item, then resolve_feedback with a note saying what changed.',
];

const GOTCHAS = [
  'The bar: craft beautiful UI/UX a designer would sign off on, and polish to it YOURSELF — start from a pattern, use the whole toolkit (icons/fonts/controls/components), and run canvas_evaluate → resolve EVERY comment → re-evaluate until clean and > 95 BEFORE presenting. The evaluate result\'s "directive" field says when it\'s safe to present. Never show the user an unpolished design.',
  'Icons: Lucide ({ type: "icon", icon: "search" }) and Material Symbols (icon: "material:check", iconStyle outlined/rounded/sharp, "-fill" suffix for filled) render by name — never fake them with Unicode glyphs. Casing: use textTransform: "uppercase", not uppercased content.',
  'Controls: toggle / checkbox / radio / select are real node types with checked / disabled / value, token-styled — never assemble them from frames + ellipses.',
  'Bulk edits & queries: replace_matching_properties changes a property across every node matching a value predicate in one call (scope/type filters; dryRun previews the match set); find_nodes is the read-only twin — locate nodes by property/text/name and get ids + paths instead of guessing from read_nodes trees. canvas_autofix apply: true writes the whole mechanical fix set in one call.',
  'Component scaffolds: apply_structure with kind "component" structures (data-table, form-field, toolbar, stat-card, toggle-row) + targetId stamps reusable fragments with re-keyed IDs — build tables/forms from these, not node-by-node.',
  'canvas_import_html: Tailwind classes map to intent directly (bg-surface → fill "$surface", gap-4 → 16, bg-red-500 → the bundled v4 palette hex) and literal colors snap to the design system — a bare snippet styles via the common utilities + palette; pass the compiled CSS via the css param for everything else. Always read the returned report (snapped/literals/layout/warnings); the import is honest about what it dropped.',
  'Imports reconstruct STRUCTURE: tables → proportional columns, grids → rows from the computed template, centered/max-width content stays centered, other multi-column CSS clusters by geometry. Check report.layout — a "stack-fallback" entry names a container that needs hand-fixing; everything else arrived structurally correct, so do not rebuild it.',
  'Fonts: a fontFamily named in a typography token loads automatically (Google Fonts, cached locally); typography.body.fontFamily sets the document default. A "Font warnings" item in a screenshot result means the named face is NOT rendering — fix the name or register it via set_fonts.',
  'Row rules / accent bars: per-side borders — borderTop: { width: 1, color: "$border" } per table row, borderLeft: { width: 3, color: "$primary" } for accent edges; style "dashed"|"dotted" marks forecast/draft; strokeDasharray ("6 4") dashes SVG paths. Never fake hairlines with gap: 1 + fill bleed-through.',
  'Prefer structured gradient / shadows ({ stops: [...] } and [{ x, y, blur, color }]); a raw CSS string on those fields is accepted too.',
  'import_design_md reliably imports spacing + component skeletons; set colors / typography / radius explicitly via set_variables.',
  'Binding (canvas_bind, or init on first run) re-keys every project / canvas ID to repo-* form — use the IDs init returns, never cache pre-bind IDs.',
  'Point-and-tell feedback: the user clicks elements in the viewer (Comment mode) to leave node-anchored or whole-page comments, stored on the canvas at metadata.feedback. get_feedback returns them (with a node snapshot; orphaned: true = the node is gone but the concern likely still applies); open feedback blocks presenting, same as open inspector comments — address each item, then resolve_feedback with a one-line note of what changed (shown as your reply in the viewer\'s Feedback tab). canvas_list rows and canvas_evaluate results carry an openFeedback count (and the evaluate directive stays blocking) while comments are open.',
  'Cliché tells (canvas_evaluate "cliche" category): avoid default purple/indigo accents, gradient/glow overuse, fake window chrome, fabricated metrics, slop copy (filler verbs / scroll cues / "Jane Doe" / hype labels), an eyebrow above every section (keep to ~1 per 3 sections), mixed radius systems (one radius scale), pure black/white (use off-black/off-white), and competing accents (one accent hue + neutrals).',
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
  'List canvases. By default returns all non-archived canvases. Filter by `projectId` to scope to one project. Set `includeArchived: true` to include archived canvases in the result. A row carrying `openFeedback: n` has open point-and-tell comments from the user waiting — read them with get_feedback before working on (or presenting) that canvas.',
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
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...await warmFontsContent(variables)] };
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
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...await warmFontsContent(variables)] };
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

Node types: frame, text, rectangle, ellipse, image, icon, path, component, instance, toggle, checkbox, radio, select
Properties: fill, gradient, stroke, strokeWidth, strokeStyle, borderTop, borderRight, borderBottom, borderLeft, cornerRadius, width, height, minWidth, maxWidth, layout ("horizontal"|"vertical"), gap, padding, alignItems, justifyContent, fontSize, fontFamily, fontWeight, color, content, textAlign, lineHeight, letterSpacing (px), textDecoration, textTransform ("uppercase" etc. — don't bake casing into content), fontVariationSettings (variable-font axes, e.g. '"wght" 650'), src, objectFit, opacity, shadow, shadows, blur, backdropBlur, backdropFilter, overflow, wrap, position, x, y, icon, iconSize, iconColor, iconStyle, checked, disabled, value, d, viewBox, strokeLinecap, strokeLinejoin, strokeDasharray, animation, transition, componentId, overrides, responsive

Borders: stroke + strokeWidth draw all four sides (strokeStyle "solid"|"dashed"|"dotted", default solid — a dashed outline is the forecast/placeholder convention). Per-side borders take an object: borderTop: { width: 1, color: "$border", style?: "solid"|"dashed"|"dotted" } — use these for table row rules (borderTop on each row) and accent edges (borderLeft: { width: 3, color: "$primary" }), NEVER a gap-1-with-fill-bleed hack. Paths dash via strokeDasharray: "6 4" (or [6, 4]).

Icons: two bundled sets render by name — use these instead of Unicode glyph stand-ins (✓ ● ▾):
  - Lucide (1,900+, stroke style): I("parent", { type: "icon", icon: "search", iconSize: 24, iconColor: "$primary" }) — browse at lucide.dev
  - Material Symbols (3,800+, fill style): icon: "material:check" + optional iconStyle: "outlined"|"rounded"|"sharp" (default outlined); "-fill" suffix selects the filled variant (e.g. "material:star-fill") — browse at fonts.google.com/icons

Input controls: toggle / checkbox / radio / select are real node types — I("parent", { type: "toggle", checked: true }), I("parent", { type: "select", value: "Admin", width: 200 }). Colors default from design tokens ($accent / $border / $bg-surface / $text-primary, neutral fallbacks when unthemed); fill / stroke / color override. NEVER fake a control from frames + ellipses.

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

// --- find_nodes (Phase 22 slice B, #136) ---
server.tool(
  'find_nodes',
  `Find nodes by what they ARE instead of tracking ids by hand: a property/value predicate (same \`match\` semantics as replace_matching_properties — AND across keys, $token refs literal, structured values by shape), a \`text\` substring (case-insensitive, text content), and/or an exact \`name\`. All provided filters AND together; \`scope\` limits to a subtree, \`type\` to a node type.

Returns { count, matches: [{ id, type, name?, path }] } in document order — \`path\` is the named ancestor chain ("Document / Table / Row 2 / text") so you can tell WHICH match you want before editing it. Read-only.

Use it before targeted edits ("which node holds $1.52M?" → find_nodes({ text: "$1.52M" })) instead of guessing ids from read_nodes trees — editing a guessed id is how the wrong node gets restyled. Pairs with replace_matching_properties (same predicate, write-side) and batch_design U() (per-id edits).`,
  {
    canvasId: z.string().describe('Canvas ID'),
    match: z.record(z.any()).optional().describe('Property/value predicate — a node matches when EVERY entry equals its current value (e.g. { "fontSize": 30 } or { "fill": "$surface" }).'),
    text: z.string().optional().describe('Case-insensitive substring match on text content (e.g. "$1.52M").'),
    name: z.string().optional().describe('Exact match on the node name (e.g. "YearTable").'),
    scope: z.string().optional().describe('Node ID — limit the search to this subtree (inclusive). Default: the whole document.'),
    type: z.string().optional().describe('Only match nodes of this type (frame, text, icon, ...).'),
  },
  async ({ canvasId, match, text, name, scope, type }) => {
    if (!match && text === undefined && name === undefined && !type) {
      return { content: [{ type: 'text', text: 'Error: provide at least one of match / text / name / type — an unfiltered query is just read_nodes.' }], isError: true };
    }
    ensureFresh(canvasId); // viewer/hand edits may have landed since the last read
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    try {
      const found = findNodesDetailed(canvas.root, { match, text, name, scopeId: scope, type: type as SceneNode['type'] | undefined });
      const matches = found.map(({ node, path }) => ({ id: node.id, type: node.type, ...(node.name ? { name: node.name } : {}), path }));
      return { content: [{ type: 'text', text: JSON.stringify({ count: matches.length, matches }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- replace_matching_properties (issue #127) ---
server.tool(
  'replace_matching_properties',
  `Bulk property edit: find every node whose properties equal ALL the \`match\` entries (AND across keys) and apply the \`set\` properties to each in one call — instead of hand-writing one batch_design U() per node ("set width: "100%" on all nodes currently width: 110" is one call, not 68).

Matching is by value equality: numbers/strings literally (a $token ref like "$surface" matches as its literal string), structured values (gradient, shadows, padding arrays) by shape. Narrow the blast radius with \`scope\` (limit to a subtree) and/or \`type\` (only nodes of that type). \`set\` cannot change id or type — use batch_design R() to retype a node.

ALWAYS preview with dryRun: true first when the match value could be common (width: 150 can match far more nodes than intended): it returns the matched nodes ({ id, type, name }) and count without writing. The non-dry result returns the same match list plus ok — mirrors batch_design's shape.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    match: z.record(z.any()).describe('Property/value predicate — a node matches when EVERY entry equals its current value (e.g. { "width": 110 } or { "fill": "$secondary-container" }). Must be non-empty.'),
    set: z.record(z.any()).describe('Properties to write on every matched node (e.g. { "width": "100%" }). id/type are ignored. Must be non-empty.'),
    scope: z.string().optional().describe('Node ID — limit the match to this subtree (inclusive). Default: the whole document.'),
    type: z.string().optional().describe('Only match nodes of this type (frame, text, rectangle, ellipse, image, icon, path, component, instance, toggle, checkbox, radio, select).'),
    dryRun: z.boolean().optional().describe('Preview: return the matched nodes + count WITHOUT writing. Use it before any wide match.'),
  },
  async ({ canvasId, match, set, scope, type, dryRun }) => {
    if (!match || Object.keys(match).length === 0) {
      return { content: [{ type: 'text', text: 'Error: `match` must be non-empty — an empty predicate would match every node. Use batch_design U() ops for targeted edits.' }], isError: true };
    }
    if (!dryRun && (!set || Object.keys(set).length === 0)) {
      return { content: [{ type: 'text', text: 'Error: `set` must be non-empty (nothing to write). Use dryRun: true to only preview matches.' }], isError: true };
    }
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    try {
      const opts = { scopeId: scope, type: type as SceneNode['type'] | undefined };
      const matched = dryRun
        ? collectMatchingNodes(canvas.root, match, opts)
        : replaceMatchingProperties(canvas.root, match, set as Partial<SceneNode>, opts);
      if (!dryRun) touchCanvas(canvasId);
      const matches = matched.map((n) => ({ id: n.id, type: n.type, ...(n.name ? { name: n.name } : {}) }));
      const viewerUrl = getViewerUrl();
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: true, ...(dryRun ? { dryRun: true } : {}), count: matches.length, matches }, null, 2) },
          ...(!dryRun && viewerUrl ? [{ type: 'text' as const, text: `View live: ${viewerUrl}/canvas/${canvasId}` }] : []),
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

/** Phase 16 Slice A — shared pre-render step for every Chrome-rendering tool:
 * merge tokens, resolve $refs, and run the font backstop so any referenced
 * family renders in its real face (cache-first; resolution failure degrades to
 * the fallback stack + a warning, never a render failure). */
async function prepareRender(canvas: Canvas): Promise<{ resolved: SceneNode; renderOpts: RenderOptions; fontWarnings: string[] }> {
  const merged = getCanvasTokens(canvas);
  const resolved = resolveVariables(canvas.root, merged);
  const { extraFonts, warnings } = await ensureFontsForRender(resolved, canvas, merged);
  return { resolved, renderOpts: { extraFonts, bodyFontFamily: bodyFontFamilyFromTokens(merged) }, fontWarnings: warnings };
}

/** Warnings as an extra content item — empty array when there's nothing to say. */
function fontWarningContent(warnings: string[]): { type: 'text'; text: string }[] {
  return warnings.length ? [{ type: 'text' as const, text: `Font warnings:\n- ${warnings.join('\n- ')}` }] : [];
}

/** Write-time font warm-up (spec FR-A2): resolving when the token is declared
 * means the first screenshot is already correct and offline. Failures are
 * reported as an extra content item, never block the token write. */
async function warmFontsContent(vars: Parameters<typeof warmFamilies>[0]): Promise<{ type: 'text'; text: string }[]> {
  const { resolved, failed } = await warmFamilies(vars);
  if (!resolved.length && !failed.length) return [];
  const lines = [
    ...resolved.map((f) => `- "${f}" resolved + cached — renders in the real face from the next screenshot`),
    ...failed.map((f) => `- "${f.family}" could not be resolved (${f.error}) — will render with the fallback stack unless registered via set_fonts`),
  ];
  return [{ type: 'text' as const, text: `Fonts:\n${lines.join('\n')}` }];
}

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

    const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas);
    const w = width ?? (typeof canvas.root.width === 'number' ? canvas.root.width : 1440);
    const h = height ?? (typeof canvas.root.height === 'number' ? canvas.root.height : 900);
    const html = renderToHtml(resolved, w, h, canvas, renderOpts);
    const base64 = await takeScreenshot(html, { width: w, height: h, scale, nodeId });

    return {
      content: [
        {
          type: 'image',
          data: base64,
          mimeType: 'image/png',
        },
        ...fontWarningContent(fontWarnings),
      ],
    };
  }
);

// --- read_nodes ---
server.tool(
  'read_nodes',
  'Read node data from the scene graph. Returns JSON representation of nodes. Already know the id? Read it here. Don\'t know the id — hunting for "the node with $1.52M" or "the row named YearTable"? Use find_nodes instead of eyeballing this tree.',
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

    // Fonts go through the backstop here too — a custom face changes glyph
    // metrics, so layout rects must measure the same font the screenshot shows.
    const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas);
    const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
    const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
    const html = renderToHtml(resolved, w, h, canvas, renderOpts);
    const layout = await computeLayout(html, nodeId, maxDepth);

    return { content: [{ type: 'text', text: JSON.stringify(layout, null, 2) }, ...fontWarningContent(fontWarnings)] };
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
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...await warmFontsContent(variables)] };
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
  `Register custom fonts on a canvas. Three ways, combinable:
  - families: ["Inter"] — EASIEST: resolve by name from Google Fonts (weights 400-700, cached locally). Merged into the existing declarations.
  - fonts: [{ family, url }] with a binary URL (.woff2/.woff/.ttf/.otf, https:// or data:) — replaces existing declarations wholesale. Pass [] to clear.
  - fonts: [{ family, url }] with a Google Fonts CSS URL (fonts.googleapis.com/css2?...) — the faces are extracted from the stylesheet automatically.
Fonts named in typography tokens load automatically at render time — you only need set_fonts for families outside the token system or from non-Google sources.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    fonts: z.array(z.object({
      family: z.string().min(1).describe('CSS font-family name (no surrounding quotes)'),
      url: z.string().regex(/^(https?:\/\/|data:)/i).describe('Font binary URL, or a Google Fonts css2 stylesheet URL to extract faces from'),
      weight: z.union([z.string(), z.number()]).optional().describe('font-weight (e.g. 400, 700, "bold")'),
      style: z.enum(['normal', 'italic']).optional(),
    })).optional().describe('Explicit font declarations. Replaces existing fonts wholesale when provided.'),
    families: z.array(z.string().min(1)).optional().describe('Family names to resolve from Google Fonts and merge in (e.g. ["Inter", "JetBrains Mono"])'),
  },
  async ({ canvasId, fonts, families }) => {
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    if (!fonts && !families?.length) return { content: [{ type: 'text', text: 'Error: Pass `fonts` (declarations) and/or `families` (names to resolve).' }], isError: true };
    const unsafeFamily = /["';{}\n\r<>]/;
    const unsafeUrl = /["\n\r<>]/;
    const bad = fonts?.find((f) => unsafeFamily.test(f.family) || unsafeUrl.test(f.url));
    if (bad) return { content: [{ type: 'text', text: `Error: Unsafe characters in font ${JSON.stringify(bad)} — family must not contain quotes/semicolons/braces/angle brackets/newlines; url must not contain quotes/newlines/angle brackets.` }], isError: true };

    // `fonts` keeps its replace-wholesale contract; `families` merges.
    let next: FontFace[] = fonts !== undefined ? [] : [...(canvas.fonts ?? [])];
    const failed: { family: string; error: string }[] = [];

    for (const f of fonts ?? []) {
      if (isStylesheetUrl(f.url)) {
        try {
          next.push(...await resolveStylesheetUrl(f.url));
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: Could not extract fonts from stylesheet ${f.url}: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
      } else {
        next.push(f);
      }
    }

    for (const family of families ?? []) {
      try {
        const { faces } = await resolveFamily(family);
        next = next.filter((f) => f.family.toLowerCase() !== family.toLowerCase()); // replace same-family entries
        next.push(...faces);
      } catch (err) {
        failed.push({ family, error: err instanceof Error ? err.message : String(err) });
      }
    }

    canvas.fonts = next;
    touchCanvas(canvasId);
    return {
      content: [{ type: 'text', text: JSON.stringify({ fonts: canvas.fonts, ...(failed.length ? { failed } : {}) }, null, 2) }],
      ...(failed.length && !next.length ? { isError: true as const } : {}),
    };
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

    const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas);
    const w = width ?? (typeof canvas.root.width === 'number' ? canvas.root.width : 1440);
    const h = height ?? (typeof canvas.root.height === 'number' ? canvas.root.height : 900);
    const html = renderToHtml(resolved, w, h, canvas, renderOpts);

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

    return { content: [{ type: 'text', text: JSON.stringify({ exported: exportedFiles }, null, 2) }, ...fontWarningContent(fontWarnings)] };
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

    const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas);
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
      (bp) => renderToHtml(resolved, bp.width, bp.height, canvas, renderOpts),
      bps,
      scale,
    );

    return {
      content: [
        ...results.map((r) => ({
          type: 'image' as const,
          data: r.data,
          mimeType: 'image/png' as const,
        })),
        ...fontWarningContent(fontWarnings),
      ],
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

    const prep1 = await prepareRender(canvas1);
    const prep2 = await prepareRender(canvas2);
    const html1 = renderToHtml(prep1.resolved, w, h, canvas1, prep1.renderOpts);
    const html2 = renderToHtml(prep2.resolved, w, h, canvas2, prep2.renderOpts);

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
        ...fontWarningContent([...new Set([...prep1.fontWarnings, ...prep2.fontWarnings])]),
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
  `List available layout structures, two kinds:
  - kind "page" — whole-page scaffolds (marquee-hero, bento-grid, …) stamped once at the canvas root, tagged on four taxonomy axes (heroTreatment, density, rhythm, alignment) so you deliberately vary page shape.
  - kind "component" — reusable fragments (data-table, form-field, toolbar, stat-card, toggle-row) stamped under ANY node via apply_structure targetId, repeatably — a high-fidelity table costs one stamp instead of ~80 hand-placed nodes.
Distinct from presets: structures define layout skeleton, presets define color/token theme. Pass projectId to also get a diversification signal (recently-built page structures + a hint to differ). Apply one with apply_structure, then screenshot and verify before populating.`,
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
  `Stamp a layout structure (see list_structures) onto a canvas. Two kinds:
  - page scaffolds insert at the canvas root and record provenance; refuses if the root already has content unless replace is true.
  - component scaffolds (data-table, form-field, toolbar, stat-card, toggle-row) insert under targetId (default root), repeatably — every stamp re-keys its node IDs and returns an idMap (templateId → live id) for follow-up batch_design ops.
Seeds neutral default colors so the scaffold renders even before a preset is applied. Returns the placeholder node ids to populate — fill them with batch_design U ops, then call screenshot to verify the layout.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    structure: z.string().describe('Structure name (use list_structures, e.g. marquee-hero, data-table)'),
    replace: z.boolean().optional().describe('Page scaffolds only: if the root already has children, clear them before stamping. Default false (refuses on a non-empty canvas).'),
    targetId: z.string().optional().describe('Component scaffolds only: node to stamp under (default "document"). Page scaffolds always stamp at the root.'),
  },
  async ({ canvasId, structure, replace, targetId }) => {
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    try {
      const existingColors = new Set(Object.keys(getCanvasTokens(canvas).colors ?? {}));
      const result = applyStructure(canvas, structure, { replace, existingColors, targetId });
      // Record provenance in the per-project build log (feeds the diversification
      // signal) — page stamps only: component stamps don't shape the page, and
      // logging them would pollute the diversification signal (spec C9).
      if (result.kind === 'page') {
        const prov = canvas.metadata?.provenance;
        if (prov) appendBuildLog(canvas.projectId, { ...prov, canvasId: canvas.id, canvasName: canvas.name });
      }
      touchCanvas(canvasId);
      return { content: [{ type: 'text', text: JSON.stringify({
        ...result,
        instruction: result.kind === 'component'
          ? 'Populate the placeholders via the idMap with batch_design U ops (e.g. U(idMap["dt-row1-name"], { content: "..." })); copy repeated fragments with C ops; then screenshot to verify.'
          : 'Populate each placeholder by id with batch_design U ops (replace the role-labeled content), then call screenshot to verify the layout before refining.',
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

// ── shared import finishing (Phase 17) ──────────────────────────────────────

type ImportTokenMatch = { source?: 'workspace' | 'designMd' | 'tailwind' | 'none'; tolerance?: number; designMd?: string };

function validateImportArgs(projectId: string | undefined, tokenMatch: ImportTokenMatch | undefined): { content: { type: 'text'; text: string }[]; isError: true } | null {
  if (projectId && !getProject(projectId)) {
    return { content: [{ type: 'text' as const, text: `Error: Project "${projectId}" not found. Use project_list to see projects.` }], isError: true };
  }
  if (tokenMatch?.source === 'designMd' && !tokenMatch.designMd) {
    return { content: [{ type: 'text' as const, text: 'Error: tokenMatch.source "designMd" requires tokenMatch.designMd content.' }], isError: true };
  }
  return null;
}

/** Create + persist the canvas for an import result: token snapping (FR-B2,
 * default source = the canvas's merged inheritance chain), font warm-up
 * through the Phase 16 resolver, and the provenance stamp (URL or 'html' —
 * never auth material). */
async function finishImport(
  imported: { root: SceneNode; report: import('./import.js').ImportReport; contentHeight: number },
  opts: { name: string; projectId?: string; width: number; importedFrom: string; tokenMatch?: ImportTokenMatch; tailwindTheme?: Record<string, string> },
): Promise<{ content: { type: 'text'; text: string }[] }> {
  const { root, report, contentHeight } = imported;
  const canvas = createCanvas(opts.name, opts.projectId);
  canvas.root.width = opts.width;
  canvas.root.height = Math.max(contentHeight, 100);
  canvas.root.children = [root];

  const source = opts.tokenMatch?.source ?? 'workspace';
  if (source !== 'none') {
    const vars = source === 'designMd' ? parseDesignMd(opts.tokenMatch!.designMd!).variables
      : source === 'tailwind' ? { colors: opts.tailwindTheme ?? {} }
      : getCanvasTokens(canvas);
    snapToTokens(root, vars, report, { tolerance: opts.tokenMatch?.tolerance });
  }

  for (const family of collectReferencedFamilies(root)) {
    try { await resolveFamily(family); } catch { report.unmatchedFonts.push(family); }
  }

  canvas.metadata = {
    ...canvas.metadata,
    provenance: { importedFrom: opts.importedFrom, at: new Date().toISOString() },
  };
  touchCanvas(canvas.id);
  return { content: [{ type: 'text' as const, text: JSON.stringify({
    canvasId: canvas.id,
    rootId: root.id,
    report,
    instruction: 'Screenshot the canvas to review fidelity, then check report.warnings and report.literals for what needs hand-finishing.',
  }, null, 2) }] };
}

// --- canvas_import_html ---
server.tool(
  'canvas_import_html',
  `Import an HTML snippet (+ optional CSS) as an editable canvas — the reverse of export. Renders the markup headlessly and walks the DOM's computed styles into a scene graph: flex containers → frames (layout/gap/padding/align), <table> → rows of proportional-width cell frames (thead/tbody unwrapped, dividers preserved), CSS grid → rows of proportional columns from the computed template (grid-column spans honored), centered/max-width content → centered frames at their real width, other multi-column CSS → geometry-clustered rows, text runs → text nodes (size/weight/color/spacing/transform), <img> → image, inline SVGs → icon nodes when they match a bundled Lucide/Material glyph (else path), checkboxes/radios/switches/selects → the input-primitive node types with their live checked/value state. report.layout records how each container was reconstructed (table|grid|centered|geometry|stack-fallback) — a stack-fallback entry is the one place needing hand-fixing.

Token re-mapping: Tailwind utility classes map to INTENT directly (bg-surface → fill: "$surface", gap-4 → 16, custom utilities via tailwind.theme); remaining literal colors snap to the matched design system (nearest within tolerance — near-ties are reported, never guessed). report.snapped / report.literals / report.scaleMatches tell you exactly what happened; report.warnings flags $refs the design system doesn't define yet.

LOSSY BY DESIGN — read the returned report: snapped (values → $tokens), literals (colors with no token), scaleMatches (numbers equal to a scale token, informational), layout (per-container reconstruction), unmatchedFonts, unmatchedIcons, warnings (dropped pseudo-elements / background images / truncations). The import is an editable starting point that honestly tells you where it degraded, not a pixel-perfect clone.

Note: a bare Tailwind snippet has no Tailwind runtime — the class intent mapper covers the common utilities; pass the compiled CSS via \`css\` for everything else.`,
  {
    html: z.string().min(1).describe('The HTML snippet to import'),
    css: z.string().optional().describe('CSS to apply (e.g. the compiled Tailwind stylesheet). Without it, only inline styles, browser defaults, and Tailwind class intent render.'),
    projectId: z.string().optional().describe('Project to create the canvas in (default: the default project)'),
    name: z.string().optional().describe('Canvas name (default: "Imported HTML")'),
    selector: z.string().optional().describe('Import only the first element matching this CSS selector within the snippet'),
    width: z.number().optional().describe('Container width the layout resolves against (default 1440)'),
    flatten: z.object({
      collapseWrappers: z.boolean().optional().describe('Collapse single-child wrapper divs with no visual props (default true)'),
      mergeTextRuns: z.boolean().optional().describe('Merge adjacent text runs with identical style (default true)'),
      dropInvisible: z.boolean().optional().describe('Drop display:none / zero-size / aria-hidden nodes (default true)'),
      maxDepth: z.number().optional().describe('Truncate subtrees deeper than this (default 24)'),
    }).optional().describe('Tree-simplification knobs'),
    tokenMatch: z.object({
      source: z.enum(['workspace', 'designMd', 'tailwind', 'none']).optional().describe('Design system to snap against: "workspace" (default — the target project\'s merged tokens), "designMd" (parse designMd content), "tailwind" (the supplied theme), "none" (skip snapping)'),
      tolerance: z.number().optional().describe('Max normalized RGB distance for nearest-color snapping (default 0.08)'),
      designMd: z.string().optional().describe('DESIGN.md content — required when source is "designMd"'),
    }).optional().describe('Snap concrete values back to $token refs'),
    tailwind: z.object({
      theme: z.record(z.string()).optional().describe('Flat { name: value } map from the project\'s @theme — widens which class names map to $tokens (e.g. { surface: "#1e1e1e" })'),
    }).optional().describe('Tailwind-specific import options'),
  },
  async ({ html, css, projectId, name, selector, width, flatten, tokenMatch, tailwind }) => {
    const invalid = validateImportArgs(projectId, tokenMatch);
    if (invalid) return invalid;
    try {
      const imported = await importHtml(html, { css, selector, width, flatten, tailwindTheme: tailwind?.theme });
      return finishImport(imported, { name: name ?? 'Imported HTML', projectId, width: width ?? 1440, importedFrom: 'html', tokenMatch, tailwindTheme: tailwind?.theme });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- canvas_import_url ---
server.tool(
  'canvas_import_url',
  `Import a LIVE page as an editable, token-mapped canvas — point at a running app (or a deployed URL) and the screen becomes the design-of-record without redrawing. Same engine as canvas_import_html (computed-style DOM walk: frames/text/images/icons/input primitives, Tailwind intent mapping, design-system token snapping, structural reconstruction — tables/grids/centering/geometry clustering, reported per-container in report.layout) plus live-page controls:
  - viewport (default 1440×900) — the width layouts resolve against
  - selector — import one component instead of the whole page
  - waitFor — a CSS selector to await or a delay in ms, for client-rendered UI
  - auth — headers/cookies for gated pages; they live ONLY in a throwaway browser context and are never persisted to the canvas, provenance, or report

LOSSY BY DESIGN — read the returned report (snapped/literals/scaleMatches/layout/unmatchedFonts/unmatchedIcons/warnings). Fonts seen on the page load through the font-by-name resolver so the canvas renders in the same faces.`,
  {
    url: z.string().regex(/^https?:\/\//i).describe('The page to import (http/https)'),
    projectId: z.string().optional().describe('Project to create the canvas in (default: the default project)'),
    name: z.string().optional().describe('Canvas name (default: "Imported — <hostname>")'),
    viewport: z.object({
      width: z.number().optional().describe('Viewport width (default 1440)'),
      height: z.number().optional().describe('Viewport height (default 900)'),
    }).optional(),
    selector: z.string().optional().describe('Import only the first element matching this CSS selector (default: body)'),
    waitFor: z.union([z.string(), z.number()]).optional().describe('CSS selector to await, or delay in ms (max 15s) — for JS-rendered pages'),
    auth: z.object({
      headers: z.record(z.string()).optional().describe('Extra HTTP headers (e.g. Authorization)'),
      cookies: z.array(z.object({
        name: z.string(), value: z.string(),
        domain: z.string().optional(), path: z.string().optional(),
      })).optional(),
    }).optional().describe('Credentials for gated pages — used in a throwaway context, never persisted'),
    flatten: z.object({
      collapseWrappers: z.boolean().optional(), mergeTextRuns: z.boolean().optional(),
      dropInvisible: z.boolean().optional(), maxDepth: z.number().optional(),
    }).optional().describe('Tree-simplification knobs (same defaults as canvas_import_html)'),
    tokenMatch: z.object({
      source: z.enum(['workspace', 'designMd', 'tailwind', 'none']).optional(),
      tolerance: z.number().optional(),
      designMd: z.string().optional(),
    }).optional().describe('Snap concrete values back to $token refs (default source: workspace)'),
    tailwind: z.object({
      theme: z.record(z.string()).optional(),
    }).optional().describe('Tailwind @theme map for class-intent mapping'),
  },
  async ({ url, projectId, name, viewport, selector, waitFor, auth, flatten, tokenMatch, tailwind }) => {
    const invalid = validateImportArgs(projectId, tokenMatch);
    if (invalid) return invalid;
    try {
      const imported = await importUrl(url, { viewport, selector, waitFor, auth, flatten, tailwindTheme: tailwind?.theme });
      const hostname = new URL(url).hostname;
      return finishImport(imported, {
        name: name ?? `Imported — ${selector ?? hostname}`,
        projectId,
        width: viewport?.width ?? 1440,
        importedFrom: url, // the URL is recorded; auth never is
        tokenMatch,
        tailwindTheme: tailwind?.theme,
      });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- canvas_sync_from_url ---
server.tool(
  'canvas_sync_from_url',
  `Drift detection: re-import a live page EPHEMERALLY (no canvas is created, nothing is mutated) and pixel-diff it against an existing canvas — "has the shipped app diverged from the approved design?" as a number, not a vibe. Returns the diff image (changed regions in red), changePercent, and the import report.

The design-of-record becomes a living contract: run this after deploys, or wire it into CI and fail when changePercent exceeds a threshold. Same live-page controls as canvas_import_url (viewport / selector / waitFor / auth — auth stays in a throwaway context, never persisted). Both sides render at the same viewport, scale 1, so changePercent is comparable run-to-run.`,
  {
    canvasId: z.string().describe('The canvas that is the design-of-record'),
    url: z.string().regex(/^https?:\/\//i).describe('The live page to compare against (http/https)'),
    viewport: z.object({
      width: z.number().optional().describe('Compare width (default: the canvas root width, else 1440)'),
      height: z.number().optional().describe('Compare height (default: the canvas root height, else 900)'),
    }).optional(),
    selector: z.string().optional().describe('Compare against one component instead of the whole page'),
    waitFor: z.union([z.string(), z.number()]).optional().describe('CSS selector to await, or delay in ms — for JS-rendered pages'),
    auth: z.object({
      headers: z.record(z.string()).optional(),
      cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string().optional(), path: z.string().optional() })).optional(),
    }).optional().describe('Credentials for gated pages — throwaway context, never persisted'),
  },
  async ({ canvasId, url, viewport, selector, waitFor, auth }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    try {
      const w = viewport?.width ?? (typeof canvas.root.width === 'number' ? canvas.root.width : 1440);
      const h = viewport?.height ?? (typeof canvas.root.height === 'number' ? canvas.root.height : 900);

      const imported = await importUrl(url, { viewport: { width: w, height: h }, selector, waitFor, auth });
      const liveHtml = await renderImportedTree(imported.root, w, h);

      const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas);
      const canvasHtml = renderToHtml(resolved, w, h, canvas, renderOpts);

      const diff = await computeDiff(canvasHtml, liveHtml, w, h, 1);

      return {
        content: [
          { type: 'image', data: diff.diffImage, mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify({
            changePercent: diff.changePercent,
            changedPixels: diff.changedPixels,
            totalPixels: diff.totalPixels,
            report: imported.report,
            verdict: diff.changePercent < 1
              ? 'In sync — the live page matches the design-of-record.'
              : `Drifted ${diff.changePercent}% — red regions in the diff image show where the shipped app diverges from the approved design.`,
          }, null, 2) },
          ...fontWarningContent(fontWarnings),
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
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
      }, ...await warmFontsContent(preset.variables)],
    };
  }
);

// --- get_feedback ---
server.tool(
  'get_feedback',
  `Read point-and-tell feedback: comments the user left by clicking elements in the viewer, each anchored to a specific node (or to the canvas as a whole when nodeId is absent). Returns open entries by default — each carries the comment, the anchor nodeId, and a node snapshot { type, name, text } captured at comment time, so you can act without extra lookups. "orphaned": true marks a comment whose anchor node no longer exists — it stays open because the concern usually still applies to the node's replacement. Omit canvasId to sweep every canvas in the current context and find where feedback is waiting. OPEN FEEDBACK BLOCKS PRESENTING, same as open inspector comments: check this tool when picking up a canvas, address each item (batch_design etc.), then close it with resolve_feedback.`,
  {
    canvasId: z.string().optional().describe('Canvas ID. Omit to sweep all canvases in the current context and return only those with feedback.'),
    includeResolved: z.boolean().optional().describe('Also return resolved entries (default false — open only)'),
  },
  async ({ canvasId, includeResolved }) => {
    if (canvasId) {
      ensureFresh(canvasId); // the comment may have just arrived from the viewer
      const canvas = getCanvas(canvasId);
      if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
      const entries = listFeedback(canvas, { includeResolved });
      return { content: [{ type: 'text', text: JSON.stringify({ canvasId, openCount: openFeedbackCount(canvas), entries }, null, 2) }] };
    }
    const perCanvas = [];
    for (const summary of listCanvases()) {
      if (summary.archived) continue;
      ensureFresh(summary.id);
      const canvas = getCanvas(summary.id);
      if (!canvas) continue;
      const entries = listFeedback(canvas, { includeResolved });
      if (entries.length > 0) perCanvas.push({ canvasId: canvas.id, name: canvas.name, openCount: openFeedbackCount(canvas), entries });
    }
    return { content: [{ type: 'text', text: JSON.stringify({ canvasesWithFeedback: perCanvas.length, canvases: perCanvas }, null, 2) }] };
  }
);

// --- resolve_feedback ---
server.tool(
  'resolve_feedback',
  `Close point-and-tell feedback entries after addressing them (see get_feedback). Marks each id resolved with resolvedBy: "agent" and an optional note — write the note as your reply to the user ("tightened the card header gap to 8"), it shows up next to their comment in the viewer. Unknown or already-resolved ids come back in notFound instead of failing the call. Resolve only what you actually addressed; the remaining openCount still blocks presenting.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    feedbackIds: z.array(z.string()).min(1).describe('Feedback entry ids (fb-...) to mark resolved'),
    note: z.string().optional().describe('One-line reply shown to the user next to their comment — what you changed'),
  },
  async ({ canvasId, feedbackIds, note }) => {
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    const result = resolveFeedback(canvas, feedbackIds, 'agent', note);
    if (result.resolved.length > 0) touchCanvas(canvasId);
    return { content: [{ type: 'text', text: JSON.stringify({ ...result, openCount: openFeedbackCount(canvas) }, null, 2) }] };
  }
);

// --- canvas_evaluate ---
server.tool(
  'canvas_evaluate',
  `Auto-score a design canvas against quality criteria. Returns an overall score (0-100), category scores, and actionable issues referencing specific node IDs. Categories: spacing, color, typography, structure, consistency (craft), plus "cliche" — the machine-made tells: default purple/indigo accents, gradient/glow overuse, fake browser/phone chrome (traffic-light dots), the hanging eyebrow-beside-heading header, fabricated-looking metrics/testimonials/logos, too many eyebrow labels (template rhythm — an eyebrow above nearly every section), slop copy (stock AI phrasing: filler verbs, scroll cues, placeholder names like "Jane Doe", hype labels), mixed radius systems (radius consistency — too many distinct corner radii), pure black/white (harsh #000000 ink or a stark #ffffff page vs a designed off-black/off-white), and competing accents (accent consistency — more than one accent hue). cliche issues carry a "tell" discriminator and are advisory (warning/info). Modes:
  - "fast": JSON-only, <100ms, deterministic heuristics only.
  - "detailed": adds Puppeteer-based pixel overlap detection in the consistency category.
  - "llm": fast-mode heuristics plus a vision-model critique against a FIXED rubric (provider picked from FRAMESMITH_LLM_PROVIDER env var, or whichever of ANTHROPIC_API_KEY / OPENAI_API_KEY is set). Adds an "llmCritique" field: { rubric: { hierarchy, execution, specificity, restraint, variety } each {score 1-5, rationale}, score (0-100 derived), summary, suggestions, needsRevision, failingAxes }. The verdict is stamped on the canvas (metadata.critique) + the per-project build log for auditability. Cost: one paid API call per invocation. To CLOSE the loop and auto-fix failing axes, use canvas_revise.
Designed for generator-evaluator loops: generate with batch_design, evaluate with canvas_evaluate, fix issues targeting the returned nodeIds (canvas_autofix handles the mechanical subset). The result includes a "directive" field — a present/keep-working verdict: resolve EVERY comment and clear > 95 before showing the design to the user; the directive tells you when it's safe to present. An "openFeedback" field (when > 0) counts the user's open point-and-tell comments — they block presenting even at a READY score; read them with get_feedback and close them with resolve_feedback.`,
  {
    canvasId: z.string().describe('Canvas ID to evaluate'),
    mode: z.enum(['fast', 'detailed', 'llm']).default('fast').describe('"fast" = JSON-only (<100ms), "detailed" = + Puppeteer layout checks, "llm" = fast + vision-model rubric critique'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche']))
      .optional()
      .describe('Specific categories to evaluate (default: all)'),
    genre: z.string().optional()
      .describe('Genre/style that relaxes specific cliche gates (e.g. "material" allows purple accents and white elevated surfaces). Defaults to the canvas provenance preset if stamped.'),
    floor: z.number().min(1).max(5).optional()
      .describe('llm mode only: per-axis rubric floor (1-5). Any axis below it sets needsRevision. Default 3 (or FRAMESMITH_CRITIQUE_FLOOR).'),
  },
  async ({ canvasId, mode, categories, genre, floor }) => {
    ensureFresh(canvasId); // a point-and-tell comment may have just arrived from the viewer
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const result = await evaluateCanvas(canvas, { mode, categories, genre });

    if (mode === 'llm') {
      try {
        const { resolved, renderOpts } = await prepareRender(canvas);
        const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
        const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
        const html = renderToHtml(resolved, w, h, canvas, renderOpts);
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

    // Action-oriented directive so the agent treats the result as a present/keep-
    // working gate, not a readout. Blocking = a sub-bar score, any warning/error,
    // OR any cliché tell (slop the user cares about, even at info severity). Pure
    // advisories (e.g. "consider extracting components") are optional refinements.
    const blocking = result.issues.filter(
      (i) => i.category === 'cliche' || i.severity === 'error' || i.severity === 'warning',
    ).length;
    const optional = result.issues.length - blocking;
    const ready = blocking === 0 && result.overallScore > 95;
    const optTail = optional ? ` ${optional} optional refinement(s) noted (info) — address if easy, not required.` : '';
    const baseDirective = ready
      ? `READY TO PRESENT — ${result.overallScore}/100, no blocking issues.${optTail}`
      : `NOT READY — ${result.overallScore}/100 with ${blocking} issue(s) to resolve${optional ? ` (+${optional} optional)` : ''}. Fix them now: canvas_autofix for the mechanical subset, batch_design for the rest (cliché tells included), then re-run canvas_evaluate. Repeat until there are zero warnings/cliché tells and the score is > 95. Do NOT show this design to the user yet.`;
    // Slice C — open point-and-tell comments block presenting even at READY:
    // the human's note outranks the heuristics.
    const openFeedback = openFeedbackCount(canvas);
    const directive = appendFeedbackDirective(baseDirective, openFeedback);

    return {
      content: [{ type: 'text', text: JSON.stringify({ ...result, ...(openFeedback > 0 ? { openFeedback } : {}), directive }, null, 2) }],
    };
  }
);

// --- canvas_autofix ---
server.tool(
  'canvas_autofix',
  `Run canvas_evaluate in fast mode and return the subset of issues that have a mechanically derived fix (off-scale spacing — gap, scalar AND array-form padding (the fix writes the complete snapped array) — → snap to scale; missing layout on multi-child frame → set vertical; recoverable WCAG contrast failure → switch text to #000 or #FFF, whichever wins; default-purple accent → swap to a neutral accent; fake-chrome strip → delete; pure-black ink → soften to off-black). By default this PROPOSES: each fix carries a ready-to-paste \`batch_design\` op string and a one-line rationale. Pass apply: true to also WRITE the fixes to the canvas in the same call — the result then reports applied/failed per op. Taste-dependent cliche tells (gradient/glow overuse, the hanging header, fabricated content, eyebrow-rhythm overuse, slop copy, mixed radius systems, competing accents) carry a suggestion but no auto-fix — call canvas_evaluate to see those. Closes the generator-evaluator loop: generate with batch_design → autofix (apply: true) → re-evaluate.`,
  {
    canvasId: z.string().describe('Canvas ID to autofix'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche']))
      .optional()
      .describe('Restrict to fixes from these categories (default: all)'),
    genre: z.string().optional()
      .describe('Genre/style that relaxes specific cliche gates (e.g. "material" allows purple accents and white elevated surfaces). Defaults to the canvas provenance preset if stamped.'),
    apply: z.boolean().optional()
      .describe('Write the fixes to the canvas in this call (default false: propose only, returning ops to run via batch_design).'),
  },
  async ({ canvasId, categories, genre, apply }) => {
    if (apply) ensureFresh(canvasId); // mutating path — pick up external edits first
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

    if (!apply || fixes.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          totalIssues: result.issues.length,
          fixableCount: fixes.length,
          ...(apply ? { applied: 0, note: 'apply: true had nothing to write' } : {}),
          fixes,
        }, null, 2) }],
      };
    }

    // parseAndExecute stops on the first failing line, so ops after a failure
    // come back "not attempted" rather than silently skipped.
    const opResults = parseAndExecute(canvas.root, fixes.map((f) => f.op).join('\n'), canvas);
    if (opResults.some((r) => r.ok)) touchCanvas(canvasId);
    const applied = fixes.filter((_, i) => opResults[i]?.ok).map((f) => ({ nodeId: f.nodeId, op: f.op, rationale: f.rationale }));
    const failed = fixes
      .map((f, i) => ({ f, r: opResults[i] }))
      .filter(({ r }) => !r?.ok)
      .map(({ f, r }) => ({ nodeId: f.nodeId, op: f.op, error: r ? r.error ?? 'failed' : 'not attempted (an earlier op failed)' }));
    return {
      content: [{ type: 'text', text: JSON.stringify({
        totalIssues: result.issues.length,
        fixableCount: fixes.length,
        appliedCount: applied.length,
        applied,
        ...(failed.length ? { failed } : {}),
        note: 'Fixes written to the canvas — re-run canvas_evaluate to confirm.',
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
      const { resolved, renderOpts } = await prepareRender(canvas);
      const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
      const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
      return takeScreenshot(renderToHtml(resolved, w, h, canvas, renderOpts), { width: w, height: h, scale: 1 });
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
  "One-call onboarding — safe to run first thing every session (idempotent). Binds the current repo if it isn't already (so canvases live as checked-in JSON under .framesmith/), ensures the convention projects exist (default: a Foundations style-guide project + a UI catch-all), and returns the LIVE state the rest of the session needs: resolved workspace + project IDs, the on-disk layout, a workflow cheatsheet, the current gotchas, and the guidelines resource URI. Binding re-keys IDs, so the IDs this returns are the ones to use — don't cache pre-bind IDs. `projects` names the projects to ensure exist (default when omitted: Foundations + UI); existing projects are never removed, so it's safe for adding feature/area projects like Onboarding or Settings. Does not seed design tokens — set those at the workspace layer with workspace_set_design_system. If any canvas in the workspace has open point-and-tell comments, the result also carries an `openFeedback: { total, note }` field — run get_feedback before doing anything else.",
  {
    dir: z.string().optional().describe('Directory to bind / detect. Defaults to the nearest git repo root above the server working directory.'),
    workspaceName: z.string().optional().describe('Name for the workspace when binding fresh. Defaults to the repo folder name.'),
    projects: z.array(z.string()).optional().describe('Convention project names to ensure exist. Defaults to ["Foundations", "UI"].'),
  },
  async ({ dir, workspaceName, projects }) => {
    const result = initWorkspace({ dir, workspaceName, projects });
    if (!result.ok) return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
    // Slice C — surface waiting point-and-tell comments at session start.
    const openFeedbackTotal = listCanvases().reduce((sum, c) => sum + (c.openFeedback ?? 0), 0);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          bound: true,
          workspace: result.workspace,
          projects: result.projects,
          projectsCreatedThisCall: result.projectsCreated,
          ...(openFeedbackTotal > 0 ? {
            openFeedback: {
              total: openFeedbackTotal,
              note: 'Open point-and-tell comments from the user are waiting — run get_feedback (no canvasId) to see them; they block presenting those canvases.',
            },
          } : {}),
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
