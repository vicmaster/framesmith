// Regression smoke for the Phase 9 follow-up bug found while dogfooding the
// v0.9.0 design system showcase.
//
// Before this fix: the viewer's `/canvas/:id/html` route called
// resolveVariables(canvas.root, canvas.variables) directly without merging
// workspace + project tokens. A canvas with `cornerRadius: '$lg'` and an
// empty canvas.variables would leave the literal `$lg` string in the node,
// then the renderer crashed with `node.cornerRadius.map is not a function`.
//
// The fix consolidated the merge in workspaces.ts:getCanvasTokens(canvas)
// and switched every render path (MCP tools, viewer, canvas_diff, evaluate)
// to use it.
//
// This test asserts the viewer-style render path now resolves workspace
// tokens correctly when canvas.variables is empty.
//
// Usage: npx tsx test-viewer-resolves-workspace-tokens.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'framesmith-viewer-tokens-'));
process.env.FRAMESMITH_HOME = tmp;

const {
  loadPersistedWorkspaces,
  ensureDefaultWorkspaceAndProject,
  createWorkspace,
  createProject,
  setWorkspaceDesignSystem,
  setProjectDesignSystem,
  getCanvasTokens,
} = await import('./src/workspaces.js');
const { resolveVariables } = await import('./src/variables.js');
const { renderToHtml } = await import('./src/renderer.js');
const { createCanvas } = await import('./src/scene-graph.js');

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

try {
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();

  // --- Setup: workspace with a design system + a canvas under it ---
  const ws = createWorkspace('Coide');
  const proj = createProject(ws.id, 'Brand')!;
  setWorkspaceDesignSystem(ws.id, {
    colors: { primary: '#f59e0b', bg: '#0a0a0a' },
    radius: { lg: 18 },
    spacing: { md: 20 },
  });

  const canvas = createCanvas('design-tokens', proj.id);
  // Intentionally NO canvas.variables — every token must inherit from workspace.
  canvas.root.children = [
    { id: 'card', type: 'frame', fill: '$bg', padding: '$md', cornerRadius: '$lg', width: 400, height: 200 },
  ];

  // --- 1. getCanvasTokens returns the workspace tokens ---
  const tokens = getCanvasTokens(canvas);
  expect('getCanvasTokens: workspace colors flow through', tokens.colors?.primary === '#f59e0b');
  expect('getCanvasTokens: workspace radius flows through', tokens.radius?.lg === 18);

  // --- 2. resolveVariables with merged tokens resolves $names ---
  const resolved = resolveVariables(canvas.root, tokens);
  const card = resolved.children?.[0];
  expect('resolve: $bg → workspace bg color', card?.fill === '#0a0a0a',
    `got fill=${card?.fill}`);
  expect('resolve: $lg → workspace radius value', card?.cornerRadius === 18,
    `got cornerRadius=${card?.cornerRadius}`);
  expect('resolve: $md → workspace spacing value', card?.padding === 20,
    `got padding=${card?.padding}`);

  // --- 3. renderToHtml with resolved tree produces valid CSS (no crash) ---
  let html = '';
  let crashed = false;
  try {
    html = renderToHtml(resolved, 1440, 900, canvas);
  } catch {
    crashed = true;
  }
  expect('render: no crash with workspace-only tokens', !crashed);
  expect('render: border-radius emitted', html.includes('border-radius: 18px'),
    `html slice: ${html.slice(0, 500)}`);
  expect('render: background-color resolved', html.includes('background-color: #0a0a0a'));

  // --- 4. Anti-pattern check: bypassing getCanvasTokens leaves $names raw ---
  // This is the exact behavior that crashed the viewer before the fix.
  const bypassed = resolveVariables(canvas.root, canvas.variables);
  const bypassedCard = bypassed.children?.[0];
  expect('anti-pattern: $lg stays unresolved when bypassing getCanvasTokens',
    bypassedCard?.cornerRadius === '$lg',
    `got cornerRadius=${bypassedCard?.cornerRadius}`);

  // --- 5. Project override takes precedence over workspace ---
  setProjectDesignSystem(proj.id, { colors: { primary: '#3b82f6' } });
  const tokens2 = getCanvasTokens(canvas);
  expect('precedence: project primary overrides workspace primary',
    tokens2.colors?.primary === '#3b82f6');
  expect('precedence: workspace bg flows through (not overridden)',
    tokens2.colors?.bg === '#0a0a0a');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
process.exit(allPass ? 0 : 1);
