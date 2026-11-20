// Phase 25 slice C — validate the hand-rolled OKLCH math against Chrome's own
// oklch() parsing (the same readback trick scripts/generate-tailwind-palette.ts
// uses). For a spread of in-gamut OKLCH values, the browser's rendered RGB and
// our oklchToHex must agree within 2/255 per channel.
//
// Usage: npx tsx test/browser/test-color-system-readback.ts   (needs Chrome)

import '../env.js';
import { oklchToHex, hexToOklch } from '../../src/color-system.js';
import { withPage } from '../../src/screenshot.js';
import { shutdown } from '../../src/screenshot.js';
import { parseColor } from '../../src/evaluate.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// In-gamut spread: every hue quadrant, light + mid + dark, modest chroma.
const SAMPLES: Array<{ l: number; c: number; h: number }> = [];
for (const l of [0.35, 0.65, 0.9]) {
  for (const h of [27, 75, 150, 220, 300]) {
    for (const c of [0.04, 0.09]) SAMPLES.push({ l, c, h });
  }
}

try {
  // Chrome preserves oklch() in computed styles now — paint each color into a
  // 1×1 2D canvas and read the sRGB pixel back instead (the same technique as
  // scripts/generate-tailwind-palette.ts).
  const browserRgb = await withPage(async (page) => {
    await page.setContent('<canvas id="probe" width="1" height="1"></canvas>', { waitUntil: 'domcontentloaded' });
    const colors = SAMPLES.map((s) => `oklch(${s.l} ${s.c} ${s.h})`);
    return page.evaluate(`(${`function (colors) {
      var ctx = document.getElementById('probe').getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      var out = [];
      for (var i = 0; i < colors.length; i++) {
        ctx.fillStyle = colors[i];
        ctx.fillRect(0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        out.push('rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')');
      }
      return out;
    }`})(${JSON.stringify(colors)})`) as Promise<string[]>;
  });

  // Compare only samples our math did NOT gamut-clip (round-tripped chroma
  // stays put): browsers use their own gamut-mapping for out-of-range colors,
  // so clipped samples legitimately differ. The point here is the CONVERSION
  // math, and unclipped values must match Chrome pixel-for-pixel.
  let worst = 0;
  let worstAt = '';
  let compared = 0;
  SAMPLES.forEach((s, i) => {
    const oursHex = oklchToHex(s);
    if (Math.abs(hexToOklch(oursHex).c - s.c) > 0.005) return; // clipped — skip
    const chrome = parseColor(browserRgb[i]);
    const ours = parseColor(oursHex);
    if (!chrome || !ours) { allPass = false; return; }
    compared++;
    const delta = Math.max(...ours.map((c, j) => Math.abs(c - chrome[j])));
    if (delta > worst) { worst = delta; worstAt = `oklch(${s.l} ${s.c} ${s.h}) ours ${oursHex} vs chrome ${browserRgb[i]}`; }
  });
  check('all samples parsed', browserRgb.length === SAMPLES.length && browserRgb.every((c) => c.startsWith('rgb')));
  check('enough in-gamut samples to be meaningful', compared >= 12, String(compared));
  check(`hand-rolled OKLCH agrees with Chrome within 2/255 (${compared} in-gamut samples)`, worst <= 2, `worst Δ ${worst} at ${worstAt}`);
} finally {
  await shutdown();
}

console.log(allPass ? '\nColor-system readback validation passed.' : '\nSOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
