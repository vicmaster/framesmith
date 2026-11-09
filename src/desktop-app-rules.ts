// Phase 31 — the desktop-app rules. Each check lands in the same change as
// the rule id it honours (see DESKTOP_APP_RULES in surfaces.ts).

import type { EvaluationIssue } from './evaluate.js';
import type { SceneNode } from './types.js';
import { windowProfile, DEFAULT_WINDOW, WINDOW_PROFILES, type SurfaceDeclaration } from './surfaces.js';

/** `desktop-app-artboard` (base ruleset, every type). Slice A: a desktop-app
 * canvas narrower than its window's minimum warns. The clauses about
 * desktop-app and overlay primitives on other types land with those
 * primitives. */
export function checkDesktopArtboard(root: SceneNode, surface: SurfaceDeclaration): EvaluationIssue[] {
  if (surface.type !== 'desktop-app') return [];
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
