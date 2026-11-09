// Phase 27 slice C — the usability layer: hit-target floor (WCAG 2.5.8,
// gated as error), label association, vague action copy, and focus-visible
// rendering. The raised archetypes must produce ZERO usability findings —
// the library ships the practices it preaches.
//
// Usage: npx tsx test-usability.ts

import './test-env.js';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { applyStructure } from './src/structures.js';
import { evaluateCanvas } from './src/evaluate.js';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { takeScreenshot, shutdown } from './src/screenshot.js';
import type { Canvas } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

async function usability(c: Canvas, mode: 'fast' | 'detailed' = 'fast') {
  const r = await evaluateCanvas(c, { mode, categories: ['usability'] });
  return r.issues;
}

// ── hit-target floor ────────────────────────────────────────────────────────
{
  console.log('── hit target ──');
  const small = createCanvas('small');
  parseAndExecute(small.root, `
row=I("document", { type: "frame", layout: "horizontal" })
I(row, { type: "text", content: "Enable" })
I(row, { type: "checkbox", width: 20, height: 20, checked: true })
`, small);
  const i1 = await usability(small);
  // Phase 31 FR-A4 — fast mode cannot measure spacing, so it warns and names
  // detailed mode; detailed mode applies the WCAG 2.5.8 spacing exception.
  check('20px checkbox in an unpadded row → one fast-mode warning naming detailed mode', i1.length === 1 && i1[0].severity === 'warning' && i1[0].message.includes('24px floor') && /detailed/.test(i1[0].suggestion ?? ''), JSON.stringify(i1.map((x) => x.message)));
  const i1d = await usability(small, 'detailed');
  check('…and in detailed mode it passes by the spacing exception when its label is outside its 24px circle', i1d.length === 0 || i1d.every((x) => !x.message.includes('24px floor')), JSON.stringify(i1d.map((x) => x.message)));

  const padded = createCanvas('padded');
  parseAndExecute(padded.root, `
row=I("document", { type: "frame", layout: "horizontal", padding: [8, 16] })
I(row, { type: "text", content: "Enable" })
I(row, { type: "checkbox", width: 20, height: 20 })
`, padded);
  const i2 = await usability(padded);
  check('same checkbox in a padded row → clean (the row is the target)', i2.length === 0, JSON.stringify(i2.map((x) => x.message)));

  const dflt = createCanvas('default-toggle');
  parseAndExecute(dflt.root, `
row=I("document", { type: "frame", layout: "horizontal" })
I(row, { type: "text", content: "Enable" })
I(row, { type: "toggle", checked: true })
`, dflt);
  const i3 = await usability(dflt);
  check('default toggle (44×24) → clean', i3.length === 0, JSON.stringify(i3.map((x) => x.message)));

  // two controls in one padded row: neither inherits the row's box
  const two = createCanvas('two-controls');
  parseAndExecute(two.root, `
row=I("document", { type: "frame", layout: "horizontal", padding: [8, 16] })
I(row, { type: "text", content: "Pair" })
I(row, { type: "checkbox", width: 18, height: 18 })
I(row, { type: "checkbox", width: 18, height: 18 })
`, two);
  const i4 = await usability(two);
  check('two small controls sharing a row → both warn in fast mode', i4.filter((x) => x.severity === 'warning' && x.message.includes('24px floor')).length === 2, JSON.stringify(i4.map((x) => `${x.severity}: ${x.message.slice(0, 80)}`)));
  const i4d = await usability(two, 'detailed');
  check('…and both error in detailed mode (touching 18px boxes: each circle reaches the other)', i4d.filter((x) => x.severity === 'error' && x.message.includes('24px circle')).length === 2, JSON.stringify(i4d.map((x) => `${x.severity}: ${x.message.slice(0, 80)}`)));

  // touch-first advisory on a phone-width artboard
  const phone = createCanvas('phone');
  phone.root.width = 390;
  parseAndExecute(phone.root, `
row=I("document", { type: "frame", layout: "horizontal", padding: [4, 8] })
I(row, { type: "text", content: "Enable" })
I(row, { type: "checkbox", width: 24, height: 24 })
`, phone);
  const i5 = await usability(phone);
  check('24px control on a 390px artboard → touch-first info', i5.length === 1 && i5[0].severity === 'info' && i5[0].message.includes('44px'), JSON.stringify(i5.map((x) => `${x.severity}: ${x.message.slice(0, 60)}`)));
}

// ── label association ───────────────────────────────────────────────────────
{
  console.log('── label association ──');
  const bare = createCanvas('bare');
  parseAndExecute(bare.root, `
wrap=I("document", { type: "frame", layout: "vertical" })
box=I(wrap, { type: "frame", layout: "horizontal", padding: 16 })
I(box, { type: "toggle" })
`, bare);
  const i1 = await usability(bare);
  const labels = i1.filter((x) => x.message.includes('no text label'));
  check('unlabeled toggle → one warning', labels.length === 1 && labels[0].severity === 'warning', JSON.stringify(i1.map((x) => x.message)));

  const above = createCanvas('label-above');
  parseAndExecute(above.root, `
group=I("document", { type: "frame", layout: "vertical", padding: 16 })
I(group, { type: "text", content: "Notifications" })
box=I(group, { type: "frame", layout: "horizontal" })
I(box, { type: "toggle" })
`, above);
  const i2 = await usability(above);
  check('label-above form → clean', i2.filter((x) => x.message.includes('label')).length === 0, JSON.stringify(i2.map((x) => x.message)));

  const sel = createCanvas('select');
  parseAndExecute(sel.root, `
box=I("document", { type: "frame", layout: "horizontal", padding: 16 })
I(box, { type: "select", value: "Option A" })
`, sel);
  const i3 = await usability(sel);
  check('select carries its own text → exempt from label check', i3.filter((x) => x.message.includes('label')).length === 0);
}

// ── vague action copy ───────────────────────────────────────────────────────
{
  console.log('── action copy ──');
  const vague = createCanvas('vague');
  parseAndExecute(vague.root, `
btn=I("document", { type: "frame", layout: "horizontal", padding: [8, 16], fill: "#2563EB" })
I(btn, { type: "text", content: "Click here", color: "#FFFFFF" })
I("document", { type: "text", content: "Click here to continue reading the guide." })
`, vague);
  const i1 = await usability(vague);
  const copy = i1.filter((x) => x.message.includes('vague action copy'));
  check('exact "Click here" flags once; prose containing it does not', copy.length === 1 && copy[0].severity === 'info', JSON.stringify(copy.map((x) => x.message)));
}

// ── the library ships what it preaches ──────────────────────────────────────
{
  console.log('── archetypes are clean ──');
  for (const name of ['settings', 'dashboard', 'auth', 'toggle-row', 'form-field', 'data-table', 'kpi-card', 'status-chip', 'segmented-control', 'breadcrumb', 'initials-avatar']) {
    const c = createCanvas(`arch-${name}`);
    const s = applyStructure(c, name, { replace: true, targetId: name === 'toggle-row' || name === 'form-field' || name === 'data-table' ? 'document' : undefined });
    void s;
    const issues = await usability(c);
    check(`${name}: zero usability findings`, issues.length === 0, JSON.stringify(issues.map((x) => `${x.severity}: ${x.message.slice(0, 70)}`)));
  }
}

// ── focus-visible rendering (FR-C2) ─────────────────────────────────────────
{
  console.log('── focus rings ──');
  const c = createCanvas('focus');
  parseAndExecute(c.root, `
row=I("document", { type: "frame", layout: "horizontal", padding: 16, gap: 8 })
I(row, { type: "text", content: "Enable" })
I(row, { type: "toggle", checked: true })
`, c);
  const resolved = resolveVariables(c.root, c.variables);
  const html = renderToHtml(resolved, 800, 200, c);
  check('focus-visible rule in the stylesheet', html.includes('[data-focusable]:focus-visible'));
  check('controls are tabbable', html.includes('tabindex="0"') && html.includes('data-focusable'));
  check('ring color rides the CSS var', html.includes('--fs-ring:'));

  // determinism: two captures of the same canvas are byte-identical (the
  // focus machinery is CSS-only; nothing is focused in a static capture).
  const a = await takeScreenshot(html, { width: 800, height: 200, scale: 1 });
  const b = await takeScreenshot(html, { width: 800, height: 200, scale: 1 });
  check('screenshots stay byte-deterministic', a === b, `${a.length} vs ${b.length}`);
}

await shutdown();
console.log(allPass ? '\nAll usability tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
