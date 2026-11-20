import '../env.js';
/**
 * Phase 29 slice B (#194) — design-system preservation.
 *
 * A canvas under a workspace design system resolves some tokens through
 * inheritance. `applyPresetTokens` deliberately does NOT clobber those: the
 * design system set them on purpose. But preservation used to be all-or-
 * nothing per token, and that produced a silent failure the checkout attempt
 * walked straight into — an inherited `body` carrying only a size shadowed the
 * generated role's whole spec, so `$body` kept the inherited 13px AND lost the
 * personality's font family. Nothing errored; the text just rendered in the
 * fallback stack.
 *
 * Run with: npx tsx test/unit/test-preservation.ts
 */
import { applyPresetTokens, resolveVariables } from '../../src/variables.js';
import { createCanvas } from '../../src/scene-graph.js';
import type { Canvas, DesignVariables, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** The generated `soft` language, trimmed to what these cases exercise. */
const GENERATED: Partial<DesignVariables> = {
  colors: { 'bg-surface': '#FFFFFF', border: '#D1D8D2', accent: '#317345' },
  typography: {
    body: { fontSize: 16, lineHeight: 1.5, fontFamily: 'Inter' },
    label: { fontSize: 13, lineHeight: 1.5, fontFamily: 'Inter', fontWeight: 500, letterSpacing: 0.25 },
    heading: { fontSize: 25, lineHeight: 1.35, fontFamily: 'Plus Jakarta Sans', fontWeight: 600 },
    title: { fontSize: 31, lineHeight: 1.2, fontFamily: 'Plus Jakarta Sans', fontWeight: 700 },
  },
};

/** framesmith's own workspace tokens, as they actually were during the
 * attempt: a bare-size `body`, and a near-black `border`. `heading` matches the
 * generated role exactly; `title` is fully specified but deliberately different. */
const INHERITED: DesignVariables = {
  colors: { border: '#2a241a', success: '#22c55e' },
  typography: {
    body: { fontSize: 13, lineHeight: 1.5 },
    heading: { fontSize: 25, lineHeight: 1.35, fontFamily: 'Plus Jakarta Sans', fontWeight: 600 },
    title: { fontSize: 28, lineHeight: 1.25, fontFamily: 'Georgia', fontWeight: 600 },
  },
};

const fresh = (): Canvas => createCanvas('preservation');

// ── FR-B1: a partial inherited token is MERGED, not swallowed ────────────────
{
  const canvas = fresh();
  const { preserved } = applyPresetTokens(canvas, GENERATED, INHERITED);
  const body = canvas.variables.typography?.['body'] as Record<string, unknown> | undefined;

  check('partial inherited body is written to the canvas as a merge', body !== undefined);
  check('inherited fontSize wins (the design system set it on purpose)', body?.fontSize === 13);
  check('generated fontFamily fills the gap — the regression that started this', body?.fontFamily === 'Inter');
  check('untouched inherited fields survive', body?.lineHeight === 1.5);

  const entry = preserved.find((p) => p.key === 'body');
  check('the merge is reported, not silent', entry !== undefined);
  check('report names the fields the preset contributed', entry?.filledFromPreset?.join(',') === 'fontFamily', entry?.filledFromPreset?.join(','));
}

// ── a COMPLETE inherited token is still pure inheritance ─────────────────────
{
  const canvas = fresh();
  const { preserved } = applyPresetTokens(canvas, GENERATED, INHERITED);

  // `title` is fully specified by inheritance and differs from the generated
  // role. There is nothing for the preset to contribute, so the merge must not
  // fire — this stays plain preservation, exactly as before slice B.
  check('a fully-specified inherited role is left to inheritance', canvas.variables.typography?.['title'] === undefined);
  const title = preserved.find((p) => p.key === 'title');
  check('...reported as a plain preservation, with no merge claimed', title !== undefined && title.filledFromPreset === undefined);

  // `heading` is IDENTICAL in both layers. Pre-existing behaviour (unchanged by
  // this slice) writes it through rather than preserving it — the value is the
  // same either way, so nothing about the rendered design differs.
  check('an identical inherited role is written through, not reported', canvas.variables.typography?.['heading'] !== undefined
    && preserved.find((p) => p.key === 'heading') === undefined);
}

// ── a role inheritance does not define at all is written whole ───────────────
{
  const canvas = fresh();
  applyPresetTokens(canvas, GENERATED, INHERITED);
  const label = canvas.variables.typography?.['label'] as Record<string, unknown> | undefined;
  check('a role absent from inheritance is written whole', label?.fontSize === 13 && label?.fontFamily === 'Inter' && label?.fontWeight === 500);
}

// ── colours: still preserved, still reported ─────────────────────────────────
{
  const canvas = fresh();
  const { preserved } = applyPresetTokens(canvas, GENERATED, INHERITED);
  check('an inherited colour is left to inheritance', canvas.variables.colors?.['border'] === undefined);
  const entry = preserved.find((p) => p.key === 'border');
  check('the kept and generated values are both reported', entry?.kept === '#2a241a' && entry?.preset === '#D1D8D2');
  check('a colour merge is never attempted (strings have no fields)', entry?.filledFromPreset === undefined);
  check('a colour inheritance does not define is written', canvas.variables.colors?.['accent'] === '#317345');
}

// ── an inherited STATUS colour is a conflict, not a footnote ─────────────────
{
  // Found by the Phase 29 acceptance re-run. The generator AA-tunes success /
  // warning / danger against its own surfaces and pairs the tint layer with
  // them, so an inherited `success` keeps pairing with the GENERATED
  // `success-tint` and fails contrast — while being reported as an ordinary
  // preservation an agent skims past. Status colours are owned vocabulary.
  const canvas = fresh();
  const inheritedStatus: DesignVariables = { colors: { success: '#22c55e' } };
  const generated: Partial<DesignVariables> = { colors: { success: '#007F38', 'success-tint': '#DAF8DF' } };
  const { preserved } = applyPresetTokens(canvas, generated, inheritedStatus);
  const entry = preserved.find((p) => p.key === 'success');
  check('an inherited status colour is preserved and reported', entry?.kept === '#22c55e' && entry?.preset === '#007F38');
  check('...while the tint it pairs with is written from the generated system', canvas.variables.colors?.['success-tint'] === '#DAF8DF');
}

// ── FR-B3: the opt-out writes the language whole ─────────────────────────────
{
  const canvas = fresh();
  const { preserved } = applyPresetTokens(canvas, GENERATED, INHERITED, { preserveInherited: false });
  check('preserveInherited:false reports nothing preserved', preserved.length === 0);
  check('...border takes the generated value', canvas.variables.colors?.['border'] === '#D1D8D2');
  const body = canvas.variables.typography?.['body'] as Record<string, unknown> | undefined;
  check('...body takes the generated spec entirely', body?.fontSize === 16 && body?.fontFamily === 'Inter');
}

// ── a token the canvas already sets itself is never treated as inherited ─────
{
  const canvas = fresh();
  canvas.variables.colors = { border: '#123456' };
  applyPresetTokens(canvas, GENERATED, INHERITED);
  check('an own-layer token is overwritten by the preset, not preserved', canvas.variables.colors?.['border'] === '#D1D8D2');
}

// ── the end-to-end symptom: $body resolves WITH the personality's face ───────
{
  const canvas = fresh();
  applyPresetTokens(canvas, GENERATED, INHERITED);
  const node: SceneNode = { id: 't', type: 'text', content: 'Body copy', fontSize: '$body' } as SceneNode;
  const resolved = resolveVariables(node, canvas.variables);
  check('a $body reference resolves to the inherited size', resolved.fontSize === 13);
  check('a $body reference resolves WITH the generated font family', resolved.fontFamily === 'Inter');
}

console.log(allPass ? '\nAll preservation tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
