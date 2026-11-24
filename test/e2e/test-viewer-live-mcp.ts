// Phase 33 slice D (FR-D4), end to end: the real MCP server with its embedded
// viewer. A comment the agent resolves with resolve_feedback moves to Resolved
// on an open detail page, and an edit through batch_design updates the score,
// both without a reload.
//
// Usage: npx tsx test/e2e/test-viewer-live-mcp.ts

import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// A free port pinned for the embedded viewer: left to itself the server would
// reuse any viewer already running on 3001–3020.
const viewerPort = await new Promise<number>((done) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); });
});
const home = mkdtempSync(join(tmpdir(), 'framesmith-live-mcp-'));
const cwd = mkdtempSync(join(tmpdir(), 'framesmith-live-mcp-cwd-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_PORT: String(viewerPort) } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-viewer-live-mcp', version: '0' });
await client.connect(transport);
const tool = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 }) as { content: Array<{ text?: string }> };
  const text = r.content[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return text; }
};

const created = await tool('canvas_create', { name: 'live' });
const canvasId = created.canvasId as string;
await tool('batch_design', { canvasId, operations: 'I("document", { type: "frame", name: "Card", width: 400, height: 200, fill: "#FFFFFF", padding: 24, children: [{ type: "text", content: "Hello", fontSize: 16, color: "#111111" }] })' });
const viewer = await tool('viewer_url', {});
const base = String(viewer.url ?? viewer).replace(/\/$/, '');
check('the server runs its own embedded viewer on the pinned port', base.endsWith(`:${viewerPort}`), base);

// A comment from the "user", through the viewer's own route.
const posted = await (await fetch(`${base}/api/canvas/${canvasId}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: 'Make the card wider.' }) })).json() as { entry?: { id: string }; id?: string };
const fbId = posted.entry?.id ?? posted.id;
check('the comment is saved', typeof fbId === 'string');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${base}/canvas/${canvasId}`, { waitUntil: 'load' });
await page.evaluate(() => { (window as unknown as { __mark: boolean }).__mark = true; });
await page.click('#tab-feedback');
await page.waitForFunction(() => document.querySelectorAll('#fb-pane .fb-card').length === 1, { timeout: 5000 }).catch(() => null);
check('the open page lists the comment as open', (await page.$$('#fb-pane .fb-card:not(.resolved)')).length === 1);

const resolved = await tool('resolve_feedback', { canvasId, feedbackIds: [fbId], note: 'Widened it to 560.' });
check('resolve_feedback resolves it', JSON.stringify(resolved).includes(String(fbId)));
await page.waitForFunction(() => document.querySelectorAll('#fb-pane .fb-card.resolved').length === 1, { timeout: 6000 }).catch(() => null);
check('the page moves it to Resolved within two polls, without a reload', (await page.$$('#fb-pane .fb-card.resolved')).length === 1 && await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark === true));
check('…showing the agent\'s reply', (await page.$eval('#fb-pane .fb-card.resolved .fb-reply', (r) => r.textContent).catch(() => '')) === 'agent: Widened it to 560.');

await page.click('#tab-quality');
const before = await page.$eval('.score-value', (s) => s.textContent);
await tool('batch_design', { canvasId, operations: 'I("document", { type: "frame", width: 100, height: 40, gap: 13, layout: "horizontal" })\nI("document", { type: "text", content: "note", fontSize: 13, color: "#F0F0F0" })' });
await page.waitForFunction((b) => document.querySelector('.score-value')?.textContent !== b, { timeout: 6000 }, before).catch(() => null);
const after = await page.$eval('.score-value', (s) => s.textContent);
check('an edit through batch_design updates the score without a reload', after !== before && await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark === true), `${before} → ${after}`);

await browser.close();
await client.close();
process.exit(allPass ? 0 : 1);
