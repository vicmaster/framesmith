import './test-env.js';
// Phase 16 Slice B — Material Symbols icon set alongside Lucide.
// Covers: ref parsing (prefix vs back-compat), per-set rendering (stroke vs
// fill recolor, sizing), style variants, -fill suffix names, unknown-name
// degrade, path-traversal rejection, renderer pass-through of iconStyle, and a
// computed-render check in Chrome.
//
// Usage: npx tsx test-material-icons.ts

import puppeteer from 'puppeteer';
import { getIconSvg, parseIconRef } from './src/icons.js';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

// ── 1. ref parsing ───────────────────────────────────────────────────────────
{
  expect('unprefixed → lucide', parseIconRef('search').set === 'lucide' && parseIconRef('search').name === 'search');
  expect('material: prefix parsed', parseIconRef('material:check').set === 'material' && parseIconRef('material:check').name === 'check');
  expect('prefix is case-insensitive', parseIconRef('Material:check').set === 'material');
  expect('unknown prefix falls back to lucide name', parseIconRef('phosphor:x').set === 'lucide');
}

// ── 2. lucide rendering unchanged (back-compat) ──────────────────────────────
{
  const svg = getIconSvg('search', 32, '#ff0000');
  expect('lucide renders', svg !== null && svg.includes('<svg'));
  expect('lucide sized', svg!.includes('width="32"'));
  expect('lucide recolors stroke', svg!.includes('stroke="#ff0000"'));
  expect('lucide unknown name → null', getIconSvg('definitely-not-an-icon') === null);
}

// ── 3. material rendering ────────────────────────────────────────────────────
{
  const svg = getIconSvg('material:check', 24, '#b71421');
  expect('material renders', svg !== null && svg!.includes('<svg'));
  expect('material sized (48 → 24)', svg!.includes('width="24"') && !svg!.includes('width="48"'));
  expect('material recolors via fill on root svg', svg!.includes('fill="#b71421"'));
  expect('material keeps its viewBox', svg!.includes('viewBox="0 -960 960 960"'));

  const fill = getIconSvg('material:check-fill', 24);
  expect('-fill variant resolves', fill !== null);

  const rounded = getIconSvg('material:check', 24, undefined, 'rounded');
  const sharp = getIconSvg('material:check', 24, undefined, 'sharp');
  const outlined = getIconSvg('material:check', 24);
  expect('style variants resolve', rounded !== null && sharp !== null && outlined !== null);
  expect('styles differ (distinct glyph data)', rounded !== outlined || sharp !== outlined);

  expect('material unknown name → null', getIconSvg('material:not-a-real-symbol') === null);
  expect('path traversal rejected', getIconSvg('material:../../package') === null);
  expect('unsafe color dropped, icon still renders', (() => {
    const s = getIconSvg('material:check', 24, '"><script>');
    return s !== null && !s.includes('script');
  })());
}

// ── 4. renderer integration ──────────────────────────────────────────────────
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#fff', children: [
      { id: 'm', type: 'icon', icon: 'material:settings', iconSize: 20, iconColor: '#333', iconStyle: 'rounded' },
      { id: 'l', type: 'icon', icon: 'heart', iconSize: 20, iconColor: '#e11' },
      { id: 'u', type: 'icon', icon: 'material:nope-nope', iconSize: 20 },
    ],
  };
  const html = renderToHtml(root, 400, 100);
  expect('renderer emits material svg', html.includes('viewBox="0 -960 960 960"'));
  expect('renderer passes iconStyle + color', html.includes('fill="#333"'));
  expect('renderer keeps lucide working', html.includes('stroke="#e11"'));
  expect('unknown icon degrades to comment', html.includes('<!-- unknown icon: material:nope-nope -->'));
}

// ── 5. Chrome: both sets paint at the requested size ─────────────────────────
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#fff', layout: 'horizontal', gap: 8, padding: 16, children: [
      { id: 'm', type: 'icon', icon: 'material:check', iconSize: 24, iconColor: '#b71421' },
      { id: 'l', type: 'icon', icon: 'check', iconSize: 24, iconColor: '#b71421' },
    ],
  };
  const html = renderToHtml(root, 200, 80);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    // String-function form avoids the tsx/esbuild __name transform inside
    // page.evaluate (same workaround as src/screenshot.ts computeDiff).
    const sizes = await page.evaluate(`(function () {
      function rect(id) {
        var el = document.querySelector('[data-node-id="' + id + '"] svg');
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }
      return { material: rect('m'), lucide: rect('l') };
    })()`) as { material: { w: number; h: number } | null; lucide: { w: number; h: number } | null };
    await page.close();
    expect('material svg paints at 24×24', sizes.material?.w === 24 && sizes.material?.h === 24, JSON.stringify(sizes.material));
    expect('lucide svg paints at 24×24', sizes.lucide?.w === 24 && sizes.lucide?.h === 24, JSON.stringify(sizes.lucide));
  } finally {
    await browser.close();
  }
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
