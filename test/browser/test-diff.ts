import '../env.js';
/**
 * Diff mode: identical renders diff at about 0%, different renders report
 * changed pixels and a diff image.
 * Run with: npx tsx test/browser/test-diff.ts
 */

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { resolveVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { computeDiff, shutdown } from '../../src/screenshot.js';

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

async function testDiffMode() {
  console.log('\n── Diff Mode ──');

  // Create two identical canvases
  const canvas1 = createCanvas('Diff A');
  const canvas2 = createCanvas('Diff B');

  const ops = `
bg=I("document", {type: "frame", width: 400, height: 300, fill: "#0a0a0a", layout: "vertical", padding: 24, gap: 16})
I(bg, {type: "text", content: "Hello World", fontSize: 24, color: "#ffffff"})
I(bg, {type: "frame", width: 200, height: 50, fill: "#3b82f6", cornerRadius: 8})
  `;

  parseAndExecute(canvas1.root, ops, canvas1);
  parseAndExecute(canvas2.root, ops, canvas2);

  const resolved1 = resolveVariables(canvas1.root, canvas1.variables);
  const resolved2 = resolveVariables(canvas2.root, canvas2.variables);

  // Compare identical canvases
  const html1 = renderToHtml(resolved1, 400, 300, canvas1);
  const html2 = renderToHtml(resolved2, 400, 300, canvas2);

  const identicalDiff = await computeDiff(html1, html2, 400, 300, 1);
  assert(identicalDiff.changePercent < 1, `Identical canvases: ${identicalDiff.changePercent}% diff (expected ~0%)`);
  assert(identicalDiff.diffImage.length > 100, 'Diff image generated');

  // Create a completely different canvas for comparison
  const canvas3 = createCanvas('Diff C');
  parseAndExecute(canvas3.root, `
bg=I("document", {type: "frame", width: 400, height: 300, fill: "#ef4444", layout: "vertical", padding: 24, gap: 16})
I(bg, {type: "text", content: "Different!", fontSize: 48, color: "#000000"})
  `, canvas3);

  const resolved3 = resolveVariables(canvas3.root, canvas3.variables);
  const html3 = renderToHtml(resolved3, 400, 300, canvas3);

  const changedDiff = await computeDiff(html1, html3, 400, 300, 1);
  assert(changedDiff.changePercent > 0, `Different canvases: ${changedDiff.changePercent}% diff (expected >0%)`);
  assert(changedDiff.changedPixels > 0, `Changed pixels: ${changedDiff.changedPixels}`);
}

async function main() {
  await testDiffMode();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  shutdown().then(() => process.exit(1));
});
