import '../env.js';
/**
 * canvas_evaluate's detailed mode, which lays the canvas out in Chrome.
 * The fast-mode checks are in test/unit/test-evaluate.ts.
 * Run with: npx tsx test/browser/test-evaluate-detailed.ts
 */

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { setVariables } from '../../src/variables.js';
import { getPreset } from '../../src/presets.js';
import { evaluateCanvas } from '../../src/evaluate.js';
import { shutdown } from '../../src/screenshot.js';

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

  const result = await evaluateCanvas(canvas, { mode: 'detailed' });
  assert(result.mode === 'detailed', 'Mode is detailed');
  assert(result.overallScore >= 0, `Score: ${result.overallScore}/100`);
  console.log(`\n  Score: ${result.overallScore}/100`);
  result.categories.forEach(c => console.log(`    ${c.name}: ${c.score}/100 (${c.issueCount} issues)`));
}

async function main() {
  await testDetailedMode();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Error:', err);
  shutdown().then(() => process.exit(1));
});
