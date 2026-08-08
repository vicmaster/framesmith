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
  const union = typesSrc.match(/export type NodeType =([\s\S]*?);/)?.[1] ?? '';
  const nodeTypes = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).filter((t) => t !== 'document');
  expect('node types found', nodeTypes.length >= 13, String(nodeTypes.length));
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
// Mirrors the RELAXED_BY_GENRE keys in evaluate.ts (module-private, so parsed
// from source). A new genre must be named in index.ts (genre param / GOTCHAS)
// and GUIDELINES or agents can never discover it.
{
  const evaluateSrc = readFileSync('src/evaluate.ts', 'utf-8');
  const table = evaluateSrc.match(/const RELAXED_BY_GENRE[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
  const genres = [...table.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
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
  const ROLES = ['$display', '$heading', '$body', '$label'];
  for (const surface of [['src/index.ts', indexSrc], ['GUIDELINES', guidelines]] as const) {
    const missing = ROLES.filter((r) => !surface[1].includes(r));
    expect(`typography roles in ${surface[0]}`, missing.length === 0, missing.join(', '));
  }
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
