// Smoke for Phase 7 slice 4a: viewer sidebar + project-scoped main pane.
// Verifies the sidebar renders the workspace > project tree, the active
// project is highlighted, canvas grids are scoped to the requested project,
// and the breadcrumb names match.
//
// Usage: npx tsx test/unit/test-viewer-sidebar.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'framesmith-test-'));
process.env.FRAMESMITH_HOME = tmp;

const ws = await import('../../src/workspaces.js');
const sg = await import('../../src/scene-graph.js');
const viewer = await import('../../src/viewer.js');
const { DEFAULT_WORKSPACE_ID, DEFAULT_PROJECT_ID } = await import('../../src/types.js');

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Build a second workspace + projects + canvases for scope/active tests
const acme = ws.createWorkspace('Acme');
const projAcmeA = ws.createProject(acme.id, 'Brand')!;
const projAcmeB = ws.createProject(acme.id, 'Marketing')!;
const projInDefault = ws.createProject(DEFAULT_WORKSPACE_ID, 'Side')!;

// 2 canvases in default project, 3 in Brand, 0 in Marketing, 1 archived in Side
const inDefault1 = sg.createCanvas('home', DEFAULT_PROJECT_ID);
const inDefault2 = sg.createCanvas('about', DEFAULT_PROJECT_ID);
sg.createCanvas('logo', projAcmeA.id);
sg.createCanvas('hero', projAcmeA.id);
sg.createCanvas('footer', projAcmeA.id);
const archivedOne = sg.createCanvas('old', projInDefault.id);
sg.archiveCanvas(archivedOne.id);

// Render the default-project page
const htmlDefault = (await viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001))!;

// ---- 1. Sidebar tree structure ------------------------------------------
// Phase 33 slice A: one nav-item link per project, the current one marked
// with aria-current="page"; an identity dot, the name and a count in each.
interface SidebarItem { current: boolean; label: string; count: number; dot: boolean }
function sidebarItem(html: string, projectId: string): SidebarItem | null {
  const m = new RegExp(`<a href="/project/${projectId}" class="nav-item"( aria-current="page")?>([\\s\\S]*?)</a>`).exec(html);
  if (!m) return null;
  return {
    current: !!m[1],
    label: /<span class="nav-label">([^<]*)<\/span>/.exec(m[2])?.[1] ?? '',
    count: Number(/<span class="nav-count">(\d+)<\/span>/.exec(m[2])?.[1] ?? NaN),
    dot: m[2].includes('class="nav-dot"'),
  };
}
const defaultItem = sidebarItem(htmlDefault, DEFAULT_PROJECT_ID);
const brandItem = sidebarItem(htmlDefault, projAcmeA.id);
check('sidebar: contains the "framesmith" wordmark', htmlDefault.includes('class="sidebar-brand">framesmith<'));
check('sidebar: contains "Personal" workspace label', htmlDefault.includes('>Personal<'));
check('sidebar: contains "Acme" workspace label', htmlDefault.includes('>Acme<'));
check('sidebar: contains "Untitled" project link', defaultItem?.label === 'Untitled', JSON.stringify(defaultItem));
check('sidebar: project rows include an identity dot', defaultItem?.dot === true && brandItem?.dot === true);
check('sidebar: contains "Brand" project link', brandItem?.label === 'Brand');
check('sidebar: contains "Marketing" project link', sidebarItem(htmlDefault, projAcmeB.id)?.label === 'Marketing');

// ---- 2. The requested project is the current place -----------------------
check('sidebar: requested project carries aria-current="page"', defaultItem?.current === true);
check('sidebar: other projects do NOT carry aria-current', brandItem?.current === false);
check('sidebar: exactly one current place on a project page', (htmlDefault.match(/<a [^>]*aria-current="page"/g) ?? []).length === 1);

// ---- 3. Canvas count badges count non-archived canvases per project -----
check('sidebar: default project shows count 2', defaultItem?.count === 2, String(defaultItem?.count));
check('sidebar: Brand project shows count 3', brandItem?.count === 3, String(brandItem?.count));
check('sidebar: Marketing project shows count 0', sidebarItem(htmlDefault, projAcmeB.id)?.count === 0);
check('sidebar: Side project shows count 0 (archived excluded)', sidebarItem(htmlDefault, projInDefault.id)?.count === 0);

// ---- 4. Breadcrumb + main pane title ------------------------------------
check('main: title shows "Untitled"', /<h1 class="page-title">Untitled<\/h1>/.test(htmlDefault));
check('main: project-meta shows "2 canvases"', htmlDefault.includes('2 canvases'));

// ---- 5. Canvas grid is project-scoped -----------------------------------
// Default project shows home + about, NOT the Acme canvases
check('main: grid contains home canvas', htmlDefault.includes(`/canvas/${inDefault1.id}`));
check('main: grid contains about canvas', htmlDefault.includes(`/canvas/${inDefault2.id}`));
check('main: grid does NOT contain Acme canvases', !htmlDefault.includes(`>logo<`) && !htmlDefault.includes(`>hero<`));
check('main: grid does NOT contain archived "old" canvas', !htmlDefault.includes('>old<'));

// ---- 6. Acme project page scoping ---------------------------------------
const htmlAcme = (await viewer.renderProjectPage(projAcmeA.id, 3001))!;
check('acme page: title shows "Brand"', /<h1 class="page-title">Brand<\/h1>/.test(htmlAcme));
check('acme page: the current place is Brand, not Untitled',
  sidebarItem(htmlAcme, projAcmeA.id)?.current === true && sidebarItem(htmlAcme, DEFAULT_PROJECT_ID)?.current === false,
);

// ---- 7. Empty-project state ---------------------------------------------
const htmlEmptyProj = (await viewer.renderProjectPage(projAcmeB.id, 3001))!;
check('empty project: shows "No canvases in Marketing yet"', htmlEmptyProj.includes('No canvases in Marketing yet'));
check('empty project: hint suggests canvas_create with this projectId', htmlEmptyProj.includes(`canvas_create({ projectId: \"${projAcmeB.id}\" })`));

// ---- 8. Unknown project → null (404 path) -------------------------------
check('renderProjectPage: returns null for unknown projectId', (await viewer.renderProjectPage('does-not-exist', 3001)) === null);

// ---- 9. Mobile sidebar toggle (off-canvas drawer below 768px) ------------
check('mobile: page includes sidebar-toggle hamburger button', htmlDefault.includes('class="sidebar-toggle"'));
check('mobile: page includes sidebar-backdrop overlay', htmlDefault.includes('class="sidebar-backdrop"'));
check('mobile: toggleSidebar JS handler is defined', htmlDefault.includes('function toggleSidebar'));
check('mobile: CSS has @media (max-width: 768px) breakpoint', htmlDefault.includes('@media (max-width: 768px)'));
check('mobile: sidebar gets transform off-canvas in mobile CSS', htmlDefault.includes('transform: translateX(-100%)'));

rmSync(tmp, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
