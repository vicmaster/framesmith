// A bound server must notice when `.framesmith/workspace.json` changes on disk
// under it (git pull, branch switch, hand edit). Canvas files got this in
// Phase 10 slice 3 (`ensureFresh`); workspace.json didn't, so the server kept
// rendering with the old design system AND its next workspace/project write
// (even an unrelated one, like creating a project) put the old copy back over
// the pulled change.
//
// Usage: npx tsx test-repo-workspace-external-change.ts

import { mkdtempSync, readFileSync, writeFileSync, utimesSync, unlinkSync } from 'node:fs';
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

// ---- F: workspace.json deleted or unreadable — keep the in-memory copy ---
writeFileSync(file, '{ not json');
utimesSync(file, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
check('unreadable workspace.json → in-memory tokens kept, no crash', ws.getCanvasTokens(canvas()).colors?.primary === '#0891B2');
unlinkSync(file);
check('deleted workspace.json → in-memory tokens kept, no crash', ws.getCanvasTokens(canvas()).colors?.primary === '#0891B2');

console.log(allPass ? '\nAll workspace external-change tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
