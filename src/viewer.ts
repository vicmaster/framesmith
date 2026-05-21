import { createServer, type Server } from 'node:http';
import { getCanvas, listCanvases, archiveCanvas, unarchiveCanvas, deleteCanvas } from './scene-graph.js';
import { resolveVariables } from './variables.js';
import { renderToHtml } from './renderer.js';
import { getProject, listProjects, listWorkspaces, getCanvasTokens } from './workspaces.js';
import { getRepoLocation, archiveRepoCanvas, deleteRepoCanvas } from './aggregate.js';
import { DEFAULT_PROJECT_ID, type Canvas } from './types.js';

let runningPort: number | null = null;
let externalViewerUrl: string | null = null;
const BASE_PORT = 3001;
const MAX_ATTEMPTS = 20;

/**
 * Set an external viewer URL (used when a standalone viewer is already running).
 * When set, getViewerUrl() returns this instead of the built-in server's URL.
 */
export function setExternalViewerUrl(url: string): void {
  externalViewerUrl = url;
}

export function getViewerUrl(): string | null {
  if (externalViewerUrl) return externalViewerUrl;
  return runningPort ? `http://localhost:${runningPort}` : null;
}

function tryListen(httpServer: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      httpServer.removeListener('error', onError);
      if (err.code === 'EADDRINUSE') {
        reject(err);
      } else {
        reject(err);
      }
    };
    httpServer.on('error', onError);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.removeListener('error', onError);
      resolve(port);
    });
  });
}

export async function startViewer(port: number): Promise<number> {
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${runningPort ?? port}`);
    const path = url.pathname;

    // CORS headers for API routes
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // API: list canvases
      if (path === '/api/canvases') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(listCanvases()));
        return;
      }

      // API: canvas meta (for polling)
      const metaMatch = path.match(/^\/api\/canvas\/([^/]+)\/meta$/);
      if (metaMatch) {
        const canvas = getCanvas(metaMatch[1]);
        if (!canvas) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          id: canvas.id,
          name: canvas.name,
          lastModified: canvas.lastModified,
          width: canvas.root.width,
          height: canvas.root.height,
        }));
        return;
      }

      // Canvas raw HTML (for iframe) — supports ?w=WIDTH&h=HEIGHT overrides
      const htmlMatch = path.match(/^\/canvas\/([^/]+)\/html$/);
      if (htmlMatch) {
        const canvas = getCanvas(htmlMatch[1]);
        if (!canvas) { res.writeHead(404); res.end('Not found'); return; }
        const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
        const defaultW = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
        const defaultH = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
        const w = url.searchParams.has('w') ? parseInt(url.searchParams.get('w')!, 10) : defaultW;
        const h = url.searchParams.has('h') ? parseInt(url.searchParams.get('h')!, 10) : defaultH;
        const html = renderToHtml(resolved, w, h, canvas);
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }

      // Canvas JSON
      const jsonMatch = path.match(/^\/canvas\/([^/]+)\/json$/);
      if (jsonMatch) {
        const canvas = getCanvas(jsonMatch[1]);
        if (!canvas) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(canvas, null, 2));
        return;
      }

      // Canvas detail page
      const detailMatch = path.match(/^\/canvas\/([^/]+)$/);
      if (detailMatch) {
        const canvas = getCanvas(detailMatch[1]);
        if (!canvas) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'text/html');
        res.end(renderDetailPage(canvas, runningPort ?? 3001));
        return;
      }

      // Project page
      const projectMatch = path.match(/^\/project\/([^/]+)$/);
      if (projectMatch) {
        const html = renderProjectPage(projectMatch[1], runningPort ?? 3001);
        if (!html) { res.writeHead(404); res.end('Project not found'); return; }
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }

      // Archive page
      if (path === '/archive') {
        res.setHeader('Content-Type', 'text/html');
        res.end(renderArchivePage(runningPort ?? 3001));
        return;
      }

      // Lifecycle API: archive / unarchive / delete a canvas. Three small
      // wrappers around the scene-graph functions so the viewer's action
      // buttons (archive page + detail page) don't need to round-trip
      // through an MCP client.
      const archiveApi = path.match(/^\/api\/canvas\/([^/]+)\/archive$/);
      if (archiveApi && req.method === 'POST') {
        const id = archiveApi[1];
        // Repo-mirrored canvases write back to their `.framesmith/` file; global
        // canvases use the in-memory + global-store path.
        const result = getRepoLocation(id) ? archiveRepoCanvas(id, true) : !!archiveCanvas(id);
        if (!result) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, canvasId: id, archived: true }));
        return;
      }
      const unarchiveApi = path.match(/^\/api\/canvas\/([^/]+)\/unarchive$/);
      if (unarchiveApi && req.method === 'POST') {
        const id = unarchiveApi[1];
        const result = getRepoLocation(id) ? archiveRepoCanvas(id, false) : !!unarchiveCanvas(id);
        if (!result) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, canvasId: id, archived: false }));
        return;
      }
      const deleteApi = path.match(/^\/api\/canvas\/([^/]+)$/);
      if (deleteApi && req.method === 'DELETE') {
        const id = deleteApi[1];
        if (!getCanvas(id)) { res.writeHead(404); res.end('Not found'); return; }
        if (getRepoLocation(id)) deleteRepoCanvas(id); else deleteCanvas(id);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, canvasId: id, deleted: true }));
        return;
      }

      // Index → default project
      if (path === '/') {
        res.writeHead(302, { Location: `/project/${DEFAULT_PROJECT_ID}` });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      res.writeHead(500);
      res.end(`Server error: ${(err as Error).message}`);
    }
  });

  // Try sequential ports starting from BASE_PORT (or a specific port if given)
  if (port > 0) {
    // Specific port requested
    const actualPort = await tryListen(httpServer, port);
    runningPort = actualPort;
    process.stderr.write(`Canvas viewer running at http://localhost:${actualPort}\n`);
    return actualPort;
  }

  // Auto-assign: try 3001, 3002, 3003...
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const tryPort = BASE_PORT + i;
      const actualPort = await tryListen(httpServer, tryPort);
      runningPort = actualPort;
      process.stderr.write(`Canvas viewer running at http://localhost:${actualPort}\n`);
      return actualPort;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      // Port in use, try next
    }
  }

  // Fallback: let OS assign
  const actualPort = await tryListen(httpServer, 0);
  runningPort = actualPort;
  process.stderr.write(`Canvas viewer running at http://localhost:${actualPort}\n`);
  return actualPort;
}

/** Shared visual tokens. All page-renderers inject this at the top of their
 *  inline <style> block so palette + reset + base typography stay consistent
 *  across gallery / project / archive / detail pages. Single source of truth
 *  for the warm-amber-on-warm-dark direction established by the slice 5 mock. */
const THEME_CSS = `
  :root {
    --bg-0: #09070a;
    --bg-1: #0d0b0a;
    --sidebar: #14110c;
    --surface: #1a160f;
    --surface-hover: #1f1a11;
    --surface-elevated: #221c12;
    --border: #2a241a;
    --border-subtle: #1f1b13;
    --border-rim: rgba(255,255,255,0.04);
    --text-primary: #fafaf5;
    --text-secondary: #b8b3a6;
    --text-tertiary: #807965;
    --text-muted: #4f4a3e;
    --accent: #f59e0b;
    --accent-deep: #b45309;
    --accent-soft: #fde68a;
    --accent-tint: rgba(245,158,11,0.08);
    --danger: #ef4444;
    --danger-bg: rgba(239,68,68,0.10);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg-0);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-feature-settings: 'cv02','cv03','cv04','cv11';
  }
`;

/** Deterministically pick a project-dot color from a 6-color palette. Hashing
 *  the projectId keeps the assignment stable across page loads without
 *  requiring a `dotColor` field on the Project entity. */
const DOT_PALETTE = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444'];
function projectDotColor(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = ((hash << 5) - hash + projectId.charCodeAt(i)) | 0;
  return DOT_PALETTE[Math.abs(hash) % DOT_PALETTE.length];
}

/** Framesmith grid logo mark — same SVG path as the build-*.ts dogfood
 * scripts. Replaces the original amber rounded-square placeholder so the
 * sidebar wordmark and the viewer favicon share a single brand identity.
 * Uses `currentColor` so the parent's `color` controls the stroke. */
const LOGO_SVG_HTML = `<svg class="sidebar-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M 4 4 L 20 4 L 20 20 L 4 20 Z M 4 11 L 20 11 M 11 11 L 11 20"/></svg>`;

/** SVG favicon embedded as a data URI. Inlined so the viewer doesn't need a
 * separate /favicon.svg route + file. URL-encoded characters: `<` → `%3C`,
 * `>` → `%3E`, `#` → `%23`. The hex color is the accent token's literal value
 * because favicons can't reference CSS vars. */
const FAVICON_HTML = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f59e0b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M 4 4 L 20 4 L 20 20 L 4 20 Z M 4 11 L 20 11 M 11 11 L 11 20'/%3E%3C/svg%3E">`;

/** Mobile sidebar drawer: at narrow viewports the 248px sidebar swallows most
 *  of the screen. Toggle button (hamburger) sits fixed top-left, sidebar
 *  becomes off-canvas, tapping the backdrop closes it. Injected into both
 *  project + archive pages — detail page has no sidebar so it doesn't need
 *  this. */
const MOBILE_TOGGLE_HTML = `
  <button class="sidebar-toggle" aria-label="Toggle sidebar" onclick="toggleSidebar()">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  </button>
  <div class="sidebar-backdrop" onclick="toggleSidebar()"></div>`;

const MOBILE_TOGGLE_CSS = `
  .sidebar-toggle { display: none; }
  .sidebar-backdrop { display: none; }
  @media (max-width: 768px) {
    .sidebar-toggle {
      display: flex; align-items: center; justify-content: center;
      position: fixed; top: 12px; left: 12px;
      width: 36px; height: 36px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-secondary);
      cursor: pointer;
      z-index: 60;
      transition: background 0.15s, color 0.15s;
    }
    .sidebar-toggle:hover { background: var(--surface-hover); color: var(--text-primary); }
    .sidebar {
      position: fixed; top: 0; bottom: 0; left: 0; height: 100vh;
      transform: translateX(-100%);
      transition: transform 0.22s ease;
      z-index: 100;
      box-shadow: 4px 0 24px rgba(0,0,0,0.5);
    }
    body.sidebar-open .sidebar { transform: translateX(0); }
    .sidebar-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 90;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease;
    }
    body.sidebar-open .sidebar-backdrop {
      display: block;
      opacity: 1;
      pointer-events: auto;
    }
    .main-header { padding-left: 64px; }  /* avoid hamburger overlapping breadcrumb */
  }`;

const MOBILE_TOGGLE_JS = `
    function toggleSidebar() {
      document.body.classList.toggle('sidebar-open');
    }`;

/** Renders the Figma-style left sidebar: workspaces → projects tree + Archive
 *  entry, with canvas-count badges and an active-state highlight on whatever
 *  the user is currently viewing. Pass `activeProjectId` for a project view,
 *  or `'archive'` for the archive view. */
function renderSidebar(active: string): string {
  const allCanvases = listCanvases();
  const projectCount = (projectId: string) =>
    allCanvases.filter((c) => c.projectId === projectId && !c.archived).length;
  const archivedCount = allCanvases.filter((c) => c.archived).length;

  const sections = listWorkspaces().map((ws) => {
    const wsProjects = listProjects(ws.id);
    if (wsProjects.length === 0) {
      return `<div class="ws-section">
          <div class="ws-name">${esc(ws.name)}</div>
          <div class="ws-empty">No projects yet</div>
        </div>`;
    }
    const items = wsProjects.map((p) => {
      const isActive = p.id === active;
      return `<a href="/project/${p.id}" class="project${isActive ? ' active' : ''}">
          ${isActive ? '<span class="project-bar"></span>' : ''}
          <span class="project-dot" style="background:${projectDotColor(p.id)}"></span>
          <span class="project-name">${esc(p.name)}</span>
          <span class="project-count">${projectCount(p.id)}</span>
        </a>`;
    }).join('');
    return `<div class="ws-section">
        <div class="ws-name">${esc(ws.name)}</div>
        ${items}
      </div>`;
  }).join('');

  const archiveActive = active === 'archive';
  const archiveLink = `<a href="/archive" class="sidebar-archive${archiveActive ? ' active' : ''}">
      <svg class="sidebar-archive-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 8v13H3V8"></path>
        <rect x="1" y="3" width="22" height="5"></rect>
        <line x1="10" y1="12" x2="14" y2="12"></line>
      </svg>
      <span class="sidebar-archive-name">Archive</span>
      <span class="sidebar-archive-count">${archivedCount}</span>
    </a>`;

  return `<aside class="sidebar">
      <div class="sidebar-header">
        ${LOGO_SVG_HTML}
        <span class="sidebar-logo">Framesmith</span>
      </div>
      <nav class="sidebar-nav">${sections}</nav>
      <div class="sidebar-footer">${archiveLink}</div>
    </aside>`;
}

/** Project-scoped main page. Sidebar on left, breadcrumb + canvas grid on right.
 *  Returns null when the project doesn't exist so the route handler can 404. */
export function renderProjectPage(projectId: string, port: number): string | null {
  const project = getProject(projectId);
  if (!project) return null;

  // Find the parent workspace for the breadcrumb. Default to "Personal" if
  // somehow orphaned (shouldn't happen after slice 1 migration).
  const ws = listWorkspaces().find((w) => w.id === project.workspaceId);
  const wsName = ws?.name ?? 'Personal';

  const canvases = listCanvases().filter((c) => c.projectId === projectId && !c.archived);
  const cards = canvases.map((c) => {
    const canvas = getCanvas(c.id)!;
    const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
    const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
    const date = new Date(c.createdAt).toLocaleString();
    const isEmpty = !canvas.root.children || canvas.root.children.length === 0;
    const thumbBody = isEmpty
      ? `<div class="thumb-empty">
            <div class="thumb-empty-back" aria-hidden="true"></div>
            <div class="thumb-empty-front" aria-hidden="true"></div>
            <span class="thumb-empty-icon" hidden>Empty canvas</span>
          </div>`
      : `<iframe src="/canvas/${c.id}/html" scrolling="no" loading="lazy"></iframe>`;
    return `
      <a href="/canvas/${c.id}" class="card">
        <div class="thumb${isEmpty ? ' thumb--empty' : ''}">${thumbBody}</div>
        <div class="info">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${w} x ${h} &middot; ${esc(date)}</div>
        </div>
      </a>`;
  }).join('\n');

  const emptyState = canvases.length === 0
    ? `<div class="empty">
        <div class="empty-icon">&#9634;</div>
        <div>No canvases in ${esc(project.name)} yet</div>
        <div class="empty-hint">Create one via your MCP client using <code>canvas_create({ projectId: "${project.id}" })</code></div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(project.name)} — Framesmith</title>
${FAVICON_HTML}
<style>
  ${THEME_CSS}
  .app { display: flex; min-height: 100vh; }

  /* Sidebar */
  .sidebar { width: 248px; flex-shrink: 0; background: var(--sidebar); border-right: 1px solid var(--border-subtle); display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .sidebar-header { padding: 22px 20px; display: flex; align-items: center; gap: 11px; }
  .sidebar-mark { width: 22px; height: 22px; color: var(--accent); flex-shrink: 0; display: block; }
  .sidebar-logo { font-size: 14px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.1px; }
  .sidebar-nav { padding: 4px 8px 0; flex: 1; }
  .ws-section { margin-bottom: 18px; padding: 0; }
  .ws-name { font-size: 10px; text-transform: uppercase; letter-spacing: 0.9px; color: var(--text-muted); padding: 14px 12px 8px; font-weight: 600; }
  .ws-empty { font-size: 12px; color: var(--text-muted); padding: 4px 12px; font-style: italic; }
  .project { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; color: var(--text-secondary); text-decoration: none; font-size: 13px; font-weight: 500; transition: background 0.15s, color 0.15s; margin-bottom: 1px; position: relative; }
  .project:hover { background: var(--surface-hover); color: var(--text-primary); }
  .project.active { background: var(--accent-tint); color: var(--text-primary); font-weight: 600; padding-left: 10px; }
  .project-bar { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 14px; background: var(--accent); border-radius: 2px; }
  .project-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .project-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .project-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .project.active .project-count { color: var(--accent-soft); }

  /* Sidebar footer: archive entry */
  .sidebar-footer { padding: 10px 8px 14px; border-top: 1px solid var(--border-subtle); }
  .sidebar-archive { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 6px; color: var(--text-secondary); text-decoration: none; font-size: 13px; font-weight: 500; transition: background 0.15s, color 0.15s; }
  .sidebar-archive:hover { background: var(--surface-hover); color: var(--text-primary); }
  .sidebar-archive.active { background: var(--accent-tint); color: var(--text-primary); font-weight: 600; }
  .sidebar-archive-icon { width: 16px; height: 16px; flex-shrink: 0; }
  .sidebar-archive-name { flex: 1; }
  .sidebar-archive-count { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .sidebar-archive.active .sidebar-archive-count { color: var(--accent-soft); }

  /* Main pane */
  .main { flex: 1; min-width: 0; background: var(--bg-1); }
  .main-header { padding: 28px 36px 24px; border-bottom: 1px solid var(--border-subtle); }
  .breadcrumb { font-size: 12px; font-weight: 500; color: var(--text-tertiary); margin-bottom: 8px; }
  .project-title { font-size: 36px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.6px; line-height: 1.1; }
  .project-meta { font-size: 13px; font-weight: 500; color: var(--text-tertiary); margin-top: 8px; }

  /* Card grid */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(264px, 1fr)); gap: 20px; padding: 28px 36px 36px; }
  .card { background: var(--surface); border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; transition: transform 0.18s ease, box-shadow 0.18s ease; box-shadow: 0 0 0 1px var(--border-rim) inset, 0 4px 12px -2px rgba(0,0,0,0.4); }
  .card:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px rgba(245,158,11,0.30) inset, 0 8px 20px -4px rgba(0,0,0,0.5); }
  .thumb { width: 100%; aspect-ratio: 16/10; overflow: hidden; background: var(--bg-0); position: relative; }
  .thumb iframe { width: 1440px; height: 900px; border: none; transform-origin: 0 0; transform: scale(0.222); pointer-events: none; position: absolute; top: 0; left: 0; }
  .thumb--empty { background: #15110b; }
  .thumb-empty { position: absolute; inset: 0; }
  .thumb-empty-back, .thumb-empty-front { position: absolute; width: 38px; height: 28px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.06); }
  .thumb-empty-back { top: calc(50% - 6px); left: calc(50% - 27px); }
  .thumb-empty-front { top: calc(50% - 10px); left: calc(50% - 19px); background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.10); }
  .info { padding: 14px 16px 16px; }
  .name { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; letter-spacing: -0.1px; }
  .meta { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 120px 32px; color: var(--text-tertiary); font-size: 15px; }
  .empty-icon { font-size: 44px; opacity: 0.3; }
  .empty-hint { font-size: 13px; color: var(--text-muted); text-align: center; max-width: 480px; }
  .empty-hint code { background: var(--surface); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: var(--text-secondary); }
  ${MOBILE_TOGGLE_CSS}
</style>
</head>
<body>
  ${MOBILE_TOGGLE_HTML}
  <div class="app">
    ${renderSidebar(projectId)}
    <main class="main">
      <div class="main-header">
        <div class="breadcrumb">${esc(wsName)} / ${esc(project.name)}</div>
        <h1 class="project-title">${esc(project.name)}</h1>
        <div class="project-meta">${canvases.length} canvas${canvases.length !== 1 ? 'es' : ''}</div>
      </div>
      ${canvases.length > 0 ? `<div class="grid">${cards}</div>` : emptyState}
    </main>
  </div>
  <script>
    ${MOBILE_TOGGLE_JS}

    // Auto-refresh: poll the canvas count for this project, reload if it changes.
    let lastCount = ${canvases.length};
    setInterval(async () => {
      try {
        const res = await fetch('/api/canvases');
        const data = await res.json();
        const inProject = data.filter((c) => c.projectId === '${projectId}' && !c.archived).length;
        if (inProject !== lastCount) location.reload();
      } catch {}
    }, 3000);
  </script>
</body>
</html>`;
}

/** Backwards-compatible alias: renders the default project. The previous
 *  `renderGalleryPage` was a flat all-canvases view; the new model is
 *  project-scoped, and the default project is the natural landing place. */
export function renderGalleryPage(port: number): string {
  return renderProjectPage(DEFAULT_PROJECT_ID, port) ?? '<h1>No projects found</h1>';
}

/** Archive view: shows all archived canvases across every project. Each card
 *  includes the source-project name (since archive is cross-project) and
 *  inline Restore / Delete actions that call the JSON API. */
export function renderArchivePage(port: number): string {
  const archived = listCanvases().filter((c) => c.archived);
  const projectName = (projectId: string) => getProject(projectId)?.name ?? '—';

  const cards = archived.map((c) => {
    const canvas = getCanvas(c.id)!;
    const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
    const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
    const archivedDate = c.lastModified ? new Date(c.lastModified).toLocaleString() : '';
    const isEmpty = !canvas.root.children || canvas.root.children.length === 0;
    const thumbBody = isEmpty
      ? `<div class="thumb-empty">
            <div class="thumb-empty-back" aria-hidden="true"></div>
            <div class="thumb-empty-front" aria-hidden="true"></div>
            <span class="thumb-empty-icon" hidden>Empty canvas</span>
          </div>`
      : `<iframe src="/canvas/${c.id}/html" scrolling="no" loading="lazy"></iframe>`;
    return `
      <div class="card card--archived" data-canvas-id="${c.id}">
        <a href="/canvas/${c.id}" class="card-link">
          <div class="thumb${isEmpty ? ' thumb--empty' : ''}">${thumbBody}</div>
          <div class="info">
            <div class="name">${esc(c.name)}</div>
            <div class="meta">${esc(projectName(c.projectId))} &middot; ${w} x ${h}</div>
            <div class="meta-archived">Archived ${esc(archivedDate)}</div>
          </div>
        </a>
        <div class="card-actions">
          <button class="card-action" data-action="restore" data-id="${c.id}">Restore</button>
          <button class="card-action card-action--danger" data-action="delete" data-id="${c.id}">Delete</button>
        </div>
      </div>`;
  }).join('\n');

  const emptyState = archived.length === 0
    ? `<div class="empty">
        <div class="empty-icon">&#9634;</div>
        <div>No archived canvases</div>
        <div class="empty-hint">Archive a canvas with <code>canvas_archive({ canvasId })</code> or the Archive button on a canvas page.</div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Archive — Framesmith</title>
${FAVICON_HTML}
<style>
  ${THEME_CSS}
  .app { display: flex; min-height: 100vh; }

  /* Sidebar */
  .sidebar { width: 248px; flex-shrink: 0; background: var(--sidebar); border-right: 1px solid var(--border-subtle); display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .sidebar-header { padding: 22px 20px; display: flex; align-items: center; gap: 11px; }
  .sidebar-mark { width: 22px; height: 22px; color: var(--accent); flex-shrink: 0; display: block; }
  .sidebar-logo { font-size: 14px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.1px; }
  .sidebar-nav { padding: 4px 8px 0; flex: 1; }
  .ws-section { margin-bottom: 18px; }
  .ws-name { font-size: 10px; text-transform: uppercase; letter-spacing: 0.9px; color: var(--text-muted); padding: 14px 12px 8px; font-weight: 600; }
  .ws-empty { font-size: 12px; color: var(--text-muted); padding: 4px 12px; font-style: italic; }
  .project { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; color: var(--text-secondary); text-decoration: none; font-size: 13px; font-weight: 500; transition: background 0.15s, color 0.15s; margin-bottom: 1px; position: relative; }
  .project:hover { background: var(--surface-hover); color: var(--text-primary); }
  .project.active { background: var(--accent-tint); color: var(--text-primary); font-weight: 600; padding-left: 10px; }
  .project-bar { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 14px; background: var(--accent); border-radius: 2px; }
  .project-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .project-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .project-count { font-size: 11px; color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .project.active .project-count { color: var(--accent-soft); }

  .sidebar-footer { padding: 10px 8px 14px; border-top: 1px solid var(--border-subtle); }
  .sidebar-archive { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 6px; color: var(--text-secondary); text-decoration: none; font-size: 13px; font-weight: 500; transition: background 0.15s, color 0.15s; }
  .sidebar-archive:hover { background: var(--surface-hover); color: var(--text-primary); }
  .sidebar-archive.active { background: var(--accent-tint); color: var(--text-primary); font-weight: 600; }
  .sidebar-archive-icon { width: 16px; height: 16px; flex-shrink: 0; }
  .sidebar-archive-name { flex: 1; }
  .sidebar-archive-count { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .sidebar-archive.active .sidebar-archive-count { color: var(--accent-soft); }

  /* Main pane */
  .main { flex: 1; min-width: 0; background: var(--bg-1); }
  .main-header { padding: 28px 36px 24px; border-bottom: 1px solid var(--border-subtle); }
  .breadcrumb { font-size: 12px; font-weight: 500; color: var(--text-tertiary); margin-bottom: 8px; }
  .project-title { font-size: 36px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.6px; line-height: 1.1; }
  .project-meta { font-size: 13px; font-weight: 500; color: var(--text-tertiary); margin-top: 8px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(264px, 1fr)); gap: 20px; padding: 28px 36px 36px; }
  .card { position: relative; background: var(--surface); border-radius: 12px; overflow: hidden; transition: transform 0.18s ease, box-shadow 0.18s ease; box-shadow: 0 0 0 1px var(--border-rim) inset, 0 4px 12px -2px rgba(0,0,0,0.4); }
  .card:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px rgba(245,158,11,0.30) inset, 0 8px 20px -4px rgba(0,0,0,0.5); }
  .card--archived { opacity: 0.72; }
  .card--archived:hover { opacity: 1; }
  .card-link { display: block; text-decoration: none; color: inherit; }
  .thumb { width: 100%; aspect-ratio: 16/10; overflow: hidden; background: var(--bg-0); position: relative; }
  .thumb iframe { width: 1440px; height: 900px; border: none; transform-origin: 0 0; transform: scale(0.222); pointer-events: none; position: absolute; top: 0; left: 0; }
  .thumb--empty { background: #15110b; }
  .thumb-empty { position: absolute; inset: 0; }
  .thumb-empty-back, .thumb-empty-front { position: absolute; width: 38px; height: 28px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.06); }
  .thumb-empty-back { top: calc(50% - 6px); left: calc(50% - 27px); }
  .thumb-empty-front { top: calc(50% - 10px); left: calc(50% - 19px); background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.10); }
  .info { padding: 14px 16px 16px; }
  .name { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; letter-spacing: -0.1px; }
  .meta { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
  .meta-archived { font-size: 11px; color: var(--text-muted); margin-top: 4px; font-style: italic; }

  .card-actions { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; opacity: 0; transition: opacity 0.15s; z-index: 2; }
  .card:hover .card-actions { opacity: 1; }
  .card-action { background: rgba(0,0,0,0.85); color: var(--text-primary); border: 1px solid var(--border); padding: 5px 10px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .card-action:hover { background: rgba(245,158,11,0.15); border-color: var(--accent); color: var(--accent-soft); }
  .card-action--danger:hover { background: var(--danger-bg); border-color: var(--danger); color: #fecaca; }

  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 120px 32px; color: var(--text-tertiary); font-size: 15px; }
  .empty-icon { font-size: 44px; opacity: 0.3; }
  .empty-hint { font-size: 13px; color: var(--text-muted); text-align: center; max-width: 480px; }
  .empty-hint code { background: var(--surface); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: var(--text-secondary); }
  ${MOBILE_TOGGLE_CSS}
</style>
</head>
<body>
  ${MOBILE_TOGGLE_HTML}
  <div class="app">
    ${renderSidebar('archive')}
    <main class="main">
      <div class="main-header">
        <div class="breadcrumb">Archive</div>
        <h1 class="project-title">Archived canvases</h1>
        <div class="project-meta">${archived.length} canvas${archived.length !== 1 ? 'es' : ''} across all projects</div>
      </div>
      ${archived.length > 0 ? `<div class="grid">${cards}</div>` : emptyState}
    </main>
  </div>
  <script>
    ${MOBILE_TOGGLE_JS}

    // Lifecycle actions: restore / permanent delete. Both call JSON endpoints
    // and reload on success. Delete prompts to confirm — it's irreversible.
    document.querySelectorAll('.card-action').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'delete' && !confirm('Permanently delete this canvas? This cannot be undone.')) return;
        try {
          const url = '/api/canvas/' + id + (action === 'restore' ? '/unarchive' : '');
          const method = action === 'delete' ? 'DELETE' : 'POST';
          const res = await fetch(url, { method });
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          location.reload();
        } catch (err) {
          alert('Action failed: ' + err.message);
        }
      });
    });
  </script>
</body>
</html>`;
}

export function renderDetailPage(canvas: Canvas, port: number): string {
  const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
  const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(canvas.name)} — Framesmith</title>
${FAVICON_HTML}
<style>
  ${THEME_CSS}
  body { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { height: 52px; background: var(--sidebar); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; padding: 0 20px; gap: 14px; flex-shrink: 0; }
  /* Grouped clusters of related buttons with subtle vertical dividers
   * between them. Reads as "view modes / utilities / lifecycle" three-way
   * grouping rather than a flat wall of 8 same-weight buttons. */
  .toolbar-cluster { display: inline-flex; align-items: center; gap: 6px; }
  .toolbar-divider { width: 1px; height: 18px; background: var(--border); flex-shrink: 0; }
  .toolbar a { color: var(--text-tertiary); text-decoration: none; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; transition: color 0.15s; }
  .toolbar a:hover { color: var(--text-primary); }
  .toolbar .title { font-size: 15px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.1px; }
  .toolbar .dim { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .toolbar .spacer { flex: 1; }
  .toolbar .btn { background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .toolbar .btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .toolbar .btn.active { background: var(--accent-tint); border-color: var(--accent); color: var(--accent-soft); font-weight: 600; }
  .toolbar .btn--danger:hover { background: var(--danger-bg); border-color: var(--danger); color: #fecaca; }
  .status { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
  .status.stale { background: var(--text-muted); }
  .viewport { flex: 1; display: flex; align-items: flex-start; justify-content: center; overflow: auto; background: var(--bg-0); padding: 24px 0; }
  .viewport iframe { border: none; background: #fff; transition: width 0.3s, height 0.3s; transform-origin: top center; }
  .viewport.fit iframe { width: 100% !important; height: 100% !important; }
  .viewport.compare #frame { display: none; }
  .viewport.compare .compare-grid { display: flex; }
  .viewport.compare #btn-fit { pointer-events: none; opacity: 0.4; }
  .compare-grid { display: none; gap: 24px; padding: 24px; align-items: flex-start; --scale: 0.35; }
  .compare-cell { display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
  .bp-label { font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
  .iframe-wrap { background: #fff; overflow: hidden; border-radius: 6px; border: 1px solid var(--border); width: calc(var(--bp-w) * var(--scale) * 1px); height: calc(var(--bp-h) * var(--scale) * 1px); }
  .iframe-wrap iframe { border: 0; background: #fff; width: calc(var(--bp-w) * 1px); height: calc(var(--bp-h) * 1px); transform: scale(var(--scale)); transform-origin: top left; }
  .json-panel { display: none; position: fixed; top: 52px; right: 0; bottom: 0; width: 480px; background: var(--sidebar); border-left: 1px solid var(--border-subtle); overflow: auto; z-index: 10; }
  .json-panel.open { display: block; }
  .json-panel pre { padding: 20px; font-size: 12px; color: var(--text-secondary); font-family: 'JetBrains Mono', 'Fira Code', monospace; white-space: pre-wrap; word-break: break-all; }
  @media (max-width: 1100px) { .compare-grid { --scale: 0.28; gap: 18px; } }
  @media (max-width: 900px) { .compare-grid { --scale: 0.22; gap: 16px; } }
  @media (max-width: 640px) {
    .toolbar { flex-wrap: wrap; height: auto; min-height: 52px; padding: 10px 12px; gap: 8px; }
    .toolbar a { font-size: 13px; }
    .toolbar .title { font-size: 14px; min-width: 0; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar .dim { display: none; }
    /* Dividers don't make sense when clusters wrap to separate rows — hide. */
    .toolbar-divider { display: none; }
    /* Spacer becomes a full-width line break so the buttons drop to a new row
     * underneath the title (rather than getting crammed alongside it). */
    .toolbar .spacer { flex-basis: 100%; height: 0; }
    /* Auto-refresh dot is too small to be worth its own line on mobile. Hide. */
    .status { display: none; }
    /* Each cluster takes a full row. Buttons inside the cluster share the
     * row width evenly via flex: 1, with compact padding. Three cluster-rows
     * stack cleanly under the title row. */
    .toolbar-cluster { flex: 0 0 100%; gap: 6px; }
    .toolbar .btn { flex: 1; min-width: 0; padding: 8px 6px; font-size: 12px; font-weight: 500; white-space: nowrap; }
    .json-panel { width: 100%; }
    .compare-grid { --scale: 0.18; gap: 12px; padding: 12px; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <a href="/project/${canvas.projectId}">&larr; Back</a>
    <span class="title">${esc(canvas.name)}</span>
    <span class="dim">${w} x ${h}</span>
    <div class="spacer"></div>
    <div class="toolbar-cluster">
      <button class="btn" onclick="setViewport(390, 844)" id="bp-mobile">Mobile</button>
      <button class="btn" onclick="setViewport(768, 1024)" id="bp-tablet">Tablet</button>
      <button class="btn active" onclick="setViewport(${w}, ${h})" id="bp-desktop">Desktop</button>
      <button class="btn" onclick="setCompareMode()" id="bp-compare">Compare</button>
    </div>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <div class="toolbar-cluster">
      <button class="btn" onclick="toggleFit()" id="btn-fit">Fit</button>
      <button class="btn" onclick="toggleJson()" id="btn-json">JSON</button>
    </div>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <div class="toolbar-cluster">
      ${canvas.archived
        ? `<button class="btn" onclick="lifecycleAction('unarchive')" id="btn-restore">Restore</button>`
        : `<button class="btn" onclick="lifecycleAction('archive')" id="btn-archive">Archive</button>`
      }
      <button class="btn btn--danger" onclick="lifecycleAction('delete')" id="btn-delete">Delete</button>
    </div>
    <div class="status" id="status" title="Auto-refresh active"></div>
  </div>
  <div class="viewport" id="viewport">
    <iframe id="frame" src="/canvas/${canvas.id}/html" width="${w}" height="${h}"></iframe>
    <div class="compare-grid" id="compare-grid">
      <div class="compare-cell" style="--bp-w: 390; --bp-h: 844;">
        <div class="bp-label">Mobile · 390×844</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=390&h=844" data-bp="mobile"></iframe></div>
      </div>
      <div class="compare-cell" style="--bp-w: 768; --bp-h: 1024;">
        <div class="bp-label">Tablet · 768×1024</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=768&h=1024" data-bp="tablet"></iframe></div>
      </div>
      <div class="compare-cell" style="--bp-w: ${w}; --bp-h: ${h};">
        <div class="bp-label">Desktop · ${w}×${h}</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=${w}&h=${h}" data-bp="desktop"></iframe></div>
      </div>
    </div>
  </div>
  <div class="json-panel" id="json-panel">
    <pre id="json-content">Loading...</pre>
  </div>
  <script>
    const canvasId = '${canvas.id}';
    let lastModified = '${canvas.lastModified}';
    let currentBp = 'desktop';

    // Auto-refresh polling
    setInterval(async () => {
      try {
        const res = await fetch('/api/canvas/' + canvasId + '/meta');
        const meta = await res.json();
        document.getElementById('status').className = 'status';
        if (meta.lastModified !== lastModified) {
          lastModified = meta.lastModified;
          refreshFrames();
          // Update JSON if panel is open
          if (document.getElementById('json-panel').classList.contains('open')) loadJson();
        }
      } catch {
        document.getElementById('status').className = 'status stale';
      }
    }, 2000);

    function refreshFrames() {
      const t = Date.now();
      const bump = (frame) => {
        const url = new URL(frame.src, location.href);
        url.searchParams.set('t', t);
        frame.src = url.toString();
      };
      if (document.getElementById('viewport').classList.contains('compare')) {
        document.querySelectorAll('.compare-cell iframe').forEach(bump);
      } else {
        bump(document.getElementById('frame'));
      }
    }

    const canvasW = ${w};
    const canvasH = ${h};

    function setViewport(w, h) {
      const frame = document.getElementById('frame');
      const vp = document.getElementById('viewport');
      vp.classList.remove('fit', 'compare');
      document.getElementById('btn-fit').classList.remove('active');

      // Reload iframe at the new viewport size so content reflows
      frame.width = w;
      frame.height = h;
      frame.style.transform = '';
      frame.style.maxWidth = '';
      frame.style.maxHeight = '';
      frame.style.width = '';
      frame.style.height = '';
      frame.style.overflow = '';
      frame.src = '/canvas/' + canvasId + '/html?w=' + w + '&h=' + h + '&t=' + Date.now();

      // Update active button
      document.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
      if (w === 390) { document.getElementById('bp-mobile').classList.add('active'); currentBp = 'mobile'; }
      else if (w === 768) { document.getElementById('bp-tablet').classList.add('active'); currentBp = 'tablet'; }
      else { document.getElementById('bp-desktop').classList.add('active'); currentBp = 'desktop'; }
    }

    function setCompareMode() {
      const vp = document.getElementById('viewport');
      vp.classList.remove('fit');
      vp.classList.add('compare');
      document.getElementById('btn-fit').classList.remove('active');
      document.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
      document.getElementById('bp-compare').classList.add('active');
      currentBp = 'compare';
    }

    function toggleFit() {
      const vp = document.getElementById('viewport');
      const btn = document.getElementById('btn-fit');
      vp.classList.toggle('fit');
      btn.classList.toggle('active');
    }

    function toggleJson() {
      const panel = document.getElementById('json-panel');
      const btn = document.getElementById('btn-json');
      panel.classList.toggle('open');
      btn.classList.toggle('active');
      if (panel.classList.contains('open')) loadJson();
    }

    async function loadJson() {
      try {
        const res = await fetch('/canvas/' + canvasId + '/json');
        const data = await res.json();
        document.getElementById('json-content').textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('json-content').textContent = 'Error loading JSON';
      }
    }

    // Archive / unarchive / delete. Delete is irreversible — confirm first.
    // After action: archive / unarchive bounce back to the project page;
    // delete bounces too (the canvas is gone, no point staying on its page).
    async function lifecycleAction(action) {
      if (action === 'delete' && !confirm('Permanently delete this canvas? This cannot be undone.')) return;
      const projectId = ${JSON.stringify(canvas.projectId)};
      try {
        const url = '/api/canvas/' + canvasId + (action === 'archive' ? '/archive' : action === 'unarchive' ? '/unarchive' : '');
        const method = action === 'delete' ? 'DELETE' : 'POST';
        const res = await fetch(url, { method });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        location.href = '/project/' + projectId;
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
    }
  </script>
</body>
</html>`;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
