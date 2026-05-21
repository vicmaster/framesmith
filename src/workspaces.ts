// Phase 7 slice 1: Workspace + Project persistence and CRUD.
//
// Workspaces and Projects each live in a single JSON index file on disk
// (`workspaces.json`, `projects.json`) under the data dir. They're small
// enough that a single-file index is simpler than per-entity files, and it
// makes the listing operation a cheap in-memory map lookup.
//
// MCP tool exposure is deferred to slice 2 — this module is the in-memory
// + on-disk foundation everything else builds on.

import { nanoid } from 'nanoid';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_ID, type Canvas, type DesignVariables, type Project, type Workspace } from './types.js';
import { mergeDesignTokens } from './variables.js';
import { isRepoBound, repoDir, writeProjectFile, type RepoProjectFile } from './repo-store.js';

const workspaces = new Map<string, Workspace>();
const projects = new Map<string, Project>();

// When repo-bound, the single virtual workspace + project come from
// `.canvas/project.json`. We keep the parsed file around so mutations
// (rename, design-system edits) can be written back to it instead of the
// global workspaces.json / projects.json indexes.
let repoProjectFile: RepoProjectFile | null = null;

// `CANVAS_MCP_HOME` lets tests redirect persistence to a tmp dir without
// touching the real ~/.canvas-mcp tree. Resolved per call so an env var set
// after module import (e.g. by a test harness) still takes effect.
function dataDir(): string {
  return process.env.CANVAS_MCP_HOME ?? join(homedir(), '.canvas-mcp');
}
function workspacesPath(): string { return join(dataDir(), 'workspaces.json'); }
function projectsPath(): string { return join(dataDir(), 'projects.json'); }

function ensureDataDir(): void {
  mkdirSync(dataDir(), { recursive: true });
}

function writeAtomic(path: string, content: string): void {
  ensureDataDir();
  writeFileSync(path, content);
}

function persistWorkspaces(): void {
  if (isRepoBound()) { persistRepoProjectFile(); return; }
  try {
    writeAtomic(workspacesPath(), JSON.stringify([...workspaces.values()], null, 2));
  } catch (err) {
    process.stderr.write(`Warning: Could not persist workspaces: ${(err as Error).message}\n`);
  }
}

function persistProjects(): void {
  if (isRepoBound()) { persistRepoProjectFile(); return; }
  try {
    writeAtomic(projectsPath(), JSON.stringify([...projects.values()], null, 2));
  } catch (err) {
    process.stderr.write(`Warning: Could not persist projects: ${(err as Error).message}\n`);
  }
}

/**
 * Load the single virtual workspace + project that back a repo-bound session
 * from a parsed `.canvas/project.json`. The flattened design system lives on
 * the virtual project so `getCanvasTokens` resolves it without a workspace
 * layer. Virtual entries never reach the global indexes — they are written
 * back only via `persistRepoProjectFile`.
 */
export function loadRepoWorkspaceProject(pf: RepoProjectFile): void {
  workspaces.clear();
  projects.clear();
  repoProjectFile = pf;
  workspaces.set(pf.workspaceId, { id: pf.workspaceId, name: pf.workspaceName, createdAt: pf.boundAt });
  projects.set(pf.projectId, {
    id: pf.projectId,
    workspaceId: pf.workspaceId,
    name: pf.projectName,
    createdAt: pf.boundAt,
    designSystem: pf.designSystem,
  });
}

/** Rewrite `.canvas/project.json` from the in-memory virtual workspace +
 * project. There is exactly one of each when bound. A workspace-level design
 * system (if one is ever set while bound) is folded into the flattened
 * snapshot so the file stays self-contained. */
function persistRepoProjectFile(): void {
  if (!isRepoBound() || !repoProjectFile) return;
  const ws = [...workspaces.values()][0];
  const proj = [...projects.values()][0];
  if (ws) repoProjectFile.workspaceName = ws.name;
  if (proj) {
    repoProjectFile.projectName = proj.name;
    repoProjectFile.designSystem = ws?.designSystem
      ? mergeDesignTokens(ws.designSystem, proj.designSystem)
      : proj.designSystem;
  }
  try {
    writeProjectFile(repoDir(), repoProjectFile);
  } catch (err) {
    process.stderr.write(`Warning: Could not persist repo project file: ${(err as Error).message}\n`);
  }
}

/** Load workspaces + projects from disk into memory. Called at server startup. */
export function loadPersistedWorkspaces(): { workspaces: number; projects: number } {
  workspaces.clear();
  projects.clear();
  try {
    if (existsSync(workspacesPath())) {
      const parsed = JSON.parse(readFileSync(workspacesPath(), 'utf-8')) as Workspace[];
      for (const w of parsed) {
        if (w && typeof w.id === 'string') workspaces.set(w.id, w);
      }
    }
  } catch {}
  try {
    if (existsSync(projectsPath())) {
      const parsed = JSON.parse(readFileSync(projectsPath(), 'utf-8')) as Project[];
      for (const p of parsed) {
        if (p && typeof p.id === 'string' && typeof p.workspaceId === 'string') projects.set(p.id, p);
      }
    }
  } catch {}
  return { workspaces: workspaces.size, projects: projects.size };
}

/**
 * Ensure the built-in `Personal` workspace + `Untitled` project exist. Stable
 * IDs (`DEFAULT_WORKSPACE_ID` / `DEFAULT_PROJECT_ID`) make this idempotent —
 * safe to call on every startup, and migration logic can rely on these IDs
 * being valid targets without first checking.
 */
export function ensureDefaultWorkspaceAndProject(): { workspaceId: string; projectId: string } {
  const now = new Date().toISOString();
  let workspaceCreated = false;
  let projectCreated = false;

  if (!workspaces.has(DEFAULT_WORKSPACE_ID)) {
    workspaces.set(DEFAULT_WORKSPACE_ID, { id: DEFAULT_WORKSPACE_ID, name: 'Personal', createdAt: now });
    workspaceCreated = true;
  }
  if (!projects.has(DEFAULT_PROJECT_ID)) {
    projects.set(DEFAULT_PROJECT_ID, { id: DEFAULT_PROJECT_ID, workspaceId: DEFAULT_WORKSPACE_ID, name: 'Untitled', createdAt: now });
    projectCreated = true;
  }
  if (workspaceCreated) persistWorkspaces();
  if (projectCreated) persistProjects();
  return { workspaceId: DEFAULT_WORKSPACE_ID, projectId: DEFAULT_PROJECT_ID };
}

// ---- Workspaces ----

export function createWorkspace(name: string): Workspace {
  const ws: Workspace = { id: nanoid(10), name, createdAt: new Date().toISOString() };
  workspaces.set(ws.id, ws);
  persistWorkspaces();
  return ws;
}

export function getWorkspace(id: string): Workspace | undefined {
  return workspaces.get(id);
}

export function listWorkspaces(): Workspace[] {
  return [...workspaces.values()];
}

export function renameWorkspace(id: string, name: string): Workspace | undefined {
  const ws = workspaces.get(id);
  if (!ws) return undefined;
  ws.name = name;
  persistWorkspaces();
  return ws;
}

export function deleteWorkspace(id: string): boolean {
  if (id === DEFAULT_WORKSPACE_ID) return false; // protect the default
  const had = workspaces.delete(id);
  if (had) persistWorkspaces();
  return had;
}

// ---- Projects ----

export function createProject(workspaceId: string, name: string): Project | undefined {
  if (!workspaces.has(workspaceId)) return undefined;
  const p: Project = { id: nanoid(10), workspaceId, name, createdAt: new Date().toISOString() };
  projects.set(p.id, p);
  persistProjects();
  return p;
}

export function getProject(id: string): Project | undefined {
  return projects.get(id);
}

export function listProjects(workspaceId?: string): Project[] {
  const all = [...projects.values()];
  return workspaceId ? all.filter((p) => p.workspaceId === workspaceId) : all;
}

export function renameProject(id: string, name: string): Project | undefined {
  const p = projects.get(id);
  if (!p) return undefined;
  p.name = name;
  persistProjects();
  return p;
}

export function deleteProject(id: string): boolean {
  if (id === DEFAULT_PROJECT_ID) return false; // protect the default
  const had = projects.delete(id);
  if (had) persistProjects();
  return had;
}

// ---- Phase 9: Design system inheritance ----

/** Set (replace) the workspace-level design system. Merges per-category with
 * the existing designSystem so the caller can supply a partial — e.g. update
 * `colors` without resetting `spacing`. */
export function setWorkspaceDesignSystem(id: string, vars: Partial<DesignVariables>): DesignVariables | undefined {
  const ws = workspaces.get(id);
  if (!ws) return undefined;
  ws.designSystem = mergeDesignSystem(ws.designSystem, vars);
  persistWorkspaces();
  return ws.designSystem;
}

export function getWorkspaceDesignSystem(id: string): DesignVariables | undefined {
  return workspaces.get(id)?.designSystem;
}

export function setProjectDesignSystem(id: string, vars: Partial<DesignVariables>): DesignVariables | undefined {
  const p = projects.get(id);
  if (!p) return undefined;
  p.designSystem = mergeDesignSystem(p.designSystem, vars);
  persistProjects();
  return p.designSystem;
}

export function getProjectDesignSystem(id: string): DesignVariables | undefined {
  return projects.get(id)?.designSystem;
}

function mergeDesignSystem(base: DesignVariables | undefined, patch: Partial<DesignVariables>): DesignVariables {
  const out: DesignVariables = { ...(base ?? {}) };
  if (patch.colors) out.colors = { ...(out.colors ?? {}), ...patch.colors };
  if (patch.spacing) out.spacing = { ...(out.spacing ?? {}), ...patch.spacing };
  if (patch.radius) out.radius = { ...(out.radius ?? {}), ...patch.radius };
  if (patch.typography) out.typography = { ...(out.typography ?? {}), ...patch.typography };
  return out;
}

/**
 * Resolve the effective design tokens for a canvas by walking the
 * `canvas → project → workspace` chain and merging with rightmost wins
 * (`canvas.variables` overrides project, project overrides workspace).
 *
 * Every render path (MCP tools, viewer, evaluate, diff) must use this
 * helper so Phase 9 inheritance is honored end-to-end. Calling
 * `resolveVariables(canvas.root, canvas.variables)` directly bypasses
 * inheritance and leaves `$workspace_token` references unresolved as
 * literal strings, which crashes the renderer with errors like
 * `node.cornerRadius.map is not a function`.
 */
export function getCanvasTokens(canvas: Canvas): DesignVariables {
  const project = projects.get(canvas.projectId);
  const workspace = project ? workspaces.get(project.workspaceId) : undefined;
  return mergeDesignTokens(workspace?.designSystem, project?.designSystem, canvas.variables);
}
