import './test-env.js';
// Discoverability guard — the #77 lesson, mechanized.
//
// MCP agents never read the README; they learn framesmith from the server
// `instructions`, the `init` GOTCHAS, tool docstrings, and the
// framesmith://guidelines resource. Phase 18 shipped before some of those
// surfaces were updated (slices C/D missed the shared docstring; GUIDELINES
// had no import section at all) — caught by a human question, not a check.
//
// This test makes the staleness mechanical: when a capability is added, the
// suite fails until the agent-facing surfaces mention it. Checks are
// substring-level on purpose — cheap, unbreakable by rephrasing, and loud
// exactly when a NEW name (tool, report field, node type, layout source)
// hasn't been surfaced anywhere agents look.
//
// Usage: npx tsx test-discoverability.ts

import { readFileSync } from 'node:fs';
import { domToSceneGraph, type RawDomNode } from './src/import.js';
import { listStructures } from './src/structures.js';
import { RULESETS, GENRE_ALIASES, SURFACE_TYPES, DEVICE_PROFILES } from './src/surfaces.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

const indexSrc = readFileSync('src/index.ts', 'utf-8');
const readme = readFileSync('README.md', 'utf-8');
const guidelines = readFileSync('docs/GUIDELINES.md', 'utf-8');

// ── 1. every MCP tool is documented in the README Tools section ──────────────
{
  const tools = [...indexSrc.matchAll(/server\.tool\(\s*\n?\s*'([a-z_]+)'/g)].map((m) => m[1]);
  expect('tool registrations found', tools.length >= 30, String(tools.length));
  const missing = tools.filter((t) => !readme.includes(`\`${t}\``));
  expect('every MCP tool appears in README', missing.length === 0, missing.join(', '));
}

// ── 2. every ImportReport field reaches the agent surfaces ───────────────────
// Live keys from a real (empty) import report, so adding a field to the
// interface fails this check until index.ts (docstrings/INSTRUCTIONS/GOTCHAS)
// and GUIDELINES mention it. 'counts' is bookkeeping, not guidance.
{
  const { report } = domToSceneGraph({ tag: 'div', classes: [], rect: { x: 0, y: 0, w: 1, h: 1 }, styles: { display: 'block', visibility: 'visible' }, attrs: {}, children: [] } as RawDomNode);
  const keys = Object.keys(report).filter((k) => k !== 'counts');
  expect('report fields found', keys.length >= 6, keys.join(', '));
  const missingIdx = keys.filter((k) => !indexSrc.includes(k));
  expect('every report field mentioned in src/index.ts (docstrings/instructions)', missingIdx.length === 0, missingIdx.join(', '));
  const missingGl = keys.filter((k) => !guidelines.includes(k));
  expect('every report field mentioned in GUIDELINES', missingGl.length === 0, missingGl.join(', '));
}

// ── 3. report.layout sources are explained where agents look ─────────────────
// Mirrors the ImportReport['layout'][number]['source'] union — update BOTH
// when adding a source (the union itself can't be introspected at runtime).
{
  const SOURCES = ['table', 'grid', 'centered', 'geometry', 'stack-fallback'];
  const missing = SOURCES.filter((s) => !guidelines.includes(s) || !indexSrc.includes(s));
  expect('every report.layout source in GUIDELINES + index.ts', missing.length === 0, missing.join(', '));
}

// ── 4. every authorable node type is in the batch_design docstring + README ──
{
  const typesSrc = readFileSync('src/types.ts', 'utf-8');
  // Comments go first: a `;` inside one would end the union early (it hid
  // skeleton, chart and every Phase 30 primitive from this check).
  const union = typesSrc.replace(/\/\/[^\n]*/g, '').match(/export type NodeType =([\s\S]*?);/)?.[1] ?? '';
  const nodeTypes = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).filter((t) => t !== 'document');
  expect('node types found', nodeTypes.length >= 22 && nodeTypes.includes('tab-bar') && nodeTypes.includes('skeleton'), String(nodeTypes.length));
  const docLine = indexSrc.match(/Node types: ([^\n]+)/)?.[1] ?? '';
  const missingDoc = nodeTypes.filter((t) => !docLine.includes(t));
  expect('every node type in the batch_design docstring', missingDoc.length === 0, missingDoc.join(', '));
  const readmeLine = readme.match(/\*\*Node types:\*\* ([^\n]+)/)?.[1] ?? '';
  const missingReadme = nodeTypes.filter((t) => !readmeLine.includes(`\`${t}\``));
  expect('every node type in the README', missingReadme.length === 0, missingReadme.join(', '));
}

// ── 5. every structure scaffold is documented in the README ──────────────────
// (Agents enumerate structures via the list_structures tool — live data — so
// the docstring needn't name them all; the README must.)
{
  // Require a backticked `name` token, not a bare substring — otherwise a new
  // structure can false-pass on an incidental word in prose (e.g. "dashboards").
  const structures = listStructures().map((s) => s.name);
  const missing = structures.filter((s) => !readme.includes(`\`${s}\``));
  expect('every structure named (backticked) in the README', missing.length === 0, missing.join(', '));
}

// ── 5b. Phase 30 slice E: anatomies and surfaces ─────────────────────────────
// An agent asking for a phone screen must learn which anatomies resolve on a
// mobile canvas, and the two parameters that steer resolution.
{
  const instructions = /const INSTRUCTIONS = `([\s\S]*?)`;/.exec(indexSrc)?.[1] ?? '';
  const tool = (name: string) => new RegExp(`'${name}',\\s*\`([\\s\\S]*?)\`,`).exec(indexSrc)?.[1] ?? '';
  const anatomies = [...new Set(listStructures({ type: 'mobile' }).filter((s) => s.kind === 'page').map((s) => s.anatomy))];
  expect('there are mobile page anatomies to document', anatomies.length > 0);
  const missingInstr = anatomies.filter((a) => !instructions.includes(`${a}-mobile`));
  expect('every mobile realisation named in INSTRUCTIONS', instructions !== '' && missingInstr.length === 0, missingInstr.join(', '));
  const missingGl = anatomies.filter((a) => !guidelines.includes(`\`${a}\``));
  expect('every mobile anatomy named (backticked) in GUIDELINES', missingGl.length === 0, missingGl.join(', '));
  expect('apply_structure docstring names realisation', /realisation/.test(tool('apply_structure')));
  expect('list_structures docstring names canvasId', /canvasId/.test(tool('list_structures')));
  const gotchas = /const GOTCHAS = \[([\s\S]*?)\n\];/.exec(indexSrc)?.[1] ?? '';
  expect('GOTCHAS tell a phone agent to start from a realisation and list by canvas',
    gotchas.includes('list_structures({ canvasId })') && anatomies.every((a) => gotchas.includes(a)));
}

// ── 6. every cliche tell is surfaced where agents look ───────────────────────
// Tell slugs are kebab ('accent-hue') but the agent surfaces describe them in
// prose, so each slug maps to a phrase that MUST appear in both the index.ts
// docstrings/GOTCHAS and GUIDELINES. Adding a tell to the ClicheTell union
// fails this check until it gets a phrase here AND that phrase is documented.
{
  const evaluateSrc = readFileSync('src/evaluate.ts', 'utf-8');
  const union = evaluateSrc.match(/export type ClicheTell =([\s\S]*?);/)?.[1] ?? '';
  const tells = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  expect('cliche tells found', tells.length >= 10, String(tells.length));

  const TELL_PHRASE: Record<string, string> = {
    'accent-hue': 'purple',
    'gradient-glow': 'glow',
    'fake-chrome': 'chrome',
    'hanging-header': 'hanging',
    'honest-content': 'fabricated',
    'eyebrow-rhythm': 'rhythm',
    'slop-copy': 'slop copy',
    'radius-consistency': 'radius',
    'pure-black-white': 'pure black',
    'accent-consistency': 'competing accent',
  };
  const unmapped = tells.filter((t) => !(t in TELL_PHRASE));
  expect('every cliche tell has a documented phrase', unmapped.length === 0, unmapped.join(', '));

  const missingIdx = tells.filter((t) => TELL_PHRASE[t] && !indexSrc.includes(TELL_PHRASE[t]));
  expect('every cliche tell surfaced in src/index.ts', missingIdx.length === 0, missingIdx.join(', '));
  const missingGl = tells.filter((t) => TELL_PHRASE[t] && !guidelines.includes(TELL_PHRASE[t]));
  expect('every cliche tell surfaced in GUIDELINES', missingGl.length === 0, missingGl.join(', '));
}

// ── 7. every relax-genre is surfaced where agents look ───────────────────────
// Mirrors the genre rows of the ruleset table (src/surfaces.ts RULESETS) plus
// their aliases. A new genre must be named in index.ts (genre param / GOTCHAS)
// and GUIDELINES or agents can never discover it.
{
  const genres = [...Object.keys(RULESETS.genre), ...GENRE_ALIASES.keys()];
  expect('relax-genres found', genres.length >= 3, genres.join(', '));
  const missingIdx = genres.filter((g) => !indexSrc.includes(`"${g}"`));
  expect('every relax-genre named in src/index.ts', missingIdx.length === 0, missingIdx.join(', '));
  const missingGl = genres.filter((g) => !guidelines.includes(`"${g}"`));
  expect('every relax-genre named in GUIDELINES', missingGl.length === 0, missingGl.join(', '));

  // Issue #152 — the evaluate result's genre report ({ active, source,
  // relaxed, notRelaxed }) must stay documented on the agent surfaces.
  for (const field of ['notRelaxed', 'relaxedBy']) {
    expect(`genre-report field "${field}" documented in src/index.ts`, indexSrc.includes(field));
    expect(`genre-report field "${field}" documented in GUIDELINES`, guidelines.includes(field));
  }

  // Phase 29 — "named somewhere" is too weak a guard. When TWO genres relax the
  // same tell, a passage that offers one and not the other is worse than one
  // that offers neither: it reads as the complete answer. That is exactly how
  // the commerce genre shipped missing from the canvas_autofix README row while
  // the near-identical canvas_evaluate row above it was correct.
  //
  // The invariant: for any tell relaxed by more than one canonical genre, every
  // LINE that names one of them as a genre must name all of them. Scoped per
  // tell so unrelated genres aren't dragged in (a fabricated-content passage has
  // no reason to mention "material", which relaxes different tells), and keyed
  // on quoted/backticked mentions so prose like "dashboard vocabulary" — which
  // describes a style, not a genre value — stays exempt.
  // GENRE_ALIASES is a Map of [alias, canonical] pairs (Phase 30 made `data`
  // canonical and `dashboard` its alias).
  const canonical = Object.keys(RULESETS.genre);
  expect('genre aliases present in the ruleset table', GENRE_ALIASES.size > 0, [...GENRE_ALIASES.keys()].join(', '));

  const tellToGenres = new Map<string, string[]>();
  for (const g of canonical) {
    for (const t of RULESETS.genre[g].relax ?? []) {
      tellToGenres.set(t, [...(tellToGenres.get(t) ?? []), g]);
    }
  }
  const shared = [...tellToGenres.entries()].filter(([, gs]) => gs.length > 1);
  expect('at least one tell is relaxed by 2+ genres (guard has something to check)', shared.length > 0,
    shared.map(([t, gs]) => `${t}: ${gs.join('+')}`).join('; '));

  // A line counts as a genre passage only if it TALKS about genre — `dashboard`
  // is also a page-scaffold name, and the structures list in the README is not
  // an incomplete genre enumeration.
  const named = (line: string, g: string) => new RegExp(`[\`"]${g}[\`"]`).test(line);
  const aboutGenre = (line: string) => /genre/i.test(line);
  for (const [tell, gs] of shared) {
    const offenders: string[] = [];
    for (const [label, src] of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
      src.split('\n').forEach((line, i) => {
        if (!aboutGenre(line)) return;
        const present = gs.filter((g) => named(line, g));
        if (present.length === 0 || present.length === gs.length) return;
        offenders.push(`${label}:${i + 1} names ${present.join('/')} but not ${gs.filter((g) => !present.includes(g)).join('/')}`);
      });
    }
    expect(`every passage offering a "${tell}" genre offers all of them`, offenders.length === 0, offenders.join(' | '));
  }
}

// ── 7b. Phase 30 slice A: `data` is the genre agents are told to declare ─────
// `dashboard` stays an alias forever (stored canvases carry it), but no agent
// surface may RECOMMEND it — the layout word pushed a fitness app into the
// wrong label. And the genre/preset split's new output fields stay documented.
{
  const evaluateSrc = readFileSync('src/evaluate.ts', 'utf-8');
  const recommends = /genre[:=]?\s*\\?["'`]dashboard\\?["'`]|set_genre\(\s*\\?["'`]dashboard/;
  const offenders: string[] = [];
  const surfacesSrc = readFileSync('src/surfaces.ts', 'utf-8');
  for (const [label, src] of [['src/index.ts', indexSrc], ['src/evaluate.ts', evaluateSrc], ['src/surfaces.ts', surfacesSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    src.split('\n').forEach((line, i) => { if (recommends.test(line)) offenders.push(`${label}:${i + 1}`); });
  }
  expect('no agent surface recommends genre: "dashboard" (declare "data")', offenders.length === 0, offenders.join(', '));
  expect('aliases: dashboard → data, checkout → commerce', GENRE_ALIASES.get('dashboard') === 'data' && GENRE_ALIASES.get('checkout') === 'commerce');

  for (const field of ['byPreset', 'presetRelaxes', 'canonical']) {
    expect(`genre field "${field}" documented in src/index.ts`, indexSrc.includes(field));
    expect(`genre field "${field}" documented in GUIDELINES`, guidelines.includes(field));
  }
  expect('canvas_set_genre documented as writing provenance.genre', indexSrc.includes('metadata.provenance.genre') && readme.includes('metadata.provenance.genre'));
}

// ── 8. gate-integrity vocabulary is surfaced where agents look ───────────────
// Phase 23 (#148/#149): the drift finding kinds (mirrors the DriftFindingKind
// union in drift.ts) and the approval hash field must stay on the agent
// surfaces — a finding kind an agent can't interpret is noise, and versionHash
// is the whole falsifiability story.
{
  const driftSrc = readFileSync('src/drift.ts', 'utf-8');
  const union = driftSrc.match(/export type DriftFindingKind =([\s\S]*?);/)?.[1] ?? '';
  const kinds = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  expect('drift finding kinds found', kinds.length >= 4, kinds.join(', '));
  const missingIdx = kinds.filter((k) => !indexSrc.includes(k));
  expect('every drift finding kind in src/index.ts', missingIdx.length === 0, missingIdx.join(', '));
  const missingGl = kinds.filter((k) => !guidelines.includes(k));
  expect('every drift finding kind in GUIDELINES', missingGl.length === 0, missingGl.join(', '));
  const missingRm = kinds.filter((k) => !readme.includes(k));
  expect('every drift finding kind in README', missingRm.length === 0, missingRm.join(', '));

  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    expect(`versionHash documented in ${surface[0]}`, surface[1].includes('versionHash'));
  }
  // The CLI subcommands are part of the contract too (GUIDELINES + README).
  for (const cmd of ['check-drift', 'verify']) {
    expect(`CLI "framesmith ${cmd}" in GUIDELINES`, guidelines.includes(`framesmith ${cmd}`));
    expect(`CLI "framesmith ${cmd}" in README`, readme.includes(`framesmith ${cmd}`));
  }
}

// ── 9. Phase 24 vocabulary is surfaced where agents look ─────────────────────
// The coverage category, the demanded state names (parsed from the
// COVERAGE_DEMANDS table), and the stress perturbation names (live import)
// must stay documented — a warning an agent can't interpret is noise, and an
// undocumented perturbation never gets run.
{
  const { PERTURBATION_NAMES } = await import('./src/stress.js');
  expect('perturbation names found', PERTURBATION_NAMES.length >= 5, PERTURBATION_NAMES.join(', '));
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = PERTURBATION_NAMES.filter((p: string) => !surface[1].includes(p));
    expect(`every perturbation named in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }

  const evaluateSrc = readFileSync('src/evaluate.ts', 'utf-8');
  const demandsTable = evaluateSrc.match(/COVERAGE_DEMANDS[\s\S]*?\n\];/)?.[0] ?? '';
  const states = [...new Set([...demandsTable.matchAll(/demands: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])))];
  expect('demanded states found', states.length >= 3, states.join(', '));
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = states.filter((s) => !surface[1].includes(`"${s}"`) && !surface[1].includes(`\`${s}\``));
    expect(`every demanded state named in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }

  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    expect(`coverage category documented in ${surface[0]}`, /coverage/.test(surface[1]));
  }
}

// ── 10. Phase 25 vocabulary is surfaced where agents look ────────────────────
// The generators' emitted names (ratio names, semantic color tokens), the
// theme parameter, and the motion-token prefix must stay documented — a
// generated vocabulary nobody can discover is a private language.
{
  const { RATIO_NAMES } = await import('./src/scales.js');
  expect('ratio names found', RATIO_NAMES.length >= 6, RATIO_NAMES.join(', '));
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = RATIO_NAMES.filter((r: string) => !surface[1].includes(r));
    expect(`every ratio name in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }

  const { generateColorSystem } = await import('./src/color-system.js');
  const semanticNames = Object.keys(generateColorSystem('#2563EB').light);
  expect('semantic token names found', semanticNames.length >= 7, semanticNames.join(', '));
  for (const surface of [['src/index.ts', indexSrc], ['README', readme]] as const) {
    const missing = semanticNames.filter((n) => !surface[1].includes(n));
    expect(`every semantic token name in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }

  for (const concept of ['theme', 'dark.colors', '$motion', 'APCA']) {
    for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
      expect(`"${concept}" documented in ${surface[0]}`, surface[1].includes(concept));
    }
  }
}

// ── 11. Phase 26 vocabulary is surfaced where agents look ────────────────────
// Grid's authoring props, the project roll-up's finding kinds (parsed from
// the ProjectFindingKind union), and the flow-rubric axes (live import).
{
  for (const prop of ['gridColumns', 'gridColumn', 'gridRow', 'rowGap']) {
    expect(`grid prop "${prop}" in src/index.ts`, indexSrc.includes(prop));
    expect(`grid prop "${prop}" in README`, readme.includes(prop));
  }
  expect('gridColumns shown in GUIDELINES', guidelines.includes('gridColumns'));

  const projSrc = readFileSync('src/project-evaluate.ts', 'utf-8');
  const union = projSrc.match(/export type ProjectFindingKind =([\s\S]*?);/)?.[1] ?? '';
  const kinds = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  expect('project finding kinds found', kinds.length >= 5, kinds.join(', '));
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = kinds.filter((k) => !surface[1].includes(k));
    expect(`every project finding kind in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }

  const { FLOW_AXES } = await import('./src/llm-judge.js');
  expect('flow axes found', FLOW_AXES.length >= 4, FLOW_AXES.join(', '));
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = FLOW_AXES.filter((a: string) => !surface[1].includes(a));
    expect(`every flow axis in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }
}

// ── Phase 28 slice C: the tells know dashboard vocabulary ────────────────────
{
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines]] as const) {
    expect(`dataviz tell exemptions documented in ${surface[0]}`, /\$chart-\*/.test(surface[1]) || surface[1].includes('$chart-*'));
  }
}

// ── Phase 28 slice B: dataviz primitives ─────────────────────────────────────
{
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    expect(`donut kind in ${surface[0]}`, surface[1].includes('donut'));
    expect(`sparkline kind in ${surface[0]}`, surface[1].includes('sparkline'));
    expect(`segments vocabulary in ${surface[0]}`, surface[1].includes('segments'));
    expect(`bar emphasis vocabulary in ${surface[0]}`, surface[1].includes('highlight'));
  }
}

// ── Phase 28 slice A: the color range ────────────────────────────────────────
{
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    expect(`chart tokens in ${surface[0]}`, surface[1].includes('chart-1'));
    expect(`tint layer in ${surface[0]}`, surface[1].includes('success-tint') && surface[1].includes('accent-tint'));
  }
}

// ── Phase 27 slice C: the usability category ─────────────────────────────────
{
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    expect(`usability category in ${surface[0]}`, surface[1].includes('usability'));
    expect(`hit-target floor in ${surface[0]}`, surface[1].includes('24px') && surface[1].includes('2.5.8'));
  }
}

// ── Phase 27 slice A: personalities + elevation vocabulary ───────────────────
{
  const { PERSONALITY_NAMES } = await import('./src/design-language.js');
  expect('four personalities exported', PERSONALITY_NAMES.length === 4, PERSONALITY_NAMES.join(', '));
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = PERSONALITY_NAMES.filter((p: string) => !surface[1].includes(p));
    expect(`every personality named in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }
  const ELEVATION_NAMES = ['flat', 'raised', 'floating', 'overlay'];
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = ELEVATION_NAMES.filter((e) => !surface[1].includes(`$elevation`) || !surface[1].includes(e));
    expect(`elevation vocabulary in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }
  const ROLES = ['$display', '$heading', '$title', '$body', '$label'];
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines]] as const) {
    const missing = ROLES.filter((r) => !surface[1].includes(r));
    expect(`typography roles in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }
}

// ── Phase 30 slice B: the type axis ──────────────────────────────────────────
// Every canvas type and every device profile is named where agents look, and
// the surface report's fields are documented — a type an agent can't find is
// a phone screen judged as a web page.
{
  for (const [label, src] of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines]] as const) {
    const types = SURFACE_TYPES.filter((t) => !src.includes(`type: "${t}"`));
    expect(`every canvas type named (type: "…") in ${label}`, types.length === 0, types.join(', '));
    const devices = Object.keys(DEVICE_PROFILES).filter((d) => !src.includes(`"${d}"`));
    expect(`every device profile named in ${label}`, devices.length === 0, devices.join(', '));
    const fields = ['rulesOn', 'rulesOff', 'conflicts', 'typeSource', 'safeArea'].filter((f) => !src.includes(f));
    expect(`surface fields documented in ${label}`, fields.length === 0, fields.join(', '));
  }
}

// ── Phase 30 slice C: every registered rule id reaches the agent surfaces ────
// Rule ids appear on findings (`rule`) and in the surface report (rulesOn). An
// id an agent can't look up is a finding it can't act on.
{
  const ruleIds = new Set<string>();
  for (const axis of Object.values(RULESETS)) {
    for (const r of Object.values(axis)) [...(r.enable ?? []), ...(r.disable ?? [])].forEach((id) => ruleIds.add(id));
  }
  expect('the ruleset table registers rule ids', ruleIds.size > 0);
  for (const [label, src] of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines], ['README', readme]] as const) {
    const missing = [...ruleIds].filter((id) => !src.includes(id));
    expect(`every rule id named in ${label}`, missing.length === 0, missing.join(', '));
  }
  expect('the issue `rule` field is documented in src/index.ts and GUIDELINES', /"rule" field/.test(indexSrc) && /`rule` field/.test(guidelines));
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
