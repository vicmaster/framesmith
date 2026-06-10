import './test-env.js';
// Phase 16 Slice A — fonts by name. All network stubbed (injectable fetchImpl);
// the cache lands in the FRAMESMITH_HOME tmp dir test-env provides.
//
// Covers: stack parsing + system-family skip list, css2 @font-face extraction
// (latin filter, variable weight ranges), resolveFamily (cache miss → hit, the
// plain-URL weight fallback, failure), collectReferencedFamilies,
// bodyFontFamilyFromTokens, warmFamilies, ensureFontsForRender (data-URI
// injection, declared-family skip, warning path), and the renderToHtml opts
// (extraFonts + bodyFontFamily).
//
// Usage: npx tsx test-fonts-by-name.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SYSTEM_FAMILIES,
  firstResolvableFamily,
  collectReferencedFamilies,
  bodyFontFamilyFromTokens,
  extractFontFaces,
  resolveFamily,
  resolveStylesheetUrl,
  isStylesheetUrl,
  warmFamilies,
  ensureFontsForRender,
  FontResolveError,
} from './src/fonts.js';
import { renderToHtml } from './src/renderer.js';
import type { Canvas, DesignVariables, SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

// ── stub fetch ───────────────────────────────────────────────────────────────

const CSS2_FIXTURE = `
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v18/cyrillic.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v18/latin-400.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v18/latin-700i.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

const VARIABLE_FIXTURE = `
/* latin */
@font-face {
  font-family: 'Recursive';
  font-style: normal;
  font-weight: 300 1000;
  src: url(https://fonts.gstatic.com/s/recursive/v38/latin-var.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

const FAKE_WOFF2 = Buffer.from('not-a-real-font-but-bytes-are-bytes');

function makeResponse(body: string | Buffer, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => body.toString(),
    arrayBuffer: async () => {
      const buf = typeof body === 'string' ? Buffer.from(body) : body;
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  } as unknown as Response;
}

/** Stub serving css2 for known families + fake binaries for gstatic URLs. */
function makeStubFetch(opts: { failWeighted?: boolean; failAll?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (opts.failAll) return makeResponse('', false, 503);
    if (url.includes('fonts.googleapis.com')) {
      if (opts.failWeighted && url.includes(':wght@')) return makeResponse('', false, 400);
      if (url.includes('Inter')) return makeResponse(CSS2_FIXTURE);
      if (url.includes('Recursive')) return makeResponse(VARIABLE_FIXTURE);
      return makeResponse('', false, 400); // unknown family
    }
    if (url.includes('fonts.gstatic.com')) return makeResponse(FAKE_WOFF2);
    return makeResponse('', false, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const fontsDir = join(process.env.FRAMESMITH_HOME!, 'fonts');

// ── 1. stack parsing + skip list ─────────────────────────────────────────────
{
  expect('Inter from a stack', firstResolvableFamily('Inter, system-ui, sans-serif') === 'Inter');
  expect('quoted multi-word family', firstResolvableFamily('"JetBrains Mono", monospace') === 'JetBrains Mono');
  expect('pure system stack → null', firstResolvableFamily('system-ui, -apple-system, sans-serif') === null);
  expect('Roboto is on the skip list', SYSTEM_FAMILIES.has('roboto') && firstResolvableFamily('Roboto, sans-serif') === null);
  expect('unresolved $token → null', firstResolvableFamily('$fontBody') === null);
  expect('skips leading system, finds custom', firstResolvableFamily('system-ui, Inter') === 'Inter');
}

// ── 2. css2 extraction ───────────────────────────────────────────────────────
{
  const faces = extractFontFaces(CSS2_FIXTURE);
  expect('latin filter drops the cyrillic block', faces.length === 2, `got ${faces.length}`);
  expect('extracts family + url', faces[0]?.family === 'Inter' && faces[0]?.url.includes('latin-400.woff2'));
  expect('extracts weight + style', faces[1]?.weight === '700' && faces[1]?.style === 'italic');
  const variable = extractFontFaces(VARIABLE_FIXTURE);
  expect('variable weight range survives', variable[0]?.weight === '300 1000', `got "${variable[0]?.weight}"`);
  expect('no faces in arbitrary css', extractFontFaces('.a { color: red }').length === 0);
}

// ── 3. resolveFamily: miss → network → cache → hit ───────────────────────────
{
  const { fetchImpl, calls } = makeStubFetch();
  const first = await resolveFamily('Inter', { fetchImpl });
  expect('resolves 2 latin faces', first.faces.length === 2, `got ${first.faces.length}`);
  expect('first resolve is not from cache', !first.fromCache);
  expect('faces carry remote gstatic urls', first.faces.every((f) => f.url.startsWith('https://fonts.gstatic.com/')));
  expect('registry written', existsSync(join(fontsDir, 'registry.json')));
  expect('binaries cached on disk', readFileSync(join(fontsDir, 'registry.json'), 'utf-8').includes('"file"'));

  const callsBefore = calls.length;
  const second = await resolveFamily('Inter', { fetchImpl });
  expect('second resolve is a cache hit', second.fromCache);
  expect('cache hit makes no network calls', calls.length === callsBefore);
}

// ── 4. weighted-request fallback + failure modes ─────────────────────────────
{
  const { fetchImpl, calls } = makeStubFetch({ failWeighted: true });
  const resolved = await resolveFamily('Recursive', { fetchImpl });
  expect('falls back to the plain css2 url', resolved.faces.length === 1 && calls.some((u) => u.includes('Recursive') && !u.includes(':wght@')));

  const { fetchImpl: failFetch } = makeStubFetch({ failAll: true });
  let threw: unknown;
  try { await resolveFamily('Nonexistent Family', { fetchImpl: failFetch }); } catch (err) { threw = err; }
  expect('unresolvable family throws FontResolveError', threw instanceof FontResolveError);

  let sysThrew: unknown;
  try { await resolveFamily('system-ui', { fetchImpl }); } catch (err) { sysThrew = err; }
  expect('system family refuses to resolve', sysThrew instanceof FontResolveError);
}

// ── 5. collect + body-font helpers ───────────────────────────────────────────
{
  const root: SceneNode = {
    id: 'doc', type: 'document', children: [
      { id: 'a', type: 'text', content: 'x', fontFamily: 'Inter, system-ui' },
      { id: 'b', type: 'text', content: 'y', fontFamily: '"JetBrains Mono", monospace' },
      { id: 'c', type: 'text', content: 'z', fontFamily: 'Inter' }, // dupe
      { id: 'd', type: 'text', content: 'w', fontFamily: 'system-ui' },
    ],
  };
  const merged: DesignVariables = { typography: { body: { fontSize: 16, fontFamily: 'Inter' }, code: { fontSize: 13, fontFamily: 'Space Mono' } } };
  const families = collectReferencedFamilies(root, merged);
  expect('collects node + token families, deduped', JSON.stringify(families) === JSON.stringify(['Inter', 'JetBrains Mono', 'Space Mono']), JSON.stringify(families));
  expect('body token surfaces as document default', bodyFontFamilyFromTokens(merged) === 'Inter');
  expect('base alias works', bodyFontFamilyFromTokens({ typography: { base: { fontSize: 16, fontFamily: 'Lora' } } }) === 'Lora');
  expect('no body token → undefined', bodyFontFamilyFromTokens({ typography: { heading: { fontSize: 32, fontFamily: 'Lora' } } }) === undefined);
}

// ── 6. warmFamilies ──────────────────────────────────────────────────────────
{
  const { fetchImpl } = makeStubFetch();
  const report = await warmFamilies({ typography: { body: { fontSize: 16, fontFamily: 'Inter' }, code: { fontSize: 13, fontFamily: 'No Such Face' } } }, { fetchImpl });
  expect('warm resolves the known family', report.resolved.includes('Inter'));
  expect('warm reports the unknown family', report.failed.length === 1 && report.failed[0].family === 'No Such Face');
}

// ── 7. ensureFontsForRender ──────────────────────────────────────────────────
{
  const canvas = {
    id: 'c1', name: 'Test', projectId: 'p', root: { id: 'doc', type: 'document' } as SceneNode,
    components: {}, fonts: [],
  } as unknown as Canvas;
  const resolvedRoot: SceneNode = { id: 'doc', type: 'document', children: [{ id: 't', type: 'text', content: 'x', fontFamily: 'Inter' }] };
  const { fetchImpl } = makeStubFetch();

  const result = await ensureFontsForRender(resolvedRoot, canvas, undefined, { fetchImpl });
  expect('backstop injects data-URI faces', result.extraFonts.length === 2 && result.extraFonts.every((f) => f.url.startsWith('data:font/woff2;base64,')));
  expect('no warnings on success', result.warnings.length === 0, result.warnings.join(' | '));

  // declared family → skipped entirely
  const declared = { ...canvas, fonts: [{ family: 'Inter', url: 'https://example.com/inter.woff2' }] } as Canvas;
  const skipped = await ensureFontsForRender(resolvedRoot, declared, undefined, { fetchImpl });
  expect('declared family skips the backstop', skipped.extraFonts.length === 0 && skipped.warnings.length === 0);

  // unresolvable family → warning naming set_fonts, render not failed
  const badRoot: SceneNode = { id: 'doc', type: 'document', children: [{ id: 't', type: 'text', content: 'x', fontFamily: 'Ghost Face' }] };
  const { fetchImpl: failFetch } = makeStubFetch({ failAll: true });
  const warned = await ensureFontsForRender(badRoot, canvas, undefined, { fetchImpl: failFetch });
  expect('failure degrades to a warning', warned.extraFonts.length === 0 && warned.warnings.length === 1 && warned.warnings[0].includes('set_fonts'), warned.warnings.join(' | '));
}

// ── 8. stylesheet-URL registration ───────────────────────────────────────────
{
  expect('css2 url detected as stylesheet', isStylesheetUrl('https://fonts.googleapis.com/css2?family=Inter'));
  expect('binary url is not a stylesheet', !isStylesheetUrl('https://fonts.gstatic.com/s/inter/v18/latin.woff2'));
  const { fetchImpl } = makeStubFetch();
  const faces = await resolveStylesheetUrl('https://fonts.googleapis.com/css2?family=Inter:wght@400;700', { fetchImpl });
  expect('stylesheet url yields persistable faces', faces.length === 2 && faces.every((f) => f.url.startsWith('https://fonts.gstatic.com/')));
}

// ── 9. renderToHtml integration (no Chrome needed) ───────────────────────────
{
  const root: SceneNode = { id: 'doc', type: 'document', fill: '#FFF', children: [{ id: 't', type: 'text', content: 'Hi', fontSize: 16 }] };
  const html = renderToHtml(root, 1440, 900, undefined, {
    extraFonts: [{ family: 'Inter', url: 'data:font/woff2;base64,QUJD', weight: '400' }],
    bodyFontFamily: 'Inter',
  });
  expect('extraFonts emit @font-face', html.includes('@font-face') && html.includes('font-family: "Inter"'));
  expect('body default font prepends the family', html.includes('font-family: Inter, system-ui,'));

  const quoted = renderToHtml(root, 1440, 900, undefined, { bodyFontFamily: 'JetBrains Mono' });
  expect('multi-word body family gets quoted', quoted.includes('font-family: "JetBrains Mono", system-ui,'));

  const unsafe = renderToHtml(root, 1440, 900, undefined, { bodyFontFamily: 'Evil"; } body { display: none' });
  expect('unsafe body family falls back to system stack', unsafe.includes('font-family: system-ui,') && !unsafe.includes('Evil'));

  const plain = renderToHtml(root, 1440, 900);
  expect('no opts → unchanged system stack', plain.includes('font-family: system-ui, -apple-system,'));
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
