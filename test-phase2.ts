import './test-env.js';
/**
 * Quick smoke test for Phase 2 features.
 * Run with: npx tsx test-phase2.ts
 */

import { createCanvas, getCanvas, findNode } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { resolveVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { takeScreenshot, exportToFile, shutdown } from './src/screenshot.js';
import { listPresets, getPreset } from './src/presets.js';
import { getIconSvg, listIconNames } from './src/icons.js';
import { setVariables } from './src/variables.js';

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

async function testPresets() {
  console.log('\n── Style Guide Presets ──');

  const presets = listPresets();
  assert(presets.length === 4, 'Has 4 presets');
  assert(presets.some(p => p.name === 'dark'), 'Has dark preset');
  assert(presets.some(p => p.name === 'light'), 'Has light preset');
  assert(presets.some(p => p.name === 'material'), 'Has material preset');
  assert(presets.some(p => p.name === 'minimal'), 'Has minimal preset');

  const dark = getPreset('dark')!;
  assert(!!dark.variables.colors, 'Dark preset has colors');
  assert(!!dark.variables.typography, 'Dark preset has typography');

  // Apply preset to canvas
  const canvas = createCanvas('Preset Test');
  setVariables(canvas, dark.variables);
  assert(canvas.variables.colors?.['bg-primary'] === '#0a0a0a', 'Preset applied to canvas');
}

async function testIcons() {
  console.log('\n── Icon Support (Lucide) ──');

  const names = listIconNames();
  assert(names.length > 100, `Loaded ${names.length} icons`);
  assert(names.includes('search'), 'Has search icon');
  assert(names.includes('heart'), 'Has heart icon');
  assert(names.includes('home'), 'Has home icon');

  const svg = getIconSvg('search', 24, '#ff0000');
  assert(svg !== null, 'getIconSvg returns SVG');
  assert(svg!.includes('<svg'), 'SVG contains <svg> tag');
  assert(svg!.includes('width="24"'), 'SVG has correct size');
  assert(svg!.includes('stroke="#ff0000"'), 'SVG has custom color');

  const missing = getIconSvg('nonexistent-icon-xyz');
  assert(missing === null, 'Returns null for unknown icon');

  // Render icon node
  const canvas = createCanvas('Icon Test');
  const results = parseAndExecute(canvas.root, `
icon1=I("document", {type: "icon", icon: "search", iconSize: 32, iconColor: "#3b82f6"})
icon2=I("document", {type: "icon", icon: "heart", iconSize: 24, iconColor: "#ef4444"})
  `, canvas);
  assert(results.every(r => r.ok), 'Icon nodes inserted');

  const html = renderToHtml(canvas.root, 400, 200, canvas);
  assert(html.includes('<svg'), 'HTML contains rendered SVG icon');
  assert(html.includes('search'), 'HTML contains search icon class');
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
    outputPath: '/tmp/canvas-mcp-test',
    fileName: 'test-export',
    width: 400,
    height: 200,
  });
  assert(pngPath.endsWith('.png'), `PNG exported to ${pngPath}`);

  // Export PDF
  const pdfPath = await exportToFile(html, {
    format: 'pdf',
    outputPath: '/tmp/canvas-mcp-test',
    fileName: 'test-export',
    width: 400,
    height: 200,
  });
  assert(pdfPath.endsWith('.pdf'), `PDF exported to ${pdfPath}`);

  // Export JPEG
  const jpgPath = await exportToFile(html, {
    format: 'jpeg',
    outputPath: '/tmp/canvas-mcp-test',
    fileName: 'test-export',
    width: 400,
    height: 200,
  });
  assert(jpgPath.endsWith('.jpeg'), `JPEG exported to ${jpgPath}`);

  console.log('  → Files written to /tmp/canvas-mcp-test/');
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

async function testComponentBinding() {
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

// Run all tests
async function main() {
  console.log('Canvas MCP — Phase 2 Smoke Tests\n================================');

  await testPresets();
  await testIcons();
  await testExport();
  await testComponents();
  await testComponentBinding();

  console.log(`\n================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  await shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  shutdown().then(() => process.exit(1));
});