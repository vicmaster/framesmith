// Phase 25 slice E — token-detachment lint: a literal that EQUALS a token's
// value flags (info, score-neutral) with a mechanical $ref autofix when the
// match is unique; ambiguous matches list candidates and never guess.
//
// Usage: npx tsx test/unit/test-token-lint.ts

import '../env.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const detachments = (r: Awaited<ReturnType<typeof evaluateCanvas>>) =>
  r.issues.filter((i) => i.message.includes('detached literals drift'));

// ── unique match → autofix; case-insensitive; radius too ────────────────────
{
  const c = createCanvas('Detached');
  c.variables = { colors: { surface: '#F8FAFC', ink: '#111827' }, radius: { md: 12 } };
  parseAndExecute(c.root, `
card=I("document", { type: "frame", layout: "vertical", gap: 8, fill: "#f8fafc", cornerRadius: 12, padding: 24 })
I(card, { type: "text", content: "Attached", color: "$ink" })
I(card, { type: "text", content: "Fine literal", color: "#334155" })
`, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['consistency'] });
  const d = detachments(r);
  check('one finding per node (fill wins over radius on the same node)', d.length === 1, JSON.stringify(d.map((i) => i.message)));
  check('case-insensitive match + $ref autofix', d[0].fix?.op.includes('fill: "$surface"') === true, d[0].fix?.op);
  check('info severity, score-neutral', d[0].severity === 'info' && (r.categories.find((x) => x.name === 'consistency')?.score ?? 0) === 100);
  check('non-matching literal not flagged', !r.issues.some((i) => i.message.includes('#334155')));

  // Apply the fix — the lint goes quiet.
  parseAndExecute(c.root, d[0].fix!.op, c);
  const r2 = await evaluateCanvas(c, { mode: 'fast', categories: ['consistency'] });
  const d2 = detachments(r2);
  check('after re-attach: radius detachment surfaces next', d2.length === 1 && d2[0].fix?.op.includes('cornerRadius: "$md"') === true, JSON.stringify(d2));
}

// ── ambiguous match → candidates, NO fix ────────────────────────────────────
{
  const c = createCanvas('Ambiguous');
  c.variables = { colors: { surface: '#FFFFFF', 'bg-elevated': '#FFFFFF' } };
  parseAndExecute(c.root, `I("document", { type: "frame", fill: "#ffffff" })`, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['consistency'] });
  const d = detachments(r);
  check('ambiguous → both candidates listed, no fix', d.length === 1 && d[0].fix === undefined && d[0].message.includes('$surface') && d[0].message.includes('$bg-elevated'), JSON.stringify(d));
}

// ── $refs and un-tokened canvases stay silent ───────────────────────────────
{
  const c = createCanvas('Clean');
  c.variables = { colors: { surface: '#F8FAFC' } };
  parseAndExecute(c.root, `I("document", { type: "frame", fill: "$surface" })`, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['consistency'] });
  check('$ref usage never flags', detachments(r).length === 0);

  const bare = createCanvas('No Tokens');
  parseAndExecute(bare.root, `I("document", { type: "frame", fill: "#F8FAFC" })`, bare);
  const rb = await evaluateCanvas(bare, { mode: 'fast', categories: ['consistency'] });
  check('no tokens → nothing to detach from', detachments(rb).length === 0);
}

// ── cap ─────────────────────────────────────────────────────────────────────
{
  const c = createCanvas('Capped');
  c.variables = { colors: { surface: '#F8FAFC' } };
  const ops = Array.from({ length: 30 }, (_, i) => `I("document", { type: "frame", fill: "#F8FAFC", name: "f${i}" })`).join('\n');
  parseAndExecute(c.root, ops, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['consistency'] });
  check('findings capped at 20', detachments(r).length === 20, String(detachments(r).length));
}

console.log(allPass ? '\nAll token-lint tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
