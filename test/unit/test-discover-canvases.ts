// Discovery of canvas files added on disk while the server runs, at the store
// level: what it loads, what it sets aside, and what it must never load back.
// The end-to-end path (canvas_list, a tool given an id) is in
// test/e2e/test-external-new-files.ts.
//
// Usage: npx tsx test/unit/test-discover-canvases.ts

import { chmodSync, mkdtempSync, readFileSync, readdirSync, renameSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-discover-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-discover-repo-'));
process.env.FRAMESMITH_HOME = globalHome;

const sg = await import('../../src/scene-graph.js');
const ws = await import('../../src/workspaces.js');
const { bindRepo } = await import('../../src/bind.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}
const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;
let n = 0;
const bump = (p: string) => { n++; const t = new Date(Date.now() + n * 2000); utimesSync(p, t, t); };

// ── the global store ─────────────────────────────────────────────────────────
ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();
const g = sg.createCanvas('global-seed');
const globalDir = join(globalHome, 'canvases');
const seedJson = JSON.parse(readFileSync(join(globalDir, `${g.id}.json`), 'utf-8'));
const like = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ...seedJson, id, name: id, ...extra });

writeFileSync(join(globalDir, 'gAddedAAAA.json'), like('gAddedAAAA'));
check('global: a file another session wrote is discovered', sg.discoverCanvases() === 1 && !!sg.getCanvas('gAddedAAAA'));
writeFileSync(join(globalDir, 'gWrongIdBB.json'), like('someOther'));
check('global: a file whose id is not its name is not loaded', sg.discoverCanvases() === 0 && !sg.getCanvas('someOther') && !sg.getCanvas('gWrongIdBB'));
writeFileSync(join(globalDir, 'gWrongIdBB.json'), like('gWrongIdBB'));
check('…and is once it changes to match', sg.discoverCanvases() === 1 && !!sg.getCanvas('gWrongIdBB'));
if (canChmod) {
  chmodSync(globalDir, 0o555);
  sg.deleteCanvas('gAddedAAAA');
  chmodSync(globalDir, 0o755);
  check('global: a deleted canvas whose file could not be removed is not loaded back', sg.discoverCanvases() === 0 && !sg.getCanvas('gAddedAAAA'));
}

// ── a bound repo ─────────────────────────────────────────────────────────────
const w = ws.createWorkspace('Acme');
const ui = ws.createProject(w.id, 'UI')!;
const c = sg.createCanvas('Login Form', ui.id);
check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);
const canvasDir = join(repoRoot, '.framesmith');
const uiId = sg.getCanvas(c.id)!.projectId;
const loginFile = join(canvasDir, readdirSync(canvasDir, { recursive: true }).map(String).find((f) => f.endsWith('.json') && f !== 'workspace.json' && readFileSync(join(canvasDir, f), 'utf-8').includes(`"${c.id}"`))!);
const uiDir = dirname(loginFile);
const login = JSON.parse(readFileSync(loginFile, 'utf-8'));
const repoLike = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ...login, id, name: id, ...extra });

const { projectId: _drop, ...noProject } = JSON.parse(repoLike('noProjCCCC'));
writeFileSync(join(uiDir, 'no-project.json'), JSON.stringify(noProject));
sg.ensureAllFresh();
check('repo: a new file with no projectId takes its folder\'s project', sg.getCanvas('noProjCCCC')?.projectId === uiId, String(sg.getCanvas('noProjCCCC')?.projectId));

writeFileSync(join(uiDir, 'junk.json'), JSON.stringify({ not: 'a canvas' }));
sg.ensureAllFresh();
writeFileSync(join(uiDir, 'junk.json'), repoLike('junkNowDDD'));
bump(join(uiDir, 'junk.json'));
sg.ensureAllFresh();
check('repo: a JSON file that is not a canvas is set aside, then loaded once it becomes one', !!sg.getCanvas('junkNowDDD'));

writeFileSync(join(uiDir, 'copy.json'), repoLike(c.id, { name: 'COPY' }));
sg.ensureAllFresh();
check('repo: a copy of a loaded canvas does not replace it', sg.getCanvas(c.id)?.name === 'Login Form');
unlinkSync(loginFile);
sg.ensureAllFresh();
check('…and is adopted when the original file goes away', sg.getCanvas(c.id)?.name === 'COPY');
renameSync(join(uiDir, 'copy.json'), loginFile);
bump(loginFile);
sg.ensureAllFresh();

// A branch switch: the same path now holds another canvas.
writeFileSync(loginFile, repoLike('otherBrEEE'));
bump(loginFile);
sg.ensureAllFresh();
check('repo: when a path holds another canvas, the old id is gone', !sg.getCanvas(c.id));
check('…and the other canvas is loaded under its own id', sg.getCanvas('otherBrEEE')?.id === 'otherBrEEE');
sg.touchCanvas('otherBrEEE');
check('…and a write goes to that same file, with no second copy', readdirSync(uiDir).filter((f) => readFileSync(join(uiDir, f), 'utf-8').includes('"otherBrEEE"')).length === 1);

if (canChmod) {
  chmodSync(uiDir, 0o555);
  sg.deleteCanvas('noProjCCCC');
  chmodSync(uiDir, 0o755);
  sg.ensureAllFresh();
  check('repo: a deleted canvas whose file could not be removed is not loaded back', !sg.getCanvas('noProjCCCC'));
  writeFileSync(join(uiDir, 'no-project.json'), repoLike('noProjCCCC', { name: 'restored by git' }));
  bump(join(uiDir, 'no-project.json'));
  sg.ensureAllFresh();
  check('…unless its file changes (a checkout restores it)', sg.getCanvas('noProjCCCC')?.name === 'restored by git');
}

check('repo: the global store is not scanned while bound', (() => { writeFileSync(join(globalDir, 'gBoundFFFF.json'), like('gBoundFFFF')); return sg.discoverCanvases() === 0 && !sg.getCanvas('gBoundFFFF'); })());
process.exit(allPass ? 0 : 1);
