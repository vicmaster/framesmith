// Smoke for the renderer default font-family. Asserts that a text node with no
// `fontFamily` set inherits the sans-serif stack from the body rule (not the
// browser's default serif), and that explicit per-node `fontFamily` still wins.
//
// Usage: npx tsx test-default-font.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

const root: SceneNode = {
  id: 'doc',
  type: 'document',
  padding: 24,
  gap: 16,
  children: [
    { id: 'inherits', type: 'text', content: 'inherits body default' },
    { id: 'overrides', type: 'text', content: 'explicit override', fontFamily: 'Georgia, serif' },
  ],
};

const html = renderToHtml(root, 400, 200);
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let allPass = true;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 200, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(() => ({
    inherits: getComputedStyle(document.querySelector('[data-node-id="inherits"]')!).fontFamily,
    overrides: getComputedStyle(document.querySelector('[data-node-id="overrides"]')!).fontFamily,
  }));

  const inheritsOk = /system-ui|sans-serif/i.test(result.inherits) && !/serif$/i.test(result.inherits.split(',')[0].trim());
  const overridesOk = /Georgia/i.test(result.overrides);

  console.log(`inherits: "${result.inherits}" → ${inheritsOk ? 'PASS' : 'FAIL'} (expected sans-serif stack)`);
  console.log(`overrides: "${result.overrides}" → ${overridesOk ? 'PASS' : 'FAIL'} (expected Georgia)`);

  allPass = inheritsOk && overridesOk;
} finally {
  await browser.close();
}

process.exit(allPass ? 0 : 1);
