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
import { DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_ID, type Project, type Workspace } from './types.js';

const workspaces = new Map<string, Workspace>();
const projects = new Map<string, Project>();

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
  try {
    writeAtomic(workspacesPath(), JSON.stringify([...workspaces.values()], null, 2));
  } catch (err) {
    process.stderr.write(`Warning: Could not persist workspaces: ${(err as Error).message}\n`);
  }
}

function persistProjects(): void {
  try {
    writeAtomic(projectsPath(), JSON.stringify([...projects.values()], null, 2));
  } catch (err) {
    process.stderr.write(`Warning: Could not persist projects: ${(err as Error).message}\n`);
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
