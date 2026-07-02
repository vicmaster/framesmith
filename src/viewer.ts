import { createServer, type IncomingMessage, type Server } from 'node:http';
import { getCanvas, listCanvases, archiveCanvas, unarchiveCanvas, deleteCanvas, ensureFresh, touchCanvas } from './scene-graph.js';
import { resolveVariables } from './variables.js';
import { renderToHtml } from './renderer.js';
import { getProject, listProjects, listWorkspaces, getCanvasTokens, getProjectDesignSystem, getWorkspaceDesignSystem } from './workspaces.js';
import { getRepoLocation, archiveRepoCanvas, deleteRepoCanvas, updateRepoCanvas } from './aggregate.js';
import { DEFAULT_PROJECT_ID, type Canvas, type SceneNode } from './types.js';
import { evaluateCanvas, type EvaluationResult, type EvaluationIssue } from './evaluate.js';
import { addFeedback, listFeedback, resolveFeedback, deleteFeedback, openFeedbackCount } from './feedback.js';

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

/** Read + parse a JSON request body (Phase 21 — the feedback POSTs are the
 * viewer's first body-carrying endpoints). Empty body → {}. */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 64 * 1024) reject(new Error('Body too large')); });
    req.on('end', () => {
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/** Mutate a canvas's feedback through the right backend: repo mirrors write
 * back to their `.framesmith/` file (standalone viewer), everything else goes
 * through the store + touchCanvas (which persists global canvases, and repo
 * canvases when this is the MCP server's embedded viewer). Mirrors the
 * archive-endpoint routing at the top of startViewer. */
function mutateFeedback(id: string, mutate: (c: Canvas) => boolean): boolean {
  if (getRepoLocation(id)) return updateRepoCanvas(id, mutate);
  ensureFresh(id); // embedded-viewer case: pick up external edits before mutating
  const c = getCanvas(id);
  if (!c) return false;
  if (!mutate(c)) return false;
  touchCanvas(id);
  return true;
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
  const httpServer = createServer(async (req, res) => {
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
        res.end(await renderDetailPage(canvas, runningPort ?? 3001));
        return;
      }

      // Project page
      const projectMatch = path.match(/^\/project\/([^/]+)$/);
      if (projectMatch) {
        const html = await renderProjectPage(projectMatch[1], runningPort ?? 3001);
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
      // Feedback API (Phase 21 Slice B) — point-and-tell comments. Same
      // backend routing as the lifecycle endpoints above.
      const feedbackApi = path.match(/^\/api\/canvas\/([^/]+)\/feedback$/);
      if (feedbackApi && req.method === 'GET') {
        const canvas = getCanvas(feedbackApi[1]);
        if (!canvas) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ openCount: openFeedbackCount(canvas), entries: listFeedback(canvas, { includeResolved: true }) }));
        return;
      }
      if (feedbackApi && req.method === 'POST') {
        const id = feedbackApi[1];
        const body = await readJsonBody(req);
        const nodeId = typeof body.nodeId === 'string' && body.nodeId ? body.nodeId : undefined;
        const comment = typeof body.comment === 'string' ? body.comment : '';
        let entry: unknown = null;
        let addError: string | null = null;
        const ok = mutateFeedback(id, (c) => {
          try { entry = addFeedback(c, { nodeId, comment }); return true; }
          catch (e) { addError = (e as Error).message; return false; }
        });
        if (addError) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: addError })); return; }
        if (!ok) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, entry }));
        return;
      }
      const feedbackItemApi = path.match(/^\/api\/canvas\/([^/]+)\/feedback\/([^/]+)$/);
      if (feedbackItemApi && req.method === 'DELETE') {
        const [, id, fbId] = feedbackItemApi;
        let removed = false;
        const ok = mutateFeedback(id, (c) => { removed = deleteFeedback(c, fbId); return removed; });
        if (!ok || !removed) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, deleted: fbId }));
        return;
      }
      const feedbackResolveApi = path.match(/^\/api\/canvas\/([^/]+)\/feedback\/([^/]+)\/resolve$/);
      if (feedbackResolveApi && req.method === 'POST') {
        const [, id, fbId] = feedbackResolveApi;
        const body = await readJsonBody(req);
        const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
        let resolved = false;
        const ok = mutateFeedback(id, (c) => { resolved = resolveFeedback(c, [fbId], 'user', note).resolved.length > 0; return resolved; });
        if (!ok || !resolved) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, resolved: fbId }));
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
    --success: #22c55e;
    --info: #3b82f6;
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
export async function renderProjectPage(projectId: string, port: number): Promise<string | null> {
  const project = getProject(projectId);
  if (!project) return null;

  // Find the parent workspace for the breadcrumb. Default to "Personal" if
  // somehow orphaned (shouldn't happen after slice 1 migration).
  const ws = listWorkspaces().find((w) => w.id === project.workspaceId);
  const wsName = ws?.name ?? 'Personal';

  const canvases = listCanvases().filter((c) => c.projectId === projectId && !c.archived);
  const cards = (await Promise.all(canvases.map(async (c) => {
    const canvas = getCanvas(c.id)!;
    const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
    const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
    const date = new Date(c.createdAt).toLocaleString();
    const isEmpty = !canvas.root.children || canvas.root.children.length === 0;
    // Phase 19 Slice A — gallery score badge (fast eval, cached; empty → none).
    const ev = await evalFor(canvas);
    const scoreBadge = ev
      ? `<div class="card-score" style="color:${scoreColor(ev.overallScore)}" title="Heuristic quality score">${ev.overallScore}</div>`
      : '';
    const thumbBody = isEmpty
      ? `<div class="thumb-empty">
            <div class="thumb-empty-back" aria-hidden="true"></div>
            <div class="thumb-empty-front" aria-hidden="true"></div>
            <span class="thumb-empty-icon" hidden>Empty canvas</span>
          </div>`
      : `<iframe src="/canvas/${c.id}/html" scrolling="no" loading="lazy"></iframe>`;
    return `
      <a href="/canvas/${c.id}" class="card">
        <div class="thumb${isEmpty ? ' thumb--empty' : ''}">${scoreBadge}${thumbBody}</div>
        <div class="info">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${w} x ${h} &middot; ${esc(date)}</div>
        </div>
      </a>`;
  }))).join('\n');

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
  /* Phase 19 Slice A — heuristic quality score badge on each card thumbnail. */
  .card-score { position: absolute; top: 8px; right: 8px; z-index: 2; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; background: rgba(9,7,10,0.78); backdrop-filter: blur(4px); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; line-height: 1; }
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
export async function renderGalleryPage(port: number): Promise<string> {
  return (await renderProjectPage(DEFAULT_PROJECT_ID, port)) ?? '<h1>No projects found</h1>';
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
  /* Phase 19 Slice A — heuristic quality score badge on each card thumbnail. */
  .card-score { position: absolute; top: 8px; right: 8px; z-index: 2; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; background: rgba(9,7,10,0.78); backdrop-filter: blur(4px); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; line-height: 1; }
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

/* ── Phase 19 Slice A — Quality panel ─────────────────────────────────────
 * The viewer surfaces the heuristic (fast, Chrome-free) canvas_evaluate so a
 * human reviewer sees the same score + cliché tells the agent sees over MCP.
 * Read-only: computed for display, never written back to the scene graph. */

// Cache fast-eval by canvas id + mtime so the gallery doesn't re-score every
// canvas on every reload. Bounded — drop the oldest when it grows past a cap.
const scoreCache = new Map<string, EvaluationResult>();
async function evalFor(canvas: Canvas): Promise<EvaluationResult | null> {
  if (!canvas.root.children || canvas.root.children.length === 0) return null; // empty → no score
  const key = `${canvas.id}:${canvas.lastModified}`;
  const hit = scoreCache.get(key);
  if (hit) return hit;
  try {
    // Match the agent: relax tells for the canvas's own genre (provenance preset).
    const genre = (canvas.metadata?.provenance as { preset?: string } | undefined)?.preset;
    const result = await evaluateCanvas(canvas, { mode: 'fast', genre });
    if (scoreCache.size > 200) scoreCache.delete(scoreCache.keys().next().value as string);
    scoreCache.set(key, result);
    return result;
  } catch {
    return null; // a scoring failure must never break the page
  }
}

function gradeFor(score: number): { label: string; warn: boolean } {
  if (score >= 90) return { label: 'Excellent', warn: false };
  if (score >= 75) return { label: 'Good', warn: false };
  if (score >= 60) return { label: 'Needs improvement', warn: true };
  return { label: 'Poor', warn: true };
}
// ≥80 green, 60–79 amber, <60 red — the bar colors in the panel + gallery badge.
function scoreColor(score: number): string {
  return score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--accent)' : 'var(--danger)';
}
function sevColor(severity: string): string {
  return severity === 'error' ? 'var(--danger)' : severity === 'warning' ? 'var(--accent)' : 'var(--info)';
}

function renderIssueCard(issue: EvaluationIssue): string {
  const label = issue.tell ? `${esc(issue.category)} · ${esc(issue.tell)}` : esc(issue.category);
  const clickable = typeof issue.nodeId === 'string' && issue.nodeId.length > 0;
  const fixTag = issue.fix
    ? `<span class="insp-fix" title="canvas_autofix can resolve this">&#9889; auto-fixable</span>` : '';
  return `
    <div class="insp-issue${clickable ? '' : ' insp-issue--static'}"${clickable ? ` data-issue-node="${esc(issue.nodeId!)}"` : ''}>
      <div class="insp-issue-top">
        <span class="insp-dot" style="background:${sevColor(issue.severity)}"></span>
        <span class="insp-badge">${label}</span>
        ${fixTag}
      </div>
      <div class="insp-msg">${esc(issue.message)}</div>
      ${issue.suggestion ? `<div class="insp-sug">${esc(issue.suggestion)}</div>` : ''}
    </div>`;
}

/* ── Phase 19 Slice B — Design-system panel ───────────────────────────────
 * Resolves the canvas's effective tokens (the merged workspace▸project▸canvas
 * chain) and shows them as swatches / type scale / spacing / radius. Each token
 * is attributed to the layer it resolved from; only OVERRIDES of the dominant
 * layer are tagged (the section header states the default), keeping it clean. */
type TokenLayer = 'canvas' | 'project' | 'workspace' | 'default';

function mostCommon(layers: TokenLayer[]): TokenLayer {
  const tally = new Map<TokenLayer, number>();
  for (const l of layers) tally.set(l, (tally.get(l) ?? 0) + 1);
  let best: TokenLayer = 'default'; let n = -1;
  for (const [l, c] of tally) if (c > n) { best = l; n = c; }
  return best;
}

function renderDesignSystem(canvas: Canvas): string {
  const tokens = getCanvasTokens(canvas);
  const project = getProject(canvas.projectId);
  const projectDS = project ? getProjectDesignSystem(project.id) : undefined;
  const workspaceDS = project ? getWorkspaceDesignSystem(project.workspaceId) : undefined;

  const has = (ds: unknown, cat: string, name: string): boolean => {
    const m = ds && (ds as Record<string, unknown>)[cat];
    return !!m && Object.prototype.hasOwnProperty.call(m, name);
  };
  const sourceOf = (cat: string, name: string): TokenLayer => {
    if (has(canvas.variables, cat, name)) return 'canvas';
    if (has(projectDS, cat, name)) return 'project';
    if (has(workspaceDS, cat, name)) return 'workspace';
    return 'default';
  };

  const cats = ['colors', 'spacing', 'radius', 'typography'] as const;
  const allSources: TokenLayer[] = [];
  for (const cat of cats) {
    const m = (tokens as Record<string, unknown>)[cat] as Record<string, unknown> | undefined;
    if (m) for (const n of Object.keys(m)) allSources.push(sourceOf(cat, n));
  }
  if (allSources.length === 0) {
    return `
  <div class="insp-tabpane" data-pane="design" hidden>
    <div class="insp-section"><div class="insp-clean">This canvas inherits no design tokens. Set them with set_variables or bind a design system.</div></div>
  </div>`;
  }
  const dominant = mostCommon(allSources);
  const defaultLabel = dominant === 'default' ? 'defaults' : `from ${dominant}`;
  const tag = (cat: string, name: string): string => {
    const s = sourceOf(cat, name);
    return s === dominant ? '' : ` <span class="ds-src ds-src--${s}">${s}</span>`;
  };
  const sectionLabel = (title: string): string =>
    `<div class="insp-section-head"><span class="insp-section-label">${title}</span><span class="ds-default">${defaultLabel}</span></div>`;

  const colors = (tokens.colors ?? {}) as Record<string, string>;
  const colorEntries = Object.entries(colors);
  const colorSec = colorEntries.length ? `
    <div class="insp-section">
      ${sectionLabel('Colors')}
      <div class="ds-swatches">
        ${colorEntries.map(([name, hex]) => `
          <div class="ds-swatch">
            <div class="ds-chip" style="background:${esc(String(hex))}"></div>
            <div class="ds-swatch-meta">
              <span class="ds-name">${esc(name)}${tag('colors', name)}</span>
              <span class="ds-hex">${esc(String(hex))}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const typo = (tokens.typography ?? {}) as Record<string, { fontSize?: number; fontWeight?: number | string }>;
  const typoEntries = Object.entries(typo);
  const typeSec = typoEntries.length ? `
    <div class="insp-divider"></div>
    <div class="insp-section">
      ${sectionLabel('Type scale')}
      ${typoEntries.map(([name, t]) => {
        const size = Number(t.fontSize ?? 14);
        const weight = t.fontWeight ?? 400;
        const disp = Math.min(Number.isFinite(size) ? size : 14, 30);
        return `<div class="ds-type">
          <span class="ds-type-sample" style="font-size:${disp}px;font-weight:${esc(String(weight))}">${esc(name)}</span>
          <span class="ds-type-meta">${esc(String(t.fontSize ?? '—'))}/${esc(String(weight))}${tag('typography', name)}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const spacing = (tokens.spacing ?? {}) as Record<string, number>;
  const spacingEntries = Object.entries(spacing);
  const maxSp = Math.max(1, ...spacingEntries.map(([, v]) => Number(v)).filter((n) => Number.isFinite(n)));
  const spaceSec = spacingEntries.length ? `
    <div class="insp-divider"></div>
    <div class="insp-section">
      ${sectionLabel('Spacing')}
      ${spacingEntries.map(([name, val]) => {
        const w = Math.max(6, Math.round((Number(val) / maxSp) * 120));
        return `<div class="ds-sp">
          <span class="ds-sp-name">${esc(name)}${tag('spacing', name)}</span>
          <span class="ds-sp-bar" style="width:${w}px"></span>
          <span class="ds-sp-val">${esc(String(val))}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const radius = (tokens.radius ?? {}) as Record<string, number>;
  const radiusEntries = Object.entries(radius);
  const radiusSec = radiusEntries.length ? `
    <div class="insp-divider"></div>
    <div class="insp-section">
      ${sectionLabel('Radius')}
      <div class="ds-radii">
        ${radiusEntries.map(([name, val]) => {
          const r = Math.min(Math.max(0, Number(val) || 0), 22);
          return `<div class="ds-rad">
            <div class="ds-rad-tile" style="border-radius:${r}px"></div>
            <span class="ds-rad-label">${esc(name)} · ${esc(String(val))}${tag('radius', name)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  return `
  <div class="insp-tabpane" data-pane="design" hidden>
    ${colorSec}${typeSec}${spaceSec}${radiusSec}
  </div>`;
}

/** Phase 21 — id → { name, type } for every node, embedded in the detail page
 * so the comment-mode breadcrumb can label ancestors without extra requests. */
function buildNodeIndex(root: SceneNode): Record<string, { name?: string; type: string }> {
  const index: Record<string, { name?: string; type: string }> = {};
  const walk = (n: SceneNode) => {
    index[n.id] = { ...(n.name ? { name: n.name } : {}), type: n.type };
    for (const child of n.children ?? []) walk(child);
  };
  walk(root);
  return index;
}

/** JSON.stringify safe to inline inside a <script> block. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function renderInspector(ev: EvaluationResult, canvas: Canvas): string {
  const grade = gradeFor(ev.overallScore);
  const fbOpen = openFeedbackCount(canvas);
  const cats = ev.categories.map((c) => `
      <div class="insp-cat">
        <span class="insp-cat-name">${esc(c.name)}</span>
        <span class="insp-cat-track"><span class="insp-cat-fill" style="width:${Math.max(0, Math.min(100, c.score))}%;background:${scoreColor(c.score)}"></span></span>
        <span class="insp-cat-score" style="${c.score < 60 ? 'color:var(--danger);font-weight:700' : ''}">${c.score}</span>
      </div>`).join('');
  const issues = ev.issues.length
    ? ev.issues.map(renderIssueCard).join('')
    : `<div class="insp-clean">No issues — this canvas is clean.</div>`;
  return `
  <aside class="inspector" id="inspector">
    <div class="insp-tabs">
      <span class="insp-tab active" data-tab="quality">Quality</span>
      <span class="insp-tab" data-tab="design">Design system</span>
      <span class="insp-tab" data-tab="feedback">Feedback<span class="fb-badge" id="fb-badge"${fbOpen ? '' : ' hidden'}>${fbOpen}</span></span>
      <span class="insp-tab disabled" title="Coming in Phase 19 Slice C">Import</span>
    </div>
    <div class="insp-tabpane" data-pane="quality">
      <div class="insp-score">
        <div class="insp-score-row">
          <div class="insp-score-num">${ev.overallScore}<span>/100</span></div>
          <span class="insp-grade${grade.warn ? ' warn' : ''}">${grade.label}</span>
        </div>
        <div class="insp-track"><div class="insp-fill" style="width:${ev.overallScore}%;background:${scoreColor(ev.overallScore)}"></div></div>
      </div>
      <div class="insp-divider"></div>
      <div class="insp-section">
        <div class="insp-section-label">Categories</div>
        ${cats}
      </div>
      <div class="insp-divider"></div>
      <div class="insp-section">
        <div class="insp-section-head"><span class="insp-section-label">Issues</span><span class="insp-count">${ev.issues.length}</span></div>
        ${issues}
      </div>
    </div>
    ${renderDesignSystem(canvas)}
    <div class="insp-tabpane" data-pane="feedback" hidden>
      <div class="insp-section">
        <div class="insp-section-head"><span class="insp-section-label">Point-and-tell</span></div>
        <div class="fb-hint">Toggle <b>Comment</b> in the toolbar, then click any element in the preview to leave a note for the agent.</div>
        <div id="fb-pane"></div>
      </div>
    </div>
  </aside>`;
}

export async function renderDetailPage(canvas: Canvas, port: number): Promise<string> {
  const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
  const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;

  // Provenance chip (Phase 11) — structure · preset · alignment/density. Shows
  // only the parts that exist; hidden entirely when a canvas has no provenance.
  const prov = canvas.metadata?.provenance;
  let provChip = '';
  if (prov) {
    const parts: string[] = [];
    if (prov.structure) parts.push(esc(prov.structure));
    if (prov.preset) parts.push(esc(prov.preset));
    const ax = prov.axes ? [prov.axes.alignment, prov.axes.density].filter(Boolean).join('/') : '';
    if (ax) parts.push(esc(ax));
    if (parts.length) provChip = `<span class="prov" title="Provenance — the structure / preset / axes that produced this canvas"><b>◆</b>${parts.join(' · ')}</span>`;
  }

  // Critique verdict chip (Phase 13) — latest rubric overall + needs-revision
  // flag. Hidden when a canvas has never been judged.
  const crit = canvas.metadata?.critique;
  let verdictChip = '';
  if (crit) {
    const cls = crit.needsRevision ? 'verdict warn' : 'verdict';
    const tail = crit.needsRevision ? ' · needs revision' : '';
    verdictChip = `<span class="${cls}" title="Latest rubric critique (Phase 13) — derived overall + needs-revision flag"><b>◇</b>${crit.overall}/100${tail}</span>`;
  }

  // Phase 19 Slice A — heuristic quality inspector (fast, Chrome-free, read-only).
  const ev = await evalFor(canvas);
  const inspectorHtml = ev ? renderInspector(ev, canvas) : '';

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
  /* Provenance chip — the structure / preset / axes that produced this canvas
   * (Phase 11). Flat + muted, with a single small accent mark; no glow. */
  .toolbar .prov { font-size: 12px; color: var(--text-muted); font-weight: 500; white-space: nowrap; }
  .toolbar .prov b { color: var(--accent-soft); font-weight: 700; margin-right: 6px; }
  /* Critique verdict chip (Phase 13) — flat, muted; amber mark when the latest
   * rubric flagged the canvas as needing revision. */
  .toolbar .verdict { font-size: 12px; color: var(--text-muted); font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .toolbar .verdict b { color: var(--accent-soft); font-weight: 700; margin-right: 6px; }
  .toolbar .verdict.warn b { color: #d9a441; }
  .toolbar .spacer { flex: 1; }
  .toolbar .btn { background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .toolbar .btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .toolbar .btn.active { background: var(--accent-tint); border-color: var(--accent); color: var(--accent-soft); font-weight: 600; }
  .toolbar .btn--danger:hover { background: var(--danger-bg); border-color: var(--danger); color: #fecaca; }
  .status { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
  .status.stale { background: var(--text-muted); }
  /* Phase 19 — detail body splits into the preview (left) and the read-only
   * quality inspector (right). Toolbar stays full-width above. */
  .detail-main { flex: 1; display: flex; min-height: 0; }
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
  /* Quality inspector (Phase 19 Slice A) */
  .inspector { width: 360px; flex-shrink: 0; background: var(--sidebar); border-left: 1px solid var(--border-subtle); overflow-y: auto; }
  .insp-tabs { display: flex; gap: 20px; padding: 16px 20px 0; border-bottom: 1px solid var(--border); align-items: flex-end; }
  .insp-tab { font-size: 13px; font-weight: 500; color: var(--text-tertiary); padding-bottom: 10px; border-bottom: 2px solid transparent; }
  .insp-tab.active { color: var(--accent); font-weight: 600; border-bottom-color: var(--accent); }
  .insp-tab.disabled { color: var(--text-muted); cursor: default; }
  .insp-score { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
  .insp-score-row { display: flex; justify-content: space-between; align-items: center; }
  .insp-score-num { font-size: 40px; font-weight: 700; color: var(--text-primary); line-height: 1; font-variant-numeric: tabular-nums; }
  .insp-score-num span { font-size: 14px; font-weight: 500; color: var(--text-muted); margin-left: 2px; }
  .insp-grade { font-size: 11px; font-weight: 600; color: var(--text-secondary); background: var(--surface-elevated); border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px; }
  .insp-grade.warn { color: var(--accent-soft); }
  .insp-track { width: 100%; height: 8px; border-radius: 4px; background: var(--surface-elevated); overflow: hidden; }
  .insp-fill { height: 100%; border-radius: 4px; }
  .insp-divider { height: 1px; background: var(--border); }
  .insp-section { padding: 16px 20px; display: flex; flex-direction: column; gap: 11px; }
  .insp-section-head { display: flex; justify-content: space-between; align-items: center; }
  .insp-section-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); }
  .insp-count { font-size: 11px; font-weight: 700; color: var(--text-secondary); background: var(--surface-elevated); border-radius: 6px; padding: 2px 8px; }
  .insp-cat { display: flex; align-items: center; gap: 10px; }
  .insp-cat-name { width: 84px; flex-shrink: 0; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
  .insp-cat-track { flex: 1; height: 6px; border-radius: 3px; background: var(--surface-elevated); overflow: hidden; }
  .insp-cat-fill { display: block; height: 100%; border-radius: 3px; }
  .insp-cat-score { width: 28px; flex-shrink: 0; text-align: right; font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .insp-issue { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .insp-issue:hover { border-color: var(--border); background: var(--surface-hover); }
  .insp-issue.sel { border-color: var(--accent); background: var(--accent-tint); }
  .insp-issue--static { cursor: default; }
  .insp-issue--static:hover { border-color: var(--border-subtle); background: var(--surface); }
  .insp-issue-top { display: flex; align-items: center; gap: 8px; }
  .insp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .insp-badge { font-size: 10px; font-weight: 600; color: var(--accent-soft); background: var(--surface-elevated); border-radius: 6px; padding: 2px 7px; }
  .insp-fix { margin-left: auto; font-size: 10px; font-weight: 600; color: var(--success); }
  .insp-msg { font-size: 12px; font-weight: 500; color: var(--text-primary); line-height: 1.45; }
  .insp-sug { font-size: 11px; color: var(--text-tertiary); line-height: 1.45; }
  .insp-clean { font-size: 12px; color: var(--text-tertiary); padding: 4px 0; }
  /* Design-system pane (Phase 19 Slice B) */
  .insp-tab[data-tab] { cursor: pointer; }
  .insp-tabpane[hidden] { display: none; }
  .ds-default { font-size: 10px; font-weight: 500; color: var(--text-muted); }
  .ds-src { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 1px 5px; border-radius: 4px; }
  .ds-src--canvas { color: var(--accent-soft); background: var(--accent-tint); }
  .ds-src--project { color: #9dc0ef; background: rgba(59,130,246,0.14); }
  .ds-src--workspace { color: var(--text-tertiary); background: var(--surface-elevated); }
  .ds-src--default { color: var(--text-muted); background: var(--surface-elevated); }
  .ds-swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ds-swatch { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .ds-chip { width: 100%; height: 36px; border-radius: 8px; border: 1px solid var(--border-subtle); }
  .ds-swatch-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; min-width: 0; }
  .ds-name { font-size: 12px; font-weight: 600; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds-hex { font-size: 11px; font-weight: 500; color: var(--text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .ds-type { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .ds-type-sample { color: var(--text-primary); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds-type-meta { font-size: 10px; font-weight: 500; color: var(--text-muted); flex-shrink: 0; }
  .ds-sp { display: flex; align-items: center; gap: 10px; }
  .ds-sp-name { width: 36px; flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--text-secondary); }
  .ds-sp-bar { height: 8px; border-radius: 2px; background: var(--accent); flex-shrink: 0; }
  .ds-sp-val { font-size: 11px; font-weight: 500; color: var(--text-muted); }
  .ds-radii { display: flex; gap: 16px; }
  .ds-rad { display: flex; flex-direction: column; gap: 6px; align-items: center; }
  .ds-rad-tile { width: 56px; height: 40px; background: var(--surface-elevated); border: 1px solid var(--border); }
  .ds-rad-label { font-size: 10px; font-weight: 500; color: var(--text-muted); }
  /* Point-and-tell feedback (Phase 21 Slice B) */
  .fb-badge { font-size: 10px; font-weight: 700; color: var(--accent-soft); background: var(--accent-tint); border-radius: 8px; padding: 1px 6px; margin-left: 6px; font-variant-numeric: tabular-nums; }
  .fb-hint { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
  .fb-hint b { color: var(--text-secondary); }
  #fb-pane { display: flex; flex-direction: column; gap: 10px; }
  .fb-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .fb-card:hover { border-color: var(--border); background: var(--surface-hover); }
  .fb-card.sel { border-color: var(--accent); background: var(--accent-tint); }
  .fb-card.resolved { opacity: 0.55; cursor: default; }
  .fb-card-top { display: flex; align-items: center; gap: 8px; }
  .fb-anchor { font-size: 10px; font-weight: 600; color: var(--accent-soft); background: var(--surface-elevated); border-radius: 6px; padding: 2px 7px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fb-orphan { font-size: 10px; font-weight: 600; color: #d9a441; }
  .fb-when { margin-left: auto; font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .fb-comment { font-size: 12px; font-weight: 500; color: var(--text-primary); line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .fb-reply { font-size: 11px; color: var(--text-tertiary); line-height: 1.45; border-left: 2px solid var(--border); padding-left: 8px; }
  .fb-actions { display: flex; gap: 6px; margin-top: 2px; }
  .fb-btn { background: var(--surface-elevated); border: 1px solid var(--border); color: var(--text-secondary); padding: 3px 10px; border-radius: 5px; font-size: 10px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .fb-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .fb-btn--danger:hover { background: var(--danger-bg); border-color: var(--danger); color: #fecaca; }
  .fb-sep { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin-top: 4px; }
  .fb-empty { font-size: 12px; color: var(--text-tertiary); }
  /* Comment popover — parent-page overlay anchored near the clicked element. */
  .fb-popover { position: fixed; z-index: 30; width: 300px; background: var(--sidebar); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 28px rgba(0,0,0,0.45); }
  .fb-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .fb-chip { font-size: 10px; font-weight: 600; color: var(--text-tertiary); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; cursor: pointer; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fb-chip.sel { color: var(--accent-soft); background: var(--accent-tint); border-color: var(--accent); }
  .fb-popover textarea { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-family: inherit; font-size: 12px; line-height: 1.45; padding: 8px; min-height: 60px; resize: vertical; }
  .fb-popover textarea:focus { outline: none; border-color: var(--accent); }
  .fb-pop-actions { display: flex; justify-content: flex-end; gap: 6px; }
  @media (max-width: 900px) { .inspector { width: 300px; } }
  @media (max-width: 720px) { .detail-main { flex-direction: column; } .inspector { width: 100%; border-left: none; border-top: 1px solid var(--border-subtle); } }
  @media (max-width: 1100px) { .compare-grid { --scale: 0.28; gap: 18px; } }
  @media (max-width: 900px) { .compare-grid { --scale: 0.22; gap: 16px; } }
  @media (max-width: 640px) {
    .toolbar { flex-wrap: wrap; height: auto; min-height: 52px; padding: 10px 12px; gap: 8px; }
    .toolbar a { font-size: 13px; }
    .toolbar .title { font-size: 14px; min-width: 0; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar .dim, .toolbar .prov { display: none; }
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
    ${provChip}
    ${verdictChip}
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
      <button class="btn" onclick="toggleComment()" id="btn-comment" title="Click any element in the preview to leave a note for the agent">Comment</button>
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
  <div class="detail-main">
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
  ${inspectorHtml}
  </div>
  <div class="json-panel" id="json-panel">
    <pre id="json-content">Loading...</pre>
  </div>
  <script>
    const canvasId = '${canvas.id}';
    let lastModified = '${canvas.lastModified}';
    let currentBp = 'desktop';

    // Phase 21 — point-and-tell: initial feedback entries + node labels for
    // the breadcrumb. Kept fresh client-side via GET /api/canvas/:id/feedback.
    const FB_INIT = ${scriptJson(listFeedback(canvas, { includeResolved: true }))};
    const NODE_INDEX = ${scriptJson(buildNodeIndex(canvas.root))};

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

    // ── Phase 21 — point-and-tell feedback ─────────────────────────────────
    // Pane renderer: cards are built with DOM APIs (never innerHTML from user
    // text) so comment content can't inject markup.
    function nodeLabel(nodeId) {
      const n = NODE_INDEX[nodeId];
      return n ? (n.name || n.type) : nodeId;
    }

    function fbCard(entry) {
      const card = document.createElement('div');
      card.className = 'fb-card' + (entry.resolvedAt ? ' resolved' : '');
      const top = document.createElement('div');
      top.className = 'fb-card-top';
      const anchor = document.createElement('span');
      anchor.className = 'fb-anchor';
      anchor.textContent = entry.nodeId ? ((entry.node && (entry.node.name || entry.node.type)) || nodeLabel(entry.nodeId)) : 'whole page';
      top.appendChild(anchor);
      if (entry.orphaned) {
        const o = document.createElement('span');
        o.className = 'fb-orphan';
        o.title = 'The anchored node no longer exists — the concern may still apply to its replacement';
        o.textContent = 'node gone';
        top.appendChild(o);
      }
      const when = document.createElement('span');
      when.className = 'fb-when';
      when.textContent = new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      top.appendChild(when);
      card.appendChild(top);
      const msg = document.createElement('div');
      msg.className = 'fb-comment';
      msg.textContent = entry.comment;
      card.appendChild(msg);
      if (entry.resolutionNote) {
        const reply = document.createElement('div');
        reply.className = 'fb-reply';
        reply.textContent = (entry.resolvedBy === 'agent' ? 'agent: ' : '') + entry.resolutionNote;
        card.appendChild(reply);
      }
      if (!entry.resolvedAt) {
        const actions = document.createElement('div');
        actions.className = 'fb-actions';
        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'fb-btn';
        resolveBtn.textContent = 'Resolve';
        resolveBtn.onclick = (e) => { e.stopPropagation(); fbAction('/feedback/' + entry.id + '/resolve', 'POST'); };
        const delBtn = document.createElement('button');
        delBtn.className = 'fb-btn fb-btn--danger';
        delBtn.textContent = 'Delete';
        delBtn.onclick = (e) => { e.stopPropagation(); if (confirm('Delete this comment?')) fbAction('/feedback/' + entry.id, 'DELETE'); };
        actions.appendChild(resolveBtn);
        actions.appendChild(delBtn);
        card.appendChild(actions);
      }
      if (entry.nodeId && !entry.orphaned) {
        card.onclick = () => {
          const wasSel = card.classList.contains('sel');
          document.querySelectorAll('.fb-card.sel').forEach((o) => o.classList.remove('sel'));
          if (wasSel) { highlightNode(null, false); return; }
          card.classList.add('sel');
          highlightNode(entry.nodeId, true);
        };
      }
      return card;
    }

    function renderFeedbackPane(entries) {
      const pane = document.getElementById('fb-pane');
      const badge = document.getElementById('fb-badge');
      if (!pane) return;
      pane.replaceChildren();
      const open = entries.filter((e) => !e.resolvedAt);
      const done = entries.filter((e) => e.resolvedAt);
      if (badge) { badge.textContent = String(open.length); badge.hidden = open.length === 0; }
      if (!open.length && !done.length) {
        const empty = document.createElement('div');
        empty.className = 'fb-empty';
        empty.textContent = 'No comments yet.';
        pane.appendChild(empty);
        return;
      }
      open.forEach((e) => pane.appendChild(fbCard(e)));
      if (done.length) {
        const sep = document.createElement('div');
        sep.className = 'fb-sep';
        sep.textContent = 'Resolved';
        pane.appendChild(sep);
        done.forEach((e) => pane.appendChild(fbCard(e)));
      }
    }

    async function loadFeedback() {
      try {
        const res = await fetch('/api/canvas/' + canvasId + '/feedback');
        const data = await res.json();
        renderFeedbackPane(data.entries);
      } catch { /* pane keeps its last state */ }
    }

    async function fbAction(suffix, method) {
      try {
        const res = await fetch('/api/canvas/' + canvasId + suffix, { method });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        loadFeedback();
      } catch (err) { alert('Action failed: ' + err.message); }
    }

    // Comment mode: crosshair + hover outline inside the main iframe; click
    // resolves the nearest data-node-id, a popover picks scope + takes the note.
    let commentMode = false;
    const HOVER_STYLE_ID = 'fs-comment-hover';

    function frameDoc() {
      const frame = document.getElementById('frame');
      try { return frame.contentDocument; } catch { return null; }
    }

    function setFrameCommentAffordance(on) {
      const doc = frameDoc();
      if (!doc || !doc.body) return;
      doc.getElementById(HOVER_STYLE_ID)?.remove();
      if (on) {
        const style = doc.createElement('style');
        style.id = HOVER_STYLE_ID;
        style.textContent = 'body { cursor: crosshair !important; } [data-node-id]:hover { outline: 1px dashed #f59e0b !important; outline-offset: 1px; }';
        doc.head.appendChild(style);
      }
    }

    function onFrameClick(e) {
      if (!commentMode) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest ? e.target.closest('[data-node-id]') : null;
      const chain = [];
      let el = target;
      while (el) {
        chain.push(el.getAttribute('data-node-id'));
        el = el.parentElement && el.parentElement.closest('[data-node-id]');
      }
      openPopover(chain, e);
    }

    function hookFrame() {
      const doc = frameDoc();
      if (!doc) return;
      doc.removeEventListener('click', onFrameClick, true);
      doc.addEventListener('click', onFrameClick, true);
      setFrameCommentAffordance(commentMode);
    }

    function toggleComment() {
      commentMode = !commentMode;
      document.getElementById('btn-comment').classList.toggle('active', commentMode);
      if (!commentMode) closePopover();
      hookFrame();
    }

    let popoverEl = null;
    let popoverSelected = null; // nodeId or null = whole page

    function closePopover() {
      if (popoverEl) { popoverEl.remove(); popoverEl = null; }
      highlightNode(null, false);
    }

    function openPopover(chain, clickEvent) {
      closePopover();
      popoverSelected = chain.length ? chain[0] : null;
      const pop = document.createElement('div');
      pop.className = 'fb-popover';
      const chips = document.createElement('div');
      chips.className = 'fb-chips';
      const allChips = [];
      const makeChip = (label, nodeId, title) => {
        const chip = document.createElement('span');
        chip.className = 'fb-chip';
        chip.textContent = label;
        if (title) chip.title = title;
        chip.onclick = () => {
          popoverSelected = nodeId;
          allChips.forEach((c) => c.classList.remove('sel'));
          chip.classList.add('sel');
          highlightNode(nodeId, !!nodeId);
        };
        allChips.push(chip);
        chips.appendChild(chip);
        return chip;
      };
      chain.slice(0, 5).forEach((nodeId) => makeChip(nodeLabel(nodeId), nodeId, 'Anchor the comment to this element'));
      makeChip('whole page', null, 'A general note not tied to one element');
      const selIdx = chain.length ? 0 : allChips.length - 1;
      allChips[selIdx].classList.add('sel');
      if (popoverSelected) highlightNode(popoverSelected, true);
      pop.appendChild(chips);
      const ta = document.createElement('textarea');
      ta.placeholder = 'Tell the agent what to change…';
      pop.appendChild(ta);
      const actions = document.createElement('div');
      actions.className = 'fb-pop-actions';
      const cancel = document.createElement('button');
      cancel.className = 'fb-btn';
      cancel.textContent = 'Cancel';
      cancel.onclick = closePopover;
      const save = document.createElement('button');
      save.className = 'fb-btn';
      save.textContent = 'Save comment';
      save.onclick = async () => {
        const comment = ta.value.trim();
        if (!comment) { ta.focus(); return; }
        try {
          const res = await fetch('/api/canvas/' + canvasId + '/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(popoverSelected ? { nodeId: popoverSelected, comment } : { comment }),
          });
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          closePopover();
          loadFeedback();
          const fbTab = document.querySelector('.insp-tab[data-tab="feedback"]');
          if (fbTab) fbTab.click();
        } catch (err) { alert('Could not save comment: ' + err.message); }
      };
      actions.appendChild(cancel);
      actions.appendChild(save);
      pop.appendChild(actions);
      document.body.appendChild(pop);
      popoverEl = pop;
      // Position near the click, mapping iframe coords → page coords (handles
      // Fit-mode scaling); clamp so the popover stays on-screen.
      const frame = document.getElementById('frame');
      const rect = frame.getBoundingClientRect();
      const win = frame.contentWindow;
      const sx = win && win.innerWidth ? rect.width / win.innerWidth : 1;
      const sy = win && win.innerHeight ? rect.height / win.innerHeight : 1;
      const px = rect.left + clickEvent.clientX * sx;
      const py = rect.top + clickEvent.clientY * sy;
      pop.style.left = Math.max(8, Math.min(px, window.innerWidth - 316)) + 'px';
      pop.style.top = Math.max(60, Math.min(py + 8, window.innerHeight - pop.offsetHeight - 8)) + 'px';
      ta.focus();
    }

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
    document.getElementById('frame').addEventListener('load', hookFrame);
    hookFrame();
    renderFeedbackPane(FB_INIT);

    // Phase 19 Slice A — click an issue to outline its node in the preview.
    // The render carries data-node-id on every element; iframes are same-origin
    // so we toggle an outline directly in their documents.
    function highlightNode(nodeId, on) {
      const frames = [];
      const main = document.getElementById('frame');
      if (main && getComputedStyle(main).display !== 'none') frames.push(main);
      document.querySelectorAll('.compare-cell iframe').forEach((f) => frames.push(f));
      for (const f of frames) {
        let doc;
        try { doc = f.contentDocument; } catch { continue; }
        if (!doc) continue;
        doc.querySelectorAll('[data-fs-hl]').forEach((n) => {
          n.style.outline = ''; n.style.outlineOffset = ''; n.removeAttribute('data-fs-hl');
        });
        if (on && nodeId) {
          const t = doc.querySelector('[data-node-id="' + (window.CSS && CSS.escape ? CSS.escape(nodeId) : nodeId) + '"]');
          if (t) {
            t.style.outline = '2px solid #f59e0b'; t.style.outlineOffset = '1px';
            t.setAttribute('data-fs-hl', '1');
            t.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
      }
    }
    document.querySelectorAll('.insp-issue[data-issue-node]').forEach((el) => {
      el.addEventListener('click', () => {
        const wasSel = el.classList.contains('sel');
        document.querySelectorAll('.insp-issue.sel').forEach((o) => o.classList.remove('sel'));
        if (wasSel) { highlightNode(null, false); return; }
        el.classList.add('sel');
        highlightNode(el.getAttribute('data-issue-node'), true);
      });
    });

    // Phase 19 Slice B — inspector tab switching (Quality / Design system).
    document.querySelectorAll('.insp-tab[data-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.getAttribute('data-tab');
        document.querySelectorAll('.insp-tab[data-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.insp-tabpane').forEach((p) => { p.hidden = p.getAttribute('data-pane') !== name; });
      });
    });
  </script>
</body>
</html>`;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
