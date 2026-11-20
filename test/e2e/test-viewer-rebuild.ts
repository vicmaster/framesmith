// Phase 31 slice I (FR-J1) — the acceptance re-run. framesmith's own viewer
// (the gallery, a canvas's detail page with its inspector, and the archive),
// rebuilt as desktop-app canvases on the finished phase through the REAL tool
// handlers over MCP stdio: one project, one project-scope design system,
// apply_structure from the app realisations, then batch_design. Six canvases
// (three bases and the comment-open, confirm-delete and empty states) must
// each reach CLEAN in fast and detailed mode in both themes with a full
// canvas_stress run CLEAN, and the six defects the 2026-11-08 baseline found
// in the live viewer must be fixed, each checked by name. The numbers it
// prints are the ones the slice I PR quotes. Contracts: V1 to V9 in
// docs/specs/PHASE-31-SPEC.md.
//
// Usage: npx tsx test/e2e/test-viewer-rebuild.ts
//   VIEWER_OUT=<dir> also writes screenshots, crops and JSON there.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { contrastRatio, parseColor } from '../../src/color-math.js';
import { resolveVariables } from '../../src/variables.js';
import type { DesignVariables, SceneNode } from '../../src/types.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Spelled out, not read from src/surfaces.ts, so dropping a rule from the
// ruleset cannot also drop it from what this gate expects.
const DESKTOP_RULE_IDS = [
  'desktop-app-artboard', 'desktop-app-target', 'desktop-app-handbuilt-target', 'desktop-app-icon-label',
  'desktop-app-current', 'desktop-app-type-ladder', 'desktop-app-row-rhythm', 'desktop-app-truncation',
  'desktop-app-primary-count', 'desktop-app-overlay', 'desktop-app-focus-visible', 'desktop-app-state-contrast',
  'desktop-app-boundary', 'desktop-app-disabled',
];
const STATE_RULES = ['desktop-app-focus-visible', 'desktop-app-state-contrast', 'desktop-app-boundary'];
const STRESS_DEFAULTS = ['long-text', 'i18n', 'big-numbers', 'empty', 'many'];
const COLOR_FIELDS = ['fill', 'stroke', 'color', 'iconColor', 'secondaryColor', 'badgeColor', 'dotColor'] as const;
const out = process.env.VIEWER_OUT;
if (out) mkdirSync(out, { recursive: true });

// ── the content (V2) ────────────────────────────────────────────────────────
// The viewer's own data: the baseline fixtures' projects, canvases, scores and
// findings. The amber seed yields five series hues, so five projects.

const PROJECTS: Array<[string, number]> = [
  ['Design system', 1], ['UI', 5], ['Releases', 2], ['Pattern library', 11], ['Foundations', 0],
];

/** The sidebar's projects over a realisation's nav-items (`existing` of them),
 * the current one active; the secondary item becomes Archive. */
function sidebar(prefix: string, current: string | null, archived: number, existing: number): string {
  const lines = [
    `U("${prefix}-brand", { content: "framesmith" })`,
    `ws=I("${prefix}", { type: "text", name: "Workspace label", content: "Personal", fontSize: "$caption", fontWeight: 600, color: "$text-secondary", padding: [0, 8] })`,
    `M(ws, "${prefix}", 1)`,
  ];
  PROJECTS.forEach(([label, count], i) => {
    const props = `label: "${label}", count: ${count}, dotColor: "$chart-${i + 1}", icon: null, active: ${label === current}`;
    lines.push(i < existing ? `U("${prefix}-nav-${i + 1}", { ${props} })` : `I("${prefix}-nav", { type: "nav-item", ${props} })`);
  });
  for (let i = PROJECTS.length + 1; i <= existing; i++) lines.push(`D("${prefix}-nav-${i}")`);
  lines.push(`U("${prefix}-more-1", { label: "Archive", icon: "archive", count: ${archived}, active: ${current === null} })`);
  return lines.join('\n');
}

const CARDS: Array<[string, number]> = [
  ['auth', 100], ['bento-grid', 100], ['catalogue', 100], ['dashboard', 95], ['onboarding', 100], ['settings', 98],
];

const GALLERY = `
${sidebar('bra-sidebar', 'Pattern library', 3, 3)}
U("bra-header-title", { content: "Pattern library", title: "Pattern library" })
D("bra-new")
I("bra-header-actions", { type: "text", name: "Canvas count", content: "11 canvases", fontSize: "$caption", color: "$text-secondary" })
U("bra-search", { placeholder: "Search canvases" })
U("bra-tabs", { items: [{ label: "All", count: 11, active: true }, { label: "Web", count: 9 }, { label: "Mobile", count: 1 }, { label: "Desktop app", count: 1 }] })
${CARDS.map(([name, score], i) => {
  const id = `bra-card-${i + 1}`;
  return [
    `U("${id}", { name: "Canvas card" })`,
    `U("${id}-media", { layout: "horizontal", justifyContent: "end", alignItems: "start", padding: "$space-sm" })`,
    `I("${id}-media", { type: "text", name: "Score", content: "${score}", title: "Quality score ${score} of 100", fontSize: "$caption", fontWeight: 600, color: "$text-primary", tabularNums: true, fill: "$bg-surface", cornerRadius: "$radius-sm", padding: [2, 8] })`,
    `U("${id}-title", { label: "${name}" })`,
    `U("${id}-meta", { content: "1440 × 900 · Jun 26, 2026", title: "1440 × 900 · Jun 26, 2026" })`,
  ].join('\n');
}).join('\n')}
`;

const CATEGORIES: Array<[string, number]> = [
  ['Spacing', 100], ['Color', 100], ['Typography', 100], ['Structure', 100],
  ['Consistency', 100], ['Usability', 100], ['Coverage', 30], ['Cliché', 100],
];

/** The baseline inspector's 18 findings, one card per distinct finding. */
const ISSUES: Array<{ category: string; message: string; nodes: number; fixable?: boolean }> = [
  { category: 'Typography', message: 'Display text at 28px with default tracking reads loose. Tighten it to -0.5.', nodes: 4, fixable: true },
  { category: 'Consistency', message: 'Corner radius 8 equals the $md token. Reference the token instead.', nodes: 5, fixable: true },
  { category: 'Consistency', message: 'Corner radius 16 equals the $lg token. Reference the token instead.', nodes: 5, fixable: true },
  { category: 'Coverage', message: 'The data table has no empty state variant.', nodes: 1 },
  { category: 'Coverage', message: 'The data table has no loading state variant.', nodes: 1 },
  { category: 'Structure', message: 'No component instances in 43 nodes. Promote a repeated subtree.', nodes: 1 },
  { category: 'Color', message: 'Weak perceptual contrast on the primary link (APCA advisory).', nodes: 1 },
];
const FINDINGS = ISSUES.reduce((n, i) => n + i.nodes, 0);

function issueCard(i: number, issue: typeof ISSUES[number]): string {
  const card = `card${i}`;
  const nodes = issue.nodes === 1 ? '1 node' : `${issue.nodes} nodes`;
  return [
    `${card}=I(issues, { type: "frame", name: "Issue card", width: "100%", layout: "vertical", gap: "$space-xs", padding: "$space-sm", cornerRadius: "$radius-md", fill: "$bg-primary", stroke: "$border", strokeWidth: 1 })`,
    `I(${card}, { type: "text", name: "Issue category", content: "${issue.category}${issue.fixable ? ' · auto-fixable' : ''}", fontSize: "$caption", fontWeight: 600, color: "$text-secondary" })`,
    `I(${card}, { type: "text", name: "Issue message", content: "${issue.message}", fontSize: "$label", color: "$text-primary" })`,
    `I(${card}, { type: "link", name: "Issue nodes", label: "Show ${nodes}" })`,
  ].join('\n');
}

const ACTION = 'minWidth: "max-content", maxWidth: 140, variant: "secondary", size: "sm"';
const DETAIL = `
U("eia-crumb-parent", { name: "Back link", label: "Back", icon: "arrow-left" })
D("eia-crumb-sep")
U("eia-title", { content: "dashboard", title: "dashboard", fontSize: "$body" })
I("eia-crumbs", { type: "text", name: "Canvas size", content: "1440 × 900", minWidth: "max-content", fontSize: "$caption", color: "$text-secondary" })
D("eia-share")
D("eia-publish")
U("eia-actions", { minWidth: 0 })
bp=I("eia-actions", { type: "frame", name: "Breakpoints", minWidth: 0 })
I(bp, { type: "tabs", name: "Breakpoint tabs", variant: "contained", size: "sm", items: [{ label: "Mobile" }, { label: "Tablet" }, { label: "Desktop", active: true }, { label: "Compare" }] })
I("eia-actions", { type: "divider", name: "View divider", orientation: "vertical" })
I("eia-actions", { type: "button", name: "JSON button", label: "JSON", icon: "braces", ${ACTION} })
I("eia-actions", { type: "button", name: "Comment button", label: "Comment", icon: "message-square", ${ACTION} })
I("eia-actions", { type: "button", name: "Archive button", label: "Archive", icon: "archive", ${ACTION} })
I("eia-actions", { type: "divider", name: "Danger divider", orientation: "vertical" })
I("eia-actions", { type: "button", name: "Delete button", label: "Delete", icon: "trash-2", minWidth: "max-content", maxWidth: 140, variant: "destructive", size: "sm" })
D("eia-tool-select")
D("eia-tool-pan")
I("eia-tools", { type: "button", icon: "scan", ariaLabel: "Fit to window", variant: "ghost", size: "xs", color: "$text-secondary" })
U("eia-canvas-label", { content: "Canvas preview, 1440 × 900" })
U("eia-tabs", { name: "Inspector tabs", items: [{ label: "Quality", active: true }, { label: "Design system" }, { label: "Feedback" }] })
U("eia-props-title", { content: "Score 95 of 100 · Excellent" })
D("eia-prop-name")
D("eia-prop-width")
D("eia-prop-mode")
D("eia-prop-visible")
D("eia-prop-source")
${CATEGORIES.map(([c, v]) => `I("eia-props", { type: "property-row", label: "${c}", children: [{ type: "text", content: "${v}", fontSize: "$label", color: "$text-primary", tabularNums: true }] })`).join('\n')}
I("eia-inspector", { type: "text", name: "Issues title", content: "Issues · ${FINDINGS} findings in ${ISSUES.length} groups", fontSize: "$body", fontWeight: 600, color: "$text-primary" })
issues=I("eia-inspector", { type: "frame", name: "Issues", width: "100%", layout: "vertical", gap: "$space-xs" })
${ISSUES.map((x, i) => issueCard(i, x)).join('\n')}
`;

const ARCHIVE = `
${sidebar('swa-sidebar', null, 3, 4)}
U("swa-header-title", { content: "Archive", title: "Archive" })
D("swa-secondary")
D("swa-primary")
meta=I("swa-header-actions", { type: "text", name: "Archive count", content: "3 canvases across all projects", fontSize: "$caption", color: "$text-secondary" })
M(meta, "swa-header-actions", 0)
D("swa-canvas")
tree=I("swa-work", { type: "frame", name: "Archived canvases", width: "100%", layout: "vertical", gap: "$space-3xs" })
I(tree, { type: "tree-row", label: "Pattern library", depth: 0, expanded: true, icon: "folder" })
I(tree, { type: "tree-row", label: "marquee-hero", depth: 1, icon: "file", active: true })
I(tree, { type: "tree-row", label: "catalogue", depth: 1, icon: "file" })
I(tree, { type: "tree-row", label: "UI", depth: 0, expanded: true, icon: "folder" })
I(tree, { type: "tree-row", label: "checkout-northrail-coffee-loading", depth: 1, icon: "file" })
U("swa-panel-title", { content: "marquee-hero", title: "marquee-hero" })
U("swa-prop-1", { label: "Project" })
U("swa-prop-1-value", { content: "Pattern library", title: "Pattern library" })
U("swa-prop-2", { label: "Archived" })
U("swa-prop-2-value", { content: "Nov 8, 2026", title: "Nov 8, 2026" })
U("swa-prop-3", { label: "Size" })
U("swa-prop-3-value", { content: "1440 × 900", title: "1440 × 900" })
I("swa-props", { type: "property-row", label: "Score", children: [{ type: "text", content: "100", fontSize: "$label", color: "$text-primary", tabularNums: true }] })
I("swa-panel", { type: "button", name: "Restore button", label: "Restore", icon: "archive-restore", size: "sm", maxWidth: "100%" })
I("swa-panel", { type: "divider", name: "Danger divider" })
danger=I("swa-panel", { type: "frame", name: "Delete permanently", width: "100%", layout: "vertical", gap: "$space-xs" })
I(danger, { type: "text", content: "Deleting removes the canvas and its variants for good.", fontSize: "$label", color: "$text-secondary" })
I(danger, { type: "button", name: "Delete permanently button", label: "Delete permanently", icon: "trash-2", variant: "destructive", size: "sm", maxWidth: "100%" })
`;

/** Ops on a variant: its node ids are re-keyed, so `v` maps a base id. */
type VariantOps = (v: (id: string) => string) => string;

const CONFIRM: VariantOps = (v) => `
I("${v('eia-shell')}", { type: "modal", name: "Delete dialog", size: "sm", title: "Delete canvas?", actions: [{ label: "Cancel" }, { label: "Delete", variant: "destructive" }], children: [{ type: "text", content: "“dashboard” and its 2 variants will be permanently deleted. This cannot be undone.", fontSize: "$label", color: "$text-primary" }] })
`;

const EMPTY: VariantOps = (v) => `
U("${v('swa-sidebar-more-1')}", { count: 0 })
U("${v('meta')}", { content: "0 canvases" })
D("${v('tree')}")
D("${v('swa-panel')}")
D("${v('swa-div-2')}")
D("${v('swa-toggle')}")
empty=I("${v('swa-work')}", { type: "frame", name: "Empty state", width: "100%", height: "100%", layout: "vertical", alignItems: "center", justifyContent: "center", gap: "$space-sm" })
I(empty, { type: "icon", icon: "archive", iconSize: 32, iconColor: "$text-secondary" })
I(empty, { type: "text", content: "No archived canvases", fontSize: "$body", fontWeight: 600, color: "$text-primary", textAlign: "center" })
I(empty, { type: "text", content: "Archive a canvas from its page, or have your agent call canvas_archive.", fontSize: "$body", color: "$text-secondary", textAlign: "center", maxWidth: 360 })
`;

// ── harness ─────────────────────────────────────────────────────────────────

const home = mkdtempSync(join(tmpdir(), 'framesmith-viewer-rebuild-'));
const cwd = mkdtempSync(join(tmpdir(), 'framesmith-viewer-rebuild-cwd-'));
const transport = new StdioClientTransport({
  command: resolve('node_modules/.bin/tsx'),
  args: [resolve('src/index.ts')],
  cwd,
  env: { ...process.env, FRAMESMITH_HOME: home, CANVAS_MCP_PROJECT_DIR: cwd, FRAMESMITH_VIEWER_URL: 'http://localhost:1' } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'test-viewer-rebuild', version: '0' });
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

type Node = { id: string; type: string; name?: string; label?: string; content?: string; variant?: string; active?: boolean; items?: Array<{ label: string; active?: boolean }>; children?: Node[]; [k: string]: unknown };
const walk = (n: Node, acc: Node[] = []): Node[] => { acc.push(n); (n.children ?? []).forEach((c) => walk(c, acc)); return acc; };
const readCanvas = (id: string) => JSON.parse(readFileSync(join(home, 'canvases', `${id}.json`), 'utf-8'));
const byName = (root: Node, name: string) => walk(root).filter((n) => n.name === name);
const parentOf = (root: Node, id: string): Node | undefined => walk(root).find((n) => (n.children ?? []).some((c) => c.id === id));

type Issue = { severity: string; rule?: string; tell?: string; theme?: string; message?: string; detail?: string; nodeId?: string; nodeIds?: string[] };
const describe = (issues: Issue[]) => issues.map((i) => `${i.severity}:${i.rule ?? i.tell ?? ''}${i.theme ? '(dark)' : ''} ${i.nodeId ?? ''} ${(i.message ?? i.detail ?? '').slice(0, 90)}`).join(' | ');
const opErrors = (b: unknown) => (typeof b === 'string' ? [b] : ((b as { errors?: unknown[] }).errors ?? []));

/** V4(5)'s predicate: every card message distinct. */
export const distinctMessages = (messages: string[]) => new Set(messages).size === messages.length;

async function build(name: string, projectId: string, anatomy: string, ops: string) {
  const c = await tool('canvas_create', { name, type: 'desktop-app', projectId });
  const s = await tool('apply_structure', { canvasId: c.canvasId, structure: anatomy });
  const b = await tool('batch_design', { canvasId: c.canvasId, operations: ops });
  check(`${name}: canvas_create declares a 1440×900 desktop-app canvas`, c.type === 'desktop-app' && c.width === 1440 && c.height === 900, JSON.stringify({ type: c.type, width: c.width, height: c.height }));
  check(`${name}: apply_structure("${anatomy}") stamps ${anatomy}-app`, s.applied === `${anatomy}-app`, s.applied);
  check(`${name}: the adaptation applies without op errors`, opErrors(b).length === 0, JSON.stringify(opErrors(b)).slice(0, 300));
  return { id: c.canvasId as string, bindings: (b.nodeIds ?? {}) as Record<string, string> };
}

async function variant(name: string, baseId: string, state: string, ops: VariantOps, baseBindings: Record<string, string>) {
  const r = await tool('canvas_add_variant', { canvasId: baseId, state });
  const idMap = r.idMap as Record<string, string>;
  const v = (id: string) => idMap[baseBindings[id] ?? id] ?? id;
  const b = await tool('batch_design', { canvasId: r.canvasId, operations: ops(v) });
  check(`${name}: the ${state} adaptation applies without op errors`, opErrors(b).length === 0, JSON.stringify(opErrors(b)).slice(0, 300));
  return { id: r.canvasId as string, v };
}

type Verdict = { name: string; id: string; scores: Record<string, number>; truncations: number; stress: string };
const verdicts: Verdict[] = [];

/** V3 on one canvas: stress, then fast, then detailed. */
async function judge(name: string, id: string, projectId: string, opts: { base: boolean; bigNumbers: boolean }) {
  const shot = await call('screenshot', { canvasId: id });
  const fontWarnings = shot.filter((x) => x.type === 'text' && x.text?.startsWith('Font warnings'));
  check(`${name}: the design system's fonts load (no Font warnings)`, fontWarnings.length === 0, fontWarnings.map((x) => x.text).join(' '));

  const st = await tool('canvas_stress', { canvasId: id });
  if (out) writeFileSync(join(out, `${slug(name)}-stress.json`), JSON.stringify(st, null, 2));
  const runs = (st.perturbations ?? []) as Array<{ name: string; touchedCount?: number; skipped?: string; findings?: Issue[] }>;
  const ran = runs.map((p) => p.name).sort();
  check(`${name}: canvas_stress ran the full default set`, JSON.stringify(ran) === JSON.stringify([...STRESS_DEFAULTS].sort()), ran.join(', '));
  const stressWarnings = runs.flatMap((p) => p.findings ?? []).filter((f) => f.severity !== 'info');
  check(`${name}: canvas_stress is CLEAN`, /^CLEAN\b/.test(st.verdict) && stressWarnings.length === 0, `${st.verdict?.slice(0, 60)}${stressWarnings.length ? ' — ' + describe(stressWarnings) : ''}`);
  const touched = (n: string) => runs.find((p) => p.name === n)?.touchedCount ?? 0;
  const must = STRESS_DEFAULTS.filter((n) => n !== 'big-numbers' || opts.bigNumbers);
  check(`${name}: every perturbation it must run touched a node (${must.join(', ')})`, must.every((n) => touched(n) > 0), runs.map((p) => `${p.name}:${p.touchedCount ?? 'skipped'}`).join(' '));
  const skipped = runs.filter((p) => p.skipped).map((p) => p.name);
  check(`${name}: no perturbation skipped${opts.bigNumbers ? '' : ' but big-numbers (no figures to widen)'}`, JSON.stringify(skipped) === JSON.stringify(opts.bigNumbers ? [] : ['big-numbers']), skipped.join(', '));
  const truncations = runs.flatMap((p) => p.findings ?? []).filter((f) => f.severity === 'info').length;

  const canvas = readCanvas(id);
  check(`${name}: the canvas sits in the viewer project`, canvas.projectId === projectId, canvas.projectId);
  check(`${name}: the canvas's own variables are empty (all tokens from the project)`, JSON.stringify(canvas.variables ?? {}) === '{}', JSON.stringify(canvas.variables).slice(0, 120));

  const scores: Record<string, number> = {};
  for (const mode of ['fast', 'detailed'] as const) {
    const content = await call('canvas_evaluate', { canvasId: id, mode });
    const ev = JSON.parse(content[0]?.text ?? '{}');
    // Detailed mode lays out in the design system's faces (S11) and says so
    // when one cannot load; fast mode renders nothing.
    const evalFonts = content.filter((x) => x.type === 'text' && x.text?.startsWith('Font warnings'));
    check(`${name} ${mode}: no Font warnings from evaluate`, evalFonts.length === 0, evalFonts.map((x) => x.text).join(' ').slice(0, 160));
    if (out) writeFileSync(join(out, `${slug(name)}-evaluate-${mode}.json`), JSON.stringify(ev, null, 2));
    const issues = ev.issues as Issue[];
    scores[mode] = ev.overallScore;
    const blocking = issues.filter((i) => i.severity === 'error' || i.severity === 'warning' || i.tell);
    check(`${name} ${mode}: CLEAN — zero errors, warnings and tells, READY`, blocking.length === 0 && /^READY/.test(ev.directive), `${ev.overallScore}/100${blocking.length ? ' — ' + describe(blocking) : ''}`);
    check(`${name} ${mode}: the directive read this canvas's own current CLEAN stress run`, ev.stress?.verdict === 'CLEAN' && ev.stress?.current === true && ev.stress?.type === 'desktop-app', JSON.stringify(ev.stress));
    const dark = issues.filter((i) => i.theme === 'dark' && i.severity !== 'info');
    check(`${name} ${mode}: no dark-theme warning or error`, dark.length === 0, describe(dark));
    const handbuilt = issues.filter((i) => i.rule === 'desktop-app-handbuilt-target');
    check(`${name} ${mode}: zero desktop-app-handbuilt-target findings`, handbuilt.length === 0, describe(handbuilt));
    const states = issues.filter((i) => STATE_RULES.includes(i.rule ?? ''));
    check(`${name} ${mode}: no state-rule finding of any severity (nothing skipped silently)`, states.length === 0, describe(states));
    const on = new Set(ev.surface?.rulesOn ?? []);
    const missing = DESKTOP_RULE_IDS.filter((r) => !on.has(r));
    check(`${name} ${mode}: the surface report enables every desktop-app rule and disables type-scale-ratio`,
      ev.surface?.type === 'desktop-app' && missing.length === 0 && (ev.surface?.rulesOff ?? []).includes('type-scale-ratio'),
      missing.length ? `missing ${missing.join(', ')}` : '');
    if (mode === 'fast' && opts.base) {
      // None of the bases is data-bearing (no detected table, fewer than
      // three form controls), so coverage has nothing to demand: the check
      // says so rather than passing on an empty list by accident.
      check(`${name}: coverage asks for no state variant (not data-bearing)`, ev.coverage?.dataBearing === false && JSON.stringify(ev.coverage?.missing ?? []) === '[]', JSON.stringify(ev.coverage));
    }
    console.log(`      ${mode} score ${ev.overallScore}/100 · ${issues.length} findings (${issues.filter((i) => i.severity === 'info').length} info)`);
  }
  verdicts.push({ name, id, scores, truncations, stress: String(st.verdict).split(' ')[0] });
  return canvas;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every colour on the canvas is a $token the merged tokens define, and
 * nothing resolves to a leftover `$` string in either theme (V4(4)). */
function tokenOnly(name: string, canvas: { root: Node }, defined: Set<string>) {
  const bad: string[] = [];
  const texts: string[] = [];
  const ref = (v: unknown) => typeof v === 'string' && v.startsWith('$') && defined.has(v.slice(1));
  for (const n of walk(canvas.root)) {
    if (n.type === 'text' && !ref(n.color)) texts.push(n.id);
    for (const f of COLOR_FIELDS) if (n[f] !== undefined && n[f] !== null && !ref(n[f])) bad.push(`${n.id}.${f}=${String(n[f])}`);
    const bb = n.borderBottom as { color?: string } | undefined;
    if (bb?.color !== undefined && !ref(bb.color)) bad.push(`${n.id}.borderBottom.color=${bb.color}`);
    for (const s of (n.shadows as Array<{ color?: string }> | undefined) ?? []) if (!ref(s.color)) bad.push(`${n.id}.shadows.color=${s.color}`);
  }
  check(`${name}: every text has an explicit $token colour`, texts.length === 0, texts.join(', '));
  check(`${name}: every colour field set is a defined $token`, bad.length === 0, bad.slice(0, 6).join(', '));
}

try {
  // ── build (V1, V2) ────────────────────────────────────────────────────────
  const ws = await tool('workspace_list', {});
  const workspaceId = (Array.isArray(ws) ? ws : ws.workspaces)[0].id;
  const project = await tool('project_create', { workspaceId, name: 'framesmith viewer' });
  const projectId = project.id as string;
  const ds = await tool('generate_design_system', { projectId, seed: '#B45309', personality: 'technical', baseSize: 14 });
  check('generate_design_system writes the project with the 14px pivot', ds.wroteTo?.layer === 'project' && ds.baseSize === 14, JSON.stringify(ds.wroteTo));

  const gallery = await build('Gallery', projectId, 'browser', GALLERY);
  const detail = await build('Canvas detail', projectId, 'editor-inspector', DETAIL);
  const archive = await build('Archive', projectId, 'split-workbench', ARCHIVE);

  // comment-open: the popover goes under the Comment button, read from its
  // rendered box, as GUIDELINES tells an agent to place one.
  const commentVariant = await variant('Comment open', detail.id, 'comment-open', () => '', {});
  const cv = readCanvas(commentVariant.id);
  const commentButton = byName(cv.root, 'Comment button')[0];
  const box = await tool('snapshot_layout', { canvasId: commentVariant.id, nodeId: commentButton.id });
  const btn = (Array.isArray(box) ? box[0] : box.layout?.[0] ?? box) as { x: number; y: number; width: number; height: number };
  const popW = 320;
  const popX = Math.round(btn.x + btn.width - popW);
  const popY = Math.round(btn.y + btn.height + 8);
  const pop = await tool('batch_design', { canvasId: commentVariant.id, operations: `
pop=I("${parentOf(cv.root, commentButton.id)!.id}", { type: "popover", name: "Comment popover", anchor: "${commentButton.id}", x: ${popX}, y: ${popY}, width: ${popW}, gap: "$space-sm", overflow: "auto" })
I(pop, { type: "text", content: "Comment on dashboard", fontSize: "$label", fontWeight: 600, color: "$text-primary" })
I(pop, { type: "text-input", name: "Comment field", placeholder: "Add a comment", rows: 3, width: "100%" })
row=I(pop, { type: "frame", name: "Comment actions", width: "100%", layout: "horizontal", justifyContent: "end", gap: "$space-xs", wrap: true })
I(row, { type: "button", label: "Cancel", variant: "secondary", size: "sm", maxWidth: "100%" })
I(row, { type: "button", label: "Post", size: "sm", maxWidth: "100%" })
` });
  check('Comment open: the popover inserts without op errors', opErrors(pop).length === 0, JSON.stringify(opErrors(pop)).slice(0, 300));
  const popNode = byName(readCanvas(commentVariant.id).root, 'Comment popover')[0];
  const popBox = await tool('snapshot_layout', { canvasId: commentVariant.id, nodeId: popNode.id });
  const popRect = (Array.isArray(popBox) ? popBox[0] : popBox.layout?.[0] ?? popBox) as { height: number };
  const fix = await tool('batch_design', { canvasId: commentVariant.id, operations: `U("${popNode.id}", { height: ${Math.ceil(popRect.height)} })` });
  check('Comment open: the popover takes its measured height', opErrors(fix).length === 0 && popRect.height > 0, `${popX},${popY} ${popW}×${Math.ceil(popRect.height)}`);

  const confirmVariant = await variant('Confirm delete', detail.id, 'confirm-delete', CONFIRM, detail.bindings);
  const emptyVariant = await variant('Archive empty', archive.id, 'empty', EMPTY, archive.bindings);

  // ── verdicts (V3) ─────────────────────────────────────────────────────────
  const six: Array<[string, string, { base: boolean; bigNumbers: boolean }]> = [
    ['Gallery', gallery.id, { base: true, bigNumbers: true }],
    ['Canvas detail', detail.id, { base: true, bigNumbers: true }],
    ['Archive', archive.id, { base: true, bigNumbers: true }],
    ['Comment open', commentVariant.id, { base: false, bigNumbers: true }],
    ['Confirm delete', confirmVariant.id, { base: false, bigNumbers: true }],
    // An empty archive shows no figures, so big-numbers has nothing to widen.
    ['Archive empty', emptyVariant.id, { base: false, bigNumbers: false }],
  ];
  const canvases: Record<string, { root: Node }> = {};
  for (const [name, id, opts] of six) canvases[name] = await judge(name, id, projectId, opts);

  // ── the six defects (V4) ──────────────────────────────────────────────────
  const detailRoot = canvases['Canvas detail'].root;
  // (1) Back
  const back = byName(detailRoot, 'Back link')[0];
  check('E3 Back: the back control is a link labelled "Back"', back?.type === 'link' && back.label === 'Back', JSON.stringify(back).slice(0, 120));
  const evDetail = await tool('canvas_evaluate', { canvasId: detail.id, mode: 'detailed' });
  const backTarget = (evDetail.issues as Issue[]).filter((i) => i.rule === 'desktop-app-target' && (i.nodeId === back.id || i.nodeIds?.includes(back.id)));
  check('E3 Back: detailed evaluate raises no desktop-app-target finding on it', backTarget.length === 0, describe(backTarget));
  const backBox = await tool('snapshot_layout', { canvasId: detail.id, nodeId: back.id });
  const backRect = (Array.isArray(backBox) ? backBox[0] : backBox.layout?.[0] ?? backBox) as { height: number };
  check('E3 Back: it renders at least 24 tall', backRect.height >= 24, `${backRect.height}px (the baseline's was 17)`);
  // (2) Inspector tabs
  const tabs = byName(detailRoot, 'Inspector tabs');
  const inspector = walk(detailRoot).find((n) => n.id === 'eia-inspector')!;
  check('E4 Inspector tabs: the inspector holds exactly one tabs node', walk(inspector).filter((n) => n.type === 'tabs').length === 1);
  const labels = tabs[0]?.items?.map((t) => t.label) ?? [];
  check('E4 Inspector tabs: one tabs node with Quality, Design system and Feedback, exactly one active',
    tabs.length === 1 && tabs[0].type === 'tabs' && JSON.stringify(labels) === JSON.stringify(['Quality', 'Design system', 'Feedback']) && tabs[0].items!.filter((t) => t.active).length === 1,
    labels.join(', '));
  // (3) Issue cards
  const CLICKABLE = new Set(['button', 'link', 'text-input', 'nav-item', 'tabs', 'tree-row', 'menu-row', 'list-row', 'toggle', 'checkbox', 'radio', 'select']);
  const cards = byName(detailRoot, 'Issue card');
  check('E4 Issue cards: every card is plain content holding a clickable primitive',
    cards.length === ISSUES.length && cards.every((c) => c.type === 'frame' && walk(c).some((n) => CLICKABLE.has(n.type))),
    `${cards.length} cards`);
  // (4) Muted labels
  // Every canvas's own variables are empty (judge), so the project's design
  // system is what each one resolves.
  const system = await tool('project_get_design_system', { projectId });
  const tokens = (system.designSystem ?? system.variables ?? system) as { colors?: Record<string, string>; dark?: { colors?: Record<string, string> } };
  const colors = tokens.colors ?? {};
  const darkColors = { ...colors, ...(tokens.dark?.colors ?? {}) };
  check('the project design system carries a dark colour layer that restates $text-secondary', Object.keys(tokens.dark?.colors ?? {}).length > 0 && !!tokens.dark?.colors?.['text-secondary'] && tokens.dark.colors['text-secondary'] !== colors['text-secondary']);
  for (const [theme, c] of [['light', colors], ['dark', darkColors]] as const) {
    for (const bg of ['bg-primary', 'bg-surface', 'bg-elevated']) {
      const fg = parseColor(c['text-secondary']);
      const back2 = parseColor(c[bg]);
      const ratio = fg && back2 ? Math.round(contrastRatio(fg, back2) * 100) / 100 : 0;
      check(`E1/E2 Muted labels: $text-secondary on $${bg} is 4.5:1 or more (${theme})`, ratio >= 4.5, `${ratio}:1`);
    }
  }
  const defined = new Set(Object.keys(darkColors));
  for (const [name] of six) tokenOnly(name, canvases[name], defined);
  // Any $ref, colour or not (a misspelt "$space-sm" or "$caption"), would be
  // left in the resolved tree as a literal string the renderer drops.
  for (const [name] of six) {
    for (const theme of ['light', 'dark'] as const) {
      const resolved = resolveVariables(canvases[name].root as unknown as SceneNode, tokens as DesignVariables, { theme });
      const left: string[] = [];
      const scan = (v: unknown, path: string) => {
        if (typeof v === 'string') { if (v.startsWith('$')) left.push(`${path}=${v}`); }
        else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}[${i}]`));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, path ? `${path}.${k}` : k);
      };
      scan(resolved, '');
      check(`${name}: no unresolved $ref in the ${theme} tree`, left.length === 0, left.slice(0, 4).join(', '));
    }
  }
  // (5) Grouped issues
  const messages = cards.map((c) => walk(c).find((n) => n.name === 'Issue message')?.content ?? '');
  check('E5 Grouped issues: no two issue cards carry the same message', distinctMessages(messages));
  const tracking = cards.find((c) => /28px with default tracking/.test(walk(c).find((n) => n.name === 'Issue message')?.content ?? ''));
  check('E5 Grouped issues: the repeated tracking finding is one card naming its four nodes',
    !!tracking && walk(tracking).some((n) => /\b4 nodes\b/.test(String(n.label ?? n.content ?? ''))));
  check('twin (d): the distinct-message predicate fails on a duplicated card', !distinctMessages([...messages, messages[0]]));
  // (6) Delete apart from Archive: a different weight, and either another
  // group or a divider between them.
  const del = byName(detailRoot, 'Delete button')[0];
  const arc = byName(detailRoot, 'Archive button')[0];
  const delParent = parentOf(detailRoot, del.id)!;
  const arcParent = parentOf(detailRoot, arc.id)!;
  const kids = delParent.children!.map((c) => c.id);
  const lo = Math.min(kids.indexOf(arc.id), kids.indexOf(del.id));
  const hi = Math.max(kids.indexOf(arc.id), kids.indexOf(del.id));
  const apart = arcParent.id !== delParent.id || delParent.children!.slice(lo + 1, hi).some((n) => n.type === 'divider');
  check('E6 Delete: a destructive button; Archive is neither destructive nor primary',
    del.type === 'button' && del.variant === 'destructive' && arc.type === 'button' && typeof arc.variant === 'string' && !['destructive', 'primary'].includes(arc.variant as string),
    `${del.variant} / ${arc.variant}`);
  check('E6 Delete: set apart from Archive (another group, or a divider between them)', apart);
  const confirmIssues = (await tool('canvas_evaluate', { canvasId: confirmVariant.id, mode: 'fast' })).issues as Issue[];
  check('Confirm delete: the dialog\'s one filled action raises no primary-count info', !confirmIssues.some((i) => i.rule === 'desktop-app-primary-count'));
  const archiveRoot = canvases['Archive'].root;
  const permanent = byName(archiveRoot, 'Delete permanently button')[0];
  const panel = walk(archiveRoot).find((n) => n.id === 'swa-panel')!;
  const pk = panel.children!.map((c) => c.name ?? c.id);
  check('E6 Delete: the archive\'s permanent delete is destructive and sits below a divider from Restore',
    permanent?.variant === 'destructive' && pk.indexOf('Danger divider') > pk.indexOf('Restore button') && pk.indexOf('Delete permanently') > pk.indexOf('Danger divider'),
    pk.join(' > '));

  // ── twins (V5) ────────────────────────────────────────────────────────────
  // Each twin runs on a throwaway clone of the detail page (canvas_add_variant
  // under a twin-* state), so the six judged canvases are never touched:
  // set_variables only merges, so a canvas once overridden can't return to
  // the empty variables V3 asserts.
  let twins = 0;
  async function twin(state: string, ops: VariantOps, setup?: (id: string) => Promise<void>) {
    const t = await variant(`twin ${state}`, detail.id, `twin-${++twins}-${state}`, ops, detail.bindings);
    if (setup) await setup(t.id);
    return t;
  }
  const fastIssues = async (id: string) => (await tool('canvas_evaluate', { canvasId: id, mode: 'fast' })).issues as Issue[];
  const detailedIssues = async (id: string) => (await tool('canvas_evaluate', { canvasId: id, mode: 'detailed' })).issues as Issue[];

  // (a) a dark-only contrast failure surfaces, so V3(c) is live.
  const darkTwin = await twin('dark-contrast', () => '', async (id) => {
    await tool('set_variables', { canvasId: id, variables: { dark: { colors: { 'text-secondary': darkColors['bg-surface'] } } } });
  });
  const darkErr = (await fastIssues(darkTwin.id)).filter((i) => i.theme === 'dark' && i.severity === 'error');
  check('twin (a): a dark-only contrast failure raises a dark-tagged error', darkErr.length > 0, describe(darkErr.slice(0, 2)));

  // (b) the baseline's hand-built back control is named, so V3(d) is live.
  const handTwin = await twin('handbuilt-back', (v) => `
D("${v('eia-crumb-parent')}")
hb=I("${v('eia-crumb-slot')}", { type: "frame", name: "Hand-built back", height: 17, layout: "horizontal", alignItems: "center", gap: 4 })
I(hb, { type: "icon", icon: "arrow-left", iconSize: 14, iconColor: "$text-secondary" })
I(hb, { type: "text", content: "Back", fontSize: "$caption", color: "$text-secondary" })
`);
  for (const [mode, issues] of [['fast', await fastIssues(handTwin.id)], ['detailed', await detailedIssues(handTwin.id)]] as const) {
    const hit = issues.filter((i) => i.rule === 'desktop-app-handbuilt-target');
    check(`twin (b) ${mode}: the baseline's hand-built Back raises desktop-app-handbuilt-target`, hit.length > 0, describe(hit));
  }

  // (c) two packed 20px targets fail the 24px circle, so V4(1)'s rule is live.
  const packTwin = await twin('packed-targets', (v) => `
pk=I("${v('eia-work')}", { type: "frame", name: "Packed tools", layout: "horizontal", gap: 0 })
I(pk, { type: "button", icon: "zoom-in", ariaLabel: "Zoom in", variant: "ghost", size: "xs", height: 20, color: "$text-secondary" })
I(pk, { type: "button", icon: "zoom-out", ariaLabel: "Zoom out", variant: "ghost", size: "xs", height: 20, color: "$text-secondary" })
`);
  const packFast = (await fastIssues(packTwin.id)).filter((i) => i.rule === 'desktop-app-target');
  const packDetailed = (await detailedIssues(packTwin.id)).filter((i) => i.rule === 'desktop-app-target');
  check('twin (c) fast: two packed 20px buttons warn', packFast.filter((i) => i.severity === 'warning').length === 2, describe(packFast));
  check('twin (c) detailed: two packed 20px buttons are errors', packDetailed.filter((i) => i.severity === 'error').length === 2, describe(packDetailed));

  // (e) a FRAGILE stress run blocks presenting, so V3(a)/(b) read live state.
  const clipTwin = await twin('clipped-label', (v) => `
cl=I("${v('eia-work')}", { type: "frame", name: "Clipped label", width: 160, height: 20, overflow: "hidden" })
I(cl, { type: "text", content: "Short label", fontSize: "$label", color: "$text-primary" })
`);
  const clipStress = await tool('canvas_stress', { canvasId: clipTwin.id });
  const clipEval = await tool('canvas_evaluate', { canvasId: clipTwin.id, mode: 'fast' });
  check('twin (e): a label that wraps and clips under long-text makes stress FRAGILE', /^FRAGILE\b/.test(clipStress.verdict), clipStress.verdict?.slice(0, 60));
  check('twin (e): the next fast evaluate is not READY', !/^READY/.test(clipEval.directive) && clipEval.stress?.verdict === 'FRAGILE', clipEval.directive?.slice(0, 60));

  // (f) a popover leaving the window warns, so desktop-app-overlay is live.
  const popTwin = await twin('popover-off-window', (v) => `
I("${v('eia-actions')}", { type: "popover", name: "Off-window popover", x: 1300, y: ${popY}, width: 320, height: 120, children: [{ type: "text", content: "Comment on dashboard", fontSize: "$label", color: "$text-primary" }] })
`);
  const off = (await fastIssues(popTwin.id)).filter((i) => i.rule === 'desktop-app-overlay' && i.severity === 'warning');
  check('twin (f) fast: a popover leaving the window raises a desktop-app-overlay warning', off.length > 0, describe(off));

  // (g) a focus ring the colour of the panel fails, so the state rules are live.
  const ringTwin = await twin('focus-ring', () => '', async (id) => {
    await tool('set_variables', { canvasId: id, variables: { colors: { 'focus-ring': colors['bg-surface'] } } });
  });
  const ring = (await fastIssues(ringTwin.id)).filter((i) => i.rule === 'desktop-app-focus-visible' && i.severity === 'error');
  check('twin (g): a focus ring the colour of the inspector panel raises desktop-app-focus-visible', ring.length > 0, describe(ring.slice(0, 1)));

  // (h) a clone never stressed carries no stress record, so the judge's
  // "stress field present" check is live; (i) a clone stressed CLEAN and then
  // edited reads current: false.
  const freshTwin = await twin('never-stressed', () => '');
  const fresh = await tool('canvas_evaluate', { canvasId: freshTwin.id, mode: 'fast' });
  check('twin (h): a canvas never stressed has no stress field', fresh.stress === undefined, JSON.stringify(fresh.stress));
  const staleTwin = await twin('stale-stress', () => '');
  const staleRun = await tool('canvas_stress', { canvasId: staleTwin.id });
  await tool('batch_design', { canvasId: staleTwin.id, operations: `U("${staleTwin.v('eia-canvas-label')}", { content: "Canvas preview" })` });
  const stale = await tool('canvas_evaluate', { canvasId: staleTwin.id, mode: 'fast' });
  check('twin (i): an edit after a CLEAN stress run reads current: false', /^CLEAN\b/.test(staleRun.verdict) && stale.stress?.verdict === 'CLEAN' && stale.stress?.current === false, JSON.stringify(stale.stress));
  // (j) a dialog with two filled primaries raises the primary-count info that
  // Confirm delete must not.
  const primaryTwin = await twin('two-primaries', (v) => `
I("${v('eia-shell')}", { type: "modal", size: "sm", title: "Delete canvas?", actions: [{ label: "Keep", variant: "primary" }, { label: "Delete", variant: "primary" }], children: [{ type: "text", content: "This cannot be undone.", fontSize: "$label", color: "$text-primary" }] })
`);
  check('twin (j): two primary actions in one dialog raise desktop-app-primary-count', ((await fastIssues(primaryTwin.id)).some((i) => i.rule === 'desktop-app-primary-count')));

  // The judged canvases were not touched by the twins.
  for (const [name, id] of six) {
    const ev = await tool('canvas_evaluate', { canvasId: id, mode: 'fast' });
    check(`${name}: still READY on its own current CLEAN stress run after the twins`, /^READY/.test(ev.directive) && ev.stress?.current === true && ev.stress?.verdict === 'CLEAN');
  }

  // ── evidence (V6) ─────────────────────────────────────────────────────────
  if (out) {
    for (const [name, id] of six) {
      for (const theme of ['light', 'dark'] as const) {
        const img = (await call('screenshot', { canvasId: id, theme })).find((x) => x.type === 'image');
        if (img?.data) writeFileSync(join(out, `${slug(name)}-${theme}.png`), Buffer.from(img.data, 'base64'));
      }
      writeFileSync(join(out, `${slug(name)}.json`), JSON.stringify(readCanvas(id), null, 2));
    }
    const crops: Array<[string, string, string]> = [
      ['defect-1-muted-labels', gallery.id, 'bra-sidebar'],
      ['defect-2-back', detail.id, 'eia-crumbs'],
      ['defect-3-inspector-tabs', detail.id, byName(detailRoot, 'Inspector tabs')[0].id],
      ['defect-4-issue-cards', detail.id, byName(detailRoot, 'Issues')[0].id],
      ['defect-5-grouped-issue', detail.id, tracking!.id],
      ['defect-6-delete-apart', detail.id, 'eia-actions'],
    ];
    for (const [file, id, nodeId] of crops) {
      const img = (await call('screenshot', { canvasId: id, nodeId, theme: 'dark' })).find((x) => x.type === 'image');
      if (img?.data) writeFileSync(join(out, `${file}.png`), Buffer.from(img.data, 'base64'));
    }
  }

  // ── the numbers the PR quotes ─────────────────────────────────────────────
  console.log('\nCanvas            fast  detailed  stress  designed truncations');
  for (const v of verdicts) console.log(`${v.name.padEnd(18)}${String(v.scores.fast).padEnd(6)}${String(v.scores.detailed).padEnd(10)}${v.stress.padEnd(8)}${v.truncations}`);
  console.log('\nDone.');
} finally {
  await client.close();
}

console.log(allPass ? '\nAll checks passed.' : '\nSome checks FAILED.');
process.exit(allPass ? 0 : 1);
