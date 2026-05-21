import './test-env.js';
// Smoke for Phase 6a llm-judge module. Exercises parse + provider-selection +
// the dispatch path through `judges` without hitting any real API. The MCP
// tool wiring in src/index.ts uses the same `judgeCanvas` entry, so this
// covers the orchestration there too.
//
// Usage: npx tsx test-llm-judge.ts

import { judges, judgeCanvas, parseJudgement, pickProvider, type Provider } from './src/llm-judge.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ---- 1. parseJudgement: well-formed JSON --------------------------------
{
  const parsed = parseJudgement(JSON.stringify({
    score: 87,
    summary: 'Clean layout with strong hierarchy.',
    strengths: ['clear typographic scale', 'good contrast'],
    weaknesses: ['stat tiles slightly misaligned'],
    suggestions: ['snap stat tiles to a shared baseline'],
  }));
  check('parse: score', parsed.score === 87);
  check('parse: summary', parsed.summary.startsWith('Clean layout'));
  check('parse: strengths array', parsed.strengths.length === 2);
  check('parse: weaknesses array', parsed.weaknesses.length === 1);
  check('parse: suggestions array', parsed.suggestions.length === 1);
}

// ---- 2. parseJudgement: code-fenced output (models love to do this) ----
{
  const wrapped = '```json\n' + JSON.stringify({ score: 50, summary: 'mid', strengths: [], weaknesses: [], suggestions: [] }) + '\n```';
  const parsed = parseJudgement(wrapped);
  check('parse: strips ```json fences', parsed.score === 50 && parsed.summary === 'mid');
}

// ---- 3. parseJudgement: score clamping to 0–100 ------------------------
{
  const overshoot = parseJudgement(JSON.stringify({ score: 250, summary: '', strengths: [], weaknesses: [], suggestions: [] }));
  check('parse: clamps score >100 to 100', overshoot.score === 100);
  const undershoot = parseJudgement(JSON.stringify({ score: -10, summary: '', strengths: [], weaknesses: [], suggestions: [] }));
  check('parse: clamps score <0 to 0', undershoot.score === 0);
}

// ---- 4. parseJudgement: bad input throws ------------------------------
{
  let threw = false;
  try { parseJudgement('not json at all'); } catch { threw = true; }
  check('parse: malformed input throws', threw);
}

// ---- 5. pickProvider: env-var priority ---------------------------------
{
  // Clean slate per case — process.env mutations are scoped to this test.
  const savedForced = process.env.CANVAS_LLM_PROVIDER;
  const savedAnth = process.env.ANTHROPIC_API_KEY;
  const savedOAI = process.env.OPENAI_API_KEY;

  delete process.env.CANVAS_LLM_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  check('pickProvider: no keys → null', pickProvider() === null);

  process.env.OPENAI_API_KEY = 'sk-test';
  check('pickProvider: openai key only → openai', pickProvider() === 'openai');

  process.env.ANTHROPIC_API_KEY = 'sk-test';
  check('pickProvider: both keys → anthropic (priority)', pickProvider() === 'anthropic');

  process.env.CANVAS_LLM_PROVIDER = 'openai';
  check('pickProvider: forced openai overrides priority', pickProvider() === 'openai');

  process.env.CANVAS_LLM_PROVIDER = savedForced ?? '';
  if (savedAnth === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedAnth;
  if (savedOAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedOAI;
  if (!savedForced) delete process.env.CANVAS_LLM_PROVIDER;
}

// ---- 6. judgeCanvas: dispatches via `judges` table; stub provider ------
{
  // Pluggability claim: swapping the table entry should redirect dispatch.
  // We replace `anthropic` with a stub, call judgeCanvas, restore.
  const original = judges.anthropic;
  let stubCalled = false;
  judges.anthropic = async (png: string) => {
    stubCalled = true;
    return {
      provider: 'anthropic',
      model: 'stub-1',
      score: 42,
      summary: `stubbed (png length ${png.length})`,
      strengths: [], weaknesses: [], suggestions: [],
    };
  };
  try {
    const result = await judgeCanvas('PNGBASE64DATA', 'anthropic');
    check('dispatch: stubbed anthropic judge was called', stubCalled);
    check('dispatch: result flows through', result.score === 42 && result.model === 'stub-1');
    check('dispatch: image is forwarded', result.summary.includes('png length 13'));
  } finally {
    judges.anthropic = original;
  }
}

// ---- 7. judgeCanvas: no provider + no keys → typed error --------------
{
  const savedForced = process.env.CANVAS_LLM_PROVIDER;
  const savedAnth = process.env.ANTHROPIC_API_KEY;
  const savedOAI = process.env.OPENAI_API_KEY;
  delete process.env.CANVAS_LLM_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;

  let caught: unknown = null;
  try { await judgeCanvas('PNG'); } catch (e) { caught = e; }
  check('unavailable: throws LLMJudgeUnavailableError', (caught as Error)?.name === 'LLMJudgeUnavailableError');

  if (savedForced) process.env.CANVAS_LLM_PROVIDER = savedForced;
  if (savedAnth) process.env.ANTHROPIC_API_KEY = savedAnth;
  if (savedOAI) process.env.OPENAI_API_KEY = savedOAI;
}

process.exit(allPass ? 0 : 1);