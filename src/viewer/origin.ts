// Who may talk to the viewer. It listens on 127.0.0.1 and sends no CORS
// header, so a page on another site cannot read its responses. Two gaps
// remain, and this closes both:
// - a page on another site can still SEND a simple POST or DELETE (no
//   preflight), so a write must come from the viewer's own pages;
// - DNS rebinding points another site's name at 127.0.0.1, making it
//   same-origin, so every request must name a loopback host.
import type { IncomingMessage } from 'node:http';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const READ_METHODS = new Set(['GET', 'HEAD']);

/** Why the viewer refuses a request, or null when it serves it. A request
 * with no Origin and no Sec-Fetch-Site (curl, the MCP server's probe) is
 * not a browser page, so it passes on its Host alone. */
export function refusalReason(req: IncomingMessage): string | null {
  const host = req.headers.host ?? '';
  let hostname = '';
  try { hostname = new URL(`http://${host}`).hostname; } catch { /* a malformed Host is refused below */ }
  if (!LOOPBACK_HOSTS.has(hostname)) return `host ${host || '(none)'} is not a loopback address`;
  if (READ_METHODS.has(req.method ?? 'GET')) return null;

  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return `a ${site} request cannot change canvases`;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return `origin ${origin} cannot change canvases`;
  return null;
}
