import './test-env.js';
// Phase 22 slice D (#134) — font ergonomics:
//   1. "mono"/"sans" render as CSS generics (node + body default), never
//      resolve over the network, never warn.
//   2. unverifiedFamiliesInOps — the batch_design authoring-time check.
// (The set_fonts label-honoring path is covered in test-fonts-by-name.ts §8.)
//
// Usage: npx tsx test-font-aliases.ts

import { aliasFamilyStack, firstResolvableFamily, collectReferencedFamilies, ensureFontsForRender, unverifiedFamiliesInOps, hasCachedFamily } from './src/fonts.js';
import { renderToHtml } from './src/renderer.js';
import type { Canvas, SceneNode } from './src/types.js';

function fakeCanvas(root: SceneNode): Canvas {
  return {
    id: 'alias-test', name: 'font-aliases', root, variables: {}, components: {},
    createdAt: '1970-01-01T00:00:00Z', lastModified: '1970-01-01T00:00:00Z', projectId: 'default-project',
  };
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── 1. alias mapping ─────────────────────────────────────────────────────────
{
  check('mono → monospace', aliasFamilyStack('mono') === 'monospace');
  check('sans → sans-serif', aliasFamilyStack('sans') === 'sans-serif');
  check('case-insensitive', aliasFamilyStack('Mono') === 'monospace');
  check('stack members alias individually', aliasFamilyStack('JetBrains Mono, mono') === 'JetBrains Mono, monospace');
  check('real families pass through verbatim', aliasFamilyStack('Inter') === 'Inter');
  check('real generics pass through verbatim', aliasFamilyStack('monospace') === 'monospace');
}

// ── 2. renderer emission ─────────────────────────────────────────────────────
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#FFF',
    children: [
      { id: 'm', type: 'text', content: '$1.52M', fontFamily: 'mono', fontSize: 14 },
      { id: 's', type: 'text', content: 'label', fontFamily: 'sans', fontSize: 14 },
    ],
  };
  const html = renderToHtml(root, 800, 600);
  check('node "mono" renders as monospace', html.includes('font-family: monospace'), html.match(/font-family[^;]*/g)?.join(' | '));
  check('node "sans" renders as sans-serif', html.includes('font-family: sans-serif'));
  check('literal "mono" never reaches the page', !/font-family: mono[;"]/.test(html));

  const body = renderToHtml(root, 800, 600, undefined, { bodyFontFamily: 'mono' });
  check('body default "mono" renders as monospace', body.includes('body') && /body \{[^}]*font-family: monospace,/.test(body));
}

// ── 2b. an explicit set_fonts label under a reserved generic wins ───────────
// (set_fonts's "label wins" story only holds if the renderer actually emits
// the literal label instead of aliasing it away — regression for the bug
// where a "mono"-labeled registration was dead: the @font-face declared under
// "mono" had nothing referencing it because every fontFamily: "mono" node got
// aliased to the CSS generic before reaching the page.)
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#FFF',
    children: [{ id: 'm', type: 'text', content: 'code', fontFamily: 'mono', fontSize: 14 }],
  };
  const canvas = fakeCanvas(root);
  canvas.fonts = [{ family: 'mono', url: 'data:font/woff2;base64,AAAA', weight: '400' }];
  const html = renderToHtml(root, 800, 600, canvas, {});
  check('registered "mono" label reaches the node style verbatim', /font-family: mono[;"]/.test(html), html.match(/font-family[^;]*/g)?.join(' | '));
  check('@font-face for the registered label is present', /@font-face\s*\{[^}]*font-family:\s*"mono"/.test(html));

  const bodyHtml = renderToHtml(root, 800, 600, canvas, { bodyFontFamily: 'mono' });
  check('registered "mono" also wins as the body default', /body \{[^}]*font-family: mono,/.test(bodyHtml));

  // Unregistered "sans" on the SAME canvas still aliases normally — the
  // override is per-label, not a blanket "canvas has custom fonts" bypass.
  const mixedRoot: SceneNode = {
    id: 'doc', type: 'document', fill: '#FFF',
    children: [{ id: 's', type: 'text', content: 'label', fontFamily: 'sans', fontSize: 14 }],
  };
  const mixedHtml = renderToHtml(mixedRoot, 800, 600, canvas, {});
  check('unregistered "sans" still aliases to sans-serif on the same canvas', mixedHtml.includes('font-family: sans-serif'));
}

// ── 3. generics never resolve, never warn ────────────────────────────────────
{
  check('firstResolvableFamily skips "mono"', firstResolvableFamily('mono') === null);
  check('firstResolvableFamily skips "sans"', firstResolvableFamily('sans') === null);
  check('"JetBrains Mono, mono" still resolves the real face', firstResolvableFamily('JetBrains Mono, mono') === 'JetBrains Mono');

  const root: SceneNode = { id: 'doc', type: 'document', children: [{ id: 't', type: 'text', content: 'x', fontFamily: 'mono' }] };
  check('collectReferencedFamilies ignores generics', collectReferencedFamilies(root).length === 0);

  // The full render backstop with a fetch that fails everything: a generic
  // must produce zero warnings (it never even tries the network).
  const failFetch = async () => { throw new Error('offline'); };
  const { warnings } = await ensureFontsForRender(root, fakeCanvas(root), undefined, { fetchImpl: failFetch as never });
  check('render backstop is silent for generics even offline', warnings.length === 0, warnings.join(' | '));
}

// ── 4. authoring-time check (cache-only) ─────────────────────────────────────
{
  // FRAMESMITH_HOME is a fresh tmp dir (test-env), so the registry is empty.
  check('registry starts empty in the test env', !hasCachedFamily('Inter'));

  const ops = [
    'U("a", { fontFamily: "JetBrans Mono", fontSize: 13 })', // typo — should flag
    'U("b", { fontFamily: "mono" })',                         // generic — silent
    'U("c", { fontFamily: "system-ui, sans-serif" })',        // system stack — silent
    'U("d", { fontFamily: "$code" })',                        // token ref — silent (warms at token write)
    'U("e", { fontFamily: "Declared Face" })',                // declared on canvas — silent
    'U("f", { fontFamily: \'JetBrans Mono\' })',              // dup (single-quoted) — deduped
  ].join('\n');
  const unverified = unverifiedFamiliesInOps(ops, ['Declared Face']);
  check('typo family flags exactly once', unverified.length === 1 && unverified[0] === 'JetBrans Mono', unverified.join(', '));

  check('ops without fontFamily are silent', unverifiedFamiliesInOps('U("a", { fill: "#FFF" })', []).length === 0);
  check('stack leading with a real family flags it', unverifiedFamiliesInOps('U("a", { fontFamily: "Ghost Face, monospace" })', [])[0] === 'Ghost Face');
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
