import './test-env.js';
// Phase 17 Slice C — canvas_import_url. All pages served from a local
// http server spun up in-test (no external network): styled page, selector
// narrowing, waitFor for JS-rendered content, auth header/cookie injection
// (the server echoes them into the DOM), relative-img resolution against the
// page URL, and the no-auth-persistence guarantee.
//
// Usage: npx tsx test-import-url.ts

import { createServer, type Server } from 'node:http';
import { importUrl } from './src/import.js';
import { shutdown } from './src/screenshot.js';
import type { SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

const find = (root: SceneNode, pred: (n: SceneNode) => boolean): SceneNode | null => {
  if (pred(root)) return root;
  for (const c of root.children ?? []) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
};

// 1×1 transparent PNG for the relative-img test.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const PAGE = (req: { authorization?: string; cookie?: string }) => `<!DOCTYPE html><html><head><style>
  body { margin: 0; font-family: Arial; }
  .card { display: flex; flex-direction: column; gap: 10px; padding: 20px; background-color: #1e293b; border-radius: 10px; width: 360px; }
  .title { font-size: 18px; font-weight: 700; color: #f8fafc; }
</style></head><body>
  <div class="card" id="card">
    <span class="title">Live import</span>
    <span id="auth">${req.authorization ?? 'no-auth'}</span>
    <span id="cookie">${req.cookie ?? 'no-cookie'}</span>
    <img src="/pixel.png" width="24" height="24" alt="pixel">
  </div>
  <div id="late-slot"></div>
  <script>setTimeout(function () {
    var el = document.createElement('p');
    el.id = 'late';
    el.textContent = 'Rendered late';
    document.getElementById('late-slot').appendChild(el);
  }, 2500); /* well past networkidle2's ~500ms settle, so the eager import misses it */</script>
</body></html>`;

const server: Server = createServer((req, res) => {
  if (req.url === '/pixel.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE({ authorization: req.headers.authorization, cookie: req.headers.cookie }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
const BASE = `http://127.0.0.1:${port}`;

try {
  // ── 1. basic live import ───────────────────────────────────────────────────
  {
    const { root, report } = await importUrl(`${BASE}/`, { viewport: { width: 800, height: 600 } });
    const card = find(root, (n) => n.fill === 'rgb(30, 41, 59)');
    expect('live page imports with computed styles', card !== null && card!.layout === 'vertical' && card!.gap === 10 && card!.cornerRadius === 10, JSON.stringify({ layout: card?.layout, gap: card?.gap }));
    const title = find(root, (n) => n.type === 'text' && n.content === 'Live import');
    expect('text imported', title !== null && title!.fontSize === 18 && title!.fontWeight === 700);
    const img = find(root, (n) => n.type === 'image');
    expect('relative img resolves against the page URL', img !== null && img!.src === `${BASE}/pixel.png`, String(img?.src));
    // Same-style sibling spans merge into one text run — match on content.
    expect('no-auth page shows no credentials', find(root, (n) => typeof n.content === 'string' && n.content.includes('no-auth') && n.content.includes('no-cookie')) !== null);
    expect('report populated', report.counts.nodes > 3, JSON.stringify(report.counts));
  }

  // ── 2. selector narrows ──────────────────────────────────────────────────
  {
    const { root } = await importUrl(`${BASE}/`, { selector: '#card' });
    expect('selector imports just the component', root.fill === 'rgb(30, 41, 59)' && find(root, (n) => n.id === 'late') === null);

    let missed: unknown;
    try { await importUrl(`${BASE}/`, { selector: '#nope' }); } catch (err) { missed = err; }
    expect('unmatched selector errors with the URL', missed instanceof Error && (missed as Error).message.includes('#nope'));
  }

  // ── 3. waitFor catches JS-rendered content ───────────────────────────────
  {
    const { root: eager } = await importUrl(`${BASE}/`);
    const { root: waited } = await importUrl(`${BASE}/`, { waitFor: '#late' });
    expect('without waitFor the late node is absent', find(eager, (n) => n.content === 'Rendered late') === null);
    expect('waitFor selector captures JS-rendered content', find(waited, (n) => n.content === 'Rendered late') !== null);
  }

  // ── 4. auth injection + non-persistence ──────────────────────────────────
  {
    const { root, report } = await importUrl(`${BASE}/`, {
      auth: {
        headers: { Authorization: 'Bearer sekrit-token-123' },
        cookies: [{ name: 'session', value: 'sekrit-cookie-456' }],
      },
    });
    expect('auth header reaches the page', find(root, (n) => typeof n.content === 'string' && n.content.includes('sekrit-token-123')) !== null);
    expect('cookie reaches the page', find(root, (n) => typeof n.content === 'string' && n.content.includes('session=sekrit-cookie-456')) !== null);
    // The page ECHOES credentials into its DOM (that's the page's choice) — but
    // the import machinery itself must not record them anywhere structural.
    const reportJson = JSON.stringify(report);
    expect('report carries no credentials', !reportJson.includes('sekrit-token-123') && !reportJson.includes('sekrit-cookie-456'));
  }

  // ── 5. URL validation ─────────────────────────────────────────────────────
  {
    let bad: unknown;
    try { await importUrl('file:///etc/passwd'); } catch (err) { bad = err; }
    expect('non-http URLs are rejected', bad instanceof Error && (bad as Error).message.includes('http'));
  }
} finally {
  server.close();
  await shutdown();
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
