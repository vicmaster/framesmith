import type { SceneNode, Structure } from './types.js';
import { COLOR, SPACE, RADIUS, ELEV, TYPE } from './structure-tokens.js';

// Phase 31 slice D — the desktop-app realisations (FR-D2). Built only from
// primitives and $tokens. Each fills the window: the stamp sets the root's
// overflow to hidden (Structure.root) so the root keeps the artboard's height,
// the shell is `height: "100%"`, and every pane scrolls on its own
// (`overflow: "auto"`). A pane's direct children carry no fixed height and no
// overflow, so tripled content scrolls inside its pane instead of squashing
// its rows or growing the page.
// Fixed widths carry a matching minWidth, since a scrolling flex item may
// otherwise shrink below its width.

const APP_ROOT = { overflow: 'hidden' as const };
const SIDEBAR_WIDTH = 240;
const HEADER_HEIGHT = 48;
const ROW_HEIGHT = 32;

/** The window-filling shell: panes side by side. */
function shell(id: string, children: SceneNode[]): SceneNode {
  return { id, type: 'frame', name: 'Shell', width: '100%', height: '100%', layout: 'horizontal', fill: COLOR.bgPrimary, children };
}

/** A pane that scrolls on its own. Its direct children never carry a fixed
 * height, so they keep their content size and the pane scrolls instead of
 * squashing them. */
function pane(id: string, name: string, children: SceneNode[], opts: { width?: number | string; minWidth?: number; fill?: string; gap?: string; padding?: string } = {}): SceneNode {
  return {
    id, type: 'frame', name, layout: 'vertical', overflow: 'auto', minHeight: 0,
    width: opts.width ?? '100%', minWidth: opts.minWidth ?? 0,
    gap: opts.gap ?? SPACE.md, padding: opts.padding ?? SPACE.lg,
    ...(opts.fill ? { fill: opts.fill } : {}),
    children,
  };
}

const vDivider = (id: string): SceneNode => ({ id, type: 'divider', orientation: 'vertical' });

/** The navigation sidebar: product name over nav-items, the first active. */
function sidebar(id: string, items: Array<[string, string]>, footer: Array<[string, string]> = []): SceneNode {
  const navItem = (key: string, [label, icon]: [string, string], active = false): SceneNode =>
    ({ id: `${id}-${key}`, type: 'nav-item', label, icon, ...(active ? { active: true } : {}) });
  return pane(id, 'Sidebar', [
    { id: `${id}-brand`, type: 'text', content: 'Product name', fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary, padding: [SPACE.xs2, SPACE.xs] },
    {
      id: `${id}-nav`, type: 'frame', name: 'Navigation', width: '100%', layout: 'vertical', gap: SPACE.xxs,
      children: items.map((item, i) => navItem(`nav-${i + 1}`, item, i === 0)),
    },
    ...(footer.length ? [{
      id: `${id}-more`, type: 'frame' as const, name: 'Secondary navigation', width: '100%', layout: 'vertical' as const, gap: SPACE.xxs,
      children: footer.map((item, i) => navItem(`more-${i + 1}`, item)),
    }] : []),
  ], { width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH, fill: COLOR.bgSurface, gap: SPACE.lg, padding: SPACE.sm });
}

/** A pane header bar: a title and its actions, 48 tall, ruled below. */
function header(id: string, title: string, actions: SceneNode[]): SceneNode {
  return {
    id, type: 'frame', name: 'Header', width: '100%', height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT,
    layout: 'horizontal', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md,
    padding: [0, SPACE.md], borderBottom: { width: 1, color: COLOR.border },
    children: [
      { id: `${id}-title`, type: 'text', content: title, fontSize: TYPE.textLg, fontWeight: 600, color: COLOR.textPrimary, textOverflow: 'ellipsis', title },
      // The title truncates; the actions (each button capped) never shrink.
      { id: `${id}-actions`, type: 'frame', name: 'Actions', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs, minWidth: 'max-content', children: actions },
    ],
  };
}

/** The column beside the sidebar: fixed bars on top, then a row of panes
 * that takes the height left (`height: 100%` + `minHeight: 0` shrinks it by
 * exactly the bars, which keep theirs through their own minHeight). */
function main(id: string, bars: SceneNode[], panes: SceneNode[]): SceneNode {
  return {
    id, type: 'frame', name: 'Main', width: '100%', minWidth: 0, layout: 'vertical',
    children: [
      ...bars,
      { id: `${id}-panes`, type: 'frame', name: 'Panes', width: '100%', height: '100%', minHeight: 0, layout: 'horizontal', children: panes },
    ],
  };
}

/** A labelled button caps its width, so a long label truncates instead of
 * pushing its bar past a 1024px window. */
const BUTTON_MAX = 200;
const secondary = (id: string, label: string, icon?: string): SceneNode =>
  ({ id, type: 'button', label, variant: 'secondary', size: 'sm', maxWidth: BUTTON_MAX, ...(icon ? { icon } : {}) });
const primary = (id: string, label: string): SceneNode => ({ id, type: 'button', label, size: 'sm', maxWidth: BUTTON_MAX });
/** A 24px icon-only tool, named for screen readers, in quiet ink (a toolbar
 * of accent-coloured glyphs would compete with the one primary action). */
const iconButton = (id: string, icon: string, ariaLabel: string): SceneNode =>
  ({ id, type: 'button', icon, ariaLabel, variant: 'ghost', size: 'xs', color: COLOR.textSecondary });

/** A text that may be cut: one line, an ellipsis, its full copy as `title`. */
function cut(id: string, content: string, extra: Partial<SceneNode> = {}): SceneNode {
  return { id, type: 'text', content, fontSize: TYPE.label, color: COLOR.textPrimary, textOverflow: 'ellipsis', title: content, minWidth: 0, ...extra };
}

/** A section heading inside a pane. */
const sectionTitle = (id: string, content: string): SceneNode =>
  ({ id, type: 'text', content, fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary });

// ── the app table (data-table-app, skeleton-table-app, dashboard-app) ───────
// Carbon's ladder: the toolbar, every body row and (at rest) the header row
// are 32 tall.

// The row-actions column is the button's own 24px under a blank header (the
// usual overflow-menu column), so the button sits straight in the row: one
// level less, which keeps a table stamped into a realisation's pane within
// the 8-level depth advisory.
const ACTIONS_WIDTH = 24;
const COLUMNS: Array<{ key: string; label: string; width: string; end?: boolean }> = [
  { key: 'name', label: 'Name', width: '36%' },
  { key: 'status', label: 'Status', width: '18%' },
  { key: 'updated', label: 'Updated', width: '20%' },
  { key: 'amount', label: 'Amount', width: '18%', end: true },
  { key: 'actions', label: '', width: `${ACTIONS_WIDTH}px`, end: true },
];

/** A 32px row: one cell per column, a text cell sized straight to its
 * column width, the actions cell (the icon button, or the header's blank
 * frame) at the column's fixed 24px. */
function tableRow(id: string, cells: (col: (typeof COLUMNS)[number]) => SceneNode, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id, type: 'frame', name: 'Row', width: '100%', height: ROW_HEIGHT, minHeight: ROW_HEIGHT, layout: 'horizontal', alignItems: 'center',
    gap: SPACE.md, padding: [0, SPACE.md], borderBottom: { width: 1, color: COLOR.border }, ...extra,
    children: COLUMNS.map((col) => {
      const cell = cells(col);
      if (cell.type === 'text') return { ...cell, width: col.width, ...(col.end ? { textAlign: 'right' as const } : {}) };
      return { ...cell, width: ACTIONS_WIDTH, minWidth: ACTIONS_WIDTH };
    }),
  };
}

/** The header row: column names in full (a header is never cut), so it has
 * no fixed height: 32 at rest, taller when a long name wraps. */
function headerRow(id: string): SceneNode {
  // minWidth 0 lets a long unbroken name break inside its column.
  const row = tableRow(id, (col) => (col.key === 'actions'
    ? { id: `${id}-${col.key}`, type: 'frame', name: 'Actions' }
    : { id: `${id}-${col.key}-text`, type: 'text', content: col.label, fontSize: TYPE.caption, fontWeight: 600, color: COLOR.textSecondary, minWidth: 0 }), { name: 'Header' });
  delete row.height;
  return row;
}

function bodyRow(id: string, last = false): SceneNode {
  return tableRow(id, (col) => {
    const cid = `${id}-${col.key}-cell`;
    if (col.key === 'actions') return iconButton(`${id}-actions`, 'ellipsis', 'Row actions');
    if (col.key === 'amount') return cut(cid, 'Amount — TBD', { tabularNums: true });
    if (col.key === 'name') return cut(cid, 'Item name', { fontWeight: 500 });
    return cut(cid, col.key === 'status' ? 'Status' : 'Date', { color: COLOR.textSecondary });
  }, last ? { borderBottom: undefined } : {});
}

function skeletonRow(id: string, last = false): SceneNode {
  const bar: Record<string, string> = { name: '60%', status: '50%', updated: '55%', amount: '45%', actions: '100%' };
  return {
    id, type: 'frame', name: 'Skeleton row', width: '100%', height: ROW_HEIGHT, minHeight: ROW_HEIGHT, layout: 'horizontal', alignItems: 'center',
    gap: SPACE.md, padding: [0, SPACE.md], ...(last ? {} : { borderBottom: { width: 1, color: COLOR.border } }),
    children: COLUMNS.map((col) => ({
      id: `${id}-${col.key}`, type: 'frame' as const, width: col.width, minWidth: 0, ...(col.end ? { alignItems: 'end' as const } : {}),
      children: [{ id: `${id}-${col.key}-bar`, type: 'skeleton' as const, width: bar[col.key], height: 12, cornerRadius: RADIUS.sm }],
    })),
  };
}

/** The table's toolbar: search, a filter, 32 tall like the rows. */
function tableToolbar(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Toolbar', width: '100%', height: ROW_HEIGHT, minHeight: ROW_HEIGHT, layout: 'horizontal', alignItems: 'center',
    justifyContent: 'space-between', gap: SPACE.sm,
    children: [
      // A text-input never shrinks: its 240px slot does, so a narrow pane
      // keeps the filter in view.
      {
        id: `${id}-search-slot`, type: 'frame', name: 'Search', width: 240, minWidth: 0,
        children: [{ id: `${id}-search`, type: 'text-input', placeholder: 'Search', icon: 'search', size: 'sm', width: '100%' }],
      },
      secondary(`${id}-filter`, 'Filter', 'list-filter'),
    ],
  };
}

/** A bordered table: header row over body rows. It never clips (a frame with
 * `overflow` may shrink below its rows inside a scrolling pane), so the header
 * carries no fill of its own to poke past the rounded corners. */
function appTable(id: string, rows: SceneNode[]): SceneNode {
  return {
    id, type: 'frame', name: 'Table', width: '100%', layout: 'vertical',
    cornerRadius: RADIUS.sm, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [headerRow(`${id}-header`), ...rows],
  };
}

function pager(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Pagination', width: '100%', height: ROW_HEIGHT, minHeight: ROW_HEIGHT, layout: 'horizontal',
    alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm,
    children: [
      cut(`${id}-count`, 'Row count — TBD', { fontSize: TYPE.caption, color: COLOR.textSecondary, tabularNums: true }),
      {
        id: `${id}-pages`, type: 'frame', name: 'Pager', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
        children: [iconButton(`${id}-prev`, 'chevron-left', 'Previous page'), iconButton(`${id}-next`, 'chevron-right', 'Next page')],
      },
    ],
  };
}

export const dataTableApp: Structure = {
  name: 'data-table-app',
  kind: 'component',
  anatomy: 'data-table',
  surface: 'desktop-app',
  description: 'The desktop-app data table on the density ladder: a 32px toolbar (search field, filter), a 32px header row over 32px body rows (name, status, date, a right-aligned amount, an icon-only row-actions button under a blank header), and a 32px pager. Stamp it into a pane at least 480px wide (a content, work or detail pane), not a 300px side panel: narrower, its column names wrap. Copy rows with batch_design C ops to extend. Its loading state is skeleton-table-app.',
  nodes: [{
    id: 'dta', type: 'frame', name: 'Data table', width: '100%', layout: 'vertical', gap: SPACE.sm,
    children: [
      tableToolbar('dta-toolbar'),
      appTable('dta-table', [bodyRow('dta-r1'), bodyRow('dta-r2'), bodyRow('dta-r3', true)]),
      pager('dta-pager'),
    ],
  }],
};

export const skeletonTableApp: Structure = {
  name: 'skeleton-table-app',
  kind: 'component',
  anatomy: 'skeleton-table',
  surface: 'desktop-app',
  description: 'Loading state for data-table-app: the same 32px header row over skeleton rows of the same height and columns, so the loaded table lands without a layout shift.',
  nodes: [{
    id: 'ska', type: 'frame', name: 'Skeleton table', width: '100%', layout: 'vertical', gap: SPACE.sm,
    children: [appTable('ska-table', [skeletonRow('ska-r1'), skeletonRow('ska-r2'), skeletonRow('ska-r3', true)])],
  }],
};

// ── split-workbench-app ─────────────────────────────────────────────────────

const NAV: Array<[string, string]> = [
  ['Overview', 'layout-dashboard'], ['Projects', 'folder'], ['Members', 'users'], ['Reports', 'chart-column'],
];
const MORE: Array<[string, string]> = [['Settings', 'settings']];

function propertyText(id: string, label: string): SceneNode {
  return { id, type: 'property-row', label, children: [cut(`${id}-value`, 'Value — TBD')] };
}

export const splitWorkbenchApp: Structure = {
  name: 'split-workbench-app',
  anatomy: 'split-workbench',
  surface: 'desktop-app',
  description: 'The desktop-app shell: a sidebar of nav-items beside a header (title, actions, a pane toggle as an icon-only button) over a work area and a right detail panel of property rows. Every pane scrolls on its own; the window never does.',
  axes: { heroTreatment: 'split', density: 'dense', rhythm: 'asymmetric', alignment: 'split' },
  root: APP_ROOT,
  nodes: [shell('swa-shell', [
    sidebar('swa-sidebar', NAV, MORE),
    vDivider('swa-div-1'),
    main('swa-main', [
      header('swa-header', 'Workspace', [
        secondary('swa-secondary', 'Secondary'),
        primary('swa-primary', 'Primary action'),
        iconButton('swa-toggle', 'panel-right', 'Toggle panel'),
      ]),
    ], [
      pane('swa-work', 'Work area', [{
        id: 'swa-canvas', type: 'frame', name: 'Work surface', width: '100%', height: '100%', layout: 'vertical',
        alignItems: 'center', justifyContent: 'center', cornerRadius: RADIUS.md,
        fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
        children: [{ id: 'swa-canvas-label', type: 'text', content: 'Work area', fontSize: TYPE.body, color: COLOR.textSecondary }],
      }]),
      vDivider('swa-div-2'),
      pane('swa-panel', 'Detail panel', [
        sectionTitle('swa-panel-title', 'Details'),
        {
          id: 'swa-props', type: 'frame', name: 'Properties', width: '100%', layout: 'vertical', gap: SPACE.xs,
          children: [propertyText('swa-prop-1', 'Owner'), propertyText('swa-prop-2', 'Status'), propertyText('swa-prop-3', 'Updated')],
        },
      ], { width: 300, minWidth: 300, fill: COLOR.bgSurface }),
    ]),
  ])],
};

// ── list-detail-app ─────────────────────────────────────────────────────────

function listItem(id: string): SceneNode {
  return {
    id, type: 'list-row', title: 'Item title', subtitle: 'Supporting detail',
    trailing: { text: 'Meta' },
  };
}

export const listDetailApp: Structure = {
  name: 'list-detail-app',
  anatomy: 'list-detail',
  surface: 'desktop-app',
  description: 'Navigation, list and detail panes side by side: a sidebar of nav-items, a searchable list of rows, and a detail pane holding a designed "nothing selected" placeholder until a row is chosen. Each pane scrolls on its own.',
  axes: { heroTreatment: 'split', density: 'dense', rhythm: 'asymmetric', alignment: 'left' },
  root: APP_ROOT,
  nodes: [shell('lda-shell', [
    sidebar('lda-sidebar', [['Inbox', 'inbox'], ['Assigned', 'user'], ['Archive', 'archive']], MORE),
    vDivider('lda-div-1'),
    pane('lda-list', 'List', [
      {
        id: 'lda-list-head', type: 'frame', name: 'List header', width: '100%', layout: 'vertical', gap: SPACE.sm,
        children: [
          sectionTitle('lda-list-title', 'Inbox'),
          { id: 'lda-search', type: 'text-input', placeholder: 'Search', icon: 'search', size: 'sm', width: '100%' },
        ],
      },
      {
        id: 'lda-rows', type: 'frame', name: 'Rows', width: '100%', layout: 'vertical',
        children: [listItem('lda-row-1'), listItem('lda-row-2'), listItem('lda-row-3'), listItem('lda-row-4')],
      },
    ], { width: 360, minWidth: 360, gap: SPACE.sm, padding: SPACE.sm }),
    vDivider('lda-div-2'),
    pane('lda-detail', 'Detail', [{
      id: 'lda-empty', type: 'frame', name: 'Nothing selected', width: '100%', height: '100%', layout: 'vertical',
      alignItems: 'center', justifyContent: 'center', gap: SPACE.sm,
      children: [
        { id: 'lda-empty-icon', type: 'icon', icon: 'mouse-pointer-click', iconSize: 32, iconColor: COLOR.textSecondary },
        { id: 'lda-empty-title', type: 'text', content: 'Nothing selected', fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary, textAlign: 'center' },
        { id: 'lda-empty-body', type: 'text', content: 'Choose an item from the list to see its details here.', fontSize: TYPE.body, color: COLOR.textSecondary, textAlign: 'center', maxWidth: 360 },
      ],
    }]),
  ])],
};

// ── editor-inspector-app ────────────────────────────────────────────────────

export const editorInspectorApp: Structure = {
  name: 'editor-inspector-app',
  anatomy: 'editor-inspector',
  surface: 'desktop-app',
  description: 'An editor: a header (a breadcrumb of links, the document title, actions) over a work area with a tool strip of icon-only buttons, beside a 70/30 inspector of tabs and property rows (text inputs, a select, a toggle, a button). Each pane scrolls on its own.',
  axes: { heroTreatment: 'split', density: 'dense', rhythm: 'asymmetric', alignment: 'split' },
  root: APP_ROOT,
  nodes: [shell('eia-shell', [
    main('eia-main', [{
      id: 'eia-header', type: 'frame', name: 'Header', width: '100%', height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT,
      layout: 'horizontal', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md,
      padding: [0, SPACE.md], borderBottom: { width: 1, color: COLOR.border },
      children: [
        {
          id: 'eia-crumbs', type: 'frame', name: 'Breadcrumb', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs, minWidth: 0,
          children: [
            // The slot shrinks (a link never does), so a long parent name truncates.
            { id: 'eia-crumb-slot', type: 'frame', name: 'Parent', minWidth: 0, children: [{ id: 'eia-crumb-parent', type: 'link', label: 'Documents' }] },
            { id: 'eia-crumb-sep', type: 'icon', icon: 'chevron-right', iconSize: 14, iconColor: COLOR.textSecondary },
            { id: 'eia-title', type: 'text', content: 'Document title', fontSize: TYPE.label, fontWeight: 600, color: COLOR.textPrimary, textOverflow: 'ellipsis', title: 'Document title', minWidth: 0 },
          ],
        },
        {
          id: 'eia-actions', type: 'frame', name: 'Actions', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs, minWidth: 'max-content',
          children: [secondary('eia-share', 'Share'), primary('eia-publish', 'Publish')],
        },
      ],
    }], [
      pane('eia-work', 'Work area', [
        {
          id: 'eia-tools', type: 'frame', name: 'Tools', width: 'fit-content', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
          padding: SPACE.xs2, cornerRadius: RADIUS.sm, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
          children: [
            iconButton('eia-tool-select', 'mouse-pointer-2', 'Select'),
            iconButton('eia-tool-pan', 'hand', 'Pan'),
            iconButton('eia-tool-zoom-in', 'zoom-in', 'Zoom in'),
            iconButton('eia-tool-zoom-out', 'zoom-out', 'Zoom out'),
          ],
        },
        {
          id: 'eia-canvas', type: 'frame', name: 'Work surface', width: '100%', height: '100%', layout: 'vertical',
          alignItems: 'center', justifyContent: 'center', cornerRadius: RADIUS.md,
          fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
          children: [{ id: 'eia-canvas-label', type: 'text', content: 'Work area', fontSize: TYPE.body, color: COLOR.textSecondary }],
        },
      ], { width: '70%', gap: SPACE.sm }),
      vDivider('eia-div'),
      pane('eia-inspector', 'Inspector', [
        { id: 'eia-tabs', type: 'tabs', items: [{ label: 'Design', active: true }, { label: 'Layout' }, { label: 'Notes' }], size: 'sm' },
        sectionTitle('eia-props-title', 'Properties'),
        {
          id: 'eia-props', type: 'frame', name: 'Properties', width: '100%', layout: 'vertical', gap: SPACE.xs,
          children: [
            { id: 'eia-prop-name', type: 'property-row', label: 'Name', children: [{ id: 'eia-prop-name-input', type: 'text-input', value: 'Value', size: 'sm', width: '100%' }] },
            { id: 'eia-prop-width', type: 'property-row', label: 'Width', children: [{ id: 'eia-prop-width-input', type: 'text-input', value: 'Value', size: 'sm', width: '100%' }] },
            { id: 'eia-prop-mode', type: 'property-row', label: 'Mode', children: [{ id: 'eia-prop-mode-select', type: 'select', value: 'Option', width: '100%' }] },
            { id: 'eia-prop-visible', type: 'property-row', label: 'Visible', children: [{ id: 'eia-prop-visible-toggle', type: 'toggle', checked: true }] },
            { id: 'eia-prop-source', type: 'property-row', label: 'Source', children: [{ ...secondary('eia-prop-source-button', 'Choose'), maxWidth: '100%' }] },
          ],
        },
      ], { width: '30%', minWidth: 280, fill: COLOR.bgSurface, gap: SPACE.sm, padding: SPACE.md }),
    ]),
  ])],
};

// ── browser-app ─────────────────────────────────────────────────────────────

function itemCard(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Item card', width: '100%', minWidth: 0, layout: 'vertical', overflow: 'hidden',
    cornerRadius: RADIUS.md, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, shadow: ELEV.flat,
    children: [
      { id: `${id}-media`, type: 'frame', name: 'Preview', width: '100%', height: 140, fill: COLOR.bgElevated },
      {
        id: `${id}-copy`, type: 'frame', name: 'Copy', width: '100%', layout: 'vertical', gap: SPACE.xxs, padding: SPACE.sm,
        children: [
          { id: `${id}-title`, type: 'link', label: 'Item title' },
          cut(`${id}-meta`, 'Meta — TBD', { fontSize: TYPE.caption, color: COLOR.textSecondary }),
        ],
      },
    ],
  };
}

export const browserApp: Structure = {
  name: 'browser-app',
  anatomy: 'browser',
  surface: 'desktop-app',
  description: 'A browser of items: a sidebar of nav-items, a header with the one primary action, a filter bar (search field, tabs) and an adaptive grid of item cards (minimum column width 240) whose titles are links. The grid pane scrolls on its own.',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'left' },
  root: APP_ROOT,
  nodes: [shell('bra-shell', [
    sidebar('bra-sidebar', [['All items', 'layout-grid'], ['Recent', 'clock'], ['Shared', 'users']], MORE),
    vDivider('bra-div'),
    main('bra-main', [
      header('bra-header', 'Items', [primary('bra-new', 'New item')]),
      {
        id: 'bra-filters', type: 'frame', name: 'Filter bar', width: '100%', height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT,
        layout: 'horizontal', alignItems: 'center', gap: SPACE.md, padding: [0, SPACE.md], borderBottom: { width: 1, color: COLOR.border },
        children: [
          { id: 'bra-search', type: 'text-input', placeholder: 'Search', icon: 'search', size: 'sm', width: 280 },
          {
            // The slot shrinks (a tablist never does), so long labels truncate inside it.
            id: 'bra-tabs-slot', type: 'frame', name: 'Tabs', width: '100%', minWidth: 0,
            children: [{ id: 'bra-tabs', type: 'tabs', variant: 'contained', size: 'sm', items: [{ label: 'All', active: true }, { label: 'Starred' }, { label: 'Archived' }] }],
          },
        ],
      },
    ], [
      pane('bra-grid-pane', 'Items', [{
        id: 'bra-grid', type: 'frame', name: 'Item grid', width: '100%', layout: 'grid',
        gridColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: SPACE.md, rowGap: SPACE.md,
        children: [1, 2, 3, 4, 5, 6].map((i) => itemCard(`bra-card-${i}`)),
      }]),
    ]),
  ])],
};

// ── dashboard-app ───────────────────────────────────────────────────────────

function statTile(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Stat', width: '100%', minWidth: 0, layout: 'vertical', gap: SPACE.xs,
    padding: SPACE.md, cornerRadius: RADIUS.md, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      cut(`${id}-label`, 'Metric label', { fontSize: TYPE.caption, color: COLOR.textSecondary }),
      cut(`${id}-value`, 'Value — TBD', { fontSize: TYPE.textLg, fontWeight: 600, tabularNums: true }),
      cut(`${id}-delta`, 'Change — TBD', { fontSize: TYPE.caption, color: COLOR.textSecondary }),
    ],
  };
}

export const dashboardApp: Structure = {
  name: 'dashboard-app',
  anatomy: 'dashboard',
  surface: 'desktop-app',
  description: 'The desktop-app dashboard: a sidebar of nav-items, a header with actions, and a scrolling content pane of a four-up stat row, a trend chart panel and a recent-items table on the 32px ladder. No fabricated numbers.',
  axes: { heroTreatment: 'stat-led', density: 'dense', rhythm: 'uniform', alignment: 'left' },
  root: APP_ROOT,
  nodes: [shell('dba-shell', [
    sidebar('dba-sidebar', NAV, MORE),
    vDivider('dba-div'),
    main('dba-main', [
      header('dba-header', 'Overview', [secondary('dba-export', 'Export', 'download')]),
    ], [
      pane('dba-content', 'Content', [
        {
          id: 'dba-stats', type: 'frame', name: 'Stat row', width: '100%', layout: 'grid', gridColumns: 4, gap: SPACE.md,
          children: [statTile('dba-stat-1'), statTile('dba-stat-2'), statTile('dba-stat-3'), statTile('dba-stat-4')],
        },
        {
          id: 'dba-chart', type: 'frame', name: 'Chart panel', width: '100%', layout: 'vertical', gap: SPACE.sm,
          padding: SPACE.md, cornerRadius: RADIUS.md, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
          children: [
            sectionTitle('dba-chart-title', 'Trend'),
            {
              id: 'dba-chart-area', type: 'chart', name: 'Chart area', width: '100%', height: 220,
              kind: 'line', curve: 'smooth', gridlines: 4,
              series: [{ data: [12, 18, 15, 24, 22, 30, 34], stroke: COLOR.accent, strokeWidth: 2, area: true }],
              xLabels: ['Label', '', '', '', '', '', 'Label'],
              yLabels: ['Label', '', '', '', 'Label'],
            },
          ],
        },
        sectionTitle('dba-recent-title', 'Recent'),
        appTable('dba-table', [bodyRow('dba-r1'), bodyRow('dba-r2'), bodyRow('dba-r3', true)]),
      ]),
    ]),
  ])],
};

// ── settings-app ────────────────────────────────────────────────────────────

function settingsGroup(id: string, title: string, rows: SceneNode[]): SceneNode {
  return {
    id, type: 'frame', name: title, width: '100%', layout: 'vertical', gap: SPACE.sm,
    children: [
      sectionTitle(`${id}-title`, title),
      {
        id: `${id}-rows`, type: 'frame', name: 'Rows', width: '100%', layout: 'vertical', gap: SPACE.xs, padding: [SPACE.sm, SPACE.md],
        cornerRadius: RADIUS.md, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
        children: rows,
      },
    ],
  };
}

const settingRow = (id: string, label: string, control: SceneNode): SceneNode =>
  ({ id, type: 'property-row', label, labelWidth: 200, children: [control] });

export const settingsApp: Structure = {
  name: 'settings-app',
  anatomy: 'settings',
  surface: 'desktop-app',
  description: 'Desktop-app settings: a sidebar of setting sections as nav-items beside a scrolling column of grouped property rows (text inputs, a select, toggles), a danger zone with a destructive action set apart, and Cancel / Save at the foot.',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'left' },
  root: APP_ROOT,
  nodes: [shell('sta-shell', [
    sidebar('sta-sidebar', [['General', 'sliders-horizontal'], ['Notifications', 'bell'], ['Members', 'users'], ['Billing', 'credit-card']]),
    vDivider('sta-div'),
    pane('sta-content', 'Content', [{
      id: 'sta-col', type: 'frame', name: 'Column', width: '100%', maxWidth: 720, layout: 'vertical', gap: SPACE.lg,
      children: [
        { id: 'sta-title', type: 'text', content: 'General', fontSize: TYPE.textLg, fontWeight: 600, color: COLOR.textPrimary },
        settingsGroup('sta-profile', 'Workspace', [
          settingRow('sta-name', 'Workspace name', { id: 'sta-name-input', type: 'text-input', value: 'Value', size: 'sm', width: '100%' }),
          settingRow('sta-url', 'Address', { id: 'sta-url-input', type: 'text-input', value: 'Value', size: 'sm', width: '100%' }),
          settingRow('sta-lang', 'Language', { id: 'sta-lang-select', type: 'select', value: 'Option', width: '100%' }),
        ]),
        settingsGroup('sta-notify', 'Notifications', [
          settingRow('sta-email', 'Email updates', { id: 'sta-email-toggle', type: 'toggle', checked: true }),
          settingRow('sta-digest', 'Weekly digest', { id: 'sta-digest-toggle', type: 'toggle' }),
        ]),
        {
          id: 'sta-danger', type: 'frame', name: 'Danger zone', width: '100%', layout: 'horizontal', alignItems: 'center',
          justifyContent: 'space-between', gap: SPACE.md, padding: SPACE.md, cornerRadius: RADIUS.md,
          fill: COLOR.bgSurface, stroke: '$danger', strokeWidth: 1,
          children: [
            {
              id: 'sta-danger-copy', type: 'frame', name: 'Copy', layout: 'vertical', gap: SPACE.xxs, minWidth: 0,
              children: [
                { id: 'sta-danger-title', type: 'text', content: 'Delete workspace', fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary },
                { id: 'sta-danger-desc', type: 'text', content: 'Consequence — to confirm', fontSize: TYPE.body, color: COLOR.textSecondary },
              ],
            },
            { id: 'sta-delete', type: 'button', label: 'Delete', variant: 'destructive', size: 'sm' },
          ],
        },
        {
          id: 'sta-footer', type: 'frame', name: 'Footer actions', width: '100%', layout: 'horizontal', justifyContent: 'end',
          alignItems: 'center', gap: SPACE.xs, wrap: true,
          children: [secondary('sta-cancel', 'Cancel'), primary('sta-save', 'Save changes')],
        },
      ],
    }]),
  ])],
};

/** Every desktop-app structure, in registry order. */
export const DESKTOP_APP_STRUCTURES: Array<[string, Structure]> = [
  ['split-workbench-app', splitWorkbenchApp],
  ['list-detail-app', listDetailApp],
  ['editor-inspector-app', editorInspectorApp],
  ['browser-app', browserApp],
  ['dashboard-app', dashboardApp],
  ['settings-app', settingsApp],
  ['data-table-app', dataTableApp],
  ['skeleton-table-app', skeletonTableApp],
];
