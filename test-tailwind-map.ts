import './test-env.js';
// Phase 17 Slice B — Tailwind intent mapping + token snapping (pure, no Chrome).
// Covers: utility families (spacing/layout/sizing/radius/border/typography/
// color), theme widening, palette fallthrough, intent merge in domToSceneGraph
// (fill-gaps vs override semantics), snapToTokens (exact, nearest, tie
// reporting, unresolved-$ref warning, scale matches, literal cap behavior).
//
// Usage: npx tsx test-tailwind-map.ts

import { classesToProps } from './src/tailwind-map.js';
import { domToSceneGraph, snapToTokens, parseCssColor, type RawDomNode, type ImportReport } from './src/import.js';
import type { DesignVariables, SceneNode } from './src/types.js';

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

// ── 1. utility families ──────────────────────────────────────────────────────
{
  const { props } = classesToProps(['flex', 'flex-col', 'items-center', 'justify-between', 'gap-4', 'p-6', 'rounded-xl', 'border', 'overflow-hidden', 'opacity-90']);
  expect('layout family', props.layout === 'vertical' && props.alignItems === 'center' && props.justifyContent === 'space-between');
  expect('spacing scale (4px base)', props.gap === 16 && props.padding === 24);
  expect('radius v4 names', props.cornerRadius === 12);
  expect('border + misc', props.strokeWidth === 1 && props.overflow === 'hidden' && props.opacity === 0.9);

  const { props: t } = classesToProps(['text-sm', 'font-semibold', 'uppercase', 'text-center', 'leading-tight']);
  expect('typography family', t.fontSize === 14 && t.fontWeight === 600 && t.textTransform === 'uppercase' && t.textAlign === 'center' && t.lineHeight === 1.25);

  const { props: sz } = classesToProps(['w-full', 'max-w-2xl', 'h-10']);
  expect('sizing family', sz.width === '100%' && sz.maxWidth === 672 && sz.height === 40);

  const { props: sides } = classesToProps(['px-4', 'py-2']);
  expect('asymmetric padding composes', JSON.stringify(sides.padding) === '[8,16]');

  const { props: arb } = classesToProps(['gap-[13px]', 'p-px', 'w-[37px]', 'rounded-[5px]']);
  expect('arbitrary px values', arb.gap === 13 && arb.padding === 1 && arb.width === 37 && arb.cornerRadius === 5);
}

// ── 2. color rules ───────────────────────────────────────────────────────────
{
  const { props, tokenRefs } = classesToProps(['bg-surface', 'text-primary', 'border-muted']);
  expect('custom names → $token refs', props.fill === '$surface' && props.color === '$primary' && props.stroke === '$muted');
  expect('tokenRefs recorded', tokenRefs.length === 3 && tokenRefs.every((t) => t.token.startsWith('$')));

  const { props: lit } = classesToProps(['bg-white', 'text-black']);
  expect('white/black → literals', lit.fill === '#FFFFFF' && lit.color === '#000000');

  const { props: pal, tokenRefs: palRefs } = classesToProps(['bg-red-500', 'text-slate-50']);
  expect('palette classes → v4 hex literals (Chrome-generated)', pal.fill === '#fb2c36' && pal.color === '#f8fafc', JSON.stringify(pal));
  expect('palette literals are NOT $token refs', palRefs.length === 0);

  const { props: arb } = classesToProps(['bg-[#123456]']);
  expect('arbitrary colors fall through', arb.fill === undefined);

  const { props: themed } = classesToProps(['bg-red-500'], { 'red-500': '#custom' });
  expect('theme overrides the palette', themed.fill === '$red-500');

  const { props: ambiguous } = classesToProps(['text-lg', 'text-secondary']);
  expect('text- disambiguates size vs color', ambiguous.fontSize === 18 && ambiguous.color === '$secondary');
}

// ── 3. intent merge in domToSceneGraph ───────────────────────────────────────
{
  // Bare Tailwind snippet: computed styles empty → intent provides everything.
  const bare = el({
    tag: 'div',
    classes: ['flex', 'flex-col', 'gap-3', 'p-6', 'bg-surface', 'rounded-lg'],
    children: [el({ tag: 'span', classes: ['text-sm', 'text-secondary'], text: 'Label', styles: { display: 'inline', visibility: 'visible' } })],
  });
  const { root, report } = domToSceneGraph(bare);
  expect('intent fills unstyled geometry', root.layout === 'vertical' && root.gap === 12 && root.padding === 24 && root.cornerRadius === 8);
  expect('intent token fill applied + reported', root.fill === '$surface' && report.snapped.some((s) => s.token === '$surface' && s.from === '(unstyled)'));
  const label = root.children![0];
  expect('text intent applied', label.fontSize === 14 && label.color === '$secondary');

  // Computed styles present (CSS ran): geometry keeps computed, color $ref overrides.
  const styled = el({
    tag: 'div',
    classes: ['gap-4', 'bg-surface'],
    styles: { display: 'flex', flexDirection: 'row', rowGap: '20px', columnGap: '20px', backgroundColor: 'rgb(30, 30, 30)', visibility: 'visible' },
    children: [el({ tag: 'span', text: 'x', styles: { display: 'inline', visibility: 'visible' } })],
  });
  const { root: r2, report: rep2 } = domToSceneGraph(styled);
  expect('computed geometry wins over intent', r2.gap === 20, String(r2.gap));
  expect('token intent overrides computed color', r2.fill === '$surface' && rep2.snapped.some((s) => s.from === 'rgb(30, 30, 30)'));

  // Palette literals are fill-gap only: bare snippet gets them, computed CSS keeps its value.
  const barePalette = el({ tag: 'div', classes: ['bg-gray-200'], children: [el({ tag: 'span', text: 'x', styles: { display: 'inline', visibility: 'visible' } })] });
  const { root: r3 } = domToSceneGraph(barePalette);
  expect('palette fills an unstyled snippet', r3.fill === '#e5e7eb', String(r3.fill));

  const styledPalette = el({
    tag: 'div', classes: ['bg-gray-200'],
    styles: { display: 'block', backgroundColor: 'rgb(1, 2, 3)', visibility: 'visible' },
    children: [el({ tag: 'span', text: 'x', styles: { display: 'inline', visibility: 'visible' } })],
  });
  const { root: r4 } = domToSceneGraph(styledPalette);
  expect('computed color beats the palette literal', r4.fill === 'rgb(1, 2, 3)', String(r4.fill));
}

// ── 4. parseCssColor ─────────────────────────────────────────────────────────
{
  expect('hex6', JSON.stringify(parseCssColor('#b71421')) === '[183,20,33]');
  expect('hex3', JSON.stringify(parseCssColor('#fff')) === '[255,255,255]');
  expect('rgb()', JSON.stringify(parseCssColor('rgb(30, 30, 30)')) === '[30,30,30]');
  expect('opaque rgba ok', JSON.stringify(parseCssColor('rgba(1, 2, 3, 1)')) === '[1,2,3]');
  expect('translucent rgba rejected', parseCssColor('rgba(0, 0, 0, 0.5)') === null);
  expect('garbage rejected', parseCssColor('linear-gradient(x)') === null);
}

// ── 5. snapToTokens ──────────────────────────────────────────────────────────
{
  const vars: DesignVariables = {
    colors: { primary: '#b71421', surface: '#1e1e1e', border: '#3a3a3a', almostPrimary: '#b91622' },
    spacing: { sm: 8, md: 16, lg: 24 },
    radius: { md: 8, xl: 12 },
    typography: { body: { fontSize: 14 }, heading: { fontSize: 20 } },
  };
  const mkReport = (): ImportReport => ({ counts: { nodes: 0, frames: 0, text: 0, maxDepth: 0, dropped: 0 }, snapped: [], literals: [], scaleMatches: [], unmatchedFonts: [], unmatchedIcons: [], warnings: [] });

  // exact match snaps
  const tree1: SceneNode = { id: 'a', type: 'frame', fill: 'rgb(30, 30, 30)', children: [{ id: 'b', type: 'text', content: 'x', color: '#B71421' }] };
  const r1 = mkReport();
  snapToTokens(tree1, vars, r1);
  expect('exact rgb snaps to $surface', tree1.fill === '$surface');
  expect('case-insensitive hex — near-tie with $almostPrimary is reported, not guessed',
    (tree1.children![0].color === '$primary') !== (r1.warnings.some((w) => w.includes('almostPrimary'))),
    JSON.stringify({ color: tree1.children![0].color, warnings: r1.warnings }));

  // exact match must win unconditionally even with a near sibling token
  expect('exact match snaps despite near-tie token', tree1.children![0].color === '$primary', String(tree1.children![0].color));

  // nearest within tolerance snaps; far value stays literal
  const tree2: SceneNode = { id: 'c', type: 'frame', fill: 'rgb(58, 58, 60)', children: [{ id: 'd', type: 'frame', fill: '#00ff88' }] };
  const r2 = mkReport();
  snapToTokens(tree2, vars, r2);
  expect('near color snaps to $border', tree2.fill === '$border', String(tree2.fill));
  expect('far color stays literal + reported', tree2.children![0].fill === '#00ff88' && r2.literals.some((l) => l.value === '#00ff88'));

  // unresolved $ref (from Tailwind intent) warns
  const tree3: SceneNode = { id: 'e', type: 'frame', fill: '$mystery' };
  const r3 = mkReport();
  snapToTokens(tree3, vars, r3);
  expect('unresolved $ref warns', r3.warnings.some((w) => w.includes('$mystery') && w.includes('set_variables')));

  // scale matches reported, values untouched
  const tree4: SceneNode = { id: 'f', type: 'frame', gap: 16, padding: 24, cornerRadius: 8, children: [{ id: 'g', type: 'text', content: 'x', fontSize: 14 }] };
  const r4 = mkReport();
  snapToTokens(tree4, vars, r4);
  const matched = (prop: string, token: string) => r4.scaleMatches.some((m) => m.prop === prop && m.token === token);
  expect('scale matches reported (gap/padding/radius/fontSize)', matched('gap', '$md') && matched('padding', '$lg') && matched('cornerRadius', '$md') && matched('fontSize', '$body'), JSON.stringify(r4.scaleMatches));
  expect('number props not rewritten', tree4.gap === 16 && tree4.cornerRadius === 8);
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
