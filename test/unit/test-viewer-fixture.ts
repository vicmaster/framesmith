// Phase 33 — the viewer fixture store holds what the spec says it holds, and
// its two canvases either side of the bar score exactly 96 and 95. When scoring
// changes, this test names it instead of a gallery test failing obscurely.
//
// Usage: npx tsx test/unit/test-viewer-fixture.ts

import '../env.js';
import { listCanvases, getCanvas } from '../../src/scene-graph.js';
import { listProjects } from '../../src/workspaces.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { resolveSurface } from '../../src/surfaces.js';
import { DEFAULT_PROJECT_ID } from '../../src/types.js';
import { seedViewerStore } from '../fixtures/viewer-store.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const store = seedViewerStore();
const rows = listCanvases();
const inProject = (projectId: string) => rows.filter((r) => r.projectId === projectId);
const score = async (id: string) => {
  const row = rows.find((r) => r.id === id)!;
  return (await evaluateCanvas(getCanvas(id)!, { mode: 'fast', designedStates: row.variants?.map((v) => v.state) ?? [] })).overallScore;
};

check('three projects: Untitled, Pattern library, Archived work',
  JSON.stringify(listProjects().map((p) => p.name).sort()) === JSON.stringify(['Archived work', 'Pattern library', 'Untitled']));
check('the default project is empty', inProject(DEFAULT_PROJECT_ID).length === 0);

const pattern = inProject(store.patternProjectId);
check('the pattern library copies all eleven repo canvases', ['auth', 'bento-grid', 'catalogue', 'dashboard', 'editorial-longform', 'marquee-hero', 'onboarding', 'pricing', 'settings', 'split-workbench', 'stat-led'].every((n) => pattern.some((r) => r.name === n)));
check('one mobile and one desktop-app canvas', resolveSurface(getCanvas(store.ids.mobile)!).type === 'mobile' && resolveSurface(getCanvas(store.ids.desktopApp)!).type === 'desktop-app');
const states = rows.find((r) => r.id === store.ids.withStates)?.variants?.map((v) => v.state).sort();
check('one canvas with the empty and loading states', JSON.stringify(states) === '["empty","loading"]', JSON.stringify(states));
check('one empty canvas', (getCanvas(store.ids.blank)!.root.children ?? []).length === 0);
check('one canvas with a dark token layer', Object.keys(getCanvas(store.ids.themed)!.variables?.dark?.colors ?? {}).length > 0);
const feedback = getCanvas(store.ids.withFeedback)!.metadata?.feedback ?? [];
check('one canvas with an open and a resolved comment', feedback.filter((e) => !e.resolvedAt).length === 1 && feedback.filter((e) => e.resolvedAt).length === 1);
check('copies keep their source dates', getCanvas(store.ids.auth)!.lastModified.startsWith('2026-06-26'), getCanvas(store.ids.auth)!.lastModified);

check('marquee-hero scores 100', (await score(store.ids['marquee-hero'])) === 100);
const at96 = await score(store.ids.at96);
check('the at-the-bar canvas scores exactly 96', at96 === 96, String(at96));
const at95 = await score(store.ids.at95);
check('the below-the-bar canvas scores exactly 95', at95 === 95, String(at95));

const archived = inProject(store.archivedProjectId);
check('three archived canvases in Archived work', archived.length === 3 && archived.every((r) => r.archived));
check('archived canvases carry distinct archive dates', new Set(archived.map((r) => getCanvas(r.id)!.archivedAt)).size === 3);

process.exit(allPass ? 0 : 1);
