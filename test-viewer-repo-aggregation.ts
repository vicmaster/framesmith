// Smoke for Phase 10 slice 2: viewer aggregation (global + registered repos).
//
// Binding a workspace registers its `.canvas/` in registry.json and removes the
// emptied source workspace from the global indexes. The viewer's aggregation
// loader then shows the global store PLUS every registered repo — without a
// duplicate empty shell for the bound workspace.
//
// Usage: npx tsx test-viewer-repo-aggregation.ts

import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'canvas-mcp-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'canvas-mcp-repo-'));
process.env.CANVAS_MCP_HOME = globalHome;

const { createCanvas, listCanvases, loadPersistedCanvases, getCanvas } = await import('./src/scene-graph.js');
const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createWorkspace, createProject, setWorkspaceDesignSystem, listWorkspaces, listProjects, getCanvasTokens } = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');
const { resetRepoState, readRegistry } = await import('./src/repo-store.js');
const { loadGlobalAndRegisteredRepos } = await import('./src/aggregate.js');
const { DEFAULT_PROJECT_ID } = await import('./src/types.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ---- Boot global; one global canvas stays in Personal -----------------------
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();
createCanvas('Scratch', DEFAULT_PROJECT_ID);

// ---- A separate workspace gets bound into the repo -------------------------
const ws = createWorkspace('Acme');
setWorkspaceDesignSystem(ws.id, { colors: { brand: '#e94560' } });
const ui = createProject(ws.id, 'UI')!;
const bloom = createCanvas('Bloom', ui.id);

const result = bindRepo({ workspaceId: ws.id, dir: repoRoot });
check('bind succeeded', result.ok, result.ok ? '' : result.error);

// registry records the repo
const reg = readRegistry();
check('registry.json lists the repo .canvas dir', reg.includes(join(repoRoot, '.canvas')), reg.join(','));
check('registry.json exists on disk', existsSync(join(globalHome, 'registry.json')));

// ---- Simulate the viewer process: global backend, aggregate ---------------
resetRepoState();
const agg = loadGlobalAndRegisteredRepos();
check('aggregation reports 1 repo, 1 canvas', agg.repos === 1 && agg.canvases === 1, `repos=${agg.repos} canvases=${agg.canvases}`);

// gallery shows both the global and the repo canvas
const names = listCanvases().map((c) => c.name).sort();
check('gallery includes both global + repo canvases', JSON.stringify(names) === JSON.stringify(['Bloom', 'Scratch']), names.join(','));

// sidebar shows Personal + Acme, with NO duplicate empty Acme shell
const wsNames = listWorkspaces().map((w) => w.name).sort();
check('workspaces are Personal + Acme (no duplicate)', JSON.stringify(wsNames) === JSON.stringify(['Acme', 'Personal']), wsNames.join(','));
const acme = listWorkspaces().find((w) => w.name === 'Acme')!;
check('the Acme workspace shown is the repo (virtual) one', acme.id.startsWith('repo-ws-'), acme.id);
check('Acme UI project is present', listProjects(acme.id).some((p) => p.name === 'UI'));

// tokens resolve through the mirrored repo workspace
check('repo workspace token resolves in viewer', getCanvasTokens(getCanvas(bloom.id)!).colors?.brand === '#e94560');

// ---- A dead registry entry is skipped gracefully --------------------------
const { registerRepo } = await import('./src/repo-store.js');
registerRepo(join(repoRoot, 'does-not-exist', '.canvas'));
resetRepoState();
const agg2 = loadGlobalAndRegisteredRepos();
check('dead registry entry skipped (still 1 repo)', agg2.repos === 1, `repos=${agg2.repos}`);

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
