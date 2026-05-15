// Rebuilds docs/hero.png — the README hero image — by composing a dashboard
// mock as a canvas-mcp scene graph and rendering it through renderer +
// puppeteer. Doubles as a canvas-mcp authoring example.
//
// Usage: npx tsx scripts/build-hero.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { renderToHtml } from '../src/renderer.js';
import type { SceneNode } from '../src/types.js';

const C = {
  bgFrom: '#0F172A',
  bgTo: '#1E293B',
  card: '#1E293B',
  textPrimary: '#F8FAFC',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  greenLight: '#34D399',
  green: '#10B981',
  blueLight: '#60A5FA',
  blue: '#3B82F6',
  red: '#F87171',
};

const barGradient = (blue = false) => ({
  type: 'linear' as const,
  angle: 180,
  stops: blue
    ? [{ color: C.blueLight, position: 0 }, { color: C.blue, position: 100 }]
    : [{ color: C.greenLight, position: 0 }, { color: C.green, position: 100 }],
});

const bar = (id: string, height: number, blue = false): SceneNode => ({
  id, type: 'frame', width: 80, height,
  cornerRadius: [6, 6, 2, 2],
  gradient: barGradient(blue),
});

const monthLabel = (id: string, text: string, highlighted = false): SceneNode => ({
  id, type: 'text', content: text, fontSize: 12,
  fontWeight: highlighted ? 700 : 500,
  color: highlighted ? C.textPrimary : C.textDim,
  width: 80, textAlign: 'center',
});

const statTile = (id: string, label: string, value: string, delta: string, deltaUp: boolean): SceneNode => ({
  id, type: 'frame', width: 224, padding: 24, gap: 8,
  fill: C.card, cornerRadius: 16,
  shadows: [{ x: 0, y: 8, blur: 24, color: 'rgba(0,0,0,0.3)' }],
  children: [
    { id: `${id}-l`, type: 'text', content: label, fontSize: 12, fontWeight: 500, color: C.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
    { id: `${id}-v`, type: 'text', content: value, fontSize: 28, fontWeight: 700, color: C.textPrimary },
    { id: `${id}-d`, type: 'text', content: delta, fontSize: 12, fontWeight: 500, color: deltaUp ? C.greenLight : C.red },
  ],
});

const root: SceneNode = {
  id: 'doc', type: 'document',
  gradient: { type: 'linear', angle: 135, stops: [{ color: C.bgFrom, position: 0 }, { color: C.bgTo, position: 100 }] },
  padding: 48, gap: 32,
  alignItems: 'center', justifyContent: 'center',
  children: [
    {
      id: 'card', type: 'frame', width: 720, padding: 40, gap: 24,
      fill: C.card, cornerRadius: 20,
      shadows: [
        { x: 0, y: 24, blur: 60, color: 'rgba(0,0,0,0.45)' },
        { x: 0, y: 1, blur: 0, color: 'rgba(255,255,255,0.04)', inset: true },
      ],
      children: [
        {
          id: 'hdr', type: 'frame', layout: 'horizontal',
          justifyContent: 'space-between', alignItems: 'center',
          children: [
            { id: 'hdr-l', type: 'text', content: 'Revenue', fontSize: 14, fontWeight: 500, color: C.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
            {
              id: 'badge', type: 'frame', layout: 'horizontal', alignItems: 'center',
              gap: 6, padding: [6, 12], fill: 'rgba(16,185,129,0.12)', cornerRadius: 999,
              children: [
                { id: 'bdot', type: 'ellipse', width: 6, height: 6, fill: C.green },
                { id: 'btxt', type: 'text', content: '+12%', fontSize: 13, fontWeight: 600, color: C.greenLight },
              ],
            },
          ],
        },
        { id: 'big', type: 'text', content: '$48,290', fontSize: 56, fontWeight: 700, color: C.textPrimary, letterSpacing: -1 },
        { id: 'sub', type: 'text', content: 'Last 6 months', fontSize: 13, fontWeight: 500, color: C.textDim },
        {
          id: 'chart', type: 'frame', layout: 'horizontal', gap: 16,
          alignItems: 'end', height: 140,
          children: [
            bar('b1', 64),
            bar('b2', 92),
            bar('b3', 78),
            bar('b4', 110),
            bar('b5', 96),
            bar('b6', 132, true),
          ],
        },
        {
          id: 'months', type: 'frame', layout: 'horizontal', gap: 16,
          children: [
            monthLabel('m1', 'Jan'),
            monthLabel('m2', 'Feb'),
            monthLabel('m3', 'Mar'),
            monthLabel('m4', 'Apr'),
            monthLabel('m5', 'May'),
            monthLabel('m6', 'Jun', true),
          ],
        },
      ],
    },
    {
      id: 'stats', type: 'frame', width: 720, layout: 'horizontal',
      gap: 24, responsive: 'stack',
      children: [
        statTile('s1', 'Active users', '1,284', '↑ 5.2% vs last week', true),
        statTile('s2', 'Conversion', '3.4%', '↑ 0.8pp vs last month', true),
        statTile('s3', 'Avg order', '$87', '↓ 2.1% vs last week', false),
      ],
    },
  ],
};

const WIDTH = 1200;
const HEIGHT = 800;
const SCALE = 2;
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'docs', 'hero.png');

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
