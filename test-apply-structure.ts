// T4 end-to-end smoke test: apply_structure helper + render verification.
// Run: npx tsx test-apply-structure.ts
import './test-env.js'; // isolate persistence — MUST be first
import { createCanvas } from './src/scene-graph.js';
import { applyStructure } from './src/structures.js';
import { getCanvasTokens } from './src/workspaces.js';
import { resolveVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
};

function renderCanvas(canvas: ReturnType<typeof createCanvas>): string {
  const resolved = resolveVariables(canvas.root, getCanvasTokens(canvas));
  return renderToHtml(resolved, 1280, 900, canvas);
}

// ── apply onto an empty, unthemed canvas ──────────────────────────────────
console.log('apply marquee-hero to a fresh unthemed canvas');
const canvas = createCanvas('T4 marquee');
const existingColors = new Set(Object.keys(getCanvasTokens(canvas).colors ?? {}));
check(existingColors.size === 0, 'fresh canvas has no resolvable colors');

const res = applyStructure(canvas, 'marquee-hero', { existingColors });
check(canvas.root.children?.length === 2, `root has 2 top-level nodes (got ${canvas.root.children?.length})`);
check(res.insertedNodeIds.includes('mh-hero'), 'returns inserted node ids');
check(res.placeholders.some((p) => p.role === 'Headline'), 'placeholder list includes a "Headline" role');

console.log('provenance stamped into metadata bag');
check(canvas.metadata?.provenance?.structure === 'marquee-hero', 'provenance.structure recorded');
check(canvas.metadata?.provenance?.axes?.heroTreatment === 'marquee', 'provenance.axes recorded');
check(typeof canvas.metadata?.provenance?.at === 'string', 'provenance.at timestamp present');

console.log('color seeding (A-P4) — unresolved $tokens get neutral defaults');
check(res.seededColors.includes('accent') && res.seededColors.includes('bg-primary'), 'seeded the referenced color tokens');
check(typeof canvas.variables.colors?.['accent'] === 'string', 'accent written to canvas.variables.colors');

console.log('render — scaffold produces HTML with NO unresolved $tokens');
const html = renderCanvas(canvas);
check(html.includes('Headline'), 'rendered HTML contains the Headline placeholder');
const leaked = [...res.seededColors, ...Object.keys(getCanvasTokens(canvas).colors ?? {})]
  .filter((t) => html.includes('$' + t));
check(leaked.length === 0, `no literal $token leaked into HTML${leaked.length ? ` (leaked: ${leaked.join(', ')})` : ''}`);
// belt-and-suspenders: no '$' immediately followed by a token-ish word
check(!/\$[a-z][a-z0-9-]*/i.test(html), 'no $token-shaped strings remain in HTML');

// ── refuse / replace (C2) ─────────────────────────────────────────────────
console.log('refuse on non-empty root unless replace (C2)');
let refused = false;
try { applyStructure(canvas, 'bento-grid', { existingColors }); } catch { refused = true; }
check(refused, 'applying to a non-empty root without replace throws');

const res2 = applyStructure(canvas, 'bento-grid', { replace: true, existingColors });
check(res2.applied === 'bento-grid', 'replace: true succeeds');
check(canvas.root.children?.length === 1 && canvas.root.children?.[0].id === 'bn-page', 'root replaced with bento-grid');
check(canvas.metadata?.provenance?.structure === 'bento-grid', 'provenance updated to bento-grid');
check(renderCanvas(canvas).includes('Headline'), 'bento-grid also renders');

// ── unknown structure ─────────────────────────────────────────────────────
console.log('unknown structure name throws');
let threw = false;
try { applyStructure(createCanvas('x'), 'nope', {}); } catch { threw = true; }
check(threw, 'unknown structure name throws a clear error');

// ── seeding respects already-resolvable colors ────────────────────────────
console.log('seeding skips colors already provided');
const themed = createCanvas('themed');
themed.variables.colors = { accent: '#ff0000' };
const themedExisting = new Set(Object.keys(getCanvasTokens(themed).colors ?? {}));
const res3 = applyStructure(themed, 'marquee-hero', { existingColors: themedExisting });
check(!res3.seededColors.includes('accent'), 'does not re-seed the pre-set accent');
check(themed.variables.colors?.['accent'] === '#ff0000', 'pre-set accent preserved');

console.log(failures === 0 ? '\nT4 SMOKE TEST PASSED ✅' : `\nT4 SMOKE TEST FAILED ✗ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
