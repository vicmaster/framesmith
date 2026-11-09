// Phase 31 slice A — the desktop-app type, the type-scale-ratio rule id, the
// web/desktop-app 24px census (fast mode), navigation lists that are not
// tables, folded results, the import report summary, type-aware generation
// with state + control tokens, the baseline fixtures, and the viewer's window
// breakpoints. The detailed-mode circle test lives in test-pointer-targets.ts
// (it needs Chrome).
//
// Usage: npx tsx test-desktop-app.ts

import './test-env.js';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCanvas } from './src/scene-graph.js';
import { surfaceFor, resolveSurface, RULESETS } from './src/surfaces.js';
import { evaluateCanvas, foldIssues, contrastRatio, parseColor, type EvaluationIssue } from './src/evaluate.js';
import { extractInventory } from './src/drift.js';
import { summarizeImportReport, type ImportReport } from './src/import.js';
import { generateDesignSystem, typeBase, STATE_LAYERS, PERSONALITY_NAMES } from './src/design-language.js';
import { mergeDesignTokens, setVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { renderDetailPage } from './src/viewer.js';
import { resolveStructure } from './src/structures.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function canvasWith(children: SceneNode[], surface?: { type: 'web' | 'mobile' | 'desktop-app'; device?: string }, width = 1440): Canvas {
  return {
    id: 'c1', name: 'c', projectId: 'p', components: {}, variables: {}, createdAt: '', lastModified: '',
    root: { id: 'document', type: 'document', name: 'Document', width, height: 900, fill: '#FFFFFF', layout: 'vertical', padding: 24, children },
    ...(surface ? { metadata: { surface } } : {}),
  } as Canvas;
}
const text = (id: string, content: string, fontSize: number): SceneNode => ({ id, name: id, type: 'text', content, fontSize, color: '#111111' });

// ── FR-A1: the type ────────────────────────────────────────────────────────
{
  const c = createCanvas('app', undefined, {}, surfaceFor('desktop-app').hasOwnProperty('surface') ? (surfaceFor('desktop-app') as { surface: { type: 'desktop-app'; device?: string } }).surface : undefined);
  const s = resolveSurface(c);
  check('canvas_create desktop-app reads back 1440×900', c.root.width === 1440 && c.root.height === 900 && c.root.safeArea === undefined, `${c.root.width}×${c.root.height}`);
  check('desktop-app surface defaults to window-1440', s.type === 'desktop-app' && s.device === 'window-1440' && s.source === 'declared', JSON.stringify(s));
  check('a phone profile is refused on desktop-app', 'error' in surfaceFor('desktop-app', 'iphone-390'));
  check('a window profile is refused on mobile', 'error' in surfaceFor('mobile', 'window-1440'));
  check('web takes no device', 'error' in surfaceFor('web', 'window-1440'));
  const stray = canvasWith([], { type: 'desktop-app', device: 'iphone-390' });
  check('a stored mismatched device resolves to the type default', resolveSurface(stray).device === 'window-1440', JSON.stringify(resolveSurface(stray)));
  const plain = canvasWith([text('t', 'Hello', 16)]);
  const declared = canvasWith([text('t', 'Hello', 16)], { type: 'desktop-app', device: 'window-1440' });
  check('declaring the type never changes the render', renderToHtml(plain.root, 1440, 900, plain) === renderToHtml(declared.root, 1440, 900, declared));
}

// ── FR-A2 / FR-A3: type-scale-ratio and the desktop-app row ────────────────
{
  const dense = [text('a', 'Label', 13), text('b', 'Body copy here', 14), text('c', 'Title', 15)];
  const web = await evaluateCanvas(canvasWith(dense, { type: 'web' }), { mode: 'fast', categories: ['typography'] });
  const app = await evaluateCanvas(canvasWith(dense, { type: 'desktop-app', device: 'window-1440' }), { mode: 'fast', categories: ['typography'] });
  const ratio = (r: typeof web) => r.issues.filter((i) => i.rule === 'type-scale-ratio');
  check('web keeps the ratio check, tagged type-scale-ratio', ratio(web).length >= 1, JSON.stringify(ratio(web).map((i) => i.message)));
  check('desktop-app turns type-scale-ratio off', ratio(app).length === 0 && app.surface.rulesOff.includes('type-scale-ratio'), JSON.stringify(app.surface));
  check('desktop-app rulesOn carries the base artboard rules', JSON.stringify(app.surface.rulesOn) === JSON.stringify(['desktop-app-artboard', 'mobile-artboard']), JSON.stringify(app.surface.rulesOn));
  check('the desktop-app row registers only what has a check today', JSON.stringify(RULESETS.type['desktop-app']) === JSON.stringify({ enable: [], disable: ['type-scale-ratio'] }));
}

// ── desktop-app-artboard ────────────────────────────────────────────────────
{
  const narrow = await evaluateCanvas(canvasWith([text('t', 'Hi', 14)], { type: 'desktop-app', device: 'window-1440' }, 900), { mode: 'fast', categories: ['structure'] });
  const wide = await evaluateCanvas(canvasWith([text('t', 'Hi', 14)], { type: 'desktop-app', device: 'window-1440' }), { mode: 'fast', categories: ['structure'] });
  const web900 = await evaluateCanvas(canvasWith([text('t', 'Hi', 14)], { type: 'web' }, 900), { mode: 'fast', categories: ['structure'] });
  const art = (r: typeof wide) => r.issues.filter((i) => i.rule === 'desktop-app-artboard');
  check('a 900px desktop-app canvas warns (desktop-app-artboard)', art(narrow).length === 1 && art(narrow)[0].severity === 'warning');
  check('a 1440 desktop-app canvas is silent', art(wide).length === 0);
  check('a 900px web canvas is silent', art(web900).length === 0);
}

// ── FR-A4: the 24px census, fast mode ──────────────────────────────────────
{
  const small = (id: string): SceneNode => ({ id, name: id, type: 'button', icon: 'x', height: 20, width: 20 });
  const row: SceneNode = { id: 'row', name: 'row', type: 'frame', layout: 'horizontal', gap: 4, children: [small('b1'), small('b2')] };
  for (const type of ['web', 'desktop-app'] as const) {
    const r = await evaluateCanvas(canvasWith([row], { type, ...(type === 'desktop-app' ? { device: 'window-1440' } : {}) }), { mode: 'fast', categories: ['usability'] });
    const t = r.issues.filter((i) => /below the 24px floor/.test(i.message));
    check(`${type}: a 20px button warns in fast mode, naming the exception and detailed mode`, t.length === 2 && t.every((i) => i.severity === 'warning' && /spacing exception/.test(i.message) && /detailed/.test(i.suggestion ?? '')), JSON.stringify(t.map((i) => [i.severity, i.message])));
  }
  const disabled = await evaluateCanvas(canvasWith([{ ...row, children: [{ ...small('b1'), disabled: true }] }], { type: 'web' }), { mode: 'fast', categories: ['usability'] });
  check('a disabled target is not measured', !disabled.issues.some((i) => /24px floor/.test(i.message)));
  const padded: SceneNode = { id: 'r2', name: 'row', type: 'frame', layout: 'horizontal', padding: 12, children: [{ id: 'cb', name: 'cb', type: 'checkbox' }, text('l', 'Remember me', 14)] };
  const lone = await evaluateCanvas(canvasWith([padded]), { mode: 'fast', categories: ['usability'] });
  check('a lone 18px checkbox in a padded row still passes', !lone.issues.some((i) => /24px floor/.test(i.message)), JSON.stringify(lone.issues.map((i) => i.message)));
  const bare: SceneNode = { id: 'r3', name: 'row', type: 'frame', layout: 'horizontal', children: [{ id: 'cb1', name: 'cb1', type: 'checkbox' }, { id: 'cb2', name: 'cb2', type: 'checkbox' }, text('l', 'Pick', 14)] };
  const two = await evaluateCanvas(canvasWith([bare]), { mode: 'fast', categories: ['usability'] });
  check('two bare checkboxes warn in fast mode (was an error in both modes)', two.issues.filter((i) => /24px floor/.test(i.message)).every((i) => i.severity === 'warning') && two.issues.filter((i) => /24px floor/.test(i.message)).length === 2);
  const ok: SceneNode = { id: 'b', name: 'b', type: 'button', label: 'Save', size: 'sm' };
  const fine = await evaluateCanvas(canvasWith([ok], { type: 'desktop-app', device: 'window-1440' }), { mode: 'fast', categories: ['usability'] });
  check('a 32px button passes', !fine.issues.some((i) => /24px floor/.test(i.message)));
  const comp: Canvas = canvasWith([{ id: 'inst', name: 'inst', type: 'instance', componentId: 'tiny' } as SceneNode], { type: 'web' });
  comp.components = { tiny: { id: 'tiny', name: 'Tiny', type: 'component', layout: 'horizontal', children: [small('t1'), small('t2')] } as SceneNode };
  const inInstance = await evaluateCanvas(comp, { mode: 'fast', categories: ['usability'] });
  const hits = inInstance.issues.filter((i) => /24px floor/.test(i.message));
  check('targets inside an instance are measured and reported on the instance', hits.length >= 1 && hits.every((i) => i.nodeId === 'inst'), JSON.stringify(hits.map((i) => i.nodeId)));
}

// ── FR-A5: lists that lead with a mark are not tables ──────────────────────
{
  const fixture = JSON.parse(readFileSync('test-fixtures/viewer-baseline/gallery-pattern-library.json', 'utf-8')) as Canvas;
  const find = (n: SceneNode, id: string): SceneNode | undefined => n.id === id ? n : n.children?.map((c) => find(c, id)).find(Boolean);
  const sidebar = find(fixture.root, 'imp-frame-33')!;
  check('the baseline sidebar subtree is present', !!sidebar && (sidebar.children?.length ?? 0) >= 6);
  check('the baseline sidebar yields no table', extractInventory(sidebar).tables.length === 0);
  const sidebarCanvas = canvasWith([sidebar]);
  const cov = await evaluateCanvas(sidebarCanvas, { mode: 'fast', categories: ['coverage'] });
  check('the baseline sidebar raises no coverage finding', cov.issues.length === 0, JSON.stringify(cov.issues.map((i) => i.message)));
  const hrow = (id: string, cells: SceneNode[]): SceneNode => ({ id, name: id, type: 'frame', layout: 'horizontal', children: cells });
  const region: SceneNode = { id: 'tbl', name: 'tbl', type: 'frame', layout: 'vertical', children: [
    hrow('h', [text('h1', 'Region', 12), text('h2', 'Revenue', 12)]),
    hrow('r1', [text('a1', 'North', 14), text('a2', '$40', 14)]),
    hrow('r2', [text('b1', 'South', 14), text('b2', '$12', 14)]),
    hrow('r3', [text('c1', 'West', 14), text('c2', '$9', 14)]),
  ] };
  check('a Region / Revenue table with a header row still detects', extractInventory(region).tables.length === 1);
  const avatar = (id: string): SceneNode => ({ id, name: id, type: 'image', width: 24, height: 24, src: 'data:image/png;base64,' });
  const users: SceneNode = { id: 'users', name: 'users', type: 'frame', layout: 'vertical', children: [
    hrow('uh', [text('u0', 'Name', 12), text('u1', 'Role', 12), text('u2', 'Seen', 12)]),
    hrow('u1r', [avatar('av1'), text('n1', 'Ana', 14), text('r1x', 'Admin', 14)]),
    hrow('u2r', [avatar('av2'), text('n2', 'Bo', 14), text('r2x', 'Editor', 14)]),
    hrow('u3r', [avatar('av3'), text('n3', 'Cy', 14), text('r3x', 'Viewer', 14)]),
  ] };
  check('an avatar-led users table under a text header still detects', extractInventory(users).tables.length === 1);
  const icons: SceneNode = { id: 'nav', name: 'nav', type: 'frame', layout: 'vertical', children: ['Home', 'Files', 'Shared'].map((l, i) => hrow(`n${i}`, [{ id: `i${i}`, name: 'i', type: 'icon', icon: 'home' }, text(`l${i}`, l, 14), text(`k${i}`, String(i + 1), 12)])) };
  check('an icon-led navigation list is not a table', extractInventory(icons).tables.length === 0);
}

// ── FR-A7: folding and the import summary ──────────────────────────────────
{
  const w = (id: string, n: number, fix = true): EvaluationIssue => ({ category: 'spacing', severity: 'warning', nodeId: id, message: `gap: ${n}px is not on the spacing scale.`, ...(fix ? { fix: { op: `U("${id}", { gap: 8 })`, rationale: 'snap' } } : {}) });
  const issues: EvaluationIssue[] = [
    { category: 'color', severity: 'error', nodeId: 'e1', message: 'Text "a" has contrast ratio 2:1' },
    { category: 'color', severity: 'error', nodeId: 'e2', message: 'Text "b" has contrast ratio 2:1' },
    { category: 'color', severity: 'error', nodeId: 'e3', message: 'Text "c" has contrast ratio 2:1' },
    w('a', 11), w('b', 13), w('c', 15),
    w('x', 11, false), w('y', 13, false),
    { category: 'color', severity: 'info', nodeId: 'i1', message: 'APCA advisory: Lc 60.8' },
    { category: 'color', severity: 'info', nodeId: 'i2', message: 'APCA advisory: Lc 59.1' },
    { category: 'color', severity: 'info', nodeId: 'i3', message: 'APCA advisory: Lc 57.0' },
  ];
  const folded = foldIssues(issues);
  check('errors never fold', folded.filter((i) => i.severity === 'error').length === 3);
  const spacing = folded.filter((i) => i.category === 'spacing');
  check('same-shaped warnings fold into one entry; fixes lists the members that had one', spacing.length === 1 && spacing[0].count === 5 && JSON.stringify(spacing[0].nodeIds) === '["a","b","c","x","y"]' && spacing[0].fixes?.length === 3 && spacing[0].fix === undefined, JSON.stringify(spacing));
  check('two of a kind do not fold', foldIssues([w('p', 11), w('q', 13)]).length === 2);
  const apca = folded.filter((i) => i.category === 'color' && i.severity === 'info');
  check('three infos fold, with no fixes field', apca.length === 1 && apca[0].count === 3 && apca[0].fixes === undefined);
  check('the folded entry sits where the first member was', folded.findIndex((i) => i.nodeIds?.includes('a')) === 3);

  const ds = JSON.parse(readFileSync('test-fixtures/viewer-baseline/detail-web-dashboard.json', 'utf-8')) as Canvas;
  const r = await evaluateCanvas(ds, { mode: 'fast' });
  const opsBefore = r.issues.filter((i) => i.fix).map((i) => i.fix!.op).sort();
  const f = foldIssues(r.issues);
  const opsAfter = f.flatMap((i) => [...(i.fix ? [i.fix.op] : []), ...(i.fixes ?? []).map((x) => x.op)]).sort();
  check('every fix op survives folding on the baseline detail page', JSON.stringify(opsBefore) === JSON.stringify(opsAfter), `${opsBefore.length} vs ${opsAfter.length}`);
  const before = JSON.stringify(r, null, 2).length;
  const after = JSON.stringify({ ...r, issues: f }, null, 2).length;
  check('the baseline detail result folds to about half (≤ 55%)', after <= before * 0.55, `${before} → ${after}`);

  const report: ImportReport = { counts: { nodes: 1, frames: 1, text: 0, maxDepth: 1, dropped: 0 }, snapped: [], literals: [], scaleMatches: [], layout: [], unmatchedFonts: [], unmatchedIcons: [], warnings: [] };
  for (let i = 0; i < 40; i++) report.snapped.push({ nodeId: `n${i}`, prop: 'fill', from: 'rgb(0,0,0)', token: i % 2 ? '$bg' : '$surface' });
  for (let i = 0; i < 30; i++) report.literals.push({ nodeId: `l${i}`, prop: 'fill', value: 'rgb(26, 22, 15)' });
  for (let i = 0; i < 50; i++) report.scaleMatches.push({ nodeId: `s${i}`, prop: 'gap', value: 8, token: '$sm' });
  const sum = summarizeImportReport(report);
  check('snapped groups per token with counts and five ids', sum.snapped.length === 2 && sum.snapped.every((g) => g.count === 20 && g.nodeIds.length === 5) && sum.summarized === true);
  check('literals group per value', sum.literals.length === 1 && sum.literals[0].value === 'rgb(26, 22, 15)' && sum.literals[0].count === 30);
  check('the summary is under half the full report', JSON.stringify(sum, null, 2).length <= JSON.stringify(report, null, 2).length / 2);
}

// ── FR-A8: generation ───────────────────────────────────────────────────────
{
  check('desktop-app pivots on 14 (13 for data-dense)', typeBase('technical', { surface: 'desktop-app' }).size === 14 && typeBase('data-dense', { surface: 'desktop-app' }).size === 13 && typeBase('technical', { surface: 'desktop-app' }).source === 'desktop-app');
  check('an explicit baseSize wins on desktop-app', typeBase('soft', { surface: 'desktop-app', baseSize: 16 }).size === 16);
  let worstRing = Infinity; let worstBorder = Infinity; let floor = Infinity; let bodyOk = true;
  for (const p of PERSONALITY_NAMES) for (const seed of ['#2563EB', '#16A34A', '#F59E0B', '#DB2777', '#64748B', '#0EA5E9']) {
    const s = generateDesignSystem(seed, p, { surface: 'desktop-app' });
    const light = s.variables.colors!;
    const dark = { ...light, ...s.variables.dark!.colors! };
    for (const cols of [light, dark]) {
      for (const k of Object.keys(cols).filter((k) => k.startsWith('bg-') || k.endsWith('-tint'))) worstRing = Math.min(worstRing, contrastRatio(parseColor(cols['focus-ring'])!, parseColor(cols[k])!));
      for (const k of ['bg-primary', 'bg-surface']) worstBorder = Math.min(worstBorder, contrastRatio(parseColor(cols['border-strong'])!, parseColor(cols[k])!));
    }
    const sizes = Object.values(s.variables.typography!).map((t) => t.fontSize).filter((x): x is number => typeof x === 'number');
    floor = Math.min(floor, ...sizes);
    if (![13, 14].includes(s.variables.typography!.body.fontSize as number)) bodyOk = false;
    if (JSON.stringify(s.variables.state) !== JSON.stringify(STATE_LAYERS)) bodyOk = false;
  }
  check('focus-ring clears 3:1 on every bg-* and -tint in both themes, every personality and seed', worstRing >= 3, worstRing.toFixed(2));
  check('border-strong clears 3:1 on bg-primary and bg-surface in both themes', worstBorder >= 3, worstBorder.toFixed(2));
  check('desktop-app systems: body 13 or 14, nothing below 11, state tokens written', bodyOk && floor >= 11, `floor ${floor}`);
  const merged = mergeDesignTokens({ state: { hover: 0.08, focus: 0.1 } }, { state: { hover: 0.12 } });
  check('state tokens layer workspace → canvas like motion', merged.state?.hover === 0.12 && merged.state?.focus === 0.1);
  const c = canvasWith([]);
  setVariables(c, { state: { pressed: 0.2 } });
  check('set_variables writes state', c.variables.state?.pressed === 0.2);
}

// ── FR-A9: the fixtures ─────────────────────────────────────────────────────
{
  const files = readdirSync('test-fixtures/viewer-baseline').filter((f) => f.endsWith('.json')).sort();
  check('four baseline fixtures are committed', JSON.stringify(files) === JSON.stringify(['archive.json', 'detail-mobile-ridgeline.json', 'detail-web-dashboard.json', 'gallery-pattern-library.json']), files.join(', '));
  for (const f of files) {
    const raw = readFileSync(`test-fixtures/viewer-baseline/${f}`, 'utf-8');
    const c = JSON.parse(raw) as Canvas;
    check(`${f} loads with a root and its own design system`, c.root?.type === 'document' && !!c.variables?.colors, createHash('sha256').update(raw).digest('hex').slice(0, 12));
  }
}

// ── Structure resolution names every type ───────────────────────────────────
{
  let msg = '';
  try { resolveStructure('pricing', 'desktop-app'); } catch (e) { msg = (e as Error).message; }
  check('pricing on desktop-app refuses and names realisation "web"', /no desktop-app realisation/.test(msg) && /realisation: "web"/.test(msg), msg);
  let feed = '';
  try { resolveStructure('feed', 'desktop-app'); } catch (e) { feed = (e as Error).message; }
  check('feed on desktop-app refuses and names realisation "mobile"', /realisation: "mobile"/.test(feed) && !/realisation: "web"/.test(feed), feed);
}

// ── FR-I1: the viewer's window breakpoints ──────────────────────────────────
{
  const html = await renderDetailPage(canvasWith([text('t', 'Hi', 14)], { type: 'desktop-app', device: 'window-1440' }), 0);
  check('the detail page offers 1024 and 1280 window buttons plus the artboard', /id="bp-w1024"/.test(html) && /id="bp-w1280"/.test(html) && /id="bp-desktop"[^>]*>1440</.test(html));
  check('no phone or tablet buttons on a desktop-app canvas', !/id="bp-mobile"/.test(html) && !/id="bp-tablet"/.test(html));
  const web = await renderDetailPage(canvasWith([text('t', 'Hi', 14)]), 0);
  check('a web canvas keeps Mobile / Tablet / Desktop', /id="bp-mobile"/.test(web) && /id="bp-tablet"/.test(web));
}

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
