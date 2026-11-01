// T2a runtime smoke test: registry behavior + structure invariants.
// Run: npx tsx test-structures.ts
import './test-env.js';
import { listStructures, getStructure, registerStructure, resolveStructure, applyStructure } from './src/structures.js';
import { createCanvas, setCanvasType } from './src/scene-graph.js';
import type { SceneNode, Structure } from './src/types.js';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; };
};

const AXES = {
  heroTreatment: ['none', 'marquee', 'split', 'stat-led', 'editorial'],
  density: ['airy', 'balanced', 'dense'],
  rhythm: ['uniform', 'alternating', 'asymmetric'],
  alignment: ['centered', 'left', 'split'],
} as const;

// Only these fields may carry a `$token` ref; everything else must be literal
// (the A-P4 theming split — geometry stays crash-safe on unthemed canvases).
const COLOR_FIELDS = new Set(['fill', 'color', 'stroke', 'iconColor']);
// Phase 27 slice B — density/depth/type live on tokens too. These fields may
// carry $refs ('$space-*', '$radius-*', '$elevation.*', '$title'); anything
// else stringly-$ is still a violation.
const TOKEN_FIELDS = new Set(['gap', 'rowGap', 'padding', 'cornerRadius', 'shadow', 'fontSize']);

function walk(node: SceneNode, visit: (n: SceneNode) => void): void {
  visit(node);
  node.children?.forEach((c) => walk(c, visit));
}

// Count-independent: the live catalogue is the source of truth (the roster
// grew far past the Phase 11 six this file used to hard-code).
const PAGES = listStructures().filter((s) => s.kind === 'page').map((s) => s.name);
const NAMES = PAGES;

console.log('listStructures()');
const list = listStructures();
check(list.length >= 12, `catalogue holds pages + components (got ${list.length})`);
check(PAGES.length >= 6, `at least the original six page structures (got ${PAGES.length})`);
check(list.filter((s) => s.kind === 'page').every((s) => !!s.name && !!s.description && !!s.axes), 'each page entry has name + description + axes');

console.log('getStructure()');
for (const name of NAMES) check(!!getStructure(name), `resolves '${name}'`);
check(getStructure('does-not-exist') === undefined, 'unknown name → undefined');

console.log('taxonomy — every structure tagged on all 4 axes with valid values');
for (const name of NAMES) {
  const s = getStructure(name)!;
  for (const axis of Object.keys(AXES) as (keyof typeof AXES)[]) {
    const v = s.axes[axis];
    check((AXES[axis] as readonly string[]).includes(v), `${name}.${axis} = '${v}' is valid`);
  }
}

console.log('structure has placeholder nodes');
for (const name of NAMES) {
  const s = getStructure(name)!;
  check(Array.isArray(s.nodes) && s.nodes.length > 0, `${name} has nodes`);
}

console.log('theming split — $tokens only in color or token-bearing fields (A-P4 + Phase 27B)');
for (const name of NAMES) {
  const s = getStructure(name)!;
  const violations: string[] = [];
  s.nodes.forEach((root) => walk(root, (n) => {
    for (const [k, val] of Object.entries(n)) {
      const holds = (v: unknown): boolean => typeof v === 'string' && v.startsWith('$');
      if ((holds(val) || (Array.isArray(val) && val.some(holds))) && !COLOR_FIELDS.has(k) && !TOKEN_FIELDS.has(k)) {
        violations.push(`${n.id}.${k}=${JSON.stringify(val)}`);
      }
    }
  }));
  check(violations.length === 0, `${name} keeps $tokens in sanctioned fields${violations.length ? ` (offenders: ${violations.join(', ')})` : ''}`);
}

console.log('all node ids are unique within a structure');
for (const name of NAMES) {
  const s = getStructure(name)!;
  const ids: string[] = [];
  s.nodes.forEach((root) => walk(root, (n) => ids.push(n.id)));
  check(new Set(ids).size === ids.length, `${name} has ${ids.length} unique ids`);
}

console.log('registerStructure() adds a new entry');
const stub: Structure = {
  name: 'test-stub', description: 'temp', axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'left' }, nodes: [{ id: 't', type: 'frame' }],
};
registerStructure(stub);
check(getStructure('test-stub')?.description === 'temp', 'registered stub is retrievable');
check(listStructures().length === list.length + 1, `list grows by one after registration`);

// ── Phase 30 slice E — anatomy and realisation ─────────────────────────────
const throws = (fn: () => unknown, pattern: RegExp): boolean => {
  try { fn(); return false; } catch (e) { return pattern.test((e as Error).message); }
};
const page = (name: string, extra: Partial<Structure> = {}): Structure => ({
  name, description: 'temp', axes: stub.axes, nodes: [{ id: `${name}-n`, type: 'frame' }], ...extra,
});

console.log('anatomy and surface — defaults and the six mobile realisations');
const all = listStructures();
const byName = new Map(all.map((s) => [s.name, s]));
check(byName.get('pricing')?.anatomy === 'pricing' && byName.get('pricing')?.surface === 'web', 'an unmarked structure defaults to anatomy = name, surface web');
for (const anatomy of ['dashboard', 'settings', 'auth', 'onboarding', 'feed', 'detail']) {
  const s = getStructure(`${anatomy}-mobile`)!;
  const nodes = s?.nodes ?? [];
  check(s?.anatomy === anatomy && s?.surface === 'mobile' && s?.kind === undefined, `${anatomy}-mobile realises ${anatomy} on mobile as a page`);
  const last = nodes[nodes.length - 1]?.type;
  check(nodes[0]?.type === 'status-bar' && (last === 'home-indicator' || last === 'tab-bar'), `${anatomy}-mobile starts with status-bar, ends with home-indicator or tab-bar (${last})`);
}
check(JSON.stringify(byName.get('dashboard')?.surfaces) === '["web","mobile"]', 'dashboard is realised on web and mobile');
check(JSON.stringify(byName.get('feed-mobile')?.surfaces) === '["mobile"]', 'feed is realised on mobile only');
check(JSON.stringify(byName.get('empty-state')?.surfaces) === '["web","mobile"]' && byName.get('empty-state')?.surface === 'any', 'an any component counts for both types');

console.log('listStructures({ type }) filters by the surface that covers the type');
const mobileList = listStructures({ type: 'mobile' }).map((s) => s.name);
const webList = listStructures({ type: 'web' }).map((s) => s.name);
check(mobileList.includes('dashboard-mobile') && !mobileList.includes('dashboard') && !mobileList.includes('data-table'), 'mobile listing: realisations, no web-only structures');
check(mobileList.includes('empty-state') && webList.includes('empty-state'), 'an any component is listed for both');
check(webList.includes('dashboard') && !webList.includes('dashboard-mobile'), 'web listing: no mobile realisations');
check(all.length === new Set([...mobileList, ...webList]).size, 'every structure is listed for some type');

console.log('resolveStructure — every branch');
check(resolveStructure('dashboard', 'mobile').name === 'dashboard-mobile', 'anatomy name → the mobile realisation on mobile');
check(resolveStructure('dashboard', 'web').name === 'dashboard', 'anatomy name → the web realisation on web');
check(resolveStructure('empty-state', 'mobile').name === 'empty-state', 'an any component resolves on mobile');
check(throws(() => resolveStructure('pricing', 'mobile'), /^"pricing" has no mobile realisation\. Page anatomies with a mobile realisation: dashboard, settings, auth, onboarding, feed, detail\. Pass realisation: "web"/), 'pricing on mobile refuses, naming the mobile page anatomies and realisation: "web"');
check(throws(() => resolveStructure('feed', 'web'), /"feed" has no web realisation\..*Pass realisation: "mobile"/), 'feed on web refuses and names realisation: "mobile"');
check(throws(() => resolveStructure('data-table', 'mobile'), /Component anatomies with a mobile realisation: .*empty-state/), 'a web-only component on mobile refuses, listing component anatomies');
check(throws(() => resolveStructure('dashboard-mobile', 'web'), /mobile realisation of "dashboard" and this canvas is web.*Pass realisation: "mobile"/), 'a realisation name on the wrong type refuses with its force hint');
check(resolveStructure('dashboard-mobile', 'mobile').name === 'dashboard-mobile', 'a realisation name on its own type is used as is');
check(throws(() => resolveStructure('nope', 'web'), /not found/), 'unknown name → not found');

console.log('applyStructure resolves by the canvas type and realisation forces');
const phone = createCanvas('e-phone', undefined, {}, { type: 'mobile' });
const r1 = applyStructure(phone, 'dashboard');
check(r1.applied === 'dashboard-mobile' && r1.anatomy === 'dashboard' && r1.surface === 'mobile', 'dashboard on a mobile canvas stamps dashboard-mobile');
check(phone.metadata?.provenance?.structure === 'dashboard-mobile', 'provenance records the realisation name');
check(r1.placeholders.some((p) => p.prop === 'title' && p.id === 'dm-row-1') && r1.placeholders.some((p) => p.prop === 'label'), 'primitive copy is listed as placeholders with its prop');
check(['text-primary', 'text-secondary', 'border', 'bg-surface', 'danger', 'accent'].every((t) => r1.seededColors.includes(t)), 'the colour tokens primitives read are seeded');
const plain = applyStructure(createCanvas('e-plain', undefined, {}, { type: 'mobile' }), 'feed');
check(plain.seededColors.includes('text-primary'), 'a stamp that references no $text-primary still seeds it for its primitives');
const forced = applyStructure(createCanvas('e-forced', undefined, {}, { type: 'mobile' }), 'dashboard', { realisation: 'web' });
check(forced.applied === 'dashboard' && forced.surface === 'web', 'realisation: "web" stamps the web dashboard on a mobile canvas');
const toWeb = applyStructure(createCanvas('e-web'), 'feed', { realisation: 'mobile' });
check(toWeb.applied === 'feed-mobile', 'realisation: "mobile" stamps a mobile realisation on a web canvas');
const retyped = createCanvas('e-retyped');
setCanvasType(retyped.id, { type: 'mobile' });
check(applyStructure(retyped, 'settings').applied === 'settings-mobile', 'a canvas re-declared mobile resolves to the mobile realisation');
check(throws(() => applyStructure(createCanvas('e-refuse', undefined, {}, { type: 'mobile' }), 'pricing'), /no mobile realisation/), 'pricing on a mobile canvas refuses');

console.log('registry invariant — (anatomy, surface) unique, no shadowing names');
const before = listStructures().length;
check(throws(() => registerStructure(page('dash-2', { anatomy: 'dashboard' })), /both realise anatomy "dashboard"/), 'a second web realisation of dashboard is rejected');
check(throws(() => registerStructure(page('dash-any', { anatomy: 'dashboard', surface: 'any' })), /both realise anatomy "dashboard"/), 'an any realisation collides with the web and mobile ones');
check(throws(() => registerStructure(page('feed', { anatomy: 'stream', surface: 'web' })), /named after the anatomy of "feed-mobile"/), 'a name that is another structure\'s anatomy is rejected');
check(listStructures().length === before, 'rejected registrations leave the registry unchanged');
registerStructure(page('feed-web', { anatomy: 'feed', surface: 'web' }));
check(resolveStructure('feed', 'web').name === 'feed-web', 'a web realisation of a new anatomy registers and resolves');
registerStructure(page('feed-web', { anatomy: 'feed', surface: 'web', description: 'replaced' }));
check(getStructure('feed-web')?.description === 'replaced', 're-registering a name replaces it without colliding with itself');

console.log(failures === 0 ? '\nT2a SMOKE TEST PASSED ✅' : `\nT2a SMOKE TEST FAILED ✗ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
