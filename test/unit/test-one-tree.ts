import '../env.js';
// Phase 32 slice B (FR-B1, FR-B2): the renderer and every rule read one tree,
// with instances expanded and then resolved. A disabled button inside an
// instance renders as it does outside one; a low-contrast text inside an
// instance is one error reported on the instance, with the inner node named
// and no fix; feedback on an inner node lands on the instance.
//
// Usage: npx tsx test/unit/test-one-tree.ts

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { renderToHtml } from '../../src/renderer.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { expandTree, storedId } from '../../src/expand.js';
import { addFeedback } from '../../src/feedback.js';
import type { Canvas, DesignVariables } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** A page holding one instance of a card (a button and a faint note) and,
 * beside it, the same button outside any component. */
function build(variables: DesignVariables, override: Record<string, unknown>) {
  const canvas = createCanvas('one tree');
  canvas.variables = variables;
  const ops = parseAndExecute(canvas.root, `
page=I("document", {type: "frame", name: "page", layout: "vertical", gap: 16, padding: 24, fill: "#FFFFFF", width: 800})
card=I("document", {type: "component", name: "Card", layout: "vertical", padding: 16, gap: 8, fill: "#FFFFFF"})
cta=I(card, {type: "button", name: "cta", label: "Save", variant: "primary"})
note=I(card, {type: "text", name: "note", content: "A faint note", color: "#EEEEEE", fontSize: 14})
`, canvas);
  const page = ops[0].nodeId!;
  const card = ops[1].nodeId!;
  const def = canvas.components[card];
  const childId = (name: string) => def.children!.find((c) => c.name === name)!.id;
  const [inst, outside] = parseAndExecute(canvas.root, `
inst=I("${page}", {type: "instance", name: "card-1", componentId: "${card}", overrides: ${JSON.stringify({ cta: override })}})
out=I("${page}", ${JSON.stringify({ type: 'button', name: 'outside', label: 'Save', variant: 'primary', ...override })})
`, canvas).map((r) => r.nodeId!);
  return { canvas, inst, outside, cta: childId('cta'), note: childId('note') };
}

/** The opening tag of the element a node id renders as, without the id. */
function tagOf(html: string, id: string): string {
  const at = html.indexOf(`data-node-id="${id}"`);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1).replace(` data-node-id="${id}"`, '');
}

const PLAIN: DesignVariables = { colors: { accent: '#0F766E', 'bg-surface': '#FFFFFF', 'text-primary': '#111111' } };
const STATE_TOKENS: DesignVariables = { ...PLAIN, state: { disabledContent: 0.38, disabledContainer: 0.12 } };

// ── FR-B1: a disabled button inside an instance renders as it does outside ──
for (const [label, vars] of [['without state tokens', PLAIN], ['with state tokens', STATE_TOKENS]] as const) {
  const { canvas, inst, outside, cta } = build(vars, { disabled: true });
  const html = renderToHtml(canvas.root, 800, 600, canvas);
  const inner = tagOf(html, `${inst}/${cta}`);
  const out = tagOf(html, outside);
  check(`disabled button inside an instance renders at all (${label})`, inner !== '' && out !== '');
  check(`…with the same markup and style as outside one (${label})`, inner === out, inner === out ? undefined : `\n  inside:  ${inner}\n  outside: ${out}`);
  check(`…in the design system's accent, not the fallback (${label})`, out.includes('#0F766E') && !inner.includes('#2563EB'), inner);
}

// The same render, expanded by the caller first, is byte-identical.
{
  const { canvas } = build(PLAIN, { disabled: true });
  const viaRenderer = renderToHtml(canvas.root, 800, 600, canvas);
  const viaHelper = renderToHtml(expandTree(canvas.root, canvas, canvas.variables).root, 800, 600, canvas);
  check('rendering a raw tree equals rendering the expanded, resolved tree', viaRenderer === viaHelper);
}

// Two instances of one component: distinct ids for the same child.
{
  const { canvas, inst, cta } = build(PLAIN, {});
  const page = canvas.root.children![0].id;
  const [second] = parseAndExecute(canvas.root, `I("${page}", {type: "instance", name: "card-2", componentId: "${(canvas.root.children![0].children![0] as { componentId?: string }).componentId}"})`, canvas).map((r) => r.nodeId!);
  const { root, owners } = expandTree(canvas.root, canvas);
  const ids: string[] = [];
  (function walk(n: typeof root) { ids.push(n.id); n.children?.forEach(walk); })(root);
  check('two instances give one child two distinct ids', ids.includes(`${inst}/${cta}`) && ids.includes(`${second}/${cta}`));
  check('ids are unique across the expanded tree', new Set(ids).size === ids.length);
  check('owners map each inner id to its instance', owners.get(`${inst}/${cta}`)?.id === inst && owners.get(`${second}/${cta}`)?.id === second);
  check('the instance root keeps its own id and is not owned', ids.includes(inst) && !owners.has(inst));
  check('storedId gives the instance for an inner id', storedId(`${inst}/${cta}`) === inst && storedId(inst) === inst);
}

// ── FR-B2: a finding inside an instance names it ────────────────────────────
{
  const { canvas, inst, note } = build(PLAIN, {});
  const result = await evaluateCanvas(canvas, { mode: 'fast' });
  const contrast = result.issues.filter((i) => i.category === 'color' && i.severity === 'error' && (i.innerNodeId === `${inst}/${note}` || i.nodeId === `${inst}/${note}`));
  check('faint text inside an instance is one contrast error', contrast.length === 1, JSON.stringify(result.issues.filter((i) => i.category === 'color')));
  const issue = contrast[0];
  check('…with nodeId the instance', issue?.nodeId === inst, issue?.nodeId);
  check('…innerNodeId the text\'s expanded id', issue?.innerNodeId === `${inst}/${note}`, issue?.innerNodeId);
  check('…naming the instance and its component', !!issue?.message.includes('instance "card-1" of component "Card"'), issue?.message);
  check('…and no fix', issue !== undefined && issue.fix === undefined);
  const fixOps = result.issues.flatMap((i) => [i.fix?.op, ...(i.fixes ?? []).map((f) => f.op)]).filter((op): op is string => !!op);
  check('no fix op names an expanded id (canvas_autofix stays applicable)', fixOps.every((op) => !op.includes(`${inst}/`)), fixOps.join(' | '));
  check('no finding keeps an expanded id as its nodeId', result.issues.every((i) => !i.nodeId.includes('/')));
}

// Without the instance, the same faint text outside is the same error, on itself.
{
  const canvas: Canvas = createCanvas('outside');
  parseAndExecute(canvas.root, `
page=I("document", {type: "frame", layout: "vertical", padding: 24, fill: "#FFFFFF", width: 800})
t=I(page, {type: "text", content: "A faint note", color: "#EEEEEE", fontSize: 14})
`, canvas);
  const result = await evaluateCanvas(canvas, { mode: 'fast' });
  const errors = result.issues.filter((i) => i.category === 'color' && i.severity === 'error');
  check('outside an instance the text is an error on itself, with no innerNodeId', errors.length === 1 && errors[0].innerNodeId === undefined);
}

// ── FR-B2: feedback on an inner node lands on the instance ──────────────────
{
  const { canvas, inst, note } = build(PLAIN, {});
  const entry = addFeedback(canvas, { nodeId: `${inst}/${note}`, comment: 'too faint' });
  check('feedback on an expanded id is stored on the instance', entry.nodeId === inst, entry.nodeId);
  check('…with the instance\'s snapshot', entry.node?.type === 'instance', JSON.stringify(entry.node));
  let threw = false;
  try { addFeedback(canvas, { nodeId: 'nope/x', comment: 'x' }); } catch { threw = true; }
  check('an expanded id whose instance does not exist still throws', threw);
}

console.log(allPass ? '\nAll one-tree checks passed.' : '\nSome one-tree checks FAILED.');
process.exit(allPass ? 0 : 1);
