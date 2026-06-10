// Regenerate src/tailwind-palette.ts from Tailwind v4's official theme.css.
//
// The v4 default palette is defined in oklch; we need the sRGB values an
// actual Tailwind page renders. Rather than reimplementing the oklch→sRGB
// math, feed each value through the bundled Chrome (set it as a background-
// color, read the computed rgb back) — byte-identical to what a real v4 page
// computes, with zero color-science code to maintain.
//
// Usage:
//   curl -sL https://raw.githubusercontent.com/tailwindlabs/tailwindcss/main/packages/tailwindcss/theme.css -o /tmp/tw-theme.css
//   npx tsx scripts/generate-tailwind-palette.ts /tmp/tw-theme.css
//
// Commit the regenerated src/tailwind-palette.ts. Only needed when Tailwind
// recalibrates its palette (rare).

import { readFileSync, writeFileSync } from 'node:fs';
import { withPage, shutdown } from '../src/screenshot.js';

const themePath = process.argv[2];
if (!themePath) {
  console.error('Usage: npx tsx scripts/generate-tailwind-palette.ts <path-to-theme.css>');
  process.exit(1);
}

const css = readFileSync(themePath, 'utf-8');
const entries = [...css.matchAll(/--color-([a-z]+-(?:50|[1-9]50|[1-9]00))\s*:\s*(oklch\([^)]+\))\s*;/g)]
  .map((m) => ({ name: m[1], oklch: m[2] }));

if (entries.length < 200) {
  console.error(`Only ${entries.length} palette entries matched — theme.css format changed? Aborting.`);
  process.exit(1);
}

// getComputedStyle preserves oklch in modern Chrome, so rasterize instead:
// paint each color into a 2D canvas and read the sRGB pixel back — exactly
// the bytes a screenshot of a Tailwind v4 page would contain.
const resolved = await withPage(async (page) => {
  await page.setContent('<canvas id="probe" width="1" height="1"></canvas>', { waitUntil: 'domcontentloaded' });
  const out: Record<string, string> = {};
  for (const { name, oklch } of entries) {
    const hex = (await page.evaluate(`(function (v) {
      var ctx = document.getElementById('probe').getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#000000';
      ctx.fillStyle = v;
      if (ctx.fillStyle === '#000000' && v.indexOf('black') === -1) { /* may legitimately be black */ }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      var d = ctx.getImageData(0, 0, 1, 1).data;
      if (d[3] === 0) return null;
      return '#' + [d[0], d[1], d[2]].map(function (c) { return c.toString(16).padStart(2, '0'); }).join('');
    })(${JSON.stringify(oklch)})`)) as string | null;
    if (!hex) throw new Error(`Chrome rejected ${name}: ${oklch}`);
    out[name] = hex;
  }
  return out;
});

const lines = Object.entries(resolved).map(([name, hex]) => `  '${name}': '${hex}',`).join('\n');
writeFileSync('src/tailwind-palette.ts', `// GENERATED — do not edit by hand. Regenerate with:
//   curl -sL https://raw.githubusercontent.com/tailwindlabs/tailwindcss/main/packages/tailwindcss/theme.css -o /tmp/tw-theme.css
//   npx tsx scripts/generate-tailwind-palette.ts /tmp/tw-theme.css
//
// Tailwind v4 default palette as sRGB hex — converted from the official oklch
// values by Chrome itself (see the generator), so these match what a real
// Tailwind v4 page computes. Used by the import intent mapper so palette
// classes (bg-red-500) style a bare snippet; they map to hex LITERALS, not
// $tokens — palette colors aren't design-system tokens (snapToTokens may
// still snap them to nearby brand tokens afterwards, with tie reporting).

export const TAILWIND_PALETTE: Record<string, string> = {
${lines}
};
`);

console.log(`Wrote src/tailwind-palette.ts with ${entries.length} entries.`);
await shutdown();
