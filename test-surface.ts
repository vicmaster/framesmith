// Phase 30 slice B — the canvas type axis and the ruleset table. In-process:
// creation defaults, canvas_set_type's storage rules, variants, ruleset
// composition (union + conflict), the surface report, the root's safeArea
// padding (HTML-string assertions, no Chrome), render invariance under
// metadata.surface, and the viewer's score cache key. Then the real tool
// handlers over MCP stdio: canvas_create / canvas_set_type / canvas_evaluate /
// canvas_autofix / generate_design_system results and errors.
//
// Usage: npx tsx test-surface.ts

import './test-env.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCanvas, setCanvasType, setCanvasGenre, addVariant, getCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { canvasVersionHash } from './src/version.js';
import { evaluateCanvas } from './src/evaluate.js';
import { renderToHtml } from './src/renderer.js';
import { evalCacheKey } from './src/viewer.js';
import {
  activeRulesets, composeRulesets, resolveSurface, surfaceFor, knownGenres, relaxedByGenre,
  RULESETS, DEVICE_PROFILES, DEFAULT_DEVICE, type Ruleset,
} from './src/surfaces.js';
import type { Canvas } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function addContent(canvas: Canvas) {
  parseAndExecute(canvas.root, `
f=I("document", { type: "frame", layout: "vertical", gap: 16, padding: 24 })
I(f, { type: "text", content: "Morning run", fontSize: 20 })
`, canvas);
}

// The document root's own inline style (the first data-node-id div).
function rootStyle(canvas: Canvas): string {
  const html = renderToHtml(canvas.root, 390, 844, canvas);
  return html.match(new RegExp(`<div[^>]*data-node-id="${canvas.root.id}"[^>]*>`))?.[0] ?? html.match(/style="([^"]*)"[^>]*data-node-id="[^"]*"/)?.[0] ?? '';
}

// ── creation defaults ─────────────────────────────────────────────────────
{
  console.log('── creation ──');
  const p = DEVICE_PROFILES[DEFAULT_DEVICE];
  const mobile = createCanvas('Phone', undefined, {}, { type: 'mobile', device: DEFAULT_DEVICE });
  check('mobile canvas reads back 390×844', mobile.root.width === 390 && mobile.root.height === 844);
  check('mobile root.safeArea is the profile insets', mobile.root.safeArea?.top === 47 && mobile.root.safeArea?.bottom === 34);
  check('metadata.surface stored', mobile.metadata?.surface?.type === 'mobile' && mobile.metadata?.surface?.device === 'iphone-390');
  check('resolveSurface: declared mobile', JSON.stringify(resolveSurface(mobile)) === JSON.stringify({ type: 'mobile', device: 'iphone-390', source: 'declared' }));
  check('profile constants match the spec table', p.width === 390 && p.height === 844 && p.touchTarget === 44 && p.bodySize === 17 && p.bodyFloor === 16 && p.smallestText === 11);

  const sized = createCanvas('Phone wide', undefined, { width: 393 }, { type: 'mobile' });
  check('explicit width wins, height from the profile', sized.root.width === 393 && sized.root.height === 844);
  check('explicit size still gets the insets', sized.root.safeArea?.top === 47);

  const web = createCanvas('Web', undefined, {}, { type: 'web' });
  check('declared web: 1440×900, no safeArea', web.root.width === 1440 && web.root.height === 900 && web.root.safeArea === undefined);
  check('declared web source', resolveSurface(web).source === 'declared' && resolveSurface(web).device === null);

  const plain = createCanvas('Plain');
  check('no type: no metadata.surface', plain.metadata?.surface === undefined);
  check('no type: web / default', JSON.stringify(resolveSurface(plain)) === JSON.stringify({ type: 'web', device: null, source: 'default' }));

  const odd = createCanvas('Odd');
  odd.metadata = { surface: { type: 'tablet' as 'web' } };
  check('an unreadable stored type reads as web / default', resolveSurface(odd).source === 'default');

  check('surfaceFor rejects device on web', 'error' in surfaceFor('web', 'iphone-390'));
  check('surfaceFor rejects an unknown device', 'error' in surfaceFor('mobile', 'pixel-9'));
  check('surfaceFor rejects a prototype key as a device', 'error' in surfaceFor('mobile', 'constructor'));
  check('surfaceFor defaults the device', JSON.stringify(surfaceFor('mobile')) === JSON.stringify({ surface: { type: 'mobile', device: 'iphone-390' } }));
}

// ── canvas_set_type storage ───────────────────────────────────────────────
{
  console.log('\n── set type ──');
  const c = createCanvas('Desk', undefined, { width: 1440, height: 900 });
  addContent(c);
  const rootBefore = JSON.stringify(c.root);
  const hash = canvasVersionHash(c);
  const r1 = setCanvasType(c.id, { type: 'mobile', device: 'iphone-390' });
  check('set-type returns previous null', r1?.previous === null);
  check('type stored', resolveSurface(c).type === 'mobile');
  check('root untouched (no resize, no safeArea)', JSON.stringify(c.root) === rootBefore);
  check('versionHash unchanged', canvasVersionHash(c) === hash);
  const r2 = setCanvasType(c.id, { type: 'web' });
  check('previous echoes the prior declaration', r2?.previous?.type === 'mobile' && r2?.previous?.device === 'iphone-390');
  const r3 = setCanvasType(c.id, null);
  check('clear: previous web, surface removed', r3?.previous?.type === 'web' && c.metadata?.surface === undefined);
  check('clear: reads as default', resolveSurface(c).source === 'default');
  const lm = c.lastModified;
  setCanvasType(c.id, null);
  check('clearing a clear canvas does not dirty it', c.lastModified === lm);
  check('unknown canvas → undefined', setCanvasType('nope', { type: 'web' }) === undefined);

  setCanvasGenre(c.id, 'commerce');
  setCanvasType(c.id, { type: 'mobile', device: 'iphone-390' });
  check('set-type leaves the genre alone', c.metadata?.provenance?.genre === 'commerce');
}

// ── variants ──────────────────────────────────────────────────────────────
{
  console.log('\n── variants ──');
  const base = createCanvas('Feed', undefined, {}, { type: 'mobile', device: 'iphone-390' });
  addContent(base);
  const { canvas: v } = addVariant(base.id, 'empty');
  check('variant copies metadata.surface', v.metadata?.surface?.type === 'mobile' && v.metadata?.surface?.device === 'iphone-390');
  check('variant root keeps safeArea', v.root.safeArea?.top === 47 && v.root.safeArea?.bottom === 34);
  const ev = await evaluateCanvas(v, { mode: 'fast' });
  check('variant evaluates as mobile', ev.surface.type === 'mobile' && ev.surface.source === 'declared');
  v.metadata!.surface!.device = 'changed';
  check('variant surface is a copy, not shared', base.metadata?.surface?.device === 'iphone-390');
}

// ── ruleset composition ───────────────────────────────────────────────────
{
  console.log('\n── rulesets ──');
  const sets = activeRulesets({ type: 'mobile', genre: 'commerce', preset: 'material' });
  check('base + type + genre + preset rows', sets.length === 4, String(sets.length));
  const composed = composeRulesets(sets);
  check('relax is the union of all three axes', ['honest-content', 'accent-hue', 'pure-black-white'].every((t) => composed.relaxed.includes(t as never)), composed.relaxed.join(','));
  check('alias folds before lookup', activeRulesets({ type: 'web', genre: 'checkout' }).some((r) => r === RULESETS.genre.commerce));
  check('unknown genre and preset add no row', activeRulesets({ type: 'web', genre: 'constructor', preset: 'toString' }).length === 2);

  const synthetic: Ruleset[] = [
    { enable: ['mobile-touch-target', 'x-only-on'] },
    { disable: ['mobile-touch-target', 'x-only-off'], relax: ['accent-hue'] },
    { enable: ['x-only-on'], relax: ['accent-hue'] },
  ];
  const c = composeRulesets(synthetic);
  check('enable+disable conflict resolves to ON', c.on.includes('mobile-touch-target') && !c.off.includes('mobile-touch-target'));
  check('conflict is reported', JSON.stringify(c.conflicts) === JSON.stringify(['mobile-touch-target']));
  check('plain disable stays off', JSON.stringify(c.off) === JSON.stringify(['x-only-off']));
  check('ids de-duplicated + sorted', JSON.stringify(c.on) === JSON.stringify(['mobile-touch-target', 'x-only-on']));
  check('relax de-duplicated', c.relaxed.length === 1);

  check('views: knownGenres keeps canonical-then-alias order', JSON.stringify(knownGenres()) === JSON.stringify(['material', 'data', 'dashboard', 'commerce', 'checkout']), knownGenres().join(','));
  check('views: relaxedByGenre folds aliases', JSON.stringify(relaxedByGenre('dashboard')) === JSON.stringify(['honest-content']));
  check('views: unknown genre relaxes nothing', relaxedByGenre('constructor').length === 0);
}

// ── surface report on evaluate ────────────────────────────────────────────
{
  console.log('\n── surface report ──');
  const m = createCanvas('Report', undefined, {}, { type: 'mobile' });
  addContent(m);
  const ev = await evaluateCanvas(m, { mode: 'fast' });
  check('surface report present with the documented shape', JSON.stringify(Object.keys(ev.surface).sort()) === JSON.stringify(['conflicts', 'device', 'rulesOff', 'rulesOn', 'source', 'type']));
  check('mobile report', ev.surface.type === 'mobile' && ev.surface.device === 'iphone-390' && ev.surface.source === 'declared');
  check('slice B: no rule ids registered yet', ev.surface.rulesOn.length === 0 && ev.surface.rulesOff.length === 0 && ev.surface.conflicts.length === 0);
  const filtered = await evaluateCanvas(m, { mode: 'fast', categories: ['spacing'] });
  check('surface present even without the cliche category', filtered.surface?.type === 'mobile' && filtered.genre === undefined);
  const empty = createCanvas('Empty', undefined, {}, { type: 'mobile' });
  const evEmpty = await evaluateCanvas(empty, { mode: 'fast' });
  check('surface present on the empty-canvas result', evEmpty.surface?.type === 'mobile');
  const plain = createCanvas('Plain report');
  addContent(plain);
  const evPlain = await evaluateCanvas(plain, { mode: 'fast' });
  check('undeclared canvas reports web / default', evPlain.surface.type === 'web' && evPlain.surface.source === 'default' && evPlain.surface.device === null);

  // FR-A2 survives the table: material preset + commerce genre relax together.
  m.metadata = { ...m.metadata, provenance: { preset: 'material', genre: 'commerce' } as never };
  const evMat = await evaluateCanvas(m, { mode: 'fast' });
  check('material preset + commerce genre relax all three', ['accent-hue', 'pure-black-white', 'honest-content'].every((t) => evMat.genre?.relaxed.includes(t as never)), evMat.genre?.relaxed.join(','));
  const evExplicit = await evaluateCanvas(m, { mode: 'fast', genre: 'commerce' });
  check('explicit genre keeps the preset relaxation', evExplicit.genre?.relaxed.includes('accent-hue') === true);
}

// ── safeArea rendering + render invariance ────────────────────────────────
{
  console.log('\n── safeArea render ──');
  const m = createCanvas('Insets', undefined, {}, { type: 'mobile' });
  addContent(m);
  check('no authored padding: 0px + insets', rootStyle(m).includes('padding-top: calc(0px + 47px)') && rootStyle(m).includes('padding-bottom: calc(0px + 34px)'), rootStyle(m));

  m.root.padding = 24;
  check('scalar padding adds to the insets', rootStyle(m).includes('padding-top: calc(24px + 47px)') && rootStyle(m).includes('padding-bottom: calc(24px + 34px)'));
  m.root.padding = [12, 16];
  check('[v, h] padding: v + insets', rootStyle(m).includes('padding-top: calc(12px + 47px)') && rootStyle(m).includes('padding-bottom: calc(12px + 34px)'));
  m.root.padding = [8, 16, 20, 16];
  check('[t, r, b, l] padding: t / b + insets', rootStyle(m).includes('padding-top: calc(8px + 47px)') && rootStyle(m).includes('padding-bottom: calc(20px + 34px)'));
  m.root.padding = [10, 16, 6];
  check('[t, h, b] padding: t / b + insets', rootStyle(m).includes('padding-top: calc(10px + 47px)') && rootStyle(m).includes('padding-bottom: calc(6px + 34px)'));
  m.root.padding = 40;
  check('fluid padding stays fluid, inset stays exact', /padding-top: calc\(clamp\([^)]*\) \+ 47px\)/.test(rootStyle(m)), rootStyle(m));

  m.root.padding = undefined;
  m.root.safeArea = { top: -5, bottom: Number.NaN } as never;
  check('invalid insets are ignored', !rootStyle(m).includes('calc('));
  m.root.safeArea = { top: 47 } as never;
  check('one valid side still applies', rootStyle(m).includes('padding-top: calc(0px + 47px)') && !rootStyle(m).includes('padding-bottom'));

  // A frame's safeArea is not the root's: only the document honours it.
  const frameOnly = createCanvas('Frame insets');
  parseAndExecute(frameOnly.root, `f=I("document", { type: "frame", padding: 8, safeArea: { top: 47, bottom: 34 } })`, frameOnly);
  check('safeArea on a frame is ignored', !renderToHtml(frameOnly.root, 390, 844, frameOnly).includes('+ 47px'));

  const plain = createCanvas('Invariance');
  addContent(plain);
  const before = renderToHtml(plain.root, 390, 844, plain);
  plain.metadata = { ...plain.metadata, surface: { type: 'mobile', device: 'iphone-390' } };
  check('metadata.surface never changes the render', renderToHtml(plain.root, 390, 844, plain) === before);
  check('no safeArea: no calc padding in the shell', !before.includes('+ 47px'));

  const viaOp = createCanvas('Via op');
  addContent(viaOp);
  parseAndExecute(viaOp.root, `U("document", { safeArea: { top: 47, bottom: 34 } })`, viaOp);
  check('U("document", { safeArea }) writes the root', viaOp.root.safeArea?.top === 47 && viaOp.root.safeArea?.bottom === 34);
  const h0 = canvasVersionHash(viaOp);
  viaOp.root.safeArea = { top: 50, bottom: 34 };
  check('safeArea is part of the versionHash (it changes the render)', canvasVersionHash(viaOp) !== h0);
}

// ── viewer score cache key ────────────────────────────────────────────────
{
  console.log('\n── cache key ──');
  const c = createCanvas('Cache');
  addContent(c);
  const k0 = evalCacheKey(c, []);
  setCanvasType(c.id, { type: 'mobile', device: 'iphone-390' });
  const k1 = evalCacheKey(c, []);
  check('set-type changes the score cache key', k1 !== k0);
  setCanvasType(c.id, { type: 'web' });
  check('web vs mobile keys differ', evalCacheKey(c, []) !== k1);
  setCanvasGenre(c.id, 'data');
  check('set-genre still changes it', evalCacheKey(c, []) !== k1);
  check('the canvas in the store is the one keyed', getCanvas(c.id) === c);
}

// ── the real tool handlers over MCP stdio ─────────────────────────────────
{
  console.log('\n── MCP tools ──');
  const home = mkdtempSync(join(tmpdir(), 'framesmith-surface-mcp-'));
  const cwd = mkdtempSync(join(tmpdir(), 'framesmith-surface-mcp-cwd-'));
  const transport = new StdioClientTransport({
    command: resolve('node_modules/.bin/tsx'),
    args: [resolve('src/index.ts')],
    cwd,
    env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test-surface', version: '0' });
  await client.connect(transport);
  async function tool(name: string, args: Record<string, unknown>) {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]?.text ?? '';
    try { return { ...JSON.parse(text), isError: r.isError }; } catch { return { text, isError: r.isError }; }
  }

  try {
    const m = await tool('canvas_create', { name: 'Phone', type: 'mobile' });
    check('canvas_create mobile: size, type, device, safeArea in the result',
      m.width === 390 && m.height === 844 && m.type === 'mobile' && m.typeSource === 'declared' && m.device === 'iphone-390' && m.safeArea?.top === 47 && m.safeArea?.bottom === 34, JSON.stringify(m));
    const w = await tool('canvas_create', { name: 'Page' });
    check('canvas_create default: web / default, no device or safeArea', w.type === 'web' && w.typeSource === 'default' && w.device === undefined && w.safeArea === undefined);
    const bad = await tool('canvas_create', { name: 'Bad', device: 'iphone-390' });
    check('canvas_create: device without type errors', bad.isError === true && /type: "mobile"/.test(bad.text));
    const badDev = await tool('canvas_create', { name: 'Bad', type: 'mobile', device: 'pixel-9' });
    check('canvas_create: unknown device errors with the known list', badDev.isError === true && badDev.text.includes('iphone-390'));
    const webDev = await tool('canvas_create', { name: 'Bad', type: 'web', device: 'iphone-390' });
    check('canvas_create: device with web errors', webDev.isError === true);

    const set = await tool('canvas_set_type', { canvasId: w.canvasId, type: 'mobile' });
    check('canvas_set_type: mobile with the default device', set.type === 'mobile' && set.device === 'iphone-390' && set.source === 'declared' && set.previous === null);
    check('canvas_set_type: artboard untouched', set.artboard?.width === 1440 && set.artboard?.height === 900);
    check('canvas_set_type: hint names the safeArea op and the size', typeof set.hint === 'string' && set.hint.includes('U("document", { safeArea: { top: 47, bottom: 34 } })') && set.hint.includes('390×844'), set.hint);
    check('canvas_set_type: versionHashUnchanged', set.versionHashUnchanged === true);
    const onPhone = await tool('canvas_set_type', { canvasId: m.canvasId, type: 'mobile' });
    check('canvas_set_type on a created phone canvas: no hint', onPhone.hint === undefined && onPhone.previous?.type === 'mobile');
    const cleared = await tool('canvas_set_type', { canvasId: w.canvasId, type: null });
    check('canvas_set_type null clears to default', cleared.type === 'web' && cleared.source === 'default' && cleared.device === null && cleared.previous?.type === 'mobile');
    const nullDev = await tool('canvas_set_type', { canvasId: w.canvasId, type: null, device: 'iphone-390' });
    check('canvas_set_type: device with null errors', nullDev.isError === true);
    const missing = await tool('canvas_set_type', { canvasId: 'nope', type: 'web' });
    check('canvas_set_type: unknown canvas errors', missing.isError === true);

    await tool('batch_design', { canvasId: m.canvasId, operations: `
f=I("document", { type: "frame", layout: "vertical", gap: 16, padding: 16 })
I(f, { type: "text", content: "Today", fontSize: 28 })
` });
    const ev = await tool('canvas_evaluate', { canvasId: m.canvasId });
    check('canvas_evaluate returns the surface report', ev.surface?.type === 'mobile' && Array.isArray(ev.surface?.rulesOn) && Array.isArray(ev.surface?.conflicts));
    const fix = await tool('canvas_autofix', { canvasId: m.canvasId });
    check('canvas_autofix returns the surface report', fix.surface?.type === 'mobile' && fix.surface?.source === 'declared');

    const gen = await tool('generate_design_system', { seed: '#0E7490', personality: 'technical', canvasId: m.canvasId });
    check('generate_design_system on mobile: body 17, source mobile', gen.typographyRoles?.body?.fontSize === 17 && gen.baseSize === 17 && gen.baseSizeSource === 'mobile', JSON.stringify(gen.typographyRoles?.body));
    const dense = await tool('canvas_create', { name: 'Dense', type: 'mobile' });
    const genDense = await tool('generate_design_system', { seed: '#0E7490', personality: 'data-dense', canvasId: dense.canvasId });
    check('data-dense on mobile: body 16', genDense.baseSize === 16 && genDense.typographyRoles?.body?.fontSize === 16);
    const genWeb = await tool('generate_design_system', { seed: '#0E7490', personality: 'data-dense', canvasId: w.canvasId });
    check('data-dense on web keeps its 13 pivot', genWeb.baseSize === 13 && genWeb.baseSizeSource === 'personality');
    const genExplicit = await tool('generate_design_system', { seed: '#0E7490', personality: 'soft', canvasId: m.canvasId, baseSize: 18 });
    check('explicit baseSize wins on mobile', genExplicit.baseSize === 18 && genExplicit.baseSizeSource === 'explicit');
  } finally {
    await client.close();
  }
}

console.log(allPass ? '\nAll surface tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
