// Regression tests for issue #64 (PR 2 — wrong-result bugs):
//   1. A CSS *string* on `gradient` / `shadows` (instead of the structured
//      form) used to crash the renderer on `.map` — and thus `screenshot`.
//      Now it renders as a raw CSS value; structured forms still work.
//   2. `canvas_move` on a bound repo left the canvas JSON in the *old* project
//      subdir. Now the file is relocated to the target project's subdir.
//
// Usage: npx tsx test-gradient-shadow-move-fixes.ts

import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
process.env.FRAMESMITH_HOME = globalHome;

const { renderToHtml } = await import('./src/renderer.js');
const { createCanvas, moveCanvas, loadPersistedCanvases } = await import('./src/scene-graph.js');
const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createWorkspace, createProject, listProjects } = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');
const { readWorkspaceFile } = await import('./src/repo-store.js');
import type { SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── Renderer: CSS strings on gradient / shadows no longer crash ───────────────
function render(node: Partial<SceneNode>): string {
  const root: SceneNode = { id: 'root', name: 'root', type: 'frame', width: 400, height: 300, ...node } as SceneNode;
  return renderToHtml(root, 400, 300);
}

// gradient as a raw CSS string — previously threw "Cannot read properties of
// undefined (reading 'map')".
let html = '';
let threw = false;
try { html = render({ gradient: 'linear-gradient(90deg, #f00, #00f)' as unknown as SceneNode['gradient'] }); }
catch { threw = true; }
check('gradient string: renderer does not throw', !threw);
check('gradient string: emitted as raw background', html.includes('background: linear-gradient(90deg, #f00, #00f)'));

// shadows as a raw CSS string (the plural field) — previously threw on `.map`.
threw = false; html = '';
try { html = render({ shadows: '0 1px 2px rgba(0,0,0,0.2)' as unknown as SceneNode['shadows'] }); }
catch { threw = true; }
check('shadows string: renderer does not throw', !threw);
check('shadows string: emitted as raw box-shadow', html.includes('box-shadow: 0 1px 2px rgba(0,0,0,0.2)'));

// Structured forms still render correctly (no regression).
html = render({ gradient: { type: 'linear', angle: 45, stops: [{ color: '#000', position: 0 }, { color: '#fff', position: 100 }] } });
check('gradient structured: still renders linear-gradient', html.includes('background: linear-gradient(45deg, #000 0%, #fff 100%)'));

html = render({ shadows: [{ x: 0, y: 4, blur: 8, color: 'rgba(0,0,0,0.3)' }] });
check('shadows structured: still renders box-shadow', html.includes('box-shadow: 0px 4px 8px 0px rgba(0,0,0,0.3)'));

// Singular `shadow` string still works.
html = render({ shadow: '0 0 0 1px #ccc' });
check('shadow (singular) string: still renders', html.includes('box-shadow: 0 0 0 1px #ccc'));

// A malformed structured gradient (no stops) falls back to fill, not a crash.
threw = false; html = '';
try { html = render({ gradient: { type: 'linear' } as unknown as SceneNode['gradient'], fill: '#abc' }); }
catch { threw = true; }
check('gradient malformed: no crash, falls back to fill', !threw && html.includes('background-color: #abc'));

// ── canvas_move relocates the file across project subdirs (bound repo) ─────────
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();

const ws = createWorkspace('Move Test');
createProject(ws.id, 'Source')!;
createProject(ws.id, 'Target')!;

const bound = bindRepo({ workspaceId: ws.id, dir: repoRoot });
check('move: bind succeeded', bound.ok, bound.ok ? '' : (bound as { error?: string }).error);

const canvasDir = join(repoRoot, '.framesmith');
const source = listProjects().find((p) => p.name === 'Source')!;
const target = listProjects().find((p) => p.name === 'Target')!;
const wf = readWorkspaceFile(canvasDir)!;
const sourceDir = wf.projects.find((p) => p.id === source.id)!.dir;
const targetDir = wf.projects.find((p) => p.id === target.id)!.dir;

const canvas = createCanvas('Mover', source.id);
const filesInSourceBefore = readdirSync(join(canvasDir, sourceDir)).filter((f) => f.endsWith('.json'));
check('move: file starts in source subdir', filesInSourceBefore.length === 1, `files=${filesInSourceBefore.join(',')}`);

moveCanvas(canvas.id, target.id);

const filesInSourceAfter = readdirSync(join(canvasDir, sourceDir)).filter((f) => f.endsWith('.json'));
const targetExists = existsSync(join(canvasDir, targetDir));
const filesInTargetAfter = targetExists ? readdirSync(join(canvasDir, targetDir)).filter((f) => f.endsWith('.json')) : [];
check('move: source subdir no longer holds the canvas', filesInSourceAfter.length === 0, `files=${filesInSourceAfter.join(',')}`);
check('move: target subdir now holds the canvas', filesInTargetAfter.length === 1, `files=${filesInTargetAfter.join(',')}`);

// And it reloads from the target subdir on a fresh read.
const reloaded = loadPersistedCanvases();
check('move: exactly one canvas reloads after move', reloaded === 1, `count=${reloaded}`);

console.log(allPass ? '\nPR2 FIXES TEST PASSED ✅' : '\nPR2 FIXES TEST FAILED ✗');
process.exit(allPass ? 0 : 1);
