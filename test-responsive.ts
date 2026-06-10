import './test-env.js';
/**
 * Responsive padding + font scaling smoke test.
 * Builds a design with large padding (120px) and headline (64px),
 * captures it at mobile/tablet/desktop, and writes the rendered HTML
 * so you can inspect the clamp() output.
 *
 * Run: npx tsx test-responsive.ts
 * Output: /tmp/framesmith-responsive/
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { resolveVariables, setVariables } from './src/variables.js';
import { renderToHtml } from './src/renderer.js';
import { takeResponsiveScreenshots, shutdown } from './src/screenshot.js';
import { getPreset } from './src/presets.js';

const OUT = '/tmp/framesmith-responsive';

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
  await shutdown();
  if (pass !== checks.length || shots.length !== bps.length) process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err);
  shutdown().then(() => process.exit(1));
});