// Smoke for the viewer logo + favicon swap.
//
// - Every page emits a `<link rel="icon" type="image/svg+xml">` favicon with
//   the framesmith grid mark, stroked in the design system's accent.
// - Phase 33: the sidebar's brand is the "framesmith" wordmark linked home.
//
// Usage: npx tsx test/unit/test-viewer-logo-favicon.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'framesmith-logo-'));
process.env.FRAMESMITH_HOME = tmp;

const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject } = await import('../../src/workspaces.js');
const { createCanvas } = await import('../../src/scene-graph.js');
const { renderProjectPage, renderArchivePage, renderDetailPage } = await import('../../src/viewer.js');
const { DEFAULT_PROJECT_ID } = await import('../../src/types.js');
const { LIGHT } = await import('../../src/viewer/tokens.js');

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

try {
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();
  const canvas = createCanvas('logo-favicon-test', DEFAULT_PROJECT_ID);

  const gallery = (await renderProjectPage(DEFAULT_PROJECT_ID, 3001))!;
  const archive = await renderArchivePage(3001);
  const detail = await renderDetailPage(canvas, 3001);

  // --- Favicon present on every page ---
  for (const [name, html] of [['gallery', gallery], ['archive', archive], ['detail', detail]] as const) {
    expect(`favicon: ${name} has <link rel="icon" type="image/svg+xml">`,
      html.includes('<link rel="icon" type="image/svg+xml"'));
    expect(`favicon: ${name} data URI contains the grid path`,
      html.includes("d='M 4 4 L 20 4 L 20 20 L 4 20 Z"));
  }

  // --- Phase 33: the sidebar's brand is the wordmark, linked home; the grid
  // mark lives on in the favicon, stroked in the design system's accent. ---
  for (const [name, html] of [['gallery', gallery], ['archive', archive]] as const) {
    expect(`brand: ${name} sidebar shows the framesmith wordmark linked to /`,
      html.includes('<a href="/" class="sidebar-brand">framesmith</a>'));
    expect(`brand: ${name} sidebar has no grid mark`, !html.includes('sidebar-mark'));
  }
  expect('favicon: stroked in the light accent token', gallery.includes(`stroke='${encodeURIComponent(LIGHT.colors.accent)}'`));

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
