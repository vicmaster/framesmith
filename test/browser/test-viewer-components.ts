// Phase 33 slice A — the shared components work by keyboard (FR-A4), narrow
// windows keep working (FR-A5), and the viewer's fonts load from the cache
// (FR-A3). The components run on a harness page built from their own exports;
// the narrow-window and font checks run against a live viewer.
//
// Usage: npx tsx test/browser/test-viewer-components.ts

import '../env.js';
import { createServer } from 'node:net';
import puppeteer, { type Page } from 'puppeteer';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject } from '../../src/workspaces.js';
import { createCanvas, archiveCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { resolveFamily } from '../../src/fonts.js';
import { startViewer, renderProjectPage } from '../../src/viewer.js';
import { baseCss, COMPONENTS_CSS } from '../../src/viewer/styles.js';
import { COMPONENTS_JS, renderDialog, renderMenu, renderTabs, icon } from '../../src/viewer/components.js';
import { VIEWER_FONT_FAMILIES } from '../../src/viewer/tokens.js';
import { DEFAULT_PROJECT_ID } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.FRAMESMITH_CHROME_PATH || undefined });
const page = await browser.newPage();
const focused = (p: Page) => p.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return el ? (el.id || el.dataset.tab || el.dataset.action || el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName) : null;
});

// ── FR-A4: the components on a harness page ──────────────────────────────────
const harness = `<!doctype html><html><head><style>${baseCss()}${COMPONENTS_CSS}</style></head><body>
  ${renderTabs([
    { id: 'one', label: 'Quality', selected: true, panelId: 'panel-one' },
    { id: 'two', label: 'Design system', panelId: 'panel-two' },
    { id: 'three', label: 'Feedback', count: 2, panelId: 'panel-three' },
  ], 'Inspector')}
  <div id="panel-one" role="tabpanel">one</div><div id="panel-two" role="tabpanel" hidden>two</div><div id="panel-three" role="tabpanel" hidden>three</div>
  ${renderMenu('more', icon('ellipsis'), 'More actions', [
    { action: 'json', label: 'View JSON', icon: 'braces' },
    { action: 'copy', label: 'Copy canvas ID', icon: 'copy' },
    'separator',
    { action: 'delete', label: 'Delete canvas', icon: 'trash-2', danger: true },
  ])}
  <button id="opener" class="btn btn--secondary">Delete</button>
  <p id="outside">outside</p>
  ${renderDialog({ id: 'confirm', title: 'Delete dashboard?', body: 'It cannot be restored.', confirmLabel: 'Delete canvas', destructive: true })}
  <script>${COMPONENTS_JS}
    window.actions = []; window.results = [];
    document.querySelector('[data-menu]').addEventListener('menuaction', (e) => window.actions.push(e.detail.action));
    document.getElementById('opener').addEventListener('click', async () => window.results.push(await fsDialog.open('confirm')));
  </script></body></html>`;
await page.setContent(harness);

// Tabs.
await page.focus('#tab-one');
await page.keyboard.press('ArrowRight');
const tabState = () => page.evaluate(() => ({
  selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
  shown: [...document.querySelectorAll('[role="tabpanel"]')].filter((p) => !(p as HTMLElement).hidden).map((p) => p.id),
  tabbable: [...document.querySelectorAll('[role="tab"]')].filter((t) => (t as HTMLElement).tabIndex === 0).map((t) => t.id),
}));
let t = await tabState();
check('tabs: ArrowRight selects the next tab and shows its panel', t.selected === 'tab-two' && t.shown.join() === 'panel-two', JSON.stringify(t));
check('tabs: only the selected tab is in the tab order', t.tabbable.join() === 'tab-two');
await page.keyboard.press('End');
t = await tabState();
check('tabs: End selects the last tab', t.selected === 'tab-three' && t.shown.join() === 'panel-three');
await page.keyboard.press('ArrowRight');
t = await tabState();
check('tabs: ArrowRight wraps to the first tab', t.selected === 'tab-one' && (await focused(page)) === 'tab-one');
await page.keyboard.press('ArrowLeft');
check('tabs: ArrowLeft wraps to the last tab', (await tabState()).selected === 'tab-three');

// Menu.
const menuOpen = () => page.evaluate(() => !(document.getElementById('more') as HTMLElement).hidden);
await page.focus('[aria-haspopup="menu"]');
await page.keyboard.press('Enter');
check('menu: Enter on the button opens it with the first item focused', (await menuOpen()) && (await focused(page)) === 'json');
check('menu: the button reports aria-expanded', await page.$eval('[aria-haspopup="menu"]', (b) => b.getAttribute('aria-expanded') === 'true'));
await page.keyboard.press('ArrowDown');
check('menu: ArrowDown moves to the next item', (await focused(page)) === 'copy');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
check('menu: ArrowDown wraps past the last item', (await focused(page)) === 'json');
await page.keyboard.press('ArrowUp');
check('menu: ArrowUp wraps to the last item', (await focused(page)) === 'delete');
await page.keyboard.press('Escape');
check('menu: Escape closes it and returns focus to the button', !(await menuOpen()) && (await focused(page)) === 'More actions');
await page.keyboard.press('Enter');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
check('menu: Enter on an item fires menuaction and closes', (await page.evaluate(() => (window as unknown as { actions: string[] }).actions.join())) === 'copy' && !(await menuOpen()));
await page.click('[aria-haspopup="menu"]');
await page.click('#outside');
check('menu: an outside click closes it', !(await menuOpen()));

// Dialog.
const dialogOpen = () => page.evaluate(() => !(document.querySelector('[data-dialog-scrim]') as HTMLElement).hidden);
await page.focus('#opener');
await page.keyboard.press('Enter');
check('dialog: opens with focus on Cancel', (await dialogOpen()) && (await focused(page)) === 'Cancel');
check('dialog: is a modal dialog named by its title', await page.$eval('#confirm', (d) => d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent === 'Delete dashboard?'));
await page.keyboard.press('Tab');
check('dialog: Tab moves to the confirm button', (await focused(page)) === 'Delete canvas');
await page.keyboard.press('Tab');
check('dialog: Tab wraps inside the dialog', (await focused(page)) === 'Cancel');
await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
check('dialog: Shift+Tab wraps backwards', (await focused(page)) === 'Delete canvas');
await page.keyboard.press('Escape');
check('dialog: Escape cancels and returns focus to the opener', !(await dialogOpen()) && (await focused(page)) === 'opener');
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
const results = await page.evaluate(() => (window as unknown as { results: boolean[] }).results);
check('dialog: resolves false on cancel and true on confirm', results.join() === 'false,true', results.join());

// ── FR-A3 offline: an empty font cache renders the fallback stack ────────────
// env.js points FRAMESMITH_HOME at an empty temp dir, so nothing is cached yet.
{
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();
  const cold = (await renderProjectPage(DEFAULT_PROJECT_ID, 0))!;
  check('fonts offline: no @font-face is declared with an empty cache', !cold.includes('@font-face'));
  const coldErrors: string[] = [];
  const onError = (e: unknown) => coldErrors.push(String(e));
  page.on('pageerror', onError);
  await page.setContent(cold, { waitUntil: 'load' });
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check('fonts offline: the body falls back to system-ui', family.includes('system-ui'), family);
  check('fonts offline: the page renders with no script error', coldErrors.length === 0, coldErrors.join(' | '));
  page.off('pageerror', onError);
}

// ── a live viewer for FR-A5 and FR-A3 ────────────────────────────────────────
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
const canvas = createCanvas('narrow', DEFAULT_PROJECT_ID);
parseAndExecute(canvas.root, 'I("document", { type: "frame", width: "100%", height: 200, fill: "#E2E2DF" })', canvas);
archiveCanvas(createCanvas('archived', DEFAULT_PROJECT_ID).id);

const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address() as { port: number }; s.close(() => resolve(p)); });
});
await startViewer(port);
const base = `http://127.0.0.1:${port}`;
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// FR-A5: 390×844, no page scrolls sideways; the drawer opens and closes.
await page.setViewport({ width: 390, height: 844 });
for (const [name, path] of [['project', `/project/${DEFAULT_PROJECT_ID}`], ['archive', '/archive'], ['detail', `/canvas/${canvas.id}`]] as const) {
  await page.goto(base + path, { waitUntil: 'load' });
  const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  check(`narrow: the ${name} page has no horizontal scroll at 390px`, wide.scroll <= wide.client, `${wide.scroll} > ${wide.client}`);
}
await page.goto(`${base}/project/${DEFAULT_PROJECT_ID}`, { waitUntil: 'load' });
const sidebarLeft = () => page.$eval('.sidebar', (s) => s.getBoundingClientRect().right);
check('narrow: the sidebar starts off-canvas', (await sidebarLeft()) <= 0);
await page.click('.sidebar-toggle');
await new Promise((r) => setTimeout(r, 400));
check('narrow: the toggle opens the drawer', (await sidebarLeft()) > 0);
await page.mouse.click(380, 400);
await new Promise((r) => setTimeout(r, 400));
check('narrow: the backdrop closes it', (await sidebarLeft()) <= 0);
// FR-A5: the detail page's inspector stacks at 720px or less, and its toolbar
// wraps at 640px or less.
await page.setViewport({ width: 700, height: 900 });
await page.goto(`${base}/canvas/${canvas.id}`, { waitUntil: 'load' });
const stacked = await page.evaluate(() => {
  const inspector = document.getElementById('inspector')!.getBoundingClientRect();
  const viewport = document.getElementById('viewport')!.getBoundingClientRect();
  return { inspectorWidth: inspector.width, inspectorTop: inspector.top, viewportBottom: viewport.bottom, page: document.documentElement.clientWidth };
});
check('narrow: at 700px the inspector stacks under the preview, full width', stacked.inspectorWidth >= stacked.page - 1 && stacked.inspectorTop >= stacked.viewportBottom - 1, JSON.stringify(stacked));
const toolbarHeight = async (width: number) => {
  await page.setViewport({ width, height: 900 });
  await page.goto(`${base}/canvas/${canvas.id}`, { waitUntil: 'load' });
  return page.$eval('.toolbar', (t) => t.getBoundingClientRect().height);
};
const wide = await toolbarHeight(1440);
const wrapped = await toolbarHeight(600);
check('narrow: at 600px the detail toolbar wraps onto more rows', wrapped > wide * 1.5, `${wide} → ${wrapped}`);
await page.setViewport({ width: 1440, height: 900 });

// FR-A3: with the cache warm, the design system's faces load from the font route.
let warm = true;
for (const family of VIEWER_FONT_FAMILIES) {
  try { await resolveFamily(family); } catch { warm = false; }
}
if (!warm) {
  console.log('SKIP  fonts: no network to warm the font cache');
} else {
  await page.goto(`${base}/project/${DEFAULT_PROJECT_ID}`, { waitUntil: 'load' });
  const loaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('14px Inter');
    return { count: faces.length, family: faces[0]?.family ?? '' };
  });
  check('fonts: Inter loads from /assets/fonts', loaded.count > 0 && loaded.family.includes('Inter'), JSON.stringify(loaded));
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check('fonts: the body uses Inter first', body.startsWith('Inter') || body.startsWith('"Inter"'), body);
}
check('no page error or console error on any page', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
process.exit(allPass ? 0 : 1);
