// Smoke for the viewer logo + favicon swap.
//
// - Sidebar shows the framesmith grid path mark (not the old amber square).
// - Every page emits a `<link rel="icon" type="image/svg+xml">` favicon.
// - .sidebar-mark CSS no longer uses background-color (background is set on
//   the placeholder span; the new SVG draws via stroke="currentColor").
//
// Usage: npx tsx test-viewer-logo-favicon.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'framesmith-logo-'));
process.env.FRAMESMITH_HOME = tmp;

const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject } = await import('./src/workspaces.js');
const { createCanvas } = await import('./src/scene-graph.js');
const { renderProjectPage, renderArchivePage, renderDetailPage } = await import('./src/viewer.js');
const { DEFAULT_PROJECT_ID } = await import('./src/types.js');

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

try {
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();
  const canvas = createCanvas('logo-favicon-test', DEFAULT_PROJECT_ID);

  const gallery = (await renderProjectPage(DEFAULT_PROJECT_ID, 3001))!;
  const archive = renderArchivePage(3001);
  const detail = await renderDetailPage(canvas, 3001);

  // --- Favicon present on every page ---
  for (const [name, html] of [['gallery', gallery], ['archive', archive], ['detail', detail]] as const) {
    expect(`favicon: ${name} has <link rel="icon" type="image/svg+xml">`,
      html.includes('<link rel="icon" type="image/svg+xml"'));
    expect(`favicon: ${name} data URI contains the grid path`,
      html.includes("d='M 4 4 L 20 4 L 20 20 L 4 20 Z"));
  }

  // --- Sidebar shows the new logo SVG instead of the empty span ---
  for (const [name, html] of [['gallery', gallery], ['archive', archive]] as const) {
    expect(`logo: ${name} sidebar contains the grid path mark`,
      html.includes('<svg class="sidebar-mark"') && html.includes('d="M 4 4 L 20 4 L 20 20 L 4 20 Z'));
    expect(`logo: ${name} sidebar does NOT contain the old empty <span class="sidebar-mark"></span>`,
      !html.includes('<span class="sidebar-mark"></span>'));
  }

  // --- .sidebar-mark CSS no longer paints a solid amber rectangle ---
  expect('css: .sidebar-mark no background-color: var(--accent)',
    !gallery.includes('background: var(--accent); flex-shrink: 0; }'),
    'old rule (background: var(--accent)) should be replaced with color: var(--accent)');
  expect('css: .sidebar-mark uses color: var(--accent) for stroke',
    gallery.includes('color: var(--accent)') && gallery.includes('.sidebar-mark {'));

  // --- Detail page has no sidebar so logo-mark CSS may or may not appear,
  // but favicon must still be on the page (covered above). ---
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);
