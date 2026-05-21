// Phase 10 — bind orchestration.
//
// Creating a `.canvas/` binding spans three layers (repo IO, the workspace /
// project model, and the canvas store), so it lives in its own module rather
// than in index.ts — keeping it importable by the smoke test without booting
// the MCP server. None of the layers below import this file, so there is no
// import cycle.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import {
  isRepoBound, getBackend, projectStartDir, findRepoRoot, setRepoBackend,
  writeProjectFile, writeCanvasToDir, SCHEMA_VERSION, type RepoProjectFile,
} from './repo-store.js';
import { getProject, getWorkspace, loadRepoWorkspaceProject } from './workspaces.js';
import { listCanvases, getCanvas, purgeGlobalCanvas, loadPersistedCanvases } from './scene-graph.js';
import { mergeDesignTokens } from './variables.js';
import { DEFAULT_PROJECT_ID } from './types.js';

export type BindResult =
  | { ok: true; root: string; dir: string; workspace: string; project: string; migrated: number }
  | { ok: false; error: string };

/** Create a `.canvas/` binding in the project directory, migrate a project's
 * canvases into it, and switch the live session to the repo backend. */
export function bindRepo(opts: { projectId?: string; dir?: string }): BindResult {
  if (isRepoBound()) {
    const b = getBackend();
    return { ok: false, error: `Already bound to a repo at ${b.kind === 'repo' ? b.dir : '(unknown)'}.` };
  }
  const start = opts.dir ?? projectStartDir();
  const root = findRepoRoot(start);
  const dir = join(root, '.canvas');
  if (existsSync(join(dir, 'project.json'))) {
    return { ok: false, error: `A .canvas/ binding already exists at ${dir}. Restart the server in this directory to use it.` };
  }
  const srcProjectId = opts.projectId ?? DEFAULT_PROJECT_ID;
  const srcProject = getProject(srcProjectId);
  if (!srcProject) return { ok: false, error: `Project "${srcProjectId}" not found. Use project_list to see available projects.` };
  const srcWs = getWorkspace(srcProject.workspaceId);

  // Flatten the effective design system at bind time so a fresh clone renders
  // identically without any global workspace/project state.
  const flattened = mergeDesignTokens(srcWs?.designSystem, srcProject.designSystem);
  const now = new Date().toISOString();
  const pf: RepoProjectFile = {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: `repo-ws-${nanoid(8)}`,
    workspaceName: srcWs?.name ?? 'Repo',
    projectId: `repo-proj-${nanoid(8)}`,
    projectName: srcProject.name,
    designSystem: Object.keys(flattened).length ? flattened : undefined,
    boundAt: now,
  };

  // Snapshot the canvases to migrate before switching backend.
  const toMigrate = listCanvases()
    .filter((c) => c.projectId === srcProjectId)
    .map((c) => getCanvas(c.id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  writeProjectFile(dir, pf);
  for (const canvas of toMigrate) {
    canvas.projectId = pf.projectId;
    writeCanvasToDir(dir, canvas);
    purgeGlobalCanvas(canvas.id);
  }

  // Switch the live session to the repo and reload the store from disk.
  setRepoBackend(root, dir);
  loadRepoWorkspaceProject(pf);
  loadPersistedCanvases();

  return { ok: true, root, dir, workspace: pf.workspaceName, project: pf.projectName, migrated: toMigrate.length };
}
