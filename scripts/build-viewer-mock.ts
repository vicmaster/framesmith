// Renders docs/viewer-refresh-mock.png — the design spec for the Phase 7
// slice 5 viewer UI refresh. Composed entirely as a canvas-mcp scene graph
// and screenshotted through the renderer + puppeteer pipeline.
//
// Also publishes the canvas to ~/.canvas-mcp/canvases/ so the live spec is
// reviewable at http://localhost:3001/canvas/viewer-refresh-mock with breakpoint
// + Compare modes (not just as a flat PNG attached to a PR).
//
// Usage: npx tsx scripts/build-viewer-mock.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer';
import { renderToHtml } from '../src/renderer.js';
import { type Canvas, type SceneNode } from '../src/types.js';
import {
  loadPersistedWorkspaces,
  ensureDefaultWorkspaceAndProject,
  createWorkspace,
  listWorkspaces,
  createProject,
  listProjects,
} from '../src/workspaces.js';

// ---- Palette ------------------------------------------------------------
// Amber-gold direction. Purple/indigo became the default for AI-generated
// "premium dark theme" by 2026 (Linear-inspired everywhere); canvas-mcp's
// identity is the opposite of that. Warm near-black surfaces, amber→orange
// accent that maps to the canvas/paint metaphor of the product, used very
// sparingly so it reads as a signature rather than as decoration.
const C = {
  // Surfaces — warm-tinted darks (brown/khaki undertone, not pure neutral)
  bg0: '#09070a',
  bg1: '#0d0b0a',
  sidebar: '#14110c',
  surface: '#1a160f',
  surfaceHover: '#211c14',
  surfaceElevated: '#251f15',
  // Borders
  border: '#2a241a',
  borderSubtle: '#1f1b13',
  borderHighlight: 'rgba(255,255,255,0.04)', // glass rim on cards
  // Text — slightly warm whites/greys
  textPrimary: '#fafaf5',
  textSecondary: '#b8b3a6',
  textTertiary: '#807965',
  textMuted: '#4f4a3e',
  // Accent — flat amber + a couple derivatives. No gradient pairs.
  accentFrom: '#f59e0b',                  // amber-500 — the signature
  accentDeep: '#b45309',                  // amber-700 — for hover-down states
  accentSoft: '#fde68a',                  // amber-200 — active text/count contrast
  accentActiveBg: 'rgba(245,158,11,0.08)',// active-row fill, single flat tint
  // Project dot palette — varied colors so the sidebar reads identifiable
  // per project, but skewed away from purple to keep the AI-default-purple
  // feel out of the design entirely.
  dot1: '#22c55e', // green
  dot2: '#3b82f6', // blue
  dot3: '#f59e0b', // amber (matches main accent — it's fine, this is canvas-mcp)
  dot4: '#ec4899', // pink
  dot5: '#06b6d4', // cyan
  dot6: '#ef4444', // red
  // Content thumbnail palettes — keep mixed so cards have visual variety,
  // but make the amber/gold one the most prominent (last in the rotation
  // since it ends a row).
  chartGreen:  ['#34d399', '#10b981'],
  chartBlue:   ['#60a5fa', '#3b82f6'],
  chartAmber:  ['#fcd34d', '#f59e0b'], // replaces the indigo/violet variant
};

const FONT_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';

// ---- Sidebar pieces -----------------------------------------------------

const sidebarHeader: SceneNode = {
  id: 'sb-header',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center',
  gap: 11,
  padding: [22, 20],
  children: [
    // Logo mark: flat amber rounded square. Gradient-free per the design
    // direction — flat colors read as more disciplined and confident than
    // the AI-default "gradient on the brand mark" recipe.
    {
      id: 'sb-logo-mark',
      type: 'frame',
      width: 22, height: 22,
      cornerRadius: 6,
      fill: C.accentFrom,
    },
    { id: 'sb-logo-text', type: 'text', content: 'Canvas', fontSize: 14, fontWeight: 600, color: C.textPrimary, letterSpacing: -0.1 },
  ],
};

const wsLabel = (id: string, text: string): SceneNode => ({
  id, type: 'text', content: text,
  fontSize: 10, fontWeight: 600, color: C.textMuted,
  letterSpacing: 0.9, textTransform: 'uppercase',
});

const projectDot = (id: string, color: string): SceneNode => ({
  id, type: 'ellipse', width: 6, height: 6, fill: color,
});

// Project row. When active, it gets:
//   - a soft gradient fill (accent-from low alpha → accent-to lower alpha)
//   - a 2px solid accent-color left bar (acts as a focus marker)
//   - 600-weight project name + brighter count badge
// This reads more like Linear's active-item treatment than a flat blue tint.
const projectRow = (id: string, name: string, count: string, dotColor: string, active = false): SceneNode => {
  const base: SceneNode = {
    id, type: 'frame',
    layout: 'horizontal',
    alignItems: 'center',
    padding: [8, 12, 8, active ? 10 : 12], // shave 2px of left padding when active so the left bar can fit
    gap: 10,
    cornerRadius: 6,
    children: [
      // Left accent bar appears only when active. Flat amber — was a gradient,
      // gradient-free design direction means it's a single confident color.
      ...(active
        ? [{
            id: `${id}-bar`,
            type: 'frame' as const,
            width: 2, height: 14,
            fill: C.accentFrom,
            cornerRadius: 2,
          }]
        : []),
      projectDot(`${id}-dot`, dotColor),
      {
        id: `${id}-name`,
        type: 'text',
        content: name,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? C.textPrimary : C.textSecondary,
        width: '100%', // takes remaining width so the count anchors right
      },
      { id: `${id}-count`, type: 'text', content: count, fontSize: 11, fontWeight: 500, color: active ? C.accentSoft : C.textMuted },
    ],
  };
  if (active) {
    // Flat low-alpha amber instead of horizontal gradient — feels more
    // intentional and matches the no-gradients direction.
    base.fill = C.accentActiveBg;
  }
  return base;
};

const wsSection = (id: string, label: string, projects: SceneNode[]): SceneNode => ({
  id, type: 'frame', layout: 'vertical', gap: 1,
  padding: [0, 8, 14, 8],
  children: [
    { id: `${id}-label-wrap`, type: 'frame', padding: [16, 12, 8, 12], children: [wsLabel(`${id}-label`, label)] },
    ...projects,
  ],
});

const archiveRow: SceneNode = {
  id: 'sb-archive',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center', gap: 10,
  padding: [9, 12],
  cornerRadius: 6,
  children: [
    // Archive box icon — small rounded rect with a top "lid line" via inner shadow
    {
      id: 'sb-archive-icon',
      type: 'frame', width: 16, height: 13,
      fill: 'transparent',
      stroke: C.textTertiary, strokeWidth: 1.2,
      cornerRadius: 2,
    },
    { id: 'sb-archive-name', type: 'text', content: 'Archive', fontSize: 13, fontWeight: 500, color: C.textSecondary, width: '100%' },
    { id: 'sb-archive-count', type: 'text', content: '8', fontSize: 11, fontWeight: 500, color: C.textMuted },
  ],
};

const sidebar: SceneNode = {
  id: 'sidebar',
  type: 'frame',
  width: 248, height: 900,
  fill: C.sidebar,
  layout: 'vertical',
  alignItems: 'stretch',
  shadows: [
    // 1px right border via shadow (cleaner than `stroke` which paints all sides)
    { x: 1, y: 0, blur: 0, spread: 0, color: C.borderSubtle },
  ],
  children: [
    sidebarHeader,
    {
      id: 'sb-nav', type: 'frame',
      layout: 'vertical', gap: 0, padding: [4, 0, 0, 0],
      width: '100%',
      children: [
        // Dogfood the example data: canvas-mcp is the active workspace, Viewer
        // is the active project — i.e. exactly what we're working on right now.
        wsSection('ws-canvas', 'canvas-mcp', [
          projectRow('p-viewer',   'Viewer',          '14', C.dot1, true),
          projectRow('p-renderer', 'Renderer',        '6',  C.dot2),
          projectRow('p-roadmap',  'Roadmap',         '5',  C.dot3),
        ]),
        wsSection('ws-coide', 'Coide', [
          projectRow('p-agents',  'Agents tab',  '9', C.dot4),
          projectRow('p-memory',  'Memory',      '4', C.dot5),
        ]),
        wsSection('ws-magma', 'Magmalabs', [
          projectRow('p-sandbox', 'Sandbox', '3', C.dot6),
        ]),
      ],
    },
    // Push footer to the bottom. Implemented as a fixed-height spacer because
    // the renderer doesn't expose flex-grow as a primitive.
    { id: 'sb-spacer', type: 'frame', height: 190 },
    {
      id: 'sb-footer', type: 'frame',
      padding: [10, 8, 14, 8], width: '100%', gap: 2,
      shadows: [{ x: 0, y: -1, blur: 0, spread: 0, color: C.borderSubtle, inset: true }],
      children: [archiveRow],
    },
  ],
};

// ---- Main pane pieces ---------------------------------------------------

// A small "Personal / Untitled" style breadcrumb where the workspace name
// is dim and the project name is brighter — guides the eye to "where am I."
const breadcrumb: SceneNode = {
  id: 'breadcrumb', type: 'frame',
  layout: 'horizontal', alignItems: 'center', gap: 8,
  children: [
    { id: 'bc-ws',   type: 'text', content: 'canvas-mcp', fontSize: 12, fontWeight: 500, color: C.textTertiary },
    { id: 'bc-sep',  type: 'text', content: '/',          fontSize: 12, fontWeight: 500, color: C.textMuted },
    { id: 'bc-proj', type: 'text', content: 'Viewer',     fontSize: 12, fontWeight: 600, color: C.textSecondary },
  ],
};

// Title row: title on the left, "14 canvases" meta and a "+ New canvas" CTA
// on the right. Justify space-between gives the page a stronger horizontal axis.
const titleRow: SceneNode = {
  id: 'title-row', type: 'frame',
  layout: 'horizontal', alignItems: 'center', justifyContent: 'space-between', gap: 24,
  children: [
    {
      id: 'title-block', type: 'frame', layout: 'vertical', gap: 6, alignItems: 'start',
      children: [
        breadcrumb,
        { id: 'title', type: 'text', content: 'Viewer', fontSize: 36, fontWeight: 700, color: C.textPrimary, letterSpacing: -0.6 },
        { id: 'meta', type: 'text', content: '14 canvases', fontSize: 13, fontWeight: 500, color: C.textTertiary },
      ],
    },
    // "+ New canvas" pill: subtle border, soft gradient on hover (mocked via
    // a low-alpha fill here). Right-aligned so it anchors the header axis.
    {
      id: 'cta-new', type: 'frame',
      layout: 'horizontal', alignItems: 'center', gap: 8,
      padding: [10, 16],
      cornerRadius: 8,
      fill: C.surfaceElevated,
      shadows: [
        { x: 0, y: 1, blur: 0, spread: 0, color: C.borderHighlight, inset: true },
        { x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(0,0,0,0.3)' },
      ],
      children: [
        { id: 'cta-plus', type: 'text', content: '+', fontSize: 14, fontWeight: 600, color: C.accentSoft },
        { id: 'cta-text', type: 'text', content: 'New canvas', fontSize: 13, fontWeight: 600, color: C.textPrimary },
      ],
    },
  ],
};

const mainHeader: SceneNode = {
  id: 'main-header',
  type: 'frame',
  padding: [28, 36, 24, 36],
  children: [titleRow],
};

const headerDivider: SceneNode = { id: 'main-divider', type: 'frame', height: 1, fill: C.borderSubtle, width: '100%' };

// ---- Cards --------------------------------------------------------------

// Empty thumbnail: instead of a tiny dashed square that reads as "broken,"
// use two stacked hairline rectangles on a flat warm surface — feels like
// "blank canvas, ready" rather than "missing image."
const emptyThumb = (id: string): SceneNode => ({
  id: `${id}-thumb`, type: 'frame',
  width: '100%', height: 168,
  position: 'relative',
  overflow: 'hidden',
  fill: '#15110b', // flat warm dark (between sidebar and surface tones)
  cornerRadius: [12, 12, 0, 0],
  alignItems: 'center', justifyContent: 'center',
  children: [
    // Stack two squares offset, hinting at "layered canvas." No halo —
    // the gradient halo was the obvious thing to drop in a flat redesign.
    {
      id: `${id}-mark-back`, type: 'frame',
      width: 38, height: 28,
      stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1,
      cornerRadius: 4,
      position: 'absolute', x: 144, y: 76,
    },
    {
      id: `${id}-mark-front`, type: 'frame',
      width: 38, height: 28,
      stroke: 'rgba(255,255,255,0.10)', strokeWidth: 1,
      cornerRadius: 4,
      fill: 'rgba(255,255,255,0.02)',
      position: 'absolute', x: 152, y: 72,
    },
  ],
});

// Content thumbnail: faux "designed canvas" preview — flat warm bg + a
// mini bar chart where each bar is a single flat color. Gradient bars
// were the cliché AI tell; flat chart bars feel more like a real product.
const contentThumb = (id: string, palette: string[]): SceneNode => ({
  id: `${id}-thumb`, type: 'frame',
  width: '100%', height: 168,
  position: 'relative',
  overflow: 'hidden',
  fill: '#1a140c', // flat darker warm than empty-thumb so they read distinct
  cornerRadius: [12, 12, 0, 0],
  alignItems: 'center', justifyContent: 'center',
  children: [
    {
      id: `${id}-chart`, type: 'frame',
      layout: 'horizontal', alignItems: 'end', gap: 7,
      children: [40, 64, 50, 80, 96].map((h, i) => ({
        id: `${id}-b${i}`,
        type: 'frame' as const,
        width: 14, height: h,
        cornerRadius: 2,
        // The last bar uses the secondary palette color so the eye lands
        // on it as the "headline" — same compositional move, just flat.
        fill: i === 4 ? palette[2] : palette[0],
      })),
    },
  ],
});

const card = (id: string, name: string, meta: string, variant: 'empty' | 'green' | 'blue' | 'amber'): SceneNode => {
  const palette =
    variant === 'green' ? [...C.chartGreen, ...C.chartAmber] :
    variant === 'blue'  ? [...C.chartBlue,  ...C.chartAmber] :
    variant === 'amber' ? [...C.chartAmber, ...C.chartGreen] :
    [];
  return {
    id, type: 'frame',
    width: 264,
    fill: C.surface,
    cornerRadius: 12,
    layout: 'vertical',
    shadows: [
      // 1px top-highlight gives the card a glassy upper edge — Linear-style polish
      { x: 0, y: 1, blur: 0, spread: 0, color: C.borderHighlight, inset: true },
      // Soft drop shadow for depth without weight
      { x: 0, y: 4, blur: 12, spread: -2, color: 'rgba(0,0,0,0.35)' },
    ],
    children: [
      variant === 'empty' ? emptyThumb(id) : contentThumb(id, palette),
      {
        id: `${id}-info`, type: 'frame',
        padding: [14, 16, 16, 16],
        gap: 4,
        children: [
          { id: `${id}-name`, type: 'text', content: name, fontSize: 14, fontWeight: 600, color: C.textPrimary, letterSpacing: -0.1 },
          { id: `${id}-meta`, type: 'text', content: meta, fontSize: 12, fontWeight: 500, color: C.textTertiary },
        ],
      },
    ],
  };
};

const grid: SceneNode = {
  id: 'grid',
  type: 'frame',
  layout: 'horizontal', wrap: true,
  gap: 20,
  padding: [24, 36, 36, 36],
  width: '100%',
  children: [
    // 4 × 2 grid, mixing content + empty so the gallery has visual rhythm
    card('c1', 'Sidebar spec',       'Updated 2h ago',  'amber'),
    card('c2', 'Empty state',         'Updated 5h ago',  'empty'),
    card('c3', 'Project page',       'Updated yesterday','green'),
    card('c4', 'Archive view',       'Updated 3d ago',  'blue'),
    card('c5', 'Compare layout',     '1440 × 900',      'empty'),
    card('c6', 'Detail toolbar',     '1440 × 900',      'empty'),
    card('c7', 'Hover states',       '1440 × 900',      'empty'),
    card('c8', 'Typography study',   '1440 × 900',      'green'),
  ],
};

const mainPane: SceneNode = {
  id: 'main',
  type: 'frame',
  layout: 'vertical',
  width: '100%',
  alignItems: 'stretch',
  // Flat warm-dark fill — was a top-left bloom gradient. Restraint reads
  // more confident than ambient lighting effects in 2026 dark-theme UIs.
  fill: C.bg1,
  children: [mainHeader, headerDivider, grid],
};

// ---- Root --------------------------------------------------------------

const root: SceneNode = {
  id: 'doc',
  type: 'document',
  fill: C.bg0,
  fontFamily: FONT_STACK,
  layout: 'horizontal',
  alignItems: 'stretch',
  children: [sidebar, mainPane],
};

const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'docs', 'viewer-refresh-mock.png');

// Publish to the local canvas store so the design is reviewable LIVE in the
// viewer at http://localhost:3001/canvas/viewer-refresh-mock with breakpoints
// and Compare mode — not just as a flat PNG attached to a PR.
//
// Lands in canvas-mcp / UI — internal viewer-chrome specs live alongside the
// shipped UI patterns, separate from the Releases and Design system projects.
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
const WORKSPACE_NAME = 'canvas-mcp';
const PROJECT_NAME = 'UI';
let workspace = listWorkspaces().find((w) => w.name === WORKSPACE_NAME);
if (!workspace) workspace = createWorkspace(WORKSPACE_NAME);
let project = listProjects(workspace.id).find((p) => p.name === PROJECT_NAME);
if (!project) project = createProject(workspace.id, PROJECT_NAME)!;

const STORE_DIR = join(process.env.CANVAS_MCP_HOME ?? join(homedir(), '.canvas-mcp'), 'canvases');
const CANVAS_ID = 'viewer-refresh-mock';
const now = new Date().toISOString();
const canvas: Canvas = {
  id: CANVAS_ID,
  name: 'viewer-refresh-mock (Phase 7 slice 5 spec)',
  root: { ...root, width: WIDTH, height: HEIGHT },
  variables: {},
  components: {},
  createdAt: now,
  lastModified: now,
  projectId: project.id,
};

const html = renderToHtml(root, WIDTH, HEIGHT);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, buf);
  console.log(`Wrote ${OUTPUT} (${WIDTH * SCALE}x${HEIGHT * SCALE})`);
} finally {
  await browser.close();
}

await mkdir(STORE_DIR, { recursive: true });
await writeFile(join(STORE_DIR, `${CANVAS_ID}.json`), JSON.stringify(canvas, null, 2));
console.log(`Published canvas "${CANVAS_ID}" to ${STORE_DIR}`);
console.log(`Open it in the viewer: http://localhost:3001/canvas/${CANVAS_ID}`);
