#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvas, getCanvas, listCanvases, findNode, touchCanvas, loadPersistedCanvases, archiveCanvas, unarchiveCanvas, moveCanvas, deleteCanvas, countCanvasesInProject, ensureFresh, collectMatchingNodes, replaceMatchingProperties, findNodesDetailed, setCanvasGenre, addVariant } from './scene-graph.js';
import { canvasVersionHash } from './version.js';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createWorkspace, listWorkspaces, renameWorkspace, deleteWorkspace, createProject, getProject, getWorkspace, listProjects, renameProject, deleteProject, setWorkspaceDesignSystem, getWorkspaceDesignSystem, setProjectDesignSystem, getProjectDesignSystem, getCanvasTokens, getInheritedTokens, loadRepoWorkspace } from './workspaces.js';
import { DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_ID } from './types.js';
import { detectBinding, projectStartDir, readWorkspaceFile, setRepoBackend, registerRepo, migrateLegacyHome, appendBuildLog, recordPresetInBuildLog, readBuildLog } from './repo-store.js';
import { bindRepo, initWorkspace } from './bind.js';
import { parseAndExecute, ignoredShadowWarning } from './operations.js';
import { promoteToComponent, copyNodesAcross } from './components.js';
import { resolveVariables, setVariables, getVariables, applyPresetTokens } from './variables.js';
import { renderToHtml, type RenderOptions } from './renderer.js';
import { ensureFontsForRender, bodyFontFamilyFromTokens, resolveFamily, warmFamilies, resolveStylesheetUrl, isStylesheetUrl, collectReferencedFamilies, unverifiedFamiliesInOps } from './fonts.js';
import { takeScreenshot, computeLayout, exportToFile, takeResponsiveScreenshots, computeDiff, shutdown } from './screenshot.js';
import { listPresets, getPreset, registerPreset } from './presets.js';
import { listStructures, applyStructure, computeDiversificationHint } from './structures.js';
import { parseDesignMd } from './design-md-parser.js';
import { listFeedback, resolveFeedback, openFeedbackCount, appendFeedbackDirective } from './feedback.js';
import { importHtml, importUrl, renderImportedTree, snapToTokens } from './import.js';
import { computeStructuralDrift, expandInstances } from './drift.js';
import { applyPerturbation, compareLayouts, PERTURBATION_NAMES, type PerturbationName } from './stress.js';
import { generateTypeScale, generateSpaceScale, resolveRatio, type RatioName } from './scales.js';
import { generateColorSystem } from './color-system.js';
import { generateDesignSystem, PERSONALITY_NAMES, type PersonalityName } from './design-language.js';
import { evaluateProject } from './project-evaluate.js';
import { startViewer, getViewerUrl, setExternalViewerUrl } from './viewer.js';
import { evaluateCanvas, relaxedByGenre, knownGenres } from './evaluate.js';
import { judgeCanvas, judgeFlow, LLMJudgeUnavailableError } from './llm-judge.js';
import { reviseCanvas } from './reviser.js';
import { stampCritique, runReviseLoop } from './critique.js';
import type { Canvas, DesignVariables, FontFace, SceneNode } from './types.js';

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

A data screen isn't done at one static frame with ideal data. DESIGN EVERY STATE: tables need designed "empty" + "loading" variants, forms need "error" — the coverage category warns until they exist, and canvas_add_variant + the empty-state / skeleton-table / skeleton-card scaffolds make each one a clone plus a stamp. SURVIVE EVERY STRING: run canvas_stress before presenting a data screen — it renders the too-long name, the German label, the "999+" badge, and empty/tripled tables, and reports what clipped or overflowed by node id (fix with fluid widths / minWidth floors / wrapping, then re-run until CLEAN).

DERIVE, DON'T HAND-PICK. Start every new project's look with generate_design_system: one seed color + one PERSONALITY (technical / editorial / soft / data-dense) → the complete design language — color system, curated font pairing, typography ROLES ($display/$heading/$body/$label), radius + density stances, $elevation.* depth tokens (dark-aware), $motion defaults. Deterministic, no API key; a different personality on the same seed is a visibly different product — pick the stance deliberately. The single-purpose generators stay for targeted regeneration: generate_scale (a named ratio → the full text-xs…text-3xl type scale + paired space-3xs…space-3xl spacing, craft defaults baked in, fluid clamp() optional) and generate_color_system (one seed → OKLCH primary/neutral ramps, status colors, and the bg-surface/text-primary/accent semantic vocabulary the structures speak — every text/surface pair AA by construction, dark theme included as a sparse dark.colors layer). Then USE the system: theme: "dark" renders the dark theme and canvas_evaluate contrast-checks both automatically (APCA appears as info-only — WCAG 2.2 is the gate); the consistency category re-attaches literals that drifted from tokens; motion timing lives in $motion tokens, not scattered ms values. Generate first, adjust individual tokens after — never eyeball ten hexes.

FINISH THE MODULE AS A SET. Products are sets of screens, and two things only exist at the set level: composition and coherence. Compose with real grid (layout: "grid" + gridColumns + span placement — bento/editorial tiles are grid children, never nested-flex approximations). When a multi-screen module feels done, project_evaluate rolls it up: per-screen scores plus the cross-screen findings no single canvas can see — radius-drift, accent-drift, token-adoption, copied-chrome (with the create_component + copy_nodes fix named), state-coverage. It is ADVISORY — only the per-canvas directives gate presenting. mode: "llm" adds the flow critique: up to 8 screens judged together for navigation/terminology/state-visibility/hierarchy consistency (keyless users get the full roll-up with a note).

Use the whole toolkit by default — a real UI uses these, so a good design must too (not only when asked): icons, fonts, controls, components, $tokens. Don't FAKE them (no Unicode-glyph icons, no ellipse "toggles") and don't OMIT them where a real UI has them — nav rows get a leading icon, metrics get an icon, feature lists get check icons, empty states get a glyph, forms use real controls. Starting from a pattern gives you all of this for free.

Icons & typography: two bundled icon sets render by name via the icon node type — Lucide ({ type: "icon", icon: "search" }) and Material Symbols (icon: "material:check", optional iconStyle outlined/rounded/sharp, "-fill" suffix for filled variants) — never fake icons with Unicode glyphs. Text nodes support letterSpacing / textTransform / fontVariationSettings — use textTransform: "uppercase" instead of baking casing into content. Input controls (toggle / checkbox / radio / select) are real node types ({ type: "toggle", checked: true }) styled from design tokens — never fake a control from frames + ellipses.

Fonts load by name: set fontFamily in a typography token (or on a node) and the renderer resolves it from Google Fonts automatically (cached in ~/.framesmith/fonts/ — offline after first use). typography.body.fontFamily becomes the document default. Generic shorthands "mono" / "sans" render as CSS monospace / sans-serif — no registration, no network. batch_design warns immediately when a call writes a fontFamily nothing can serve yet (not cached / not registered / not generic) — heed it, and heed "Font warnings" in screenshot results: a warned family is rendering in the fallback stack, not the face you named. set_fonts is only needed for non-Google sources; with a css2 stylesheet URL, the family label you pass is the family that gets registered.

Charts are data-driven: { type: "chart", kind: "line"|"bar", series: [{ data, stroke, strokeDasharray?, area?, points? }], gridlines, xLabels } does all the coordinate math — multi-series in one node, domains auto from data, dashed = projected / solid = actual. Never hand-compute SVG path coordinates for a chart; editing a value is a one-prop edit.

Reuse instead of rebuild: create_component promotes any existing subtree into a reusable component (an instance takes its place, render-identical); stamp more instances via batch_design ({ type: "instance", componentId, overrides: { "<childName>": {...} } } — overrides match children by NAME). copy_nodes copies subtrees across canvases with fresh ids + an idMap, carrying referenced component defs along — the app shell is built once and copied everywhere, never re-authored node-by-node.

Structures come in two kinds (list_structures): page scaffolds (marquee-hero, bento-grid, stat-led, editorial-longform, split-workbench, catalogue, dashboard, auth, pricing, settings, onboarding) stamp once at the root — each is taste-vetted (> 95, zero cliché tells) so it's a non-slop starting point to ADAPT, not boilerplate; component scaffolds (data-table, form-field, toolbar, stat-card, toggle-row) stamp under any targetId, repeatably, returning an idMap — a data table is one apply_structure call, not 80 nodes.

Import from implementation: canvas_import_html (snippet + optional CSS) and canvas_import_url (live page — viewport/selector/waitFor/auth) turn shipped UI into an editable, TOKEN-MAPPED canvas — flex→frames, text runs, imgs, recognized SVGs→icons, checkboxes/switches/selects→input primitives; Tailwind classes map to intent (bg-surface → fill "$surface") and literal colors snap to the design system. STRUCTURE reconstructs too: <table> → rows of proportional columns, CSS grid → rows from the computed template, centered/max-width content stays centered, other multi-column CSS clusters by geometry — report.layout records how each container was handled (table|grid|centered|geometry|stack-fallback; a stack-fallback entry = hand-fix that one container, everything else arrived structurally correct). Lossy by design: READ the returned report (snapped/literals/layout/warnings) instead of assuming fidelity.

Gate integrity (keeping the canvas honest once it describes a shipped view): canvas_check_drift = WHAT structurally diverged (findings in words — missing-in-page / missing-in-canvas / control-mismatch / table-mismatch; run it BEFORE designing on such a canvas, and reconcile findings deliberately: update the canvas, flag the implementation, or ask — never silently annotate the difference); canvas_sync_from_url = HOW MUCH it looks different (ephemeral re-import + pixel diff as a changePercent); canvas_version = is a recorded approval still true (content versionHash + expectedHash check; approvals should bind to the hash, not the canvas name). Both checks also run headlessly from CI: npx framesmith check-drift / verify (exit 1 on failure).

Bulk edits & queries: replace_matching_properties applies one property change to EVERY node matching a value predicate in a single call (scope subtree + node-type filters; dryRun previews the match set first) — reach for it instead of hand-writing one batch_design U() per node when the same change spans many nodes (table cells, repeated cards). find_nodes is its read-only twin: locate nodes by property/text/name ("which node holds $1.52M?") and get ids + readable paths back — use it before targeted edits instead of guessing ids from read_nodes trees. canvas_autofix with apply: true writes every mechanical fix (spacing snaps incl. array padding, contrast, known-default accents) in one call.

Point-and-tell feedback: the user toggles Comment mode in the viewer and clicks any element to leave a note anchored to that node (or to the whole page). Comments are stored on the canvas, git-diffable in bound repos, and reach the running server automatically. Check get_feedback when picking up a canvas — each entry carries the anchor nodeId plus a node snapshot, enough to act on immediately. Open feedback blocks presenting, same as open inspector comments: address every item, then close each via resolve_feedback with a one-line note saying what changed (your note shows up as a reply in the viewer's Feedback tab).

Gotchas (current sharp edges):
- Row rules and accent bars are per-side borders — borderTop: { width: 1, color: "$border" } on each table row, borderLeft: { width: 3, color: "$primary" } for an accent edge (style "dashed"|"dotted" for forecast/draft outlines; strokeDasharray dashes SVG paths). Never fake hairlines with gap: 1 + background bleed-through.
- Prefer STRUCTURED gradient / shadows ({ stops: [...] } and [{ x, y, blur, color }]); a raw CSS string on those fields is accepted too. The plural \`shadows\` always beats the singular \`shadow\` — writing \`shadow\` on a node that has \`shadows\` is a no-op (batch_design warns when this happens).
- import_design_md reliably imports spacing + component skeletons; colors / typography / radius parsing is lossy — set those explicitly via set_variables.`;

const server = new McpServer({
  name: 'framesmith',
  version: '1.10.0',
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
  'Data screens: design every state — canvas_add_variant for "empty" / "loading" ("error" for forms) + the empty-state / skeleton-table scaffolds (coverage warns until they exist) — and run canvas_stress before presenting (fix clips/overflows with fluid widths, then re-run until CLEAN).',
  'Derive the system before drawing: generate_design_system (seed + personality → the full design language: colors, font pairing, type roles, radii, $elevation depth, $motion) is the headline call; generate_scale / generate_color_system regenerate just the scale or just the palette — then reference $tokens everywhere and let the lint re-attach any literal that drifts.',
  'Multi-screen module? Finish as a SET: project_evaluate rolls up per-screen scores + cross-screen drift (radius / accent / token adoption / copied chrome / states) — advisory, the per-canvas directives still gate; mode "llm" adds the flow critique. Compose bento/editorial layouts with real grid (layout "grid" + spans), never nested flex.',
  'Picking up an existing canvas? get_feedback first — point-and-tell comments may be waiting (node-anchored or canvas-level). Address every open item, then resolve_feedback with a note saying what changed.',
  'If the canvas describes a SHIPPED view, canvas_check_drift against the live route before designing on it — a drifted canvas means faithfully restyling a fiction. Reconcile findings deliberately (update the canvas / flag the implementation / ask), never silently annotate.',
];

const GOTCHAS = [
  'The bar: craft beautiful UI/UX a designer would sign off on, and polish to it YOURSELF — start from a pattern, use the whole toolkit (icons/fonts/controls/components), and run canvas_evaluate → resolve EVERY comment → re-evaluate until clean and > 95 BEFORE presenting. The evaluate result\'s "directive" field says when it\'s safe to present. Never show the user an unpolished design.',
  'Icons: Lucide ({ type: "icon", icon: "search" }) and Material Symbols (icon: "material:check", iconStyle outlined/rounded/sharp, "-fill" suffix for filled) render by name — never fake them with Unicode glyphs. Casing: use textTransform: "uppercase", not uppercased content.',
  'Controls: toggle / checkbox / radio / select are real node types with checked / disabled / value, token-styled — never assemble them from frames + ellipses.',
  'Bulk edits & queries: replace_matching_properties changes a property across every node matching a value predicate in one call (scope/type filters; dryRun previews the match set); find_nodes is the read-only twin — locate nodes by property/text/name and get ids + paths instead of guessing from read_nodes trees. canvas_autofix apply: true writes the whole mechanical fix set in one call.',
  'Component scaffolds: apply_structure with kind "component" structures (data-table, form-field, toolbar, stat-card, toggle-row) + targetId stamps reusable fragments with re-keyed IDs — build tables/forms from these, not node-by-node.',
  'Charts: the chart node type is data-driven ({ kind: "line"|"bar", series: [{ data, stroke, strokeDasharray?, area?, points? }], gridlines?, xLabels? }) — it does the value→coordinate math, dashes mark projected vs actual, and editing a data point is a one-prop edit. Never hand-compute path d-strings for a chart.',
  'Shared chrome is a component, not a copy-paste: create_component promotes a built subtree (render-identical; overrides target named children), batch_design I() stamps more instances, copy_nodes carries subtrees + their component defs to sibling canvases. Rebuilding an app shell node-by-node on every canvas is the anti-pattern.',
  'canvas_import_html: Tailwind classes map to intent directly (bg-surface → fill "$surface", gap-4 → 16, bg-red-500 → the bundled v4 palette hex) and literal colors snap to the design system — a bare snippet styles via the common utilities + palette; pass the compiled CSS via the css param for everything else. Always read the returned report (snapped/literals/layout/warnings); the import is honest about what it dropped.',
  'Imports reconstruct STRUCTURE: tables → proportional columns, grids → rows from the computed template, centered/max-width content stays centered, other multi-column CSS clusters by geometry. Check report.layout — a "stack-fallback" entry names a container that needs hand-fixing; everything else arrived structurally correct, so do not rebuild it.',
  'Fonts: a fontFamily named in a typography token loads automatically (Google Fonts, cached locally); typography.body.fontFamily sets the document default. "mono" / "sans" are generic shorthands (render as monospace / sans-serif, no registration). batch_design warns at write time when a family is not yet servable; a "Font warnings" item in a screenshot result means the named face is NOT rendering — fix the name or register it via set_fonts (with a css2 URL, YOUR family label is what gets registered).',
  'Row rules / accent bars: per-side borders — borderTop: { width: 1, color: "$border" } per table row, borderLeft: { width: 3, color: "$primary" } for accent edges; style "dashed"|"dotted" marks forecast/draft; strokeDasharray ("6 4") dashes SVG paths. Never fake hairlines with gap: 1 + fill bleed-through.',
  'Prefer structured gradient / shadows ({ stops: [...] } and [{ x, y, blur, color }]); a raw CSS string on those fields is accepted too. The plural `shadows` always beats the singular `shadow` — writing `shadow` on a node that has `shadows` is a no-op (batch_design warns when this happens).',
  'import_design_md reliably imports spacing + component skeletons; set colors / typography / radius explicitly via set_variables.',
  'Binding (canvas_bind, or init on first run) re-keys every project / canvas ID to repo-* form — use the IDs init returns, never cache pre-bind IDs.',
  'Point-and-tell feedback: the user clicks elements in the viewer (Comment mode) to leave node-anchored or whole-page comments, stored on the canvas at metadata.feedback. get_feedback returns them (with a node snapshot; orphaned: true = the node is gone but the concern likely still applies); open feedback blocks presenting, same as open inspector comments — address each item, then resolve_feedback with a one-line note of what changed (shown as your reply in the viewer\'s Feedback tab). canvas_list rows and canvas_evaluate results carry an openFeedback count (and the evaluate directive stays blocking) while comments are open.',
  'Cliché tells (canvas_evaluate "cliche" category): avoid default purple/indigo accents, gradient/glow overuse, fake window chrome, fabricated metrics, slop copy (filler verbs / scroll cues / "Jane Doe" / hype labels), an eyebrow above every section (keep to ~1 per 3 sections), mixed radius systems (one radius scale), pure black/white (use off-black/off-white), and competing accents (one accent hue + neutrals).',
  'Genre calibration: declare the genre the screen actually IS — stamp it durably with canvas_set_genre (no token churn; null clears), or pass genre: "dashboard" (alias "data") per call on canvas_evaluate/canvas_autofix. "dashboard" stops a data-dense screen\'s own realistic figures from flagging as fabricated; "material" allows purple + white surfaces. Genre follows what the screen is FOR, not what it contains: read screens with published figures → "dashboard"; editors/admin forms → "material". The evaluate result\'s genre field audits the choice ({ active, source, relaxed, notRelaxed }) — a score pinned by tells in notRelaxed means the genre is probably wrong. Matching an existing app\'s type scale? Declare the sizes as typography tokens — pinned sizes skip the adjacent-ratio check. Never use genre to dodge flags on a marketing page.',
  'Every state, every string: a data screen is not done at one static frame with ideal data. Tables demand designed "empty" + "loading" state variants, forms demand "error" (the coverage category warns until they exist — each is one canvas_add_variant + one scaffold stamp: empty-state / skeleton-table / skeleton-card); skeleton blocks pulse only in the live viewer, never in screenshots. Then canvas_stress before presenting: it renders hostile-but-realistic content (long-text / i18n / big-numbers / empty / many) and reports clips and overflows by node id — fix with fluid widths / minWidth floors / wrapping, or textOverflow: "ellipsis" on a label that must stay single-line (that downgrades its clip to info instead of warning), and re-run until CLEAN.',
  'Derive, don\'t hand-pick: generate_design_system (seed + REQUIRED personality: technical/editorial/soft/data-dense) writes the whole design language in one call — including $display/$heading/$body/$label typography roles, $elevation.* shadow tokens (reference as shadow: "$elevation.raised"; the dark layer re-states depth), and $motion defaults. For targeted regeneration only: generate_scale gives a modular type + space scale from a ratio (craft defaults baked in; fluid clamp() optional); generate_color_system gives OKLCH ramps + a matched neutral + status colors + the semantic tokens the structures use, AA by construction, WITH a dark theme (sparse dark.colors layer). Render dark via theme: "dark" on screenshot/screenshot_responsive/export; canvas_evaluate contrast-checks both themes automatically (dark failures point at the dark layer — never write a literal fix; APCA Lc is info-only, WCAG 2.2 gates). Literals that equal a token get re-attached by autofix; timing belongs in $motion tokens.',
  'Beyond one canvas: bento/editorial compositions are REAL grid — layout: "grid" + gridColumns (count / fr-weight array / template string) + gridColumn/gridRow spans (a number means span N); responsive: "stack" collapses to one column on mobile. Never approximate tiles with nested flex. When a multi-screen module feels done, project_evaluate reviews the SET — radius-drift / accent-drift / token-adoption / copied-chrome / state-coverage findings, each naming its canvases — and mode "llm" judges up to 8 screens together for flow consistency (flowSkipped lists anything past the cap; keyless → full roll-up + a note). ADVISORY: only the per-canvas directives gate presenting.',
  'Gate integrity: a canvas describing a SHIPPED view is a contract — run canvas_check_drift against the live route BEFORE designing on it (findings: missing-in-page / missing-in-canvas / control-mismatch / table-mismatch), and reconcile deliberately: update the canvas, flag the implementation, or ask — never silently annotate a difference. canvas_sync_from_url answers "how much does it LOOK different" (pixel %); canvas_version makes approvals falsifiable — record { canvasId, versionHash } at approval time and check with expectedHash later (metadata/feedback never moves the hash). CI can demand both: npx framesmith check-drift / verify exit 1 on failure.',
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
  'List canvases. By default returns all non-archived canvases. Filter by `projectId` to scope to one project. Set `includeArchived: true` to include archived canvases in the result. A row carrying `openFeedback: n` has open point-and-tell comments from the user waiting — read them with get_feedback before working on (or presenting) that canvas. Every row carries a `versionHash` — the design-content hash canvas_version checks approvals against, so a gate can populate its records from this listing alone. State variants (canvas_add_variant): a variant row carries `variant: { of, state }`; its base row carries `variants: [{ state, canvasId }]` — one listing answers "which states are designed for this screen".',
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

// --- canvas_add_variant (Phase 24 slice A) ---
server.tool(
  'canvas_add_variant',
  `Clone a screen into a linked STATE VARIANT — the empty / loading / error version of a canvas, as its own sibling canvas. Real UX lives in these states, and a data screen isn't done until they're designed; this makes starting one a single call instead of a rebuild.

The clone is a full canvas (re-keyed node IDs, same project, tokens/components/fonts copied, provenance/genre carried over — feedback and critique stay behind) named "<base> · <state>" and stamped with metadata.variant = { of, state }. The result's idMap maps every base node id to its clone, so follow-up edits target the right nodes immediately: delete the data rows, stamp an empty-state scaffold, adjust copy. Adding a variant to a canvas that is itself a variant links to the ROOT base (variants never nest); one canvas per state per base — a duplicate state errors instead of forking.

state is a free string; "empty", "loading", and "error" are the recommended vocabulary (they're what the viewer groups and what coverage checks will look for). canvas_list shows the designed states on the base row (variants: [{ state, canvasId }]).`,
  {
    canvasId: z.string().describe('The base canvas to clone (a variant id also works — it resolves to the root base)'),
    state: z.string().min(1).describe('The state this variant designs — "empty", "loading", "error" recommended; free string accepted'),
  },
  async ({ canvasId, state }) => {
    try {
      const { canvas, idMap } = addVariant(canvasId, state);
      const viewerUrl = getViewerUrl();
      return {
        content: [
          { type: 'text', text: JSON.stringify({
            canvasId: canvas.id,
            name: canvas.name,
            state: canvas.metadata!.variant!.state,
            of: canvas.metadata!.variant!.of,
            idMap,
            next: 'Design the state: edit via batch_design using the idMap ids (e.g. delete data rows and stamp an empty-state pattern), then evaluate as usual — variants hold the same > 95 bar.',
          }, null, 2) },
          ...(viewerUrl ? [{ type: 'text' as const, text: `View live: ${viewerUrl}/canvas/${canvas.id}` }] : []),
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
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
Returns { ok, nodeIds, results }: nodeIds maps each bound variable to the node ID it created (e.g. { "header": "n_a1b2" }) — record it and use those IDs to target nodes in later calls (bindings only live within a single call). results lists each op's outcome in order. If the call wrote a fontFamily nothing can serve yet (not cached, not registered, not system/generic), an extra "Font warnings" content item names it — cache-only check, no network, so it can't catch everything set_fonts/network resolution would.

Node types: frame, text, rectangle, ellipse, image, icon, path, component, instance, toggle, checkbox, radio, select, chart, skeleton
Properties: fill, gradient, stroke, strokeWidth, strokeStyle, borderTop, borderRight, borderBottom, borderLeft, cornerRadius, width, height, minWidth, maxWidth, layout ("horizontal"|"vertical"|"grid"), gap, rowGap, gridColumns, gridColumn, gridRow, padding, alignItems, justifyContent, fontSize, fontFamily, fontWeight, color, content, textAlign, lineHeight, letterSpacing (px), textDecoration, textTransform ("uppercase" etc. — don't bake casing into content), textOverflow ("ellipsis" — designed single-line truncation for labels that must survive hostile-length content; canvas_stress reports clips behind it as info, not warnings), tabularNums (fixed-width digits so number columns align — table scaffolds and chart ticks carry it by default), fontVariationSettings (variable-font axes, e.g. '"wght" 650'), src, objectFit, opacity, shadow, shadows (plural wins — a \`shadow\` written where \`shadows\` is set is ignored, and the op result carries a warning saying so), blur, backdropBlur, backdropFilter, overflow, wrap, position, x, y, icon, iconSize, iconColor, iconStyle, checked, disabled, value, pulse, d, viewBox, strokeLinecap, strokeLinejoin, strokeDasharray, animation, transition (object, or the string "$motion.<name>" referencing a motion token), kind, series, xDomain, yDomain, curve, gridlines, xLabels, yLabels, componentId, overrides, responsive

Charts: { type: "chart", kind: "line"|"bar", series: [{ data: [210, 450, 648], stroke: "$accent", strokeDasharray?: "6 4", area?, points? }], yDomain?: [0, 2700], curve?: "smooth", gridlines?: 4, xLabels?: ["Jan", ..., "Dec"], yLabels? } — the node does ALL the value→coordinate math (multi-series in one node; x = data index, a shorter series stops early against a longer one; domains auto from data, bars floor at 0). Dash the projected/forecast series, solid the actuals. NEVER hand-compute path d-strings or absolutely-position tick labels for a chart.

Borders: stroke + strokeWidth draw all four sides (strokeStyle "solid"|"dashed"|"dotted", default solid — a dashed outline is the forecast/placeholder convention). Per-side borders take an object: borderTop: { width: 1, color: "$border", style?: "solid"|"dashed"|"dotted" } — use these for table row rules (borderTop on each row) and accent edges (borderLeft: { width: 3, color: "$primary" }), NEVER a gap-1-with-fill-bleed hack. Paths dash via strokeDasharray: "6 4" (or [6, 4]).

Grid: layout: "grid" + gridColumns (a count → equal columns; an array of fr weights / CSS lengths like [2, 1, "240px"]; or a template string) gives real CSS grid — the bento/editorial compositions flex can only approximate. Children place with gridColumn / gridRow (a number means "span N"; strings accept "span 2" or "1 / 3"). gap covers both axes, rowGap overrides the row axis; responsive: "stack" collapses the grid to one column on mobile with spans reset. Tracks render as minmax(0, Nfr) so long content can't blow a column past its share.

Icons: two bundled sets render by name — use these instead of Unicode glyph stand-ins (✓ ● ▾):
  - Lucide (1,900+, stroke style): I("parent", { type: "icon", icon: "search", iconSize: 24, iconColor: "$primary" }) — browse at lucide.dev
  - Material Symbols (3,800+, fill style): icon: "material:check" + optional iconStyle: "outlined"|"rounded"|"sharp" (default outlined); "-fill" suffix selects the filled variant (e.g. "material:star-fill") — browse at fonts.google.com/icons

Components: I("parent", { type: "instance", componentId: "cmp-shell", overrides: { "<childName>": { content: "..." } } }) stamps a registered component (create_component promotes an existing subtree into one; overrides match def children by NAME). Instance-level props override the def root.

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
    // Phase 22 slice D (#134) — authoring-time font check (cache-only, no
    // network): flag families this call wrote that nothing can serve yet, so a
    // typo surfaces NOW instead of as a silent fallback three renders later.
    const unverified = unverifiedFamiliesInOps(operations, (canvas.fonts ?? []).map((f) => f.family));
    const fontNote = unverified.length
      ? [{ type: 'text' as const, text: `Font warnings:\n${unverified.map((f) =>
          `- "${f}" is not cached or registered yet — the next render will try Google Fonts and fall back silently if the name is wrong. Verify via screenshot (watch its Font warnings), or warm it now: set_fonts families: ["${f}"].`).join('\n')}` }]
      : [];
    const viewerUrl = getViewerUrl();
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ok: results.every((r) => r.ok), nodeIds, results }, null, 2) },
        ...fontNote,
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
      // Issue #151 — a `shadow` written where `shadows` is active is a silent
      // no-op at render time; surface it per matched node instead.
      const shadowWarned = dryRun ? [] : matched.filter((n) => ignoredShadowWarning(n, set));
      const warning = shadowWarned.length
        ? `\`shadow\` was ignored on ${shadowWarned.length} matched node(s) that also have \`shadows\`, which always wins at render time (${shadowWarned.slice(0, 5).map((n) => n.id).join(', ')}${shadowWarned.length > 5 ? ', …' : ''}). Put the value in \`shadows\`, or clear \`shadows\` first.`
        : undefined;
      const viewerUrl = getViewerUrl();
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: true, ...(dryRun ? { dryRun: true } : {}), count: matches.length, matches, ...(warning ? { warning } : {}) }, null, 2) },
          ...(!dryRun && viewerUrl ? [{ type: 'text' as const, text: `View live: ${viewerUrl}/canvas/${canvasId}` }] : []),
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- create_component (Phase 22 slice E, #130) ---
server.tool(
  'create_component',
  `Promote an existing subtree to a reusable component: the subtree moves into the canvas's component registry and an \`instance\` node takes its place — the render is pixel-identical. Returns the componentId plus \`overridableChildren\`, the named descendants that \`overrides\` can target.

Stamp more copies with batch_design: I("parent", { type: "instance", componentId: "<id>", overrides: { "<childName>": { content: "..." } } }) — overrides match children BY NAME, so name the parts you'll vary. Instance-level props (width, opacity, ...) override the def's root.

Use this the moment the same chunk exists (or is about to exist) twice — app shells, cards, rows. canvas_evaluate's "no component instances" advisory is satisfied by real instances, and copy_nodes carries the component def along when you copy an instance to another canvas.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    nodeId: z.string().describe('Root of the subtree to promote (cannot be the document root or an existing instance)'),
    name: z.string().optional().describe('Component name (default: the node\'s name, then its type). Also seeds the componentId slug.'),
  },
  async ({ canvasId, nodeId, name }) => {
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    try {
      const result = promoteToComponent(canvas, nodeId, name);
      touchCanvas(canvasId);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          ...result,
          next: `Stamp copies via batch_design: I("parentId", { type: "instance", componentId: "${result.componentId}", overrides: { ${result.overridableChildren.length ? `"${result.overridableChildren[0]}": { content: "..." }` : '/* name children to make them overridable */'} } })`,
        }, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- copy_nodes (Phase 22 slice E, #130) ---
server.tool(
  'copy_nodes',
  `Copy subtrees from one canvas into another (or duplicate within the same canvas) — the cross-canvas reuse batch_design's C() can't do. Every copied node gets a fresh id; the result's idMap (sourceId → newId, every node) and rootIds let you retarget follow-up ops immediately. Component definitions referenced by the copied trees travel along automatically (an id collision with a different def re-keys the incoming one and remaps the copied instances).

The shared-app-shell workflow: build the shell once, create_component it, then copy_nodes the instance into each sibling canvas — the def travels, and each canvas overrides the parts that differ (active nav item, page title).`,
  {
    fromCanvasId: z.string().describe('Source canvas'),
    nodeIds: z.array(z.string()).min(1).describe('Roots of the subtrees to copy'),
    toCanvasId: z.string().describe('Target canvas (may equal fromCanvasId to duplicate)'),
    parentId: z.string().optional().describe('Target parent node (default: the target document root)'),
    index: z.number().optional().describe('Insert position among the parent\'s children (default: append)'),
  },
  async ({ fromCanvasId, nodeIds, toCanvasId, parentId, index }) => {
    ensureFresh(fromCanvasId);
    if (toCanvasId !== fromCanvasId) ensureFresh(toCanvasId);
    const source = getCanvas(fromCanvasId);
    if (!source) return { content: [{ type: 'text', text: `Error: Source canvas "${fromCanvasId}" not found` }], isError: true };
    const target = getCanvas(toCanvasId);
    if (!target) return { content: [{ type: 'text', text: `Error: Target canvas "${toCanvasId}" not found` }], isError: true };
    try {
      const result = copyNodesAcross(source, target, nodeIds, parentId, index);
      touchCanvas(toCanvasId);
      const viewerUrl = getViewerUrl();
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: true, copied: nodeIds.length, ...result }, null, 2) },
          ...(viewerUrl ? [{ type: 'text' as const, text: `View live: ${viewerUrl}/canvas/${toCanvasId}` }] : []),
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
async function prepareRender(canvas: Canvas, theme?: 'light' | 'dark'): Promise<{ resolved: SceneNode; renderOpts: RenderOptions; fontWarnings: string[] }> {
  const merged = getCanvasTokens(canvas);
  const resolved = resolveVariables(canvas.root, merged, { theme });
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
    theme: z.enum(['light', 'dark']).optional().describe('Render theme — "dark" applies the design system\'s dark token layer (dark.colors/dark.elevation overrides); default light. No-op when no dark layer exists.'),
  },
  async ({ canvasId, nodeId, width, height, scale, theme }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas, theme);
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
  'Get computed bounding boxes for all nodes by rendering the canvas in a browser. Returns { nodeId, x, y, width, height } for each node — plus, on any node whose content exceeds its box, overflow data: scrollWidth/clientWidth/scrollHeight/clientHeight and an ellipsis flag when a designed text-overflow truncation is active (the same capture canvas_stress uses to detect clipping).',
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
        fontSize: z.union([z.number(), z.string()]).describe('px number, or a CSS length expression (e.g. a clamp() from generate_scale fluid mode)'),
        fontWeight: z.union([z.string(), z.number()]).optional(),
        fontFamily: z.string().optional(),
        lineHeight: z.union([z.number(), z.string()]).optional(),
        letterSpacing: z.number().optional().describe('px — applied through $refs like the rest of the token spec'),
      })).optional(),
      elevation: z.record(z.array(z.object({
        x: z.number(), y: z.number(), blur: z.number(), spread: z.number().optional(),
        color: z.string(), inset: z.boolean().optional(),
      }))).optional().describe('Elevation (shadow) tokens, keyed by name (e.g. flat/raised/floating/overlay) — reference from a node as shadow: "$elevation.<name>". Each value is a layered box-shadow array (the same shape as a node\'s "shadows" property).'),
      dark: z.object({
        colors: z.record(z.string()).optional(),
        elevation: z.record(z.array(z.object({
          x: z.number(), y: z.number(), blur: z.number(), spread: z.number().optional(),
          color: z.string(), inset: z.boolean().optional(),
        }))).optional().describe('Dark-theme elevation override, SPARSE by token name — light-tuned shadows read wrong on dark surfaces, so re-state depth here rather than inheriting it.'),
      }).optional().describe('Dark-theme override layer, SPARSE by token name — anything not overridden inherits the light value. Read by theme: "dark" renders and the dual-theme contrast check.'),
      motion: z.record(z.object({
        duration: z.number().describe('ms'),
        easing: z.string().describe('Named easing (ease, ease-out, …) or cubic-bezier(…)'),
      })).optional().describe('Motion tokens — reference from nodes as transition: "$motion.<name>". Declaring them also quiets the ad-hoc-timing consistency nudge.'),
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

// --- generate_scale (Phase 25 slice B) ---
server.tool(
  'generate_scale',
  `Derive, don't hand-pick: a named ratio + a base size → a full modular TYPE scale (text-xs … text-3xl typography tokens) and a PAIRED space scale (space-3xs … space-3xl, md = 1× base), written to the workspace / project / canvas token layer of your choice. The craft defaults are baked into every step — line-height bands (1.5 body / 1.35 subhead / 1.2 display) and negative display tracking — so by construction a generated scale satisfies the tracking advisory, and its sizes are PINNED for the type-scale ratio check (generated = declared = intentional). Usage-dependent checks still apply: measure (line length depends on your containers) and the unique-size count (use the steps a screen needs, not all seven).

Named ratios: minor-second (1.125), major-second (1.2), minor-third (1.25), major-third (1.333), perfect-fourth (1.5), golden (1.618) — or pass a number in (1, 2.2]. Reference the result as fontSize: "$text-lg" (full token spec applies) and gap/padding: "$space-md".

fluid mode (Utopia pattern): each TYPE step becomes a clamp() interpolating from ~85% of its size at minViewport (default 390) to full size at maxViewport (default 1440) — the renderer passes the expression through, and clamp-typed sizes are exempt from the numeric scale checks. The space scale stays static numbers by design (spacing tokens and the spacing checks are number-based).

Merges into the target layer like set_variables (existing token names are overwritten and reported in "overwrote"; other categories untouched). Exactly ONE of canvasId / projectId / workspaceId.`,
  {
    ratio: z.union([z.string(), z.number()]).describe('Named ratio ("major-third", "perfect-fourth", …) or a number in (1, 2.2]'),
    baseSize: z.number().min(10).max(24).optional().describe('Body size the scale pivots on (default 16)'),
    stepsDown: z.number().int().min(0).max(4).optional().describe('Steps below base (default 2: sm, xs)'),
    stepsUp: z.number().int().min(0).max(6).optional().describe('Steps above base (default 4: lg … 3xl)'),
    fluid: z.object({
      minViewport: z.number().optional().describe('Viewport where each step bottoms out at ~85% (default 390)'),
      maxViewport: z.number().optional().describe('Viewport where each step reaches full size (default 1440)'),
    }).optional().describe('Emit Utopia-style clamp() type sizes instead of static px'),
    canvasId: z.string().optional().describe('Write to this canvas\'s variables'),
    projectId: z.string().optional().describe('Write to this project\'s design system'),
    workspaceId: z.string().optional().describe('Write to this workspace\'s design system'),
  },
  async ({ ratio, baseSize, stepsDown, stepsUp, fluid, canvasId, projectId, workspaceId }) => {
    const targets = [canvasId, projectId, workspaceId].filter(Boolean);
    if (targets.length !== 1) {
      return { content: [{ type: 'text', text: 'Error: pass exactly ONE of canvasId / projectId / workspaceId — the layer the scale is written to.' }], isError: true };
    }
    try {
      const typography = generateTypeScale({ ratio: ratio as RatioName | number, baseSize, stepsDown, stepsUp, fluid });
      const spacing = generateSpaceScale(baseSize ?? 16);

      let existing: DesignVariables | undefined;
      let wroteTo: Record<string, string>;
      if (canvasId) {
        ensureFresh(canvasId);
        const canvas = getCanvas(canvasId);
        if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
        existing = canvas.variables;
        setVariables(canvas, { typography, spacing });
        touchCanvas(canvasId);
        wroteTo = { layer: 'canvas', id: canvasId };
      } else if (projectId) {
        existing = getProjectDesignSystem(projectId);
        if (setProjectDesignSystem(projectId, { typography, spacing }) === undefined) {
          return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
        }
        wroteTo = { layer: 'project', id: projectId };
      } else {
        existing = getWorkspaceDesignSystem(workspaceId!);
        if (setWorkspaceDesignSystem(workspaceId!, { typography, spacing }) === undefined) {
          return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
        }
        wroteTo = { layer: 'workspace', id: workspaceId! };
      }

      const overwrote = [
        ...Object.keys(typography).filter((k) => existing?.typography?.[k] !== undefined),
        ...Object.keys(spacing).filter((k) => existing?.spacing?.[k] !== undefined),
      ];
      return { content: [{ type: 'text', text: JSON.stringify({
        wroteTo,
        ratio: resolveRatio(ratio as RatioName | number),
        typography,
        spacing,
        ...(overwrote.length ? { overwrote } : {}),
        note: `Reference sizes as fontSize: "$text-…" (the full token spec — line-height and display tracking — applies through the ref) and spacing as "$space-…". Generated sizes are pinned for the type-scale check.${fluid ? ' Fluid clamp() sizes are exempt from numeric scale checks; the space scale stays static.' : ''}`,
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- generate_color_system (Phase 25 slice C) ---
server.tool(
  'generate_color_system',
  `One seed color → a full perceptual color system: OKLCH ramps primary-50…900 (even lightness steps, chroma tapered at the extremes, gamut-clipped toward lower chroma — never hue-shifted), a matched neutral ramp (a whisper of the seed's hue — never dead grey, never visibly tinted), status colors (success / warning / danger, hue held but darkened until each clears WCAG AA as TEXT on white — the invariant is shared contrast, not shared lightness), and the SEMANTIC tokens the structures already speak: bg-primary, bg-surface, bg-elevated, text-primary, text-secondary, border, accent. Text and accent steps are picked by MEASURED contrast — every semantic text/surface pair clears WCAG AA by construction, not by hope.

The DARK theme ships in the same call (the Radix pattern: a reversed walk of the same ramps, not inverted hex): the semantic dark mapping is WRITTEN to the layer's dark.colors override — so theme: "dark" on screenshot/export renders it and canvas_evaluate contrast-checks BOTH themes from then on. Status colors get a SECOND pass for dark: the light-tuned success/warning/danger are re-lit (hue held) until each clears AA against the dark surface too, so a $danger message reads in both themes. Writes the light system to exactly ONE of canvasId / projectId / workspaceId. Canvas scope honors the inherited-design-system contract (tokens the canvas inherits from workspace/project are PRESERVED and reported, same as apply_preset — pass them explicitly via set_variables if you want the generated values). Raise your palette floor: generate first, then adjust individual tokens — don't eyeball ten hexes.`,
  {
    seed: z.string().describe('The brand color to derive everything from (#RRGGBB)'),
    canvasId: z.string().optional().describe('Write to this canvas\'s variables'),
    projectId: z.string().optional().describe('Write to this project\'s design system'),
    workspaceId: z.string().optional().describe('Write to this workspace\'s design system'),
  },
  async ({ seed, canvasId, projectId, workspaceId }) => {
    const targets = [canvasId, projectId, workspaceId].filter(Boolean);
    if (targets.length !== 1) {
      return { content: [{ type: 'text', text: 'Error: pass exactly ONE of canvasId / projectId / workspaceId — the layer the system is written to.' }], isError: true };
    }
    try {
      const system = generateColorSystem(seed);
      const colors: Record<string, string> = {};
      for (const [step, hex] of Object.entries(system.primary)) colors[`primary-${step}`] = hex;
      for (const [step, hex] of Object.entries(system.neutral)) colors[`neutral-${step}`] = hex;
      Object.assign(colors, system.status, system.light);

      let preserved: Array<{ category: string; key: string; kept: string; preset: string }> = [];
      let overwrote: string[] = [];
      let wroteTo: Record<string, string>;
      if (canvasId) {
        ensureFresh(canvasId);
        const canvas = getCanvas(canvasId);
        if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
        overwrote = Object.keys(colors).filter((k) => canvas.variables.colors?.[k] !== undefined);
        const merge = applyPresetTokens(canvas, { colors }, getInheritedTokens(canvas));
        preserved = merge.preserved;
        setVariables(canvas, { dark: { colors: { ...system.dark } } });
        touchCanvas(canvasId);
        wroteTo = { layer: 'canvas', id: canvasId };
      } else if (projectId) {
        const existing = getProjectDesignSystem(projectId);
        overwrote = Object.keys(colors).filter((k) => existing?.colors?.[k] !== undefined);
        if (setProjectDesignSystem(projectId, { colors, dark: { colors: { ...system.dark } } }) === undefined) {
          return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
        }
        wroteTo = { layer: 'project', id: projectId };
      } else {
        const existing = getWorkspaceDesignSystem(workspaceId!);
        overwrote = Object.keys(colors).filter((k) => existing?.colors?.[k] !== undefined);
        if (setWorkspaceDesignSystem(workspaceId!, { colors, dark: { colors: { ...system.dark } } }) === undefined) {
          return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
        }
        wroteTo = { layer: 'workspace', id: workspaceId! };
      }

      return { content: [{ type: 'text', text: JSON.stringify({
        wroteTo,
        seed: system.seed,
        primary: system.primary,
        neutral: system.neutral,
        status: system.status,
        semantics: system.light,
        dark: system.dark,
        ...(preserved.length ? { preservedFromDesignSystem: preserved } : {}),
        ...(overwrote.length ? { overwrote } : {}),
        note: 'Light system + dark override layer written. Reference tokens as $primary-600, $bg-surface, $accent, … (the semantic names are the same vocabulary the structure scaffolds use); render the dark theme with theme: "dark" on screenshot/export — canvas_evaluate now contrast-checks both themes automatically.',
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- generate_design_system (Phase 27 slice A) ---
server.tool(
  'generate_design_system',
  `THE way to start a new project's look: one seed color + one PERSONALITY → the complete design language, deterministically, no API key. Composes the color engine (OKLCH ramps + semantic tokens + dark theme, AA by construction — everything generate_color_system does) and the scale engine (modular type + space ladder, craft defaults baked in), then adds what neither engine has an opinion about: a curated font pairing loaded through the font pipeline (real faces from the first screenshot), per-role tracking/leading, a radius stance, a density stance, $elevation.* shadow tokens WITH a dark-theme treatment, and $motion defaults.

Personalities (required — pick a stance, don't default into sameness):
- "technical" — crisp, engineered, product-tool energy (Space Grotesk + Inter, tight display tracking, 6/10/14 radii, quick motion). For developer tools, admin panels, B2B products.
- "editorial" — confident serif voice, generous air (Fraunces + Source Sans 3, larger scale contrast, near-sharp radii). For marketing pages, content products, brand sites.
- "soft" — warm, rounded, human (Plus Jakarta Sans + Inter, 12/16/20 radii, springy motion). For consumer apps, onboarding, anything friendly.
- "data-dense" — instrument-panel density (Inter + a JetBrains Mono "figures" role, 13px pivot, minimal radii, near-flat depth). For dashboards, tables, monitoring.

The typography layer ships ROLE tokens the structures speak — $display / $heading / $body / $label / $caption (+ $figures when a mono face exists) — alongside the text-xs…text-3xl steps. Depth: reference elevation from any node as shadow: "$elevation.flat|raised|floating|overlay" — the dark layer re-states each depth so it reads on dark surfaces. Writes to exactly ONE of canvasId / projectId / workspaceId; canvas scope preserves inherited design-system tokens (reported, same contract as generate_color_system). The two single-purpose generators stay available for targeted regeneration (just the palette, just the scale).`,
  {
    seed: z.string().describe('The brand color to derive everything from (#RRGGBB)'),
    personality: z.enum(['technical', 'editorial', 'soft', 'data-dense']).describe('The design stance — required. Genre guide: dashboards → data-dense or technical; marketing/content → editorial; consumer → soft.'),
    baseSize: z.number().optional().describe('Override the personality\'s type pivot (10–24px)'),
    ratio: z.union([z.enum(['minor-second', 'major-second', 'minor-third', 'major-third', 'perfect-fourth', 'golden']), z.number()]).optional().describe('Override the personality\'s scale ratio'),
    canvasId: z.string().optional().describe('Write to this canvas\'s variables'),
    projectId: z.string().optional().describe('Write to this project\'s design system'),
    workspaceId: z.string().optional().describe('Write to this workspace\'s design system'),
  },
  async ({ seed, personality, baseSize, ratio, canvasId, projectId, workspaceId }) => {
    const targets = [canvasId, projectId, workspaceId].filter(Boolean);
    if (targets.length !== 1) {
      return { content: [{ type: 'text', text: 'Error: pass exactly ONE of canvasId / projectId / workspaceId — the layer the system is written to.' }], isError: true };
    }
    try {
      const system = generateDesignSystem(seed, personality as PersonalityName, { baseSize, ratio });
      const vars = system.variables;

      let preserved: Array<{ category: string; key: string; kept: string; preset: string }> = [];
      let wroteTo: Record<string, string>;
      if (canvasId) {
        ensureFresh(canvasId);
        const canvas = getCanvas(canvasId);
        if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
        const merge = applyPresetTokens(canvas, { colors: vars.colors, spacing: vars.spacing, radius: vars.radius, typography: vars.typography }, getInheritedTokens(canvas));
        preserved = merge.preserved;
        setVariables(canvas, { elevation: vars.elevation, motion: vars.motion, dark: vars.dark });
        touchCanvas(canvasId);
        wroteTo = { layer: 'canvas', id: canvasId };
      } else if (projectId) {
        if (setProjectDesignSystem(projectId, vars) === undefined) {
          return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found` }], isError: true };
        }
        wroteTo = { layer: 'project', id: projectId };
      } else {
        if (setWorkspaceDesignSystem(workspaceId!, vars) === undefined) {
          return { content: [{ type: 'text', text: `Error: Workspace "${workspaceId}" not found` }], isError: true };
        }
        wroteTo = { layer: 'workspace', id: workspaceId! };
      }

      const fontsContent = await warmFontsContent({ typography: vars.typography });

      return { content: [
        { type: 'text', text: JSON.stringify({
          wroteTo,
          personality: system.personality,
          intent: system.intent,
          fonts: system.fonts,
          seed: system.colorSystem.seed,
          semantics: system.colorSystem.light,
          typographyRoles: { display: vars.typography!['display'], heading: vars.typography!['heading'], body: vars.typography!['body'], label: vars.typography!['label'] },
          radius: vars.radius,
          elevation: Object.keys(vars.elevation ?? {}),
          motion: Object.keys(vars.motion ?? {}),
          ...(preserved.length ? { preservedFromDesignSystem: preserved } : {}),
          note: 'Full design language written: reference $display/$heading/$body/$label typography roles, $bg-surface/$accent/… colors, shadow: "$elevation.raised" for depth, transition: "$motion.base" for timing. Render dark with theme: "dark" — colors AND elevation re-state themselves. Same seed with a different personality gives a visibly different product.',
        }, null, 2) },
        ...fontsContent,
      ] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
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
  - fonts: [{ family, url }] with a Google Fonts CSS URL (fonts.googleapis.com/css2?...) — the faces are extracted from the stylesheet and registered under YOUR family label (the label wins: { family: "mono", url: <JetBrains Mono css2 URL> } makes fontFamily: "mono" render JetBrains Mono; the result's "aliased" field shows the mapping).
Fonts named in typography tokens load automatically at render time — you only need set_fonts for families outside the token system or from non-Google sources. Shorthand generics need no registration at all: fontFamily "mono" / "sans" render as CSS monospace / sans-serif.`,
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
    const aliased: { family: string; stylesheetFamilies: string[] }[] = [];

    for (const f of fonts ?? []) {
      if (isStylesheetUrl(f.url)) {
        try {
          // The caller's family label wins (#134): faces extracted from the
          // stylesheet register under it, so nodes referencing that label match.
          const { faces, stylesheetFamilies } = await resolveStylesheetUrl(f.url, {}, f.family);
          next.push(...faces);
          if (stylesheetFamilies.some((s) => s.toLowerCase() !== f.family.toLowerCase())) {
            aliased.push({ family: f.family, stylesheetFamilies });
          }
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
      content: [{ type: 'text', text: JSON.stringify({ fonts: canvas.fonts, ...(aliased.length ? { aliased } : {}), ...(failed.length ? { failed } : {}) }, null, 2) }],
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
    theme: z.enum(['light', 'dark']).optional().describe('Render theme — "dark" applies the design system\'s dark token layer (dark.colors/dark.elevation overrides); default light. No-op when no dark layer exists.'),
  },
  async ({ canvasId, format, outputPath, nodeIds, width, height, scale, theme }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas, theme);
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

    // versionHash ties the exported artifact to the exact design it rendered
    // (Phase 23 slice A — an approval screenshot is checkable later).
    return { content: [{ type: 'text', text: JSON.stringify({ exported: exportedFiles, versionHash: canvasVersionHash(canvas) }, null, 2) }, ...fontWarningContent(fontWarnings)] };
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
    theme: z.enum(['light', 'dark']).optional().describe('Render theme — "dark" applies the design system\'s dark token layer (dark.colors/dark.elevation overrides); default light. No-op when no dark layer exists.'),
  },
  async ({ canvasId, breakpoints, scale, theme }) => {
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const { resolved, renderOpts, fontWarnings } = await prepareRender(canvas, theme);
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

// --- canvas_check_drift (Phase 23 slice B, #148) ---
server.tool(
  'canvas_check_drift',
  `Structural drift detection: re-import a live page EPHEMERALLY (no canvas created, nothing mutated) and compare WHAT the canvas and the shipped view are made of — where canvas_sync_from_url answers "how much does it LOOK different" (a pixel percentage), this answers "what diverged", in words. Coarse by design: it compares text runs, controls, and table shapes — never styles or geometry.

Finding kinds: missing-in-page (the canvas shows something the page doesn't have — a phantom column, a control that was never built), missing-in-canvas (the page grew something the canvas doesn't show), control-mismatch (e.g. the canvas has a radio group ("Notification type"); the page has a select), table-mismatch (column/header divergence; row-count differences are info-only — data length isn't drift). Mostly-numeric texts are treated as data, not structure, so live figures don't false-flag; unmatched page text is a count, never per-string noise. inSync is true only when there are zero error/warning findings.

Run this when PICKING UP a canvas that describes a shipped view — designing on a drifted canvas means faithfully restyling a fiction. On findings, reconcile DELIBERATELY: update the canvas (batch_design / canvas_import_url), fix the implementation, or flag the difference to the user — never silently annotate it away. The result carries the canvas's versionHash so a gate can record what was checked. Same live-page controls as canvas_import_url (viewport / selector / waitFor / auth — auth stays in a throwaway context, never persisted). CI/pre-commit can run the same check without an MCP client: \`npx framesmith check-drift <canvasIdOrName> --url <url>\` exits 1 on drift.`,
  {
    canvasId: z.string().describe('The canvas that is the design-of-record'),
    url: z.string().regex(/^https?:\/\//i).describe('The live page to compare against (http/https)'),
    viewport: z.object({
      width: z.number().optional().describe('Import width (default: the canvas root width, else 1440)'),
      height: z.number().optional().describe('Import height (default: the canvas root height, else 900)'),
    }).optional(),
    selector: z.string().optional().describe('Compare against one component instead of the whole page'),
    waitFor: z.union([z.string(), z.number()]).optional().describe('CSS selector to await, or delay in ms — for JS-rendered pages'),
    auth: z.object({
      headers: z.record(z.string()).optional(),
      cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string().optional(), path: z.string().optional() })).optional(),
    }).optional().describe('Credentials for gated pages — throwaway context, never persisted'),
  },
  async ({ canvasId, url, viewport, selector, waitFor, auth }) => {
    ensureFresh(canvasId); // compare what's on disk, not a stale in-memory copy
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    try {
      const w = viewport?.width ?? (typeof canvas.root.width === 'number' ? canvas.root.width : 1440);
      const h = viewport?.height ?? (typeof canvas.root.height === 'number' ? canvas.root.height : 900);

      const imported = await importUrl(url, { viewport: { width: w, height: h }, selector, waitFor, auth });
      // Instance-expanded so stamped components (app shells) are inventoried.
      const drift = computeStructuralDrift(expandInstances(canvas.root, canvas), imported.root);

      const blocking = drift.findings.filter((f) => f.severity !== 'info').length;
      return {
        content: [{ type: 'text', text: JSON.stringify({
          ...drift,
          versionHash: canvasVersionHash(canvas),
          verdict: drift.inSync
            ? 'IN SYNC — no structural drift between the canvas and the page.'
            : `DRIFTED — ${blocking} structural finding(s). Reconcile deliberately: update the canvas, fix the implementation, or flag the difference — do not design on this canvas as-is.`,
        }, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- canvas_version (Phase 23 slice A, #149) ---
server.tool(
  'canvas_version',
  `The falsifiable half of a design-approval gate: returns the canvas's versionHash — a stable content hash (sha256:<16 hex>) of the DESIGN itself (node tree, canvas tokens, components, fonts). Metadata never moves it: feedback arriving or being resolved, critique stamps, and provenance changes all leave the hash unchanged, so an approval recorded against a hash survives everything except an actual design change.

Record { canvasId, versionHash } wherever approvals live (a YAML file, a PR comment — that's the consumer's concern); later, pass the recorded hash as expectedHash and the result's "matches" boolean tells you whether the approved canvas is still the current design. canvas_list rows carry the same versionHash, so a gate can populate its records from a listing alone. The hash is process- and machine-independent — the same checked-in repo canvas hashes identically everywhere. CI/pre-commit can run the same check without an MCP client: \`npx framesmith verify <canvasIdOrName> --hash <hash>\` exits 1 on mismatch.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    expectedHash: z.string().optional().describe('A previously recorded versionHash to check against — the result gains matches: true/false'),
  },
  async ({ canvasId, expectedHash }) => {
    ensureFresh(canvasId); // hash what's on disk, not a stale in-memory copy
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    const versionHash = canvasVersionHash(canvas);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        canvasId,
        name: canvas.name,
        versionHash,
        lastModified: canvas.lastModified,
        ...(expectedHash !== undefined ? { matches: versionHash === expectedHash } : {}),
      }, null, 2) }],
    };
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

// --- canvas_set_genre (issue #162) ---
server.tool(
  'canvas_set_genre',
  `Durably declare what a canvas IS — writes the genre to metadata.provenance.preset WITHOUT the token/component churn of apply_preset, so an already-styled canvas can be calibrated in one call. The stamp is what canvas_evaluate / canvas_autofix / the viewer's quality panel read when no explicit genre param is passed (the evaluate result's genre.source shows "provenance" for a stamp vs "explicit" for a param). Pass genre: null to clear the stamp; other provenance facts (structure, importedFrom) are preserved either way.

Genres that relax cliche tells: "material" (accent-hue, pure-black-white), "dashboard" / alias "data" (honest-content). Any other string is stored but relaxes nothing — the result's "relaxes" list (and a note) tells you immediately, instead of a silently ineffective stamp. Genre follows what the screen is FOR, not what it contains: read screens with published figures → "dashboard"; editors/admin forms → "material". NEVER use a genre to dodge flags on a marketing page — declaring the wrong genre doesn't make the design better, it makes the evaluator blind.

Stamping a genre does NOT move the canvas's versionHash (the hash covers design content only, never metadata) — recorded approvals stay valid.`,
  {
    canvasId: z.string().describe('Canvas ID'),
    genre: z.string().nullable().describe('Genre to stamp (e.g. "dashboard", "material"), or null to clear the stamp'),
  },
  async ({ canvasId, genre }) => {
    const result = setCanvasGenre(canvasId, genre);
    if (!result) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };
    const relaxes = genre === null ? [] : relaxedByGenre(genre);
    const unknown = genre !== null && relaxes.length === 0;
    return {
      content: [{ type: 'text', text: JSON.stringify({
        canvasId,
        genre,
        previous: result.previous,
        relaxes,
        ...(unknown ? { note: `"${genre}" is not a known relax-genre — it will relax no cliche tells (known: ${knownGenres().join(', ')}). The stamp is stored anyway (preset names are legal here).` } : {}),
        versionHashUnchanged: true,
      }, null, 2) }],
    };
  }
);

// --- canvas_evaluate ---
server.tool(
  'canvas_evaluate',
  `Auto-score a design canvas against quality criteria. Returns an overall score (0-100), category scores, and actionable issues referencing specific node IDs. Categories: spacing, color, typography, structure, consistency (craft), plus "cliche" — the machine-made tells: default purple/indigo accents, gradient/glow overuse, fake browser/phone chrome (traffic-light dots), the hanging eyebrow-beside-heading header, fabricated-looking metrics/testimonials/logos, too many eyebrow labels (template rhythm — an eyebrow above nearly every section), slop copy (stock AI phrasing: filler verbs, scroll cues, placeholder names like "Jane Doe", hype labels), mixed radius systems (radius consistency — too many distinct corner radii), pure black/white (harsh #000000 ink or a stark #ffffff page vs a designed off-black/off-white), and competing accents (accent consistency — more than one accent hue). cliche issues carry a "tell" discriminator and are advisory (warning/info). The color category is DUAL-THEME aware: when the design system has a dark token layer (dark.colors — see set_variables / generate_color_system), contrast is checked in BOTH themes — dark-run issues carry theme: "dark", the category score takes the worse theme, and dark failures point at the dark token layer instead of carrying a literal fix (a node-level literal would break the light theme). WCAG 2.2 remains the gate; WCAG-passing pairs that are perceptually weak by APCA (Lc below ~75 body / ~60 large) get an INFO advisory — APCA is a candidate method, not a standard, and never blocks. Plus "coverage" (Phase 24): a BASE canvas whose content carries data — a detected table (empty + loading demanded) or a form of 3+ input controls (error demanded) — gets a directive-blocking WARNING per missing state variant; the result's "coverage" field reports { dataBearing, states, missing }. Designing the state is one canvas_add_variant + one scaffold stamp (empty-state / skeleton-table / skeleton-card); variant canvases themselves and non-data screens get no coverage findings. Modes:
  - "fast": JSON-only, <100ms, deterministic heuristics only.
  - "detailed": adds Puppeteer-based pixel overlap detection in the consistency category.
  - "llm": fast-mode heuristics plus a vision-model critique against a FIXED rubric (provider picked from FRAMESMITH_LLM_PROVIDER env var, or whichever of ANTHROPIC_API_KEY / OPENAI_API_KEY is set). Adds an "llmCritique" field: { rubric: { hierarchy, execution, specificity, restraint, variety } each {score 1-5, rationale}, score (0-100 derived), summary, suggestions, needsRevision, failingAxes }. The verdict is stamped on the canvas (metadata.critique) + the per-project build log for auditability. Cost: one paid API call per invocation. To CLOSE the loop and auto-fix failing axes, use canvas_revise.
Designed for generator-evaluator loops: generate with batch_design, evaluate with canvas_evaluate, fix issues targeting the returned nodeIds (canvas_autofix handles the mechanical subset). The result includes a "directive" field — a present/keep-working verdict: resolve EVERY comment and clear > 95 before showing the design to the user; the directive tells you when it's safe to present. An "openFeedback" field (when > 0) counts the user's open point-and-tell comments — they block presenting even at a READY score; read them with get_feedback and close them with resolve_feedback.

THE HEURISTIC DIRECTIVE IS THE PRESENTATION GATE. mode: "llm" adds optional depth (a vision-model rubric critique — composition, hierarchy, polish) on top; it requires an ANTHROPIC_API_KEY or OPENAI_API_KEY and fails gracefully without one — the FULL heuristic result still returns with an llmNote explaining what's missing, and the heuristic directive alone decides. Data-dense screens: pass genre: "dashboard" so the design's own realistic figures aren't flagged as fabricated (see the genre param).

The result's "genre" field (present whenever cliche ran) makes the genre decision auditable: { active, source ("explicit" param | "provenance" stamp | null), relaxed (tells skipped), notRelaxed ([{ tell, relaxedBy }] — tells still flagging that a DIFFERENT genre would relax) }. If the score is pinned by tells listed in notRelaxed, the genre is probably wrong — genre follows what the screen is FOR (read screens with published figures → "dashboard"; editors/admin forms → "material"), not what it contains.`,
  {
    canvasId: z.string().describe('Canvas ID to evaluate'),
    mode: z.enum(['fast', 'detailed', 'llm']).default('fast').describe('"fast" = JSON-only (<100ms), "detailed" = + Puppeteer layout checks, "llm" = fast + vision-model rubric critique'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche', 'coverage']))
      .optional()
      .describe('Specific categories to evaluate (default: all)'),
    genre: z.string().optional()
      .describe('Genre/style that relaxes specific cliche gates — "material" allows purple accents and white elevated surfaces; "dashboard" (alias "data") allows realistic figures on data-dense product screens (relaxes honest-content). Defaults to the canvas provenance preset if stamped (canvas_set_genre stamps it durably, no token churn). Pick by what the screen is FOR, not what it contains: read screens presenting figures are "dashboard"; editors and admin forms are "material". The result\'s genre field shows what the choice did.'),
    floor: z.number().min(1).max(5).optional()
      .describe('llm mode only: per-axis rubric floor (1-5). Any axis below it sets needsRevision. Default 3 (or FRAMESMITH_CRITIQUE_FLOOR).'),
  },
  async ({ canvasId, mode, categories, genre, floor }) => {
    ensureFresh(canvasId); // a point-and-tell comment may have just arrived from the viewer
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    // Phase 24 slice C — the coverage check needs to know which state
    // variants exist for this canvas (sibling lookup, store-level).
    const designedStates = listCanvases().find((r) => r.id === canvasId)?.variants?.map((v) => v.state) ?? [];
    const result = await evaluateCanvas(canvas, { mode, categories, genre, designedStates });

    let llmNote: string | undefined;
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
        // Phase 26 slice C — keyless alignment with project_evaluate: a
        // missing provider degrades to a NOTE on the full heuristic result
        // (the directive alone decides); only real API failures error.
        if (err instanceof LLMJudgeUnavailableError) {
          llmNote = `LLM critique unavailable: ${err.message} The heuristic result stands alone.`;
        } else {
          return { content: [{ type: 'text', text: `LLM critique failed: ${(err as Error).message}` }], isError: true };
        }
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
      content: [{ type: 'text', text: JSON.stringify({ ...result, ...(llmNote ? { llmNote } : {}), ...(openFeedback > 0 ? { openFeedback } : {}), directive }, null, 2) }],
    };
  }
);

// --- canvas_autofix ---
server.tool(
  'canvas_autofix',
  `Run canvas_evaluate in fast mode and return the subset of issues that have a mechanically derived fix (off-scale spacing — gap, scalar AND array-form padding (the fix writes the complete snapped array) — → snap to scale; missing layout on multi-child frame → set vertical; recoverable WCAG contrast failure → switch text to #000 or #FFF, whichever wins; default-purple accent → swap to a neutral accent; fake-chrome strip → delete; pure-black ink → soften to off-black; a literal fill/stroke/color/cornerRadius that exactly equals a SINGLE token's value → re-pointed to the \$ref — a value shared by multiple tokens is reported with candidates but never auto-fixed). By default this PROPOSES: each fix carries a ready-to-paste \`batch_design\` op string and a one-line rationale. Pass apply: true to also WRITE the fixes to the canvas in the same call — the result then reports applied/failed per op. Taste-dependent cliche tells (gradient/glow overuse, the hanging header, fabricated content, eyebrow-rhythm overuse, slop copy, mixed radius systems, competing accents) carry a suggestion but no auto-fix — call canvas_evaluate to see those. Coverage warnings (missing empty/loading/error state variants) also have no mechanical fix: designing a state is judgment — the suggestion names the canvas_add_variant + scaffold path. Closes the generator-evaluator loop: generate with batch_design → autofix (apply: true) → re-evaluate.`,
  {
    canvasId: z.string().describe('Canvas ID to autofix'),
    categories: z.array(z.enum(['spacing', 'color', 'typography', 'structure', 'consistency', 'cliche', 'coverage']))
      .optional()
      .describe('Restrict to fixes from these categories (default: all)'),
    genre: z.string().optional()
      .describe('Genre/style that relaxes specific cliche gates — "material" allows purple accents and white elevated surfaces; "dashboard" (alias "data") allows realistic figures on data-dense product screens (relaxes honest-content). Defaults to the canvas provenance preset if stamped (canvas_set_genre stamps it durably, no token churn). Pick by what the screen is FOR, not what it contains: read screens presenting figures are "dashboard"; editors and admin forms are "material". The result\'s genre field shows what the choice did.'),
    apply: z.boolean().optional()
      .describe('Write the fixes to the canvas in this call (default false: propose only, returning ops to run via batch_design).'),
  },
  async ({ canvasId, categories, genre, apply }) => {
    if (apply) ensureFresh(canvasId); // mutating path — pick up external edits first
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    const designedStates = listCanvases().find((r) => r.id === canvasId)?.variants?.map((v) => v.state) ?? [];
    const result = await evaluateCanvas(canvas, { mode: 'fast', categories, genre, designedStates });
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
          ...(result.genre ? { genre: result.genre } : {}),
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
        ...(result.genre ? { genre: result.genre } : {}),
        appliedCount: applied.length,
        applied,
        ...(failed.length ? { failed } : {}),
        note: 'Fixes written to the canvas — re-run canvas_evaluate to confirm.',
      }, null, 2) }],
    };
  }
);

// --- canvas_stress (Phase 24 slice D) ---
server.tool(
  'canvas_stress',
  `Content stress test: does the design survive real data? Re-renders the canvas under hostile-but-realistic content perturbations and reports exactly what broke, by node id — the too-long name that clips, the German label that wraps ugly, the "999+" badge that blows its box. Never mutates the canvas.

Perturbations (default: all): long-text (non-data text ×2.2 plus one long unbroken token — the wrap-breaker), i18n (×1.4 — the German/Finnish expansion rule), big-numbers (data-like text to its widest realistic form: "9" → "999+", "$1.5M" → "$1,520,847.33"), empty (detected tables lose their data rows), many (data rows ×3). Tables are found with the same inventory drift and coverage use.

Finding kinds: clip (content cut off — INFO when a designed text-overflow ellipsis is doing its job, or when it is just the page growing taller than its fixed artboard, which scrolls on a real page; WARNING otherwise), overflow-x (a node escapes its parent box or the canvas), layout-shift (an UNTOUCHED node ballooning — perturbed nodes, their ancestors, and siblings that merely stretch with a growing parent are exempt). Only NEW breakage counts: anything already clipping at baseline is the design's standing state, not the perturbation's fault. verdict is CLEAN only with zero warnings — fix findings with fluid widths, minWidth floors, wrapping, or textOverflow: "ellipsis" on labels that must stay single-line (that is the designed-truncation property the info path rewards), then re-run. Chrome required; ~1 render per perturbation.`,
  {
    canvasId: z.string().describe('Canvas to stress'),
    perturbations: z.array(z.enum(['long-text', 'i18n', 'big-numbers', 'empty', 'many'])).optional()
      .describe('Subset to run (default: all five)'),
    screenshots: z.boolean().optional().describe('Attach a render of each perturbation that produced warnings (default false)'),
  },
  async ({ canvasId, perturbations, screenshots }) => {
    ensureFresh(canvasId);
    const canvas = getCanvas(canvasId);
    if (!canvas) return { content: [{ type: 'text', text: 'Error: Canvas not found' }], isError: true };

    try {
      const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
      const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
      const merged = getCanvasTokens(canvas);
      const { renderOpts, fontWarnings } = await prepareRender(canvas);
      // Instance-expanded so stamped components stress like everything else;
      // the expanded tree is the base for BOTH sides so node ids align.
      const expandedBase = expandInstances(canvas.root, canvas);
      const baselineHtml = renderToHtml(resolveVariables(structuredClone(expandedBase), merged), w, h, canvas, renderOpts);
      const baselineLayout = await computeLayout(baselineHtml, undefined, 25, { width: w, height: h });

      const names = (perturbations ?? PERTURBATION_NAMES) as PerturbationName[];
      const perturbationResults: Record<string, unknown>[] = [];
      const images: { type: 'image'; data: string; mimeType: string }[] = [];
      let warnings = 0;
      let infos = 0;

      for (const name of names) {
        const { root, touched } = applyPerturbation(name, expandedBase);
        if (touched.length === 0) {
          perturbationResults.push({ name, skipped: 'nothing to perturb (no matching content)' });
          continue;
        }
        const html = renderToHtml(resolveVariables(structuredClone(root), merged), w, h, canvas, renderOpts);
        const layout = await computeLayout(html, undefined, 25, { width: w, height: h });
        const findings = compareLayouts(baselineLayout, layout, touched, w);
        warnings += findings.filter((f) => f.severity === 'warning').length;
        infos += findings.filter((f) => f.severity === 'info').length;
        perturbationResults.push({ name, touchedCount: touched.length, findings });
        if (screenshots && findings.some((f) => f.severity === 'warning')) {
          images.push({ type: 'image', data: await takeScreenshot(html, { width: w, height: h, scale: 1 }), mimeType: 'image/png' });
        }
      }

      const verdict = warnings === 0
        ? `CLEAN — the design held its layout under ${names.length} content perturbation(s).${infos ? ` ${infos} designed truncation(s) engaged (info).` : ''}`
        : `FRAGILE — ${warnings} layout break(s) under hostile content. Fix with fluid widths / minWidth floors / wrapping (see width strategies), then re-run.`;

      return {
        content: [
          { type: 'text', text: JSON.stringify({
            canvasId,
            versionHash: canvasVersionHash(canvas),
            perturbations: perturbationResults,
            counts: { warnings, infos },
            verdict,
          }, null, 2) },
          ...images,
          ...fontWarningContent(fontWarnings),
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- project_evaluate (Phase 26 slice B) ---
server.tool(
  'project_evaluate',
  `The set-level review no single canvas can give: per-screen score summaries plus the checks that only exist ACROSS screens. Run it when a multi-screen module feels done.

Cross-screen findings (each names its evidence — which canvases, which values): radius-drift (a screen whose corner-radius set shares nothing with the project's common scale), accent-drift (an accent hue > 30° from the project's dominant one), token-adoption (a screen styling by hand while the rest reference tokens), copied-chrome (the same substantial top-level shape hand-copied on 2+ screens instead of component instances — the create_component + copy_nodes path is named), and state-coverage (the aggregated missing empty/loading/error table).

THIS IS ADVISORY, NOT A GATE. Only the per-canvas directives (canvas_evaluate score, coverage, feedback) gate presenting — this roll-up reviews coherence and points at fixes; it never blocks. Variant canvases are excluded from the rows (they'd double-count screens) and feed their base's states column instead. The default mode is Chrome-free and needs no API key.

mode: "llm" adds the FLOW CRITIQUE: up to 8 screens are rendered and judged TOGETHER (one multi-image call) against a fixed flow rubric — navigation-consistency, terminology-consistency, state-visibility, hierarchy-consistency — each 1-5 with a rationale, plus per-screen notes naming the canvas. Screens past the cap are listed in flowSkipped (pass canvasIds to pick the flow yourself — nothing is silently dropped). Needs Chrome + an ANTHROPIC_API_KEY or OPENAI_API_KEY; WITHOUT a key the full heuristic roll-up still returns, with a flowNote instead of an error.`,
  {
    projectId: z.string().describe('The project whose screens to roll up'),
    canvasIds: z.array(z.string()).optional().describe('Restrict to these canvases (e.g. the screens of one flow); default: every non-variant canvas in the project'),
    mode: z.enum(['fast', 'llm']).default('fast').describe('"fast" = heuristic roll-up only (Chrome-free, keyless); "llm" adds the multi-image flow critique (Chrome + API key; degrades to a note without one)'),
  },
  async ({ projectId, canvasIds, mode }) => {
    if (!getProject(projectId)) {
      return { content: [{ type: 'text', text: `Error: Project "${projectId}" not found. Use project_list to see projects.` }], isError: true };
    }
    const rows = listCanvases().filter((r) => r.projectId === projectId && !r.archived && !r.variant && (!canvasIds || canvasIds.includes(r.id)));
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'Error: no matching canvases in this project (variants are excluded — pass base canvas ids).' }], isError: true };
    }
    const canvases: Canvas[] = [];
    for (const r of rows) {
      ensureFresh(r.id);
      const c = getCanvas(r.id);
      if (c) canvases.push(c);
    }
    const statesByCanvas = new Map(rows.map((r) => [r.id, r.variants?.map((v) => v.state) ?? []]));
    const result = await evaluateProject(canvases, statesByCanvas);

    // Phase 26 slice C — the flow critique: one multi-image judge call over
    // up to 8 screens. Any failure (no key, API hiccup) degrades to a note —
    // the heuristic roll-up is the primary product and always returns.
    let flowCritique: unknown;
    let flowSkipped: string[] | undefined;
    let flowNote: string | undefined;
    if (mode === 'llm') {
      const FLOW_CAP = 8;
      const flowCanvases = canvases.slice(0, FLOW_CAP);
      flowSkipped = canvases.slice(FLOW_CAP).map((c) => c.name);
      if (flowCanvases.length < 2) {
        flowNote = 'Flow critique needs at least 2 screens — flow qualities do not exist on one.';
      } else {
        try {
          const screens = [];
          for (const c of flowCanvases) {
            const { resolved, renderOpts } = await prepareRender(c);
            const w = typeof c.root.width === 'number' ? c.root.width : 1440;
            const h = typeof c.root.height === 'number' ? c.root.height : 900;
            const html = renderToHtml(resolved, w, h, c, renderOpts);
            screens.push({ name: c.name, png: await takeScreenshot(html, { width: w, height: h, scale: 1 }) });
          }
          flowCritique = await judgeFlow(screens);
        } catch (err) {
          flowNote = err instanceof LLMJudgeUnavailableError
            ? `Flow critique unavailable: ${err.message} The heuristic roll-up below stands alone.`
            : `Flow critique failed (${(err as Error).message}) — the heuristic roll-up below stands alone.`;
        }
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify({
      projectId,
      ...result,
      ...(flowCritique ? { flowCritique } : {}),
      ...(flowSkipped?.length ? { flowSkipped } : {}),
      ...(flowNote ? { flowNote } : {}),
    }, null, 2) }] };
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

// Phase 23 slice C — CLI dispatch (spec C5). EXACT subcommand names only:
// anything else (including flags an MCP client might pass) falls through to
// the server unchanged, so `npx framesmith` keeps booting as the MCP server.
const CLI_COMMANDS = new Set(['check-drift', 'verify', 'help', '--help', '-h']);
if (CLI_COMMANDS.has(process.argv[2])) {
  const { runCli } = await import('./cli.js');
  process.exit(await runCli(process.argv.slice(2)));
} else {
  main().catch((err) => {
    console.error('Failed to start framesmith:', err);
    process.exit(1);
  });
}
