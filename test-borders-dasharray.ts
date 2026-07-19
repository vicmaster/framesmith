import './test-env.js';
// Phase 22 slice A — per-side borders (#131) + dash control (#132).
// String-level assertions on renderToHtml output — no Chrome needed.
//
// Usage: npx tsx test-borders-dasharray.ts

import { createCanvas, insertNode } from './src/scene-graph.js';
import { resolveVariables } from './src/variables.js';
import { renderToHtml, dasharrayValue } from './src/renderer.js';
import type { SceneNode } from './src/types.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const canvas = createCanvas('borders-dasharray-test');
const root = canvas.root;
const render = (node: SceneNode) => renderToHtml(node, 800, 600, canvas);

// ── per-side borders ─────────────────────────────────────────────────────────
{
  const row = insertNode(root, root.id, {
    type: 'frame',
    name: 'Row',
    borderTop: { width: 1, color: '#E5E7EB' },
    borderLeft: { width: 3, color: '#2563EB' },
  });
  const html = render(root);
  check('borderTop renders', html.includes('border-top: 1px solid #E5E7EB'), html.match(/border-top[^;]*/)?.[0]);
  check('borderLeft renders', html.includes('border-left: 3px solid #2563EB'));
  check('unset sides absent', !html.includes('border-right') && !html.includes('border-bottom'));

  row.borderTop = { width: 1, color: '#E5E7EB', style: 'dashed' };
  check('per-side style dashed', render(root).includes('border-top: 1px dashed #E5E7EB'));
}

// ── stroke composition + strokeStyle ─────────────────────────────────────────
{
  const card = insertNode(root, root.id, {
    type: 'frame',
    name: 'Forecast',
    stroke: '#D1D5DB',
    strokeWidth: 1,
    strokeStyle: 'dashed',
    borderLeft: { width: 3, color: '#DC2626' },
  });
  const html = render(root);
  check('strokeStyle dashes the shorthand', html.includes('border: 1px dashed #D1D5DB'));
  const style = html.match(/style="[^"]*border: 1px dashed #D1D5DB[^"]*"/)?.[0] ?? '';
  check('per-side emitted after shorthand (cascade wins)',
    style.indexOf('border: 1px dashed') < style.indexOf('border-left: 3px solid #DC2626') && style.includes('border-left: 3px solid #DC2626'), style);
  check('default strokeStyle stays solid', (() => {
    card.strokeStyle = undefined;
    return render(root).includes('border: 1px solid #D1D5DB');
  })());
}

// ── token resolution in border sides ─────────────────────────────────────────
{
  canvas.variables = { colors: { border: '#374151', primary: '#0D9488' } };
  const node = insertNode(root, root.id, {
    type: 'frame',
    name: 'Tokened',
    borderBottom: { width: 1, color: '$border' },
    borderLeft: { width: 3, color: '$primary' },
  });
  const resolved = resolveVariables(root, canvas.variables);
  const html = renderToHtml(resolved, 800, 600, canvas);
  check('$token resolves in borderBottom.color', html.includes('border-bottom: 1px solid #374151'));
  check('$token resolves in borderLeft.color', html.includes('border-left: 3px solid #0D9488'));
  check('unknown $token left verbatim', (() => {
    node.borderBottom = { width: 1, color: '$nope' };
    const r = resolveVariables(root, canvas.variables);
    return renderToHtml(r, 800, 600, canvas).includes('border-bottom: 1px solid $nope');
  })());
}

// ── path strokeDasharray ─────────────────────────────────────────────────────
{
  const path = insertNode(root, root.id, {
    type: 'path',
    d: 'M0 0 L100 50',
    stroke: '#2563EB',
    strokeWidth: 2.5,
    width: 100,
    height: 50,
    strokeDasharray: '6 4',
  });
  check('string dasharray renders', render(root).includes('stroke-dasharray="6 4"'));

  path.strokeDasharray = [2, 3.5];
  check('number-array dasharray joins with spaces', render(root).includes('stroke-dasharray="2 3.5"'));

  path.strokeDasharray = '6 4" onload="alert(1)';
  check('unsafe dasharray dropped', !render(root).includes('onload'));

  check('dasharrayValue: undefined → null', dasharrayValue(undefined) === null);
  check('dasharrayValue: negative rejected', dasharrayValue([6, -4]) === null);
  check('dasharrayValue: empty array rejected', dasharrayValue([]) === null);
  check('dasharrayValue: comma string accepted', dasharrayValue('2,3.5') === '2,3.5');
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
