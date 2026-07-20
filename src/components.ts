// Phase 22 slice E (#130) — component ergonomics.
//
// The render machinery for components has existed since v1 (canvas.components
// + resolveInstance in renderer.ts, override-by-child-name), but nothing in
// the authoring surface *created* one from existing work: canvas_evaluate
// scolded "no component instances found" while the only path was hand-building
// a type:"component" node. Two pure operations close the gap:
//   - promoteToComponent: subtree → canvas.components def + an instance node
//     in its place (render-identical — the def keeps the subtree's ids, and
//     resolveInstance stamps the instance id back onto the def root).
//   - copyNodesAcross: deep-copy subtrees into another canvas (or the same
//     one) with re-keyed ids and an idMap, carrying along any component defs
//     the copied trees reference (collision-checked).
// Callers persist (touchCanvas) — same contract as scene-graph.ts.

import { nanoid } from 'nanoid';
import type { Canvas, SceneNode } from './types.js';
import { findNode } from './scene-graph.js';

export interface PromoteResult {
  componentId: string;
  /** The instance now sitting where the subtree was (keeps the original id). */
  instanceId: string;
  name: string;
  /** Named descendants of the def, in document order — the keys `overrides`
   * can target (resolveInstance matches overrides by child `name`). */
  overridableChildren: string[];
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'component';
}

function uniqueComponentId(canvas: Canvas, name: string): string {
  const base = `cmp-${slugify(name)}`;
  if (!canvas.components[base]) return base;
  let n = 2;
  while (canvas.components[`${base}-${n}`]) n++;
  return `${base}-${n}`;
}

function namedDescendants(def: SceneNode): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const walk = (node: SceneNode): void => {
    for (const child of node.children ?? []) {
      if (child.name && !seen.has(child.name)) {
        seen.add(child.name);
        names.push(child.name);
      }
      walk(child);
    }
  };
  walk(def);
  return names;
}

/** Promote an existing subtree to a reusable component: the subtree becomes
 * `canvas.components[componentId]` and an `instance` node takes its place.
 * Render-identical: the def keeps the subtree's node ids and the instance
 * keeps the subtree root's id (resolveInstance stamps it back at render).
 * The def keeps the node's own type (frame etc.) — resolveInstance is
 * type-agnostic and the clone renders exactly as the original did. */
export function promoteToComponent(canvas: Canvas, nodeId: string, name?: string): PromoteResult {
  const result = findNode(canvas.root, nodeId);
  if (!result) throw new Error(`Node "${nodeId}" not found`);
  if (!result.parent) throw new Error('Cannot promote the root node — promote a section frame instead');
  const node = result.node;
  if (node.type === 'instance') throw new Error(`Node "${nodeId}" is already a component instance`);

  const compName = name ?? node.name ?? node.type;
  const componentId = uniqueComponentId(canvas, compName);
  const def = structuredClone(node);
  def.name = compName;
  canvas.components[componentId] = def;

  const instance: SceneNode = { id: node.id, type: 'instance', componentId, name: compName };
  result.parent.children![result.index] = instance;

  return { componentId, instanceId: instance.id, name: compName, overridableChildren: namedDescendants(def) };
}

export interface CopyResult {
  /** Every copied node's source id → its new id in the target canvas. */
  idMap: Record<string, string>;
  /** New ids of the copied subtree roots, in input order. */
  rootIds: string[];
  /** componentIds registered on the target as part of this copy. */
  copiedComponents: string[];
}

function cloneWithMap(node: SceneNode, idMap: Record<string, string>): SceneNode {
  const clone: SceneNode = { ...node, id: nanoid(10) };
  idMap[node.id] = clone.id;
  if (node.children) clone.children = node.children.map((c) => cloneWithMap(c, idMap));
  return clone;
}

/** Deep-copy subtrees from one canvas into another (or the same one) with
 * re-keyed ids. Component defs referenced by the copied trees travel along:
 * missing defs are registered on the target; an id collision with a DIFFERENT
 * def re-keys the incoming one (`<id>-2`, …) and remaps the copied instances;
 * an identical def is shared. Dangling componentIds copy as-is (they render
 * nothing — same as in the source). */
export function copyNodesAcross(source: Canvas, target: Canvas, nodeIds: string[], parentId = 'document', index?: number): CopyResult {
  if (nodeIds.length === 0) throw new Error('nodeIds must be non-empty');
  const parent = parentId === 'document' ? target.root : findNode(target.root, parentId)?.node;
  if (!parent) throw new Error(`Parent node "${parentId}" not found in target canvas`);

  const idMap: Record<string, string> = {};
  const clones: SceneNode[] = [];
  for (const id of nodeIds) {
    const found = findNode(source.root, id);
    if (!found) throw new Error(`Node "${id}" not found in source canvas`);
    clones.push(cloneWithMap(found.node, idMap));
  }

  // Carry referenced component defs across.
  const referenced = new Set<string>();
  const collect = (n: SceneNode): void => {
    if (n.componentId) referenced.add(n.componentId);
    n.children?.forEach(collect);
  };
  clones.forEach(collect);

  const copiedComponents: string[] = [];
  const remap = new Map<string, string>();
  for (const ref of referenced) {
    const def = source.components[ref];
    if (!def) continue;
    const existing = target.components[ref];
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(def)) continue; // identical — share it
      let alt = `${ref}-2`;
      for (let n = 3; target.components[alt]; n++) alt = `${ref}-${n}`;
      target.components[alt] = structuredClone(def);
      remap.set(ref, alt);
      copiedComponents.push(alt);
    } else {
      target.components[ref] = structuredClone(def);
      copiedComponents.push(ref);
    }
  }
  if (remap.size) {
    const rewrite = (n: SceneNode): void => {
      if (n.componentId && remap.has(n.componentId)) n.componentId = remap.get(n.componentId)!;
      n.children?.forEach(rewrite);
    };
    clones.forEach(rewrite);
  }

  if (!parent.children) parent.children = [];
  if (index !== undefined && index >= 0) parent.children.splice(index, 0, ...clones);
  else parent.children.push(...clones);

  return { idMap, rootIds: clones.map((c) => c.id), copiedComponents };
}
