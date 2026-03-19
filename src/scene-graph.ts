import { nanoid } from 'nanoid';
import type { Canvas, SceneNode } from './types.js';

const store = new Map<string, Canvas>();

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
    createdAt: new Date().toISOString(),
  };
  store.set(id, canvas);
  return canvas;
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
  if (['frame', 'document'].includes(node.type) && !node.children) {
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
  if (['frame', 'document'].includes(newNode.type) && !newNode.children) {
    newNode.children = [];
  }
  result.parent.children![result.index] = newNode;
  return newNode;
}
