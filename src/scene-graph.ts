import { nanoid } from 'nanoid';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Canvas, SceneNode } from './types.js';

const store = new Map<string, Canvas>();

// --- Disk persistence ---
const CANVAS_DIR = join(homedir(), '.canvas-mcp', 'canvases');

function ensureDir(): void {
  mkdirSync(CANVAS_DIR, { recursive: true });
}

function persistCanvas(canvas: Canvas): void {
  try {
    ensureDir();
    writeFileSync(join(CANVAS_DIR, `${canvas.id}.json`), JSON.stringify(canvas, null, 2));
  } catch (err) {
    process.stderr.write(`Warning: Could not persist canvas ${canvas.id}: ${(err as Error).message}\n`);
  }
}

function removePersistedCanvas(id: string): void {
  try {
    const filePath = join(CANVAS_DIR, `${id}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {}
}

/** Load all persisted canvases from disk into the in-memory store. */
export function loadPersistedCanvases(): number {
  try {
    ensureDir();
    const files = readdirSync(CANVAS_DIR).filter(f => f.endsWith('.json'));
    let loaded = 0;
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(CANVAS_DIR, file), 'utf-8')) as Canvas;
        if (data.id && data.root) {
          store.set(data.id, data);
          loaded++;
        }
      } catch {}
    }
    if (loaded > 0) {
      process.stderr.write(`Loaded ${loaded} persisted canvas(es) from ${CANVAS_DIR}\n`);
    }
    return loaded;
  } catch {
    return 0;
  }
}

export function createCanvas(name?: string): Canvas {
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

export function listCanvases(): { id: string; name: string; createdAt: string }[] {
  return Array.from(store.values()).map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
  }));
}

export function deleteCanvas(id: string): boolean {
  removePersistedCanvas(id);
  return store.delete(id);
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
