import './test-env.js';
// Smoke for Phase 10: asset externalization.
//
// Inline data: image URIs bloat the committed JSON. When written to a repo
// `.canvas/`, each is extracted to `.canvas/assets/<hash>.<ext>` and replaced
// with a compact `asset:<file>` ref; on read it rehydrates to the data: URI so
// the in-memory canvas stays inline. Identical images dedupe to one file.
//
// Usage: npx tsx test-repo-assets.ts

import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = mkdtempSync(join(tmpdir(), 'canvas-mcp-repo-'));

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');
const { parseAndExecute } = await import('./src/operations.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();
const w = ws.createWorkspace('Acme');
const ui = ws.createProject(w.id, 'UI')!;
const canvas = sg.createCanvas('Hero', ui.id);
// Two image nodes sharing the same data URI (should dedupe to one asset file).
parseAndExecute(canvas.root, [
  `I("${canvas.root.id}", { type: "image", src: "${PNG}" })`,
  `I("${canvas.root.id}", { type: "image", src: "${PNG}" })`,
].join('\n'), canvas);

check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);

const canvasDir = join(repoRoot, '.canvas');
const file = join(canvasDir, 'ui', 'hero.json');
const raw = readFileSync(file, 'utf-8');

check('committed JSON contains NO base64 data URI', !raw.includes('data:image'), raw.includes('data:image') ? 'still inline' : '');
check('committed JSON references asset:', raw.includes('asset:'));
const assetsDir = join(canvasDir, 'assets');
check('.canvas/assets/ dir created', existsSync(assetsDir));
const assetFiles = existsSync(assetsDir) ? readdirSync(assetsDir).filter((f) => !f.endsWith('.tmp')) : [];
check('two identical images dedupe to one asset file', assetFiles.length === 1, assetFiles.join(','));
check('asset file is a .png', assetFiles[0]?.endsWith('.png') === true, assetFiles[0]);

// reload from disk → images rehydrated back to inline data: URIs
const { resetRepoState, detectBinding, readWorkspaceFile, setRepoBackend } = await import('./src/repo-store.js');
resetRepoState();
const b = detectBinding(repoRoot)!;
setRepoBackend(b.root, b.dir);
ws.loadRepoWorkspace(readWorkspaceFile(b.dir)!);
sg.loadPersistedCanvases();
const reloaded = sg.getCanvas(canvas.id)!;
const imgs = reloaded.root.children!.filter((n) => n.type === 'image');
check('both image nodes reloaded', imgs.length === 2, `count=${imgs.length}`);
check('reloaded image src rehydrated to data: URI', imgs.every((n) => n.src === PNG));

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
