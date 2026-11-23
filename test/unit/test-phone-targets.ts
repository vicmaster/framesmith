// Phase 32 slice E (FR-E1 to FR-E3, contracts R1 to R7): on a phone the 44px
// census measures a link, a text-input, a modal's close button and actions and
// a toast's action; `size: "lg"` (text-input) and `controlSize: "md"`
// (modal, toast) clear them. Web and desktop-app keep their 24px census.
//
// Usage: npx tsx test/unit/test-phone-targets.ts

import '../env.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { overlayTargets, desktopTargets, textInputHeight } from '../../src/primitives.js';
import { tokenRefs } from '../../src/variables.js';
import type { Canvas, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

type Surface = { type: 'web' | 'mobile' | 'desktop-app'; device?: string };
const phone: Surface = { type: 'mobile', device: 'iphone-390' };
const app: Surface = { type: 'desktop-app', device: 'window-1440' };
const web: Surface = { type: 'web' };

function canvasWith(children: SceneNode[], surface: Surface): Canvas {
  const width = surface.type === 'mobile' ? 390 : 1440;
  return {
    id: 'c', name: 'c', projectId: 'p', components: {}, createdAt: '', lastModified: '', variables: {},
    root: { id: 'document', type: 'document', name: 'Document', width, height: 844, fill: '#FFFFFF', layout: 'vertical', padding: 24, gap: 8, children },
    metadata: { surface },
  } as Canvas;
}

const touch = async (children: SceneNode[], surface: Surface = phone) =>
  (await evaluateCanvas(canvasWith(children, surface), { mode: 'fast', categories: ['usability'] })).issues.filter((i) => i.rule === 'mobile-touch-target');

const label = (id: string): SceneNode => ({ id, name: id, type: 'text', content: 'Email address' });
const modal = (extra: Partial<SceneNode> = {}): SceneNode => ({
  id: 'm', name: 'm', type: 'modal', title: 'Delete file?',
  actions: [{ label: 'Cancel' }, { label: 'Delete', variant: 'destructive' }],
  children: [{ id: 'mt', name: 'mt', type: 'text', content: 'This cannot be undone.' }], ...extra,
} as SceneNode);
const toast = (extra: Partial<SceneNode> = {}): SceneNode => ({ id: 't', name: 't', type: 'toast', text: 'Saved', action: { label: 'Undo' }, ...extra } as SceneNode);

// ── R1: text-input lg = 44 ─────────────────────────────────────────────────
{
  const h = (extra: Partial<SceneNode>) => textInputHeight({ id: 'i', type: 'text-input', ...extra } as SceneNode);
  check('R1: text-input sm 32 / md 40 / lg 44', h({ size: 'sm' }) === 32 && h({}) === 40 && h({ size: 'md' }) === 40 && h({ size: 'lg' }) === 44);
  check('R1 twin: xs is not a text-input size (40)', h({ size: 'xs' }) === 40);
  check('R1: a multi-line lg input grows past 44 by its rows', h({ size: 'lg', rows: 3 }) === 72 && h({ size: 'lg', rows: 2 }) === 52);
  check('R1: desktopTargets measures lg at 44', desktopTargets({ id: 'i', type: 'text-input', size: 'lg' } as SceneNode)[0].h === 44);
}

// ── R2: link and text-input on a phone ─────────────────────────────────────
{
  const link = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Forgot password?' }]);
  check('R2: a default link is a mobile-touch-target error', link.length === 1 && link[0].severity === 'error' && link[0].nodeId === 'l' && /^link has a \?×24px touch target/.test(link[0].message), link.map((i) => i.message).join(' | '));
  check('R2: the link suggestion names height', /height: 44/.test(link[0]?.suggestion ?? ''), link[0]?.suggestion);
  const tall = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Forgot password?', height: 44 }]);
  check('R2 twin: height: 44 clears the link', tall.length === 0, tall.map((i) => i.message).join(' | '));
  // Round 1 (spec change to R2): a link with a numeric height is never
  // narrower than tall, so height 44 clears width too, whatever its width.
  const glyph = await touch([{ id: 'l', name: 'l', type: 'link', icon: 'settings', ariaLabel: 'Settings', height: 44 }]);
  check('R2: a glyph-only link at height 44 is 44 wide (min-width) and passes', glyph.length === 0, glyph.map((i) => i.message).join(' | '));
  const glyph32 = await touch([{ id: 'l', name: 'l', type: 'link', icon: 'settings', ariaLabel: 'Settings', height: 32 }]);
  check('R2 twin: a glyph-only link at height 32 is 32×32 and errors, suggesting height 44', glyph32.length === 1 && /32×32px/.test(glyph32[0].message) && /height: 44/.test(glyph32[0].suggestion ?? ''), glyph32.map((i) => `${i.message} / ${i.suggestion}`).join(' | '));
  const glyphBare = await touch([{ id: 'l', name: 'l', type: 'link', icon: 'settings', ariaLabel: 'Settings' }]);
  check('R2 twin: a glyph-only link with no height hugs its glyph (14×24) and errors', glyphBare.length === 1 && /14×24px/.test(glyphBare[0].message));
  const narrow = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Go', height: 44, width: 30 }]);
  check('R2: a labelled link with width 30 and height 44 renders 44 wide and passes', narrow.length === 0, narrow.map((i) => i.message).join(' | '));
  const px = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Go', height: 32, width: '30px' }]);
  check('R2: a link\'s px-string width is read (30px at height 32 measures 32×32)', px.length === 1 && /32×32px/.test(px[0].message), px.map((i) => i.message).join(' | '));
  const half = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Go', height: 43.5, width: 43.5 }]);
  check('R2: a fractional size is printed to one decimal, not rounded up to the floor', half.length === 1 && /43\.5×43\.5px/.test(half[0].message), half.map((i) => i.message).join(' | '));
  const frac = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Go', height: 41.7 }]);
  check('twin: a fraction that rounds below the floor prints whole (42, as before)', frac.length === 1 && /\?×42px/.test(frac[0].message), frac.map((i) => i.message).join(' | '));
  const near = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Go', height: 43.96 }]);
  check('a fraction just under the floor never prints as the floor (43.9)', near.length === 1 && /\?×43\.9px/.test(near[0].message), near.map((i) => i.message).join(' | '));

  const md = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', placeholder: 'you@example.com' }]);
  check('R2: a default (40px) text-input errors on a phone, suggesting size "lg"', md.length === 1 && md[0].nodeId === 'i' && /40px touch target/.test(md[0].message) && /size "lg"/.test(md[0].suggestion ?? ''), md.map((i) => `${i.message} / ${i.suggestion}`).join(' | '));
  const sm = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', size: 'sm' }]);
  check('R2: an sm text-input errors', sm.length === 1 && /32px/.test(sm[0].message));
  const lg = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', size: 'lg' }]);
  check('R2 twin: size "lg" clears the text-input', lg.length === 0, lg.map((i) => i.message).join(' | '));
  const rows = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', rows: 2 }]);
  check('R2 twin: a 2-row text-input (52) passes', rows.length === 0);
  const thin = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', size: 'lg', width: 40 }]);
  check('R2: a numeric width below 44 errors with the width suggestion', thin.length === 1 && /Widen it to 44/.test(thin[0].suggestion ?? '') && !/size "lg"/.test(thin[0].suggestion ?? ''));
  const pxIn = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', size: 'lg', width: '40px' }]);
  check('R2: a text-input\'s px-string width is not read (as in the 24px census)', pxIn.length === 0);

  for (const surface of [web, app]) {
    const off = await touch([{ id: 'l', name: 'l', type: 'link', label: 'Go' }, label('lb'), { id: 'i', name: 'i', type: 'text-input' }, modal(), toast()], surface);
    check(`R2 twin: on ${surface.type} none of this raises mobile-touch-target`, off.length === 0);
  }
  const appIssues = (await evaluateCanvas(canvasWith([{ id: 'i', name: 'i', type: 'text-input', size: 'sm', width: 20 }, label('lb')], app), { mode: 'fast', categories: ['usability'] })).issues;
  check('R2 twin: desktop-app keeps the 24px census on a text-input', appIssues.some((i) => i.nodeId === 'i' && /24px floor/.test(i.message)));
}

// ── R3: disabled targets count on a phone ──────────────────────────────────
{
  const off = await touch([
    { id: 'l', name: 'l', type: 'link', label: 'Go', disabled: true },
    label('lb'), { id: 'i', name: 'i', type: 'text-input', state: 'disabled' },
    modal({ actions: [{ label: 'Delete', variant: 'destructive', disabled: true }] }),
  ]);
  check('R3: disabled link, text-input and modal action are still measured', ['l', 'i'].every((id) => off.some((i) => i.nodeId === id)) && off.filter((i) => i.nodeId === 'm').length === 2, off.map((i) => i.nodeId).join(','));
}

// ── R4: the row rule counts a link or text-input ───────────────────────────
{
  const row = (extra: SceneNode[]): SceneNode => ({
    id: 'row', name: 'row', type: 'frame', layout: 'horizontal', height: 56, alignItems: 'center', gap: 8,
    children: [{ id: 'cb', name: 'cb', type: 'checkbox' }, { id: 'rt', name: 'rt', type: 'text', content: 'Remember me' }, ...extra],
  } as SceneNode);
  const alone = await touch([row([])]);
  check('R4 twin: a lone checkbox in a 56px row passes', alone.length === 0, alone.map((i) => i.message).join(' | '));
  const withInput = await touch([row([{ id: 'i', name: 'i', type: 'text-input', size: 'lg', width: 200 }])]);
  check('R4: a checkbox beside a text-input is measured bare', withInput.some((i) => i.nodeId === 'cb') && !withInput.some((i) => i.nodeId === 'i'), withInput.map((i) => i.nodeId).join(','));
  const withLink = await touch([row([{ id: 'l', name: 'l', type: 'link', label: 'Terms', height: 44 }])]);
  check('R4: a checkbox beside a link is measured bare', withLink.some((i) => i.nodeId === 'cb') && !withLink.some((i) => i.nodeId === 'l'));
  const webRow = (await evaluateCanvas(canvasWith([row([{ id: 'l', name: 'l', type: 'link', label: 'Terms' }])], web), { mode: 'fast', categories: ['usability'] })).issues;
  check('R4 twin: on web the row rule is unchanged (no finding on the checkbox)', !webRow.some((i) => i.nodeId === 'cb'), webRow.map((i) => i.message).join(' | '));
}

// ── R5/R7: controlSize on modal and toast ──────────────────────────────────
{
  const hs = (n: SceneNode) => JSON.stringify(overlayTargets(n).map((t) => [t.w ?? null, t.h]));
  check('R7: default modal targets are 32 (close square)', hs(modal()) === '[[32,32],[null,32],[null,32]]', hs(modal()));
  check('R7: controlSize md → 44 (close 44×44)', hs(modal({ controlSize: 'md' })) === '[[44,44],[null,44],[null,44]]');
  check('R7: controlSize xs → 24, lg → 52', hs(modal({ controlSize: 'xs' })) === '[[24,24],[null,24],[null,24]]' && hs(modal({ controlSize: 'lg' })) === '[[52,52],[null,52],[null,52]]');
  check('R7: a toast action defaults to 24, md → 44', overlayTargets(toast())[0].h === 24 && overlayTargets(toast({ controlSize: 'md' }))[0].h === 44);
  for (const bad of ['constructor', 'toString', 'xl', 44, { md: true }] as unknown[]) {
    const m = modal({ controlSize: bad as SceneNode['controlSize'] });
    const t = toast({ controlSize: bad as SceneNode['controlSize'] });
    check(`R5: controlSize ${JSON.stringify(bad)} falls back to the defaults`, hs(m) === hs(modal()) && overlayTargets(t)[0].h === 24, `${hs(m)} ${overlayTargets(t)[0]?.h}`);
  }

  const both = await touch([modal(), toast()]);
  check('FR-E3: a default modal (two actions) and a toast with an action are four errors', both.length === 4 && both.filter((i) => i.nodeId === 'm').length === 3 && both.filter((i) => i.nodeId === 't').length === 1, both.map((i) => i.message).join(' | '));
  check('FR-E3: the modal suggestion names controlSize "md" and sheet', both.filter((i) => i.nodeId === 'm').length === 3 && both.filter((i) => i.nodeId === 'm').every((i) => /controlSize: "md"/.test(i.suggestion ?? '') && /sheet/.test(i.suggestion ?? '')));
  check('FR-E3: the close button is reported 32×32', both.some((i) => /^modal close button has a 32×32px/.test(i.message)));
  const md = await touch([modal({ controlSize: 'md' }), toast({ controlSize: 'md' })]);
  check('FR-E3 twin: controlSize "md" on both clears all four', md.length === 0, md.map((i) => i.message).join(' | '));
  const lg = await touch([modal({ controlSize: 'lg' }), toast({ controlSize: 'lg' })]);
  check('FR-E3 twin: "lg" clears too', lg.length === 0);
  const toastSm = await touch([modal({ controlSize: 'md' }), toast({ controlSize: 'sm' })]);
  check('FR-E3: "sm" on the toast is one error', toastSm.length === 1 && toastSm[0].nodeId === 't' && /32px/.test(toastSm[0].message));
  const ctor = await touch([modal({ controlSize: 'constructor' as SceneNode['controlSize'] }), toast({ controlSize: 44 as unknown as SceneNode['controlSize'] })]);
  check('R5: "constructor" and 44 measure as the defaults (four errors)', ctor.length === 4);
  const noAction = await touch([toast({ action: undefined })]);
  check('twin: a toast without an action has no target', noAction.length === 0);
}

// ── Verify round 1: mutation survivors ─────────────────────────────────────
{
  check('controlSize is never read as a token ref', tokenRefs({ id: 'm', type: 'modal', controlSize: '$md' } as unknown as SceneNode).length === 0);
  const arr = ['md'] as unknown as SceneNode['controlSize'];
  check('an array controlSize is the default (not coerced to "md")', overlayTargets(modal({ controlSize: arr }))[0].h === 32 && overlayTargets(toast({ controlSize: arr }))[0].h === 24);
  const tall = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', width: 44 }]);
  check('a 44-wide md text-input fails on height only (exact suggestion)', tall.length === 1 && tall[0].suggestion === 'Use size "lg" (44px).', tall[0]?.suggestion);
  const both = await touch([label('lb'), { id: 'i', name: 'i', type: 'text-input', size: 'sm', width: 20 }]);
  check('a text-input failing both ways gets both fixes, one space apart', both.length === 1 && both[0].suggestion === 'Use size "lg" (44px). Widen it to 44 or drop its width (a field spans its container).', both[0]?.suggestion);
  const toastFix = (await touch([toast()]))[0]?.suggestion;
  check('the toast suggestion names the toast', toastFix === 'Set controlSize: "md" (44px) on the toast.', toastFix);
  const linkFix = (await touch([{ id: 'l', name: 'l', type: 'link', icon: 'settings', ariaLabel: 'Settings', width: 'auto' }]))[0]?.suggestion;
  check('a link\'s suggestion is height alone, whatever its width', linkFix === 'Give the link height: 44 (it is never narrower than its height), or make it a button (size "md").', linkFix);
}

if (!allPass) {
  console.log('\nSome checks FAILED');
  process.exit(1);
}
console.log('\nAll checks passed');
