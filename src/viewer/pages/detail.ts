// Phase 33 slice A — the canvas detail page, moved from viewer.ts.
import type { Canvas } from '../../types.js';
import { getProject, getCanvasTokens, getProjectDesignSystem, getWorkspaceDesignSystem } from '../../workspaces.js';
import { listCanvases } from '../../scene-graph.js';
import { resolveSurface, usableSafeArea, deviceProfile, windowProfile, WINDOW_PROFILES, DEFAULT_WINDOW, DEFAULT_DEVICE, type DeviceProfile } from '../../surfaces.js';
import { resolveGenre, type EvaluationResult, type EvaluationIssue } from '../../evaluate.js';
import { isPresetName } from '../../genre.js';
import { openFeedbackCount } from '../../feedback.js';
import { withoutRetiredSeeds } from '../../variables.js';
import { baseCss } from '../styles.js';
import { FAVICON_HTML } from '../components.js';
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
function renderDevice(canvas: Canvas, w: number, h: number, deviceId: string, profile: DeviceProfile): string {
  const reserved = canvas.root.type === 'document' ? usableSafeArea(canvas.root.safeArea) : {};
  const top = reserved.top ?? profile.safeArea.top;
  const bottom = reserved.bottom ?? profile.safeArea.bottom;
  return `<div class="viewport viewport--device" id="viewport">
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

  // State chips (Phase 24 slice A) — a screen and its designed states cross-
  // link: on a base with variants, "default" (active) + each state; on a
  // variant, the base ("default") + every sibling state. Orphan-safe: a
  // variant whose base is gone simply shows no chips.
  const rows = listCanvases();
  const selfRow = rows.find((r) => r.id === canvas.id);
  let stateChips = '';
  {
    const chip = (label: string, id: string | null) => id === null
      ? `<span class="state-chip state-chip--active">${esc(label)}</span>`
      : `<a class="state-chip" href="/canvas/${id}">${esc(label)}</a>`;
    if (selfRow?.variants?.length) {
      stateChips = `<span class="state-chips" title="Designed states of this screen">${[
        chip('default', null),
        ...selfRow.variants.map((v) => chip(v.state, v.canvasId)),
      ].join('')}</span>`;
    } else if (selfRow?.variant) {
      const base = rows.find((r) => r.id === selfRow.variant!.of);
      if (base) {
        const siblings = (base.variants ?? []).filter((v) => v.canvasId !== canvas.id);
        stateChips = `<span class="state-chips" title="Designed states of this screen">${[
          chip('default', base.id),
          ...siblings.map((v) => chip(v.state, v.canvasId)),
          chip(selfRow.variant.state, null),
        ].join('')}</span>`;
      }
    }
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
  body { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { height: 52px; background: var(--sidebar); border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; padding: 0 20px; gap: 14px; flex-shrink: 0; }
  /* Grouped clusters of related buttons with subtle vertical dividers
   * between them. Reads as "view modes / utilities / lifecycle" three-way
   * grouping rather than a flat wall of 8 same-weight buttons. */
  .toolbar-cluster { display: inline-flex; align-items: center; gap: 6px; }
  .toolbar-divider { width: 1px; height: 18px; background: var(--border); flex-shrink: 0; }
  .toolbar a { color: var(--text-tertiary); text-decoration: none; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; transition: color 0.15s; }
  .toolbar a:hover { color: var(--text-primary); }
  .toolbar .title { font-size: 15px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.1px; }
  .toolbar .dim { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  /* Provenance chip — the structure / preset / axes that produced this canvas
   * (Phase 11). Flat + muted, with a single small accent mark; no glow. */
  .toolbar .prov { font-size: 12px; color: var(--text-muted); font-weight: 500; white-space: nowrap; }
  .toolbar .prov b { color: var(--accent-soft); font-weight: 700; margin-right: 6px; }
  /* Critique verdict chip (Phase 13) — flat, muted; amber mark when the latest
   * rubric flagged the canvas as needing revision. */
  .toolbar .verdict { font-size: 12px; color: var(--text-muted); font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .toolbar .verdict b { color: var(--accent-soft); font-weight: 700; margin-right: 6px; }
  .toolbar .verdict.warn b { color: var(--warning); }
  .toolbar .spacer { flex: 1; }
  .toolbar .btn { background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .toolbar .btn:hover { background: var(--surface-hover); color: var(--text-primary); }
  .toolbar .btn.active { background: var(--accent-tint); border-color: var(--accent); color: var(--accent-soft); font-weight: 600; }
  .toolbar .btn--danger:hover { background: var(--danger-tint); border-color: var(--danger); color: var(--danger); }
  .status { width: 8px; height: 8px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
  .status.stale { background: var(--text-muted); }
  /* Phase 19 — detail body splits into the preview (left) and the read-only
   * quality inspector (right). Toolbar stays full-width above. */
  .detail-main { flex: 1; display: flex; min-height: 0; }
  .viewport { flex: 1; display: flex; align-items: flex-start; justify-content: safe center; overflow: auto; background: var(--bg-0); padding: 24px 0; }
  .viewport iframe { border: none; background: transparent; transition: width 0.3s, height 0.3s; transform-origin: top center; }
  .viewport.fit iframe { width: 100% !important; height: 100% !important; }
  .viewport.compare #frame { display: none; }
  .viewport.compare .compare-grid { display: flex; }
  .viewport.compare #btn-fit { pointer-events: none; opacity: 0.4; }
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
  .json-panel { display: none; position: fixed; top: 52px; right: 0; bottom: 0; width: 480px; background: var(--sidebar); border-left: 1px solid var(--border-subtle); overflow: auto; z-index: 10; }
  .json-panel.open { display: block; }
  .json-panel pre { padding: 20px; font-size: 12px; color: var(--text-secondary); font-family: 'JetBrains Mono', 'Fira Code', monospace; white-space: pre-wrap; word-break: break-all; }
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
  @media (max-width: 640px) {
    .toolbar { flex-wrap: wrap; height: auto; min-height: 52px; padding: 10px 12px; gap: 8px; }
    .toolbar a { font-size: 13px; }
    .toolbar .title { font-size: 14px; min-width: 0; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar .dim, .toolbar .prov { display: none; }
    /* Dividers don't make sense when clusters wrap to separate rows — hide. */
    .toolbar-divider { display: none; }
    /* Spacer becomes a full-width line break so the buttons drop to a new row
     * underneath the title (rather than getting crammed alongside it). */
    .toolbar .spacer { flex-basis: 100%; height: 0; }
    /* Auto-refresh dot is too small to be worth its own line on mobile. Hide. */
    .status { display: none; }
    /* Each cluster takes a full row. Buttons inside the cluster share the
     * row width evenly via flex: 1, with compact padding. Three cluster-rows
     * stack cleanly under the title row. */
    .toolbar-cluster { flex: 0 0 100%; gap: 6px; }
    .toolbar .btn { flex: 1; min-width: 0; padding: 8px 6px; font-size: 12px; font-weight: 500; white-space: nowrap; }
    .json-panel { width: 100%; }
    .compare-grid { --scale: 0.18; gap: 12px; padding: 12px; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <a href="/project/${canvas.projectId}">&larr; Back</a>
    <span class="title">${esc(canvas.name)}</span>
    <span class="dim">${w} x ${h}${isMobile ? ` &middot; ${esc(deviceId)}` : window ? ` &middot; ${esc(window.id)}` : ''}</span>
    ${stateChips}
    ${provChip}
    ${verdictChip}
    <div class="spacer"></div>
    <div class="toolbar-cluster">
      ${hasDark ? '<button class="btn" id="theme-toggle" onclick="toggleTheme()" title="Render the dark token layer">Dark</button>' : ''}
      ${isMobile
        ? '<button class="btn" onclick="toggleSafeArea()" id="btn-safe" title="Show where the status bar and home indicator sit">Safe area</button>'
        : window
        ? `${windowWidths.map((bw) => `<button class="btn bp-btn" onclick="setViewport(${bw}, ${h}, 'w${bw}')" id="bp-w${bw}" title="A ${bw}px window">${bw}</button>`).join('\n      ')}
      <button class="btn bp-btn active" onclick="setViewport(${w}, ${h}, 'desktop')" id="bp-desktop" title="The artboard's window">${w}</button>
      <button class="btn bp-btn" onclick="setCompareMode()" id="bp-compare">Compare</button>`
        : `<button class="btn bp-btn" onclick="setViewport(${PHONE.width}, ${PHONE.height}, 'mobile')" id="bp-mobile">Mobile</button>
      <button class="btn bp-btn" onclick="setViewport(768, 1024, 'tablet')" id="bp-tablet">Tablet</button>
      <button class="btn bp-btn active" onclick="setViewport(${w}, ${h}, 'desktop')" id="bp-desktop">Desktop</button>
      <button class="btn bp-btn" onclick="setCompareMode()" id="bp-compare">Compare</button>`}
    </div>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <div class="toolbar-cluster">
      ${isMobile ? '' : '<button class="btn" onclick="toggleFit()" id="btn-fit">Fit</button>'}
      <button class="btn" onclick="toggleJson()" id="btn-json">JSON</button>
      <button class="btn" onclick="toggleComment()" id="btn-comment" title="Click any element in the preview to leave a note for the agent">Comment</button>
    </div>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <div class="toolbar-cluster">
      ${canvas.archived
        ? `<button class="btn" onclick="lifecycleAction('unarchive')" id="btn-restore">Restore</button>`
        : `<button class="btn" onclick="lifecycleAction('archive')" id="btn-archive">Archive</button>`
      }
      <button class="btn btn--danger" onclick="lifecycleAction('delete')" id="btn-delete">Delete</button>
    </div>
    <div class="status" id="status" title="Auto-refresh active"></div>
  </div>
  <div class="detail-main">
  ${isMobile ? renderDevice(canvas, w, h, deviceId, profile) : `<div class="viewport" id="viewport">
    <iframe id="frame" src="/canvas/${canvas.id}/html" width="${w}" height="${h}"></iframe>
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
  <div class="json-panel" id="json-panel">
    <pre id="json-content">Loading...</pre>
  </div>
  <script>
    ${detailScript(canvas, w, h, surface.type)}
  </script>
</body>
</html>`;
}
