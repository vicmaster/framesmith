// Smoke for Phase 7 slice 4b: archive surface (route + sidebar entry +
// per-card restore/delete) and detail-page lifecycle buttons. Drives the
// underlying functions directly — the API endpoints are thin wrappers over
// scene-graph.archiveCanvas / unarchiveCanvas / deleteCanvas, already
// covered by test-workspace-mcp-tools.ts.
//
// Usage: npx tsx test-archive-view.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'canvas-mcp-test-'));
process.env.CANVAS_MCP_HOME = tmp;

const ws = await import('./src/workspaces.js');
const sg = await import('./src/scene-graph.js');
const viewer = await import('./src/viewer.js');
const { DEFAULT_PROJECT_ID } = await import('./src/types.js');

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Build state: one active canvas, two archived from two different projects
const acme = ws.createWorkspace('Acme');
const brand = ws.createProject(acme.id, 'Brand')!;

const active = sg.createCanvas('still-around', DEFAULT_PROJECT_ID);
const archivedA = sg.createCanvas('to-archive-a', DEFAULT_PROJECT_ID);
const archivedB = sg.createCanvas('to-archive-b', brand.id);
sg.archiveCanvas(archivedA.id);
sg.archiveCanvas(archivedB.id);

// ---- 1. Sidebar Archive entry on a project page ------------------------
{
  const html = viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001)!;
  check('project page: sidebar contains Archive link', html.includes('class="sidebar-archive'));
  check('project page: Archive link points to /archive', html.includes('href="/archive"'));
  check('project page: Archive count = 2 (cross-project total)',
    /class="sidebar-archive-count">2<\/span>/.test(html));
  check('project page: Archive entry is NOT active', !/class="sidebar-archive active"/.test(html));
}

// ---- 2. Archive page renders the right canvases -----------------------
{
  const html = viewer.renderArchivePage(3001);
  check('archive: title shows "Archived canvases"',
    /<h1 class="project-title">Archived canvases<\/h1>/.test(html));
  check('archive: meta shows count across all projects', html.includes('2 canvases across all projects'));
  check('archive: Archive sidebar entry IS active', /class="sidebar-archive active"/.test(html));

  check('archive: contains archivedA card', html.includes(`/canvas/${archivedA.id}`));
  check('archive: contains archivedB card', html.includes(`/canvas/${archivedB.id}`));
  check('archive: does NOT contain active canvas card', !html.includes(`/canvas/${active.id}`));

  // Each archived card shows its source project name
  check('archive: archivedA card shows source project "Untitled"', html.includes('Untitled &middot;'));
  check('archive: archivedB card shows source project "Brand"', html.includes('Brand &middot;'));

  // Restore + Delete buttons per card
  const restoreBtns = (html.match(/data-action="restore"/g) ?? []).length;
  const deleteBtns = (html.match(/data-action="delete"/g) ?? []).length;
  check('archive: each archived canvas has a Restore button', restoreBtns === 2);
  check('archive: each archived canvas has a Delete button', deleteBtns === 2);
}

// ---- 3. Archive page empty state --------------------------------------
{
  // Unarchive both → archive should be empty
  sg.unarchiveCanvas(archivedA.id);
  sg.unarchiveCanvas(archivedB.id);
  const html = viewer.renderArchivePage(3001);
  check('archive empty: title still "Archived canvases"',
    /<h1 class="project-title">Archived canvases<\/h1>/.test(html));
  check('archive empty: meta shows 0 canvases', html.includes('0 canvases across all projects'));
  check('archive empty: empty-state message present', html.includes('No archived canvases'));
  check('archive empty: empty-state hint references canvas_archive', html.includes('canvas_archive'));
  // Re-archive for the next checks
  sg.archiveCanvas(archivedA.id);
}

// ---- 4. Detail page lifecycle buttons ---------------------------------
{
  // Non-archived canvas → Archive button + Delete button, NO Restore button
  const detailActive = viewer.renderDetailPage(sg.getCanvas(active.id)!, 3001);
  check('detail (active): Archive button present', detailActive.includes('id="btn-archive"'));
  check('detail (active): Restore button absent', !detailActive.includes('id="btn-restore"'));
  check('detail (active): Delete button present', detailActive.includes('id="btn-delete"'));
  check('detail (active): lifecycleAction handler defined', detailActive.includes('async function lifecycleAction'));
  check('detail (active): "Back" goes to canvas\'s project',
    detailActive.includes(`/project/${DEFAULT_PROJECT_ID}`));

  // Archived canvas → Restore button instead of Archive
  const detailArchived = viewer.renderDetailPage(sg.getCanvas(archivedA.id)!, 3001);
  check('detail (archived): Restore button present', detailArchived.includes('id="btn-restore"'));
  check('detail (archived): Archive button absent', !detailArchived.includes('id="btn-archive"'));
  check('detail (archived): Delete button still present', detailArchived.includes('id="btn-delete"'));
}

// ---- 5. Counts are dynamic ---------------------------------------------
{
  // Delete the archived canvas, archive count should drop in the sidebar.
  sg.deleteCanvas(archivedA.id);
  const html = viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001)!;
  check('after delete: sidebar archive count drops to 0',
    /class="sidebar-archive-count">0<\/span>/.test(html));
}

rmSync(tmp, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
