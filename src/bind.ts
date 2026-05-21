// Phase 10 — bind orchestration.
//
// Binding spans three layers (repo IO, the workspace / project model, and the
// canvas store), so it lives in its own module rather than in index.ts —
// keeping it importable by the smoke test without booting the MCP server. None
// of the layers below import this file, so there is no import cycle.
//
// A repo binds a whole workspace: every project under it becomes a `.canvas/`
// subdirectory, every canvas an open-JSON file inside it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import {
  isRepoBound, getBackend, projectStartDir, findRepoRoot, setRepoBackend,
  writeWorkspaceFile, writeCanvasToDir, registerProjectDir, uniqueProjectDir,
  registerRepo, SCHEMA_VERSION, type RepoWorkspaceFile, type RepoProjectEntry,
} from './repo-store.js';
import { getWorkspace, listProjects, loadRepoWorkspace, deleteProject, deleteWorkspace } from './workspaces.js';
import { listCanvases, getCanvas, purgeGlobalCanvas, loadPersistedCanvases } from './scene-graph.js';
import { DEFAULT_WORKSPACE_ID } from './types.js';

export type BindResult =
  | { ok: true; root: string; dir: string; workspace: string; projects: number; migrated: number }
  | { ok: false; error: string };

/** Create a `.canvas/` binding for a workspace: migrate all of its projects +
 * canvases into the repo, then switch the live session to the repo backend. */
export function bindRepo(opts: { workspaceId?: string; dir?: string }): BindResult {
  if (isRepoBound()) {
    const b = getBackend();
    return { ok: false, error: `Already bound to a repo at ${b.kind === 'repo' ? b.dir : '(unknown)'}.` };
  }
  const start = opts.dir ?? projectStartDir();
  const root = findRepoRoot(start);
  const dir = join(root, '.canvas');
  if (existsSync(join(dir, 'workspace.json'))) {
    return { ok: false, error: `A .canvas/ binding already exists at ${dir}. Restart the server in this directory to use it.` };
  }
  const srcWsId = opts.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const srcWs = getWorkspace(srcWsId);
  if (!srcWs) return { ok: false, error: `Workspace "${srcWsId}" not found. Use workspace_list to see available workspaces.` };

  const now = new Date().toISOString();
  const srcProjects = listProjects(srcWsId);

  // Build the virtual project entries, assigning each a stable subdirectory and
  // a fresh repo-scoped id. Track old → new project id so canvases retarget.
  const idMap = new Map<string, string>();
  const projectEntries: RepoProjectEntry[] = srcProjects.map((p) => {
    const newId = `repo-proj-${nanoid(8)}`;
    idMap.set(p.id, newId);
    const projDir = uniqueProjectDir(p.name);
    registerProjectDir(newId, projDir);
    return { id: newId, name: p.name, dir: projDir, designSystem: p.designSystem };
  });

  const wf: RepoWorkspaceFile = {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: `repo-ws-${nanoid(8)}`,
    workspaceName: srcWs.name,
    designSystem: srcWs.designSystem,
    projects: projectEntries,
    boundAt: now,
  };

  // Snapshot the canvases to migrate before switching backend.
  const toMigrate = listCanvases()
    .filter((c) => idMap.has(c.projectId))
    .map((c) => getCanvas(c.id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  writeWorkspaceFile(dir, wf);
  for (const canvas of toMigrate) {
    canvas.projectId = idMap.get(canvas.projectId)!;
    writeCanvasToDir(dir, canvas);
    purgeGlobalCanvas(canvas.id);
  }

  // The source workspace's content now lives in the repo — drop the emptied
  // source workspace + projects from the global indexes so the viewer doesn't
  // show a duplicate empty shell beside the repo. The built-in Personal
  // workspace is protected (deleteWorkspace/deleteProject refuse it), so a bind
  // of Personal leaves the global default intact.
  if (srcWsId !== DEFAULT_WORKSPACE_ID) {
    for (const p of srcProjects) deleteProject(p.id);
    deleteWorkspace(srcWsId);
  }

  // Switch the live session to the repo and reload the store from disk.
  setRepoBackend(root, dir);
  loadRepoWorkspace(wf);
  loadPersistedCanvases();
  registerRepo(dir); // so the viewer can mirror this repo

  return { ok: true, root, dir, workspace: wf.workspaceName, projects: projectEntries.length, migrated: toMigrate.length };
}
