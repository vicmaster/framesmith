import './test-env.js';
/**
 * Phase 12 — cliché & craft guardrails. Exercises the `cliche` evaluation
 * category: one fixture per tell, genre-relax, honest-content guard, the
 * mechanical autofix surfacing, and a clean design that flags nothing.
 * Run with: npx tsx test-cliche.ts
 */
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { evaluateCanvas, rgbToHsl, parseAlpha } from './src/evaluate.js';
import type { Canvas } from './src/types.js';
import { shutdown } from './src/screenshot.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

function build(name: string, ops: string): Canvas {
  const canvas = createCanvas(name);
  parseAndExecute(canvas.root, ops);
  return canvas;
}
async function cliche(canvas: Canvas, genre?: string) {
  return (await evaluateCanvas(canvas, { mode: 'fast', categories: ['cliche'], genre })).issues;
}
const tells = (issues: { tell?: string }[], t: string) => issues.filter((i) => i.tell === t);

// --- T0: color utils ---
async function testColorUtils() {
  console.log('\n── color utils (rgbToHsl / parseAlpha) ──');
  const indigo = rgbToHsl([99, 102, 241]); // #6366f1
  assert(indigo.h >= 230 && indigo.h <= 245 && indigo.s > 0.8, 'indigo #6366f1 → high-sat blue-violet hue');
  const grey = rgbToHsl([128, 128, 128]);
  assert(grey.s === 0, 'grey has zero saturation');
  assert(parseAlpha('#00000080') > 0.49 && parseAlpha('#00000080') < 0.51, 'hex8 alpha ~0.5');
  assert(parseAlpha('rgba(0,0,0,0.6)') === 0.6, 'rgba alpha 0.6');
  assert(parseAlpha('#112233') === 1, 'opaque hex → alpha 1');
}

// --- FR-2 / C4: default purple accent ---
async function testAccentHue() {
  console.log('\n── tell: default purple/indigo accent ──');

  const literal = build('purple-literal', `
page=I("document", {type:"frame", width:1200, fill:"#0B1120"})
cta=I(page, {type:"frame", name:"CTA", width:160, padding:16, cornerRadius:8, fill:"#6366f1"})
I(cta, {type:"text", content:"Get started", color:"#ffffff"})`);
  const li = tells(await cliche(literal), 'accent-hue');
  assert(li.length === 1, 'literal #6366f1 flags one accent-hue tell');
  assert(!!li[0].fix && li[0].fix.op.includes('#2563EB'), 'known-default literal → autofix to neutral accent');

  const tokened = build('purple-token', `
page=I("document", {type:"frame", width:1200, fill:"#0B1120"})
cta=I(page, {type:"frame", name:"CTA", width:160, padding:16, cornerRadius:8, fill:"$accent"})
I(cta, {type:"text", content:"Get started", color:"#ffffff"})`);
  tokened.variables = { colors: { accent: '#8b5cf6' } };
  const ti = tells(await cliche(tokened), 'accent-hue');
  assert(ti.length === 1, '$token purple flags one accent-hue tell');
  assert(!ti[0].fix, '$token-sourced purple → suggestion only, no batch_design fix');

  const blue = build('blue-accent', `
page=I("document", {type:"frame", width:1200, fill:"#0B1120"})
cta=I(page, {type:"frame", width:160, padding:16, cornerRadius:8, fill:"#2563EB"})
I(cta, {type:"text", content:"Get started", color:"#ffffff"})`);
  assert(tells(await cliche(blue), 'accent-hue').length === 0, 'a blue accent does not flag');

  const bg = build('purple-bg', `
page=I("document", {type:"frame", width:1200, fill:"#7c3aed"})
I(page, {type:"text", content:"Hero", fontSize:48, color:"#ffffff"})`);
  assert(tells(await cliche(bg), 'accent-hue').length === 0, 'full-bleed purple background is not flagged as an accent');
}

// --- FR-8 / C3: genre-aware loosening ---
async function testGenreRelax() {
  console.log('\n── genre relax (material allows purple) ──');
  // A clearly-saturated violet (the kind that flags) so the relax is provable.
  // Material's own muted #6750a4 (s≈0.34) sits below the tell threshold anyway.
  const ops = `
page=I("document", {type:"frame", width:1200, fill:"#fffbfe"})
cta=I(page, {type:"frame", width:160, padding:16, cornerRadius:8, fill:"#7c3aed"})
I(cta, {type:"text", content:"Get started", color:"#ffffff"})`;

  const viaOption = build('material-opt', ops);
  assert(tells(await cliche(viaOption, 'material'), 'accent-hue').length === 0, 'explicit genre:"material" suppresses accent-hue');
  assert(tells(await cliche(viaOption), 'accent-hue').length === 1, 'without genre, the same purple flags');

  const viaProvenance = build('material-prov', ops);
  viaProvenance.metadata = { provenance: { preset: 'material', at: new Date().toISOString() } };
  assert(tells(await cliche(viaProvenance), 'accent-hue').length === 0, 'provenance preset "material" suppresses accent-hue');
}

// --- FR-3 / C8 / C9: gradient & glow ---
async function testGradientGlow() {
  console.log('\n── tell: gradient / glow overuse ──');

  const grad = createCanvas('gradients');
  parseAndExecute(grad.root, `page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})`);
  const page = grad.root.children![0];
  for (let i = 0; i < 3; i++) {
    page.children = page.children ?? [];
    page.children.push({ id: `g${i}`, type: 'frame', width: 300, height: 120,
      gradient: { type: 'linear', angle: 135, stops: [{ color: '#6366f1' }, { color: '#ec4899' }] } });
  }
  assert(tells(await cliche(grad), 'gradient-glow').length === 1, '3 gradient nodes flag overuse');

  const glow = createCanvas('glow');
  parseAndExecute(glow.root, `page=I("document", {type:"frame", width:1200})`);
  glow.root.children![0].children = [{ id: 'card', type: 'frame', name: 'Card', width: 320, height: 200, fill: '#111827',
    shadows: [{ x: 0, y: 0, blur: 40, color: 'rgba(99,102,241,0.6)' }] }];
  const gi = tells(await cliche(glow), 'gradient-glow');
  assert(gi.length === 1 && !gi[0].fix, 'a colored glow shadow flags (warning, no autofix)');

  const flat = build('flat-shadow', `
page=I("document", {type:"frame", width:1200})
card=I(page, {type:"frame", width:320, height:200, fill:"#111827", shadow:"0 2px 8px rgba(0,0,0,0.2)"})`);
  assert(tells(await cliche(flat), 'gradient-glow').length === 0, 'a subtle neutral shadow does not flag');
}

// --- FR-4 / C6: fake chrome ---
async function testFakeChrome() {
  console.log('\n── tell: fake browser/OS chrome ──');
  const c = createCanvas('chrome');
  parseAndExecute(c.root, `page=I("document", {type:"frame", width:1200})`);
  const page = c.root.children![0];
  page.children = [{ id: 'bar', type: 'frame', name: 'window-bar', layout: 'horizontal', gap: 8, width: 400, children: [
    { id: 'd1', type: 'ellipse', width: 12, height: 12, fill: '#ff5f56' },
    { id: 'd2', type: 'ellipse', width: 12, height: 12, fill: '#ffbd2e' },
    { id: 'd3', type: 'ellipse', width: 12, height: 12, fill: '#27c93f' },
  ] }];
  const fi = tells(await cliche(c), 'fake-chrome');
  assert(fi.length === 1, 'three traffic-light dots flag fake-chrome');
  assert(!!fi[0].fix && fi[0].fix.op.startsWith('D('), 'dedicated chrome strip → delete autofix');

  const clean = build('two-dots', `
page=I("document", {type:"frame", width:1200, layout:"horizontal", gap:8})
I(page, {type:"ellipse", width:12, height:12, fill:"#22c55e"})
I(page, {type:"ellipse", width:12, height:12, fill:"#ef4444"})`);
  assert(tells(await cliche(clean), 'fake-chrome').length === 0, 'only two dots → not flagged');
}

// --- FR-5 / C7: hanging header ---
async function testHangingHeader() {
  console.log('\n── tell: hanging tag-left/heading-right header ──');
  const hang = build('hanging', `
page=I("document", {type:"frame", width:1200})
hdr=I(page, {type:"frame", name:"header", layout:"horizontal", gap:16})
I(hdr, {type:"text", content:"FEATURES", fontSize:12})
I(hdr, {type:"text", content:"Everything you need", fontSize:36})`);
  const hi = tells(await cliche(hang), 'hanging-header');
  assert(hi.length === 1 && hi[0].severity === 'info' && !hi[0].fix, 'eyebrow beside heading flags (info, no fix)');

  const stacked = build('stacked', `
page=I("document", {type:"frame", width:1200})
hdr=I(page, {type:"frame", layout:"vertical", gap:8})
I(hdr, {type:"text", content:"FEATURES", fontSize:12})
I(hdr, {type:"text", content:"Everything you need", fontSize:36})`);
  assert(tells(await cliche(stacked), 'hanging-header').length === 0, 'stacked eyebrow-over-heading does not flag');
}

// --- FR-6 / C5: honest content ---
async function testHonestContent() {
  console.log('\n── tell: honest content ──');
  const c = build('fabricated', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", name:"stat", content:"99.9% uptime", fontSize:32})
I(page, {type:"text", name:"quote", content:"— Jane Doe, CEO", fontSize:16})
I(page, {type:"text", name:"logo", content:"TechCrunch", fontSize:14})
I(page, {type:"text", name:"price", content:"$29/mo", fontSize:24})
I(page, {type:"text", name:"rating", content:"4.9 ★ rating", fontSize:14})`);
  const hc = tells(await cliche(c), 'honest-content');
  assert(hc.length === 5, 'metric, testimonial, brand logo, price, rating all flag');
  assert(hc.every((i) => i.severity === 'info' && !i.fix), 'honest-content is info, suggest-only');

  const labeled = build('labeled', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", content:"Uptime — to confirm", fontSize:32})
I(page, {type:"text", content:"Customer quote — placeholder", fontSize:16})
I(page, {type:"text", content:"Get started today", fontSize:16})`);
  assert(tells(await cliche(labeled), 'honest-content').length === 0, 'labeled placeholders + plain copy do not flag');
}

// --- clean design flags nothing; FR-1 category present ---
async function testCleanAndCategory() {
  console.log('\n── clean design + category wiring ──');
  const clean = build('clean', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:24, padding:48, fill:"#0F172A"})
hero=I(page, {type:"frame", layout:"vertical", gap:16})
I(hero, {type:"text", content:"Build faster", fontSize:48, color:"#F8FAFC"})
I(hero, {type:"text", content:"A short honest description of the product.", fontSize:18, color:"#CBD5E1"})
cta=I(hero, {type:"frame", width:160, padding:16, cornerRadius:8, fill:"#2563EB"})
I(cta, {type:"text", content:"Get started", color:"#ffffff"})`);
  assert((await cliche(clean)).length === 0, 'a restrained, honest design flags no cliche tells');

  const full = await evaluateCanvas(clean, { mode: 'fast' });
  assert(full.categories.some((c) => c.name === 'cliche'), 'cliche appears in the default category set');
  const clicheCat = full.categories.find((c) => c.name === 'cliche')!;
  assert(clicheCat.score === 100 && clicheCat.weight === 15, 'clean cliche scores 100 at weight 15');
}

// --- FR-7: autofix surfaces only mechanical cliche fixes ---
async function testAutofixSurfacing() {
  console.log('\n── autofix surfacing (mechanical only) ──');
  const c = createCanvas('autofix');
  parseAndExecute(c.root, `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
cta=I(page, {type:"frame", name:"CTA", width:160, padding:16, cornerRadius:8, fill:"#6366f1"})
bar=I(page, {type:"frame", name:"window-bar", layout:"horizontal", gap:8, width:400})
hdr=I(page, {type:"frame", layout:"horizontal", gap:16})`);
  // dots under bar
  const page = c.root.children![0];
  const bar = page.children!.find((n) => n.id === page.children![1].id)!;
  bar.children = [
    { id: 'q1', type: 'ellipse', width: 12, height: 12, fill: '#ff5f56' },
    { id: 'q2', type: 'ellipse', width: 12, height: 12, fill: '#ffbd2e' },
    { id: 'q3', type: 'ellipse', width: 12, height: 12, fill: '#27c93f' },
  ];
  const hdr = page.children![2];
  hdr.children = [
    { id: 'eb', type: 'text', content: 'FEATURES', fontSize: 12 },
    { id: 'hh', type: 'text', content: 'Everything you need', fontSize: 36 },
  ];

  const result = await evaluateCanvas(c, { mode: 'fast', categories: ['cliche'] });
  const fixes = result.issues.filter((i) => i.fix);
  assert(fixes.some((i) => i.tell === 'accent-hue'), 'autofix includes the default-purple swap');
  assert(fixes.some((i) => i.tell === 'fake-chrome'), 'autofix includes the fake-chrome delete');
  assert(!fixes.some((i) => i.tell === 'hanging-header'), 'autofix excludes the taste-only hanging header');
}

// --- FR-7: eyebrow rhythm (global count vs section count) ---
async function testEyebrowRhythm() {
  console.log('\n── tell: eyebrow rhythm ──');
  const over = build('eyebrow-over', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:24})
s1=I(page, {type:"frame", layout:"vertical", gap:8})
I(s1, {type:"text", content:"FEATURES", fontSize:12, textTransform:"uppercase"})
I(s1, {type:"text", content:"Heading one", fontSize:36})
s2=I(page, {type:"frame", layout:"vertical", gap:8})
I(s2, {type:"text", content:"PRICING", fontSize:12, textTransform:"uppercase"})
I(s2, {type:"text", content:"Heading two", fontSize:36})
s3=I(page, {type:"frame", layout:"vertical", gap:8})
I(s3, {type:"text", content:"ABOUT", fontSize:12, textTransform:"uppercase"})
I(s3, {type:"text", content:"Heading three", fontSize:36})`);
  const oi = tells(await cliche(over), 'eyebrow-rhythm');
  assert(oi.length === 1 && oi[0].severity === 'warning' && !oi[0].fix, '3 eyebrows over 3 sections flags once (warning, no fix)');

  // letterSpacing alone qualifies as an eyebrow (2 eyebrows, 2 sections, cap 1)
  const ls = build('eyebrow-ls', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:24})
s1=I(page, {type:"frame", layout:"vertical", gap:8})
I(s1, {type:"text", content:"Section one", fontSize:11, letterSpacing:2})
I(s1, {type:"text", content:"Heading one", fontSize:36})
s2=I(page, {type:"frame", layout:"vertical", gap:8})
I(s2, {type:"text", content:"Section two", fontSize:11, letterSpacing:2})
I(s2, {type:"text", content:"Heading two", fontSize:36})`);
  assert(tells(await cliche(ls), 'eyebrow-rhythm').length === 1, 'letter-spaced labels count as eyebrows');

  // at cap: 1 eyebrow across 3 sections → within ceil(3/3)=1
  const atCap = build('eyebrow-atcap', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:24})
s1=I(page, {type:"frame", layout:"vertical", gap:8})
I(s1, {type:"text", content:"FEATURES", fontSize:12, textTransform:"uppercase"})
I(s1, {type:"text", content:"Heading one", fontSize:36})
I(page, {type:"text", content:"Heading two", fontSize:36})
I(page, {type:"text", content:"Heading three", fontSize:36})`);
  assert(tells(await cliche(atCap), 'eyebrow-rhythm').length === 0, '1 eyebrow across 3 sections is within cap');

  // too few sections to have a rhythm (1 heading, 2 eyebrows)
  const tiny = build('eyebrow-tiny', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:24})
I(page, {type:"text", content:"ALPHA LABEL", fontSize:12, textTransform:"uppercase"})
I(page, {type:"text", content:"BETA LABEL", fontSize:12, textTransform:"uppercase"})
I(page, {type:"text", content:"Heading one", fontSize:36})`);
  assert(tells(await cliche(tiny), 'eyebrow-rhythm').length === 0, '<2 sections never flags eyebrow rhythm');
}

// --- FR-8: slop copy (stock AI phrasing) ---
async function testSlopCopy() {
  console.log('\n── tell: slop copy ──');
  const c = build('slop', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", name:"filler", content:"Elevate your workflow", fontSize:32})
I(page, {type:"text", name:"scroll", content:"Scroll to explore", fontSize:14})
I(page, {type:"text", name:"name", content:"Jane Doe", fontSize:16})
I(page, {type:"text", name:"hype", content:"Early access", fontSize:14})
I(page, {type:"text", name:"num", content:"01 / Capabilities", fontSize:12})`);
  const sc = tells(await cliche(c), 'slop-copy');
  assert(sc.length === 5, 'filler verb, scroll cue, placeholder name, hype label, section-number all flag');
  assert(sc.every((i) => i.severity === 'info' && !i.fix), 'slop-copy is info, suggest-only');

  // version strings must NOT flag (framesmith ships release-notes canvases)
  const version = build('version', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", content:"v1.5.2", fontSize:14})
I(page, {type:"text", content:"Released June 2026", fontSize:14})`);
  assert(tells(await cliche(version), 'slop-copy').length === 0, 'a version label does not flag as slop');

  // specific, branded copy + placeholder guard stay clean
  const clean = build('slop-clean', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", content:"Ship designs your team approves", fontSize:32})
I(page, {type:"text", content:"Pricing — placeholder", fontSize:16})`);
  assert(tells(await cliche(clean), 'slop-copy').length === 0, 'branded copy + labeled placeholder do not flag');
}

async function main() {
  await testColorUtils();
  await testAccentHue();
  await testGenreRelax();
  await testGradientGlow();
  await testFakeChrome();
  await testHangingHeader();
  await testHonestContent();
  await testEyebrowRhythm();
  await testSlopCopy();
  await testCleanAndCategory();
  await testAutofixSurfacing();

  console.log(`\n${passed} passed, ${failed} failed`);
  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}
main();
