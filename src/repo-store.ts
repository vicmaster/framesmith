// Phase 10 — repo-bound canvas storage.
//
// When a project tree has a `.canvas/` directory, that directory is the source
// of truth for a whole workspace: `workspace.json` (the binding + the workspace
// design system + the list of projects) and one subdirectory per project
// holding one open-JSON file per canvas (slug-named, full scene graph embedded).
// The global ~/.canvas-mcp store keeps no copy of a bound canvas — a canvas is
// either repo-bound or global, never both, so there is nothing to reconcile.
//
//   .canvas/
//     workspace.json        # workspace + projects[] + flattened design system
//     design-system/
//       design-tokens.json
//     ui/
//       bloom-landing.json
//
// This module is deliberately dependency-light (types only) so scene-graph.ts
// and workspaces.ts can both call into it without an import cycle. Higher-level
// orchestration (which workspace to migrate, how tokens layer) lives in bind.ts.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Canvas, DesignVariables } from './types.js';

export const REPO_DIR_NAME = '.canvas';
export const WORKSPACE_FILE = 'workspace.json';
export const SCHEMA_VERSION = 1;

export interface RepoProjectEntry {
  id: string;
  name: string;
  /** Subdirectory under `.canvas/` holding this project's canvas files. */
  dir: string;
  /** Project-level token overrides (Phase 9 layer above the canvas). */
  designSystem?: DesignVariables;
}

/** Binding metadata persisted to `.canvas/workspace.json`. Carries the
 * workspace design system + per-project overrides so a fresh clone (with empty
 * global state) resolves tokens identically. */
export interface RepoWorkspaceFile {
  schemaVersion: number;
  workspaceId: string;
  workspaceName: string;
  designSystem?: DesignVariables;
  projects: RepoProjectEntry[];
  boundAt: string;
}

export type Backend =
  | { kind: 'global' }
  | { kind: 'repo'; root: string; dir: string };

let backend: Backend = { kind: 'global' };

// id → path of the canvas file relative to `.canvas/` (e.g. `ui/login.json`),
// and projectId → its subdirectory name. Learned on load, assigned on write.
// One repo per server process, so module-level maps are sufficient.
const fileById = new Map<string, string>();
const projectDirById = new Map<string, string>();

export function getBackend(): Backend { return backend; }
export function isRepoBound(): boolean { return backend.kind === 'repo'; }

export function repoDir(): string {
  if (backend.kind !== 'repo') throw new Error('repoDir() called while not repo-bound');
  return backend.dir;
}
export function setRepoBackend(root: string, dir: string): void {
  backend = { kind: 'repo', root, dir };
}
export function setGlobalBackend(): void {
  backend = { kind: 'global' };
}

/** Reset all module state. Test-only — production has one backend per process. */
export function resetRepoState(): void {
  fileById.clear();
  projectDirById.clear();
  backend = { kind: 'global' };
}

// --- Project ↔ subdirectory registry ---
export function registerProjectDir(projectId: string, dir: string): void {
  projectDirById.set(projectId, dir);
}
export function getProjectDir(projectId: string): string | undefined {
  return projectDirById.get(projectId);
}

/** A subdirectory name for a new project, unique among registered projects. */
export function uniqueProjectDir(name: string): string {
  const base = slugify(name);
  const taken = new Set(projectDirById.values());
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}-${n++}`;
  return candidate;
}

// --- Deterministic serialization ---
// Recursively sort object keys so the on-disk JSON is stable across writes and
// diffs cleanly in code review. Arrays keep their order (scene-graph child
// order is meaningful); only object keys are sorted.
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2) + '\n';
}

// --- Slug / filename ---
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'canvas';
}

function uniqueFilename(projectDir: string, name: string): string {
  const base = slugify(name);
  const taken = new Set(
    [...fileById.values()].filter((rel) => dirname(rel) === projectDir).map((rel) => basename(rel)),
  );
  let candidate = `${base}.json`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}-${n++}.json`;
  return candidate;
}

// --- Atomic write (write to a sibling temp file, then rename) ---
function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

// --- workspace.json ---
export function readWorkspaceFile(dir: string): RepoWorkspaceFile | null {
  const p = join(dir, WORKSPACE_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as RepoWorkspaceFile;
  } catch {
    return null;
  }
}

export function writeWorkspaceFile(dir: string, file: RepoWorkspaceFile): void {
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, WORKSPACE_FILE), stableStringify(file));
}

// --- canvas IO (rootDir = the `.canvas/` dir) ---
export function writeCanvasToDir(rootDir: string, canvas: Canvas): void {
  const projectDir = projectDirById.get(canvas.projectId) ?? 'unsorted';
  const targetDir = join(rootDir, projectDir);
  mkdirSync(targetDir, { recursive: true });
  let rel = fileById.get(canvas.id);
  if (!rel) {
    rel = join(projectDir, uniqueFilename(projectDir, canvas.name));
    fileById.set(canvas.id, rel);
  }
  writeAtomic(join(rootDir, rel), stableStringify(canvas));
}

export function removeCanvasFromDir(rootDir: string, id: string): void {
  const rel = fileById.get(id);
  if (!rel) return;
  try {
    const p = join(rootDir, rel);
    if (existsSync(p)) unlinkSync(p);
  } catch {}
  fileById.delete(id);
}

/** Read every canvas file across all registered project subdirectories,
 * rebuilding the id → relative-path map. `projectDirById` must already be
 * populated (from `workspace.json`) before this is called. */
export function loadCanvasesFromDir(rootDir: string): Canvas[] {
  fileById.clear();
  const out: Canvas[] = [];
  for (const projectDir of projectDirById.values()) {
    const abs = join(rootDir, projectDir);
    if (!existsSync(abs)) continue;
    let files: string[];
    try {
      files = readdirSync(abs).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(abs, file), 'utf-8')) as Canvas;
        if (data.id && data.root) {
          fileById.set(data.id, join(projectDir, file));
          out.push(data);
        }
      } catch {}
    }
  }
  return out;
}

// --- Discovery ---
/** Walk up from `startDir` to the filesystem root, returning the binding for
 * the nearest ancestor that contains `.canvas/workspace.json`, else null. The
 * `workspace.json` marker (not a bare `.canvas` dir) is required so an
 * unrelated directory is never mistaken for a binding. */
export function detectBinding(startDir: string): { root: string; dir: string } | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, REPO_DIR_NAME);
    if (existsSync(join(candidate, WORKSPACE_FILE))) return { root: dir, dir: candidate };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The directory we treat as the project root when creating a new binding: the
 * nearest ancestor containing `.git`, else `startDir` itself. */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

/** Where discovery starts. `CANVAS_MCP_PROJECT_DIR` overrides cwd for MCP
 * clients that don't launch the server in the user's project directory. */
export function projectStartDir(): string {
  return process.env.CANVAS_MCP_PROJECT_DIR ?? process.cwd();
}

// --- Repo registry (Slice 2) ---
// The viewer can't scan the filesystem for bound repos, so each binding records
// its `.canvas/` path in a global registry. The viewer reads the registry on
// load and mirrors those repos into its (read-only) gallery.

function dataDir(): string {
  return process.env.CANVAS_MCP_HOME ?? join(homedir(), '.canvas-mcp');
}
function registryPath(): string {
  return join(dataDir(), 'registry.json');
}

/** The `.canvas/` directories of every known bound repo. */
export function readRegistry(): string[] {
  try {
    if (!existsSync(registryPath())) return [];
    const parsed = JSON.parse(readFileSync(registryPath(), 'utf-8')) as { repos?: unknown };
    return Array.isArray(parsed.repos) ? parsed.repos.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Record a bound repo's `.canvas/` dir in the registry (idempotent). Called on
 * bind and whenever a bound server boots, so existing bindings self-register. */
export function registerRepo(canvasDir: string): void {
  try {
    const repos = readRegistry();
    if (repos.includes(canvasDir)) return;
    repos.push(canvasDir);
    mkdirSync(dataDir(), { recursive: true });
    writeAtomic(registryPath(), stableStringify({ repos }));
  } catch (err) {
    process.stderr.write(`Warning: could not update repo registry: ${(err as Error).message}\n`);
  }
}

/** Read a bound repo's canvases without touching module state (backend /
 * fileById / projectDirById). Used by the viewer to mirror repos read-only;
 * never call this on the server's own bound store — use the backend path. */
export function readRepoCanvases(canvasDir: string): Canvas[] {
  const wf = readWorkspaceFile(canvasDir);
  if (!wf) return [];
  const out: Canvas[] = [];
  for (const proj of wf.projects) {
    const abs = join(canvasDir, proj.dir);
    if (!existsSync(abs)) continue;
    let files: string[];
    try {
      files = readdirSync(abs).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(abs, file), 'utf-8')) as Canvas;
        if (data.id && data.root) out.push(data);
      } catch {}
    }
  }
  return out;
}
