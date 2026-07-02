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
import type { Canvas } from './types.js';
import { readRegistry, readWorkspaceFile, readRepoCanvasEntries, writeCanvasFileAt, deleteCanvasFileAt } from './repo-store.js';
import { watch, existsSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

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
    try {
      const wf = readWorkspaceFile(dir);
      if (!wf) continue; // moved / deleted / unreadable — skip
      mergeRepoWorkspace(wf);
      const entries = readRepoCanvasEntries(dir);
      ingestCanvases(entries.map((e) => e.canvas));
      for (const e of entries) repoLocations.set(e.canvas.id, { canvasDir: dir, absFile: e.absFile });
      repos++;
      canvases += entries.length;
    } catch {
      // Malformed/mid-write repo files must never take the viewer down — the
      // live watcher (watchAggregateSources) can fire during an agent's write,
      // and a corrupt repo is the repo's problem, not the gallery's. Skip it;
      // the next change event re-reads it.
      continue;
    }
  }
  return { repos, canvases };
}

/** Watch EVERY aggregation source for changes and re-aggregate (debounced):
 * the global canvases dir, registry.json, and — the part the standalone viewer
 * was missing — every registered repo's `.framesmith/` (recursively, so
 * per-project subdir canvas writes fire too). Repo watchers re-sync after each
 * reload, so a repo bound while the viewer runs starts updating live without a
 * restart. Returns a dispose function (tests / shutdown). */
export function watchAggregateSources(
  dataDir: string,
  onReload?: (info: { repos: number; canvases: number }) => void,
): () => void {
  const repoWatchers = new Map<string, FSWatcher>();
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const isContentFile = (filename: string | null) =>
    !!filename && (filename.endsWith('.json')); // canvases, workspace.json, registry.json; asset binaries don't matter

  const reload = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const info = loadGlobalAndRegisteredRepos();
      syncRepoWatchers();
      onReload?.(info);
    }, 300);
  };

  const watchRepo = (dir: string) => {
    if (repoWatchers.has(dir) || !existsSync(dir)) return;
    try {
      // recursive: per-project subdirs hold the canvas files.
      repoWatchers.set(dir, watch(dir, { recursive: true }, (_e, f) => { if (isContentFile(f)) reload(); }));
    } catch {
      // Recursive watch unavailable (older Linux Node) — top level still
      // catches workspace.json; better than nothing.
      try { repoWatchers.set(dir, watch(dir, (_e, f) => { if (isContentFile(f)) reload(); })); } catch { /* repo gone — skip */ }
    }
  };

  const syncRepoWatchers = () => {
    const registered = new Set(readRegistry());
    for (const dir of registered) watchRepo(dir);
    for (const [dir, watcher] of repoWatchers) {
      if (!registered.has(dir)) {
        watcher.close();
        repoWatchers.delete(dir);
      }
    }
  };

  const topWatchers: FSWatcher[] = [];
  try {
    topWatchers.push(watch(join(dataDir, 'canvases'), (_e, f) => { if (isContentFile(f)) reload(); }));
  } catch { /* global store dir missing — created on first write; registry watcher still covers re-binds */ }
  try {
    topWatchers.push(watch(dataDir, (_e, f) => { if (f === 'registry.json') reload(); }));
  } catch { /* data dir missing entirely — nothing to watch yet */ }
  syncRepoWatchers();

  return () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    for (const w of topWatchers) w.close();
    for (const w of repoWatchers.values()) w.close();
    repoWatchers.clear();
  };
}

/** Mutate a mirrored repo canvas in the store and write it back to the repo
 * file it came from (Phase 21 — the generic shape archive always had). The
 * mutator returns false to abort without writing. Returns false if the id
 * isn't a repo mirror (caller falls back to the global path). */
export function updateRepoCanvas(id: string, mutate: (c: Canvas) => boolean): boolean {
  const loc = repoLocations.get(id);
  if (!loc) return false;
  const c = getCanvas(id);
  if (!c) return false;
  if (!mutate(c)) return false;
  c.lastModified = new Date().toISOString();
  writeCanvasFileAt(loc.canvasDir, loc.absFile, c);
  return true;
}

/** Archive/unarchive a mirrored repo canvas: flip the flag in the store and
 * write it back to the repo file. Returns false if the id isn't a repo mirror
 * (caller falls back to the global path). */
export function archiveRepoCanvas(id: string, archived: boolean): boolean {
  return updateRepoCanvas(id, (c) => {
    c.archived = archived;
    if (archived) c.archivedAt = new Date().toISOString();
    else delete c.archivedAt;
    return true;
  });
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
