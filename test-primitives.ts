import './test-env.js';
// Phase 16 Slice C — input primitives (toggle / checkbox / radio / select).
// Covers: token-aware defaults vs neutral fallbacks (resolveVariables),
// checked/unchecked anatomy, explicit fill/stroke/color overrides, disabled
// opacity, select placeholder vs value, sizing, no fake-chrome false positive
// from radio groups (checkCliche), and a Chrome paint check.
//
// Usage: npx tsx test-primitives.ts

import puppeteer from 'puppeteer';
import { renderToHtml } from './src/renderer.js';
import { resolveVariables } from './src/variables.js';
import { evaluateCanvas } from './src/evaluate.js';
import type { Canvas, DesignVariables, SceneNode } from './src/types.js';

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const expect = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

const THEME: DesignVariables = { colors: { accent: '#B71421', border: '#3A3A3A', 'bg-surface': '#1E1E1E', 'text-primary': '#F5F5F5' } };

function renderResolved(node: SceneNode, vars: DesignVariables = {}): string {
  const root: SceneNode = { id: 'doc', type: 'document', fill: '#fff', children: [node] };
  return renderToHtml(resolveVariables(root, vars), 400, 100);
}

// ── 1. toggle ────────────────────────────────────────────────────────────────
{
  const on = renderResolved({ id: 't', type: 'toggle', checked: true }, THEME);
  expect('checked toggle track uses $accent', on.includes('background-color: #B71421'));
  expect('toggle has a white knob', on.includes('background-color: #FFFFFF') && on.includes('border-radius: 50%'));

  const off = renderResolved({ id: 't', type: 'toggle' }, THEME);
  expect('unchecked toggle track uses $border', off.includes('background-color: #3A3A3A'));

  const bare = renderResolved({ id: 't', type: 'toggle', checked: true });
  expect('unthemed checked toggle falls back to neutral accent', bare.includes('background-color: #2563EB'));

  const sized = renderResolved({ id: 't', type: 'toggle', checked: true, width: 60, height: 32 });
  expect('toggle respects width/height', sized.includes('width: 60px') && sized.includes('height: 32px') && sized.includes('border-radius: 16px'));

  const knobOn = renderResolved({ id: 't', type: 'toggle', checked: true });
  const knobOff = renderResolved({ id: 't', type: 'toggle' });
  const leftOf = (html: string) => html.match(/left: (\d+)px/)?.[1];
  expect('knob position differs by checked', leftOf(knobOn) !== leftOf(knobOff), `on=${leftOf(knobOn)} off=${leftOf(knobOff)}`);

  const override = renderResolved({ id: 't', type: 'toggle', checked: true, fill: '#00FF00' }, THEME);
  expect('explicit fill overrides the token default', override.includes('background-color: #00FF00'));
}

// ── 2. checkbox ──────────────────────────────────────────────────────────────
{
  const on = renderResolved({ id: 'c', type: 'checkbox', checked: true }, THEME);
  expect('checked checkbox fills accent + draws check', on.includes('background-color: #B71421') && on.includes('<svg') && on.includes('stroke="#FFFFFF"'));

  const off = renderResolved({ id: 'c', type: 'checkbox' }, THEME);
  expect('unchecked checkbox is transparent with border', off.includes('background-color: transparent') && off.includes('border: 1.5px solid #3A3A3A'));
  expect('unchecked checkbox has no check mark', !off.includes('<svg'));
}

// ── 3. radio ─────────────────────────────────────────────────────────────────
{
  const on = renderResolved({ id: 'r', type: 'radio', checked: true }, THEME);
  expect('checked radio: accent ring + dot', on.includes('border: 1.5px solid #B71421') && on.includes('background-color: #B71421'));

  const off = renderResolved({ id: 'r', type: 'radio' }, THEME);
  expect('unchecked radio: border ring, no dot', off.includes('border: 1.5px solid #3A3A3A') && (off.match(/border-radius: 50%/g) ?? []).length === 1);
}

// ── 4. select ────────────────────────────────────────────────────────────────
{
  const filled = renderResolved({ id: 's', type: 'select', value: 'Administrator' }, THEME);
  expect('select shows the value in text-primary', filled.includes('Administrator') && filled.includes('color: #F5F5F5'));
  expect('select uses surface + border tokens', filled.includes('background-color: #1E1E1E') && filled.includes('border: 1px solid #3A3A3A'));
  expect('select draws a chevron', filled.includes('chevron-down') || filled.includes('<svg'));

  const placeholder = renderResolved({ id: 's', type: 'select' }, THEME);
  expect('placeholder is muted', placeholder.includes('Select…') && placeholder.includes('color: #9CA3AF'));

  const wide = renderResolved({ id: 's', type: 'select', value: 'x', width: '100%' }, THEME);
  expect('select accepts string widths', wide.includes('width: 100%'));
  const fit = renderResolved({ id: 's', type: 'select', value: 'x' }, THEME);
  expect('select defaults to fit-content', fit.includes('width: fit-content'));
}

// ── 5. disabled + content safety ─────────────────────────────────────────────
{
  const disabled = renderResolved({ id: 't', type: 'toggle', checked: true, disabled: true }, THEME);
  expect('disabled control gets opacity 0.5', disabled.includes('opacity: 0.5'));

  const explicit = renderResolved({ id: 't', type: 'toggle', disabled: true, opacity: 0.8 }, THEME);
  expect('explicit opacity wins over disabled default', explicit.includes('opacity: 0.8') && !explicit.includes('opacity: 0.5'));

  const xss = renderResolved({ id: 's', type: 'select', value: '<script>alert(1)</script>' }, THEME);
  expect('select value is HTML-escaped', !xss.includes('<script>') && xss.includes('&lt;script&gt;'));
}

// ── 6. radio group does NOT trip the fake-chrome cliché tell ─────────────────
{
  const canvas = {
    id: 'c1', name: 'Radios', projectId: 'p',
    root: {
      id: 'doc', type: 'document', fill: '#FFFFFF', width: 800, height: 400, layout: 'vertical', gap: 12, padding: 32,
      children: [
        { id: 'r1', type: 'radio', checked: true },
        { id: 'r2', type: 'radio' },
        { id: 'r3', type: 'radio' },
        { id: 'r4', type: 'radio' },
      ],
    } as SceneNode,
    variables: {}, components: {},
  } as unknown as Canvas;
  const result = await evaluateCanvas(canvas, { mode: 'fast', categories: ['cliche'] });
  const fakeChrome = result.issues.filter((i) => (i as { tell?: string }).tell === 'fake-chrome');
  expect('4 radios do not flag fake-chrome', fakeChrome.length === 0, JSON.stringify(fakeChrome.map((i) => i.message)));
}

// ── 7. Chrome: controls paint at expected geometry ───────────────────────────
{
  const root: SceneNode = {
    id: 'doc', type: 'document', fill: '#fff', layout: 'horizontal', gap: 12, padding: 16, alignItems: 'center',
    children: [
      { id: 'tg', type: 'toggle', checked: true },
      { id: 'cb', type: 'checkbox', checked: true },
      { id: 'rd', type: 'radio', checked: true },
      { id: 'sl', type: 'select', value: 'Admin' },
    ],
  };
  const html = renderToHtml(resolveVariables(root, THEME), 400, 80);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const rects = await page.evaluate(`(function () {
      function r(id) {
        var el = document.querySelector('[data-node-id="' + id + '"]');
        if (!el) return null;
        var b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
      }
      return { tg: r('tg'), cb: r('cb'), rd: r('rd'), sl: r('sl') };
    })()`) as Record<string, { w: number; h: number } | null>;
    await page.close();
    expect('toggle paints 44×24', rects.tg?.w === 44 && rects.tg?.h === 24, JSON.stringify(rects.tg));
    expect('checkbox paints 18×18', rects.cb?.w === 18 && rects.cb?.h === 18, JSON.stringify(rects.cb));
    expect('radio paints 18×18', rects.rd?.w === 18 && rects.rd?.h === 18, JSON.stringify(rects.rd));
    expect('select paints fit-content (> 40px wide)', (rects.sl?.w ?? 0) > 40, JSON.stringify(rects.sl));
  } finally {
    await browser.close();
  }
}

let allPass = true;
for (const c of checks) {
  if (!c.ok) allPass = false;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(allPass ? 0 : 1);
