// Smoke for Phase 10 slice 3: external-change safety.
//
// When repo-bound, a canvas file can change under the running server (git pull,
// branch switch, hand-edit). Before mutating, the server must reload the fresh
// version (never clobber it); if the file was deleted, drop it from the store;
// and workspace.json from a newer schema must still read best-effort.
//
// Usage: npx tsx test-repo-external-change.ts

import { mkdtempSync, writeFileSync, unlinkSync, utimesSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'canvas-mcp-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'canvas-mcp-repo-'));
process.env.CANVAS_MCP_HOME = globalHome;

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');
const repo = await import('./src/repo-store.js');
const { setVariables } = await import('./src/variables.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const canvasDir = join(repoRoot, '.canvas');
const bump = (p: string) => utimesSync(p, new Date(Date.now() + 5000), new Date(Date.now() + 5000));

// ---- Bind a workspace with one canvas ---------------------------------------
ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();
const w = ws.createWorkspace('Acme');
const ui = ws.createProject(w.id, 'UI')!;
const c = sg.createCanvas('Login Form', ui.id);
check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);

const file = join(canvasDir, 'ui', 'login-form.json');
check('canvas file exists on disk', existsSync(file));
check('not externally modified right after bind', repo.externallyModified(canvasDir, c.id) === false);

// ---- A: external edit is detected and reloaded before mutation --------------
const disk = JSON.parse(readFileSync(file, 'utf-8'));
disk.name = 'Login (edited externally)';
writeFileSync(file, JSON.stringify(disk, null, 2));
bump(file);
check('externallyModified detects the edit', repo.externallyModified(canvasDir, c.id) === true);
sg.ensureFresh(c.id);
check('ensureFresh reloaded the external name', sg.getCanvas(c.id)?.name === 'Login (edited externally)');
check('not modified again right after reload', repo.externallyModified(canvasDir, c.id) === false);

// ---- B: our write builds on the fresh version (no clobber) ------------------
const fresh = sg.getCanvas(c.id)!;
setVariables(fresh, { colors: { added: '#abcabc' } });
sg.touchCanvas(c.id); // persists to repo
const after = JSON.parse(readFileSync(file, 'utf-8'));
check('external edit preserved after our write (no clobber)', after.name === 'Login (edited externally)');
check('our change persisted on top', after.variables?.colors?.added === '#abcabc');

// ---- C: external delete drops the canvas from the store --------------------
unlinkSync(file);
check('externallyModified true after delete', repo.externallyModified(canvasDir, c.id) === true);
sg.ensureFresh(c.id);
check('canvas dropped from store after external delete', sg.getCanvas(c.id) === undefined);

// ---- schemaVersion guard: a newer file still reads best-effort -------------
const wfPath = join(canvasDir, 'workspace.json');
const wf = JSON.parse(readFileSync(wfPath, 'utf-8'));
wf.schemaVersion = 999;
writeFileSync(wfPath, JSON.stringify(wf, null, 2));
const readBack = repo.readWorkspaceFile(canvasDir);
check('newer schemaVersion still readable (best-effort)', !!readBack && readBack.workspaceName === 'Acme');

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
