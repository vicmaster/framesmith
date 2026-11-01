import type { Canvas, DesignVariables, SceneNode, ShadowSpec } from './types.js';

export function resolveVariables(node: SceneNode, variables: DesignVariables, opts?: { theme?: 'light' | 'dark' }): SceneNode {
  // Phase 25 slice D — dark is a sparse override layer: merge it over colors
  // and resolve exactly as light does. Theme is a pure RENDER/EVALUATE
  // parameter, never canvas state (versionHash and drift baselines must not
  // fork on it).
  const effective = opts?.theme === 'dark' && (variables.dark?.colors || variables.dark?.elevation)
    ? {
        ...variables,
        colors: { ...variables.colors, ...variables.dark?.colors },
        elevation: { ...variables.elevation, ...variables.dark?.elevation },
      }
    : variables;
  return deepResolve(structuredClone(node), effective);
}

const NESTED_TOKEN_PROPS = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;

function deepResolve(node: SceneNode, variables: DesignVariables): SceneNode {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'type' || key === 'children') continue;

    if (typeof value === 'string' && value.startsWith('$')) {
      const tokenName = value.slice(1);
      // Phase 25 slice A (FR-A1) — a typography token referenced from
      // fontSize applies its FULL spec (size + weight/family/lineHeight/
      // letterSpacing), not just the size. Explicit node props always win —
      // only gaps are filled. This retires the long-documented quirk where
      // declaring a type system only half-applied it.
      const typo = key === 'fontSize' ? variables.typography?.[tokenName] : undefined;
      if (typo) {
        node.fontSize = typo.fontSize;
        if (node.fontWeight === undefined && typo.fontWeight !== undefined) node.fontWeight = typo.fontWeight;
        if (node.fontFamily === undefined && typo.fontFamily !== undefined) node.fontFamily = typo.fontFamily;
        if (node.lineHeight === undefined && typo.lineHeight !== undefined) node.lineHeight = typo.lineHeight;
        if (node.letterSpacing === undefined && typo.letterSpacing !== undefined) node.letterSpacing = typo.letterSpacing;
        continue;
      }
      const resolved = lookupToken(tokenName, variables);
      if (resolved !== undefined) {
        // Phase 27 — an elevation ref on `shadow` resolves to the structured
        // shadows array (the renderer's plural path); explicit `shadows` wins.
        if (key === 'shadow' && Array.isArray(resolved)) {
          if (node.shadows === undefined) node.shadows = resolved as ShadowSpec[];
          delete node.shadow;
          continue;
        }
        (node as unknown as Record<string, unknown>)[key] = resolved;
      }
    }
  }

  // Phase 27 slice B — padding / cornerRadius arrays can mix numbers with
  // "$space-*" / "$radius-*" refs; resolve each entry.
  for (const key of ['padding', 'cornerRadius'] as const) {
    const arr = node[key];
    if (Array.isArray(arr)) {
      (node as unknown as Record<string, unknown>)[key] = arr.map((entry) => {
        if (typeof entry !== 'string' || !entry.startsWith('$')) return entry;
        const resolved = lookupToken(entry.slice(1), variables);
        return resolved !== undefined ? resolved : entry;
      });
    }
  }

  // Phase 22 slice A — object-valued props hold colors the top-level walk
  // above can't see. Resolve $refs one level in (extend this list when a new
  // structured prop carries tokens).
  for (const key of NESTED_TOKEN_PROPS) {
    const obj = node[key];
    if (obj && typeof obj === 'object' && typeof obj.color === 'string' && obj.color.startsWith('$')) {
      const resolved = lookupToken(obj.color.slice(1), variables);
      if (resolved !== undefined) obj.color = resolved as string;
    }
  }
  // Phase 22 slice F — chart series carry their own stroke colors.
  if (Array.isArray(node.series)) {
    for (const s of node.series) {
      if (s && typeof s.stroke === 'string' && s.stroke.startsWith('$')) {
        const resolved = lookupToken(s.stroke.slice(1), variables);
        if (resolved !== undefined) s.stroke = resolved as string;
      }
    }
  }
  // Phase 28 slice B — donut segments carry their own colors ($chart-* refs).
  if (Array.isArray(node.segments)) {
    for (const s of node.segments) {
      if (s && typeof s.color === 'string' && s.color.startsWith('$')) {
        const resolved = lookupToken(s.color.slice(1), variables);
        if (resolved !== undefined) s.color = resolved as string;
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
  if (t === 'skeleton') {
    // Phase 24 slice B — loading placeholder: a themed canvas picks up its
    // own border tone (or an explicit `skeleton` token); unthemed canvases
    // get a translucent neutral that reads on light AND dark surfaces.
    if (node.fill === undefined) node.fill = v.colors?.skeleton ?? v.colors?.border ?? 'rgba(127, 127, 127, 0.22)';
    return;
  }
  if (MOBILE_PRIMITIVES.has(t)) { applyPrimitiveDefaults(node, v); return; }
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

// Phase 30 slice D — the mobile primitives default the same way: tokens when
// the canvas has them, neutral fallbacks when it doesn't, explicit props win.
const MOBILE_PRIMITIVES = new Set(['status-bar', 'home-indicator', 'nav-bar', 'tab-bar', 'button', 'list-row', 'sheet']);

function applyPrimitiveDefaults(node: SceneNode, v: DesignVariables): void {
  const c = v.colors ?? {};
  const accent = c.accent ?? c.primary ?? CONTROL_FALLBACK.accent;
  const border = c.border ?? CONTROL_FALLBACK.border;
  const surface = c['bg-surface'] ?? c.surface ?? CONTROL_FALLBACK.surface;
  const text = c['text-primary'] ?? CONTROL_FALLBACK.text;
  const secondary = c['text-secondary'] ?? '#6B7280';
  const danger = c.danger ?? c.error ?? '#DC2626';
  const set = <K extends keyof SceneNode>(key: K, value: SceneNode[K]) => { if (node[key] === undefined) node[key] = value; };
  if (node.disabled && node.opacity === undefined) node.opacity = 0.5;

  switch (node.type) {
    case 'status-bar':
    case 'home-indicator':
      set('color', text);
      break;
    case 'nav-bar':
      set('color', text);
      set('iconColor', accent);
      break;
    case 'tab-bar':
      set('fill', surface);
      set('stroke', border);
      set('iconColor', accent);
      set('color', secondary);
      set('badgeColor', danger);
      break;
    case 'list-row':
      set('color', text);
      set('secondaryColor', secondary);
      set('iconColor', accent);
      set('stroke', border);
      break;
    case 'sheet':
      set('fill', surface);
      set('stroke', border);
      if (node.cornerRadius === undefined) node.cornerRadius = v.radius?.['radius-lg'] ?? 12;
      break;
    case 'button': {
      const variant = node.variant;
      if (variant === 'secondary') {
        set('fill', 'transparent');
        set('stroke', border);
        set('color', text);
      } else if (variant === 'ghost') {
        set('fill', 'transparent');
        set('color', accent);
      } else {
        set('fill', variant === 'destructive' ? danger : accent);
        set('color', onFill(node.fill));
      }
      if (node.cornerRadius === undefined) node.cornerRadius = v.radius?.['radius-md'] ?? 8;
      break;
    }
  }
}

/** White or near-black (#111827), whichever contrasts more with a hex fill. */
function onFill(fill: string | undefined): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill ?? '');
  if (!m) return '#FFFFFF';
  const lum = (hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => {
      const ch = parseInt(hex.slice(i, i + 2), 16) / 255;
      return ch <= 0.03928 ? ch / 12.92 : ((ch + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l = lum(m[1]);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (lum('111827') + 0.05) ? '#FFFFFF' : '#111827';
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
  if (vars.dark?.colors || vars.dark?.elevation) {
    canvas.variables.dark = {
      ...(canvas.variables.dark?.colors || vars.dark?.colors ? { colors: { ...canvas.variables.dark?.colors, ...vars.dark?.colors } } : {}),
      ...(canvas.variables.dark?.elevation || vars.dark?.elevation ? { elevation: { ...canvas.variables.dark?.elevation, ...vars.dark?.elevation } } : {}),
    };
  }
  if (vars.motion) canvas.variables.motion = { ...canvas.variables.motion, ...vars.motion };
  if (vars.elevation) canvas.variables.elevation = { ...canvas.variables.elevation, ...vars.elevation };
  return canvas.variables;
}

export function getVariables(canvas: Canvas): DesignVariables {
  return canvas.variables;
}

export interface PresetApplyResult {
  variables: DesignVariables;
  /** Tokens left to inheritance instead of being overwritten by the preset.
   * `filledFromPreset` names the sub-fields the preset contributed to a
   * partially-specified token (Phase 29 FR-B1) — when present, the canvas got a
   * MERGED value rather than pure inheritance. */
  preserved: Array<{ category: string; key: string; kept: string; preset: string; filledFromPreset?: string[] }>;
}

export interface PresetApplyOptions {
  /** Phase 29 FR-B3 — write every preset token, ignoring inheritance. A caller
   * asking for a whole new design language usually means it. */
  preserveInherited?: boolean;
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
  options: PresetApplyOptions = {},
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
      if (options.preserveInherited === false || hasOwn || inhVal === undefined || tokenEquals(inhVal, val)) {
        own[key] = val;
        continue;
      }

      // Phase 29 FR-B1 — a token is not all-or-nothing. An inherited typography
      // token that carries only a size ({ fontSize: 13 }) used to shadow the
      // preset's whole spec, so the role kept the inherited size AND silently
      // lost the personality's fontFamily/weight/tracking — it still resolved,
      // so nothing errored, and the text rendered in the fallback stack. Merge
      // field-wise instead: inherited fields win, the preset fills the gaps.
      const merged = mergeTokenFields(inhVal, val);
      if (merged) {
        own[key] = merged.value;
        preserved.push({ category: cat, key, kept: fmtToken(cat, inhVal), preset: fmtToken(cat, val), filledFromPreset: merged.filled });
        continue;
      }

      preserved.push({ category: cat, key, kept: fmtToken(cat, inhVal), preset: fmtToken(cat, val) });
    }
  }
  return { variables: canvas.variables, preserved };
}

/** Field-wise merge of a partially-specified inherited token over a fully
 * specified preset one. Inherited fields win (the design system set them on
 * purpose); the preset contributes only what inheritance left undefined.
 * Returns null when there is nothing to contribute — the inherited token is
 * complete, or either side isn't a plain object — so the caller falls back to
 * plain preservation. */
function mergeTokenFields(inhVal: unknown, presetVal: unknown): { value: Record<string, unknown>; filled: string[] } | null {
  if (!isPlainRecord(inhVal) || !isPlainRecord(presetVal)) return null;
  const filled = Object.keys(presetVal).filter((f) => inhVal[f] === undefined);
  if (filled.length === 0) return null;
  return { value: { ...presetVal, ...inhVal }, filled };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tokenEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function fmtToken(cat: string, val: unknown): string {
  if (cat === 'typography' && val && typeof val === 'object' && 'fontSize' in (val as object)) {
    const fs = (val as { fontSize: number | string }).fontSize;
    return typeof fs === 'number' ? `${fs}px` : String(fs);
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
    if (layer.dark?.colors || layer.dark?.elevation) {
      out.dark = {
        ...(out.dark?.colors || layer.dark?.colors ? { colors: { ...(out.dark?.colors ?? {}), ...layer.dark?.colors } } : {}),
        ...(out.dark?.elevation || layer.dark?.elevation ? { elevation: { ...(out.dark?.elevation ?? {}), ...layer.dark?.elevation } } : {}),
      };
    }
    if (layer.motion) out.motion = { ...(out.motion ?? {}), ...layer.motion };
    if (layer.elevation) out.elevation = { ...(out.elevation ?? {}), ...layer.elevation };
  }
  return out;
}
