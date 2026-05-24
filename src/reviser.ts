// Phase 13: the "reviser" half of the closed critique loop. Given a rendered
// screenshot, a pruned scene graph, and the failing rubric axes, it asks an LLM
// for a targeted `batch_design` op script that raises those axes. Pluggable per
// provider via a `revisers` table — mirrors `llm-judge.ts` exactly so a third
// provider is a one-line addition. Returns RAW ops text; the caller validates
// and executes it through the existing `parseAndExecute` (no new op engine).

import { type Provider, type FailingAxis, pickProvider, LLMJudgeUnavailableError } from './llm-judge.js';

export interface ReviseArgs {
  screenshotBase64: string;
  /** Pruned scene-graph JSON: node ids / types / names / key props only (no
   * inline assets) — enough for the model to reference real ids cheaply. */
  sceneGraph: string;
  failingAxes: FailingAxis[];
  suggestions: string[];
}

export type Reviser = (args: ReviseArgs) => Promise<string>;

const SYSTEM_PROMPT = `You revise a web design by emitting a batch_design op script. You are given: a screenshot of the current render, the scene-graph JSON (node ids, types, names, key props), the failing rubric axes (each with a rationale), and suggestions.

Return ONLY a batch_design op script — newline-separated ops, no prose, no markdown fences. Ops:
  U("id", { prop: value, ... })       update node properties
  I("parentId", { type, ... })        insert a child
  D("id")                             delete a node
  M("id", "newParentId", index)       move a node

Rules:
- Reference ONLY real node ids present in the scene-graph JSON.
- Make MINIMAL, targeted edits that raise the failing axes — do not rewrite the whole design.
- hierarchy: adjust fontSize / fontWeight / spacing / order to create a clear focal path.
- execution: align siblings, snap spacing to a scale, fix contrast.
- specificity / variety: vary layout, avoid the default centered-hero shape.
- restraint: remove gratuitous gradients / colored glows / default-purple accents / fake window chrome.
Output the ops only.`;

function buildUserPrompt(args: ReviseArgs): string {
  const axes = args.failingAxes.map((a) => `- ${a.axis} (${a.score}/5): ${a.rationale}`).join('\n');
  const suggestions = args.suggestions.length ? `\nSuggestions:\n${args.suggestions.map((s) => `- ${s}`).join('\n')}` : '';
  return `Failing axes:\n${axes}${suggestions}\n\nScene graph:\n${args.sceneGraph}\n\nReturn the batch_design ops only.`;
}

// Strip markdown fences in case the model wrapped the ops despite the prompt.
export function stripOpsFences(text: string): string {
  return text.replace(/^\s*```(?:[a-z]*)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

export async function reviseCanvas(args: ReviseArgs, providerOverride?: Provider): Promise<string> {
  const provider = providerOverride ?? pickProvider();
  if (!provider) {
    throw new LLMJudgeUnavailableError(
      'No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (or FRAMESMITH_LLM_PROVIDER=anthropic|openai to pick one explicitly).',
    );
  }
  return revisers[provider](args);
}

// ---- Provider adapters ----

async function reviseWithAnthropic(args: ReviseArgs): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const model = process.env.FRAMESMITH_LLM_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const response = await client.messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: args.screenshotBase64 } },
          { type: 'text', text: buildUserPrompt(args) },
        ],
      },
    ],
  });
  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return stripOpsFences(text);
}

async function reviseWithOpenAI(args: ReviseArgs): Promise<string> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI();
  const model = process.env.FRAMESMITH_LLM_OPENAI_MODEL ?? 'gpt-4.1';
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserPrompt(args) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${args.screenshotBase64}` } },
        ],
      },
    ],
  });
  return stripOpsFences(response.choices[0]?.message?.content ?? '');
}

export const revisers: Record<Provider, Reviser> = {
  anthropic: reviseWithAnthropic,
  openai: reviseWithOpenAI,
};
