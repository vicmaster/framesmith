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
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
}

/** Stable IDs for the built-in defaults so migration is idempotent. */
export const DEFAULT_WORKSPACE_ID = 'default-workspace';
export const DEFAULT_PROJECT_ID = 'default-project';
