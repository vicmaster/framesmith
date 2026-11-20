// Issue #151 — singular `shadow` is silently ignored when `shadows` exists:
// the renderer gives `shadows` (array or CSS string) total precedence, so a
// `shadow` written onto such a node is a no-op. The fix surfaces a `warning`
// on the op result (batch_design I/U/C/R and replace_matching_properties)
// instead of failing silently.
//
// Usage: npx tsx test/unit/test-shadow-warning.ts

import '../env.js';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute, ignoredShadowWarning } from '../../src/operations.js';
import { replaceMatchingProperties } from '../../src/scene-graph.js';
import type { SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const canvas = createCanvas('Shadow Warning Test');

// U writing `shadow` onto a node whose `shadows` array is active → warning.
const r1 = parseAndExecute(canvas.root, `
card=I("document", { type: "frame", shadows: [{ "x": 0, "y": 1, "blur": 2, "color": "rgba(0,0,0,0.2)" }] })
U(card, { shadow: "0 4px 12px rgba(0,0,0,0.3)" })
`, canvas);
check('ops succeed', r1.every((r) => r.ok));
check('I with shadows only → no warning', r1[0].warning === undefined, r1[0].warning);
check('U shadow onto shadows node → warning', typeof r1[1].warning === 'string' && r1[1].warning.includes('`shadow` was ignored'), r1[1].warning);

// `shadow` alone (no shadows) works — must NOT warn.
const r2 = parseAndExecute(canvas.root, `
plain=I("document", { type: "frame" })
U(plain, { shadow: "0 1px 2px rgba(0,0,0,0.2)" })
`, canvas);
check('shadow alone → no warning', r2.every((r) => r.warning === undefined), JSON.stringify(r2));

// Empty `shadows` array does not shadow the singular form (renderer falls
// through to `shadow`) — no warning.
const r3 = parseAndExecute(canvas.root, `
e=I("document", { type: "frame", shadows: [] })
U(e, { shadow: "0 1px 2px rgba(0,0,0,0.2)" })
`, canvas);
check('empty shadows array → no warning', r3.every((r) => r.warning === undefined), JSON.stringify(r3));

// `shadows` as a CSS string also wins → warning.
const r4 = parseAndExecute(canvas.root, `
s=I("document", { type: "frame", shadows: "0 1px 2px rgba(0,0,0,0.2)" })
U(s, { shadow: "0 4px 12px rgba(0,0,0,0.3)" })
`, canvas);
check('string-form shadows → warning', typeof r4[1].warning === 'string', JSON.stringify(r4[1]));

// I setting both in one op → warning on the insert itself.
const r5 = parseAndExecute(canvas.root, `
both=I("document", { type: "frame", shadow: "0 1px 2px #0002", shadows: [{ "x": 0, "y": 2, "blur": 4, "color": "#0003" }] })
`, canvas);
check('I with both forms → warning', typeof r5[0].warning === 'string', JSON.stringify(r5[0]));

// C copying a shadows node with a `shadow` override → warning.
const r6 = parseAndExecute(canvas.root, `
src=I("document", { type: "frame", shadows: [{ "x": 0, "y": 1, "blur": 2, "color": "#0002" }] })
copy=C(src, "document", { shadow: "0 4px 8px #0003" })
`, canvas);
check('C override shadow onto shadows source → warning', typeof r6[1].warning === 'string', JSON.stringify(r6[1]));

// R replacing with only `shadow` → the old shadows are gone, so no warning.
const r7 = parseAndExecute(canvas.root, `
victim=I("document", { type: "frame", shadows: [{ "x": 0, "y": 1, "blur": 2, "color": "#0002" }] })
fresh=R(victim, { type: "frame", shadow: "0 1px 2px #0002" })
`, canvas);
check('R with shadow only → no warning (shadows replaced away)', r7[1].warning === undefined, JSON.stringify(r7[1]));

// The helper drives replace_matching_properties' warning too.
const c2 = createCanvas('Bulk Shadow Test');
parseAndExecute(c2.root, `
a=I("document", { type: "frame", width: 100, shadows: [{ "x": 0, "y": 1, "blur": 2, "color": "#0002" }] })
b=I("document", { type: "frame", width: 100 })
`, c2);
const set = { shadow: '0 4px 8px #0003' } as Partial<SceneNode>;
const matched = replaceMatchingProperties(c2.root, { width: 100 }, set);
const warned = matched.filter((n) => ignoredShadowWarning(n, set as Record<string, unknown>));
check('bulk set: only the shadows node warns', matched.length === 2 && warned.length === 1, `matched=${matched.length} warned=${warned.length}`);

console.log(allPass ? '\nAll shadow-warning tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
