import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Phase 16 Slice B — two bundled icon sets behind one `icon` prop:
//   - Lucide (stroke-based, 1,900+): unprefixed names — `icon: "search"` (back-compat)
//   - Material Symbols (fill-based, 3,800+ × outlined/rounded/sharp): `icon: "material:check"`,
//     style picked by `iconStyle` (default outlined); `-fill` suffixed names
//     (`material:check-fill`) select the filled variant — they ship as distinct files.
// Lucide preloads its whole directory once (small set, existing behavior);
// Material reads per-icon on demand (7,800 files per style — preloading would
// cost hundreds of ms for icons mostly never used) with a per-name cache.

export type MaterialStyle = 'outlined' | 'rounded' | 'sharp';

export interface IconRef {
  set: 'lucide' | 'material';
  name: string;
}

/** Split an icon reference on the set prefix. Unprefixed → Lucide (back-compat);
 * unknown prefixes are treated as Lucide names (a Lucide miss degrades to the
 * unknown-icon comment downstream, same as any typo). */
export function parseIconRef(ref: string): IconRef {
  const sep = ref.indexOf(':');
  if (sep > 0 && ref.slice(0, sep).toLowerCase() === 'material') {
    return { set: 'material', name: ref.slice(sep + 1).trim() };
  }
  return { set: 'lucide', name: ref };
}

// ── Lucide (stroke-based, preloaded) ─────────────────────────────────────────

let lucideCache: Map<string, string> | null = null;

function getLucideDir(): string {
  // Resolve from lucide-static package
  const lucidePath = dirname(fileURLToPath(import.meta.resolve('lucide-static')));
  // lucidePath points to dist/esm or dist/cjs, go up to package root
  const packageRoot = join(lucidePath, '..', '..');
  return join(packageRoot, 'icons');
}

function loadLucide(): Map<string, string> {
  if (lucideCache) return lucideCache;
  lucideCache = new Map();

  const iconsDir = getLucideDir();
  const files = readdirSync(iconsDir).filter((f) => f.endsWith('.svg'));
  for (const file of files) {
    const name = basename(file, '.svg');
    const svg = readFileSync(join(iconsDir, file), 'utf-8');
    lucideCache.set(name, svg);
  }

  return lucideCache;
}

function lucideSvg(name: string, size: number, color?: string): string | null {
  const svg = loadLucide().get(name);
  if (!svg) return null;

  // Replace size and color attributes
  let result = svg
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`);

  if (color) {
    result = result.replace(/stroke="currentColor"/, `stroke="${color}"`);
  }

  // Remove the license comment for cleaner HTML
  result = result.replace(/<!--.*?-->\n?/s, '');

  return result;
}

// ── Material Symbols (fill-based, on-demand) ─────────────────────────────────

const MATERIAL_STYLES: readonly MaterialStyle[] = ['outlined', 'rounded', 'sharp'];
const materialCache = new Map<string, string | null>(); // "style/name" → raw svg (null = known miss)
let materialRoot: string | null | undefined; // undefined = not probed, null = package missing

function getMaterialRoot(): string | null {
  if (materialRoot !== undefined) return materialRoot;
  try {
    // The package has no JS entry point — resolve its package.json and take the dir.
    materialRoot = dirname(fileURLToPath(import.meta.resolve('@material-symbols/svg-400/package.json')));
  } catch {
    materialRoot = null;
  }
  return materialRoot;
}

function materialSvg(name: string, size: number, color?: string, style: MaterialStyle = 'outlined'): string | null {
  if (!name || !/^[a-z0-9-]+$/i.test(name)) return null; // names are file paths — reject anything path-like
  const resolvedStyle = MATERIAL_STYLES.includes(style) ? style : 'outlined';
  const key = `${resolvedStyle}/${name}`;

  let raw = materialCache.get(key);
  if (raw === undefined) {
    const root = getMaterialRoot();
    const path = root ? join(root, resolvedStyle, `${name}.svg`) : null;
    raw = path && existsSync(path) ? readFileSync(path, 'utf-8') : null;
    materialCache.set(key, raw);
  }
  if (!raw) return null;

  // Material SVGs ship width/height="48" and fill-inheriting paths (no fill attr).
  let result = raw
    .replace(/width="48"/, `width="${size}"`)
    .replace(/height="48"/, `height="${size}"`);
  if (color) {
    result = result.replace('<svg ', `<svg fill="${color}" `);
  }
  return result;
}

// ── public API ───────────────────────────────────────────────────────────────

export function getIconSvg(ref: string, size = 24, color?: string, style?: MaterialStyle): string | null {
  const { set, name } = parseIconRef(ref);
  // Color is interpolated into an SVG attribute — drop anything that could
  // escape it (an unresolved/malformed value degrades to currentColor).
  const safeColor = color && !/["'<>;]/.test(color) ? color : undefined;
  return set === 'material' ? materialSvg(name, size, safeColor, style) : lucideSvg(name, size, safeColor);
}

export function listIconNames(): string[] {
  return Array.from(loadLucide().keys()).sort();
}
