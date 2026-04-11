import { createServer, type Server } from 'node:http';
import { getCanvas, listCanvases } from './scene-graph.js';
import { resolveVariables } from './variables.js';
import { renderToHtml } from './renderer.js';
import type { Canvas } from './types.js';

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
        const resolved = resolveVariables(canvas.root, canvas.variables);
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

      // Gallery (index)
      if (path === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(renderGalleryPage(runningPort ?? 3001));
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

function renderGalleryPage(port: number): string {
  const canvases = listCanvases();
  const cards = canvases.map((c) => {
    const canvas = getCanvas(c.id)!;
    const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
    const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;
    const date = new Date(c.createdAt).toLocaleString();
    return `
      <a href="/canvas/${c.id}" class="card">
        <div class="thumb">
          <iframe src="/canvas/${c.id}/html" scrolling="no" loading="lazy"></iframe>
        </div>
        <div class="info">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${w} x ${h} &middot; ${esc(date)}</div>
        </div>
      </a>`;
  }).join('\n');

  const empty = canvases.length === 0
    ? `<div class="empty">
        <div class="empty-icon">&#9634;</div>
        <div>No canvases yet</div>
        <div class="empty-hint">Create one via your MCP client using <code>canvas_create</code></div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Canvas MCP Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; }
  .header { padding: 24px 32px; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 20px; font-weight: 600; color: #fff; }
  .header .badge { background: #3b82f6; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 500; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; padding: 32px; }
  .card { background: #111; border: 1px solid #222; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; transition: border-color 0.2s, transform 0.2s; }
  .card:hover { border-color: #3b82f6; transform: translateY(-2px); }
  .thumb { width: 100%; aspect-ratio: 16/10; overflow: hidden; background: #0a0a0a; position: relative; }
  .thumb iframe { width: 1440px; height: 900px; border: none; transform-origin: 0 0; transform: scale(0.222); pointer-events: none; position: absolute; top: 0; left: 0; }
  .info { padding: 16px; }
  .name { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #666; }
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 120px 32px; color: #555; font-size: 16px; }
  .empty-icon { font-size: 48px; opacity: 0.3; }
  .empty-hint { font-size: 13px; color: #444; }
  .empty-hint code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>Canvas MCP</h1>
    <span class="badge">${canvases.length} canvas${canvases.length !== 1 ? 'es' : ''}</span>
  </div>
  ${canvases.length > 0 ? `<div class="grid">${cards}</div>` : empty}
  <script>
    // Auto-refresh gallery every 3 seconds
    let lastCount = ${canvases.length};
    setInterval(async () => {
      try {
        const res = await fetch('/api/canvases');
        const data = await res.json();
        if (data.length !== lastCount) location.reload();
      } catch {}
    }, 3000);
  </script>
</body>
</html>`;
}

function renderDetailPage(canvas: Canvas, port: number): string {
  const w = typeof canvas.root.width === 'number' ? canvas.root.width : 1440;
  const h = typeof canvas.root.height === 'number' ? canvas.root.height : 900;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(canvas.name)} — Canvas MCP</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { height: 52px; background: #111; border-bottom: 1px solid #222; display: flex; align-items: center; padding: 0 20px; gap: 16px; flex-shrink: 0; }
  .toolbar a { color: #888; text-decoration: none; font-size: 14px; display: flex; align-items: center; gap: 6px; }
  .toolbar a:hover { color: #fff; }
  .toolbar .title { font-size: 15px; font-weight: 600; color: #fff; }
  .toolbar .dim { font-size: 12px; color: #555; }
  .toolbar .spacer { flex: 1; }
  .toolbar .btn { background: #1a1a1a; border: 1px solid #333; color: #ccc; padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; }
  .toolbar .btn:hover { background: #222; color: #fff; }
  .toolbar .btn.active { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  .status { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
  .status.stale { background: #555; }
  .viewport { flex: 1; display: flex; align-items: flex-start; justify-content: center; overflow: auto; background: #0a0a0a; padding: 24px 0; }
  .viewport iframe { border: none; background: #fff; transition: width 0.3s, height 0.3s; transform-origin: top center; }
  .viewport.fit iframe { width: 100% !important; height: 100% !important; }
  .json-panel { display: none; position: fixed; top: 52px; right: 0; bottom: 0; width: 480px; background: #111; border-left: 1px solid #222; overflow: auto; z-index: 10; }
  .json-panel.open { display: block; }
  .json-panel pre { padding: 20px; font-size: 12px; color: #a0a0a0; font-family: 'JetBrains Mono', 'Fira Code', monospace; white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>
  <div class="toolbar">
    <a href="/">&larr; Back</a>
    <span class="title">${esc(canvas.name)}</span>
    <span class="dim">${w} x ${h}</span>
    <div class="spacer"></div>
    <button class="btn" onclick="setViewport(390, 844)" id="bp-mobile">Mobile</button>
    <button class="btn" onclick="setViewport(768, 1024)" id="bp-tablet">Tablet</button>
    <button class="btn active" onclick="setViewport(${w}, ${h})" id="bp-desktop">Desktop</button>
    <button class="btn" onclick="toggleFit()" id="btn-fit">Fit</button>
    <button class="btn" onclick="toggleJson()" id="btn-json">JSON</button>
    <div class="status" id="status" title="Auto-refresh active"></div>
  </div>
  <div class="viewport" id="viewport">
    <iframe id="frame" src="/canvas/${canvas.id}/html" width="${w}" height="${h}"></iframe>
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
          document.getElementById('frame').src = '/canvas/' + canvasId + '/html?t=' + Date.now();
          // Update JSON if panel is open
          if (document.getElementById('json-panel').classList.contains('open')) loadJson();
        }
      } catch {
        document.getElementById('status').className = 'status stale';
      }
    }, 2000);

    const canvasW = ${w};
    const canvasH = ${h};

    function setViewport(w, h) {
      const frame = document.getElementById('frame');
      const vp = document.getElementById('viewport');
      vp.classList.remove('fit');
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
  </script>
</body>
</html>`;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
