import '../env.js';
/**
 * The built-in style presets and the Lucide icon set: preset tokens apply to a
 * canvas, icons resolve by name and render as inline SVG.
 * Run with: npx tsx test/unit/test-presets-icons.ts
 */

import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { renderToHtml } from '../../src/renderer.js';
import { listPresets, getPreset } from '../../src/presets.js';
import { getIconSvg, listIconNames } from '../../src/icons.js';
import { setVariables } from '../../src/variables.js';

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

function testPresets() {
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

function testIcons() {
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

testPresets();
testIcons();

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// Deliberate type error: proves CI's fast job type-checks tests. Reverted next.
const typeCheckProbe: number = 'not a number';
void typeCheckProbe;
