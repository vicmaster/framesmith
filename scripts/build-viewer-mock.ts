// Renders docs/viewer-refresh-mock.png — the design spec for the Phase 7
// slice 5 viewer UI refresh. Composed entirely as a canvas-mcp scene graph
// (gradients, shadows, components, fluid widths) and screenshotted through
// the renderer + puppeteer pipeline. Implementation lands against this mock
// in a follow-up PR; iterating the design here is cheaper than iterating CSS.
//
// Usage: npx tsx scripts/build-viewer-mock.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { renderToHtml } from '../src/renderer.js';
import type { SceneNode } from '../src/types.js';

// Linear-inspired palette: warm dark (slight blue/purple cast), indigo→violet
// accent gradient, layered surface tones so cards and chrome have depth
// without heavy shadows. Tabular-feeling counts via fixed-width labels.
const C = {
  bg: '#0e0e12',
  sidebar: '#131319',
  surface: '#16161c',
  surfaceElevated: '#1c1c24',
  border: '#25252e',
  borderSubtle: '#1d1d24',
  textPrimary: '#f5f5f7',
  textSecondary: '#a1a1ab',
  textTertiary: '#71717a',
  textMuted: '#5a5a64',
  accentFrom: '#6366f1',
  accentTo: '#8b5cf6',
  accentActiveBg: '#1e1b4b',
  accentSoft: '#c4b5fd',
  archiveBg: '#1a1421',
};

// ---- Sidebar pieces -----------------------------------------------------

const sidebarHeader: SceneNode = {
  id: 'sb-header',
  type: 'frame',
  layout: 'horizontal',
  alignItems: 'center',
  gap: 10,
  padding: [18, 18],
  children: [
    {
      id: 'sb-logo-dot',
      type: 'ellipse',
      width: 16, height: 16,
      gradient: { type: 'linear', angle: 135, stops: [{ color: C.accentFrom }, { color: C.accentTo }] },
    },
    { id: 'sb-logo-text', type: 'text', content: 'Canvas MCP', fontSize: 14, fontWeight: 600, color: C.textPrimary, letterSpacing: 0.1 },
  ],
};

const wsLabel = (id: string, text: string): SceneNode => ({
  id, type: 'text', content: text,
  fontSize: 11, fontWeight: 600, color: C.textMuted,
  letterSpacing: 0.8, textTransform: 'uppercase',
});

const projectRow = (id: string, name: string, count: string, active = false): SceneNode => {
  const base: SceneNode = {
    id, type: 'frame',
    layout: 'horizontal',
    alignItems: 'center', justifyContent: 'space-between',
    padding: [8, 12], gap: 8,
    cornerRadius: 6,
    children: [
      { id: `${id}-name`, type: 'text', content: name, fontSize: 13, fontWeight: active ? 600 : 500, color: active ? C.textPrimary : C.textSecondary },
      { id: `${id}-count`, type: 'text', content: count, fontSize: 11, fontWeight: 500, color: active ? C.accentSoft : C.textMuted },
    ],
  };
  if (active) base.fill = C.accentActiveBg;
  return base;
};

const wsSection = (id: string, label: string, projects: SceneNode[]): SceneNode => ({
  id, type: 'frame', layout: 'vertical', gap: 2,
  padding: [0, 8, 16, 8],
  children: [
    { id: `${id}-label-wrap`, type: 'frame', padding: [12, 8, 8, 8], children: [wsLabel(`${id}-label`, label)] },
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
    {
      id: 'sb-archive-icon',
      type: 'frame', width: 16, height: 14,
      fill: C.surface,
      cornerRadius: 3,
      stroke: C.border, strokeWidth: 1,
    },
    { id: 'sb-archive-name', type: 'text', content: 'Archive', fontSize: 13, fontWeight: 500, color: C.textSecondary, width: '100%' },
    { id: 'sb-archive-count', type: 'text', content: '3', fontSize: 11, fontWeight: 500, color: C.textMuted },
  ],
};

const sidebar: SceneNode = {
  id: 'sidebar',
  type: 'frame',
  width: 240, height: 900,
  fill: C.sidebar,
  layout: 'vertical',
  alignItems: 'stretch',
  children: [
    sidebarHeader,
    { id: 'sb-header-divider', type: 'frame', height: 1, fill: C.borderSubtle, width: '100%' },
    {
      id: 'sb-nav', type: 'frame',
      layout: 'vertical', gap: 0, padding: [12, 0, 0, 0],
      width: '100%',
      children: [
        wsSection('ws-personal', 'Personal', [
          projectRow('p-untitled', 'Untitled', '21', true),
          projectRow('p-brand', 'Brand', '5'),
          projectRow('p-marketing', 'Marketing', '8'),
        ]),
        wsSection('ws-acme', 'Acme', [
          projectRow('p-website', 'Website redesign', '12'),
          projectRow('p-mobile', 'Mobile app', '4'),
        ]),
      ],
    },
    // Footer pushed to bottom (no flex-grow primitive — use a spacer frame instead).
    { id: 'sb-spacer', type: 'frame', height: 260 },
    { id: 'sb-footer-divider', type: 'frame', height: 1, fill: C.borderSubtle, width: '100%' },
    {
      id: 'sb-footer', type: 'frame',
      padding: [10, 8], width: '100%',
      children: [archiveRow],
    },
  ],
};

// ---- Main pane pieces ---------------------------------------------------

const mainHeader: SceneNode = {
  id: 'main-header',
  type: 'frame',
  layout: 'vertical', gap: 6,
  padding: [28, 32, 26, 32],
  children: [
    { id: 'breadcrumb', type: 'text', content: 'Personal / Untitled', fontSize: 12, fontWeight: 500, color: C.textTertiary },
    { id: 'title', type: 'text', content: 'Untitled', fontSize: 26, fontWeight: 600, color: C.textPrimary, letterSpacing: -0.3 },
    { id: 'meta', type: 'text', content: '21 canvases', fontSize: 13, fontWeight: 500, color: C.textSecondary },
  ],
};

const headerDivider: SceneNode = { id: 'main-divider', type: 'frame', height: 1, fill: C.borderSubtle, width: '100%' };

// A "card" with a thumbnail area + name/meta strip.
const card = (id: string, name: string, meta: string, thumb: 'empty' | 'content' = 'empty'): SceneNode => ({
  id, type: 'frame',
  width: 288, // 4 across in (1440 - 240 - 64 - 3*24)/4 ≈ 288
  fill: C.surface,
  cornerRadius: 12,
  layout: 'vertical',
  children: [
    {
      id: `${id}-thumb`, type: 'frame',
      width: '100%', height: 180,
      // `position: relative` scopes any absolutely-positioned children to
      // this frame (otherwise they migrate to body coordinates).
      position: 'relative',
      gradient: thumb === 'empty'
        ? { type: 'radial', stops: [{ color: '#1a1a22' }, { color: '#0f0f14' }] }
        : { type: 'linear', angle: 135, stops: [{ color: '#1e1b4b' }, { color: '#0e0e12' }] },
      cornerRadius: [12, 12, 0, 0],
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
      children: thumb === 'empty'
        ? [
            {
              id: `${id}-thumb-icon`, type: 'frame',
              width: 28, height: 28,
              stroke: C.textMuted, strokeWidth: 1,
              cornerRadius: 4,
              opacity: 0.5,
            },
          ]
        : [
            // Faux dashboard content: a small bar chart. Layout flex so the
            // bars share a baseline; no `position: absolute` (which broke
            // out of the thumb in the first pass).
            {
              id: `${id}-chart`, type: 'frame',
              layout: 'horizontal', alignItems: 'end', gap: 8,
              children: [
                { id: `${id}-b1`, type: 'frame', width: 14, height: 36, cornerRadius: 2, gradient: { type: 'linear', angle: 180, stops: [{ color: '#34d399' }, { color: '#10b981' }] } },
                { id: `${id}-b2`, type: 'frame', width: 14, height: 60, cornerRadius: 2, gradient: { type: 'linear', angle: 180, stops: [{ color: '#34d399' }, { color: '#10b981' }] } },
                { id: `${id}-b3`, type: 'frame', width: 14, height: 48, cornerRadius: 2, gradient: { type: 'linear', angle: 180, stops: [{ color: '#34d399' }, { color: '#10b981' }] } },
                { id: `${id}-b4`, type: 'frame', width: 14, height: 76, cornerRadius: 2, gradient: { type: 'linear', angle: 180, stops: [{ color: '#34d399' }, { color: '#10b981' }] } },
                { id: `${id}-b5`, type: 'frame', width: 14, height: 92, cornerRadius: 2, gradient: { type: 'linear', angle: 180, stops: [{ color: '#60a5fa' }, { color: '#3b82f6' }] } },
              ],
            },
          ],
    },
    {
      id: `${id}-info`, type: 'frame',
      padding: [14, 16, 16, 16],
      gap: 4,
      children: [
        { id: `${id}-name`, type: 'text', content: name, fontSize: 14, fontWeight: 600, color: C.textPrimary },
        { id: `${id}-meta`, type: 'text', content: meta, fontSize: 12, fontWeight: 500, color: C.textTertiary },
      ],
    },
  ],
});

const grid: SceneNode = {
  id: 'grid',
  type: 'frame',
  layout: 'horizontal', wrap: true,
  gap: 24,
  padding: [28, 32],
  children: [
    card('c1', 'readme-hero', '1440 × 900', 'content'),
    card('c2', 'Bad Design', '1440 × 900'),
    card('c3', 'Sample Test Design', '1440 × 900'),
    card('c4', 'Dashboard', '1440 × 900', 'content'),
    card('c5', 'Components', '1440 × 900'),
    card('c6', 'Responsive scaling', '1440 × 900'),
    card('c7', 'Detailed Test', '1440 × 900'),
    card('c8', 'Material', '1440 × 900'),
  ],
};

const mainPane: SceneNode = {
  id: 'main',
  type: 'frame',
  layout: 'vertical',
  width: '100%',
  alignItems: 'stretch',
  children: [mainHeader, headerDivider, grid],
};

// ---- Root --------------------------------------------------------------

const root: SceneNode = {
  id: 'doc',
  type: 'document',
  fill: C.bg,
  layout: 'horizontal',
  alignItems: 'stretch',
  children: [sidebar, mainPane],
};

const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'docs', 'viewer-refresh-mock.png');

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
