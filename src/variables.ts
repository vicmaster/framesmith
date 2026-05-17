import type { Canvas, DesignVariables, SceneNode } from './types.js';

export function resolveVariables(node: SceneNode, variables: DesignVariables): SceneNode {
  return deepResolve(structuredClone(node), variables);
}

function deepResolve(node: SceneNode, variables: DesignVariables): SceneNode {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'type' || key === 'children') continue;

    if (typeof value === 'string' && value.startsWith('$')) {
      const tokenName = value.slice(1);
      const resolved = lookupToken(tokenName, variables);
      if (resolved !== undefined) {
        (node as unknown as Record<string, unknown>)[key] = resolved;
      }
    }
  }

  if (node.children) {
    node.children = node.children.map((child) => deepResolve(child, variables));
  }

  return node;
}

function lookupToken(name: string, variables: DesignVariables): unknown {
  // Check each category
  if (variables.colors?.[name] !== undefined) return variables.colors[name];
  if (variables.spacing?.[name] !== undefined) return variables.spacing[name];
  if (variables.radius?.[name] !== undefined) return variables.radius[name];
  if (variables.typography?.[name] !== undefined) {
    // For typography, return the fontSize as a simple value
    return variables.typography[name].fontSize;
  }

  // Support dotted paths: colors.primary
  const dotIdx = name.indexOf('.');
  if (dotIdx > 0) {
    const category = name.substring(0, dotIdx) as keyof DesignVariables;
    const key = name.substring(dotIdx + 1);
    const cat = variables[category];
    if (cat && typeof cat === 'object' && key in cat) {
      return (cat as Record<string, unknown>)[key];
    }
  }

  return undefined;
}

export function setVariables(canvas: Canvas, vars: Partial<DesignVariables>): DesignVariables {
  if (vars.colors) canvas.variables.colors = { ...canvas.variables.colors, ...vars.colors };
  if (vars.spacing) canvas.variables.spacing = { ...canvas.variables.spacing, ...vars.spacing };
  if (vars.radius) canvas.variables.radius = { ...canvas.variables.radius, ...vars.radius };
  if (vars.typography) canvas.variables.typography = { ...canvas.variables.typography, ...vars.typography };
  return canvas.variables;
}

export function getVariables(canvas: Canvas): DesignVariables {
  return canvas.variables;
}

/** Phase 9 — merge three layers of design tokens with rightmost winning:
 * canvas.variables overrides project.designSystem overrides workspace.designSystem.
 * Per category, keys are merged (not replaced wholesale), so a canvas can
 * override a single color without losing the workspace's full color palette. */
export function mergeDesignTokens(...layers: Array<DesignVariables | undefined>): DesignVariables {
  const out: DesignVariables = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.colors) out.colors = { ...(out.colors ?? {}), ...layer.colors };
    if (layer.spacing) out.spacing = { ...(out.spacing ?? {}), ...layer.spacing };
    if (layer.radius) out.radius = { ...(out.radius ?? {}), ...layer.radius };
    if (layer.typography) out.typography = { ...(out.typography ?? {}), ...layer.typography };
  }
  return out;
}
