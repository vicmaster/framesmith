// Phase 33 slice A — the viewer's HTTP server and routes, moved from viewer.ts.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { getCanvas, listCanvases, archiveCanvas, unarchiveCanvas, deleteCanvas, ensureFresh, touchCanvas } from '../scene-graph.js';
import { expandTree } from '../expand.js';
import { renderToHtml } from '../renderer.js';
import { getCanvasTokens } from '../workspaces.js';
import { getRepoLocation, archiveRepoCanvas, deleteRepoCanvas, updateRepoCanvas } from '../aggregate.js';
import { DEFAULT_PROJECT_ID, type Canvas } from '../types.js';
import { resolveSurface } from '../surfaces.js';
import { resolveGenre } from '../evaluate.js';
import { addFeedback, listFeedback, resolveFeedback, deleteFeedback, openFeedbackCount } from '../feedback.js';
import { cachedFontFile, resolveFamily } from '../fonts.js';
import { evalCacheKey } from './scores.js';
import { renderProjectPage } from './pages/project.js';
import { renderArchivePage } from './pages/archive.js';
import { renderDetailPage, renderInspectorParts } from './pages/detail.js';
import { feedbackKey } from './feedback-key.js';
import { VIEWER_FONT_FAMILIES } from './tokens.js';

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
  // Warm the viewer's own fonts in the background, once. Pages read the cache
  // on every render, so a warm-up that lands after the first page shows on the
  // next load; offline, the fallback stack draws until the viewer restarts.
  for (const family of VIEWER_FONT_FAMILIES) resolveFamily(family).catch(() => {});

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${runningPort ?? port}`);
    const path = url.pathname;

    // CORS headers for API routes
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // Phase 33 — the design system's fonts, from the font cache by file name.
      const fontMatch = path.match(/^\/assets\/fonts\/([^/]+)$/);
      if (fontMatch) {
        const font = cachedFontFile(fontMatch[1]);
        if (!font) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': font.mime, 'Cache-Control': 'max-age=31536000, immutable' });
        res.end(readFileSync(font.path));
        return;
      }

      // API: list canvases
      if (path === '/api/canvases') {
        res.setHeader('Content-Type', 'application/json');
        // Phase 33 slice B — each row carries its type and genre, which the
        // gallery's live poll compares (FR-B4).
        res.end(JSON.stringify(listCanvases().map((row) => {
          const canvas = getCanvas(row.id);
          return canvas ? { ...row, type: resolveSurface(canvas).type, genre: resolveGenre(canvas).genre } : row;
        })));
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
          // Content hash for the poll loop — catches edits that don't bump
          // lastModified (hand-edited repo JSON, metadata stamps; issue #150).
          contentKey: evalCacheKey(canvas),
          width: canvas.root.width,
          height: canvas.root.height,
          type: resolveSurface(canvas).type,
          safeArea: canvas.root.safeArea,
          // Phase 33 FR-D4 — changes when a comment is added, resolved or deleted.
          feedbackKey: feedbackKey(canvas),
        }));
        return;
      }

      // Canvas raw HTML (for iframe) — supports ?w=WIDTH&h=HEIGHT overrides
      const htmlMatch = path.match(/^\/canvas\/([^/]+)\/html$/);
      if (htmlMatch) {
        const canvas = getCanvas(htmlMatch[1]);
        if (!canvas) { res.writeHead(404); res.end('Not found'); return; }
        // Phase 25 slice D — ?theme=dark renders the dark token layer.
        const theme = url.searchParams.get('theme') === 'dark' ? 'dark' as const : undefined;
        const resolved = expandTree(canvas.root, canvas, getCanvasTokens(canvas), { theme }).root;
        const defaultW = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
        const defaultH = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
        const w = url.searchParams.has('w') ? parseInt(url.searchParams.get('w')!, 10) : defaultW;
        const h = url.searchParams.has('h') ? parseInt(url.searchParams.get('h')!, 10) : defaultH;
        // skeletonPulse: the live viewer is the ONE context where skeleton
        // blocks animate — screenshots/exports/diffs stay static.
        const html = renderToHtml(resolved, w, h, canvas, { skeletonPulse: true });
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }

      // Canvas JSON
      // Phase 33 FR-D4 — the inspector's Quality and Design system panels and
      // the node index, for the detail page's live swap.
      const inspectorMatch = path.match(/^\/canvas\/([^/]+)\/inspector$/);
      if (inspectorMatch) {
        const canvas = getCanvas(inspectorMatch[1]);
        if (!canvas) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(await renderInspectorParts(canvas)));
        return;
      }

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
