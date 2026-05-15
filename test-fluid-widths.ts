// Smoke test for Phase 5 item #3: fluid widths via minWidth / maxWidth.
// Runs the renderer + puppeteer directly so it does not depend on the long-
// running MCP server (which holds dist/ in Node memory until restarted).
//
// Usage: npx tsx test-fluid-widths.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

const root: SceneNode = {
  id: 'doc',
  type: 'document',
  children: [
    {
      id: 'capped',
      type: 'frame',
      width: '100%',
      maxWidth: 600,
      height: 80,
      fill: '#3B82F6',
    },
    {
      id: 'floored',
      type: 'frame',
      width: '50%',
      minWidth: 240,
      height: 80,
      fill: '#10B981',
    },
    {
      id: 'pixel-shrinks',
      type: 'frame',
      width: 1200,
      height: 80,
      fill: '#F59E0B',
    },
    {
      id: 'pixel-locked',
      type: 'frame',
      width: 1200,
      maxWidth: 1200,
      height: 80,
      fill: '#EF4444',
    },
  ],
};

const checks: { vp: number; expect: Record<string, { width: number }> }[] = [
  {
    vp: 1440,
    expect: {
      // capped width: "100%" cools to maxWidth 600 on a wide viewport
      capped: { width: 600 },
      // floored 50% of 1440 = 720, well above the 240 floor
      floored: { width: 720 },
      // legacy pixel width with implicit max-width: 100% — fits in 1440
      'pixel-shrinks': { width: 1200 },
      // explicit maxWidth disables the implicit shrink; element overflows
      'pixel-locked': { width: 1200 },
    },
  },
  {
    vp: 390,
    expect: {
      // capped: maxWidth 600 inactive at 390 → fills available
      capped: { width: 390 },
      // floored: 50% of 390 = 195, raised to the 240 floor
      floored: { width: 240 },
      // legacy pixel shrinks to viewport via max-width: 100%
      'pixel-shrinks': { width: 390 },
      // explicit maxWidth 1200 overrides the auto-shrink — overflows
      'pixel-locked': { width: 1200 },
    },
  },
];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let allPass = true;

for (const { vp, expect } of checks) {
  const html = renderToHtml(root, vp, 600);
  const page = await browser.newPage();
  await page.setViewport({ width: vp, height: 600, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  const widths = await page.evaluate(() => {
    const ids = ['capped', 'floored', 'pixel-shrinks', 'pixel-locked'];
    const out: Record<string, number> = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
      out[id] = el ? Math.round(el.getBoundingClientRect().width) : -1;
    }
    return out;
  });

  console.log(`\n[viewport ${vp}px]`);
  for (const [id, e] of Object.entries(expect)) {
    const actual = widths[id];
    const ok = actual === e.width;
    if (!ok) allPass = false;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${id}: expected ${e.width}px, got ${actual}px`);
  }

  await page.close();
}

await browser.close();
process.exit(allPass ? 0 : 1);
