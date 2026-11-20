// Phase 25 slice B — generate_scale: modular type + paired space scales from
// a ratio, with the slice-A craft defaults baked in, optional fluid clamp()
// forms, and string-fontSize pass-through in the renderer.
//
// Usage: npx tsx test/unit/test-scales.ts

import '../env.js';
import { generateTypeScale, generateSpaceScale, fluidClamp, resolveRatio, RATIOS, RATIO_NAMES } from '../../src/scales.js';
import { resolveVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import type { SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── ratio table + validation ────────────────────────────────────────────────
check('six named ratios', RATIO_NAMES.length === 6 && RATIOS['major-third'] === 1.333);
check('numeric ratio passes through', resolveRatio(1.42) === 1.42);
let err = '';
try { resolveRatio('vibes' as never); } catch (e) { err = (e as Error).message; }
check('unknown ratio names the options', err.includes('major-third'), err);
try { resolveRatio(3); } catch (e) { err = (e as Error).message; }
check('out-of-range numeric rejected', err.includes('(1, 2.2]'));

// ── static type scale ───────────────────────────────────────────────────────
{
  const scale = generateTypeScale({ ratio: 'major-third', baseSize: 16 });
  const names = Object.keys(scale);
  check('default names xs…3xl', names.join(',') === 'text-xs,text-sm,text-base,text-lg,text-xl,text-2xl,text-3xl', names.join(','));
  check('base pivots at 16', scale['text-base'].fontSize === 16);
  const sizes = names.map((n) => scale[n].fontSize as number);
  check('strictly increasing integers', sizes.every((s, i) => Number.isInteger(s) && (i === 0 || s > sizes[i - 1])), sizes.join(','));
  check('display steps carry tracking + tight leading', scale['text-3xl'].letterSpacing === -1 && scale['text-3xl'].lineHeight === 1.2, JSON.stringify(scale['text-3xl']));
  check('body steps carry reading leading, no tracking', scale['text-base'].lineHeight === 1.5 && scale['text-base'].letterSpacing === undefined);

  // Tight ratio at small sizes: rounding collisions resolved to +1.
  const tight = generateTypeScale({ ratio: 'minor-second', baseSize: 12, stepsDown: 3 });
  const tsizes = Object.values(tight).map((t) => t.fontSize as number);
  check('tight ratio stays strictly increasing', tsizes.every((s, i) => i === 0 || s > tsizes[i - 1]), tsizes.join(','));
}

// ── space scale ─────────────────────────────────────────────────────────────
{
  const space = generateSpaceScale(16);
  check('md = 1× base', space['space-md'] === 16);
  check('ladder shape', space['space-3xs'] === 2 && space['space-xs'] === 8 && space['space-2xl'] === 48 && space['space-3xl'] === 64, JSON.stringify(space));
}

// ── fluid clamp math ────────────────────────────────────────────────────────
{
  const c = fluidClamp(14, 20, 390, 1440);
  check('clamp endpoints preserved', c.startsWith('clamp(14px,') && c.endsWith('20px)'), c);
  // Evaluate the linear part at both viewports — must hit the endpoints.
  const m = c.match(/clamp\(\d+px, (-?[\d.]+)px \+ ([\d.]+)vw, \d+px\)/)!;
  const [intercept, vw] = [parseFloat(m[1]), parseFloat(m[2])];
  const at = (viewport: number) => intercept + (vw / 100) * viewport;
  check('linear hits min at minViewport', Math.abs(at(390) - 14) < 0.1, String(at(390)));
  check('linear hits max at maxViewport', Math.abs(at(1440) - 20) < 0.1, String(at(1440)));

  const fluid = generateTypeScale({ ratio: 'perfect-fourth', fluid: {} });
  check('fluid steps are clamp strings', Object.values(fluid).every((t) => typeof t.fontSize === 'string' && (t.fontSize as string).startsWith('clamp(')));
  check('fluid keeps craft defaults', fluid['text-3xl'].letterSpacing === -1);
}

// ── renderer pass-through + evaluator interplay ─────────────────────────────
{
  const canvas = createCanvas('Fluid Render');
  canvas.variables = { typography: { 'text-hero': { fontSize: 'clamp(28px, 10.4px + 4.5vw, 54px)', lineHeight: 1.2, letterSpacing: -1 } } };
  parseAndExecute(canvas.root, `I("document", { type: "text", content: "Fluid hero", fontSize: "$text-hero" })`, canvas);
  const resolved = resolveVariables(canvas.root, canvas.variables);
  check('$ref resolves the clamp + full spec', resolved.children![0].fontSize === 'clamp(28px, 10.4px + 4.5vw, 54px)' && resolved.children![0].letterSpacing === -1);
  const html = renderToHtml(resolved, 800, 600, canvas);
  check('renderer emits the clamp expression raw', html.includes('font-size: clamp(28px, 10.4px + 4.5vw, 54px)'));

  const evil = resolveVariables({ id: 'd', type: 'document', children: [{ id: 't', type: 'text', content: 'x', fontSize: 'clamp(1px)"; background: url(x)' }] } as SceneNode, {});
  const evilHtml = renderToHtml(evil, 800, 600);
  check('unsafe fontSize string dropped to 14px', evilHtml.includes('font-size: 14px') && !evilHtml.includes('url(x)'));

  // Evaluator: clamp sizes don't join the numeric ratio check, measure skips them.
  const r = await evaluateCanvas(canvas, { mode: 'fast', categories: ['typography'] });
  check('clamp sizes produce no scale/measure issues', r.issues.length === 0, JSON.stringify(r.issues));
}

// ── generated scale pins the ratio check ────────────────────────────────────
{
  const canvas = createCanvas('Pinned Scale');
  canvas.variables = { typography: generateTypeScale({ ratio: 'major-second', baseSize: 16 }) as never, spacing: generateSpaceScale(16) };
  parseAndExecute(canvas.root, `
f=I("document", { type: "frame", layout: "vertical", gap: "$space-md", padding: "$space-lg" })
I(f, { type: "text", content: "Heading", fontSize: "$text-2xl" })
I(f, { type: "text", content: "Sub", fontSize: "$text-lg" })
I(f, { type: "text", content: "Body copy", fontSize: "$text-base" })
`, canvas);
  const r = await evaluateCanvas(canvas, { mode: 'fast', categories: ['typography', 'spacing'] });
  check('generated scale evaluates clean (pinned + craft defaults)', r.issues.length === 0, JSON.stringify(r.issues));
}

console.log(allPass ? '\nAll scale tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
