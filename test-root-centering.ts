import './test-env.js';
// Smoke for Phase 5 item #4: root document centers horizontally and the root
// fill/gradient extends to the full viewport (no dead white sidebars on wide
// screens).
//
// Usage: npx tsx test-root-centering.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

const SOLID: SceneNode = {
  id: 'doc-solid', type: 'document', fill: '#1E293B',
  width: 1200, height: 600,
  children: [{ id: 'child', type: 'text', content: 'centered', color: '#FFFFFF' }],
};

const GRADIENT: SceneNode = {
  id: 'doc-gradient', type: 'document',
  gradient: { type: 'linear', angle: 135, stops: [{ color: '#0F172A', position: 0 }, { color: '#1E293B', position: 100 }] },
  width: 1200, height: 600,
  children: [{ id: 'child', type: 'text', content: 'centered', color: '#FFFFFF' }],
};

const PLAIN: SceneNode = {
  id: 'doc-plain', type: 'document',
  width: 800, height: 400,
  children: [{ id: 'child', type: 'text', content: 'no bg' }],
};

const cases = [
  { name: 'solid fill, wide viewport', root: SOLID, renderW: 1200, vpW: 1920, expectBodyX: 360, expectHtmlBg: 'rgb(30, 41, 59)', expectHtmlImage: 'none' },
  { name: 'gradient, wide viewport', root: GRADIENT, renderW: 1200, vpW: 1920, expectBodyX: 360, expectHtmlBg: 'rgba(0, 0, 0, 0)', expectHtmlImage: /linear-gradient/ },
  { name: 'no bg, wide viewport', root: PLAIN, renderW: 800, vpW: 1920, expectBodyX: 560, expectHtmlBg: 'rgba(0, 0, 0, 0)', expectHtmlImage: 'none' },
  { name: 'solid fill, narrow viewport (no overflow)', root: SOLID, renderW: 1200, vpW: 1200, expectBodyX: 0, expectHtmlBg: 'rgb(30, 41, 59)', expectHtmlImage: 'none' },
];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let allPass = true;
try {
  for (const c of cases) {
    const html = renderToHtml(c.root, c.renderW, 600);
    const page = await browser.newPage();
    await page.setViewport({ width: c.vpW, height: 800, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(() => ({
      bodyX: Math.round(document.body.getBoundingClientRect().x),
      bodyWidth: Math.round(document.body.getBoundingClientRect().width),
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      htmlImage: getComputedStyle(document.documentElement).backgroundImage,
    }));
    await page.close();

    const xOk = r.bodyX === c.expectBodyX;
    const bgOk = r.htmlBg === c.expectHtmlBg;
    const imgOk = c.expectHtmlImage instanceof RegExp ? c.expectHtmlImage.test(r.htmlImage) : r.htmlImage === c.expectHtmlImage;
    const pass = xOk && bgOk && imgOk;
    if (!pass) allPass = false;
    console.log(`[${c.name}]`);
    console.log(`  bodyX:     ${r.bodyX} (expected ${c.expectBodyX}) — ${xOk ? 'PASS' : 'FAIL'}`);
    console.log(`  htmlBg:    ${r.htmlBg} (expected ${c.expectHtmlBg}) — ${bgOk ? 'PASS' : 'FAIL'}`);
    console.log(`  htmlImage: ${r.htmlImage.slice(0, 80)} — ${imgOk ? 'PASS' : 'FAIL'}`);
  }
} finally {
  await browser.close();
}
process.exit(allPass ? 0 : 1);