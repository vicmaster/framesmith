// Phase 33 slice C — the detail page's shell on the fixture store: the toolbar
// by canvas type with the state nav (FR-C1), the More menu (FR-C2), the delete
// dialog (FR-C3) and the preview tools (FR-C4).
//
// Usage: npx tsx test/browser/test-viewer-detail.ts

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
const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address() as { port: number }; s.close(() => resolve(p)); });
});
await startViewer(port);
const base = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
await browser.defaultBrowserContext().overridePermissions(base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
const open = (id: string) => page.goto(`${base}/canvas/${id}`, { waitUntil: 'load' });
const tabs = () => page.$$eval('.bp-btn', (bs) => bs.map((b) => `${b.textContent}${b.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── FR-C1: the toolbar by type ───────────────────────────────────────────────
await open(store.ids.withStates);
check('web: Mobile, Tablet, Desktop (selected), Compare', JSON.stringify(await tabs()) === '["Mobile","Tablet","Desktop*","Compare"]', JSON.stringify(await tabs()));
const back = await page.$eval('.back-link', (a) => ({ href: a.getAttribute('href'), text: a.textContent!.trim() }));
check('the back link names the project and goes to it', back.href === `/project/${store.patternProjectId}` && back.text === 'Pattern library', JSON.stringify(back));
check('the size sits after the name', (await page.$eval('.toolbar .dim', (d) => d.textContent)) === '1440 × 900');
const states = await page.$$eval('.state-nav a', (as) => as.map((a) => `${a.textContent}${a.getAttribute('aria-current') ? '*' : ''}`));
check('the state nav lists default (current), empty and loading', JSON.stringify(states) === '["default*","empty","loading"]', JSON.stringify(states));
check('the state nav is a nav of links, not a tablist', await page.$eval('.state-nav', (n) => n.tagName === 'NAV' && n.getAttribute('aria-label') === 'States' && !n.querySelector('[role="tab"]')));
check('the caption names the type, size and states', (await page.$eval('.caption', (c) => c.textContent)) === 'Web · 1440 × 900 · States: empty, loading');
check('the Live status is on the toolbar', (await page.$eval('#live .live-label', (l) => l.textContent)) === 'Live');

await open(store.ids.desktopApp);
check('desktop-app: 1024, 1280, 1440 (selected), Compare', JSON.stringify(await tabs()) === '["1024","1280","1440*","Compare"]', JSON.stringify(await tabs()));
check('desktop-app: the size names the window', (await page.$eval('.toolbar .dim', (d) => d.textContent)) === '1440 × 900 · window-1440');
await open(store.ids.mobile);
check('mobile: no breakpoint tabs', (await tabs()).length === 0);
check('mobile: the size names the device', (await page.$eval('.toolbar .dim', (d) => d.textContent)) === '390 × 844 · iphone-390');
check('mobile: no zoom tools, a Safe area button', !(await page.$('#btn-zoom-in')) && !!(await page.$('#btn-safe')));
await page.click('#btn-safe');
check('mobile: Safe area shows the overlay', await page.$eval('#safe-overlay', (o) => !(o as HTMLElement).hidden) && (await page.$eval('#btn-safe', (b) => b.getAttribute('aria-pressed'))) === 'true');

await open(store.ids.withFeedback);
check('the Comment button counts open comments', (await page.$eval('#btn-comment .tab-count', (c) => c.textContent).catch(() => null)) === '1');

// Keyboard: the breakpoint tabs move with the arrow keys and switch the preview.
await open(store.ids.withStates);
await page.focus('#bp-desktop');
await page.keyboard.press('ArrowLeft');
await pause(200);
check('ArrowLeft selects Tablet and resizes the preview', JSON.stringify(await tabs()) === '["Mobile","Tablet*","Desktop","Compare"]' && (await page.$eval('#frame', (f) => f.getAttribute('width'))) === '768', JSON.stringify(await tabs()));

// ── FR-C4: preview tools ─────────────────────────────────────────────────────
await open(store.ids.withStates);
const stage = () => page.$eval('#stage', (s) => ({ scale: Number((s as HTMLElement).dataset.scale), mode: (s as HTMLElement).dataset.mode, box: (document.getElementById('frame-box') as HTMLElement).getBoundingClientRect().width }));
const fit = await stage();
check('the preview opens fitted, below 100%', fit.mode === 'fit' && fit.scale > 0.3 && fit.scale < 1, JSON.stringify(fit));
check('the box takes the scaled width', Math.abs(fit.box - 1440 * fit.scale) <= 2, JSON.stringify(fit));
await page.click('#btn-zoom-in');
const zoomedIn = await stage();
check('zoom in goes to the next step above', zoomedIn.mode === 'zoom' && zoomedIn.scale === [0.5, 0.75, 1, 1.5, 2].find((s) => s > fit.scale), JSON.stringify(zoomedIn));
await page.click('#btn-zoom-in');
await page.click('#btn-zoom-out');
check('zoom out goes to the next step below', (await stage()).scale === zoomedIn.scale);
const scrolls = await page.$eval('#viewport', (v) => { v.scrollLeft = 0; return v.scrollWidth > v.clientWidth; });
await page.click('#btn-zoom-in'); await page.click('#btn-zoom-in');
check('above the pane width, the pane scrolls over the preview', await page.$eval('#viewport', (v) => v.scrollWidth > v.clientWidth), String(scrolls));
await page.click('#btn-fit');
check('Fit returns to fitted', JSON.stringify(await stage()) === JSON.stringify(fit));
await page.click('#btn-zoom-in');
await page.click('#bp-tablet');
await pause(200);
const tablet = await stage();
check('choosing a breakpoint resets to fit', tablet.mode === 'fit' && tablet.scale === 1, JSON.stringify(tablet));
await page.click('#bp-compare');
check('Compare disables the zoom tools', await page.$eval('#btn-zoom-in', (b) => (b as HTMLButtonElement).disabled) && await page.$eval('#btn-fit', (b) => (b as HTMLButtonElement).disabled));
await page.click('#bp-desktop');
check('leaving Compare enables them again', !(await page.$eval('#btn-zoom-in', (b) => (b as HTMLButtonElement).disabled)));

await open(store.ids.dashboard);
check('a canvas with no dark layer has no theme button', !(await page.$('#theme-toggle')));
await open(store.ids.themed);
check('a canvas with a dark layer has the theme button, off', (await page.$eval('#theme-toggle', (b) => b.getAttribute('aria-pressed')).catch(() => null)) === 'false');
await page.click('#theme-toggle');
check('the theme button renders the preview dark', (await page.$eval('#frame', (f) => f.getAttribute('src') ?? '')).includes('theme=dark') && (await page.$eval('#theme-toggle', (b) => b.getAttribute('aria-pressed'))) === 'true');
check('…and keeps its label', (await page.$eval('#theme-toggle', (b) => b.getAttribute('aria-label'))) === 'Preview in dark');
await page.click('#theme-toggle');
check('pressing it again renders the preview light', !(await page.$eval('#frame', (f) => f.getAttribute('src') ?? '')).includes('theme=dark'));

// The frame shows the whole artboard: at 100% its inner box is the artboard.
await page.click('#bp-desktop');
while (await page.$eval('#btn-zoom-in', (b) => !(b as HTMLButtonElement).disabled) && Number(await page.$eval('#stage', (s) => (s as HTMLElement).dataset.scale)) < 1) await page.click('#btn-zoom-in');
check('at 100% the frame shows all 1440 × 900', JSON.stringify(await page.$eval('#frame-box', (b) => [b.clientWidth, b.clientHeight])) === '[1440,900]', JSON.stringify(await page.$eval('#frame-box', (b) => [b.clientWidth, b.clientHeight])));
await page.click('#btn-zoom-in'); await page.click('#btn-zoom-in');
check('zoom in is disabled at the largest step', await page.$eval('#btn-zoom-in', (b) => (b as HTMLButtonElement).disabled));

// ── FR-C2: the More menu ─────────────────────────────────────────────────────
await open(store.ids.auth);
const more = '[aria-label="More actions"]';
await page.focus(more);
await page.keyboard.press('Enter');
check('More opens by keyboard with View JSON focused', await page.evaluate(() => (document.activeElement as HTMLElement).dataset.action === 'json'));
await page.keyboard.press('Escape');
check('Escape closes it and returns focus', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'More actions' && (document.getElementById('more-menu') as HTMLElement).hidden));
await page.click(more);
await page.click('[data-action="json"]');
await page.waitForFunction(() => document.getElementById('json-content')!.textContent!.includes('"root"'), { timeout: 3000 }).catch(() => null);
check('View JSON opens the panel with the canvas', await page.$eval('#json-panel', (p) => !(p as HTMLElement).hidden && p.textContent!.includes(`"name": "auth"`)));
await page.click('[aria-label="Close JSON"]');
check('the panel closes', await page.$eval('#json-panel', (p) => (p as HTMLElement).hidden));
await page.click(more);
await page.click('[data-action="copy"]');
await pause(150);
check('Copy canvas ID says Copied in place', (await page.$eval('[data-action="copy"] span', (s) => s.textContent)) === 'Copied');
check('…and the clipboard holds the id', (await page.evaluate(() => navigator.clipboard.readText())) === store.ids.auth);
await page.click('[data-action="copy"]');
await pause(2100);
check('…and the label returns after 2 seconds, even after a second copy', (await page.$eval('[data-action="copy"] span', (s) => s.textContent)) === 'Copy canvas ID');
await page.keyboard.press('Escape');

await page.click(more);
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-action="archive"]')]);
check('Archive archives the canvas and goes to the project', getCanvas(store.ids.auth)!.archived === true && page.url().endsWith(`/project/${store.patternProjectId}`));
await open(store.ids.auth);
await page.click(more);
check('an archived canvas offers Restore, not Archive', !!(await page.$('[data-action="unarchive"]')) && !(await page.$('[data-action="archive"]')));
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-action="unarchive"]')]);
check('Restore brings it back', getCanvas(store.ids.auth)!.archived !== true);

// ── FR-C3: the delete dialog ─────────────────────────────────────────────────
await open(store.ids.catalogue);
await page.click(more);
await page.click('[data-action="delete"]');
const dialog = await page.$eval('#delete-dialog', (d) => ({ shown: !(d.closest('[data-dialog-scrim]') as HTMLElement).hidden, title: d.querySelector('.dialog-title')!.textContent, body: d.querySelector('.dialog-body')!.textContent }));
check('Delete canvas opens the dialog, titled with the name', dialog.shown && dialog.title === 'Delete catalogue?', JSON.stringify(dialog));
check('…saying it cannot be undone and offering archive', dialog.body!.includes('cannot be restored') && dialog.body!.includes('archive it instead'));
check('focus starts on Cancel', await page.evaluate(() => document.activeElement?.textContent === 'Cancel'));
await page.click('[data-dialog-cancel]');
check('Cancel leaves the canvas', !!getCanvas(store.ids.catalogue) && await page.$eval('#delete-dialog', (d) => (d.closest('[data-dialog-scrim]') as HTMLElement).hidden));
await page.click(more);
await page.click('[data-action="delete"]');
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-dialog-confirm]')]);
check('confirming deletes it and goes to the project', !getCanvas(store.ids.catalogue) && page.url().endsWith(`/project/${store.patternProjectId}`));

// Narrow windows: the name and the states stay visible; below 720px the page scrolls to the inspector.
await open(store.ids.withStates);
for (const width of [1200, 1024, 768]) {
  await page.setViewport({ width, height: 900 });
  const sizes = await page.evaluate(() => ({ title: document.querySelector('.toolbar .title')!.getBoundingClientRect().width, states: document.querySelector('.state-nav')!.getBoundingClientRect().right <= document.querySelector('.crumbs')!.getBoundingClientRect().right + 1 }));
  check(`at ${width}px the name keeps at least 80px and the states fit`, sizes.title >= 79 && sizes.states, JSON.stringify(sizes));
}
await page.setViewport({ width: 390, height: 844 });
const narrow = await page.evaluate(() => ({ viewport: document.getElementById('viewport')!.getBoundingClientRect().height, scrolls: document.querySelector('.detail-main')!.scrollHeight > document.querySelector('.detail-main')!.clientHeight }));
check('at 390px the preview keeps a usable height and the page scrolls to the inspector', narrow.viewport >= 0.55 * 844 && narrow.scrolls, JSON.stringify(narrow));
await page.setViewport({ width: 1440, height: 900 });

check('no page error', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
process.exit(allPass ? 0 : 1);
