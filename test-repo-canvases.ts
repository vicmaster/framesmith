// Smoke for Phase 10 slice 1: repo-bound canvas storage.
//
// Verifies the source-of-truth model: binding a project writes a `.canvas/`
// dir (one open-JSON file per canvas + project.json with a flattened design
// system), drops the global copies, routes subsequent writes to the repo,
// serializes deterministically, and round-trips through a simulated restart.
//
// Uses CANVAS_MCP_HOME for the global store and a separate tmp dir for the repo.
//
// Usage: npx tsx test-repo-canvases.ts

import { mkdirSync, mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'canvas-mcp-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'canvas-mcp-repo-'));
process.env.CANVAS_MCP_HOME = globalHome;

// Import AFTER setting the env var so first reads see it.
const { createCanvas, getCanvas, listCanvases, loadPersistedCanvases } = await import('./src/scene-graph.js');
const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, setWorkspaceDesignSystem, listProjects, getCanvasTokens, loadRepoWorkspaceProject } = await import('./src/workspaces.js');
const { DEFAULT_WORKSPACE_ID, DEFAULT_PROJECT_ID } = await import('./src/types.js');
const { bindRepo } = await import('./src/bind.js');
const { isRepoBound, detectBinding, readProjectFile, setRepoBackend, resetRepoState, PROJECT_FILE } = await import('./src/repo-store.js');
const { setVariables } = await import('./src/variables.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const canvasDir = join(repoRoot, '.canvas');
const globalCanvases = join(globalHome, 'canvases');

// ---- Boot global, seed a design system + two canvases -----------------------
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();

setWorkspaceDesignSystem(DEFAULT_WORKSPACE_ID, { colors: { brand: '#e94560' } });

const c1 = createCanvas('Login Form', DEFAULT_PROJECT_ID);
const c2 = createCanvas('Pricing Page', DEFAULT_PROJECT_ID);
setVariables(c1, { colors: { local: '#0f3460' } });

check('two global canvas files exist before bind',
  existsSync(join(globalCanvases, `${c1.id}.json`)) && existsSync(join(globalCanvases, `${c2.id}.json`)));

// ---- Bind ------------------------------------------------------------------
const result = bindRepo({ projectId: DEFAULT_PROJECT_ID, dir: repoRoot });
check('bind succeeded', result.ok, result.ok ? '' : result.error);
check('bind reports both canvases migrated', result.ok && result.migrated === 2, result.ok ? `migrated=${result.migrated}` : '');
check('isRepoBound() is true after bind', isRepoBound());

// project.json: schemaVersion + flattened design system
check('.canvas/project.json exists', existsSync(join(canvasDir, PROJECT_FILE)));
const pf = readProjectFile(canvasDir);
check('project.json has schemaVersion 1', pf?.schemaVersion === 1, `got ${pf?.schemaVersion}`);
check('project.json flattens workspace design system', pf?.designSystem?.colors?.brand === '#e94560', `got ${pf?.designSystem?.colors?.brand}`);
check('project.json carries a virtual project id', !!pf && pf.projectId.startsWith('repo-proj-'));

// global copies dropped
check('global canvas files removed after bind',
  !existsSync(join(globalCanvases, `${c1.id}.json`)) && !existsSync(join(globalCanvases, `${c2.id}.json`)));

// slug-named per-canvas files written into the repo
check('slug filename login-form.json exists', existsSync(join(canvasDir, 'login-form.json')));
check('slug filename pricing-page.json exists', existsSync(join(canvasDir, 'pricing-page.json')));

// deterministic serialization: sorted top-level keys + trailing newline
const raw = readFileSync(join(canvasDir, 'login-form.json'), 'utf-8');
check('canvas file ends with a trailing newline', raw.endsWith('\n'));
const topKeys = Object.keys(JSON.parse(raw));
check('canvas JSON keys are sorted', JSON.stringify(topKeys) === JSON.stringify([...topKeys].sort()), topKeys.join(','));

// canvases retargeted to the virtual project + tokens resolve through it
const reloaded1 = getCanvas(c1.id)!;
check('canvas reassigned to virtual project', reloaded1.projectId === pf!.projectId, reloaded1.projectId);
const tokens1 = getCanvasTokens(reloaded1);
check('flattened brand token resolves after bind', tokens1.colors?.brand === '#e94560');
check('canvas-local token still resolves after bind', tokens1.colors?.local === '#0f3460');

// ---- New canvas after bind lands in the repo, not global -------------------
const virtualProjectId = listProjects()[0].id;
const c3 = createCanvas('Settings', virtualProjectId);
check('new canvas written into .canvas/', existsSync(join(canvasDir, 'settings.json')));
check('new canvas NOT written to global store', !existsSync(join(globalCanvases, `${c3.id}.json`)));

// ---- Round-trip: simulate a fresh process / clone --------------------------
resetRepoState();
const detected = detectBinding(repoRoot);
check('detectBinding finds the binding at repo root', !!detected && detected.dir === canvasDir);

// auto-detect should also work from a nested subdirectory (walk-up)
const sub = join(repoRoot, 'src', 'components');
mkdirSync(sub, { recursive: true });
const detectedNested = detectBinding(sub);
check('detectBinding walks up from a subdirectory', !!detectedNested && detectedNested.dir === canvasDir);

// boot sequence a fresh server would run
const pf2 = readProjectFile(detected!.dir)!;
setRepoBackend(detected!.root, detected!.dir);
loadRepoWorkspaceProject(pf2);
const count = loadPersistedCanvases();
check('all three canvases reload from disk', count === 3, `count=${count}`);
const names = listCanvases().map((c) => c.name).sort();
check('reloaded canvas names match', JSON.stringify(names) === JSON.stringify(['Login Form', 'Pricing Page', 'Settings']), names.join(','));
check('tokens still resolve after reload', getCanvasTokens(getCanvas(c1.id)!).colors?.brand === '#e94560');

// no stray files were written to the global store during the whole run
const globalLeftovers = existsSync(globalCanvases) ? readdirSync(globalCanvases).filter((f) => f.endsWith('.json')) : [];
check('global canvases dir holds no bound-canvas files', globalLeftovers.length === 0, globalLeftovers.join(','));

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
