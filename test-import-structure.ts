import './test-env.js';
// Phase 18 — structural reconstruction tests (pure, no Chrome). Slice B:
// <table> → rows of percentage cells. Fixtures mimic the #92 User Management
// shape: header + data rows × 4 columns with realistic computed rects.
//
// Usage: npx tsx test-import-structure.ts

import { domToSceneGraph, type RawDomNode } from './src/import.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

function el(partial: Partial<RawDomNode> & { tag: string }): RawDomNode {
  return {
    classes: [], rect: { x: 0, y: 0, w: 200, h: 40 },
    styles: { display: 'block', visibility: 'visible', opacity: '1' },
    attrs: {}, children: [], ...partial,
  } as RawDomNode;
}

const find = (root: SceneNode, pred: (n: SceneNode) => boolean): SceneNode | null => {
  if (pred(root)) return root;
  for (const c of root.children ?? []) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
};
const findAll = (root: SceneNode, pred: (n: SceneNode) => boolean): SceneNode[] => {
  const out: SceneNode[] = [];
  const walk = (n: SceneNode) => { if (pred(n)) out.push(n); n.children?.forEach(walk); };
  walk(root);
  return out;
};

/** A #92-shaped cell. */
function cell(tag: 'td' | 'th', w: number, text: string, extra: Partial<RawDomNode> = {}): RawDomNode {
  return el({
    tag, text,
    rect: { x: 0, y: 0, w, h: 52 },
    styles: {
      display: 'table-cell', visibility: 'visible',
      paddingTop: '12px', paddingRight: '16px', paddingBottom: '12px', paddingLeft: '16px',
      borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: 'rgb(58, 58, 58)',
      ...(tag === 'th' ? { fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'rgb(160, 160, 160)' } : { fontSize: '14px', color: 'rgb(245, 245, 245)' }),
    },
    ...extra,
  });
}

function tr(cells: RawDomNode[], extra: Partial<RawDomNode> = {}): RawDomNode {
  return el({ tag: 'tr', rect: { x: 0, y: 0, w: 800, h: 52 }, styles: { display: 'table-row', visibility: 'visible' }, children: cells, ...extra });
}

// ── 1. the User Management table shape ───────────────────────────────────────
{
  const table = el({
    tag: 'table',
    rect: { x: 0, y: 0, w: 800, h: 260 },
    styles: { display: 'table', visibility: 'visible', backgroundColor: 'rgb(30, 30, 30)', borderTopLeftRadius: '12px', overflow: 'hidden' },
    children: [
      el({ tag: 'caption', text: 'All users', styles: { display: 'table-caption', fontSize: '13px', color: 'rgb(160, 160, 160)', visibility: 'visible' } }),
      el({ tag: 'thead', styles: { display: 'table-header-group', visibility: 'visible' }, children: [
        tr([cell('th', 320, 'User'), cell('th', 160, 'Source'), cell('th', 200, 'Status'), cell('th', 120, 'Role')]),
      ] }),
      el({ tag: 'tbody', styles: { display: 'table-row-group', visibility: 'visible' }, children: [
        tr([
          cell('td', 320, '', { children: [el({ tag: 'div', styles: { display: 'flex', flexDirection: 'row', rowGap: '12px', columnGap: '12px', alignItems: 'center', visibility: 'visible' }, children: [
            el({ tag: 'div', rect: { x: 0, y: 0, w: 32, h: 32 }, styles: { display: 'block', backgroundColor: 'rgb(26, 26, 26)', borderTopLeftRadius: '50%', visibility: 'visible' } }),
            el({ tag: 'span', text: 'Ada Lovelace', styles: { display: 'inline', fontSize: '14px', fontWeight: '600', color: 'rgb(245, 245, 245)', visibility: 'visible' } }),
          ] })] }),
          cell('td', 160, '', { children: [el({ tag: 'span', text: 'GOOGLE', classes: ['chip'], rect: { x: 0, y: 0, w: 64, h: 22 }, styles: { display: 'inline-flex', backgroundColor: 'rgb(40, 40, 40)', borderTopLeftRadius: '999px', fontSize: '11px', color: 'rgb(160, 160, 160)', paddingTop: '2px', paddingRight: '8px', paddingBottom: '2px', paddingLeft: '8px', visibility: 'visible' } })] }),
          cell('td', 200, 'Active'),
          cell('td', 120, '', { children: [el({ tag: 'select', attrs: { selectValue: 'Admin' }, rect: { x: 0, y: 0, w: 96, h: 32 }, styles: { display: 'inline-block', visibility: 'visible' } })] }),
        ]),
        tr([cell('td', 320, 'Grace Hopper'), cell('td', 160, 'EMAIL'), cell('td', 200, 'Invited'), cell('td', 120, 'Viewer')]),
      ] }),
    ],
  });

  const { root, report } = domToSceneGraph(table);
  expect('table → named vertical frame at 100%', root.name === 'Table' && root.layout === 'vertical' && root.width === '100%');
  expect('table keeps its own styling', root.fill === 'rgb(30, 30, 30)' && root.cornerRadius === 12 && root.overflow === 'hidden');

  const rows = findAll(root, (n) => n.name === 'Row' || n.name === 'Header row');
  expect('thead/tbody unwrap into 3 rows', rows.length === 3, String(rows.length));
  expect('header row identified', rows[0].name === 'Header row');
  expect('rows are horizontal, centered, full-width', rows.every((r) => r.layout === 'horizontal' && r.alignItems === 'center' && r.width === '100%'));

  const headerCells = rows[0].children!;
  expect('4 columns with proportional widths', headerCells.length === 4
    && headerCells[0].width === '40%' && headerCells[1].width === '20%' && headerCells[2].width === '25%' && headerCells[3].width === '15%',
    JSON.stringify(headerCells.map((c) => c.width)));
  expect('percentages sum to 100', headerCells.reduce((s, c) => s + parseFloat(String(c.width)), 0) === 100);

  const th = find(rows[0], (n) => n.content === 'User');
  expect('th keeps its computed header type', th !== null && th!.textTransform === 'uppercase' && th!.fontWeight === 600 && th!.letterSpacing === 0.6);

  expect('caption becomes a text node above the rows', root.children![0].type === 'text' && root.children![0].content === 'All users');

  const dividers = findAll(root, (n) => n.name === 'Divider');
  expect('cell bottom borders become hairline dividers', dividers.length === 3 && dividers.every((d) => d.height === 1 && d.fill === 'rgb(58, 58, 58)' && d.width === '100%'), String(dividers.length));

  expect('cell content recurses (avatar flex, chip, select primitive)',
    find(root, (n) => n.content === 'Ada Lovelace') !== null
    && find(root, (n) => n.content === 'GOOGLE') !== null
    && find(root, (n) => n.type === 'select' && n.value === 'Admin') !== null);

  expect('report.layout records the table', report.layout.some((l) => l.source === 'table' && l.detail === '3 rows × 4 cols'), JSON.stringify(report.layout));
}

// ── 2. edge cases ────────────────────────────────────────────────────────────
{
  // colspan: the wide cell's rect covers two tracks → proportional width, free.
  const colspanTable = el({ tag: 'table', styles: { display: 'table', visibility: 'visible' }, children: [
    tr([cell('td', 480, 'Wide (colspan 2)'), cell('td', 320, 'Normal')]),
  ] });
  const { root: ct } = domToSceneGraph(colspanTable);
  const ctCells = find(ct, (n) => n.name === 'Row')!.children!;
  expect('colspan handled via rect proportion', ctCells[0].width === '60%' && ctCells[1].width === '40%', JSON.stringify(ctCells.map((c) => c.width)));

  // rowspan: warned, not reconstructed.
  const rowspanTable = el({ tag: 'table', styles: { display: 'table', visibility: 'visible' }, children: [
    tr([cell('td', 400, 'Spans', { attrs: { rowSpan: 2 } }), cell('td', 400, 'A')]),
    tr([cell('td', 800, 'B')]),
  ] });
  const { report: rr } = domToSceneGraph(rowspanTable);
  expect('rowspan warns once', rr.warnings.filter((w) => w.includes('rowspan')).length === 1);

  // a row-less table falls back to the generic frame path.
  const empty = el({ tag: 'table', text: 'just text', styles: { display: 'table', visibility: 'visible' } });
  const { root: et, report: er } = domToSceneGraph(empty);
  expect('row-less table falls through gracefully', et.name === undefined && er.layout.length === 0 && find(et, (n) => n.content === 'just text') !== null);

  // hidden rows drop with dropInvisible.
  const hiddenRow = el({ tag: 'table', styles: { display: 'table', visibility: 'visible' }, children: [
    tr([cell('td', 800, 'visible')]),
    tr([cell('td', 800, 'hidden')], { styles: { display: 'none', visibility: 'visible' } }),
  ] });
  const { root: ht } = domToSceneGraph(hiddenRow);
  expect('hidden rows are dropped', findAll(ht, (n) => n.name === 'Row').length === 1);
}

// ── 3. flatten never eats reconstructed frames ───────────────────────────────
{
  // A one-column table: each Row has a single bare Cell — without the name
  // guard, collapseWrappers would dissolve the row structure.
  const oneCol = el({ tag: 'table', styles: { display: 'table', visibility: 'visible' }, children: [
    tr([cell('td', 800, 'Only column')]),
    tr([cell('td', 800, 'Second row')]),
  ] });
  const { root } = domToSceneGraph(oneCol); // default flatten: collapseWrappers on
  const rows = findAll(root, (n) => n.name === 'Row');
  expect('named row/cell frames survive wrapper collapse', rows.length === 2 && rows.every((r) => r.children?.[0].name === 'Cell'), String(rows.length));
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
