// Phase 33 slice A — the canvas detail page, moved from viewer.ts.
import type { Canvas } from '../../types.js';
import { getProject, getCanvasTokens, getProjectDesignSystem, getWorkspaceDesignSystem } from '../../workspaces.js';
import { listCanvases } from '../../scene-graph.js';
import { resolveSurface, usableSafeArea, deviceProfile, windowProfile, WINDOW_PROFILES, DEFAULT_WINDOW, DEFAULT_DEVICE, type DeviceProfile } from '../../surfaces.js';
import { foldIssues, resolveGenre, type EvaluationResult, type EvaluationIssue } from '../../evaluate.js';
import { isPresetName } from '../../genre.js';
import { openFeedbackCount } from '../../feedback.js';
import { withoutRetiredSeeds } from '../../variables.js';
import { baseCss, COMPONENTS_CSS } from '../styles.js';
import { TYPE_LABELS } from './project.js';
import { FAVICON_HTML, icon, renderDialog, renderMenu, renderTabs } from '../components.js';
import { artboardSize, buildNodeIndex, esc, PHONE } from '../shared.js';
import { evalFor } from '../scores.js';
import { detailScript } from '../client/detail.js';

/** The evaluator's quality bar: a score above 95 is at it (FR-B2, FR-D1). */
const BAR = 96;

const CATEGORY_LABELS: Record<string, string> = {
  spacing: 'Spacing', color: 'Color', typography: 'Typography', structure: 'Structure',
  consistency: 'Consistency', usability: 'Usability', coverage: 'Coverage', cliche: 'Cliché',
};
const categoryLabel = (name: string) => CATEGORY_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1 };
const severityRank = (sev: string) => SEVERITY_RANK[sev] ?? 2;

/** One folded issue as a ruled row (FR-D1): "<Category> · <kind>", the
 * message, and a link that outlines its nodes. The suggestion is the row's
 * tooltip; the agent reads it from canvas_evaluate. */
function renderIssueRow(issue: EvaluationIssue): string {
  const fixable = !!issue.fix || (issue.fixes?.length ?? 0) > 0;
  const kind = issue.tell ?? (fixable ? 'auto-fixable' : issue.severity);
  const nodes = issue.nodeIds?.length ? issue.nodeIds : issue.nodeId ? [issue.nodeId] : [];
  const show = nodes.length
    ? `<button type="button" class="issue-nodes" data-nodes="${esc(JSON.stringify(nodes))}">Show ${nodes.length} node${nodes.length === 1 ? '' : 's'}</button>`
    : '';
  return `
    <div class="issue issue--${esc(issue.severity)}"${issue.suggestion ? ` title="${esc(issue.suggestion)}"` : ''}>
      <div class="issue-kind">${esc(categoryLabel(issue.category))} · ${esc(kind)}</div>
      <div class="issue-msg">${esc(issue.message)}</div>
      ${show}
    </div>`;
}

/* ── Phase 19 Slice B — Design-system panel ───────────────────────────────
 * Resolves the canvas's effective tokens (the merged workspace▸project▸canvas
 * chain) and shows them as swatches / type scale / spacing / radius. Each token
 * is attributed to the layer it resolved from; only OVERRIDES of the dominant
 * layer are tagged (the section header states the default), keeping it clean. */
type TokenLayer = 'canvas' | 'project' | 'workspace' | 'default';

function mostCommon(layers: TokenLayer[]): TokenLayer {
  const tally = new Map<TokenLayer, number>();
  for (const l of layers) tally.set(l, (tally.get(l) ?? 0) + 1);
  let best: TokenLayer = 'default'; let n = -1;
  for (const [l, c] of tally) if (c > n) { best = l; n = c; }
  return best;
}

function renderDesignSystem(canvas: Canvas): string {
  const tokens = getCanvasTokens(canvas);
  const project = getProject(canvas.projectId);
  const projectDS = project ? getProjectDesignSystem(project.id) : undefined;
  const workspaceDS = project ? getWorkspaceDesignSystem(project.workspaceId) : undefined;

  const has = (ds: unknown, cat: string, name: string): boolean => {
    const m = ds && (ds as Record<string, unknown>)[cat];
    return !!m && Object.prototype.hasOwnProperty.call(m, name);
  };
  const sourceOf = (cat: string, name: string): TokenLayer => {
    // A retired scaffold seed is not the canvas's value (FR-C6).
    if (has(withoutRetiredSeeds(canvas.variables), cat, name)) return 'canvas';
    if (has(projectDS, cat, name)) return 'project';
    if (has(workspaceDS, cat, name)) return 'workspace';
    return 'default';
  };

  const cats = ['colors', 'spacing', 'radius', 'typography'] as const;
  const allSources: TokenLayer[] = [];
  for (const cat of cats) {
    const m = (tokens as Record<string, unknown>)[cat] as Record<string, unknown> | undefined;
    if (m) for (const n of Object.keys(m)) allSources.push(sourceOf(cat, n));
  }
  if (allSources.length === 0) {
    return '<div class="insp-section"><div class="insp-empty">This canvas inherits no design tokens. Set them with set_variables or bind a design system.</div></div>';
  }
  const dominant = mostCommon(allSources);
  const defaultLabel = dominant === 'default' ? 'defaults' : `from ${dominant}`;
  const tag = (cat: string, name: string): string => {
    const s = sourceOf(cat, name);
    return s === dominant ? '' : ` <span class="ds-src ds-src--${s}">${s}</span>`;
  };
  const sectionLabel = (title: string): string =>
    `<div class="insp-section-head"><span class="insp-section-label">${title}</span><span class="ds-default">${defaultLabel}</span></div>`;

  const colors = (tokens.colors ?? {}) as Record<string, string>;
  const colorEntries = Object.entries(colors);
  const colorSec = colorEntries.length ? `
    <div class="insp-section">
      ${sectionLabel('Colors')}
      <div class="ds-swatches">
        ${colorEntries.map(([name, hex]) => `
          <div class="ds-swatch">
            <div class="ds-chip" style="background:${esc(String(hex))}"></div>
            <div class="ds-swatch-meta">
              <span class="ds-name">${esc(name)}${tag('colors', name)}</span>
              <span class="ds-hex">${esc(String(hex))}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const typo = (tokens.typography ?? {}) as Record<string, { fontSize?: number; fontWeight?: number | string }>;
  const typoEntries = Object.entries(typo);
  const typeSec = typoEntries.length ? `
    <div class="insp-divider"></div>
    <div class="insp-section">
      ${sectionLabel('Type scale')}
      ${typoEntries.map(([name, t]) => {
        const size = Number(t.fontSize ?? 14);
        const weight = t.fontWeight ?? 400;
        const disp = Math.min(Number.isFinite(size) ? size : 14, 30);
        return `<div class="ds-type">
          <span class="ds-type-sample" style="font-size:${disp}px;font-weight:${esc(String(weight))}">${esc(name)}</span>
          <span class="ds-type-meta">${esc(String(t.fontSize ?? '—'))}/${esc(String(weight))}${tag('typography', name)}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const spacing = (tokens.spacing ?? {}) as Record<string, number>;
  const spacingEntries = Object.entries(spacing);
  const maxSp = Math.max(1, ...spacingEntries.map(([, v]) => Number(v)).filter((n) => Number.isFinite(n)));
  const spaceSec = spacingEntries.length ? `
    <div class="insp-divider"></div>
    <div class="insp-section">
      ${sectionLabel('Spacing')}
      ${spacingEntries.map(([name, val]) => {
        const w = Math.max(6, Math.round((Number(val) / maxSp) * 120));
        return `<div class="ds-sp">
          <span class="ds-sp-name">${esc(name)}${tag('spacing', name)}</span>
          <span class="ds-sp-bar" style="width:${w}px"></span>
          <span class="ds-sp-val">${esc(String(val))}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const radius = (tokens.radius ?? {}) as Record<string, number>;
  const radiusEntries = Object.entries(radius);
  const radiusSec = radiusEntries.length ? `
    <div class="insp-divider"></div>
    <div class="insp-section">
      ${sectionLabel('Radius')}
      <div class="ds-radii">
        ${radiusEntries.map(([name, val]) => {
          const r = Math.min(Math.max(0, Number(val) || 0), 22);
          return `<div class="ds-rad">
            <div class="ds-rad-tile" style="border-radius:${r}px"></div>
            <span class="ds-rad-label">${esc(name)} · ${esc(String(val))}${tag('radius', name)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const body = `${colorSec}${typeSec}${spaceSec}${radiusSec}`;
  return body.trim() ? body : '<div class="insp-section"><div class="insp-empty">This canvas inherits no design tokens.</div></div>';
}

/** The Quality tab (FR-D1): the score against the bar with a reason line,
 * provenance and critique, the categories lowest first, then the folded
 * issues, errors first. */
export function renderQualityPanel(ev: EvaluationResult | null, canvas: Canvas): string {
  if (!ev) return '<div class="insp-section"><div class="insp-empty">An empty canvas has no score yet.</div></div>';
  const below = ev.overallScore < BAR;
  const folded = foldIssues(ev.issues);
  const ordered = [...folded].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const cats = [...ev.categories].sort((a, b) => a.score - b.score);
  const weakest = cats.find((c) => c.score < 100);
  const blocker = weakest ? ordered.find((i) => i.category === weakest.name) : undefined;
  const reason = weakest
    ? `${categoryLabel(weakest.name)} holds it back${blocker ? `: ${blocker.message}` : '.'}`
    : 'Every category is at 100.';

  const prov = canvas.metadata?.provenance;
  const genre = resolveGenre(canvas).genre;
  const built = [prov?.structure, genre, prov?.preset && ('genre' in (prov ?? {}) || isPresetName(prov.preset)) ? prov.preset : undefined].filter(Boolean) as string[];
  const crit = canvas.metadata?.critique;

  const findings = folded.reduce((n, i) => n + (i.count ?? 1), 0);
  return `
    <div class="insp-section score-block">
      <div class="score-line">
        <div class="score-figure"><span class="score-value">${ev.overallScore}</span><span class="score-scale">/ 100</span></div>
        <span class="verdict-chip${below ? ' verdict-chip--below' : ''}">${below ? 'Below the bar' : 'At the bar'}</span>
      </div>
      <div class="score-reason">${esc(reason)}</div>
      ${built.length ? `<div class="score-built">Built from ${esc(built.join(' · '))}</div>` : ''}
      ${crit ? `<div class="score-critique">Vision critique ${crit.overall}/100${crit.needsRevision ? ' · needs revision' : ''}</div>` : ''}
    </div>
    <div class="insp-section categories">
      ${cats.map((c) => `<div class="category${c.score < BAR ? ' category--below' : ''}">
        <span class="category-name">${esc(categoryLabel(c.name))}</span>
        <span class="meter"><span class="meter-fill" style="width:${Math.max(0, Math.min(100, c.score))}%"></span></span>
        <span class="category-score">${c.score}</span>
      </div>`).join('')}
    </div>
    <div class="insp-section issues">
      <div class="issues-head"><span class="issues-title">Issues</span><span class="issues-count">${folded.length ? `${findings} finding${findings === 1 ? '' : 's'} in ${folded.length} group${folded.length === 1 ? '' : 's'}` : ''}</span></div>
      ${ordered.length ? ordered.map(renderIssueRow).join('') : '<div class="insp-empty">No issues. This canvas is clean.</div>'}
    </div>`;
}

/** The Feedback tab's shell; the list is rendered client-side from
 * /api/canvas/:id/feedback, so comment text never passes through innerHTML. */
function renderFeedbackPanel(): string {
  return `<div class="insp-section">
      <div class="fb-hint">Press <b>Comment</b>, then click an element in the preview to pin a note for the agent.</div>
      <div id="fb-pane"></div>
    </div>`;
}

/** What GET /canvas/:id/inspector returns (FR-D4): the panels the page swaps
 * when the canvas changes, and the node index the comment popover labels with. */
export async function renderInspectorParts(canvas: Canvas): Promise<{ quality: string; design: string; nodeIndex: Record<string, { name?: string; type: string }> }> {
  return { quality: renderQualityPanel(await evalFor(canvas), canvas), design: renderDesignSystem(canvas), nodeIndex: buildNodeIndex(canvas.root) };
}

function renderInspector(ev: EvaluationResult | null, canvas: Canvas): string {
  const open = openFeedbackCount(canvas);
  return `
  <aside class="inspector" id="inspector" aria-label="Inspector">
    <div class="insp-tabs">${renderTabs([
      { id: 'quality', label: 'Quality', selected: true, panelId: 'insp-quality' },
      { id: 'design', label: 'Design system', panelId: 'insp-design' },
      { id: 'feedback', label: 'Feedback', count: open, panelId: 'insp-feedback' },
    ], 'Inspector')}</div>
    <section class="insp-panel" id="insp-quality" role="tabpanel" aria-labelledby="tab-quality">${renderQualityPanel(ev, canvas)}</section>
    <section class="insp-panel" id="insp-design" role="tabpanel" aria-labelledby="tab-design" hidden>${renderDesignSystem(canvas)}</section>
    <section class="insp-panel" id="insp-feedback" role="tabpanel" aria-labelledby="tab-feedback" hidden>${renderFeedbackPanel()}</section>
  </aside>`;
}

/** The detail view's device presentation: the canvas at 1:1 inside a bezel,
 *  with the safe-area bands (the root's `safeArea`, else the profile's insets,
 *  per side — the hardware intrudes there either way) hidden until toggled. A
 *  side set to 0 draws no band. */
function renderDevice(canvas: Canvas, w: number, h: number, deviceId: string, profile: DeviceProfile, tools: string): string {
  const reserved = canvas.root.type === 'document' ? usableSafeArea(canvas.root.safeArea) : {};
  const top = reserved.top ?? profile.safeArea.top;
  const bottom = reserved.bottom ?? profile.safeArea.bottom;
  return `<div class="viewport viewport--device" id="viewport">
    ${tools}
    <div class="device" data-device="${esc(deviceId)}">
      <div class="device-screen" style="width: ${w}px; height: ${h}px;">
        <iframe id="frame" src="/canvas/${canvas.id}/html" width="${w}" height="${h}"></iframe>
        <div class="safe-overlay" id="safe-overlay" hidden>
          ${top > 0 ? `<div class="safe-band safe-band--top" style="height: ${top}px;"><span>${top}</span></div>` : ''}
          ${bottom > 0 ? `<div class="safe-band safe-band--bottom" style="height: ${bottom}px;"><span>${bottom}</span></div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

export async function renderDetailPage(canvas: Canvas, port: number): Promise<string> {
  const { w, h } = artboardSize(canvas);
  // Phase 30 slice F — a mobile canvas opens 1:1 in a device frame; a web
  // canvas keeps the breakpoint buttons, sized from the device profile table.
  const surface = resolveSurface(canvas);
  const isMobile = surface.type === 'mobile';
  // Phase 31 FR-I1 — a desktop-app canvas's breakpoints are window widths
  // from its window profile (narrower than the artboard), not phone/tablet.
  const window = surface.type === 'desktop-app' ? windowProfile(surface.device ?? DEFAULT_WINDOW) ?? WINDOW_PROFILES[DEFAULT_WINDOW] : undefined;
  const windowWidths = window ? window.breakpoints.filter((bw) => bw < w) : [];
  const deviceId = surface.device ?? DEFAULT_DEVICE;
  const profile = deviceProfile(deviceId) ?? PHONE;

  // Phase 25 slice D — a dark token layer makes the theme toggle appear.
  const hasDark = Object.keys(getCanvasTokens(canvas).dark?.colors ?? {}).length > 0;

  // Phase 33 FR-C1 — the screen's designed states as a nav of links (each is a
  // page, so not a tablist): on a base with variants, "default" (current) and
  // each state; on a variant, the base ("default") and every sibling. Orphan-
  // safe: a variant whose base is gone shows none.
  const rows = listCanvases();
  const selfRow = rows.find((r) => r.id === canvas.id);
  const baseRow = selfRow?.variants?.length ? selfRow : selfRow?.variant ? rows.find((r) => r.id === selfRow.variant!.of) : undefined;
  const designedStates = (baseRow?.variants ?? []).map((v) => v.state);
  let stateNav = '';
  if (baseRow) {
    const link = (label: string, id: string) => `<a class="state-link" href="/canvas/${esc(id)}"${id === canvas.id ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
    stateNav = `<nav class="state-nav" aria-label="States">${[
      link('default', baseRow.id),
      ...(baseRow.variants ?? []).map((v) => link(v.state, v.canvasId)),
    ].join('')}</nav>`;
  }



  const projectName = getProject(canvas.projectId)?.name ?? 'Back';
  const openComments = openFeedbackCount(canvas);
  const caption = [TYPE_LABELS[surface.type], `${w} × ${h}`, designedStates.length ? `States: ${designedStates.join(', ')}` : 'No state variants yet'].join(' · ');

  // FR-C1 — the breakpoints by type: web gets phone, tablet, the artboard and
  // Compare; desktop-app the window widths below the artboard, the artboard
  // and Compare; mobile none (it shows the device frame at 1:1).
  // The shared tab handler (COMPONENTS_JS) selects on click and arrow keys and
  // fires "tabchange"; the page script switches the preview from data-w/h.
  const bpTab = (id: string, label: string, size: [number, number] | null, selected = false, title = '') =>
    `<button type="button" role="tab" class="tab bp-btn" id="bp-${id}" data-tab="${id}"${size ? ` data-w="${size[0]}" data-h="${size[1]}"` : ''} aria-selected="${selected}" tabindex="${selected ? 0 : -1}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
  const breakpoints = isMobile ? '<div class="breakpoints"></div>' : `<div class="breakpoints"><div class="tablist bp-tabs" role="tablist" aria-label="Preview width">${window
    ? [...windowWidths.map((bw) => bpTab(`w${bw}`, String(bw), [bw, h], false, `A ${bw}px window`)),
       bpTab('desktop', String(w), [w, h], true, "The artboard's window"),
       bpTab('compare', 'Compare', null)].join('')
    : [bpTab('mobile', 'Mobile', [PHONE.width, PHONE.height]),
       bpTab('tablet', 'Tablet', [768, 1024]),
       bpTab('desktop', 'Desktop', [w, h], true),
       bpTab('compare', 'Compare', null)].join('')}</div></div>`;

  // FR-C4 — the preview tools: zoom on web and desktop-app canvases; the
  // preview's theme when a dark layer exists; the safe area on a phone.
  const toolButton = (id: string, iconName: string, label: string, onclick: string, pressed?: boolean) =>
    `<button type="button" class="btn btn--ghost btn--icon btn--xs" id="${id}" aria-label="${esc(label)}" title="${esc(label)}" onclick="${onclick}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${icon(iconName)}</button>`;
  const tools = `<div class="tools" role="toolbar" aria-label="Preview tools">${[
    ...(isMobile ? [] : [toolButton('btn-zoom-in', 'zoom-in', 'Zoom in', 'zoomBy(1)'), toolButton('btn-zoom-out', 'zoom-out', 'Zoom out', 'zoomBy(-1)'), toolButton('btn-fit', 'scan', 'Fit to window', 'fitPreview()')]),
    ...(hasDark ? [toolButton('theme-toggle', 'moon', 'Preview in dark', 'toggleTheme()', false)] : []),
    ...(isMobile ? [toolButton('btn-safe', 'smartphone', 'Show safe area', 'toggleSafeArea()', false)] : []),
  ].join('')}</div>`;

  // Phase 19 Slice A — heuristic quality inspector (fast, Chrome-free, read-only).
  const ev = await evalFor(canvas);
  const inspectorHtml = renderInspector(ev, canvas);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(canvas.name)} — Framesmith</title>
${FAVICON_HTML}
<style>
  ${baseCss()}
  ${COMPONENTS_CSS}
  body { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  /* Phase 33 FR-C1 — the toolbar: crumbs, breakpoint tabs, actions. */
  .toolbar { height: 48px; flex-shrink: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: var(--space-md); padding: 0 var(--space-md); background: var(--bg-surface); border-bottom: 1px solid var(--border); }
  .crumbs { display: flex; align-items: center; gap: var(--space-xs); min-width: 0; overflow: hidden; }
  .crumbs > * { flex-shrink: 0; }
  .back-link { display: inline-flex; align-items: center; gap: var(--space-2xs); min-width: 0; max-width: 180px; color: var(--accent); text-decoration: none; font-weight: 500; white-space: nowrap; }
  .back-link span { overflow: hidden; text-overflow: ellipsis; }
  .back-link:hover span { text-decoration: underline; }
  .crumb-sep { color: var(--text-secondary); flex-shrink: 0; }
  .toolbar .title { font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 80px; max-width: 240px; flex-shrink: 1; }
  .toolbar .dim { font-size: var(--font-label); color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .state-nav { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--radius-sm); background: var(--neutral-tint); flex-shrink: 0; }
  .state-link { font-size: var(--font-label); font-weight: 500; padding: 2px var(--space-xs); border-radius: 4px; color: var(--text-secondary); text-decoration: none; white-space: nowrap; }
  .state-link:hover { color: var(--text-primary); }
  .state-link[aria-current="page"] { background: var(--bg-surface); color: var(--text-primary); font-weight: 600; box-shadow: var(--elevation-flat); }
  .breakpoints { display: flex; justify-content: center; }
  .bp-tabs { border-bottom: none; gap: 2px; }
  .bp-tabs .tab { padding: 0 var(--space-xs); border-radius: var(--radius-sm); }
  .bp-tabs .tab[aria-selected="true"] { background: var(--accent-tint); }
  .bp-tabs .tab[aria-selected="true"]::after { display: none; }
  .actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-xs); min-width: 0; }
  .actions .btn.active { background: var(--accent-tint); border-color: var(--accent); }
  .live { display: inline-flex; align-items: center; gap: var(--space-2xs); font-size: var(--font-label); color: var(--text-secondary); white-space: nowrap; margin-left: var(--space-2xs); }
  .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }
  .live.offline .live-dot { background: var(--border-strong); }
  /* Phase 19 — detail body splits into the preview (left) and the read-only
   * quality inspector (right). Toolbar stays full-width above. */
  .detail-main { flex: 1; display: flex; min-height: 0; }
  .viewport { position: relative; flex: 1; display: flex; align-items: safe center; justify-content: safe center; overflow: auto; background: var(--bg-primary); padding: 72px var(--space-lg) var(--space-lg); }
  /* FR-C4 — preview tools float top-left; the stage scales the artboard. */
  .tools { position: absolute; top: var(--space-md); left: var(--space-md); z-index: 5; display: flex; gap: 2px; padding: var(--space-2xs); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .btn--xs { width: 24px; height: 24px; padding: 0; }
  .btn--xs[aria-pressed="true"] { background: var(--accent-tint); color: var(--accent); }
  .btn:disabled { opacity: 0.4; pointer-events: none; }
  .stage { display: flex; flex-direction: column; align-items: center; gap: var(--space-sm); }
  .frame-box { box-sizing: content-box; position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--elevation-floating); background: var(--bg-surface); }
  .frame-box iframe { position: absolute; top: 0; left: 0; border: none; background: transparent; transform-origin: 0 0; }
  .caption { font-size: var(--font-label); color: var(--text-secondary); text-align: center; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .viewport.compare .stage { display: none; }
  .viewport.compare .compare-grid { display: flex; }
  /* Phase 30 slice F — a mobile canvas at 1:1 in a CSS device frame. The
   * iframe scrolls inside the screen, so fixed chrome stays pinned. */
  .viewport--device { padding: 72px 24px 48px; }
  .device { flex-shrink: 0; padding: 12px; border-radius: 59px; background: var(--bg-elevated); box-shadow: 0 0 0 1px var(--border-strong), var(--elevation-floating); }
  .device-screen { position: relative; overflow: hidden; border-radius: 47px; background: transparent; }
  .device-screen iframe { display: block; border: 0; }
  .safe-overlay { position: absolute; inset: 0; pointer-events: none; }
  .safe-overlay[hidden] { display: none; }
  .safe-band { position: absolute; left: 0; right: 0; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .safe-band--top { top: 0; border-bottom: 1px dashed var(--accent); }
  .safe-band--bottom { bottom: 0; border-top: 1px dashed var(--accent); justify-content: flex-end; padding-right: 64px; } /* the label clears the home-indicator pill */
  .safe-band span { font-size: 10px; font-weight: 600; line-height: 1; color: var(--accent); background: var(--bg-surface); border-radius: 4px; padding: 3px 6px; font-variant-numeric: tabular-nums; }
  .compare-grid { display: none; gap: 24px; padding: 24px; align-items: flex-start; --scale: 0.35; }
  .compare-cell { display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
  .bp-label { font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
  .iframe-wrap { background: transparent; overflow: hidden; border-radius: 6px; border: 1px solid var(--border); width: calc(var(--bp-w) * var(--scale) * 1px); height: calc(var(--bp-h) * var(--scale) * 1px); }
  .iframe-wrap iframe { border: 0; background: transparent; width: calc(var(--bp-w) * 1px); height: calc(var(--bp-h) * 1px); transform: scale(var(--scale)); transform-origin: top left; }
  .json-panel { position: fixed; top: 48px; right: 0; bottom: 0; width: 480px; max-width: 100%; z-index: 300; display: flex; flex-direction: column; background: var(--bg-surface); border-left: 1px solid var(--border); box-shadow: var(--elevation-overlay); }
  .json-panel[hidden] { display: none; }
  .json-head { display: flex; align-items: center; justify-content: space-between; padding: var(--space-xs) var(--space-sm) var(--space-xs) var(--space-md); border-bottom: 1px solid var(--border); font-weight: 600; }
  .json-panel pre { flex: 1; overflow: auto; padding: var(--space-md); font-size: var(--font-label); color: var(--text-secondary); font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace; white-space: pre-wrap; word-break: break-all; }
  /* Phase 33 slice D — the inspector. */
  .inspector { width: 380px; flex-shrink: 0; background: var(--bg-surface); border-left: 1px solid var(--border); overflow-y: auto; }
  .insp-tabs { position: sticky; top: 0; z-index: 2; background: var(--bg-surface); padding: var(--space-xs) var(--space-md) 0; }
  .insp-panel[hidden] { display: none; }
  .insp-section { padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-xs); }
  .insp-section + .insp-section { border-top: 1px solid var(--border); }
  .insp-empty { font-size: var(--font-label); color: var(--text-secondary); }
  .score-line { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
  .score-figure { display: flex; align-items: baseline; gap: var(--space-2xs); }
  .score-value { font-family: var(--family-display); font-size: var(--font-display); font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
  .score-scale { font-size: var(--font-label); color: var(--text-secondary); }
  .verdict-chip { font-size: var(--font-caption); font-weight: 600; padding: 2px 8px; border-radius: var(--radius-sm); background: var(--neutral-tint); color: var(--text-secondary); white-space: nowrap; }
  .verdict-chip--below { background: var(--warning-tint); color: var(--warning); }
  .score-reason { font-size: var(--font-label); color: var(--text-secondary); }
  .score-built, .score-critique { font-size: var(--font-caption); color: var(--text-secondary); }
  .categories { gap: 0; }
  .category { display: flex; align-items: center; gap: var(--space-sm); height: 28px; }
  .category-name { width: 96px; flex-shrink: 0; font-size: var(--font-label); color: var(--text-secondary); }
  .category--below .category-name { color: var(--text-primary); }
  .meter { flex: 1; height: 4px; border-radius: var(--radius-sm); background: var(--neutral-tint); overflow: hidden; }
  .meter-fill { display: block; height: 100%; border-radius: var(--radius-sm); background: var(--border-strong); }
  .category--below .meter-fill { background: var(--warning); }
  .category-score { width: 28px; flex-shrink: 0; text-align: right; font-size: var(--font-label); font-weight: 500; font-variant-numeric: tabular-nums; }
  .category--below .category-score { color: var(--warning); font-weight: 600; }
  .issues { gap: 0; }
  .issues-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-sm); padding-bottom: var(--space-2xs); }
  .issues-title { font-weight: 600; }
  .issues-count { font-size: var(--font-caption); color: var(--text-secondary); }
  .issue { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: var(--space-sm) 0; border-bottom: 1px solid var(--border); }
  .issue:last-child { border-bottom: none; }
  .issue-kind { font-size: var(--font-caption); font-weight: 600; color: var(--text-secondary); }
  .issue--error .issue-kind { color: var(--danger); }
  .issue--warning .issue-kind { color: var(--warning); }
  .issue-msg { font-size: var(--font-label); color: var(--text-primary); }
  .issue-nodes { border: none; background: none; padding: 0; font: inherit; font-size: var(--font-label); font-weight: 500; color: var(--accent); cursor: pointer; }
  .issue-nodes:hover { text-decoration: underline; }
  .issue-nodes[aria-pressed="true"] { text-decoration: underline; font-weight: 600; }
  /* Design system tab (Phase 19 slice B), on the new tokens. */
  .insp-section-label { font-size: var(--font-caption); font-weight: 600; color: var(--text-secondary); }
  .insp-section-head { display: flex; justify-content: space-between; align-items: baseline; }
  .ds-default { font-size: var(--font-caption); color: var(--text-secondary); }
  .ds-src { font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; margin-left: 4px; background: var(--neutral-tint); color: var(--text-secondary); }
  .ds-src--canvas { background: var(--accent-tint); color: var(--accent); }
  .ds-swatches { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); }
  .ds-swatch { display: flex; flex-direction: column; gap: var(--space-2xs); min-width: 0; }
  .ds-chip { width: 100%; height: 32px; border-radius: var(--radius-sm); border: 1px solid var(--border); }
  .ds-swatch-meta { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2xs); }
  .ds-name { font-size: var(--font-label); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds-hex { font-size: var(--font-caption); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .ds-type { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-sm); }
  .ds-type-sample { line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds-type-meta { font-size: var(--font-caption); color: var(--text-secondary); flex-shrink: 0; }
  .ds-sp { display: flex; align-items: center; gap: var(--space-sm); }
  .ds-sp-name { width: 72px; flex-shrink: 0; font-size: var(--font-label); color: var(--text-secondary); }
  .ds-sp-bar { height: 6px; border-radius: 2px; background: var(--border-strong); flex-shrink: 0; }
  .ds-sp-val { font-size: var(--font-caption); color: var(--text-secondary); }
  .ds-radii { display: flex; flex-wrap: wrap; gap: var(--space-md); }
  .ds-rad { display: flex; flex-direction: column; gap: var(--space-2xs); align-items: center; }
  .ds-rad-tile { width: 56px; height: 40px; background: var(--neutral-tint); border: 1px solid var(--border-strong); }
  .ds-rad-label { font-size: var(--font-caption); color: var(--text-secondary); }
  /* Feedback tab (Phase 21), on the new tokens. */
  .fb-hint { font-size: var(--font-label); color: var(--text-secondary); }
  .fb-hint b { color: var(--text-primary); }
  #fb-pane { display: flex; flex-direction: column; }
  .fb-empty { font-size: var(--font-label); color: var(--text-secondary); padding: var(--space-sm) 0; }
  .fb-card { display: flex; flex-direction: column; gap: var(--space-2xs); padding: var(--space-sm) 0; border-bottom: 1px solid var(--border); cursor: pointer; }
  .fb-card.sel .fb-comment { color: var(--accent); }
  .fb-card.resolved { cursor: default; }
  .fb-card.resolved .fb-comment { color: var(--text-secondary); }
  .fb-card-top { display: flex; align-items: center; gap: var(--space-xs); }
  .fb-anchor { font-size: var(--font-caption); font-weight: 600; color: var(--text-secondary); background: var(--neutral-tint); border-radius: 4px; padding: 1px 6px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fb-orphan { font-size: var(--font-caption); font-weight: 600; color: var(--warning); }
  .fb-when { margin-left: auto; font-size: var(--font-caption); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .fb-comment { font-size: var(--font-label); color: var(--text-primary); white-space: pre-wrap; }
  .fb-reply { font-size: var(--font-label); color: var(--text-secondary); border-left: 2px solid var(--border-strong); padding-left: var(--space-xs); }
  .fb-actions { display: flex; gap: var(--space-xs); margin-top: 2px; }
  .fb-sep { font-size: var(--font-caption); font-weight: 600; color: var(--text-secondary); padding: var(--space-md) 0 var(--space-2xs); }
  .fb-actions .btn { height: 24px; padding: 0 var(--space-xs); font-size: var(--font-label); }
  /* FR-D3 — the comment popover, under the Comment button. */
  .comment-wrap { position: relative; display: inline-flex; }
  .comment-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 400; width: 320px; padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--elevation-floating); }
  .comment-pop[hidden] { display: none; }
  .comment-pop-title { font-weight: 600; }
  .comment-pop-hint { font-size: var(--font-label); color: var(--text-secondary); }
  .fb-chips { display: flex; flex-wrap: wrap; gap: var(--space-2xs); }
  .fb-chips[hidden] { display: none; }
  .fb-chip { font: inherit; font-size: var(--font-caption); font-weight: 500; color: var(--text-secondary); background: var(--neutral-tint); border: 1px solid transparent; border-radius: 999px; padding: 2px 8px; cursor: pointer; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fb-chip[aria-pressed="true"] { color: var(--accent); background: var(--accent-tint); border-color: var(--accent); }
  .comment-pop textarea { width: 100%; min-height: 72px; resize: vertical; padding: var(--space-xs); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-primary); font: inherit; font-size: var(--font-body); }
  .comment-pop textarea:focus { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .comment-pop-actions { display: flex; justify-content: flex-end; gap: var(--space-xs); }
  @media (max-width: 900px) { .inspector { width: 320px; } }
  @media (max-width: 720px) { .detail-main { flex-direction: column; overflow-y: auto; } .viewport { flex: none; min-height: 60vh; } .inspector { width: 100%; overflow-y: visible; border-left: none; border-top: 1px solid var(--border); } }
  @media (max-width: 1100px) { .compare-grid { --scale: 0.28; gap: 18px; } }
  @media (max-width: 900px) { .compare-grid { --scale: 0.22; gap: 16px; } }
  @media (max-width: 1399px) { .toolbar { grid-template-columns: minmax(0, 1fr) auto auto; } }
  @media (max-width: 1100px) { .toolbar .dim { display: none; } }
  @media (max-width: 900px) {
    .toolbar { display: flex; flex-wrap: wrap; height: auto; min-height: 48px; padding: var(--space-xs) var(--space-sm); row-gap: var(--space-xs); }
    .crumbs { flex: 0 0 100%; }
    .breakpoints { flex: 1; justify-content: flex-start; min-width: 0; overflow-x: auto; }
    .actions { flex: 0 0 auto; }
    .json-panel { top: 0; }
  }
  @media (max-width: 640px) {
    .toolbar .dim, .live { display: none; }
    .actions .btn span:not(.tab-count) { display: none; }
    .viewport { padding: 64px var(--space-sm) var(--space-sm); }
    .compare-grid { --scale: 0.18; gap: 12px; padding: 12px; }
  }
</style>
</head>
<body>
  <header class="toolbar">
    <div class="crumbs">
      <a class="back-link" href="/project/${esc(canvas.projectId)}">${icon('arrow-left')}<span>${esc(projectName)}</span></a>
      ${icon('chevron-right', 14).replace('<svg', '<svg class="crumb-sep" aria-hidden="true"')}
      <span class="title" title="${esc(canvas.name)}">${esc(canvas.name)}</span>
      <span class="dim">${w} × ${h}${isMobile ? ` · ${esc(deviceId)}` : window ? ` · ${esc(window.id)}` : ''}</span>
      ${stateNav}
    </div>
    ${breakpoints}
    <div class="actions">
      <div class="comment-wrap">
        <button type="button" class="btn btn--secondary" onclick="toggleComment()" id="btn-comment" aria-pressed="false" aria-expanded="false" aria-controls="comment-pop" title="Click any element in the preview to leave a note for the agent">${icon('message-square')}<span>Comment</span><span class="tab-count" id="comment-count"${openComments > 0 ? '' : ' hidden'}>${openComments}</span></button>
        <div class="comment-pop" id="comment-pop" role="dialog" aria-labelledby="comment-pop-title" hidden>
          <div class="comment-pop-title" id="comment-pop-title">Comment on ${esc(canvas.name)}</div>
          <div class="comment-pop-hint">Click an element in the preview to pin the comment to it. Your agent reads it with get_feedback.</div>
          <div class="fb-chips" id="fb-chips" role="group" aria-label="Pin the comment to" hidden></div>
          <textarea id="comment-text" placeholder="Describe the change" aria-label="Comment"></textarea>
          <div class="comment-pop-actions">
            <button type="button" class="btn btn--ghost" id="comment-cancel">Cancel</button>
            <button type="button" class="btn btn--primary" id="comment-save">Add comment</button>
          </div>
        </div>
      </div>
      ${renderMenu('more-menu', icon('ellipsis'), 'More actions', [
        { action: 'json', label: 'View JSON', icon: 'braces' },
        { action: 'copy', label: 'Copy canvas ID', icon: 'copy', keepOpen: true },
        'separator',
        canvas.archived ? { action: 'unarchive', label: 'Restore', icon: 'archive-restore' } : { action: 'archive', label: 'Archive', icon: 'archive' },
        { action: 'delete', label: 'Delete canvas', icon: 'trash-2', danger: true },
      ])}
      <span class="live" id="live" role="status"><span class="live-dot"></span><span class="live-label">Live</span></span>
    </div>
  </header>
  <div class="detail-main">
  ${isMobile ? renderDevice(canvas, w, h, deviceId, profile, tools) : `<div class="viewport" id="viewport">
    ${tools}
    <div class="stage" id="stage">
      <div class="frame-box" id="frame-box" style="width: ${w}px; height: ${h}px;"><iframe id="frame" src="/canvas/${esc(canvas.id)}/html" width="${w}" height="${h}" title="Preview of ${esc(canvas.name)}"></iframe></div>
      <div class="caption">${esc(caption)}</div>
    </div>
    <div class="compare-grid" id="compare-grid">
      ${window ? windowWidths.map((bw) => `<div class="compare-cell" style="--bp-w: ${bw}; --bp-h: ${h};">
        <div class="bp-label">Window · ${bw}×${h}</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=${bw}&h=${h}" data-bp="w${bw}" title="Preview at ${bw}×${h}"></iframe></div>
      </div>`).join('\n      ') : `<div class="compare-cell" style="--bp-w: ${PHONE.width}; --bp-h: ${PHONE.height};">
        <div class="bp-label">Mobile · ${PHONE.width}×${PHONE.height}</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=${PHONE.width}&h=${PHONE.height}" data-bp="mobile" title="Preview at ${PHONE.width}×${PHONE.height}"></iframe></div>
      </div>
      <div class="compare-cell" style="--bp-w: 768; --bp-h: 1024;">
        <div class="bp-label">Tablet · 768×1024</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=768&h=1024" data-bp="tablet" title="Preview at 768×1024"></iframe></div>
      </div>`}
      <div class="compare-cell" style="--bp-w: ${w}; --bp-h: ${h};">
        <div class="bp-label">${window ? "Window" : "Desktop"} · ${w}×${h}</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=${w}&h=${h}" data-bp="desktop" title="Preview at ${w}×${h}"></iframe></div>
      </div>
    </div>
  </div>`}
  ${inspectorHtml}
  </div>
  <aside class="json-panel" id="json-panel" aria-label="Canvas JSON" hidden>
    <div class="json-head"><span>JSON</span><button type="button" class="btn btn--ghost btn--icon" aria-label="Close JSON" onclick="toggleJson(false)">${icon('x')}</button></div>
    <pre id="json-content">Loading...</pre>
  </aside>
  ${renderDialog({ id: 'fb-delete-dialog', title: 'Delete this comment?', body: 'The comment is removed for everyone, your agent included.', confirmLabel: 'Delete comment', destructive: true })}
  ${renderDialog({ id: 'delete-dialog', title: `Delete ${canvas.name}?`, body: 'The canvas is deleted for good and cannot be restored. To hide it from the gallery and keep it, archive it instead.', confirmLabel: 'Delete canvas', destructive: true })}
  <script>
    ${detailScript(canvas, w, h, surface.type)}
  </script>
</body>
</html>`;
}
