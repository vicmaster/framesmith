import './test-env.js';
// Standalone-viewer live updates: watchAggregateSources must fire a reload for
// EVERY aggregation source — the global store, registry.json, and (the bug
// this test pins) every bound repo's .framesmith/, including per-project
// subdirs and repos bound AFTER the watcher started. Uses real fs.watch with
// generous polling timeouts.
//
// Usage: npx tsx test-viewer-watch.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { watchAggregateSources } from './src/aggregate.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

const DATA_DIR = process.env.FRAMESMITH_HOME!;
const CANVAS_DIR = join(DATA_DIR, 'canvases');
mkdirSync(CANVAS_DIR, { recursive: true });

// A fake bound repo with a project subdir (the real layout).
const repo1 = join(mkdtempSync(join(tmpdir(), 'fs-repo1-')), '.framesmith');
mkdirSync(join(repo1, 'repo-proj'), { recursive: true });
writeFileSync(join(DATA_DIR, 'registry.json'), JSON.stringify({ repos: [repo1] }));

let reloads = 0;
const dispose = watchAggregateSources(DATA_DIR, () => { reloads++; });

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function firedAfter(action: () => void, timeoutMs = 4000): Promise<boolean> {
  const before = reloads;
  action();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (reloads > before) return true;
    await settle(100);
  }
  return false;
}

try {
  // ── 1. global canvas write fires ───────────────────────────────────────────
  expect('global canvas write triggers a reload',
    await firedAfter(() => writeFileSync(join(CANVAS_DIR, 'c1.json'), '{}')));

  // ── 2. bound-repo canvas write fires (the #magma-core bug) ────────────────
  expect('bound-repo canvas write (project subdir) triggers a reload',
    await firedAfter(() => writeFileSync(join(repo1, 'repo-proj', 'canvas-a.json'), '{}')));

  // ── 3. workspace.json write in the repo fires ──────────────────────────────
  expect('bound-repo workspace.json write triggers a reload',
    await firedAfter(() => writeFileSync(join(repo1, 'workspace.json'), '{}')));

  // ── 4. non-JSON writes (assets) do NOT fire ────────────────────────────────
  {
    const before = reloads;
    writeFileSync(join(repo1, 'asset.png'), 'binary');
    await settle(800);
    expect('asset (non-JSON) writes are ignored', reloads === before, String(reloads - before));
  }

  // ── 5. a repo bound WHILE the viewer runs starts updating live ─────────────
  const repo2 = join(mkdtempSync(join(tmpdir(), 'fs-repo2-')), '.framesmith');
  mkdirSync(join(repo2, 'repo-proj2'), { recursive: true });
  expect('registry change triggers a reload',
    await firedAfter(() => writeFileSync(join(DATA_DIR, 'registry.json'), JSON.stringify({ repos: [repo1, repo2] }))));
  await settle(500); // let syncRepoWatchers attach repo2
  expect('a repo bound after startup is watched too',
    await firedAfter(() => writeFileSync(join(repo2, 'repo-proj2', 'canvas-b.json'), '{}')));

  // ── 6. dispose stops everything ─────────────────────────────────────────────
  dispose();
  {
    const before = reloads;
    writeFileSync(join(repo1, 'repo-proj', 'canvas-c.json'), '{}');
    writeFileSync(join(CANVAS_DIR, 'c2.json'), '{}');
    await settle(800);
    expect('dispose() stops all watchers', reloads === before, String(reloads - before));
  }
} finally {
  dispose();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
