import '../env.js';
/**
 * Phase 29 slice E (#194) — renderer and capture.
 *
 * Two shipped fixes and one guard:
 *
 *   1. `responsive: "fixed"` is WITHDRAWN. It was documented in four places for
 *      four releases while nothing in the renderer ever read it — it promised an
 *      opt-out from reflow, but `stack` and `wrap` are both opt-IN, so a
 *      container with no hint already never reflows. The guard below asserts the
 *      documented vocabulary and the implemented vocabulary stay the same set,
 *      so a value can't be documented into existence again.
 *
 *   2. `screenshot` can capture the whole design. It hardcoded `fullPage: false`
 *      with no way to override, so a canvas taller than its artboard could only
 *      be seen by editing the root height by hand.
 *
 * Needs Chrome for the capture case. Run with: npx tsx test/browser/test-render-capture.ts
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, getCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { renderToHtml } from '../../src/renderer.js';
import { takeScreenshot, exportToFile, shutdown } from '../../src/screenshot.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── 1. documented responsive hints == implemented responsive hints ───────────
{
  const types = readFileSync('src/types.ts', 'utf-8');
  const union = types.match(/responsive\?:\s*([^;]+);/)?.[1] ?? '';
  const declared = new Set([...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]));

  const renderer = readFileSync('src/renderer.ts', 'utf-8');
  const implemented = new Set([...renderer.matchAll(/responsive === '([a-z]+)'/g)].map((m) => m[1]));

  check('the responsive union is non-empty', declared.size > 0, [...declared].join(', '));
  const documentedNotImplemented = [...declared].filter((v) => !implemented.has(v));
  check('every documented responsive hint is read by the renderer',
    documentedNotImplemented.length === 0,
    documentedNotImplemented.length ? `${documentedNotImplemented.join(', ')} declared but never read` : '');
  check('"fixed" is gone from the union', !declared.has('fixed'));

  const guidelines = readFileSync('docs/GUIDELINES.md', 'utf-8');
  check('GUIDELINES no longer offers responsive: "fixed"', !/responsive:\s*"fixed"/.test(guidelines));
  const indexSrc = readFileSync('src/index.ts', 'utf-8');
  check('the batch_design docstring no longer offers it', !/responsive:\s*"fixed"/.test(indexSrc));
}

// ── 2. a design taller than its artboard can be captured whole ───────────────
{
  // Artboard 600 tall, content well past it — the shape that used to be cut off.
  const c = createCanvas('tall');
  parseAndExecute(c.root, `
U("document", {width:800, height:600, layout:"vertical", gap:0, fill:"#FFFFFF"})
a=I("document", {type:"frame", width:"100%", height:500, fill:"#E2E8F0"})
b=I("document", {type:"frame", width:"100%", height:500, fill:"#CBD5E1"})
c=I("document", {type:"frame", width:"100%", height:500, fill:"#94A3B8"})
`, c);
  const cv = getCanvas(c.id)!;
  const html = renderToHtml(cv.root, 800, 600, cv);

  const viewport = Buffer.from(await takeScreenshot(html, { width: 800, height: 600, scale: 1 }), 'base64');
  const whole = Buffer.from(await takeScreenshot(html, { width: 800, height: 600, scale: 1, fullPage: true }), 'base64');

  // PNG dimensions live in the IHDR chunk: width at byte 16, height at 20.
  const dims = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
  const v = dims(viewport);
  const f = dims(whole);

  check('the default capture is still exactly the artboard', v.w === 800 && v.h === 600, `${v.w}x${v.h}`);
  check('fullPage captures past the artboard to the real content height', f.h > v.h, `${f.w}x${f.h} vs ${v.w}x${v.h}`);
  check('fullPage reaches all 1500px of content', f.h >= 1500, `${f.h}px tall`);
  check('width is unaffected either way', f.w === v.w);

  // The order above is the one that matters and is deliberately not rearranged:
  // a viewport capture runs FIRST, then a full one, through the same singleton
  // browser. Puppeteer's own `fullPage` silently degrades to viewport-sized
  // output in exactly that sequence, which is every real session — so a repeat
  // call has to keep working too, not just the first one on a fresh browser.
  const again = Buffer.from(await takeScreenshot(html, { width: 800, height: 600, scale: 1, fullPage: true }), 'base64');
  const a = dims(again);
  check('a repeat full capture through the same browser still works', a.h >= 1500, `${a.w}x${a.h}`);
}

// ── 3. export captures the whole design too ──────────────────────────────────
{
  // `fullPage` shipped on `screenshot` and not on `export`, so saving a design
  // taller than its artboard still meant passing the height by hand. Both now
  // share one helper; this pins that they agree.
  const c = createCanvas('tall-export');
  parseAndExecute(c.root, `
U("document", {width:800, height:600, layout:"vertical", gap:0, fill:"#FFFFFF"})
a=I("document", {type:"frame", width:"100%", height:500, fill:"#E2E8F0"})
b=I("document", {type:"frame", width:"100%", height:500, fill:"#CBD5E1"})
c=I("document", {type:"frame", width:"100%", height:500, fill:"#94A3B8"})
`, c);
  const cv = getCanvas(c.id)!;
  const html = renderToHtml(cv.root, 800, 600, cv);
  const dir = mkdtempSync(join(tmpdir(), 'framesmith-export-'));

  const viewportPath = await exportToFile(html, { width: 800, height: 600, scale: 1, format: 'png', outputPath: dir, fileName: 'viewport' });
  const wholePath = await exportToFile(html, { width: 800, height: 600, scale: 1, format: 'png', outputPath: dir, fileName: 'whole', fullPage: true });

  const dims = (p: string) => { const b = readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  const v = dims(viewportPath);
  const f = dims(wholePath);
  check('export default is still exactly the artboard', v.w === 800 && v.h === 600, `${v.w}x${v.h}`);
  check('export fullPage reaches all 1500px of content', f.h >= 1500, `${f.w}x${f.h}`);
  check('export width is unaffected either way', f.w === v.w);
}

console.log(allPass ? '\nAll render-capture tests passed.' : '\nSOME TESTS FAILED');
await shutdown();
process.exit(allPass ? 0 : 1);
