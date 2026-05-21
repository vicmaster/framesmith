import './test-env.js';
// Smoke for Phase 8 item: SVG path primitives.
// The renderer must:
//   - emit a <svg><path/></svg> for type:'path' nodes
//   - default viewBox to `0 0 width height` when omitted
//   - respect explicit viewBox
//   - apply fill/stroke/strokeWidth/strokeLinecap/strokeLinejoin to the path
//   - skip background-color and border on the wrapper div (path uses fill on
//     the path element, not as the wrapper's background)
//   - reject unsafe `d` strings (invalid markup characters) and emit a comment
//   - leave width/height/position/cornerRadius/opacity on the wrapper
//
// Usage: npx tsx test-svg-paths.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

function render(node: SceneNode): string {
  return renderToHtml({ id: 'doc', type: 'document', fill: '#0F172A', children: [node] }, 1440, 900);
}

// Triangle path data for the smoke tests
const TRIANGLE = 'M 12 2 L 22 22 L 2 22 Z';

// --- 1. Basic path emits <svg><path/></svg> ---
{
  const html = render({ id: 'tri', type: 'path', width: 24, height: 24, d: TRIANGLE, fill: '#f59e0b' });
  expect('basic: html contains <svg', html.includes('<svg'));
  expect('basic: html contains <path', html.includes('<path '));
  expect('basic: d attribute present', html.includes(`d="${TRIANGLE}"`));
  expect('basic: fill attribute on path', html.includes('fill="#f59e0b"'));
}

// --- 2. viewBox defaults from width/height when omitted ---
{
  const html = render({ id: 'tri', type: 'path', width: 48, height: 32, d: TRIANGLE });
  expect('viewBox default: derived from w/h', html.includes('viewBox="0 0 48 32"'));
}

// --- 3. Explicit viewBox takes precedence ---
{
  const html = render({ id: 'tri', type: 'path', width: 100, height: 100, d: TRIANGLE, viewBox: '0 0 24 24' });
  expect('viewBox explicit: kept verbatim', html.includes('viewBox="0 0 24 24"'));
  expect('viewBox explicit: width-derived form NOT emitted', !html.includes('viewBox="0 0 100 100"'));
}

// --- 4. stroke / strokeWidth / linecap / linejoin propagate ---
{
  const html = render({
    id: 'tri', type: 'path', width: 24, height: 24, d: TRIANGLE,
    stroke: '#000', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  });
  expect('stroke: stroke attribute on path', html.includes('stroke="#000"'));
  expect('stroke: stroke-width attribute on path', html.includes('stroke-width="2"'));
  expect('stroke: stroke-linecap="round"', html.includes('stroke-linecap="round"'));
  expect('stroke: stroke-linejoin="round"', html.includes('stroke-linejoin="round"'));
}

// --- 5. fill/stroke do NOT show up as wrapper background/border ---
{
  const html = render({ id: 'tri', type: 'path', width: 24, height: 24, d: TRIANGLE, fill: '#f59e0b', stroke: '#000', strokeWidth: 2 });
  // Find the wrapper div for data-node-id="tri" and check its inline style
  const m = html.match(/<div data-node-id="tri" style="([^"]*)">/);
  const wrapperStyle = m?.[1] ?? '';
  expect('wrapper: no background-color from fill', !wrapperStyle.includes('background-color'),
    `wrapperStyle="${wrapperStyle}"`);
  expect('wrapper: no border from stroke', !wrapperStyle.includes('border:'),
    `wrapperStyle="${wrapperStyle}"`);
}

// --- 6. Unsafe `d` (contains <) is dropped with comment ---
{
  const html = render({ id: 'tri', type: 'path', width: 24, height: 24, d: 'M 0 0 <script>alert(1)</script>' });
  expect('unsafe d: no <path emitted', !html.includes('<path '));
  expect('unsafe d: comment present', html.includes('<!-- invalid path d -->'));
}

// --- 7. Unsafe viewBox falls back to default ---
{
  const html = render({ id: 'tri', type: 'path', width: 50, height: 50, d: TRIANGLE, viewBox: '0 0 24" onload="alert(1)' });
  expect('unsafe viewBox: falls back to derived', html.includes('viewBox="0 0 50 50"'));
  expect('unsafe viewBox: unsafe form NOT emitted', !html.includes('onload'));
}

// --- 8. Wrapper still gets width/height/position from SceneNode ---
{
  const html = render({ id: 'tri', type: 'path', width: 48, height: 48, d: TRIANGLE, cornerRadius: 6, opacity: 0.8 });
  const m = html.match(/<div data-node-id="tri" style="([^"]*)">/);
  const wrapperStyle = m?.[1] ?? '';
  expect('wrapper: width preserved', wrapperStyle.includes('width: 48px'));
  expect('wrapper: cornerRadius preserved', wrapperStyle.includes('border-radius: 6px'));
  expect('wrapper: opacity preserved', wrapperStyle.includes('opacity: 0.8'));
}

// --- 9. Browser parses the SVG path successfully ---
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const html = render({ id: 'tri', type: 'path', width: 100, height: 100, d: TRIANGLE, fill: '#f59e0b' });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const observed = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-node-id="tri"]');
    const svg = wrapper?.querySelector('svg');
    const path = svg?.querySelector('path');
    return {
      hasSvg: !!svg,
      hasPath: !!path,
      pathD: path?.getAttribute('d') ?? '',
      pathFill: path?.getAttribute('fill') ?? '',
      svgViewBox: svg?.getAttribute('viewBox') ?? '',
    };
  });
  await page.close();
  expect('browser: SVG element in DOM', observed.hasSvg);
  expect('browser: path element in DOM', observed.hasPath);
  expect('browser: path d attribute round-trips', observed.pathD === TRIANGLE,
    `got="${observed.pathD}"`);
  expect('browser: path fill round-trips', observed.pathFill === '#f59e0b',
    `got="${observed.pathFill}"`);
  expect('browser: viewBox round-trips', observed.svgViewBox === '0 0 100 100',
    `got="${observed.svgViewBox}"`);
} finally {
  await browser.close();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);