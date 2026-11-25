// The viewer serves only its own pages: no CORS header on any response, a
// write (POST or DELETE) refused from another origin or site, and every
// request refused when its Host is not a loopback name (DNS rebinding).
// Raw requests, so each header is exactly what a browser or curl would send.
//
// Usage: npx tsx test/unit/test-viewer-origin.ts

import '../env.js';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject } from '../../src/workspaces.js';
import { createCanvas, getCanvas } from '../../src/scene-graph.js';
import { startViewer } from '../../src/viewer.js';
import { DEFAULT_PROJECT_ID } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
const canvas = createCanvas('origin', DEFAULT_PROJECT_ID);

const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address() as { port: number }; s.close(() => resolve(p)); });
});
await startViewer(port);
const self = `127.0.0.1:${port}`;

interface Reply { status: number; headers: Record<string, unknown> }
function send(method: string, path: string, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers, setHost: !('Host' in headers) }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
const archive = `/api/canvas/${canvas.id}/archive`;
const unarchive = `/api/canvas/${canvas.id}/unarchive`;
const archived = () => getCanvas(canvas.id)?.archived === true;

// ── reads ────────────────────────────────────────────────────────────────────
const list = await send('GET', '/api/canvases', { Host: self });
check('a read from the viewer\'s host is served', list.status === 200);
check('…with no CORS header', !('access-control-allow-origin' in list.headers));
const page = await send('GET', `/canvas/${canvas.id}/json`, { Host: self, Origin: 'https://evil.example' });
check('a cross-origin read is served but carries no CORS header, so the page cannot read it', page.status === 200 && !('access-control-allow-origin' in page.headers));
check('localhost and [::1] are loopback hosts too', (await send('GET', '/api/canvases', { Host: `localhost:${port}` })).status === 200 && (await send('GET', '/api/canvases', { Host: `[::1]:${port}` })).status === 200);
check('a rebinding host is refused, reads included', (await send('GET', '/api/canvases', { Host: `evil.example:${port}` })).status === 403);
check('a request with no Host is refused', (await send('GET', '/api/canvases', { Host: '' })).status === 403);

// ── writes ───────────────────────────────────────────────────────────────────
let r = await send('POST', archive, { Host: self, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' });
check('a cross-site POST is refused', r.status === 403 && !archived(), String(r.status));
r = await send('POST', archive, { Host: self, Origin: 'https://evil.example' });
check('a foreign Origin is refused without Sec-Fetch-Site', r.status === 403 && !archived());
r = await send('POST', archive, { Host: self, Origin: 'null' });
check('a null Origin (sandboxed frame, file page) is refused', r.status === 403 && !archived());
r = await send('POST', archive, { Host: self, Origin: 'http://localhost:9', 'Sec-Fetch-Site': 'same-site' });
check('another localhost port is same-site, not same-origin: refused', r.status === 403 && !archived());
r = await send('DELETE', `/api/canvas/${canvas.id}`, { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}`, 'Sec-Fetch-Site': 'same-origin' });
check('a rebinding page is same-origin to itself, and still refused by its host', r.status === 403 && !!getCanvas(canvas.id));

r = await send('POST', archive, { Host: self, Origin: `http://${self}`, 'Sec-Fetch-Site': 'same-origin' });
check('the viewer\'s own page can archive', r.status === 200 && archived());
r = await send('POST', unarchive, { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, 'Sec-Fetch-Site': 'same-origin' });
check('…also when opened as localhost', r.status === 200 && !archived());
r = await send('POST', archive, { Host: self });
check('a client with no Origin (curl, a script) can still write', r.status === 200 && archived());

process.exit(allPass ? 0 : 1);
