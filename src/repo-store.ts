// Phase 10 — repo-bound canvas storage.
//
// When a project has a `.canvas/` directory, that directory is the source of
// truth for its canvases: one open-JSON file per canvas (slug-named, full
// scene graph embedded) plus a `project.json` binding file. The global
// ~/.canvas-mcp store holds no competing copy of a bound canvas — a canvas is
// either repo-bound or global, never both, so there is nothing to reconcile.
//
// This module is deliberately dependency-light (types only) so scene-graph.ts
// and workspaces.ts can both call into it without an import cycle. Higher-level
// orchestration (which canvases to migrate, how to flatten tokens) lives in
// index.ts, which has access to the workspace/project getters.

import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Canvas, DesignVariables } from './types.js';

export const REPO_DIR_NAME = '.canvas';
export const PROJECT_FILE = 'project.json';
export const SCHEMA_VERSION = 1;

/** Binding metadata persisted to `.canvas/project.json`. Carries a flattened
 * snapshot of the effective design system so a fresh clone (with empty global
 * state) renders identically — the workspace + project token layers are
 * resolved at write time and folded into `designSystem`. */
export interface RepoProjectFile {
  schemaVersion: number;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  designSystem?: DesignVariables;
  boundAt: string;
}

export type Backend =
  | { kind: 'global' }
  | { kind: 'repo'; root: string; dir: string };

let backend: Backend = { kind: 'global' };

// id → filename within `.canvas/`, learned on load and assigned on first write.
// One repo per server process, so a module-level map is sufficient.
const fileById = new Map<string, string>();

export function getBackend(): Backend { return backend; }
export function isRepoBound(): boolean { return backend.kind === 'repo'; }

export function repoDir(): string {
  if (backend.kind !== 'repo') throw new Error('repoDir() called while not repo-bound');
  return backend.dir;
}
export function repoRoot(): string {
  if (backend.kind !== 'repo') throw new Error('repoRoot() called while not repo-bound');
  return backend.root;
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
  backend = { kind: 'global' };
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

function uniqueFilename(name: string): string {
  const base = slugify(name);
  const taken = new Set(fileById.values());
  let candidate = `${base}.json`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}.json`;
    n++;
  }
  return candidate;
}

// --- Atomic write (write to a sibling temp file, then rename) ---
function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

// --- project.json ---
export function readProjectFile(dir: string): RepoProjectFile | null {
  const p = join(dir, PROJECT_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as RepoProjectFile;
  } catch {
    return null;
  }
}

export function writeProjectFile(dir: string, file: RepoProjectFile): void {
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, PROJECT_FILE), stableStringify(file));
}

// --- canvas IO (dir-explicit so bind migration can target a dir before the
// backend is switched) ---
export function writeCanvasToDir(dir: string, canvas: Canvas): void {
  mkdirSync(dir, { recursive: true });
  let file = fileById.get(canvas.id);
  if (!file) {
    file = uniqueFilename(canvas.name);
    fileById.set(canvas.id, file);
  }
  writeAtomic(join(dir, file), stableStringify(canvas));
}

export function removeCanvasFromDir(dir: string, id: string): void {
  const file = fileById.get(id);
  if (!file) return;
  try {
    const p = join(dir, file);
    if (existsSync(p)) unlinkSync(p);
  } catch {}
  fileById.delete(id);
}

/** Read every `*.json` (except `project.json`) in `dir`, rebuilding the
 * id → filename map. The full scene graph lives in each file, so a fresh clone
 * reconstructs the store from disk with no global state. */
export function loadCanvasesFromDir(dir: string): Canvas[] {
  fileById.clear();
  const out: Canvas[] = [];
  if (!existsSync(dir)) return out;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== PROJECT_FILE);
  } catch {
    return out;
  }
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Canvas;
      if (data.id && data.root) {
        fileById.set(data.id, file);
        out.push(data);
      }
    } catch {}
  }
  return out;
}

// --- Discovery ---
/** Walk up from `startDir` to the filesystem root, returning the binding for
 * the nearest ancestor that contains `.canvas/project.json`, else null. The
 * `project.json` marker (not a bare `.canvas` dir) is required so an unrelated
 * directory is never mistaken for a binding. */
export function detectBinding(startDir: string): { root: string; dir: string } | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, REPO_DIR_NAME);
    if (existsSync(join(candidate, PROJECT_FILE))) return { root: dir, dir: candidate };
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
