export type NodeType = 'frame' | 'text' | 'rectangle' | 'ellipse' | 'image' | 'icon' | 'component' | 'instance' | 'document' | 'path';

export interface SceneNode {
  id: string;
  type: NodeType;
  name?: string;
  children?: SceneNode[];

  // Layout
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  layout?: 'horizontal' | 'vertical' | 'none';
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  wrap?: boolean;

  // Responsive layout hint. Authored desktop-first; the renderer adapts down.
  //   stack — horizontal layout flips to vertical below the mobile breakpoint
  //   wrap  — children wrap to the next line instead of overflowing
  //   fixed — never reflows (e.g. toolbars). Marker today; reserved for future
  //           opt-out of descendant fluid scaling.
  responsive?: 'stack' | 'wrap' | 'fixed';

  // Position (when layout is 'none' on parent)
  x?: number;
  y?: number;
  position?: 'absolute' | 'relative';

  // Visual
  fill?: string;
  gradient?: {
    type: 'linear' | 'radial';
    angle?: number;
    stops: Array<{ color: string; position?: number }>;
  };
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number | [number, number, number, number];
  opacity?: number;
  overflow?: 'visible' | 'hidden' | 'auto';
  shadow?: string;
  shadows?: Array<{
    x: number; y: number; blur: number; spread?: number;
    color: string; inset?: boolean;
  }>;
  blur?: number;
  backdropBlur?: number;
  /** Composable backdrop filter functions. Each field is numeric:
   * `blur` in px; `saturate`/`brightness`/`contrast` as percentage values
   * where `100` is the identity (`saturate: 180` → `saturate(180%)`).
   * If `backdropFilter` is set it takes precedence over `backdropBlur`. */
  backdropFilter?: {
    blur?: number;
    saturate?: number;
    brightness?: number;
    contrast?: number;
  };

  // Text
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number | string;
  letterSpacing?: number;
  textDecoration?: string;
  textTransform?: string;

  // Image
  src?: string;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';

  // Icon
  icon?: string;
  iconSize?: number;
  iconColor?: string;

  // SVG path (only for type: 'path'). Inherits fill/stroke/strokeWidth from
  // the standard SceneNode fields; viewBox defaults to `0 0 width height`.
  d?: string;
  viewBox?: string;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';

  // CSS animation, referencing a built-in keyframe. The renderer auto-emits
  // the `@keyframes` block only when any node references the name.
  animation?: {
    name: 'fadeIn' | 'slideUp' | 'slideDown' | 'scaleIn';
    duration?: number;   // ms, default 300
    delay?: number;      // ms, default 0
    easing?: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear';
    iteration?: number | 'infinite';
  };

  // CSS transition. Note: transitions only fire on state change (hover, focus,
  // JS-driven property change). Inert in static renders today — included so a
  // future PR that adds pseudo-class or interactive state has a place to land.
  transition?: {
    property?: string;   // e.g. 'all', 'opacity', 'transform'. Identifier chars only.
    duration: number;    // ms
    easing?: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear';
    delay?: number;      // ms
  };

  // Component / Instance
  componentId?: string;
  overrides?: Record<string, Partial<SceneNode>>;
}

export interface DesignVariables {
  colors?: Record<string, string>;
  spacing?: Record<string, number>;
  radius?: Record<string, number>;
  typography?: Record<string, { fontSize: number; fontWeight?: string | number; fontFamily?: string; lineHeight?: number | string }>;
}

/** Custom font face declaration. Renderer emits a single `@font-face` rule
 * per entry plus a `<link rel="preconnect">` per unique origin so the browser
 * can warm the connection before the first font request fires. */
export interface FontFace {
  /** Family name used in `fontFamily` (no quotes). */
  family: string;
  /** Direct binary URL (.woff2/.woff/.ttf/.otf) — `https://`, `http://`, or
   * `data:` URIs are accepted. Stylesheet URLs (e.g. fonts.googleapis.com/css2)
   * are not supported; reference the gstatic.com binary directly. */
  url: string;
  weight?: number | string;
  style?: 'normal' | 'italic';
}

/** Phase 11 — independent taxonomy axes a layout structure is tagged on, so
 * "differs from the last canvas" is a computable set diff, not a vibe. Every
 * structure sets all four; the diversification signal and Phase 13's "variety"
 * rubric axis both read them, so keep the names/values stable. */
export interface StructureAxes {
  heroTreatment: 'none' | 'marquee' | 'split' | 'stat-led' | 'editorial';
  density: 'airy' | 'balanced' | 'dense';
  rhythm: 'uniform' | 'alternating' | 'asymmetric';
  alignment: 'centered' | 'left' | 'split';
}

/** Phase 11 — a named page structure: a partial scene tree of labeled
 * placeholder children plus its taxonomy tags. Distinct from a preset — presets
 * carry tokens/components, structures carry the layout skeleton. Placeholders
 * are labeled neutral blocks (never fabricated data) and reference `$token`s so
 * an applied preset themes them. Registered in `src/structures.ts`. */
export interface Structure {
  name: string;
  description: string;
  axes: StructureAxes;
  /** Placeholder children inserted under `canvas.root` by `apply_structure`. */
  nodes: SceneNode[];
}

/** Phase 11 — provenance stamp recorded on `Canvas.metadata`: which structure /
 * preset / axes produced a canvas. Lives in the open metadata bag so Phases 12
 * (cliche flags) and 13 (rubric verdict) extend it without a further migration. */
export interface Provenance {
  structure?: string;
  preset?: string;
  axes?: Partial<StructureAxes>;
  /** Reserved for a future "pick a structure for me" auto-selector; unused in v1.1. */
  seed?: string;
  /** ISO-8601 timestamp when the stamp was written. */
  at: string;
}

/** Phase 11 — one per-project build-log entry: a provenance record plus the
 * canvas it describes. The diversification signal reads the last N entries to
 * steer the next canvas toward differing on >= 1 axis. */
export interface BuildLogEntry extends Provenance {
  canvasId: string;
  canvasName: string;
}

export interface Canvas {
  id: string;
  name: string;
  root: SceneNode;
  variables: DesignVariables;
  /** Custom font faces emitted into the rendered document head. */
  fonts?: FontFace[];
  components: Record<string, SceneNode>;
  createdAt: string;
  lastModified: string;
  /**
   * Every canvas belongs to exactly one project. On migration, canvases
   * without `projectId` are assigned to the default project (`DEFAULT_PROJECT_ID`).
   */
  projectId: string;
  /** Soft-delete flag. Archived canvases stay in storage but are hidden from
   * the default gallery view. Permadelete is a separate action. */
  archived?: boolean;
  archivedAt?: string;
  /** Phase 11 — open metadata bag. `provenance` records which structure / preset
   * / axes produced this canvas (feeds the per-project build log + diversification
   * signal). Optional, so existing canvases load unchanged with no migration.
   * Phases 12/13 extend this bag (cliche flags, rubric verdict) in place. */
  metadata?: {
    provenance?: Provenance;
    [key: string]: unknown;
  };
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  /** Phase 9 — workspace-level design system inherited by every project +
   * canvas under it. Resolution order at render is canvas.variables (override)
   * → project.designSystem → workspace.designSystem → built-in defaults. */
  designSystem?: DesignVariables;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  /** Phase 9 — project-level overrides on top of the parent workspace's design
   * system. Sits between workspace and canvas in the resolution chain. */
  designSystem?: DesignVariables;
}

/** Stable IDs for the built-in defaults so migration is idempotent. */
export const DEFAULT_WORKSPACE_ID = 'default-workspace';
export const DEFAULT_PROJECT_ID = 'default-project';
