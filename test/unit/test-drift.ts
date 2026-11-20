// Phase 23 slice B (#148) — structural drift engine. Pure fixtures, no Chrome.
// The two acceptance fixtures reproduce the incidents that motivated the
// issue: a canvas showing a STATUS column / "Rename" links the page no longer
// has, and a canvas radiogroup the implementation shipped as a <select>.
//
// Usage: npx tsx test/unit/test-drift.ts

import '../env.js';
import { computeStructuralDrift, extractInventory, expandInstances, isDataLike } from '../../src/drift.js';
import type { Canvas, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

let seq = 0;
const id = () => `n${++seq}`;
const text = (content: string): SceneNode => ({ id: id(), type: 'text', content });
const frame = (children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id: id(), type: 'frame', children, ...extra } as SceneNode);
const doc = (children: SceneNode[]): SceneNode => ({ id: 'document', type: 'document', children } as SceneNode);
const control = (type: 'toggle' | 'checkbox' | 'radio' | 'select', extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id: id(), type, ...extra } as SceneNode);

/** A 2+-column table: header row + data rows, all same cell count. */
function table(headers: string[], rows: string[][], name?: string): SceneNode {
  // Rows are horizontal — cells beside each other. (A layout-less frame
  // stacks children vertically, which never renders as a table; the detector
  // requires the horizontal signature since Phase 27.)
  const row = (cells: string[]) => frame(cells.map((c) => frame([text(c)])), { layout: 'horizontal', ...(name ? { name: 'Row' } : {}) });
  return frame([row(headers), ...rows.map(row)], name ? { name } : {});
}

// ── isDataLike ──────────────────────────────────────────────────────────────
check('data-like: money/percent/date', isDataLike('$1.52M') && isDataLike('+4.2%') && isDataLike('12,400') && isDataLike('Q3 2026'));
check('structural: words survive', !isDataLike('STATUS') && !isDataLike('Rename') && !isDataLike('Revenue 2026'));

// ── inventory basics ────────────────────────────────────────────────────────
{
  const inv = extractInventory(doc([
    text('Settings'),
    frame([text('Email alerts'), control('toggle')]),
    frame([text('Notification type'), control('radio'), control('radio'), control('radio')]),
    control('select', { value: 'Admin' }),
  ]));
  check('flat radio run → ONE radio-group(3)', inv.controls.filter((c) => c.kind === 'radio-group').length === 1
    && inv.controls.find((c) => c.kind === 'radio-group')?.options === 3, JSON.stringify(inv.controls));
  check('toggle labeled by preceding text', inv.controls.find((c) => c.kind === 'toggle')?.label === 'email alerts');
  check('radio-group labeled by field label', inv.controls.find((c) => c.kind === 'radio-group')?.label === 'notification type');
}
{
  // Wrapped layout: each radio in its own row with an option label.
  const inv = extractInventory(doc([
    text('Notification type'),
    frame([
      frame([control('radio'), text('Email')]),
      frame([control('radio'), text('SMS')]),
      frame([control('radio'), text('Push')]),
    ]),
  ]));
  check('wrapped radios → ONE radio-group(3)', inv.controls.length === 1 && inv.controls[0].kind === 'radio-group' && inv.controls[0].options === 3, JSON.stringify(inv.controls));
  check('wrapped group takes the container-level label', inv.controls[0].label === 'notification type', inv.controls[0].label);
}
{
  // Radios alone in a dedicated options frame — the group label must come
  // from one level above the container (the regression behind the live test).
  const inv = extractInventory(doc([frame([text('Control type'), frame([control('radio'), control('radio')])])]));
  check('bare options-frame radios inherit the field label', inv.controls[0]?.label === 'control type', inv.controls[0]?.label);
}
{
  const inv = extractInventory(doc([table(['NAME', 'TYPE'], [['a', 'b'], ['c', 'd']])]));
  check('generic table detected', inv.tables.length === 1 && inv.tables[0].columnCount === 2 && inv.tables[0].headers.join(',') === 'NAME,TYPE');
  check('table subtree consumed (no cell texts leak)', inv.texts.length === 0, JSON.stringify(inv.texts.map((t) => t.display)));
}

{
  // Phase 26 slice A — grid containers are compositions, never tables (the
  // detector is shared with coverage and stress).
  const inv = extractInventory(doc([frame([
    frame([text('REVENUE'), text('Details')]),
    frame([text('GROWTH'), text('Details')]),
  ], { layout: 'grid' } as never)]));
  // Phase 28 — two stacked horizontal rows (topbar over greeting) is a
  // layout, never a table; three matching rows still are; an import-named
  // Table keeps the trusted two-row shape.
  const layoutInv = extractInventory(doc([frame([
    frame([frame([text('Fieldwork')]), frame([text('Search')])], { layout: 'horizontal' }),
    frame([frame([text('Good morning')]), frame([text('Export')])], { layout: 'horizontal' }),
  ])]));
  check('two stacked 2-cell rows never read as a table', layoutInv.tables.length === 0, JSON.stringify(layoutInv.tables));
  const threeRowInv = extractInventory(doc([table(['NAME', 'TYPE'], [['a', 'b'], ['c', 'd']])]));
  check('header + two data rows (3 total) still detected', threeRowInv.tables.length === 1);
  const namedTwoRow = extractInventory(doc([table(['NAME', 'TYPE'], [['a', 'b']], 'Table')]));
  check('import-named Table keeps the loose 2-row shape', namedTwoRow.tables.length === 1, JSON.stringify(namedTwoRow.tables));
  check('grid container never reads as a table', inv.tables.length === 0);
}

// ── identical trees → in sync, zero findings ────────────────────────────────
{
  const make = () => doc([text('Stream types'), table(['NAME', 'TYPE'], [['Live', 'video']]), frame([text('Enabled'), control('toggle')])]);
  const r = computeStructuralDrift(make(), make());
  check('identical → inSync, no findings', r.inSync && r.findings.length === 0, JSON.stringify(r.findings));
}

// ── incident 1: STATUS column + Rename links the page no longer has ─────────
{
  const canvasSide = doc([
    text('Stream types'),
    table(['NAME', 'TYPE', 'STATUS', 'ACTIONS'], [['Live', 'video', 'active', 'edit'], ['VOD', 'video', 'paused', 'edit']]),
    frame([text('Legacy stream'), text('Rename')]), // rows outside the table
    frame([text('Archived stream'), text('Rename')]),
  ]);
  const pageSide = doc([
    text('Stream types'),
    table(['NAME', 'TYPE', 'ACTIONS'], [['Live', 'video', 'edit'], ['VOD', 'video', 'edit']]),
  ]);
  const r = computeStructuralDrift(canvasSide, pageSide);
  const tableFinding = r.findings.find((f) => f.kind === 'table-mismatch' && f.severity === 'error');
  check('incident 1: STATUS column named in table-mismatch', !!tableFinding && tableFinding.detail.includes('STATUS'), tableFinding?.detail);
  const rename = r.findings.filter((f) => f.kind === 'missing-in-page' && f.detail.includes('Rename'));
  check('incident 1: Rename links reported missing-in-page', rename.length === 2, String(rename.length));
  const legacy = r.findings.some((f) => f.kind === 'missing-in-page' && f.detail.includes('Legacy stream'));
  check('incident 1: phantom row text reported', legacy);
  check('incident 1: drifted', !r.inSync);
}

// ── incident 2: canvas radiogroup, page shipped a select ────────────────────
{
  const canvasSide = doc([
    text('Revenue driver'),
    text('Control type'),
    frame([
      frame([control('radio'), text('Manual')]),
      frame([control('radio'), text('Computed')]),
      frame([control('radio'), text('Hybrid')]),
    ]),
  ]);
  const pageSide = doc([
    text('Revenue driver'),
    text('Control type'),
    control('select', { value: 'Manual' }),
  ]);
  const r = computeStructuralDrift(canvasSide, pageSide);
  const mm = r.findings.filter((f) => f.kind === 'control-mismatch');
  check('incident 2: exactly one control-mismatch', mm.length === 1, JSON.stringify(r.findings));
  check('incident 2: says radio group vs select', !!mm[0] && /radio group \(3 options\)/.test(mm[0].detail) && mm[0].detail.includes('select'), mm[0]?.detail);
  check('incident 2: no spurious missing-control findings', !r.findings.some((f) => f.kind === 'missing-in-page' && /radio|select/.test(f.detail)));
  check('incident 2: drifted', !r.inSync);
}

// ── live data is not drift ──────────────────────────────────────────────────
{
  const canvasSide = doc([text('Revenue'), text('$1.52M'), text('+4.2%')]);
  const pageSide = doc([text('Revenue'), text('$1.61M'), text('+3.8%')]);
  const r = computeStructuralDrift(canvasSide, pageSide);
  check('changed figures → still in sync', r.inSync, JSON.stringify(r.findings));
  check('figures counted as data-like', r.counts.dataLikeSkipped === 2, String(r.counts.dataLikeSkipped));
  check('unmatched page text is an info count', r.findings.every((f) => f.severity === 'info') && r.counts.unmatchedPageTexts === 2);
}

// ── page grew a control the canvas lacks ────────────────────────────────────
{
  const canvasSide = doc([frame([text('Email alerts'), control('toggle')])]);
  const pageSide = doc([frame([text('Email alerts'), control('toggle')]), frame([text('Digest mode'), control('toggle')])]);
  const r = computeStructuralDrift(canvasSide, pageSide);
  const f = r.findings.find((x) => x.kind === 'missing-in-canvas' && x.detail.includes('toggle'));
  check('new page control → missing-in-canvas warning', !!f && f.severity === 'warning', JSON.stringify(r.findings));
  check('warnings block inSync', !r.inSync);
}

// ── same label, same kind, across layouts → clean match ────────────────────
{
  const canvasSide = doc([frame([text('Enabled'), control('toggle')]), frame([text('Role'), control('select')])]);
  const pageSide = doc([frame([frame([text('Enabled')]), control('toggle')]), control('select', { value: 'Admin' }), text('Role')]);
  const r = computeStructuralDrift(canvasSide, pageSide);
  check('re-nested same controls → no control findings', !r.findings.some((f) => f.kind === 'control-mismatch' || (f.kind === 'missing-in-page' && /toggle|select/.test(f.detail))), JSON.stringify(r.findings));
}

// ── per-string cap ──────────────────────────────────────────────────────────
{
  const canvasSide = doc(Array.from({ length: 30 }, (_, i) => text(`Section heading ${String.fromCharCode(65 + i)}`)));
  const pageSide = doc([text('Totally different')]);
  const r = computeStructuralDrift(canvasSide, pageSide);
  const perString = r.findings.filter((f) => f.kind === 'missing-in-page' && !f.detail.startsWith('…and'));
  const summary = r.findings.find((f) => f.detail.startsWith('…and'));
  check('missing-text findings capped at 20 + summary', perString.length === 20 && !!summary && summary.detail.includes('10 more'), summary?.detail);
}

// ── expandInstances sees through components ─────────────────────────────────
{
  const shell: SceneNode = frame([text('Dashboard'), control('toggle')], { name: 'Shell' });
  const canvas = {
    components: { 'cmp-shell': shell },
    root: doc([{ id: 'inst-1', type: 'instance', componentId: 'cmp-shell' } as SceneNode]),
  } as unknown as Canvas;
  const inv = extractInventory(expandInstances(canvas.root, canvas));
  check('instance expanded into inventory', inv.texts.some((t) => t.display === 'Dashboard') && inv.controls.length === 1, JSON.stringify(inv.counts));
}

console.log(allPass ? '\nAll drift tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
