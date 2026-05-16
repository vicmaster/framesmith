// Smoke for Phase 7 slice 2: workspace + project CRUD, canvas lifecycle
// (archive / unarchive / move / delete), and cascade-refusal protections.
// Drives the underlying scene-graph / workspaces functions directly — the
// MCP tool handlers in src/index.ts are thin pass-throughs, covered here by
// proxy. Runs in a tmp dir via CANVAS_MCP_HOME so it doesn't touch the real
// ~/.canvas-mcp tree.
//
// Usage: npx tsx test-workspace-mcp-tools.ts

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'canvas-mcp-test-'));
process.env.CANVAS_MCP_HOME = tmp;

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { DEFAULT_WORKSPACE_ID, DEFAULT_PROJECT_ID } = await import('./src/types.js');

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ---- Workspace CRUD ------------------------------------------------------
{
  const initial = ws.listWorkspaces().length;
  check('workspace: starts with default Personal', initial === 1);

  const created = ws.createWorkspace('Acme Corp');
  check('workspace: create returns new workspace', created.name === 'Acme Corp' && ws.listWorkspaces().length === 2);

  const renamed = ws.renameWorkspace(created.id, 'Acme Inc');
  check('workspace: rename updates name', renamed?.name === 'Acme Inc');

  check('workspace: rename non-existent returns undefined', ws.renameWorkspace('nonexistent', 'X') === undefined);

  check('workspace: delete returns true', ws.deleteWorkspace(created.id) === true);
  check('workspace: list size returns to 1 after delete', ws.listWorkspaces().length === 1);

  check('workspace: delete default REFUSED', ws.deleteWorkspace(DEFAULT_WORKSPACE_ID) === false && ws.getWorkspace(DEFAULT_WORKSPACE_ID) !== undefined);
}

// ---- Project CRUD --------------------------------------------------------
{
  const projCount = ws.listProjects().length;
  check('project: starts with default Untitled', projCount === 1);

  const inDefault = ws.createProject(DEFAULT_WORKSPACE_ID, 'Design System');
  check('project: create in default workspace', !!inDefault && inDefault.name === 'Design System');

  check('project: create with invalid workspaceId returns undefined', ws.createProject('nope', 'Project X') === undefined);

  const renamedProj = ws.renameProject(inDefault!.id, 'Design System v2');
  check('project: rename updates name', renamedProj?.name === 'Design System v2');

  const scoped = ws.listProjects(DEFAULT_WORKSPACE_ID);
  check('project: list scoped to workspace', scoped.length === 2);

  // Second workspace, list scoped should NOT include the project we just made
  const otherWs = ws.createWorkspace('Other');
  check('project: list scoped to a different workspace returns []', ws.listProjects(otherWs.id).length === 0);

  check('project: delete returns true on empty project', ws.deleteProject(inDefault!.id) === true);
  check('project: delete default REFUSED', ws.deleteProject(DEFAULT_PROJECT_ID) === false);

  // cleanup the extra workspace
  ws.deleteWorkspace(otherWs.id);
}

// ---- Canvas creation lands in the right project ---------------------------
{
  const proj = ws.createProject(DEFAULT_WORKSPACE_ID, 'Brand');
  const canvas = sg.createCanvas('logo-mock', proj!.id);
  check('canvas: create with projectId lands in that project', canvas.projectId === proj!.id);

  const defaultCanvas = sg.createCanvas('quick-sketch');
  check('canvas: create without projectId lands in default', defaultCanvas.projectId === DEFAULT_PROJECT_ID);

  // cleanup
  sg.deleteCanvas(canvas.id);
  sg.deleteCanvas(defaultCanvas.id);
  ws.deleteProject(proj!.id);
}

// ---- Canvas lifecycle: archive / unarchive ------------------------------
{
  const c = sg.createCanvas('to-archive');
  check('lifecycle: fresh canvas is not archived', c.archived !== true);

  const archived = sg.archiveCanvas(c.id);
  check('lifecycle: archiveCanvas sets archived=true with timestamp', archived?.archived === true && typeof archived?.archivedAt === 'string');

  // listCanvases reflects the archived flag
  const summary = sg.listCanvases().find((s) => s.id === c.id);
  check('lifecycle: listCanvases summary reports archived=true', summary?.archived === true);

  const unarchived = sg.unarchiveCanvas(c.id);
  check('lifecycle: unarchiveCanvas clears archived flag', unarchived?.archived === false);
  check('lifecycle: unarchiveCanvas clears archivedAt', unarchived?.archivedAt === undefined);

  check('lifecycle: archive non-existent returns undefined', sg.archiveCanvas('nope') === undefined);

  sg.deleteCanvas(c.id);
}

// ---- Canvas lifecycle: move between projects -----------------------------
{
  const projA = ws.createProject(DEFAULT_WORKSPACE_ID, 'A');
  const projB = ws.createProject(DEFAULT_WORKSPACE_ID, 'B');
  const c = sg.createCanvas('travels', projA!.id);
  check('move: starts in project A', c.projectId === projA!.id);

  const moved = sg.moveCanvas(c.id, projB!.id);
  check('move: moveCanvas updates projectId', moved?.projectId === projB!.id);

  const countA = sg.countCanvasesInProject(projA!.id);
  const countB = sg.countCanvasesInProject(projB!.id);
  check('move: count for source project drops, target rises', countA === 0 && countB === 1);

  sg.deleteCanvas(c.id);
  ws.deleteProject(projA!.id);
  ws.deleteProject(projB!.id);
}

// ---- Canvas lifecycle: permanent delete removes disk file ---------------
{
  const c = sg.createCanvas('doomed');
  const expectedPath = join(tmp, 'canvases', `${c.id}.json`);
  check('delete: file exists before delete', existsSync(expectedPath));

  const ok = sg.deleteCanvas(c.id);
  check('delete: returns true', ok === true);
  check('delete: file is removed from disk', !existsSync(expectedPath));
  check('delete: getCanvas returns undefined', sg.getCanvas(c.id) === undefined);
}

// ---- Cascade-refusal: project with canvases cannot be deleted (handler logic) -
{
  // The MCP handler in src/index.ts checks countCanvasesInProject before
  // calling deleteProject. We exercise that count-and-refuse logic directly.
  const proj = ws.createProject(DEFAULT_WORKSPACE_ID, 'Has Canvases');
  const c = sg.createCanvas('blocker', proj!.id);

  const count = sg.countCanvasesInProject(proj!.id);
  check('cascade: count detects 1 canvas in project', count === 1);

  // Even archived canvases block deletion (includeArchived default = true)
  sg.archiveCanvas(c.id);
  check('cascade: count includes archived canvas', sg.countCanvasesInProject(proj!.id) === 1);

  // Once the canvas is gone, project_delete can proceed
  sg.deleteCanvas(c.id);
  check('cascade: count goes to 0 after canvas deleted', sg.countCanvasesInProject(proj!.id) === 0);
  check('cascade: project_delete now succeeds', ws.deleteProject(proj!.id) === true);
}

rmSync(tmp, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
