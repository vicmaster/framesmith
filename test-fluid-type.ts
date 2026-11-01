import './test-env.js';
// Phase 30 slice G — large type is fluid against the artboard it was authored
// on (the root's own width), not a fixed 1440. On a 390 phone artboard a 33px
// $title used to render at 20px, under the 21px card title, and a 27px
// $heading at 16px, under the 17px body. Padding keeps its 1440 reference
// (the mobile rules model it, slice C). Markup only; no Chrome needed.
//
// Usage: npx tsx test-fluid-type.ts

import { renderToHtml } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const doc = (width: number | string | undefined, children: SceneNode[]): SceneNode =>
  ({ id: 'doc', type: 'document', ...(width === undefined ? {} : { width }), children } as SceneNode);
const text = (id: string, fontSize: number | string): SceneNode => ({ id, type: 'text', content: id, fontSize });
const fontOf = (html: string, id: string) => html.match(new RegExp(`data-node-id="${id}"[^>]*style="[^"]*font-size: ([^;"]+)`))?.[1];

/** The px a fluid clamp(min, Nvw, max) renders at on a viewport. */
function at(css: string | undefined, viewport: number): number | undefined {
  const m = css?.match(/^clamp\((\d+)px, ([\d.]+)vw, (\d+)px\)$/);
  if (!m) return css?.endsWith('px') ? parseFloat(css) : undefined;
  return Math.min(+m[3], Math.max(+m[1], (+m[2] / 100) * viewport));
}

// A phone artboard: authored sizes render as authored at its own width.
{
  const html = renderToHtml(doc(390, [text('title', 33), text('heading', 27), text('lg', 21), text('body', 17)]), 390, 844);
  const px = ['title', 'heading', 'lg', 'body'].map((id) => at(fontOf(html, id), 390));
  check('390 artboard: the 33px title renders 33px at 390', Math.abs(px[0]! - 33) < 0.05, fontOf(html, 'title'));
  check('390 artboard: the 27px heading renders 27px at 390', Math.abs(px[1]! - 27) < 0.05, fontOf(html, 'heading'));
  check('390 artboard: hierarchy holds — title > heading > lg > body', px[0]! > px[1]! && px[1]! > px[2]! && px[2]! > px[3]!, px.join(' > '));
  check('390 artboard: fluid still shrinks on a narrower viewport', at(fontOf(html, 'title'), 320)! < 33);
  check('390 artboard: never grows past authored on a wider viewport', at(fontOf(html, 'title'), 1440) === 33);
}

// The 1440 default is unchanged, including under a narrow responsive render.
{
  const root = doc(1440, [text('h', 64), text('s', 32)]);
  const desktop = renderToHtml(root, 1440, 900);
  check('1440 artboard: 64 keeps clamp(38px, 4.44vw, 64px)', fontOf(desktop, 'h') === 'clamp(38px, 4.44vw, 64px)', fontOf(desktop, 'h'));
  check('1440 artboard: 32 keeps clamp(19px, 2.22vw, 32px)', fontOf(desktop, 's') === 'clamp(19px, 2.22vw, 32px)', fontOf(desktop, 's'));
  const phone = renderToHtml(root, 390, 844);
  check('a breakpoint render reads the root width, not the viewport', fontOf(phone, 'h') === fontOf(desktop, 'h'), fontOf(phone, 'h'));
}

// No numeric root width → the 1440 reference.
for (const w of [undefined, '100%', 0, -5]) {
  const html = renderToHtml(doc(w, [text('h', 64)]), 1440, 900);
  check(`root width ${JSON.stringify(w)}: falls back to 1440`, fontOf(html, 'h') === 'clamp(38px, 4.44vw, 64px)', fontOf(html, 'h'));
}

// Another web width: authored at its own width.
{
  const html = renderToHtml(doc(1280, [text('h', 32)]), 1280, 800);
  check('1280 artboard: 32 renders 32 at 1280', fontOf(html, 'h') === 'clamp(19px, 2.50vw, 32px)', fontOf(html, 'h'));
}

// Below the threshold and string sizes are untouched.
{
  const html = renderToHtml(doc(390, [text('small', 23), text('edge', 24), text('str', 'clamp(1rem, 0.9rem + 0.5vw, 1.25rem)')]), 390, 844);
  check('23px stays static', fontOf(html, 'small') === '23px', fontOf(html, 'small'));
  check('24px is the first fluid size', fontOf(html, 'edge') === 'clamp(16px, 6.15vw, 24px)', fontOf(html, 'edge'));
  check('a CSS length string passes through', fontOf(html, 'str') === 'clamp(1rem, 0.9rem + 0.5vw, 1.25rem)', fontOf(html, 'str'));
}

// Padding keeps its 1440 reference on a phone (slice C's mobile rules model it).
{
  const html = renderToHtml(doc(390, [{ id: 'pad', type: 'frame', padding: 48, children: [] } as SceneNode]), 390, 844);
  check('padding 48 on a 390 artboard keeps clamp(12px, 3.33vw, 48px)', html.includes('padding: clamp(12px, 3.33vw, 48px)'));
}

console.log(allPass ? '\nAll fluid-type tests passed.' : '\nSome fluid-type tests FAILED.');
process.exit(allPass ? 0 : 1);
