// Phase 30 slice F (FR-F1, FR-F2): the viewer shows a canvas at its artboard's
// real proportions. Cards size their iframe from the root and take its aspect
// ratio (clamped); a mobile canvas opens 1:1 in a device frame with a
// safe-area overlay and no breakpoint buttons; a web canvas's breakpoint
// buttons read the phone size from the device profile table. Markup only —
// test-viewer-surface-browser.ts checks the same pages in Chrome.
//
// Usage: npx tsx test-viewer-surface.ts

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.FRAMESMITH_HOME = mkdtempSync(join(tmpdir(), 'framesmith-test-'));

const ws = await import('./src/workspaces.js');
const sg = await import('./src/scene-graph.js');
const viewer = await import('./src/viewer.js');
const { DEFAULT_PROJECT_ID } = await import('./src/types.js');
const { DEVICE_PROFILES } = await import('./src/surfaces.js');

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const content = [{ id: 't', type: 'text' as const, content: 'Hello' }];
function make(name: string, size: { width?: number; height?: number }, surface?: { type: 'web' | 'mobile' }) {
  const c = sg.createCanvas(name, DEFAULT_PROJECT_ID, size, surface);
  c.root.children = structuredClone(content);
  return c;
}

/** The card markup for one canvas: from its card's opening tag to the next card. */
function cardFor(html: string, id: string): string {
  const at = html.indexOf(`href="/canvas/${id}"`);
  if (at < 0) return '';
  const next = html.slice(at + 1).search(/<a href="\/canvas\/|<div class="card[ "]/);
  return html.slice(at, next < 0 ? undefined : at + 1 + next);
}

const phone = make('phone', {}, { type: 'mobile' });
const desktop = make('desktop', { width: 1440, height: 900 });
const longPage = make('long', { width: 1440, height: 6000 });
const banner = make('banner', { width: 1440, height: 300 });
const empty = sg.createCanvas('empty-phone', DEFAULT_PROJECT_ID, {}, { type: 'mobile' });

// --- FR-F1: gallery cards ---
const project = (await viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001))!;

const phoneCard = cardFor(project, phone.id);
check('phone card: 390×844 iframe', phoneCard.includes('style="width: 390px; height: 844px;"'));
check('phone card: aspect 390 / 844', phoneCard.includes('aspect-ratio: 390 / 844;'));
check('phone card: server scale 0.222 × 1440 / 390', phoneCard.includes('--thumb-scale: 0.8197;'));
check('phone card: thumb carries its artboard width', phoneCard.includes('data-artboard-w="390"'));

const desktopCard = cardFor(project, desktop.id);
check('desktop card: 1440×900 iframe', desktopCard.includes('style="width: 1440px; height: 900px;"'));
check('desktop card: aspect 1440 / 900', desktopCard.includes('aspect-ratio: 1440 / 900;'));
check('desktop card: scale(0.222)', desktopCard.includes('--thumb-scale: 0.222;'));

const longCard = cardFor(project, longPage.id);
check('long page: aspect clamps to the phone ratio', longCard.includes('aspect-ratio: 390 / 844;'));
check('long page: iframe keeps the full artboard', longCard.includes('style="width: 1440px; height: 6000px;"'));
check('banner: aspect clamps to 2 / 1', cardFor(project, banner.id).includes('aspect-ratio: 2 / 1;'));

const emptyCard = cardFor(project, empty.id);
check('empty canvas: placeholder in a portrait box', emptyCard.includes('thumb--empty') && emptyCard.includes('aspect-ratio: 390 / 844;') && !emptyCard.includes('<iframe'));

check('project page: the fit script ships', project.includes("thumb.style.setProperty('--thumb-scale'"));
check('project page: no hardcoded 1440×900 thumb size left', !project.includes('width: 1440px; height: 900px; border: none'));
check('project page: cards align to their top', /\.grid \{[^}]*align-items: start/.test(project));

// The archive page builds its cards through the same helper.
sg.archiveCanvas(phone.id);
const archive = viewer.renderArchivePage(3001);
const archivedCard = cardFor(archive, phone.id);
check('archive card: 390×844 iframe at 390 / 844', archivedCard.includes('style="width: 390px; height: 844px;"') && archivedCard.includes('aspect-ratio: 390 / 844;'));
check('archive page: the fit script ships', archive.includes("thumb.style.setProperty('--thumb-scale'"));
sg.unarchiveCanvas(phone.id);

// --- FR-F2: detail view ---
const phoneDetail = await viewer.renderDetailPage(sg.getCanvas(phone.id)!, 3001);
check('mobile detail: device frame', phoneDetail.includes('class="device" data-device="iphone-390"'));
check('mobile detail: screen at 1:1', phoneDetail.includes('class="device-screen" style="width: 390px; height: 844px;"'));
check('mobile detail: #frame inside the screen', /class="device-screen"[^>]*>\s*<iframe id="frame"/.test(phoneDetail));
check('mobile detail: safe-area toggle', phoneDetail.includes('id="btn-safe"') && phoneDetail.includes('function toggleSafeArea'));
check('mobile detail: overlay hidden by default', phoneDetail.includes('id="safe-overlay" hidden'));
check('mobile detail: top band 47', phoneDetail.includes('safe-band--top" style="height: 47px;"'));
check('mobile detail: bottom band 34', phoneDetail.includes('safe-band--bottom" style="height: 34px;"'));
for (const id of ['bp-mobile', 'bp-tablet', 'bp-desktop', 'bp-compare', 'btn-fit', 'compare-grid']) {
  check(`mobile detail: no #${id}`, !phoneDetail.includes(`id="${id}"`));
}
check('mobile detail: label names the device', phoneDetail.includes('390 x 844 &middot; iphone-390'));
check('mobile detail: comment and JSON stay', phoneDetail.includes('id="btn-comment"') && phoneDetail.includes('id="btn-json"'));

// Without root.safeArea (a canvas made mobile by canvas_set_type) the bands
// come from the profile; with custom insets they follow the root, per side.
const typed = make('typed', { width: 390, height: 844 });
sg.setCanvasType(typed.id, { type: 'mobile' });
const typedDetail = await viewer.renderDetailPage(sg.getCanvas(typed.id)!, 3001);
check('typed mobile: profile bands 47 / 34', typedDetail.includes('safe-band--top" style="height: 47px;"') && typedDetail.includes('safe-band--bottom" style="height: 34px;"'));

const custom = make('custom', {}, { type: 'mobile' });
custom.root.safeArea = { top: 20, bottom: Number.NaN };
const customDetail = await viewer.renderDetailPage(custom, 3001);
check('custom insets: top from the root', customDetail.includes('safe-band--top" style="height: 20px;"'));
check('custom insets: unusable bottom falls back to the profile', customDetail.includes('safe-band--bottom" style="height: 34px;"'));

// A side set to 0 draws no band (a 1px band under a 16px label straddled the edge).
const flush = make('flush', {}, { type: 'mobile' });
flush.root.safeArea = { top: 0, bottom: 34 };
const flushDetail = await viewer.renderDetailPage(flush, 3001);
check('zero inset: no top band', !flushDetail.includes('class="safe-band safe-band--top"') && flushDetail.includes('safe-band--bottom" style="height: 34px;"'));

// Only finite positive sizes are read; anything else is the 1440×900 default.
for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
  const odd = make('odd', { width: 1440, height: 900 });
  odd.root.width = bad;
  const card = cardFor((await viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001))!, odd.id);
  check(`root width ${bad}: card falls back to 1440`, card.includes('style="width: 1440px; height: 900px;"') && card.includes('--thumb-scale: 0.222;'));
  sg.deleteCanvas(odd.id);
}

// The open detail page reloads when its type or artboard changes.
check('detail page: reloads on a type or size change', phoneDetail.includes('const pageShape = {"type":"mobile","width":390,"height":844}') && phoneDetail.includes('location.reload()'));
check('detail page: breakpoint switch keeps the dark render', phoneDetail.includes("(themeMode === 'dark' ? '&theme=dark' : '')"));
check('preview: overflow stays scrollable to the left edge', /\.viewport \{[^}]*justify-content: safe center/.test(phoneDetail));

// --- FR-F2: web breakpoints from the profile table ---
const p = DEVICE_PROFILES['iphone-390'];
const webDetail = await viewer.renderDetailPage(sg.getCanvas(desktop.id)!, 3001);
check('web detail: Mobile button uses the profile size', webDetail.includes(`setViewport(${p.width}, ${p.height}, 'mobile')`));
check('web detail: compare cell uses the profile size', webDetail.includes(`html?w=${p.width}&h=${p.height}`) && webDetail.includes(`--bp-w: ${p.width}; --bp-h: ${p.height};`));
check('web detail: no device frame', !webDetail.includes('class="device"') && !webDetail.includes('id="btn-safe"'));
check('web detail: active state follows the pressed button', webDetail.includes("document.getElementById('bp-' + bp).classList.add('active')"));
check('web detail: switching clears only breakpoint buttons', !webDetail.includes("querySelectorAll('.btn').forEach(b => b.classList.remove('active'))"));

// A profile-sized canvas with no declared type is still web: framed only on declaration.
const undeclared = make('undeclared', { width: 390, height: 844 });
const undeclaredDetail = await viewer.renderDetailPage(sg.getCanvas(undeclared.id)!, 3001);
check('undeclared 390 canvas: breakpoints, no frame', undeclaredDetail.includes('id="bp-desktop"') && !undeclaredDetail.includes('class="device"'));

// The render route is untouched: device mode is presentation only.
check('mobile detail: iframe points at the plain render route', phoneDetail.includes(`<iframe id="frame" src="/canvas/${phone.id}/html" width="390" height="844">`));

if (!allPass) { console.log('\nFAILED'); process.exit(1); }
console.log('\nAll viewer surface checks passed.');
