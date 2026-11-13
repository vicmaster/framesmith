// The depth-3 shape hash: one definition for the project roll-up (a shell
// copied across screens) and the desktop-app primary-count rule (a grid of
// same-shaped cards).

import type { SceneNode } from './types.js';

/** Depth-3 shape hash: type + name + child-count tree. Styles deliberately
 * excluded — a copied shell whose active nav item is restyled per screen
 * still matches; a structurally edited copy doesn't (miss it rather than
 * accuse legitimate variation). `names: false` drops names too, for repeats
 * whose copies are renamed per item (a grid of pricing cards). */
export function shapeHash(node: SceneNode, depth = 3, opts: { names?: boolean } = {}): string {
  const part = `${node.type}:${opts.names === false ? '' : node.name ?? ''}:${node.children?.length ?? 0}`;
  if (depth <= 1 || !node.children?.length) return part;
  return `${part}[${node.children.map((c) => shapeHash(c, depth - 1, opts)).join(',')}]`;
}
