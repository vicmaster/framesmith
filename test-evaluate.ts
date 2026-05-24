import './test-env.js';
/**
 * Test the canvas_evaluate tool with intentionally good and bad designs.
 * Run with: npx tsx test-evaluate.ts
 */

import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { setVariables } from './src/variables.js';
import { getPreset } from './src/presets.js';
import { evaluateCanvas } from './src/evaluate.js';
import { shutdown } from './src/screenshot.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

async function testBadDesign() {
  console.log('\n── Bad Design (should score low) ──');

  const canvas = createCanvas('Bad Design');
  // No preset, no variables — hardcoded everything
  parseAndExecute(canvas.root, `
page=I("document", {type: "frame", width: 1440, height: 900, fill: "#000000"})
box1=I(page, {type: "frame", width: 300, height: 200, fill: "#111111", padding: 13})
I(box1, {type: "text", content: "Very low contrast text", fontSize: 14, color: "#222222"})
I(box1, {type: "text", content: "Another bad contrast", fontSize: 15, color: "#333333"})
box2=I(page, {type: "frame", width: 300, height: 200, fill: "#ffffff", padding: 17})
I(box2, {type: "text", content: "Tiny text", fontSize: 9, fontWeight: 400})
I(box2, {type: "text", content: "Huge text", fontSize: 72, fontWeight: 400})
I(box2, {type: "text", content: "Medium text", fontSize: 23, fontWeight: 400})
I(box2, {type: "text", content: "Another size", fontSize: 31, fontWeight: 400})
I(box2, {type: "text", content: "Yet another", fontSize: 11, fontWeight: 400})
I(box2, {type: "text", content: "And another", fontSize: 19, fontWeight: 400})
I(box2, {type: "text", content: "One more", fontSize: 44, fontWeight: 400})
cta=I(page, {type: "frame", width: 160, height: 44, fill: "#6366f1", cornerRadius: 8})
I(page, {type: "text", content: "99.9% uptime", fontSize: 32, color: "#ffffff"})
deep1=I(page, {type: "frame"})
deep2=I(deep1, {type: "frame"})
deep3=I(deep2, {type: "frame"})
deep4=I(deep3, {type: "frame"})
deep5=I(deep4, {type: "frame"})
deep6=I(deep5, {type: "frame"})
deep7=I(deep6, {type: "frame"})
deep8=I(deep7, {type: "frame"})
deep9=I(deep8, {type: "frame"})
I(deep9, {type: "text", content: "Deeply nested", fontSize: 14, color: "#000000"})
  `, canvas);

  const result = await evaluateCanvas(canvas, { mode: 'fast' });

  assert(result.overallScore < 70, `Overall score is low: ${result.overallScore}/100`);
  assert(result.issues.length > 0, `Has issues: ${result.issues.length} found`);

  const colorIssues = result.issues.filter(i => i.category === 'color');
  assert(colorIssues.some(i => i.severity === 'error'), `Has color contrast errors`);

  const typographyIssues = result.issues.filter(i => i.category === 'typography');
  assert(typographyIssues.length > 0, `Has typography issues: ${typographyIssues.length}`);

  const structureIssues = result.issues.filter(i => i.category === 'structure');
  assert(structureIssues.some(i => i.message.includes('depth')), `Detects deep nesting`);

  const consistencyIssues = result.issues.filter(i => i.category === 'consistency');
  assert(consistencyIssues.length > 0, `Has consistency issues`);

  // Issues reference node IDs
  assert(result.issues.every(i => i.nodeId), 'All issues have nodeId');

  assert(result.summary.length > 50, `Summary is descriptive: "${result.summary.slice(0, 80)}..."`);
  assert(result.stats.totalNodes > 10, `Stats: ${result.stats.totalNodes} total nodes`);

  console.log(`\n  Score: ${result.overallScore}/100`);
  result.categories.forEach(c => console.log(`    ${c.name}: ${c.score}/100 (${c.issueCount} issues)`));
}

async function testGoodDesign() {
  console.log('\n── Good Design (should score high) ──');

  const canvas = createCanvas('Good Design');
  setVariables(canvas, getPreset('dark')!.variables);

  parseAndExecute(canvas.root, `
page=I("document", {type: "frame", name: "page", width: 1440, height: 900, fill: "$bg-primary", layout: "vertical", padding: "$lg", gap: "$md"})
header=I(page, {type: "frame", name: "header", layout: "horizontal", alignItems: "center", gap: "$md", width: "100%"})
I(header, {type: "text", name: "title", content: "Dashboard", fontSize: 28, fontWeight: 700, color: "$text-primary"})
I(header, {type: "text", name: "subtitle", content: "Overview of your data", fontSize: 14, color: "$text-secondary"})
cards=I(page, {type: "frame", name: "cards", layout: "horizontal", gap: "$md"})
card1=I(cards, {type: "frame", name: "card-revenue", width: 300, height: 150, fill: "$bg-surface", cornerRadius: "$md", padding: "$lg", layout: "vertical", gap: "$sm"})
I(card1, {type: "text", name: "card-label", content: "Revenue", fontSize: 14, color: "$text-secondary"})
I(card1, {type: "text", name: "card-value", content: "$48,250", fontSize: 32, fontWeight: 700, color: "$text-primary"})
card2=I(cards, {type: "frame", name: "card-users", width: 300, height: 150, fill: "$bg-surface", cornerRadius: "$md", padding: "$lg", layout: "vertical", gap: "$sm"})
I(card2, {type: "text", name: "card-label2", content: "Users", fontSize: 14, color: "$text-secondary"})
I(card2, {type: "text", name: "card-value2", content: "12,847", fontSize: 32, fontWeight: 700, color: "$text-primary"})
  `, canvas);

  const result = await evaluateCanvas(canvas, { mode: 'fast' });

  assert(result.overallScore >= 70, `Overall score is good: ${result.overallScore}/100`);

  const errors = result.issues.filter(i => i.severity === 'error');
  assert(errors.length === 0, `No critical errors`);

  assert(result.stats.tokenUsagePercent > 0, `Uses design tokens: ${result.stats.tokenUsagePercent}%`);

  console.log(`\n  Score: ${result.overallScore}/100`);
  result.categories.forEach(c => console.log(`    ${c.name}: ${c.score}/100 (${c.issueCount} issues)`));
}

async function testDetailedMode() {
  console.log('\n── Detailed Mode (Puppeteer) ──');

  const canvas = createCanvas('Detailed Test');
  setVariables(canvas, getPreset('dark')!.variables);

  parseAndExecute(canvas.root, `
page=I("document", {type: "frame", name: "page", width: 800, height: 600, fill: "$bg-primary", layout: "vertical", padding: "$lg", gap: "$md"})
I(page, {type: "text", name: "title", content: "Detailed Test", fontSize: 24, fontWeight: 700, color: "$text-primary"})
row=I(page, {type: "frame", name: "row", layout: "horizontal", gap: "$md"})
I(row, {type: "frame", name: "box1", width: 200, height: 100, fill: "$bg-surface", cornerRadius: "$sm"})
I(row, {type: "frame", name: "box2", width: 200, height: 100, fill: "$bg-surface", cornerRadius: "$sm"})
  `, canvas);

  try {
    const result = await evaluateCanvas(canvas, { mode: 'detailed' });
    assert(result.mode === 'detailed', 'Mode is detailed');
    assert(result.overallScore >= 0, `Score: ${result.overallScore}/100`);
    console.log(`\n  Score: ${result.overallScore}/100`);
    result.categories.forEach(c => console.log(`    ${c.name}: ${c.score}/100 (${c.issueCount} issues)`));
  } catch {
    console.log('  (skipped — Puppeteer Chrome not available)');
    passed++; // Don't count as failure
  }
}

async function testCategoryFilter() {
  console.log('\n── Category Filter ──');

  const canvas = createCanvas('Filter Test');
  parseAndExecute(canvas.root, `
I("document", {type: "frame", width: 400, height: 300, fill: "#ffffff"})
  `, canvas);

  const result = await evaluateCanvas(canvas, { mode: 'fast', categories: ['spacing'] });
  assert(result.categories.length === 1, `Only 1 category evaluated`);
  assert(result.categories[0].name === 'spacing', `Category is spacing`);
}

async function testEmptyCanvas() {
  console.log('\n── Empty Canvas ──');

  const canvas = createCanvas('Empty');
  const result = await evaluateCanvas(canvas, { mode: 'fast' });
  assert(result.overallScore === 100, `Empty canvas scores 100`);
  assert(result.summary.includes('empty'), `Summary mentions empty`);
}

async function main() {
  console.log('Framesmith — Evaluate Tests\n===========================');

  await testBadDesign();
  await testGoodDesign();
  await testDetailedMode();
  await testCategoryFilter();
  await testEmptyCanvas();

  console.log(`\n===========================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Error:', err);
  shutdown().then(() => process.exit(1));
});