import './test-env.js';
// Regression smoke for the inline-style attribute escape bug found while
// dogfooding the Phase 8 release page.
//
// Before this fix: a fontFamily of "Inter", system-ui (double quotes around
// Inter) interpolated raw into `style="..."`, prematurely closing the outer
// HTML attribute. Everything after the inner `"` was lost as malformed HTML,
// including the `color` declaration — text rendered un-styled.
//
// After: `"` and `&` in style values are HTML-escaped (&quot; / &amp;) so
// the browser still parses them back to the same CSS string but the attribute
// stays well-formed.
//
// Usage: npx tsx test-style-attr-escape.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

// --- HTML-level: " in fontFamily becomes &quot; (no premature attribute close) ---
{
  const html = renderToHtml({
    id: 'doc', type: 'document', fill: '#0F172A',
    children: [
      { id: 't', type: 'text', content: 'Hello', fontSize: 24, fontFamily: '"Inter", system-ui, sans-serif', color: '#fafaf5' },
    ],
  }, 1440, 900);
  expect('html: contains &quot;Inter&quot; (escaped)', html.includes('&quot;Inter&quot;'));
  expect('html: raw "Inter" (with both " unescaped) absent', !html.includes('"Inter"'));
  // The color must still be present in the same attribute (no premature close)
  const tagMatch = html.match(/<p data-node-id="t" style="([^"]*)"/);
  expect('html: color survives in same style attribute', (tagMatch?.[1] ?? '').includes('color: #fafaf5'),
    `style="${tagMatch?.[1] ?? '(no match)'}"`);
}

// --- Browser-level: the escaped attribute parses back to the original CSS ---
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const html = renderToHtml({
    id: 'doc', type: 'document', fill: '#0F172A',
    children: [
      { id: 't', type: 'text', content: 'Hello', fontSize: 24, fontFamily: '"Inter", system-ui, sans-serif', color: '#fafaf5' },
    ],
  }, 1440, 900);
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const observed = await page.evaluate(() => {
    const el = document.querySelector('[data-node-id="t"]') as HTMLElement;
    const cs = getComputedStyle(el);
    return { color: cs.color, fontFamily: cs.fontFamily };
  });
  await page.close();
  // rgb(250, 250, 245) is the rgba form of #fafaf5
  expect('browser: color preserved through escape', observed.color === 'rgb(250, 250, 245)',
    `color=${observed.color}`);
  expect('browser: fontFamily resolves to a stack containing Inter',
    observed.fontFamily.includes('Inter'),
    `fontFamily=${observed.fontFamily}`);
} finally {
  await browser.close();
}

// --- Ampersand also escaped ---
{
  const html = renderToHtml({
    id: 'doc', type: 'document', fill: '#0F172A',
    children: [
      // CSS quoted-string ampersand isn't common, but we escape & for HTML
      // attribute safety. font-family containing & should round-trip.
      { id: 't', type: 'text', content: 'X', fontFamily: 'A&B', color: '#fff' },
    ],
  }, 1440, 900);
  expect('html: & escaped to &amp;', html.includes('font-family: A&amp;B'));
  expect('html: raw "& " inside style absent', !html.includes('font-family: A&B'));
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);