// Phase 10 — asset externalization.
//
// Base64 `data:` URIs (images) inlined in a canvas bloat the committed JSON and
// wreck its diff. When writing to a repo `.canvas/`, we extract each `data:`
// payload to `.canvas/assets/<content-hash>.<ext>` and replace the value with a
// compact `asset:<file>` reference. On read we rehydrate the reference back to a
// `data:` URI, so the in-memory canvas is always fully inline — the renderer,
// evaluator, and viewer never need to know assets exist. Externalization is
// purely an on-disk serialization concern.
//
// Content-hash filenames make writes deterministic and dedupe identical images.

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Canvas, SceneNode } from './types.js';

const ASSETS_DIR = 'assets';
const ASSET_SCHEME = 'asset:';
// data:<mime>[;base64],<payload>  (s flag: payload may contain newlines)
const DATA_URI_RE = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

function extForMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] ?? 'bin';
}

function mimeForExt(ext: string): string {
  const hit = Object.entries(MIME_TO_EXT).find(([, e]) => e === ext);
  return hit ? hit[0] : 'application/octet-stream';
}

/** Walk every node's `src`, applying `fn` and replacing the value when it
 * returns a string. Returns a deep clone — the input canvas is untouched. */
function mapSrc(canvas: Canvas, fn: (src: string) => string | null): Canvas {
  const clone = structuredClone(canvas);
  const walk = (node: SceneNode) => {
    if (typeof node.src === 'string') {
      const next = fn(node.src);
      if (next !== null) node.src = next;
    }
    node.children?.forEach(walk);
  };
  walk(clone.root);
  return clone;
}

/** Replace inline `data:` image URIs with `asset:<file>` refs, writing each
 * binary into `<rootDir>/assets/`. Used before serializing a canvas to disk. */
export function externalizeAssets(rootDir: string, canvas: Canvas): Canvas {
  return mapSrc(canvas, (src) => {
    if (!src.startsWith('data:')) return null;
    const m = DATA_URI_RE.exec(src);
    if (!m) return null;
    const [, mime, base64Flag, payload] = m;
    const buf = base64Flag
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf-8');
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const file = `${hash}.${extForMime(mime)}`;
    const dir = join(rootDir, ASSETS_DIR);
    const abs = join(dir, file);
    if (!existsSync(abs)) {
      mkdirSync(dir, { recursive: true });
      const tmp = `${abs}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, abs);
    }
    return `${ASSET_SCHEME}${file}`;
  });
}

/** Replace `asset:<file>` refs with the `data:` URI read from `<rootDir>/assets/`.
 * Used after reading a canvas from disk so downstream code sees inline images. */
export function rehydrateAssets(rootDir: string, canvas: Canvas): Canvas {
  return mapSrc(canvas, (src) => {
    if (!src.startsWith(ASSET_SCHEME)) return null;
    const file = src.slice(ASSET_SCHEME.length);
    // Reject anything that could escape the assets dir.
    if (file.includes('/') || file.includes('\\') || file.includes('..')) return null;
    const abs = join(rootDir, ASSETS_DIR, file);
    if (!existsSync(abs)) return null;
    try {
      const buf = readFileSync(abs);
      const ext = file.split('.').pop() ?? '';
      return `data:${mimeForExt(ext)};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  });
}
