import './test-env.js';
// Smoke for Phase 5 item #7: viewer detail page exposes a side-by-side
// "Compare" view with three iframes (mobile / tablet / desktop) that point at
// the same per-breakpoint render route added in PR #13. Renders the detail page
// directly (no HTTP / no long-running viewer process — those tend to cache
// stale code) and asserts the expected markup + CSS hooks are present.
//
// Usage: npx tsx test-viewer-compare.ts

import puppeteer from 'puppeteer';
import { renderDetailPage } from './src/viewer.js';
import type { Canvas } from './src/types.js';

const canvas: Canvas = {
  id: 'test-canvas-id',
  name: 'compare-smoke',
  root: { id: 'doc', type: 'document', width: 1440, height: 900 },
  variables: {},
  components: {},
  createdAt: '2026-05-16T00:00:00Z',
  lastModified: '2026-05-16T00:00:00Z',
};

const html = renderDetailPage(canvas, 3001);

const markupChecks: Array<{ name: string; needle: string | RegExp }> = [
  { name: 'Compare toolbar button', needle: 'id="bp-compare"' },
  { name: 'compare-grid container', needle: 'id="compare-grid"' },
  { name: 'mobile cell points at ?w=390&h=844', needle: '/canvas/test-canvas-id/html?w=390&h=844' },
  { name: 'tablet cell points at ?w=768&h=1024', needle: '/canvas/test-canvas-id/html?w=768&h=1024' },
  { name: 'desktop cell uses canvas natural width/height', needle: '/canvas/test-canvas-id/html?w=1440&h=1024' === '/canvas/test-canvas-id/html?w=1440&h=1024' ? /\/canvas\/test-canvas-id\/html\?w=1440&h=900\b/ : '' },
  { name: 'setCompareMode handler defined', needle: 'function setCompareMode' },
  { name: 'refreshFrames helper defined', needle: 'function refreshFrames' },
  { name: '.viewport.compare CSS rule', needle: '.viewport.compare' },
  { name: '--bp-w CSS variable wiring', needle: '--bp-w' },
  // Slice-5b polish: toolbar buttons are grouped into clusters separated by
  // hairline dividers (was a flat row of 8 same-weight buttons).
  { name: 'toolbar clusters group related buttons', needle: 'class="toolbar-cluster"' },
  { name: 'toolbar dividers between clusters', needle: 'class="toolbar-divider"' },
  // Mobile polish: dividers hidden, clusters stack full-width, status dot hidden.
  { name: 'mobile: toolbar-divider hidden in @media query', needle: /@media \(max-width: 640px\)[\s\S]*?\.toolbar-divider\s*\{\s*display:\s*none/ },
  { name: 'mobile: cluster takes 100% row width', needle: /@media \(max-width: 640px\)[\s\S]*?\.toolbar-cluster\s*\{[^}]*flex:\s*0\s*0\s*100%/ },
  { name: 'mobile: status dot hidden', needle: /@media \(max-width: 640px\)[\s\S]*?\.status\s*\{\s*display:\s*none/ },
];

let allPass = true;
for (const c of markupChecks) {
  const ok = typeof c.needle === 'string' ? html.includes(c.needle) : c.needle.test(html);
  if (!ok) allPass = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
}

// Runtime check: load the HTML in puppeteer, simulate clicking Compare, assert
// that the compare grid becomes visible and the single iframe hides.
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  // Block child iframe loads — we're testing the parent page's toggle logic,
  // not the canvas render path (covered by test-responsive-reflow.ts).
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.url().includes('/canvas/test-canvas-id/html') ? req.abort() : req.continue()));

  const before = await page.evaluate(() => ({
    singleVisible: getComputedStyle(document.getElementById('frame')!).display !== 'none',
    gridVisible: getComputedStyle(document.getElementById('compare-grid')!).display !== 'none',
  }));

  await page.click('#bp-compare');
  await new Promise((r) => setTimeout(r, 50));

  const after = await page.evaluate(() => ({
    singleVisible: getComputedStyle(document.getElementById('frame')!).display !== 'none',
    gridVisible: getComputedStyle(document.getElementById('compare-grid')!).display !== 'none',
    cells: document.querySelectorAll('.compare-cell').length,
    activeBtn: document.querySelector('.btn.active')?.id ?? null,
  }));

  const beforeOk = before.singleVisible === true && before.gridVisible === false;
  const afterOk = after.singleVisible === false && after.gridVisible === true && after.cells === 3 && after.activeBtn === 'bp-compare';
  if (!beforeOk) allPass = false;
  if (!afterOk) allPass = false;
  console.log(`${beforeOk ? 'PASS' : 'FAIL'}  initial state: single iframe visible, grid hidden`);
  console.log(`${afterOk ? 'PASS' : 'FAIL'}  after Compare click: grid visible (${after.cells} cells), single hidden, button active`);
} finally {
  await browser.close();
}

process.exit(allPass ? 0 : 1);