// Phase 30 slice C — the mobile ruleset, fast mode: each rule's positive and
// negative fixtures from the spec's FR-C1..C8 rows and the slice C build
// contract, the stress engine's mobile behaviour, the directive's type note,
// and the real tool handlers over MCP stdio. Detailed mode and canvas_stress
// need Chrome and live in test-mobile-rules-detailed.ts.
//
// Usage: npx tsx test-mobile-rules.ts

import './test-env.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createCanvas } from './src/scene-graph.js';
import { parseAndExecute } from './src/operations.js';
import { evaluateCanvas, type EvaluationIssue } from './src/evaluate.js';
import { buildEvaluateDirective } from './src/directive.js';
import { applyPerturbation } from './src/stress.js';
import { fontPx, proseWords } from './src/mobile-rules.js';
import { renderedPaddingPx, renderToHtml } from './src/renderer.js';
import type { Canvas, SceneNode } from './src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

/** A phone canvas: declared mobile, 390×844, root safeArea unless `bare`. */
function phone(ops: string, opts: { bare?: boolean; type?: 'web' | 'mobile' | 'none'; width?: number; height?: number; variables?: Canvas['variables'] } = {}): Canvas {
  const type = opts.type ?? 'mobile';
  const c = type === 'mobile'
    ? createCanvas('phone', undefined, { ...(opts.width ? { width: opts.width } : {}), ...(opts.height ? { height: opts.height } : {}) }, { type: 'mobile' })
    : createCanvas('phone', undefined, { width: opts.width ?? 390, height: opts.height ?? 844 }, type === 'web' ? { type: 'web' } : undefined);
  if (opts.bare) delete c.root.safeArea;
  if (opts.variables) c.variables = { ...c.variables, ...opts.variables };
  parseAndExecute(c.root, ops, c);
  return c;
}

async function issues(c: Canvas, rule?: string, mode: 'fast' | 'detailed' = 'fast'): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(c, { mode });
  return r.issues.filter((i) => (rule ? i.rule === rule : i.rule !== undefined));
}
const show = (list: EvaluationIssue[]) => JSON.stringify(list.map((i) => `${i.severity} ${i.rule} ${i.nodeId}: ${i.message.slice(0, 70)}`));

// ── measurement helpers ───────────────────────────────────────────────────
{
  console.log('── measurement ──');
  check('padding under 32 renders as authored', renderedPaddingPx(24, 390) === 24);
  check('48px padding renders 13px on a 390 artboard', Math.round(renderedPaddingPx(48, 390)) === 13);
  check('48px padding renders 48 at 1440', renderedPaddingPx(48, 1440) === 48);
  check('fontPx: number, px, rem, clamp min, unresolved ref', fontPx(12) === 12 && fontPx('12px') === 12 && fontPx('1rem') === 16
    && fontPx('clamp(1rem, 0.9rem + 0.5vw, 1.25rem)') === 16 && fontPx('$missing') === 14 && fontPx(undefined) === undefined);
  check('proseWords: a metrics line is not prose', proseWords('5.2 mi · 1h 12m · 340 ft') === 2, String(proseWords('5.2 mi · 1h 12m · 340 ft')));
  check('proseWords: CJK counts one word per two characters', proseWords('今日は良い天気ですね') === 5);
}

// ── FR-C1 mobile-touch-target ─────────────────────────────────────────────
{
  console.log('\n── mobile-touch-target ──');
  const card = `f=I("document", { type: "frame", layout: "vertical", padding: 12 })
I(f, { type: "text", content: "Remember me" })
I(f, { type: "checkbox", width: 32, height: 32 })`;
  const m = await issues(phone(card), 'mobile-touch-target');
  check('32px control in a 12px-padded frame on mobile → error', m.length === 1 && m[0].severity === 'error' && m[0].category === 'usability' && m[0].message.includes('44px'), show(m));
  const w = await evaluateCanvas(phone(card, { type: 'web' }), { mode: 'fast', categories: ['usability'] });
  check('same canvas declared web → only the unchanged touch-first info', w.issues.length === 1 && w.issues[0].severity === 'info' && w.issues[0].rule === undefined && buildEvaluateDirective(w).ready, JSON.stringify(w.issues.map((i) => i.message)));

  const row44 = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 44, width: "100%" })
I(r, { type: "text", content: "Wi-Fi" })
I(r, { type: "toggle", checked: true })`), 'mobile-touch-target');
  check('toggle alone in a 44px row → passes', row44.length === 0, show(row44));

  const row56 = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 56, padding: [0, 16], alignItems: "center", width: "100%" })
I(r, { type: "text", content: "Notifications" })
I(r, { type: "toggle" })`), 'mobile-touch-target');
  check('toggle in a 56px settings row → passes (the row is the target)', row56.length === 0, show(row56));

  const login = await issues(phone(`c=I("document", { type: "frame", layout: "vertical", padding: 20 })
I(c, { type: "text", content: "Sign in", fontSize: 22 })
I(c, { type: "text", content: "Use the email you signed up with." })
I(c, { type: "checkbox", width: 18, height: 18 })`), 'mobile-touch-target');
  check('lone checkbox in a padded card → error (a card is not its row)', login.length === 1, show(login));

  const scaled = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", padding: [32, 16] })
I(r, { type: "text", content: "Sync" })
I(r, { type: "toggle" })`), 'mobile-touch-target');
  check('row padding 32 renders ~9px on a phone → toggle row is 41px → error', scaled.length === 1, show(scaled));

  const stretched = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 44 })
I(r, { type: "text", content: "Remember me" })
I(r, { type: "checkbox", width: 18, height: 18 })`), 'mobile-touch-target');
  check('a width-less 44px row in a vertical parent stretches full width → passes (the hint works verbatim)', stretched.length === 0, show(stretched));

  // A stretching row takes its host's width, never more (rendered widths in
  // parentheses: all below 44, so detailed rendering agrees).
  const narrowHost = await issues(phone(`c=I("document", { type: "frame", layout: "vertical", width: 40 })
r=I(c, { type: "frame", layout: "horizontal", height: 44 })
I(r, { type: "checkbox", width: 18, height: 18 })`), 'mobile-touch-target');
  check('row stretching inside a 40px column is 40 wide → error (40×44)', narrowHost.length === 1 && narrowHost[0].message.includes('40×44'), show(narrowHost));
  const hugHost = phone(`c=I("document", { type: "frame", layout: "vertical" })
r=I(c, { type: "frame", layout: "horizontal", height: 44 })
I(r, { type: "checkbox", width: 18, height: 18 })`);
  hugHost.root.alignItems = 'center';
  const hugI = await issues(hugHost, 'mobile-touch-target');
  check('row in a host shrink-wrapped by a centring root → error (18×44)', hugI.length === 1, show(hugI));
  const inRow = await issues(phone(`o=I("document", { type: "frame", layout: "horizontal" })
c=I(o, { type: "frame", layout: "vertical" })
r=I(c, { type: "frame", layout: "horizontal", height: 44 })
I(r, { type: "checkbox", width: 18, height: 18 })`), 'mobile-touch-target');
  check('row in a width-less column inside a horizontal parent → error (18×44)', inRow.length === 1, show(inRow));
  const absRow = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 44, position: "absolute", x: 16, y: 100 })
I(r, { type: "checkbox", width: 18, height: 18 })`), 'mobile-touch-target');
  check('an absolute row never stretches → error (18×44)', absRow.length === 1, show(absRow));

  const fullHeight = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", width: "100%", height: "100%" })
I(r, { type: "text", content: "Remember me" })
I(r, { type: "checkbox", width: 18, height: 18 })`), 'mobile-touch-target');
  check('a full-HEIGHT row says nothing about its height → still an error', fullHeight.length === 1 && fullHeight[0].message.includes('390×18'), show(fullHeight));

  const two = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 56 })
I(r, { type: "text", content: "Pair" })
I(r, { type: "checkbox", width: 24, height: 24 })
I(r, { type: "checkbox", width: 24, height: 24 })`), 'mobile-touch-target');
  check('two controls sharing a row → both measured bare', two.length === 2, show(two));
}

// ── FR-C2 mobile-handbuilt-target ─────────────────────────────────────────
{
  console.log('\n── mobile-handbuilt-target ──');
  const c = phone(`a=I("document", { type: "frame", width: 40, height: 40, alignItems: "center", justifyContent: "center" })
I(a, { type: "icon", icon: "bell" })
b=I("document", { type: "frame", width: 44, height: 44 })
I(b, { type: "icon", icon: "bell" })
t=I("document", { type: "frame", layout: "vertical", width: 56, height: 48 })
I(t, { type: "icon", icon: "house" })
I(t, { type: "text", content: "Home" })
s=I("document", { type: "frame", layout: "horizontal", height: 32 })
I(s, { type: "icon", icon: "plus" })
I(s, { type: "text", content: "Add item" })
col=I("document", { type: "frame", layout: "vertical", width: 74 })
circ=I(col, { type: "frame", width: 40, height: 40 })
I(circ, { type: "icon", icon: "play" })
I(col, { type: "text", content: "Start" })
chip=I("document", { type: "frame", layout: "horizontal", height: 24 })
I(chip, { type: "icon", icon: "flame" })
I(chip, { type: "text", content: "Five day streak so far" })
hug=I("document", { type: "frame", padding: 8 })
I(hug, { type: "icon", icon: "x", iconSize: 20 })`);
  const found = await issues(c, 'mobile-handbuilt-target');
  const byIndex = (k: number) => found.some((i) => i.nodeId === c.root.children![k].id);
  check('40×40 icon-only frame → info', byIndex(0) && found.every((i) => i.severity === 'info'), show(found));
  check('44×44 icon frame and 56×48 tab item → nothing', !byIndex(1) && !byIndex(2));
  check('32px-tall icon + short label → info', byIndex(3));
  check('outermost tap-shaped frame only: a column with unknown height reports nothing, its 40px circle stays silent', !byIndex(4) && !found.some((i) => i.nodeId === c.root.children![4].children![0].id));
  check('icon + a five-word label is not tap-shaped', !byIndex(5));
  check('hug-sized icon frame: 20 + 2×8 = 36 → info', byIndex(6), show(found));
  check('exactly three infos', found.length === 3, show(found));
  const web = await issues(phone(`a=I("document", { type: "frame", width: 40, height: 40 })
I(a, { type: "icon", icon: "bell" })`, { type: 'web' }), 'mobile-handbuilt-target');
  check('web canvas → no handbuilt infos', web.length === 0);
}

// ── FR-C3 mobile-safe-area (fast) ─────────────────────────────────────────
{
  console.log('\n── mobile-safe-area (fast) ──');
  const flow = `f=I("document", { type: "frame", layout: "vertical", gap: 12 })
I(f, { type: "text", content: "Today" })
I(f, { type: "text", content: "Nothing planned." })`;
  const safe = await issues(phone(flow), 'mobile-safe-area');
  check('default path (root safeArea): in-flow content → clean', safe.length === 0, show(safe));

  const abs = phone(`${flow}
I("document", { type: "text", content: "Offline", position: "absolute", x: 16, y: 10 })`);
  const absI = await issues(abs, 'mobile-safe-area');
  check('absolute text at y 10 → warning', absI.length === 1 && absI[0].severity === 'warning' && absI[0].category === 'usability', show(absI));

  const low = await issues(phone(`${flow}
I("document", { type: "text", content: "Saved", position: "absolute", x: 16, y: 820 })`), 'mobile-safe-area');
  check('absolute text reaching the bottom inset → warning', low.length === 1 && low[0].message.includes('bottom'), show(low));

  const bare = await issues(phone(flow, { bare: true }), 'mobile-safe-area');
  check('no safeArea, content at the top and the end → two warnings naming the safeArea op', bare.length === 2 && bare.every((i) => i.suggestion?.includes('safeArea: { top: 47, bottom: 34 }')), show(bare));

  const spaced = await issues(phone(`I("document", { type: "frame", height: 47 })
${flow}
I("document", { type: "frame", height: 34 })`, { bare: true }), 'mobile-safe-area');
  check('no safeArea, spacer frames of the inset heights → clean', spaced.length === 0, show(spaced));

  const padSpacer = await issues(phone(`I("document", { type: "frame", padding: [24, 0] })
${flow}
I("document", { type: "frame", minHeight: 34 })`, { bare: true }), 'mobile-safe-area');
  check('spacers sized by padding (24+24) and minHeight → clean', padSpacer.length === 0, show(padSpacer));

  const bigPad = phone(flow, { bare: true });
  bigPad.root.padding = [64, 0, 64, 0];
  const bigPadI = await issues(bigPad, 'mobile-safe-area');
  check('root padding 64 renders ~17px on a phone → still warns', bigPadI.length === 2, show(bigPadI));

  const hero = await issues(phone(`I("document", { type: "image", src: "https://example.com/hero.jpg", width: "100%", height: 220 })
${flow}
I("document", { type: "frame", height: 34 })`, { bare: true }), 'mobile-safe-area');
  check('full-width hero image under the status bar, text below the inset → clean', hero.length === 0, show(hero));

  const absHero = phone(`I("document", { type: "image", src: "https://example.com/hero.jpg", position: "absolute", x: 0, y: 0, width: "100%", height: 200 })
${flow}`);
  absHero.root.padding = 16;
  const absHeroI = await issues(absHero, 'mobile-safe-area');
  check('absolute full-width hero in a padded root is background, not content → clean', absHeroI.length === 0, show(absHeroI));

  const smallAbs = phone(`${flow}
a=I("document", { type: "frame", position: "absolute", x: 16, y: 10, width: 40, height: 40 })
I(a, { type: "image", src: "https://example.com/avatar.jpg", position: "absolute", x: 0, y: 0, width: "100%", height: 40 })`);
  smallAbs.root.padding = [0, 16];
  const smallAbsI = await issues(smallAbs, 'mobile-safe-area');
  check('a small absolute image inside a 40px absolute frame is content → warning', smallAbsI.length === 1 && smallAbsI[0].message.includes('top'), show(smallAbsI));

  const row = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", padding: [8, 16] })
I(r, { type: "text", content: "Back" })
I(r, { type: "text", content: "Edit" })
${flow}
I("document", { type: "frame", height: 34 })`, { bare: true }), 'mobile-safe-area');
  check('horizontal row at the top: its content sits at the row padding → warning', row.length === 1 && row[0].message.includes('top'), show(row));

  const overlay = phone(`${flow}
o=I("document", { type: "frame", layout: "vertical", position: "absolute", x: 0, y: 0, width: 390, height: 844 })
I(o, { type: "text", content: "Welcome back" })`);
  const overlayI = await issues(overlay, 'mobile-safe-area');
  check('absolute full-screen overlay with unpadded content → warning naming padding inside the overlay', overlayI.length === 2 && overlayI.every((i) => i.suggestion?.startsWith('Pad')), show(overlayI));

  const nested = await issues(phone(`${flow}
w=I("document", { type: "frame", layout: "vertical" })
I(w, { type: "text", content: "Badge", position: "absolute", x: 0, y: 0 })`), 'mobile-safe-area');
  check('absolute content inside an in-flow frame → one info naming detailed mode', nested.length === 1 && nested[0].severity === 'info' && nested[0].suggestion?.includes('detailed'), show(nested));
}

// ── cost: the walks stay near-linear in nesting depth ─────────────────────
{
  console.log('\n── cost ──');
  const chain = (depth: number): Canvas => {
    const c = phone('', { bare: true });
    let parent = c.root;
    for (let k = 0; k < depth; k++) {
      const f = { id: `d${depth}-${k}`, type: 'frame', layout: 'vertical', children: [] } as unknown as SceneNode;
      parent.children = [...(parent.children ?? []), f];
      parent = f;
    }
    parent.children = [{ id: `d${depth}-leaf`, type: 'icon', icon: 'bell' } as SceneNode];
    return c;
  };
  const time = async (c: Canvas) => {
    const t = performance.now();
    await evaluateCanvas(c, { mode: 'fast', categories: ['usability'] });
    return performance.now() - t;
  };
  await time(chain(50)); // warm up
  const small = Math.min(await time(chain(150)), await time(chain(150)));
  const large = Math.min(await time(chain(600)), await time(chain(600)));
  check('a 4× deeper chain costs well under 16× (no cubic walk)', large < small * 16, `${small.toFixed(1)}ms → ${large.toFixed(1)}ms`);
}

// ── FR-C4 mobile-type-floor ───────────────────────────────────────────────
{
  console.log('\n── mobile-type-floor ──');
  const typo = (entries: Record<string, number>) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { fontSize: v }]));
  const c = phone(`I("document", { type: "text", content: "Your run synced and your weekly summary is ready to read.", fontSize: "$text-sm" })
I("document", { type: "text", content: "Updated 2 minutes ago", fontSize: 13 })
I("document", { type: "text", content: "Mon", fontSize: 10 })
I("document", { type: "text", content: "5.2 mi · 1h 12m · 340 ft", fontSize: 12 })
I("document", { type: "text", content: "This is a long caption line that runs on for twelve words or so.", fontSize: 14 })`,
  { variables: { typography: typo({ 'text-sm': 12, body: 14 }) } });
  const found = await issues(c, 'mobile-type-floor');
  const at = (k: number) => found.find((i) => i.nodeId === c.root.children![k].id);
  check('12px paragraph via $text-sm → warning', at(0)?.severity === 'warning' && at(0)?.category === 'typography', show(found));
  check('13px timestamp line → nothing', !at(1));
  check('10px label → warning (below 11)', at(2)?.severity === 'warning' && at(2)!.message.includes('11px'));
  check('12px metrics line → nothing (two prose words)', !at(3));
  check('14px twelve-word copy → info', at(4)?.severity === 'info');
  check('workspace body 14 that no node references → no finding of its own', found.length === 3, show(found));

  const body = phone(`I("document", { type: "text", content: "Hi", fontSize: "$body" })`, { variables: { typography: typo({ body: 14 }) } });
  const bodyI = await issues(body, 'mobile-type-floor');
  check('a node using $body at 14 → warning naming the 16px floor', bodyI.length === 1 && bodyI[0].message.includes('16px'), show(bodyI));
  const ok = await issues(phone(`I("document", { type: "text", content: "Hi", fontSize: "$body" })`, { variables: { typography: typo({ body: 17 }) } }), 'mobile-type-floor');
  check('$body at 17 → clean', ok.length === 0);
}

// ── FR-C5 mobile-one-column ───────────────────────────────────────────────
{
  console.log('\n── mobile-one-column ──');
  const c = phone(`r=I("document", { type: "frame", layout: "horizontal", gap: 12 })
a=I(r, { type: "frame", layout: "vertical" })
I(a, { type: "text", content: "How we rebuilt the route planner from the ground up" })
b=I(r, { type: "frame", layout: "vertical" })
I(b, { type: "text", content: "Five habits that keep long runs feeling easy and fun" })
q=I("document", { type: "frame", layout: "horizontal" })
I(q, { type: "text", content: "Start" })
I(q, { type: "text", content: "Routes" })
I(q, { type: "text", content: "Plan" })
I(q, { type: "text", content: "Gear" })
s=I("document", { type: "frame", layout: "horizontal" })
I(s, { type: "text", content: "42.8 km" })
I(s, { type: "text", content: "5:12 /km" })`);
  const found = await issues(c, 'mobile-one-column');
  check('two side-by-side article cards → one info on the row', found.length === 1 && found[0].nodeId === c.root.children![0].id && found[0].severity === 'info', show(found));
}

// ── FR-C6 mobile-artboard ─────────────────────────────────────────────────
{
  console.log('\n── mobile-artboard ──');
  const content = 'I("document", { type: "text", content: "Hello" })';
  const undeclared = await issues(phone(content, { type: 'none' }), 'mobile-artboard');
  check('390 canvas, no type → warning (structure)', undeclared.length === 1 && undeclared[0].severity === 'warning' && undeclared[0].category === 'structure' && undeclared[0].suggestion!.includes('canvas_set_type'), show(undeclared));
  const web = await issues(phone(content, { type: 'web' }), 'mobile-artboard');
  check('390 canvas declared web → info only', web.length === 1 && web[0].severity === 'info', show(web));
  const wide = await issues(phone(content, { width: 1440, height: 900 }), 'mobile-artboard');
  check('mobile canvas at 1440 → warning', wide.length === 1 && wide[0].severity === 'warning', show(wide));
  const odd = await issues(phone(content, { width: 393, height: 852 }), 'mobile-artboard');
  check('mobile canvas at 393×852 → info', odd.length === 1 && odd[0].severity === 'info', show(odd));
  const exact = await issues(phone(content), 'mobile-artboard');
  check('mobile canvas at 390×844 → nothing', exact.length === 0);
  const desktop = await issues(phone(content, { type: 'none', width: 1440, height: 900 }), 'mobile-artboard');
  check('undeclared 1440 canvas → nothing', desktop.length === 0);
  const chrome = phone(content, { type: 'none', width: 1440, height: 900 });
  chrome.root.children!.push({ id: 'tb', type: 'tab-bar' as SceneNode['type'] });
  const chromeI = await issues(chrome, 'mobile-artboard');
  check('undeclared wide canvas holding a mobile chrome primitive → warning', chromeI.length === 1 && chromeI[0].severity === 'warning', show(chromeI));

  const r = await evaluateCanvas(phone(content, { type: 'none' }), { mode: 'fast' });
  check('undeclared phone canvas: directive NOT READY', !buildEvaluateDirective(r).ready);
}

// ── rule gating ───────────────────────────────────────────────────────────
{
  console.log('\n── gating ──');
  const c = phone(`I("document", { type: "text", content: "Mon", fontSize: 9, position: "absolute", x: 0, y: 4 })`, { type: 'web' });
  const web = await issues(c);
  check('web canvas: only mobile-artboard can fire', web.every((i) => i.rule === 'mobile-artboard'), show(web));
  const filtered = await evaluateCanvas(phone('I("document", { type: "text", content: "x", fontSize: 9 })'), { mode: 'fast', categories: ['usability'] });
  check('a rule runs only with its category: no type-floor under categories [usability]', !filtered.issues.some((i) => i.rule === 'mobile-type-floor'));
}

// ── FR-C8 stress on mobile ────────────────────────────────────────────────
{
  console.log('\n── stress ──');
  let n = 0;
  const id = () => `s${++n}`;
  const text = (content: string): SceneNode => ({ id: id(), type: 'text', content });
  const row = (title: string): SceneNode => ({ id: id(), type: 'list-row' as SceneNode['type'], title, subtitle: 'Yesterday afternoon', trailing: { text: 'Open' } } as unknown as SceneNode);
  const tabs = { id: id(), type: 'tab-bar', items: [{ icon: 'house', label: 'Home' }, { icon: 'map', label: 'Routes' }] } as unknown as SceneNode;
  const list = { id: id(), type: 'frame', children: [row('Cedar Ridge loop'), row('Riverside tempo'), row('Old Mill recovery')] } as SceneNode;
  const root: SceneNode = { id: 'document', type: 'document', children: [text('FM'), text('Good morning'), list, tabs] } as SceneNode;
  const props = (r: SceneNode, k: number): Record<string, unknown> => (r.children![2].children![k] as unknown as Record<string, unknown>);

  const mob = applyPerturbation('long-text', root, { type: 'mobile' });
  check('mobile long-text: "FM" (≤3 chars) untouched', mob.root.children![0].content === 'FM');
  check('mobile long-text: list-row titles, subtitles and trailing text perturbed', String(props(mob.root, 0).title).length > 40 && String(props(mob.root, 1).subtitle).length > 40 && String((props(mob.root, 2).trailing as { text: string }).text).length > 20);
  const tabLabels = (r: SceneNode) => (r.children![3] as unknown as { items: { label: string }[] }).items.map((i) => i.label);
  check('mobile long-text: tab labels (fixed vocabulary) untouched', JSON.stringify(tabLabels(mob.root)) === '["Home","Routes"]');
  const i18n = applyPerturbation('i18n', root, { type: 'mobile' });
  check('mobile i18n: tab labels perturbed', tabLabels(i18n.root).every((l) => l.length > 6), JSON.stringify(tabLabels(i18n.root)));
  const web = applyPerturbation('long-text', root, { type: 'web' });
  check('web long-text: "FM" perturbed as before', (web.root.children![0].content as string).length > 10);
  check('the source tree is never mutated', root.children![0].content === 'FM' && props(root, 0).title === 'Cedar Ridge loop');

  const empty = applyPerturbation('empty', root, { type: 'mobile' });
  check('empty: a run of list-rows is removed, touched = its parent', empty.root.children![2].children!.length === 0 && empty.touched.includes(list.id));
  const many = applyPerturbation('many', root, { type: 'mobile' });
  check('many: the run ×3 with suffixed ids', many.root.children![2].children!.length === 9 && many.root.children![2].children!.some((r) => r.id.endsWith('-x2')));
  const lone = { id: 'document', type: 'document', children: [row('Only row')] } as SceneNode;
  check('a single list-row is not a list', applyPerturbation('empty', lone).touched.length === 0);

  // The directive: a type change makes the record stale for the note only.
  const clean = { overallScore: 100, issues: [], categories: [], summary: '', stats: {} } as never;
  const fragileOtherType = buildEvaluateDirective(clean, 0, { warnings: 2, current: false, ranAsType: 'mobile' });
  check('FRAGILE then a type change: still NOT READY, the note names the earlier type', !fragileOtherType.ready && fragileOtherType.directive.includes('earlier type ("mobile")'), fragileOtherType.directive);
  const fragileEdit = buildEvaluateDirective(clean, 0, { warnings: 2, current: false });
  check('FRAGILE then an edit: the note says earlier version', fragileEdit.directive.includes('earlier version'));
}

// ── boundaries (from the slice C mutation round) ───────────────────────────
// Each check below killed a mutant the rule fixtures above let survive.
async function iss(c: Canvas, rule: string, mode: 'fast' | 'detailed' = 'fast', categories?: string[]): Promise<EvaluationIssue[]> {
  const r = await evaluateCanvas(c, { mode, ...(categories ? { categories: categories as never } : {}) });
  return r.issues.filter((i) => i.rule === rule);
}
const T = (content: string, fs: number) => `I("document", { type: "text", content: "${content}", fontSize: ${fs} })`;
const WORDS = ['alpha', 'bravo', 'cedar', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike'];
const W = (n: number) => WORDS.slice(0, n).join(' ');
{
  console.log('\n── boundaries ──');
// --- type floor / prose boundaries
check('G-F1 11px label: no type-floor issue (M31)', (await iss(phone(T('Mon', 11)), 'mobile-type-floor')).length === 0);
check('G-F2 $body at exactly 16: clean (M32)', (await iss((() => { const c = phone('I("document", { type: "text", content: "Hi", fontSize: "$body" })'); c.variables = { ...c.variables, typography: { body: { fontSize: 16 } } } as never; return c; })(), 'mobile-type-floor')).length === 0);
check('G-F3 13px 6-word prose: no issue (M04,M34)', (await iss(phone(T(W(6), 13)), 'mobile-type-floor')).length === 0);
check('G-F4 12px 5-word prose: warning (M06)', (await iss(phone(T(W(5), 12)), 'mobile-type-floor')).length === 1);
check('G-F5 12px 4-word prose: none (M05)', (await iss(phone(T(W(4), 12)), 'mobile-type-floor')).length === 0);
check('G-F6 14px exactly 12 words: info (M07)', (await iss(phone(T(W(12), 14)), 'mobile-type-floor')).length === 1);
check('G-F7 14px 11 words: none (M08)', (await iss(phone(T(W(11), 14)), 'mobile-type-floor')).length === 0);

// --- one-column
const row2 = (a: string, b: string, layout = 'horizontal') => `r=I("document", { type: "frame", layout: "${layout}" })\na=I(r, { type: "frame" })\nI(a, { type: "text", content: "${a}" })\nb=I(r, { type: "frame" })\nI(b, { type: "text", content: "${b}" })`;
check('G-C1 avatar + one prose block row: no one-column (M35)', (await iss(phone(row2('JD', W(10))), 'mobile-one-column')).length === 0);
check('G-C2 grid with two prose blocks: info (M36)', (await iss(phone(row2(W(10), W(10), 'grid')), 'mobile-one-column')).length === 1);
check('G-C3 two blocks of exactly 8 words: info (M09)', (await iss(phone(row2(W(8), W(8))), 'mobile-one-column')).length === 1);
check('G-C4 web canvas with two prose columns: no one-column (E17)', (await iss(phone(row2(W(10), W(10)), { type: 'web' }), 'mobile-one-column')).length === 0);

// --- handbuilt
check('G-H1 icon + exactly 3-word label, 32 tall: info (M10)', (await iss(phone('s=I("document", { type: "frame", layout: "horizontal", height: 32 })\nI(s, { type: "icon", icon: "plus" })\nI(s, { type: "text", content: "Add new item" })'), 'mobile-handbuilt-target')).length === 1);
check('G-H2 icon + 4-word label: not tap shaped (M39-ish)', (await iss(phone('s=I("document", { type: "frame", layout: "horizontal", height: 32 })\nI(s, { type: "icon", icon: "plus" })\nI(s, { type: "text", content: "Add a new item" })'), 'mobile-handbuilt-target')).length === 0);
check('G-H5 icon + two short texts: not tap shaped (M39)', (await iss(phone('s=I("document", { type: "frame", layout: "horizontal", height: 32 })\nI(s, { type: "icon", icon: "plus" })\nI(s, { type: "text", content: "Add" })\nI(s, { type: "text", content: "item" })'), 'mobile-handbuilt-target')).length === 0);
check('G-H3 hug icon frame, default icon 24 + padding 10 = 44: none (M38)', (await iss(phone('h=I("document", { type: "frame", padding: 10 })\nI(h, { type: "icon", icon: "x" })'), 'mobile-handbuilt-target')).length === 0);
check('G-H4 3-value padding [0,12,0] height 44 icon-only: none (M17)', await (async () => { const c = phone('h=I("document", { type: "frame", height: 44 })\nI(h, { type: "icon", icon: "x" })'); (c.root.children![0] as SceneNode).padding = [0, 12, 0] as never; return (await iss(c, 'mobile-handbuilt-target')).length === 0; })());

// --- artboard
check('G-A1 mobile 390x900: info (M40)', (await iss(phone(T('x', 16), { height: 900 }), 'mobile-artboard')).length === 1);
check('G-A2 mobile at exactly 500: warning (M41)', (await iss(phone(T('x', 16), { width: 500, height: 844 }), 'mobile-artboard')).some((i) => i.severity === 'warning'));
check('G-A3 mobile at 480 (<500): info only (M02)', (await iss(phone(T('x', 16), { width: 480, height: 844 }), 'mobile-artboard')).every((i) => i.severity === 'info'));

// --- touch target
const tt = async (ops: string) => (await iss(phone(ops), 'mobile-touch-target')).length;
check('G-T1 toggle > vertical wrapper > 44px row: passes via hop 2 (E01)', await tt('r=I("document", { type: "frame", layout: "horizontal", height: 44, width: "100%" })\nw=I(r, { type: "frame", layout: "vertical" })\nI(w, { type: "toggle" })') === 0);
check('G-T2 3 levels deep: row out of reach → error (E02)', await tt('r=I("document", { type: "frame", layout: "horizontal", height: 44, width: "100%" })\na=I(r, { type: "frame", layout: "vertical" })\nb=I(a, { type: "frame", layout: "vertical" })\nI(b, { type: "checkbox", width: 24, height: 24 })') === 1);
check('G-T3 row minHeight 44, no height: passes (E06)', await tt('r=I("document", { type: "frame", layout: "horizontal", minHeight: 44, width: "100%" })\nI(r, { type: "checkbox", width: 24, height: 24 })') === 0);
check('G-T4 row width fill_container height 44: passes (E05)', await tt('r=I("document", { type: "frame", layout: "horizontal", height: 44, width: "fill_container" })\nI(r, { type: "checkbox", width: 24, height: 24 })') === 0);
check('G-T5 two checkboxes in a wide 56 row: both error (E04)', await tt('r=I("document", { type: "frame", layout: "horizontal", height: 56, width: "100%" })\nI(r, { type: "checkbox", width: 24, height: 24 })\nI(r, { type: "checkbox", width: 24, height: 24 })') === 2);
{
  const r = await evaluateCanvas(phone('f=I("document", { type: "frame", layout: "vertical", padding: 12 })\nI(f, { type: "text", content: "Remember me" })\nI(f, { type: "checkbox", width: 32, height: 32 })'), { mode: 'fast', categories: ['usability'] });
  const u = r.categories.find((c) => c.name === 'usability')!;
  check('G-T6 touch error costs 25 points: usability 75 (E10)', u.score === 75, String(u.score));
}
{
  const r = await evaluateCanvas(phone('a=I("document", { type: "frame", width: 40, height: 40 })\nI(a, { type: "icon", icon: "bell" })'), { mode: 'fast', categories: ['usability'] });
  check('G-T7 info-only handbuilt finding costs 0: usability 100 (E13)', r.categories.find((c) => c.name === 'usability')!.score === 100);
}
{
  const r = await evaluateCanvas(phone(T('Mon', 9)), { mode: 'fast', categories: ['typography'] });
  const t = r.categories.find((c) => c.name === 'typography')!;
  const base = await evaluateCanvas(phone(T('Mon', 16)), { mode: 'fast', categories: ['typography'] });
  check('G-T8 type-floor warning costs 10 vs the same text at 16 (E12)', base.categories[0].score - t.score >= 10, `${base.categories[0].score} vs ${t.score}`);
}

// --- safe-area fast
const sa = async (ops: string, o: Parameters<typeof phone>[1] = {}) => (await iss(phone(ops, o), 'mobile-safe-area')).length;
const flow1 = 'f=I("document", { type: "frame", layout: "vertical", gap: 12 })\nI(f, { type: "text", content: "Today" })';
check('G-S1 bare root + spacers + positioned text at y 100: clean (M21)', await sa(`I("document", { type: "frame", height: 47 })\n${flow1}\nI("document", { type: "frame", height: 34 })\nI("document", { type: "text", content: "Pin", position: "absolute", x: 0, y: 100 })`, { bare: true }) === 0);
check('G-S2 numeric image width 390 on bare root: background (M19)', await sa(`I("document", { type: "image", src: "https://example.com/h.jpg", width: 390, height: 220 })\n${flow1}\nI("document", { type: "frame", height: 34 })`, { bare: true }) === 0);
check('G-S3 positioned text, y 800, lineHeight 1.5 @20px: bottom warning (M25)', await sa(`${flow1}\nI("document", { type: "text", content: "Saved", fontSize: 20, lineHeight: 1.5, position: "absolute", x: 0, y: 800 })`) === 1);
check('G-S4 positioned text height 20 ending exactly at 810: clean (M26)', await sa(`${flow1}\nI("document", { type: "text", content: "Saved", height: 20, position: "absolute", x: 0, y: 790 })`) === 0);
check('G-S5 explicit safeArea {0,0} reserved: no walk warning (S07)', await (async () => { const c = phone(flow1); (c.root as SceneNode).safeArea = { top: 0, bottom: 0 } as never; return (await iss(c, 'mobile-safe-area')).length === 0; })());
// --- stress pure
{
  let n = 0; const id = () => `g${++n}`;
  const row = (title: string) => ({ id: id(), type: 'list-row', title } as unknown as SceneNode);
  const mk = (kids: SceneNode[]) => ({ id: 'document', type: 'document', children: kids } as SceneNode);
  const sp = { id: id(), type: 'frame' } as SceneNode;
  const root = mk([{ id: id(), type: 'frame', children: [row('A1'), row('A2'), sp, row('B1'), row('B2')] } as SceneNode]);
  const e = applyPerturbation('empty', root, { type: 'mobile' });
  check('G-L1 two runs in one container: empty removes both (T14)', e.root.children![0].children!.length === 1, String(e.root.children![0].children!.length));
  const m = applyPerturbation('many', root, { type: 'mobile' });
  check('G-L2 two runs: many triples both (T14)', m.root.children![0].children!.length === 1 + 12, String(m.root.children![0].children!.length));
  const sm = mk([{ id: id(), type: 'text', content: 'Mon' } as SceneNode, { id: id(), type: 'text', content: 'Home' } as SceneNode]);
  const lt = applyPerturbation('long-text', sm, { type: 'mobile' });
  check('G-L3 mobile long-text: 3-char "Mon" untouched, 4-char "Home" perturbed (T01)', lt.root.children![0].content === 'Mon' && (lt.root.children![1].content as string).length > 10);
  const prim = mk([
    { id: 'b', type: 'button', label: 'Start run' }, { id: 'n', type: 'nav-bar', title: 'Routes', leading: { label: 'Back' }, trailing: [{ label: 'Edit' }] },
  ] as unknown as SceneNode[]);
  const L = (r: SceneNode, i: number) => r.children![i] as unknown as { label?: string; title?: string; leading?: { label: string }; trailing?: { label: string }[] };
  const mob = applyPerturbation('long-text', prim, { type: 'mobile' });
  check('G-P1 mobile long-text: button label perturbed (T05)', (L(mob.root, 0).label ?? '').length > 15);
  check('G-P2 mobile long-text: nav-bar title perturbed (T06)', (L(mob.root, 1).title ?? '').length > 10);
  check('G-P3 mobile long-text: nav-bar leading/trailing labels fixed (T07,T08)', L(mob.root, 1).leading!.label === 'Back' && L(mob.root, 1).trailing![0].label === 'Edit');
  const i18 = applyPerturbation('i18n', prim, { type: 'mobile' });
  check('G-P4 mobile i18n: nav-bar leading/trailing labels perturbed (T07,T08)', L(i18.root, 1).leading!.label !== 'Back' && L(i18.root, 1).trailing![0].label !== 'Edit');
  const blank = mk([{ id: 'b2', type: 'button', label: '   ' }] as unknown as SceneNode[]);
  check('G-P5 whitespace-only label is not touched (T11)', applyPerturbation('long-text', blank, { type: 'web' }).touched.length === 0);
}

}

// ── slice D: tappable primitives (FR-C1) ──────────────────────────────────
{
  console.log('\n── slice D: tappable primitives ──');
  const small = `f=I("document", { type: "frame", layout: "vertical", padding: 12 })
I(f, { type: "button", label: "Add", size: "sm" })`;
  const m = await issues(phone(small), 'mobile-touch-target');
  check('a 32px button in a 12px-padded frame on mobile → error', m.length === 1 && m[0].severity === 'error' && m[0].message.includes('button') && (m[0].suggestion ?? '').includes('"md"'), show(m));
  const w = await evaluateCanvas(phone(small, { type: 'web' }), { mode: 'fast', categories: ['usability'] });
  check('the same button declared web → READY, no target finding', !w.issues.some((i) => i.message.includes('touch target') || i.message.includes('hit target')) && buildEvaluateDirective(w).ready, JSON.stringify(w.issues.map((i) => i.message)));
  check('a default button passes', (await issues(phone('I("document", { type: "button", label: "Continue" })'), 'mobile-touch-target')).length === 0);
  check('an icon-only md button passes; sm errors', (await issues(phone('I("document", { type: "button", icon: "plus" })'), 'mobile-touch-target')).length === 0
    && (await issues(phone('I("document", { type: "button", icon: "plus", size: "sm" })'), 'mobile-touch-target')).length === 1);
  check('minHeight 44 lifts an sm button', (await issues(phone('I("document", { type: "button", label: "Go", size: "sm", minHeight: 44 })'), 'mobile-touch-target')).length === 0);
  const items = '[{ icon: "house", label: "A" }, { icon: "map", label: "B" }, { icon: "user", label: "C" }, { icon: "bell", label: "D" }, { icon: "settings", label: "E" }]';
  const narrow = await issues(phone(`I("document", { type: "tab-bar", width: 150, items: ${items} })`), 'mobile-touch-target');
  check('a 150px tab bar with five tabs → five 30px tab errors', narrow.length === 5 && narrow[0].message.includes('30×49'), show(narrow));
  check('a full-width five-tab bar with a FAB passes', (await issues(phone(`I("document", { type: "tab-bar", variant: "fab", items: ${items} })`), 'mobile-touch-target')).length === 0);
  check('a 30px-wide list-row errors; a spanning one passes', (await issues(phone('I("document", { type: "list-row", title: "x", width: 30 })'), 'mobile-touch-target')).length === 1
    && (await issues(phone('I("document", { type: "list-row", title: "Wi-Fi" })'), 'mobile-touch-target')).length === 0);
  check('nav-bar actions are 44×44 by construction', (await issues(phone('I("document", { type: "nav-bar", title: "T", leading: { label: "Back" }, trailing: [{ icon: "search" }] })'), 'mobile-touch-target')).length === 0);
  const shared = await issues(phone(`r=I("document", { type: "frame", layout: "horizontal", height: 44, width: "100%" })
I(r, { type: "text", content: "Agree" })
I(r, { type: "checkbox" })
I(r, { type: "button", label: "Terms", variant: "ghost" })`), 'mobile-touch-target');
  check('a checkbox sharing a row with a button does not inherit the row', shared.length === 1 && shared[0].message.startsWith('checkbox'), show(shared));
}

// ── slice D: instances are judged like their render ───────────────────────
{
  console.log('\n── slice D: instances ──');
  const c = phone('I("document", { type: "instance", componentId: "row", name: "Consent row" })');
  c.components = { row: { id: 'row', type: 'component', name: 'Row', layout: 'horizontal', height: 20, children: [{ id: 'row-t', type: 'text', content: 'Agree' }, { id: 'row-c', type: 'checkbox' }] } };
  const inst = c.root.children![0].id;
  const t = await issues(c, 'mobile-touch-target');
  check('a small control inside an instance errors, reported on the instance', t.length === 1 && t[0].nodeId === inst && t[0].message.includes('inside instance'), show(t));
  c.components = { row: { id: 'row', type: 'component', children: [{ id: 'row-tb', type: 'tab-bar', items: [{ icon: 'house', label: 'A' }] }] } };
  const tb = await issues(c, 'mobile-tab-bar');
  check('a one-tab bar inside a component warns on the instance', tb.length === 1 && tb[0].nodeId === inst, show(tb));
}

// ── slice D: mobile-handbuilt-target names the primitive ──────────────────
{
  console.log('\n── slice D: hand-built target ──');
  const h = await issues(phone(`b=I("document", { type: "frame", width: 32, height: 32 })
I(b, { type: "icon", icon: "bell" })`), 'mobile-handbuilt-target');
  check('the suggestion names `button`', h.length === 1 && (h[0].suggestion ?? '').includes('`button`') && !(h[0].suggestion ?? '').includes('make it at least'), show(h));
  check('a frame holding a button is not tap-shaped', (await issues(phone(`b=I("document", { type: "frame", width: 32, height: 32 })
I(b, { type: "button", icon: "bell" })`), 'mobile-handbuilt-target')).length === 0);
}

// ── slice D: mobile-tab-bar (FR-D3) ───────────────────────────────────────
{
  console.log('\n── slice D: mobile-tab-bar ──');
  const tab = (i: number) => `{ icon: "house", label: "T${i}" }`;
  const bar = (n: number, extra = '') => phone(`I("document", { type: "tab-bar", items: [${Array.from({ length: n }, (_, i) => tab(i)).join(', ')}]${extra} })`);
  const five = await issues(bar(5, ', variant: "fab", fab: { icon: "plus" }'), 'mobile-tab-bar');
  check('five tabs + a FAB, pinned: nothing', five.length === 0, show(five));
  check('two tabs pass', (await issues(bar(2), 'mobile-tab-bar')).length === 0);
  const six = await issues(bar(6), 'mobile-tab-bar');
  check('six tabs warn', six.length === 1 && six[0].severity === 'warning' && six[0].category === 'usability' && six[0].message.includes('6 tabs'), show(six));
  check('one tab warns', (await issues(bar(1), 'mobile-tab-bar')).length === 1);
  const unlabeled = await issues(phone('I("document", { type: "tab-bar", items: [{ icon: "house", label: "Home" }, { icon: "map", label: "" }, { icon: "user" }] })'), 'mobile-tab-bar');
  check('icon-only tabs warn once, naming them', unlabeled.length === 1 && unlabeled[0].message.includes('2, 3'), show(unlabeled));
  check('a tab bar moved into flow warns', (await issues(bar(3, ', position: "relative"'), 'mobile-tab-bar')).length === 1);
  check('a tab bar with a y (top-pinned) warns, even with a bottom', (await issues(bar(3, ', y: 0, bottom: 0'), 'mobile-tab-bar')).length === 1);
  const web = await evaluateCanvas(bar(6, ''), { mode: 'fast' });
  check('mobile-tab-bar is in the mobile surface report', web.surface.rulesOn.includes('mobile-tab-bar'));
  const declaredWeb = await issues(phone(`I("document", { type: "tab-bar", items: [${tab(1)}] })`, { type: 'web' }), 'mobile-tab-bar');
  check('not on web', declaredWeb.length === 0);
}

// ── slice D: mobile-safe-area with pinned positioning (FR-C3) ─────────────
{
  console.log('\n── slice D: safe area + pinned ──');
  const sa = (ops: string, bare = false) => issues(phone(ops, { bare }), 'mobile-safe-area');
  check('no safeArea + a fixed status-bar + text → silent', (await sa(`I("document", { type: "status-bar" })
I("document", { type: "text", content: "Hello" })`, true)).filter((i) => i.message.includes('top')).length === 0);
  check('no safeArea + an in-flow status-bar is a spacer', (await sa(`I("document", { type: "status-bar", position: "relative" })
I("document", { type: "text", content: "Hello" })`, true)).filter((i) => i.message.includes('top of the screen')).length === 0);
  check('no safeArea + a fixed tab-bar reserves the bottom', (await sa(`I("document", { type: "text", content: "Hello" })
I("document", { type: "tab-bar", items: [{ icon: "house", label: "A" }, { icon: "user", label: "B" }] })`, true)).filter((i) => i.message.includes('bottom')).length === 0);

  const bareBar = await sa(`bar=I("document", { type: "frame", name: "CTA", position: "fixed", bottom: 0, layout: "vertical" })
I(bar, { type: "button", name: "Pay", label: "Pay" })`);
  check('a fixed CTA at bottom 0 with no padding warns (its button sits in the inset)', bareBar.some((i) => i.severity === 'warning' && i.message.includes('Pay') && i.message.includes('inset')), show(bareBar));

  const idiom = (spacer: number) => `list=I("document", { type: "frame", layout: "vertical" })
I(list, { type: "text", content: "Order summary" })
I(list, { type: "frame", name: "End spacer", height: ${spacer} })
bar=I("document", { type: "frame", name: "CTA", position: "fixed", bottom: 0, layout: "vertical", padding: [12, 16, 12, 16] })
I(bar, { type: "button", name: "Pay", label: "Pay", width: "100%" })
I(bar, { type: "frame", name: "Inset", height: 34 })`;
  // Bar height 12 + 44 + 34 + 12 = 102; the root reserves 34 → a 68px spacer clears it.
  const good = await sa(idiom(68));
  check('the pinned-bar idiom (padding < 32 + an inset spacer) with a 68px end spacer passes', good.length === 0, show(good));
  const short = await sa(idiom(20));
  check('…with a 20px end spacer the scroll end stays under the bar, naming a 48px spacer', short.length === 1 && short[0].message.includes('under pinned "CTA"') && (short[0].suggestion ?? '').includes('48px spacer'), show(short));
  const offset = await sa(`list=I("document", { type: "frame", layout: "vertical" })
I(list, { type: "text", content: "Order summary" })
I(list, { type: "frame", height: 44 })
I("document", { type: "button", name: "Pay", label: "Pay", position: "fixed", bottom: 34 })`);
  check('a fixed button at bottom 34 passes condition 1, and the end spacer clears it', offset.length === 0, show(offset));
  const textBar = await sa(`bar=I("document", { type: "frame", position: "fixed", bottom: 40, layout: "vertical", padding: 12 })
I(bar, { type: "text", content: "Free shipping over $50" })`);
  check('a pinned bar holding text has no resolvable height → the detailed-mode info', textBar.length === 1 && textBar[0].severity === 'info' && textBar[0].message.includes('height of a pinned bar'), show(textBar));

  check('a fixed nav-bar at y 0 without safeArea warns (nav-bar is content)', (await sa('I("document", { type: "nav-bar", title: "Inbox", position: "fixed", y: 0 })', true)).some((i) => i.message.includes('inset')));
  const topBar = (spacer: string) => sa(`I("document", { type: "nav-bar", name: "Nav", title: "Inbox", position: "fixed", y: 47 })
${spacer}I("document", { type: "text", name: "First", content: "First message" })`);
  const hidden = await topBar('');
  check('a fixed nav-bar at y 47 hides the first content at scroll 0 (the mirror condition)', hidden.length === 1 && hidden[0].message.includes('start of the scroll'), show(hidden));
  check('…a 44px spacer before the content clears it', (await topBar('I("document", { type: "frame", height: 44 })\n')).length === 0);

  const blurred = await sa(`g=I("document", { type: "frame", backdropBlur: 12 })
I(g, { type: "button", label: "Go", position: "fixed", bottom: 0 })`);
  check('a fixed node under a blurred ancestor is unplaceable → info only', blurred.length === 1 && blurred[0].severity === 'info', show(blurred));
  check('a sheet\'s content is never judged', (await sa(`sh=I("document", { type: "sheet" })
I(sh, { type: "text", content: "Sheet title" })`, true)).length === 0);
  const sticky = await sa(`h=I("document", { type: "frame", position: "sticky", y: 0, layout: "vertical" })
I(h, { type: "text", name: "Header", content: "Header" })`);
  check('a sticky header at y 0 warns (its stuck position is under the status bar)', sticky.some((i) => i.severity === 'warning' && i.message.includes('Header')), show(sticky));
  check('slice C still holds: an absolute text at y 10 warns', (await sa('I("document", { type: "text", content: "x", position: "absolute", y: 10 })')).length === 1);
}

// ── slice D: reuse + unknown icons on primitives ──────────────────────────
{
  console.log('\n── slice D: reuse + icons ──');
  const rows = Array.from({ length: 8 }, (_, i) => `I(l, { type: "list-row", title: "Row ${i}" })`).join('\n');
  const many = await evaluateCanvas(phone(`l=I("document", { type: "frame", layout: "vertical" })\n${rows}\nI("document", { type: "frame" })\nI("document", { type: "frame" })\nI("document", { type: "frame" })`), { mode: 'fast', categories: ['structure'] });
  check('eight list-rows and no components → no reuse advisory', !many.issues.some((i) => i.message.includes('No component instances')), JSON.stringify(many.issues.map((i) => i.message)));
  const frames = Array.from({ length: 12 }, () => 'I("document", { type: "frame" })').join('\n');
  const once = await evaluateCanvas(phone(`I("document", { type: "button", label: "Go" })\nI("document", { type: "tab-bar", items: [{ icon: "house", label: "A" }, { icon: "user", label: "B" }] })\n${frames}`), { mode: 'fast', categories: ['structure'] });
  check('one button + one tab bar is not reuse → the advisory stays', once.issues.some((i) => i.message.includes('No component instances')));

  const icons = await evaluateCanvas(phone(`I("document", { type: "tab-bar", items: [{ icon: "housee", label: "A" }, { icon: "nope-nope", label: "B" }, { label: "C" }] })
I("document", { type: "button", label: "Next", icon: "Chevron-Right" })
I("document", { type: "button", label: "Plain" })
I("document", { type: "list-row", title: "Ada", leading: { initials: "AL" } })`), { mode: 'fast', categories: ['structure'] });
  const iconIssues = icons.issues.filter((i) => /icon/i.test(i.message));
  check('every bad tab icon reports, plus the missing one', iconIssues.filter((i) => i.message.includes('items[')).length === 3, JSON.stringify(iconIssues.map((i) => i.message)));
  const btn = iconIssues.find((i) => i.message.includes('Chevron-Right'));
  check('button.icon gets the mechanical fix', btn?.fix?.op.includes('chevron-right') === true, JSON.stringify(btn));
  check('label-only buttons and initials rows are not flagged', iconIssues.length === 4, String(iconIssues.length));
}

// ── slice D: verify-round regressions ─────────────────────────────────────
{
  console.log('\n── slice D: verify-round regressions ──');
  // Three instances of one component: one finding each, on its own instance.
  const c = phone(`I("document", { type: "instance", componentId: "cb", name: "A" })
I("document", { type: "instance", componentId: "cb", name: "B" })
I("document", { type: "instance", componentId: "cb", name: "C" })`);
  c.components = { cb: { id: 'cb', type: 'component', children: [{ id: 'cb-btn', type: 'button', name: 'Btn', label: 'Add', size: 'sm' }] } };
  const ids = c.root.children!.map((n) => n.id);
  const three = await issues(c, 'mobile-touch-target');
  check('three instances of a bad component → three errors, one per instance', three.length === 3 && new Set(three.map((i) => i.nodeId)).size === 3 && three.every((i) => ids.includes(i.nodeId!)), show(three));
  c.root.children![0].overrides = { Btn: { size: 'md' } };
  const two = await issues(c, 'mobile-touch-target');
  check('…an override fixing A leaves B and C, and never blames A', two.length === 2 && !two.some((i) => i.nodeId === ids[0]), show(two));

  // Token census: primitive copy is not a style value.
  const tokens = { colors: { accent: '#0B6E4F', 'bg-surface': '#FFFFFF' } };
  const prim = await evaluateCanvas(phone(`U("document", { fill: "$bg-surface" })
I("document", { type: "status-bar" })
I("document", { type: "nav-bar", title: "Settings", largeTitle: true })
${Array.from({ length: 6 }, (_, i) => `I("document", { type: "list-row", title: "Row ${i}", subtitle: "Detail ${i}", trailing: { chevron: true } })`).join('\n')}
I("document", { type: "button", label: "Sign out", variant: "destructive" })`, { variables: tokens }), { mode: 'fast', categories: ['structure'] });
  check('a primitive-built screen is not told it under-uses tokens', !prim.issues.some((i) => i.message.includes('use design tokens')), JSON.stringify(prim.issues.map((i) => i.message)));
  const literal = await evaluateCanvas(phone(Array.from({ length: 8 }, () => 'I("document", { type: "frame", fill: "#F0F0F0", stroke: "#DDDDDD", height: 20 })').join('\n'), { variables: tokens }), { mode: 'fast', categories: ['structure'] });
  check('…frames with literal colours still are (probe)', literal.issues.some((i) => i.message.includes('use design tokens')));

  // Malformed props never throw.
  const weird = phone(`I("document", { type: "nav-bar", title: 2024, trailing: [null, { icon: "search" }] })
I("document", { type: "tab-bar", items: [null, { icon: "house", label: 5 }, { icon: "user", label: "Me" }] })
I("document", { type: "button", label: 5 })
I("document", { type: "list-row", title: 7, subtitle: 8, trailing: { text: 9 } })
I("document", { type: "status-bar", time: 930 })`);
  let threw = '';
  try { await evaluateCanvas(weird, { mode: 'fast' }); renderToHtml(weird.root, 390, 844, weird); } catch (e) { threw = String(e); }
  check('null entries and numeric labels neither crash evaluate nor render', threw === '', threw);
  const html = renderToHtml(weird.root, 390, 844, weird);
  check('numeric labels render as text', html.includes('>2024<') && html.includes('>930<') && html.includes('>5<'));
  const numLabel = await issues(weird, 'mobile-tab-bar');
  check('a numeric tab label counts as a label (and the unrendered null entry is ignored)', numLabel.length === 0, show(numLabel));
  const zero = renderToHtml(phone('I("document", { type: "list-row", title: "Inbox", trailing: { badge: 0 } })').root, 390, 844);
  check('a zero badge renders no bubble', !zero.includes('>0</span>'));

  // A third trailing nav action never renders, so its icon is never judged.
  const nav = await evaluateCanvas(phone('I("document", { type: "nav-bar", title: "T", trailing: [{ icon: "search" }, { icon: "plus" }, { icon: "nope-nope" }] })'), { mode: 'fast', categories: ['structure'] });
  check('a third trailing nav action is not icon-checked', !nav.issues.some((i) => i.message.includes('nope-nope')));
  const abs = await issues(phone('I("document", { type: "tab-bar", position: "absolute", items: [{ icon: "house", label: "A" }, { icon: "user", label: "B" }] })'), 'mobile-tab-bar');
  check('an absolute tab bar is named by its position, not "in flow"', abs.length === 1 && abs[0].message.includes('position "absolute"') && !abs[0].message.includes('in flow'), show(abs));
}

// ── slice D: mutation-round gaps ──────────────────────────────────────────
{
  console.log('\n── slice D: mutation-round gaps ──');
  const items5 = Array.from({ length: 5 }, (_, i) => `{ icon: "house", label: "T${i}" }`).join(', ');
  const fabNarrow = await issues(phone(`I("document", { type: "tab-bar", variant: "fab", width: 250, items: [${items5}] })`), 'mobile-touch-target');
  check('a 250px fab bar with five tabs: six slots, five 42px tab errors', fabNarrow.filter((i) => i.message.startsWith('tab')).length === 5 && fabNarrow[0].message.includes('42×49'), show(fabNarrow));
  for (const [what, prop] of [['blur', 'blur: 8'], ['backdropFilter', 'backdropFilter: { blur: 10 }'], ['a slideUp animation', 'animation: { name: "slideUp" }'], ['a scaleIn animation', 'animation: { name: "scaleIn" }']] as const) {
    const found = await issues(phone(`g=I("document", { type: "frame", ${prop} })
I(g, { type: "button", label: "Go", position: "fixed", bottom: 0 })`), 'mobile-safe-area');
    check(`a fixed node under ${what} is unplaceable → info only`, found.length === 1 && found[0].severity === 'info', show(found));
  }
  const grand = await issues(phone(`g=I("document", { type: "frame", blur: 4 })
m=I(g, { type: "frame" })
I(m, { type: "button", label: "Go", position: "fixed", bottom: 0 })`), 'mobile-safe-area');
  check('…and under a blurred grandparent too', grand.length === 1 && grand[0].severity === 'info', show(grand));
  const gapBar = await issues(phone(`list=I("document", { type: "frame", layout: "vertical" })
I(list, { type: "text", content: "Order summary" })
I(list, { type: "frame", height: 68 })
bar=I("document", { type: "frame", name: "CTA", position: "fixed", bottom: 0, layout: "vertical", gap: 20, padding: [12, 16, 12, 16] })
I(bar, { type: "button", label: "Pay", width: "100%" })
I(bar, { type: "frame", height: 34 })`), 'mobile-safe-area');
  check('a pinned bar\'s gap counts toward its height (122 > the 102 a 68px spacer clears)', gapBar.length === 1 && gapBar[0].message.includes('122px'), show(gapBar));
  const icons = await evaluateCanvas(phone(`I("document", { type: "list-row", title: "A", leading: { icon: "nope-one" } })
I("document", { type: "nav-bar", title: "T", trailing: [{ icon: "nope-two" }] })
I("document", { type: "tab-bar", variant: "fab", fab: { icon: "nope-three" }, items: [{ icon: "house", label: "A" }, { icon: "user", label: "B" }] })`), { mode: 'fast', categories: ['structure'] });
  check('list-row leading, nav trailing and FAB icons are checked', ['nope-one', 'nope-two', 'nope-three'].every((n) => icons.issues.some((i) => i.message.includes(n))), JSON.stringify(icons.issues.map((i) => i.message)));
}

// ── slice D: post-3b regressions ──────────────────────────────────────────
{
  console.log('\n── slice D: post-3b regressions ──');
  const nulls = await issues(phone('I("document", { type: "tab-bar", items: [null, { icon: "house", label: "A" }, { icon: "user", label: "B" }] })'), 'mobile-tab-bar');
  check('a null tab entry (not rendered) is neither counted nor called unlabeled', nulls.length === 0, show(nulls));
}

// ── the real tool handlers over MCP stdio ─────────────────────────────────
{
  console.log('\n── MCP tools ──');
  const home = mkdtempSync(join(tmpdir(), 'framesmith-mobile-mcp-'));
  const cwd = mkdtempSync(join(tmpdir(), 'framesmith-mobile-mcp-cwd-'));
  const transport = new StdioClientTransport({
    command: resolve('node_modules/.bin/tsx'),
    args: [resolve('src/index.ts')],
    cwd,
    env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test-mobile-rules', version: '0' });
  await client.connect(transport);
  async function tool(name: string, args: Record<string, unknown>) {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]?.text ?? '';
    try { return { ...JSON.parse(text), isError: r.isError }; } catch { return { text, isError: r.isError }; }
  }
  try {
    const bare = await tool('canvas_create', { name: 'Bare phone', width: 390, height: 844 });
    await tool('batch_design', { canvasId: bare.canvasId, operations: 'I("document", { type: "text", content: "Hello" })' });
    const ev = await tool('canvas_evaluate', { canvasId: bare.canvasId });
    const art = ev.issues.filter((i: EvaluationIssue) => i.rule === 'mobile-artboard');
    check('canvas_create({ width: 390 }) with no type → NOT READY with a mobile-artboard warning', art.length === 1 && art[0].severity === 'warning' && ev.directive.startsWith('NOT READY'), JSON.stringify(art));
    check('the issue carries its rule id and the surface report lists it', ev.surface.rulesOn.includes('mobile-artboard'));

    const m = await tool('canvas_create', { name: 'Phone', type: 'mobile' });
    await tool('batch_design', { canvasId: m.canvasId, operations: 'I("document", { type: "text", content: "Hello" })' });
    const v = await tool('canvas_add_variant', { canvasId: m.canvasId, state: 'empty' });
    const set = await tool('canvas_set_type', { canvasId: m.canvasId, type: 'web' });
    check('canvas_set_type names the variant left on the old type', Array.isArray(set.variantsOutOfSync) && set.variantsOutOfSync.length === 1 && set.variantsOutOfSync[0].type === 'mobile' && set.variantsOutOfSync[0].state === 'empty', JSON.stringify(set.variantsOutOfSync));
    const back = await tool('canvas_set_type', { canvasId: m.canvasId, type: 'mobile' });
    check('…and nothing once they agree again', back.variantsOutOfSync === undefined);
    void v;
  } finally {
    await client.close();
  }
}

console.log(allPass ? '\nAll mobile ruleset checks passed.' : '\nSome mobile ruleset checks FAILED.');
process.exit(allPass ? 0 : 1);
