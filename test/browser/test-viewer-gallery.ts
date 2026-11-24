// Phase 33 slice B — the gallery on the fixture store: cards, counts and the
// summary (FR-B1), score chips against the bar (FR-B2), search and type
// filter kept in the URL (FR-B3), and the live poll (FR-B4).
//
// Usage: npx tsx test/browser/test-viewer-gallery.ts

import '../env.js';
import { createServer } from 'node:net';
import puppeteer, { type Page } from 'puppeteer';
import { getCanvas, listCanvases, touchCanvas, addVariant } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { startViewer } from '../../src/viewer.js';
import { evalFor } from '../../src/viewer/scores.js';
import { baseRows } from '../../src/viewer/shared.js';
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
const url = `http://127.0.0.1:${port}/project/${store.patternProjectId}`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });

// ── FR-B1: cards, counts, summary, meta ──────────────────────────────────────
const bases = baseRows(listCanvases(), store.patternProjectId);
let below = 0;
for (const row of bases) {
  const ev = await evalFor(getCanvas(row.id)!, row.variants?.map((v) => v.state) ?? []);
  if (ev && ev.overallScore < 96) below++;
}
const cardCount = await page.$$eval('article.card', (cards) => cards.length);
check('one card per base canvas', cardCount === bases.length, `${cardCount} vs ${bases.length}`);
const summary = await page.$eval('#summary', (s) => s.textContent);
check('summary counts canvases and those below the bar', summary === `${bases.length} canvases · ${below} below the bar`, `${summary} (below=${below})`);
const tabs = await page.$$eval('.filter-bar [role="tab"]', (ts) => ts.map((t) => t.textContent!.replace(/\s+/g, ' ').trim()));
check('type tabs carry their counts', JSON.stringify(tabs) === JSON.stringify([`All ${bases.length}`, `Web ${bases.length - 2}`, 'Mobile 1', 'Desktop app 1']), JSON.stringify(tabs));
const meta = (id: string) => page.$eval(`[data-canvas-id="${id}"] .card-meta`, (m) => m.textContent);
check('meta line: type, size and edited date', (await meta(store.ids.auth)) === 'Web · 1440 × 900 · Edited Jun 26', String(await meta(store.ids.auth)));
check('meta line: a screen with states counts them', (await meta(store.ids.withStates))?.endsWith(' · 2 states') === true, String(await meta(store.ids.withStates)));
const height = (id: string) => page.$eval(`[data-canvas-id="${id}"] .thumb`, (t) => t.getBoundingClientRect().height);
check('a phone card is taller than a web card', (await height(store.ids.mobile)) > (await height(store.ids.auth)) * 1.5);
const link = await page.$eval(`[data-canvas-id="${store.ids.auth}"] .card-name`, (a) => a.getAttribute('href'));
check('the card name links to the canvas', link === `/canvas/${store.ids.auth}`);

// ── FR-B2: score chips against the bar ───────────────────────────────────────
const chip = (id: string) => page.$eval(`[data-canvas-id="${id}"]`, (card) => {
  const c = card.querySelector('.score-chip');
  return c ? { text: c.textContent, below: c.classList.contains('score-chip--below') } : null;
});
check('100 is a neutral chip', JSON.stringify(await chip(store.ids['marquee-hero'])) === '{"text":"100","below":false}');
check('96 is a neutral chip (at the bar)', JSON.stringify(await chip(store.ids.at96)) === '{"text":"96","below":false}', JSON.stringify(await chip(store.ids.at96)));
check('95 is a warning chip (below the bar)', JSON.stringify(await chip(store.ids.at95)) === '{"text":"95","below":true}', JSON.stringify(await chip(store.ids.at95)));
check('an empty canvas shows no chip', (await chip(store.ids.blank)) === null);
const colors = await page.$eval(`[data-canvas-id="${store.ids.at95}"] .score-chip`, (c) => { const s = getComputedStyle(c); return s.color + ' / ' + s.backgroundColor; });
const neutralColors = await page.$eval(`[data-canvas-id="${store.ids.at96}"] .score-chip`, (c) => { const s = getComputedStyle(c); return s.color + ' / ' + s.backgroundColor; });
check('the below-the-bar chip is drawn differently from the neutral one', colors !== neutralColors, `${colors} vs ${neutralColors}`);

// ── FR-B3: search and filter, kept in the URL ────────────────────────────────
const visible = (p: Page) => p.$$eval('article.card', (cards) => cards.filter((c) => !(c as HTMLElement).hidden).map((c) => (c.querySelector('.card-name') as HTMLElement).textContent));
await page.type('#search', 'AUTH');
check('search filters by name, case-insensitive', JSON.stringify((await visible(page)).sort()) === '["auth","auth-feedback"]', JSON.stringify(await visible(page)));
check('the query is kept in the URL', new URL(page.url()).searchParams.get('q') === 'AUTH');
await page.click('[data-tab="mobile"]');
check('the type tab narrows the search further', (await visible(page)).length === 0);
check('no match shows the message and a Clear button', await page.$eval('#no-match', (n) => !(n as HTMLElement).hidden && n.textContent!.includes('No canvases match “AUTH”')));
await page.click('#clear-filters');
check('Clear restores every card', (await visible(page)).length === bases.length);
check('Clear empties the URL', new URL(page.url()).search === '');
await page.goto(`${url}?q=auth&type=web`, { waitUntil: 'load' });
check('reloading ?q=auth&type=web restores the query', (await page.$eval('#search', (i) => (i as HTMLInputElement).value)) === 'auth');
check('…and the Web tab', (await page.$eval('[role="tab"][aria-selected="true"]', (t) => (t as HTMLElement).dataset.tab)) === 'web');
check('…and the filtered cards', JSON.stringify((await visible(page)).sort()) === '["auth","auth-feedback"]');

// ── FR-B4: live ──────────────────────────────────────────────────────────────
await page.goto(url, { waitUntil: 'load' });
const mark = () => page.evaluate(() => { (window as unknown as { __mark: boolean }).__mark = true; });
const reloaded = async () => !(await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark));
const settle = () => new Promise((r) => setTimeout(r, 7000)); // two polls

await mark(); await settle();
check('no reload when nothing changed', !(await reloaded()));
check('the status reads Live', (await page.$eval('#live .live-label', (l) => l.textContent)) === 'Live');

const edited = getCanvas(store.ids.catalogue)!;
parseAndExecute(edited.root, 'I("document", { type: "text", content: "edited" })', edited);
touchCanvas(edited.id);
await settle();
check('an edit reloads the gallery', await reloaded());

await page.waitForSelector('#live'); await mark();
getCanvas(store.ids.onboarding)!.name = 'onboarding-renamed';
await settle();
check('a rename reloads the gallery', await reloaded());
check('…and shows the new name', (await page.$eval(`[data-canvas-id="${store.ids.onboarding}"] .card-name`, (a) => a.textContent)) === 'onboarding-renamed');

await mark();
addVariant(store.ids.pricing, 'empty');
await settle();
check('a new state variant reloads the gallery', await reloaded());
check('…and the card counts it', (await meta(store.ids.pricing))?.endsWith(' · 1 state') === true, String(await meta(store.ids.pricing)));

await page.setOfflineMode(true);
await new Promise((r) => setTimeout(r, 3500));
check('a failed poll shows Offline', (await page.$eval('#live .live-label', (l) => l.textContent)) === 'Offline');
await page.setOfflineMode(false);
await new Promise((r) => setTimeout(r, 3500));
check('the next good poll shows Live again', (await page.$eval('#live .live-label', (l) => l.textContent)) === 'Live');

check('no page error', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
process.exit(allPass ? 0 : 1);
