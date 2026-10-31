import './test-env.js';
/**
 * Four defects from the 2026-09-07 mobile surface attempt. Each one silently
 * dropped or contradicted something the agent wrote:
 *
 *   1. canvas_create threw away width/height, so no phone artboard was possible.
 *   2. gap: 0 warned as off the spacing scale, though gap: null renders the same.
 *   3. A scalar chart `highlight: 5` rendered no emphasis and said nothing.
 *   4. canvas_evaluate said READY TO PRESENT while canvas_stress was FRAGILE.
 *
 * Run with: npx tsx test-silent-drops.ts
 */
import { createCanvas, getCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { evaluateCanvas } from './src/evaluate.js';
import { renderToHtml } from './src/renderer.js';
import { buildEvaluateDirective } from './src/directive.js';
import { lastStressRun, recordStressRun } from './src/stress.js';
import type { EvaluationResult } from './src/evaluate.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── 1. canvas_create honours width/height ────────────────────────────────────
{
  const phone = createCanvas('phone', undefined, { width: 390, height: 844 });
  const readBack = getCanvas(phone.id)!;
  check('a 390×844 canvas reads back 390×844', readBack.root.width === 390 && readBack.root.height === 844,
    `${readBack.root.width}×${readBack.root.height}`);

  const wide = createCanvas('default');
  check('omitted size keeps the 1440×900 default', wide.root.width === 1440 && wide.root.height === 900);

  const tall = createCanvas('width only', undefined, { width: 390 });
  check('an omitted height keeps its default', tall.root.width === 390 && tall.root.height === 900);
}

// ── 2. gap: 0 is on-scale ────────────────────────────────────────────────────
{
  const canvas = createCanvas('flush');
  parseAndExecute(canvas.root, `
list=I("document", {type:"frame", width:390, layout:"vertical", gap:0})
odd=I("document", {type:"frame", width:390, layout:"vertical", gap:5})`, canvas);
  canvas.variables = { spacing: { sm: 4, md: 8, lg: 16 } } as never;
  const r = await evaluateCanvas(canvas, { mode: 'fast', categories: ['spacing'] });
  const gapIssues = r.issues.filter((i) => /^gap:/.test(i.message));
  check('gap: 0 raises no spacing issue', !gapIssues.some((i) => /gap: 0px/.test(i.message)),
    gapIssues.map((i) => i.message).join('; '));
  check('gap: 5 still warns', gapIssues.some((i) => /gap: 5px/.test(i.message)));
}

// ── 3. scalar chart highlight ────────────────────────────────────────────────
{
  const chart = (highlight: unknown) => {
    const canvas = createCanvas('chart');
    parseAndExecute(canvas.root, `c=I("document", {type:"chart", kind:"bar", width:400, height:200, series:[{data:[1,2,3,4,5,6,7], highlight:${JSON.stringify(highlight)}}]})`, canvas);
    return { canvas, html: renderToHtml(canvas.root, 400, 200, canvas) };
  };
  const scalar = chart(5);
  const array = chart([5]);
  const none = chart([]);
  check('highlight: 5 renders the same chart as highlight: [5]', strip(scalar.html) === strip(array.html));
  check('...and differs from no emphasis', strip(scalar.html) !== strip(none.html));

  const canvas = createCanvas('bad highlight');
  const [bad] = parseAndExecute(canvas.root, `c=I("document", {type:"chart", kind:"bar", series:[{data:[1,2,3], highlight:"5"}]})`, canvas);
  check('highlight: "5" succeeds with a warning', bad.ok && /series\[0\]\.highlight/.test(bad.warning ?? ''), bad.warning);
  const [badEntry] = parseAndExecute(canvas.root, `U("${bad.nodeId}", {series:[{data:[1,2,3], highlight:[1, "2"]}]})`, canvas);
  check('an array with a non-number entry warns too', /series\[0\]\.highlight/.test(badEntry.warning ?? ''), badEntry.warning);
  const [good] = parseAndExecute(canvas.root, `U("${bad.nodeId}", {series:[{data:[1,2,3], highlight:2}]})`, canvas);
  check('a valid scalar highlight carries no warning', good.ok && !good.warning, good.warning);
}

// ── 4. evaluate knows the last stress verdict ────────────────────────────────
{
  const fake = (issues: Array<{ category: string; severity: string }> = []): EvaluationResult =>
    ({ overallScore: 99, categories: [], issues, stats: {}, mode: 'fast' } as unknown as EvaluationResult);

  const fragileNow = buildEvaluateDirective(fake(), 0, { warnings: 19, current: true });
  check('FRAGILE stress on this version → NOT READY', !fragileNow.ready && /^NOT READY/.test(fragileNow.directive),
    fragileNow.directive.slice(0, 120));
  check('...and the directive names the stress breaks', /19 layout break/.test(fragileNow.directive));

  const withIssues = buildEvaluateDirective(fake([{ category: 'spacing', severity: 'warning' }]), 0, { warnings: 3, current: true });
  check('blocking issues + FRAGILE stress → both named', !withIssues.ready && /1 issue/.test(withIssues.directive) && /3 layout break/.test(withIssues.directive));

  const stale = buildEvaluateDirective(fake(), 0, { warnings: 4, current: false });
  check('FRAGILE on an earlier version → readiness unchanged', stale.ready);
  check('...but the directive says to re-run canvas_stress', /re-run canvas_stress/.test(stale.directive));

  const clean = buildEvaluateDirective(fake(), 0, { warnings: 0, current: true });
  const noRun = buildEvaluateDirective(fake());
  check('CLEAN stress → same directive as no stress run', clean.ready && clean.directive === noRun.directive);

  recordStressRun('c1', { versionHash: 'sha256r:a', warnings: 2 });
  recordStressRun('c1', { versionHash: 'sha256r:b', warnings: 0 });
  check('the last stress run per canvas wins', lastStressRun('c1')?.versionHash === 'sha256r:b' && lastStressRun('c1')?.warnings === 0);
  check('no run recorded → undefined', lastStressRun('never') === undefined);
}

/** Node ids are random per canvas; compare the markup without them. */
function strip(html: string): string {
  return html.replace(/data-node-id="[^"]*"/g, '').replace(/id="[^"]*"/g, '');
}

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
