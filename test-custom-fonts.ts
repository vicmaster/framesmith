import './test-env.js';
// Smoke for Phase 8 item: custom font loading.
// The renderer must:
//   - emit `@font-face` blocks in <head> for `canvas.fonts` entries
//   - emit `<link rel="preconnect">` for unique remote origins
//   - skip preconnect for data: URIs (no origin to warm)
//   - silently drop entries with unsafe characters (defense in depth on top of
//     the MCP-tool zod validation)
//   - declare `font-display: swap` so paint isn't blocked on slow fonts
//   - leave canvases with no `fonts` field unchanged (no font-face block)
//
// Usage: npx tsx test-custom-fonts.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { Canvas, SceneNode } from './src/types.js';

const baseRoot: SceneNode = {
  id: 'doc', type: 'document', fill: '#0F172A',
  children: [
    { id: 'h', type: 'text', content: 'Designed type', fontSize: 48, fontFamily: 'Inter', color: '#FFFFFF' },
  ],
};

function makeCanvas(fonts?: Canvas['fonts']): Canvas {
  return {
    id: 'test', name: 'Test', projectId: 'p', createdAt: '', lastModified: '',
    root: baseRoot, variables: {}, components: {},
    fonts,
  };
}

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

// --- 1. Canvas without fonts: no font-face, no preconnect ---
{
  const html = renderToHtml(baseRoot, 1440, 900, makeCanvas(undefined));
  expect('no fonts: html has no @font-face', !html.includes('@font-face'));
  expect('no fonts: html has no preconnect link', !html.includes('rel="preconnect"'));
}

// --- 2. Single https font: emits @font-face + preconnect + font-display swap ---
{
  const canvas = makeCanvas([
    { family: 'Inter', url: 'https://fonts.gstatic.com/s/inter/v18/inter-regular.woff2', weight: 400, style: 'normal' },
  ]);
  const html = renderToHtml(baseRoot, 1440, 900, canvas);
  expect('https font: contains @font-face', html.includes('@font-face'));
  expect('https font: contains family token', html.includes('font-family: "Inter"'));
  expect('https font: contains src url', html.includes('src: url("https://fonts.gstatic.com/s/inter/v18/inter-regular.woff2") format("woff2")'));
  expect('https font: font-display: swap is declared', html.includes('font-display: swap'));
  expect('https font: font-weight present', html.includes('font-weight: 400'));
  expect('https font: font-style present', html.includes('font-style: normal'));
  expect('https font: preconnect emitted for gstatic origin', html.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'));
}

// --- 3. data: URI font: @font-face yes, preconnect NO ---
{
  const canvas = makeCanvas([
    { family: 'Synthetic', url: 'data:font/woff2;base64,AAAA' },
  ]);
  const html = renderToHtml(baseRoot, 1440, 900, canvas);
  expect('data URI: contains @font-face', html.includes('@font-face'));
  expect('data URI: format guessed as woff2', html.includes('format("woff2")'));
  expect('data URI: no preconnect link', !html.includes('rel="preconnect"'));
}

// --- 4. Invalid font (unsafe characters): silently dropped ---
{
  const canvas = makeCanvas([
    // Semicolon would escape the CSS declaration — must be dropped
    { family: 'Evil; color: red', url: 'https://example.com/a.woff2' },
    // Valid one alongside — should survive
    { family: 'Good', url: 'https://example.com/good.woff2' },
  ]);
  const html = renderToHtml(baseRoot, 1440, 900, canvas);
  expect('invalid: unsafe family dropped', !html.includes('Evil'));
  expect('invalid: good family survives', html.includes('font-family: "Good"'));
}

// --- 5. URL without http(s) or data:: dropped (e.g. javascript: scheme) ---
{
  const canvas = makeCanvas([
    { family: 'JsScheme', url: 'javascript:alert(1)' },
    { family: 'Ok', url: 'https://cdn.example.com/ok.woff2' },
  ]);
  const html = renderToHtml(baseRoot, 1440, 900, canvas);
  expect('javascript: URL dropped', !html.includes('JsScheme'));
  expect('valid URL survives next to dropped one', html.includes('font-family: "Ok"'));
}

// --- 6. Multiple https fonts, deduped preconnect ---
{
  const canvas = makeCanvas([
    { family: 'Inter', url: 'https://fonts.gstatic.com/s/inter/v18/a.woff2', weight: 400 },
    { family: 'Inter', url: 'https://fonts.gstatic.com/s/inter/v18/b.woff2', weight: 700 },
  ]);
  const html = renderToHtml(baseRoot, 1440, 900, canvas);
  const preconnectMatches = html.match(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"/g) ?? [];
  expect('two fonts same origin: single preconnect', preconnectMatches.length === 1, `count=${preconnectMatches.length}`);
  expect('two fonts: two @font-face blocks', (html.match(/@font-face/g) ?? []).length === 2);
}

// --- 7. Browser parses the @font-face rule successfully ---
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const canvas = makeCanvas([
    { family: 'ParseCheck', url: 'data:font/woff2;base64,AAAA', weight: 500 },
  ]);
  const html = renderToHtml(baseRoot, 1440, 900, canvas);
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const observed = await page.evaluate(() => Array.from(document.fonts).map((f) => f.family));
  await page.close();
  expect('browser registers ParseCheck in document.fonts', observed.includes('ParseCheck'), `observed=${JSON.stringify(observed)}`);
} finally {
  await browser.close();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);