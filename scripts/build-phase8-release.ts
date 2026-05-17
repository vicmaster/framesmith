// Renders docs/phase8-release.png — a single hero composition that exercises
// all five Phase 8 renderer primitives in honest design context:
//
//   1. Custom font loading — Inter loaded from Bunny Fonts CDN via @font-face
//   2. SVG path primitives — wordmark logo mark composed from raw `d`
//   3. backdrop-filter — glass card with composed blur + saturate over an
//      amber blob backdrop
//   4. Animations — slideUp on the headline + staggered fadeIn on the
//      feature list rows
//   5. Auto position: relative — "NEW" badge absolutely positioned on the
//      version pill (the pill itself has no explicit `position`, the
//      renderer injects relative automatically)
//
// Publishes to the local canvas store with a stable ID so the design is
// reviewable LIVE in the viewer at http://localhost:3001/canvas/phase8-release
// (animations play, glass effect renders, font swaps in).
//
// Usage: npx tsx scripts/build-phase8-release.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer';
import { renderToHtml } from '../src/renderer.js';
import { type Canvas, type FontFace, type SceneNode } from '../src/types.js';
import {
  loadPersistedWorkspaces,
  ensureDefaultWorkspaceAndProject,
  createWorkspace,
  listWorkspaces,
  createProject,
  listProjects,
} from '../src/workspaces.js';

// ---- Palette ------------------------------------------------------------
// Warm-dark amber. No gradients. No purple. (per visual-design-bar memory)
const C = {
  bg0: '#09070a',
  surface: '#1a160f',
  surfaceElevated: '#231d13',
  border: 'rgba(255, 255, 255, 0.06)',
  borderGlass: 'rgba(255, 255, 255, 0.10)',
  textPrimary: '#fafaf5',
  textSecondary: '#b8b3a6',
  textMuted: '#7a7464',
  accent: '#f59e0b',         // amber-500 — signature
  accentSoft: '#fde68a',     // amber-200
  accentBlob: '#f59e0b',     // flat amber for the backdrop blob
};

// ---- Fonts ---------------------------------------------------------------
// Bunny Fonts has stable, predictable URLs and serves Inter directly as
// .woff2. Fallback to system-ui if the CDN is unreachable.
const FONTS: FontFace[] = [
  { family: 'Inter', url: 'https://fonts.bunny.net/inter/files/inter-latin-400-normal.woff2', weight: 400 },
  { family: 'Inter', url: 'https://fonts.bunny.net/inter/files/inter-latin-600-normal.woff2', weight: 600 },
  { family: 'Inter', url: 'https://fonts.bunny.net/inter/files/inter-latin-700-normal.woff2', weight: 700 },
];
// Use single-quoted family inside the JS string so the inline `font-family`
// CSS value uses single quotes — double quotes would prematurely close the
// outer `style="..."` HTML attribute.
const FONT_STACK = "'Inter', system-ui, -apple-system, sans-serif";

// ---- SVG logo mark -------------------------------------------------------
// Stylized canvas/grid glyph. Three strokes forming an abstract frame.
const logoMark: SceneNode = {
  id: 'logo-mark',
  type: 'path',
  width: 36,
  height: 36,
  viewBox: '0 0 24 24',
  // M outer rounded rect, then two internal strokes evoking a canvas split
  d: 'M 4 4 L 20 4 L 20 20 L 4 20 Z M 4 11 L 20 11 M 11 11 L 11 20',
  fill: 'none',
  stroke: C.accent,
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

// ---- Header (logo + wordmark) -------------------------------------------
const header: SceneNode = {
  id: 'header',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center',
  gap: 12,
  children: [
    logoMark,
    { id: 'wordmark', type: 'text', content: 'canvas-mcp', fontSize: 18, fontWeight: 600, color: C.textPrimary, fontFamily: FONT_STACK },
  ],
};

// ---- Headline block ------------------------------------------------------
const headlineBlock: SceneNode = {
  id: 'headline-block',
  type: 'frame',
  layout: 'vertical',
  gap: 20,
  // slideUp the whole block on page load — single staged motion at the top
  animation: { name: 'slideUp', duration: 500, easing: 'ease-out' },
  children: [
    {
      id: 'eyebrow',
      type: 'text',
      content: 'v0.8.0 — RENDERER EXPRESSIVENESS',
      fontSize: 13,
      fontWeight: 600,
      color: C.accent,
      fontFamily: FONT_STACK,
      letterSpacing: 1.2,
    },
    {
      id: 'headline',
      type: 'text',
      content: 'Five primitives.\nOne quiet release.',
      fontSize: 64,
      fontWeight: 700,
      lineHeight: 1.05,
      color: C.textPrimary,
      fontFamily: FONT_STACK,
      letterSpacing: -1.5,
    },
    {
      id: 'subhead',
      type: 'text',
      content: 'The renderer learned how to fade in, blur what’s behind it, load a real typeface, draw a custom mark, and know which ancestor to anchor against.',
      fontSize: 18,
      fontWeight: 400,
      lineHeight: 1.6,
      color: C.textSecondary,
      fontFamily: FONT_STACK,
      maxWidth: 640,
    },
  ],
};

// ---- Version pill (with absolutely-positioned NEW badge) -----------------
// The pill frame has no explicit `position`. The renderer auto-injects
// `position: relative` because the NEW badge is `position: absolute`.
// Proves the foot-gun fix end-to-end.
const versionPill: SceneNode = {
  id: 'version-pill',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center',
  gap: 10,
  padding: [9, 16],
  fill: C.surfaceElevated,
  cornerRadius: 999,
  stroke: C.border,
  strokeWidth: 1,
  width: 168,
  height: 38,
  // No `position` set here — auto-relative kicks in because of NEW-badge
  children: [
    { id: 'dot', type: 'frame', width: 8, height: 8, fill: C.accent, cornerRadius: 999 },
    { id: 'pill-text', type: 'text', content: 'Phase 8 shipped', fontSize: 13, fontWeight: 600, color: C.textPrimary, fontFamily: FONT_STACK },
    {
      id: 'new-badge',
      type: 'frame',
      position: 'absolute',
      x: 138,
      y: -10,
      padding: [3, 8],
      fill: C.accent,
      cornerRadius: 999,
      children: [
        { id: 'new-text', type: 'text', content: 'NEW', fontSize: 10, fontWeight: 700, color: C.bg0, fontFamily: FONT_STACK, letterSpacing: 0.6 },
      ],
    },
  ],
};

// ---- Decorative blob (sits behind the glass card) -----------------------
// Flat amber circle, no gradient. The glass card's backdrop-filter blurs
// + saturates this so the glass actually looks like glass over color.
// Positioned to OVERLAP the glass card so the blur effect has something
// to actually blur — that's the whole point of glassmorphism.
const blob: SceneNode = {
  id: 'blob',
  type: 'frame',
  position: 'absolute',
  x: 120,
  y: 40,
  width: 320,
  height: 320,
  fill: C.accentBlob,
  cornerRadius: 9999,
};

// Second smaller blob in a different hue to give the glass more to blur.
const blob2: SceneNode = {
  id: 'blob2',
  type: 'frame',
  position: 'absolute',
  x: 0,
  y: 240,
  width: 220,
  height: 220,
  fill: '#3b82f6',
  cornerRadius: 9999,
  opacity: 0.6,
};

// ---- Glass card (backdrop-filter) ---------------------------------------
function featureRow(num: number, title: string, body: string, delayMs: number): SceneNode {
  return {
    id: `feature-${num}`,
    type: 'frame',
    layout: 'horizontal',
    gap: 16,
    alignItems: 'start',
    animation: { name: 'fadeIn', duration: 400, delay: delayMs },
    children: [
      // Numeric label in accent color
      {
        id: `feature-${num}-num`,
        type: 'text',
        content: String(num).padStart(2, '0'),
        fontSize: 13,
        fontWeight: 700,
        color: C.accent,
        fontFamily: FONT_STACK,
        letterSpacing: 0.8,
        width: 28,
      },
      {
        id: `feature-${num}-body`,
        type: 'frame',
        layout: 'vertical',
        gap: 4,
        children: [
          { id: `feature-${num}-title`, type: 'text', content: title, fontSize: 15, fontWeight: 600, color: C.textPrimary, fontFamily: FONT_STACK },
          { id: `feature-${num}-desc`, type: 'text', content: body, fontSize: 14, lineHeight: 1.5, color: C.textSecondary, fontFamily: FONT_STACK },
        ],
      },
    ],
  };
}

const glassCard: SceneNode = {
  id: 'glass-card',
  type: 'frame',
  layout: 'vertical',
  gap: 22,
  padding: 32,
  width: 460,
  fill: 'rgba(20, 17, 12, 0.30)',
  cornerRadius: 18,
  stroke: C.borderGlass,
  strokeWidth: 1,
  backdropFilter: { blur: 28, saturate: 180 },
  children: [
    { id: 'gc-title', type: 'text', content: 'What’s new', fontSize: 13, fontWeight: 600, color: C.accent, fontFamily: FONT_STACK, letterSpacing: 1.2 },
    featureRow(1, 'Custom typography', 'Hosted font faces with `@font-face` and preconnect.', 80),
    featureRow(2, 'Backdrop filter', 'Composable blur, saturate, brightness, contrast.', 160),
    featureRow(3, 'SVG path primitives', 'Custom marks beyond the Lucide icon library.', 240),
    featureRow(4, 'Animations', 'Built-in keyframes auto-emitted on reference.', 320),
    featureRow(5, 'Auto position', 'Frames with absolute children just work.', 400),
  ],
};

// ---- Right column (glass card over blobs) -------------------------------
// All children use position: absolute; the renderer auto-injects
// position: relative on this column frame.
const rightColumn: SceneNode = {
  id: 'right-column',
  type: 'frame',
  width: 500,
  height: 540,
  children: [
    blob,
    blob2,
    { ...glassCard, position: 'absolute', x: 20, y: 60 },
  ],
};

// ---- Left column (header + headline + pill) -----------------------------
const leftColumn: SceneNode = {
  id: 'left-column',
  type: 'frame',
  layout: 'vertical',
  gap: 40,
  width: 600,
  children: [
    header,
    headlineBlock,
    versionPill,
  ],
};

// ---- Body (two columns) -------------------------------------------------
const body: SceneNode = {
  id: 'body',
  type: 'frame',
  layout: 'horizontal',
  gap: 80,
  padding: [88, 88, 88, 88],
  alignItems: 'start',
  responsive: 'stack',
  children: [leftColumn, rightColumn],
};

// ---- Root --------------------------------------------------------------
const root: SceneNode = {
  id: 'doc',
  type: 'document',
  fill: C.bg0,
  fontFamily: FONT_STACK,
  width: 1440,
  height: 900,
  children: [body],
};

// ---- Build ---------------------------------------------------------------
const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'docs', 'phase8-release.png');

// Place the release artifact in canvas-mcp / Releases (find-or-create both).
// Released hero pages live in their own project, separate from the design
// system foundations and internal specs — see canvas-mcp workspace layout.
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
const WORKSPACE_NAME = 'canvas-mcp';
const PROJECT_NAME = 'Releases';
let workspace = listWorkspaces().find((w) => w.name === WORKSPACE_NAME);
if (!workspace) workspace = createWorkspace(WORKSPACE_NAME);
let project = listProjects(workspace.id).find((p) => p.name === PROJECT_NAME);
if (!project) project = createProject(workspace.id, PROJECT_NAME)!;

const STORE_DIR = join(process.env.CANVAS_MCP_HOME ?? join(homedir(), '.canvas-mcp'), 'canvases');
const CANVAS_ID = 'phase8-release';
const now = new Date().toISOString();
const canvas: Canvas = {
  id: CANVAS_ID,
  name: 'phase8-release (v0.8.0 hero)',
  root,
  variables: {},
  components: {},
  fonts: FONTS,
  createdAt: now,
  lastModified: now,
  projectId: project.id,
};

const html = renderToHtml(root, WIDTH, HEIGHT, canvas);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  // Wait briefly for fonts + animations to settle before snapshot.
  await new Promise((r) => setTimeout(r, 1200));
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
