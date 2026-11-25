// Phase 33 slice E — the archive page, design screens 6 and 7: a tree of
// archived canvases grouped by project, and the selected one in a right panel
// with Restore and Delete permanently. Selection is the ?canvas= query,
// rendered on the server (D10); actions run in client/archive.ts.

import type { Canvas } from '../../types.js';
import { getCanvas, listCanvases } from '../../scene-graph.js';
import { getProject } from '../../workspaces.js';
import { baseCss, COMPONENTS_CSS, MOBILE_TOGGLE_CSS, SIDEBAR_CSS } from '../styles.js';
import { FAVICON_HTML, MOBILE_TOGGLE_HTML, icon, renderDialog, renderSidebar } from '../components.js';
import { artboardSize, esc, renderThumb } from '../shared.js';
import { evalFor } from '../scores.js';
import { archiveScript } from '../client/archive.js';

interface ArchivedEntry { canvas: Canvas; archivedAt: string; projectName: string | null }
interface ProjectGroup { projectId: string; name: string; entries: ArchivedEntry[] }

/** "Nov 8, 2026". */
export function archivedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Archived canvases grouped by project: projects by name, canvases by
 * archivedAt newest first (lastModified when a canvas has no archivedAt). */
export function archiveGroups(): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const row of listCanvases().filter((c) => c.archived)) {
    const canvas = getCanvas(row.id);
    if (!canvas) continue;
    const projectName = getProject(row.projectId)?.name ?? null;
    const group = groups.get(row.projectId) ?? { projectId: row.projectId, name: projectName ?? 'Unknown project', entries: [] };
    group.entries.push({ canvas, archivedAt: canvas.archivedAt ?? row.lastModified, projectName });
    groups.set(row.projectId, group);
  }
  const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const g of sorted) g.entries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  return sorted;
}

/** The canvas the panel shows: the requested one when it is archived, else
 * the most recently archived. Also the canvas to select once it is gone. */
function pickSelection(order: ArchivedEntry[], requested: string | null): { selected: ArchivedEntry; next: string | null } {
  const newest = order.reduce((a, b) => (b.archivedAt > a.archivedAt ? b : a));
  const selected = order.find((e) => e.canvas.id === requested) ?? newest;
  const i = order.indexOf(selected);
  const neighbour = order[i + 1] ?? order[i - 1];
  return { selected, next: neighbour?.canvas.id ?? null };
}

function renderTree(groups: ProjectGroup[], selectedId: string): string {
  return groups.map((g) => {
    const rows = g.entries.map((e) => {
      const on = e.canvas.id === selectedId;
      return `<li><a class="tree-row tree-row--canvas" href="/archive?canvas=${encodeURIComponent(e.canvas.id)}" data-canvas-id="${esc(e.canvas.id)}"${on ? ' aria-current="page"' : ''} title="${esc(e.canvas.name)}">${icon('file')}<span class="tree-label">${esc(e.canvas.name)}</span></a></li>`;
    }).join('');
    return `<li><details class="tree-group" open>
        <summary class="tree-row tree-row--project"><span class="tree-chevron">${icon('chevron-down')}</span>${icon('folder')}<span class="tree-label">${esc(g.name)}</span></summary>
        <ul class="tree-children">${rows}</ul>
      </details></li>`;
  }).join('');
}

async function renderPanel(entry: ArchivedEntry): Promise<string> {
  const { canvas } = entry;
  const { w, h } = artboardSize(canvas);
  const ev = await evalFor(canvas);
  const restore = entry.projectName ? `Restore to ${entry.projectName}` : 'Restore';
  const props: Array<[string, string]> = [
    ['Project', entry.projectName ?? 'Unknown project'],
    ['Archived', archivedLabel(entry.archivedAt)],
    ['Score', ev ? String(ev.overallScore) : 'No score yet'],
    ['Size', `${w} × ${h}`],
  ];
  return `<aside class="panel" aria-label="Selected canvas" data-canvas-id="${esc(canvas.id)}">
        <h2 class="panel-title" title="${esc(canvas.name)}"><a href="/canvas/${esc(canvas.id)}">${esc(canvas.name)}</a></h2>
        ${renderThumb(canvas)}
        <dl class="props">${props.map(([k, v]) => `<div class="prop"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <button type="button" class="btn btn--primary btn--block" id="btn-restore">${icon('archive-restore')}<span>${esc(restore)}</span></button>
        <div class="danger-zone">
          <p>Deleting removes the canvas for good. It cannot be restored.</p>
          <button type="button" class="btn btn--ghost btn--danger-text" id="btn-delete">${icon('trash-2')}<span>Delete permanently</span></button>
        </div>
        <p class="panel-error" id="panel-error" role="alert" hidden></p>
      </aside>`;
}

const EMPTY_HTML = `<div class="empty">
        <div class="empty-icon">${icon('archive', 32)}</div>
        <div class="empty-title">No archived canvases</div>
        <div class="empty-hint">Archive a canvas from its page, or have your agent call canvas_archive. Archived canvases wait here until you restore or delete them.</div>
      </div>`;

/** The archive page. `requested` is the ?canvas= query, if any. */
export async function renderArchivePage(_port: number, requested: string | null = null): Promise<string> {
  const groups = archiveGroups();
  const order = groups.flatMap((g) => g.entries);
  const n = order.length;
  const summary = n === 0 ? '0 canvases' : `${n} canvas${n === 1 ? '' : 'es'} · hidden from the gallery until restored`;

  let body = EMPTY_HTML;
  let dialog = '';
  let script = archiveScript(null, null);
  if (n > 0) {
    const { selected, next } = pickSelection(order, requested);
    body = `<div class="panes">
        <nav class="tree-pane" aria-label="Archived canvases"><ul class="tree">${renderTree(groups, selected.canvas.id)}</ul></nav>
        ${await renderPanel(selected)}
      </div>`;
    dialog = renderDialog({ id: 'delete-dialog', title: `Delete ${selected.canvas.name}?`, body: 'The canvas is deleted for good and cannot be restored.', confirmLabel: 'Delete permanently', destructive: true });
    script = archiveScript(selected.canvas.id, next);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archive — framesmith</title>
${FAVICON_HTML}
<style>
  ${baseCss()}
  ${SIDEBAR_CSS}
  ${COMPONENTS_CSS}
  ${ARCHIVE_CSS}
  ${MOBILE_TOGGLE_CSS}
</style>
</head>
<body>
  ${MOBILE_TOGGLE_HTML}
  <div class="app">
    ${renderSidebar('archive')}
    <main class="main">
      <header class="main-header">
        <h1 class="page-title">Archive</h1>
        <span class="summary">${esc(summary)}</span>
      </header>
      ${body}
    </main>
  </div>
  ${dialog}
  <script>
    ${script}
  </script>
</body>
</html>`;
}

const ARCHIVE_CSS = `
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-primary); }
  .main-header { height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: 0 var(--space-md); border-bottom: 1px solid var(--border); }
  .page-title { font-size: 18px; font-weight: 600; white-space: nowrap; }
  .summary { font-size: var(--font-label); font-weight: 500; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

  .panes { flex: 1; display: flex; min-height: 0; }
  .tree-pane { flex: 1; min-width: 0; padding: var(--space-md) var(--space-lg); }
  .tree, .tree-children { list-style: none; display: flex; flex-direction: column; gap: var(--space-3xs); }
  .tree-children { margin-top: var(--space-3xs); }
  .tree-row { position: relative; display: flex; align-items: center; gap: var(--space-xs); height: 32px; padding: 0 var(--space-xs); border-radius: var(--radius-sm); color: var(--text-primary); text-decoration: none; font-size: var(--font-body); cursor: pointer; }
  .tree-row svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--text-secondary); }
  .tree-row:hover { background: var(--hover); }
  .tree-row--project { list-style: none; }
  .tree-row--project::-webkit-details-marker { display: none; }
  .tree-chevron { display: inline-flex; transition: transform 0.15s; }
  .tree-group:not([open]) .tree-chevron { transform: rotate(-90deg); }
  .tree-row--canvas { padding-left: calc(var(--space-xs) + 40px); }
  .tree-row--canvas[aria-current="page"] { background: var(--accent-tint); font-weight: 600; }
  .tree-row--canvas[aria-current="page"] svg { color: var(--accent); }
  .tree-row--canvas[aria-current="page"]::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; border-radius: 2px; background: var(--accent); }
  .tree-label { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .panel { width: 360px; flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-md); background: var(--bg-surface); border-left: 1px solid var(--border); }
  .panel-title { font-size: 18px; font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel-title a { color: inherit; text-decoration: none; }
  .panel-title a:hover { text-decoration: underline; }
  .thumb { width: 100%; overflow: hidden; background: var(--bg-elevated); position: relative; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .thumb iframe { border: none; transform-origin: 0 0; transform: scale(var(--thumb-scale, 0.222)); pointer-events: none; position: absolute; top: 0; left: 0; }
  .thumb-empty { position: absolute; inset: 0; }
  .thumb-empty-back, .thumb-empty-front { position: absolute; width: 38px; height: 28px; border-radius: 4px; border: 1px solid var(--border); }
  .thumb-empty-back { top: calc(50% - 6px); left: calc(50% - 27px); }
  .thumb-empty-front { top: calc(50% - 10px); left: calc(50% - 19px); background: var(--bg-surface); border-color: var(--border-strong); }
  .props { display: flex; flex-direction: column; }
  .prop { display: flex; align-items: center; gap: var(--space-xs); min-height: 32px; font-size: var(--font-label); }
  .prop dt { width: 96px; flex-shrink: 0; color: var(--text-secondary); }
  .prop dd { min-width: 0; font-weight: 500; color: var(--text-primary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .btn--block { width: 100%; }
  .btn--block span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .danger-zone { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-xs); padding-top: var(--space-md); border-top: 1px solid var(--border); }
  .danger-zone p { font-size: var(--font-label); font-weight: 500; color: var(--text-secondary); }
  .btn--danger-text, .btn--danger-text svg { color: var(--danger); font-weight: 600; }
  .panel-error { font-size: var(--font-label); color: var(--danger); }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-sm); padding: 120px var(--space-lg); text-align: center; color: var(--text-secondary); }
  .empty-icon { color: var(--text-secondary); }
  .empty-title { font-size: var(--font-body); font-weight: 600; color: var(--text-primary); }
  .empty-hint { font-size: var(--font-label); font-weight: 500; max-width: 400px; }
  @media (max-width: 720px) { .panes { flex-direction: column; } .panel { width: auto; border-left: none; border-top: 1px solid var(--border); } .tree-pane { padding: var(--space-md); } }`;
