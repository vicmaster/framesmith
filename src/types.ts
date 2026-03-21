export type NodeType = 'frame' | 'text' | 'rectangle' | 'ellipse' | 'image' | 'icon' | 'component' | 'instance' | 'document';

export interface SceneNode {
  id: string;
  type: NodeType;
  name?: string;
  children?: SceneNode[];

  // Layout
  width?: number | string;
  height?: number | string;
  layout?: 'horizontal' | 'vertical' | 'none';
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  wrap?: boolean;

  // Position (when layout is 'none' on parent)
  x?: number;
  y?: number;
  position?: 'absolute' | 'relative';

  // Visual
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number | [number, number, number, number];
  opacity?: number;
  overflow?: 'visible' | 'hidden' | 'auto';
  shadow?: string;

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

export interface Canvas {
  id: string;
  name: string;
  root: SceneNode;
  variables: DesignVariables;
  components: Record<string, SceneNode>;
  createdAt: string;
}
