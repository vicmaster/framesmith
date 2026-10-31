// Phase 30 slice C — the mobile ruleset, fast mode: each rule's positive and
// negative fixtures from the spec's FR-C1..C8 rows and the slice C build
// contract, the stress engine's mobile behaviour, the directive's type note,
// and the real tool handlers over MCP stdio. Detailed mode and canvas_stress
// need Chrome and live in test-mobile-rules-detailed.ts.
//
// Usage: npx tsx test-mobile-rules.ts

import './test-env.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { buildEvaluateDirective } from './src/directive.js';
import { applyPerturbation } from './src/stress.js';
import { fontPx, proseWords } from './src/mobile-rules.js';
import { renderedPaddingPx } from './src/renderer.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** A phone canvas: declared mobile, 390×844, root safeArea unless `bare`. */
function phone(ops: string, opts: { bare?: boolean; type?: 'web' | 'mobile' | 'none'; width?: number; height?: number; variables?: Canvas['variables'] } = {}): Canvas {
  const type = opts.type ?? 'mobile';
  const c = type === 'mobile'
    ? createCanvas('phone', undefined, { ...(opts.width ? { width: opts.width } : {}), ...(opts.height ? { height: opts.height } : {}) }, { type: 'mobile' })
    : createCanvas('phone', undefined, { width: opts.width ?? 390, height: opts.height ?? 844 }, type === 'web' ? { type: 'web' } : undefined);
  if (opts.bare) delete c.root.safeArea;
  if (opts.variables) c.variables = { ...c.variables, ...opts.variables };
  parseAndExecute(c.root, ops, c);
  return c;
}

async function issues(c: Canvas, rule?: string, mode: 'fast' | 'detailed' = 'fast'): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(c, { mode });
  return r.issues.filter((i) => (rule ? i.rule === rule : i.rule !== undefined));
}
const show = (list: EvaluationIssue[]) => JSON.stringify(list.map((i) => `${i.severity} ${i.rule} ${i.nodeId}: ${i.message.slice(0, 70)}`));

// ── measurement helpers ───────────────────────────────────────────────────
{
  console.log('── measurement ──');
  check('padding under 32 renders as authored', renderedPaddingPx(24, 390) === 24);
  check('48px padding renders 13px on a 390 artboard', Math.round(renderedPaddingPx(48, 390)) === 13);
  check('48px padding renders 48 at 1440', renderedPaddingPx(48, 1440) === 48);
  check('fontPx: number, px, rem, clamp min, unresolved ref', fontPx(12) === 12 && fontPx('12px') === 12 && fontPx('1rem') === 16
    && fontPx('clamp(1rem, 0.9rem + 0.5vw, 1.25rem)') === 16 && fontPx('$missing') === 14 && fontPx(undefined) === undefined);
  check('proseWords: a metrics line is not prose', proseWords('5.2 mi · 1h 12m · 340 ft') === 2, String(proseWords('5.2 mi · 1h 12m · 340 ft')));
  check('proseWords: CJK counts one word per two characters', proseWords('今日は良い天気ですね') === 5);
}

// ── FR-C1 mobile-touch-target ─────────────────────────────────────────────
{
  console.log('\n── mobile-touch-target ──');
  const card = `f=I("document", { type: "frame", layout: "vertical", padding: 12 })
I(f, { type: "text", content: "Remember me" })
I(f, { type: "checkbox", width: 32, height: 32 })`;
  const m = await issues(phone(card), 'mobile-touch-target');
  check('32px control in a 12px-padded frame on mobile → error', m.length === 1 && m[0].severity === 'error' && m[0].category === 'usability' && m[0].message.includes('44px'), show(m));
  const w = await evaluateCanvas(phone(card, { type: 'web' }), { mode: 'fast', categories: ['usability'] });
  check('same canvas declared web → only the unchanged touch-first info', w.issues.length === 1 && w.issues[0].severity === 'info' && w.issues[0].rule === undefined && buildEvaluateDirective(w).ready, JSON.stringify(w.issues.map((i) => i.message)));

  const row44 = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 44, width: "100%" })
I(r, { type: "text", content: "Wi-Fi" })
I(r, { type: "toggle", checked: true })`), 'mobile-touch-target');
  check('toggle alone in a 44px row → passes', row44.length === 0, show(row44));

  const row56 = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 56, padding: [0, 16], alignItems: "center", width: "100%" })
I(r, { type: "text", content: "Notifications" })
I(r, { type: "toggle" })`), 'mobile-touch-target');
  check('toggle in a 56px settings row → passes (the row is the target)', row56.length === 0, show(row56));

  const login = await issues(phone(`c=I("document", { type: "frame", layout: "vertical", padding: 20 })
I(c, { type: "text", content: "Sign in", fontSize: 22 })
I(c, { type: "text", content: "Use the email you signed up with." })
I(c, { type: "checkbox", width: 18, height: 18 })`), 'mobile-touch-target');
  check('lone checkbox in a padded card → error (a card is not its row)', login.length === 1, show(login));

  const scaled = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", padding: [32, 16] })
I(r, { type: "text", content: "Sync" })
I(r, { type: "toggle" })`), 'mobile-touch-target');
  check('row padding 32 renders ~9px on a phone → toggle row is 41px → error', scaled.length === 1, show(scaled));

  const two = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 56 })
I(r, { type: "text", content: "Pair" })
I(r, { type: "checkbox", width: 24, height: 24 })
I(r, { type: "checkbox", width: 24, height: 24 })`), 'mobile-touch-target');
  check('two controls sharing a row → both measured bare', two.length === 2, show(two));
}

// ── FR-C2 mobile-handbuilt-target ─────────────────────────────────────────
{
  console.log('\n── mobile-handbuilt-target ──');
  const c = phone(`a=I("document", { type: "frame", width: 40, height: 40, alignItems: "center", justifyContent: "center" })
I(a, { type: "icon", icon: "bell" })
b=I("document", { type: "frame", width: 44, height: 44 })
I(b, { type: "icon", icon: "bell" })
t=I("document", { type: "frame", layout: "vertical", width: 56, height: 48 })
I(t, { type: "icon", icon: "house" })
I(t, { type: "text", content: "Home" })
s=I("document", { type: "frame", layout: "horizontal", height: 32 })
I(s, { type: "icon", icon: "plus" })
I(s, { type: "text", content: "Add item" })
col=I("document", { type: "frame", layout: "vertical", width: 74 })
circ=I(col, { type: "frame", width: 40, height: 40 })
I(circ, { type: "icon", icon: "play" })
I(col, { type: "text", content: "Start" })
chip=I("document", { type: "frame", layout: "horizontal", height: 24 })
I(chip, { type: "icon", icon: "flame" })
I(chip, { type: "text", content: "Five day streak so far" })
hug=I("document", { type: "frame", padding: 8 })
I(hug, { type: "icon", icon: "x", iconSize: 20 })`);
  const found = await issues(c, 'mobile-handbuilt-target');
  const byIndex = (k: number) => found.some((i) => i.nodeId === c.root.children![k].id);
  check('40×40 icon-only frame → info', byIndex(0) && found.every((i) => i.severity === 'info'), show(found));
  check('44×44 icon frame and 56×48 tab item → nothing', !byIndex(1) && !byIndex(2));
  check('32px-tall icon + short label → info', byIndex(3));
  check('outermost tap-shaped frame only: a column with unknown height reports nothing, its 40px circle stays silent', !byIndex(4) && !found.some((i) => i.nodeId === c.root.children![4].children![0].id));
  check('icon + a five-word label is not tap-shaped', !byIndex(5));
  check('hug-sized icon frame: 20 + 2×8 = 36 → info', byIndex(6), show(found));
  check('exactly three infos', found.length === 3, show(found));
  const web = await issues(phone(`a=I("document", { type: "frame", width: 40, height: 40 })
I(a, { type: "icon", icon: "bell" })`, { type: 'web' }), 'mobile-handbuilt-target');
  check('web canvas → no handbuilt infos', web.length === 0);
}

// ── FR-C3 mobile-safe-area (fast) ─────────────────────────────────────────
{
  console.log('\n── mobile-safe-area (fast) ──');
  const flow = `f=I("document", { type: "frame", layout: "vertical", gap: 12 })
I(f, { type: "text", content: "Today" })
I(f, { type: "text", content: "Nothing planned." })`;
  const safe = await issues(phone(flow), 'mobile-safe-area');
  check('default path (root safeArea): in-flow content → clean', safe.length === 0, show(safe));

  const abs = phone(`${flow}
I("document", { type: "text", content: "Offline", position: "absolute", x: 16, y: 10 })`);
  const absI = await issues(abs, 'mobile-safe-area');
  check('absolute text at y 10 → warning', absI.length === 1 && absI[0].severity === 'warning' && absI[0].category === 'usability', show(absI));

  const low = await issues(phone(`${flow}
I("document", { type: "text", content: "Saved", position: "absolute", x: 16, y: 820 })`), 'mobile-safe-area');
  check('absolute text reaching the bottom inset → warning', low.length === 1 && low[0].message.includes('bottom'), show(low));

  const bare = await issues(phone(flow, { bare: true }), 'mobile-safe-area');
  check('no safeArea, content at the top and the end → two warnings naming the safeArea op', bare.length === 2 && bare.every((i) => i.suggestion?.includes('safeArea: { top: 47, bottom: 34 }')), show(bare));

  const spaced = await issues(phone(`I("document", { type: "frame", height: 47 })
${flow}
I("document", { type: "frame", height: 34 })`, { bare: true }), 'mobile-safe-area');
  check('no safeArea, spacer frames of the inset heights → clean', spaced.length === 0, show(spaced));

  const padSpacer = await issues(phone(`I("document", { type: "frame", padding: [24, 0] })
${flow}
I("document", { type: "frame", minHeight: 34 })`, { bare: true }), 'mobile-safe-area');
  check('spacers sized by padding (24+24) and minHeight → clean', padSpacer.length === 0, show(padSpacer));

  const bigPad = phone(flow, { bare: true });
  bigPad.root.padding = [64, 0, 64, 0];
  const bigPadI = await issues(bigPad, 'mobile-safe-area');
  check('root padding 64 renders ~17px on a phone → still warns', bigPadI.length === 2, show(bigPadI));

  const hero = await issues(phone(`I("document", { type: "image", src: "https://example.com/hero.jpg", width: "100%", height: 220 })
${flow}
I("document", { type: "frame", height: 34 })`, { bare: true }), 'mobile-safe-area');
  check('full-width hero image under the status bar, text below the inset → clean', hero.length === 0, show(hero));

  const row = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", padding: [8, 16] })
I(r, { type: "text", content: "Back" })
I(r, { type: "text", content: "Edit" })
${flow}
I("document", { type: "frame", height: 34 })`, { bare: true }), 'mobile-safe-area');
  check('horizontal row at the top: its content sits at the row padding → warning', row.length === 1 && row[0].message.includes('top'), show(row));

  const overlay = phone(`${flow}
o=I("document", { type: "frame", layout: "vertical", position: "absolute", x: 0, y: 0, width: 390, height: 844 })
I(o, { type: "text", content: "Welcome back" })`);
  const overlayI = await issues(overlay, 'mobile-safe-area');
  check('absolute full-screen overlay with unpadded content → warning naming padding inside the overlay', overlayI.length === 2 && overlayI.every((i) => i.suggestion?.startsWith('Pad')), show(overlayI));

  const nested = await issues(phone(`${flow}
w=I("document", { type: "frame", layout: "vertical" })
I(w, { type: "text", content: "Badge", position: "absolute", x: 0, y: 0 })`), 'mobile-safe-area');
  check('absolute content inside an in-flow frame → one info naming detailed mode', nested.length === 1 && nested[0].severity === 'info' && nested[0].suggestion?.includes('detailed'), show(nested));
}

// ── FR-C4 mobile-type-floor ───────────────────────────────────────────────
{
  console.log('\n── mobile-type-floor ──');
  const typo = (entries: Record<string, number>) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { fontSize: v }]));
  const c = phone(`I("document", { type: "text", content: "Your run synced and your weekly summary is ready to read.", fontSize: "$text-sm" })
I("document", { type: "text", content: "Updated 2 minutes ago", fontSize: 13 })
I("document", { type: "text", content: "Mon", fontSize: 10 })
I("document", { type: "text", content: "5.2 mi · 1h 12m · 340 ft", fontSize: 12 })
I("document", { type: "text", content: "This is a long caption line that runs on for twelve words or so.", fontSize: 14 })`,
  { variables: { typography: typo({ 'text-sm': 12, body: 14 }) } });
  const found = await issues(c, 'mobile-type-floor');
  const at = (k: number) => found.find((i) => i.nodeId === c.root.children![k].id);
  check('12px paragraph via $text-sm → warning', at(0)?.severity === 'warning' && at(0)?.category === 'typography', show(found));
  check('13px timestamp line → nothing', !at(1));
  check('10px label → warning (below 11)', at(2)?.severity === 'warning' && at(2)!.message.includes('11px'));
  check('12px metrics line → nothing (two prose words)', !at(3));
  check('14px twelve-word copy → info', at(4)?.severity === 'info');
  check('workspace body 14 that no node references → no finding of its own', found.length === 3, show(found));

  const body = phone(`I("document", { type: "text", content: "Hi", fontSize: "$body" })`, { variables: { typography: typo({ body: 14 }) } });
  const bodyI = await issues(body, 'mobile-type-floor');
  check('a node using $body at 14 → warning naming the 16px floor', bodyI.length === 1 && bodyI[0].message.includes('16px'), show(bodyI));
  const ok = await issues(phone(`I("document", { type: "text", content: "Hi", fontSize: "$body" })`, { variables: { typography: typo({ body: 17 }) } }), 'mobile-type-floor');
  check('$body at 17 → clean', ok.length === 0);
}

// ── FR-C5 mobile-one-column ───────────────────────────────────────────────
{
  console.log('\n── mobile-one-column ──');
  const c = phone(`r=I("document", { type: "frame", layout: "horizontal", gap: 12 })
a=I(r, { type: "frame", layout: "vertical" })
I(a, { type: "text", content: "How we rebuilt the route planner from the ground up" })
b=I(r, { type: "frame", layout: "vertical" })
I(b, { type: "text", content: "Five habits that keep long runs feeling easy and fun" })
q=I("document", { type: "frame", layout: "horizontal" })
I(q, { type: "text", content: "Start" })
I(q, { type: "text", content: "Routes" })
I(q, { type: "text", content: "Plan" })
I(q, { type: "text", content: "Gear" })
s=I("document", { type: "frame", layout: "horizontal" })
I(s, { type: "text", content: "42.8 km" })
I(s, { type: "text", content: "5:12 /km" })`);
  const found = await issues(c, 'mobile-one-column');
  check('two side-by-side article cards → one info on the row', found.length === 1 && found[0].nodeId === c.root.children![0].id && found[0].severity === 'info', show(found));
}

// ── FR-C6 mobile-artboard ─────────────────────────────────────────────────
{
  console.log('\n── mobile-artboard ──');
  const content = 'I("document", { type: "text", content: "Hello" })';
  const undeclared = await issues(phone(content, { type: 'none' }), 'mobile-artboard');
  check('390 canvas, no type → warning (structure)', undeclared.length === 1 && undeclared[0].severity === 'warning' && undeclared[0].category === 'structure' && undeclared[0].suggestion!.includes('canvas_set_type'), show(undeclared));
  const web = await issues(phone(content, { type: 'web' }), 'mobile-artboard');
  check('390 canvas declared web → info only', web.length === 1 && web[0].severity === 'info', show(web));
  const wide = await issues(phone(content, { width: 1440, height: 900 }), 'mobile-artboard');
  check('mobile canvas at 1440 → warning', wide.length === 1 && wide[0].severity === 'warning', show(wide));
  const odd = await issues(phone(content, { width: 393, height: 852 }), 'mobile-artboard');
  check('mobile canvas at 393×852 → info', odd.length === 1 && odd[0].severity === 'info', show(odd));
  const exact = await issues(phone(content), 'mobile-artboard');
  check('mobile canvas at 390×844 → nothing', exact.length === 0);
  const desktop = await issues(phone(content, { type: 'none', width: 1440, height: 900 }), 'mobile-artboard');
  check('undeclared 1440 canvas → nothing', desktop.length === 0);
  const chrome = phone(content, { type: 'none', width: 1440, height: 900 });
  chrome.root.children!.push({ id: 'tb', type: 'tab-bar' as SceneNode['type'] });
  const chromeI = await issues(chrome, 'mobile-artboard');
  check('undeclared wide canvas holding a mobile chrome primitive → warning', chromeI.length === 1 && chromeI[0].severity === 'warning', show(chromeI));

  const r = await evaluateCanvas(phone(content, { type: 'none' }), { mode: 'fast' });
  check('undeclared phone canvas: directive NOT READY', !buildEvaluateDirective(r).ready);
}

// ── rule gating ───────────────────────────────────────────────────────────
{
  console.log('\n── gating ──');
  const c = phone(`I("document", { type: "text", content: "Mon", fontSize: 9, position: "absolute", x: 0, y: 4 })`, { type: 'web' });
  const web = await issues(c);
  check('web canvas: only mobile-artboard can fire', web.every((i) => i.rule === 'mobile-artboard'), show(web));
  const filtered = await evaluateCanvas(phone('I("document", { type: "text", content: "x", fontSize: 9 })'), { mode: 'fast', categories: ['usability'] });
  check('a rule runs only with its category: no type-floor under categories [usability]', !filtered.issues.some((i) => i.rule === 'mobile-type-floor'));
}

// ── FR-C8 stress on mobile ────────────────────────────────────────────────
{
  console.log('\n── stress ──');
  let n = 0;
  const id = () => `s${++n}`;
  const text = (content: string): SceneNode => ({ id: id(), type: 'text', content });
  const row = (title: string): SceneNode => ({ id: id(), type: 'list-row' as SceneNode['type'], title, subtitle: 'Yesterday afternoon', trailing: { text: 'Open' } } as unknown as SceneNode);
  const tabs = { id: id(), type: 'tab-bar', items: [{ icon: 'house', label: 'Home' }, { icon: 'map', label: 'Routes' }] } as unknown as SceneNode;
  const list = { id: id(), type: 'frame', children: [row('Cedar Ridge loop'), row('Riverside tempo'), row('Old Mill recovery')] } as SceneNode;
  const root: SceneNode = { id: 'document', type: 'document', children: [text('FM'), text('Good morning'), list, tabs] } as SceneNode;
  const props = (r: SceneNode, k: number): Record<string, unknown> => (r.children![2].children![k] as unknown as Record<string, unknown>);

  const mob = applyPerturbation('long-text', root, { type: 'mobile' });
  check('mobile long-text: "FM" (≤3 chars) untouched', mob.root.children![0].content === 'FM');
  check('mobile long-text: list-row titles, subtitles and trailing text perturbed', String(props(mob.root, 0).title).length > 40 && String(props(mob.root, 1).subtitle).length > 40 && String((props(mob.root, 2).trailing as { text: string }).text).length > 20);
  const tabLabels = (r: SceneNode) => (r.children![3] as unknown as { items: { label: string }[] }).items.map((i) => i.label);
  check('mobile long-text: tab labels (fixed vocabulary) untouched', JSON.stringify(tabLabels(mob.root)) === '["Home","Routes"]');
  const i18n = applyPerturbation('i18n', root, { type: 'mobile' });
  check('mobile i18n: tab labels perturbed', tabLabels(i18n.root).every((l) => l.length > 6), JSON.stringify(tabLabels(i18n.root)));
  const web = applyPerturbation('long-text', root, { type: 'web' });
  check('web long-text: "FM" perturbed as before', (web.root.children![0].content as string).length > 10);
  check('the source tree is never mutated', root.children![0].content === 'FM' && props(root, 0).title === 'Cedar Ridge loop');

  const empty = applyPerturbation('empty', root, { type: 'mobile' });
  check('empty: a run of list-rows is removed, touched = its parent', empty.root.children![2].children!.length === 0 && empty.touched.includes(list.id));
  const many = applyPerturbation('many', root, { type: 'mobile' });
  check('many: the run ×3 with suffixed ids', many.root.children![2].children!.length === 9 && many.root.children![2].children!.some((r) => r.id.endsWith('-x2')));
  const lone = { id: 'document', type: 'document', children: [row('Only row')] } as SceneNode;
  check('a single list-row is not a list', applyPerturbation('empty', lone).touched.length === 0);

  // The directive: a type change makes the record stale for the note only.
  const clean = { overallScore: 100, issues: [], categories: [], summary: '', stats: {} } as never;
  const fragileOtherType = buildEvaluateDirective(clean, 0, { warnings: 2, current: false, ranAsType: 'mobile' });
  check('FRAGILE then a type change: still NOT READY, the note names the earlier type', !fragileOtherType.ready && fragileOtherType.directive.includes('earlier type ("mobile")'), fragileOtherType.directive);
  const fragileEdit = buildEvaluateDirective(clean, 0, { warnings: 2, current: false });
  check('FRAGILE then an edit: the note says earlier version', fragileEdit.directive.includes('earlier version'));
}

// ── the real tool handlers over MCP stdio ─────────────────────────────────
{
  console.log('\n── MCP tools ──');
  const home = mkdtempSync(join(tmpdir(), 'framesmith-mobile-mcp-'));
  const cwd = mkdtempSync(join(tmpdir(), 'framesmith-mobile-mcp-cwd-'));
  const transport = new StdioClientTransport({
    command: resolve('node_modules/.bin/tsx'),
    args: [resolve('src/index.ts')],
    cwd,
    env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test-mobile-rules', version: '0' });
  await client.connect(transport);
  async function tool(name: string, args: Record<string, unknown>) {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]?.text ?? '';
    try { return { ...JSON.parse(text), isError: r.isError }; } catch { return { text, isError: r.isError }; }
  }
  try {
    const bare = await tool('canvas_create', { name: 'Bare phone', width: 390, height: 844 });
    await tool('batch_design', { canvasId: bare.canvasId, operations: 'I("document", { type: "text", content: "Hello" })' });
    const ev = await tool('canvas_evaluate', { canvasId: bare.canvasId });
    const art = ev.issues.filter((i: EvaluationIssue) => i.rule === 'mobile-artboard');
    check('canvas_create({ width: 390 }) with no type → NOT READY with a mobile-artboard warning', art.length === 1 && art[0].severity === 'warning' && ev.directive.startsWith('NOT READY'), JSON.stringify(art));
    check('the issue carries its rule id and the surface report lists it', ev.surface.rulesOn.includes('mobile-artboard'));

    const m = await tool('canvas_create', { name: 'Phone', type: 'mobile' });
    await tool('batch_design', { canvasId: m.canvasId, operations: 'I("document", { type: "text", content: "Hello" })' });
    const v = await tool('canvas_add_variant', { canvasId: m.canvasId, state: 'empty' });
    const set = await tool('canvas_set_type', { canvasId: m.canvasId, type: 'web' });
    check('canvas_set_type names the variant left on the old type', Array.isArray(set.variantsOutOfSync) && set.variantsOutOfSync.length === 1 && set.variantsOutOfSync[0].type === 'mobile' && set.variantsOutOfSync[0].state === 'empty', JSON.stringify(set.variantsOutOfSync));
    const back = await tool('canvas_set_type', { canvasId: m.canvasId, type: 'mobile' });
    check('…and nothing once they agree again', back.variantsOutOfSync === undefined);
    void v;
  } finally {
    await client.close();
  }
}

console.log(allPass ? '\nAll mobile ruleset checks passed.' : '\nSome mobile ruleset checks FAILED.');
process.exit(allPass ? 0 : 1);
