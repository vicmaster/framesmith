// Phase 26 slice C — the flow critique: parsing contract, note anchoring,
// derived scoring, the stubbed judge path (no network, no Chrome), and the
// no-provider degradation. Mirrors the test-critique stubbing pattern:
// flowJudges is an exported mutable table.
//
// Usage: npx tsx test/unit/test-flow-critique.ts

import '../env.js';
import { parseFlowRubric, judgeFlow, flowJudges, FLOW_AXES, LLMJudgeUnavailableError, type FlowCritiqueResult } from '../../src/llm-judge.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const NAMES = ['Overview', 'Reports', 'Settings'];
const VALID = JSON.stringify({
  rubric: {
    'navigation-consistency': { score: 4, rationale: 'Sidebar identical on all three.' },
    'terminology-consistency': { score: 2, rationale: '"Members" on Overview becomes "Users" on Settings.' },
    'state-visibility': { score: 4, rationale: 'Counts update visibly.' },
    'hierarchy-consistency': { score: 5, rationale: 'Same heading system throughout.' },
  },
  summary: 'Coherent shell; terminology drifts.',
  screenNotes: [
    { screen: 'Settings', note: 'Rename "Users" to "Members" to match the rest of the flow.' },
    { screen: 'Atlantis', note: 'This screen does not exist.' },
    { screen: 'Reports', note: 'The filter row lacks an applied-state indicator.' },
  ],
});

// ── parsing contract ────────────────────────────────────────────────────────
{
  const r = parseFlowRubric(VALID, NAMES);
  check('all four flow axes parsed', FLOW_AXES.every((a) => r.rubric[a].score >= 1 && r.rubric[a].rationale.length > 0));
  check('score derived from the mean', r.score === Math.round(((4 + 2 + 4 + 5) / 4 / 5) * 100), String(r.score));
  check('notes naming unknown screens are dropped', r.screenNotes.length === 2 && r.screenNotes.every((n) => NAMES.includes(n.screen)), JSON.stringify(r.screenNotes));

  const fenced = '```json\n' + VALID + '\n```';
  check('markdown fences stripped', parseFlowRubric(fenced, NAMES).score === r.score);

  const sloppy = JSON.stringify({ rubric: { 'navigation-consistency': { score: 99 } }, summary: 7, screenNotes: 'nope' });
  const s = parseFlowRubric(sloppy, NAMES);
  check('scores clamped, missing axes default mid, junk coerced', s.rubric['navigation-consistency'].score === 5 && s.rubric['state-visibility'].score === 3 && s.summary === '' && s.screenNotes.length === 0);

  let err = '';
  try { parseFlowRubric('the flow looks nice!', NAMES); } catch (e) { err = (e as Error).message; }
  check('non-JSON throws with the raw excerpt', err.includes('valid JSON'), err.slice(0, 60));
}

// ── stubbed judge path ──────────────────────────────────────────────────────
{
  process.env.FRAMESMITH_LLM_PROVIDER = 'anthropic';
  const original = flowJudges.anthropic;
  let received: { name: string; png: string }[] = [];
  flowJudges.anthropic = async (screens) => {
    received = screens;
    return { provider: 'anthropic', model: 'stub', ...parseFlowRubric(VALID, screens.map((s) => s.name)) } as FlowCritiqueResult;
  };
  try {
    const result = await judgeFlow(NAMES.map((name) => ({ name, png: 'cGln' })));
    check('stubbed judge receives every screen in order', received.map((s) => s.name).join(',') === NAMES.join(','));
    check('result carries rubric + anchored notes', result.rubric['terminology-consistency'].score === 2 && result.screenNotes.length === 2);
  } finally {
    flowJudges.anthropic = original;
  }

  let err = '';
  try { await judgeFlow([{ name: 'only-one', png: 'x' }]); } catch (e) { err = (e as Error).message; }
  check('fewer than 2 screens rejected', err.includes('at least 2'), err);
}

// ── no-provider degradation ─────────────────────────────────────────────────
{
  const saved = { p: process.env.FRAMESMITH_LLM_PROVIDER, a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  delete process.env.FRAMESMITH_LLM_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    let caught: unknown;
    try { await judgeFlow(NAMES.map((name) => ({ name, png: 'x' }))); } catch (e) { caught = e; }
    check('no provider → LLMJudgeUnavailableError (the note-not-error contract lives in the handlers)', caught instanceof LLMJudgeUnavailableError, String(caught));
  } finally {
    if (saved.p) process.env.FRAMESMITH_LLM_PROVIDER = saved.p;
    if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.o) process.env.OPENAI_API_KEY = saved.o;
  }
}

console.log(allPass ? '\nAll flow-critique tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
