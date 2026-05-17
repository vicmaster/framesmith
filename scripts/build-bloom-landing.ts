// Renders docs/bloom-landing.png — a standalone product-landing showcase
// using a fresh design system (NOT the canvas-mcp amber-dark identity).
//
// Demonstrates the renderer's range:
//   - Two custom font families via @font-face (Fraunces serif + DM Sans)
//   - Light theme + forest green accent (no amber, no purple)
//   - Auto position: relative on the right column (cards use absolute)
//   - Staggered fadeIn / slideUp animations
//   - Soft shadow primitives, SVG path icons
//   - Tokens at the canvas level (overrides any workspace tokens)
//
// Lives in canvas-mcp / UI — this is a design demonstration, not a
// version-tagged release artifact.
//
// Usage: npx tsx scripts/build-bloom-landing.ts

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
  getWorkspace,
} from '../src/workspaces.js';
import type { Canvas, DesignVariables, FontFace, SceneNode } from '../src/types.js';

loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();

const WORKSPACE_NAME = 'canvas-mcp';
const PROJECT_NAME = 'UI';
let workspace = listWorkspaces().find((w) => w.name === WORKSPACE_NAME);
if (!workspace) workspace = createWorkspace(WORKSPACE_NAME);
let project = listProjects(workspace.id).find((p) => p.name === PROJECT_NAME);
if (!project) project = createProject(workspace.id, PROJECT_NAME)!;

// ---- Bloom design tokens (set at canvas level so they override the
// canvas-mcp workspace tokens this canvas would otherwise inherit) ---------
// Light theme — warm cream + near-black + deep forest green. Avoids amber
// (canvas-mcp brand) and purple/indigo (AI defaults per visual-design-bar).
const BLOOM: DesignVariables = {
  colors: {
    bg: '#FAF7F2',
    surface: '#FFFFFF',
    surfaceTint: '#F3EFE7',
    textPrimary: '#1C1A18',
    textSecondary: '#56524C',
    textMuted: '#9B958C',
    border: '#E8E2D6',
    borderSubtle: '#EFEBE2',
    accent: '#1F4838',
    accentSoft: '#DDE7E1',
    accentDeep: '#163428',
    onAccent: '#F7F4EE',
    swatchSand: '#E8DDC6',
    swatchClay: '#D5BFA3',
    swatchMoss: '#8FA989',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 36, xxl: 56 },
  radius: { sm: 8, md: 14, lg: 20, pill: 9999 },
  typography: {
    eyebrow: { fontSize: 12, fontWeight: 600, lineHeight: 1.4 },
    headline: { fontSize: 72, fontWeight: 600, lineHeight: 1.02 },
    subhead: { fontSize: 18, fontWeight: 400, lineHeight: 1.55 },
    label: { fontSize: 12, fontWeight: 500, lineHeight: 1.4 },
    body: { fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
    cardTitle: { fontSize: 17, fontWeight: 600, lineHeight: 1.3 },
    cta: { fontSize: 15, fontWeight: 600, lineHeight: 1 },
  },
};

// ---- Fonts via Bunny Fonts CDN ------------------------------------------
const FONTS: FontFace[] = [
  // Serif headline — Fraunces gives Bloom a distinct character vs. Inter.
  { family: 'Fraunces',  url: 'https://fonts.bunny.net/fraunces/files/fraunces-latin-600-normal.woff2', weight: 600 },
  // Body sans — DM Sans is clean + warmer than Inter, fits the wellness vibe.
  { family: 'DM Sans',   url: 'https://fonts.bunny.net/dm-sans/files/dm-sans-latin-400-normal.woff2', weight: 400 },
  { family: 'DM Sans',   url: 'https://fonts.bunny.net/dm-sans/files/dm-sans-latin-500-normal.woff2', weight: 500 },
  { family: 'DM Sans',   url: 'https://fonts.bunny.net/dm-sans/files/dm-sans-latin-600-normal.woff2', weight: 600 },
];
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS  = "'DM Sans', system-ui, -apple-system, sans-serif";

// ---- Tiny SVG path helper -----------------------------------------------
function icon(id: string, d: string, color = '$textSecondary', size = 18): SceneNode {
  return {
    id, type: 'path', width: size, height: size, viewBox: '0 0 24 24',
    d, fill: 'none', stroke: color, strokeWidth: 1.6,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
}

// ---- Top nav ------------------------------------------------------------
// Wordmark-only brand. A small icon mark next to "Bloom" set in Fraunces
// just competed with the serif's character — premium serif-wordmark brands
// (Aesop, Hermès, Apothem) earn their identity from the wordmark alone.
const navLink = (id: string, label: string): SceneNode => ({
  id, type: 'text', content: label, fontFamily: SANS, fontSize: 14, fontWeight: 500, color: '$textSecondary',
});

const topnav: SceneNode = {
  id: 'topnav',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center',
  // `justifyContent: space-between` distributes the three groups across the
  // available space with NO fixed widths on the children — that way the
  // wordmark lives flush against the topnav's left padding, matching the
  // padding of the body section below (88px). Result: "Bloom" lines up
  // vertically with the headline, eyebrow dot, CTA, etc.
  justifyContent: 'space-between',
  width: 1440,
  height: 72,
  padding: [16, 88],
  fill: '$bg',
  children: [
    // Wordmark (direct child — no wrapper frame so nothing pads it inward)
    { id: 'wordmark', type: 'text', content: 'Bloom', fontFamily: SERIF, fontSize: 24, fontWeight: 600, color: '$textPrimary', letterSpacing: -0.4 },
    // Center nav group
    {
      id: 'nav-center', type: 'frame', layout: 'horizontal', gap: '$xl', alignItems: 'center',
      children: [
        navLink('nav-product',  'Product'),
        navLink('nav-practice', 'Practice'),
        navLink('nav-pricing',  'Pricing'),
        navLink('nav-about',    'About'),
      ],
    },
    // Right actions group (sign in + CTA pill)
    {
      id: 'nav-right', type: 'frame', layout: 'horizontal', gap: '$lg', alignItems: 'center',
      children: [
        { id: 'signin', type: 'text', content: 'Sign in', fontFamily: SANS, fontSize: 14, fontWeight: 500, color: '$textPrimary' },
        {
          id: 'cta-nav', type: 'frame', layout: 'horizontal', alignItems: 'center',
          padding: [12, 18], fill: '$accent', cornerRadius: '$pill',
          children: [
            { id: 'cta-nav-text', type: 'text', content: 'Start free', fontFamily: SANS, fontSize: 13, fontWeight: 600, color: '$onAccent' },
          ],
        },
      ],
    },
  ],
};

// ---- Hero left column (text + CTAs) -------------------------------------
const heroLeft: SceneNode = {
  id: 'hero-left',
  type: 'frame',
  layout: 'vertical',
  gap: '$lg',
  width: 600,
  animation: { name: 'slideUp', duration: 600, easing: 'ease-out' },
  children: [
    // Eyebrow with small dot
    {
      id: 'eyebrow-row', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: '$sm',
      children: [
        { id: 'eyebrow-dot', type: 'frame', width: 6, height: 6, cornerRadius: '$pill', fill: '$accent' },
        { id: 'eyebrow', type: 'text', content: 'A DAILY JOURNALING PRACTICE', fontFamily: SANS, fontSize: 12, fontWeight: 600, color: '$accent', letterSpacing: 1.5 },
      ],
    },
    {
      id: 'headline', type: 'text',
      content: 'Five minutes a day to notice what matters.',
      // Explicit weight — `fontSize: "$headline"` only resolves the size,
      // not the weight stored on the typography token.
      fontFamily: SERIF, fontSize: 72, fontWeight: 600, color: '$textPrimary',
      lineHeight: 1.02, letterSpacing: -2,
      maxWidth: 560,
    },
    {
      id: 'subhead', type: 'text',
      content: 'Bloom is a quiet space for the questions that move you forward — not the inbox that pulls you back. One prompt, every morning. No streaks, no badges, no noise.',
      fontFamily: SANS, fontSize: 18, fontWeight: 400, color: '$textSecondary', lineHeight: 1.55,
      maxWidth: 520,
    },
    // CTA row
    {
      id: 'cta-row', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: '$lg',
      padding: ['$sm', 0, 0, 0],
      children: [
        // Primary CTA
        {
          id: 'cta-primary', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: '$sm',
          padding: [14, 28], fill: '$accent', cornerRadius: '$pill',
          children: [
            // Use the en-dash unicode `–` between "14" and "day" so the
            // hyphen-minus glyph (which renders short in DM Sans next to
            // digits) doesn't visually disappear. Reads as "14–day trial".
            { id: 'cta-primary-text', type: 'text', content: 'Start your free trial', fontFamily: SANS, fontSize: 15, fontWeight: 600, color: '$onAccent' },
            icon('cta-arrow', 'M 5 12 H 19 M 13 6 L 19 12 L 13 18', '$onAccent', 16),
          ],
        },
        // Secondary link
        {
          id: 'cta-secondary', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: 6,
          children: [
            icon('play-icon', 'M 8 5 L 19 12 L 8 19 Z', '$textPrimary', 14),
            { id: 'cta-secondary-text', type: 'text', content: 'See how it works', fontFamily: SANS, fontSize: 15, fontWeight: 500, color: '$textPrimary' },
          ],
        },
      ],
    },
    // Trust strip
    {
      id: 'trust-row', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: '$md',
      padding: ['$xl', 0, 0, 0],
      children: [
        { id: 'trust-stars', type: 'text', content: '★★★★★', fontFamily: SANS, fontSize: 14, fontWeight: 500, color: '$accent' },
        { id: 'trust-text', type: 'text', content: '4.9 · 12,400 quiet mornings', fontFamily: SANS, fontSize: 13, fontWeight: 400, color: '$textMuted' },
      ],
    },
  ],
};

// ---- Hero right column (overlapping cards) ------------------------------
// Main journal card (back, larger) — today's prompt + answer.
const journalCard: SceneNode = {
  id: 'card-journal',
  type: 'frame',
  position: 'absolute',
  x: 0,
  y: 20,
  width: 380,
  height: 320,
  padding: '$lg',
  fill: '$surface',
  cornerRadius: '$lg',
  shadows: [
    { x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(28, 26, 24, 0.04)' },
    { x: 0, y: 12, blur: 36, spread: -4, color: 'rgba(28, 26, 24, 0.08)' },
  ],
  layout: 'vertical', gap: '$md',
  animation: { name: 'fadeIn', duration: 500, delay: 200 },
  children: [
    {
      id: 'card-journal-header', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: '$sm',
      children: [
        { id: 'card-journal-date', type: 'text', content: 'TUE · MAY 17', fontFamily: SANS, fontSize: 11, fontWeight: 600, color: '$textMuted', letterSpacing: 1 },
        { id: 'card-journal-spacer', type: 'frame', width: 1, height: 1 },
        {
          id: 'card-journal-tag', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: 4,
          padding: [3, 8], fill: '$accentSoft', cornerRadius: '$pill',
          children: [
            { id: 'card-tag-dot', type: 'frame', width: 5, height: 5, cornerRadius: '$pill', fill: '$accent' },
            { id: 'card-tag-text', type: 'text', content: 'Reflection', fontFamily: SANS, fontSize: 11, fontWeight: 600, color: '$accentDeep' },
          ],
        },
      ],
    },
    {
      id: 'card-journal-prompt', type: 'text',
      content: 'What did today’s quiet moment make space for?',
      fontFamily: SERIF, fontSize: 26, fontWeight: 600, color: '$textPrimary', lineHeight: 1.15, letterSpacing: -0.5,
    },
    {
      id: 'card-journal-body', type: 'text',
      content: 'Walked the long way to the studio and noticed the linden trees are out. The whole block smells like honey by 8 a.m. — I forgot how short that window is.',
      fontFamily: SANS, fontSize: 14, fontWeight: 400, color: '$textSecondary', lineHeight: 1.6,
    },
    {
      id: 'card-journal-footer', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: '$sm',
      padding: ['$md', 0, 0, 0],
      children: [
        icon('time-icon', 'M 12 6 V 12 L 16 14 M 12 3 a 9 9 0 1 0 0 18 a 9 9 0 0 0 0 -18 z', '$textMuted', 14),
        { id: 'card-time', type: 'text', content: '4 min · 218 words', fontFamily: SANS, fontSize: 12, fontWeight: 500, color: '$textMuted' },
      ],
    },
  ],
};

// Small streak / progress card (overlapping, front) — week dots.
const dayDot = (id: string, label: string, filled: boolean): SceneNode => ({
  id, type: 'frame', layout: 'vertical', alignItems: 'center', gap: 6,
  children: [
    {
      id: `${id}-dot`, type: 'frame', width: 14, height: 14, cornerRadius: '$pill',
      fill: filled ? '$accent' : '$surfaceTint',
      stroke: filled ? 'none' : '$border',
      strokeWidth: 1,
    },
    { id: `${id}-label`, type: 'text', content: label, fontFamily: SANS, fontSize: 10, fontWeight: 500, color: '$textMuted' },
  ],
});

const streakCard: SceneNode = {
  id: 'card-streak',
  type: 'frame',
  position: 'absolute',
  x: 220,
  y: 290,
  width: 280,
  padding: '$md',
  fill: '$surface',
  cornerRadius: '$md',
  shadows: [
    { x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(28, 26, 24, 0.04)' },
    { x: 0, y: 16, blur: 40, spread: -4, color: 'rgba(28, 26, 24, 0.10)' },
  ],
  layout: 'vertical', gap: '$sm',
  animation: { name: 'fadeIn', duration: 500, delay: 360 },
  children: [
    {
      id: 'streak-header', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: '$sm',
      children: [
        { id: 'streak-title', type: 'text', content: 'This week', fontFamily: SANS, fontSize: 12, fontWeight: 600, color: '$textPrimary', letterSpacing: 0.3 },
        { id: 'streak-spacer', type: 'frame', width: 1, height: 1 },
        { id: 'streak-meta', type: 'text', content: '6 of 7', fontFamily: SANS, fontSize: 11, fontWeight: 500, color: '$textMuted' },
      ],
    },
    {
      id: 'streak-days', type: 'frame', layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center',
      children: [
        dayDot('day-mon', 'M', true),
        dayDot('day-tue', 'T', true),
        dayDot('day-wed', 'W', true),
        dayDot('day-thu', 'T', true),
        dayDot('day-fri', 'F', false),
        dayDot('day-sat', 'S', true),
        dayDot('day-sun', 'S', true),
      ],
    },
  ],
};

const heroRight: SceneNode = {
  id: 'hero-right',
  type: 'frame',
  width: 540,
  height: 460,
  // position:relative is auto-injected because children use position:absolute
  children: [journalCard, streakCard],
};

// ---- Hero composition ----------------------------------------------------
const heroSection: SceneNode = {
  id: 'hero-section',
  type: 'frame',
  layout: 'horizontal',
  width: 1440,
  padding: [60, 88, 88, 88],
  gap: 80,
  alignItems: 'center',
  responsive: 'stack',
  children: [heroLeft, heroRight],
};

// ---- Root ---------------------------------------------------------------
const WIDTH = 1440;
const HEIGHT = 900;
const root: SceneNode = {
  id: 'doc', type: 'document',
  fill: '$bg', fontFamily: SANS,
  width: WIDTH, height: HEIGHT,
  children: [topnav, heroSection],
};

// ---- Build ---------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'docs', 'bloom-landing.png');
const STORE_DIR = join(process.env.CANVAS_MCP_HOME ?? join(homedir(), '.canvas-mcp'), 'canvases');
const CANVAS_ID = 'bloom-landing';
const now = new Date().toISOString();
const canvas: Canvas = {
  id: CANVAS_ID,
  name: 'Bloom landing (renderer capabilities showcase)',
  root,
  // Canvas-level tokens override anything inherited from the workspace
  // (this design intentionally uses a different system from canvas-mcp's
  // amber-dark identity).
  variables: BLOOM,
  components: {},
  fonts: FONTS,
  createdAt: now,
  lastModified: now,
  projectId: project.id,
};

// Resolve through merge chain so the canvas-level overrides win.
const ws = getWorkspace(workspace.id);
const tokens = mergeDesignTokens(ws?.designSystem, project.designSystem, canvas.variables);
const resolvedRoot = resolveVariables(root, tokens);
const html = renderToHtml(resolvedRoot, WIDTH, HEIGHT, canvas);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  // Let fonts + animations settle before snapshot.
  await new Promise((r) => setTimeout(r, 1500));
  const buf = await page.screenshot({ type: 'png', fullPage: false });
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
