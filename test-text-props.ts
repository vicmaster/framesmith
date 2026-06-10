import './test-env.js';
// Smoke for text styling props the issue-#77 dogfood session needed:
//   - letterSpacing → letter-spacing: <n>px
//   - textTransform → text-transform: <value>
//   - fontVariationSettings → font-variation-settings (quotes survive the
//     style-attribute escape round-trip and reach the CSSOM intact)
//
// Usage: npx tsx test-text-props.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

function render(node: SceneNode): string {
  return renderToHtml({ id: 'doc', type: 'document', fill: '#FFFFFF', children: [node] }, 1440, 900);
}

// --- 1. Emission ---
{
  const html = render({
    id: 'label', type: 'text', content: 'Active users', fontSize: 12,
    letterSpacing: 0.8, textTransform: 'uppercase', fontVariationSettings: '"wght" 650, "opsz" 24',
  });
  expect('emits letter-spacing in px', html.includes('letter-spacing: 0.8px'));
  expect('emits text-transform', html.includes('text-transform: uppercase'));
  expect('emits font-variation-settings (attr-escaped quotes)',
    html.includes('font-variation-settings: &quot;wght&quot; 650, &quot;opsz&quot; 24'));
}

// --- 2. Absent props emit nothing ---
{
  const html = render({ id: 'plain', type: 'text', content: 'Plain', fontSize: 16 });
  expect('no spurious letter-spacing', !html.includes('letter-spacing'));
  expect('no spurious text-transform', !html.includes('text-transform'));
  expect('no spurious font-variation-settings', !html.includes('font-variation-settings'));
}

// --- 3. Browser computes the values (quotes survived escaping) ---
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const html = render({
    id: 'label', type: 'text', content: 'Active users', fontSize: 12,
    letterSpacing: 0.8, textTransform: 'uppercase', fontVariationSettings: '"wght" 650',
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const computed = await page.evaluate(() => {
    const el = document.querySelector('[data-node-id="label"]') as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      fontVariationSettings: cs.fontVariationSettings,
    };
  });
  await page.close();
  expect('browser: letter-spacing = 0.8px', computed.letterSpacing === '0.8px', `got "${computed.letterSpacing}"`);
  expect('browser: text-transform = uppercase', computed.textTransform === 'uppercase', `got "${computed.textTransform}"`);
  expect('browser: font-variation-settings = "wght" 650', computed.fontVariationSettings === '"wght" 650', `got "${computed.fontVariationSettings}"`);
} finally {
  await browser.close();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);
