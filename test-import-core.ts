import './test-env.js';
// Phase 17 Slice A — import core, pure side (no Chrome).
// Fixture RawDomNode JSON → domToSceneGraph/flattenTree: node typing (controls,
// media, svg→icon/path), flex/grid mapping, style parsing, width strategy,
// flatten knobs, report shape/warnings, icon hash matching against the real
// bundled sets.
//
// Usage: npx tsx test-import-core.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { domToSceneGraph, matchIcon, type RawDomNode } from './src/import.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

/** Fixture helper — sensible invisible-free defaults. */
function el(partial: Partial<RawDomNode> & { tag: string }): RawDomNode {
  return {
    classes: [],
    rect: { x: 0, y: 0, w: 200, h: 40 },
    styles: { display: 'block', visibility: 'visible', opacity: '1' },
    attrs: {},
    children: [],
    ...partial,
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

// ── 1. flex container mapping ────────────────────────────────────────────────
{
  const raw = el({
    tag: 'div',
    rect: { x: 0, y: 0, w: 400, h: 100 },
    styles: {
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
      rowGap: '12px', columnGap: '12px',
      paddingTop: '16px', paddingRight: '24px', paddingBottom: '16px', paddingLeft: '24px',
      backgroundColor: 'rgb(17, 24, 39)', borderTopLeftRadius: '12px',
      borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'rgb(55, 65, 81)',
      boxShadow: 'rgba(0, 0, 0, 0.1) 0px 4px 6px 0px', opacity: '0.9', overflow: 'hidden',
      visibility: 'visible',
    },
    children: [el({ tag: 'span', text: 'a', styles: { display: 'inline', visibility: 'visible' } }), el({ tag: 'span', text: 'b', styles: { display: 'inline', visibility: 'visible' } })],
  });
  const { root } = domToSceneGraph(raw, { flatten: { collapseWrappers: false, mergeTextRuns: false } });
  expect('flex row → horizontal layout', root.layout === 'horizontal');
  expect('wrap + align + justify map', root.wrap === true && root.alignItems === 'center' && root.justifyContent === 'space-between');
  expect('gap parsed', root.gap === 12);
  expect('symmetric padding → [v, h]', JSON.stringify(root.padding) === '[16,24]');
  expect('bg → fill (computed rgb kept)', root.fill === 'rgb(17, 24, 39)');
  expect('border → stroke + strokeWidth', root.stroke === 'rgb(55, 65, 81)' && root.strokeWidth === 1);
  expect('radius / shadow / opacity / overflow', root.cornerRadius === 12 && typeof root.shadows === 'string' && root.opacity === 0.9 && root.overflow === 'hidden');
}

// ── 2. text mapping ──────────────────────────────────────────────────────────
{
  const raw = el({
    tag: 'h2',
    text: 'User Management',
    styles: {
      display: 'block', visibility: 'visible',
      fontSize: '20px', fontWeight: '700', color: 'rgb(249, 250, 251)', fontFamily: 'Inter, sans-serif',
      lineHeight: '28px', letterSpacing: '0.4px', textTransform: 'uppercase', textAlign: 'center', textDecorationLine: 'none',
    },
  });
  const { root } = domToSceneGraph(raw);
  expect('text-only element → text node', root.type === 'text' && root.content === 'User Management');
  expect('font props map', root.fontSize === 20 && root.fontWeight === 700 && root.color === 'rgb(249, 250, 251)' && root.fontFamily === 'Inter, sans-serif');
  expect('lineHeight + letterSpacing map (sub-pixel kept)', root.lineHeight === '28px' && root.letterSpacing === 0.4, `lh=${root.lineHeight} ls=${root.letterSpacing}`);
  expect('textTransform + textAlign map', root.textTransform === 'uppercase' && root.textAlign === 'center');
}

// ── 3. controls ──────────────────────────────────────────────────────────────
{
  const raw = el({
    tag: 'div',
    styles: { display: 'flex', flexDirection: 'column', visibility: 'visible' },
    children: [
      el({ tag: 'input', attrs: { type: 'checkbox', checked: true } }),
      el({ tag: 'input', attrs: { type: 'radio', checked: false } }),
      el({ tag: 'input', attrs: { type: 'checkbox', checked: true, role: 'switch' } }),
      el({ tag: 'button', attrs: { role: 'switch', ariaChecked: 'true' } }),
      el({ tag: 'select', attrs: { selectValue: 'Administrator' }, rect: { x: 0, y: 0, w: 200, h: 36 } }),
    ],
  });
  const { root } = domToSceneGraph(raw);
  const types = (root.children ?? []).map((c) => c.type);
  expect('controls map to primitives', JSON.stringify(types) === JSON.stringify(['checkbox', 'radio', 'toggle', 'toggle', 'select']), JSON.stringify(types));
  expect('checked state survives', root.children![0].checked === true && root.children![1].checked === undefined);
  expect('role=switch checkbox → toggle', root.children![2].type === 'toggle' && root.children![2].checked === true);
  expect('aria-checked toggle state', root.children![3].checked === true);
  expect('select value survives', root.children![4].value === 'Administrator');
}

// ── 4. media + svg ───────────────────────────────────────────────────────────
{
  const checkSvg = readFileSync(join(dirname(fileURLToPath(import.meta.resolve('lucide-static'))), '..', '..', 'icons', 'check.svg'), 'utf-8');
  const checkD = [...checkSvg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  expect('lucide check matches by path hash', matchIcon(checkD) === 'check');
  expect('unknown path data misses', matchIcon(['M 1 2 L 3 4 Z']) === null);

  const raw = el({
    tag: 'div',
    styles: { display: 'flex', flexDirection: 'row', visibility: 'visible' },
    children: [
      el({ tag: 'img', attrs: { src: 'https://example.com/a.png' }, rect: { x: 0, y: 0, w: 32, h: 32 } }),
      el({ tag: 'img', attrs: { src: '/relative.png', alt: 'avatar' }, rect: { x: 0, y: 0, w: 32, h: 32 } }),
      el({ tag: 'svg', svgPaths: checkD, svgViewBox: '0 0 24 24', rect: { x: 0, y: 0, w: 16, h: 16 }, styles: { display: 'inline', color: 'rgb(34, 197, 94)', visibility: 'visible' } }),
      el({ tag: 'svg', svgPaths: ['M 1 2 L 3 4 Z'], svgViewBox: '0 0 24 24', rect: { x: 0, y: 0, w: 16, h: 16 }, styles: { display: 'inline', visibility: 'visible' } }),
    ],
  });
  const { root, report } = domToSceneGraph(raw);
  const kids = root.children!;
  expect('absolute img → image node', kids[0].type === 'image' && kids[0].src === 'https://example.com/a.png');
  expect('relative img → placeholder + warning', kids[1].type === 'frame' && kids[1].fill === '#E5E7EB' && report.warnings.some((w) => w.includes('relative.png')));
  expect('recognized svg → icon node', kids[2].type === 'icon' && kids[2].icon === 'check' && kids[2].iconSize === 16 && kids[2].iconColor === 'rgb(34, 197, 94)');
  expect('unrecognized svg → path + report', kids[3].type === 'path' && kids[3].d === 'M 1 2 L 3 4 Z' && report.unmatchedIcons.length === 1);
}

// ── 5. invisible drops + grid warning ────────────────────────────────────────
{
  const raw = el({
    tag: 'div',
    styles: { display: 'grid', rowGap: '8px', visibility: 'visible' },
    children: [
      el({ tag: 'div', styles: { display: 'none', visibility: 'visible' }, text: 'hidden' }),
      el({ tag: 'div', attrs: { ariaHidden: true }, text: 'decorative' }),
      el({ tag: 'div', rect: { x: 0, y: 0, w: 0, h: 0 }, text: 'zero' }),
      el({ tag: 'p', text: 'visible' }),
    ],
  });
  const { root, report } = domToSceneGraph(raw);
  expect('grid → vertical + warning', root.layout === 'vertical' && root.gap === 8 && report.warnings.some((w) => w.includes('grid')));
  expect('invisible nodes dropped', root.children!.length === 1 && root.children![0].content === 'visible');
  expect('drops counted', report.counts.dropped === 3, String(report.counts.dropped));
}

// ── 6. flatten: wrappers + text runs + maxDepth ──────────────────────────────
{
  const wrapper = el({
    tag: 'div',
    styles: { display: 'block', visibility: 'visible' },
    rect: { x: 0, y: 0, w: 600, h: 100 },
    children: [el({
      tag: 'div',
      styles: { display: 'flex', flexDirection: 'row', backgroundColor: 'rgb(255, 0, 0)', visibility: 'visible' },
      children: [
        el({ tag: 'span', text: 'Hello', styles: { display: 'inline', fontSize: '14px', color: 'rgb(0, 0, 0)', visibility: 'visible' } }),
        el({ tag: 'span', text: 'world', styles: { display: 'inline', fontSize: '14px', color: 'rgb(0, 0, 0)', visibility: 'visible' } }),
        el({ tag: 'span', text: 'BIG', styles: { display: 'inline', fontSize: '24px', color: 'rgb(0, 0, 0)', visibility: 'visible' } }),
      ],
    })],
  });
  const { root } = domToSceneGraph(wrapper);
  expect('plain wrapper collapsed', root.fill === 'rgb(255, 0, 0)' && root.layout === 'horizontal');
  expect('same-style text runs merged', root.children!.length === 2 && root.children![0].content === 'Hello world');
  expect('different-style run kept', root.children![1].content === 'BIG');

  const { root: kept } = domToSceneGraph(wrapper, { flatten: { collapseWrappers: false, mergeTextRuns: false } });
  expect('knobs disable flattening', kept.children!.length === 1 && kept.children![0].children!.length === 3);

  // maxDepth: a 5-deep chain truncated at 2
  let deep = el({ tag: 'p', text: 'leaf' });
  for (let i = 0; i < 5; i++) deep = el({ tag: 'div', styles: { display: 'block', backgroundColor: `rgb(${i}, 0, 0)`, visibility: 'visible' }, children: [deep] });
  const { root: truncated, report: tr } = domToSceneGraph(deep, { flatten: { maxDepth: 2, collapseWrappers: false } });
  expect('maxDepth truncates + warns', !find(truncated, (n) => n.content === 'leaf') && tr.warnings.some((w) => w.includes('maxDepth')));
}

// ── 7. width strategy ────────────────────────────────────────────────────────
{
  const raw = el({
    tag: 'div',
    rect: { x: 0, y: 0, w: 600, h: 300 },
    styles: { display: 'flex', flexDirection: 'column', paddingTop: '0px', paddingRight: '20px', paddingBottom: '0px', paddingLeft: '20px', backgroundColor: 'rgb(1, 1, 1)', visibility: 'visible' },
    children: [
      el({ tag: 'div', rect: { x: 0, y: 0, w: 560, h: 40 }, styles: { display: 'block', backgroundColor: 'rgb(2, 2, 2)', visibility: 'visible' } }),
      el({ tag: 'div', rect: { x: 0, y: 0, w: 32, h: 32 }, styles: { display: 'block', backgroundColor: 'rgb(3, 3, 3)', visibility: 'visible' } }),
      el({ tag: 'div', rect: { x: 0, y: 0, w: 300, h: 40 }, styles: { display: 'block', backgroundColor: 'rgb(4, 4, 4)', visibility: 'visible' } }),
    ],
  });
  const { root } = domToSceneGraph(raw);
  const kids = root.children!;
  expect('≈parent-content width → "100%"', kids[0].width === '100%', String(kids[0].width));
  expect('small fixed box keeps px', kids[1].width === 32);
  expect('mid-size width stays content-driven', kids[2].width === undefined, String(kids[2].width));
}

// ── 8. report counts ─────────────────────────────────────────────────────────
{
  const raw = el({
    tag: 'div',
    styles: { display: 'flex', flexDirection: 'column', backgroundColor: 'rgb(9, 9, 9)', visibility: 'visible' },
    children: [el({ tag: 'p', text: 'one' }), el({ tag: 'p', text: 'two', styles: { display: 'block', fontSize: '20px', visibility: 'visible' } })],
  });
  const { report } = domToSceneGraph(raw);
  expect('counts: nodes/frames/text', report.counts.nodes === 3 && report.counts.frames === 1 && report.counts.text === 2, JSON.stringify(report.counts));
  expect('report has the slice-B fields ready', Array.isArray(report.snapped) && Array.isArray(report.literals) && Array.isArray(report.unmatchedFonts));
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
