// T9 test for Phase 11 Slice C: the diversification signal.
// Pure-function assertions for computeDiversificationHint, plus an integration
// check of the read+slice+compute composition the canvas_create / list_structures
// handlers run (last N = 5, newest first).
//
// Usage: npx tsx test-diversification.ts
import './test-env.js'; // isolate persistence — MUST be first
import { computeDiversificationHint } from './src/structures.js';
import { appendBuildLog, readBuildLog } from './src/repo-store.js';
import type { BuildLogEntry, StructureAxes } from './src/types.js';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
};

const axes = (
  heroTreatment: StructureAxes['heroTreatment'],
  density: StructureAxes['density'],
  rhythm: StructureAxes['rhythm'],
  alignment: StructureAxes['alignment'],
): StructureAxes => ({ heroTreatment, density, rhythm, alignment });

const entry = (canvasId: string, a?: StructureAxes): BuildLogEntry => ({
  canvasId,
  canvasName: canvasId,
  at: new Date().toISOString(),
  ...(a ? { axes: a } : {}),
});

// ── empty history ────────────────────────────────────────────────────────────
console.log('empty history → open hint, nothing repeated');
const h0 = computeDiversificationHint([]);
check(h0.repeatedAxes.length === 0, 'no repeated axes');
check(/no recent structured/i.test(h0.suggestion), 'suggestion invites picking any structure');
check(h0.recent.length === 0, 'recent passes through');

// ── single structured entry → nothing repeats yet ─────────────────────────────
console.log('single entry → not enough to repeat');
const h1 = computeDiversificationHint([entry('c1', axes('marquee', 'airy', 'uniform', 'centered'))]);
check(h1.repeatedAxes.length === 0, 'one canvas cannot repeat an axis');
check(/already vary|keep the variety/i.test(h1.suggestion), 'suggestion does not falsely claim repetition');

// ── two identical → all four axes flagged ─────────────────────────────────────
console.log('two identical canvases → all four axes converge');
const same = axes('marquee', 'airy', 'uniform', 'centered');
const h2 = computeDiversificationHint([entry('c1', same), entry('c2', same)]);
check(h2.repeatedAxes.length === 4, `all 4 axes repeated (got ${h2.repeatedAxes.length})`);
check(h2.suggestion.includes('density=airy') && h2.suggestion.includes('heroTreatment=marquee'), 'suggestion names the repeated values');

// ── differ on one axis → that axis drops out ──────────────────────────────────
console.log('two canvases differing only on density → density not flagged');
const h3 = computeDiversificationHint([
  entry('c1', axes('marquee', 'airy', 'uniform', 'centered')),
  entry('c2', axes('marquee', 'dense', 'uniform', 'centered')),
]);
check(!h3.repeatedAxes.includes('density'), 'density is not a repeated axis');
check(h3.repeatedAxes.includes('heroTreatment') && h3.repeatedAxes.includes('rhythm') && h3.repeatedAxes.includes('alignment'), 'the three shared axes are flagged');

// ── preset-only (no axes) entries are ignored ─────────────────────────────────
console.log('entries without axes (preset-only / hand-built) are ignored');
const h4 = computeDiversificationHint([entry('c1'), entry('c2')]);
check(h4.repeatedAxes.length === 0 && /no recent structured/i.test(h4.suggestion), 'all-axis-less history reads as empty');
const h5 = computeDiversificationHint([entry('c1', same), entry('c2', same), entry('c3')]);
check(h5.repeatedAxes.length === 4, 'axis-less entry does not dilute the structured tally');

// ── strict majority — a minority lean is NOT flagged, a majority is ───────────
console.log('strict majority — 2/5 (minority) not flagged; 3/5 and 4/5 (majority) flagged');
const five = [
  entry('a', axes('marquee', 'airy', 'uniform', 'left')),
  entry('b', axes('marquee', 'dense', 'uniform', 'centered')),
  entry('c', axes('split', 'airy', 'uniform', 'left')),
  entry('d', axes('stat-led', 'dense', 'asymmetric', 'split')),
  entry('e', axes('editorial', 'balanced', 'uniform', 'left')),
];
// heroTreatment: marquee 2/5 → minority; density: airy 2 / dense 2 → minority;
// rhythm: uniform 4/5 → majority; alignment: left 3/5 → majority.
const hb = computeDiversificationHint(five);
check(!hb.repeatedAxes.includes('heroTreatment'), 'heroTreatment 2/5 (minority) is NOT flagged');
check(!hb.repeatedAxes.includes('density'), 'density 2/5 (minority) is NOT flagged');
check(hb.repeatedAxes.includes('rhythm'), 'rhythm 4/5 (majority) is flagged');
check(hb.repeatedAxes.includes('alignment'), 'alignment 3/5 (majority) is flagged');

// ── integration: read + slice(last 5) + reverse (newest first), the cap ───────
console.log('integration — handler composition caps at last 5, newest first');
const pid = 'proj-diverse';
// 7 entries: density=airy on all (always repeated); heroTreatment editorial only on
// the two OLDEST (c1,c2) + newest (c7), distinct across the last 5 → editorial must
// NOT be flagged if the last-5 cap holds (it would be, if c1/c2 leaked in).
appendBuildLog(pid, entry('c1', axes('editorial', 'airy', 'uniform', 'left')));
appendBuildLog(pid, entry('c2', axes('editorial', 'airy', 'uniform', 'left')));
appendBuildLog(pid, entry('c3', axes('marquee', 'airy', 'uniform', 'left')));
appendBuildLog(pid, entry('c4', axes('split', 'airy', 'uniform', 'left')));
appendBuildLog(pid, entry('c5', axes('stat-led', 'airy', 'uniform', 'left')));
appendBuildLog(pid, entry('c6', axes('none', 'airy', 'uniform', 'left')));
appendBuildLog(pid, entry('c7', axes('editorial', 'airy', 'uniform', 'left')));

const recent = readBuildLog(pid).slice(-5).reverse();
const hi = computeDiversificationHint(recent);
check(recent.length === 5, `considers exactly 5 entries (got ${recent.length})`);
check(recent[0].canvasId === 'c7', 'newest entry is first');
check(hi.repeatedAxes.includes('density'), 'density (airy on every recent canvas) is flagged');
check(!hi.repeatedAxes.includes('heroTreatment'), 'heroTreatment NOT flagged — last-5 values are distinct (cap holds)');

console.log(failures === 0 ? '\nT9 DIVERSIFICATION TEST PASSED ✅' : `\nT9 DIVERSIFICATION TEST FAILED ✗ (${failures})`);
process.exit(failures === 0 ? 0 : 1);
