// A page on another origin, in a real browser, can neither read the viewer's
// data nor change a canvas, while the viewer's own page still can.
//
// Usage: npx tsx test/browser/test-viewer-origin.ts

import '../env.js';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject } from '../../src/workspaces.js';
import { createCanvas, getCanvas } from '../../src/scene-graph.js';
import { startViewer } from '../../src/viewer.js';
import { DEFAULT_PROJECT_ID } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
});

loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
const canvas = createCanvas('origin', DEFAULT_PROJECT_ID);
const port = await freePort();
await startViewer(port);
const viewer = `http://127.0.0.1:${port}`;

// The other site: a blank page on another port.
const otherPort = await freePort();
const other = createHttpServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!DOCTYPE html><title>other</title>'); });
await new Promise<void>((r) => other.listen(otherPort, '127.0.0.1', r));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const origin of [`http://127.0.0.1:${otherPort}`, `http://localhost:${otherPort}`]) {
  await page.goto(origin, { waitUntil: 'load' });
  const read = await page.evaluate(async (url) => {
    try { await (await fetch(url)).json(); return 'read'; } catch { return 'blocked'; }
  }, `${viewer}/api/canvases`);
  check(`${origin}: cannot read the canvas list`, read === 'blocked', read);
  // A no-cors POST and a form POST are "simple": the browser sends them with
  // no preflight, so only the server can refuse them.
  await page.evaluate(async (url) => { await fetch(url, { method: 'POST', mode: 'no-cors' }).catch(() => {}); }, `${viewer}/api/canvas/${canvas.id}/archive`);
  await page.evaluate((url) => {
    const form = document.createElement('form');
    form.method = 'POST'; form.action = url; document.body.appendChild(form); form.submit();
  }, `${viewer}/api/canvas/${canvas.id}/archive`);
  await page.waitForNavigation({ waitUntil: 'load' }).catch(() => null);
  check(`${origin}: a no-cors fetch and a form POST leave the canvas unarchived`, getCanvas(canvas.id)?.archived !== true);
}

// The viewer's own page: the More menu's Archive still works.
await page.goto(`${viewer}/canvas/${canvas.id}`, { waitUntil: 'load' });
const status = await page.evaluate(async (id) => (await fetch(`/api/canvas/${id}/archive`, { method: 'POST' })).status, canvas.id);
check('the viewer\'s own page can archive', status === 200 && getCanvas(canvas.id)?.archived === true, String(status));

await browser.close();
other.close();
process.exit(allPass ? 0 : 1);
