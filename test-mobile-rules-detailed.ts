// Phase 30 slice C — the mobile ruleset where it needs Chrome: mobile-safe-area
// in detailed mode (rendered rects), and the canvas_stress record carrying the
// canvas type through the real tool handlers.
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

  // The known gap until slice D: a fixed-height root does not carry its end
  // padding past overflowing content, so a long screen ends in the inset.
  const rows = Array.from({ length: 60 }, (_, k) => `I(f, { type: "text", content: "Row ${k + 1}" })`).join('\n');
  const tall = phone(`f=I("document", { type: "frame", layout: "vertical", gap: 8, padding: [0, 16] })\n${rows}`);
  const tallFast = await safeArea(tall, 'fast');
  const tallDetailed = await safeArea(tall, 'detailed');
  check('tall screen on the default path: detailed catches the document end in the inset', tallDetailed.length > 0 && tallDetailed.every((i) => i.message.includes('end of the scroll')), show(tallDetailed));
  check('…which fast mode trusts the reservation for (recorded gap until slice D)', tallFast.length === 0, show(tallFast));
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

console.log(allPass ? '\nAll detailed mobile checks passed.' : '\nSome detailed mobile checks FAILED.');
process.exit(allPass ? 0 : 1);
