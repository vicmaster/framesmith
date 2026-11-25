// Smoke for Phase 7 slice 4b, rebuilt in Phase 33 slice E: archive surface
// (route + sidebar entry + tree, panel and empty state) and detail-page lifecycle buttons. Drives the
// underlying functions directly — the API endpoints are thin wrappers over
// scene-graph.archiveCanvas / unarchiveCanvas / deleteCanvas, already
// covered by test/unit/test-workspace-mcp-tools.ts.
//
// Usage: npx tsx test/unit/test-archive-view.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'framesmith-test-'));
process.env.FRAMESMITH_HOME = tmp;

const ws = await import('../../src/workspaces.js');
const sg = await import('../../src/scene-graph.js');
const viewer = await import('../../src/viewer.js');
const { DEFAULT_PROJECT_ID } = await import('../../src/types.js');

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

/** The sidebar's Archive link (Phase 33): whether it is the current place, and its count. */
function archiveLink(html: string): { current: boolean; count: number } | null {
  const m = /<a href="\/archive" class="nav-item sidebar-archive"( aria-current="page")?>([\s\S]*?)<\/a>/.exec(html);
  return m ? { current: !!m[1], count: Number(/<span class="nav-count">(\d+)<\/span>/.exec(m[2])?.[1] ?? NaN) } : null;
}

// ---- 1. Sidebar Archive entry on a project page ------------------------
{
  const html = (await viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001))!;
  check('project page: sidebar contains Archive link', html.includes('class="nav-item sidebar-archive"'));
  check('project page: Archive link points to /archive', html.includes('href="/archive"'));
  check('project page: Archive count = 2 (cross-project total)', archiveLink(html)?.count === 2);
  check('project page: Archive entry is NOT the current place', archiveLink(html)?.current === false);
}

// ---- 2. Archive page: tree, panel, selection (Phase 33 FR-E1) ----------
{
  // archivedA was archived first; give it the older archivedAt so the order is certain.
  sg.getCanvas(archivedA.id)!.archivedAt = '2026-11-01T00:00:00.000Z';
  sg.getCanvas(archivedB.id)!.archivedAt = '2026-11-02T00:00:00.000Z';
  const html = await viewer.renderArchivePage(3001);
  check('archive: header title "Archive"', /<h1 class="page-title">Archive<\/h1>/.test(html));
  check('archive: summary counts and explains', html.includes('2 canvases · hidden from the gallery until restored'));
  check('archive: Archive sidebar entry IS the current place', archiveLink(html)?.current === true);

  const rows = [...html.matchAll(/class="tree-row tree-row--canvas" href="\/archive\?canvas=([^"]+)"/g)].map((m) => m[1]);
  check('archive: one tree row per archived canvas', rows.length === 2 && rows.includes(archivedA.id) && rows.includes(archivedB.id), JSON.stringify(rows));
  check('archive: no row for the active canvas', !html.includes(`data-canvas-id="${active.id}"`));
  const groups = [...html.matchAll(/<summary class="tree-row tree-row--project">[\s\S]*?<span class="tree-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  check('archive: grouped by project, projects by name', JSON.stringify(groups) === '["Brand","Untitled"]', JSON.stringify(groups));

  const panel = html.slice(html.indexOf('<aside class="panel"'));
  check('archive: default selection is the most recently archived', panel.includes(`data-canvas-id="${archivedB.id}"`) && html.includes(`data-canvas-id="${archivedB.id}" aria-current="page"`));
  check('archive: panel shows Project and Archived date', panel.includes('<dt>Project</dt><dd>Brand</dd>') && panel.includes('<dt>Archived</dt><dd>Nov 2, 2026</dd>'));
  check('archive: panel shows Size and a score for an empty canvas', panel.includes('<dt>Size</dt><dd>1440 × 900</dd>') && panel.includes('<dt>Score</dt><dd>No score yet</dd>'));
  check('archive: Restore names the project', panel.includes('<span>Restore to Brand</span>'));
  check('archive: Delete permanently, under the warning', panel.includes('Deleting removes the canvas for good. It cannot be restored.') && panel.includes('id="btn-delete"'));
  check('archive: delete confirms in the shared dialog', html.includes('id="delete-dialog"') && html.includes('Delete to-archive-b?') && html.includes("fsDialog.open('delete-dialog')"));
  check('archive: the next canvas is passed to the script', html.includes(`const NEXT = "${archivedA.id}";`));

  const picked = await viewer.renderArchivePage(3001, archivedA.id);
  check('archive: ?canvas= selects that canvas', picked.includes(`data-canvas-id="${archivedA.id}" aria-current="page"`) && picked.includes('<span>Restore to Untitled</span>'));
  check('archive: …and the next is the one before it', picked.includes(`const NEXT = "${archivedB.id}";`));
  const unknown = await viewer.renderArchivePage(3001, active.id);
  check('archive: a ?canvas= that is not archived falls back to the newest', unknown.includes(`data-canvas-id="${archivedB.id}" aria-current="page"`));
}

// ---- 2b. A canvas whose project is gone cannot be restored into nowhere --
{
  const orphanProject = ws.createProject(acme.id, 'Doomed')!;
  const orphan = sg.createCanvas('orphan', orphanProject.id);
  sg.archiveCanvas(orphan.id);
  ws.deleteProject(orphanProject.id);
  const html = await viewer.renderArchivePage(3001, orphan.id);
  check('orphan: grouped under "Unknown project"', html.includes('<span class="tree-label">Unknown project</span>'));
  check('orphan: no Restore button, a note saying how instead', !html.includes('id="btn-restore"') && html.includes('canvas_move'));
  check('orphan: Delete permanently still offered', html.includes('id="btn-delete"'));
  sg.deleteCanvas(orphan.id);
}

// ---- 3. Archive page empty state (FR-E2) -------------------------------
{
  sg.unarchiveCanvas(archivedA.id);
  sg.unarchiveCanvas(archivedB.id);
  const html = await viewer.renderArchivePage(3001);
  check('archive empty: title still "Archive"', /<h1 class="page-title">Archive<\/h1>/.test(html));
  check('archive empty: summary says 0 canvases', html.includes('<span class="summary">0 canvases</span>'));
  check('archive empty: empty-state title', html.includes('No archived canvases'));
  check('archive empty: the design\'s hint', html.includes('Archive a canvas from its page, or have your agent call canvas_archive. Archived canvases wait here until you restore or delete them.'));
  check('archive empty: no panel, no dialog', !html.includes('class="panel"') && !html.includes('id="delete-dialog"'));
  // Re-archive for the next checks
  sg.archiveCanvas(archivedA.id);
}

// ---- 4. Detail page lifecycle buttons ---------------------------------
{
  // Non-archived canvas → Archive button + Delete button, NO Restore button
  const detailActive = await viewer.renderDetailPage(sg.getCanvas(active.id)!, 3001);
  // Phase 33 slice C: lifecycle actions live in the More menu; Delete confirms in a dialog.
  check('detail (active): More menu offers Archive', detailActive.includes('data-action="archive"'));
  check('detail (active): no Restore on an active canvas', !detailActive.includes('data-action="unarchive"'));
  check('detail (active): More menu offers Delete canvas', detailActive.includes('data-action="delete"'));
  check('detail (active): the delete dialog is on the page', detailActive.includes('id="delete-dialog"') && detailActive.includes('fsDialog.open(\'delete-dialog\')'));
  check('detail (active): lifecycleAction handler defined', detailActive.includes('async function lifecycleAction'));
  check('detail (active): "Back" goes to canvas\'s project',
    detailActive.includes(`/project/${DEFAULT_PROJECT_ID}`));

  // Archived canvas → Restore button instead of Archive
  const detailArchived = await viewer.renderDetailPage(sg.getCanvas(archivedA.id)!, 3001);
  check('detail (archived): More menu offers Restore', detailArchived.includes('data-action="unarchive"'));
  check('detail (archived): no Archive on an archived canvas', !detailArchived.includes('data-action="archive"'));
  check('detail (archived): Delete canvas still offered', detailArchived.includes('data-action="delete"'));
}

// ---- 5. Counts are dynamic ---------------------------------------------
{
  // Delete the archived canvas, archive count should drop in the sidebar.
  sg.deleteCanvas(archivedA.id);
  const html = (await viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001))!;
  check('after delete: sidebar archive count drops to 0', archiveLink(html)?.count === 0);
}

rmSync(tmp, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
