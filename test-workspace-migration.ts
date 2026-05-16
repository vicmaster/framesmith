// Smoke for Phase 7 slice 1: workspace/project persistence + canvas migration.
// Pre-Phase-7 canvas files (no `projectId`) must auto-assign to the default
// project at load time, the rewrite is one-shot per canvas, and the default
// workspace/project files must materialize on disk.
//
// Uses CANVAS_MCP_HOME to redirect persistence to a tmp dir so we don't
// pollute the real ~/.canvas-mcp tree.
//
// Usage: npx tsx test-workspace-migration.ts

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'canvas-mcp-test-'));
process.env.CANVAS_MCP_HOME = tmp;

// Import AFTER setting the env var so the modules' first reads see it.
const { loadPersistedCanvases, getCanvas } = await import('./src/scene-graph.js');
const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, getWorkspace, getProject, listWorkspaces, listProjects } = await import('./src/workspaces.js');
const { DEFAULT_WORKSPACE_ID, DEFAULT_PROJECT_ID } = await import('./src/types.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Seed a pre-Phase-7 canvas (no projectId) on disk
const canvasesDir = join(tmp, 'canvases');
mkdirSync(canvasesDir, { recursive: true });
const preMigrationCanvas = {
  id: 'unmigrated-id-1',
  name: 'pre-phase-7-canvas',
  root: { id: 'root-id', type: 'document', children: [] },
  variables: {},
  components: {},
  createdAt: '2026-04-01T00:00:00Z',
  lastModified: '2026-04-01T00:00:00Z',
  // intentionally NO projectId — this is what an old canvas file looks like
};
const preMigrationPath = join(canvasesDir, 'unmigrated-id-1.json');
writeFileSync(preMigrationPath, JSON.stringify(preMigrationCanvas, null, 2));

// Boot order matches src/index.ts
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();

// ---- 1. Defaults materialize on disk + in memory ---------------------------
check('default workspace exists in memory', !!getWorkspace(DEFAULT_WORKSPACE_ID));
check('default project exists in memory', !!getProject(DEFAULT_PROJECT_ID));
check('workspaces.json written to disk', existsSync(join(tmp, 'workspaces.json')));
check('projects.json written to disk', existsSync(join(tmp, 'projects.json')));

const workspacesOnDisk = JSON.parse(readFileSync(join(tmp, 'workspaces.json'), 'utf-8'));
const projectsOnDisk = JSON.parse(readFileSync(join(tmp, 'projects.json'), 'utf-8'));
check('default workspace persisted: name=Personal', workspacesOnDisk[0]?.name === 'Personal' && workspacesOnDisk[0]?.id === DEFAULT_WORKSPACE_ID);
check('default project persisted: name=Untitled, linked to default workspace',
  projectsOnDisk[0]?.name === 'Untitled' && projectsOnDisk[0]?.workspaceId === DEFAULT_WORKSPACE_ID);

// ---- 2. Canvas migration ---------------------------------------------------
const migrated = getCanvas('unmigrated-id-1');
check('pre-Phase-7 canvas was loaded', !!migrated);
check('migrated canvas gained projectId=default-project', migrated?.projectId === DEFAULT_PROJECT_ID);

const reread = JSON.parse(readFileSync(preMigrationPath, 'utf-8'));
check('migrated canvas was rewritten to disk with projectId', reread.projectId === DEFAULT_PROJECT_ID);

// ---- 3. Migration is idempotent --------------------------------------------
// Second load should NOT clobber projectId (already correct) and should NOT
// re-create defaults. Capture mtimes/contents to verify nothing rewrote.
const workspacesContentBefore = readFileSync(join(tmp, 'workspaces.json'), 'utf-8');
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();
const workspacesContentAfter = readFileSync(join(tmp, 'workspaces.json'), 'utf-8');
check('second load: workspaces.json content unchanged (idempotent)', workspacesContentBefore === workspacesContentAfter);
check('second load: still exactly one workspace (no duplicate)', listWorkspaces().length === 1);
check('second load: still exactly one project (no duplicate)', listProjects().length === 1);
const reloadedCanvas = getCanvas('unmigrated-id-1');
check('second load: canvas still has projectId set', reloadedCanvas?.projectId === DEFAULT_PROJECT_ID);

// ---- 4. Canvas already with projectId is untouched -------------------------
const alreadyMigratedPath = join(canvasesDir, 'already-migrated.json');
writeFileSync(alreadyMigratedPath, JSON.stringify({
  id: 'already-migrated',
  name: 'already-migrated',
  root: { id: 'r2', type: 'document', children: [] },
  variables: {}, components: {},
  createdAt: '2026-05-16T00:00:00Z', lastModified: '2026-05-16T00:00:00Z',
  projectId: 'some-custom-project-id',
}, null, 2));
const customContentBefore = readFileSync(alreadyMigratedPath, 'utf-8');
loadPersistedCanvases();
const customContentAfter = readFileSync(alreadyMigratedPath, 'utf-8');
check('already-migrated canvas is NOT rewritten (preserves custom projectId)', customContentBefore === customContentAfter);
check('already-migrated canvas keeps its custom projectId in memory', getCanvas('already-migrated')?.projectId === 'some-custom-project-id');

// ---- Cleanup ---------------------------------------------------------------
rmSync(tmp, { recursive: true, force: true });

process.exit(allPass ? 0 : 1);
