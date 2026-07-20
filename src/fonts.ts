// Phase 16 Slice A — fonts by name (spec C1: hybrid loading).
//
// A font family named anywhere (typography token, node fontFamily, or explicit
// set_fonts registration) should render in that face with zero extra agent
// steps. Two cooperating halves:
//   - write-time: token/font writes call `warmFamilies` so resolution + caching
//     happen when the intent is declared (failures are warnings, never write
//     failures);
//   - render-time backstop: `ensureFontsForRender` collects every referenced
//     family before a render, serves cached binaries as data: URIs, and only
//     touches the network for families the write path never saw.
//
// Resolution is Google Fonts css2 → @font-face extraction via regex (no CSS
// parser dependency) → binary download → content-hashed cache under
// `<FRAMESMITH_HOME>/fonts/` with a registry.json index. After the first
// resolve a family renders offline and deterministically. An unresolvable
// family degrades to the fallback stack plus an explicit warning — the one
// thing this module must never do is fail or block a render.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Canvas, DesignVariables, FontFace, SceneNode } from './types.js';

// Same env contract as scene-graph.ts/workspaces.ts so test-env.ts redirects
// the font cache along with everything else.
function fontsDir(): string {
  const home = process.env.FRAMESMITH_HOME ?? process.env.CANVAS_MCP_HOME ?? join(homedir(), '.framesmith');
  return join(home, 'fonts');
}

/** Families the renderer's fallback stack already covers (or that no font
 * provider can resolve) — never sent to Google Fonts. Compared lowercased. */
export const SYSTEM_FAMILIES: ReadonlySet<string> = new Set([
  'system-ui', '-apple-system', 'blinkmacsystemfont',
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'math', 'emoji',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'segoe ui', 'helvetica', 'helvetica neue', 'arial', 'arial black',
  'georgia', 'times', 'times new roman', 'courier', 'courier new',
  'verdana', 'tahoma', 'trebuchet ms', 'impact',
  'sf pro', 'sf pro text', 'sf pro display', 'sf mono', 'menlo', 'monaco', 'consolas',
  'roboto', // ships on Android/ChromeOS and is the renderer stack's own fallback member
  // Phase 22 slice D (#134) — shorthand generics. Aliased to the real CSS
  // generic at render time (GENERIC_ALIASES); listed here so they're never
  // sent to Google Fonts and never warned about.
  'mono', 'sans',
]);

/** Phase 22 slice D (#134) — shorthand → CSS generic. The renderer substitutes
 * these when emitting font-family so `fontFamily: "mono"` renders monospaced
 * instead of falling through to the browser's default (serif). Compared
 * lowercased. Upgrade a generic to a real face anytime via set_fonts (the
 * family label you pass is the family that gets registered). */
export const GENERIC_ALIASES: Readonly<Record<string, string>> = {
  mono: 'monospace',
  sans: 'sans-serif',
};

/** Substitute GENERIC_ALIASES entries in a font stack, leaving everything else
 * verbatim: `"JetBrains Mono, mono"` → `"JetBrains Mono, monospace"`.
 *
 * `registered` (lowercased canvas.fonts family names) skips the substitution:
 * a family explicitly registered under a reserved label (e.g.
 * `set_fonts({ fonts: [{ family: "mono", url: <css2 URL> }] })`) must actually
 * reach the @font-face rule declared under that label, or the registration
 * would be silently dead. */
export function aliasFamilyStack(stack: string, registered?: ReadonlySet<string>): string {
  return stack
    .split(',')
    .map((raw) => {
      const bare = raw.trim().replace(/^["']|["']$/g, '').trim();
      const lower = bare.toLowerCase();
      if (registered?.has(lower)) return raw.trim();
      return GENERIC_ALIASES[lower] ?? raw.trim();
    })
    .join(', ');
}

// Family names are interpolated into CSS + URLs; same guard as the renderer's
// isSafeFamily plus `$` (an unresolved token reference is not a family).
function isResolvableName(family: string): boolean {
  return family.length > 0 && family.length < 80 && !/["';{}\n\r<>$\\]/.test(family);
}

/** First family in a CSS font stack that a provider could plausibly resolve:
 * strips quotes, skips system/generic families. `"Inter, system-ui"` → `"Inter"`;
 * `"system-ui, sans-serif"` → null. */
export function firstResolvableFamily(stack: string): string | null {
  for (const raw of stack.split(',')) {
    const family = raw.trim().replace(/^["']|["']$/g, '').trim();
    if (!family) continue;
    if (SYSTEM_FAMILIES.has(family.toLowerCase())) continue;
    if (!isResolvableName(family)) continue;
    return family;
  }
  return null;
}

/** Every resolvable family referenced by a (token-resolved) scene tree plus the
 * merged typography tokens, deduped in first-seen order. */
export function collectReferencedFamilies(root: SceneNode, merged?: DesignVariables): string[] {
  const seen = new Map<string, string>(); // lower → original
  const add = (stack: string | undefined) => {
    if (!stack) return;
    const family = firstResolvableFamily(stack);
    if (family && !seen.has(family.toLowerCase())) seen.set(family.toLowerCase(), family);
  };
  const walk = (node: SceneNode) => {
    add(node.fontFamily);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  for (const t of Object.values(merged?.typography ?? {})) add(t.fontFamily);
  return [...seen.values()];
}

/** The document-default family per spec C7: `typography.body.fontFamily`
 * (alias `base`). Returned verbatim (it may be a full stack); the renderer
 * appends its system tail. */
export function bodyFontFamilyFromTokens(merged?: DesignVariables): string | undefined {
  const stack = merged?.typography?.body?.fontFamily ?? merged?.typography?.base?.fontFamily;
  if (!stack || /["{}\n\r<>$\\]/.test(stack)) return undefined;
  return stack;
}

// ── css2 extraction ─────────────────────────────────────────────────────────

export interface ExtractedFace {
  family: string;
  url: string;
  weight?: string; // "400" or a variable range "100 900"
  style?: 'normal' | 'italic';
  /** unicode-range, used to keep only latin subsets. */
  unicodeRange?: string;
}

/** Pull @font-face declarations out of a Google Fonts css2 response (or any
 * stylesheet) with regexes — resilient to ordering/whitespace, no CSS parser.
 * Keeps only faces whose unicode-range covers basic latin (or that declare no
 * range at all); css2 emits one block per script subset and UI copy lives in
 * latin. */
export function extractFontFaces(cssText: string): ExtractedFace[] {
  const faces: ExtractedFace[] = [];
  for (const block of cssText.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const family = block.match(/font-family\s*:\s*['"]?([^'";]+?)['"]?\s*;/)?.[1]?.trim();
    const url = block.match(/src\s*:[^;]*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/)?.[1];
    if (!family || !url || !/^https?:\/\//i.test(url)) continue;
    const weight = block.match(/font-weight\s*:\s*([\d]+(?:\s+[\d]+)?)\s*;/)?.[1];
    const style = block.match(/font-style\s*:\s*(normal|italic)\s*;/)?.[1] as 'normal' | 'italic' | undefined;
    const unicodeRange = block.match(/unicode-range\s*:\s*([^;]+);/)?.[1]?.trim();
    if (unicodeRange && !/U\+0(0)?-|U\+0000/i.test(unicodeRange)) continue; // non-latin subset
    faces.push({ family, url, weight, style, unicodeRange });
  }
  return faces;
}

// ── disk cache ──────────────────────────────────────────────────────────────

interface RegistryFace {
  family: string;
  /** Original remote binary URL (what gets persisted into canvas.fonts). */
  url: string;
  /** Cached binary filename under the fonts dir. */
  file: string;
  weight?: string;
  style?: 'normal' | 'italic';
}

interface FontRegistry {
  version: 1;
  families: Record<string, { family: string; faces: RegistryFace[]; fetchedAt: string }>;
}

function registryPath(): string {
  return join(fontsDir(), 'registry.json');
}

function readRegistry(): FontRegistry {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), 'utf-8')) as FontRegistry;
    if (parsed?.version === 1 && parsed.families) return parsed;
  } catch {
    // missing or corrupt → cold cache
  }
  return { version: 1, families: {} };
}

function writeRegistry(registry: FontRegistry): void {
  mkdirSync(fontsDir(), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
}

function extOf(url: string): string {
  return /\.woff2(\?|$)/i.test(url) ? 'woff2'
    : /\.woff(\?|$)/i.test(url) ? 'woff'
    : /\.otf(\?|$)/i.test(url) ? 'otf'
    : 'ttf';
}

function mimeOf(ext: string): string {
  return ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'otf' ? 'font/otf' : 'font/ttf';
}

function faceToDataUri(face: RegistryFace): FontFace | null {
  const path = join(fontsDir(), face.file);
  if (!existsSync(path)) return null;
  const ext = face.file.split('.').pop() ?? 'woff2';
  const data = readFileSync(path).toString('base64');
  return {
    family: face.family,
    url: `data:${mimeOf(ext)};base64,${data}`,
    ...(face.weight !== undefined ? { weight: face.weight } : {}),
    ...(face.style ? { style: face.style } : {}),
  };
}

// ── resolution ──────────────────────────────────────────────────────────────

export class FontResolveError extends Error {
  constructor(public readonly family: string, message: string) {
    super(`Could not resolve font "${family}": ${message}`);
    this.name = 'FontResolveError';
  }
}

export interface ResolveOptions {
  /** Injectable for tests — no network in CI. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ResolvedFamily {
  family: string;
  /** Faces with remote URLs — the persistable form. */
  faces: FontFace[];
  fromCache: boolean;
}

// Google serves woff2 only to clients that advertise support.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Weights presets/structures actually use; families lacking one of them make
// css2 400 the whole request, so fall back to the family's default face.
const PREFERRED_WEIGHTS = '400;500;600;700';

async function fetchText(url: string, opts: ResolveOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.text();
}

async function fetchBinary(url: string, opts: ResolveOptions): Promise<Buffer> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching font binary`);
  return Buffer.from(await res.arrayBuffer());
}

/** Download + cache the binaries for extracted faces; returns registry faces.
 * Shared by name resolution and css2-stylesheet-URL registration. */
async function cacheFaces(family: string, extracted: ExtractedFace[], opts: ResolveOptions): Promise<RegistryFace[]> {
  const cached: RegistryFace[] = [];
  for (const face of extracted) {
    const buf = await fetchBinary(face.url, opts);
    const ext = extOf(face.url);
    const file = `${createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    mkdirSync(fontsDir(), { recursive: true });
    const path = join(fontsDir(), file);
    if (!existsSync(path)) writeFileSync(path, buf);
    cached.push({
      family: face.family,
      url: face.url,
      file,
      ...(face.weight !== undefined ? { weight: face.weight } : {}),
      ...(face.style ? { style: face.style } : {}),
    });
  }
  const registry = readRegistry();
  registry.families[family.toLowerCase()] = { family, faces: cached, fetchedAt: new Date().toISOString() };
  writeRegistry(registry);
  return cached;
}

function registryFacesToFontFaces(faces: RegistryFace[]): FontFace[] {
  return faces.map((f) => ({
    family: f.family,
    url: f.url,
    ...(f.weight !== undefined ? { weight: f.weight } : {}),
    ...(f.style ? { style: f.style } : {}),
  }));
}

/** Resolve a family by name via Google Fonts, cache-first. Throws
 * FontResolveError when the family is unknown/unreachable — callers convert
 * that to a warning. */
export async function resolveFamily(family: string, opts: ResolveOptions = {}): Promise<ResolvedFamily> {
  if (!isResolvableName(family)) throw new FontResolveError(family, 'invalid family name');
  if (SYSTEM_FAMILIES.has(family.toLowerCase())) throw new FontResolveError(family, 'system family — nothing to load');

  const cached = readRegistry().families[family.toLowerCase()];
  if (cached?.faces.length && cached.faces.every((f) => existsSync(join(fontsDir(), f.file)))) {
    return { family: cached.family, faces: registryFacesToFontFaces(cached.faces), fromCache: true };
  }

  const encoded = encodeURIComponent(family).replace(/%20/g, '+');
  let css: string;
  try {
    css = await fetchText(`https://fonts.googleapis.com/css2?family=${encoded}:wght@${PREFERRED_WEIGHTS}&display=swap`, opts);
  } catch {
    // Families without the preferred weights 400-return the whole request —
    // retry for whatever the family's default face is before giving up.
    try {
      css = await fetchText(`https://fonts.googleapis.com/css2?family=${encoded}&display=swap`, opts);
    } catch (err) {
      throw new FontResolveError(family, err instanceof Error ? err.message : String(err));
    }
  }

  const extracted = extractFontFaces(css);
  if (!extracted.length) throw new FontResolveError(family, 'no usable @font-face declarations in the stylesheet');

  try {
    const faces = await cacheFaces(family, extracted, opts);
    return { family, faces: registryFacesToFontFaces(faces), fromCache: false };
  } catch (err) {
    throw new FontResolveError(family, err instanceof Error ? err.message : String(err));
  }
}

/** Register the faces a stylesheet URL (e.g. fonts.googleapis.com/css2?...)
 * declares: fetch, extract, cache the binaries, return persistable FontFaces
 * (remote URLs). Used by set_fonts so agents can paste the css2 URL they
 * actually have instead of hunting gstatic binary URLs. Throws on failure —
 * an explicit registration that did nothing should error, unlike the backstop.
 *
 * Phase 22 slice D (#134): `label` (the caller's `family` field) wins — the
 * extracted faces register under it, so `{ family: "mono", url: <css2 URL> }`
 * makes `fontFamily: "mono"` hit those faces. `stylesheetFamilies` reports the
 * stylesheet's own font-family names so the alias is visible. */
export async function resolveStylesheetUrl(url: string, opts: ResolveOptions = {}, label?: string): Promise<{ faces: FontFace[]; stylesheetFamilies: string[] }> {
  const css = await fetchText(url, opts);
  const extracted = extractFontFaces(css);
  if (!extracted.length) throw new Error(`No usable @font-face declarations found at ${url}`);
  const stylesheetFamilies = [...new Set(extracted.map((f) => f.family))];
  if (label) {
    const relabeled = extracted.map((f) => ({ ...f, family: label }));
    return { faces: registryFacesToFontFaces(await cacheFaces(label, relabeled, opts)), stylesheetFamilies };
  }
  const byFamily = new Map<string, ExtractedFace[]>();
  for (const face of extracted) {
    const key = face.family.toLowerCase();
    byFamily.set(key, [...(byFamily.get(key) ?? []), face]);
  }
  const out: FontFace[] = [];
  for (const faces of byFamily.values()) {
    out.push(...registryFacesToFontFaces(await cacheFaces(faces[0].family, faces, opts)));
  }
  return { faces: out, stylesheetFamilies };
}

/** Cache-only check: is a family already resolvable without the network —
 * present in the local registry? Used by the batch_design authoring-time
 * warning (no network on the hot path). */
export function hasCachedFamily(family: string): boolean {
  return (readRegistry().families[family.toLowerCase()]?.faces.length ?? 0) > 0;
}

/** Phase 22 slice D (#134) — authoring-time font check for batch_design:
 * scan an operations string for fontFamily literals and return the families
 * that are neither declared on the canvas, cached locally, nor system/generic
 * — i.e. the ones that will hit the network (or silently fall back) at render.
 * Cache-only, no network. $token refs are skipped (they warm at token-write). */
export function unverifiedFamiliesInOps(operations: string, declaredFamilies: string[]): string[] {
  const declared = new Set(declaredFamilies.map((f) => f.toLowerCase()));
  const out = new Map<string, string>();
  for (const m of operations.matchAll(/fontFamily\s*:\s*(["'])((?:(?!\1).)*)\1/g)) {
    const stack = m[2];
    if (stack.startsWith('$')) continue;
    const family = firstResolvableFamily(stack);
    if (!family) continue; // system/generic — always renders
    if (declared.has(family.toLowerCase())) continue;
    if (hasCachedFamily(family)) continue;
    out.set(family.toLowerCase(), family);
  }
  return [...out.values()];
}

/** True when a URL is a stylesheet to extract from, not a font binary. */
export function isStylesheetUrl(url: string): boolean {
  return /fonts\.googleapis\.com\/css/i.test(url) || /\.css(\?|$)/i.test(url);
}

/** Write-time warm-up: resolve every family a DesignVariables write declares.
 * Never throws — returns what resolved and what failed so tool handlers can
 * report without failing the write. */
export async function warmFamilies(vars: Partial<DesignVariables> | undefined, opts: ResolveOptions = {}): Promise<{ resolved: string[]; failed: { family: string; error: string }[] }> {
  const resolved: string[] = [];
  const failed: { family: string; error: string }[] = [];
  const families = new Map<string, string>();
  for (const t of Object.values(vars?.typography ?? {})) {
    const family = t.fontFamily ? firstResolvableFamily(t.fontFamily) : null;
    if (family) families.set(family.toLowerCase(), family);
  }
  for (const family of families.values()) {
    try {
      await resolveFamily(family, opts);
      resolved.push(family);
    } catch (err) {
      failed.push({ family, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { resolved, failed };
}

/** Render-time backstop (spec FR-A3): every family the resolved tree + merged
 * tokens reference and `canvas.fonts` doesn't already declare gets served from
 * the cache as a data: URI face (resolving over the network at most once).
 * Failures become warnings; the render itself never fails or blocks on this. */
export async function ensureFontsForRender(
  resolvedRoot: SceneNode,
  canvas: Canvas,
  merged?: DesignVariables,
  opts: ResolveOptions = {},
): Promise<{ extraFonts: FontFace[]; warnings: string[] }> {
  const extraFonts: FontFace[] = [];
  const warnings: string[] = [];

  const declared = new Set((canvas.fonts ?? []).map((f) => f.family.toLowerCase()));
  for (const family of collectReferencedFamilies(resolvedRoot, merged)) {
    if (declared.has(family.toLowerCase())) continue;
    try {
      await resolveFamily(family, opts); // cache hit or one network resolve
      const entry = readRegistry().families[family.toLowerCase()];
      const dataFaces = (entry?.faces ?? []).map(faceToDataUri).filter((f): f is FontFace => f !== null);
      if (dataFaces.length) extraFonts.push(...dataFaces);
      else warnings.push(`Font "${family}": resolved but cache files are missing; rendering with the fallback stack.`);
    } catch (err) {
      warnings.push(
        `Font "${family}" could not be loaded (${err instanceof Error ? err.message : String(err)}); rendering with the fallback stack. ` +
        `Register it explicitly with set_fonts (families: ["${family}"] or a direct binary URL).`,
      );
    }
  }

  return { extraFonts, warnings };
}
