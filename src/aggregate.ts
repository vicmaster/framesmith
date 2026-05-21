// Phase 10 Slice 2 — viewer aggregation.
//
// The standalone viewer shows a unified gallery of every canvas: the global
// ~/.framesmith store plus every registered repo's `.framesmith/`. The repo content
// is a read-only mirror, rebuilt from disk on each call (viewer launch / reload)
// — repos stay the source of truth; reads never write back. Repos that have
// moved or been deleted are skipped.
//
// Lifecycle (archive/delete) on a mirrored canvas is written back to the repo
// file it came from (Phase 10 closeout) — see archiveRepoCanvas / deleteRepoCanvas.
//
// This is a *viewer-only* concern: the MCP server's own store stays scoped to
// its context (bound → that repo; unbound → global), so the agent never sees
// other repos' canvases.

import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, mergeRepoWorkspace } from './workspaces.js';
import { loadPersistedCanvases, ingestCanvases, getCanvas, deleteCanvas } from './scene-graph.js';
import { readRegistry, readWorkspaceFile, readRepoCanvasEntries, writeCanvasFileAt, deleteCanvasFileAt } from './repo-store.js';

// canvasId → where its file lives, for mirrored repo canvases. Lets the viewer
// write lifecycle changes back to the right repo file.
const repoLocations = new Map<string, { canvasDir: string; absFile: string }>();

export function getRepoLocation(id: string): { canvasDir: string; absFile: string } | undefined {
  return repoLocations.get(id);
}

export function loadGlobalAndRegisteredRepos(): { repos: number; canvases: number } {
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();
  loadPersistedCanvases();
  repoLocations.clear();

  let repos = 0;
  let canvases = 0;
  for (const dir of readRegistry()) {
    const wf = readWorkspaceFile(dir);
    if (!wf) continue; // moved / deleted / unreadable — skip
    mergeRepoWorkspace(wf);
    const entries = readRepoCanvasEntries(dir);
    ingestCanvases(entries.map((e) => e.canvas));
    for (const e of entries) repoLocations.set(e.canvas.id, { canvasDir: dir, absFile: e.absFile });
    repos++;
    canvases += entries.length;
  }
  return { repos, canvases };
}

/** Archive/unarchive a mirrored repo canvas: flip the flag in the store and
 * write it back to the repo file. Returns false if the id isn't a repo mirror
 * (caller falls back to the global path). */
export function archiveRepoCanvas(id: string, archived: boolean): boolean {
  const loc = repoLocations.get(id);
  if (!loc) return false;
  const c = getCanvas(id);
  if (!c) return false;
  c.archived = archived;
  const now = new Date().toISOString();
  if (archived) c.archivedAt = now;
  else delete c.archivedAt;
  c.lastModified = now;
  writeCanvasFileAt(loc.canvasDir, loc.absFile, c);
  return true;
}

/** Delete a mirrored repo canvas: remove its repo file and drop it from the
 * store. Returns false if the id isn't a repo mirror. */
export function deleteRepoCanvas(id: string): boolean {
  const loc = repoLocations.get(id);
  if (!loc) return false;
  deleteCanvasFileAt(loc.absFile);
  repoLocations.delete(id);
  deleteCanvas(id); // store removal; harmless no-op against the global store
  return true;
}
