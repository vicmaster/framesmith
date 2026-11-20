import '../env.js';
/**
 * Phase 29 slice D (#194) — advisory honesty.
 *
 * Three advisories cost real time on the checkout attempt without pointing at a
 * defect, and one gate could not be satisfied by improving the design. This
 * pins the new behaviour so none of it drifts back:
 *
 *   1. The sibling-padding uniformity advisory is GONE. It fired on correct
 *      designs and relocated up and down the tree as each "fix" changed which
 *      siblings differed.
 *   2. Spacing variety is measured against the DECLARED scale. A design drawing
 *      exclusively from its own nine-step generated scale was being told to
 *      consolidate for using the system.
 *   3. The cliché eyebrow/heading thresholds read off the canvas's own type
 *      scale, so a role-based design is measured by its own proportions rather
 *      than by pixel constants that assume literal sizes.
 *   4. Readiness turns on BLOCKING findings. The old rule also demanded > 95,
 *      which stranded the attempt at "zero issues to resolve" and NOT READY.
 *
 * Run with: npx tsx test/unit/test-advisory-honesty.ts
 */
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { generateDesignSystem } from '../../src/design-language.js';
import type { Canvas } from '../../src/types.js';
import { buildEvaluateDirective } from '../../src/directive.js';
import type { EvaluationResult } from '../../src/evaluate.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}
function build(name: string, ops: string): Canvas {
  const canvas = createCanvas(name);
  parseAndExecute(canvas.root, ops, canvas);
  return canvas;
}

// ── 1. sibling padding is not a finding ──────────────────────────────────────
{
  // The exact shape a page shell has: a thin utility band, a taller header, a
  // padded main region. All three are correct and all three differ.
  const page = build('bands', `
util=I("document", {type:"frame", width:1200, padding:[8,32,8,32], fill:"#111111"})
head=I("document", {type:"frame", width:1200, padding:[16,32,16,32], fill:"#FFFFFF"})
main=I("document", {type:"frame", width:1200, padding:[32,32,32,32], fill:"#F8FAFC"})
I(main, {type:"text", content:"Section", fontSize:24, color:"#0F172A"})`);
  const r = await evaluateCanvas(page, { mode: 'fast', categories: ['consistency'] });
  const padding = r.issues.filter((i) => /padding/i.test(i.message));
  check('a page\'s structural bands produce no sibling-padding finding', padding.length === 0,
    padding.map((i) => i.message).join('; '));
  check('consistency is not penalised for it', r.categories.find((c) => c.name === 'consistency')?.score === 100);
}

// ── 2. spacing variety measures the UNDECLARED remainder ─────────────────────
{
  // Nine gaps, every one of them a step on the generated scale.
  const onScale = build('on-scale', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:2})
a=I(page, {type:"frame", width:"100%", layout:"vertical", gap:4})
b=I(page, {type:"frame", width:"100%", layout:"vertical", gap:8})
c=I(page, {type:"frame", width:"100%", layout:"vertical", gap:12})
d=I(page, {type:"frame", width:"100%", layout:"vertical", gap:16})
e=I(page, {type:"frame", width:"100%", layout:"vertical", gap:24})
f=I(page, {type:"frame", width:"100%", layout:"vertical", gap:32})
g=I(page, {type:"frame", width:"100%", layout:"vertical", gap:48})
h=I(page, {type:"frame", width:"100%", layout:"vertical", gap:64})`);
  onScale.variables = generateDesignSystem('#166534', 'soft').variables;
  const r1 = await evaluateCanvas(onScale, { mode: 'fast', categories: ['spacing'] });
  const variety1 = r1.issues.filter((i) => /spacing values/.test(i.message));
  check('nine values that are ALL on the declared scale → no sprawl advisory', variety1.length === 0,
    variety1.map((i) => i.message).join('; '));
  check('...and spacing scores full marks', r1.categories.find((c) => c.name === 'spacing')?.score === 100);

  // Seven values, none of them on the scale: that IS sprawl.
  const offScale = build('off-scale', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:3})
a=I(page, {type:"frame", width:"100%", layout:"vertical", gap:5})
b=I(page, {type:"frame", width:"100%", layout:"vertical", gap:7})
c=I(page, {type:"frame", width:"100%", layout:"vertical", gap:9})
d=I(page, {type:"frame", width:"100%", layout:"vertical", gap:11})
e=I(page, {type:"frame", width:"100%", layout:"vertical", gap:13})
f=I(page, {type:"frame", width:"100%", layout:"vertical", gap:15})`);
  offScale.variables = generateDesignSystem('#166534', 'soft').variables;
  const r2 = await evaluateCanvas(offScale, { mode: 'fast', categories: ['spacing'] });
  check('seven values NONE of which are on the scale → sprawl still reported',
    r2.issues.some((i) => /not on its declared scale/.test(i.message)),
    r2.issues.map((i) => i.message.slice(0, 60)).join('; '));
}

// ── 3. cliché thresholds follow the canvas's own type scale ──────────────────
{
  // `soft` puts heading at 25px. Under the old hard >= 28 constant these three
  // section heads were invisible to the census, so the eyebrow-to-section ratio
  // collapsed and the tell fired on a design that was fine.
  const ops = `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:32, fill:"#FFFFFF"})
s1=I(page, {type:"frame", width:"100%", layout:"vertical", gap:8})
I(s1, {type:"text", content:"OVERVIEW", fontSize:11, textTransform:"uppercase", letterSpacing:0.5, color:"#5F6560"})
I(s1, {type:"text", content:"First section", fontSize:25, fontWeight:600, color:"#373C38"})
s2=I(page, {type:"frame", width:"100%", layout:"vertical", gap:8})
I(s2, {type:"text", content:"Second section", fontSize:25, fontWeight:600, color:"#373C38"})
s3=I(page, {type:"frame", width:"100%", layout:"vertical", gap:8})
I(s3, {type:"text", content:"Third section", fontSize:25, fontWeight:600, color:"#373C38"})`;
  const themed = build('themed-sections', ops);
  themed.variables = generateDesignSystem('#166534', 'soft').variables;
  const r = await evaluateCanvas(themed, { mode: 'fast', categories: ['cliche'] });
  check('25px section heads count as sections on a scale that says so',
    r.issues.filter((i) => i.tell === 'eyebrow-rhythm').length === 0,
    r.issues.filter((i) => i.tell === 'eyebrow-rhythm').map((i) => i.message.slice(0, 70)).join('; '));

  // A genuine eyebrow-above-every-section rhythm must still fire.
  const spammy = build('eyebrow-spam', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:32, fill:"#FFFFFF"})
s1=I(page, {type:"frame", width:"100%", layout:"vertical", gap:8})
I(s1, {type:"text", content:"ONE", fontSize:11, textTransform:"uppercase", letterSpacing:0.5, color:"#5F6560"})
I(s1, {type:"text", content:"First", fontSize:25, fontWeight:600, color:"#373C38"})
s2=I(page, {type:"frame", width:"100%", layout:"vertical", gap:8})
I(s2, {type:"text", content:"TWO", fontSize:11, textTransform:"uppercase", letterSpacing:0.5, color:"#5F6560"})
I(s2, {type:"text", content:"Second", fontSize:25, fontWeight:600, color:"#373C38"})
s3=I(page, {type:"frame", width:"100%", layout:"vertical", gap:8})
I(s3, {type:"text", content:"THREE", fontSize:11, textTransform:"uppercase", letterSpacing:0.5, color:"#5F6560"})
I(s3, {type:"text", content:"Third", fontSize:25, fontWeight:600, color:"#373C38"})`);
  spammy.variables = generateDesignSystem('#166534', 'soft').variables;
  const rs = await evaluateCanvas(spammy, { mode: 'fast', categories: ['cliche'] });
  check('an eyebrow above every section still flags',
    rs.issues.some((i) => i.tell === 'eyebrow-rhythm'));
}

// ── 4. the gate turns on blocking findings, not the score ────────────────────
{
  const fake = (score: number, issues: Array<{ category: string; severity: string }>): EvaluationResult =>
    ({ overallScore: score, categories: [], issues: issues as EvaluationResult['issues'], stats: {} as never, mode: 'fast' } as unknown as EvaluationResult);

  // The exact state the checkout attempt was stranded in: everything real fixed,
  // a pile of advisories, and a score just under the bar.
  const stranded = buildEvaluateDirective(fake(93, Array.from({ length: 52 }, () => ({ category: 'color', severity: 'info' }))));
  check('zero blocking + 93 → READY (was NOT READY with no way out)', stranded.ready);
  check('...and the directive still states the score', stranded.directive.includes('93/100'));
  check('...and says plainly that it is at or below the bar', /at or below the > 95 bar/.test(stranded.directive),
    stranded.directive.slice(0, 120));

  const clear = buildEvaluateDirective(fake(98, []));
  check('zero blocking + 98 → READY with no below-bar caveat',
    clear.ready && !/below the > 95 bar/.test(clear.directive));

  // One warning outranks a high score.
  const warned = buildEvaluateDirective(fake(99, [{ category: 'spacing', severity: 'warning' }]));
  check('a single warning at 99 → NOT READY', !warned.ready && warned.blocking === 1);

  // A cliché tell blocks even at info severity — slop the user notices.
  const slop = buildEvaluateDirective(fake(99, [{ category: 'cliche', severity: 'info' }]));
  check('an info-severity cliché tell still blocks', !slop.ready && slop.blocking === 1);

  // A human's note outranks the heuristics.
  const commented = buildEvaluateDirective(fake(99, []), 2);
  check('open point-and-tell feedback is appended even when ready',
    commented.ready && /feedback|comment/i.test(commented.directive), commented.directive.slice(-90));
}

console.log(allPass ? '\nAll advisory-honesty tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
