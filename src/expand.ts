// Phase 32 slice B — one tree. The renderer and every rule read the canvas
// through this module: each instance is expanded into the component tree it
// renders (overrides applied), and only then are design tokens resolved, so
// what a check judges inside a component is exactly what the render draws.
//
// Ids: a node inside an instance gets the instance path as a prefix
// (`<instanceId>/<childId>`, nesting as `<outer>/<inner>/<childId>`), so two
// instances of one component never share an id. The instance's own root keeps
// the instance id. Stored ids never contain "/", so the first segment of an
// expanded id is always the outermost instance, which exists in the stored
// tree and is what a finding or a comment on the node is reported on.
import type { Canvas, DesignVariables, SceneNode } from './types.js';
import { resolveVariables } from './variables.js';

export interface ExpandedTree {
  /** The tree with every resolvable instance expanded; resolved when tokens
   * were given. */
  root: SceneNode;
  /** Expanded id → the outermost instance (a stored node) that holds it. The
   * instance roots themselves are not in the map. */
  owners: Map<string, SceneNode>;
}

/** Expand every instance, then resolve tokens (when given) over the whole
 * tree. Without tokens the tree stays raw: `$refs` as authored. */
export function expandTree(
  root: SceneNode,
  canvas: Canvas,
  tokens?: DesignVariables,
  opts?: { theme?: 'light' | 'dark' },
): ExpandedTree {
  const owners = new Map<string, SceneNode>();
  const walk = (node: SceneNode, owner: SceneNode | undefined, prefix: string): SceneNode => {
    const id = owner ? prefix + node.id : node.id;
    if (owner) owners.set(id, owner);
    const resolved = node.type === 'instance' && node.componentId ? resolveInstance(node, canvas) : null;
    const source = resolved ?? node;
    const out: SceneNode = { ...source, id };
    if (source.children) {
      // Inside an instance, children take its path; elsewhere the current one.
      const [childOwner, childPrefix] = resolved ? [owner ?? node, `${prefix}${node.id}/`] : [owner, prefix];
      out.children = source.children.map((c) => walk(c, childOwner, childPrefix));
    }
    return out;
  };
  const expanded = walk(root, undefined, '');
  return { root: tokens ? resolveVariables(expanded, tokens, opts) : expanded, owners };
}

/** Whether a tree still holds an instance this canvas can expand. */
export function hasInstances(root: SceneNode, canvas: Canvas): boolean {
  if (root.type === 'instance' && root.componentId && canvas.components[root.componentId]) return true;
  return (root.children ?? []).some((c) => hasInstances(c, canvas));
}

/** The stored node an expanded id belongs to: the outermost instance for a
 * node inside one, else the id itself. */
export function storedId(id: string): string {
  const at = id.indexOf('/');
  return at < 0 ? id : id.slice(0, at);
}

/** One instance as the tree it renders: a clone of its component with the
 * instance's id, its own props laid over the component root, and its named
 * child overrides applied. Null when the component does not exist. */
export function resolveInstance(instance: SceneNode, canvas: Canvas): SceneNode | null {
  const component = canvas.components[instance.componentId!];
  if (!component) return null;

  const clone = structuredClone(component);
  clone.id = instance.id;

  // Instance-level props override the component root.
  const { type: _, id: _id, componentId: _cid, overrides: _ov, children: _ch, ...rootOverrides } = instance;
  Object.assign(clone, rootOverrides);

  if (instance.overrides) applyOverrides(clone, instance.overrides);
  return clone;
}

/** Named child overrides, matched by node name anywhere in the clone. */
function applyOverrides(node: SceneNode, overrides: Record<string, Partial<SceneNode>>): void {
  if (node.name && overrides[node.name]) {
    const { type: _, id: _id, children: _ch, ...props } = overrides[node.name];
    Object.assign(node, props);
  }
  for (const child of node.children ?? []) applyOverrides(child, overrides);
}
