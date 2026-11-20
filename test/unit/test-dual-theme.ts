// Phase 25 slice D — dual theme: the sparse dark token layer, theme-aware
// resolution/rendering, the both-mode contrast run with tagged issues, the
// APCA advisory (info, never blocking), and cache/hash interactions.
//
// Usage: npx tsx test/unit/test-dual-theme.ts

import '../env.js';
import { resolveVariables, mergeDesignTokens, setVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { evaluateCanvas, apcaLc, contrastRatio, parseColor } from '../../src/evaluate.js';
import { createCanvas, addVariant } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { evalCacheKey } from '../../src/viewer.js';
import { canvasVersionHash } from '../../src/version.js';
import { generateColorSystem } from '../../src/color-system.js';
import type { SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const TOKENS = {
  colors: { surface: '#FFFFFF', ink: '#111827', accent: '#2563EB' },
  dark: { colors: { surface: '#111318', ink: '#F5F5F4' } }, // accent NOT overridden — inherits
};

// ── resolution ──────────────────────────────────────────────────────────────
{
  const root: SceneNode = { id: 'doc', type: 'document', children: [
    { id: 'card', type: 'frame', fill: '$surface', children: [
      { id: 't', type: 'text', content: 'Hello', color: '$ink' },
      { id: 'a', type: 'text', content: 'Link', color: '$accent' },
    ] },
  ] } as SceneNode;
  const light = resolveVariables(root, TOKENS);
  check('light: base colors resolve', light.children![0].fill === '#FFFFFF' && light.children![0].children![0].color === '#111827');
  const dark = resolveVariables(root, TOKENS, { theme: 'dark' });
  check('dark: overridden tokens flip', dark.children![0].fill === '#111318' && dark.children![0].children![0].color === '#F5F5F4');
  check('dark: non-overridden tokens inherit light', dark.children![0].children![1].color === '#2563EB');
  const noLayer = resolveVariables(root, { colors: TOKENS.colors }, { theme: 'dark' });
  check('theme: dark without a dark layer is a no-op', noLayer.children![0].fill === '#FFFFFF');

  // The dark render reaches the HTML.
  const html = renderToHtml(dark, 800, 600);
  check('dark render emits dark values', html.includes('#111318') && html.includes('#F5F5F4'));
}

// ── layer merge (workspace dark flows to the canvas) ────────────────────────
{
  const merged = mergeDesignTokens(
    { colors: { surface: '#FFF' }, dark: { colors: { surface: '#101010' } } },
    { dark: { colors: { border: '#333333' } } },
  );
  check('mergeDesignTokens merges dark key-wise', merged.dark?.colors?.surface === '#101010' && merged.dark?.colors?.border === '#333333');
}

// ── evaluate: both-mode contrast, tagged issues, min score ─────────────────
{
  // ink flips to a color that FAILS on the dark surface; light stays clean.
  const c = createCanvas('Dual Contrast');
  c.variables = {
    colors: { surface: '#FFFFFF', ink: '#111827' },
    dark: { colors: { surface: '#15171C', ink: '#3A3F4A' } }, // dark ink ≈ invisible on dark surface
  };
  parseAndExecute(c.root, `
card=I("document", { type: "frame", fill: "$surface", padding: 24 })
I(card, { type: "text", content: "Quarterly revenue report", color: "$ink", fontSize: 14 })
`, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['color'] });
  const darkErrors = r.issues.filter((i) => i.severity === 'error' && i.theme === 'dark');
  const lightErrors = r.issues.filter((i) => i.severity === 'error' && !i.theme);
  check('dark-only failure caught + tagged', darkErrors.length === 1 && lightErrors.length === 0, JSON.stringify(r.issues.map((i) => ({ s: i.severity, t: i.theme }))));
  check('dark failure carries NO literal fix (points at the dark layer)', darkErrors[0].fix === undefined && darkErrors[0].suggestion!.includes('dark token layer'));
  check('score takes the worse theme', (r.categories.find((x) => x.name === 'color')?.score ?? 100) < 100);

  // No dark layer → single run, no tagged issues.
  const plain = createCanvas('Single Theme');
  plain.variables = { colors: { surface: '#FFFFFF', ink: '#111827' } };
  parseAndExecute(plain.root, `
card=I("document", { type: "frame", fill: "$surface", padding: 24 })
I(card, { type: "text", content: "Hello there", color: "$ink", fontSize: 14 })
`, plain);
  const rp = await evaluateCanvas(plain, { mode: 'fast', categories: ['color'] });
  check('no dark layer → no themed issues', rp.issues.every((i) => i.theme === undefined));
}

// ── APCA ────────────────────────────────────────────────────────────────────
{
  const rgb = (hex: string) => parseColor(hex)!;
  const blackOnWhite = apcaLc(rgb('#000000'), rgb('#FFFFFF'));
  const whiteOnBlack = apcaLc(rgb('#FFFFFF'), rgb('#000000'));
  check('APCA: black-on-white ≈ +106', Math.abs(blackOnWhite - 106) < 2, String(blackOnWhite));
  check('APCA: white-on-black ≈ −107 (polarity matters)', Math.abs(whiteOnBlack + 107) < 2, String(whiteOnBlack));
  check('APCA: identical pair → 0', apcaLc(rgb('#888888'), rgb('#888888')) === 0);
  const mid = apcaLc(rgb('#767676'), rgb('#FFFFFF'));
  check('APCA: mid-grey on white lands mid-band', mid > 50 && mid < 75, String(mid));

  // The advisory: a pair that PASSES WCAG but is APCA-weak → info issue.
  const fg = '#757575';
  const wcag = contrastRatio(rgb(fg), rgb('#FFFFFF'));
  const lc = Math.abs(apcaLc(rgb(fg), rgb('#FFFFFF')));
  check('premise: passes WCAG, weak by APCA', wcag >= 4.5 && lc < 75, `wcag ${wcag.toFixed(2)} lc ${lc}`);
  const c = createCanvas('APCA Advisory');
  parseAndExecute(c.root, `
card=I("document", { type: "frame", fill: "#FFFFFF", padding: 24 })
I(card, { type: "text", content: "Secondary caption text", color: "${fg}", fontSize: 14 })
`, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['color'] });
  const advisory = r.issues.filter((i) => i.message.includes('APCA advisory'));
  check('APCA advisory fires as info', advisory.length === 1 && advisory[0].severity === 'info', JSON.stringify(r.issues));
  check('APCA advisory is score-neutral + non-blocking', (r.categories.find((x) => x.name === 'color')?.score) === 100);
}

// ── generator writes the dark layer; caches/hashes react correctly ─────────
{
  const c = createCanvas('Seeded');
  const system = generateColorSystem('#0E7490');
  const kBefore = evalCacheKey(c);
  const hBefore = canvasVersionHash(c);
  setVariables(c, { colors: { ...system.light }, dark: { colors: { ...system.dark } } });
  check('dark layer stored sparsely', Object.keys(c.variables.dark!.colors!).length === Object.keys(system.dark).length);
  check('dark layer moves the eval cache key', evalCacheKey(c) !== kBefore);
  check('dark layer moves the versionHash (design content)', canvasVersionHash(c) !== hBefore);

  // Generated system: both themes pass the dual contrast run.
  parseAndExecute(c.root, `
card=I("document", { type: "frame", fill: "$bg-surface", padding: 24 })
I(card, { type: "text", content: "Primary reading text", color: "$text-primary", fontSize: 14 })
I(card, { type: "text", content: "Secondary supporting text", color: "$text-secondary", fontSize: 13 })
`, c);
  const r = await evaluateCanvas(c, { mode: 'fast', categories: ['color'] });
  check('generated dual-theme system: zero contrast errors in both themes', r.issues.every((i) => i.severity !== 'error'), JSON.stringify(r.issues.filter((i) => i.severity === 'error')));
}

// ── variants + theme are orthogonal ─────────────────────────────────────────
{
  const base = createCanvas('Orthogonal');
  base.variables = { colors: { surface: '#FFF' }, dark: { colors: { surface: '#101010' } } };
  parseAndExecute(base.root, `I("document", { type: "frame", fill: "$surface" })`, base);
  const { canvas: variant } = addVariant(base.id, 'empty');
  check('variants carry the dark layer', variant.variables.dark?.colors?.surface === '#101010');
}

console.log(allPass ? '\nAll dual-theme tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
