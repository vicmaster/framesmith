// Phase 10 Slice 2 — viewer aggregation.
//
// The standalone viewer shows a unified gallery of every canvas: the global
// ~/.canvas-mcp store plus every registered repo's `.canvas/`. The repo content
// is a read-only cache, rebuilt from disk on each call (viewer launch / reload)
// — repos stay the source of truth; this never writes back. Repos that have
// moved or been deleted are skipped.
//
// This is a *viewer-only* concern: the MCP server's own store stays scoped to
// its context (bound → that repo; unbound → global), so the agent never sees
// other repos' canvases.

import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, mergeRepoWorkspace } from './workspaces.js';
import { loadPersistedCanvases, ingestCanvases } from './scene-graph.js';
import { readRegistry, readWorkspaceFile, readRepoCanvases } from './repo-store.js';

export function loadGlobalAndRegisteredRepos(): { repos: number; canvases: number } {
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();
  loadPersistedCanvases();

  let repos = 0;
  let canvases = 0;
  for (const dir of readRegistry()) {
    const wf = readWorkspaceFile(dir);
    if (!wf) continue; // moved / deleted / unreadable — skip
    mergeRepoWorkspace(wf);
    const cs = readRepoCanvases(dir);
    ingestCanvases(cs);
    repos++;
    canvases += cs.length;
  }
  return { repos, canvases };
}
