import './test-env.js';
// Phase 30 slice D — the mobile primitives and pinned positioning, Chrome-free:
// render markup and CSS, colour defaults (themed and unthemed), the root's
// min-height, the pinned-chrome reservations with and without safeArea, the
// viewport meta, and the geometry the rules share with the renderer.
// Rendered geometry lives in test-positioning.ts (Chrome).
//
// Usage: npx tsx test-mobile-primitives.ts

import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { buttonBox, chromeHeight, chromeReservation, effectivePosition, pinsBottom, pinsTop, tabItemBox } from './src/primitives.js';
import type { DesignVariables, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const THEME: DesignVariables = {
  colors: { accent: '#0B6E4F', border: '#E4E4E7', 'bg-surface': '#FAFAFA', 'text-primary': '#18181B', 'text-secondary': '#52525B', danger: '#B42318' },
  radius: { 'radius-md': 10, 'radius-lg': 16 },
};

function doc(children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode {
  return { id: 'doc', type: 'document', width: 390, height: 844, fill: '#FFFFFF', children, ...extra };
}
const render = (root: SceneNode, vars: DesignVariables = {}) => renderToHtml(resolveVariables(root, vars), 390, 844);
/** The style attribute of the element carrying `data-node-id="id"`. */
function styleOf(html: string, id: string): string {
  const m = new RegExp(`data-node-id="${id}"[^>]*style="([^"]*)"`).exec(html);
  return m ? m[1].replace(/&quot;/g, '"') : '';
}

// ── root render and viewport meta ─────────────────────────────────────────
{
  console.log('── root ──');
  const html = render(doc([{ id: 't', type: 'text', content: 'Hi' }]));
  const root = styleOf(html, 'doc');
  check('root keeps its height and grows to its content', root.includes('height: 844px') && root.includes('min-height: max-content'), root);
  const clipped = styleOf(render(doc([], { overflow: 'hidden' })), 'doc');
  check('a root with an authored overflow keeps the plain fixed height', clipped.includes('height: 844px') && !clipped.includes('max-content'), clipped);
  const visible = styleOf(render(doc([], { overflow: 'visible' })), 'doc');
  check('overflow "visible" still grows', visible.includes('min-height: max-content'));
  check('viewport meta present', html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  const frame = styleOf(render(doc([{ id: 'f', type: 'frame', height: 100 }])), 'f');
  check('a non-root frame keeps a plain height', frame === 'height: 100px', frame);
}

// ── positioning ───────────────────────────────────────────────────────────
{
  console.log('\n── positioning ──');
  const abs = styleOf(render(doc([{ id: 'a', type: 'text', content: 'x', position: 'absolute', x: 10, y: 20 }])), 'a');
  check('absolute keeps left/top as before', abs.includes('position: absolute; left: 10px; top: 20px'), abs);
  const fixed = styleOf(render(doc([{ id: 'f', type: 'frame', position: 'fixed', bottom: 0, height: 60 }])), 'f');
  check('fixed: left measured from the root edge, width capped at the root', fixed.includes('left: calc(max(0px, (100% - 390px) / 2) + 0px)') && fixed.includes('max-width: 390px'), fixed);
  check('fixed: bottom offset + z-index, no default top', fixed.includes('bottom: 0px') && fixed.includes('z-index: 10') && !fixed.includes('top:'), fixed);
  const right = styleOf(render(doc([{ id: 'f', type: 'frame', position: 'fixed', right: 16, y: 100 }])), 'f');
  check('fixed: right from the root edge, no left', right.includes('right: calc(max(0px, (100% - 390px) / 2) + 16px)') && !right.includes('left:') && right.includes('top: 100px'), right);
  const sticky = styleOf(render(doc([{ id: 's', type: 'frame', position: 'sticky' }])), 's');
  check('sticky with no offset sticks at top 0, z 5', sticky.includes('position: sticky') && sticky.includes('top: 0') && sticky.includes('z-index: 5'), sticky);
  const relBottom = styleOf(render(doc([{ id: 'r', type: 'frame', position: 'relative', bottom: 4, right: 2 }])), 'r');
  check('bottom / right emit plainly off fixed', relBottom.includes('right: 2px') && relBottom.includes('bottom: 4px'), relBottom);
}

// ── chrome reservations ───────────────────────────────────────────────────
{
  console.log('\n── reservations ──');
  const safe = { safeArea: { top: 47, bottom: 34 } };
  const tab: SceneNode = { id: 'tb', type: 'tab-bar', items: [{ icon: 'house', label: 'Home' }, { icon: 'user', label: 'Me' }] };
  const both = styleOf(render(doc([tab], safe)), 'doc');
  check('safeArea + fixed tab-bar → bottom max(calc(0px + 34px), 83px)', both.includes('padding-bottom: max(calc(0px + 34px), 83px)'), both);
  check('top keeps the slice B safeArea emission', both.includes('padding-top: calc(0px + 47px)'), both);
  const bare = styleOf(render(doc([{ id: 'sb', type: 'status-bar' }, { id: 't', type: 'text', content: 'x' }])), 'doc');
  check('no safeArea + fixed status-bar → top reservation 47', bare.includes('padding-top: max(0px, 47px)') && !bare.includes('padding-bottom'), bare);
  const fab = styleOf(render(doc([{ ...tab, variant: 'fab' }], safe)), 'doc');
  check('a fab tab-bar reserves its raised FAB (99)', fab.includes('83px') === false && fab.includes('99px'), fab);
  const offset = styleOf(render(doc([{ id: 'hi', type: 'home-indicator', bottom: 10 }], safe)), 'doc');
  check('a home-indicator with a bottom offset reserves 34 + 10', offset.includes('max(calc(0px + 34px), 44px)'), offset);
  const inFlow = styleOf(render(doc([{ ...tab, position: 'relative' }], safe)), 'doc');
  check('a tab-bar moved into flow reserves nothing', inFlow.includes('padding-bottom: calc(0px + 34px)') && !inFlow.includes('max('), inFlow);
  const inSheet = styleOf(render(doc([{ id: 'sh', type: 'sheet', children: [tab] }], safe)), 'doc');
  check('chrome inside a sheet reserves nothing', !inSheet.includes('max('), inSheet);
  const padded = styleOf(render(doc([tab], { ...safe, padding: [0, 16, 24, 16] })), 'doc');
  check('authored padding rides inside the max()', padded.includes('padding-bottom: max(calc(24px + 34px), 83px)'), padded);
  const plain = styleOf(render(doc([{ id: 't', type: 'text', content: 'x' }], safe)), 'doc');
  check('no chrome → slice B emission byte for byte', plain.includes('padding-top: calc(0px + 47px); padding-bottom: calc(0px + 34px)'), plain);
  check('chromeReservation: fab + home indicator → max', chromeReservation(doc([{ ...tab, variant: 'fab' }, { id: 'hi', type: 'home-indicator' }], safe)).bottom === 99);
}

// ── primitives: markup, sizes, defaults ───────────────────────────────────
{
  console.log('\n── status-bar / home-indicator ──');
  const html = render(doc([{ id: 'sb', type: 'status-bar' }, { id: 'hi', type: 'home-indicator' }], { safeArea: { top: 50, bottom: 30 } }), THEME);
  const sb = styleOf(html, 'sb');
  check('status-bar: fixed top 0, height = safeArea.top, $text-primary glyphs', sb.includes('position: fixed') && sb.includes('top: 0') && sb.includes('height: 50px') && sb.includes('color: #18181B'), sb);
  check('status-bar shows 9:41 and three glyphs', html.includes('>9:41<') && (html.match(/<svg width="(18|16|27)"/g) ?? []).length === 3);
  const hi = styleOf(html, 'hi');
  check('home-indicator: fixed bottom 0, height = safeArea.bottom', hi.includes('bottom: 0') && hi.includes('height: 30px') && hi.includes('pointer-events: none'), hi);
  check('home-indicator pill 134×5', html.includes('width: 134px; height: 5px'));
  const light = render(doc([{ id: 'sb', type: 'status-bar', appearance: 'light', time: '10:02' }]));
  check('appearance "light" → white glyphs, custom time, 47 without safeArea', styleOf(light, 'sb').includes('color: #FFFFFF') && light.includes('>10:02<') && styleOf(light, 'sb').includes('height: 47px'));
  check('chromeHeight falls back to 47 / 34', chromeHeight({ id: 'x', type: 'status-bar' }, { top: 47, bottom: 34 }) === 47);
}
{
  console.log('\n── nav-bar ──');
  const html = render(doc([{ id: 'nb', type: 'nav-bar', title: 'Settings', leading: { label: 'Back' }, trailing: [{ icon: 'search' }, { label: 'Edit' }, { icon: 'x' }] }]), THEME);
  const nb = styleOf(html, 'nb');
  check('nav-bar: 44 tall, in flow, never shrinks', nb.includes('height: 44px') && !nb.includes('position:') && nb.includes('flex-shrink: 0'), nb);
  check('nav-bar: centred 17px title in a label', html.includes('font-size: 17px; font-weight: 600">Settings<'));
  check('nav-bar: actions get 44px boxes in the accent', (html.match(/min-width: 44px; height: 44px/g) ?? []).length === 3 && html.includes('color: #0B6E4F'));
  check('nav-bar: a third trailing action is ignored', !html.includes('lucide-x') && (html.match(/min-width: 44px; height: 44px/g) ?? []).length === 3);
  const large = render(doc([{ id: 'nb', type: 'nav-bar', title: 'Inbox', largeTitle: true }]));
  check('largeTitle: 96 tall, 34px bold title', styleOf(large, 'nb').includes('height: 96px') && large.includes('font-size: 34px; font-weight: 700'));
}
{
  console.log('\n── tab-bar ──');
  const items = [{ icon: 'house', label: 'Today', active: true }, { icon: 'map', label: 'Routes', badge: 3 }, { icon: 'user', label: 'Profile' }, { icon: 'settings', label: 'Settings' }];
  const html = render(doc([{ id: 'tb', type: 'tab-bar', items }], { safeArea: { top: 47, bottom: 34 } }), THEME);
  const tb = styleOf(html, 'tb');
  check('tab-bar: fixed bottom 0, 49 + 34 tall, surface fill, top border', tb.includes('position: fixed') && tb.includes('bottom: 0') && tb.includes('height: 83px') && tb.includes('background-color: #FAFAFA') && tb.includes('border-top: 1px solid #E4E4E7'), tb);
  check('tab-bar: active item in the accent, others secondary', html.includes('color: #0B6E4F') && html.includes('color: #52525B'));
  check('tab-bar: labels are 11px designed-truncation labels', (html.match(/data-fs-label[^>]*font-size: 11px/g) ?? []).length === 4);
  check('tab-bar: badge uses $danger', html.includes('background-color: #B42318') && html.includes('>3</span>'));
  const fab = render(doc([{ id: 'tb', type: 'tab-bar', items, variant: 'fab', fab: { icon: 'plus' } }]));
  check('fab: box is 16px taller and holds a 56px circle', styleOf(fab, 'tb').includes('height: 99px') && fab.includes('width: 56px; height: 56px'));
  const slots = [...fab.matchAll(/flex: 1 1 0/g)].length;
  check('fab: four items + the FAB slot', slots === 5, String(slots));
  const floating = render(doc([{ id: 'tb', type: 'tab-bar', items, variant: 'floating' }]));
  check('floating: transparent box, inset pill with radius', !styleOf(floating, 'tb').includes('background-color') && floating.includes('border-radius: 24.5px') && styleOf(floating, 'tb').includes('padding: 0 16px'));
  check('tabItemBox: 390 / 4 × 49; floating subtracts 32', tabItemBox({ id: 'x', type: 'tab-bar', items }, 390).w === 97.5 && tabItemBox({ id: 'x', type: 'tab-bar', items, variant: 'floating' }, 390).w === 89.5);
}
{
  console.log('\n── button ──');
  const sizes = (['sm', 'md', 'lg'] as const).map((size) => styleOf(render(doc([{ id: 'b', type: 'button', label: 'Go', size }])), 'b'));
  check('button heights 32 / 44 / 52 with matching min-width', sizes.every((st, i) => st.includes(`height: ${[32, 44, 52][i]}px`) && st.includes(`min-width: ${[32, 44, 52][i]}px`)), sizes.join(' | '));
  check('button never shrinks, hugs its label by default', sizes[1].includes('flex-shrink: 0') && sizes[1].includes('width: fit-content'));
  const primary = render(doc([{ id: 'b', type: 'button', label: 'Save' }]), THEME);
  check('primary: accent fill, label colour by contrast, radius-md', styleOf(primary, 'b').includes('background-color: #0B6E4F') && styleOf(primary, 'b').includes('color: #FFFFFF') && styleOf(primary, 'b').includes('border-radius: 10px'));
  const pale = styleOf(render(doc([{ id: 'b', type: 'button', label: 'Save' }]), { colors: { accent: '#F5D90A' } }), 'b');
  check('a pale accent gets a dark label', pale.includes('color: #111827'), pale);
  const secondary = styleOf(render(doc([{ id: 'b', type: 'button', label: 'Plan', variant: 'secondary' }]), THEME), 'b');
  check('secondary: transparent, $border stroke, text label', secondary.includes('background-color: transparent') && secondary.includes('border: 1px solid #E4E4E7') && secondary.includes('color: #18181B'), secondary);
  const destructive = styleOf(render(doc([{ id: 'b', type: 'button', label: 'Delete', variant: 'destructive' }])), 'b');
  check('destructive unthemed falls back to #DC2626', destructive.includes('background-color: #DC2626'), destructive);
  const iconOnly = styleOf(render(doc([{ id: 'b', type: 'button', icon: 'plus', variant: 'ghost' }])), 'b');
  check('icon-only button is square', iconOnly.includes('width: 44px') && iconOnly.includes('height: 44px') && iconOnly.includes('padding: 0'), iconOnly);
  const floor = styleOf(render(doc([{ id: 'b', type: 'button', label: 'Go', size: 'sm', minHeight: 44 }])), 'b');
  check('minHeight raises a button (height = min-height)', floor.includes('height: 44px; min-height: 44px'), floor);
  check('buttonBox matches: sm 32×32, icon-only square, never narrower than tall',
    buttonBox({ id: 'x', type: 'button', label: 'Go', size: 'sm' }).h === 32
    && buttonBox({ id: 'x', type: 'button', icon: 'plus', width: 200 }).w === 44
    && buttonBox({ id: 'x', type: 'button', label: 'Go', width: 20 }).w === 44);
  const disabled = styleOf(render(doc([{ id: 'b', type: 'button', label: 'Go', disabled: true }])), 'b');
  check('disabled → opacity 0.5', disabled.includes('opacity: 0.5'));
}
{
  console.log('\n── list-row ──');
  const html = render(doc([{ id: 'r', type: 'list-row', title: 'Wi-Fi', subtitle: 'Home', leading: { icon: 'wifi' }, trailing: { chevron: true }, divider: true }]), THEME);
  const r = styleOf(html, 'r');
  check('list-row: min 56 with a subtitle, stretches, never shrinks', r.includes('min-height: 56px') && r.includes('align-self: stretch') && r.includes('flex-shrink: 0'), r);
  check('list-row: title + subtitle are truncating labels', html.includes('font-size: 16px; line-height: 1.3">Wi-Fi<') && html.includes('color: #52525B">Home<'));
  check('list-row: divider from the 16px inset', html.includes('left: 16px; right: 0; bottom: 0; height: 1px; background-color: #E4E4E7'));
  check('list-row: 44 without a subtitle', styleOf(render(doc([{ id: 'r', type: 'list-row', title: 'x' }])), 'r').includes('min-height: 44px'));
  const toggle = render(doc([{ id: 'r', type: 'list-row', title: 'Sync', trailing: { toggle: true } }]), THEME);
  check('list-row: trailing toggle in the accent', toggle.includes('width: 44px; height: 24px; border-radius: 12px; background-color: #0B6E4F'));
  const initials = render(doc([{ id: 'r', type: 'list-row', title: 'Ada', leading: { initials: 'AL' }, trailing: { text: 'Admin' } }]));
  check('list-row: initials circle + trailing text', initials.includes('>AL</div>') && initials.includes('>Admin<'));
}
{
  console.log('\n── sheet ──');
  const html = render(doc([{ id: 'sh', type: 'sheet', detent: 'medium', padding: 16, gap: 12, children: [{ id: 'st', type: 'text', content: 'Share' }] }], { safeArea: { top: 47, bottom: 34 } }), THEME);
  const sh = styleOf(html, 'sh');
  check('sheet: fixed panel, half height, scrolls, top radius from radius-lg', sh.includes('position: fixed') && sh.includes('height: 50%') && sh.includes('overflow-y: auto') && sh.includes('border-radius: 16px 16px 0 0'), sh);
  check('sheet: grabber adds 16 top, inset adds 34 bottom', sh.includes('padding: calc(16px + 16px) 16px calc(16px + 34px) 16px'), sh);
  check('sheet: a scrim precedes the panel', html.includes('background-color: rgba(0, 0, 0, 0.4)'));
  check('sheet: panel marked data-fs-scroll, children inside', html.includes('data-fs-scroll') && html.indexOf('data-node-id="st"') > html.indexOf('data-node-id="sh"'));
  const large = styleOf(render(doc([{ id: 'sh', type: 'sheet', detent: 'large', grabber: false }])), 'sh');
  check('large detent reaches to inset + 10; no grabber → plain top padding', large.includes('top: 57px') && large.includes('padding: 0px'), large);
  check('a sheet is always fixed', effectivePosition({ id: 's', type: 'sheet', position: 'relative' }) === 'fixed');
}

// ── unthemed never crashes; pinning helpers ───────────────────────────────
{
  console.log('\n── defaults + helpers ──');
  const all: SceneNode[] = [
    { id: 'a', type: 'status-bar' }, { id: 'b', type: 'home-indicator' }, { id: 'c', type: 'nav-bar', title: 'T' },
    { id: 'd', type: 'tab-bar', items: [{ icon: 'house', label: 'H' }, { icon: 'user', label: 'U' }] },
    { id: 'e', type: 'button', label: 'B' }, { id: 'f', type: 'list-row', title: 'R' }, { id: 'g', type: 'sheet' },
  ];
  let ok = true;
  try { render(doc(all)); } catch { ok = false; }
  check('every primitive renders unthemed', ok);
  check('pinsBottom: default tab-bar yes; y set no; generic fixed with no offset no',
    pinsBottom({ id: 't', type: 'tab-bar' }) && !pinsBottom({ id: 't', type: 'tab-bar', y: 0 }) && !pinsBottom({ id: 'f', type: 'frame', position: 'fixed' }));
  check('pinsTop: status-bar and a no-offset fixed frame yes; bottom bar no',
    pinsTop({ id: 's', type: 'status-bar' }) && pinsTop({ id: 'f', type: 'frame', position: 'fixed' }) && !pinsTop({ id: 'f', type: 'frame', position: 'fixed', bottom: 0 }));
}

// ── mutation-round gaps ───────────────────────────────────────────────────
{
  console.log('\n── mutation-round gaps ──');
  const safe = { safeArea: { top: 47, bottom: 34 } };
  const comp = { id: 'c', name: 'c', variables: {}, components: { bar: { id: 'bar', type: 'component', children: [{ id: 'bar-tb', type: 'tab-bar', items: [{ icon: 'house', label: 'A' }, { icon: 'user', label: 'B' }] }] } } } as never;
  const viaInstance = styleOf(renderToHtml(doc([{ id: 'i', type: 'instance', componentId: 'bar' }], safe), 390, 844, comp), 'doc');
  check('a tab-bar inside an instance reserves the bottom too', viaInstance.includes('max(calc(0px + 34px), 83px)'), viaInstance);
  const offsetTop = styleOf(render(doc([{ id: 'sb', type: 'status-bar', y: 10 }])), 'doc');
  check('a status-bar at y 10 reserves 47 + 10', offsetTop.includes('padding-top: max(0px, 57px)'), offsetTop);
  const fab = render(doc([{ id: 'tb', type: 'tab-bar', variant: 'fab', items: [{ icon: 'house', label: 'A' }, { icon: 'user', label: 'B' }] }]));
  check('the FAB is centred in its slot and raised past the band border', fab.includes('left: 50%; top: -17px; margin-left: -28px'));
  const back = render(doc([{ id: 'nb', type: 'nav-bar', title: 'T', leading: { label: 'Back' } }]));
  check('a back action with no icon draws the chevron-left glyph', back.includes('lucide-chevron-left') || back.includes('m15 18-6-6 6-6'), back.slice(back.indexOf('data-node-id="nb"'), back.indexOf('data-node-id="nb"') + 400));
}

console.log(allPass ? '\nAll mobile primitive checks passed.' : '\nSome mobile primitive checks FAILED.');
process.exit(allPass ? 0 : 1);
