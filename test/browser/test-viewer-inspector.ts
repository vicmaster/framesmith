// Phase 33 slice D — the detail page's inspector and comments on the fixture
// store: "Show n nodes" outlines them (FR-D1), the tab list and the restyled
// tabs (FR-D2), the comment popover for page-level and pinned comments
// (FR-D3), and panels that refresh without a reload (FR-D4).
//
// Usage: npx tsx test/browser/test-viewer-inspector.ts

import '../env.js';
import { createServer } from 'node:net';
import puppeteer, { type Page } from 'puppeteer';
import { getCanvas, touchCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { listFeedback, resolveFeedback } from '../../src/feedback.js';
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
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const open = async (id: string) => { await page.goto(`${base}/canvas/${id}`, { waitUntil: 'load' }); await page.waitForFunction(() => !!(document.getElementById('frame') as HTMLIFrameElement).contentDocument?.querySelector('[data-node-id]'), { timeout: 10_000 }); };
const outlined = (p: Page) => p.$eval('#frame', (f) => (f as HTMLIFrameElement).contentDocument!.querySelectorAll('[data-fs-hl]').length);

// ── FR-D2: the tab list ──────────────────────────────────────────────────────
await open(store.ids.dashboard);
const tabs = await page.$$eval('.insp-tabs [role="tab"]', (ts) => ts.map((t) => t.getAttribute('data-tab')));
check('the tabs are Quality, Design system and Feedback (no Import)', JSON.stringify(tabs) === '["quality","design","feedback"]', JSON.stringify(tabs));
await page.focus('#tab-quality');
await page.keyboard.press('ArrowRight');
check('ArrowRight shows the Design system panel', await page.evaluate(() => !(document.getElementById('insp-design') as HTMLElement).hidden && (document.getElementById('insp-quality') as HTMLElement).hidden));
check('the Design system panel shows the tokens', (await page.$$('#insp-design .ds-swatch')).length > 0);
await page.keyboard.press('ArrowRight');
check('then the Feedback panel', await page.evaluate(() => !(document.getElementById('insp-feedback') as HTMLElement).hidden));
await page.click('#tab-quality');

// ── FR-D1: Show n nodes ──────────────────────────────────────────────────────
const multi = await page.$$eval('.issue-nodes', (bs) => bs.map((b) => JSON.parse((b as HTMLElement).dataset.nodes!).length).findIndex((n) => n > 1));
check('a group with several nodes is listed', multi >= 0);
const buttons = await page.$$('.issue-nodes');
const n = await buttons[multi].evaluate((b) => JSON.parse((b as HTMLElement).dataset.nodes!).length as number);
await buttons[multi].click();
await pause(200);
check(`"Show ${n} nodes" outlines ${n} nodes in the preview`, (await outlined(page)) === n, String(await outlined(page)));
await buttons[multi].click();
await pause(200);
check('pressing it again clears the outline', (await outlined(page)) === 0);

// ── FR-D3: the comment popover ───────────────────────────────────────────────
await open(store.ids['bento-grid']);
await page.click('#btn-comment');
const popState = await page.evaluate(() => ({
  shown: !(document.getElementById('comment-pop') as HTMLElement).hidden,
  title: document.getElementById('comment-pop-title')!.textContent,
  focus: document.activeElement?.id,
  chips: !(document.getElementById('fb-chips') as HTMLElement).hidden,
  pressed: document.getElementById('btn-comment')!.getAttribute('aria-pressed'),
}));
check('Comment opens the popover under the button, titled with the name', popState.shown && popState.title === 'Comment on bento-grid' && popState.pressed === 'true', JSON.stringify(popState));
check('…with the field focused and no anchor yet', popState.focus === 'comment-text' && !popState.chips);
const rightEdge = await page.$eval('#comment-pop', (p) => Math.round(p.getBoundingClientRect().right));
const buttonRight = await page.$eval('#btn-comment', (b) => Math.round(b.getBoundingClientRect().right));
check('…aligned to the Comment button', Math.abs(rightEdge - buttonRight) <= 1, `${rightEdge} vs ${buttonRight}`);
await page.type('#comment-text', 'The headline needs more air.');
await page.click('#comment-save');
await page.waitForFunction(() => (document.getElementById('tab-feedback') as HTMLElement).getAttribute('aria-selected') === 'true', { timeout: 5000 }).catch(() => null);
let entries = listFeedback(getCanvas(store.ids['bento-grid'])!, { includeResolved: true });
check('a page-level comment saves with no node', entries.length === 1 && !entries[0].nodeId && entries[0].comment === 'The headline needs more air.');
check('saving switches to the Feedback tab and closes the popover', await page.evaluate(() => (document.getElementById('tab-feedback') as HTMLElement).getAttribute('aria-selected') === 'true' && (document.getElementById('comment-pop') as HTMLElement).hidden));
await page.waitForFunction(() => document.querySelectorAll('#fb-pane .fb-card').length === 1, { timeout: 5000 }).catch(() => null);
check('the Feedback list shows it', (await page.$$('#fb-pane .fb-card')).length === 1);
check('the Feedback tab and the Comment button count it', (await page.$eval('#tab-feedback .tab-count', (c) => c.textContent)) === '1' && (await page.$eval('#comment-count', (c) => !(c as HTMLElement).hidden && c.textContent === '1')));

await page.click('#btn-comment');
const frame = page.frames().find((f) => f.url().includes('/html'))!;
const target = await frame.$('[data-node-id] [data-node-id] [data-node-id]');
// The comment pins to the innermost node under the click point.
const targetId = await target!.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)!.closest('[data-node-id]')!.getAttribute('data-node-id');
});
// Click where a user would: the preview is scaled to fit, and Puppeteer's own
// element click ignores the iframe's transform, so map the point through it.
const box = await target!.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const frameBox = await page.$eval('#frame', (f) => { const r = f.getBoundingClientRect(); return { left: r.left, top: r.top, scale: r.width / (f as HTMLIFrameElement).offsetWidth }; });
await page.mouse.click(frameBox.left + box.x * frameBox.scale, frameBox.top + box.y * frameBox.scale);
await pause(200);
const chips = await page.$$eval('#fb-chips .fb-chip', (cs) => cs.map((c) => `${c.textContent}${c.getAttribute('aria-pressed') === 'true' ? '*' : ''}`));
check('clicking an element pins the comment and lists its ancestors', chips.length >= 2 && chips[0].endsWith('*') && chips[chips.length - 1] === 'whole page', JSON.stringify(chips));
check('…without moving the popover', Math.abs((await page.$eval('#comment-pop', (p) => Math.round(p.getBoundingClientRect().right))) - buttonRight) <= 1);
await page.type('#comment-text', 'Tighten this card.');
await page.click('#comment-save');
await pause(500);
entries = listFeedback(getCanvas(store.ids['bento-grid'])!, { includeResolved: true });
check('a pinned comment saves with the clicked node', entries.length === 2 && entries.some((e) => e.nodeId === targetId?.split('/')[0] && e.comment === 'Tighten this card.'), JSON.stringify(entries.map((e) => e.nodeId)));

await page.click('#btn-comment');
await page.type('#comment-text', 'draft');
await page.keyboard.press('Escape');
check('Escape closes the popover and leaves comment mode', await page.evaluate(() => (document.getElementById('comment-pop') as HTMLElement).hidden && document.getElementById('btn-comment')!.getAttribute('aria-pressed') === 'false'));

// Deleting a comment goes through the dialog.
await page.click('#tab-feedback');
const del = await page.$$('#fb-pane .fb-card .btn--ghost');
await del[0].click();
check('Delete on a comment opens the dialog', await page.$eval('#fb-delete-dialog', (d) => !(d.closest('[data-dialog-scrim]') as HTMLElement).hidden));
await page.click('#fb-delete-dialog [data-dialog-confirm]');
await pause(600);
check('confirming deletes it', listFeedback(getCanvas(store.ids['bento-grid'])!, { includeResolved: true }).length === 1);

// ── FR-D4: live panels ───────────────────────────────────────────────────────
await open(store.ids.withFeedback);
await page.evaluate(() => { (window as unknown as { __mark: boolean }).__mark = true; });
await page.click('#tab-feedback');
const fbCanvas = getCanvas(store.ids.withFeedback)!;
const openOne = listFeedback(fbCanvas).find((e) => !e.resolvedAt)!;
resolveFeedback(fbCanvas, [openOne.id], 'agent', 'Raised the button contrast.');
await page.waitForFunction(() => document.querySelectorAll('#fb-pane .fb-card.resolved').length === 2, { timeout: 6000 }).catch(() => null);
check('a comment the agent resolves moves to Resolved without a reload', (await page.$$('#fb-pane .fb-card.resolved')).length === 2 && await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark === true));
check('…and the counts drop to 0', (await page.$eval('#tab-feedback .tab-count', (c) => c.textContent)) === '0' && (await page.$eval('#comment-count', (c) => (c as HTMLElement).hidden)));
check('…and the Feedback tab stays selected', (await page.$eval('#tab-feedback', (t) => t.getAttribute('aria-selected'))) === 'true');

await open(store.ids['marquee-hero']);
await page.evaluate(() => { (window as unknown as { __mark: boolean }).__mark = true; });
const before = await page.$eval('.score-value', (s) => s.textContent);
const hero = getCanvas(store.ids['marquee-hero'])!;
parseAndExecute(hero.root, 'I("mh-hero", { type: "frame", width: 100, height: 40, gap: 13, layout: "horizontal" })', hero);
touchCanvas(hero.id);
await page.waitForFunction((b) => document.querySelector('.score-value')?.textContent !== b, { timeout: 6000 }, before).catch(() => null);
const after = await page.$eval('.score-value', (s) => s.textContent);
check('an edit updates the score without a reload', after !== before && await page.evaluate(() => (window as unknown as { __mark?: boolean }).__mark === true), `${before} → ${after}`);

// A failed panel fetch is retried on the next poll, not dropped.
await open(store.ids['editorial-longform']);
await page.setRequestInterception(true);
let failNext = true;
const onRequest = (req: import('puppeteer').HTTPRequest) => {
  if (failNext && req.url().endsWith('/inspector')) { failNext = false; req.respond({ status: 500, body: 'boom' }); }
  else req.continue();
};
page.on('request', onRequest);
const longform = getCanvas(store.ids['editorial-longform'])!;
const before2 = await page.$eval('.score-value', (s) => s.textContent);
parseAndExecute(longform.root, 'I("document", { type: "frame", width: 100, height: 40, gap: 13, layout: "horizontal" })', longform);
touchCanvas(longform.id);
await page.waitForFunction((b) => document.querySelector('.score-value')?.textContent !== b, { timeout: 8000 }, before2).catch(() => null);
check('after a failed panel fetch the next poll still updates the score', !failNext && (await page.$eval('.score-value', (s) => s.textContent)) !== before2);
page.off('request', onRequest);
await page.setRequestInterception(false);

// An open popover and its draft survive a swap; Cancel returns focus to Comment.
await page.click('#btn-comment');
await page.type('#comment-text', 'half-written');
parseAndExecute(longform.root, 'I("document", { type: "frame", width: 100, height: 40, gap: 15, layout: "horizontal" })', longform);
touchCanvas(longform.id);
const before3 = await page.$eval('.score-value', (s) => s.textContent);
await page.waitForFunction((b) => document.querySelector('.score-value')?.textContent !== b, { timeout: 8000 }, before3).catch(() => null);
check('an open popover keeps its draft through a swap', await page.evaluate(() => !(document.getElementById('comment-pop') as HTMLElement).hidden && (document.getElementById('comment-text') as HTMLTextAreaElement).value === 'half-written'));
await page.click('#comment-cancel');
check('Cancel closes it and returns focus to the Comment button', await page.evaluate(() => document.activeElement?.id === 'btn-comment'));

// An edit that removes a commented node flags its comment without a new comment.
await open(store.ids.withFeedback);
await page.click('#tab-feedback');
const fb2 = getCanvas(store.ids.withFeedback)!;
const pinned = listFeedback(fb2, { includeResolved: true }).find((e) => e.nodeId)!;
const rootKids = fb2.root.children ?? [];
fb2.root.children = rootKids.filter((c) => c.id !== pinned.nodeId);
touchCanvas(fb2.id);
await page.waitForFunction(() => !!document.querySelector('#fb-pane .fb-orphan'), { timeout: 8000 }).catch(() => null);
check('a comment whose node an edit removed shows "node gone"', !!(await page.$('#fb-pane .fb-orphan')));

check('no page error', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
process.exit(allPass ? 0 : 1);
