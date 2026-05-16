// Rebuilds docs/hero.png — the README hero image — by rendering the dashboard
// mock canvas through renderer + puppeteer. The scene graph itself lives in
// benchmark/corpus/hero.ts (single source of truth shared with the Phase 6b
// benchmark suite).
//
// Usage: npx tsx scripts/build-hero.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { renderToHtml } from '../src/renderer.js';
import { heroRoot } from '../benchmark/corpus/hero.js';

const WIDTH = 1200;
const HEIGHT = 800;
const SCALE = 2;
const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'docs', 'hero.png');

const html = renderToHtml(heroRoot, WIDTH, HEIGHT);
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
