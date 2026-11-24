// Phase 33 slice D (FR-D1) — the Quality tab's rules, on fixture canvases:
// the verdict chip against the bar, the reason line, categories lowest first,
// issues folded as canvas_evaluate folds them for agents, errors first, and
// each row's kind (tell, auto-fixable or severity).
//
// Usage: npx tsx test/unit/test-viewer-quality.ts

import '../env.js';
import { getCanvas } from '../../src/scene-graph.js';
import { evaluateCanvas, foldIssues } from '../../src/evaluate.js';
import { renderQualityPanel } from '../../src/viewer/pages/detail.js';
import { seedViewerStore } from '../fixtures/viewer-store.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const store = seedViewerStore();
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);

// Below the bar: the pattern library's dashboard (95).
const dash = getCanvas(store.ids.dashboard)!;
const ev = await evaluateCanvas(dash, { mode: 'fast', designedStates: [] });
const html = renderQualityPanel(ev, dash);
check('the score and scale', /<span class="score-value">95<\/span><span class="score-scale">\/ 100<\/span>/.test(html));
check('below the bar the chip says so, in the warning style', html.includes('<span class="verdict-chip verdict-chip--below">Below the bar</span>'));
const weakest = [...ev.categories].sort((a, b) => a.score - b.score)[0];
check('the reason names the weakest category', text(html).includes(`${weakest.name === 'cliche' ? 'Cliché' : weakest.name[0].toUpperCase() + weakest.name.slice(1)} holds it back:`), weakest.name);
check('provenance reads "Built from …"', /<div class="score-built">Built from [^<]+<\/div>/.test(html));

const scores = all(html, /<span class="category-score">(\d+)<\/span>/g).map(Number);
check('categories run lowest first', scores.length === ev.categories.length && scores.every((v, i) => i === 0 || scores[i - 1] <= v), scores.join(','));
check('a category below the bar is marked', /class="category category--below"/.test(html) === scores.some((v) => v < 96));

const folded = foldIssues(ev.issues);
const findings = folded.reduce((n, i) => n + (i.count ?? 1), 0);
check('"N findings in M groups" counts the folded issues', html.includes(`${findings} finding${findings === 1 ? '' : 's'} in ${folded.length} group${folded.length === 1 ? '' : 's'}`), `${findings} / ${folded.length}`);
const rows = all(html, /<div class="issue issue--(\w+)"/g);
check('one row per folded issue', rows.length === folded.length, `${rows.length} vs ${folded.length}`);
const rank = (s: string) => (s === 'error' ? 0 : s === 'warning' ? 1 : 2);
check('errors first, then warnings, then the rest', rows.every((s, i) => i === 0 || rank(rows[i - 1]) <= rank(s)), rows.join(','));
const kinds = all(html, /<div class="issue-kind">([^<]+)<\/div>/g).map((k) => k.split(' · ')[1]);
const expectKinds = [...folded].sort((a, b) => rank(a.severity) - rank(b.severity)).map((i) => i.tell ?? (i.fix || (i.fixes?.length ?? 0) > 0 ? 'auto-fixable' : i.severity));
check('each kind is the tell, "auto-fixable", or the severity', JSON.stringify(kinds) === JSON.stringify(expectKinds), JSON.stringify(kinds));
const multi = folded.find((i) => (i.nodeIds?.length ?? 0) > 1);
check('a folded group offers "Show n nodes" with all its ids', !!multi && html.includes(`Show ${multi.nodeIds!.length} nodes`), String(multi?.nodeIds?.length));
check('the suggestion is a tooltip, not text', !folded.some((i) => i.suggestion && text(html).includes(i.suggestion)));

// At the bar, and clean.
const at96 = getCanvas(store.ids.at96)!;
check('at 96 the chip says At the bar', renderQualityPanel(await evaluateCanvas(at96, { mode: 'fast' }), at96).includes('<span class="verdict-chip">At the bar</span>'));
const clean = getCanvas(store.ids['marquee-hero'])!;
const cleanEv = await evaluateCanvas(clean, { mode: 'fast' });
const cleanHtml = renderQualityPanel(cleanEv, clean);
check('with every category at 100 the reason says so', !cleanEv.categories.every((c) => c.score === 100) || cleanHtml.includes('Every category is at 100.'));

// The vision critique, when present.
const judged = { ...clean, metadata: { ...clean.metadata, critique: { overall: 82, needsRevision: true } } } as typeof clean;
check('a vision critique shows as a row', renderQualityPanel(cleanEv, judged).includes('Vision critique 82/100 · needs revision'));
check('an empty canvas says it has no score', renderQualityPanel(null, getCanvas(store.ids.blank)!).includes('An empty canvas has no score yet.'));

process.exit(allPass ? 0 : 1);
