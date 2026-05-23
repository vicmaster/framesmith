// Phase 10 — bind orchestration.
//
// Binding spans three layers (repo IO, the workspace / project model, and the
// canvas store), so it lives in its own module rather than in index.ts —
// keeping it importable by the smoke test without booting the MCP server. None
// of the layers below import this file, so there is no import cycle.
//
// A repo binds a whole workspace: every project under it becomes a `.framesmith/`
// subdirectory, every canvas an open-JSON file inside it.

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { nanoid } from 'nanoid';
import {
  isRepoBound, getBackend, projectStartDir, findRepoRoot, setRepoBackend,
  writeWorkspaceFile, writeCanvasToDir, registerProjectDir, uniqueProjectDir,
  registerRepo, detectBinding, readWorkspaceFile, getProjectDir,
  SCHEMA_VERSION, type RepoWorkspaceFile, type RepoProjectEntry,
} from './repo-store.js';
import {
  getWorkspace, listProjects, loadRepoWorkspace, deleteProject, deleteWorkspace,
  createWorkspace, createProject, listWorkspaces, getWorkspaceDesignSystem,
} from './workspaces.js';
import { listCanvases, getCanvas, purgeGlobalCanvas, loadPersistedCanvases } from './scene-graph.js';
import { DEFAULT_WORKSPACE_ID } from './types.js';

export type BindResult =
  | { ok: true; root: string; dir: string; workspace: string; projects: number; migrated: number }
  | { ok: false; error: string };

/** Create a `.framesmith/` binding for a workspace: migrate all of its projects +
 * canvases into the repo, then switch the live session to the repo backend. */
export function bindRepo(opts: { workspaceId?: string; dir?: string }): BindResult {
  if (isRepoBound()) {
    const b = getBackend();
    return { ok: false, error: `Already bound to a repo at ${b.kind === 'repo' ? b.dir : '(unknown)'}.` };
  }
  const start = opts.dir ?? projectStartDir();
  const root = findRepoRoot(start);
  const dir = join(root, '.framesmith');
  if (existsSync(join(dir, 'workspace.json'))) {
    return { ok: false, error: `A .framesmith/ binding already exists at ${dir}. Restart the server in this directory to use it.` };
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

/** Turn a directory basename into a readable workspace name ("md-toolkit" →
 * "Md Toolkit"). Falls back to "Design" for an empty/odd basename. */
export function prettifyWorkspaceName(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || 'Design';
}

export type InitResult =
  | {
      ok: true;
      workspace: { id: string; name: string; canvasDir: string | null };
      projects: Array<{ id: string; name: string; dir: string | null }>;
      projectsCreated: string[];
      designSystemTokenCount: number;
    }
  | { ok: false; error: string };

/** Phase 15 — the `init` tool core: idempotent onboarding orchestration.
 *
 * Resolves the session to a bound repo (adopting an on-disk binding, or binding
 * fresh with a new workspace + the convention projects), ensures the requested
 * projects exist by name, then collects the live state (re-keyed IDs, on-disk
 * dirs, token count). Safe to call repeatedly. Presentation — the workflow
 * cheatsheet, gotchas, viewer URL — is layered on by the index.ts handler. */
export function initWorkspace(opts: { dir?: string; workspaceName?: string; projects?: string[] }): InitResult {
  const desired = [...new Set((opts.projects && opts.projects.length ? opts.projects : ['Foundations', 'UI']).map((s) => s.trim()).filter(Boolean))];
  const created: string[] = [];

  // 1. Resolve to a bound session.
  if (!isRepoBound()) {
    // Adopt an existing on-disk binding if the server booted outside the repo
    // (keeps init idempotent in that case); otherwise bind fresh.
    const existing = detectBinding(opts.dir ?? projectStartDir());
    const existingFile = existing ? readWorkspaceFile(existing.dir) : null;
    if (existing && existingFile) {
      setRepoBackend(existing.root, existing.dir);
      loadRepoWorkspace(existingFile);
      loadPersistedCanvases();
      registerRepo(existing.dir);
    } else {
      const root = findRepoRoot(opts.dir ?? projectStartDir());
      const ws = createWorkspace(opts.workspaceName ?? prettifyWorkspaceName(basename(root)));
      for (const name of desired) createProject(ws.id, name);
      const result = bindRepo({ workspaceId: ws.id, dir: opts.dir });
      if (!result.ok) {
        // Roll back the workspace we just created so a failed init leaves no orphan.
        for (const p of listProjects(ws.id)) deleteProject(p.id);
        deleteWorkspace(ws.id);
        return { ok: false, error: result.error };
      }
      created.push(...desired);
    }
  }

  // 2. Bound now — ensure the convention projects exist (by name, idempotent).
  const ws = listWorkspaces()[0];
  if (!ws) return { ok: false, error: 'no workspace after init (unexpected).' };
  const have = new Set(listProjects(ws.id).map((p) => p.name.toLowerCase()));
  for (const name of desired) {
    if (!have.has(name.toLowerCase())) {
      createProject(ws.id, name);
      created.push(name);
      have.add(name.toLowerCase());
    }
  }

  // 3. Collect the live state.
  const backend = getBackend();
  const ds = getWorkspaceDesignSystem(ws.id);
  const tokenCount = ds
    ? Object.keys(ds.colors ?? {}).length + Object.keys(ds.spacing ?? {}).length + Object.keys(ds.radius ?? {}).length + Object.keys(ds.typography ?? {}).length
    : 0;
  return {
    ok: true,
    workspace: { id: ws.id, name: ws.name, canvasDir: backend.kind === 'repo' ? backend.dir : null },
    projects: listProjects(ws.id).map((p) => ({ id: p.id, name: p.name, dir: getProjectDir(p.id) ?? null })),
    projectsCreated: created,
    designSystemTokenCount: tokenCount,
  };
}
