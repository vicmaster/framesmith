// Phase 23 slice C (#148, #149) — the CLI entry points. Spawns the real bin
// entry (src/index.ts via tsx) so the argv dispatch itself is under test:
// `verify` / `check-drift` run and exit with gate-friendly codes, and — the
// regression that must never happen — NO ARGS still boots the MCP server
// (a real initialize handshake over stdio, not just "didn't crash").
//
// Usage: npx tsx test-cli.ts   (check-drift cases need Chrome)

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';

const tmpHome = mkdtempSync(join(tmpdir(), 'framesmith-cli-home-'));
const tmpCwd = mkdtempSync(join(tmpdir(), 'framesmith-cli-cwd-')); // outside this repo: no .framesmith binding above it
process.env.FRAMESMITH_HOME = tmpHome;

const { createCanvas, touchCanvas } = await import('./src/scene-graph.js');
const { parseAndExecute } = await import('./src/operations.js');
const { canvasVersionHash } = await import('./src/version.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Seed the global store the spawned CLI will read (same FRAMESMITH_HOME).
const canvas = createCanvas('Stream Settings');
parseAndExecute(canvas.root, `
f=I("document", { type: "frame", layout: "vertical", gap: 8 })
I(f, { type: "text", content: "Control type", fontSize: 13 })
I(f, { type: "select", value: "Manual" })
`, canvas);
touchCanvas(canvas.id); // persist the ops — the spawned CLI reads the disk store
const goodHash = canvasVersionHash(canvas);

const ENTRY = resolve('src/index.ts');
const TSX = resolve('node_modules/.bin/tsx');

function run(args: string[], opts: { stdin?: string; killAfterMs?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn(TSX, [ENTRY, ...args], {
      cwd: tmpCwd,
      env: { ...process.env, FRAMESMITH_HOME: tmpHome, FRAMESMITH_VIEWER_URL: 'http://localhost:1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    if (opts.stdin) child.stdin.write(opts.stdin);
    const timer = opts.killAfterMs ? setTimeout(() => child.kill('SIGKILL'), opts.killAfterMs) : null;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}

// ── verify ──────────────────────────────────────────────────────────────────
{
  const r = await run(['verify', canvas.id, '--hash', goodHash]);
  check('verify match → exit 0', r.code === 0, `code=${r.code} ${r.stderr}`);
  check('verify match → OK line', r.stdout.includes('OK'), r.stdout);
}
{
  const r = await run(['verify', 'Stream Settings', '--hash', goodHash]);
  check('verify resolves by name', r.code === 0, `code=${r.code} ${r.stderr}`);
}
{
  const r = await run(['verify', canvas.id, '--hash', 'sha256r:0000000000000000', '--json']);
  check('verify mismatch → exit 1', r.code === 1, `code=${r.code}`);
  const out = JSON.parse(r.stdout);
  check('verify --json shape', out.matches === false && out.versionHash === goodHash && out.canvasId === canvas.id, r.stdout);
}
{
  const r = await run(['verify', 'no-such-canvas', '--hash', goodHash]);
  check('unknown canvas → exit 2', r.code === 2, `code=${r.code}`);
}
{
  const r = await run(['verify', canvas.id]);
  check('verify without --hash → exit 2', r.code === 2);
}
{
  const r = await run(['verify', canvas.id, '--hash', goodHash, '--bogus']);
  check('unknown flag → exit 2', r.code === 2, r.stderr.split('\n')[0]);
}
{
  const r = await run(['help']);
  check('help → exit 0 + usage', r.code === 0 && r.stdout.includes('framesmith gate checks'), `code=${r.code}`);
}

// ── check-drift ─────────────────────────────────────────────────────────────
{
  const r = await run(['check-drift', canvas.id]);
  check('check-drift without --url → exit 2 (before Chrome)', r.code === 2, `code=${r.code}`);
}
{
  const PAGE_SELECT = `<!DOCTYPE html><html><body><div><label>Control type</label><select><option selected>Manual</option></select></div></body></html>`;
  const PAGE_RADIOS = `<!DOCTYPE html><html><body><div><label>Control type</label><div><input type="radio" checked><input type="radio"></div></div></body></html>`;
  let page = PAGE_SELECT;
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

  const inSync = await run(['check-drift', canvas.id, '--url', url, '--viewport', '800x600']);
  check('check-drift in sync → exit 0', inSync.code === 0, `code=${inSync.code} ${inSync.stderr.slice(-200)}`);
  check('check-drift in sync → IN SYNC line', inSync.stdout.includes('IN SYNC'), inSync.stdout);

  page = PAGE_RADIOS; // the page now ships radios where the canvas has a select
  const drifted = await run(['check-drift', canvas.id, '--url', url, '--viewport', '800x600', '--json']);
  check('check-drift drifted → exit 1', drifted.code === 1, `code=${drifted.code} ${drifted.stderr.slice(-200)}`);
  const out = JSON.parse(drifted.stdout);
  check('drift --json carries findings + versionHash', out.inSync === false && out.versionHash === goodHash
    && out.findings.some((f: { kind: string }) => f.kind === 'control-mismatch'), drifted.stdout.slice(0, 300));
  server.close();
}

// ── the regression guard: no args still boots the MCP server ────────────────
{
  const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-cli', version: '0' } } }) + '\n';
  const r = await run([], { stdin: initialize, killAfterMs: 15_000 });
  check('no args → MCP initialize handshake answered', r.stdout.includes('"serverInfo"') && r.stdout.includes('framesmith'), r.stdout.slice(0, 200) || r.stderr.slice(0, 200));
}

rmSync(tmpHome, { recursive: true, force: true });
rmSync(tmpCwd, { recursive: true, force: true });
console.log(allPass ? '\nAll CLI tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
