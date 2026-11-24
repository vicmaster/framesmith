// Phase 33 slice A — the viewer's shared components (FR-A4): sidebar, tabs,
// menu and dialog, built once. Markup here; behaviour in COMPONENTS_JS, which
// every page includes; styles in styles.ts.

import { listCanvases } from '../scene-graph.js';
import { listProjects, listWorkspaces } from '../workspaces.js';
import { getIconSvg } from '../icons.js';
import { baseRows, esc } from './shared.js';
import { LIGHT } from './tokens.js';

/** A bundled Lucide icon, stroked in the current text colour. */
export function icon(name: string, size = 16): string {
  return getIconSvg(name, size, 'currentColor') ?? '';
}

/** SVG favicon embedded as a data URI, so the viewer needs no favicon route.
 * URL-encoded: `<` → `%3C`, `>` → `%3E`. The stroke is the light accent's
 * value, because a favicon cannot read CSS variables. */
export const FAVICON_HTML = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(LIGHT.colors.accent)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M 4 4 L 20 4 L 20 20 L 4 20 Z M 4 11 L 20 11 M 11 11 L 11 20'/%3E%3C/svg%3E">`;

/** Mobile sidebar drawer (FR-A5): a fixed toggle and a backdrop that closes it. */
export const MOBILE_TOGGLE_HTML = `
  <button class="sidebar-toggle" aria-label="Toggle sidebar" onclick="toggleSidebar()">${icon('menu', 18)}</button>
  <div class="sidebar-backdrop" onclick="toggleSidebar()"></div>`;

export const MOBILE_TOGGLE_JS = `
    function toggleSidebar() {
      document.body.classList.toggle('sidebar-open');
    }`;

const DOT_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];

/** A project's identity dot: one of the design system's series colours,
 * picked by hashing the id so it stays stable without a stored field. */
export function projectDotToken(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = ((hash << 5) - hash + projectId.charCodeAt(i)) | 0;
  return `var(${DOT_TOKENS[Math.abs(hash) % DOT_TOKENS.length]})`;
}

/** The sidebar: wordmark; per workspace its label and one link per project
 * (identity dot, name, card count), or "No projects yet"; Archive
 * pinned to the bottom with its count. `active` is a project id or 'archive'. */
export function renderSidebar(active: string): string {
  const all = listCanvases();
  // Cards, not canvases: a state variant folds into its base, as on the page.
  const projectCount = (projectId: string) => baseRows(all, projectId).length;
  const archivedCount = all.filter((c) => c.archived).length;
  const current = (on: boolean) => (on ? ' aria-current="page"' : '');

  const sections = listWorkspaces().map((ws) => {
    const projects = listProjects(ws.id);
    const items = projects.length === 0
      ? '<div class="ws-empty">No projects yet</div>'
      : projects.map((p) => `<a href="/project/${esc(p.id)}" class="nav-item"${current(p.id === active)}>
          <span class="nav-dot" style="background:${projectDotToken(p.id)}"></span>
          <span class="nav-label">${esc(p.name)}</span>
          <span class="nav-count">${projectCount(p.id)}</span>
        </a>`).join('');
    return `<div class="ws-section"><div class="ws-name">${esc(ws.name)}</div>${items}</div>`;
  }).join('');

  return `<aside class="sidebar">
      <a href="/" class="sidebar-brand">framesmith</a>
      <nav class="sidebar-nav" aria-label="Projects">${sections}</nav>
      <a href="/archive" class="nav-item sidebar-archive"${current(active === 'archive')}>
        <span class="nav-icon">${icon('archive')}</span>
        <span class="nav-label">Archive</span>
        <span class="nav-count">${archivedCount}</span>
      </a>
    </aside>`;
}

export interface TabSpec { id: string; label: string; count?: number; selected?: boolean; panelId?: string }

/** A tab list: real buttons with role="tab", arrow keys move between them
 * (COMPONENTS_JS). Selecting one shows its panel (aria-controls) and hides
 * the others, and fires a "tabchange" event on the list. */
export function renderTabs(tabs: TabSpec[], label: string): string {
  const buttons = tabs.map((t) => `<button type="button" role="tab" class="tab" id="tab-${esc(t.id)}" data-tab="${esc(t.id)}" aria-selected="${t.selected ? 'true' : 'false'}" tabindex="${t.selected ? '0' : '-1'}"${t.panelId ? ` aria-controls="${esc(t.panelId)}"` : ''}>${esc(t.label)}${t.count !== undefined ? ` <span class="tab-count">${t.count}</span>` : ''}</button>`).join('');
  return `<div class="tablist" role="tablist" aria-label="${esc(label)}">${buttons}</div>`;
}

export type MenuItemSpec = { action: string; label: string; icon?: string; danger?: boolean; keepOpen?: boolean } | 'separator';

/** A menu behind a button: Up and Down move, Enter activates, Escape and an
 * outside click close it and return focus (COMPONENTS_JS). Choosing an item
 * fires a "menuaction" event on the wrapper with detail.action. */
export function renderMenu(id: string, buttonHtml: string, buttonLabel: string, items: MenuItemSpec[]): string {
  const rows = items.map((item) => item === 'separator'
    ? '<div class="menu-sep" role="separator"></div>'
    : `<button type="button" role="menuitem" class="menu-item${item.danger ? ' menu-item--danger' : ''}" data-action="${esc(item.action)}"${item.keepOpen ? ' data-keep-open' : ''} tabindex="-1">${item.icon ? icon(item.icon) : ''}<span>${esc(item.label)}</span></button>`).join('');
  return `<div class="menu-wrap" data-menu="${esc(id)}">
      <button type="button" class="btn btn--ghost btn--icon" aria-haspopup="menu" aria-expanded="false" aria-controls="${esc(id)}" aria-label="${esc(buttonLabel)}">${buttonHtml}</button>
      <div class="menu" role="menu" id="${esc(id)}" aria-label="${esc(buttonLabel)}" hidden>${rows}</div>
    </div>`;
}

export interface DialogSpec { id: string; title: string; body: string; confirmLabel: string; destructive?: boolean }

/** A modal dialog over a scrim, hidden until fsDialog.open(id) (COMPONENTS_JS):
 * focus moves to Cancel, Tab stays inside, Escape or the scrim cancels. */
export function renderDialog(d: DialogSpec): string {
  return `<div class="dialog-scrim" data-dialog-scrim="${esc(d.id)}" hidden>
      <div class="dialog" role="dialog" aria-modal="true" id="${esc(d.id)}" aria-labelledby="${esc(d.id)}-title">
        <div class="dialog-head">
          <div class="dialog-title" id="${esc(d.id)}-title">${esc(d.title)}</div>
          <button type="button" class="btn btn--ghost btn--icon" data-dialog-close aria-label="Close">${icon('x')}</button>
        </div>
        <div class="dialog-body">${esc(d.body)}</div>
        <div class="dialog-actions">
          <button type="button" class="btn btn--secondary" data-dialog-cancel>Cancel</button>
          <button type="button" class="btn ${d.destructive ? 'btn--destructive' : 'btn--primary'}" data-dialog-confirm>${esc(d.confirmLabel)}</button>
        </div>
      </div>
    </div>`;
}

/** Behaviour for every tab list, menu and dialog on the page. */
export const COMPONENTS_JS = `
    (() => {
      // Tabs: click or arrow keys select; the selected tab's panel shows.
      document.querySelectorAll('[role="tablist"]').forEach((list) => {
        const tabs = () => Array.from(list.querySelectorAll('[role="tab"]'));
        const select = (tab, focus) => {
          tabs().forEach((t) => {
            const on = t === tab;
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
            const panel = t.getAttribute('aria-controls') && document.getElementById(t.getAttribute('aria-controls'));
            if (panel) panel.hidden = !on;
          });
          if (focus) tab.focus();
          list.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: tab.dataset.tab } }));
        };
        list.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) select(t, false); });
        list.addEventListener('keydown', (e) => {
          const all = tabs(); const i = all.indexOf(document.activeElement);
          if (i < 0) return;
          const next = e.key === 'ArrowRight' ? all[(i + 1) % all.length]
            : e.key === 'ArrowLeft' ? all[(i - 1 + all.length) % all.length]
            : e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : null;
          if (next) { e.preventDefault(); select(next, true); }
        });
      });

      // Menus: the button toggles; Up/Down/Home/End move; Escape, Tab and an
      // outside click close and return focus to the button.
      document.querySelectorAll('[data-menu]').forEach((wrap) => {
        const button = wrap.querySelector('[aria-haspopup="menu"]');
        const menu = wrap.querySelector('[role="menu"]');
        const items = () => Array.from(menu.querySelectorAll('[role="menuitem"]'));
        const close = (refocus) => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (refocus) button.focus(); };
        const open = () => { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); const first = items()[0]; if (first) first.focus(); };
        button.addEventListener('click', () => (menu.hidden ? open() : close(true)));
        menu.addEventListener('keydown', (e) => {
          const all = items(); const i = all.indexOf(document.activeElement);
          if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
          if (e.key === 'Tab') { close(false); return; }
          const next = e.key === 'ArrowDown' ? all[(i + 1) % all.length]
            : e.key === 'ArrowUp' ? all[(i - 1 + all.length) % all.length]
            : e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : null;
          if (next) { e.preventDefault(); next.focus(); }
        });
        menu.addEventListener('click', (e) => {
          const item = e.target.closest('[role="menuitem"]');
          if (!item) return;
          // An item that reports its result in place (Copy) keeps the menu open.
          if (!item.hasAttribute('data-keep-open')) close(true);
          wrap.dispatchEvent(new CustomEvent('menuaction', { detail: { action: item.dataset.action } }));
        });
        document.addEventListener('click', (e) => { if (!menu.hidden && !wrap.contains(e.target)) close(false); });
      });

      // Dialogs: fsDialog.open(id) resolves true on confirm, false on cancel.
      window.fsDialog = {
        open(id) {
          const dialog = document.getElementById(id);
          const scrim = dialog && dialog.closest('[data-dialog-scrim]');
          if (!scrim) return Promise.resolve(false);
          const opener = document.activeElement;
          scrim.hidden = false;
          const cancel = dialog.querySelector('[data-dialog-cancel]');
          const confirm = dialog.querySelector('[data-dialog-confirm]');
          const closer = dialog.querySelector('[data-dialog-close]');
          cancel.focus();
          return new Promise((resolve) => {
            const done = (value) => {
              scrim.hidden = true;
              dialog.removeEventListener('keydown', onKey);
              scrim.removeEventListener('click', onScrim);
              cancel.removeEventListener('click', onCancel);
              confirm.removeEventListener('click', onConfirm);
              if (closer) closer.removeEventListener('click', onCancel);
              if (opener && opener.focus) opener.focus();
              resolve(value);
            };
            const onCancel = () => done(false);
            const onConfirm = () => done(true);
            const onScrim = (e) => { if (e.target === scrim) done(false); };
            const onKey = (e) => {
              if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
              if (e.key !== 'Tab') return;
              const focusable = Array.from(dialog.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'));
              const first = focusable[0]; const last = focusable[focusable.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            };
            dialog.addEventListener('keydown', onKey);
            scrim.addEventListener('click', onScrim);
            cancel.addEventListener('click', onCancel);
            confirm.addEventListener('click', onConfirm);
            if (closer) closer.addEventListener('click', onCancel);
          });
        },
      };
    })();`;
