import type { DesignVariables, SceneNode } from './types.js';

export interface Preset {
  name: string;
  description: string;
  variables: DesignVariables;
  /** Reusable component skeletons (button, card, badge) keyed by slug. */
  components?: Record<string, SceneNode>;
}

const dark: Preset = {
  name: 'dark',
  description: 'Dark theme with blue accent. Dark backgrounds, light text.',
  variables: {
    colors: {
      'bg-primary': '#0a0a0a',
      'bg-surface': '#111111',
      'bg-elevated': '#1a1a1a',
      'text-primary': '#ffffffde',
      'text-secondary': '#ffffffa0',
      'text-muted': '#ffffff4d',
      'accent': '#3b82f6',
      'accent-hover': '#2563eb',
      'border': '#ffffff1a',
      'error': '#ef4444',
      'success': '#22c55e',
      'warning': '#f59e0b',
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 },
    radius: { sm: 4, md: 8, lg: 16, full: 9999 },
    typography: {
      'heading-xl': { fontSize: 36, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.2 },
      'heading-lg': { fontSize: 28, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.3 },
      'heading': { fontSize: 22, fontWeight: 600, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.3 },
      'body': { fontSize: 15, fontWeight: 400, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.5 },
      'body-sm': { fontSize: 13, fontWeight: 400, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.5 },
      'caption': { fontSize: 11, fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.4 },
      'mono': { fontSize: 13, fontWeight: 400, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6 },
    },
  },
};

const light: Preset = {
  name: 'light',
  description: 'Clean light theme with blue accent. White backgrounds, dark text.',
  variables: {
    colors: {
      'bg-primary': '#fafafa',
      'bg-surface': '#f8f9fa',
      'bg-elevated': '#fefefe',
      'text-primary': '#111827',
      'text-secondary': '#4b5563',
      'text-muted': '#9ca3af',
      'accent': '#1d4ed8',
      'accent-hover': '#1e40af',
      'border': '#e5e7eb',
      'error': '#ef4444',
      'success': '#16a34a',
      'warning': '#d97706',
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 },
    radius: { sm: 4, md: 8, lg: 16, full: 9999 },
    typography: {
      'heading-xl': { fontSize: 36, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.2 },
      'heading-lg': { fontSize: 28, fontWeight: 700, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.3 },
      'heading': { fontSize: 22, fontWeight: 600, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.3 },
      'body': { fontSize: 15, fontWeight: 400, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.5 },
      'body-sm': { fontSize: 13, fontWeight: 400, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.5 },
      'caption': { fontSize: 11, fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif', lineHeight: 1.4 },
      'mono': { fontSize: 13, fontWeight: 400, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6 },
    },
  },
};

const material: Preset = {
  name: 'material',
  description: 'Material Design 3 inspired theme. Purple accent, rounded corners.',
  variables: {
    colors: {
      'bg-primary': '#fffbfe',
      'bg-surface': '#f7f2fa',
      'bg-elevated': '#ffffff',
      'text-primary': '#1c1b1f',
      'text-secondary': '#49454f',
      'text-muted': '#79747e',
      'accent': '#6750a4',
      'accent-hover': '#4f378b',
      'border': '#cac4d0',
      'error': '#b3261e',
      'success': '#386a20',
      'warning': '#7d5700',
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 },
    radius: { sm: 8, md: 12, lg: 16, full: 9999 },
    typography: {
      'heading-xl': { fontSize: 36, fontWeight: 400, fontFamily: 'Roboto, system-ui, sans-serif', lineHeight: 1.2 },
      'heading-lg': { fontSize: 28, fontWeight: 400, fontFamily: 'Roboto, system-ui, sans-serif', lineHeight: 1.3 },
      'heading': { fontSize: 22, fontWeight: 500, fontFamily: 'Roboto, system-ui, sans-serif', lineHeight: 1.3 },
      'body': { fontSize: 14, fontWeight: 400, fontFamily: 'Roboto, system-ui, sans-serif', lineHeight: 1.5 },
      'body-sm': { fontSize: 12, fontWeight: 400, fontFamily: 'Roboto, system-ui, sans-serif', lineHeight: 1.5 },
      'caption': { fontSize: 11, fontWeight: 500, fontFamily: 'Roboto, system-ui, sans-serif', lineHeight: 1.4 },
      'mono': { fontSize: 13, fontWeight: 400, fontFamily: 'Roboto Mono, monospace', lineHeight: 1.6 },
    },
  },
};

const minimal: Preset = {
  name: 'minimal',
  description: 'Monochrome minimal theme. Black and white, clean typography.',
  variables: {
    colors: {
      'bg-primary': '#fcfcfc',
      'bg-surface': '#fafafa',
      'bg-elevated': '#fefefe',
      'text-primary': '#0a0a0a',
      'text-secondary': '#404040',
      'text-muted': '#8a8a8a',
      'accent': '#0a0a0a',
      'accent-hover': '#333333',
      'border': '#e0e0e0',
      'error': '#d32f2f',
      'success': '#2e7d32',
      'warning': '#ed6c02',
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 },
    radius: { sm: 2, md: 4, lg: 8, full: 9999 },
    typography: {
      'heading-xl': { fontSize: 40, fontWeight: 300, fontFamily: 'Georgia, serif', lineHeight: 1.2 },
      'heading-lg': { fontSize: 30, fontWeight: 300, fontFamily: 'Georgia, serif', lineHeight: 1.3 },
      'heading': { fontSize: 22, fontWeight: 400, fontFamily: 'Georgia, serif', lineHeight: 1.3 },
      'body': { fontSize: 16, fontWeight: 400, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 },
      'body-sm': { fontSize: 14, fontWeight: 400, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 },
      'caption': { fontSize: 12, fontWeight: 400, fontFamily: 'system-ui, sans-serif', lineHeight: 1.4 },
      'mono': { fontSize: 14, fontWeight: 400, fontFamily: 'Menlo, monospace', lineHeight: 1.6 },
    },
  },
};

const presetMap = new Map<string, Preset>([
  ['dark', dark],
  ['light', light],
  ['material', material],
  ['minimal', minimal],
]);

export function listPresets(): { name: string; description: string }[] {
  return Array.from(presetMap.values()).map(({ name, description }) => ({ name, description }));
}

export function getPreset(name: string): Preset | undefined {
  return presetMap.get(name);
}

export function registerPreset(preset: Preset): void {
  presetMap.set(preset.name, preset);
}
