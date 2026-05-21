import './test-env.js';
/**
 * Test the web viewer HTTP server.
 * Run with: npx tsx test-viewer.ts
 * Then open http://localhost:3001 to see the gallery.
 */

import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { setVariables } from './src/variables.js';
import { getPreset } from './src/presets.js';
import { startViewer } from './src/viewer.js';

let PORT: number;

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

async function main() {
  console.log('Framesmith — Viewer Tests\n========================\n');

  // Start viewer on random free port
  PORT = await startViewer(0);

  // Create sample canvases
  console.log('Creating sample canvases...');

  const dash = createCanvas('Dashboard');
  setVariables(dash, getPreset('dark')!.variables);
  parseAndExecute(dash.root, `
page=I("document", {type: "frame", width: 1440, height: 900, fill: "$bg-primary", layout: "vertical", padding: 32, gap: 24})
I(page, {type: "text", content: "Dashboard", fontSize: 28, fontWeight: 700, color: "$text-primary"})
cards=I(page, {type: "frame", layout: "horizontal", gap: 20})
c1=I(cards, {type: "frame", width: 280, height: 140, gradient: {type: "linear", angle: 135, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: 16, padding: 24, layout: "vertical", justifyContent: "space-between"})
I(c1, {type: "text", content: "Revenue", fontSize: 14, color: "#ffffffa0"})
I(c1, {type: "text", content: "$48,250", fontSize: 32, fontWeight: 700, color: "#fff"})
  `, dash);

  const login = createCanvas('Login Page');
  setVariables(login, getPreset('dark')!.variables);
  parseAndExecute(login.root, `
page=I("document", {type: "frame", width: 1440, height: 900, fill: "$bg-primary", layout: "vertical", alignItems: "center", justifyContent: "center"})
card=I(page, {type: "frame", width: 400, fill: "$bg-surface", cornerRadius: 16, padding: 32, layout: "vertical", gap: 20, shadows: [{x: 0, y: 8, blur: 32, color: "rgba(0,0,0,0.4)"}]})
I(card, {type: "text", content: "Sign In", fontSize: 24, fontWeight: 700, color: "$text-primary"})
I(card, {type: "frame", width: "100%", height: 44, fill: "#ffffff10", cornerRadius: 8})
I(card, {type: "frame", width: "100%", height: 44, fill: "#ffffff10", cornerRadius: 8})
btn=I(card, {type: "frame", width: "100%", height: 44, fill: "$accent", cornerRadius: 8, layout: "horizontal", alignItems: "center", justifyContent: "center"})
I(btn, {type: "text", content: "Continue", fontSize: 15, fontWeight: 600, color: "#fff"})
  `, login);

  const light = createCanvas('Light Theme');
  setVariables(light, getPreset('light')!.variables);
  parseAndExecute(light.root, `
page=I("document", {type: "frame", width: 1440, height: 900, fill: "$bg-primary", layout: "vertical", padding: 32, gap: 16})
I(page, {type: "text", content: "Light Theme Example", fontSize: 24, fontWeight: 600, color: "$text-primary"})
I(page, {type: "text", content: "Clean and minimal design", fontSize: 15, color: "$text-secondary"})
  `, light);

  console.log(`  Created 3 canvases\n`);

  // Test HTTP endpoints
  console.log('── HTTP Endpoints ──');

  const galleryRes = await fetch(`http://localhost:${PORT}/`);
  assert(galleryRes.status === 200, `GET / returns 200`);
  const galleryHtml = await galleryRes.text();
  assert(galleryHtml.includes('Framesmith'), 'Gallery contains title');
  assert(galleryHtml.includes('Dashboard'), 'Gallery contains Dashboard canvas');
  assert(galleryHtml.includes('Login Page'), 'Gallery contains Login Page canvas');
  assert(galleryHtml.includes('3 canvases'), 'Gallery shows correct count');

  const apiRes = await fetch(`http://localhost:${PORT}/api/canvases`);
  assert(apiRes.status === 200, 'GET /api/canvases returns 200');
  const canvases = await apiRes.json();
  assert(canvases.length === 3, 'API returns 3 canvases');

  const detailRes = await fetch(`http://localhost:${PORT}/canvas/${dash.id}`);
  assert(detailRes.status === 200, `GET /canvas/:id returns 200`);
  const detailHtml = await detailRes.text();
  assert(detailHtml.includes('Dashboard'), 'Detail page contains canvas name');
  assert(detailHtml.includes('Mobile'), 'Detail page has viewport buttons');
  assert(detailHtml.includes('iframe'), 'Detail page has iframe');

  const htmlRes = await fetch(`http://localhost:${PORT}/canvas/${dash.id}/html`);
  assert(htmlRes.status === 200, 'GET /canvas/:id/html returns 200');
  const rawHtml = await htmlRes.text();
  assert(rawHtml.includes('linear-gradient'), 'Raw HTML contains gradient');
  assert(rawHtml.includes('$48,250'), 'Raw HTML contains canvas content');

  const jsonRes = await fetch(`http://localhost:${PORT}/canvas/${dash.id}/json`);
  assert(jsonRes.status === 200, 'GET /canvas/:id/json returns 200');
  const json = await jsonRes.json();
  assert(json.id === dash.id, 'JSON has correct canvas ID');
  assert(json.root.type === 'document', 'JSON has root document node');

  const metaRes = await fetch(`http://localhost:${PORT}/api/canvas/${dash.id}/meta`);
  assert(metaRes.status === 200, 'GET /api/canvas/:id/meta returns 200');
  const meta = await metaRes.json();
  assert(!!meta.lastModified, 'Meta has lastModified timestamp');
  assert(meta.name === 'Dashboard', 'Meta has correct name');

  // Test 404
  const notFound = await fetch(`http://localhost:${PORT}/canvas/nonexistent`);
  assert(notFound.status === 404, 'Non-existent canvas returns 404');

  console.log(`\n========================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`\nViewer is still running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop, or open the URL in your browser to see the gallery.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});