// Workspace and project design systems must keep elevation (shadow) tokens.
// The merge behind workspace_set_design_system / project_set_design_system
// copied colors, spacing, radius, typography, dark colors and motion, but not
// `elevation` or `dark.elevation` — and a later dark-colour edit replaced the
// whole dark layer, dropping its elevation. So generate_design_system at
// workspace or project scope lost every $elevation.* token, and screens
// inheriting from that layer rendered their shadows as unresolved refs.
//
// Usage: npx tsx test-design-system-elevation.ts

import './test-env.js';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { createWorkspace, createProject, ensureDefaultWorkspaceAndProject, setWorkspaceDesignSystem, setProjectDesignSystem, getCanvasTokens } from './src/workspaces.js';
import { generateDesignSystem } from './src/design-language.js';
import { resolveVariables } from './src/variables.js';
import type { SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

ensureDefaultWorkspaceAndProject();
const system = generateDesignSystem('#2563EB', 'technical');
const lightNames = Object.keys(system.variables.elevation ?? {});
const darkNames = Object.keys(system.variables.dark?.elevation ?? {});
check('the generator emits light + dark elevation tokens (fixture sanity)', lightNames.length > 0 && darkNames.length > 0, `light=${lightNames} dark=${darkNames}`);
const token = lightNames.includes('raised') ? 'raised' : lightNames[0]; // 'flat' may be shadowless in both themes

/** A canvas in `projectId` whose card uses `$elevation.<token>`; returns the
 * card's resolved shadows in the given theme. A resolved elevation ref moves
 * from `shadow` to the structured `shadows` array; an unresolved one stays
 * behind as the literal "$elevation.…" string on `shadow`. */
function shadowOf(projectId: string, theme: 'light' | 'dark' = 'light') {
  const c = createCanvas('Shadow probe', projectId);
  parseAndExecute(c.root, `card=I("document", { type: "frame", padding: 16, shadow: "$elevation.${token}" })`, c);
  const resolved = resolveVariables(c.root, getCanvasTokens(c), { theme });
  const card = resolved.children?.[0] as SceneNode & { shadow?: unknown; shadows?: unknown };
  return card.shadow !== undefined ? card.shadow : card.shadows;
}

// ---- workspace scope ------------------------------------------------------
{
  const ws = createWorkspace('Elevation WS');
  const p = createProject(ws.id, 'Screens')!;
  const out = setWorkspaceDesignSystem(ws.id, system.variables);
  check('workspace design system keeps elevation', !!out?.elevation?.[token], JSON.stringify(Object.keys(out ?? {})));
  check('workspace design system keeps dark.elevation', !!out?.dark?.elevation?.[token]);
  const light = shadowOf(p.id);
  check('a canvas under the workspace resolves $elevation.* to a shadow (light)', Array.isArray(light), JSON.stringify(light));
  const dark = shadowOf(p.id, 'dark');
  check('…and to the DARK shadow in the dark theme', Array.isArray(dark) && JSON.stringify(dark) !== JSON.stringify(light), JSON.stringify(dark));

  // A later partial edit must not drop what's there.
  setWorkspaceDesignSystem(ws.id, { dark: { colors: { primary: '#60A5FA' } } });
  const after = setWorkspaceDesignSystem(ws.id, { colors: { accent: '#0891B2' } });
  check('a later dark-colour edit keeps dark.elevation', !!after?.dark?.elevation?.[token]);
  check('…and keeps the other dark colours', Object.keys(after?.dark?.colors ?? {}).length > 1 && after?.dark?.colors?.primary === '#60A5FA');
  check('a later colour edit keeps elevation', !!after?.elevation?.[token]);

  // A partial elevation edit merges per token, like every other category.
  const merged = setWorkspaceDesignSystem(ws.id, { elevation: { custom: [{ x: 0, y: 2, blur: 4, color: '#00000033' }] } });
  check('a partial elevation edit adds a token and keeps the rest', !!merged?.elevation?.custom && !!merged?.elevation?.[token]);
}

// ---- project scope --------------------------------------------------------
{
  const ws = createWorkspace('Elevation WS 2');
  const p = createProject(ws.id, 'Screens')!;
  const out = setProjectDesignSystem(p.id, system.variables);
  check('project design system keeps elevation', !!out?.elevation?.[token]);
  check('project design system keeps dark.elevation', !!out?.dark?.elevation?.[token]);
  check('a canvas in the project resolves $elevation.* to a shadow', Array.isArray(shadowOf(p.id)));
}

console.log(allPass ? '\nAll design-system elevation tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
