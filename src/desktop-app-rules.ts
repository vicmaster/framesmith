// Phase 31 — the desktop-app rules. Each check lands in the same change as
// the rule id it honours (see DESKTOP_APP_RULES in surfaces.ts).

import type { EvaluationIssue } from './evaluate.js';
import type { SceneNode } from './types.js';
import { DESKTOP_APP_PRIMITIVES } from './primitives.js';
import { windowProfile, DEFAULT_WINDOW, WINDOW_PROFILES, type SurfaceDeclaration } from './surfaces.js';

/** `desktop-app-artboard` (base ruleset, every type). A desktop-app canvas
 * narrower than its window's minimum warns (slice A). A canvas that holds a
 * desktop-app primitive (nav-item, tabs, tree-row, menu-row, property-row)
 * must say it is one (slice B): undeclared warns, an explicit `web` gets an
 * info, an explicit `mobile` warns. The overlay clause lands with the
 * overlay primitives (slice E). Reads the tree with instances expanded. */
export function checkDesktopArtboard(root: SceneNode, surface: SurfaceDeclaration): EvaluationIssue[] {
  if (surface.type !== 'desktop-app') return checkAppPrimitivesDeclared(root, surface);
  const profile = windowProfile(surface.device ?? DEFAULT_WINDOW) ?? WINDOW_PROFILES[DEFAULT_WINDOW];
  const width = typeof root.width === 'number' ? root.width : profile.width;
  if (width >= profile.minWidth) return [];
  return [{
    category: 'structure',
    rule: 'desktop-app-artboard',
    severity: 'warning',
    nodeId: root.id,
    nodeName: root.name,
    message: `This canvas is declared desktop-app but its artboard is ${width}px wide — the desktop-app layouts are built for windows of ${profile.minWidth}px and up.`,
    suggestion: `Resize it: U("document", { width: ${profile.width}, height: ${profile.height} }) — or canvas_set_type({ type: "mobile" }) / ({ type: "web" }) if it is a phone screen or a narrow web page.`,
  }];
}

function firstAppPrimitive(root: SceneNode): SceneNode | undefined {
  if (DESKTOP_APP_PRIMITIVES.has(root.type)) return root;
  for (const c of root.children ?? []) {
    const hit = firstAppPrimitive(c);
    if (hit) return hit;
  }
  return undefined;
}

function checkAppPrimitivesDeclared(root: SceneNode, surface: SurfaceDeclaration): EvaluationIssue[] {
  const hit = firstAppPrimitive(root);
  if (!hit) return [];
  const what = `a ${hit.type}${hit.name ? ` ("${hit.name}")` : ''}`;
  const base = { category: 'structure', rule: 'desktop-app-artboard', nodeId: hit.id, nodeName: hit.name } as const;
  if (surface.source === 'default') {
    return [{
      ...base, severity: 'warning',
      message: `This canvas holds ${what}, a desktop-app primitive, but never declared its type, so it is judged as a web page.`,
      suggestion: 'Declare it: canvas_set_type({ type: "desktop-app" }) for an application screen (a tool you work in), or canvas_set_type({ type: "web" }) if it really is a page you read.',
    }];
  }
  if (surface.type === 'mobile') {
    return [{
      ...base, severity: 'warning',
      message: `This canvas is declared mobile but holds ${what}, a desktop-app primitive built for pointer input and dense windows.`,
      suggestion: 'Use the mobile vocabulary on a phone (list-row, tab-bar, nav-bar, button), or canvas_set_type({ type: "desktop-app" }) if this is an application window.',
    }];
  }
  return [{
    ...base, severity: 'info',
    message: `This canvas is declared web but holds ${what}: an application screen should declare desktop-app so the desktop-app ruleset judges it.`,
    suggestion: 'canvas_set_type({ type: "desktop-app" }) if this is a tool you work in.',
  }];
}
