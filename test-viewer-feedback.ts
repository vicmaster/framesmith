import './test-env.js';
// Phase 21 Slice B — viewer feedback JSON API round-trip on both backends.
//
// Spins the real viewer on an ephemeral port and drives the feedback endpoints
// over HTTP: add (anchored / whole-page / invalid), list, user-side resolve,
// delete, and the repo write-back path. The iframe comment-mode UI is manually
// verified; this covers everything the browser JS calls.
//
// Usage: npx tsx test-viewer-feedback.ts

import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { parseAndExecute } = await import('./src/operations.js');
const { startViewer } = await import('./src/viewer.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

const canvas = sg.createCanvas('API target');
parseAndExecute(canvas.root, `card=I("document",{type:"frame",name:"Card",layout:"vertical"})`);
const cardId = canvas.root.children![0].id;

const port = await startViewer(0);
const base = `http://127.0.0.1:${port}`;
const api = (suffix: string, init?: RequestInit) => fetch(`${base}/api/canvas/${canvas.id}${suffix}`, init);
const post = (suffix: string, body?: unknown) =>
  api(suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

// ---- add ---------------------------------------------------------------------
let res = await post('/feedback', { nodeId: cardId, comment: 'tighter' });
const added = await res.json();
check('POST anchored → 200 + entry', res.ok && added.ok && added.entry.id.startsWith('fb-'));
check('entry snapshot captured', added.entry.node?.name === 'Card');

res = await post('/feedback', { comment: 'page feels cramped' });
const general = await res.json();
check('POST whole-page → 200', res.ok && general.entry.nodeId === undefined);

res = await post('/feedback', { nodeId: 'nope', comment: 'x' });
check('POST bad nodeId → 400', res.status === 400 && (await res.json()).error.includes('not found'));
res = await post('/feedback', { comment: '   ' });
check('POST empty comment → 400', res.status === 400);
res = await fetch(`${base}/api/canvas/unknown-id/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: 'x' }) });
check('POST unknown canvas → 404', res.status === 404);

// ---- list ----------------------------------------------------------------------
res = await api('/feedback');
const list = await res.json();
check('GET list → openCount 2, both entries', list.openCount === 2 && list.entries.length === 2);

// ---- resolve (user-side) -------------------------------------------------------
res = await post(`/feedback/${added.entry.id}/resolve`, { note: 'moot' });
check('POST resolve → 200', res.ok);
res = await api('/feedback');
const afterResolve = await res.json();
const resolvedEntry = afterResolve.entries.find((e: { id: string }) => e.id === added.entry.id);
check('resolved entry: resolvedBy user + note', resolvedEntry.resolvedBy === 'user' && resolvedEntry.resolutionNote === 'moot');
check('openCount dropped to 1', afterResolve.openCount === 1);
res = await post(`/feedback/${added.entry.id}/resolve`);
check('re-resolve same id → 404', res.status === 404);

// ---- delete --------------------------------------------------------------------
res = await api(`/feedback/${general.entry.id}`, { method: 'DELETE' });
check('DELETE entry → 200', res.ok);
res = await api(`/feedback/${general.entry.id}`, { method: 'DELETE' });
check('DELETE again → 404', res.status === 404);

// ---- global persistence --------------------------------------------------------
const globalFile = join(process.env.FRAMESMITH_HOME!, 'canvases', `${canvas.id}.json`);
check('mutations persisted to global store', existsSync(globalFile) && JSON.parse(readFileSync(globalFile, 'utf-8')).metadata.feedback.length === 1);

// ---- detail page embeds the tab + data -----------------------------------------
res = await fetch(`${base}/canvas/${canvas.id}`);
const page = await res.text();
check('detail page has Feedback tab', page.includes('data-tab="feedback"'));
check('detail page embeds FB_INIT + NODE_INDEX', page.includes('FB_INIT') && page.includes('NODE_INDEX'));
check('detail page has Comment toolbar button', page.includes('btn-comment'));

// ---- repo-mirror backend --------------------------------------------------------
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
const { bindRepo } = await import('./src/bind.js');
const { resetRepoState } = await import('./src/repo-store.js');
const { loadGlobalAndRegisteredRepos, getRepoLocation } = await import('./src/aggregate.js');

const w = ws.createWorkspace('Acme');
const ui = ws.createProject(w.id, 'UI')!;
const home = sg.createCanvas('Home', ui.id);
check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);
resetRepoState(); // simulate the standalone viewer process: global backend + registry mirror
loadGlobalAndRegisteredRepos();
check('repo canvas mirrored', !!getRepoLocation(home.id));

res = await fetch(`${base}/api/canvas/${home.id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: 'repo note' }) });
check('POST on repo mirror → 200', res.ok);
const homeFile = join(repoRoot, '.framesmith', 'ui', 'home.json');
const onDisk = JSON.parse(readFileSync(homeFile, 'utf-8'));
check('comment written back to repo file', onDisk.metadata?.feedback?.[0]?.comment === 'repo note');
check('NO stray global file for the repo canvas', !existsSync(join(process.env.FRAMESMITH_HOME!, 'canvases', `${home.id}.json`)));

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
