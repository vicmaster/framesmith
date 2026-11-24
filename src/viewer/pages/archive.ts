import { getCanvas, listCanvases } from '../../scene-graph.js';
import { getProject } from '../../workspaces.js';
import { baseCss, COMPONENTS_CSS, MOBILE_TOGGLE_CSS, SIDEBAR_CSS } from '../styles.js';
import { FAVICON_HTML, MOBILE_TOGGLE_HTML, renderSidebar } from '../components.js';
import { artboardSize, esc, renderThumb } from '../shared.js';
import { archiveScript } from '../client/archive.js';

/** Archive view: shows all archived canvases across every project. Each card
 *  includes the source-project name (since archive is cross-project) and
 *  inline Restore / Delete actions that call the JSON API. */
export function renderArchivePage(port: number): string {
  const archived = listCanvases().filter((c) => c.archived);
  const projectName = (projectId: string) => getProject(projectId)?.name ?? '—';

  const cards = archived.map((c) => {
    const canvas = getCanvas(c.id)!;
    const { w, h } = artboardSize(canvas);
    const archivedDate = c.lastModified ? new Date(c.lastModified).toLocaleString() : '';
    return `
      <div class="card card--archived" data-canvas-id="${c.id}">
        <a href="/canvas/${c.id}" class="card-link">
          ${renderThumb(canvas)}
          <div class="info">
            <div class="name">${esc(c.name)}</div>
            <div class="meta">${esc(projectName(c.projectId))} &middot; ${w} x ${h}</div>
            <div class="meta-archived">Archived ${esc(archivedDate)}</div>
          </div>
        </a>
        <div class="card-actions">
          <button class="card-action" data-action="restore" data-id="${c.id}">Restore</button>
          <button class="card-action card-action--danger" data-action="delete" data-id="${c.id}">Delete</button>
        </div>
      </div>`;
  }).join('\n');

  const emptyState = archived.length === 0
    ? `<div class="empty">
        <div class="empty-icon">&#9634;</div>
        <div>No archived canvases</div>
        <div class="empty-hint">Archive a canvas with <code>canvas_archive({ canvasId })</code> or the Archive button on a canvas page.</div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Archive — Framesmith</title>
${FAVICON_HTML}
<style>
  ${baseCss()}
  ${SIDEBAR_CSS}
  ${COMPONENTS_CSS}
  /* Main pane */
  .main { flex: 1; min-width: 0; background: var(--bg-1); }
  .main-header { padding: 28px 36px 24px; border-bottom: 1px solid var(--border-subtle); }
  .breadcrumb { font-size: 12px; font-weight: 500; color: var(--text-tertiary); margin-bottom: 8px; }
  .project-title { font-size: 36px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.6px; line-height: 1.1; }
  .project-meta { font-size: 13px; font-weight: 500; color: var(--text-tertiary); margin-top: 8px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(264px, 1fr)); gap: 20px; align-items: start; padding: 28px 36px 36px; }
  .card { position: relative; background: var(--surface); border-radius: 12px; overflow: hidden; transition: transform 0.18s ease, box-shadow 0.18s ease; border: 1px solid var(--border); box-shadow: var(--elevation-flat); }
  .card:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--elevation-raised); }
  .card--archived { opacity: 0.72; }
  .card--archived:hover { opacity: 1; }
  .card-link { display: block; text-decoration: none; color: inherit; }
  .thumb { width: 100%; aspect-ratio: 16/10; overflow: hidden; background: var(--bg-0); position: relative; }
  .thumb iframe { border: none; transform-origin: 0 0; transform: scale(var(--thumb-scale, 0.222)); pointer-events: none; position: absolute; top: 0; left: 0; }
  .thumb--empty { background: var(--bg-elevated); }
  /* Phase 19 Slice A — heuristic quality score badge on each card thumbnail. */
  .card-score { position: absolute; top: 8px; right: 8px; z-index: 2; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; background: var(--neutral-tint); color: var(--text-secondary); border: none; border-radius: 6px; padding: 3px 8px; line-height: 1; }
  .thumb-empty { position: absolute; inset: 0; }
  .thumb-empty-back, .thumb-empty-front { position: absolute; width: 38px; height: 28px; border-radius: 4px; border: 1px solid var(--border); }
  .thumb-empty-back { top: calc(50% - 6px); left: calc(50% - 27px); }
  .thumb-empty-front { top: calc(50% - 10px); left: calc(50% - 19px); background: var(--bg-surface); border-color: var(--border-strong); }
  .info { padding: 14px 16px 16px; }
  .name { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; letter-spacing: -0.1px; }
  .meta { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
  .meta-archived { font-size: 11px; color: var(--text-muted); margin-top: 4px; font-style: italic; }

  .card-actions { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; opacity: 0; transition: opacity 0.15s; z-index: 2; }
  .card:hover .card-actions { opacity: 1; }
  .card-action { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border); padding: 5px 10px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s, color 0.15s; }
  .card-action:hover { background: var(--accent-tint); border-color: var(--accent); color: var(--accent); }
  .card-action--danger:hover { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }

  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 120px 32px; color: var(--text-tertiary); font-size: 15px; }
  .empty-icon { font-size: 44px; opacity: 0.3; }
  .empty-hint { font-size: 13px; color: var(--text-muted); text-align: center; max-width: 480px; }
  .empty-hint code { background: var(--surface); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: var(--text-secondary); }
  ${MOBILE_TOGGLE_CSS}
</style>
</head>
<body>
  ${MOBILE_TOGGLE_HTML}
  <div class="app">
    ${renderSidebar('archive')}
    <main class="main">
      <div class="main-header">
        <div class="breadcrumb">Archive</div>
        <h1 class="project-title">Archived canvases</h1>
        <div class="project-meta">${archived.length} canvas${archived.length !== 1 ? 'es' : ''} across all projects</div>
      </div>
      ${archived.length > 0 ? `<div class="grid">${cards}</div>` : emptyState}
    </main>
  </div>
  <script>
    ${archiveScript()}
  </script>
</body>
</html>`;
}
