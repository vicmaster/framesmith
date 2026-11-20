import '../env.js';
/**
 * Components and their instances: overrides apply per instance, a component id
 * bound by name resolves, and an instance tree renders in Chrome.
 * Run with: npx tsx test/browser/test-component-instances.ts
 */

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
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

async function testComponents() {
  console.log('\n── Reusable Components ──');

  const canvas = createCanvas('Component Test');

  // Define a component
  const results = parseAndExecute(canvas.root, `
card=I("document", {type: "component", name: "Card", width: 300, height: 150, fill: "#1a1a1a", cornerRadius: 12, layout: "vertical", padding: 16, gap: 8})
title=I(card, {type: "text", name: "title", content: "Default Title", fontSize: 20, fontWeight: 700, color: "#ffffff"})
desc=I(card, {type: "text", name: "description", content: "Default description text", fontSize: 14, color: "#ffffffa0"})
  `, canvas);
  assert(results.every(r => r.ok), 'Component created');
  assert(Object.keys(canvas.components).length === 1, 'Component registered in canvas');

  const compId = results[0].nodeId!;
  assert(canvas.components[compId] !== undefined, 'Component accessible by ID');

  // Create instances with overrides
  const instanceResults = parseAndExecute(canvas.root, `
inst1=I("document", {type: "instance", componentId: "${compId}", overrides: {title: {content: "First Card"}, description: {content: "Custom description 1"}}})
inst2=I("document", {type: "instance", componentId: "${compId}", overrides: {title: {content: "Second Card", color: "#3b82f6"}}})
  `, canvas);
  assert(instanceResults.every(r => r.ok), 'Instances created');

  // Render and verify instances are resolved
  const html = renderToHtml(canvas.root, 800, 600, canvas);
  assert(html.includes('First Card'), 'Instance 1 override applied');
  assert(html.includes('Second Card'), 'Instance 2 override applied');
  assert(html.includes('Custom description 1'), 'Nested override applied');
  assert(html.includes('Default description text'), 'Instance 2 keeps default description');

  // Take screenshot to verify visual rendering
  const base64 = await takeScreenshot(html, { width: 800, height: 600 });
  assert(base64.length > 100, `Screenshot captured (${Math.round(base64.length / 1024)}KB base64)`);
}

function testComponentBinding() {
  console.log('\n── Component ID Binding ──');

  const canvas = createCanvas('Binding Test');

  // Use binding variable for componentId (not string literal)
  const results = parseAndExecute(canvas.root, `
btn=I("document", {type: "component", name: "Button", width: 120, height: 40, fill: "#3b82f6", cornerRadius: 8, layout: "horizontal", alignItems: "center", justifyContent: "center"})
I(btn, {type: "text", name: "label", content: "Click me", fontSize: 14, color: "#fff"})
inst=I("document", {type: "instance", componentId: btn, overrides: {label: {content: "Submit"}}})
  `, canvas);
  assert(results.every(r => r.ok), 'Component + instance via binding');

  const html = renderToHtml(canvas.root, 400, 200, canvas);
  assert(html.includes('Submit'), 'Binding-based instance resolved');
}

async function main() {
  await testComponents();
  testComponentBinding();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  shutdown().then(() => process.exit(1));
});
