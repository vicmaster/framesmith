// Smoke for Phase 5 item #6: screenshot_responsive renders HTML per breakpoint
// so the body scaffold (max-width / min-height) matches each viewport, not the
// largest breakpoint. Asserts the runtime body box at each breakpoint matches
// the requested viewport dimensions and that @media reflow still fires.
//
// Usage: npx tsx test-responsive-reflow.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { Breakpoint } from './src/screenshot.js';
import type { SceneNode } from './src/types.js';

const root: SceneNode = {
  id: 'doc', type: 'document',
  fill: '#0F172A',
  children: [
    {
      id: 'row', type: 'frame',
      layout: 'horizontal', responsive: 'stack', gap: 16, padding: 24,
      children: [
        { id: 'c1', type: 'frame', width: 360, height: 200, fill: '#3B82F6' },
        { id: 'c2', type: 'frame', width: 360, height: 200, fill: '#10B981' },
        { id: 'c3', type: 'frame', width: 360, height: 200, fill: '#F59E0B' },
      ],
    },
  ],
};

const breakpoints: Breakpoint[] = [
  { label: 'mobile',  width: 390,  height: 844 },
  { label: 'tablet',  width: 768,  height: 1024 },
  { label: 'desktop', width: 1440, height: 900 },
];

// The exact renderer closure that src/index.ts now passes to
// takeResponsiveScreenshots — testing it directly so we exercise the same
// per-breakpoint path without booting an MCP server.
const renderForBreakpoint = (bp: Breakpoint) => renderToHtml(root, bp.width, bp.height);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let allPass = true;

try {
  for (const bp of breakpoints) {
    const html = renderForBreakpoint(bp);
    const page = await browser.newPage();
    await page.setViewport({ width: bp.width, height: bp.height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(() => ({
      bodyMaxWidth: getComputedStyle(document.body).maxWidth,
      bodyMinHeight: getComputedStyle(document.body).minHeight,
      bodyWidth: Math.round(document.body.getBoundingClientRect().width),
      rowDirection: getComputedStyle(document.querySelector('[data-node-id="row"]')!).flexDirection,
    }));
    await page.close();

    // The renderer emits `@media (max-width: 767px)` for the `stack` hint, so
    // the tablet preset at exactly 768 lands in the desktop band. Matches the
    // Bootstrap/Tailwind convention where 768 is the start of `md`.
    const expectStack = bp.width < 768;
    const maxOk = r.bodyMaxWidth === `${bp.width}px`;
    const minOk = r.bodyMinHeight === `${bp.height}px`;
    const widthOk = r.bodyWidth === bp.width;
    const dirOk = expectStack ? r.rowDirection === 'column' : r.rowDirection === 'row';
    const pass = maxOk && minOk && widthOk && dirOk;
    if (!pass) allPass = false;

    console.log(`[${bp.label} ${bp.width}x${bp.height}]`);
    console.log(`  body max-width:  ${r.bodyMaxWidth}  ${maxOk ? 'PASS' : `FAIL (expected ${bp.width}px)`}`);
    console.log(`  body min-height: ${r.bodyMinHeight}  ${minOk ? 'PASS' : `FAIL (expected ${bp.height}px)`}`);
    console.log(`  body width:      ${r.bodyWidth}px  ${widthOk ? 'PASS' : `FAIL (expected ${bp.width}px)`}`);
    console.log(`  row direction:   ${r.rowDirection}  ${dirOk ? 'PASS' : `FAIL (expected ${expectStack ? 'column' : 'row'})`}`);
  }
} finally {
  await browser.close();
}

process.exit(allPass ? 0 : 1);
