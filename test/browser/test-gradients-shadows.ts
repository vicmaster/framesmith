import '../env.js';
/**
 * Gradients, shadows and blur: structured and legacy forms emit the right CSS,
 * and a gradient tree renders in Chrome.
 * Run with: npx tsx test/browser/test-gradients-shadows.ts
 */

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { resolveVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { takeScreenshot, shutdown } from '../../src/screenshot.js';

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

async function testGradients() {
  console.log('\n── Gradients ──');

  const canvas = createCanvas('Gradient Test');
  const results = parseAndExecute(canvas.root, `
linear=I("document", {type: "frame", width: 400, height: 200, gradient: {type: "linear", angle: 135, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: 12})
radial=I("document", {type: "frame", width: 400, height: 200, gradient: {type: "radial", stops: [{color: "#ffffff", position: 0}, {color: "#000000", position: 100}]}, cornerRadius: 12})
fallback=I("document", {type: "frame", width: 400, height: 200, fill: "#ff0000"})
  `, canvas);
  assert(results.every(r => r.ok), 'Gradient nodes inserted');

  const resolved = resolveVariables(canvas.root, canvas.variables);
  const html = renderToHtml(resolved, 800, 800, canvas);

  assert(html.includes('linear-gradient(135deg'), 'HTML contains linear-gradient with angle');
  assert(html.includes('#667eea 0%'), 'Linear gradient has first stop');
  assert(html.includes('#764ba2 100%'), 'Linear gradient has second stop');
  assert(html.includes('radial-gradient('), 'HTML contains radial-gradient');
  assert(html.includes('background-color: #ff0000'), 'Fallback fill still works');

  // Gradient and fill should not both appear on the same node
  // The linear gradient node should use background, not background-color
  assert(html.includes('background: linear-gradient'), 'Gradient uses background property');

  const base64 = await takeScreenshot(html, { width: 800, height: 800 });
  assert(base64.length > 100, `Screenshot captured (${Math.round(base64.length / 1024)}KB)`);
}

function testShadowsAndBlur() {
  console.log('\n── Shadows & Blur ──');

  const canvas = createCanvas('Shadow Test');
  const results = parseAndExecute(canvas.root, `
box1=I("document", {type: "frame", width: 300, height: 150, fill: "#ffffff", shadows: [{x: 0, y: 4, blur: 12, spread: 0, color: "rgba(0,0,0,0.2)"}], cornerRadius: 8})
box2=I("document", {type: "frame", width: 300, height: 150, fill: "#ffffff", shadows: [{x: 0, y: 2, blur: 4, color: "rgba(0,0,0,0.1)"}, {x: 0, y: 8, blur: 24, color: "rgba(0,0,0,0.15)"}], cornerRadius: 8})
box3=I("document", {type: "frame", width: 300, height: 150, fill: "#ffffff", shadow: "0 4px 6px rgba(0,0,0,0.1)"})
blurred=I("document", {type: "frame", width: 300, height: 150, fill: "#3b82f6", blur: 4})
backdrop=I("document", {type: "frame", width: 300, height: 150, fill: "rgba(255,255,255,0.5)", backdropBlur: 8})
  `, canvas);
  assert(results.every(r => r.ok), 'Shadow/blur nodes inserted');

  const resolved = resolveVariables(canvas.root, canvas.variables);
  const html = renderToHtml(resolved, 800, 1000, canvas);

  // Structured shadows
  assert(html.includes('box-shadow: 0px 4px 12px 0px rgba(0,0,0,0.2)'), 'Single structured shadow rendered');
  assert(html.includes('0px 2px 4px 0px rgba(0,0,0,0.1)'), 'Multi-shadow first shadow');
  assert(html.includes('0px 8px 24px 0px rgba(0,0,0,0.15)'), 'Multi-shadow second shadow');

  // Legacy shadow string
  assert(html.includes('box-shadow: 0 4px 6px rgba(0,0,0,0.1)'), 'Legacy shadow string still works');

  // Blur
  assert(html.includes('filter: blur(4px)'), 'Blur filter rendered');
  assert(html.includes('backdrop-filter: blur(8px)'), 'Backdrop blur rendered');
}

async function main() {
  await testGradients();
  testShadowsAndBlur();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  shutdown().then(() => process.exit(1));
});
