import '../env.js';
/**
 * Phase 12 — cliché & craft guardrails. Exercises the `cliche` evaluation
 * category: one fixture per tell, genre-relax, honest-content guard, the
 * mechanical autofix surfacing, and a clean design that flags nothing.
 * Run with: npx tsx test/unit/test-cliche.ts
 */
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { evaluateCanvas, rgbToHsl, parseAlpha, type EvaluationIssue } from '../../src/evaluate.js';
import type { Canvas } from '../../src/types.js';
import { shutdown } from '../../src/screenshot.js';

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
const tells = (issues: EvaluationIssue[], t: string) => issues.filter((i) => i.tell === t);

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

// --- Phase 28 slice C: the evaluator knows dashboard language ---
async function testMicroPatternScaffolds() {
  console.log('\n── Phase 28: micro-pattern scaffolds ──');
  const { applyStructure } = await import('../../src/structures.js');
  for (const name of ['kpi-card', 'status-chip', 'segmented-control', 'breadcrumb', 'initials-avatar']) {
    const c = createCanvas(`mp-${name}`);
    applyStructure(c, name, { targetId: 'document' });
    const issues = await cliche(c);
    assert(issues.length === 0, `${name}: zero cliché tells on the seeded defaults`);
  }
}

async function testDashboardVocabulary() {
  console.log('\n── Phase 28: dashboard vocabulary ──');

  // $chart-* / $*-tint refs are sanctioned even when violet…
  const sanctioned = build('chart-tokens', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
dot=I(page, {type:"ellipse", width:8, height:8, fill:"$chart-2"})
chip=I(page, {type:"frame", width:80, padding:[4,8], cornerRadius:999, fill:"$violet-tint"})
I(chip, {type:"text", content:"Beta", fontSize:12, color:"$chart-2"})
`);
  sanctioned.variables = { colors: { 'chart-2': '#7C3AED', 'violet-tint': '#EDE6FB' } };
  assert(tells(await cliche(sanctioned), 'accent-hue').length === 0, 'violet through $chart-*/$*-tint refs → clean');

  // …literal violets still flag
  const literal = build('literal-violet', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"ellipse", width:8, height:8, fill:"#7C3AED"})
`);
  assert(tells(await cliche(literal), 'accent-hue').length >= 1, 'a literal violet still flags');

  // …and a purple through a NON-sanctioned token keeps the token-level advice
  const otherTok = build('other-token', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"ellipse", width:8, height:8, fill:"$brand"})
`);
  otherTok.variables = { colors: { brand: '#7C3AED' } };
  assert(tells(await cliche(otherTok), 'accent-hue').length >= 1, 'a purple through a non-dataviz token still flags');

  // token-referenced gradients don't count toward overuse; literals do
  const gradTok = build('grad-tokens', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
a=I(page, {type:"frame", width:200, height:80, gradient:"$hero-fade"})
b=I(page, {type:"frame", width:200, height:80, gradient:"$hero-fade"})
c=I(page, {type:"frame", width:200, height:80, gradient:"$hero-fade"})
`);
  gradTok.variables = { colors: { 'hero-fade': 'linear-gradient(180deg, #2563EB, #0D9488)' } };
  assert(tells(await cliche(gradTok), 'gradient-glow').length === 0, 'token-referenced gradients exempt from overuse');
  const gradLit = build('grad-literals', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
a=I(page, {type:"frame", width:200, height:80, gradient:"linear-gradient(180deg, #111, #222)"})
b=I(page, {type:"frame", width:200, height:80, gradient:"linear-gradient(180deg, #111, #222)"})
c=I(page, {type:"frame", width:200, height:80, gradient:"linear-gradient(180deg, #111, #222)"})
`);
  assert(tells(await cliche(gradLit), 'gradient-glow').length === 1, 'literal gradient overuse still flags');

  // hand-drawn sparkline bars are not traffic lights…
  const bars = build('spark-bars', `
row=I("document", {type:"frame", width:120, layout:"horizontal", gap:2, alignItems:"end"})
I(row, {type:"frame", width:4, height:12, cornerRadius:2, fill:"#94A3B8"})
I(row, {type:"frame", width:4, height:18, cornerRadius:2, fill:"#94A3B8"})
I(row, {type:"frame", width:4, height:24, cornerRadius:2, fill:"#94A3B8"})
I(row, {type:"frame", width:4, height:16, cornerRadius:2, fill:"#94A3B8"})
`);
  assert(tells(await cliche(bars), 'fake-chrome').length === 0, 'thin rounded bars are not traffic lights');

  // …real dots still are
  const dots = build('real-dots', `
bar=I("document", {type:"frame", name:"window-bar", width:400, layout:"horizontal", gap:8})
I(bar, {type:"ellipse", width:12, height:12, fill:"#ff5f56"})
I(bar, {type:"ellipse", width:12, height:12, fill:"#ffbd2e"})
I(bar, {type:"ellipse", width:12, height:12, fill:"#27c93f"})
`);
  assert(tells(await cliche(dots), 'fake-chrome').length === 1, 'a real traffic-light strip still flags');

  // KPI-card labels beside big tabular figures are not eyebrows…
  const kpis = build('kpi-labels', `
page=I("document", {type:"frame", width:1200, layout:"horizontal", gap:16})
k1=I(page, {type:"frame", layout:"vertical", gap:8, padding:16})
I(k1, {type:"text", content:"FORMS COLLECTED", fontSize:12, textTransform:"uppercase", letterSpacing:0.5})
I(k1, {type:"text", content:"1,204", fontSize:28, fontWeight:700, tabularNums:true})
k2=I(page, {type:"frame", layout:"vertical", gap:8, padding:16})
I(k2, {type:"text", content:"ACTIVE AGENTS", fontSize:12, textTransform:"uppercase", letterSpacing:0.5})
I(k2, {type:"text", content:"18", fontSize:28, fontWeight:700, tabularNums:true})
k3=I(page, {type:"frame", layout:"vertical", gap:8, padding:16})
I(k3, {type:"text", content:"FLAGS RAISED", fontSize:12, textTransform:"uppercase", letterSpacing:0.5})
I(k3, {type:"text", content:"3", fontSize:28, fontWeight:700, tabularNums:true})
k4=I(page, {type:"frame", layout:"vertical", gap:8, padding:16})
I(k4, {type:"text", content:"AVG FORMS", fontSize:12, textTransform:"uppercase", letterSpacing:0.5})
I(k4, {type:"text", content:"134", fontSize:28, fontWeight:700, tabularNums:true})
`);
  assert(tells(await cliche(kpis), 'eyebrow-rhythm').length === 0, 'uppercase KPI labels beside tabular figures are not eyebrows');
}

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

  // …but only when the tracking is a deliberate choice. A type role that sets a
  // little letterSpacing (the `soft` personality ships label at 0.25) used to
  // turn every form field on a screen into an "eyebrow": the v2.1.0 checkout
  // example had eleven, all of them ordinary labels sitting above inputs. The
  // census across the canvas corpus put role-inherited tracking at 0.3–0.6 and
  // deliberate eyebrow tracking at 1–2, so the floor sits at 1.
  const formLabels = build('eyebrow-form-labels', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:24})
s1=I(page, {type:"frame", layout:"vertical", gap:8})
I(s1, {type:"text", content:"Email", fontSize:13, letterSpacing:0.25})
I(s1, {type:"text", content:"you@example.com", fontSize:16})
I(s1, {type:"text", content:"Full name", fontSize:13, letterSpacing:0.25})
I(s1, {type:"text", content:"Rosa Lindqvist", fontSize:16})
I(s1, {type:"text", content:"Heading one", fontSize:36})
s2=I(page, {type:"frame", layout:"vertical", gap:8})
I(s2, {type:"text", content:"City", fontSize:13, letterSpacing:0.25})
I(s2, {type:"text", content:"Bristol", fontSize:16})
I(s2, {type:"text", content:"Postcode", fontSize:13, letterSpacing:0.25})
I(s2, {type:"text", content:"BS1 4TR", fontSize:16})
I(s2, {type:"text", content:"Heading two", fontSize:36})`);
  assert(tells(await cliche(formLabels), 'eyebrow-rhythm').length === 0,
    'lightly-tracked sentence-case form labels are not eyebrows');

  // Capitalised content is an eyebrow however it was authored — typing the caps
  // instead of setting textTransform is the same design decision, and it is the
  // most common form in the corpus.
  const literalCaps = build('eyebrow-literal-caps', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:24})
s1=I(page, {type:"frame", layout:"vertical", gap:8})
I(s1, {type:"text", content:"MODULES", fontSize:12, letterSpacing:0.5})
I(s1, {type:"text", content:"Heading one", fontSize:36})
s2=I(page, {type:"frame", layout:"vertical", gap:8})
I(s2, {type:"text", content:"YEAR TO DATE", fontSize:12, letterSpacing:0.5})
I(s2, {type:"text", content:"Heading two", fontSize:36})`);
  assert(tells(await cliche(literalCaps), 'eyebrow-rhythm').length === 1,
    'capitalised content counts even without textTransform');

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

  // Phase 29 slice A (#194) — a numeral bound to a unit noun by a TIGHT hyphen
  // is a compound modifier, not a section-number eyebrow. The checkout attempt
  // had "30-day plant guarantee" flagged and reworded to dodge it.
  const retail = build('retail-copy', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", content:"30-day plant guarantee", fontSize:14})
I(page, {type:"text", content:"2-year warranty included", fontSize:14})
I(page, {type:"text", content:"24/7 support", fontSize:14})
I(page, {type:"text", content:"12-month plan", fontSize:14})
I(page, {type:"text", content:"90-day returns", fontSize:14})`);
  assert(tells(await cliche(retail), 'slop-copy').length === 0, 'compound modifiers (30-day, 2-year, 24/7) are retail copy, not eyebrows');

  // ...and the real eyebrow shapes still fire, including the SPACED hyphen.
  const eyebrows = build('numbered-eyebrows', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", content:"01 — Introduction", fontSize:12})
I(page, {type:"text", content:"02 / Process", fontSize:12})
I(page, {type:"text", content:"3. Overview", fontSize:12})
I(page, {type:"text", content:"04 - Results", fontSize:12})`);
  assert(tells(await cliche(eyebrows), 'slop-copy').length === 4, 'numbered eyebrows still flag — em dash, slash, dot, and spaced hyphen');
}

// --- Phase 29 slice A (#194): the evaluator knows transactional commerce ---
async function testCommerceGenre() {
  console.log('\n── Phase 29: commerce genre ──');
  // A checkout's own money: line prices, subtotal, credit, total.
  const checkout = build('checkout', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", content:"$76.00", fontSize:16})
I(page, {type:"text", content:"$38.00 each", fontSize:13})
I(page, {type:"text", content:"Subtotal $142.00", fontSize:16})
I(page, {type:"text", content:"$40.00 available", fontSize:13})
I(page, {type:"text", content:"Total $94.40", fontSize:20})`);
  assert(tells(await cliche(checkout), 'honest-content').length > 0, 'without a genre, a checkout price list flags as fabricated');
  assert(tells(await cliche(checkout, 'commerce'), 'honest-content').length === 0, 'genre:"commerce" relaxes the money on a transactional screen');
  assert(tells(await cliche(checkout, 'checkout'), 'honest-content').length === 0, '"checkout" is an alias of commerce');

  // The genre report folds the alias away and still offers the tradeoff.
  const report = (await evaluateCanvas(checkout, { mode: 'fast', categories: ['cliche'], genre: 'commerce' })).genre;
  assert(report?.active === 'commerce' && report.relaxed.includes('honest-content'), 'genre report names commerce and what it relaxed');
  const offered = (await evaluateCanvas(checkout, { mode: 'fast', categories: ['cliche'] })).genre;
  const byTell = offered?.notRelaxed.find((n) => n.tell === 'honest-content');
  assert(!!byTell && byTell.relaxedBy.includes('commerce') && !byTell.relaxedBy.includes('checkout'),
    'notRelaxed offers "commerce" as a canonical option, never the alias');

  // The guardrail still holds: commerce does not license invented social proof.
  const marketing = build('marketing', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"text", content:"Trusted by 12,000 teams", fontSize:16})
I(page, {type:"text", content:"— Jane Doe, CEO", fontSize:14})
I(page, {type:"text", content:"99.9% uptime", fontSize:16})`);
  const marketingIssues = await cliche(marketing, 'commerce');
  assert(marketingIssues.length > 0, 'genre:"commerce" does not clear a marketing page of fabricated social proof');
}

// --- FR-9: radius consistency ---
async function testRadiusConsistency() {
  console.log('\n── tell: radius consistency ──');
  const sprawl = build('radius-sprawl', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"frame", width:200, height:80, cornerRadius:4, fill:"#1E293B"})
I(page, {type:"frame", width:200, height:80, cornerRadius:8, fill:"#1E293B"})
I(page, {type:"frame", width:200, height:80, cornerRadius:14, fill:"#1E293B"})
I(page, {type:"frame", width:200, height:80, cornerRadius:24, fill:"#1E293B"})`);
  const ri = tells(await cliche(sprawl), 'radius-consistency');
  assert(ri.length === 1 && ri[0].severity === 'info' && !ri[0].fix, '4 distinct radii flag once (info, no fix)');

  const scale = build('radius-scale', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16})
I(page, {type:"frame", width:200, height:80, cornerRadius:8, fill:"#1E293B"})
I(page, {type:"frame", width:200, height:80, cornerRadius:8, fill:"#1E293B"})
I(page, {type:"frame", width:200, height:80, cornerRadius:12, fill:"#1E293B"})`);
  assert(tells(await cliche(scale), 'radius-consistency').length === 0, 'a 2-step radius scale does not flag');
}

// --- FR-10: pure black / white ---
async function testPureBlackWhite() {
  console.log('\n── tell: pure black / white ──');
  const c = build('pure', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16, fill:"#ffffff"})
I(page, {type:"text", name:"ink", content:"Heading", fontSize:32, color:"#000000"})`);
  const bw = tells(await cliche(c), 'pure-black-white');
  assert(bw.length === 2, 'pure-black ink + pure-white page both flag');
  const ink = bw.find((i) => i.message.includes('color'))!;
  assert(!!ink.fix && ink.fix.op.includes('#0A0A0A'), 'pure-black ink carries an off-black autofix');
  const page = bw.find((i) => i.message.includes('background'))!;
  assert(!page.fix, 'pure-white page background is suggest-only');

  const off = build('off', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16, fill:"#0F172A"})
I(page, {type:"text", content:"Heading", fontSize:32, color:"#F8FAFC"})`);
  assert(tells(await cliche(off), 'pure-black-white').length === 0, 'off-black/off-white do not flag');
}

// --- FR-11: accent consistency ---
async function testAccentConsistency() {
  console.log('\n── tell: accent consistency ──');
  const rainbow = build('rainbow', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16, fill:"#0F172A"})
I(page, {type:"frame", name:"a", width:120, height:48, cornerRadius:8, fill:"#2563EB"})
I(page, {type:"frame", name:"b", width:120, height:48, cornerRadius:8, fill:"#16A34A"})
I(page, {type:"frame", name:"c", width:120, height:48, cornerRadius:8, fill:"#DC2626"})`);
  const ac = tells(await cliche(rainbow), 'accent-consistency');
  assert(ac.length === 1 && ac[0].severity === 'info' && !ac[0].fix, '3 competing accent hues flag once (info, no fix)');

  const focused = build('focused', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16, fill:"#0F172A"})
I(page, {type:"frame", width:120, height:48, cornerRadius:8, fill:"#2563EB"})
I(page, {type:"text", content:"Learn more", fontSize:14, color:"#2563EB"})
I(page, {type:"text", content:"Body copy here", fontSize:16, color:"#CBD5E1"})`);
  assert(tells(await cliche(focused), 'accent-consistency').length === 0, 'one accent + neutrals does not flag');

  // Phase 29 follow-up (#194) — the design system's STATUS vocabulary is not a
  // set of competing accents. A commerce screen showing savings in $success,
  // remove in $danger and low-stock in $warning used to flag, and because every
  // cliché tell is directive-BLOCKING regardless of severity, that made a
  // correct design unpresentable with no honest fix.
  const statuses = build('status-vocab', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16, fill:"#FFFFFF"})
I(page, {type:"frame", width:120, height:48, cornerRadius:8, fill:"$accent"})
I(page, {type:"text", content:"Free shipping", fontSize:16, color:"$success"})
I(page, {type:"text", content:"Remove", fontSize:16, color:"$danger"})
I(page, {type:"text", content:"Only 2 left", fontSize:16, color:"$warning"})`);
  statuses.variables = { colors: { accent: '#2563EB', success: '#007F38', danger: '#BC4A41', warning: '#956300' } };
  assert(tells(await cliche(statuses), 'accent-consistency').length === 0,
    'accent + the status vocabulary through tokens does not flag');

  // ...but the same hues as LITERALS are just competing accents: nothing
  // declares them to be status colours.
  const literalStatuses = build('literal-statuses', `
page=I("document", {type:"frame", width:1200, layout:"vertical", gap:16, fill:"#FFFFFF"})
I(page, {type:"frame", width:120, height:48, cornerRadius:8, fill:"#2563EB"})
I(page, {type:"text", content:"Free shipping", fontSize:16, color:"#007F38"})
I(page, {type:"text", content:"Remove", fontSize:16, color:"#BC4A41"})
I(page, {type:"text", content:"Only 2 left", fontSize:16, color:"#956300"})`);
  assert(tells(await cliche(literalStatuses), 'accent-consistency').length === 1,
    'the same hues as literals still flag');
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
  await testRadiusConsistency();
  await testPureBlackWhite();
  await testAccentConsistency();
  await testCleanAndCategory();
  await testAutofixSurfacing();
  await testCommerceGenre();
  await testDashboardVocabulary();
  await testMicroPatternScaffolds();

  console.log(`\n${passed} passed, ${failed} failed`);
  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}
main();
