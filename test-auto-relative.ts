import './test-env.js';
// Smoke for Phase 8 item: auto position: relative injection.
// When a descendant uses `position: absolute` without a positioned ancestor,
// the renderer must inject `position: relative` on the nearest container
// frame/document/component so the absolute child anchors to it instead of
// escaping to body coordinates (the slice 5a mock bug).
//
// Usage: npx tsx test-auto-relative.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

interface Case {
  label: string;
  root: SceneNode;
  // Map of node id → expected computed `position` value.
  expect: Record<string, string>;
}

const cases: Case[] = [
  {
    label: 'frame with absolute child gets position: relative',
    root: {
      id: 'doc', type: 'document', fill: '#0F172A',
      children: [
        {
          id: 'card', type: 'frame', width: 400, height: 240, fill: '#1f2937',
          children: [
            { id: 'badge', type: 'frame', position: 'absolute', x: 12, y: 12, width: 40, height: 20, fill: '#f59e0b' },
          ],
        },
      ],
    },
    expect: { card: 'relative', badge: 'absolute' },
  },
  {
    label: 'no injection when ancestor is already positioned',
    root: {
      id: 'doc', type: 'document', fill: '#0F172A',
      children: [
        {
          id: 'outer', type: 'frame', position: 'relative', width: 600, height: 400, fill: '#1f2937',
          children: [
            {
              id: 'inner', type: 'frame', width: 400, height: 240, fill: '#374151',
              children: [
                { id: 'badge', type: 'frame', position: 'absolute', x: 12, y: 12, width: 40, height: 20, fill: '#f59e0b' },
              ],
            },
          ],
        },
      ],
    },
    // outer keeps its explicit relative, inner stays static (no injection)
    expect: { outer: 'relative', inner: 'static', badge: 'absolute' },
  },
  {
    label: 'nearest container picked when multiple frames stack',
    root: {
      id: 'doc', type: 'document', fill: '#0F172A',
      children: [
        {
          id: 'outer', type: 'frame', width: 600, height: 400, fill: '#1f2937',
          children: [
            {
              id: 'inner', type: 'frame', width: 400, height: 240, fill: '#374151',
              children: [
                { id: 'badge', type: 'frame', position: 'absolute', x: 12, y: 12, width: 40, height: 20, fill: '#f59e0b' },
              ],
            },
          ],
        },
      ],
    },
    // inner is the nearest container ancestor — it gets the injection.
    // outer stays static (we don't bubble higher than necessary).
    expect: { outer: 'static', inner: 'relative', badge: 'absolute' },
  },
  {
    label: 'document is the container when absolute child is at root level',
    root: {
      id: 'doc', type: 'document', fill: '#0F172A',
      children: [
        { id: 'badge', type: 'frame', position: 'absolute', x: 12, y: 12, width: 40, height: 20, fill: '#f59e0b' },
      ],
    },
    expect: { doc: 'relative', badge: 'absolute' },
  },
];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let allPass = true;

try {
  for (const c of cases) {
    const html = renderToHtml(c.root, 1440, 900);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const ids = Object.keys(c.expect);
    const observed = await page.evaluate((nodeIds) => {
      const out: Record<string, string> = {};
      for (const id of nodeIds) {
        const el = document.querySelector(`[data-node-id="${id}"]`);
        out[id] = el ? getComputedStyle(el).position : 'MISSING';
      }
      return out;
    }, ids);
    await page.close();

    console.log(`[${c.label}]`);
    let casePass = true;
    for (const id of ids) {
      const want = c.expect[id];
      const got = observed[id];
      const ok = got === want;
      if (!ok) casePass = false;
      console.log(`  ${id}: ${got}  ${ok ? 'PASS' : `FAIL (expected ${want})`}`);
    }
    if (!casePass) allPass = false;
  }
} finally {
  await browser.close();
}

process.exit(allPass ? 0 : 1);