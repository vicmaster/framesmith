import './test-env.js';
/**
 * Visual smoke test — generates screenshots you can actually look at.
 * Run with: npx tsx test-visual.ts
 * Then open /tmp/framesmith-visual/ to see the results.
 */

import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { resolveVariables, setVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { exportToFile, takeResponsiveScreenshots, computeDiff, shutdown } from './src/screenshot.js';
import { getPreset } from './src/presets.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = '/tmp/framesmith-visual';

async function saveBase64Png(data: string, name: string) {
  await writeFile(join(OUT, name), Buffer.from(data, 'base64'));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Generating visual tests → ${OUT}/\n`);

  // ─── 1. Dashboard with dark preset, gradients, shadows, icons ───
  console.log('1. Dashboard with all Phase 2+3 features...');
  const dash = createCanvas('Dashboard');
  setVariables(dash, getPreset('dark')!.variables);

  parseAndExecute(dash.root, `
page=I("document", {type: "frame", width: 1440, height: 900, fill: "$bg-primary", layout: "vertical"})

nav=I(page, {type: "frame", width: "100%", height: 64, fill: "$bg-surface", layout: "horizontal", alignItems: "center", padding: [0, 32, 0, 32], gap: 16})
I(nav, {type: "icon", icon: "layout-dashboard", iconSize: 24, iconColor: "$accent"})
I(nav, {type: "text", content: "Framesmith Dashboard", fontSize: 18, fontWeight: 600, color: "$text-primary"})

body=I(page, {type: "frame", width: "100%", height: "100%", layout: "horizontal", padding: 32, gap: 24})

sidebar=I(body, {type: "frame", width: 240, layout: "vertical", gap: 4})
nav1=I(sidebar, {type: "frame", layout: "horizontal", gap: 12, alignItems: "center", padding: [10, 16, 10, 16], cornerRadius: 8, fill: "$bg-elevated"})
I(nav1, {type: "icon", icon: "home", iconSize: 18, iconColor: "$accent"})
I(nav1, {type: "text", content: "Home", fontSize: 14, color: "$text-primary"})
nav2=I(sidebar, {type: "frame", layout: "horizontal", gap: 12, alignItems: "center", padding: [10, 16, 10, 16], cornerRadius: 8})
I(nav2, {type: "icon", icon: "bar-chart-3", iconSize: 18, iconColor: "$text-muted"})
I(nav2, {type: "text", content: "Analytics", fontSize: 14, color: "$text-secondary"})
nav3=I(sidebar, {type: "frame", layout: "horizontal", gap: 12, alignItems: "center", padding: [10, 16, 10, 16], cornerRadius: 8})
I(nav3, {type: "icon", icon: "settings", iconSize: 18, iconColor: "$text-muted"})
I(nav3, {type: "text", content: "Settings", fontSize: 14, color: "$text-secondary"})

main=I(body, {type: "frame", width: "100%", layout: "vertical", gap: 24})

cards=I(main, {type: "frame", layout: "horizontal", gap: 20, width: "100%"})

card1=I(cards, {type: "frame", width: 280, height: 140, gradient: {type: "linear", angle: 135, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: 16, padding: 24, layout: "vertical", justifyContent: "space-between"})
I(card1, {type: "text", content: "Revenue", fontSize: 14, color: "#ffffffa0"})
I(card1, {type: "text", content: "$48,250", fontSize: 32, fontWeight: 700, color: "#ffffff"})

card2=I(cards, {type: "frame", width: 280, height: 140, gradient: {type: "linear", angle: 135, stops: [{color: "#f093fb", position: 0}, {color: "#f5576c", position: 100}]}, cornerRadius: 16, padding: 24, layout: "vertical", justifyContent: "space-between"})
I(card2, {type: "text", content: "Users", fontSize: 14, color: "#ffffffa0"})
I(card2, {type: "text", content: "12,847", fontSize: 32, fontWeight: 700, color: "#ffffff"})

card3=I(cards, {type: "frame", width: 280, height: 140, gradient: {type: "linear", angle: 135, stops: [{color: "#4facfe", position: 0}, {color: "#00f2fe", position: 100}]}, cornerRadius: 16, padding: 24, layout: "vertical", justifyContent: "space-between"})
I(card3, {type: "text", content: "Conversion", fontSize: 14, color: "#ffffffa0"})
I(card3, {type: "text", content: "3.24%", fontSize: 32, fontWeight: 700, color: "#ffffff"})

chart=I(main, {type: "frame", width: "100%", height: 300, fill: "$bg-surface", cornerRadius: 16, padding: 24, layout: "vertical", gap: 16, shadows: [{x: 0, y: 4, blur: 24, spread: 0, color: "rgba(0,0,0,0.3)"}]})
I(chart, {type: "text", content: "Monthly Overview", fontSize: 16, fontWeight: 600, color: "$text-primary"})
bars=I(chart, {type: "frame", layout: "horizontal", gap: 12, alignItems: "end", height: "100%", width: "100%", padding: [0, 0, 16, 0]})
I(bars, {type: "frame", width: 40, height: "30%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
I(bars, {type: "frame", width: 40, height: "55%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
I(bars, {type: "frame", width: 40, height: "40%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
I(bars, {type: "frame", width: 40, height: "70%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
I(bars, {type: "frame", width: 40, height: "85%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
I(bars, {type: "frame", width: 40, height: "60%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
I(bars, {type: "frame", width: 40, height: "45%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
I(bars, {type: "frame", width: 40, height: "90%", gradient: {type: "linear", angle: 0, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: [6, 6, 0, 0]})
  `, dash);

  const dashResolved = resolveVariables(dash.root, dash.variables);
  const dashHtml = renderToHtml(dashResolved, 1440, 900, dash);
  await exportToFile(dashHtml, { format: 'png', outputPath: OUT, fileName: '1-dashboard', width: 1440, height: 900 });
  console.log('   → 1-dashboard.png');

  // ─── 2. Components demo ───
  console.log('2. Reusable components...');
  const comp = createCanvas('Components');
  setVariables(comp, getPreset('dark')!.variables);

  parseAndExecute(comp.root, `
page=I("document", {type: "frame", width: 1440, height: 900, fill: "$bg-primary", layout: "vertical", alignItems: "center", justifyContent: "center", gap: 32})
I(page, {type: "text", content: "Reusable Components", fontSize: 28, fontWeight: 700, color: "$text-primary"})

card=I(page, {type: "component", name: "ProfileCard", width: 320, fill: "$bg-surface", cornerRadius: 16, layout: "vertical", padding: 24, gap: 16, shadows: [{x: 0, y: 8, blur: 32, color: "rgba(0,0,0,0.4)"}]})
avatar=I(card, {type: "frame", name: "avatar", width: 64, height: 64, cornerRadius: [32, 32, 32, 32], gradient: {type: "radial", stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, layout: "horizontal", alignItems: "center", justifyContent: "center"})
I(avatar, {type: "icon", icon: "user", iconSize: 28, iconColor: "#ffffff"})
I(card, {type: "text", name: "name", content: "Default Name", fontSize: 20, fontWeight: 600, color: "$text-primary"})
I(card, {type: "text", name: "role", content: "Default Role", fontSize: 14, color: "$text-muted"})

row=I(page, {type: "frame", layout: "horizontal", gap: 24})
I(row, {type: "instance", componentId: card, overrides: {name: {content: "Alice Chen"}, role: {content: "Lead Designer"}}})
I(row, {type: "instance", componentId: card, overrides: {name: {content: "Bob Rivera"}, role: {content: "Engineer"}}})
I(row, {type: "instance", componentId: card, overrides: {name: {content: "Carol Wu"}, role: {content: "PM"}}})
  `, comp);

  const compResolved = resolveVariables(comp.root, comp.variables);
  const compHtml = renderToHtml(compResolved, 1440, 900, comp);
  await exportToFile(compHtml, { format: 'png', outputPath: OUT, fileName: '2-components', width: 1440, height: 900 });
  console.log('   → 2-components.png');

  // ─── 3. Style presets comparison ───
  console.log('3. Style presets side by side...');
  for (const presetName of ['dark', 'light', 'material', 'minimal']) {
    const c = createCanvas(presetName);
    setVariables(c, getPreset(presetName)!.variables);

    parseAndExecute(c.root, `
page=I("document", {type: "frame", width: 500, height: 400, fill: "$bg-primary", layout: "vertical", padding: 32, gap: 20})
I(page, {type: "text", content: "${presetName.charAt(0).toUpperCase() + presetName.slice(1)} Preset", fontSize: 24, fontWeight: 700, color: "$text-primary"})
I(page, {type: "text", content: "A sample card showing the color palette", fontSize: 14, color: "$text-secondary"})
card=I(page, {type: "frame", width: "100%", fill: "$bg-surface", cornerRadius: "$md", padding: 20, layout: "vertical", gap: 12})
I(card, {type: "text", content: "Card Title", fontSize: 18, fontWeight: 600, color: "$text-primary"})
I(card, {type: "text", content: "Some body text to show typography and secondary colors.", fontSize: 14, color: "$text-secondary"})
btn=I(card, {type: "frame", width: 120, height: 40, fill: "$accent", cornerRadius: "$sm", layout: "horizontal", alignItems: "center", justifyContent: "center"})
I(btn, {type: "text", content: "Action", fontSize: 14, fontWeight: 600, color: "#ffffff"})
    `, c);

    const r = resolveVariables(c.root, c.variables);
    const h = renderToHtml(r, 500, 400, c);
    await exportToFile(h, { format: 'png', outputPath: OUT, fileName: `3-preset-${presetName}`, width: 500, height: 400 });
    console.log(`   → 3-preset-${presetName}.png`);
  }

  // ─── 4. Responsive breakpoints ───
  console.log('4. Responsive breakpoints...');
  const resp = createCanvas('Responsive');
  setVariables(resp, getPreset('dark')!.variables);

  parseAndExecute(resp.root, `
page=I("document", {type: "frame", width: "100%", height: "100%", fill: "$bg-primary", layout: "vertical", padding: 24, gap: 16})
header=I(page, {type: "frame", layout: "horizontal", gap: 12, alignItems: "center", width: "100%"})
I(header, {type: "icon", icon: "smartphone", iconSize: 20, iconColor: "$accent"})
I(header, {type: "text", content: "Responsive Layout", fontSize: 22, fontWeight: 700, color: "$text-primary"})
grid=I(page, {type: "frame", layout: "horizontal", gap: 16, wrap: true, width: "100%"})
I(grid, {type: "frame", width: 200, height: 120, gradient: {type: "linear", angle: 135, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: 12})
I(grid, {type: "frame", width: 200, height: 120, gradient: {type: "linear", angle: 135, stops: [{color: "#f093fb", position: 0}, {color: "#f5576c", position: 100}]}, cornerRadius: 12})
I(grid, {type: "frame", width: 200, height: 120, gradient: {type: "linear", angle: 135, stops: [{color: "#4facfe", position: 0}, {color: "#00f2fe", position: 100}]}, cornerRadius: 12})
I(grid, {type: "frame", width: 200, height: 120, gradient: {type: "linear", angle: 135, stops: [{color: "#43e97b", position: 0}, {color: "#38f9d7", position: 100}]}, cornerRadius: 12})
I(grid, {type: "frame", width: 200, height: 120, gradient: {type: "linear", angle: 135, stops: [{color: "#fa709a", position: 0}, {color: "#fee140", position: 100}]}, cornerRadius: 12})
I(grid, {type: "frame", width: 200, height: 120, gradient: {type: "linear", angle: 135, stops: [{color: "#a18cd1", position: 0}, {color: "#fbc2eb", position: 100}]}, cornerRadius: 12})
  `, resp);

  const respResolved = resolveVariables(resp.root, resp.variables);
  const respHtml = renderToHtml(respResolved, 1440, 900, resp);

  const bps = [
    { label: 'mobile', width: 390, height: 844 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1440, height: 900 },
  ];
  const responsive = await takeResponsiveScreenshots(respHtml, bps);
  for (const r of responsive) {
    await saveBase64Png(r.data, `4-responsive-${r.label}.png`);
    console.log(`   → 4-responsive-${r.label}.png (${r.width}x${r.height})`);
  }

  // ─── 5. Diff mode ───
  console.log('5. Visual diff...');
  const before = createCanvas('Before');
  setVariables(before, getPreset('dark')!.variables);
  parseAndExecute(before.root, `
page=I("document", {type: "frame", width: 600, height: 400, fill: "$bg-primary", layout: "vertical", padding: 32, gap: 20, alignItems: "center", justifyContent: "center"})
card=I(page, {type: "frame", width: 400, fill: "$bg-surface", cornerRadius: 16, padding: 32, layout: "vertical", gap: 16, shadows: [{x: 0, y: 4, blur: 24, color: "rgba(0,0,0,0.3)"}]})
I(card, {type: "text", content: "Before", fontSize: 28, fontWeight: 700, color: "$text-primary"})
I(card, {type: "text", content: "Original design with blue button", fontSize: 14, color: "$text-secondary"})
btn=I(card, {type: "frame", width: "100%", height: 44, fill: "$accent", cornerRadius: 8, layout: "horizontal", alignItems: "center", justifyContent: "center"})
I(btn, {type: "text", content: "Submit", fontSize: 16, fontWeight: 600, color: "#ffffff"})
  `, before);

  const after = createCanvas('After');
  setVariables(after, getPreset('dark')!.variables);
  parseAndExecute(after.root, `
page=I("document", {type: "frame", width: 600, height: 400, fill: "$bg-primary", layout: "vertical", padding: 32, gap: 20, alignItems: "center", justifyContent: "center"})
card=I(page, {type: "frame", width: 400, fill: "$bg-surface", cornerRadius: 16, padding: 32, layout: "vertical", gap: 16, shadows: [{x: 0, y: 4, blur: 24, color: "rgba(0,0,0,0.3)"}]})
I(card, {type: "text", content: "After", fontSize: 28, fontWeight: 700, color: "$text-primary"})
I(card, {type: "text", content: "Updated design with gradient button", fontSize: 14, color: "$text-secondary"})
btn=I(card, {type: "frame", width: "100%", height: 44, gradient: {type: "linear", angle: 90, stops: [{color: "#667eea", position: 0}, {color: "#764ba2", position: 100}]}, cornerRadius: 8, layout: "horizontal", alignItems: "center", justifyContent: "center"})
I(btn, {type: "text", content: "Submit", fontSize: 16, fontWeight: 600, color: "#ffffff"})
I(card, {type: "frame", width: "100%", height: 44, fill: "rgba(255,255,255,0.05)", cornerRadius: 8, layout: "horizontal", alignItems: "center", justifyContent: "center"})
  `, after);

  // Export before and after
  const beforeResolved = resolveVariables(before.root, before.variables);
  const afterResolved = resolveVariables(after.root, after.variables);
  const beforeHtml = renderToHtml(beforeResolved, 600, 400, before);
  const afterHtml = renderToHtml(afterResolved, 600, 400, after);

  await exportToFile(beforeHtml, { format: 'png', outputPath: OUT, fileName: '5-diff-before', width: 600, height: 400 });
  await exportToFile(afterHtml, { format: 'png', outputPath: OUT, fileName: '5-diff-after', width: 600, height: 400 });
  console.log('   → 5-diff-before.png');
  console.log('   → 5-diff-after.png');

  const diff = await computeDiff(beforeHtml, afterHtml, 600, 400, 1);
  await saveBase64Png(diff.diffImage, '5-diff-result.png');
  console.log(`   → 5-diff-result.png (${diff.changePercent}% changed)`);

  // ─── 6. PDF export ───
  console.log('6. PDF export...');
  await exportToFile(dashHtml, { format: 'pdf', outputPath: OUT, fileName: '6-dashboard', width: 1440, height: 900 });
  console.log('   → 6-dashboard.pdf');

  console.log(`\nDone! Open the folder to inspect:\n  open ${OUT}`);
  await shutdown();
}

main().catch((err) => {
  console.error('Error:', err);
  shutdown().then(() => process.exit(1));
});