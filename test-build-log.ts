// T8 round-trip test for Phase 11 Slice B: build log + provenance persistence.
//
// Mirrors the apply_structure / apply_preset handler wiring (which can't be
// unit-tested through index.ts) against both backends:
//   - global  → ~/.framesmith/build-logs.json (single file keyed by projectId)
//   - repo    → .framesmith/<projectDir>/build-log.json (per project subdir)
// Verifies: provenance is stamped + survives a canvas reload; build-log entries
// survive bind + a simulated restart; preset updates the latest entry in place
// (and appends a minimal entry on a hand-built canvas); files serialize
// deterministically (stableStringify — sorted keys + trailing newline).
//
// Usage: npx tsx test-build-log.ts

import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const globalHome = mkdtempSync(join(tmpdir(), 'framesmith-global-'));
const repoRoot = mkdtempSync(join(tmpdir(), 'framesmith-repo-'));
process.env.FRAMESMITH_HOME = globalHome;

// Import AFTER setting the env var so first reads see it.
const { createCanvas, getCanvas, touchCanvas, loadPersistedCanvases } = await import('./src/scene-graph.js');
const { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createWorkspace, createProject, listProjects, getCanvasTokens, loadRepoWorkspace } = await import('./src/workspaces.js');
const { applyStructure } = await import('./src/structures.js');
const { bindRepo } = await import('./src/bind.js');
const { appendBuildLog, readBuildLog, recordPresetInBuildLog, detectBinding, readWorkspaceFile, setRepoBackend, resetRepoState, stableStringify } = await import('./src/repo-store.js');

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** Mirror the apply_structure handler: stamp the scaffold + log its provenance. */
function applyStructureLikeHandler(canvasId: string, structure: string) {
  const canvas = getCanvas(canvasId)!;
  const existingColors = new Set(Object.keys(getCanvasTokens(canvas).colors ?? {}));
  applyStructure(canvas, structure, { existingColors });
  const prov = canvas.metadata?.provenance;
  if (prov) appendBuildLog(canvas.projectId, { ...prov, canvasId: canvas.id, canvasName: canvas.name });
  touchCanvas(canvasId);
}

/** Mirror the apply_preset handler: stamp the preset + update the build log. */
function applyPresetLikeHandler(canvasId: string, preset: string) {
  const canvas = getCanvas(canvasId)!;
  canvas.metadata = {
    ...canvas.metadata,
    provenance: { ...canvas.metadata?.provenance, preset, at: new Date().toISOString() },
  };
  recordPresetInBuildLog(canvas.projectId, canvas.id, canvas.name, preset);
  touchCanvas(canvasId);
}

// ── Boot global store ────────────────────────────────────────────────────────
loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
loadPersistedCanvases();

// ════════════════════════════════════════════════════════════════════════════
// GLOBAL BACKEND
// ════════════════════════════════════════════════════════════════════════════
const ws = createWorkspace('Log Test');
const projA = createProject(ws.id, 'Proj A')!;
const projB = createProject(ws.id, 'Proj B')!;

const alpha = createCanvas('Alpha', projA.id);
applyStructureLikeHandler(alpha.id, 'marquee-hero');

const logA = readBuildLog(projA.id);
check('global: build log has 1 entry for proj A', logA.length === 1, `len=${logA.length}`);
check('global: entry records the structure', logA[0]?.structure === 'marquee-hero');
check('global: entry carries taxonomy axes', logA[0]?.axes?.heroTreatment === 'marquee');
check('global: entry carries canvasId + name', logA[0]?.canvasId === alpha.id && logA[0]?.canvasName === 'Alpha');
check('global: entry has an ISO timestamp', typeof logA[0]?.at === 'string');

// Keying isolation — a second project's log is independent.
const beta = createCanvas('Beta', projB.id);
applyStructureLikeHandler(beta.id, 'bento-grid');
check('global: proj B log is isolated (1 entry, bento-grid)', readBuildLog(projB.id).length === 1 && readBuildLog(projB.id)[0].structure === 'bento-grid');
check('global: proj A log unaffected by proj B write', readBuildLog(projA.id).length === 1 && readBuildLog(projA.id)[0].structure === 'marquee-hero');

// Preset updates the latest entry in place (no new entry, structure preserved).
applyPresetLikeHandler(alpha.id, 'dark');
const logA2 = readBuildLog(projA.id);
check('global: preset updates latest entry in place (still 1)', logA2.length === 1, `len=${logA2.length}`);
check('global: preset recorded on the entry', logA2[0]?.preset === 'dark');
check('global: structure preserved through preset update', logA2[0]?.structure === 'marquee-hero');

// Preset on a hand-built canvas with no prior provenance → minimal entry (A-T3).
const gamma = createCanvas('Gamma', projA.id);
applyPresetLikeHandler(gamma.id, 'light');
const logA3 = readBuildLog(projA.id);
check('global: preset on hand-built canvas appends a minimal entry', logA3.length === 2, `len=${logA3.length}`);
const gammaEntry = logA3.find((e) => e.canvasId === gamma.id);
check('global: minimal entry has preset but no structure', gammaEntry?.preset === 'light' && gammaEntry?.structure === undefined);

// Deterministic on-disk serialization.
const globalLogFile = join(globalHome, 'build-logs.json');
check('global: build-logs.json written at the flat global path', existsSync(globalLogFile));
const graw = readFileSync(globalLogFile, 'utf-8');
check('global: file ends with a trailing newline', graw.endsWith('\n'));
check('global: file content is stable (sorted keys)', graw === stableStringify(JSON.parse(graw)));

// Provenance survives a canvas reload from disk.
loadPersistedCanvases();
const alphaReloaded = getCanvas(alpha.id)!;
check('global: canvas provenance survives reload (structure + preset)',
  alphaReloaded.metadata?.provenance?.structure === 'marquee-hero' && alphaReloaded.metadata?.provenance?.preset === 'dark');

// ════════════════════════════════════════════════════════════════════════════
// REPO BACKEND (bind + simulated restart)
// ════════════════════════════════════════════════════════════════════════════
const canvasDir = join(repoRoot, '.framesmith');
const wsRepo = createWorkspace('Repo WS');
createProject(wsRepo.id, 'UI')!;

const bound = bindRepo({ workspaceId: wsRepo.id, dir: repoRoot });
check('repo: bind succeeded', bound.ok, bound.ok ? '' : bound.error);

const virtualUi = listProjects().find((p) => p.name === 'UI')!;
const repoHero = createCanvas('Repo Hero', virtualUi.id);
applyStructureLikeHandler(repoHero.id, 'split-workbench');

const wf = readWorkspaceFile(canvasDir)!;
const uiDir = wf.projects.find((p) => p.id === virtualUi.id)!.dir;
check('repo: build-log.json lives in the project subdir', existsSync(join(canvasDir, uiDir, 'build-log.json')));

const rraw = readFileSync(join(canvasDir, uiDir, 'build-log.json'), 'utf-8');
check('repo: build-log.json ends with a trailing newline', rraw.endsWith('\n'));
check('repo: build-log.json is stable (sorted keys)', rraw === stableStringify(JSON.parse(rraw)));

// Simulate a fresh process / clone.
resetRepoState();
const detected = detectBinding(repoRoot)!;
check('repo: detectBinding finds the binding', !!detected && detected.dir === canvasDir);
const wf2 = readWorkspaceFile(detected.dir)!;
setRepoBackend(detected.root, detected.dir);
loadRepoWorkspace(wf2);
const count = loadPersistedCanvases();
check('repo: exactly the canvas reloads (build-log.json not mistaken for a canvas)', count === 1, `count=${count}`);

const heroReloaded = getCanvas(repoHero.id)!;
check('repo: canvas provenance survives reload', heroReloaded.metadata?.provenance?.structure === 'split-workbench');
const rlog = readBuildLog(heroReloaded.projectId);
check('repo: build log survives reload', rlog.length === 1 && rlog[0].structure === 'split-workbench' && rlog[0].canvasId === repoHero.id);

// Preset update routes to the repo file after reload.
applyPresetLikeHandler(heroReloaded.id, 'minimal');
const rlog2 = readBuildLog(heroReloaded.projectId);
check('repo: preset updates latest entry in place', rlog2.length === 1 && rlog2[0].preset === 'minimal' && rlog2[0].structure === 'split-workbench');

console.log(allPass ? '\nT8 BUILD-LOG TEST PASSED ✅' : '\nT8 BUILD-LOG TEST FAILED ✗');
process.exit(allPass ? 0 : 1);
