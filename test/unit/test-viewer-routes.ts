// Phase 33 slice A (FR-A1, FR-A3) — every viewer route still answers after the
// move into src/viewer/, with its status and content type; and the new font
// route serves a cached file and nothing else.
//
// Usage: npx tsx test/unit/test-viewer-routes.ts

import '../env.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject } from '../../src/workspaces.js';
import { createCanvas, archiveCanvas } from '../../src/scene-graph.js';
import { startViewer } from '../../src/viewer.js';
import { DEFAULT_PROJECT_ID } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** A free port, so the test never meets a running viewer on 3001. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

loadPersistedWorkspaces();
ensureDefaultWorkspaceAndProject();
const canvas = createCanvas('routes', DEFAULT_PROJECT_ID);
const gone = createCanvas('to-delete', DEFAULT_PROJECT_ID);

// A cached font file, as the font cache stores it (FRAMESMITH_HOME/fonts).
const fontsDir = join(process.env.FRAMESMITH_HOME!, 'fonts');
mkdirSync(fontsDir, { recursive: true });
writeFileSync(join(fontsDir, 'abc123.woff2'), Buffer.from('wOF2-test'));

const port = await startViewer(await freePort());
const base = `http://127.0.0.1:${port}`;

async function expect(method: string, path: string, status: number, type?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  const ct = res.headers.get('content-type') ?? '';
  check(`${method} ${path} → ${status}${type ? ` ${type}` : ''}`, res.status === status && (!type || ct.startsWith(type)), `${res.status} ${ct}`);
  return res;
}

const root = await expect('GET', '/', 302);
check('GET / redirects to the default project', root.headers.get('location') === `/project/${DEFAULT_PROJECT_ID}`, root.headers.get('location') ?? '');
await expect('GET', `/project/${DEFAULT_PROJECT_ID}`, 200, 'text/html');
await expect('GET', '/project/nope', 404);
await expect('GET', `/canvas/${canvas.id}`, 200, 'text/html');
await expect('GET', `/canvas/${canvas.id}/html`, 200, 'text/html');
await expect('GET', `/canvas/${canvas.id}/html?w=390&h=844&theme=dark`, 200, 'text/html');
await expect('GET', `/canvas/${canvas.id}/json`, 200, 'application/json');
await expect('GET', '/canvas/nope', 404);
await expect('GET', '/archive', 200, 'text/html');
await expect('GET', '/api/canvases', 200, 'application/json');
const meta = await (await expect('GET', `/api/canvas/${canvas.id}/meta`, 200, 'application/json')).json() as { id: string; contentKey?: string };
check('meta carries the id and a contentKey', meta.id === canvas.id && typeof meta.contentKey === 'string');
await expect('GET', `/api/canvas/${canvas.id}/feedback`, 200, 'application/json');

const added = await (await expect('POST', `/api/canvas/${canvas.id}/feedback`, 200, 'application/json', { comment: 'tighten the header' })).json() as { entry?: { id: string }; id?: string };
const fbId = added.entry?.id ?? added.id;
check('feedback POST returns the new entry id', typeof fbId === 'string', JSON.stringify(added).slice(0, 120));
await expect('POST', `/api/canvas/${canvas.id}/feedback/${fbId}/resolve`, 200, 'application/json', { note: 'done' });
await expect('DELETE', `/api/canvas/${canvas.id}/feedback/${fbId}`, 200);
await expect('POST', `/api/canvas/${canvas.id}/feedback`, 400, undefined, { nodeId: 'no-such-node', comment: 'x' });

await expect('POST', `/api/canvas/${canvas.id}/archive`, 200);
await expect('POST', `/api/canvas/${canvas.id}/unarchive`, 200);
archiveCanvas(gone.id);
await expect('DELETE', `/api/canvas/${gone.id}`, 200);

// FR-A3: the font route.
const font = await expect('GET', '/assets/fonts/abc123.woff2', 200, 'font/woff2');
check('font route: long-lived immutable cache header', (font.headers.get('cache-control') ?? '').includes('immutable'));
check('font route: serves the cached bytes', (await font.text()) === 'wOF2-test');
await expect('GET', '/assets/fonts/missing.woff2', 404);
await expect('GET', '/assets/fonts/registry.json', 404);
await expect('GET', '/assets/fonts/..%2Fregistry.json', 404);

await expect('GET', '/no/such/route', 404);

process.exit(allPass ? 0 : 1);
