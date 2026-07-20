import './test-env.js';
// Phase 22 slice F (#129) — the data-driven chart node.
// Pure geometry via chartGeometry + SVG string assertions on renderToHtml;
// ops-parser round-trip for the nested series shape. No Chrome needed.
//
// Usage: npx tsx test-chart.ts

import { createCanvas, insertNode } from './src/scene-graph.js';
import { resolveVariables } from './src/variables.js';
import { renderToHtml, chartGeometry } from './src/renderer.js';
import { parseAndExecute } from './src/operations.js';
import { applyStructure } from './src/structures.js';
import type { SceneNode } from './src/types.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const canvas = createCanvas('chart-test');
const root = canvas.root;
const render = () => renderToHtml(root, 1200, 800, canvas);

// ── geometry (pure) ──────────────────────────────────────────────────────────
{
  const node: SceneNode = { id: 'g', type: 'chart', width: 600, height: 240, series: [{ data: [0, 50, 100] }] };
  const g = chartGeometry(node, 600, 240)!;
  check('auto yDomain maps min to bottom', g.y(0) === g.y0 + g.plotH);
  check('auto yDomain maps max to top', g.y(100) === g.y0);
  check('x maps indexes across the plot', g.x(0) === g.x0 && g.x(2) === g.x0 + g.plotW && g.x(1) === g.x0 + g.plotW / 2);

  // Shorter series against a longer one: index range comes from the longest.
  const multi: SceneNode = { id: 'm', type: 'chart', series: [{ data: [1, 2, 3, 4, 5, 6, 7] }, { data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }] };
  const gm = chartGeometry(multi, 600, 240)!;
  check('shorter series spans its fraction of the width', Math.abs(gm.x(6) - (gm.x0 + (6 / 11) * gm.plotW)) < 0.001);

  // Explicit domains win; degenerate domain pads.
  const dom: SceneNode = { id: 'd', type: 'chart', yDomain: [0, 2700], series: [{ data: [210, 450] }] };
  const gd = chartGeometry(dom, 600, 240)!;
  check('explicit yDomain wins', gd.y(2700) === gd.y0 && gd.y(0) === gd.y0 + gd.plotH);
  const flat: SceneNode = { id: 'f', type: 'chart', series: [{ data: [5, 5, 5] }] };
  check('flat data does not divide by zero', isFinite(chartGeometry(flat, 600, 240)!.y(5)));

  // Bars floor the auto domain at 0.
  const bar: SceneNode = { id: 'b', type: 'chart', kind: 'bar', series: [{ data: [10, 20] }] };
  const gb = chartGeometry(bar, 600, 240)!;
  check('bar auto yDomain floors at 0', gb.y(0) === gb.y0 + gb.plotH);

  // Label margins reserve plot space.
  const labeled: SceneNode = { id: 'l', type: 'chart', series: [{ data: [1, 2] }], xLabels: ['a', 'b'], yLabels: ['0', '1'] };
  const gl = chartGeometry(labeled, 600, 240)!;
  check('labels reserve margins', gl.x0 === 44 && gl.plotH < 240 - 4);

  check('no plottable series → null', chartGeometry({ id: 'n', type: 'chart', series: [{ data: [] }] }, 600, 240) === null);
}

// ── rendering ────────────────────────────────────────────────────────────────
{
  const chart = insertNode(root, root.id, {
    type: 'chart', name: 'Pace', kind: 'line', width: 600, height: 220, gridlines: 4,
    series: [
      { data: [210, 450, 648, 903, 1133, 1338, 1518], stroke: '#2563EB', strokeWidth: 2.5, area: true, points: true },
      { data: [225, 450, 675, 900, 1125, 1350, 1575, 1800, 2025, 2250, 2475, 2700], stroke: '#94A3B8', strokeDasharray: '6 4' },
    ],
    xLabels: ['Jan', '', 'Dec'],
    yLabels: ['0', '2.7M'],
  });
  const html = render();
  check('chart renders an svg', html.includes('viewBox="0 0 600 220"'));
  check('two series paths drawn', (html.match(/<path d="M/g) ?? []).length >= 2);
  check('dashed series carries stroke-dasharray', html.includes('stroke-dasharray="6 4"'));
  check('area fill at 12% opacity', html.includes('fill-opacity="0.12"'));
  check('point markers drawn', (html.match(/<circle /g) ?? []).length === 7);
  check('gridlines drawn', (html.match(/<line /g) ?? []).length === 4);
  check('x labels rendered, empty ticks skipped... rendered as empty', html.includes('>Jan</text>') && html.includes('>Dec</text>'));
  check('y labels right-aligned at the left edge', html.includes('text-anchor="end">2.7M</text>'));

  // Smooth curve emits cubic segments.
  chart.curve = 'smooth';
  check('smooth curve uses cubic beziers', render().includes(' C'));

  // Bar kind: grouped rects from the same series model.
  const barChart = insertNode(root, root.id, {
    type: 'chart', name: 'Monthly', kind: 'bar', width: 400, height: 160,
    series: [{ data: [10, 25, 18], stroke: '#0D9488' }, { data: [8, 20, 15], stroke: '#D97706' }],
  });
  const barHtml = render();
  check('bar chart draws a rect per value per series', (barHtml.match(/<rect /g) ?? []).length === 6);

  // Label content is escaped.
  barChart.xLabels = ['<img onerror=x>'];
  check('labels are HTML-escaped', !render().includes('<img onerror'));

  // Default colors avoid purple; missing strokes cycle the ramp.
  const plain = insertNode(root, root.id, { type: 'chart', width: 300, height: 100, series: [{ data: [1, 2] }, { data: [2, 1] }] });
  const plainHtml = render();
  check('default series colors cycle the neutral ramp', plainHtml.includes('#2563EB') && plainHtml.includes('#0D9488'));
  check('empty chart renders a comment, not a crash', (() => {
    insertNode(root, root.id, { type: 'chart', width: 100, height: 50 });
    return render().includes('<!-- chart: no plottable series -->');
  })());
  void plain;
}

// ── tokens + ops parser round-trip ───────────────────────────────────────────
{
  const c2 = createCanvas('chart-token-test');
  c2.variables = { colors: { accent: '#0E7490', border: '#CBD5E1' } };
  const ops = 'pace=I("document", { type: "chart", kind: "line", width: 500, height: 200, series: [{ data: [1, 2, 3], stroke: "$accent" }, { data: [3, 2, 1], stroke: "$border", strokeDasharray: [6, 4] }] })';
  const results = parseAndExecute(c2.root, ops, c2);
  check('ops parser accepts the nested series shape', results.every((r) => r.ok), JSON.stringify(results));
  const resolved = resolveVariables(c2.root, c2.variables);
  const html = renderToHtml(resolved, 800, 400, c2);
  check('$token strokes resolve inside series', html.includes('#0E7490') && html.includes('#CBD5E1'));
  check('number-array dasharray works in series', html.includes('stroke-dasharray="6 4"'));
}

// ── dashboard pattern carries a real chart ───────────────────────────────────
{
  const c3 = createCanvas('chart-pattern-test');
  applyStructure(c3, 'dashboard', { replace: true });
  const html = renderToHtml(resolveVariables(c3.root, c3.variables), 1440, 900, c3);
  check('dashboard pattern renders a real chart svg', html.includes('preserveAspectRatio="none"') && html.includes('stroke-dasharray="6 4"'));
  check('dashboard chart has no placeholder label', !html.includes('Chart — placeholder'));
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
