// Phase 28 slice B — the dataviz primitives: donut (data-bound slices +
// center slots), bar emphasis + in-SVG gradients, sparkline. Pure SVG-string
// assertions (no Chrome); the slice-D proof re-run covers pixels.
//
// Usage: npx tsx test/unit/test-charts.ts

import '../env.js';
import { renderToHtml, chartGeometry } from '../../src/renderer.js';
import { resolveVariables } from '../../src/variables.js';
import type { SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const html = (node: SceneNode) => renderToHtml({ id: 'doc', type: 'document', children: [node] } as SceneNode, 800, 400);
const svgOf = (s: string) => s.slice(s.indexOf('<svg'), s.indexOf('</svg>') + 6);

// ── donut ───────────────────────────────────────────────────────────────────
{
  console.log('── donut ──');
  const donut: SceneNode = {
    id: 'd1', type: 'chart', kind: 'donut', width: 200, height: 200,
    segments: [
      { value: 32, color: '#2563EB', label: 'North' },
      { value: 24, color: '#DB2777' },
      { value: 44, color: '#0D9488' },
    ],
    centerValue: '1,204', centerLabel: 'forms',
  };
  const svg = svgOf(html(donut));
  check('one slice path per segment', (svg.match(/<path /g) ?? []).length === 3, String((svg.match(/<path /g) ?? []).length));
  check('slice colors land as fills', svg.includes('#2563EB') && svg.includes('#DB2777') && svg.includes('#0D9488'));
  check('center value rendered tabular + bold', svg.includes('>1,204</text>') && svg.includes('font-weight="700"') && svg.includes('tabular-nums'));
  check('center label rendered muted', svg.includes('>forms</text>'));
  check('arcs, not conic hacks', svg.includes(' A') && !svg.includes('conic-gradient'));

  // single segment = a full ring (the degenerate-arc split)
  const full = svgOf(html({ id: 'd2', type: 'chart', kind: 'donut', width: 100, height: 100, segments: [{ value: 10, color: '#2563EB' }] }));
  check('single segment renders a full ring (two half arcs)', (full.match(/<path /g) ?? []).length === 2);

  // $chart-* refs resolve through the variables walk
  const reffed: SceneNode = {
    id: 'd3', type: 'chart', kind: 'donut', width: 100, height: 100,
    segments: [{ value: 1, color: '$chart-1' }, { value: 1, color: '$chart-2' }],
  };
  const resolved = resolveVariables(reffed, { colors: { 'chart-1': '#111111', 'chart-2': '#222222' } });
  check('$chart refs resolve on segments', resolved.segments![0].color === '#111111' && resolved.segments![1].color === '#222222');

  // junk segments dropped; empty → comment, not a crash
  const junk = svgOf(html({ id: 'd4', type: 'chart', kind: 'donut', width: 100, height: 100, segments: [{ value: -5, color: '#111111' }, { value: NaN, color: '#222222' } as never] }));
  check('no valid segments → placeholder comment', junk === '<svg'.slice(0, 0) + junk && html({ id: 'd5', type: 'chart', kind: 'donut', width: 100, height: 100 }).includes('<!-- donut: no segments -->'));
}

// ── bar emphasis + gradients ────────────────────────────────────────────────
{
  console.log('── bar emphasis ──');
  const bars: SceneNode = {
    id: 'b1', type: 'chart', kind: 'bar', width: 600, height: 240,
    series: [{ data: [10, 20, 30, 40], stroke: '#2563EB', highlight: [2] }],
  };
  const svg = svgOf(html(bars));
  check('four bars', (svg.match(/<rect /g) ?? []).length === 4);
  check('non-highlighted bars muted at 0.3', (svg.match(/fill-opacity="0.3"/g) ?? []).length === 3, String((svg.match(/fill-opacity="0.3"/g) ?? []).length));

  const grad: SceneNode = {
    id: 'b2', type: 'chart', kind: 'bar', width: 600, height: 240,
    series: [{ data: [10, 20, 30], stroke: '#2563EB', highlight: [2], barGradient: true }],
  };
  const gsvg = svgOf(html(grad));
  check('gradient defs scoped to the node id', gsvg.includes('id="fs-grad-b2-0"'));
  check('muted bars fill from the gradient, hot bar stays solid', (gsvg.match(/url\(#fs-grad-b2-0\)/g) ?? []).length === 2 && gsvg.includes('fill="#2563EB"'));

  const plain = svgOf(html({ id: 'b3', type: 'chart', kind: 'bar', width: 600, height: 240, series: [{ data: [1, 2], stroke: '#2563EB' }] }));
  check('no highlight → all solid, no defs', !plain.includes('fill-opacity') && !plain.includes('<defs>'));
}

// ── sparkline ───────────────────────────────────────────────────────────────
{
  console.log('── sparkline ──');
  const spark: SceneNode = {
    id: 's1', type: 'chart', kind: 'sparkline', width: 60, height: 28,
    series: [{ data: [40, 55, 45, 70, 100], stroke: '#2563EB' }],
    xLabels: ['never', 'rendered'], yLabels: ['no'],
  };
  const svg = svgOf(html(spark));
  check('five bars, no axis text', (svg.match(/<rect /g) ?? []).length === 5 && !svg.includes('<text'));
  check('latest point emphasized by default (rest muted)', (svg.match(/fill-opacity="0.3"/g) ?? []).length === 4);
  const geom = chartGeometry(spark, 60, 28);
  check('axis-free geometry (no label padding)', geom !== null && geom.x0 === 0);

  const line = svgOf(html({ id: 's2', type: 'chart', kind: 'sparkline', sparkKind: 'line', width: 60, height: 28, series: [{ data: [1, 3, 2] }] }));
  check('line form renders a path', line.includes('<path ') && !line.includes('<rect '));
}

console.log(allPass ? '\nAll chart tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
