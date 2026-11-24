import { getCanvas, listCanvases } from '../../scene-graph.js';
import { getProject, listWorkspaces } from '../../workspaces.js';
import { DEFAULT_PROJECT_ID } from '../../types.js';
import { baseCss, COMPONENTS_CSS, MOBILE_TOGGLE_CSS, SIDEBAR_CSS } from '../styles.js';
import { FAVICON_HTML, MOBILE_TOGGLE_HTML, renderSidebar } from '../components.js';
import { artboardSize, esc, renderThumb } from '../shared.js';
import { evalFor, scoreColor } from '../scores.js';
import { projectScript } from '../client/project.js';

/** Project-scoped main page. Sidebar on left, breadcrumb + canvas grid on right.
 *  Returns null when the project doesn't exist so the route handler can 404. */
export async function renderProjectPage(projectId: string, port: number): Promise<string | null> {
  const project = getProject(projectId);
  if (!project) return null;

  // Find the parent workspace for the breadcrumb. Default to "Personal" if
  // somehow orphaned (shouldn't happen after slice 1 migration).
  const ws = listWorkspaces().find((w) => w.id === project.workspaceId);
  const wsName = ws?.name ?? 'Personal';

  // One listing for the whole render: it version-hashes every canvas in the
  // store, so it is the most expensive call on this path and must not be
  // repeated per card.
  const allRows = listCanvases();
  const statesById = new Map(allRows.map((r) => [r.id, r.variants?.map((v) => v.state) ?? []]));
  const canvases = allRows.filter((c) => c.projectId === projectId && !c.archived);
  // Phase 24 slice A — a screen and its state variants are ONE card: variants
  // whose base is in this listing fold into the base card as chips. A variant
  // whose base is missing (orphan) or lives elsewhere stays a standalone card.
  const present = new Set(canvases.map((c) => c.id));
  const shown = canvases.filter((c) => !(c.variant && present.has(c.variant.of)));
  const cards = (await Promise.all(shown.map(async (c) => {
    const canvas = getCanvas(c.id)!;
    const { w, h } = artboardSize(canvas);
    const date = new Date(c.createdAt).toLocaleString();
    // Phase 19 Slice A — gallery score badge (fast eval, cached; empty → none).
    const ev = await evalFor(canvas, statesById.get(c.id) ?? []);
    const scoreBadge = ev
      ? `<div class="card-score" style="color:${scoreColor(ev.overallScore)}" title="Heuristic quality score">${ev.overallScore}</div>`
      : '';
    const stateChips = c.variants?.length
      ? `<div class="state-chips card-states">
          <span class="state-chip state-chip--active">default</span>
          ${c.variants.map((v) => `<a class="state-chip" href="/canvas/${v.canvasId}">${esc(v.state)}</a>`).join('')}
        </div>`
      : '';
    return stateChips
      ? `
      <div class="card">
        <a href="/canvas/${c.id}" class="card-link">
          ${renderThumb(canvas, scoreBadge)}
          <div class="info">
            <div class="name">${esc(c.name)}</div>
            <div class="meta">${w} x ${h} &middot; ${esc(date)}</div>
          </div>
        </a>
        ${stateChips}
      </div>`
      : `
      <a href="/canvas/${c.id}" class="card">
        ${renderThumb(canvas, scoreBadge)}
        <div class="info">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${w} x ${h} &middot; ${esc(date)}</div>
        </div>
      </a>`;
  }))).join('\n');

  const emptyState = canvases.length === 0
    ? `<div class="empty">
        <div class="empty-icon">&#9634;</div>
        <div>No canvases in ${esc(project.name)} yet</div>
        <div class="empty-hint">Create one via your MCP client using <code>canvas_create({ projectId: "${project.id}" })</code></div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(project.name)} — Framesmith</title>
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

  /* Card grid */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(264px, 1fr)); gap: 20px; align-items: start; padding: 28px 36px 36px; }
  .card { background: var(--surface); border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; transition: transform 0.18s ease, box-shadow 0.18s ease; border: 1px solid var(--border); box-shadow: var(--elevation-flat); }
  .card:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--elevation-raised); }
  .card-link { display: block; text-decoration: none; color: inherit; }
  .card-states { padding: 0 14px 12px; }
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
    ${renderSidebar(projectId)}
    <main class="main">
      <div class="main-header">
        <div class="breadcrumb">${esc(wsName)} / ${esc(project.name)}</div>
        <h1 class="project-title">${esc(project.name)}</h1>
        <div class="project-meta">${canvases.length} canvas${canvases.length !== 1 ? 'es' : ''}</div>
      </div>
      ${canvases.length > 0 ? `<div class="grid">${cards}</div>` : emptyState}
    </main>
  </div>
  <script>
    ${projectScript(projectId, canvases.length)}
  </script>
</body>
</html>`;
}

/** Backwards-compatible alias: renders the default project. The previous
 *  `renderGalleryPage` was a flat all-canvases view; the new model is
 *  project-scoped, and the default project is the natural landing place. */
export async function renderGalleryPage(port: number): Promise<string> {
  return (await renderProjectPage(DEFAULT_PROJECT_ID, port)) ?? '<h1>No projects found</h1>';
}
