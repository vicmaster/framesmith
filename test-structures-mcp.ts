// Phase 30 slice E — anatomy resolution through the REAL tool handlers.
// test-structures covers resolveStructure / listStructures / applyStructure;
// this drives list_structures and apply_structure over MCP stdio, so a handler
// that stops reading the canvas type or drops `realisation` fails here.
//
// Usage: npx tsx test-structures-mcp.ts

import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const home = mkdtempSync(join(tmpdir(), 'framesmith-structures-mcp-'));
const cwd = mkdtempSync(join(tmpdir(), 'framesmith-structures-mcp-cwd-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-structures-mcp', version: '0' });
await client.connect(transport);

async function tool(name: string, args: Record<string, unknown>): Promise<{ data: any; text: string; isError: boolean }> {
  const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
  const text = r.content[0]?.text ?? '';
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* an error string */ }
  return { data, text, isError: r.isError === true };
}

const names = (list: { name: string }[]): string[] => list.map((s) => s.name);

try {
  const phone = (await tool('canvas_create', { name: 'phone', type: 'mobile' })).data.canvasId;
  const web = (await tool('canvas_create', { name: 'web' })).data.canvasId;

  // list_structures: neither → web; canvasId → that canvas's type; type → that type.
  const plain = (await tool('list_structures', {})).data;
  check('no canvasId or type lists web', names(plain).includes('dashboard') && !names(plain).includes('dashboard-mobile'));
  check('entries carry anatomy, surface and surfaces', plain.find((s: any) => s.name === 'dashboard')?.anatomy === 'dashboard'
    && JSON.stringify(plain.find((s: any) => s.name === 'dashboard')?.surfaces) === '["web","mobile"]');
  const byCanvas = (await tool('list_structures', { canvasId: phone })).data;
  check('canvasId of a mobile canvas lists the mobile realisations', names(byCanvas).includes('feed-mobile') && !names(byCanvas).includes('pricing'));
  check('canvasId of a web canvas lists web', names((await tool('list_structures', { canvasId: web })).data).includes('pricing'));
  check('type "mobile" lists the mobile realisations', names((await tool('list_structures', { type: 'mobile' })).data).includes('detail-mobile'));
  const both = await tool('list_structures', { canvasId: phone, type: 'web' });
  check('canvasId and type together is an error', both.isError && /not both/.test(both.text), both.text);
  const missing = await tool('list_structures', { canvasId: 'nope' });
  check('an unknown canvasId is an error', missing.isError && /Canvas not found/.test(missing.text), missing.text);

  // apply_structure resolves by the canvas type.
  const stamped = (await tool('apply_structure', { canvasId: phone, structure: 'dashboard' })).data;
  check('dashboard on a mobile canvas stamps dashboard-mobile', stamped.applied === 'dashboard-mobile' && stamped.anatomy === 'dashboard' && stamped.surface === 'mobile', JSON.stringify({ applied: stamped.applied, anatomy: stamped.anatomy }));
  const refused = await tool('apply_structure', { canvasId: phone, structure: 'pricing', replace: true });
  check('pricing on a mobile canvas refuses, listing the mobile anatomies', refused.isError && /no mobile realisation.*dashboard, settings, auth, onboarding, feed, detail/.test(refused.text), refused.text);
  const forced = (await tool('apply_structure', { canvasId: phone, structure: 'dashboard', replace: true, realisation: 'web' })).data;
  check('realisation "web" stamps the web dashboard on a mobile canvas', forced.applied === 'dashboard' && forced.surface === 'web', forced.applied);

  // A canvas re-declared mobile resolves the same way.
  await tool('canvas_set_type', { canvasId: web, type: 'mobile' });
  check('canvas_set_type to mobile changes what settings resolves to', (await tool('apply_structure', { canvasId: web, structure: 'settings' })).data.applied === 'settings-mobile');

  // The handler passes the canvas's resolved tokens: a generated phone system's
  // colours are never overwritten by the seeded neutral defaults.
  const themed = (await tool('canvas_create', { name: 'themed', type: 'mobile' })).data.canvasId;
  await tool('generate_design_system', { canvasId: themed, seed: '#166534', personality: 'soft' });
  const seeded = (await tool('apply_structure', { canvasId: themed, structure: 'settings' })).data.seededColors as string[];
  check('a stamp after generate_design_system seeds none of the system\'s colours', !['accent', 'text-primary', 'bg-surface', 'border'].some((t) => seeded.includes(t)), seeded.join(', '));

  // list_structures reads the canvas fresh: a type written to disk under the
  // server (a git pull) is what it lists for.
  const pulled = (await tool('canvas_create', { name: 'pulled' })).data.canvasId;
  const file = join(home, 'canvases', `${pulled}.json`);
  const stored = JSON.parse(readFileSync(file, 'utf-8'));
  stored.metadata = { ...stored.metadata, surface: { type: 'mobile', device: 'iphone-390' } };
  writeFileSync(file, JSON.stringify(stored));
  const later = new Date(Date.now() + 5000);
  utimesSync(file, later, later);
  check('list_structures sees a type changed on disk', names((await tool('list_structures', { canvasId: pulled })).data).includes('feed-mobile'));
} finally {
  await client.close();
}

console.log(allPass ? '\nAll structures MCP tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
