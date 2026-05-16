// Phase 6a: LLM-as-judge for `canvas_evaluate`. Takes a PNG of the rendered
// canvas, asks a vision model for a holistic visual-quality assessment, and
// returns a structured critique. Providers are pluggable via a single
// `judges` table — adding a third (Gemini, Groq, etc.) is a one-line
// addition once a Judge function is written.

export type Provider = 'anthropic' | 'openai';

export interface LLMJudgeResult {
  provider: Provider;
  model: string;
  score: number;          // 0–100 holistic visual-quality score
  summary: string;        // 1–2 sentences
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

export type Judge = (screenshotPngBase64: string) => Promise<LLMJudgeResult>;

const SYSTEM_PROMPT = `You are a senior visual designer reviewing a rendered web design. You will be shown a screenshot and asked to assess visual craft (hierarchy, contrast, spacing, typography, alignment, balance). Output STRICT JSON only — no prose before or after, no markdown fences — matching this schema:
{
  "score": number from 0 to 100,
  "summary": string (1–2 sentences),
  "strengths": string[] (up to 5 short bullets),
  "weaknesses": string[] (up to 5 short bullets),
  "suggestions": string[] (up to 5 concrete fixes)
}
Be specific. Reference what you see in the image. Do not assume context that isn't visible.`;

const USER_PROMPT = `Evaluate this rendered design. Return the JSON object only.`;

export function pickProvider(): Provider | null {
  const forced = process.env.CANVAS_LLM_PROVIDER;
  if (forced === 'anthropic' || forced === 'openai') return forced;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export class LLMJudgeUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'LLMJudgeUnavailableError';
  }
}

export async function judgeCanvas(screenshotPngBase64: string, providerOverride?: Provider): Promise<LLMJudgeResult> {
  const provider = providerOverride ?? pickProvider();
  if (!provider) {
    throw new LLMJudgeUnavailableError(
      'No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (or CANVAS_LLM_PROVIDER=anthropic|openai to pick one explicitly).',
    );
  }
  const judge = judges[provider];
  return judge(screenshotPngBase64);
}

// ---- Provider adapters ----

async function judgeWithAnthropic(screenshotPngBase64: string): Promise<LLMJudgeResult> {
  // Dynamic import keeps the SDK out of the critical path for users who never
  // call llm-mode evaluation (the rest of canvas-mcp works without it).
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const model = process.env.CANVAS_LLM_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotPngBase64 } },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const parsed = parseJudgement(text);
  return { provider: 'anthropic', model, ...parsed };
}

async function judgeWithOpenAI(screenshotPngBase64: string): Promise<LLMJudgeResult> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI();
  const model = process.env.CANVAS_LLM_OPENAI_MODEL ?? 'gpt-4.1';
  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: USER_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotPngBase64}` } },
        ],
      },
    ],
  });
  const text = response.choices[0]?.message?.content ?? '';
  const parsed = parseJudgement(text);
  return { provider: 'openai', model, ...parsed };
}

export const judges: Record<Provider, Judge> = {
  anthropic: judgeWithAnthropic,
  openai: judgeWithOpenAI,
};

// ---- Response parsing ----

export function parseJudgement(text: string): Omit<LLMJudgeResult, 'provider' | 'model'> {
  // Strip markdown fences in case the model wrapped the JSON despite the prompt.
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`LLM did not return valid JSON: ${(err as Error).message}. Raw output: ${text.slice(0, 200)}`);
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM response was not a JSON object.');
  }
  const rec = obj as Record<string, unknown>;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    score: typeof rec.score === 'number' ? Math.max(0, Math.min(100, Math.round(rec.score))) : 0,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    strengths: asStringArray(rec.strengths),
    weaknesses: asStringArray(rec.weaknesses),
    suggestions: asStringArray(rec.suggestions),
  };
}
