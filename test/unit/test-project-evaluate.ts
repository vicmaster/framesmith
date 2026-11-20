// Phase 26 slice B — the project roll-up: per-screen rows plus the five
// cross-screen checks, all advisory (never error severity), each naming its
// evidence. Fixtures: a coherent project (clean) and a drifting one where
// every finding kind fires against the right canvases.
//
// Usage: npx tsx test/unit/test-project-evaluate.ts

import '../env.js';
import { evaluateProject } from '../../src/project-evaluate.js';
import { createCanvas, addVariant } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import type { Canvas } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const TOKENS = { colors: { accent: '#2563EB', surface: '#F8FAFC', ink: '#111827' } };

/** A coherent screen: shared radius scale (8/16), token refs, a modest tree. */
function coherentScreen(name: string, opts: { accent?: string; shellCopy?: boolean; literals?: boolean } = {}): Canvas {
  const c = createCanvas(name);
  c.variables = { colors: { ...TOKENS.colors, ...(opts.accent ? { accent: opts.accent } : {}) } };
  const fill = opts.literals ? '#F8FAFC' : '$surface';
  const color = opts.literals ? '#111827' : '$ink';
  parseAndExecute(c.root, `
${opts.shellCopy ? `
shell=I("document", { type: "frame", name: "App shell", layout: "horizontal", gap: 8, padding: 16, cornerRadius: 8, fill: ${JSON.stringify(fill)} })
I(shell, { type: "text", content: "Product", fontWeight: 700, color: ${JSON.stringify(color)} })
I(shell, { type: "text", content: "Reports", color: ${JSON.stringify(color)} })
I(shell, { type: "text", content: "Settings", color: ${JSON.stringify(color)} })
` : ''}
card=I("document", { type: "frame", name: "${name} card", layout: "vertical", gap: 16, padding: 24, cornerRadius: 16, fill: ${JSON.stringify(fill)} })
I(card, { type: "text", content: "${name} heading", fontSize: 20, fontWeight: 600, color: ${JSON.stringify(color)} })
I(card, { type: "text", content: "Supporting copy for ${name}", fontSize: 14, color: ${JSON.stringify(color)} })
b=I(card, { type: "frame", layout: "horizontal", padding: [8, 16], cornerRadius: 8, fill: "$accent", width: "fit-content" })
I(b, { type: "text", content: "Action", fontSize: 13, color: "#FFFFFF" })
`, c);
  return c;
}

const states = new Map<string, string[]>();

// ── the drifting project ────────────────────────────────────────────────────
const s1 = coherentScreen('Overview', { shellCopy: true });
const s2 = coherentScreen('Reports', { shellCopy: true });
const s3 = coherentScreen('Members', { shellCopy: true });
const s4 = coherentScreen('Billing');
const rogueRadius = createCanvas('Legacy');
rogueRadius.variables = { colors: TOKENS.colors };
parseAndExecute(rogueRadius.root, `
card=I("document", { type: "frame", layout: "vertical", gap: 12, padding: 20, cornerRadius: 6, fill: "$surface" })
I(card, { type: "text", content: "Legacy heading", fontSize: 20, color: "$ink" })
inner=I(card, { type: "frame", cornerRadius: 12, padding: 12, fill: "$surface" })
I(inner, { type: "text", content: "Legacy body", fontSize: 14, color: "$ink" })
`, rogueRadius);
const offAccent = coherentScreen('Promotions', { accent: '#16A34A' }); // green vs the blue majority
const handStyled = coherentScreen('Archive', { literals: true });

const drifting = [s1, s2, s3, s4, rogueRadius, offAccent, handStyled];
for (const c of drifting) states.set(c.id, []);

{
  const r = await evaluateProject(drifting, states);
  check('one row per screen', r.canvases.length === 7 && r.counts.screens === 7);
  check('advisory only — never error severity', r.findings.every((f) => f.severity !== ('error' as never)));
  check('every finding names canvases', r.findings.every((f) => f.canvasIds.length > 0));

  const radius = r.findings.filter((f) => f.kind === 'radius-drift');
  check('rogue radius scale flagged, correctly attributed', radius.length === 1 && radius[0].canvasIds[0] === rogueRadius.id, JSON.stringify(radius));

  const accent = r.findings.filter((f) => f.kind === 'accent-drift');
  check('off-accent screen flagged', accent.length === 1 && accent[0].canvasIds[0] === offAccent.id, JSON.stringify(accent));

  const chrome = r.findings.filter((f) => f.kind === 'copied-chrome');
  check('hand-copied shell flagged across its 3 carriers', chrome.length === 1 && chrome[0].canvasIds.length === 3
    && [s1.id, s2.id, s3.id].every((id) => chrome[0].canvasIds.includes(id)), JSON.stringify(chrome.map((f) => f.canvasIds)));
  check('shell suggestion names the component path', chrome[0].suggestion!.includes('create_component') && chrome[0].suggestion!.includes('copy_nodes'));

  const adoption = r.findings.filter((f) => f.kind === 'token-adoption');
  check('hand-styled screen flagged as adoption outlier', adoption.length === 1 && adoption[0].canvasIds[0] === handStyled.id, JSON.stringify(adoption));

  check('verdict says REVIEW + advisory reminder', r.verdict.startsWith('REVIEW') && r.verdict.includes('ADVISORY'));
}

// ── the coherent project ────────────────────────────────────────────────────
{
  const clean = [coherentScreen('A'), coherentScreen('B'), coherentScreen('C')];
  const cleanStates = new Map(clean.map((c) => [c.id, [] as string[]]));
  const r = await evaluateProject(clean, cleanStates);
  const crossFindings = r.findings.filter((f) => f.kind !== 'state-coverage');
  check('coherent project → zero cross-screen findings', crossFindings.length === 0, JSON.stringify(crossFindings));
  check('coherent verdict', r.verdict.startsWith('COHERENT') || r.verdict.startsWith('REVIEW'), r.verdict);
}

// ── state coverage aggregation + variants feed rows ─────────────────────────
{
  const tableScreen = createCanvas('Orders');
  tableScreen.variables = { colors: TOKENS.colors };
  parseAndExecute(tableScreen.root, `
t=I("document", { type: "frame", layout: "vertical", gap: 0 })
h=I(t, { type: "frame", layout: "horizontal", gap: 16 })
h1=I(h, { type: "frame" })
I(h1, { type: "text", content: "NAME" })
h2=I(h, { type: "frame" })
I(h2, { type: "text", content: "STATUS" })
r1=I(t, { type: "frame", layout: "horizontal", gap: 16 })
c1=I(r1, { type: "frame" })
I(c1, { type: "text", content: "Live" })
c2=I(r1, { type: "frame" })
I(c2, { type: "text", content: "active" })
r2=I(t, { type: "frame", layout: "horizontal", gap: 16 })
c3=I(r2, { type: "frame" })
I(c3, { type: "text", content: "VOD" })
c4=I(r2, { type: "frame" })
I(c4, { type: "text", content: "paused" })
`, tableScreen);
  addVariant(tableScreen.id, 'empty');

  const r = await evaluateProject([tableScreen], new Map([[tableScreen.id, ['empty']]]));
  const row = r.canvases[0];
  check('variant states feed the row', row.states.join(',') === 'empty');
  check('missing states surface on the row', row.missingStates.join(',') === 'loading', JSON.stringify(row));
  const cov = r.findings.filter((f) => f.kind === 'state-coverage');
  check('coverage aggregated as a project finding', cov.length === 1 && cov[0].detail.includes('loading'), JSON.stringify(cov));
}

console.log(allPass ? '\nAll project-evaluate tests passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
