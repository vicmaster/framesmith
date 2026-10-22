// A bound server must notice when `.framesmith/workspace.json` changes on disk
// under it (git pull, branch switch, hand edit). Canvas files got this in
// Phase 10 slice 3 (`ensureFresh`); workspace.json didn't, so the server kept
// rendering with the old design system AND its next workspace/project write
// (even an unrelated one, like creating a project) put the old copy back over
// the pulled change.
//
// #222: a read that fails (a half-written file, or git merge-conflict markers)
// must not be taken as "seen": the next call retries, and no workspace/project
// write may overwrite a file that can't be read.
//
// Usage: npx tsx test-repo-workspace-external-change.ts

import { mkdtempSync, readFileSync, writeFileSync, utimesSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
process.env.FRAMESMITH_HOME = globalHome;

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type WsFile = {
  workspaceName: string;
  designSystem?: { colors?: Record<string, string> };
  projects: { id: string; name: string; dir: string; designSystem?: { colors?: Record<string, string> } }[];
};
const file = join(repoRoot, '.framesmith', 'workspace.json');
const readWs = (): WsFile => JSON.parse(readFileSync(file, 'utf-8'));
/** Simulate a git pull: rewrite the file and push its mtime forward so the
 * change is visible even on a filesystem with coarse mtimes. */
let bumpCount = 0;
function editOnDisk(mutate: (wf: WsFile) => void) {
  const wf = readWs();
  mutate(wf);
  writeFileSync(file, JSON.stringify(wf, null, 2));
  const t = new Date(Date.now() + 5000 * ++bumpCount);
  utimesSync(file, t, t);
}

// ---- Bind a workspace (primary = blue) with one project + canvas ----------
ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();
const w = ws.createWorkspace('Acme');
ws.setWorkspaceDesignSystem(w.id, { colors: { primary: '#2563EB' } });
const ui = ws.createProject(w.id, 'UI')!;
const c = sg.createCanvas('Login Form', ui.id);
check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);

const wsId = () => ws.listWorkspaces()[0].id;
const uiId = readWs().projects.find((p) => p.name === 'UI')!.id;
const canvas = () => sg.getCanvas(c.id)!;
check('tokens resolve blue after bind', ws.getCanvasTokens(canvas()).colors?.primary === '#2563EB');

// ---- A: the confirmed repro — an unrelated write must not undo a pull -----
editOnDisk((wf) => { wf.designSystem = { ...wf.designSystem, colors: { ...wf.designSystem?.colors, primary: '#DC2626' } }; });
ws.createProject(wsId(), 'Marketing');
const afterCreate = readWs();
check('pulled workspace token survives an unrelated createProject', afterCreate.designSystem?.colors?.primary === '#DC2626',
  `primary on disk = ${afterCreate.designSystem?.colors?.primary}`);
check('…and the new project was still written', afterCreate.projects.some((p) => p.name === 'Marketing'));

// ---- B: renders see the pulled tokens without a restart ------------------
editOnDisk((wf) => { wf.designSystem = { ...wf.designSystem, colors: { ...wf.designSystem?.colors, primary: '#16A34A' } }; });
check('getCanvasTokens returns the pulled workspace token', ws.getCanvasTokens(canvas()).colors?.primary === '#16A34A',
  `got ${ws.getCanvasTokens(canvas()).colors?.primary}`);

// ---- C: project layer — a pulled project token survives a rename ---------
editOnDisk((wf) => {
  const p = wf.projects.find((x) => x.id === uiId)!;
  p.designSystem = { ...p.designSystem, colors: { ...p.designSystem?.colors, accent: '#7C3AED' } };
});
ws.renameProject(uiId, 'UI Kit');
const afterRename = readWs().projects.find((p) => p.id === uiId)!;
check('pulled project token survives renameProject', afterRename.designSystem?.colors?.accent === '#7C3AED', JSON.stringify(afterRename.designSystem));
check('…and the rename was written', afterRename.name === 'UI Kit');
check('project ids stay stable across the reload', ws.getProject(uiId)?.name === 'UI Kit' && canvas().projectId === uiId);

// ---- D: a project added by the pull shows up -----------------------------
editOnDisk((wf) => { wf.projects.push({ id: 'repo-proj-pulled01', name: 'Pulled', dir: 'pulled' }); });
check('a project added on disk is listed', ws.listProjects(wsId()).some((p) => p.id === 'repo-proj-pulled01'));

// ---- E: our own writes don't look like external changes ------------------
ws.setWorkspaceDesignSystem(wsId(), { colors: { primary: '#0891B2' } });
check('our own write reads back', ws.getCanvasTokens(canvas()).colors?.primary === '#0891B2');
check('our own write is on disk', readWs().designSystem?.colors?.primary === '#0891B2');

// ---- G (#222): a half-written read, then the finished file keeps the same mtime
{
  const full = readWs();
  full.designSystem = { ...full.designSystem, colors: { ...full.designSystem?.colors, primary: '#DC2626' } };
  const complete = JSON.stringify(full, null, 2);
  const t = new Date(Date.now() + 5000 * ++bumpCount);
  writeFileSync(file, complete.slice(0, 40));   // the server reads mid-write…
  utimesSync(file, t, t);
  ws.getCanvasTokens(canvas());
  writeFileSync(file, complete);                // …then the write finishes with the same mtime
  utimesSync(file, t, t);
  ws.createProject(wsId(), 'Docs');
  check('finished write with the same mtime as a failed read is still picked up', readWs().designSystem?.colors?.primary === '#DC2626',
    `primary on disk = ${readWs().designSystem?.colors?.primary}`);
  check('…and the unrelated write landed too', readWs().projects.some((p) => p.name === 'Docs'));
}

// ---- H (#222): same mtime, different content (coarse-timestamp filesystems)
{
  // Pin the mtime to a whole second (exactly representable) and let the server
  // see it, so "same mtime" below is really the same mtime.
  const before = new Date(Math.floor(Date.now() / 1000) * 1000 + 5000 * ++bumpCount);
  utimesSync(file, before, before);
  ws.getCanvasTokens(canvas());
  check('pinned mtime is exact', statSync(file).mtimeMs === before.getTime());
  const wf = readWs();
  wf.designSystem = { ...wf.designSystem, colors: { ...wf.designSystem?.colors, primary: '#EA580C' } };
  writeFileSync(file, JSON.stringify(wf, null, 4)); // different size, same mtime as our last write
  utimesSync(file, before, before);
  check('an external write that keeps our mtime but changes the size is picked up', ws.getCanvasTokens(canvas()).colors?.primary === '#EA580C',
    `got ${ws.getCanvasTokens(canvas()).colors?.primary}`);
}

// ---- I (#222): unreadable workspace.json (a git merge conflict) is never overwritten
{
  const text = readFileSync(file, 'utf-8');
  const conflicted = `<<<<<<< HEAD\n${text}=======\n${text.replace('#EA580C', '#16A34A')}>>>>>>> feature\n`;
  writeFileSync(file, conflicted);
  const t = new Date(Date.now() + 5000 * ++bumpCount);
  utimesSync(file, t, t);
  check('reads keep the in-memory tokens while the file is unreadable', ws.getCanvasTokens(canvas()).colors?.primary === '#EA580C');
  let error = '';
  try { ws.renameProject(uiId, 'During conflict'); } catch (e) { error = (e as Error).message; }
  check('a workspace/project write is refused while the file is unreadable', error.includes('workspace.json') && error.toLowerCase().includes('conflict'), error || '(no error thrown)');
  check('…and the conflicted file is left untouched', readFileSync(file, 'utf-8') === conflicted);
  check('…and the in-memory state did not change', ws.getProject(uiId)?.name === 'UI Kit');
  try { ws.setWorkspaceDesignSystem(wsId(), { colors: { primary: '#000000' } }); error = ''; } catch (e) { error = (e as Error).message; }
  check('design-system writes are refused too', error.includes('workspace.json'), error || '(no error thrown)');

  // Resolving the conflict (keeping "theirs") is picked up and writes work again.
  const theirs = JSON.parse(text.replace('#EA580C', '#16A34A'));
  writeFileSync(file, JSON.stringify(theirs, null, 2));
  const t2 = new Date(Date.now() + 5000 * ++bumpCount);
  utimesSync(file, t2, t2);
  ws.renameProject(uiId, 'After conflict');
  check('after the conflict is resolved, the resolution is loaded and writes work', readWs().designSystem?.colors?.primary === '#16A34A'
    && readWs().projects.find((p) => p.id === uiId)?.name === 'After conflict');
}

// ---- F: workspace.json deleted or unreadable — keep the in-memory copy ---
writeFileSync(file, '{ not json');
utimesSync(file, new Date(Date.now() + 600_000), new Date(Date.now() + 600_000));
check('unreadable workspace.json → in-memory tokens kept, no crash', ws.getCanvasTokens(canvas()).colors?.primary === '#16A34A');
unlinkSync(file);
check('deleted workspace.json → in-memory tokens kept, no crash', ws.getCanvasTokens(canvas()).colors?.primary === '#16A34A');

console.log(allPass ? '\nAll workspace external-change tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
