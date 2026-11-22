// cornerRadius refs read the radius scale before spacing: a preset that
// defines `md` in both (spacing 16, radius 8) must render cornerRadius "$md"
// as 8, while gap/padding "$md" stay 16.
import '../env.js';
import { resolveVariables } from '../../src/variables.js';
import { getPreset } from '../../src/presets.js';
import type { SceneNode } from '../../src/types.js';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

const vars = getPreset('dark')!.variables;
const node: SceneNode = {
  id: 'card', type: 'frame', cornerRadius: '$md', gap: '$md', padding: ['$md', '$sm'],
  children: [{ id: 'inner', type: 'frame', cornerRadius: ['$sm', 0, '$lg', '$md'] }],
} as unknown as SceneNode;
const out = resolveVariables(node, vars);
const inner = out.children![0];

check('cornerRadius "$md" reads radius', out.cornerRadius, vars.radius!.md);
check('gap "$md" reads spacing', out.gap, vars.spacing!.md);
check('padding array reads spacing', out.padding, [vars.spacing!.md, vars.spacing!.sm]);
check('cornerRadius array reads radius', inner.cornerRadius, [vars.radius!.sm, 0, vars.radius!.lg, vars.radius!.md]);

const spacingOnly = resolveVariables({ id: 'a', type: 'frame', cornerRadius: '$space-2' } as unknown as SceneNode, { spacing: { 'space-2': 6 } });
check('cornerRadius falls back to spacing when radius lacks the name', spacingOnly.cornerRadius, 6);

if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log('All radius-precedence checks passed');
