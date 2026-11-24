// Phase 33 — the viewer fixture store (PHASE-33-SPEC §3 PLAN). Seeds whatever
// store FRAMESMITH_HOME points at (import '../env.js' first, so that is a temp
// dir) with what the viewer's pages and screenshots need:
//
//   Personal / Untitled        the default project, empty (the empty state)
//   Personal / Pattern library a copy of the repo's pattern library, plus a
//                              mobile and a desktop-app canvas, one canvas with
//                              two state variants, one empty canvas, one canvas
//                              with open and resolved comments, and canvases
//                              scoring exactly 96 and 95
//   Personal / Archived work   three archived canvases
//
// Built through the store's own functions rather than checked in as JSON, so it
// follows the canvas format as it changes. Copies keep their source's dates, so
// "Edited <date>" is stable.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, createProject } from '../../src/workspaces.js';
import { createCanvas, touchCanvas, addVariant, archiveCanvas, getCanvas } from '../../src/scene-graph.js';
import { applyStructure } from '../../src/structures.js';
import { parseAndExecute } from '../../src/operations.js';
import { addFeedback, resolveFeedback } from '../../src/feedback.js';
import { DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_ID, type Canvas } from '../../src/types.js';

export interface ViewerStore {
  patternProjectId: string;
  archivedProjectId: string;
  /** Canvas ids by role: each pattern copy by its source name, plus mobile,
   * desktopApp, withStates, blank, withFeedback, at96, at95, archived1..3. */
  ids: Record<string, string>;
}

const PATTERN_DIR = join('.framesmith', 'pattern-library');

/** A copy of a repo canvas file in `projectId`, keeping its content and dates. */
function copyCanvas(file: string, projectId: string, name?: string): Canvas {
  const source = JSON.parse(readFileSync(join(PATTERN_DIR, file), 'utf-8')) as Canvas;
  const canvas = createCanvas(name ?? source.name, projectId);
  canvas.root = source.root;
  canvas.variables = source.variables ?? {};
  canvas.components = source.components ?? {};
  canvas.metadata = { ...(source.metadata ?? {}) };
  touchCanvas(canvas.id);
  canvas.createdAt = source.createdAt;
  canvas.lastModified = source.lastModified;
  return canvas;
}

export function seedViewerStore(): ViewerStore {
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();
  const pattern = createProject(DEFAULT_WORKSPACE_ID, 'Pattern library')!;
  const archivedProject = createProject(DEFAULT_WORKSPACE_ID, 'Archived work')!;
  const ids: Record<string, string> = {};

  for (const file of readdirSync(PATTERN_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const c = copyCanvas(file, pattern.id);
    ids[c.name] = c.id;
  }

  // One canvas of each other type, from their realisations.
  const mobile = createCanvas('mobile-dashboard', pattern.id, {}, { type: 'mobile' });
  applyStructure(mobile, 'dashboard');
  touchCanvas(mobile.id);
  ids.mobile = mobile.id;
  const app = createCanvas('file-browser', pattern.id, {}, { type: 'desktop-app' });
  applyStructure(app, 'browser');
  touchCanvas(app.id);
  ids.desktopApp = app.id;

  // A screen with two designed states.
  const withStates = copyCanvas('settings.json', pattern.id, 'settings-states');
  addVariant(withStates.id, 'empty');
  addVariant(withStates.id, 'loading');
  ids.withStates = withStates.id;

  ids.blank = createCanvas('blank', pattern.id).id;

  // Open and resolved point-and-tell comments.
  const withFeedback = copyCanvas('auth.json', pattern.id, 'auth-feedback');
  const target = withFeedback.root.children?.[0]?.id;
  addFeedback(withFeedback, { comment: 'The sign-in button reads too quiet.', ...(target ? { nodeId: target } : {}) });
  const done = addFeedback(withFeedback, { comment: 'Tighten the heading spacing.' });
  resolveFeedback(withFeedback, [done.id], 'agent', 'Spacing moved to the scale.');
  touchCanvas(withFeedback.id);
  ids.withFeedback = withFeedback.id;

  // Either side of the bar (a score above 95): the pattern library's own
  // dashboard scores 95, and a marquee-hero copy (100) with an off-scale note
  // (13px, low contrast) and one off-scale gap scores 96. The fixture test
  // asserts both, so a scoring change shows up there, not in a page test.
  ids.at95 = ids.dashboard;
  const at96 = copyCanvas('marquee-hero.json', pattern.id, 'marquee-96');
  parseAndExecute(at96.root, AT_96_OPS, at96);
  touchCanvas(at96.id);
  ids.at96 = at96.id;

  // Three archived canvases, newest last.
  for (let i = 1; i <= 3; i++) {
    const c = copyCanvas(['pricing.json', 'stat-led.json', 'bento-grid.json'][i - 1], archivedProject.id, `old-${i}`);
    archiveCanvas(c.id);
    getCanvas(c.id)!.archivedAt = new Date(Date.UTC(2026, 10, 10 + i)).toISOString();
    ids[`archived${i}`] = c.id;
  }

  return { patternProjectId: pattern.id, archivedProjectId: archivedProject.id, ids };
}

const AT_96_OPS = [
  'I("mh-hero", { type: "text", name: "Off-scale note", content: "Draft note", fontSize: 13 })',
  'I("mh-hero", { type: "frame", name: "Off-scale gap", width: 100, height: 40, gap: 13, layout: "horizontal" })',
].join('\n');

export { DEFAULT_PROJECT_ID };
