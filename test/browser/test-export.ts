import '../env.js';
/**
 * Export to PNG, PDF and JPEG through Chrome.
 * Run with: npx tsx test/browser/test-export.ts
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { resolveVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { exportToFile, shutdown } from '../../src/screenshot.js';

const OUT = join(tmpdir(), 'framesmith-test');

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

async function testExport() {
  console.log('\n── Export to PNG/PDF ──');

  const canvas = createCanvas('Export Test');
  parseAndExecute(canvas.root, `
box=I("document", {type: "frame", width: 200, height: 100, fill: "#3b82f6", cornerRadius: 8})
I(box, {type: "text", content: "Export Test", fontSize: 18, color: "#ffffff"})
  `, canvas);

  const resolved = resolveVariables(canvas.root, canvas.variables);
  const html = renderToHtml(resolved, 400, 200, canvas);

  // Export PNG
  const pngPath = await exportToFile(html, {
    format: 'png',
    outputPath: OUT,
    fileName: 'test-export',
    width: 400,
    height: 200,
  });
  assert(pngPath.endsWith('.png'), `PNG exported to ${pngPath}`);

  // Export PDF
  const pdfPath = await exportToFile(html, {
    format: 'pdf',
    outputPath: OUT,
    fileName: 'test-export',
    width: 400,
    height: 200,
  });
  assert(pdfPath.endsWith('.pdf'), `PDF exported to ${pdfPath}`);

  // Export JPEG
  const jpgPath = await exportToFile(html, {
    format: 'jpeg',
    outputPath: OUT,
    fileName: 'test-export',
    width: 400,
    height: 200,
  });
  assert(jpgPath.endsWith('.jpeg'), `JPEG exported to ${jpgPath}`);

  console.log(`  → Files written to ${OUT}/`);
}

async function main() {
  await testExport();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  shutdown().then(() => process.exit(1));
});
