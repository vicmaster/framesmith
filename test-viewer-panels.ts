import './test-env.js';
/**
 * Phase 19 Slice A — viewer Quality panel. Pure HTML-string assertions (no
 * browser): renderDetailPage embeds the heuristic evaluation, renderProjectPage
 * stamps a score badge per card, and an empty canvas shows no panel.
 * Run with: npx tsx test-viewer-panels.ts
 */
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { renderDetailPage, renderProjectPage } from './src/viewer.js';
import { ensureDefaultWorkspaceAndProject } from './src/workspaces.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

async function main() {
  // Materialize the default workspace/project entity in the isolated test store
  // (the real environment always has Personal ▸ Untitled).
  const { projectId } = ensureDefaultWorkspaceAndProject();

  console.log('\n── detail page: quality inspector ──');
  // A canvas seeded with a fixable tell (pure-black ink) + a slop-copy tell.
  const c = createCanvas('panel-fixture');
  parseAndExecute(c.root, `
page=I("document", { type:"frame", width:1200, layout:"vertical", gap:24, padding:48, fill:"#0F172A" })
I(page, { type:"text", content:"Elevate your workflow", fontSize:32, color:"#000000" })
I(page, { type:"text", content:"A short honest description.", fontSize:16, color:"#CBD5E1" })`);
  const html = await renderDetailPage(c, 3001);

  assert(html.includes('class="inspector"'), 'detail page includes the inspector panel');
  assert(/insp-score-num">\d+/.test(html), 'inspector shows a numeric overall score');
  assert(html.includes('insp-cat-fill'), 'inspector renders category bars');
  assert(html.includes('cliche · pure-black-white'), 'a cliché tell renders its category · tell badge');
  assert(html.includes('cliche · slop-copy'), 'the slop-copy tell renders too');
  assert(html.includes('auto-fixable'), 'a fixable issue (pure-black ink) shows the auto-fixable tag');
  assert(html.includes('data-issue-node='), 'issues wire data-issue-node for click-to-highlight');
  assert(html.includes('function highlightNode'), 'the highlight script is present');
  assert(html.includes('data-node-id'), 'the highlight script targets data-node-id in the render');

  console.log('\n── empty canvas: no panel ──');
  const empty = createCanvas('empty-fixture');
  const emptyHtml = await renderDetailPage(empty, 3001);
  assert(!emptyHtml.includes('class="inspector"'), 'an empty canvas shows no inspector (nothing to score)');

  console.log('\n── gallery: score badge per card ──');
  // Both fixtures landed in the default project; render it and check the badge.
  const proj = await renderProjectPage(projectId, 3001) ?? '';
  assert(proj.includes('class="card-score"'), 'the gallery stamps a score badge on scored cards');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
main();
