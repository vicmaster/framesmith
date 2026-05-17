// Smoke for Phase 8 final item: animations + transitions.
// The renderer must:
//   - emit a built-in @keyframes block ONLY when referenced
//   - skip the @keyframes block entirely when no node references it
//   - emit `animation: <name> Xms easing Xms iter normal both` shorthand
//   - emit `transition: <property> Xms easing Xms` shorthand
//   - fall back when easing is not in the allowed whitelist
//   - ignore animations with unknown keyframe names (defense in depth)
//   - reject suspicious transition.property values (default to 'all')
//   - leave existing scenes unchanged when neither field is set
//
// Usage: npx tsx test-animations.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

function render(child: SceneNode): string {
  return renderToHtml({ id: 'doc', type: 'document', fill: '#0F172A', children: [child] }, 1440, 900);
}

// --- 1. No animation/transition: no keyframes block emitted ---
{
  const html = render({ id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff' });
  expect('no anim: no @keyframes in output', !html.includes('@keyframes'));
  expect('no anim: no animation: declaration', !html.includes('animation:'));
  expect('no anim: no transition: declaration', !html.includes('transition:'));
}

// --- 2. Single fadeIn: emits the keyframe + shorthand ---
{
  const html = render({
    id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff',
    animation: { name: 'fadeIn', duration: 400 },
  });
  expect('fadeIn: @keyframes fadeIn block emitted', html.includes('@keyframes fadeIn'));
  expect('fadeIn: shorthand with defaults', html.includes('animation: fadeIn 400ms ease-out 0ms 1 normal both'));
  // Other library keyframes shouldn't be in the output
  expect('fadeIn: slideUp not emitted', !html.includes('@keyframes slideUp'));
  expect('fadeIn: scaleIn not emitted', !html.includes('@keyframes scaleIn'));
}

// --- 3. Custom easing/delay/iteration ---
{
  const html = render({
    id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff',
    animation: { name: 'slideUp', duration: 250, delay: 100, easing: 'ease-in-out', iteration: 'infinite' },
  });
  expect('slideUp: easing applied', html.includes('animation: slideUp 250ms ease-in-out 100ms infinite normal both'));
}

// --- 4. Unknown easing falls back to ease-out ---
{
  const html = render({
    id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff',
    // @ts-expect-error testing invalid input
    animation: { name: 'fadeIn', easing: 'bounce(1)' },
  });
  expect('bad easing: falls back to ease-out', html.includes('animation: fadeIn 300ms ease-out 0ms 1 normal both'));
}

// --- 5. Unknown keyframe name dropped silently ---
{
  const html = render({
    id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff',
    // @ts-expect-error testing invalid input
    animation: { name: 'evilAnim; expression(alert(1)); --' },
  });
  expect('bad keyframe name: no animation: emitted', !html.includes('animation:'));
  expect('bad keyframe name: no @keyframes for it', !html.includes('evilAnim'));
}

// --- 6. Multiple nodes referencing same keyframe → one @keyframes block ---
{
  const html = render({
    id: 'wrap', type: 'frame', width: 200, height: 200, fill: '#fff',
    children: [
      { id: 'a', type: 'frame', width: 50, height: 50, animation: { name: 'fadeIn' } },
      { id: 'b', type: 'frame', width: 50, height: 50, animation: { name: 'fadeIn', delay: 100 } },
    ],
  });
  const blocks = (html.match(/@keyframes fadeIn/g) ?? []).length;
  expect('dedup: only one @keyframes fadeIn block', blocks === 1, `count=${blocks}`);
}

// --- 7. Different keyframes → both blocks emitted ---
{
  const html = render({
    id: 'wrap', type: 'frame', width: 200, height: 200, fill: '#fff',
    children: [
      { id: 'a', type: 'frame', width: 50, height: 50, animation: { name: 'fadeIn' } },
      { id: 'b', type: 'frame', width: 50, height: 50, animation: { name: 'slideUp' } },
    ],
  });
  expect('two names: fadeIn block emitted', html.includes('@keyframes fadeIn'));
  expect('two names: slideUp block emitted', html.includes('@keyframes slideUp'));
}

// --- 8. Transition shorthand basic ---
{
  const html = render({
    id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff',
    transition: { property: 'opacity', duration: 200, easing: 'ease-out' },
  });
  expect('transition: shorthand correct', html.includes('transition: opacity 200ms ease-out 0ms'));
}

// --- 9. Transition property defaults to 'all', invalid property rejected ---
{
  const html = render({
    id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff',
    transition: { duration: 150 },
  });
  expect('transition default property: all', html.includes('transition: all 150ms ease 0ms'));
}
{
  const html = render({
    id: 'a', type: 'frame', width: 100, height: 100, fill: '#fff',
    transition: { property: 'opacity; background: red', duration: 200 },
  });
  expect('transition unsafe property: falls back to all', html.includes('transition: all 200ms ease 0ms'));
  expect('transition unsafe property: original NOT emitted', !html.includes('opacity; background'));
}

// --- 10. Browser parses the animation and computes the property ---
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const html = render({
    id: 'anim', type: 'frame', width: 100, height: 100, fill: '#3b82f6',
    animation: { name: 'fadeIn', duration: 1000, delay: 5000 }, // long enough to inspect mid-flight
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const observed = await page.evaluate(() => {
    const el = document.querySelector('[data-node-id="anim"]') as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      animationFillMode: cs.animationFillMode,
    };
  });
  await page.close();
  expect('browser: animationName resolves to fadeIn', observed.animationName === 'fadeIn',
    `got=${observed.animationName}`);
  expect('browser: animationDuration is 1s', observed.animationDuration === '1s',
    `got=${observed.animationDuration}`);
  expect('browser: animation-fill-mode is both', observed.animationFillMode === 'both',
    `got=${observed.animationFillMode}`);
} finally {
  await browser.close();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);
