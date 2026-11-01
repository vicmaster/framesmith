// Phase 24 slice D — stress through a real render: a rigid fixture must break
// under perturbation, a fluid fixture must stay clean. Chrome required.
//
// Usage: npx tsx test-stress-render.ts

import './test-env.js';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { resolveVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { computeLayout, shutdown } from './src/screenshot.js';
import { applyPerturbation, compareLayouts, type PerturbationName } from './src/stress.js';
import type { Canvas } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const W = 800;
const H = 600;

async function stress(canvas: Canvas, name: PerturbationName) {
  const baselineHtml = renderToHtml(resolveVariables(structuredClone(canvas.root), {}), W, H, canvas);
  const baseline = await computeLayout(baselineHtml, undefined, 25, { width: W, height: H });
  const { root, touched } = applyPerturbation(name, canvas.root);
  if (touched.length === 0) return { findings: [], skipped: true };
  const html = renderToHtml(resolveVariables(structuredClone(root), {}), W, H, canvas);
  const layout = await computeLayout(html, undefined, 25, { width: W, height: H });
  return { findings: compareLayouts(baseline, layout, touched, W), skipped: false };
}

try {
  // RIGID: fixed height + overflow hidden → long text must clip.
  const rigid = createCanvas('stress-rigid');
  rigid.root.width = W; rigid.root.height = H;
  parseAndExecute(rigid.root, `
card=I("document", { type: "frame", width: 320, height: 44, overflow: "hidden", padding: 12 })
I(card, { type: "text", content: "Customer display name", fontSize: 14 })
`, rigid);
  const r1 = await stress(rigid, 'long-text');
  check('rigid fixture: long-text → clip warning', !r1.skipped && r1.findings.some((f) => f.kind === 'clip' && f.severity === 'warning'), JSON.stringify(r1.findings));

  // RIGID numbers: a tight fixed-width badge must break under 999+.
  const badge = createCanvas('stress-badge');
  badge.root.width = W; badge.root.height = H;
  parseAndExecute(badge.root, `
row=I("document", { type: "frame", layout: "horizontal", width: 200, gap: 8 })
I(row, { type: "text", content: "Inbox", fontSize: 14 })
b=I(row, { type: "frame", width: 22, height: 18, cornerRadius: 9, fill: "#111827", alignItems: "center", justifyContent: "center", overflow: "hidden" })
I(b, { type: "text", content: "9", fontSize: 11, color: "#FFFFFF" })
`, badge);
  const r2 = await stress(badge, 'big-numbers');
  check('badge fixture: big-numbers → breakage', !r2.skipped && r2.findings.some((f) => f.severity === 'warning'), JSON.stringify(r2.findings));

  // FLUID: fit-content height, fluid width, wrapping allowed → clean under everything.
  const fluid = createCanvas('stress-fluid');
  fluid.root.width = W; fluid.root.height = H;
  parseAndExecute(fluid.root, `
card=I("document", { type: "frame", width: "100%", layout: "vertical", gap: 8, padding: 16 })
I(card, { type: "text", content: "Customer display name", fontSize: 14 })
I(card, { type: "text", content: "$1.52M", fontSize: 20, fontWeight: 600 })
`, fluid);
  for (const name of ['long-text', 'i18n', 'big-numbers'] as PerturbationName[]) {
    const r = await stress(fluid, name);
    check(`fluid fixture: ${name} → clean`, !r.skipped && r.findings.filter((f) => f.severity === 'warning').length === 0, JSON.stringify(r.findings));
  }

  // TABLE: empty/many render without breakage on a fluid table.
  const tbl = createCanvas('stress-table');
  tbl.root.width = W; tbl.root.height = H;
  parseAndExecute(tbl.root, `
t=I("document", { type: "frame", layout: "vertical", width: "100%", gap: 0 })
h=I(t, { type: "frame", layout: "horizontal", gap: 16, padding: 8 })
h1=I(h, { type: "frame", width: "60%" })
I(h1, { type: "text", content: "NAME" })
h2=I(h, { type: "frame", width: "40%" })
I(h2, { type: "text", content: "STATUS" })
r1=I(t, { type: "frame", layout: "horizontal", gap: 16, padding: 8 })
c1=I(r1, { type: "frame", width: "60%" })
I(c1, { type: "text", content: "Live stream" })
c2=I(r1, { type: "frame", width: "40%" })
I(c2, { type: "text", content: "active" })
r2=I(t, { type: "frame", layout: "horizontal", gap: 16, padding: 8 })
c3=I(r2, { type: "frame", width: "60%" })
I(c3, { type: "text", content: "VOD library" })
c4=I(r2, { type: "frame", width: "40%" })
I(c4, { type: "text", content: "paused" })
`, tbl);
  const rEmpty = await stress(tbl, 'empty');
  check('table fixture: empty perturbation renders clean', !rEmpty.skipped && rEmpty.findings.filter((f) => f.severity === 'warning').length === 0, JSON.stringify(rEmpty.findings));
  const rMany = await stress(tbl, 'many');
  check('table fixture: many perturbation renders clean', !rMany.skipped && rMany.findings.filter((f) => f.severity === 'warning').length === 0, JSON.stringify(rMany.findings));
  // Phase 30 slice D verify round — 25 truncating rows must not use up the
  // finding cap before the real clip below them.
  {
    const PW = 390;
    const PH = 844;
    const rowsCanvas = createCanvas('stress-cap', undefined, {}, { type: 'mobile' });
    parseAndExecute(rowsCanvas.root, `l=I("document", { type: "frame", layout: "vertical" })
${Array.from({ length: 25 }, (_, i) => `I(l, { type: "list-row", title: "Morning run ${i}" })`).join('\n')}
b=I("document", { type: "frame", width: 300, height: 20, overflow: "hidden" })
I(b, { type: "text", content: "Morning run summary" })`, rowsCanvas);
    const base = await computeLayout(renderToHtml(resolveVariables(structuredClone(rowsCanvas.root), {}), PW, PH, rowsCanvas), undefined, 25, { width: PW, height: PH });
    const { root, touched } = applyPerturbation('long-text', rowsCanvas.root, { type: 'mobile' });
    const pert = await computeLayout(renderToHtml(resolveVariables(structuredClone(root), {}), PW, PH, rowsCanvas), undefined, 25, { width: PW, height: PH });
    const findings = compareLayouts(base, pert, touched, PW);
    check('25 truncating rows + a real clip → the clip warning survives the cap', findings.some((f) => f.severity === 'warning' && f.kind === 'clip'), JSON.stringify(findings.map((f) => `${f.severity} ${f.kind}`)));
  }

  // Phase 30 slice D — primitives under stress at phone width: a five-tab bar
  // under i18n truncates its labels by design (info, never a warning); a
  // list-row survives long-text with designed truncation only; a sheet's
  // tripled rows scroll inside the panel instead of clipping.
  {
    const PW = 390;
    const PH = 844;
    const phoneStress = async (canvas: Canvas, name: PerturbationName) => {
      const base = await computeLayout(renderToHtml(resolveVariables(structuredClone(canvas.root), {}), PW, PH, canvas), undefined, 25, { width: PW, height: PH });
      const { root, touched } = applyPerturbation(name, canvas.root, { type: 'mobile' });
      const pert = await computeLayout(renderToHtml(resolveVariables(structuredClone(root), {}), PW, PH, canvas), undefined, 25, { width: PW, height: PH });
      return { findings: compareLayouts(base, pert, touched, PW), touched };
    };
    const tabs = createCanvas('stress-tabs', undefined, {}, { type: 'mobile' });
    parseAndExecute(tabs.root, `I("document", { type: "tab-bar", items: [{ icon: "inbox", label: "Messages" }, { icon: "settings", label: "Settings" }, { icon: "activity", label: "Activity" }, { icon: "library", label: "Library" }, { icon: "user", label: "Account" }] })`, tabs);
    const t = await phoneStress(tabs, 'i18n');
    check('five-tab bar under i18n: truncation infos only, no warnings', t.findings.length > 0 && t.findings.every((f) => f.severity === 'info') && t.findings.some((f) => f.detail.includes('designed ellipsis')), JSON.stringify(t.findings));
    const lt = await phoneStress(tabs, 'long-text');
    check('…long-text leaves the tab labels alone on mobile', lt.touched.length === 0, JSON.stringify(lt.touched));

    const list = createCanvas('stress-rows', undefined, {}, { type: 'mobile' });
    parseAndExecute(list.root, `l=I("document", { type: "frame", layout: "vertical" })
I(l, { type: "list-row", title: "Morning run", subtitle: "5.2 mi", trailing: { text: "Today" } })
I(l, { type: "list-row", title: "Evening ride", trailing: { chevron: true } })`, list);
    const lr = await phoneStress(list, 'long-text');
    check('list-row under long-text: designed truncation only', lr.findings.length > 0 && lr.findings.every((f) => f.severity === 'info'), JSON.stringify(lr.findings));

    const sheet = createCanvas('stress-sheet', undefined, {}, { type: 'mobile' });
    parseAndExecute(sheet.root, `sh=I("document", { type: "sheet", detent: "medium" })
${Array.from({ length: 6 }, (_, i) => `I(sh, { type: "list-row", title: "Option ${i}" })`).join('\n')}`, sheet);
    const sm = await phoneStress(sheet, 'many');
    check('a sheet\'s tripled rows scroll inside the panel, no clip', !sm.findings.some((f) => f.kind === 'clip' && f.severity === 'warning'), JSON.stringify(sm.findings));
  }
} finally {
  await shutdown();
}

console.log(allPass ? '\nAll stress-render tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
