import './test-env.js';
// Phase 21 Slice A — point-and-tell feedback core + persistence on both backends.
//
// Part 1 drives the pure core (src/feedback.ts) on an in-memory canvas:
// snapshots, orphan detection, resolve bookkeeping. Part 2 checks the global
// store round-trip (touchCanvas → file). Part 3 binds a repo and checks the
// viewer write-back path (updateRepoCanvas) plus the FR-4 contract: a comment
// written to the repo file by another process reaches the running server via
// ensureFresh, without a restart.
//
// Usage: npx tsx test-feedback.ts

import { existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const globalHome = process.env.FRAMESMITH_HOME!;

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { addFeedback, listFeedback, resolveFeedback, deleteFeedback, openFeedbackCount, appendFeedbackDirective } = await import('./src/feedback.js');
const { parseAndExecute } = await import('./src/operations.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ---- Part 1: pure core ------------------------------------------------------
ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

const canvas = sg.createCanvas('Feedback target');
const longText = 'x'.repeat(120);
parseAndExecute(canvas.root, [
  `card=I("document",{type:"frame",name:"Card",layout:"vertical"})`,
  `t=I(card,{type:"text",content:"${longText}"})`,
].join('\n'));
const cardId = canvas.root.children![0].id;
const textId = canvas.root.children![0].children![0].id;

const anchored = addFeedback(canvas, { nodeId: textId, comment: '  tighter  ' });
check('anchored add: comment trimmed', anchored.comment === 'tighter');
check('anchored add: id has fb- prefix', anchored.id.startsWith('fb-'));
check('anchored add: snapshot type', anchored.node?.type === 'text');
check('anchored add: snapshot text truncated to 80', anchored.node?.text?.length === 80);

const onCard = addFeedback(canvas, { nodeId: cardId, comment: 'whole card feels heavy' });
check('anchored add: snapshot carries node name', onCard.node?.name === 'Card');

const general = addFeedback(canvas, { comment: 'page feels cramped overall' });
check('canvas-level add: no nodeId, no snapshot', general.nodeId === undefined && general.node === undefined);

let threw = false;
try { addFeedback(canvas, { nodeId: 'nope', comment: 'x' }); } catch { threw = true; }
check('bad nodeId throws', threw);
threw = false;
try { addFeedback(canvas, { comment: '   ' }); } catch { threw = true; }
check('empty comment throws', threw);

check('openFeedbackCount = 3', openFeedbackCount(canvas) === 3);

const res = resolveFeedback(canvas, [anchored.id, 'fb-unknown'], 'agent', 'tightened gap to 8');
check('resolve: valid id resolved', res.resolved.length === 1 && res.resolved[0] === anchored.id);
check('resolve: unknown id reported not thrown', res.notFound.length === 1 && res.notFound[0] === 'fb-unknown');
const resolvedEntry = listFeedback(canvas, { includeResolved: true }).find((e) => e.id === anchored.id)!;
check('resolve: bookkeeping (by/at/note)', resolvedEntry.resolvedBy === 'agent' && !!resolvedEntry.resolvedAt && resolvedEntry.resolutionNote === 'tightened gap to 8');
check('resolve: already-resolved id → notFound on replay', resolveFeedback(canvas, [anchored.id], 'agent').notFound.length === 1);

check('list default = open only', listFeedback(canvas).length === 2);
check('list includeResolved = all', listFeedback(canvas, { includeResolved: true }).length === 3);
check('openFeedbackCount = 2 after resolve', openFeedbackCount(canvas) === 2);

// orphan: delete the card node; its comment stays open but flags orphaned
sg.deleteNode(canvas.root, cardId);
const views = listFeedback(canvas);
check('orphaned flagged after node deletion', views.find((e) => e.id === onCard.id)?.orphaned === true);
check('orphaned entry stays open', openFeedbackCount(canvas) === 2);
check('canvas-level entry never orphaned', views.find((e) => e.id === general.id)?.orphaned === undefined);
check('snapshot survives the node (type/name intact)', views.find((e) => e.id === onCard.id)?.node?.name === 'Card');

check('deleteFeedback removes', deleteFeedback(canvas, general.id) && openFeedbackCount(canvas) === 1);
check('deleteFeedback unknown → false', deleteFeedback(canvas, 'fb-unknown') === false);

// Slice C — checkpoint surfacing
const summary = sg.listCanvases().find((c) => c.id === canvas.id)!;
check('listCanvases surfaces openFeedback when > 0', summary.openFeedback === 1);
const clean = sg.createCanvas('No feedback');
const cleanSummary = sg.listCanvases().find((c) => c.id === clean.id)!;
check('listCanvases omits openFeedback at 0', !('openFeedback' in cleanSummary));
check('appendFeedbackDirective no-ops at 0', appendFeedbackDirective('READY TO PRESENT — 98/100.', 0) === 'READY TO PRESENT — 98/100.');
const blocked = appendFeedbackDirective('READY TO PRESENT — 98/100.', 2);
check('appendFeedbackDirective blocks at > 0', blocked.includes('2 open point-and-tell') && blocked.includes('Do NOT present'));

// ---- Part 2: global-store persistence ----------------------------------------
sg.touchCanvas(canvas.id);
const globalFile = join(globalHome, 'canvases', `${canvas.id}.json`);
check('global file exists', existsSync(globalFile));
const persisted = JSON.parse(readFileSync(globalFile, 'utf-8'));
check('feedback persisted in global file', persisted.metadata?.feedback?.length === 2);

// ---- Part 3: repo backend ----------------------------------------------------
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
const { bindRepo } = await import('./src/bind.js');
const { resetRepoState } = await import('./src/repo-store.js');
const { loadGlobalAndRegisteredRepos, getRepoLocation, updateRepoCanvas } = await import('./src/aggregate.js');

const w = ws.createWorkspace('Acme');
const ui = ws.createProject(w.id, 'UI')!;
const home = sg.createCanvas('Home', ui.id);
check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);
const homeFile = join(repoRoot, '.framesmith', 'ui', 'home.json');
check('repo canvas file exists', existsSync(homeFile));

// FR-4: a comment written to the repo file externally (the viewer / a git pull)
// reaches this repo-bound server on the next ensureFresh — no restart.
const rootId = sg.getCanvas(home.id)!.root.id;
const onDisk = JSON.parse(readFileSync(homeFile, 'utf-8'));
onDisk.metadata = { ...(onDisk.metadata ?? {}), feedback: [{ id: 'fb-ext00001', nodeId: rootId, comment: 'from the viewer', at: new Date().toISOString(), node: { type: 'document' } }] };
writeFileSync(homeFile, JSON.stringify(onDisk, null, 2));
const future = new Date(Date.now() + 2000);
utimesSync(homeFile, future, future); // defeat same-ms mtime granularity
sg.ensureFresh(home.id);
check('ensureFresh delivers viewer-written comment', openFeedbackCount(sg.getCanvas(home.id)!) === 1);

// server-side resolve persists back to the repo file
resolveFeedback(sg.getCanvas(home.id)!, ['fb-ext00001'], 'agent', 'done');
sg.touchCanvas(home.id);
const afterResolve = JSON.parse(readFileSync(homeFile, 'utf-8'));
check('resolve persisted to repo file', afterResolve.metadata.feedback[0].resolvedBy === 'agent');

// viewer write-back path: updateRepoCanvas mutator (what the Slice B endpoints use)
resetRepoState();
loadGlobalAndRegisteredRepos();
check('viewer sees repo canvas', !!getRepoLocation(home.id));
const wrote = updateRepoCanvas(home.id, (c) => {
  addFeedback(c, { comment: 'viewer general note' });
  return true;
});
check('updateRepoCanvas writes back', wrote);
const afterViewer = JSON.parse(readFileSync(homeFile, 'utf-8'));
check('viewer comment in repo file', afterViewer.metadata.feedback.some((e: { comment: string }) => e.comment === 'viewer general note'));
check('mutator abort skips the write', updateRepoCanvas(home.id, () => false) === false);
check('non-repo id falls through', updateRepoCanvas('nope', () => true) === false);

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
