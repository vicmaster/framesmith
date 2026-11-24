// Phase 33 slice A — the viewer's design tokens, copied from the "Viewer redesign"
// project's design system (.framesmith/workspace.json). The design is the source:
// test/unit/test-viewer-tokens.ts fails when these drift from it. This is the only
// file under src/viewer/ allowed to hold colour literals.

export const VIEWER_DESIGN_PROJECT = { id: '3tm2S1pJhP', name: 'Viewer redesign' } as const;

export type ColorToken =
  | 'bg-primary'
  | 'bg-surface'
  | 'bg-elevated'
  | 'text-primary'
  | 'text-secondary'
  | 'border'
  | 'border-strong'
  | 'accent'
  | 'accent-tint'
  | 'neutral-tint'
  | 'warning'
  | 'warning-tint'
  | 'danger'
  | 'danger-tint'
  | 'success'
  | 'success-tint'
  | 'focus-ring'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5';

export type ElevationToken = 'flat' | 'raised' | 'floating' | 'overlay';

export interface ViewerTheme {
  colors: Record<ColorToken, string>;
  elevation: Record<ElevationToken, string>;
}

export interface TypeRole { fontFamily?: string; fontSize: number; fontWeight?: number; lineHeight?: number; letterSpacing?: number }

export const LIGHT: ViewerTheme = {
  colors: {
    'bg-primary': "#F6F6F5",
    'bg-surface': "#FFFFFF",
    'bg-elevated': "#F0F0EE",
    'text-primary': "#1D1D1C",
    'text-secondary': "#5F5F5C",
    'border': "#E2E2DF",
    'border-strong': "#8A8A86",
    'accent': "#BB5915",
    'accent-tint': "#FFF2EC",
    'neutral-tint': "#EFEFED",
    'warning': "#956300",
    'warning-tint': "#FFEFDB",
    'danger': "#BC4A41",
    'danger-tint': "#FFF2F0",
    'success': "#007F38",
    'success-tint': "#DAF8DF",
    'focus-ring': "#BB5915",
    'chart-1': "#C36120",
    'chart-2': "#8D8300",
    'chart-3': "#009861",
    'chart-4': "#0090A6",
    'chart-5': "#5D79D6",
  },
  elevation: {
    'flat': "0px 1px 2px 0px rgba(16, 24, 40, 0.05)",
    'floating': "0px 4px 6px -2px rgba(16, 24, 40, 0.06), 0px 12px 16px -4px rgba(16, 24, 40, 0.11)",
    'overlay': "0px 8px 10px -4px rgba(16, 24, 40, 0.06), 0px 20px 25px -5px rgba(16, 24, 40, 0.14)",
    'raised': "0px 1px 2px 0px rgba(16, 24, 40, 0.06), 0px 2px 4px -1px rgba(16, 24, 40, 0.08)",
  },
};

export const DARK: ViewerTheme = {
  colors: {
    'bg-primary': "#121212",
    'bg-surface': "#1A1A19",
    'bg-elevated': "#222221",
    'text-primary': "#EDEDEB",
    'text-secondary': "#A2A29E",
    'border': "#2C2C2A",
    'border-strong': "#76766F",
    'accent': "#E98B55",
    'accent-tint': "#3A2214",
    'neutral-tint': "#262625",
    'warning': "#D5A052",
    'warning-tint': "#3E2909",
    'danger': "#FB8276",
    'danger-tint': "#46221E",
    'success': "#52B76D",
    'success-tint': "#17351F",
    'focus-ring': "#D47033",
    'chart-1': "#D77336",
    'chart-2': "#A19500",
    'chart-3': "#1BAC71",
    'chart-4': "#00A4BD",
    'chart-5': "#6E8CEB",
  },
  elevation: {
    'flat': "0px 1px 2px 0px rgba(0, 0, 0, 0.2)",
    'floating': "0px 4px 6px -2px rgba(0, 0, 0, 0.24), 0px 12px 16px -4px rgba(0, 0, 0, 0.44)",
    'overlay': "0px 8px 10px -4px rgba(0, 0, 0, 0.24), 0px 20px 25px -5px rgba(0, 0, 0, 0.56)",
    'raised': "0px 1px 2px 0px rgba(0, 0, 0, 0.24), 0px 2px 4px -1px rgba(0, 0, 0, 0.32)",
  },
};

export const RADIUS = {
  'radius-lg': 14,
  'radius-md': 10,
  'radius-sm': 6,
} as const;

export const SPACING = {
  'space-2xl': 48,
  'space-2xs': 4,
  'space-3xl': 64,
  'space-3xs': 2,
  'space-lg': 24,
  'space-md': 16,
  'space-sm': 12,
  'space-xl': 32,
  'space-xs': 8,
} as const;

export const TYPE_ROLES: Record<'display' | 'title' | 'heading' | 'body' | 'label' | 'caption', TypeRole> = {
  'display': {"fontFamily": "Space Grotesk", "fontSize": 34, "fontWeight": 600, "letterSpacing": -1, "lineHeight": 1.2},
  'title': {"fontFamily": "Space Grotesk", "fontSize": 27, "fontWeight": 600, "letterSpacing": -0.5, "lineHeight": 1.35},
  'heading': {"fontFamily": "Space Grotesk", "fontSize": 22, "fontWeight": 600, "lineHeight": 1.35},
  'body': {"fontFamily": "Inter", "fontSize": 14, "lineHeight": 1.5},
  'label': {"fontFamily": "Inter", "fontSize": 12, "fontWeight": 500, "letterSpacing": 0.25, "lineHeight": 1.5},
  'caption': {"fontFamily": "Inter", "fontSize": 11, "lineHeight": 1.5},
};

/** The font families the roles name, in the order the viewer loads them. */
export const VIEWER_FONT_FAMILIES = [...new Set(Object.values(TYPE_ROLES).map((r) => r.fontFamily).filter((f): f is string => !!f))];

/** An elevation level as the design system stores it, written as a CSS
 *  box-shadow — the form this file holds and the drift test compares. */
export function toBoxShadow(layers: Array<{ x: number; y: number; blur: number; spread: number; color: string }>): string {
  return layers.map((s) => `${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`).join(', ');
}
