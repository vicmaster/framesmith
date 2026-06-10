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

  applyControlDefaults(node, variables);

  if (node.children) {
    node.children = node.children.map((child) => deepResolve(child, variables));
  }

  return node;
}

// Phase 16 — input primitives default their colors from the design system
// (the structures token vocabulary) AFTER explicit $refs resolve, so an
// unthemed canvas still renders (neutral fallbacks — same never-crash rule as
// structure scaffolds) and a themed one picks up the brand automatically.
// Explicit fill / stroke / color on the node always wins.
const CONTROL_FALLBACK = { accent: '#2563EB', border: '#D1D5DB', surface: '#FFFFFF', text: '#111827' } as const;

function applyControlDefaults(node: SceneNode, v: DesignVariables): void {
  const t = node.type;
  if (t !== 'toggle' && t !== 'checkbox' && t !== 'radio' && t !== 'select') return;

  const accent = v.colors?.accent ?? v.colors?.primary ?? CONTROL_FALLBACK.accent;
  const border = v.colors?.border ?? CONTROL_FALLBACK.border;

  if (node.disabled && node.opacity === undefined) node.opacity = 0.5;

  if (t === 'toggle') {
    // fill = track color; the knob is always white.
    if (node.fill === undefined) node.fill = node.checked ? accent : border;
  } else if (t === 'checkbox') {
    // fill = box background (transparent when unchecked so dark surfaces work).
    if (node.fill === undefined) node.fill = node.checked ? accent : 'transparent';
    if (node.stroke === undefined) node.stroke = node.checked ? accent : border;
  } else if (t === 'radio') {
    // stroke = ring, fill = dot (drawn only when checked).
    if (node.stroke === undefined) node.stroke = node.checked ? accent : border;
    if (node.fill === undefined) node.fill = accent;
  } else {
    // select
    if (node.fill === undefined) node.fill = v.colors?.['bg-surface'] ?? v.colors?.surface ?? CONTROL_FALLBACK.surface;
    if (node.stroke === undefined) node.stroke = border;
    if (node.color === undefined) node.color = v.colors?.['text-primary'] ?? CONTROL_FALLBACK.text;
  }
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

export interface PresetApplyResult {
  variables: DesignVariables;
  /** Tokens left to inheritance instead of being overwritten by the preset. */
  preserved: Array<{ category: string; key: string; kept: string; preset: string }>;
}

/** Apply a preset's tokens to a canvas WITHOUT silently clobbering tokens the
 * canvas only resolves through inheritance (workspace / project design system).
 *
 * A preset writes to the canvas layer, which wins over inheritance — so a key
 * the canvas doesn't set itself but inherits would silently diverge from the
 * design system (e.g. preset `md: 16` shadowing a workspace `md: 12`). Those are
 * preserved (left to inheritance) and reported. Keys that are new everywhere, or
 * already set on the canvas's own layer, are written normally. */
export function applyPresetTokens(
  canvas: Canvas,
  presetVars: Partial<DesignVariables>,
  inherited: DesignVariables,
): PresetApplyResult {
  const preserved: PresetApplyResult['preserved'] = [];
  const cats = ['colors', 'spacing', 'radius', 'typography'] as const;
  for (const cat of cats) {
    const pv = presetVars[cat];
    if (!pv) continue;
    if (!canvas.variables[cat]) (canvas.variables as Record<string, unknown>)[cat] = {};
    const own = canvas.variables[cat] as Record<string, unknown>;
    const inh = (inherited[cat] ?? {}) as Record<string, unknown>;
    for (const [key, val] of Object.entries(pv)) {
      const hasOwn = own[key] !== undefined;
      const inhVal = inh[key];
      if (!hasOwn && inhVal !== undefined && !tokenEquals(inhVal, val)) {
        preserved.push({ category: cat, key, kept: fmtToken(cat, inhVal), preset: fmtToken(cat, val) });
        continue;
      }
      own[key] = val;
    }
  }
  return { variables: canvas.variables, preserved };
}

function tokenEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function fmtToken(cat: string, val: unknown): string {
  if (cat === 'typography' && val && typeof val === 'object' && 'fontSize' in (val as object)) {
    return `${(val as { fontSize: number }).fontSize}px`;
  }
  return String(val);
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
