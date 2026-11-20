// Phase 25 slice E — motion tokens: $motion.<name> refs resolve on
// transition, cubic-bezier easings render safely, and the ad-hoc-timing
// nudge fires only when no motion language is declared.
//
// Usage: npx tsx test/unit/test-motion-tokens.ts

import '../env.js';
import { resolveVariables, mergeDesignTokens } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import type { SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const MOTION = { motion: { fast: { duration: 150, easing: 'ease-out' }, emphasis: { duration: 400, easing: 'cubic-bezier(0.2, 0, 0, 1)' } } };

// ── resolution + render ─────────────────────────────────────────────────────
{
  const root: SceneNode = { id: 'doc', type: 'document', children: [
    { id: 'a', type: 'frame', transition: '$motion.fast' },
    { id: 'b', type: 'frame', transition: '$motion.emphasis' },
    { id: 'c', type: 'frame', transition: '$motion.nope' },
  ] } as SceneNode;
  const r = resolveVariables(root, MOTION);
  const [a, b, c] = r.children!;
  check('$motion ref resolves to the token object', typeof a.transition === 'object' && (a.transition as { duration: number }).duration === 150);
  check('cubic-bezier easing carried', typeof b.transition === 'object' && (b.transition as { easing: string }).easing === 'cubic-bezier(0.2, 0, 0, 1)');
  check('unknown ref left as string (renderer skips it)', c.transition === '$motion.nope');

  const html = renderToHtml(r, 800, 600);
  check('named easing renders', html.includes('transition: all 150ms ease-out'));
  check('cubic-bezier renders (safe shape allowed)', html.includes('transition: all 400ms cubic-bezier(0.2, 0, 0, 1)'));
  check('unresolved string transition emits nothing', !html.includes('$motion.nope'));

  const evil = resolveVariables({ id: 'd', type: 'document', children: [{ id: 'x', type: 'frame', transition: { duration: 100, easing: 'ease}; background: url(x)' } }] } as SceneNode, {});
  const evilHtml = renderToHtml(evil, 800, 600);
  check('unsafe easing falls back to ease', evilHtml.includes('transition: all 100ms ease ') && !evilHtml.includes('url(x)'));
}

// ── layer merge ─────────────────────────────────────────────────────────────
{
  const merged = mergeDesignTokens({ motion: { fast: { duration: 150, easing: 'ease-out' } } }, { motion: { slow: { duration: 500, easing: 'ease' } } });
  check('motion merges key-wise across layers', merged.motion?.fast?.duration === 150 && merged.motion?.slow?.duration === 500);
}

// ── the ad-hoc-timing nudge ─────────────────────────────────────────────────
{
  const sprawl = createCanvas('Timing Sprawl');
  parseAndExecute(sprawl.root, `
I("document", { type: "frame", transition: { "duration": 150, "easing": "ease-out" } })
I("document", { type: "frame", transition: { "duration": 200, "easing": "ease-in" } })
I("document", { type: "frame", transition: { "duration": 350, "easing": "linear" } })
`, sprawl);
  const r = await evaluateCanvas(sprawl, { mode: 'fast', categories: ['consistency'] });
  const nudge = r.issues.filter((i) => i.message.includes('motion tokens'));
  check('3 ad-hoc combos, no tokens → one info nudge', nudge.length === 1 && nudge[0].severity === 'info', JSON.stringify(nudge));
  check('nudge is score-neutral', (r.categories.find((x) => x.name === 'consistency')?.score ?? 0) === 100);

  // Declaring motion tokens quiets it.
  sprawl.variables = { ...sprawl.variables, ...MOTION };
  const r2 = await evaluateCanvas(sprawl, { mode: 'fast', categories: ['consistency'] });
  check('declared motion language → nudge quiet', r2.issues.filter((i) => i.message.includes('motion tokens')).length === 0);

  // Two combos — below threshold.
  const two = createCanvas('Two Combos');
  parseAndExecute(two.root, `
I("document", { type: "frame", transition: { "duration": 150, "easing": "ease-out" } })
I("document", { type: "frame", transition: { "duration": 200, "easing": "ease-in" } })
`, two);
  const rt = await evaluateCanvas(two, { mode: 'fast', categories: ['consistency'] });
  check('2 combos → silent', rt.issues.filter((i) => i.message.includes('motion tokens')).length === 0);
}

console.log(allPass ? '\nAll motion-token tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
