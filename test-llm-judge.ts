import './test-env.js';
// Smoke for the Phase 13 rubric judge. Exercises parseRubric + withVerdict +
// provider-selection + the dispatch path through `judges` without hitting any
// real API. The MCP tool wiring in src/index.ts uses the same `judgeCanvas`
// entry, so this covers the orchestration there too.
//
// Usage: npx tsx test-llm-judge.ts

import {
  judges, judgeCanvas, parseRubric, withVerdict, pickProvider,
  RUBRIC_AXES, type Rubric,
} from './src/llm-judge.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const fullRubric = (scores: Partial<Record<string, number>>): Rubric => {
  const r = {} as Rubric;
  for (const a of RUBRIC_AXES) r[a] = { score: scores[a] ?? 4, rationale: `${a} note` };
  return r;
};

// ---- 1. parseRubric: well-formed rubric JSON --------------------------------
{
  const parsed = parseRubric(JSON.stringify({
    rubric: {
      hierarchy: { score: 4, rationale: 'clear focal order' },
      execution: { score: 4, rationale: 'tidy alignment' },
      specificity: { score: 4, rationale: 'feels purposeful' },
      restraint: { score: 4, rationale: 'flat, no glow' },
      variety: { score: 4, rationale: 'not a default hero' },
    },
    summary: 'Solid, considered layout.',
    suggestions: ['tighten the footer'],
  }));
  check('parse: all 5 axes present', RUBRIC_AXES.every((a) => parsed.rubric[a]?.score === 4));
  check('parse: derived score = round(mean/5*100)', parsed.score === 80, `got ${parsed.score}`);
  check('parse: summary', parsed.summary.startsWith('Solid'));
  check('parse: suggestions array', parsed.suggestions.length === 1);
}

// ---- 2. parseRubric: code-fenced output ------------------------------------
{
  const wrapped = '```json\n' + JSON.stringify({ rubric: { hierarchy: { score: 3, rationale: 'm' } }, summary: 'mid', suggestions: [] }) + '\n```';
  const parsed = parseRubric(wrapped);
  check('parse: strips ```json fences', parsed.summary === 'mid' && parsed.rubric.hierarchy.score === 3);
}

// ---- 3. parseRubric: clamping + missing-axis default -----------------------
{
  const parsed = parseRubric(JSON.stringify({ rubric: { hierarchy: { score: 99 }, execution: { score: 0 } }, summary: '', suggestions: [] }));
  check('parse: clamps axis >5 to 5', parsed.rubric.hierarchy.score === 5);
  check('parse: clamps axis <1 to 1', parsed.rubric.execution.score === 1);
  check('parse: missing axis defaults to 3', parsed.rubric.variety.score === 3 && parsed.rubric.variety.rationale === '');
}

// ---- 4. parseRubric: bad input throws -------------------------------------
{
  let threw = false;
  try { parseRubric('not json at all'); } catch { threw = true; }
  check('parse: malformed input throws', threw);
}

// ---- 5. withVerdict: floor → needsRevision + failingAxes -------------------
{
  const base = { rubric: fullRubric({ variety: 2, specificity: 2 }), score: 64, summary: '', suggestions: [] };
  const v3 = withVerdict({ provider: 'anthropic', model: 'm', ...base }, 3);
  check('verdict: needsRevision when an axis < floor', v3.needsRevision === true);
  check('verdict: failingAxes names the low axes', v3.failingAxes.map((f) => f.axis).sort().join(',') === 'specificity,variety');
  const v2 = withVerdict({ provider: 'anthropic', model: 'm', ...base }, 2);
  check('verdict: lower floor clears it', v2.needsRevision === false && v2.failingAxes.length === 0);
  const vDefault = withVerdict({ provider: 'anthropic', model: 'm', rubric: fullRubric({}), score: 80, summary: '', suggestions: [] });
  check('verdict: all-4 rubric passes default floor 3', vDefault.needsRevision === false);
}

// ---- 6. pickProvider: env-var priority ------------------------------------
{
  const saved = { f: process.env.FRAMESMITH_LLM_PROVIDER, a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  delete process.env.FRAMESMITH_LLM_PROVIDER; delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
  check('pickProvider: no keys → null', pickProvider() === null);
  process.env.OPENAI_API_KEY = 'sk-test';
  check('pickProvider: openai key only → openai', pickProvider() === 'openai');
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  check('pickProvider: both keys → anthropic (priority)', pickProvider() === 'anthropic');
  process.env.FRAMESMITH_LLM_PROVIDER = 'openai';
  check('pickProvider: forced openai overrides priority', pickProvider() === 'openai');
  if (saved.f === undefined) delete process.env.FRAMESMITH_LLM_PROVIDER; else process.env.FRAMESMITH_LLM_PROVIDER = saved.f;
  if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.a;
  if (saved.o === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.o;
}

// ---- 7. judgeCanvas: dispatches via `judges` table; stub provider ----------
{
  const original = judges.anthropic;
  let stubCalled = false;
  judges.anthropic = async (png: string) => {
    stubCalled = true;
    return { provider: 'anthropic', model: 'stub-1', rubric: fullRubric({ variety: 2 }), score: 72, summary: `stubbed (png length ${png.length})`, suggestions: [] };
  };
  try {
    const result = await judgeCanvas('PNGBASE64DATA', { provider: 'anthropic', floor: 3 });
    check('dispatch: stubbed anthropic judge was called', stubCalled);
    check('dispatch: rubric flows through', result.model === 'stub-1' && result.score === 72);
    check('dispatch: verdict derived from rubric', result.needsRevision === true && result.failingAxes[0].axis === 'variety');
    check('dispatch: image is forwarded', result.summary.includes('png length 13'));
  } finally {
    judges.anthropic = original;
  }
}

// ---- 8. judgeCanvas: no provider + no keys → typed error ------------------
{
  const saved = { f: process.env.FRAMESMITH_LLM_PROVIDER, a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  delete process.env.FRAMESMITH_LLM_PROVIDER; delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
  let caught: unknown = null;
  try { await judgeCanvas('PNG'); } catch (e) { caught = e; }
  check('unavailable: throws LLMJudgeUnavailableError', (caught as Error)?.name === 'LLMJudgeUnavailableError');
  if (saved.f) process.env.FRAMESMITH_LLM_PROVIDER = saved.f;
  if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a;
  if (saved.o) process.env.OPENAI_API_KEY = saved.o;
}

process.exit(allPass ? 0 : 1);
