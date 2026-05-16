// Smoke for Phase 7 slice 4a: viewer sidebar + project-scoped main pane.
// Verifies the sidebar renders the workspace > project tree, the active
// project is highlighted, canvas grids are scoped to the requested project,
// and the breadcrumb names match.
//
// Usage: npx tsx test-viewer-sidebar.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'canvas-mcp-test-'));
process.env.CANVAS_MCP_HOME = tmp;

const ws = await import('./src/workspaces.js');
const sg = await import('./src/scene-graph.js');
const viewer = await import('./src/viewer.js');
const { DEFAULT_WORKSPACE_ID, DEFAULT_PROJECT_ID } = await import('./src/types.js');

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
const htmlDefault = viewer.renderProjectPage(DEFAULT_PROJECT_ID, 3001)!;

// ---- 1. Sidebar tree structure ------------------------------------------
check('sidebar: contains "Canvas MCP" logo', htmlDefault.includes('sidebar-logo'));
check('sidebar: contains "Personal" workspace label', htmlDefault.includes('>Personal<'));
check('sidebar: contains "Acme" workspace label', htmlDefault.includes('>Acme<'));
check('sidebar: contains "Untitled" project link', /\/project\/default-project[^"]*"[^>]*class="project[^"]*"[\s\S]*?<span class="project-name">Untitled/.test(htmlDefault));
check('sidebar: project rows include a project-dot', /<span class="project-dot"/.test(htmlDefault));
check('sidebar: active project row includes a project-bar focus rail', /class="project active"[\s\S]*?<span class="project-bar"/.test(htmlDefault));
check('sidebar: contains "Brand" project link', new RegExp(`/project/${projAcmeA.id}`).test(htmlDefault));
check('sidebar: contains "Marketing" project link', new RegExp(`/project/${projAcmeB.id}`).test(htmlDefault));

// ---- 2. Active highlight on the requested project -----------------------
const activeRegex = new RegExp(`<a href="/project/${DEFAULT_PROJECT_ID}"[^>]*class="project active"`);
check('sidebar: requested project carries `active` class', activeRegex.test(htmlDefault));

const inactiveRegex = new RegExp(`<a href="/project/${projAcmeA.id}"[^>]*class="project"(?!\\s*active)`);
check('sidebar: other projects do NOT carry `active` class', inactiveRegex.test(htmlDefault));

// ---- 3. Canvas count badges count non-archived canvases per project -----
// Default project has 2 active canvases (home + about)
check('sidebar: default project shows count 2', /default-project[^"]*"[^>]*class="project active"[^>]*>[\s\S]*?>2<\/span>/.test(htmlDefault));
// Brand has 3
check('sidebar: Brand project shows count 3', new RegExp(`${projAcmeA.id}[^"]*"[^>]*class="project"[^>]*>[\\s\\S]*?>3<\/span>`).test(htmlDefault));
// Marketing has 0
check('sidebar: Marketing project shows count 0', new RegExp(`${projAcmeB.id}[^"]*"[^>]*class="project"[^>]*>[\\s\\S]*?>0<\/span>`).test(htmlDefault));
// Side has 1 archived canvas, count should be 0 (archived excluded)
check('sidebar: Side project shows count 0 (archived excluded)', new RegExp(`${projInDefault.id}[^"]*"[^>]*class="project"[^>]*>[\\s\\S]*?>0<\/span>`).test(htmlDefault));

// ---- 4. Breadcrumb + main pane title ------------------------------------
check('main: breadcrumb shows "Personal / Untitled"', htmlDefault.includes('Personal / Untitled'));
check('main: title shows "Untitled"', /<h1 class="project-title">Untitled<\/h1>/.test(htmlDefault));
check('main: project-meta shows "2 canvases"', htmlDefault.includes('2 canvases'));

// ---- 5. Canvas grid is project-scoped -----------------------------------
// Default project shows home + about, NOT the Acme canvases
check('main: grid contains home canvas', htmlDefault.includes(`/canvas/${inDefault1.id}`));
check('main: grid contains about canvas', htmlDefault.includes(`/canvas/${inDefault2.id}`));
check('main: grid does NOT contain Acme canvases', !htmlDefault.includes(`>logo<`) && !htmlDefault.includes(`>hero<`));
check('main: grid does NOT contain archived "old" canvas', !htmlDefault.includes('>old<'));

// ---- 6. Acme project page scoping ---------------------------------------
const htmlAcme = viewer.renderProjectPage(projAcmeA.id, 3001)!;
check('acme page: breadcrumb shows "Acme / Brand"', htmlAcme.includes('Acme / Brand'));
check('acme page: title shows "Brand"', /<h1 class="project-title">Brand<\/h1>/.test(htmlAcme));
check('acme page: active highlight is on Brand, not Untitled',
  new RegExp(`<a href="/project/${projAcmeA.id}"[^>]*class="project active"`).test(htmlAcme) &&
  new RegExp(`<a href="/project/${DEFAULT_PROJECT_ID}"[^>]*class="project"(?!\\s*active)`).test(htmlAcme),
);

// ---- 7. Empty-project state ---------------------------------------------
const htmlEmptyProj = viewer.renderProjectPage(projAcmeB.id, 3001)!;
check('empty project: shows "No canvases in Marketing yet"', htmlEmptyProj.includes('No canvases in Marketing yet'));
check('empty project: hint suggests canvas_create with this projectId', htmlEmptyProj.includes(`canvas_create({ projectId: \"${projAcmeB.id}\" })`));

// ---- 8. Unknown project → null (404 path) -------------------------------
check('renderProjectPage: returns null for unknown projectId', viewer.renderProjectPage('does-not-exist', 3001) === null);

// ---- 9. Mobile sidebar toggle (off-canvas drawer below 768px) ------------
check('mobile: page includes sidebar-toggle hamburger button', htmlDefault.includes('class="sidebar-toggle"'));
check('mobile: page includes sidebar-backdrop overlay', htmlDefault.includes('class="sidebar-backdrop"'));
check('mobile: toggleSidebar JS handler is defined', htmlDefault.includes('function toggleSidebar'));
check('mobile: CSS has @media (max-width: 768px) breakpoint', htmlDefault.includes('@media (max-width: 768px)'));
check('mobile: sidebar gets transform off-canvas in mobile CSS', htmlDefault.includes('transform: translateX(-100%)'));

rmSync(tmp, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
