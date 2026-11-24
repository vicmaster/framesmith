// Phase 33 slice A — the canvas detail page, moved from viewer.ts.
import type { Canvas } from '../../types.js';
import { getProject, getCanvasTokens, getProjectDesignSystem, getWorkspaceDesignSystem } from '../../workspaces.js';
import { listCanvases } from '../../scene-graph.js';
import { resolveSurface, usableSafeArea, deviceProfile, windowProfile, WINDOW_PROFILES, DEFAULT_WINDOW, DEFAULT_DEVICE, type DeviceProfile } from '../../surfaces.js';
import { resolveGenre, type EvaluationResult, type EvaluationIssue } from '../../evaluate.js';
import { isPresetName } from '../../genre.js';
import { openFeedbackCount } from '../../feedback.js';
import { withoutRetiredSeeds } from '../../variables.js';
import { baseCss, COMPONENTS_CSS } from '../styles.js';
import { TYPE_LABELS } from './project.js';
import { FAVICON_HTML, icon, renderDialog, renderMenu } from '../components.js';
import { artboardSize, esc, PHONE } from '../shared.js';
import { evalFor, gradeFor, scoreColor, sevColor } from '../scores.js';
import { detailScript } from '../client/detail.js';

function renderIssueCard(issue: EvaluationIssue): string {
  const label = issue.tell ? `${esc(issue.category)} · ${esc(issue.tell)}` : esc(issue.category);
  const clickable = typeof issue.nodeId === 'string' && issue.nodeId.length > 0;
  const fixTag = issue.fix
    ? `<span class="insp-fix" title="canvas_autofix can resolve this">&#9889; auto-fixable</span>` : '';
  return `
    <div class="insp-issue${clickable ? '' : ' insp-issue--static'}"${clickable ? ` data-issue-node="${esc(issue.nodeId!)}"` : ''}>
      <div class="insp-issue-top">
        <span class="insp-dot" style="background:${sevColor(issue.severity)}"></span>
        <span class="insp-badge">${label}</span>
        ${fixTag}
      </div>
      <div class="insp-msg">${esc(issue.message)}</div>
      ${issue.suggestion ? `<div class="insp-sug">${esc(issue.suggestion)}</div>` : ''}
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
    return `
  <div class="insp-tabpane" data-pane="design" hidden>
    <div class="insp-section"><div class="insp-clean">This canvas inherits no design tokens. Set them with set_variables or bind a design system.</div></div>
  </div>`;
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

  return `
  <div class="insp-tabpane" data-pane="design" hidden>
    ${colorSec}${typeSec}${spaceSec}${radiusSec}
  </div>`;
}

function renderInspector(ev: EvaluationResult, canvas: Canvas): string {
  const grade = gradeFor(ev.overallScore);
  const fbOpen = openFeedbackCount(canvas);
  const cats = ev.categories.map((c) => `
      <div class="insp-cat">
        <span class="insp-cat-name">${esc(c.name)}</span>
        <span class="insp-cat-track"><span class="insp-cat-fill" style="width:${Math.max(0, Math.min(100, c.score))}%;background:${scoreColor(c.score)}"></span></span>
        <span class="insp-cat-score" style="${c.score < 60 ? 'color:var(--danger);font-weight:700' : ''}">${c.score}</span>
      </div>`).join('');
  const issues = ev.issues.length
    ? ev.issues.map(renderIssueCard).join('')
    : `<div class="insp-clean">No issues — this canvas is clean.</div>`;
  return `
  <aside class="inspector" id="inspector">
    <div class="insp-tabs">
      <span class="insp-tab active" data-tab="quality">Quality</span>
      <span class="insp-tab" data-tab="design">Design system</span>
      <span class="insp-tab" data-tab="feedback">Feedback<span class="fb-badge" id="fb-badge"${fbOpen ? '' : ' hidden'}>${fbOpen}</span></span>
      <span class="insp-tab disabled" title="Coming in Phase 19 Slice C">Import</span>
    </div>
    <div class="insp-tabpane" data-pane="quality">
      <div class="insp-score">
        <div class="insp-score-row">
          <div class="insp-score-num">${ev.overallScore}<span>/100</span></div>
          <span class="insp-grade${grade.warn ? ' warn' : ''}">${grade.label}</span>
        </div>
        <div class="insp-track"><div class="insp-fill" style="width:${ev.overallScore}%;background:${scoreColor(ev.overallScore)}"></div></div>
      </div>
      <div class="insp-divider"></div>
      <div class="insp-section">
        <div class="insp-section-label">Categories</div>
        ${cats}
      </div>
      <div class="insp-divider"></div>
      <div class="insp-section">
        <div class="insp-section-head"><span class="insp-section-label">Issues</span><span class="insp-count">${ev.issues.length}</span></div>
        ${issues}
      </div>
    </div>
    ${renderDesignSystem(canvas)}
    <div class="insp-tabpane" data-pane="feedback" hidden>
      <div class="insp-section">
        <div class="insp-section-head"><span class="insp-section-label">Point-and-tell</span></div>
        <div class="fb-hint">Toggle <b>Comment</b> in the toolbar, then click any element in the preview to leave a note for the agent.</div>
        <div id="fb-pane"></div>
      </div>
    </div>
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

  // Provenance chip (Phase 11) — structure · genre · preset · alignment/density. Shows
  // only the parts that exist; hidden entirely when a canvas has no provenance.
  const prov = canvas.metadata?.provenance;
  let provChip = '';
  if (prov) {
    const parts: string[] = [];
    if (prov.structure) parts.push(esc(prov.structure));
    const genre = resolveGenre(canvas).genre;
    if (genre) parts.push(esc(genre));
    // A legacy genre stored in `preset` already showed as the genre above.
    if (prov.preset && ('genre' in prov || isPresetName(prov.preset))) parts.push(esc(prov.preset));
    const ax = prov.axes ? [prov.axes.alignment, prov.axes.density].filter(Boolean).join('/') : '';
    if (ax) parts.push(esc(ax));
    if (parts.length) provChip = `<span class="prov" title="Provenance — the structure / genre / preset / axes of this canvas"><b>◆</b>${parts.join(' · ')}</span>`;
  }

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

  // Critique verdict chip (Phase 13) — latest rubric overall + needs-revision
  // flag. Hidden when a canvas has never been judged.
  const crit = canvas.metadata?.critique;
  let verdictChip = '';
  if (crit) {
    const cls = crit.needsRevision ? 'verdict warn' : 'verdict';
    const tail = crit.needsRevision ? ' · needs revision' : '';
    verdictChip = `<span class="${cls}" title="Latest rubric critique (Phase 13) — derived overall + needs-revision flag"><b>◇</b>${crit.overall}/100${tail}</span>`;
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
  const inspectorHtml = ev ? renderInspector(ev, canvas) : '';

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
  .toolbar .title { font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 240px; flex-shrink: 1; }
  .toolbar .dim { font-size: var(--font-label); color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .state-nav { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--radius-sm); background: var(--neutral-tint); flex-shrink: 0; }
  .state-link { font-size: var(--font-label); font-weight: 500; padding: 2px var(--space-xs); border-radius: 4px; color: var(--text-secondary); text-decoration: none; white-space: nowrap; }
  .state-link:hover { color: var(--text-primary); }
  .state-link[aria-current="page"] { background: var(--bg-surface); color: var(--text-primary); font-weight: 600; box-shadow: var(--elevation-flat); }
  /* Provenance and critique chips (Phases 11, 13) — slice D moves them into the Quality tab. */
  .toolbar .prov, .toolbar .verdict { font-size: var(--font-label); color: var(--text-secondary); font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .crumbs > .prov, .crumbs > .verdict { flex-shrink: 100; }
  .toolbar .prov b, .toolbar .verdict b { color: var(--accent); font-weight: 700; margin-right: 6px; }
  .toolbar .verdict.warn b { color: var(--warning); }
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
  .viewport { position: relative; flex: 1; display: flex; align-items: flex-start; justify-content: safe center; overflow: auto; background: var(--bg-primary); padding: 72px var(--space-lg) var(--space-lg); }
  /* FR-C4 — preview tools float top-left; the stage scales the artboard. */
  .tools { position: absolute; top: var(--space-md); left: var(--space-md); z-index: 5; display: flex; gap: 2px; padding: var(--space-2xs); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .btn--xs { width: 24px; height: 24px; padding: 0; }
  .btn--xs[aria-pressed="true"] { background: var(--accent-tint); color: var(--accent); }
  .btn:disabled { opacity: 0.4; pointer-events: none; }
  .stage { display: flex; flex-direction: column; align-items: center; gap: var(--space-sm); }
  .frame-box { position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--elevation-floating); background: var(--bg-surface); }
  .frame-box iframe { position: absolute; top: 0; left: 0; border: none; background: transparent; transform-origin: 0 0; }
  .caption { font-size: var(--font-label); color: var(--text-secondary); text-align: center; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .viewport.compare .stage { display: none; }
  .viewport.compare .compare-grid { display: flex; }
  /* Phase 30 slice F — a mobile canvas at 1:1 in a CSS device frame. The
   * iframe scrolls inside the screen, so fixed chrome stays pinned. */
  .viewport--device { padding: 32px 24px 48px; }
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
  /* Quality inspector (Phase 19 Slice A) */
  .inspector { width: 360px; flex-shrink: 0; background: var(--sidebar); border-left: 1px solid var(--border-subtle); overflow-y: auto; }
  .insp-tabs { display: flex; gap: 20px; padding: 16px 20px 0; border-bottom: 1px solid var(--border); align-items: flex-end; }
  .insp-tab { font-size: 13px; font-weight: 500; color: var(--text-tertiary); padding-bottom: 10px; border-bottom: 2px solid transparent; }
  .insp-tab.active { color: var(--accent); font-weight: 600; border-bottom-color: var(--accent); }
  .insp-tab.disabled { color: var(--text-muted); cursor: default; }
  .insp-score { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
  .insp-score-row { display: flex; justify-content: space-between; align-items: center; }
  .insp-score-num { font-size: 40px; font-weight: 700; color: var(--text-primary); line-height: 1; font-variant-numeric: tabular-nums; }
  .insp-score-num span { font-size: 14px; font-weight: 500; color: var(--text-muted); margin-left: 2px; }
  .insp-grade { font-size: 11px; font-weight: 600; color: var(--text-secondary); background: var(--surface-elevated); border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px; }
  .insp-grade.warn { color: var(--accent-soft); }
  .insp-track { width: 100%; height: 8px; border-radius: 4px; background: var(--surface-elevated); overflow: hidden; }
  .insp-fill { height: 100%; border-radius: 4px; }
  .insp-divider { height: 1px; background: var(--border); }
  .insp-section { padding: 16px 20px; display: flex; flex-direction: column; gap: 11px; }
  .insp-section-head { display: flex; justify-content: space-between; align-items: center; }
  .insp-section-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); }
  .insp-count { font-size: 11px; font-weight: 700; color: var(--text-secondary); background: var(--surface-elevated); border-radius: 6px; padding: 2px 8px; }
  .insp-cat { display: flex; align-items: center; gap: 10px; }
  .insp-cat-name { width: 84px; flex-shrink: 0; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
  .insp-cat-track { flex: 1; height: 6px; border-radius: 3px; background: var(--surface-elevated); overflow: hidden; }
  .insp-cat-fill { display: block; height: 100%; border-radius: 3px; }
  .insp-cat-score { width: 28px; flex-shrink: 0; text-align: right; font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .insp-issue { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .insp-issue:hover { border-color: var(--border); background: var(--surface-hover); }
  .insp-issue.sel { border-color: var(--accent); background: var(--accent-tint); }
  .insp-issue--static { cursor: default; }
  .insp-issue--static:hover { border-color: var(--border-subtle); background: var(--surface); }
  .insp-issue-top { display: flex; align-items: center; gap: 8px; }
  .insp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .insp-badge { font-size: 10px; font-weight: 600; color: var(--accent-soft); background: var(--surface-elevated); border-radius: 6px; padding: 2px 7px; }
  .insp-fix { margin-left: auto; font-size: 10px; font-weight: 600; color: var(--success); }
  .insp-msg { font-size: 12px; font-weight: 500; color: var(--text-primary); line-height: 1.45; }
  .insp-sug { font-size: 11px; color: var(--text-tertiary); line-height: 1.45; }
  .insp-clean { font-size: 12px; color: var(--text-tertiary); padding: 4px 0; }
  /* Design-system pane (Phase 19 Slice B) */
  .insp-tab[data-tab] { cursor: pointer; }
  .insp-tabpane[hidden] { display: none; }
  .ds-default { font-size: 10px; font-weight: 500; color: var(--text-muted); }
  .ds-src { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 1px 5px; border-radius: 4px; }
  .ds-src--canvas { color: var(--accent-soft); background: var(--accent-tint); }
  .ds-src--project { color: var(--text-secondary); background: var(--neutral-tint); }
  .ds-src--workspace { color: var(--text-tertiary); background: var(--surface-elevated); }
  .ds-src--default { color: var(--text-muted); background: var(--surface-elevated); }
  .ds-swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ds-swatch { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .ds-chip { width: 100%; height: 36px; border-radius: 8px; border: 1px solid var(--border-subtle); }
  .ds-swatch-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; min-width: 0; }
  .ds-name { font-size: 12px; font-weight: 600; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds-hex { font-size: 11px; font-weight: 500; color: var(--text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .ds-type { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .ds-type-sample { color: var(--text-primary); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ds-type-meta { font-size: 10px; font-weight: 500; color: var(--text-muted); flex-shrink: 0; }
  .ds-sp { display: flex; align-items: center; gap: 10px; }
  .ds-sp-name { width: 36px; flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--text-secondary); }
  .ds-sp-bar { height: 8px; border-radius: 2px; background: var(--accent); flex-shrink: 0; }
  .ds-sp-val { font-size: 11px; font-weight: 500; color: var(--text-muted); }
  .ds-radii { display: flex; gap: 16px; }
  .ds-rad { display: flex; flex-direction: column; gap: 6px; align-items: center; }
  .ds-rad-tile { width: 56px; height: 40px; background: var(--surface-elevated); border: 1px solid var(--border); }
  .ds-rad-label { font-size: 10px; font-weight: 500; color: var(--text-muted); }
  /* Point-and-tell feedback (Phase 21 Slice B) */
  .fb-badge { font-size: 10px; font-weight: 700; color: var(--accent-soft); background: var(--accent-tint); border-radius: 8px; padding: 1px 6px; margin-left: 6px; font-variant-numeric: tabular-nums; }
  .fb-hint { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
  .fb-hint b { color: var(--text-secondary); }
  #fb-pane { display: flex; flex-direction: column; gap: 10px; }
  .fb-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
  .fb-card:hover { border-color: var(--border); background: var(--surface-hover); }
  .fb-card.sel { border-color: var(--accent); background: var(--accent-tint); }
  .fb-card.resolved { opacity: 0.55; cursor: default; }
  .fb-card-top { display: flex; align-items: center; gap: 8px; }
  .fb-anchor { font-size: 10px; font-weight: 600; color: var(--accent-soft); background: var(--surface-elevated); border-radius: 6px; padding: 2px 7px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fb-orphan { font-size: 10px; font-weight: 600; color: var(--warning); }
  .fb-when { margin-left: auto; font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .fb-comment { font-size: 12px; font-weight: 500; color: var(--text-primary); line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .fb-reply { font-size: 11px; color: var(--text-tertiary); line-height: 1.45; border-left: 2px solid var(--border); padding-left: 8px; }
  .fb-actions { display: flex; gap: 6px; margin-top: 2px; }
  .fb-btn { background: var(--surface-elevated); border: 1px solid var(--border); color: var(--text-secondary); padding: 3px 10px; border-radius: 5px; font-size: 10px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .fb-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .fb-btn--danger:hover { background: var(--danger-tint); border-color: var(--danger); color: var(--danger); }
  .fb-sep { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin-top: 4px; }
  .fb-empty { font-size: 12px; color: var(--text-tertiary); }
  /* Comment popover — parent-page overlay anchored near the clicked element. */
  .fb-popover { position: fixed; z-index: 30; width: 300px; background: var(--sidebar); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--elevation-floating); }
  .fb-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .fb-chip { font-size: 10px; font-weight: 600; color: var(--text-tertiary); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; cursor: pointer; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fb-chip.sel { color: var(--accent-soft); background: var(--accent-tint); border-color: var(--accent); }
  .fb-popover textarea { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-family: inherit; font-size: 12px; line-height: 1.45; padding: 8px; min-height: 60px; resize: vertical; }
  .fb-popover textarea:focus { outline: none; border-color: var(--accent); }
  .fb-pop-actions { display: flex; justify-content: flex-end; gap: 6px; }
  @media (max-width: 900px) { .inspector { width: 300px; } }
  @media (max-width: 720px) { .detail-main { flex-direction: column; } .inspector { width: 100%; border-left: none; border-top: 1px solid var(--border-subtle); } }
  @media (max-width: 1100px) { .compare-grid { --scale: 0.28; gap: 18px; } }
  @media (max-width: 900px) { .compare-grid { --scale: 0.22; gap: 16px; } }
  @media (max-width: 1100px) { .toolbar .prov, .toolbar .verdict { display: none; } }
  @media (max-width: 640px) {
    .toolbar { display: flex; flex-wrap: wrap; height: auto; min-height: 48px; padding: var(--space-xs) var(--space-sm); row-gap: var(--space-xs); }
    .crumbs { flex: 0 0 100%; }
    .toolbar .dim, .live { display: none; }
    .breakpoints { flex: 1; justify-content: flex-start; min-width: 0; overflow-x: auto; }
    .actions { flex: 0 0 auto; }
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
      ${provChip}
      ${verdictChip}
    </div>
    ${breakpoints}
    <div class="actions">
      <button type="button" class="btn btn--secondary" onclick="toggleComment()" id="btn-comment" title="Click any element in the preview to leave a note for the agent">${icon('message-square')}<span>Comment</span>${openComments > 0 ? `<span class="tab-count" id="comment-count">${openComments}</span>` : ''}</button>
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
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=${bw}&h=${h}" data-bp="w${bw}"></iframe></div>
      </div>`).join('\n      ') : `<div class="compare-cell" style="--bp-w: ${PHONE.width}; --bp-h: ${PHONE.height};">
        <div class="bp-label">Mobile · ${PHONE.width}×${PHONE.height}</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=${PHONE.width}&h=${PHONE.height}" data-bp="mobile"></iframe></div>
      </div>
      <div class="compare-cell" style="--bp-w: 768; --bp-h: 1024;">
        <div class="bp-label">Tablet · 768×1024</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=768&h=1024" data-bp="tablet"></iframe></div>
      </div>`}
      <div class="compare-cell" style="--bp-w: ${w}; --bp-h: ${h};">
        <div class="bp-label">${window ? "Window" : "Desktop"} · ${w}×${h}</div>
        <div class="iframe-wrap"><iframe src="/canvas/${canvas.id}/html?w=${w}&h=${h}" data-bp="desktop"></iframe></div>
      </div>
    </div>
  </div>`}
  ${inspectorHtml}
  </div>
  <aside class="json-panel" id="json-panel" aria-label="Canvas JSON" hidden>
    <div class="json-head"><span>JSON</span><button type="button" class="btn btn--ghost btn--icon" aria-label="Close JSON" onclick="toggleJson(false)">${icon('x')}</button></div>
    <pre id="json-content">Loading...</pre>
  </aside>
  ${renderDialog({ id: 'delete-dialog', title: `Delete ${canvas.name}?`, body: 'The canvas is deleted for good and cannot be restored. To hide it from the gallery and keep it, archive it instead.', confirmLabel: 'Delete canvas', destructive: true })}
  <script>
    ${detailScript(canvas, w, h, surface.type)}
  </script>
</body>
</html>`;
}
