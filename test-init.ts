// Tests for the Phase 15 `init` tool core (issue #64): idempotent onboarding —
// bind the repo, scaffold the convention projects, return live re-keyed IDs.
//
// Covers: fresh bind (default Foundations + UI), idempotent re-call (no dupes,
// stable IDs), custom project list, adopting an existing on-disk binding from a
// session that booted unbound, and the design-system token-count detection.
//
// Usage: npx tsx test-init.ts

import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
const repoRoot2 = mkdtempSync(join(tmpdir(), 'framesmith-repo2-'));
process.env.FRAMESMITH_HOME = globalHome;

const { initWorkspace, prettifyWorkspaceName } = await import('./src/bind.js');
const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, listWorkspaces, setWorkspaceDesignSystem } = await import('./src/workspaces.js');
const { loadPersistedCanvases } = await import('./src/scene-graph.js');
const { resetRepoState } = await import('./src/repo-store.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── prettifyWorkspaceName ─────────────────────────────────────────────────────
check('prettify: dashes → title case', prettifyWorkspaceName('md-toolkit') === 'Md Toolkit');
check('prettify: empty → Design fallback', prettifyWorkspaceName('') === 'Design');

// ── Boot a fresh global session ───────────────────────────────────────────────
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();

// ── Fresh bind from unbound ───────────────────────────────────────────────────
const r1 = initWorkspace({ dir: repoRoot });
if (!r1.ok) { console.log('FAIL  init fresh bind —', r1.error); process.exit(1); }
check('fresh: workspace name from repo folder', typeof r1.workspace.name === 'string' && r1.workspace.name.length > 0, r1.workspace.name);
check('fresh: canvasDir points into the repo', !!r1.workspace.canvasDir && r1.workspace.canvasDir.startsWith(repoRoot), r1.workspace.canvasDir ?? 'null');
check('fresh: workspace ID is repo-keyed', r1.workspace.id.startsWith('repo-ws-'), r1.workspace.id);
check('fresh: exactly Foundations + UI scaffolded', r1.projects.length === 2 && r1.projects.every((p) => ['Foundations', 'UI'].includes(p.name)), r1.projects.map((p) => p.name).join(','));
check('fresh: project IDs are repo-keyed', r1.projects.every((p) => p.id.startsWith('repo-proj-')));
check('fresh: project dirs assigned', r1.projects.every((p) => !!p.dir));
check('fresh: projectsCreated lists both', r1.projectsCreated.length === 2);
check('fresh: workspace.json written on disk', existsSync(join(repoRoot, '.framesmith', 'workspace.json')));
check('fresh: no token count yet', r1.designSystemTokenCount === 0);

// ── Idempotent re-call (now bound) ────────────────────────────────────────────
const r2 = initWorkspace({});
if (!r2.ok) { console.log('FAIL  init re-call —', r2.error); process.exit(1); }
check('idempotent: same workspace ID', r2.workspace.id === r1.workspace.id);
check('idempotent: still exactly 2 projects', r2.projects.length === 2);
check('idempotent: project IDs stable', r2.projects.map((p) => p.id).sort().join() === r1.projects.map((p) => p.id).sort().join());
check('idempotent: nothing created on re-call', r2.projectsCreated.length === 0, r2.projectsCreated.join(','));

// ── Custom project augments the convention set ────────────────────────────────
const r3 = initWorkspace({ projects: ['Onboarding'] });
if (!r3.ok) { console.log('FAIL  init custom —', r3.error); process.exit(1); }
check('custom: Onboarding added (3 total now)', r3.projects.some((p) => p.name === 'Onboarding') && r3.projects.length === 3, r3.projects.map((p) => p.name).join(','));
check('custom: only Onboarding created this call', r3.projectsCreated.length === 1 && r3.projectsCreated[0] === 'Onboarding');

// ── Token-count detection reflects a set design system ────────────────────────
setWorkspaceDesignSystem(r1.workspace.id, { colors: { brand: '#111', surface: '#fff' }, spacing: { md: 12 } });
const r4 = initWorkspace({});
check('tokens: count reflects the set design system', r4.ok && r4.designSystemTokenCount === 3, r4.ok ? String(r4.designSystemTokenCount) : 'err');

// ── Adopt an existing on-disk binding from an unbound boot ─────────────────────
// Simulate a fresh process started OUTSIDE the bound repo: reset state, boot
// global, then init pointed at the already-bound repo dir should adopt it.
resetRepoState();
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();
check('adopt setup: session is unbound (Personal present)', listWorkspaces().some((w) => w.name === 'Personal'));

const r5 = initWorkspace({ dir: repoRoot });
if (!r5.ok) { console.log('FAIL  init adopt —', r5.error); process.exit(1); }
check('adopt: re-attaches to the existing repo workspace', r5.workspace.id === r1.workspace.id, `${r5.workspace.id} vs ${r1.workspace.id}`);
check('adopt: existing projects visible (3)', r5.projects.length === 3);
check('adopt: created nothing (all already present)', r5.projectsCreated.length === 0);

// ── A second, independent fresh bind works after a reset ──────────────────────
resetRepoState();
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();
const r6 = initWorkspace({ dir: repoRoot2, workspaceName: 'Explicit Name' });
check('second repo: honors explicit workspaceName', r6.ok && r6.workspace.name === 'Explicit Name', r6.ok ? r6.workspace.name : 'err');
check('second repo: files land in its own dir', existsSync(join(repoRoot2, '.framesmith', 'workspace.json')));

console.log(allPass ? '\nINIT TEST PASSED ✅' : '\nINIT TEST FAILED ✗');
process.exit(allPass ? 0 : 1);
