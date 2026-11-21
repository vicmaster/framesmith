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

// ── Verify round 1: an override written inside a component, and a one-letter step ──
{
  const canvas = canvasWith([]);
  const [page] = parseAndExecute(canvas.root, 'page=I("document", {type: "frame", name: "page", layout: "vertical"})', canvas);
  const [inner] = parseAndExecute(canvas.root, 'inner=I("document", {type: "component", name: "Inner", layout: "vertical"})', canvas);
  parseAndExecute(canvas.root, `t=I("${inner.nodeId}", {type: "text", name: "title", content: "x", color: "$text-primary"})`, canvas);
  const [outer] = parseAndExecute(canvas.root, 'outer=I("document", {type: "component", name: "Outer", layout: "vertical"})', canvas);
  parseAndExecute(canvas.root, `ci=I("${outer.nodeId}", {type: "instance", name: "ci", componentId: "${inner.nodeId}", overrides: {"title": {"color": "$nope-in-def"}}})`, canvas);
  parseAndExecute(canvas.root, `
o1=I("${page.nodeId}", {type: "instance", name: "o1", componentId: "${outer.nodeId}"})
o2=I("${page.nodeId}", {type: "instance", name: "o2", componentId: "${outer.nodeId}"})
`, canvas);
  check('an override written inside a component, shown through two outer instances, warns once', about(await findings(canvas), '$nope-in-def').length === 1, String(about(await findings(canvas), '$nope-in-def').length));
  // Twin: overrides written on two stored instances are two places.
  const twin = canvasWith([]);
  const [tp] = parseAndExecute(twin.root, 'page=I("document", {type: "frame", name: "page", layout: "vertical"})', twin);
  const [tc] = parseAndExecute(twin.root, 'card=I("document", {type: "component", name: "Card", layout: "vertical"})', twin);
  parseAndExecute(twin.root, `t=I("${tc.nodeId}", {type: "text", name: "title", content: "x", color: "$text-primary"})`, twin);
  parseAndExecute(twin.root, `
a=I("${tp.nodeId}", {type: "instance", name: "a", componentId: "${tc.nodeId}", overrides: {"title": {"color": "$nope-own"}}})
b=I("${tp.nodeId}", {type: "instance", name: "b", componentId: "${tc.nodeId}", overrides: {"title": {"color": "$nope-own"}}})
`, twin);
  check('twin: the same typo in two stored instances\' own overrides is two findings', about(await findings(twin), '$nope-own').length === 2);
}
{
  // A lone letter is a rung of an s / m / l ladder, so it is never renamed
  // across: a missed fix is cheaper than a wrong size.
  const sml: DesignVariables = { ...SYSTEM, spacing: { 'space-md': 16 } };
  const [l] = await findings(canvasWith([frame('a', { gap: '$space-l' })], sml));
  check('$space-l on a ladder with only space-md is not renamed to it', !!l && !l.fix, l?.fix?.op);
  const [m] = await findings(canvasWith([frame('a', { gap: '$space-m' })], { ...SYSTEM, spacing: { 'space-l': 24 } }));
  check('$space-m on a ladder with only space-l is not renamed to it', !!m && !m.fix, m?.fix?.op);
  // Twins: real steps still never cross a rung.
  const [xl] = await findings(canvasWith([frame('a', { gap: '$space-2xl' })], { ...SYSTEM, spacing: { 'space-xl': 32 } }));
  check('twin: $space-2xl with only space-xl defined is not fixed (another rung)', !!xl && !xl.fix);
  const [xxs] = await findings(canvasWith([frame('a', { gap: '$space-xxs' })], { ...SYSTEM, spacing: { 'space-xs': 8 } }));
  check('twin: $space-xxs with only space-xs defined is not fixed (another rung)', !!xxs && !xxs.fix);
}
{
  const canvas = canvasWith([]);
  const [card] = parseAndExecute(canvas.root, 'card=I("document", {type: "component", name: "Card", children: [{type: "text", content: "x", color: "$nope-anon"}]})', canvas);
  parseAndExecute(canvas.root, `a=I("document", {type: "instance", name: "a", componentId: "${card.nodeId}"})`, canvas);
  const fs = await evaluateCanvas(canvas, { mode: 'fast', categories: ['structure'] });
  const ids = fs.issues.filter((i) => i.rule === 'unknown-token').map((i) => `${i.nodeId}|${i.innerNodeId ?? ''}`);
  const instId = canvas.root.children!.find((n) => n.name === 'a')?.id;
  check('an id-less node inside an instance is reported on the instance', fs.issues.some((i) => i.rule === 'unknown-token' && i.nodeId === instId && !i.fix), ids.join(', '));
  // Every rule keeps the instance for such a node (contrast too).
  const contrast = canvasWith([]);
  const [cc] = parseAndExecute(contrast.root, 'card=I("document", {type: "component", name: "Faint", fill: "#FFFFFF", children: [{type: "text", content: "faint words here", color: "#EEEEEE", fontSize: 12}]})', contrast);
  const [ci] = parseAndExecute(contrast.root, `a=I("document", {type: "instance", name: "a", componentId: "${cc.nodeId}"})`, contrast);
  const cev = await evaluateCanvas(contrast, { mode: 'fast', categories: ['color'] });
  const onInst = cev.issues.filter((i) => i.category === 'color' && i.severity === 'error' && i.nodeId === ci.nodeId);
  check('an id-less text inside an instance keeps its contrast error on the instance', onInst.length >= 1, cev.issues.map((i) => i.nodeId).join(', '));
}

// ── Verify round 1 (review): dotted derived names, aliases, messages ─────────────
{
  const fs = await findings(canvasWith([frame('a', { fill: '$colors.accent-tint' }), frame('b', { stroke: '$colors.danger' }), frame('c', { fill: '$colors.accnt-tint' })]));
  check('a dotted ref to a derived colour is valid ($colors.accent-tint, $colors.danger)', fs.every((f) => f.nodeId === 'c') && fs.length === 1, fs.map((f) => f.message).join(' | '));
}
{
  const vars: DesignVariables = { ...SYSTEM, colors: { ...SYSTEM.colors, brand: '$accent' } };
  const fs = await findings(canvasWith([frame('a', { fill: '$brand' }), frame('b', { fill: '$accent' })], vars));
  check('a token whose value is itself a ref warns (the resolver does not follow it)', fs.length === 1 && fs[0].nodeId === 'a' && /does not follow/.test(fs[0].message), fs.map((f) => f.message).join(' | '));
}
{
  const vars = structuredClone(SYSTEM);
  vars.dark = { elevation: { glow: [{ x: 0, y: 0, blur: 4, spread: 0, color: '#000' }] } };
  const [f] = await findings(canvasWith([frame('a', { shadow: '$elevation.glow' })], vars));
  check('a dark-only elevation names the elevation layer', /base elevation/.test(f?.suggestion ?? ''), f?.suggestion);
  const night = structuredClone(SYSTEM);
  night.dark = { colors: { night: '#000000' } };
  const [n] = await findings(canvasWith([frame('a', { fill: '$colors.night' })], night));
  check('a dark-only dotted colour names the bare token and the colors layer', n?.suggestion?.startsWith('Define "night" in the base colors') === true, n?.suggestion);
}
{
  const [f] = await findings(canvasWith([frame('a', { gap: '$space-mdd' })]));
  check('"Did you mean" lists only names within two edits', f?.suggestion === 'Did you mean "$space-md"?', f?.suggestion);
}

// ── Verify round 1 (mutation): edges of the fix, dedupe, tables, kill switch ──
{
  const md: DesignVariables = { ...SYSTEM, spacing: { 'space-md': 16 } };
  const [two] = await findings(canvasWith([frame('a', { gap: '$space-mxx' })], md));
  check('a typo two edits away is fixed', two?.fix?.op === 'U("a", { gap: "$space-md" })', two?.fix?.op);
  const [three] = await findings(canvasWith([frame('a', { gap: '$space-mxxx' })], md));
  check('twin: three edits away it names no candidate and has no fix', !!three && !three.fix && /Define it/.test(three.suggestion ?? ''), three?.suggestion);
  const tie: DesignVariables = { ...SYSTEM, spacing: { 'space-md': 16, 'space-me': 17 } };
  const [t] = await findings(canvasWith([frame('a', { gap: '$space-mx' })], tie));
  check('two names equally close: both named, no fix', !!t && !t.fix && /space-md/.test(t.suggestion ?? '') && /space-me/.test(t.suggestion ?? ''), t?.suggestion);
  const steps: Array<[string, Record<string, number>]> = [
    ['$space-4', { 'space-8': 32 }],
    ['$space-LG', { 'space-md': 16 }],
    ['$bg-surface-lg', { 'bg-surface-md': 16 }],
  ];
  for (const [ref, spacing] of steps) {
    const [f] = await findings(canvasWith([frame('a', { gap: ref })], { ...SYSTEM, spacing }));
    check(`${ref} against ${Object.keys(spacing)[0]} is another rung: no fix`, !!f && !f.fix, f?.fix?.op);
  }
}
{
  for (const side of ['borderRight', 'borderBottom', 'borderLeft'] as const) {
    const [f] = await findings(canvasWith([frame('a', { [side]: { width: 1, color: '$accnt' } } as Partial<SceneNode>)]));
    check(`a ${side}.color typo rewrites the whole object`, f?.fix?.op === `U("a", { ${side}: {"width":1,"color":"$accent"} })`, f?.fix?.op);
  }
}
{
  const fs = await findings(canvasWith([frame('a', { gap: '$space-mdd', rowGap: '$space-mdd' }), frame('b', { gap: '$space-mdd' })]));
  check('one typo on two props of one node, and on another node, is three findings', fs.length === 3, String(fs.length));
  const anon = canvasWith([]);
  parseAndExecute(anon.root, 'box=I("document", {type: "frame", name: "box", children: [{type: "frame", gap: "$space-mdd"}, {type: "frame", gap: "$space-mdd"}]})', anon);
  check('two id-less children with one typo are two findings', (await findings(anon)).length === 2);
}
{
  const used = canvasWith([]);
  const [p] = parseAndExecute(used.root, 'page=I("document", {type: "frame", name: "page"})', used);
  const [c] = parseAndExecute(used.root, 'card=I("document", {type: "component", name: "Used card", gap: "$space-mdd"})', used);
  parseAndExecute(used.root, `a=I("${p.nodeId}", {type: "instance", name: "a", componentId: "${c.nodeId}"})`, used);
  const [f] = await findings(used);
  check('twin: a used component\'s finding does not say no instance uses it', !!f && !/no instance uses/.test(f.message), f?.message);
}
{
  // An override on a different prop is not where the typo comes from.
  const canvas = canvasWith([]);
  const [p] = parseAndExecute(canvas.root, 'page=I("document", {type: "frame", name: "page"})', canvas);
  const [c] = parseAndExecute(canvas.root, 'card=I("document", {type: "component", name: "Card"})', canvas);
  parseAndExecute(canvas.root, `t=I("${c.nodeId}", {type: "frame", name: "inner", gap: "$space-mdd", padding: ["$space-mdd", 0]})`, canvas);
  parseAndExecute(canvas.root, `a=I("${p.nodeId}", {type: "instance", name: "a", componentId: "${c.nodeId}", overrides: {"inner": {"fill": "#FFFFFF"}}})`, canvas);
  const fs = await findings(canvas);
  check('an override on another prop does not claim the typo', fs.length === 2 && fs.every((f) => !/override for this node/.test(f.suggestion ?? '')), fs.map((f) => f.suggestion).join(' | '));
  const ovr = canvasWith([]);
  const [p2] = parseAndExecute(ovr.root, 'page=I("document", {type: "frame", name: "page"})', ovr);
  const [c2] = parseAndExecute(ovr.root, 'card=I("document", {type: "component", name: "Card"})', ovr);
  parseAndExecute(ovr.root, `t=I("${c2.nodeId}", {type: "frame", name: "inner", padding: [8, 0]})`, ovr);
  parseAndExecute(ovr.root, `a=I("${p2.nodeId}", {type: "instance", name: "a", componentId: "${c2.nodeId}", overrides: {"inner": {"padding": ["$space-mdd", 0]}}})`, ovr);
  const [o] = await findings(ovr);
  check('twin: an override holding the typo in an array entry says so', /override for this node/.test(o?.suggestion ?? ''), o?.suggestion);
}
{
  // An instance nested in a component, its own prop misspelt, seen through two outer instances.
  const canvas = canvasWith([]);
  const [p] = parseAndExecute(canvas.root, 'page=I("document", {type: "frame", name: "page"})', canvas);
  const [inner] = parseAndExecute(canvas.root, 'inner=I("document", {type: "component", name: "Inner", layout: "vertical"})', canvas);
  const [outer] = parseAndExecute(canvas.root, 'outer=I("document", {type: "component", name: "Outer"})', canvas);
  parseAndExecute(canvas.root, `ci=I("${outer.nodeId}", {type: "instance", name: "ci", componentId: "${inner.nodeId}", gap: "$space-nested"})`, canvas);
  parseAndExecute(canvas.root, `o1=I("${p.nodeId}", {type: "instance", name: "o1", componentId: "${outer.nodeId}"})\no2=I("${p.nodeId}", {type: "instance", name: "o2", componentId: "${outer.nodeId}"})`, canvas);
  const fs = about(await findings(canvas), '$space-nested');
  check('a nested instance\'s own typo, seen through two outer instances, is one finding with no fix', fs.length === 1 && !fs[0].fix, String(fs.length));
}
{
  const vars: DesignVariables = { ...SYSTEM, radius: { 'radius-md': 8 }, motion: { fast: { duration: 150, easing: 'ease-out' } }, colors: { ...SYSTEM.colors, danger: '#DC2626' } };
  const fs = await findings(canvasWith([
    { id: 'fs', type: 'text', name: 'fs', content: 'x', fontSize: '$accent' } as SceneNode,
    frame('tr', { transition: '$motion.fastt' } as unknown as Partial<SceneNode>),
    frame('tk', { transition: '$accent' } as unknown as Partial<SceneNode>),
    frame('dt', { fill: '$danger-tnt' }),
    frame('rd', { cornerRadius: '$radius-mdd' }),
    { id: 'bd', type: 'text', name: 'bd', content: 'x', fontSize: '$bodyy' } as SceneNode,
    frame('el', { shadow: '$elevation.mdd' }),
  ], vars));
  const on = (id: string) => fs.find((f) => f.nodeId === id);
  check('fontSize "$accent" warns (a colour is not a size)', /color token/.test(on('fs')?.message ?? ''), on('fs')?.message);
  check('transition "$motion.fastt" is fixed to $motion.fast', on('tr')?.fix?.op === 'U("tr", { transition: "$motion.fast" })', on('tr')?.fix?.op);
  check('transition "$accent" warns (wrong kind)', /color token, not a motion token/.test(on('tk')?.message ?? ''), on('tk')?.message);
  check('a typo near a derived colour names it', /"\$danger-tint"/.test(on('dt')?.suggestion ?? ''), on('dt')?.suggestion);
  check('radius, typography and elevation names are candidates with their prefixes', /"\$radius-md"/.test(on('rd')?.suggestion ?? '') && /"\$body"/.test(on('bd')?.suggestion ?? '') && /"\$elevation\.md"/.test(on('el')?.suggestion ?? ''), [on('rd'), on('bd'), on('el')].map((f) => f?.suggestion).join(' | '));
}
{
  // Every entry of the prop tables, and every copy prop.
  const colorProps = ['fill', 'stroke', 'color', 'iconColor', 'secondaryColor', 'badgeColor', 'dotColor'];
  const numberProps = ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'gap', 'rowGap', 'padding', 'cornerRadius', 'x', 'y', 'bottom', 'right', 'strokeWidth', 'opacity', 'blur', 'backdropBlur', 'fontWeight', 'lineHeight', 'letterSpacing', 'iconSize', 'labelWidth', 'inset', 'depth', 'rows', 'innerRatio', 'gridlines'];
  const nodes = [
    ...colorProps.map((p) => frame(`c-${p}`, { [p]: '$body' } as Partial<SceneNode>)),
    ...numberProps.map((p) => frame(`n-${p}`, { [p]: '$accent' } as Partial<SceneNode>)),
  ];
  const fs = await findings(canvasWith(nodes));
  const missC = colorProps.filter((p) => !fs.some((f) => f.nodeId === `c-${p}` && /not a color token/.test(f.message)));
  const missN = numberProps.filter((p) => !fs.some((f) => f.nodeId === `n-${p}` && /not a spacing or radius token/.test(f.message)));
  check('every colour prop rejects a typography token', missC.length === 0, missC.join(', '));
  check('every number prop rejects a colour token', missN.length === 0, missN.join(', '));
  const copy = ['name', 'content', 'text', 'title', 'subtitle', 'label', 'time', 'placeholder', 'value', 'shortcut', 'error', 'ariaLabel', 'count', 'closeLabel', 'centerValue', 'centerLabel'];
  const cfs = await findings(canvasWith(copy.map((p) => frame(`k-${p}`, { [p]: '$49' } as Partial<SceneNode>))));
  check('no copy prop is read as a token', cfs.length === 0, cfs.map((f) => f.nodeId).join(', '));
}
{
  // The kill switch: a ruleset that turns the rule off silences it, score included.
  const { RULESETS } = await import('../../src/surfaces.js');
  const typo = () => canvasWith([frame('a', { gap: '$space-mdd' })]);
  const on = await evaluateCanvas(typo(), { mode: 'fast', categories: ['structure'] });
  const saved = RULESETS.type.web;
  RULESETS.type.web = { disable: ['unknown-token'] };
  const off = await evaluateCanvas(typo(), { mode: 'fast', categories: ['structure'] });
  RULESETS.type.web = saved;
  const score = (ev: typeof on) => ev.categories.find((c) => c.name === 'structure')!.score;
  check('a ruleset that turns unknown-token off silences it and its score', !off.issues.some((i) => i.rule === 'unknown-token') && off.surface.rulesOff.includes('unknown-token') && score(off) === score(on) + 10, `${score(on)} → ${score(off)}`);
}
{
  // Token usage runs on a canvas with colours only, or spacing only.
  const colorsOnly = canvasWith([frame('a', { fill: '#123456', stroke: '#654321' })], { colors: { accent: '#2563EB' } });
  const spacingOnly = canvasWith([frame('a', { fill: '#123456', stroke: '#654321' })], { spacing: { md: 16 } });
  const advises = async (c: Canvas) => (await evaluateCanvas(c, { mode: 'fast', categories: ['structure'] })).issues.some((i) => /use design tokens/.test(i.message));
  check('the token-usage advisory runs with colours only, and with spacing only', await advises(colorsOnly) && await advises(spacingOnly));
  check('twin: with no tokens at all it does not', !(await advises(canvasWith([frame('a', { fill: '#123456', stroke: '#654321' })], {}))));
}
{
  // An id-less icon with one resolving spelling: reported on the ancestor, never fixed.
  const canvas = canvasWith([]);
  parseAndExecute(canvas.root, 'box=I("document", {type: "frame", name: "box", children: [{type: "icon", icon: "material:chevron-right"}]})', canvas);
  const ev = await evaluateCanvas(canvas, { mode: 'fast', categories: ['structure'] });
  const icon = ev.issues.find((i) => /Unknown icon/.test(i.message));
  check('an id-less misspelt icon gets no fix (it would rewrite its ancestor)', !!icon && !icon.fix, icon?.fix?.op);
  const twin = canvasWith([{ id: 'ic', type: 'icon', name: 'ic', icon: 'material:chevron-right' } as SceneNode]);
  const tw = (await evaluateCanvas(twin, { mode: 'fast', categories: ['structure'] })).issues.find((i) => /Unknown icon/.test(i.message));
  check('twin: the same icon with an id is fixed', tw?.fix?.op === 'U("ic", { icon: "material:chevron_right" })', tw?.fix?.op);
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
