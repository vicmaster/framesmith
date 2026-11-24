// Phase 33 slice B — the project page (the gallery), design screen 1: a header
// with the project, a summary against the bar and a Live status; a search
// field and type tabs; a grid of cards, each a live thumbnail with its score
// on the corner. Search, filter and live refresh run in client/project.ts.

import { getCanvas, listCanvases, type CanvasSummary } from '../../scene-graph.js';
import { getProject } from '../../workspaces.js';
import { resolveSurface, type SurfaceType } from '../../surfaces.js';
import { resolveGenre } from '../../evaluate.js';
import { DEFAULT_PROJECT_ID } from '../../types.js';
import { baseCss, COMPONENTS_CSS, MOBILE_TOGGLE_CSS, SIDEBAR_CSS } from '../styles.js';
import { FAVICON_HTML, MOBILE_TOGGLE_HTML, icon, renderSidebar, renderTabs } from '../components.js';
import { artboardSize, baseRows, esc, renderThumb } from '../shared.js';
import { evalFor } from '../scores.js';
import { projectScript } from '../client/project.js';

/** The evaluator's quality bar: a score above 95 is at it. */
export const BAR = 96;

export const TYPE_LABELS: Record<SurfaceType, string> = { web: 'Web', mobile: 'Mobile', 'desktop-app': 'Desktop app' };

/** "Edited Nov 24", with the year when it is not the current one. */
export function editedLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return `Edited ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })}`;
}

/** The score chip on a card's thumbnail: quiet at the bar, amber below it. */
function scoreChip(score: number): string {
  const below = score < BAR;
  return `<span class="score-chip${below ? ' score-chip--below' : ''}" title="Quality score ${score} of 100${below ? ', below the bar' : ''}">${score}</span>`;
}

/** What the gallery's live poll compares (FR-B4): for each base canvas, its
 * id, versionHash, name, type, genre and designed states. versionHash alone
 * misses a rename, a genre change, a new state and a type change. Mirrors
 * galleryKey in client/project.ts, which computes it from /api/canvases. */
export function galleryKey(rows: Array<CanvasSummary & { type?: string; genre?: string | null }>, projectId: string): string {
  return baseRows(rows, projectId)
    .map((r) => {
      const c = getCanvas(r.id);
      const type = r.type ?? (c ? resolveSurface(c).type : '');
      const genre = r.genre !== undefined ? r.genre : (c ? resolveGenre(c).genre : null);
      return [r.id, r.versionHash, r.name, type, genre ?? '', (r.variants ?? []).map((v) => v.state).sort().join(',')].join('|');
    })
    .sort()
    .join('\n');
}

/** Project-scoped main page. Returns null when the project doesn't exist so
 * the route handler can 404. */
export async function renderProjectPage(projectId: string, _port: number): Promise<string | null> {
  const project = getProject(projectId);
  if (!project) return null;

  // One listing for the whole render: it version-hashes every canvas in the
  // store, so it is the most expensive call on this path and must not be
  // repeated per card.
  const rows = listCanvases();
  const shown = baseRows(rows, projectId);
  const typeCounts: Record<SurfaceType, number> = { web: 0, mobile: 0, 'desktop-app': 0 };
  let below = 0;

  const cards = await Promise.all(shown.map(async (c) => {
    const canvas = getCanvas(c.id)!;
    const { w, h } = artboardSize(canvas);
    const type = resolveSurface(canvas).type;
    typeCounts[type]++;
    const states = c.variants?.map((v) => v.state) ?? [];
    const ev = await evalFor(canvas, states);
    if (ev && ev.overallScore < BAR) below++;
    const meta = [TYPE_LABELS[type], `${w} × ${h}`, editedLabel(c.lastModified), ...(states.length ? [`${states.length} state${states.length === 1 ? '' : 's'}`] : [])].filter(Boolean).join(' · ');
    return `
      <article class="card" data-canvas-id="${esc(c.id)}" data-name="${esc(c.name.toLowerCase())}" data-type="${type}">
        ${renderThumb(canvas, ev ? scoreChip(ev.overallScore) : '')}
        <div class="card-copy">
          <a class="card-name" href="/canvas/${esc(c.id)}" title="${esc(c.name)}">${esc(c.name)}</a>
          <div class="card-meta" title="${esc(meta)}">${esc(meta)}</div>
        </div>
      </article>`;
  }));

  const n = shown.length;
  const summary = `${n} canvas${n === 1 ? '' : 'es'}${n === 0 ? '' : below === 0 ? ' · all at the bar' : ` · ${below} below the bar`}`;
  const tabs = renderTabs([
    { id: 'all', label: 'All', count: n, selected: true },
    ...(Object.keys(typeCounts) as SurfaceType[]).filter((t) => typeCounts[t] > 0).map((t) => ({ id: t, label: TYPE_LABELS[t], count: typeCounts[t] })),
  ], 'Canvas type');

  const body = n === 0
    ? `<div class="empty">
        <div class="empty-icon">${icon('layout-grid', 32)}</div>
        <div class="empty-title">No canvases in ${esc(project.name)} yet</div>
        <div class="empty-hint">Create one from your MCP client with <code>canvas_create({ projectId: "${esc(project.id)}" })</code>.</div>
      </div>`
    : `<div class="filter-bar">
        <label class="search">${icon('search')}<input type="search" id="search" placeholder="Search canvases" aria-label="Search canvases" autocomplete="off"></label>
        ${tabs}
      </div>
      <div class="grid-pane">
        <div class="grid" id="grid">${cards.join('')}</div>
        <div class="no-match" id="no-match" hidden>
          <div class="empty-title" id="no-match-text"></div>
          <button type="button" class="btn btn--secondary" id="clear-filters">Clear</button>
        </div>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.name)} — framesmith</title>
${FAVICON_HTML}
<style>
  ${baseCss()}
  ${SIDEBAR_CSS}
  ${COMPONENTS_CSS}
  ${GALLERY_CSS}
  ${MOBILE_TOGGLE_CSS}
</style>
</head>
<body>
  ${MOBILE_TOGGLE_HTML}
  <div class="app">
    ${renderSidebar(projectId)}
    <main class="main">
      <header class="main-header">
        <h1 class="page-title">${esc(project.name)}</h1>
        <div class="header-side">
          <span class="summary" id="summary">${esc(summary)}</span>
          <span class="live" id="live" role="status"><span class="live-dot"></span><span class="live-label">Live</span></span>
        </div>
      </header>
      ${body}
    </main>
  </div>
  <script>
    ${projectScript(projectId, galleryKey(rows, projectId))}
  </script>
</body>
</html>`;
}

const GALLERY_CSS = `
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-primary); }
  .main-header { height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: 0 var(--space-md); border-bottom: 1px solid var(--border); }
  .page-title { font-size: 18px; font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .header-side { display: flex; align-items: center; gap: var(--space-md); min-width: 0; }
  .summary { font-size: var(--font-label); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .live { display: inline-flex; align-items: center; gap: var(--space-2xs); font-size: var(--font-label); color: var(--text-secondary); white-space: nowrap; }
  .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }
  .live.offline .live-dot { background: var(--border-strong); }

  .filter-bar { min-height: 48px; flex-shrink: 0; display: flex; align-items: center; gap: var(--space-md); padding: var(--space-xs) var(--space-md); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .search { display: flex; align-items: center; gap: var(--space-xs); width: 280px; max-width: 100%; height: 32px; padding: 0 var(--space-xs); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-secondary); }
  .search:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: inherit; font-size: var(--font-body); color: var(--text-primary); }
  .search input::placeholder { color: var(--text-secondary); }
  .filter-bar .tablist { border-bottom: none; gap: var(--space-2xs); }
  .filter-bar .tab { padding: 0 var(--space-xs); border-radius: var(--radius-sm); }
  .filter-bar .tab[aria-selected="true"] { background: var(--accent-tint); }
  .filter-bar .tab[aria-selected="true"]::after { display: none; }

  .grid-pane { flex: 1; padding: var(--space-lg); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-lg); align-items: start; }
  .card { position: relative; display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--elevation-flat); transition: border-color 0.15s, box-shadow 0.15s; }
  .card:hover { border-color: var(--border-strong); box-shadow: var(--elevation-raised); }
  .card:has(.card-name:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .card[hidden] { display: none; }
  .thumb { width: 100%; overflow: hidden; background: var(--bg-elevated); position: relative; border-bottom: 1px solid var(--border); }
  .thumb iframe { border: none; transform-origin: 0 0; transform: scale(var(--thumb-scale, 0.222)); pointer-events: none; position: absolute; top: 0; left: 0; }
  .thumb-empty { position: absolute; inset: 0; }
  .thumb-empty-back, .thumb-empty-front { position: absolute; width: 38px; height: 28px; border-radius: 4px; border: 1px solid var(--border); }
  .thumb-empty-back { top: calc(50% - 6px); left: calc(50% - 27px); }
  .thumb-empty-front { top: calc(50% - 10px); left: calc(50% - 19px); background: var(--bg-surface); border-color: var(--border-strong); }
  .score-chip { position: absolute; top: var(--space-xs); right: var(--space-xs); z-index: 2; font-size: var(--font-caption); font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.5; padding: 2px 6px; border-radius: var(--radius-sm); background: var(--neutral-tint); color: var(--text-secondary); pointer-events: none; }
  .score-chip--below { background: var(--warning-tint); color: var(--warning); }
  .card-copy { display: flex; flex-direction: column; gap: 2px; padding: var(--space-sm) var(--space-md); min-width: 0; }
  .card-name { font-size: var(--font-body); font-weight: 600; color: var(--text-primary); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; outline: none; }
  .card-name::after { content: ''; position: absolute; inset: 0; z-index: 1; }
  .card-meta { font-size: var(--font-caption); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .empty, .no-match { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-sm); padding: 120px var(--space-lg); text-align: center; color: var(--text-secondary); }
  .no-match[hidden] { display: none; }
  .empty-icon { color: var(--text-secondary); }
  .empty-title { font-size: var(--font-body); font-weight: 600; color: var(--text-primary); }
  .empty-hint { font-size: var(--font-label); max-width: 480px; }
  .empty-hint code { background: var(--neutral-tint); padding: 2px 6px; border-radius: 4px; font-size: var(--font-label); color: var(--text-primary); }
  @media (max-width: 640px) { .main-header { height: auto; min-height: 48px; flex-wrap: wrap; row-gap: 2px; padding-top: var(--space-xs); padding-bottom: var(--space-xs); } .filter-bar .tablist { overflow-x: auto; max-width: 100%; } .grid-pane { padding: var(--space-md); } .grid { grid-template-columns: 1fr; } }`;

/** Backwards-compatible alias: renders the default project. The previous
 *  `renderGalleryPage` was a flat all-canvases view; the new model is
 *  project-scoped, and the default project is the natural landing place. */
export async function renderGalleryPage(port: number): Promise<string> {
  return (await renderProjectPage(DEFAULT_PROJECT_ID, port)) ?? '<h1>No projects found</h1>';
}
