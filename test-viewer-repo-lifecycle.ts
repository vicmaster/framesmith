import './test-env.js';
// Smoke for Phase 10 closeout: viewer lifecycle on mirrored repo canvases.
//
// Archive/delete on a repo-bound canvas (shown in the viewer via the registry
// mirror) must write back to the repo `.framesmith/` file — not mis-write to the
// global store — and survive a re-aggregation.
//
// Usage: npx tsx test-viewer-repo-lifecycle.ts

import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
process.env.FRAMESMITH_HOME = globalHome;

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');
const { resetRepoState } = await import('./src/repo-store.js');
const { loadGlobalAndRegisteredRepos, getRepoLocation, archiveRepoCanvas, deleteRepoCanvas } = await import('./src/aggregate.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const canvasDir = join(repoRoot, '.framesmith');
const archivedOnDisk = (rel: string): boolean | undefined =>
  existsSync(join(canvasDir, rel)) ? JSON.parse(readFileSync(join(canvasDir, rel), 'utf-8')).archived : undefined;

// ---- Bind a workspace with two canvases ------------------------------------
ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();
const w = ws.createWorkspace('Acme');
const ui = ws.createProject(w.id, 'UI')!;
const home = sg.createCanvas('Home', ui.id);
const about = sg.createCanvas('About', ui.id);
check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);

// ---- Simulate the viewer process: global backend + aggregation -------------
resetRepoState();
loadGlobalAndRegisteredRepos();
check('viewer knows Home is a repo canvas', !!getRepoLocation(home.id));
check('viewer treats a random id as non-repo (global path)', !getRepoLocation('nope'));

// ---- Archive writes back to the repo file ----------------------------------
check('archiveRepoCanvas returns true', archiveRepoCanvas(home.id, true));
check('store reflects archived', sg.getCanvas(home.id)?.archived === true);
check('repo file ui/home.json now archived:true', archivedOnDisk('ui/home.json') === true);
check('NO stray global file for the repo canvas', !existsSync(join(globalHome, 'canvases', `${home.id}.json`)));

// survives a re-aggregation (persisted, not just in-memory)
resetRepoState();
loadGlobalAndRegisteredRepos();
check('still archived after viewer reload', sg.getCanvas(home.id)?.archived === true);

// unarchive flips it back on disk
check('unarchive returns true', archiveRepoCanvas(home.id, false));
check('repo file ui/home.json now archived:false', archivedOnDisk('ui/home.json') === false);

// ---- Delete removes the repo file ------------------------------------------
check('deleteRepoCanvas returns true', deleteRepoCanvas(about.id));
check('repo file ui/about.json removed', !existsSync(join(canvasDir, 'ui', 'about.json')));
check('about dropped from store', sg.getCanvas(about.id) === undefined);
resetRepoState();
loadGlobalAndRegisteredRepos();
check('about stays gone after viewer reload', sg.getCanvas(about.id) === undefined);
check('home still present after reload', !!sg.getCanvas(home.id));

// safety: nothing leaked into the real ~/.framesmith (FRAMESMITH_HOME is tmp)
check('global home is the tmp dir (isolation holds)', globalHome.startsWith(tmpdir()) && globalHome !== join(homedir(), '.framesmith'));

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
