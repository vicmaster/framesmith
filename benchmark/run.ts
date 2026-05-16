// Phase 6b benchmark runner. Walks the corpus, evaluates each canvas in fast
// mode, and diffs the result against benchmark/baselines.json. Catches drift
// in canvas_evaluate output across renderer / evaluator changes.
//
// Usage:
//   npx tsx benchmark/run.ts            # compare against baselines, exit nonzero on drift
//   npx tsx benchmark/run.ts --update   # rewrite baselines.json from current scores

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCanvas } from '../src/evaluate.js';
import type { Canvas, SceneNode } from '../src/types.js';
import { heroRoot } from './corpus/hero.js';
import { minimalRoot } from './corpus/minimal.js';
import { badContrastRoot } from './corpus/bad-contrast.js';

interface CorpusEntry {
  name: string;
  root: SceneNode;
}

const corpus: CorpusEntry[] = [
  { name: 'hero', root: heroRoot },
  { name: 'minimal', root: minimalRoot },
  { name: 'bad-contrast', root: badContrastRoot },
];

interface CategoryBaseline {
  name: string;
  score: number;
  issueCount: number;
}

interface Baseline {
  overallScore: number;
  categories: CategoryBaseline[];
  issueCount: number;
  issueKeys: string[];
}

type BaselinesFile = Record<string, Baseline>;

function fakeCanvas(name: string, root: SceneNode): Canvas {
  return {
    id: `bench-${name}`,
    name,
    root,
    variables: {},
    components: {},
    createdAt: '1970-01-01T00:00:00Z',
    lastModified: '1970-01-01T00:00:00Z',
  };
}

function summarize(result: Awaited<ReturnType<typeof evaluateCanvas>>): Baseline {
  return {
    overallScore: result.overallScore,
    categories: result.categories.map((c) => ({ name: c.name, score: c.score, issueCount: c.issueCount })),
    issueCount: result.issues.length,
    // category::nodeId::message is granular enough to catch a check changing its
    // wording, stopping firing, or moving to a different node.
    issueKeys: result.issues.map((i) => `${i.category}::${i.nodeId}::${i.message}`).sort(),
  };
}

function diff(expected: Baseline, actual: Baseline): string[] {
  const errs: string[] = [];
  if (expected.overallScore !== actual.overallScore) {
    errs.push(`overallScore: ${expected.overallScore} → ${actual.overallScore}`);
  }
  if (expected.issueCount !== actual.issueCount) {
    errs.push(`issueCount: ${expected.issueCount} → ${actual.issueCount}`);
  }
  const expCats = new Map(expected.categories.map((c) => [c.name, c]));
  const actCats = new Map(actual.categories.map((c) => [c.name, c]));
  for (const [catName, expCat] of expCats) {
    const actCat = actCats.get(catName);
    if (!actCat) { errs.push(`category ${catName} disappeared`); continue; }
    if (actCat.score !== expCat.score) errs.push(`${catName}.score: ${expCat.score} → ${actCat.score}`);
    if (actCat.issueCount !== expCat.issueCount) errs.push(`${catName}.issueCount: ${expCat.issueCount} → ${actCat.issueCount}`);
  }
  for (const catName of actCats.keys()) {
    if (!expCats.has(catName)) errs.push(`new category: ${catName}`);
  }
  const expKeys = new Set(expected.issueKeys);
  const actKeys = new Set(actual.issueKeys);
  for (const k of expKeys) if (!actKeys.has(k)) errs.push(`issue disappeared: ${k}`);
  for (const k of actKeys) if (!expKeys.has(k)) errs.push(`new issue: ${k}`);
  return errs;
}

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(here, 'baselines.json');
const updateMode = process.argv.includes('--update');

let baselines: BaselinesFile = {};
try {
  baselines = JSON.parse(await readFile(BASELINE_PATH, 'utf-8'));
} catch {
  if (!updateMode) {
    console.error('No baselines.json found. Run with --update to create one.');
    process.exit(2);
  }
}

const fresh: BaselinesFile = {};
let allPass = true;
for (const entry of corpus) {
  const result = await evaluateCanvas(fakeCanvas(entry.name, entry.root), { mode: 'fast' });
  const summary = summarize(result);
  fresh[entry.name] = summary;

  if (updateMode) {
    console.log(`[${entry.name}] overall=${summary.overallScore}  issues=${summary.issueCount}  cats=${summary.categories.map((c) => `${c.name}:${c.score}`).join(' ')}`);
    continue;
  }

  const expected = baselines[entry.name];
  if (!expected) {
    allPass = false;
    console.log(`FAIL  ${entry.name}: no baseline (run with --update to add)`);
    continue;
  }
  const errs = diff(expected, summary);
  if (errs.length === 0) {
    console.log(`PASS  ${entry.name}: overall=${summary.overallScore} issues=${summary.issueCount}`);
  } else {
    allPass = false;
    console.log(`FAIL  ${entry.name}:`);
    for (const e of errs) console.log(`        ${e}`);
  }
}

if (updateMode) {
  await writeFile(BASELINE_PATH, JSON.stringify(fresh, null, 2) + '\n', 'utf-8');
  console.log(`\nWrote ${BASELINE_PATH}`);
} else if (!allPass) {
  process.exit(1);
}
