// A canvas file that appears on disk while the MCP server runs (a git pull that
// brings a new canvas, possibly in a new project; another session writing to
// the global store) must reach the tools without a restart: canvas_list shows
// it and a tool given its id finds it. A canvas moved to another project is
// found at its new place.
//
// Usage: npx tsx test/e2e/test-external-new-files.ts

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type Content = Array<{ type: string; text?: string }>;
async function startServer(home: string, cwd: string) {
  const transport = new StdioClientTransport({
    command: resolve('node_modules/.bin/tsx'),
    args: [resolve('src/index.ts')],
    cwd,
    env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://127.0.0.1:9' } as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test-external-new-files', version: '0' });
  await client.connect(transport);
  const text = async (name: string, args: Record<string, unknown>) =>
    ((await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as { content: Content }).content.find((c) => c.type === 'text')?.text ?? '';
  return { client, text };
}

/** A copy of a canvas file as a different canvas, the way a teammate's commit
 * would bring one: new id and name, same content. */
function newCanvasLike(source: string, id: string, name: string, projectId: string): string {
  const canvas = JSON.parse(readFileSync(source, 'utf-8'));
  return JSON.stringify({ ...canvas, id, name, projectId }, null, 2);
}

const listed = async (text: (n: string, a: Record<string, unknown>) => Promise<string>, id: string) =>
  (JSON.parse(await text('canvas_list', {})) as Array<{ id: string; projectId: string }>).find((r) => r.id === id);

// ── a bound repo ─────────────────────────────────────────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'framesmith-new-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'framesmith-new-repo-'));
  const { client, text } = await startServer(home, repo);
  const seed = JSON.parse(await text('canvas_create', { name: 'seed' })).canvasId as string;
  await text('batch_design', { canvasId: seed, operations: 'I("document", { type: "text", name: "Label", content: "seed", fontSize: 16, color: "#111111" })' });
  await text('canvas_bind', { dir: repo });
  const dir = join(repo, '.framesmith');
  const projectDir = readdirSync(dir).find((d) => statSync(join(dir, d)).isDirectory() && readdirSync(join(dir, d)).some((f) => f.endsWith('.json')))!;
  const seedFile = join(dir, projectDir, readdirSync(join(dir, projectDir)).find((f) => f.endsWith('.json'))!);
  const projectId = JSON.parse(readFileSync(seedFile, 'utf-8')).projectId as string;

  // A new canvas in an existing project.
  writeFileSync(join(dir, projectDir, 'pulled.json'), newCanvasLike(seedFile, 'pulledAAAA', 'pulled', projectId));
  check('repo: canvas_list shows a canvas file added to a project', (await listed(text, 'pulledAAAA'))?.projectId === projectId);
  writeFileSync(join(dir, projectDir, 'by-id.json'), newCanvasLike(seedFile, 'byIdBBBBBB', 'by-id', projectId));
  check('repo: a tool given a new file\'s id finds it without a listing first', (await text('read_nodes', { canvasId: 'byIdBBBBBB' })).includes('seed'));

  // A new project: workspace.json gains it, its folder holds a canvas.
  const ws = JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf-8'));
  ws.projects.push({ id: 'repo-proj-pulled', name: 'Pulled project', dir: 'pulled-project' });
  writeFileSync(join(dir, 'workspace.json'), JSON.stringify(ws, null, 2));
  mkdirSync(join(dir, 'pulled-project'));
  writeFileSync(join(dir, 'pulled-project', 'fresh.json'), newCanvasLike(seedFile, 'inNewProjC', 'fresh', 'repo-proj-pulled'));
  check('repo: a canvas in a project added to workspace.json is listed under it', (await listed(text, 'inNewProjC'))?.projectId === 'repo-proj-pulled');

  // A canvas another session moved to another project: its file changes folder
  // and its projectId with it.
  renameSync(join(dir, projectDir, 'pulled.json'), join(dir, 'pulled-project', 'pulled.json'));
  const movedFile = join(dir, 'pulled-project', 'pulled.json');
  writeFileSync(movedFile, JSON.stringify({ ...JSON.parse(readFileSync(movedFile, 'utf-8')), projectId: 'repo-proj-pulled' }, null, 2));
  const moved = await listed(text, 'pulledAAAA');
  check('repo: a canvas moved to another project is listed under it', moved?.projectId === 'repo-proj-pulled', JSON.stringify(moved));
  await text('batch_design', { canvasId: 'pulledAAAA', operations: 'U("document", { name: "moved-and-edited" })' });
  check('repo: …and a write goes to its new place, not back to the old one', readFileSync(join(dir, 'pulled-project', 'pulled.json'), 'utf-8').includes('moved-and-edited') && !readdirSync(join(dir, projectDir)).includes('pulled.json'));

  // A new file that doesn't parse yet is not listed, and is once it does.
  writeFileSync(join(dir, projectDir, 'half.json'), '{ "id": "halfDDDDDD", ');
  check('repo: a half-written new file is not listed', !(await listed(text, 'halfDDDDDD')));
  writeFileSync(join(dir, projectDir, 'half.json'), newCanvasLike(seedFile, 'halfDDDDDD', 'half', projectId));
  check('repo: …and is once it parses', !!(await listed(text, 'halfDDDDDD')));
  await client.close();
}

// ── the global store (another session writes a canvas) ──────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'framesmith-new-global-'));
  const cwd = mkdtempSync(join(tmpdir(), 'framesmith-new-cwd-'));
  const { client, text } = await startServer(home, cwd);
  const seed = JSON.parse(await text('canvas_create', { name: 'seed' })).canvasId as string;
  const seedFile = join(home, 'canvases', `${seed}.json`);
  const projectId = JSON.parse(readFileSync(seedFile, 'utf-8')).projectId as string;
  writeFileSync(join(home, 'canvases', 'otherSessE.json'), newCanvasLike(seedFile, 'otherSessE', 'from another session', projectId));
  check('global: canvas_list shows a canvas another session wrote', !!(await listed(text, 'otherSessE')));
  writeFileSync(join(home, 'canvases', 'otherSessF.json'), newCanvasLike(seedFile, 'otherSessF', 'by id', projectId));
  check('global: a tool given its id finds it', !(await text('get_variables', { canvasId: 'otherSessF' })).startsWith('Error'));
  await client.close();
}

process.exit(allPass ? 0 : 1);
