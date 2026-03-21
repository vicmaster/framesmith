import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

let iconCache: Map<string, string> | null = null;

function getIconsDir(): string {
  // Resolve from lucide-static package
  const lucidePath = dirname(fileURLToPath(import.meta.resolve('lucide-static')));
  // lucidePath points to dist/esm or dist/cjs, go up to package root
  const packageRoot = join(lucidePath, '..', '..');
  return join(packageRoot, 'icons');
}

function loadIcons(): Map<string, string> {
  if (iconCache) return iconCache;
  iconCache = new Map();

  const iconsDir = getIconsDir();
  const files = readdirSync(iconsDir).filter((f) => f.endsWith('.svg'));
  for (const file of files) {
    const name = basename(file, '.svg');
    const svg = readFileSync(join(iconsDir, file), 'utf-8');
    iconCache.set(name, svg);
  }

  return iconCache;
}

export function getIconSvg(name: string, size = 24, color?: string): string | null {
  const icons = loadIcons();
  const svg = icons.get(name);
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

export function listIconNames(): string[] {
  const icons = loadIcons();
  return Array.from(icons.keys()).sort();
}
