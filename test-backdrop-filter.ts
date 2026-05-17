// Smoke for Phase 8 item: backdrop-filter support.
// The renderer must:
//   - compose blur + saturate + brightness + contrast into a single
//     `backdrop-filter` value in fixed order
//   - emit `-webkit-backdrop-filter` alongside `backdrop-filter` for Safari
//   - fall back to `backdropBlur` (legacy field) when `backdropFilter` is absent
//   - let `backdropFilter` win when both are set (precedence)
//   - emit nothing when both are absent
//   - skip undefined sub-fields (e.g. saturate only, no blur)
//
// Usage: npx tsx test-backdrop-filter.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

function render(node: SceneNode): string {
  return renderToHtml({ id: 'doc', type: 'document', fill: '#0F172A', children: [node] }, 1440, 900);
}

// --- 1. Empty: no backdrop emission ---
{
  const html = render({ id: 'a', type: 'frame', width: 200, height: 200, fill: 'rgba(255,255,255,0.5)' });
  expect('no filter: no backdrop-filter in output', !html.includes('backdrop-filter'));
  expect('no filter: no webkit prefix', !html.includes('-webkit-backdrop-filter'));
}

// --- 2. Legacy backdropBlur still works ---
{
  const html = render({ id: 'a', type: 'frame', width: 200, height: 200, fill: 'rgba(255,255,255,0.5)', backdropBlur: 8 });
  expect('legacy: emits backdrop-filter: blur(8px)', html.includes('backdrop-filter: blur(8px)'));
  expect('legacy: emits -webkit-backdrop-filter: blur(8px)', html.includes('-webkit-backdrop-filter: blur(8px)'));
}

// --- 3. Structured backdropFilter composes all four ---
{
  const html = render({
    id: 'a', type: 'frame', width: 200, height: 200, fill: 'rgba(255,255,255,0.4)',
    backdropFilter: { blur: 12, saturate: 180, brightness: 110, contrast: 105 },
  });
  expect('compose: fixed order blur saturate brightness contrast',
    html.includes('backdrop-filter: blur(12px) saturate(180%) brightness(110%) contrast(105%)'));
  expect('compose: webkit prefix matches unprefixed',
    html.includes('-webkit-backdrop-filter: blur(12px) saturate(180%) brightness(110%) contrast(105%)'));
}

// --- 4. Partial: only saturate (no blur) ---
{
  const html = render({
    id: 'a', type: 'frame', width: 200, height: 200, fill: 'rgba(255,255,255,0.4)',
    backdropFilter: { saturate: 200 },
  });
  expect('partial: saturate-only emits just saturate()', html.includes('backdrop-filter: saturate(200%)'));
  expect('partial: no spurious blur(0px)', !html.includes('blur(0px)'));
}

// --- 5. Precedence: backdropFilter wins over backdropBlur when both set ---
{
  const html = render({
    id: 'a', type: 'frame', width: 200, height: 200, fill: 'rgba(255,255,255,0.4)',
    backdropBlur: 20,
    backdropFilter: { blur: 4, saturate: 160 },
  });
  expect('precedence: emits structured value', html.includes('backdrop-filter: blur(4px) saturate(160%)'));
  expect('precedence: does NOT emit the legacy 20px blur', !html.includes('blur(20px)'));
}

// --- 6. Empty object: no emission (no parts to compose) ---
{
  const html = render({
    id: 'a', type: 'frame', width: 200, height: 200, fill: 'rgba(255,255,255,0.4)',
    backdropFilter: {},
  });
  expect('empty object: no backdrop-filter property', !html.includes('backdrop-filter:'));
}

// --- 7. Browser parses and computes the property ---
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const html = render({
    id: 'glass', type: 'frame', width: 200, height: 200, fill: 'rgba(255,255,255,0.4)',
    backdropFilter: { blur: 12, saturate: 180 },
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const computed = await page.evaluate(() => {
    const el = document.querySelector('[data-node-id="glass"]') as HTMLElement;
    const cs = getComputedStyle(el);
    return { backdrop: cs.backdropFilter, webkit: cs.webkitBackdropFilter };
  });
  await page.close();
  // Chromium normalizes the value but both should be non-empty + match each other.
  expect('browser: computed backdrop-filter is non-empty',
    !!computed.backdrop && computed.backdrop !== 'none',
    `backdrop="${computed.backdrop}"`);
  expect('browser: computed value contains blur(12px)',
    (computed.backdrop ?? '').includes('blur(12px)'),
    `backdrop="${computed.backdrop}"`);
  expect('browser: computed value contains saturate(1.8)',
    /saturate\((1\.?8?0?|180%)\)/.test(computed.backdrop ?? ''),
    `backdrop="${computed.backdrop}"`);
} finally {
  await browser.close();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);
