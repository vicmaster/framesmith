import '../env.js';
// Phase 32 slice C (FR-C1 to FR-C4; contracts M1 to M6): a `$ref` that no
// token defines, or that names the wrong kind of token, is an `unknown-token`
// warning; an unambiguous misspelling on a stored node carries a rename fix;
// copy is never resolved; token usage counts only refs that resolve. Every
// asserted pass has a twin that must fail.
//
// Usage: npx tsx test/unit/test-unknown-token.ts

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { renderToHtml } from '../../src/renderer.js';
import { evaluateCanvas, type EvaluationIssue } from '../../src/evaluate.js';
import { generateSpaceScale } from '../../src/scales.js';
import { createProject, createWorkspace, setWorkspaceDesignSystem } from '../../src/workspaces.js';
import type { Canvas, DesignVariables, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const SYSTEM: DesignVariables = {
  colors: { 'bg-surface': '#FFFFFF', 'text-primary': '#111827', accent: '#2563EB' },
  spacing: generateSpaceScale(16),
  typography: { body: { fontSize: 16 } },
  elevation: { md: [{ x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.1)' }] },
  state: { hover: 0.08 },
};

function canvasWith(children: SceneNode[], variables: DesignVariables = SYSTEM): Canvas {
  const canvas = createCanvas('unknown token');
  canvas.variables = structuredClone(variables);
  canvas.root.children = children;
  return canvas;
}

async function findings(canvas: Canvas): Promise<EvaluationIssue[]> {
  const ev = await evaluateCanvas(canvas, { mode: 'fast', categories: ['structure'] });
  return ev.issues.filter((i) => i.rule === 'unknown-token');
}

const frame = (id: string, props: Partial<SceneNode>): SceneNode => ({ id, type: 'frame', name: id, ...props } as SceneNode);
const about = (fs: EvaluationIssue[], text: string) => fs.filter((f) => f.message.includes(text));

// ── FR-C1: unknown refs, candidates and the fix ──────────────────────────────
{
  const fs = await findings(canvasWith([frame('a', { gap: '$space-mdd' }), frame('b', { gap: '$space-md' })]));
  const [mdd] = about(fs, '$space-mdd');
  check('gap "$space-mdd" warns', !!mdd && mdd.severity === 'warning' && mdd.category === 'structure' && mdd.nodeId === 'a');
  check('...and autofixes to $space-md', mdd?.fix?.op === 'U("a", { gap: "$space-md" })', mdd?.fix?.op);
  check('twin: gap "$space-md" is silent', fs.length === 1, fs.map((f) => f.message).join(' | '));
}
{
  const [xxs] = await findings(canvasWith([frame('a', { gap: '$space-xxs' })]));
  check('gap "$space-xxs" warns with no fix', !!xxs && !xxs.fix);
  check('...naming space-2xs, space-3xs and space-xs', ['$space-2xs', '$space-3xs', '$space-xs'].every((n) => xxs?.suggestion?.includes(`"${n}"`)), xxs?.suggestion);
}
{
  const [surf] = await findings(canvasWith([frame('a', { fill: '$bg-surfce' })]));
  check('fill "$bg-surfce" autofixes to $bg-surface', surf?.fix?.op === 'U("a", { fill: "$bg-surface" })', surf?.fix?.op);
}
{
  const fs = await findings(canvasWith([frame('a', { shadow: '$elevation.md' }), frame('b', { shadow: '$elevation.mdd' })]));
  check('a defined $elevation.md is silent, $elevation.mdd warns', fs.length === 1 && fs[0].nodeId === 'b', fs.map((f) => f.message).join(' | '));
}
{
  const fs = await findings(canvasWith([frame('a', { fill: '$success-tint' }), frame('b', { fill: '$success-tnt' })]));
  check('$success-tint with no such token is silent (it derives); $success-tnt warns', fs.length === 1 && fs[0].nodeId === 'b', fs.map((f) => f.message).join(' | '));
}
{
  const vars = structuredClone(SYSTEM);
  vars.dark = { colors: { 'night-only': '#000000' } };
  const fs = await findings(canvasWith([frame('a', { fill: '$night-only' })], vars));
  check('a token defined only in the dark layer warns for light, with no fix', fs.length === 1 && /only in the dark layer/.test(fs[0].message) && !fs[0].fix, fs.map((f) => f.message).join(' | '));
  vars.colors!['night-only'] = '#FFFFFF';
  check('twin: defined in the base too, it is silent', (await findings(canvasWith([frame('a', { fill: '$night-only' })], vars))).length === 0);
}

// ── FR-C2 and M3, M4: kinds ───────────────────────────────────────────────────
{
  const fs = await findings(canvasWith([
    frame('fill-body', { fill: '$body' }),
    frame('gap-accent', { gap: '$accent' }),
    frame('gap-body', { gap: '$body' }),
    { id: 'family', type: 'text', name: 'family', content: 'x', fontFamily: '$body' } as SceneNode,
    { id: 'size', type: 'text', name: 'size', content: 'x', fontSize: '$body' } as SceneNode,
    frame('dotted-color', { fill: '$colors.accent' }),
    frame('dotted-number', { gap: '$spacing.space-md' }),
    frame('dotted-state', { opacity: '$state.hover' } as unknown as Partial<SceneNode>),
    frame('dotted-object', { gap: '$typography.body' }),
  ]));
  const on = (id: string) => fs.filter((f) => f.nodeId === id);
  check('fill "$body" warns naming the kind it got', /typography token, not a color/.test(on('fill-body')[0]?.message ?? ''), on('fill-body')[0]?.message);
  check('gap "$accent" warns', /color token, not a spacing/.test(on('gap-accent')[0]?.message ?? ''));
  check('gap "$body" warns (a typography ref is valid only on fontSize)', on('gap-body').length === 1);
  check('fontFamily "$body" warns that the prop takes no token', /fontFamily takes no token/.test(on('family')[0]?.message ?? ''));
  check('twin: fontSize "$body" is silent', on('size').length === 0);
  check('dotted refs into colours, spacing and state are their kinds (silent)', ['dotted-color', 'dotted-number', 'dotted-state'].every((id) => on(id).length === 0), fs.map((f) => f.message).join(' | '));
  check('a dotted ref to a whole typography token warns', on('dotted-object').length === 1);
  check('wrong-kind findings carry no fix', fs.every((f) => !f.fix));
}

// ── M2: nested refs; M5: the fix's reach ──────────────────────────────────────
{
  const fs = await findings(canvasWith([
    frame('pad', { padding: ['$space-mdd', '$space-lgg'] }),
    frame('border', { borderTop: { width: 1, color: '$accnt' } }),
    { id: 'chart', type: 'chart', name: 'chart', kind: 'line', series: [{ values: [1, 2], stroke: '$accnt' }] } as unknown as SceneNode,
    frame('radius', { cornerRadius: ['$radius-mdd', 0, 0, 0] }),
  ]));
  const pad = fs.filter((f) => f.nodeId === 'pad');
  const op = 'U("pad", { padding: ["$space-md","$space-lg"] })';
  check('two typos in one padding array: two findings carrying one op that renames both', pad.length === 2 && pad.every((f) => f.fix?.op === op), pad.map((f) => f.fix?.op).join(' | '));
  const border = fs.find((f) => f.nodeId === 'border');
  check('a borderTop.color typo rewrites the whole object', border?.fix?.op === 'U("border", { borderTop: {"width":1,"color":"$accent"} })', border?.fix?.op);
  const chart = fs.find((f) => f.nodeId === 'chart');
  check('a series[].stroke typo warns with no fix (the U parser cannot round-trip it)', !!chart && /series\[0\]\.stroke/.test(chart.message) && !chart.fix, chart?.message);
  check('a cornerRadius entry with no radius tokens warns with no candidates', fs.some((f) => f.nodeId === 'radius' && !f.fix));

  // The ops apply: both renames land.
  const canvas = canvasWith([frame('pad', { padding: ['$space-mdd', '$space-lgg'] })]);
  const [first] = await findings(canvas);
  parseAndExecute(canvas.root, first.fix!.op, canvas);
  parseAndExecute(canvas.root, first.fix!.op, canvas);
  const after = canvas.root.children![0].padding;
  check('applying the op twice leaves both renames', JSON.stringify(after) === '["$space-md","$space-lg"]', JSON.stringify(after));
  check('...and the canvas is clean', (await findings(canvas)).length === 0);
}
{
  const ladder: DesignVariables = { ...SYSTEM, spacing: { 'space-md': 16 } };
  const [lg] = await findings(canvasWith([frame('a', { gap: '$space-lg' })], ladder));
  check('$space-lg on a ladder with only space-md warns with no fix (a different size)', !!lg && !lg.fix);
  const [md] = await findings(canvasWith([frame('a', { gap: '$spce-md' })], ladder));
  check('twin: $spce-md, the same rung misspelt, is fixed', md?.fix?.op === 'U("a", { gap: "$space-md" })', md?.fix?.op);
}

// ── M6: one finding per origin; components and overrides ──────────────────────
{
  const canvas = canvasWith([]);
  const [page] = parseAndExecute(canvas.root, 'page=I("document", {type: "frame", name: "page", layout: "vertical"})', canvas);
  const [card] = parseAndExecute(canvas.root, 'card=I("document", {type: "component", name: "Card", layout: "vertical", fill: "$bg-surfce"})', canvas);
  parseAndExecute(canvas.root, `t=I("${card.nodeId}", {type: "frame", name: "inner", gap: "$space-mdd"})`, canvas);
  parseAndExecute(canvas.root, `
a=I("${page.nodeId}", {type: "instance", name: "card-a", componentId: "${card.nodeId}"})
b=I("${page.nodeId}", {type: "instance", name: "card-b", componentId: "${card.nodeId}", overrides: {"inner": {"gap": "$space-lgg"}}})
`, canvas);
  const fs = await findings(canvas);
  const inner = about(fs, '$space-mdd');
  check('a typo inside a component used by two instances warns once', inner.length === 1, fs.map((f) => f.message).join(' | '));
  check('...on the instance, naming the inner node, with no fix', !!inner[0] && !!inner[0].innerNodeId && inner[0].innerNodeId.includes('/') && !inner[0].fix);
  check('a typo on the component root, seen through two instances, warns once with no fix', about(fs, '$bg-surfce').length === 1 && !about(fs, '$bg-surfce')[0].fix);
  const ovr = about(fs, '$space-lgg');
  check('an override typo warns once, no fix, and names the override', ovr.length === 1 && !ovr[0].fix && /override/.test(ovr[0].suggestion ?? ''));
}
{
  const canvas = canvasWith([frame('a', { gap: '$space-md' })]);
  parseAndExecute(canvas.root, 'card=I("document", {type: "component", name: "Unused card", gap: "$space-mdd"})', canvas);
  const fs = await findings(canvas);
  check('a typo in a component no instance uses warns and names it', fs.length === 1 && /Unused card/.test(fs[0].message) && !fs[0].fix, fs.map((f) => f.message).join(' | '));
}

// ── Nodes with no id (inline children of a batch_design insert) ─────────────
{
  const canvas = canvasWith([]);
  parseAndExecute(canvas.root, 'box=I("document", {type: "frame", name: "box", children: [{type: "text", content: "x", color: "$nope"}, {type: "icon", icon: "no-such-icon-xyz"}]})', canvas);
  const box = canvas.root.children![0].id;
  let crashed = '';
  let ev: Awaited<ReturnType<typeof evaluateCanvas>> | undefined;
  try { ev = await evaluateCanvas(canvas, { mode: 'fast', categories: ['structure'] }); } catch (e) { crashed = (e as Error).message; }
  check('an id-less inline child does not crash evaluate', !crashed, crashed);
  const token = ev?.issues.find((i) => i.rule === 'unknown-token');
  check('...its unknown token is reported on its nearest ancestor with an id, with no fix', token?.nodeId === box && !token.fix, token?.nodeId);
  const icon = ev?.issues.find((i) => /Unknown icon/.test(i.message));
  check('...and so is its unknown icon, with no fix (an op would rewrite the parent)', icon?.nodeId === box && !icon.fix, icon?.nodeId);
}

// ── FR-C3: copy is never resolved ─────────────────────────────────────────────
{
  const canvas = canvasWith([
    { id: 't1', type: 'text', name: 't1', content: '$body' } as SceneNode,
    { id: 't2', type: 'text', name: 't2', content: '$49' } as SceneNode,
    { id: 'd', type: 'chart', name: 'd', kind: 'donut', segments: [{ value: 1, color: '#2563EB' }], centerValue: '$1.2M', centerLabel: '$ revenue' } as unknown as SceneNode,
  ]);
  let html = '';
  let crashed = false;
  try { html = renderToHtml(canvas.root, 400, 300, canvas); } catch { crashed = true; }
  check('content "$body" renders the string with no crash', !crashed && html.includes('$body'));
  check('content "$49" renders literally', html.includes('$49'));
  check('copy raises no unknown-token finding', (await findings(canvas)).length === 0);
  const twin = canvasWith([{ id: 't1', type: 'text', name: 't1', content: 'x', color: '$49' } as SceneNode]);
  check('twin: the same "$49" on a style prop warns', (await findings(twin)).length === 1);
}

// ── FR-C4: token usage counts real tokens ─────────────────────────────────────
{
  const typos = canvasWith([frame('a', { gap: '$space-mdd', fill: '$bg-surfce' })]);
  const ev = await evaluateCanvas(typos, { mode: 'fast', categories: ['structure'] });
  check('a canvas whose only refs are typos reports 0% token usage', ev.stats.tokenUsagePercent === 0, String(ev.stats.tokenUsagePercent));
  const real = canvasWith([frame('a', { gap: '$space-md', fill: '$bg-surface' })]);
  check('twin: real refs count', (await evaluateCanvas(real, { mode: 'fast', categories: ['structure'] })).stats.tokenUsagePercent > 0);

  const ws = createWorkspace('inherits');
  setWorkspaceDesignSystem(ws.id, SYSTEM);
  const project = createProject(ws.id, 'p')!;
  const inherits = createCanvas('inherits', project.id);
  inherits.root.children = [frame('a', { gap: '$space-md', fill: '$bg-surface', stroke: '#000000', layout: 'vertical' })];
  const iev = await evaluateCanvas(inherits, { mode: 'fast', categories: ['structure'] });
  check('a canvas that inherits every token reports its real usage', iev.stats.tokenUsagePercent > 0, String(iev.stats.tokenUsagePercent));
  check('...and its refs raise no unknown-token finding', !iev.issues.some((i) => i.rule === 'unknown-token'));
}

if (!allPass) {
  console.log('\nSOME CHECKS FAILED');
  process.exit(1);
}
console.log('\nAll checks passed.');
process.exit(0);
