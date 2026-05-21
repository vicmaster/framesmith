// Smoke for Phase 10 slice 1: repo-bound canvas storage (workspace-level).
//
// Verifies the source-of-truth model: binding a workspace writes a `.framesmith/`
// dir (workspace.json + one subdirectory per project, one open-JSON file per
// canvas), preserves the workspace/project token layers, drops the global
// copies, routes subsequent writes to the right project subdir, serializes
// deterministically, and round-trips through a simulated restart.
//
// Uses FRAMESMITH_HOME for the global store and a separate tmp dir for the repo.
//
// Usage: npx tsx test-repo-canvases.ts

import { mkdirSync, mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
process.env.FRAMESMITH_HOME = globalHome;

// Import AFTER setting the env var so first reads see it.
const { createCanvas, getCanvas, listCanvases, loadPersistedCanvases } = await import('./src/scene-graph.js');
const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createWorkspace, createProject, setWorkspaceDesignSystem, setProjectDesignSystem, listProjects, getCanvasTokens, loadRepoWorkspace } = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');
const { isRepoBound, detectBinding, readWorkspaceFile, setRepoBackend, resetRepoState, WORKSPACE_FILE } = await import('./src/repo-store.js');
const { setVariables } = await import('./src/variables.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const canvasDir = join(repoRoot, '.framesmith');
const globalCanvases = join(globalHome, 'canvases');

// ---- Boot global, build a workspace with two projects + design layers -------
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();

const ws = createWorkspace('Acme');
setWorkspaceDesignSystem(ws.id, { colors: { brand: '#e94560' } });
const dsProject = createProject(ws.id, 'Design System')!;
const uiProject = createProject(ws.id, 'UI')!;
setProjectDesignSystem(uiProject.id, { colors: { accent: '#0f3460' } });

const tokens = createCanvas('Tokens', dsProject.id);
const bloom = createCanvas('Bloom Landing', uiProject.id);
const login = createCanvas('Login Form', uiProject.id);
setVariables(login, { colors: { local: '#123456' } });

check('three global canvas files exist before bind',
  [tokens, bloom, login].every((c) => existsSync(join(globalCanvases, `${c.id}.json`))));

// ---- Bind the workspace ----------------------------------------------------
const result = bindRepo({ workspaceId: ws.id, dir: repoRoot });
check('bind succeeded', result.ok, result.ok ? '' : result.error);
check('bind reports 2 projects, 3 canvases migrated', result.ok && result.projects === 2 && result.migrated === 3,
  result.ok ? `projects=${result.projects} migrated=${result.migrated}` : '');
check('isRepoBound() is true after bind', isRepoBound());

// workspace.json: schemaVersion + workspace design system + project entries
check('.framesmith/workspace.json exists', existsSync(join(canvasDir, WORKSPACE_FILE)));
const wf = readWorkspaceFile(canvasDir);
check('workspace.json has schemaVersion 1', wf?.schemaVersion === 1, `got ${wf?.schemaVersion}`);
check('workspace.json carries workspace design system', wf?.designSystem?.colors?.brand === '#e94560');
check('workspace.json lists 2 projects with dirs', wf?.projects?.length === 2 && wf.projects.every((p) => !!p.dir));
check('project subdir slugs are design-system + ui',
  JSON.stringify(wf?.projects.map((p) => p.dir).sort()) === JSON.stringify(['design-system', 'ui']));
check('project-level design system preserved on UI', wf?.projects.find((p) => p.dir === 'ui')?.designSystem?.colors?.accent === '#0f3460');

// per-project subdirectories with slug-named canvas files
check('design-system/tokens.json exists', existsSync(join(canvasDir, 'design-system', 'tokens.json')));
check('ui/bloom-landing.json exists', existsSync(join(canvasDir, 'ui', 'bloom-landing.json')));
check('ui/login-form.json exists', existsSync(join(canvasDir, 'ui', 'login-form.json')));

// global copies dropped
check('global canvas files removed after bind',
  [tokens, bloom, login].every((c) => !existsSync(join(globalCanvases, `${c.id}.json`))));

// deterministic serialization: sorted top-level keys + trailing newline
const raw = readFileSync(join(canvasDir, 'ui', 'login-form.json'), 'utf-8');
check('canvas file ends with a trailing newline', raw.endsWith('\n'));
const topKeys = Object.keys(JSON.parse(raw));
check('canvas JSON keys are sorted', JSON.stringify(topKeys) === JSON.stringify([...topKeys].sort()), topKeys.join(','));

// token layering resolves through the virtual workspace + project
const tk = getCanvasTokens(getCanvas(login.id)!);
check('workspace brand token resolves', tk.colors?.brand === '#e94560');
check('project accent token resolves', tk.colors?.accent === '#0f3460');
check('canvas-local token resolves', tk.colors?.local === '#123456');

// ---- New canvas after bind lands in the right project subdir ---------------
const virtualUi = listProjects().find((p) => p.name === 'UI')!;
const settings = createCanvas('Settings', virtualUi.id);
check('new canvas written into ui/ subdir', existsSync(join(canvasDir, 'ui', 'settings.json')));
check('new canvas NOT written to global store', !existsSync(join(globalCanvases, `${settings.id}.json`)));

// ---- Round-trip: simulate a fresh process / clone --------------------------
resetRepoState();
const detected = detectBinding(repoRoot);
check('detectBinding finds the binding at repo root', !!detected && detected.dir === canvasDir);

const sub = join(repoRoot, 'src', 'components');
mkdirSync(sub, { recursive: true });
const nested = detectBinding(sub);
check('detectBinding walks up from a subdirectory', !!nested && nested.dir === canvasDir);

const wf2 = readWorkspaceFile(detected!.dir)!;
setRepoBackend(detected!.root, detected!.dir);
loadRepoWorkspace(wf2);
const count = loadPersistedCanvases();
check('all four canvases reload from disk', count === 4, `count=${count}`);
const names = listCanvases().map((c) => c.name).sort();
check('reloaded canvas names match', JSON.stringify(names) === JSON.stringify(['Bloom Landing', 'Login Form', 'Settings', 'Tokens']), names.join(','));
check('tokens still resolve after reload', getCanvasTokens(getCanvas(login.id)!).colors?.brand === '#e94560');

// no bound-canvas files leaked into the global store
const leftovers = existsSync(globalCanvases) ? readdirSync(globalCanvases).filter((f) => f.endsWith('.json')) : [];
check('global canvases dir holds no bound-canvas files', leftovers.length === 0, leftovers.join(','));

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
