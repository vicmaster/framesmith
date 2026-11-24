// Phase 33 slice A — the viewer's shared CSS. Colours come only from tokens.ts
// (light on :root, dark under prefers-color-scheme), so nothing here holds a
// literal: translucent shades are color-mix() of a token.

import { cachedFontFaces } from '../fonts.js';
import { DARK, LIGHT, RADIUS, SPACING, TYPE_ROLES, VIEWER_FONT_FAMILIES, type ViewerTheme } from './tokens.js';

function themeVars(theme: ViewerTheme): string {
  const colors = Object.entries(theme.colors).map(([name, value]) => `--${name}: ${value};`);
  const shadows = Object.entries(theme.elevation).map(([name, value]) => `--elevation-${name}: ${value};`);
  return [...colors, ...shadows].join(' ');
}

function scaleVars(): string {
  const radius = Object.entries(RADIUS).map(([name, value]) => `--${name}: ${value}px;`);
  const spacing = Object.entries(SPACING).map(([name, value]) => `--${name}: ${value}px;`);
  const type = Object.entries(TYPE_ROLES).map(([role, spec]) => `--font-${role}: ${spec.fontSize}px;`);
  return [...radius, ...spacing, ...type].join(' ');
}

const FALLBACK_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const BODY_FAMILY = TYPE_ROLES.body.fontFamily ?? 'Inter';
const DISPLAY_FAMILY = TYPE_ROLES.title.fontFamily ?? BODY_FAMILY;

/** @font-face rules for the design system's families, from the font cache
 * only (no network at render). A family that is not cached gets no rule and
 * the fallback stack draws it. Read per render so a cache warmed after start
 * is picked up. */
export function fontFaceCss(): string {
  return VIEWER_FONT_FAMILIES.flatMap((family) => cachedFontFaces(family).map((face) =>
    `@font-face { font-family: '${face.family}'; src: url('/assets/fonts/${face.file}') format('woff2'); font-weight: ${face.weight ?? '400'}; font-style: ${face.style ?? 'normal'}; font-display: swap; }`,
  )).join('\n');
}

/** Tokens, reset and base type. Every page injects it first. */
export function baseCss(): string {
  return `
  ${fontFaceCss()}
  :root { color-scheme: light dark; ${themeVars(LIGHT)} ${scaleVars()}
    --font-sans: '${BODY_FAMILY}', ${FALLBACK_STACK};
    --font-display: '${DISPLAY_FAMILY}', '${BODY_FAMILY}', ${FALLBACK_STACK};
    --scrim: color-mix(in srgb, var(--text-primary) 40%, transparent);
    --hover: color-mix(in srgb, var(--text-primary) 6%, transparent);
  }
  @media (prefers-color-scheme: dark) { :root { ${themeVars(DARK)} } }
  ${LEGACY_ALIASES}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg-primary); color: var(--text-primary); font-family: var(--font-sans); font-size: var(--font-body); line-height: 1.5; -webkit-font-smoothing: antialiased; }
  :focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  ${STATE_CHIP_CSS}`;
}

/** The pre-redesign variable names, pointed at the new tokens so page bodies
 * not yet rebuilt (slices B–E) restyle without markup changes. Each later
 * slice stops using them; slice E deletes this block. */
const LEGACY_ALIASES = `
  :root {
    --bg-0: var(--bg-primary); --bg-1: var(--bg-primary);
    --sidebar: var(--bg-surface); --surface: var(--bg-surface);
    --surface-hover: var(--bg-elevated); --surface-elevated: var(--bg-elevated);
    --border-subtle: var(--border); --border-rim: transparent;
    --text-tertiary: var(--text-secondary); --text-muted: var(--text-secondary);
    --accent-deep: var(--accent); --accent-soft: var(--accent);
    --danger-bg: var(--danger-tint); --info: var(--text-secondary);
  }`;

// Phase 24 slice A — state chips: a screen's designed states (default /
// empty / loading / …) cross-linking on cards and the detail toolbar.
const STATE_CHIP_CSS = `
  .state-chips { display: inline-flex; gap: 4px; align-items: center; }
  .state-chip { font-size: 11px; line-height: 1; padding: 4px 8px; border-radius: 999px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border); text-decoration: none; white-space: nowrap; }
  a.state-chip:hover { color: var(--text-primary); border-color: var(--border-strong); }
  .state-chip--active { color: var(--text-primary); border-color: var(--accent); }`;

/** The sidebar (FR-A4), shared by the project and archive pages. */
export const SIDEBAR_CSS = `
  .app { display: flex; min-height: 100vh; }
  .sidebar { width: 240px; flex-shrink: 0; background: var(--bg-surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-lg); padding: var(--space-sm); position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .sidebar-brand { font-size: var(--font-body); font-weight: 600; color: var(--text-primary); padding: var(--space-2xs) var(--space-xs); text-decoration: none; }
  .sidebar-nav { flex: 1; display: flex; flex-direction: column; gap: var(--space-md); }
  .ws-section { display: flex; flex-direction: column; gap: 2px; }
  .ws-name { font-size: var(--font-caption); font-weight: 500; color: var(--text-secondary); padding: 0 var(--space-xs) var(--space-2xs); }
  .ws-empty { font-size: var(--font-label); color: var(--text-secondary); padding: var(--space-2xs) var(--space-xs); }
  .nav-item { position: relative; display: flex; align-items: center; gap: var(--space-xs); height: 32px; padding: 0 var(--space-xs); border-radius: var(--radius-sm); color: var(--text-primary); text-decoration: none; font-size: var(--font-body); font-weight: 500; }
  .nav-item:hover { background: var(--hover); }
  .nav-item[aria-current="page"] { background: var(--accent-tint); font-weight: 600; }
  .nav-item[aria-current="page"]::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; border-radius: 2px; background: var(--accent); }
  .nav-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .nav-icon { width: 16px; height: 16px; flex-shrink: 0; color: var(--text-secondary); }
  .nav-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nav-count { font-size: var(--font-label); color: var(--text-secondary); font-variant-numeric: tabular-nums; }`;

/** The sidebar becomes a drawer at 768px or less (FR-A5). */
export const MOBILE_TOGGLE_CSS = `
  .sidebar-toggle { display: none; }
  .sidebar-backdrop { display: none; }
  @media (max-width: 768px) {
    .sidebar-toggle {
      display: flex; align-items: center; justify-content: center;
      position: fixed; top: 12px; left: 12px;
      width: 36px; height: 36px;
      background: var(--bg-surface); border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      cursor: pointer;
      z-index: 60;
    }
    .sidebar-toggle:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .sidebar {
      position: fixed; top: 0; bottom: 0; left: 0; height: 100vh;
      transform: translateX(-100%);
      transition: transform 0.22s ease;
      z-index: 100;
      box-shadow: var(--elevation-overlay);
    }
    body.sidebar-open .sidebar { transform: translateX(0); }
    .sidebar-backdrop {
      position: fixed; inset: 0;
      background: var(--scrim);
      z-index: 90;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease;
    }
    body.sidebar-open .sidebar-backdrop {
      display: block;
      opacity: 1;
      pointer-events: auto;
    }
    .main-header { padding-left: 64px; }
  }`;

/** Buttons, tabs, menu and dialog (FR-A4). */
export const COMPONENTS_CSS = `
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2xs); height: 32px; padding: 0 var(--space-sm); border-radius: var(--radius-sm); border: 1px solid transparent; background: transparent; color: var(--text-primary); font: inherit; font-size: var(--font-body); font-weight: 500; cursor: pointer; white-space: nowrap; text-decoration: none; }
  .btn svg { width: 16px; height: 16px; flex-shrink: 0; }
  .btn--secondary { background: var(--bg-surface); border-color: var(--border-strong); }
  .btn--secondary:hover, .btn--ghost:hover { background: var(--hover); }
  .btn--primary { background: var(--accent); color: var(--bg-surface); }
  .btn--primary:hover { background: color-mix(in srgb, var(--accent) 88%, var(--text-primary)); }
  .btn--destructive { background: var(--danger); color: var(--bg-surface); }
  .btn--destructive:hover { background: color-mix(in srgb, var(--danger) 88%, var(--text-primary)); }
  .btn--icon { width: 32px; padding: 0; color: var(--text-secondary); }
  .btn[aria-expanded="true"] { background: var(--hover); }

  .tablist { display: flex; gap: var(--space-md); border-bottom: 1px solid var(--border); }
  .tab { position: relative; height: 32px; padding: 0 var(--space-2xs); border: none; background: none; font: inherit; font-size: var(--font-body); font-weight: 500; color: var(--text-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: var(--space-2xs); }
  .tab:hover { color: var(--text-primary); }
  .tab[aria-selected="true"] { color: var(--text-primary); font-weight: 600; }
  .tab[aria-selected="true"]::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--accent); border-radius: 2px; }
  .tab-count { font-size: var(--font-caption); color: var(--text-secondary); background: var(--neutral-tint); border-radius: 999px; padding: 0 6px; font-variant-numeric: tabular-nums; }

  .menu-wrap { position: relative; display: inline-flex; }
  .menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 400; min-width: 220px; padding: var(--space-2xs); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--elevation-floating); display: flex; flex-direction: column; }
  .menu[hidden] { display: none; }
  .menu-item { display: flex; align-items: center; gap: var(--space-xs); height: 32px; padding: 0 var(--space-xs); border: none; background: none; border-radius: var(--radius-sm); font: inherit; font-size: var(--font-body); color: var(--text-primary); cursor: pointer; text-align: left; }
  .menu-item svg { width: 16px; height: 16px; color: var(--text-secondary); }
  .menu-item:hover, .menu-item:focus-visible { background: var(--hover); outline: none; }
  .menu-item--danger, .menu-item--danger svg { color: var(--danger); }
  .menu-sep { height: 1px; background: var(--border); margin: var(--space-2xs) 0; }

  .dialog-scrim { position: fixed; inset: 0; z-index: 500; background: var(--scrim); display: flex; align-items: center; justify-content: center; padding: var(--space-md); }
  .dialog-scrim[hidden] { display: none; }
  .dialog { width: 100%; max-width: 420px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--elevation-overlay); padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); }
  .dialog-title { font-size: var(--font-body); font-weight: 600; }
  .dialog-body { font-size: var(--font-body); color: var(--text-primary); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: var(--space-xs); margin-top: var(--space-xs); }`;
