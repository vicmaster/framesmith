import './test-env.js';
/**
 * Smoke test for Phase 3 features.
 * Run with: npx tsx test-phase3.ts
 */

import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { resolveVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { takeScreenshot, takeResponsiveScreenshots, computeDiff, shutdown } from './src/screenshot.js';

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

async function testShadowsAndBlur() {
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

async function testResponsiveBreakpoints() {
  console.log('\n── Responsive Breakpoints ──');

  const canvas = createCanvas('Responsive Test');
  parseAndExecute(canvas.root, `
container=I("document", {type: "frame", width: "100%", height: "100%", fill: "#0a0a0a", layout: "vertical", padding: 24, gap: 16})
I(container, {type: "text", content: "Responsive Test", fontSize: 24, color: "#ffffff"})
row=I(container, {type: "frame", layout: "horizontal", gap: 16, wrap: true, width: "100%"})
I(row, {type: "frame", width: 200, height: 100, fill: "#3b82f6", cornerRadius: 8})
I(row, {type: "frame", width: 200, height: 100, fill: "#ef4444", cornerRadius: 8})
I(row, {type: "frame", width: 200, height: 100, fill: "#22c55e", cornerRadius: 8})
  `, canvas);

  const resolved = resolveVariables(canvas.root, canvas.variables);
  const html = renderToHtml(resolved, 1440, 900, canvas);

  const breakpoints = [
    { label: 'mobile', width: 390, height: 844 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1440, height: 900 },
  ];

  const results = await takeResponsiveScreenshots(html, breakpoints);
  assert(results.length === 3, 'Got 3 responsive screenshots');
  assert(results[0].label === 'mobile', 'First is mobile');
  assert(results[0].width === 390, 'Mobile width is 390');
  assert(results[1].label === 'tablet', 'Second is tablet');
  assert(results[2].label === 'desktop', 'Third is desktop');
  assert(results.every(r => r.data.length > 100), 'All screenshots have data');

  // Mobile screenshot should be smaller (fewer pixels)
  assert(results[0].data.length < results[2].data.length, 'Mobile screenshot is smaller than desktop');
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
  console.log('Canvas MCP — Phase 3 Smoke Tests\n================================');

  await testGradients();
  await testShadowsAndBlur();
  await testResponsiveBreakpoints();
  await testDiffMode();

  console.log(`\n================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  shutdown().then(() => process.exit(1));
});