import './test-env.js';
// Phase 17 Slice A — canvas_import_html, Chrome side. Real render → walk →
// scene graph → re-render round-trip. Inline styles only (no Tailwind runtime
// in a snippet — that's spec C1; class-based CSS goes through the css param).
//
// Usage: npx tsx test-import-html.ts

import { importHtml } from './src/import.js';
import { renderToHtml } from './src/renderer.js';
import { takeScreenshot, shutdown } from './src/screenshot.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

const find = (root: SceneNode, pred: (n: SceneNode) => boolean): SceneNode | null => {
  if (pred(root)) return root;
  for (const c of root.children ?? []) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
};

const SNIPPET = `
<div style="display:flex;flex-direction:column;gap:12px;padding:24px;background-color:#111827;border:1px solid #374151;border-radius:12px;width:400px">
  <h2 style="font-size:20px;font-weight:700;color:#f9fafb;margin:0;text-transform:uppercase;letter-spacing:0.5px">Card title</h2>
  <p style="font-size:14px;color:#9ca3af;margin:0;line-height:1.5">Supporting copy for the imported card.</p>
  <div style="display:flex;flex-direction:row;align-items:center;gap:8px;margin:0">
    <input type="checkbox" checked />
    <span style="font-size:13px;color:#d1d5db">Enabled</span>
  </div>
  <select style="width:160px"><option>Viewer</option><option selected>Administrator</option></select>
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#22c55e"><path d="M20 6 9 17l-5-5"/></svg>
</div>`;

// ── 1. import the snippet ────────────────────────────────────────────────────
const { root, report, contentHeight } = await importHtml(SNIPPET, { width: 800 });

{
  const card = find(root, (n) => n.fill === 'rgb(17, 24, 39)');
  expect('card frame imported with vertical flex', card !== null && card!.layout === 'vertical' && card!.gap === 12, JSON.stringify({ layout: card?.layout, gap: card?.gap }));
  expect('padding + radius + border survive', card!.padding === 24 && card!.cornerRadius === 12 && card!.strokeWidth === 1, JSON.stringify({ p: card!.padding, r: card!.cornerRadius, sw: card!.strokeWidth }));

  const title = find(root, (n) => n.type === 'text' && /card title/i.test(String(n.content)));
  expect('heading → text node with computed props', title !== null && title!.fontSize === 20 && title!.fontWeight === 700 && title!.textTransform === 'uppercase' && title!.letterSpacing === 0.5, JSON.stringify(title));

  const body = find(root, (n) => n.type === 'text' && /supporting copy/i.test(String(n.content)));
  expect('body text imported with line-height', body !== null && body!.fontSize === 14 && body!.lineHeight === '21px', `lh=${body?.lineHeight}`);

  const checkbox = find(root, (n) => n.type === 'checkbox');
  expect('checkbox imported with live checked state', checkbox !== null && checkbox!.checked === true);

  const select = find(root, (n) => n.type === 'select');
  expect('select imported with the SELECTED option', select !== null && select!.value === 'Administrator');

  const icon = find(root, (n) => n.type === 'icon');
  expect('inline check svg recognized as the lucide icon', icon !== null && icon!.icon === 'check' && icon!.iconColor === 'rgb(34, 197, 94)', JSON.stringify(icon));

  expect('content height measured', contentHeight > 100, String(contentHeight));
  expect('report counts populated', report.counts.nodes > 5 && report.counts.maxDepth >= 2, JSON.stringify(report.counts));
}

// ── 2. css param: class-based styling applies ────────────────────────────────
{
  const { root: styled } = await importHtml('<div class="chip">Beta</div>', {
    css: '.chip { display: inline-flex; padding: 4px 10px; background-color: #b71421; color: #ffffff; border-radius: 999px; font-size: 12px; }',
  });
  const chip = find(styled, (n) => n.fill === 'rgb(183, 20, 33)');
  expect('css param styles the import', chip !== null && chip!.layout === 'horizontal' && JSON.stringify(chip!.padding) === '[4,10]', JSON.stringify(chip));
}

// ── 3. selector imports a sub-tree ───────────────────────────────────────────
{
  const { root: sub } = await importHtml('<header style="background:#000;padding:8px">nav</header><main><p id="target" style="font-size:18px;color:#111827">Just this</p></main>', { selector: '#target' });
  expect('selector narrows the import', sub.type === 'text' && sub.content === 'Just this' && sub.fontSize === 18, JSON.stringify(sub));

  let missed: unknown;
  try { await importHtml('<div>x</div>', { selector: '#nope' }); } catch (err) { missed = err; }
  expect('unmatched selector errors clearly', missed instanceof Error && (missed as Error).message.includes('#nope'));
}

// ── 3b. real <table> markup reconstructs structurally (Phase 18) ─────────────
{
  const { root: t, report: tr } = await importHtml(`
    <table style="width:600px;border-collapse:collapse;background:#fff">
      <thead><tr>
        <th style="width:50%;padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">Name</th>
        <th style="width:30%;padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">Role</th>
        <th style="width:20%;padding:8px;text-align:left;border-bottom:2px solid #e5e7eb">Status</th>
      </tr></thead>
      <tbody>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb">Ada</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">Admin</td><td style="padding:8px;border-bottom:1px solid #e5e7eb">Active</td></tr>
        <tr><td style="padding:8px">Grace</td><td style="padding:8px">Viewer</td><td style="padding:8px">Invited</td></tr>
      </tbody>
    </table>`, { width: 700 });
  const tableFrame = find(t, (n) => n.name === 'Table');
  expect('Chrome table → reconstructed structure', tableFrame !== null && tr.layout.some((l) => l.source === 'table' && l.detail?.includes('3 rows')), JSON.stringify(tr.layout));
  const headerRow = find(t, (n) => n.name === 'Header row');
  const widths = (headerRow?.children ?? []).map((c) => parseFloat(String(c.width)));
  expect('Chrome computed cell widths → ~50/30/20%', widths.length === 3 && Math.abs(widths[0] - 50) < 2 && Math.abs(widths[1] - 30) < 2 && Math.abs(widths[2] - 20) < 2, JSON.stringify(widths));
  expect('row dividers present between rows', find(t, (n) => n.name === 'Divider') !== null);
}

// ── 3c. grid + centered card through real Chrome (Phase 18 slice C) ──────────
{
  const { root: g, report: gr } = await importHtml(`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;width:632px">
      <div style="background:#1e293b;height:80px">A</div>
      <div style="background:#1e293b;height:80px">B</div>
      <div style="background:#1e293b;height:80px">C</div>
      <div style="background:#1e293b;height:80px;grid-column:span 2">D wide</div>
      <div style="background:#1e293b;height:80px">E</div>
    </div>`, { width: 700 });
  const gridFrame = find(g, (n) => n.name === 'Grid');
  expect('Chrome grid (fr tracks resolve to px) reconstructs', gridFrame !== null && gr.layout.some((l) => l.source === 'grid' && l.detail === '2 rows × 3 cols'), JSON.stringify(gr.layout));
  const rows = (gridFrame?.children ?? []).filter((n) => n.name === 'Grid row');
  const spanWidth = parseFloat(String(rows[1]?.children?.[0]?.width));
  expect('Chrome span-2 child ≈ two tracks wide', spanWidth > 60 && spanWidth < 72, String(spanWidth));

  const { root: s, report: sr } = await importHtml(`
    <main style="min-height:400px;display:flex;align-items:center;justify-content:center">
      <div style="max-width:448px;width:100%;background:#0f172a;border-radius:12px;padding:32px;color:#fff">Sign in</div>
    </main>`, { width: 1440 });
  const card = find(s, (n) => n.maxWidth === 448);
  expect('Chrome centered card: fluid + capped at max-width', card !== null && card!.width === '100%' && card!.cornerRadius === 12, JSON.stringify({ w: card?.width, mw: card?.maxWidth }));
  const centerParent = find(s, (n) => n.alignItems === 'center' && n.justifyContent === 'center');
  expect('Chrome flex-center parent survives (not collapsed)', centerParent !== null && (centerParent!.children ?? []).some((c) => c.maxWidth === 448), JSON.stringify(sr.layout));
}

// ── 4. round-trip: the imported tree renders ─────────────────────────────────
{
  const html = renderToHtml({ id: 'doc', type: 'document', fill: '#FFFFFF', width: 800, height: Math.max(contentHeight, 200), children: [root] }, 800, Math.max(contentHeight, 200));
  const png = await takeScreenshot(html, { width: 800, height: Math.max(contentHeight, 200), scale: 1 });
  expect('imported tree renders to a screenshot', typeof png === 'string' && png.length > 1000);
}

await shutdown();

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
