// Renders docs/phase9-design-system.png — Phase 9 dogfood. A single canvas
// that visually documents a workspace's design system AND proves the
// inheritance chain works end-to-end. Every value in the scene graph is a
// `$token` reference; zero hex codes live inside the canvas. The resolved
// values come from `workspace.designSystem`.
//
// Idempotent: finds-or-creates the "Coide" workspace by name. Rerunning the
// script overwrites the canvas and re-applies the workspace tokens, so it's
// safe to iterate.
//
// Publishes to ~/.canvas-mcp/canvases/phase9-design-system.json with a stable
// ID so the design is reviewable live at
// http://localhost:3001/canvas/phase9-design-system — animations play, custom
// font swaps in, and you can verify (via DevTools) that fills/colors resolve
// to the workspace token values.
//
// Usage: npx tsx scripts/build-phase9-showcase.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer';
import { renderToHtml } from '../src/renderer.js';
import { resolveVariables, mergeDesignTokens } from '../src/variables.js';
import {
  loadPersistedWorkspaces,
  ensureDefaultWorkspaceAndProject,
  createWorkspace,
  listWorkspaces,
  createProject,
  listProjects,
  setWorkspaceDesignSystem,
  getWorkspace,
} from '../src/workspaces.js';
import { type Canvas, type FontFace, type SceneNode } from '../src/types.js';

// ---- Boot ---------------------------------------------------------------
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();

// Idempotent workspace lookup by name. createWorkspace assigns a nanoid each
// time, so we look for an existing match first and reuse it on reruns.
// This page IS canvas-mcp's own design system, so it lives in a workspace
// named after the project itself — not a hypothetical client workspace.
const WORKSPACE_NAME = 'canvas-mcp';
const PROJECT_NAME = 'Design system';
let workspace = listWorkspaces().find((w) => w.name === WORKSPACE_NAME);
if (!workspace) workspace = createWorkspace(WORKSPACE_NAME);
let project = listProjects(workspace.id).find((p) => p.name === PROJECT_NAME);
if (!project) project = createProject(workspace.id, PROJECT_NAME)!;

// ---- Design system ------------------------------------------------------
// THIS is the canonical token source. Setting it on the workspace means
// every canvas under "Coide" inherits these values — no per-canvas
// redefinition. The page below references each value by name only.
setWorkspaceDesignSystem(workspace.id, {
  colors: {
    bg: '#09070a',
    surface: '#1a160f',
    surfaceElevated: '#231d13',
    border: '#2a241a',
    textPrimary: '#fafaf5',
    textSecondary: '#b8b3a6',
    textMuted: '#7a7464',
    primary: '#f59e0b',         // amber-500 — signature
    primarySoft: '#fde68a',     // amber-200
    primaryDeep: '#b45309',     // amber-700
    success: '#22c55e',
    info: '#3b82f6',
  },
  spacing: { xs: 8, sm: 12, md: 20, lg: 32, xl: 48 },
  radius: { sm: 6, md: 12, lg: 18 },
  typography: {
    h1: { fontSize: 56, fontWeight: 700, lineHeight: 1.05 },
    h2: { fontSize: 22, fontWeight: 600, lineHeight: 1.3 },
    body: { fontSize: 15, fontWeight: 400, lineHeight: 1.55 },
    label: { fontSize: 12, fontWeight: 600, lineHeight: 1.4 },
    mono: { fontSize: 13, fontWeight: 500, lineHeight: 1.4 },
  },
});

// ---- Inter font (Phase 8 reuse) -----------------------------------------
const FONTS: FontFace[] = [
  { family: 'Inter', url: 'https://fonts.bunny.net/inter/files/inter-latin-400-normal.woff2', weight: 400 },
  { family: 'Inter', url: 'https://fonts.bunny.net/inter/files/inter-latin-600-normal.woff2', weight: 600 },
  { family: 'Inter', url: 'https://fonts.bunny.net/inter/files/inter-latin-700-normal.woff2', weight: 700 },
];
// Single-quoted family inside double-quoted CSS attribute (see PR #36 escape).
const FONT_STACK = "'Inter', system-ui, -apple-system, sans-serif";

// ---- Helpers ------------------------------------------------------------
// Each section frame uses workspace tokens via `$name`. Helpers return
// scene nodes that consume only those references.

// Note on labels: text content that starts with `$` is interpreted as a token
// reference by resolveVariables, so we don't put `$` in label content. The
// bare name reads as a token identifier in context (each section header
// names what we're showing) and the footer caption documents the
// `fill: "$name"` convention for code.

function swatch(name: string, hex: string, index: number): SceneNode {
  return {
    id: `swatch-${name}`,
    type: 'frame',
    layout: 'vertical',
    gap: '$xs',
    animation: { name: 'fadeIn', duration: 350, delay: 80 + index * 40 },
    children: [
      { id: `swatch-${name}-chip`, type: 'frame', width: 96, height: 56, fill: `$${name}`, cornerRadius: '$md', stroke: '$border', strokeWidth: 1 },
      { id: `swatch-${name}-label`, type: 'text', content: name, fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$textPrimary' },
      { id: `swatch-${name}-value`, type: 'text', content: hex, fontFamily: FONT_STACK, fontSize: '$mono', color: '$textMuted' },
    ],
  };
}

function spacingRow(name: string, px: number, index: number): SceneNode {
  return {
    id: `space-${name}`,
    type: 'frame',
    layout: 'horizontal',
    alignItems: 'center',
    gap: '$md',
    animation: { name: 'fadeIn', duration: 350, delay: 200 + index * 50 },
    children: [
      { id: `space-${name}-label`, type: 'text', content: name, fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$textPrimary', width: 48 },
      { id: `space-${name}-bar`, type: 'frame', width: px, height: 8, fill: '$primary', cornerRadius: '$sm' },
      { id: `space-${name}-px`, type: 'text', content: `${px}px`, fontFamily: FONT_STACK, fontSize: '$mono', color: '$textMuted' },
    ],
  };
}

function radiusBox(name: string, px: number, index: number): SceneNode {
  return {
    id: `radius-${name}`,
    type: 'frame',
    layout: 'vertical',
    gap: '$xs',
    alignItems: 'center',
    animation: { name: 'scaleIn', duration: 350, delay: 400 + index * 60 },
    children: [
      { id: `radius-${name}-box`, type: 'frame', width: 64, height: 64, fill: '$surfaceElevated', cornerRadius: `$${name}`, stroke: '$border', strokeWidth: 1 },
      { id: `radius-${name}-label`, type: 'text', content: name, fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$textPrimary' },
      { id: `radius-${name}-px`, type: 'text', content: `${px}px`, fontFamily: FONT_STACK, fontSize: '$mono', color: '$textMuted' },
    ],
  };
}

function typeSample(name: string, sample: string, index: number): SceneNode {
  return {
    id: `type-${name}`,
    type: 'frame',
    layout: 'vertical',
    gap: '$xs',
    animation: { name: 'fadeIn', duration: 350, delay: 600 + index * 50 },
    children: [
      { id: `type-${name}-label`, type: 'text', content: name, fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$primary' },
      // `$h1`, `$h2` etc. resolve to the fontSize (resolveVariables returns
      // .fontSize for typography tokens), so the same name controls both the
      // documented row label and the rendered sample size.
      { id: `type-${name}-sample`, type: 'text', content: sample, fontFamily: FONT_STACK, fontSize: `$${name}`, color: '$textPrimary' },
    ],
  };
}

// ---- Logo mark (SVG path — Phase 8 reuse) -------------------------------
const logoMark: SceneNode = {
  id: 'logo-mark', type: 'path',
  width: 32, height: 32, viewBox: '0 0 24 24',
  d: 'M 4 4 L 20 4 L 20 20 L 4 20 Z M 4 11 L 20 11 M 11 11 L 11 20',
  fill: 'none', stroke: '$primary', strokeWidth: 1.8,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};

// ---- Header (logo + workspace name + version) ---------------------------
const header: SceneNode = {
  id: 'header',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center',
  gap: '$md',
  children: [
    logoMark,
    { id: 'workspace-name', type: 'text', content: 'canvas-mcp / Design system', fontFamily: FONT_STACK, fontSize: 18, fontWeight: 600, color: '$textPrimary' },
    { id: 'spacer', type: 'frame', width: 1, height: 1 },
    {
      id: 'version-pill',
      type: 'frame',
      layout: 'horizontal',
      alignItems: 'center',
      gap: '$xs',
      padding: '$xs',
      fill: '$surfaceElevated',
      cornerRadius: '$lg',
      stroke: '$border',
      strokeWidth: 1,
      children: [
        { id: 'pill-dot', type: 'frame', width: 6, height: 6, fill: '$primary', cornerRadius: '$lg' },
        { id: 'pill-text', type: 'text', content: 'workspace design system', fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$textSecondary' },
      ],
    },
  ],
};

// ---- Hero ---------------------------------------------------------------
const hero: SceneNode = {
  id: 'hero',
  type: 'frame',
  layout: 'vertical',
  gap: '$md',
  animation: { name: 'slideUp', duration: 500, easing: 'ease-out' },
  children: [
    { id: 'eyebrow', type: 'text', content: 'v0.9.0 — DESIGN SYSTEM INHERITANCE', fontFamily: FONT_STACK, fontSize: 13, fontWeight: 600, color: '$primary', letterSpacing: 1.2 },
    { id: 'headline', type: 'text', content: 'Tokens declared once,\ninherited everywhere.', fontFamily: FONT_STACK, fontSize: '$h1', fontWeight: 700, color: '$textPrimary', lineHeight: 1.05, letterSpacing: -1.5 },
    { id: 'subhead', type: 'text', content: 'canvas-mcp declares its design system once on the workspace. Every canvas under it references tokens by name — this page itself contains zero hex codes.', fontFamily: FONT_STACK, fontSize: '$body', color: '$textSecondary', maxWidth: 640 },
  ],
};

// ---- Color palette section ----------------------------------------------
const COLOR_KEYS: Array<[string, string]> = [
  ['bg', '#09070a'],
  ['surface', '#1a160f'],
  ['primary', '#f59e0b'],
  ['primarySoft', '#fde68a'],
  ['primaryDeep', '#b45309'],
  ['textPrimary', '#fafaf5'],
  ['textSecondary', '#b8b3a6'],
  ['success', '#22c55e'],
  ['info', '#3b82f6'],
];
const colorSection: SceneNode = {
  id: 'section-colors',
  type: 'frame',
  layout: 'vertical',
  gap: '$md',
  children: [
    { id: 'colors-title', type: 'text', content: '01 · COLORS', fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$primary', letterSpacing: 1.2 },
    {
      id: 'colors-grid',
      type: 'frame',
      layout: 'horizontal',
      wrap: true,
      gap: '$md',
      children: COLOR_KEYS.map(([n, hex], i) => swatch(n, hex, i)),
    },
  ],
};

// ---- Spacing section ----------------------------------------------------
const SPACING_KEYS: Array<[string, number]> = [['xs', 8], ['sm', 12], ['md', 20], ['lg', 32], ['xl', 48]];
const spacingSection: SceneNode = {
  id: 'section-spacing',
  type: 'frame',
  layout: 'vertical',
  gap: '$md',
  children: [
    { id: 'spacing-title', type: 'text', content: '02 · SPACING', fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$primary', letterSpacing: 1.2 },
    {
      id: 'spacing-rows',
      type: 'frame',
      layout: 'vertical',
      gap: '$sm',
      children: SPACING_KEYS.map(([n, px], i) => spacingRow(n, px, i)),
    },
  ],
};

// ---- Radius section -----------------------------------------------------
const RADIUS_KEYS: Array<[string, number]> = [['sm', 6], ['md', 12], ['lg', 18]];
const radiusSection: SceneNode = {
  id: 'section-radius',
  type: 'frame',
  layout: 'vertical',
  gap: '$md',
  children: [
    { id: 'radius-title', type: 'text', content: '03 · RADIUS', fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$primary', letterSpacing: 1.2 },
    {
      id: 'radius-grid',
      type: 'frame',
      layout: 'horizontal',
      gap: '$lg',
      children: RADIUS_KEYS.map(([n, px], i) => radiusBox(n, px, i)),
    },
  ],
};

// ---- Typography section -------------------------------------------------
const TYPE_KEYS: Array<[string, string]> = [
  ['h1', 'Display headline'],
  ['h2', 'Section heading'],
  ['body', 'Body paragraph with a complete sentence.'],
  ['label', 'LABEL · UPPERCASE TAG'],
];
const typeSection: SceneNode = {
  id: 'section-typography',
  type: 'frame',
  layout: 'vertical',
  gap: '$md',
  children: [
    { id: 'type-title', type: 'text', content: '04 · TYPOGRAPHY', fontFamily: FONT_STACK, fontSize: '$label', fontWeight: 600, color: '$primary', letterSpacing: 1.2 },
    {
      id: 'type-list',
      type: 'frame',
      layout: 'vertical',
      gap: '$md',
      children: TYPE_KEYS.map(([n, sample], i) => typeSample(n, sample, i)),
    },
  ],
};

// ---- Footer caption -----------------------------------------------------
const footer: SceneNode = {
  id: 'footer',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center',
  gap: '$md',
  padding: '$md',
  fill: '$surface',
  cornerRadius: '$lg',
  stroke: '$border',
  strokeWidth: 1,
  animation: { name: 'fadeIn', duration: 400, delay: 800 },
  children: [
    {
      id: 'footer-mono-key', type: 'text',
      content: '`fill: "$primary"`',
      fontFamily: FONT_STACK, fontSize: '$mono', fontWeight: 600, color: '$primarySoft',
    },
    {
      id: 'footer-body', type: 'text',
      content: '→ resolved via workspace.designSystem.colors.primary. No hex codes in this canvas — change the workspace tokens and the whole page updates.',
      fontFamily: FONT_STACK, fontSize: '$body', color: '$textSecondary',
    },
  ],
};

// ---- Body ---------------------------------------------------------------
const body: SceneNode = {
  id: 'body',
  type: 'frame',
  layout: 'vertical',
  gap: '$xl',
  padding: '$xl',
  children: [
    header,
    hero,
    colorSection,
    spacingSection,
    {
      id: 'two-up',
      type: 'frame',
      layout: 'horizontal',
      gap: '$xl',
      alignItems: 'start',
      responsive: 'stack',
      children: [radiusSection, typeSection],
    },
    footer,
  ],
};

// ---- Root --------------------------------------------------------------
const WIDTH = 1280;
const HEIGHT = 1280;
const root: SceneNode = {
  id: 'doc',
  type: 'document',
  fill: '$bg',
  fontFamily: FONT_STACK,
  width: WIDTH,
  height: HEIGHT,
  children: [body],
};

// ---- Build canvas -------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'docs', 'phase9-design-system.png');
const STORE_DIR = join(process.env.CANVAS_MCP_HOME ?? join(homedir(), '.canvas-mcp'), 'canvases');
const CANVAS_ID = 'phase9-design-system';

const now = new Date().toISOString();
const canvas: Canvas = {
  id: CANVAS_ID,
  name: 'canvas-mcp design tokens (v0.9.0)',
  root,
  variables: {}, // intentionally empty — all tokens come from the workspace
  components: {},
  fonts: FONTS,
  createdAt: now,
  lastModified: now,
  projectId: project.id,
};

// Compose the merged tokens by hand for the puppeteer render (production
// renderer goes through the MCP server's tokensFor helper). The screenshot
// must reflect the workspace inheritance, not just canvas.variables.
const ws = getWorkspace(workspace.id);
const tokens = mergeDesignTokens(ws?.designSystem, project.designSystem, canvas.variables);
const resolvedRoot = resolveVariables(root, tokens);
const html = renderToHtml(resolvedRoot, WIDTH, HEIGHT, canvas);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));
  const buf = await page.screenshot({ type: 'png', fullPage: true });
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, buf);
  console.log(`Wrote ${OUTPUT}`);
} finally {
  await browser.close();
}

await mkdir(STORE_DIR, { recursive: true });
await writeFile(join(STORE_DIR, `${CANVAS_ID}.json`), JSON.stringify(canvas, null, 2));
console.log(`Published canvas "${CANVAS_ID}" to ${STORE_DIR}`);
console.log(`Open it in the viewer: http://localhost:3001/canvas/${CANVAS_ID}`);
console.log(`Workspace: "${WORKSPACE_NAME}" (${workspace.id}) — design system set`);
