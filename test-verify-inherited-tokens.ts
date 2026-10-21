// #217 — the end-to-end repro: in a bound repo, a design-system edit in
// .framesmith/workspace.json (workspace OR project layer) restyles an approved
// canvas, so `framesmith verify` must report STALE. Before #217 the hash
// covered only the canvas's own tokens and verify kept printing OK. Legacy
// sha256: hashes still verify, with a warning. Spawns the real CLI entry, the
// same way test-cli.ts does, but needs no Chrome (verify never touches it).
//
// Usage: npx tsx test-verify-inherited-tokens.ts

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-verify-home-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-verify-repo-'));
process.env.FRAMESMITH_HOME = globalHome;

const sg = await import('./src/scene-graph.js');
const ws = await import('./src/workspaces.js');
const { bindRepo } = await import('./src/bind.js');
const { parseAndExecute } = await import('./src/operations.js');
const { canvasVersionHash, legacyCanvasVersionHash } = await import('./src/version.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Bind a workspace whose design system defines $primary; the canvas only
// references it — it has no tokens of its own.
ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();
const w = ws.createWorkspace('Acme');
ws.setWorkspaceDesignSystem(w.id, { colors: { primary: '#2563EB' } });
const ui = ws.createProject(w.id, 'UI')!;
const c = sg.createCanvas('Pricing Card', ui.id);
parseAndExecute(c.root, `card=I("document", { type: "frame", fill: "$primary", padding: 24 })`, c);
sg.touchCanvas(c.id);
check('bind succeeded', bindRepo({ workspaceId: w.id, dir: repoRoot }).ok);

const ENTRY = resolve('src/index.ts');
const TSX = resolve('node_modules/.bin/tsx');
function verify(hash: string, json = false): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const args = [ENTRY, 'verify', 'Pricing Card', '--hash', hash, '--project-dir', repoRoot, ...(json ? ['--json'] : [])];
    const child = spawn(TSX, args, { cwd: repoRoot, env: { ...process.env, FRAMESMITH_HOME: globalHome, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => res({ code, stdout, stderr }));
  });
}

const wsFile = join(repoRoot, '.framesmith', 'workspace.json');
function editWorkspaceFile(mutate: (wf: { designSystem?: { colors?: Record<string, string> }; projects: { name: string; designSystem?: { colors?: Record<string, string> } }[] }) => void) {
  const wf = JSON.parse(readFileSync(wsFile, 'utf-8'));
  mutate(wf);
  writeFileSync(wsFile, JSON.stringify(wf, null, 2));
}

// Record the approval the way a gate would: from the CLI's own output.
const recorded = JSON.parse((await verify('sha256r:0000000000000000', true)).stdout).versionHash as string;
check('recorded hash is the sha256r: format', /^sha256r:[0-9a-f]{16}$/.test(recorded), recorded);
const legacy = legacyCanvasVersionHash(c);
check('in-process hash matches the CLI before any edit', canvasVersionHash(c) === recorded, `${canvasVersionHash(c)} vs ${recorded}`);

{
  const r = await verify(recorded);
  check('unchanged design → OK, exit 0', r.code === 0 && r.stdout.includes('OK'), `code=${r.code} ${r.stdout}${r.stderr}`);
}

// Step 2 of the repro: hand-edit the WORKSPACE design system on disk.
editWorkspaceFile((wf) => { wf.designSystem = { ...wf.designSystem, colors: { ...wf.designSystem?.colors, primary: '#DC2626' } }; });
let afterWorkspace: string;
{
  const r = await verify(recorded, true);
  const out = JSON.parse(r.stdout);
  afterWorkspace = out.versionHash;
  check('workspace token edit → STALE, exit 1', r.code === 1 && out.matches === false, `code=${r.code} ${r.stdout}`);
}
{
  const r = await verify(legacy);
  check('legacy hash after the same edit → still OK (legacy algorithm), exit 0', r.code === 0 && r.stdout.includes('OK'), `code=${r.code} ${r.stdout}`);
  check('legacy hash → WARNING on stderr naming inherited tokens', r.stderr.includes('WARNING') && r.stderr.includes('inherit'), r.stderr);
}
{
  const r = await verify(legacy, true);
  const out = JSON.parse(r.stdout);
  check('legacy hash --json carries warning + current versionHash', typeof out.warning === 'string' && out.versionHash === afterWorkspace, r.stdout);
}

// The same for the PROJECT layer.
editWorkspaceFile((wf) => {
  const p = wf.projects.find((x) => x.name === 'UI')!;
  p.designSystem = { ...p.designSystem, colors: { ...p.designSystem?.colors, primary: '#16A34A' } };
});
let afterProject: string;
{
  const r = await verify(afterWorkspace, true);
  const out = JSON.parse(r.stdout);
  afterProject = out.versionHash;
  check('project token edit → STALE, exit 1', r.code === 1 && out.matches === false, `code=${r.code} ${r.stdout}`);
}

// This process never restarted, but it reloads workspace.json when it changes
// on disk, so its hash agrees with the CLI's fresh read of the edited file.
check('in-process hash follows the hand edits without a restart', canvasVersionHash(c) === afterProject, `${canvasVersionHash(c)} vs ${afterProject}`);

rmSync(globalHome, { recursive: true, force: true });
rmSync(repoRoot, { recursive: true, force: true });
console.log(allPass ? '\nAll verify-inherited-tokens tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
