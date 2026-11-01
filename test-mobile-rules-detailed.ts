// Phase 30 slices C and D — the mobile ruleset where it needs Chrome:
// mobile-safe-area in detailed mode (rendered rects, pinned bars, sticky), and
// the canvas_stress record carrying the canvas type through the real tool
// handlers.
//
// Usage: npx tsx test-mobile-rules-detailed.ts

import './test-env.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { shutdown } from './src/screenshot.js';
import type { Canvas } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function phone(ops: string, opts: { bare?: boolean } = {}): Canvas {
  const c = createCanvas('phone', undefined, {}, { type: 'mobile' });
  if (opts.bare) delete c.root.safeArea;
  parseAndExecute(c.root, ops, c);
  return c;
}

async function safeArea(c: Canvas, mode: 'fast' | 'detailed'): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(c, { mode });
  return r.issues.filter((i) => i.rule === 'mobile-safe-area');
}
const show = (list: EvaluationIssue[]) => JSON.stringify(list.map((i) => `${i.severity} ${i.nodeId}: ${i.message.slice(0, 80)}`));

async function iss(c: Canvas, rule: string, mode: 'fast' | 'detailed' = 'fast', categories?: string[]): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(c, { mode, ...(categories ? { categories: categories as never } : {}) });
  return r.issues.filter((i) => i.rule === rule);
}

const flow = `f=I("document", { type: "frame", layout: "vertical", gap: 12, padding: [0, 16] })
I(f, { type: "text", content: "Today" })
I(f, { type: "text", content: "Nothing planned." })`;

try {
  console.log('── mobile-safe-area (detailed) ──');
  const clean = await safeArea(phone(flow), 'detailed');
  check('default path, content that fits → clean', clean.length === 0, show(clean));

  const abs = phone(`${flow}
I("document", { type: "text", content: "Offline", position: "absolute", x: 16, y: 10 })`);
  const absI = await safeArea(abs, 'detailed');
  check('absolute text at y 10 → warning in detailed too', absI.length === 1 && absI[0].severity === 'warning' && absI[0].message.includes('top'), show(absI));

  const low = await safeArea(phone(`${flow}
I("document", { type: "text", content: "Saved", position: "absolute", x: 16, y: 820 })`), 'detailed');
  check('absolute text in the bottom inset → warning', low.length === 1 && low[0].message.includes('bottom'), show(low));

  const bare = await safeArea(phone(flow, { bare: true }), 'detailed');
  check('no safeArea, content at y 0 → top warning', bare.some((i) => i.message.includes('top')), show(bare));

  const nested = phone(`${flow}
w=I("document", { type: "frame", layout: "vertical", height: 60 })
I(w, { type: "text", content: "Badge", position: "absolute", x: 0, y: -80 })`);
  const nestedFast = await safeArea(nested, 'fast');
  const nestedDetailed = await safeArea(nested, 'detailed');
  check('positioned content fast mode cannot place: fast says info, detailed places it', nestedFast.length === 1 && nestedFast[0].severity === 'info' && nestedDetailed.length === 1 && nestedDetailed[0].severity === 'warning', `${show(nestedFast)} / ${show(nestedDetailed)}`);

  // Slice D closed the slice C gap: the root grows to its content and keeps
  // its end padding, so a long screen on the default path is clean in both.
  const rows = Array.from({ length: 60 }, (_, k) => `I(f, { type: "text", content: "Row ${k + 1}" })`).join('\n');
  const tall = phone(`f=I("document", { type: "frame", layout: "vertical", gap: 8, padding: [0, 16] })\n${rows}`);
  const tallFast = await safeArea(tall, 'fast');
  const tallDetailed = await safeArea(tall, 'detailed');
  check('tall screen on the default path: detailed agrees with fast now (the root keeps its end padding)', tallDetailed.length === 0, show(tallDetailed));
  check('…and fast mode trusts the reservation, now correctly', tallFast.length === 0, show(tallFast));

  console.log('\n── boundaries (detailed) ──');
  check('G-D1 detailed + categories [usability] only still checks rendered rects (E21)', (await iss(nested, 'mobile-safe-area', 'detailed', ['usability'])).some((i) => i.severity === 'warning'));
  let ops = 'p0=I("document", { type: "frame" })\n'; for (let k = 1; k < 14; k++) ops += `p${k}=I(p${k - 1}, { type: "frame" })\n`; ops += 'I(p13, { type: "text", content: "Deep" })';
  check('G-D2 text 15 levels deep in the top inset (bare root) is seen in detailed (E22)', (await iss(phone(ops, { bare: true }), 'mobile-safe-area', 'detailed')).some((i) => i.message.includes('top')));
} finally {
  await shutdown();
}

// ── canvas_stress records the type ────────────────────────────────────────
{
  console.log('\n── stress record carries the type (MCP) ──');
  const home = mkdtempSync(join(tmpdir(), 'framesmith-mobile-stress-'));
  const cwd = mkdtempSync(join(tmpdir(), 'framesmith-mobile-stress-cwd-'));
  const transport = new StdioClientTransport({
    command: resolve('node_modules/.bin/tsx'),
    args: [resolve('src/index.ts')],
    cwd,
    env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test-mobile-rules-detailed', version: '0' });
  await client.connect(transport);
  async function tool(name: string, args: Record<string, unknown>) {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]?.text ?? '';
    try { return { ...JSON.parse(text), isError: r.isError }; } catch { return { text, isError: r.isError }; }
  }
  try {
    const m = await tool('canvas_create', { name: 'Fragile phone', type: 'mobile' });
    // A fixed 300×20 box holding one line: long copy wraps out of it → a clip.
    await tool('batch_design', { canvasId: m.canvasId, operations: `b=I("document", { type: "frame", width: 300, height: 20 })
I(b, { type: "text", content: "Morning run" })` });
    const run = await tool('canvas_stress', { canvasId: m.canvasId });
    check('stress run is FRAGILE', run.counts?.warnings > 0, JSON.stringify(run.counts));
    const before = await tool('canvas_evaluate', { canvasId: m.canvasId });
    check('evaluate reports the run under its type, current', before.stress?.type === 'mobile' && before.stress?.current === true, JSON.stringify(before.stress));

    await tool('canvas_set_type', { canvasId: m.canvasId, type: 'web' });
    const after = await tool('canvas_evaluate', { canvasId: m.canvasId });
    check('after canvas_set_type: same version hash, but the record is no longer current', after.stress?.current === false && after.stress?.type === 'mobile', JSON.stringify(after.stress));
    check('…the FRAGILE verdict still blocks, and the note names the earlier type', after.directive.startsWith('NOT READY') && after.directive.includes('earlier type ("mobile")'), after.directive);

    await tool('canvas_stress', { canvasId: m.canvasId });
    await tool('canvas_set_type', { canvasId: m.canvasId, type: null });
    const cleared = await tool('canvas_evaluate', { canvasId: m.canvasId });
    check('declared web → cleared (default web) is no type change: the record stays current', cleared.stress?.type === 'web' && cleared.stress?.current === true, JSON.stringify(cleared.stress));
  } finally {
    await client.close();
  }
}

// ── stress wiring boundaries (MCP) ──
{
  const home = mkdtempSync(join(tmpdir(), 'fm-gap-')); const cwd = mkdtempSync(join(tmpdir(), 'fm-gap-cwd-'));
  const transport = new StdioClientTransport({ command: resolve('node_modules/.bin/tsx'), args: [resolve('src/index.ts')], cwd,
    env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>, stderr: 'ignore' });
  const client = new Client({ name: 'gap', version: '0' }); await client.connect(transport);
  const tool = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[] }; try { return JSON.parse(r.content[0].text); } catch { return { text: r.content[0]?.text }; } };
  try {
    const m = await tool('canvas_create', { name: 'Mono', type: 'mobile' });
    await tool('batch_design', { canvasId: m.canvasId, operations: 'b=I("document", { type: "frame", width: 40, height: 20 })\nI(b, { type: "text", content: "FM" })' });
    const s = await tool('canvas_stress', { canvasId: m.canvasId, perturbations: ['long-text'] });
    check('G-M1 canvas_stress on a mobile canvas leaves a 2-char monogram alone (X05)', s.counts?.warnings === 0, JSON.stringify(s.counts) + JSON.stringify(s.perturbations ?? s.results ?? '').slice(0, 120));
    const w = await tool('canvas_create', { name: 'Web', type: 'web', width: 600, height: 400 });
    await tool('batch_design', { canvasId: w.canvasId, operations: 'b=I("document", { type: "frame", width: 300, height: 20 })\nI(b, { type: "text", content: "Morning run" })' });
    await tool('canvas_stress', { canvasId: w.canvasId });
    const cur = await tool('canvas_evaluate', { canvasId: w.canvasId });
    check('G-M2 directive says "this exact version" when the run is current (D02)', cur.stress?.current === true && cur.directive.includes('this exact version'), cur.directive.slice(0, 200));
    await tool('batch_design', { canvasId: w.canvasId, operations: 'I("document", { type: "text", content: "Edited" })' });
    const aft = await tool('canvas_evaluate', { canvasId: w.canvasId });
    check('G-M3 after an edit the same-type record is no longer current (X04)', aft.stress?.current === false && aft.directive.includes('earlier version'), JSON.stringify(aft.stress));
  } finally { await client.close(); }
}

// ── slice D: pinned positioning in detailed mode ──────────────────────────
{
  console.log('\n── slice D: detailed ──');
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `I(list, { type: "list-row", name: "Row ${i}", title: "Row ${i}" })`).join('\n');
  const bareBar = phone(`bar=I("document", { type: "frame", name: "CTA", position: "fixed", bottom: 0, layout: "vertical" })
I(bar, { type: "button", name: "Pay", label: "Pay" })`);
  check('a fixed CTA at bottom 0 with no padding warns in detailed mode too', (await safeArea(bareBar, 'detailed')).some((i) => i.severity === 'warning' && i.message.includes('Pay')), show(await safeArea(bareBar, 'detailed')));

  const idiom = (spacer: number) => phone(`list=I("document", { type: "frame", layout: "vertical" })
${rows(30)}
I(list, { type: "frame", name: "End spacer", height: ${spacer} })
bar=I("document", { type: "frame", name: "CTA", position: "fixed", bottom: 0, layout: "vertical", padding: [12, 16, 12, 16], fill: "#FFFFFF" })
I(bar, { type: "button", name: "Pay", label: "Pay", width: "100%" })
I(bar, { type: "frame", name: "Inset", height: 34 })`);
  const goodFast = await safeArea(idiom(68), 'fast');
  const goodDetailed = await safeArea(idiom(68), 'detailed');
  check('the pinned-bar idiom on a long screen passes both modes', goodFast.length === 0 && goodDetailed.length === 0, `${show(goodFast)} / ${show(goodDetailed)}`);
  const shortDetailed = await safeArea(idiom(20), 'detailed');
  check('…a short end spacer leaves the last row under the bar at max scroll (detailed agrees with fast)', shortDetailed.some((i) => i.message.includes('under pinned "CTA"') && i.message.includes('Row 29')), show(shortDetailed));

  const tabbed = phone(`list=I("document", { type: "frame", layout: "vertical" })
${rows(30)}
I("document", { type: "tab-bar", variant: "fab", items: [{ icon: "house", label: "A" }, { icon: "map", label: "B" }, { icon: "user", label: "C" }, { icon: "bell", label: "D" }] })`);
  const tb = await safeArea(tabbed, 'detailed');
  check('a long screen with a fab tab-bar: the renderer reserves it, detailed is clean', tb.length === 0, show(tb));

  const sticky = phone(`list=I("document", { type: "frame", layout: "vertical" })
${rows(3)}
h=I(list, { type: "frame", position: "sticky", y: 0, layout: "vertical" })
I(h, { type: "text", name: "Header", content: "Header" })
${rows(20).replace(/Row (\\d+)/g, 'Later $1')}`);
  const st = await safeArea(sticky, 'detailed');
  check('a sticky header at y 0 warns at its stuck position in detailed mode', st.some((i) => i.message.includes('Header') && i.message.includes('sticks')), show(st));

  const nav = phone(`I("document", { type: "nav-bar", name: "Nav", title: "Inbox", position: "fixed", y: 47 })
I("document", { type: "text", name: "First", content: "First message" })`);
  const nv = await safeArea(nav, 'detailed');
  check('a fixed nav-bar at y 47 over the first content warns in detailed mode', nv.some((i) => i.message.includes('First') && i.message.includes('start of the scroll')), show(nv));

  const overflowRoot = phone(`list=I("document", { type: "frame", layout: "vertical" })
${rows(30)}
U("document", { overflow: "auto" })`);
  const ov = await safeArea(overflowRoot, 'detailed');
  check('a root with overflow: auto and safeArea: no false end-of-scroll warning', ov.length === 0, show(ov));

  const long = phone(`list=I("document", { type: "frame", layout: "vertical" })
${rows(30)}`);
  const lg = await safeArea(long, 'detailed');
  check('the slice C gap is closed: a long safeArea screen is clean in detailed mode with no spacer', lg.length === 0, show(lg));
}

console.log(allPass ? '\nAll detailed mobile checks passed.' : '\nSome detailed mobile checks FAILED.');
process.exit(allPass ? 0 : 1);
