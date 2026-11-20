import '../env.js';
/**
 * Responsive padding + font scaling smoke test.
 * Builds a design with large padding (120px) and headline (64px),
 * captures it at mobile/tablet/desktop, and writes the rendered HTML
 * so you can inspect the clamp() output.
 *
 * Also checks takeResponsiveScreenshots' contract on a wrapping row: one
 * labelled shot per breakpoint, at the breakpoint's width.
 *
 * Run: npx tsx test/browser/test-responsive.ts
 * Output: framesmith-responsive/ in the OS temp dir
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '../../src/scene-graph.js';
import { parseAndExecute } from '../../src/operations.js';
import { resolveVariables, setVariables } from '../../src/variables.js';
import { renderToHtml } from '../../src/renderer.js';
import { takeResponsiveScreenshots, shutdown } from '../../src/screenshot.js';
import { getPreset } from '../../src/presets.js';

const OUT = join(tmpdir(), 'framesmith-responsive');

/** takeResponsiveScreenshots returns one labelled shot per breakpoint, in order. */
async function breakpointShots(): Promise<boolean> {
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
  const breakpoints = [
    { label: 'mobile', width: 390, height: 844 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1440, height: 900 },
  ];
  const results = await takeResponsiveScreenshots((bp) => renderToHtml(resolved, bp.width, bp.height, canvas), breakpoints);

  const checks: Array<[string, boolean]> = [
    ['Got 3 responsive screenshots', results.length === 3],
    ['First is mobile', results[0]?.label === 'mobile'],
    ['Mobile width is 390', results[0]?.width === 390],
    ['Second is tablet', results[1]?.label === 'tablet'],
    ['Third is desktop', results[2]?.label === 'desktop'],
    ['All screenshots have data', results.every((r) => r.data.length > 100)],
    // Fewer pixels at mobile width.
    ['Mobile screenshot is smaller than desktop', results[0]?.data.length < results[2]?.data.length],
  ];
  for (const [name, ok] of checks) console.log(`   ${ok ? '✓' : '✗'} ${name}`);
  return checks.every(([, ok]) => ok);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Responsive scaling test → ${OUT}/\n`);

  const c = createCanvas('Responsive scaling');
  setVariables(c, getPreset('dark')!.variables);

  parseAndExecute(c.root, `
page=I("document", {type: "frame", width: "100%", fill: "$bg-primary", layout: "vertical", padding: 120, gap: 32, alignItems: "center"})
I(page, {type: "text", content: "Big Headline Scales Down", fontSize: 64, fontWeight: 700, color: "$text-primary", textAlign: "center"})
I(page, {type: "text", content: "Subhead at 32px also scales", fontSize: 32, fontWeight: 500, color: "$text-secondary", textAlign: "center"})
I(page, {type: "text", content: "Body copy at 16px stays put — below the threshold so it remains crisp at any width.", fontSize: 16, color: "$text-muted", textAlign: "center"})
card=I(page, {type: "frame", width: 800, fill: "$bg-surface", cornerRadius: 16, padding: 64, layout: "vertical", gap: 16, alignItems: "center"})
I(card, {type: "text", content: "Card with 64px padding", fontSize: 28, fontWeight: 600, color: "$text-primary"})
I(card, {type: "text", content: "Inner padding shrinks on narrow viewports.", fontSize: 14, color: "$text-secondary"})
  `, c);

  const resolved = resolveVariables(c.root, c.variables);
  // Per-breakpoint render so the body scaffold matches each viewport — the
  // same callback contract takeResponsiveScreenshots has had since the
  // true-reflow change (and the screenshot_responsive tool uses).
  const renderAt = (width: number, height: number) => renderToHtml(resolved, width, height, c);
  const html = renderAt(1440, 900);

  await writeFile(join(OUT, 'rendered.html'), html);
  console.log('   → rendered.html (inspect clamp() output)');

  // Sanity checks on the emitted CSS
  const checks: Array<[string, boolean]> = [
    ['padding 120 emits clamp', html.includes('padding: clamp(30px, 8.33vw, 120px)')],
    ['padding 64 emits clamp', html.includes('padding: clamp(16px, 4.44vw, 64px)')],
    ['font 64 emits clamp', html.includes('font-size: clamp(38px, 4.44vw, 64px)')],
    ['font 32 emits clamp', html.includes('font-size: clamp(19px, 2.22vw, 32px)')],
    ['font 16 stays static', html.includes('font-size: 16px')],
    ['font 14 stays static', html.includes('font-size: 14px')],
  ];
  let pass = 0;
  for (const [name, ok] of checks) {
    console.log(`   ${ok ? '✓' : '✗'} ${name}`);
    if (ok) pass++;
  }
  console.log(`\n   ${pass}/${checks.length} CSS checks passed\n`);

  const bps = [
    { label: 'mobile', width: 390, height: 844 },
    { label: 'tablet', width: 768, height: 1024 },
    { label: 'desktop', width: 1440, height: 900 },
  ];
  const shots = await takeResponsiveScreenshots((bp) => renderAt(bp.width, bp.height), bps);
  for (const s of shots) {
    await writeFile(join(OUT, `${s.label}.png`), Buffer.from(s.data, 'base64'));
    console.log(`   → ${s.label}.png (${s.width}x${s.height})`);
  }

  console.log(`\nOpen: open ${OUT}`);

  console.log('\nBreakpoint shots');
  const shotsOk = await breakpointShots();

  await shutdown();
  if (pass !== checks.length || shots.length !== bps.length || !shotsOk) process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err);
  shutdown().then(() => process.exit(1));
});