// T2a runtime smoke test: registry behavior + structure invariants.
// Run: npx tsx test-structures.ts
import { listStructures, getStructure, registerStructure } from './src/structures.js';
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

function walk(node: SceneNode, visit: (n: SceneNode) => void): void {
  visit(node);
  node.children?.forEach((c) => walk(c, visit));
}

console.log('listStructures()');
const list = listStructures();
check(list.length === 2, `returns 2 structures (got ${list.length})`);
check(list.every((s) => !!s.name && !!s.description && !!s.axes), 'each entry has name + description + axes');

console.log('getStructure()');
check(!!getStructure('marquee-hero'), "resolves 'marquee-hero'");
check(!!getStructure('bento-grid'), "resolves 'bento-grid'");
check(getStructure('does-not-exist') === undefined, 'unknown name → undefined');

console.log('taxonomy — every structure tagged on all 4 axes with valid values');
for (const name of ['marquee-hero', 'bento-grid']) {
  const s = getStructure(name)!;
  for (const axis of Object.keys(AXES) as (keyof typeof AXES)[]) {
    const v = s.axes[axis];
    check((AXES[axis] as readonly string[]).includes(v), `${name}.${axis} = '${v}' is valid`);
  }
}

console.log('structure has placeholder nodes');
for (const name of ['marquee-hero', 'bento-grid']) {
  const s = getStructure(name)!;
  check(Array.isArray(s.nodes) && s.nodes.length > 0, `${name} has nodes`);
}

console.log('theming split — only color fields hold $tokens; geometry is literal (A-P4)');
for (const name of ['marquee-hero', 'bento-grid']) {
  const s = getStructure(name)!;
  let violations: string[] = [];
  s.nodes.forEach((root) => walk(root, (n) => {
    for (const [k, val] of Object.entries(n)) {
      if (typeof val === 'string' && val.startsWith('$') && !COLOR_FIELDS.has(k)) {
        violations.push(`${n.id}.${k}=${val}`);
      }
    }
  }));
  check(violations.length === 0, `${name} keeps $tokens in color fields only${violations.length ? ` (offenders: ${violations.join(', ')})` : ''}`);
}

console.log('all node ids are unique within a structure');
for (const name of ['marquee-hero', 'bento-grid']) {
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
check(listStructures().length === 3, 'list now reports 3');

console.log(failures === 0 ? '\nT2a SMOKE TEST PASSED ✅' : `\nT2a SMOKE TEST FAILED ✗ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
