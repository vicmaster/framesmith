// Phase 30 slice G (FR-G1) — the acceptance re-run. Ridgeline Today, the
// trail-running home screen the 2026-09-07 mobile attempt hand-built in 93
// nodes, rebuilt on the phase through the REAL tool handlers over MCP stdio:
// canvas_create({ type: "mobile" }) → generate_design_system →
// apply_structure("dashboard") → batch_design adaptation. It must reach CLEAN
// in fast and detailed mode in both themes, with a full canvas_stress run
// CLEAN, every tap target a primitive, no hand-built device chrome, in fewer
// than 93 nodes. The numbers it prints are the ones the slice G PR quotes.
//
// Usage: npx tsx test-ridgeline.ts
//   RIDGELINE_OUT=<dir> also writes light + dark screenshots there.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

const ATTEMPT_NODES = 93;
// Spelled out, not read from src/surfaces.ts, so dropping a rule from the
// ruleset cannot also drop it from what this gate expects.
const MOBILE_RULE_IDS = ['mobile-touch-target', 'mobile-handbuilt-target', 'mobile-safe-area', 'mobile-type-floor', 'mobile-one-column', 'mobile-tab-bar', 'mobile-artboard'];
const STRESS_DEFAULTS = ['long-text', 'i18n', 'big-numbers', 'empty', 'many'];
const out = process.env.RIDGELINE_OUT;
if (out) mkdirSync(out, { recursive: true });

const home = mkdtempSync(join(tmpdir(), 'framesmith-ridgeline-'));
const cwd = mkdtempSync(join(tmpdir(), 'framesmith-ridgeline-cwd-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-ridgeline', version: '0' });
await client.connect(transport);

type Content = { type: string; text?: string; data?: string };
async function call(name: string, args: Record<string, unknown>): Promise<Content[]> {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 170_000 }) as { content: Content[] };
  return r.content;
}
async function tool(name: string, args: Record<string, unknown>) {
  const text = (await call(name, args))[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return text; }
}

// The adaptation: the attempt's copy and figures, every tap target a
// primitive. The stamp's ids are dashboard-mobile's (dm-*).
const ADAPT = `
U("dm-nav", { title: "Good morning, Fiona", largeTitle: true, trailing: [{ icon: "bell" }] })
U("dm-hero-label", { content: "This week" })
U("dm-hero-value", { content: "42.8 km" })
track=I("dm-hero", { type: "frame", name: "Goal track", width: "100%", height: 8, cornerRadius: 4, fill: "$accent-tint" })
I(track, { type: "frame", name: "Goal fill", width: "78%", height: 8, cornerRadius: 4, fill: "$accent" })
M(track, "dm-hero", 2)
U("dm-hero-delta-icon", { icon: "target" })
U("dm-hero-delta-text", { content: "78% of your 55 km goal" })
D("dm-stat-1")
D("dm-stat-2")
U("dm-stats", { name: "Quick actions", layout: "grid", gridColumns: 2, gap: "$space-xs" })
I("dm-stats", { type: "button", label: "Start run", icon: "play", variant: "primary", width: "100%" })
I("dm-stats", { type: "button", label: "Routes", icon: "map", variant: "secondary", width: "100%" })
I("dm-stats", { type: "button", label: "Plan", icon: "calendar-days", variant: "secondary", width: "100%" })
I("dm-stats", { type: "button", label: "Gear", icon: "footprints", variant: "secondary", width: "100%" })
week=I("dm-content", { type: "frame", name: "Week chart", width: "100%", layout: "vertical", gap: "$space-sm", padding: "$space-lg", cornerRadius: "$radius-lg", fill: "$bg-surface", stroke: "$border", strokeWidth: 1, shadow: "$elevation.flat" })
M(week, "dm-content", 2)
head=I(week, { type: "frame", name: "Chart header", width: "100%", layout: "horizontal", alignItems: "center", justifyContent: "space-between", gap: "$space-sm" })
I(head, { type: "text", content: "Daily distance", fontSize: "$text-lg", fontWeight: 600, color: "$text-primary", textOverflow: "ellipsis", minWidth: 0 })
I(head, { type: "text", content: "km", fontSize: "$caption", color: "$text-secondary" })
I(week, { type: "chart", name: "Week bars", kind: "bar", width: "100%", height: 120, series: [{ data: [6.2, 0, 8.4, 5.1, 0, 12.6, 10.5], highlight: [5], stroke: "$accent" }], xLabels: ["M", "T", "W", "T", "F", "S", "S"] })
U("dm-recent-head-title", { content: "Recent runs" })
U("dm-row-1", { title: "Cedar Ridge loop", subtitle: "Yesterday · 5:42 /km", leading: { icon: "mountain" }, trailing: { text: "12.6 km" } })
U("dm-row-2", { title: "Riverside tempo", subtitle: "Thursday · 4:58 /km", leading: { icon: "timer" }, trailing: { text: "8.4 km" } })
U("dm-row-3", { title: "Old Mill recovery", subtitle: "Wednesday · 6:20 /km", leading: { icon: "leaf" }, trailing: { text: "5.1 km" } })
I("document", { type: "home-indicator" })
U("dm-tabs", { variant: "fab", fab: { icon: "plus" }, items: [{ icon: "house", label: "Home", active: true }, { icon: "map", label: "Routes" }, { icon: "users", label: "Club" }, { icon: "user", label: "Profile" }] })
`;

type Node = { type: string; name?: string; children?: Node[] };
const walk = (n: Node, out: Node[] = []): Node[] => { out.push(n); (n.children ?? []).forEach((c) => walk(c, out)); return out; };

type Issue = { severity: string; rule?: string; tell?: string; theme?: string; message?: string; detail?: string; nodeId?: string };
const describe = (issues: Issue[]) => issues.map((i) => `${i.severity}:${i.rule ?? i.tell ?? ''} ${i.nodeId ?? ''} ${(i.message ?? i.detail ?? '').slice(0, 90)}`).join(' | ');

try {
  const c = await tool('canvas_create', { name: 'Ridgeline — Today', type: 'mobile' });
  const id = c.canvasId as string;
  check('canvas_create declares a 390×844 mobile canvas', c.type === 'mobile' && c.width === 390 && c.height === 844, JSON.stringify({ type: c.type, width: c.width, height: c.height }));

  const ds = await tool('generate_design_system', { canvasId: id, seed: '#277350', personality: 'soft' });
  check('generate_design_system pivots on the phone body size', ds.baseSizeSource === 'mobile', `${ds.baseSize}px from ${ds.baseSizeSource}`);

  const s = await tool('apply_structure', { canvasId: id, structure: 'dashboard' });
  check('apply_structure("dashboard") stamps dashboard-mobile', s.applied === 'dashboard-mobile', s.applied);

  // The figures are the runner's own data and ARE the design: declare the
  // purpose, as the honest-content tell's suggestion says to.
  const g = await tool('canvas_set_genre', { canvasId: id, genre: 'data' });
  check('canvas_set_genre declares the data purpose', g.canonical === 'data', JSON.stringify(g).slice(0, 200));

  const b = await tool('batch_design', { canvasId: id, operations: ADAPT });
  const opErrors = typeof b === 'string' ? [b] : (b.errors ?? []);
  check('the adaptation applies without op errors', opErrors.length === 0, JSON.stringify(opErrors).slice(0, 300));

  // The verdicts below are only about the brief's fonts if they loaded: a
  // fallback face (offline, a Google Fonts outage) has other glyph widths.
  const shot = await call('screenshot', { canvasId: id });
  const fontWarnings = shot.filter((x) => x.type === 'text' && x.text?.startsWith('Font warnings'));
  check('the design system\'s fonts load (no Font warnings)', fontWarnings.length === 0, fontWarnings.map((x) => x.text).join(' '));

  // Stress first, so evaluate's directive reads its verdict.
  const st = await tool('canvas_stress', { canvasId: id });
  if (out) writeFileSync(join(out, 'stress.json'), JSON.stringify(st, null, 2));
  const ran = (st.perturbations ?? []).map((p: { name: string }) => p.name).sort();
  check('canvas_stress ran the full default set', JSON.stringify(ran) === JSON.stringify([...STRESS_DEFAULTS].sort()), ran.join(', '));
  const stressWarnings = (st.perturbations ?? []).flatMap((p: { findings?: Issue[] }) => p.findings ?? []).filter((f: Issue) => f.severity !== 'info');
  check('canvas_stress (full default set) is CLEAN', /^CLEAN\b/.test(st.verdict) && stressWarnings.length === 0, `${st.verdict}${stressWarnings.length ? ' — ' + describe(stressWarnings) : ''}`);

  const canvas = JSON.parse(readFileSync(join(home, 'canvases', `${id}.json`), 'utf-8'));
  check('the dark token layer exists, so the dark contrast run is not vacuous', Object.keys(canvas.variables?.dark?.colors ?? {}).length > 0);
  // Ridgeline's copy never references $body, so pin the role the type floor
  // judges: the generated phone body must be at least 16px.
  const body = canvas.variables?.typography?.body?.fontSize;
  check('the generated $body meets the 16px phone floor', typeof body === 'number' && body >= 16, `${body}px`);

  for (const mode of ['fast', 'detailed'] as const) {
    const ev = await tool('canvas_evaluate', { canvasId: id, mode });
    if (out) writeFileSync(join(out, `evaluate-${mode}.json`), JSON.stringify(ev, null, 2));
    const issues = ev.issues as Issue[];
    const blocking = issues.filter((i) => i.severity === 'error' || i.severity === 'warning' || i.tell);
    const dark = issues.filter((i) => i.theme === 'dark' && i.severity !== 'info');
    check(`${mode}: CLEAN — zero errors, warnings and tells, READY`, blocking.length === 0 && /^READY/.test(ev.directive), `${ev.overallScore}/100${blocking.length ? ' — ' + describe(blocking) : ''}`);
    check(`${mode}: no dark-theme contrast finding`, dark.length === 0, describe(dark));
    const handbuilt = issues.filter((i) => i.rule === 'mobile-handbuilt-target');
    check(`${mode}: zero mobile-handbuilt-target findings`, handbuilt.length === 0, describe(handbuilt));
    const on = new Set(ev.surface?.rulesOn ?? []);
    const missing = MOBILE_RULE_IDS.filter((r) => !on.has(r));
    check(`${mode}: the surface report has every mobile rule on`, ev.surface?.type === 'mobile' && missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : (ev.surface?.rulesOn ?? []).join(', '));
    console.log(`      ${mode} score ${ev.overallScore}/100 · ${issues.length} findings (${issues.filter((i) => i.severity === 'info').length} info)`);
  }

  const nodes = walk(canvas.root);
  check(`fewer than ${ATTEMPT_NODES} nodes`, nodes.length < ATTEMPT_NODES, `${nodes.length} nodes`);
  const types = new Set(nodes.map((n) => n.type));
  check('device chrome and navigation are the primitives', ['status-bar', 'nav-bar', 'tab-bar', 'home-indicator'].every((t) => types.has(t)));
  const chromeFrames = nodes.filter((n) => n.type === 'frame' && /status bar|home indicator|tab bar|nav bar|dynamic island|indicators/i.test(n.name ?? ''));
  check('no hand-built device chrome frame', chromeFrames.length === 0, chromeFrames.map((n) => n.name).join(', '));

  // Negative control: a dark-only contrast failure must surface, so the
  // clean dark result above is a real pass. Last, because it edits the canvas.
  await tool('set_variables', { canvasId: id, variables: { dark: { colors: { 'text-secondary': canvas.variables.dark.colors['bg-surface'] } } } });
  const control = await tool('canvas_evaluate', { canvasId: id, mode: 'fast' });
  check('control: a dark-only contrast failure is caught', (control.issues as Issue[]).some((i) => i.theme === 'dark' && i.severity !== 'info'));
  await tool('set_variables', { canvasId: id, variables: { dark: { colors: { 'text-secondary': canvas.variables.dark.colors['text-secondary'] } } } });

  if (out) {
    for (const theme of ['light', 'dark']) {
      const img = (await call('screenshot', { canvasId: id, theme, fullPage: true })).find((x) => x.type === 'image');
      if (img?.data) writeFileSync(join(out, `ridgeline-${theme}.png`), Buffer.from(img.data, 'base64'));
    }
    writeFileSync(join(out, 'ridgeline.json'), JSON.stringify(canvas, null, 2));
  }
} finally {
  await client.close();
}

console.log(allPass ? '\nAll checks passed.' : '\nSome checks FAILED.');
process.exit(allPass ? 0 : 1);
