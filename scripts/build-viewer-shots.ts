// Phase 33 slice E — the viewer's screenshots, from the fixture store
// (test/fixtures/viewer-store.ts), so every image is reproducible:
//
//   docs/framesmith-dashboard.png  the gallery (README hero)
//   docs/framesmith-canvas.png     a canvas's detail page, Quality tab
//   docs/framesmith-feedback.png   a pinned comment outlined, Feedback tab
//
// With --acceptance <dir> it also writes FR-E4's side-by-sides: each designed
// screen (docs/viewer-redesign/<n>-<screen>-<scheme>.png) beside the viewer's
// render of it at 1440×900, in both color schemes, as <n>-<screen>-<scheme>.jpg.
//
// Usage: npx tsx scripts/build-viewer-shots.ts [--acceptance <dir>]
// (needs Chrome, and a warm font cache for the design's fonts)

import '../test/env.js';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import { listCanvases, unarchiveCanvas } from '../src/scene-graph.js';
import { startViewer } from '../src/viewer.js';
import { resolveFamily } from '../src/fonts.js';
import { VIEWER_FONT_FAMILIES } from '../src/viewer/tokens.js';
import { seedViewerStore } from '../test/fixtures/viewer-store.js';

const ROOT = resolve(import.meta.dirname, '..');
const DOCS = join(ROOT, 'docs');
const flag = process.argv.indexOf('--acceptance');
const acceptanceDir = flag > 0 ? resolve(process.argv[flag + 1]) : null;

const store = seedViewerStore();
// The viewer's own fonts, into the temp store's cache (fetched once per run).
for (const family of VIEWER_FONT_FAMILIES) await resolveFamily(family);
const port = await new Promise<number>((done) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address() as { port: number }; s.close(() => done(p)); });
});
await startViewer(port);
const base = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Load a page and wait for its fonts and every preview iframe to paint. */
async function open(path: string): Promise<void> {
  await page.goto(base + path, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await pause(400);
}

const detail = (id: string) => `/canvas/${id}`;
const moreMenu = async () => { await page.click('[aria-label="More actions"]'); await pause(150); };

/** The designed screens, in the design's order, and how to reach each. */
const SCREENS: Array<{ file: string; show: () => Promise<void> }> = [
  { file: '1-gallery', show: () => open(`/project/${store.patternProjectId}`) },
  { file: '2-detail', show: () => open(detail(store.ids.at95)) },
  { file: '3-detail-menu-open', show: async () => { await open(detail(store.ids.at95)); await moreMenu(); } },
  { file: '4-detail-comment-open', show: async () => { await open(detail(store.ids.at95)); await page.click('#btn-comment'); await pause(150); } },
  { file: '5-detail-confirm-delete', show: async () => {
    await open(detail(store.ids.at95));
    await moreMenu();
    await page.click('[role="menuitem"][data-action="delete"]');
    await pause(150);
  } },
  { file: '6-archive', show: () => open('/archive') },
  { file: '7-archive-empty', show: async () => {
    for (const c of listCanvases().filter((r) => r.archived)) unarchiveCanvas(c.id);
    await open('/archive');
  } },
];

async function scheme(value: 'light' | 'dark'): Promise<void> {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]);
}

// ── README screenshots (light, 2x) ───────────────────────────────────────────
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await scheme('light');
await open(`/project/${store.patternProjectId}`);
await page.screenshot({ path: join(DOCS, 'framesmith-dashboard.png') });
await open(detail(store.ids.at95));
await page.screenshot({ path: join(DOCS, 'framesmith-canvas.png') });

// Point-and-tell: pin a comment to the Continue button, save it, then select it
// in the Feedback list so its node is outlined beside the open and resolved
// comments (the popover itself sits over the list, so it is shot closed).
await open(detail(store.ids.withFeedback));
await page.click('#btn-comment');
const frame = page.frames().find((f) => f.url().includes('/html'))!;
// A DOM click: the preview is scaled to fit, so a mouse click at the element's
// unscaled box would land elsewhere.
await frame.evaluate(() => {
  const leaf = [...document.querySelectorAll('[data-node-id]')].filter((el) => el.textContent?.trim() === 'Continue').pop() as HTMLElement;
  leaf.click();
});
await pause(200);
await page.type('#comment-text', 'Say what happens next: "Sign in" instead of "Continue".');
await page.click('#comment-save');
await page.waitForFunction(() => document.querySelectorAll('#fb-pane .fb-card').length === 3, { timeout: 5000 });
await page.evaluate(() => ([...document.querySelectorAll('#fb-pane .fb-card')].find((c) => c.textContent?.includes('Say what happens next')) as HTMLElement).click());
await pause(400);
await page.screenshot({ path: join(DOCS, 'framesmith-feedback.png') });
console.log('wrote docs/framesmith-dashboard.png, framesmith-canvas.png, framesmith-feedback.png');

// ── FR-E4 side-by-sides ──────────────────────────────────────────────────────
if (acceptanceDir) {
  mkdirSync(acceptanceDir, { recursive: true });
  const shots: Record<string, Buffer> = {};
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  for (const screen of SCREENS) {
    for (const value of ['light', 'dark'] as const) {
      await scheme(value);
      await screen.show();
      shots[`${screen.file}-${value}`] = Buffer.from(await page.screenshot());
    }
  }
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: 2000, height: 660 });
  for (const [name, viewer] of Object.entries(shots)) {
    const design = readFileSync(join(DOCS, 'viewer-redesign', `${name}.png`)).toString('base64');
    await sheet.setContent(sideBySide(design, viewer.toString('base64'), name));
    await sheet.screenshot({ path: join(acceptanceDir, `${name}.jpg`), type: 'jpeg', quality: 82 });
  }
  console.log(`wrote ${Object.keys(shots).length} side-by-sides to ${acceptanceDir}`);
}

function sideBySide(design: string, viewer: string, name: string): string {
  const dark = name.endsWith('-dark');
  const cell = (label: string, png: string) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${png}"></figure>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;display:flex;gap:20px;background:${dark ? '#000' : '#fff'};color:${dark ? '#ccc' : '#333'};font:600 14px system-ui">
    <style>figure{margin:0}figcaption{margin-bottom:8px}img{width:970px;height:606px;display:block;outline:1px solid #8884}</style>
    ${cell(`Design · ${name}`, design)}${cell(`Viewer · ${name}`, viewer)}</body></html>`;
}

await browser.close();
process.exit(0);
