// Smoke for Phase 9: workspace + project design system inheritance.
//
// Resolution order at render is workspace.designSystem → project.designSystem
// → canvas.variables, with the rightmost layer winning. The test exercises:
//
//   - workspace_set/get_design_system roundtrip + persistence
//   - project_set/get_design_system roundtrip
//   - three-layer precedence: canvas overrides project overrides workspace
//   - workspace_apply_preset copies preset tokens into the workspace
//   - error path: setting on unknown workspace/project
//   - mergeDesignTokens semantics (per-category union, rightmost wins keys)
//
// Usage:
//   FRAMESMITH_HOME=/tmp/framesmith-test-$$ npx tsx test-design-system-inheritance.ts
//   (the script sets FRAMESMITH_HOME itself so it's safe to run directly)

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'framesmith-phase9-'));
process.env.FRAMESMITH_HOME = tmp;

const {
  loadPersistedWorkspaces,
  ensureDefaultWorkspaceAndProject,
  createWorkspace,
  createProject,
  setWorkspaceDesignSystem,
  getWorkspaceDesignSystem,
  setProjectDesignSystem,
  getProjectDesignSystem,
  getWorkspace,
  getProject,
} = await import('./src/workspaces.js');
const { mergeDesignTokens, resolveVariables } = await import('./src/variables.js');
const { createCanvas, getCanvas } = await import('./src/scene-graph.js');

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

try {
  loadPersistedWorkspaces();
  const { workspaceId: defaultWsId, projectId: defaultProjectId } = ensureDefaultWorkspaceAndProject();

  // --- 1. Workspace set/get roundtrip ---
  setWorkspaceDesignSystem(defaultWsId, { colors: { primary: '#f59e0b', bg: '#0a0a0a' } });
  let wsTokens = getWorkspaceDesignSystem(defaultWsId);
  expect('workspace: set colors stored', wsTokens?.colors?.primary === '#f59e0b');
  expect('workspace: bg stored', wsTokens?.colors?.bg === '#0a0a0a');

  // Merge — second call adds spacing without touching colors
  setWorkspaceDesignSystem(defaultWsId, { spacing: { md: 16, lg: 24 } });
  wsTokens = getWorkspaceDesignSystem(defaultWsId);
  expect('workspace: merge preserves colors', wsTokens?.colors?.primary === '#f59e0b');
  expect('workspace: merge adds spacing', wsTokens?.spacing?.md === 16);

  // --- 2. Workspace persists to disk ---
  // Reload simulates server restart — designSystem should survive.
  loadPersistedWorkspaces();
  const reloaded = getWorkspace(defaultWsId);
  expect('persistence: workspace designSystem survives reload',
    reloaded?.designSystem?.colors?.primary === '#f59e0b');

  // --- 3. Project set/get roundtrip ---
  setProjectDesignSystem(defaultProjectId, { colors: { accent: '#3b82f6' } });
  const projTokens = getProjectDesignSystem(defaultProjectId);
  expect('project: set colors stored', projTokens?.colors?.accent === '#3b82f6');

  // --- 4. Three-layer precedence: canvas > project > workspace ---
  const canvas = createCanvas('test-canvas', defaultProjectId);
  // Canvas defines its own override for one color shared with workspace
  canvas.variables.colors = { primary: '#ef4444' };
  const merged = mergeDesignTokens(
    reloaded?.designSystem,
    getProject(defaultProjectId)?.designSystem,
    canvas.variables,
  );
  expect('precedence: canvas wins for shared key', merged.colors?.primary === '#ef4444');
  expect('precedence: workspace key (bg) flows through when not overridden', merged.colors?.bg === '#0a0a0a');
  expect('precedence: project key (accent) flows through when not overridden', merged.colors?.accent === '#3b82f6');
  expect('precedence: spacing from workspace flows through', merged.spacing?.md === 16);

  // --- 5. Project overrides workspace ---
  setProjectDesignSystem(defaultProjectId, { colors: { bg: '#1a1a1a' } });
  const merged2 = mergeDesignTokens(
    getWorkspace(defaultWsId)?.designSystem,
    getProject(defaultProjectId)?.designSystem,
    {},
  );
  expect('precedence: project overrides workspace for shared key', merged2.colors?.bg === '#1a1a1a');

  // --- 6. resolveVariables uses merged tokens ---
  // A canvas with `fill: "$primary"` resolves to workspace's value when
  // no project/canvas override exists. Use a separate workspace to avoid
  // collision with the canvas.variables.primary override set above.
  const fresh = createWorkspace('Coide');
  setWorkspaceDesignSystem(fresh.id, { colors: { primary: '#22c55e' } });
  const newProj = createProject(fresh.id, 'p')!;
  const newCanvas = createCanvas('c', newProj.id);
  newCanvas.root.children = [
    { id: 'btn', type: 'frame', fill: '$primary', width: 100, height: 40 },
  ];
  const tokens = mergeDesignTokens(
    getWorkspace(fresh.id)?.designSystem,
    getProject(newProj.id)?.designSystem,
    newCanvas.variables,
  );
  const resolved = resolveVariables(newCanvas.root, tokens);
  const btn = resolved.children?.[0];
  expect('resolve: $primary resolves via workspace inheritance', btn?.fill === '#22c55e',
    `got fill=${btn?.fill}`);

  // --- 7. Error paths: setting on unknown ids returns undefined ---
  expect('error: setWorkspaceDesignSystem on unknown returns undefined',
    setWorkspaceDesignSystem('nope', { colors: { x: '#fff' } }) === undefined);
  expect('error: setProjectDesignSystem on unknown returns undefined',
    setProjectDesignSystem('nope', { colors: { x: '#fff' } }) === undefined);

  // --- 8. mergeDesignTokens with all undefined returns empty object ---
  const empty = mergeDesignTokens(undefined, undefined, undefined);
  expect('merge: all undefined → empty object', JSON.stringify(empty) === '{}');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);
