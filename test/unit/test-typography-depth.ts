// Phase 25 slice A — typography correctness + numerics: full $token
// resolution (the quirk retirement — THE behavior change of the phase),
// tabular numerals, the measure check, and the tracking nudge.
//
// Usage: npx tsx test/unit/test-typography-depth.ts

import '../env.js';
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

const TYPO = {
  heading: { fontSize: 28, fontWeight: 700, fontFamily: 'Inter', lineHeight: 1.2, letterSpacing: -0.5 },
  body: { fontSize: 14 },
};

// ── FR-A1: full typography-token resolution ─────────────────────────────────
{
  const root: SceneNode = { id: 'doc', type: 'document', children: [
    { id: 't1', type: 'text', content: 'Heading', fontSize: '$heading' as unknown as number },
    { id: 't2', type: 'text', content: 'Override', fontSize: '$heading' as unknown as number, fontWeight: 400, lineHeight: 1.6 },
    { id: 't3', type: 'text', content: 'Body', fontSize: '$body' as unknown as number },
  ] } as SceneNode;
  const r = resolveVariables(root, { typography: TYPO });
  const [t1, t2, t3] = r.children!;
  check('full spec applies through $ref', t1.fontSize === 28 && t1.fontWeight === 700 && t1.fontFamily === 'Inter' && t1.lineHeight === 1.2 && t1.letterSpacing === -0.5, JSON.stringify(t1));
  check('explicit node props win over the token', t2.fontWeight === 400 && t2.lineHeight === 1.6 && t2.fontSize === 28 && t2.fontFamily === 'Inter');
  check('sparse token fills only what it has', t3.fontSize === 14 && t3.fontWeight === undefined && t3.fontFamily === undefined);
  check('non-typography $refs unaffected', resolveVariables(
    { id: 'd', type: 'document', children: [{ id: 'f', type: 'frame', fill: '$surface' as string }] } as SceneNode,
    { colors: { surface: '#F8FAFC' } },
  ).children![0].fill === '#F8FAFC');
}

// ── FR-A2: tabular numerals render ──────────────────────────────────────────
{
  const canvas = createCanvas('Tabular Render');
  parseAndExecute(canvas.root, `
t=I("document", { type: "text", content: "1,234.56", tabularNums: true })
p=I("document", { type: "text", content: "prose" })
`, canvas);
  const html = renderToHtml(canvas.root, 800, 600, canvas);
  check('tabularNums → font-variant-numeric', (html.match(/font-variant-numeric: tabular-nums/g) ?? []).length === 1);

  const chart = createCanvas('Chart Ticks');
  parseAndExecute(chart.root, `
c=I("document", { type: "chart", kind: "line", width: 600, height: 300, series: [{ "data": [1, 2, 3] }], xLabels: ["Jan", "Feb", "Mar"], yLabels: ["0", "50", "100"] })
`, chart);
  const chartHtml = renderToHtml(chart.root, 800, 600, chart);
  check('chart tick labels default tabular', (chartHtml.match(/font-variant-numeric: tabular-nums/g) ?? []).length >= 6);
}

// ── evaluator advisories (all through evaluateCanvas, fast mode) ────────────
async function typographyIssues(canvas: ReturnType<typeof createCanvas>) {
  const r = await evaluateCanvas(canvas, { mode: 'fast', categories: ['typography'] });
  return { issues: r.issues, score: r.categories.find((c) => c.name === 'typography')?.score ?? -1 };
}

// FR-A3: measure.
{
  const long = 'A sentence about readable measures and the fatigue of long lines. '.repeat(5);
  const wide = createCanvas('Wide Prose');
  wide.root.width = 1440;
  parseAndExecute(wide.root, `I("document", { type: "text", content: ${JSON.stringify(long)}, fontSize: 14 })`, wide);
  const rw = await typographyIssues(wide);
  const mw = rw.issues.find((i) => i.message.includes('characters per line'));
  check('unconstrained prose at canvas width → measure warning', mw?.severity === 'warning', JSON.stringify(mw));
  check('measure suggestion caps maxWidth ~75ch', mw?.suggestion?.includes('525') === true, mw?.suggestion);

  const capped = createCanvas('Capped Prose');
  capped.root.width = 1440;
  parseAndExecute(capped.root, `
col=I("document", { type: "frame", width: 520, layout: "vertical" })
I(col, { type: "text", content: ${JSON.stringify(long)}, fontSize: 14 })
`, capped);
  const rc = await typographyIssues(capped);
  check('capped column → no measure issue', !rc.issues.some((i) => i.message.includes('characters per line')), JSON.stringify(rc.issues));
}

// FR-A4: tracking.
{
  const hero = createCanvas('Hero');
  parseAndExecute(hero.root, `
I("document", { type: "text", content: "Ship designs users feel", fontSize: 48 })
I("document", { type: "text", content: "OVERLINE", fontSize: 32, textTransform: "uppercase", letterSpacing: 1 })
I("document", { type: "text", content: "Tracked already", fontSize: 48, letterSpacing: -1 })
`, hero);
  const rh = await typographyIssues(hero);
  const tracking = rh.issues.filter((i) => i.message.includes('default tracking'));
  check('untracked display text → one nudge with fix', tracking.length === 1 && tracking[0].fix?.op.includes('letterSpacing: -1') === true, JSON.stringify(tracking));

  // Token-declared tracking exempts the whole scale (resolution applies it).
  const typed = createCanvas('Typed Hero');
  typed.variables = { typography: { display: { fontSize: 48, letterSpacing: -1 } } };
  parseAndExecute(typed.root, `I("document", { type: "text", content: "Typed display", fontSize: "$display" })`, typed);
  const rt = await typographyIssues(typed);
  check('token-declared tracking → no nudge', !rt.issues.some((i) => i.message.includes('default tracking')), JSON.stringify(rt.issues));
}

// FR-A2 nudge: numeric table column without tabularNums.
{
  const c = createCanvas('Numeric Table');
  parseAndExecute(c.root, `
t=I("document", { type: "frame", layout: "vertical", gap: 0 })
h=I(t, { type: "frame", layout: "horizontal", gap: 16 })
h1=I(h, { type: "frame" })
I(h1, { type: "text", content: "MONTH" })
h2=I(h, { type: "frame" })
I(h2, { type: "text", content: "REVENUE" })
r1=I(t, { type: "frame", layout: "horizontal", gap: 16 })
c1=I(r1, { type: "frame" })
I(c1, { type: "text", content: "January" })
c2=I(r1, { type: "frame" })
I(c2, { type: "text", content: "$1,204.55" })
r2=I(t, { type: "frame", layout: "horizontal", gap: 16 })
d1=I(r2, { type: "frame" })
I(d1, { type: "text", content: "February" })
d2=I(r2, { type: "frame" })
I(d2, { type: "text", content: "$980.10" })
`, c);
  const rn = await typographyIssues(c);
  const nudge = rn.issues.filter((i) => i.message.includes('proportional figures'));
  check('numeric cell w/o tabularNums → autofixable info — one per data row',
    nudge.length === 2 && nudge.every((i) => i.fix?.op.includes('tabularNums: true')), JSON.stringify(nudge));
  check('word cells not flagged', !rn.issues.some((i) => i.message.includes('"January"')));

  // The fixture above carries a header and TWO data rows on purpose. It used to
  // have one, and this check sat red from Phase 28 onward: an unnamed frame now
  // needs three same-shaped rows before it reads as a table, so a header plus a
  // single row is a layout, not data. That narrowing was deliberate — the
  // detector comment in drift.ts calls the lost header-plus-one-row table an
  // accepted trade — so the fixture moves rather than the threshold. Pinning
  // the trade here keeps it a decision instead of a silent regression.
  {
    const two = createCanvas('Two-Row Table');
    parseAndExecute(two.root, `
t=I("document", { type: "frame", layout: "vertical", gap: 0 })
h=I(t, { type: "frame", layout: "horizontal", gap: 16 })
h1=I(h, { type: "frame" })
I(h1, { type: "text", content: "MONTH" })
h2=I(h, { type: "frame" })
I(h2, { type: "text", content: "REVENUE" })
r1=I(t, { type: "frame", layout: "horizontal", gap: 16 })
c1=I(r1, { type: "frame" })
I(c1, { type: "text", content: "January" })
c2=I(r1, { type: "frame" })
I(c2, { type: "text", content: "$1,204.55" })
`, two);
    const rt2 = await typographyIssues(two);
    check('header + one row is not a table, so no numeric nudge',
      !rt2.issues.some((i) => i.message.includes('proportional figures')));
  }

  // Advisories are score-neutral: same canvas with the fix applied scores the same.
  const before = rn.score;
  parseAndExecute(c.root, rn.issues.find((i) => i.fix)!.fix!.op, c);
  const after = await typographyIssues(c);
  check('advisories are score-neutral', before === after.score, `${before} vs ${after.score}`);
}

console.log(allPass ? '\nAll typography-depth tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
