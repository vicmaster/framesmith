// Phase 33 slice E — the archive page on the fixture store (FR-E1, FR-E2):
// select a canvas through its tree row, restore it, delete one through the
// shared dialog (Cancel first), and reach the empty state.
//
// Usage: npx tsx test/browser/test-viewer-archive.ts

import '../env.js';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { getCanvas } from '../../src/scene-graph.js';
import { startViewer } from '../../src/viewer.js';
import { seedViewerStore } from '../fixtures/viewer-store.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const store = seedViewerStore();
const { archived1, archived2, archived3 } = store.ids;
const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address() as { port: number }; s.close(() => resolve(p)); });
});
await startViewer(port);
const base = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

const selected = () => page.$eval('.panel', (p) => p.getAttribute('data-canvas-id'));
const rows = () => page.$$eval('.tree-row--canvas', (rs) => rs.map((r) => r.getAttribute('data-canvas-id')));
const current = () => page.$eval('.tree-row--canvas[aria-current="page"]', (r) => r.getAttribute('data-canvas-id'));

// ── FR-E1: tree and default selection ───────────────────────────────────────
await page.goto(`${base}/archive`, { waitUntil: 'load' });
check('header summary', (await page.$eval('.summary', (s) => s.textContent)) === '3 canvases · hidden from the gallery until restored');
check('canvases newest archived first', JSON.stringify(await rows()) === JSON.stringify([archived3, archived2, archived1]), JSON.stringify(await rows()));
check('the newest is selected by default', (await selected()) === archived3 && (await current()) === archived3);
const props = await page.$$eval('.prop', (ps) => ps.map((p) => `${p.querySelector('dt')!.textContent}=${p.querySelector('dd')!.textContent}`));
check('panel properties', props[0] === 'Project=Archived work' && props[1] === 'Archived=Nov 13, 2026' && /^Score=\d+$/.test(props[2]) && props[3] === 'Size=1440 × 900', JSON.stringify(props));
check('panel thumbnail renders the canvas', !!(await page.$('.panel .thumb iframe')));

// Selecting a row is a link to ?canvas=.
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click(`.tree-row--canvas[data-canvas-id="${archived2}"]`)]);
check('clicking a row selects it', (await selected()) === archived2 && page.url().endsWith(`?canvas=${archived2}`));
// A closed <details> skips its content's rendering; checkVisibility sees that.
const canvasRowShown = () => page.$eval('.tree-row--canvas', (r) => r.checkVisibility());
await page.click('.tree-row--project');
const collapsed = await canvasRowShown();
await page.click('.tree-row--project');
check('the project row collapses and expands its canvases', !collapsed && (await canvasRowShown()));

// ── Restore: back in its project, the next canvas selected ──────────────────
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#btn-restore')]);
check('Restore unarchives the canvas', getCanvas(archived2)!.archived === false);
check('…and reloads with the next canvas selected', (await selected()) === archived1 && JSON.stringify(await rows()) === JSON.stringify([archived3, archived1]));

// ── Delete permanently: Cancel keeps it, confirm deletes it ─────────────────
await page.click('#btn-delete');
check('Delete permanently opens the dialog', await page.$eval('#delete-dialog', (d) => !(d.closest('[data-dialog-scrim]') as HTMLElement).hidden));
check('…titled with the canvas', (await page.$eval('#delete-dialog-title', (t) => t.textContent)) === 'Delete old-1?');
await page.keyboard.press('Escape');
check('Escape cancels and keeps the canvas', !!getCanvas(archived1) && (await page.$eval('#delete-dialog', (d) => (d.closest('[data-dialog-scrim]') as HTMLElement).hidden)));
await page.click('#btn-delete');
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#delete-dialog [data-dialog-confirm]')]);
check('confirming deletes the canvas', getCanvas(archived1) === undefined);
check('…and selects the one before it', (await selected()) === archived3 && (await rows()).length === 1);

// ── FR-E2: the empty archive ─────────────────────────────────────────────────
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#btn-restore')]);
check('restoring the last canvas leaves the empty state', (await page.$eval('.empty-title', (t) => t.textContent)) === 'No archived canvases');
check('…with "0 canvases" and no panel', (await page.$eval('.summary', (s) => s.textContent)) === '0 canvases' && !(await page.$('.panel')));
check('the sidebar Archive count follows', (await page.$eval('.sidebar-archive .nav-count', (c) => c.textContent)) === '0');

check('no script errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(allPass ? 0 : 1);
