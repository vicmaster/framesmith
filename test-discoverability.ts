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

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
