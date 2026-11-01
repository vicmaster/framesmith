import './test-env.js';
// Phase 30 slice F (FR-F1, FR-F2) in Chrome: serves the real viewer and checks
// what the markup test can't — each thumbnail's artboard is scaled to its
// card's rendered width (and refits when the window resizes), a mobile canvas
// shows 1:1 in its device frame with a working safe-area overlay, and a web
// canvas's breakpoint buttons size the frame from the profile without
// clearing the rest of the toolbar's state.
//
// Usage: npx tsx test-viewer-surface-browser.ts

import puppeteer, { type Page } from 'puppeteer';

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { parseAndExecute } = await import('./src/operations.js');
const { startViewer } = await import('./src/viewer.js');
const { DEFAULT_PROJECT_ID } = await import('./src/types.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

const phone = sg.createCanvas('Phone', DEFAULT_PROJECT_ID, {}, { type: 'mobile' });
parseAndExecute(phone.root, `row=I("document",{type:"list-row",title:"Settings"})`);
const desktop = sg.createCanvas('Desktop', DEFAULT_PROJECT_ID, { width: 1440, height: 900 });
parseAndExecute(desktop.root, `t=I("document",{type:"text",content:"Hello"})`);

const narrowWeb = sg.createCanvas('Narrow web', DEFAULT_PROJECT_ID, { width: 390, height: 844 });
parseAndExecute(narrowWeb.root, `t=I("document",{type:"text",content:"Hello"})`);
desktop.variables = { colors: { bg: '#ffffff' }, dark: { colors: { bg: '#000000' } } };

const port = await startViewer(0);
const base = `http://127.0.0.1:${port}`;

/** Each thumb's fitted scale against its rendered width, and the iframe's
 *  rendered box against the thumb's. */
async function thumbs(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.thumb[data-artboard-w]')].map((t) => {
    const frame = t.querySelector('iframe');
    const box = t.getBoundingClientRect();
    const rect = frame?.getBoundingClientRect();
    return {
      w: Number(t.dataset.artboardW),
      thumbW: box.width,
      thumbH: box.height,
      scale: Number(getComputedStyle(t).getPropertyValue('--thumb-scale')),
      frameW: rect?.width ?? null,
      frameH: rect?.height ?? null,
    };
  }));
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // --- FR-F1: thumbnails fill their cards ---
  await page.goto(`${base}/project/${DEFAULT_PROJECT_ID}`, { waitUntil: 'networkidle0' });
  for (const width of [1440, 900]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 150));
    const all = await thumbs(page);
    const phoneThumb = all.find((t) => t.w === 390);
    const desktopThumb = all.find((t) => t.w === 1440);
    for (const [label, t, h] of [['phone', phoneThumb, 844], ['desktop', desktopThumb, 900]] as const) {
      const ok = !!t && Math.abs(t.scale - t.thumbW / t.w) < 1e-3 && t.frameW !== null && Math.abs(t.frameW - t.thumbW) < 1 && Math.abs(t.thumbH - t.thumbW * h / t.w) < 1;
      check(`${label} thumb fills its card at a ${width}px window`, ok, JSON.stringify(t));
    }
  }

  // --- FR-F2: device mode ---
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${base}/canvas/${phone.id}`, { waitUntil: 'networkidle0' });
  // No named helpers inside evaluate: tsx's keepNames wraps them in __name,
  // which does not exist in the page.
  const device = await page.evaluate(() => {
    const [frame, screen] = ['#frame', '.device-screen'].map((sel) => {
      const b = document.querySelector(sel)!.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    return { frame, screen, overlayShown: !document.getElementById('safe-overlay')!.hidden };
  });
  check('device: iframe at 1:1 (390×844)', device.frame.w === 390 && device.frame.h === 844, JSON.stringify(device.frame));
  check('device: screen wraps the iframe exactly', device.screen.w === 390 && device.screen.h === 844 && device.screen.x === device.frame.x);
  check('device: overlay off by default', !device.overlayShown);

  await page.click('#btn-safe');
  const bands = await page.evaluate(() => {
    const screen = document.querySelector('.device-screen')!.getBoundingClientRect();
    const top = document.querySelector('.safe-band--top')!.getBoundingClientRect();
    const bottom = document.querySelector('.safe-band--bottom')!.getBoundingClientRect();
    return {
      shown: getComputedStyle(document.getElementById('safe-overlay')!).display !== 'none',
      active: document.getElementById('btn-safe')!.classList.contains('active'),
      top: { h: top.height, atTop: top.y === screen.y },
      bottom: { h: bottom.height, atBottom: bottom.bottom === screen.bottom },
    };
  });
  check('overlay: shown and the toggle active', bands.shown && bands.active);
  check('overlay: top band 47 at the screen top', bands.top.h === 47 && bands.top.atTop, JSON.stringify(bands.top));
  check('overlay: bottom band 34 at the screen bottom', bands.bottom.h === 34 && bands.bottom.atBottom, JSON.stringify(bands.bottom));
  await page.click('#btn-safe');
  const hiddenAgain = await page.evaluate(() => getComputedStyle(document.getElementById('safe-overlay')!).display === 'none' && !document.getElementById('btn-safe')!.classList.contains('active'));
  check('overlay: toggles off', hiddenAgain);

  // --- FR-F2: web breakpoints read the profile, keep other toolbar state ---
  await page.goto(`${base}/canvas/${desktop.id}`, { waitUntil: 'networkidle0' });
  await page.click('#btn-json');
  await page.click('#bp-mobile');
  await new Promise((r) => setTimeout(r, 400));
  const web = await page.evaluate(() => ({
    frameW: document.getElementById('frame')!.getAttribute('width'),
    active: [...document.querySelectorAll('.btn.active')].map((b) => b.id).sort(),
  }));
  check('web: Mobile sizes the frame 390 wide', web.frameW === '390', String(web.frameW));
  check('web: Mobile active, JSON still active', JSON.stringify(web.active) === JSON.stringify(['bp-mobile', 'btn-json']), web.active.join(','));

  // A 390-wide web canvas: Desktop highlights Desktop, not Mobile.
  await page.goto(`${base}/canvas/${narrowWeb.id}`, { waitUntil: 'networkidle0' });
  await page.click('#bp-mobile');
  await page.click('#bp-desktop');
  const narrowActive = await page.evaluate(() => [...document.querySelectorAll('.bp-btn.active')].map((b) => b.id));
  check('390-wide web canvas: Desktop highlights Desktop', JSON.stringify(narrowActive) === '["bp-desktop"]', narrowActive.join(','));

  // Dark survives a breakpoint switch.
  await page.goto(`${base}/canvas/${desktop.id}`, { waitUntil: 'networkidle0' });
  await page.click('#theme-toggle');
  await page.click('#bp-tablet');
  const darkSrc = await page.evaluate(() => document.getElementById('frame')!.getAttribute('src'));
  check('Dark stays on through a breakpoint switch', !!darkSrc && darkSrc.includes('theme=dark'), String(darkSrc));

  // An open page follows a type change without a manual reload.
  await page.goto(`${base}/canvas/${desktop.id}`, { waitUntil: 'networkidle0' });
  sg.setCanvasType(desktop.id, { type: 'mobile' });
  await page.waitForSelector('.device', { timeout: 6000 }).catch(() => null);
  const live = await page.evaluate(() => ({ device: !!document.querySelector('.device'), bp: !!document.getElementById('bp-mobile') }));
  check('type change: an open page switches to the device frame', live.device && !live.bp, JSON.stringify(live));

  // A safeArea edit redraws the bands on the open page.
  const now = sg.getCanvas(desktop.id)!;
  now.root.safeArea = { top: 20, bottom: 10 };
  sg.touchCanvas(desktop.id);
  await page.waitForFunction(() => (document.querySelector('.safe-band--top') as HTMLElement | null)?.style.height === '20px', { timeout: 6000 }).catch(() => null);
  const bandTop = await page.evaluate(() => (document.querySelector('.safe-band--top') as HTMLElement | null)?.style.height ?? null);
  check('safeArea edit: an open page redraws the bands', bandTop === '20px', String(bandTop));

  // An overflowing device (this one is 1440 wide) can scroll to its left edge.
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
  const left = await page.evaluate(() => {
    const vp = document.getElementById('viewport')!;
    vp.scrollLeft = 0;
    return document.querySelector('.device')!.getBoundingClientRect().left - vp.getBoundingClientRect().left;
  });
  check('wide device: left edge reachable', left >= 0, String(left));
} finally {
  await browser.close();
}

process.exit(allPass ? 0 : 1);
