import '../env.js';
/**
 * The gallery must not re-list the whole store once per card.
 *
 * `listCanvases()` version-hashes every canvas in the store on every call, so
 * it is the most expensive thing on the render path. The score badge used to
 * reach for it once per card — through `designedStatesFor` inside both
 * `evalCacheKey` and `evalFor` — which made a page render quadratic in the size
 * of the WHOLE store, not just the project being viewed. Measured on the real
 * store (178 canvases, 43 on the project): 4.2s cold and 2.2s warm for one
 * page, ~7,600 whole-canvas hashes per request. Hoisting the listing to one
 * call per render took the same page to 0.09s.
 *
 * The scaling check below is a ratio rather than a wall-clock budget so it
 * means the same thing on a slow CI runner as on a fast laptop. Quadratic
 * growth over a 4x larger store is ~16x; linear is ~4x. The bound sits at 8x —
 * clear of honest variance, nowhere near quadratic.
 *
 * Run with: npx tsx test/unit/test-viewer-perf.ts
 */
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { renderProjectPage, evalCacheKey } from '../../src/viewer.js';
import { DEFAULT_PROJECT_ID } from '../../src/types.js';
import { ensureDefaultWorkspaceAndProject } from '../../src/workspaces.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** A canvas with enough substance that scoring and hashing both do real work. */
function seed(n: number): void {
  for (let i = 0; i < n; i++) {
    const c = createCanvas(`Screen ${i}`);
    parseAndExecute(c.root, `
U("document", {width:1440, height:900, layout:"vertical", gap:24, padding:32, fill:"#FFFFFF"})
h=I("document", {type:"frame", width:"100%", layout:"horizontal", gap:16, alignItems:"center"})
I(h, {type:"text", content:"Section ${i}", fontSize:24, fontWeight:600, color:"#0F172A"})
b=I("document", {type:"frame", width:"100%", layout:"vertical", gap:12, padding:24, fill:"#F8FAFC", cornerRadius:12})
I(b, {type:"text", content:"Supporting copy for screen ${i}.", fontSize:16, color:"#334155"})
I(b, {type:"text", content:"A second line of body copy.", fontSize:16, color:"#334155"})
`, c);
  }
}

async function timeRender(): Promise<number> {
  const t = Date.now();
  const html = await renderProjectPage(DEFAULT_PROJECT_ID, 3001);
  if (!html) throw new Error('project page did not render');
  return Date.now() - t;
}

/** Median of several renders — one sample at these speeds is mostly noise. */
async function medianRender(runs = 5): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await timeRender());
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

// ── the shape: render cost grows with the store, but not quadratically ───────
ensureDefaultWorkspaceAndProject();
seed(40);
await timeRender();                       // warm the score cache + JIT
const small = Math.max(await medianRender(), 1);

seed(120);                                // 4x the store
await timeRender();                       // warm again — we are measuring shape
const large = await medianRender();

const ratio = large / small;
check('a 4x larger store does not cost ~16x to render',
  ratio < 8, `40 canvases ${small}ms → 160 canvases ${large}ms (${ratio.toFixed(1)}x)`);

// ── the threading that made it possible stays correct ────────────────────────
{
  const c = createCanvas('Key check');
  parseAndExecute(c.root, `I("document", {type:"text", content:"Hello", fontSize:16, color:"#0F172A"})`, c);

  // Callers that pass the states they already have must agree with callers that
  // let the function look them up — otherwise the gallery and the detail page
  // would key the same canvas differently and never share a cache entry.
  check('an explicit empty state list matches the looked-up form',
    evalCacheKey(c, []) === evalCacheKey(c));

  // And the states still have to participate: a canvas that gains a designed
  // state must not keep serving the score it had before.
  check('different designed states → different key',
    evalCacheKey(c, ['empty']) !== evalCacheKey(c, []));
  check('state order does not matter',
    evalCacheKey(c, ['empty', 'loading']) === evalCacheKey(c, ['loading', 'empty']));
}

console.log(allPass ? '\nAll viewer-perf tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
