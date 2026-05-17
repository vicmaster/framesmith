export type NodeType = 'frame' | 'text' | 'rectangle' | 'ellipse' | 'image' | 'icon' | 'component' | 'instance' | 'document';

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
