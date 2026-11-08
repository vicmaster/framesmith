// canvas_evaluate's contrast check composites translucent colors.
// A translucent fill (rgba / #RRGGBBAA) is blended over the fills behind it,
// and a translucent text color over the resulting background, before the WCAG
// ratio is computed. Before this, the alpha was dropped: a selected-state tint
// of rgba(245,158,11,0.08) on a near-black panel was judged as solid amber
// (1.72:1, a false error; the real pair is 13.45:1).
//
// Usage: npx tsx test-contrast-alpha.ts

import './test-env.js';
import { evaluateCanvas } from './src/evaluate.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

function canvasOf(rootFill: string | undefined, layerFill: string | undefined, textColor: string): Canvas {
  const text: SceneNode = { id: 't1', name: 'label', type: 'text', content: 'Sample copy', color: textColor, fontSize: 16 };
  const layer: SceneNode = { id: 'layer', name: 'layer', type: 'frame', width: 200, height: 40, children: [text] };
  if (layerFill) layer.fill = layerFill;
  const root: SceneNode = { id: 'root', name: 'root', type: 'frame', width: 400, height: 200, children: [layer] };
  if (rootFill) root.fill = rootFill;
  return { id: 'c1', name: 'c', projectId: 'p', root, components: {}, variables: {}, createdAt: '', lastModified: '' } as Canvas;
}

async function contrastErrors(canvas: Canvas) {
  const result = await evaluateCanvas(canvas, { mode: 'fast', categories: ['color'] });
  return result.issues.filter((i) => i.category === 'color' && i.severity === 'error' && i.nodeId === 't1');
}

// 1. The viewer case: an 8% amber tint on a near-black panel.
let errs = await contrastErrors(canvasOf('#14110C', 'rgba(245, 158, 11, 0.08)', '#FDE68A'));
check('8% tint on a dark panel is not a false error', errs.length === 0, errs[0]?.message);

// 2. Same tint written as #RRGGBBAA.
errs = await contrastErrors(canvasOf('#14110C', '#F59E0B14', '#FDE68A'));
check('#RRGGBBAA tint composites too', errs.length === 0, errs[0]?.message);

// 3. A faint white wash over black still reads dark: dark text on it fails.
errs = await contrastErrors(canvasOf('#000000', 'rgba(255, 255, 255, 0.1)', '#222222'));
check('a 10% white wash over black is judged dark, so dark text fails', errs.length === 1);

// 4. A fully transparent fill is no background at all.
errs = await contrastErrors(canvasOf('#FFFFFF', 'rgba(0, 0, 0, 0)', '#333333'));
check('a fully transparent fill is skipped', errs.length === 0, errs[0]?.message);

// 5. Translucent text blends into its background.
errs = await contrastErrors(canvasOf('#FFFFFF', undefined, 'rgba(0, 0, 0, 0.3)'));
check('30% black text on white fails', errs.length === 1);

// 6. Translucent fills with no opaque fill behind them sit on the white page.
errs = await contrastErrors(canvasOf(undefined, 'rgba(0, 0, 0, 0.05)', '#FFFFFF'));
check('a 5% tint with nothing behind it is judged over the white page', errs.length === 1);

// 7. The message names the color it actually measured against.
errs = await contrastErrors(canvasOf('#000000', 'rgba(255, 255, 255, 0.1)', '#222222'));
check('the message shows the composited background', /composited/.test(errs[0]?.message ?? ''), errs[0]?.message);

// 8. The `transparent` keyword is see-through too.
errs = await contrastErrors(canvasOf('#FFFFFF', 'transparent', '#333333'));
check('a "transparent" fill is skipped', errs.length === 0, errs[0]?.message);

// 9. A fill the parser cannot read still paints: no check, as before.
errs = await contrastErrors(canvasOf('#FFFFFF', 'hsl(0, 0%, 10%)', '#333333'));
check('an unreadable fill stops the walk instead of measuring past it', errs.length === 0, errs[0]?.message);

// 10. Opaque pairs are unchanged.
errs = await contrastErrors(canvasOf('#FFFFFF', undefined, '#777777'));
check('opaque #777 on white still fails as before', errs.length === 1 && /4\.48:1/.test(errs[0].message), errs[0]?.message);

console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
