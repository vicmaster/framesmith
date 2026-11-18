// Phase 31 slice I, spec change S11 — detailed canvas_evaluate lays out in
// the design system's fonts, as screenshot and canvas_stress render them.
// Driven through the real canvas_evaluate handler over MCP stdio, because the
// handler is where the fonts are prepared. The body token's family is the
// generic `monospace` (it needs no download and is far wider than any sans on
// every OS), so the face decides two detailed verdicts:
//   - a toast that fits in a sans face leaves the window in monospace
//     (desktop-app-overlay reads the main detailed layout), and
//   - a 20px button pushed right by a run of "i"s lands on top of another 20px
//     button only in monospace (desktop-app-target's 24px circle reads the
//     census layout).
// The twin is the same canvas whose body is `sans-serif`: neither fires.
// Also: a family that cannot load comes back as a "Font warnings" item in
// detailed mode, and fast mode renders nothing, so it has none.
//
// Usage: npx tsx test-evaluate-fonts.ts

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const home = mkdtempSync(join(tmpdir(), 'framesmith-evaluate-fonts-'));
const cwd = mkdtempSync(join(tmpdir(), 'framesmith-evaluate-fonts-cwd-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-evaluate-fonts', version: '0' });
await client.connect(transport);

type Content = { type: string; text?: string };
async function call(name: string, args: Record<string, unknown>): Promise<Content[]> {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 170_000 }) as { content: Content[] };
  return r.content;
}
const json = (c: Content[]) => JSON.parse(c[0]?.text ?? '{}');
type Issue = { severity: string; rule?: string; nodeId?: string; nodeIds?: string[]; message?: string };

const RUN = 'i'.repeat(16);
const OPS = `
row1=I("document", { type: "frame", name: "Row 1", layout: "horizontal", alignItems: "start", gap: 0 })
I(row1, { type: "text", name: "Run", content: "${RUN}", fontSize: 14, lineHeight: 1.4, color: "#1F2937" })
I(row1, { type: "button", name: "A", icon: "plus", ariaLabel: "Add", variant: "ghost", size: "xs", height: 20, color: "#1F2937" })
row2=I("document", { type: "frame", name: "Row 2", layout: "horizontal", alignItems: "start", gap: 0 })
I(row2, { type: "frame", name: "Spacer", width: 134, height: 20 })
I(row2, { type: "button", name: "B", icon: "minus", ariaLabel: "Remove", variant: "ghost", size: "xs", height: 20, color: "#1F2937" })
I("document", { type: "toast", name: "Toast", text: "${'i'.repeat(60)}", x: 1040, y: 820 })
`;

async function canvasWithBody(family: string) {
  const c = json(await call('canvas_create', { name: `body ${family}`, type: 'desktop-app' }));
  await call('set_variables', { canvasId: c.canvasId, variables: { typography: { body: { fontSize: 14, fontFamily: family } } } });
  const b = json(await call('batch_design', { canvasId: c.canvasId, operations: OPS }));
  check(`${family}: the fixture applies`, (b.errors ?? []).length === 0, JSON.stringify(b.errors ?? []).slice(0, 200));
  return c.canvasId as string;
}

try {
  for (const [family, fires] of [['monospace', true], ['sans-serif', false]] as const) {
    const id = await canvasWithBody(family);
    const issues = json(await call('canvas_evaluate', { canvasId: id, mode: 'detailed' })).issues as Issue[];
    const overlay = issues.filter((i) => i.rule === 'desktop-app-overlay' && i.severity === 'warning' && /viewport/.test(i.message ?? ''));
    const targets = issues.filter((i) => i.rule === 'desktop-app-target' && i.severity === 'error');
    const describe = (l: Issue[]) => l.map((i) => `${i.severity}:${(i.message ?? '').slice(0, 80)}`).join(' | ');
    if (fires) {
      check('monospace body: the wide toast leaves the window in detailed mode (the main layout reads the face)', overlay.length === 1, describe(overlay));
      check('monospace body: the pushed 20px button meets the other one (the 24px-circle layout reads the face)', targets.length === 2, describe(targets));
    } else {
      check('twin, sans-serif body: the toast fits the window', overlay.length === 0, describe(overlay));
      check('twin, sans-serif body: the two 20px buttons stay apart', targets.length === 0, describe(targets));
    }
  }

  // A family that cannot load: a Font warnings item in detailed mode only.
  const c = json(await call('canvas_create', { name: 'missing face', type: 'desktop-app' }));
  await call('set_variables', { canvasId: c.canvasId, variables: { typography: { body: { fontSize: 14, fontFamily: 'Zzqxv Nonexistent Sans' } } } });
  await call('batch_design', { canvasId: c.canvasId, operations: 'I("document", { type: "text", content: "Hello", fontSize: 14, color: "#1F2937" })' });
  const detailed = await call('canvas_evaluate', { canvasId: c.canvasId, mode: 'detailed' });
  const fast = await call('canvas_evaluate', { canvasId: c.canvasId, mode: 'fast' });
  const warned = detailed.filter((x) => x.type === 'text' && x.text?.startsWith('Font warnings'));
  check('detailed: the result stays in the first content item', typeof json(detailed).overallScore === 'number');
  check('detailed: a face that cannot load comes back as a Font warnings item naming it', warned.length === 1 && /Zzqxv Nonexistent Sans/.test(warned[0].text ?? ''), warned.map((x) => x.text).join(' ').slice(0, 160));
  check('fast: renders nothing, so no Font warnings item', fast.length === 1, `${fast.length} items`);
} finally {
  await client.close();
}

console.log(allPass ? '\nAll checks passed.' : '\nSome checks FAILED.');
process.exit(allPass ? 0 : 1);
