import { nanoid } from 'nanoid';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_PROJECT_ID, type Canvas, type SceneNode } from './types.js';
import { isRepoBound, repoDir, writeCanvasToDir, removeCanvasFromDir, loadCanvasesFromDir, externallyModified, readCanvasFile } from './repo-store.js';

const store = new Map<string, Canvas>();

// --- Disk persistence ---
// `FRAMESMITH_HOME` lets tests redirect persistence to a tmp dir without
// touching the real ~/.framesmith tree. Resolved per call so an env var set
// after module import still takes effect.
function dataDir(): string {
  return process.env.FRAMESMITH_HOME ?? process.env.CANVAS_MCP_HOME ?? join(homedir(), '.framesmith');
}
function canvasDir(): string {
  return join(dataDir(), 'canvases');
}

function ensureDir(): void {
  mkdirSync(canvasDir(), { recursive: true });
}

function persistCanvas(canvas: Canvas): void {
  try {
    if (isRepoBound()) {
      writeCanvasToDir(repoDir(), canvas);
      return;
    }
    ensureDir();
    writeFileSync(join(canvasDir(), `${canvas.id}.json`), JSON.stringify(canvas, null, 2));
  } catch (err) {
    process.stderr.write(`Warning: Could not persist canvas ${canvas.id}: ${(err as Error).message}\n`);
  }
}

function removePersistedCanvas(id: string): void {
  if (isRepoBound()) {
    removeCanvasFromDir(repoDir(), id);
    return;
  }
  purgeGlobalCanvas(id);
}

/** Delete a canvas file from the global ~/.framesmith store regardless of the
 * active backend. Used during bind migration to drop the global copy after the
 * canvas has been written into the repo `.framesmith/` dir. */
export function purgeGlobalCanvas(id: string): void {
  try {
    const filePath = join(canvasDir(), `${id}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {}
}

/**
 * Load all persisted canvases from disk into the in-memory store. Migrates
 * pre-Phase-7 canvases that have no `projectId` by assigning them to the
 * default project (created by `ensureDefaultWorkspaceAndProject` at startup)
 * and rewriting them to disk so the migration is one-shot per canvas.
 */
export function loadPersistedCanvases(): number {
  store.clear();
  if (isRepoBound()) {
    const canvases = loadCanvasesFromDir(repoDir());
    for (const c of canvases) store.set(c.id, c);
    if (canvases.length > 0) {
      process.stderr.write(`Loaded ${canvases.length} repo canvas(es) from ${repoDir()}\n`);
    }
    return canvases.length;
  }
  try {
    ensureDir();
    const files = readdirSync(canvasDir()).filter(f => f.endsWith('.json'));
    let loaded = 0;
    let migrated = 0;
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(canvasDir(), file), 'utf-8')) as Canvas;
        if (data.id && data.root) {
          if (!data.projectId) {
            data.projectId = DEFAULT_PROJECT_ID;
            persistCanvas(data);
            migrated++;
          }
          store.set(data.id, data);
          loaded++;
        }
      } catch {}
    }
    if (loaded > 0) {
      const migratedSuffix = migrated > 0 ? ` (${migrated} migrated to default project)` : '';
      process.stderr.write(`Loaded ${loaded} persisted canvas(es) from ${canvasDir()}${migratedSuffix}\n`);
    }
    return loaded;
  } catch {
    return 0;
  }
}

/** Add canvases to the in-memory store without clearing it (Slice 2). Used by
 * the viewer to mirror repo-bound canvases on top of the global store. These
 * are read-only mirrors — never persisted back through this path. */
export function ingestCanvases(canvases: Canvas[]): void {
  for (const c of canvases) {
    if (c.id && c.root) store.set(c.id, c);
  }
}

export function createCanvas(name?: string, projectId: string = DEFAULT_PROJECT_ID): Canvas {
  const id = nanoid(10);
  const canvas: Canvas = {
    id,
    name: name ?? `Canvas ${store.size + 1}`,
    root: {
      id: nanoid(10),
      type: 'document',
      name: 'Document',
      children: [],
      width: 1440,
      height: 900,
      fill: '#FFFFFF',
    },
    variables: {},
    components: {},
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    projectId,
  };
  store.set(id, canvas);
  persistCanvas(canvas);
  return canvas;
}

export function touchCanvas(canvasId: string): void {
  const canvas = store.get(canvasId);
  if (canvas) {
    canvas.lastModified = new Date().toISOString();
    persistCanvas(canvas);
  }
}

export function getCanvas(id: string): Canvas | undefined {
  return store.get(id);
}

/**
 * When repo-bound, reload a canvas from disk if its file changed externally
 * (git pull / branch switch / hand-edit) since the server last touched it — so
 * the caller mutates the current version instead of clobbering it. If the file
 * was deleted externally, drop it from the store (the caller's not-found path
 * then surfaces a clear error rather than re-creating it). No-op on the global
 * backend. Call this before any mutation + persist.
 */
export function ensureFresh(id: string): void {
  if (!isRepoBound()) return;
  if (!externallyModified(repoDir(), id)) return;
  const fresh = readCanvasFile(repoDir(), id);
  if (fresh) {
    store.set(id, fresh);
    process.stderr.write(`canvas ${id} reloaded from disk (external change detected)\n`);
  } else {
    store.delete(id);
    process.stderr.write(`canvas ${id} removed (deleted on disk externally)\n`);
  }
}

export interface CanvasSummary {
  id: string;
  name: string;
  createdAt: string;
  lastModified: string;
  projectId: string;
  archived: boolean;
}

export function listCanvases(): CanvasSummary[] {
  return Array.from(store.values()).map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    lastModified: c.lastModified,
    projectId: c.projectId,
    archived: c.archived === true,
  }));
}

export function deleteCanvas(id: string): boolean {
  removePersistedCanvas(id);
  return store.delete(id);
}

export function archiveCanvas(id: string): Canvas | undefined {
  ensureFresh(id);
  const canvas = store.get(id);
  if (!canvas) return undefined;
  canvas.archived = true;
  canvas.archivedAt = new Date().toISOString();
  canvas.lastModified = canvas.archivedAt;
  persistCanvas(canvas);
  return canvas;
}

export function unarchiveCanvas(id: string): Canvas | undefined {
  ensureFresh(id);
  const canvas = store.get(id);
  if (!canvas) return undefined;
  canvas.archived = false;
  delete canvas.archivedAt;
  canvas.lastModified = new Date().toISOString();
  persistCanvas(canvas);
  return canvas;
}

export function moveCanvas(id: string, projectId: string): Canvas | undefined {
  ensureFresh(id);
  const canvas = store.get(id);
  if (!canvas) return undefined;
  canvas.projectId = projectId;
  canvas.lastModified = new Date().toISOString();
  persistCanvas(canvas);
  return canvas;
}

/** How many (non-archived) canvases sit in a given project. Used by the
 * project_delete handler to refuse deletion when a project is non-empty. */
export function countCanvasesInProject(projectId: string, includeArchived = true): number {
  let count = 0;
  for (const c of store.values()) {
    if (c.projectId !== projectId) continue;
    if (!includeArchived && c.archived) continue;
    count++;
  }
  return count;
}

export interface FindResult {
  node: SceneNode;
  parent: SceneNode | null;
  index: number;
}

export function findNode(root: SceneNode, id: string): FindResult | null {
  if (root.id === id) return { node: root, parent: null, index: -1 };
  return findNodeRecursive(root, id);
}

function findNodeRecursive(parent: SceneNode, id: string): FindResult | null {
  if (!parent.children) return null;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.id === id) return { node: child, parent, index: i };
    const found = findNodeRecursive(child, id);
    if (found) return found;
  }
  return null;
}

export function insertNode(root: SceneNode, parentId: string, data: Partial<SceneNode> & { type: SceneNode['type'] }): SceneNode {
  const result = findNode(root, parentId);
  if (!result) throw new Error(`Parent node "${parentId}" not found`);
  const parent = result.node;
  if (!parent.children) parent.children = [];

  const node: SceneNode = {
    ...data,
    id: nanoid(10),
  };
  if (['frame', 'document', 'component'].includes(node.type) && !node.children) {
    node.children = [];
  }
  parent.children.push(node);
  return node;
}

export function updateNode(root: SceneNode, nodeId: string, updates: Partial<SceneNode>): SceneNode {
  const result = findNode(root, nodeId);
  if (!result) throw new Error(`Node "${nodeId}" not found`);

  const { id: _id, type: _type, ...safeUpdates } = updates;
  Object.assign(result.node, safeUpdates);
  return result.node;
}

export function deleteNode(root: SceneNode, nodeId: string): void {
  const result = findNode(root, nodeId);
  if (!result) throw new Error(`Node "${nodeId}" not found`);
  if (!result.parent) throw new Error('Cannot delete root node');
  result.parent.children!.splice(result.index, 1);
}

function deepCloneWithNewIds(node: SceneNode, overrides?: Partial<SceneNode>): SceneNode {
  const clone: SceneNode = { ...node, id: nanoid(10), ...overrides };
  if (node.children) {
    clone.children = node.children.map((child) => deepCloneWithNewIds(child));
  }
  return clone;
}

export function copyNode(root: SceneNode, sourceId: string, parentId: string, overrides?: Partial<SceneNode>): SceneNode {
  const sourceResult = findNode(root, sourceId);
  if (!sourceResult) throw new Error(`Source node "${sourceId}" not found`);
  const parentResult = findNode(root, parentId);
  if (!parentResult) throw new Error(`Parent node "${parentId}" not found`);

  const clone = deepCloneWithNewIds(sourceResult.node, overrides);
  if (!parentResult.node.children) parentResult.node.children = [];
  parentResult.node.children.push(clone);
  return clone;
}

export function moveNode(root: SceneNode, nodeId: string, newParentId: string, index?: number): void {
  const result = findNode(root, nodeId);
  if (!result) throw new Error(`Node "${nodeId}" not found`);
  if (!result.parent) throw new Error('Cannot move root node');

  const node = result.node;
  result.parent.children!.splice(result.index, 1);

  const parentResult = findNode(root, newParentId);
  if (!parentResult) throw new Error(`New parent "${newParentId}" not found`);
  if (!parentResult.node.children) parentResult.node.children = [];

  if (index !== undefined && index >= 0) {
    parentResult.node.children.splice(index, 0, node);
  } else {
    parentResult.node.children.push(node);
  }
}

export function replaceNode(root: SceneNode, nodeId: string, newData: Partial<SceneNode>): SceneNode {
  const result = findNode(root, nodeId);
  if (!result) throw new Error(`Node "${nodeId}" not found`);
  if (!result.parent) throw new Error('Cannot replace root node');

  const newNode: SceneNode = {
    ...newData,
    id: nanoid(10),
    type: newData.type ?? result.node.type,
  };
  if (['frame', 'document', 'component'].includes(newNode.type) && !newNode.children) {
    newNode.children = [];
  }
  result.parent.children![result.index] = newNode;
  return newNode;
}
