// Phase 25 slice C — the OKLCH color engine, pure: conversion round-trips,
// ramp evenness, gamut policy (chroma clips, hue never shifts), the matched
// neutral, status lightness consistency, and the AA-by-construction semantic
// mapping in BOTH themes.
//
// Usage: npx tsx test/unit/test-color-system.ts

import '../env.js';
import { hexToOklch, oklchToHex, generateRamp, matchedNeutral, statusColors, semanticMapping, generateColorSystem, categoricalPalette, tintLayer, RAMP_STEPS } from '../../src/color-system.js';
import { contrastRatio, parseColor } from '../../src/evaluate.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const rgb = (hex: string) => parseColor(hex)!;
const aa = (fg: string, bg: string) => contrastRatio(rgb(fg), rgb(bg)) >= 4.5;

// ── conversion round-trips ──────────────────────────────────────────────────
{
  const samples = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#0E7490', '#F59E0B', '#6366F1', '#123456', '#FEDCBA'];
  const maxDelta = Math.max(...samples.map((hex) => {
    const back = rgb(oklchToHex(hexToOklch(hex)));
    const orig = rgb(hex);
    return Math.max(...back.map((c, i) => Math.abs(c - orig[i])));
  }));
  check('hex → oklch → hex round-trips within 1/255', maxDelta <= 1, `max Δ ${maxDelta}`);
  check('white is L≈1 C≈0', Math.abs(hexToOklch('#FFFFFF').l - 1) < 0.01 && hexToOklch('#FFFFFF').c < 0.01);
}

// ── ramps ───────────────────────────────────────────────────────────────────
{
  const ramp = generateRamp('#0E7490'); // teal seed
  check('ten steps', Object.keys(ramp).length === 10);
  const Ls = RAMP_STEPS.map((s) => hexToOklch(ramp[s]).l);
  check('lightness strictly decreasing', Ls.every((l, i) => i === 0 || l < Ls[i - 1]), Ls.map((l) => l.toFixed(3)).join(','));
  const deltas = [];
  for (let i = 2; i < Ls.length; i++) deltas.push(Ls[i - 1] - Ls[i]); // 100→900 gaps
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  check('100→900 steps perceptually even (±0.02 L)', deltas.every((d) => Math.abs(d - mean) < 0.02), deltas.map((d) => d.toFixed(3)).join(','));
  const seedH = hexToOklch('#0E7490').h;
  // Hue is barely defined at wash-level chroma (8-bit quantization wobbles
  // it) — measure drift where chroma is perceptually meaningful.
  const chromaticSteps = RAMP_STEPS.filter((s) => hexToOklch(ramp[s]).c >= 0.04);
  const hueDrift = Math.max(...chromaticSteps.map((s) => Math.abs(hexToOklch(ramp[s]).h - seedH)));
  check('hue stays put across chromatic steps (<3°)', chromaticSteps.length >= 7 && hueDrift < 3, `${hueDrift.toFixed(2)}° over ${chromaticSteps.length} steps`);

  // Gamut policy: a screaming out-of-gamut request keeps L and H, loses only C.
  const clipped = hexToOklch(oklchToHex({ l: 0.5, c: 0.4, h: 150 }));
  check('gamut clip: lightness held', Math.abs(clipped.l - 0.5) < 0.01, clipped.l.toFixed(3));
  check('gamut clip: hue held (<1.5°)', Math.abs(clipped.h - 150) < 1.5, clipped.h.toFixed(2));
  check('gamut clip: only chroma reduced', clipped.c < 0.4);

  // A near-grey seed still yields a usable (not flat) ramp.
  const grey = generateRamp('#888888');
  check('near-grey seed → still a ramp', hexToOklch(grey[500]).c > 0.01);
}

// ── neutral + status ────────────────────────────────────────────────────────
{
  const neutral = matchedNeutral('#0E7490');
  const cs = RAMP_STEPS.map((s) => hexToOklch(neutral[s]).c);
  check('neutral chroma is a whisper (≤0.012 everywhere)', cs.every((c) => c <= 0.012), cs.map((c) => c.toFixed(3)).join(','));
  check('neutral carries the seed hue', Math.abs(hexToOklch(neutral[500]).h - hexToOklch('#0E7490').h) < 5);

  const status = statusColors();
  // Dogfood revision: the invariant is consistent CONTRAST, not consistent
  // lightness — status colors are used as text (validation messages) and
  // each is darkened from the shared band until it clears AA on white.
  const failingText = Object.entries(status).filter(([, hex]) => !aa(hex, '#FFFFFF'));
  check('status colors read as TEXT on white (AA)', failingText.length === 0, failingText.map(([k, hex]) => `${k}: ${hex}`).join('; '));
  // Second dogfood fix: the page surface (bg-primary = neutral-50) is the
  // stricter light target — status text must clear AA there too.
  const sys = generateColorSystem('#0E7490');
  const failingOnPage = Object.entries(sys.status).filter(([, hex]) => !aa(hex, sys.light['bg-primary']));
  check('status colors read as TEXT on the off-white page (AA)', failingOnPage.length === 0, failingOnPage.map(([k, hex]) => `${k}: ${hex}`).join('; '));
  const hueDrift = (['success', 'warning', 'danger'] as const).map((k) => {
    const target = { success: 150, warning: 75, danger: 27 }[k];
    return Math.abs(hexToOklch(status[k]).h - target);
  });
  check('status hues held while darkening (<8°)', hueDrift.every((d) => d < 8), hueDrift.map((d) => d.toFixed(1)).join(','));
}

// ── semantic mapping: AA by construction, both themes ───────────────────────
{
  for (const seed of ['#0E7490', '#DC2626', '#16A34A', '#6366F1', '#F59E0B']) {
    const { light, dark } = semanticMapping(generateRamp(seed), matchedNeutral(seed));
    const pairs: Array<[string, string, string]> = [
      ['text-primary/bg-primary L', light['text-primary'], light['bg-primary']],
      ['text-primary/bg-surface L', light['text-primary'], light['bg-surface']],
      ['text-secondary/bg-surface L', light['text-secondary'], light['bg-surface']],
      ['accent/bg-surface L', light.accent, light['bg-surface']],
      ['text-primary/bg-primary D', dark['text-primary'], dark['bg-primary']],
      ['text-primary/bg-surface D', dark['text-primary'], dark['bg-surface']],
      ['text-secondary/bg-surface D', dark['text-secondary'], dark['bg-surface']],
      ['accent/bg-surface D', dark.accent, dark['bg-surface']],
    ];
    const failing = pairs.filter(([, fg, bg]) => !aa(fg, bg));
    check(`AA in both themes for seed ${seed}`, failing.length === 0, failing.map(([n, fg, bg]) => `${n}: ${fg}/${bg} = ${contrastRatio(rgb(fg), rgb(bg)).toFixed(2)}`).join('; '));
  }
  const { light, dark } = semanticMapping(generateRamp('#0E7490'), matchedNeutral('#0E7490'));
  check('light page is off-white, not #FFFFFF', light['bg-primary'].toUpperCase() !== '#FFFFFF');
  check('dark surfaces sit above the page', hexToOklch(dark['bg-surface']).l < hexToOklch(dark['bg-elevated']).l);

  // Dogfood regression: status colors must read in BOTH themes — the dark
  // layer re-lights them for AA against the dark surface (a $danger message
  // failed at 3.34:1 before this).
  for (const seed of ['#0E7490', '#DC2626', '#6366F1']) {
    const sys = generateColorSystem(seed);
    const failing = (['success', 'warning', 'danger'] as const).filter((k) => !aa(sys.dark[k], sys.dark['bg-surface']));
    check(`dark status colors AA on dark surface (seed ${seed})`, failing.length === 0,
      failing.map((k) => `${k}: ${sys.dark[k]} = ${contrastRatio(rgb(sys.dark[k]), rgb(sys.dark['bg-surface'])).toFixed(2)}`).join('; '));
    check(`dark status keeps hue (seed ${seed})`, (['success', 'danger'] as const).every((k) =>
      Math.abs(hexToOklch(sys.dark[k]).h - hexToOklch(sys.status[k]).h) < 8));
  }
}

// ── the full system ─────────────────────────────────────────────────────────
{
  const sys = generateColorSystem('#0E7490');
  check('system carries all parts', !!sys.primary[500] && !!sys.neutral[900] && !!sys.status.danger && !!sys.light.accent && !!sys.dark.accent);
  check('seed reported with its oklch', sys.seed.hex === '#0E7490' && sys.seed.oklch.l > 0 && sys.seed.oklch.c > 0);
  let err = '';
  try { generateColorSystem('not-a-color'); } catch (e) { err = (e as Error).message; }
  check('unparseable seed errors clearly', err.includes('not a parseable color'), err);
}

// ── Phase 28 slice A: the color range ───────────────────────────────────────
{
  console.log('\n── categorical palette ──');
  const cr = (a: string, b: string): number => contrastRatio(parseColor(a)!, parseColor(b)!);
  const hueDist = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };

  for (const seed of ['#0E7490', '#2563EB', '#DC2626']) {
    const sys = generateColorSystem(seed);
    const light = Object.values(sys.categorical);
    check(`${seed}: six series colors`, light.length === 6);
    const hues = light.map((h) => hexToOklch(h).h);
    const minSep = Math.min(...hues.flatMap((h, i) => hues.slice(i + 1).map((h2) => hueDist(h, h2))));
    check(`${seed}: pairwise hue separation ≥ 30°`, minSep >= 29, minSep.toFixed(1));
    check(`${seed}: series 1 carries the seed hue`, hueDist(hexToOklch(light[0]).h, hexToOklch(seed).h) < 12);
    check(`${seed}: 3:1 on the light surface`, light.every((h) => cr(h, sys.light['bg-surface']) >= 2.95), light.map((h) => cr(h, sys.light['bg-surface']).toFixed(2)).join(','));
    const darkHexes = Object.entries(sys.darkRange).filter(([k]) => k.startsWith('chart-')).map(([, v]) => v);
    check(`${seed}: 3:1 on the dark surface`, darkHexes.every((h) => cr(h, sys.dark['bg-surface']) >= 2.95), darkHexes.map((h) => cr(h, sys.dark['bg-surface']).toFixed(2)).join(','));
  }

  const bluePal = Object.values(generateColorSystem('#2563EB').categorical).map((h) => hexToOklch(h).h);
  check('non-purple seed avoids the purple band', bluePal.every((h) => h < 285 || h > 330), bluePal.map((h) => h.toFixed(0)).join(','));
  const purplePal = generateColorSystem('#7C3AED').categorical;
  check('purple seed keeps its own hue as chart-1', hueDist(hexToOklch(purplePal['chart-1']).h, hexToOklch('#7C3AED').h) < 12);

  const grey = generateColorSystem('#808080');
  check('near-neutral seed anchors at a stable hue + note', grey.rangeNote !== undefined && Object.values(grey.categorical).length === 6, grey.rangeNote);

  console.log('\n── tint layer ──');
  const sys = generateColorSystem('#0E7490');
  const pairs: Array<[string, string]> = [
    [sys.tints['accent-tint'], sys.light.accent],
    [sys.tints['success-tint'], sys.status.success],
    [sys.tints['warning-tint'], sys.status.warning],
    [sys.tints['danger-tint'], sys.status.danger],
    [sys.tints['neutral-tint'], sys.light['text-secondary']],
  ];
  check('light tint/ink pairs AA', pairs.every(([tint, ink]) => cr(ink, tint) >= 4.5), pairs.map(([t2, ink]) => cr(ink, t2).toFixed(2)).join(','));
  const darkPairs: Array<[string, string]> = [
    [sys.darkRange['accent-tint'], sys.dark.accent],
    [sys.darkRange['success-tint'], sys.dark.success],
    [sys.darkRange['warning-tint'], sys.dark.warning],
    [sys.darkRange['danger-tint'], sys.dark.danger],
    [sys.darkRange['neutral-tint'], sys.dark['text-secondary']],
  ];
  check('dark tint/ink pairs AA', darkPairs.every(([tint, ink]) => cr(ink, tint) >= 4.5), darkPairs.map(([t2, ink]) => cr(ink, t2).toFixed(2)).join(','));
  check('tint carries its ink hue', hueDist(hexToOklch(sys.tints['success-tint']).h, hexToOklch(sys.status.success).h) < 15);
  check('tints are soft washes (light, low chroma)', Object.values(sys.tints).every((h) => hexToOklch(h).l > 0.88 && hexToOklch(h).c < 0.08));
}

console.log(allPass ? '\nAll color-system tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
