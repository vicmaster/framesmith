import type { BuildLogEntry, Canvas, SceneNode, Structure, StructureAxes } from './types.js';

// Phase 11 — layout scaffold library. A Structure is a named page shape: a
// partial scene tree of *labeled placeholder* children (C8 — never fabricated
// data) plus taxonomy tags so "differs from the last canvas" is computable.
//
// Theming split (analyze A-P4): geometry (width/gap/padding/cornerRadius/
// fontSize) is LITERAL numbers so a scaffold can never crash the renderer on an
// unthemed canvas; fills/colors/strokes are `$color` token refs so an applied
// preset/design-system themes them. `apply_structure` (T4) seeds neutral
// defaults for any color token still unresolved after inheritance.
//
// Distinct from presets (`src/presets.ts`): presets carry tokens/components,
// structures carry the layout skeleton. `registerStructure` keeps the door open
// for dynamically contributed structures, mirroring `registerPreset`.

/** Standard color tokens these scaffolds reference (the preset vocabulary). */
const COLOR = {
  bgPrimary: '$bg-primary',
  bgSurface: '$bg-surface',
  bgElevated: '$bg-elevated',
  textPrimary: '$text-primary',
  textSecondary: '$text-secondary',
  accent: '$accent',
  border: '$border',
} as const;

/** A labeled placeholder card — a surface with a role label + neutral body. */
function card(
  id: string,
  label: string,
  width: number,
  height: number,
  fill: string,
  body = 'Body copy — to confirm',
): SceneNode {
  return {
    id,
    type: 'frame',
    name: label,
    width,
    height,
    layout: 'vertical',
    justifyContent: 'space-between',
    gap: 16,
    padding: 24,
    cornerRadius: 16,
    fill,
    stroke: COLOR.border,
    strokeWidth: 1,
    children: [
      { id: `${id}-label`, type: 'text', content: label, fontSize: 20, fontWeight: 600, color: COLOR.textPrimary },
      { id: `${id}-body`, type: 'text', content: body, fontSize: 14, color: COLOR.textSecondary, lineHeight: 1.5 },
    ],
  };
}

/** A pill button placeholder. */
function button(id: string, label: string, fill: string, color: string, stroke?: string): SceneNode {
  return {
    id,
    type: 'frame',
    name: label,
    layout: 'horizontal',
    alignItems: 'center',
    justifyContent: 'center',
    padding: [8, 24],
    cornerRadius: 8,
    fill,
    ...(stroke ? { stroke, strokeWidth: 1 } : {}),
    children: [{ id: `${id}-label`, type: 'text', content: label, fontSize: 16, fontWeight: 600, color }],
  };
}

/** A stat block — icon over a big value slot over a label (no fabricated
 * numbers, C8). The icon defaults sensibly; pass one to vary across a row. */
function stat(id: string, icon = 'activity'): SceneNode {
  return {
    id,
    type: 'frame',
    name: 'Stat',
    width: 300,
    layout: 'vertical',
    gap: 8,
    alignItems: 'center',
    padding: 32,
    cornerRadius: 16,
    fill: COLOR.bgSurface,
    stroke: COLOR.border,
    strokeWidth: 1,
    children: [
      { id: `${id}-icon`, type: 'icon', icon, iconSize: 24, iconColor: COLOR.accent },
      { id: `${id}-value`, type: 'text', content: 'Metric — to confirm', fontSize: 28, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center' },
      { id: `${id}-label`, type: 'text', content: 'Stat label', fontSize: 14, color: COLOR.textSecondary, textAlign: 'center' },
    ],
  };
}

/** A sidebar nav row: a leading icon + label. */
function navItem(id: string, label: string, icon = 'circle'): SceneNode {
  return {
    id,
    type: 'frame',
    name: label,
    width: '100%',
    layout: 'horizontal',
    alignItems: 'center',
    gap: 8,
    padding: [8, 16],
    cornerRadius: 8,
    fill: COLOR.bgElevated,
    children: [
      { id: `${id}-icon`, type: 'icon', icon, iconSize: 16, iconColor: COLOR.textSecondary },
      { id: `${id}-label`, type: 'text', content: label, fontSize: 14, color: COLOR.textSecondary },
    ],
  };
}

/** A catalogue card: full-bleed media surface over a padded title/meta block. */
function catItem(id: string): SceneNode {
  return {
    id,
    type: 'frame',
    name: 'Catalogue item',
    width: 368,
    layout: 'vertical',
    cornerRadius: 16,
    overflow: 'hidden',
    fill: COLOR.bgSurface,
    stroke: COLOR.border,
    strokeWidth: 1,
    children: [
      { id: `${id}-media`, type: 'frame', name: 'Media', width: '100%', height: 200, fill: COLOR.bgElevated },
      {
        id: `${id}-content`,
        type: 'frame',
        width: '100%',
        layout: 'vertical',
        gap: 8,
        padding: 16,
        children: [
          { id: `${id}-title`, type: 'text', content: 'Item title', fontSize: 16, fontWeight: 600, color: COLOR.textPrimary },
          { id: `${id}-meta`, type: 'text', content: 'Meta — to confirm', fontSize: 13, color: COLOR.textSecondary },
        ],
      },
    ],
  };
}

/** A labeled form field for page scaffolds: label over an input box. */
function field(id: string, label: string): SceneNode {
  return {
    id, type: 'frame', name: label, width: '100%', layout: 'vertical', gap: 8,
    children: [
      { id: `${id}-label`, type: 'text', content: label, fontSize: 14, fontWeight: 600, color: COLOR.textSecondary },
      { id: `${id}-input`, type: 'frame', name: 'Input', width: '100%', height: 44, cornerRadius: 8, fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1 },
    ],
  };
}

/** A feature row: a check icon + a placeholder feature label. */
function featureRow(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Feature', width: '100%', layout: 'horizontal', gap: 8, alignItems: 'center',
    children: [
      { id: `${id}-icon`, type: 'icon', icon: 'check', iconSize: 16, iconColor: COLOR.accent },
      { id: `${id}-text`, type: 'text', content: 'Feature — to confirm', fontSize: 14, color: COLOR.textSecondary },
    ],
  };
}

/** A pricing tier card: name, price slot, feature list, CTA. No fake prices. */
function tier(id: string, name: string): SceneNode {
  return {
    id, type: 'frame', name, width: 320, layout: 'vertical', gap: 24, padding: 32,
    cornerRadius: 16, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: `${id}-head`, type: 'frame', name: 'Tier head', width: '100%', layout: 'vertical', gap: 8,
        children: [
          { id: `${id}-name`, type: 'text', content: name, fontSize: 16, fontWeight: 600, color: COLOR.textSecondary },
          { id: `${id}-price`, type: 'text', content: 'Price — to confirm', fontSize: 32, fontWeight: 700, color: COLOR.textPrimary },
        ],
      },
      {
        id: `${id}-features`, type: 'frame', name: 'Features', width: '100%', layout: 'vertical', gap: 8,
        children: [featureRow(`${id}-f1`), featureRow(`${id}-f2`), featureRow(`${id}-f3`)],
      },
      {
        id: `${id}-cta`, type: 'frame', name: 'Choose plan', width: '100%', layout: 'horizontal',
        alignItems: 'center', justifyContent: 'center', padding: [8, 24], cornerRadius: 8, fill: COLOR.accent,
        children: [{ id: `${id}-cta-label`, type: 'text', content: 'Choose plan', fontSize: 14, fontWeight: 600, color: COLOR.bgPrimary }],
      },
    ],
  };
}

/** A settings row: label + description on the left, a real toggle on the right. */
function settingsRow(id: string, on: boolean): SceneNode {
  return {
    id, type: 'frame', name: 'Setting', width: '100%', layout: 'horizontal',
    justifyContent: 'space-between', alignItems: 'center', gap: 24, padding: 24,
    children: [
      {
        id: `${id}-text`, type: 'frame', layout: 'vertical', gap: 8,
        children: [
          { id: `${id}-label`, type: 'text', content: 'Setting label', fontSize: 15, fontWeight: 600, color: COLOR.textPrimary },
          { id: `${id}-desc`, type: 'text', content: 'Description — to confirm', fontSize: 13, color: COLOR.textSecondary },
        ],
      },
      { id: `${id}-toggle`, type: 'toggle', checked: on },
    ],
  };
}

// ── marquee-hero ───────────────────────────────────────────────────────────
// Full-bleed centered marquee: oversized headline, one supporting line, dual
// CTA, then a single supporting band. Airy, symmetric, one focal point.
const marqueeHero: Structure = {
  name: 'marquee-hero',
  description:
    'Full-bleed centered marquee: oversized headline, supporting line, and a dual call-to-action over a single accent, then one supporting band. Airy, symmetric, single focal point.',
  axes: { heroTreatment: 'marquee', density: 'airy', rhythm: 'uniform', alignment: 'centered' },
  nodes: [
    {
      id: 'mh-hero',
      type: 'frame',
      name: 'Hero',
      width: '100%',
      layout: 'vertical',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      padding: [64, 48],
      fill: COLOR.bgPrimary,
      children: [
        { id: 'mh-eyebrow', type: 'text', name: 'Eyebrow', content: 'Eyebrow — short label', fontSize: 14, fontWeight: 600, color: COLOR.accent, textAlign: 'center', letterSpacing: 1 },
        { id: 'mh-headline', type: 'text', name: 'Headline', content: 'Headline', fontSize: 56, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center', lineHeight: 1.1, maxWidth: 880 },
        { id: 'mh-subhead', type: 'text', name: 'Subheadline', content: 'Body copy — one or two supporting sentences.', fontSize: 20, fontWeight: 400, color: COLOR.textSecondary, textAlign: 'center', lineHeight: 1.5, maxWidth: 640 },
        {
          id: 'mh-cta',
          type: 'frame',
          name: 'CTA row',
          layout: 'horizontal',
          gap: 16,
          responsive: 'stack',
          alignItems: 'center',
          justifyContent: 'center',
          padding: [16, 0, 0, 0],
          children: [
            button('mh-cta-primary', 'Primary action', COLOR.accent, COLOR.bgPrimary),
            button('mh-cta-secondary', 'Secondary action', COLOR.bgSurface, COLOR.textPrimary, COLOR.border),
          ],
        },
      ],
    },
    {
      id: 'mh-support',
      type: 'frame',
      name: 'Supporting band',
      width: '100%',
      layout: 'vertical',
      alignItems: 'center',
      gap: 8,
      padding: [64, 48],
      fill: COLOR.bgSurface,
      children: [
        { id: 'mh-support-title', type: 'text', content: 'Supporting section', fontSize: 28, fontWeight: 600, color: COLOR.textPrimary, textAlign: 'center' },
        { id: 'mh-support-body', type: 'text', content: 'Body copy — expand on the promise above.', fontSize: 16, color: COLOR.textSecondary, textAlign: 'center', maxWidth: 560, lineHeight: 1.6 },
      ],
    },
  ],
};

// ── bento-grid ───────────────────────────────────────────────────────────
// Compact heading over a dense bento of mixed-size cards. Asymmetric rhythm,
// left-aligned, content-rich — feature overviews or dashboards.
const bentoGrid: Structure = {
  name: 'bento-grid',
  description:
    'Compact left-aligned heading over a dense bento grid of mixed-size cards. Asymmetric rhythm, content-rich — good for feature overviews or dashboards.',
  axes: { heroTreatment: 'none', density: 'dense', rhythm: 'asymmetric', alignment: 'left' },
  nodes: [
    {
      id: 'bn-page',
      type: 'frame',
      name: 'Page',
      width: '100%',
      layout: 'vertical',
      gap: 32,
      padding: [48, 48],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'bn-header',
          type: 'frame',
          name: 'Header',
          layout: 'vertical',
          gap: 8,
          children: [
            { id: 'bn-eyebrow', type: 'text', content: 'Eyebrow — section label', fontSize: 14, fontWeight: 600, color: COLOR.accent, letterSpacing: 1 },
            { id: 'bn-title', type: 'text', content: 'Headline', fontSize: 40, fontWeight: 700, color: COLOR.textPrimary, lineHeight: 1.2 },
          ],
        },
        {
          id: 'bn-grid',
          type: 'frame',
          name: 'Bento grid',
          layout: 'horizontal',
          wrap: true,
          responsive: 'wrap',
          gap: 24,
          children: [
            card('bn-card-1', 'Feature card — primary', 560, 280, COLOR.bgSurface),
            card('bn-card-2', 'Card — supporting', 300, 280, COLOR.bgSurface),
            card('bn-card-3', 'Card — metric', 280, 200, COLOR.bgElevated, 'Metric — to confirm'),
            card('bn-card-4', 'Card — supporting', 280, 200, COLOR.bgSurface),
            card('bn-card-5', 'Card — wide', 580, 200, COLOR.bgSurface),
          ],
        },
      ],
    },
  ],
};

// ── stat-led ───────────────────────────────────────────────────────────────
// Centered hero whose proof is a row of stat blocks. Balanced, uniform rhythm.
const statLed: Structure = {
  name: 'stat-led',
  description:
    'Centered hero backed by a row of stat blocks — leads with proof/metrics rather than a marquee. Balanced density, uniform rhythm. Good for results, impact, or "by the numbers" pages.',
  axes: { heroTreatment: 'stat-led', density: 'balanced', rhythm: 'uniform', alignment: 'centered' },
  nodes: [
    {
      id: 'sl-section',
      type: 'frame',
      name: 'Stat hero',
      width: '100%',
      layout: 'vertical',
      alignItems: 'center',
      gap: 32,
      padding: [64, 48],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'sl-head',
          type: 'frame',
          name: 'Heading',
          width: '100%',
          layout: 'vertical',
          alignItems: 'center',
          gap: 16,
          children: [
            { id: 'sl-eyebrow', type: 'text', content: 'Eyebrow — short label', fontSize: 14, fontWeight: 600, color: COLOR.accent, textAlign: 'center', letterSpacing: 1 },
            { id: 'sl-headline', type: 'text', content: 'Headline', fontSize: 48, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center', lineHeight: 1.15, maxWidth: 760 },
            { id: 'sl-subhead', type: 'text', content: 'Body copy — one supporting sentence.', fontSize: 18, color: COLOR.textSecondary, textAlign: 'center', maxWidth: 600, lineHeight: 1.5 },
          ],
        },
        {
          id: 'sl-stats',
          type: 'frame',
          name: 'Stat row',
          layout: 'horizontal',
          gap: 24,
          responsive: 'stack',
          justifyContent: 'center',
          children: [stat('sl-stat-1', 'trending-up'), stat('sl-stat-2', 'users'), stat('sl-stat-3', 'activity')],
        },
      ],
    },
  ],
};

// ── editorial-longform ──────────────────────────────────────────────────────
// Narrow reading column: kicker, large title, byline, lead, then sections.
const editorialLongform: Structure = {
  name: 'editorial-longform',
  description:
    'Single narrow reading column — kicker, large title, byline, lead paragraph, then alternating section headings and body copy. Airy, left-aligned, long-form. Good for articles, docs, case studies.',
  axes: { heroTreatment: 'editorial', density: 'airy', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    {
      id: 'ed-page',
      type: 'frame',
      name: 'Page',
      width: '100%',
      layout: 'vertical',
      alignItems: 'center',
      padding: [64, 48],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'ed-col',
          type: 'frame',
          name: 'Reading column',
          width: '100%',
          maxWidth: 720,
          layout: 'vertical',
          gap: 24,
          children: [
            { id: 'ed-kicker', type: 'text', content: 'Eyebrow — category', fontSize: 14, fontWeight: 600, color: COLOR.accent, letterSpacing: 1 },
            { id: 'ed-title', type: 'text', content: 'Headline', fontSize: 44, fontWeight: 700, color: COLOR.textPrimary, lineHeight: 1.2 },
            { id: 'ed-meta', type: 'text', content: 'Byline — author · date', fontSize: 14, color: COLOR.textSecondary },
            { id: 'ed-lead', type: 'text', content: 'Lead paragraph — set up the piece in two or three sentences.', fontSize: 20, color: COLOR.textSecondary, lineHeight: 1.6 },
            { id: 'ed-h2-1', type: 'text', content: 'Section heading', fontSize: 26, fontWeight: 600, color: COLOR.textPrimary, lineHeight: 1.3 },
            { id: 'ed-body-1', type: 'text', content: 'Body copy — paragraph to confirm.', fontSize: 17, color: COLOR.textSecondary, lineHeight: 1.7 },
            { id: 'ed-h2-2', type: 'text', content: 'Section heading', fontSize: 26, fontWeight: 600, color: COLOR.textPrimary, lineHeight: 1.3 },
            { id: 'ed-body-2', type: 'text', content: 'Body copy — paragraph to confirm.', fontSize: 17, color: COLOR.textSecondary, lineHeight: 1.7 },
          ],
        },
      ],
    },
  ],
};

// ── split-workbench ─────────────────────────────────────────────────────────
// App shell: fixed sidebar + filling workspace (toolbar over a work area).
const splitWorkbench: Structure = {
  name: 'split-workbench',
  description:
    'Application shell — a fixed sidebar of nav items beside a workspace (toolbar over a large work area). Dense, asymmetric, split alignment; stacks on mobile. Good for tools, dashboards, editors.',
  axes: { heroTreatment: 'split', density: 'dense', rhythm: 'asymmetric', alignment: 'split' },
  nodes: [
    {
      id: 'sw-shell',
      type: 'frame',
      name: 'Shell',
      width: '100%',
      layout: 'horizontal',
      responsive: 'stack',
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'sw-sidebar',
          type: 'frame',
          name: 'Sidebar',
          width: 280,
          layout: 'vertical',
          gap: 8,
          padding: 24,
          fill: COLOR.bgSurface,
          stroke: COLOR.border,
          strokeWidth: 1,
          children: [
            { id: 'sw-brand', type: 'text', content: 'Brand', fontSize: 16, fontWeight: 700, color: COLOR.textPrimary },
            navItem('sw-nav-1', 'Nav item', 'layout-dashboard'),
            navItem('sw-nav-2', 'Nav item', 'folder'),
            navItem('sw-nav-3', 'Nav item', 'users'),
            navItem('sw-nav-4', 'Nav item', 'settings'),
          ],
        },
        {
          id: 'sw-main',
          type: 'frame',
          name: 'Workspace',
          width: 1000,
          layout: 'vertical',
          gap: 24,
          padding: 24,
          fill: COLOR.bgPrimary,
          children: [
            {
              id: 'sw-toolbar',
              type: 'frame',
              name: 'Toolbar',
              width: '100%',
              layout: 'horizontal',
              justifyContent: 'space-between',
              alignItems: 'center',
              children: [
                { id: 'sw-title', type: 'text', content: 'Headline', fontSize: 28, fontWeight: 700, color: COLOR.textPrimary },
                button('sw-action', 'Primary action', COLOR.accent, COLOR.bgPrimary),
              ],
            },
            {
              id: 'sw-canvas',
              type: 'frame',
              name: 'Work area',
              width: '100%',
              height: 420,
              cornerRadius: 16,
              fill: COLOR.bgSurface,
              stroke: COLOR.border,
              strokeWidth: 1,
              layout: 'vertical',
              alignItems: 'center',
              justifyContent: 'center',
              children: [{ id: 'sw-canvas-label', type: 'text', content: 'Body copy — main work area', fontSize: 16, color: COLOR.textSecondary }],
            },
          ],
        },
      ],
    },
  ],
};

// ── catalogue ────────────────────────────────────────────────────────────────
// Header over a uniform grid of equal media cards. Balanced, uniform rhythm.
const catalogue: Structure = {
  name: 'catalogue',
  description:
    'Header (title + filter) over a uniform grid of equal media cards. Balanced density, uniform rhythm, left-aligned — distinct from bento\'s mixed sizes. Good for products, galleries, listings.',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    {
      id: 'cat-page',
      type: 'frame',
      name: 'Page',
      width: '100%',
      layout: 'vertical',
      gap: 32,
      padding: [48, 48],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'cat-header',
          type: 'frame',
          name: 'Header',
          width: '100%',
          layout: 'horizontal',
          justifyContent: 'space-between',
          alignItems: 'center',
          responsive: 'stack',
          children: [
            { id: 'cat-title', type: 'text', content: 'Headline', fontSize: 32, fontWeight: 700, color: COLOR.textPrimary },
            { id: 'cat-filter', type: 'text', content: 'Filter — options', fontSize: 16, color: COLOR.textSecondary },
          ],
        },
        {
          id: 'cat-grid',
          type: 'frame',
          name: 'Catalogue grid',
          width: '100%',
          layout: 'horizontal',
          wrap: true,
          responsive: 'wrap',
          gap: 24,
          children: [catItem('cat-1'), catItem('cat-2'), catItem('cat-3'), catItem('cat-4'), catItem('cat-5'), catItem('cat-6')],
        },
      ],
    },
  ],
};

// ── dashboard (Phase 20) ─────────────────────────────────────────────────────
// Application home: fixed sidebar, a topbar with the primary action, a row of
// stat blocks, then a chart area beside a recent-activity panel. Dense, split,
// uniform stat rhythm. The workhorse first screen of most tools.
const dashboard: Structure = {
  name: 'dashboard',
  description:
    'Application dashboard — sidebar nav beside a main column: topbar with primary action, a row of stat blocks, then a chart area next to a recent-activity panel. Dense and split; stacks on mobile. The default first screen for tools and admin apps.',
  axes: { heroTreatment: 'none', density: 'dense', rhythm: 'uniform', alignment: 'split' },
  nodes: [
    {
      id: 'db-shell', type: 'frame', name: 'Shell', width: '100%', layout: 'horizontal',
      responsive: 'stack', fill: COLOR.bgPrimary,
      children: [
        {
          id: 'db-sidebar', type: 'frame', name: 'Sidebar', width: 240, layout: 'vertical',
          gap: 8, padding: 24, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
          children: [
            { id: 'db-brand', type: 'text', content: 'Brand', fontSize: 16, fontWeight: 700, color: COLOR.textPrimary },
            navItem('db-nav-1', 'Overview', 'layout-dashboard'),
            navItem('db-nav-2', 'Nav item', 'users'),
            navItem('db-nav-3', 'Nav item', 'folder'),
            navItem('db-nav-4', 'Nav item', 'settings'),
          ],
        },
        {
          id: 'db-main', type: 'frame', name: 'Main', width: 1160, layout: 'vertical',
          gap: 24, padding: 24, fill: COLOR.bgPrimary,
          children: [
            {
              id: 'db-topbar', type: 'frame', name: 'Topbar', width: '100%', layout: 'horizontal',
              justifyContent: 'space-between', alignItems: 'center',
              children: [
                { id: 'db-title', type: 'text', content: 'Dashboard', fontSize: 28, fontWeight: 700, color: COLOR.textPrimary },
                button('db-action', 'Primary action', COLOR.accent, COLOR.bgPrimary),
              ],
            },
            {
              id: 'db-stats', type: 'frame', name: 'Stat row', width: '100%', layout: 'horizontal',
              gap: 24, responsive: 'wrap', wrap: true,
              children: [stat('db-stat-1', 'trending-up'), stat('db-stat-2', 'users'), stat('db-stat-3', 'activity')],
            },
            {
              id: 'db-content', type: 'frame', name: 'Content', width: '100%', layout: 'horizontal',
              gap: 24, responsive: 'stack',
              children: [
                {
                  id: 'db-chart', type: 'frame', name: 'Chart panel', width: 720, layout: 'vertical',
                  gap: 16, padding: 24, cornerRadius: 16, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
                  children: [
                    { id: 'db-chart-title', type: 'text', content: 'Overview', fontSize: 16, fontWeight: 600, color: COLOR.textPrimary },
                    {
                      id: 'db-chart-area', type: 'frame', name: 'Chart area', width: '100%', height: 224,
                      cornerRadius: 8, fill: COLOR.bgElevated, layout: 'vertical', alignItems: 'center', justifyContent: 'center',
                      children: [{ id: 'db-chart-label', type: 'text', content: 'Chart — placeholder', fontSize: 14, color: COLOR.textSecondary }],
                    },
                  ],
                },
                {
                  id: 'db-side', type: 'frame', name: 'Activity panel', width: 352, layout: 'vertical',
                  gap: 16, padding: 24, cornerRadius: 16, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
                  children: [
                    { id: 'db-side-title', type: 'text', content: 'Recent activity', fontSize: 16, fontWeight: 600, color: COLOR.textPrimary },
                    { id: 'db-act-1', type: 'text', content: 'Activity item — to confirm', fontSize: 14, color: COLOR.textSecondary, lineHeight: 1.5 },
                    { id: 'db-act-2', type: 'text', content: 'Activity item — to confirm', fontSize: 14, color: COLOR.textSecondary, lineHeight: 1.5 },
                    { id: 'db-act-3', type: 'text', content: 'Activity item — to confirm', fontSize: 14, color: COLOR.textSecondary, lineHeight: 1.5 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ── auth (Phase 20) ───────────────────────────────────────────────────────
// Centered sign-in card: title, two fields, full-width submit, secondary link.
const auth: Structure = {
  name: 'auth',
  description:
    'Centered authentication card — title + supporting line, two form fields, a full-width submit, and a secondary link. The sign-in / sign-up shape. Centered on the page.',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'centered' },
  nodes: [
    {
      id: 'au-page', type: 'frame', name: 'Page', width: '100%', layout: 'vertical',
      alignItems: 'center', justifyContent: 'center', padding: 48, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'au-card', type: 'frame', name: 'Card', width: 400, layout: 'vertical', gap: 24,
          padding: 32, cornerRadius: 16, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
          children: [
            {
              id: 'au-head', type: 'frame', width: '100%', layout: 'vertical', gap: 8,
              children: [
                { id: 'au-title', type: 'text', content: 'Sign in', fontSize: 28, fontWeight: 700, color: COLOR.textPrimary },
                { id: 'au-sub', type: 'text', content: 'Body copy — one supporting line.', fontSize: 14, color: COLOR.textSecondary, lineHeight: 1.5 },
              ],
            },
            {
              id: 'au-fields', type: 'frame', width: '100%', layout: 'vertical', gap: 16,
              children: [field('au-email', 'Email'), field('au-password', 'Password')],
            },
            {
              id: 'au-submit', type: 'frame', name: 'Submit', width: '100%', layout: 'horizontal',
              alignItems: 'center', justifyContent: 'center', padding: [8, 24], cornerRadius: 8, fill: COLOR.accent,
              children: [{ id: 'au-submit-label', type: 'text', content: 'Continue', fontSize: 16, fontWeight: 600, color: COLOR.bgPrimary }],
            },
            { id: 'au-alt', type: 'text', content: 'Secondary link', fontSize: 14, fontWeight: 500, color: COLOR.accent, textAlign: 'center' },
          ],
        },
      ],
    },
  ],
};

// ── pricing (Phase 20) ────────────────────────────────────────────────────
// Centered heading over a row of equal pricing tiers. No fabricated prices.
const pricing: Structure = {
  name: 'pricing',
  description:
    'Centered heading over a row of equal pricing tiers — each with a name, price slot, feature list, and CTA. Balanced, uniform rhythm. Prices are placeholders (no fabricated numbers).',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'centered' },
  nodes: [
    {
      id: 'pr-page', type: 'frame', name: 'Page', width: '100%', layout: 'vertical',
      alignItems: 'center', gap: 48, padding: 48, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'pr-head', type: 'frame', name: 'Header', width: '100%', layout: 'vertical', gap: 16, alignItems: 'center',
          children: [
            { id: 'pr-title', type: 'text', content: 'Pricing', fontSize: 40, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center', lineHeight: 1.2 },
            { id: 'pr-sub', type: 'text', content: 'Body copy — one supporting line about the plans.', fontSize: 16, color: COLOR.textSecondary, textAlign: 'center', lineHeight: 1.5, maxWidth: 560 },
          ],
        },
        {
          id: 'pr-tiers', type: 'frame', name: 'Tiers', layout: 'horizontal', gap: 24, wrap: true, responsive: 'wrap',
          children: [tier('pr-tier-1', 'Starter'), tier('pr-tier-2', 'Pro'), tier('pr-tier-3', 'Scale')],
        },
      ],
    },
  ],
};

// ── settings (Phase 20) ───────────────────────────────────────────────────
// A centered settings column: heading over a card of toggle rows with dividers.
const settings: Structure = {
  name: 'settings',
  description:
    'A settings screen — heading over a single card of preference rows (label + description + a real toggle), split by hairline dividers. The workhorse of preference / account screens.',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    {
      id: 'st-page', type: 'frame', name: 'Page', width: '100%', layout: 'vertical',
      alignItems: 'center', gap: 24, padding: 48, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'st-col', type: 'frame', name: 'Column', width: 720, layout: 'vertical', gap: 24,
          children: [
            { id: 'st-title', type: 'text', content: 'Settings', fontSize: 28, fontWeight: 700, color: COLOR.textPrimary },
            {
              id: 'st-card', type: 'frame', name: 'Card', width: '100%', layout: 'vertical',
              cornerRadius: 16, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
              children: [
                settingsRow('st-row-1', true),
                { id: 'st-div-1', type: 'frame', width: '100%', height: 1, fill: COLOR.border },
                settingsRow('st-row-2', false),
                { id: 'st-div-2', type: 'frame', width: '100%', height: 1, fill: COLOR.border },
                settingsRow('st-row-3', true),
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ── onboarding (Phase 20) ─────────────────────────────────────────────────
// A centered empty / first-run state: icon, heading, body, one primary action.
const onboarding: Structure = {
  name: 'onboarding',
  description:
    'A centered empty / first-run state — a glyph tile, heading, a line of body copy, and one primary action. For empty lists, first-run, or zero-data screens.',
  axes: { heroTreatment: 'none', density: 'airy', rhythm: 'uniform', alignment: 'centered' },
  nodes: [
    {
      id: 'ob-page', type: 'frame', name: 'Page', width: '100%', layout: 'vertical',
      alignItems: 'center', justifyContent: 'center', gap: 16, padding: 48, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'ob-glyph', type: 'frame', name: 'Glyph', width: 64, height: 64, cornerRadius: 16,
          fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1,
          layout: 'vertical', alignItems: 'center', justifyContent: 'center',
          children: [{ id: 'ob-glyph-icon', type: 'icon', icon: 'sparkles', iconSize: 28, iconColor: COLOR.accent }],
        },
        { id: 'ob-title', type: 'text', content: 'Get started', fontSize: 28, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center' },
        { id: 'ob-body', type: 'text', content: 'Body copy — explain the empty state and the next step in a sentence.', fontSize: 16, color: COLOR.textSecondary, textAlign: 'center', lineHeight: 1.5, maxWidth: 420 },
        {
          id: 'ob-cta', type: 'frame', name: 'Primary action', layout: 'horizontal', alignItems: 'center',
          justifyContent: 'center', padding: [8, 24], cornerRadius: 8, fill: COLOR.accent,
          children: [{ id: 'ob-cta-label', type: 'text', content: 'Primary action', fontSize: 16, fontWeight: 600, color: COLOR.bgPrimary }],
        },
      ],
    },
  ],
};

// ── component structures (Phase 16 slice D) ────────────────────────────────
// Reusable fragments stamped under any target node via apply_structure
// targetId, repeatably — template ids get re-keyed per stamp. Same theming
// split as pages: literal geometry, $color tokens. Placeholder copy only (C8).

const formField: Structure = {
  name: 'form-field',
  kind: 'component',
  description: 'A labeled form field: label, input box, and help text. Stamp once per field; set the label/help via the returned id map.',
  nodes: [{
    id: 'ff', type: 'frame', name: 'Form field', width: '100%', layout: 'vertical', gap: 8,
    children: [
      { id: 'ff-label', type: 'text', content: 'Field label', fontSize: 13, fontWeight: 600, color: COLOR.textPrimary },
      {
        id: 'ff-input', type: 'frame', name: 'Input', width: '100%', height: 40, layout: 'horizontal', alignItems: 'center',
        padding: [8, 16], cornerRadius: 8, fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1,
        children: [{ id: 'ff-placeholder', type: 'text', content: 'Placeholder — to confirm', fontSize: 14, color: COLOR.textSecondary }],
      },
      { id: 'ff-help', type: 'text', content: 'Help text — to confirm', fontSize: 12, color: COLOR.textSecondary },
    ],
  }],
};

const toggleRow: Structure = {
  name: 'toggle-row',
  kind: 'component',
  description: 'A settings row: label + description on the left, a toggle on the right. The workhorse of preference screens.',
  nodes: [{
    id: 'tr', type: 'frame', name: 'Toggle row', width: '100%', layout: 'horizontal', alignItems: 'center',
    justifyContent: 'space-between', gap: 16, padding: [8, 16], cornerRadius: 10,
    fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: 'tr-copy', type: 'frame', layout: 'vertical', gap: 2,
        children: [
          { id: 'tr-label', type: 'text', content: 'Setting label', fontSize: 14, fontWeight: 600, color: COLOR.textPrimary },
          { id: 'tr-desc', type: 'text', content: 'Setting description — to confirm', fontSize: 12, color: COLOR.textSecondary },
        ],
      },
      { id: 'tr-toggle', type: 'toggle', checked: true },
    ],
  }],
};

const statCard: Structure = {
  name: 'stat-card',
  kind: 'component',
  description: 'A single stat block: value slot over a label. Stamp several in a horizontal frame for a stat band.',
  nodes: [stat('sc')],
};

const toolbar: Structure = {
  name: 'toolbar',
  kind: 'component',
  description: 'A list-view toolbar: search field on the left, a filter and a primary action on the right.',
  nodes: [{
    id: 'tb', type: 'frame', name: 'Toolbar', width: '100%', layout: 'horizontal', alignItems: 'center',
    justifyContent: 'space-between', gap: 16,
    children: [
      {
        id: 'tb-search', type: 'frame', name: 'Search', width: 280, height: 36, layout: 'horizontal', alignItems: 'center',
        gap: 8, padding: [8, 16], cornerRadius: 8, fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1,
        children: [
          { id: 'tb-search-icon', type: 'icon', icon: 'search', iconSize: 16, iconColor: COLOR.textSecondary },
          { id: 'tb-search-text', type: 'text', content: 'Search — to confirm', fontSize: 13, color: COLOR.textSecondary },
        ],
      },
      {
        id: 'tb-actions', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: 8,
        children: [
          button('tb-filter', 'Filter', COLOR.bgElevated, COLOR.textPrimary, COLOR.border),
          button('tb-primary', 'Primary action', COLOR.accent, COLOR.textPrimary),
        ],
      },
    ],
  }],
};

/** A data-table row: identity cell (avatar + name/email), role chip, status, actions. */
function tableRow(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Row', width: '100%', layout: 'horizontal', alignItems: 'center',
    padding: [8, 16], gap: 16, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: `${id}-identity`, type: 'frame', width: '40%', layout: 'horizontal', alignItems: 'center', gap: 8,
        children: [
          { id: `${id}-avatar`, type: 'ellipse', width: 32, height: 32, fill: COLOR.bgElevated },
          {
            id: `${id}-id-copy`, type: 'frame', layout: 'vertical', gap: 2,
            children: [
              { id: `${id}-name`, type: 'text', content: 'Name — to confirm', fontSize: 14, fontWeight: 600, color: COLOR.textPrimary },
              { id: `${id}-email`, type: 'text', content: 'email — to confirm', fontSize: 12, color: COLOR.textSecondary },
            ],
          },
        ],
      },
      {
        id: `${id}-role`, type: 'frame', width: '20%', layout: 'horizontal',
        children: [{
          id: `${id}-role-chip`, type: 'frame', layout: 'horizontal', alignItems: 'center', padding: [4, 8],
          cornerRadius: 999, fill: COLOR.bgElevated,
          children: [{ id: `${id}-role-text`, type: 'text', content: 'Role', fontSize: 12, color: COLOR.textSecondary }],
        }],
      },
      {
        id: `${id}-status`, type: 'frame', width: '25%', layout: 'horizontal', alignItems: 'center', gap: 8,
        children: [
          { id: `${id}-status-toggle`, type: 'toggle', checked: true, width: 36, height: 20 },
          { id: `${id}-status-text`, type: 'text', content: 'Status', fontSize: 13, color: COLOR.textSecondary },
        ],
      },
      {
        id: `${id}-actions`, type: 'frame', width: '15%', layout: 'horizontal', justifyContent: 'end',
        children: [{ id: `${id}-actions-icon`, type: 'icon', icon: 'ellipsis', iconSize: 18, iconColor: COLOR.textSecondary }],
      },
    ],
  };
}

function tableHeaderCell(id: string, label: string, width: string, alignEnd = false): SceneNode {
  return {
    id, type: 'frame', width, layout: 'horizontal', ...(alignEnd ? { justifyContent: 'end' as const } : {}),
    children: [{ id: `${id}-text`, type: 'text', content: label, fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: COLOR.textSecondary }],
  };
}

const dataTable: Structure = {
  name: 'data-table',
  kind: 'component',
  description: 'A high-fidelity data table: header row plus three placeholder rows (avatar + name/email, role chip, status toggle, actions). Copy rows with batch_design C ops to extend; ~80 hand-placed nodes for free.',
  nodes: [{
    id: 'dt', type: 'frame', name: 'Data table', width: '100%', layout: 'vertical',
    cornerRadius: 12, overflow: 'hidden', fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: 'dt-header', type: 'frame', name: 'Header', width: '100%', layout: 'horizontal', alignItems: 'center',
        padding: [8, 16], gap: 16, fill: COLOR.bgElevated,
        children: [
          tableHeaderCell('dt-h-identity', 'Name', '40%'),
          tableHeaderCell('dt-h-role', 'Role', '20%'),
          tableHeaderCell('dt-h-status', 'Status', '25%'),
          tableHeaderCell('dt-h-actions', 'Actions', '15%', true),
        ],
      },
      tableRow('dt-row1'),
      tableRow('dt-row2'),
      tableRow('dt-row3'),
    ],
  }],
};

const structureMap = new Map<string, Structure>([
  ['marquee-hero', marqueeHero],
  ['bento-grid', bentoGrid],
  ['stat-led', statLed],
  ['editorial-longform', editorialLongform],
  ['split-workbench', splitWorkbench],
  ['catalogue', catalogue],
  ['dashboard', dashboard],
  ['auth', auth],
  ['pricing', pricing],
  ['settings', settings],
  ['onboarding', onboarding],
  // Phase 16 — component-level scaffolds
  ['data-table', dataTable],
  ['form-field', formField],
  ['toolbar', toolbar],
  ['stat-card', statCard],
  ['toggle-row', toggleRow],
]);

export function listStructures(): { name: string; kind: 'page' | 'component'; description: string; axes?: StructureAxes }[] {
  return Array.from(structureMap.values()).map(({ name, kind, description, axes }) => ({ name, kind: kind ?? 'page', description, ...(axes ? { axes } : {}) }));
}

export function getStructure(name: string): Structure | undefined {
  return structureMap.get(name);
}

export function registerStructure(structure: Structure): void {
  structureMap.set(structure.name, structure);
}

// ── apply ────────────────────────────────────────────────────────────────

/** Neutral defaults for the color tokens these scaffolds reference, so an
 * unthemed canvas still renders (analyze A-P4 — there is no built-in default
 * token layer). Mirrors the `dark` preset palette; a later `apply_preset` or
 * design-system merges over these since they live on `canvas.variables`. */
const DEFAULT_SCAFFOLD_COLORS: Record<string, string> = {
  'bg-primary': '#0a0a0a',
  'bg-surface': '#111111',
  'bg-elevated': '#1a1a1a',
  'text-primary': '#ffffffde',
  'text-secondary': '#ffffffa0',
  'accent': '#3b82f6',
  'border': '#ffffff1a',
};

/** Node fields that may carry a `$color` token ref (the theming split). */
const COLOR_FIELDS = ['fill', 'color', 'stroke', 'iconColor'] as const;

/** Page background token applied to the document root so a scaffold fills the
 * viewport (renderer hoists root fill to <html>) instead of leaving browser
 * white below/around the content. */
const PAGE_BG_TOKEN = 'bg-primary';

function walkNodes(node: SceneNode, visit: (n: SceneNode) => void): void {
  visit(node);
  node.children?.forEach((c) => walkNodes(c, visit));
}

export interface ApplyStructureResult {
  applied: string;
  kind: 'page' | 'component';
  axes?: StructureAxes;
  /** Top-level node ids inserted under the canvas root (page) or target (component). */
  insertedNodeIds: string[];
  /** Component stamps only: template id → live (re-keyed) id, for targeting follow-up ops. */
  idMap?: Record<string, string>;
  /** Fillable placeholders (text/image) with their role label, for populating. */
  placeholders: { id: string; role: string }[];
  /** Color tokens seeded with neutral defaults because they were unresolved. */
  seededColors: string[];
}

function findById(root: SceneNode, id: string): SceneNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return null;
}

/** Re-key a cloned component subtree so repeat stamps never collide: every id
 * gets a `<structureName>-<n>-` prefix, where n is the smallest counter no
 * existing id in the canvas already uses (covers stamps AND agent-made copies
 * of stamps, which keep the prefixed form). Returns templateId → liveId. */
function rekeyComponentNodes(canvas: Canvas, structureName: string, nodes: SceneNode[]): Record<string, string> {
  const existing = new Set<string>();
  walkNodes(canvas.root, (n) => existing.add(n.id));

  let n = 1;
  const hasPrefix = (p: string) => [...existing].some((id) => id.startsWith(p));
  while (hasPrefix(`${structureName}-${n}-`)) n++;
  const prefix = `${structureName}-${n}-`;

  const idMap: Record<string, string> = {};
  for (const root of nodes) {
    walkNodes(root, (node) => {
      idMap[node.id] = `${prefix}${node.id}`;
      node.id = `${prefix}${node.id}`;
    });
  }
  return idMap;
}

/** Stamp a layout structure onto a canvas: insert its placeholder scaffold under
 * the root, record provenance, and seed neutral defaults for any color token the
 * scaffold references that isn't already resolvable (A-P4). A pure mutation on
 * the passed canvas — the MCP handler wraps it with lookup / persist / response.
 *
 * @param opts.replace clear an existing non-empty root before stamping.
 * @param opts.existingColors color token names already resolvable for this canvas
 *   (from `getCanvasTokens`), so inherited/preset colors are never overwritten.
 * @throws if the structure is unknown, or the root has children and `replace` is unset.
 */
export function applyStructure(
  canvas: Canvas,
  structureName: string,
  opts: { replace?: boolean; existingColors?: Set<string>; targetId?: string } = {},
): ApplyStructureResult {
  const structure = getStructure(structureName);
  if (!structure) {
    throw new Error(`Structure "${structureName}" not found. Use list_structures to see available structures.`);
  }
  const kind = structure.kind ?? 'page';

  let inserted: SceneNode[];
  let idMap: Record<string, string> | undefined;

  if (kind === 'component') {
    // Component stamp (Phase 16 slice D): insert under any target, repeatably.
    const targetId = opts.targetId ?? 'document';
    const target = targetId === 'document' || targetId === canvas.root.id
      ? canvas.root
      : findById(canvas.root, targetId);
    if (!target) throw new Error(`Target node "${targetId}" not found on this canvas.`);

    inserted = structure.nodes.map((n) => structuredClone(n));
    idMap = rekeyComponentNodes(canvas, structure.name, inserted);
    target.children = [...(target.children ?? []), ...inserted];
    // No empty-canvas guard, no page background, no provenance stamp (spec C9 —
    // provenance.structure names the PAGE shape; component stamps don't shape it).
  } else {
    if (opts.targetId !== undefined && opts.targetId !== 'document' && opts.targetId !== canvas.root.id) {
      throw new Error(`Structure "${structureName}" is a page scaffold — it stamps at the canvas root and does not take a targetId. Component structures (see list_structures kind) do.`);
    }
    const existing = canvas.root.children ?? [];
    if (existing.length > 0 && !opts.replace) {
      throw new Error(
        `Canvas root already has ${existing.length} child node(s). Pass replace: true to clear them and stamp "${structureName}", or use a fresh canvas.`,
      );
    }

    // Insert — clone so the registry template is never mutated.
    inserted = structure.nodes.map((n) => structuredClone(n));
    canvas.root.children = inserted;

    // Give the document root a page background so the scaffold fills the viewport
    // rather than showing browser-default white. createCanvas seeds a white root
    // fill, so treat white/unset as the default backdrop and override it — but
    // preserve any custom (non-white) fill or gradient the author already chose.
    const currentFill = canvas.root.fill?.toUpperCase();
    if ((!currentFill || currentFill === '#FFFFFF') && !canvas.root.gradient) {
      canvas.root.fill = `$${PAGE_BG_TOKEN}`;
    }

    // Provenance into the open metadata bag (C3). `preset` is filled later by
    // apply_preset (T7); `seed` is reserved (C6).
    canvas.metadata = {
      ...canvas.metadata,
      provenance: { structure: structure.name, axes: structure.axes, at: new Date().toISOString() },
    };
  }

  // One pass: collect fillable placeholders + referenced color tokens.
  const placeholders: { id: string; role: string }[] = [];
  const referenced = new Set<string>();
  for (const root of inserted) {
    walkNodes(root, (n) => {
      if (n.type === 'text' && typeof n.content === 'string') placeholders.push({ id: n.id, role: n.content });
      else if (n.type === 'image') placeholders.push({ id: n.id, role: 'image' });
      for (const field of COLOR_FIELDS) {
        const v = (n as unknown as Record<string, unknown>)[field];
        if (typeof v === 'string' && v.startsWith('$')) referenced.add(v.slice(1));
      }
    });
  }

  // The page background may only live on the root (not in the scanned children).
  if (kind === 'page') referenced.add(PAGE_BG_TOKEN);

  // Seed neutral defaults for referenced colors not already resolvable (A-P4).
  const existingColors = opts.existingColors ?? new Set<string>();
  const seededColors: string[] = [];
  for (const token of referenced) {
    if (existingColors.has(token)) continue;
    const def = DEFAULT_SCAFFOLD_COLORS[token];
    if (def === undefined) continue;
    canvas.variables.colors = { ...canvas.variables.colors, [token]: def };
    seededColors.push(token);
  }

  return {
    applied: structure.name,
    kind,
    ...(structure.axes ? { axes: structure.axes } : {}),
    insertedNodeIds: inserted.map((n) => n.id),
    ...(idMap ? { idMap } : {}),
    placeholders,
    seededColors: seededColors.sort(),
  };
}

// ── diversification signal ─────────────────────────────────────────────────

/** The four taxonomy axes, in display order. */
const AXIS_KEYS: (keyof StructureAxes)[] = ['heroTreatment', 'density', 'rhythm', 'alignment'];

export interface DiversificationHint {
  /** The build-log entries this hint was computed from (newest first). */
  recent: BuildLogEntry[];
  /** Axes where recent structured canvases converged on a single value (the
   * agent is repeating itself here). Empty when recent work already varies. */
  repeatedAxes: (keyof StructureAxes)[];
  /** One-line advisory steer for the next canvas — never blocking (C5). */
  suggestion: string;
}

/** Advisory anti-sameness signal: tally taxonomy axis values across the most
 * recent structured canvases in a project and recommend differing on >= 1 axis.
 * Pure and total — entries without `axes` (preset-only / hand-built, A-T3) are
 * ignored, and an empty/short history yields an open "pick freely" hint rather
 * than a false "you're repeating". The caller decides how many entries to pass
 * (N = 5 per FR-7); this just tallies whatever it's given (analyze C-A6). */
export function computeDiversificationHint(recent: BuildLogEntry[]): DiversificationHint {
  const structured = recent.filter((e) => e.axes);
  if (structured.length === 0) {
    return {
      recent,
      repeatedAxes: [],
      suggestion: 'No recent structured canvases in this project — pick any structure to set the direction.',
    };
  }

  const repeatedAxes: (keyof StructureAxes)[] = [];
  const repeats: string[] = [];
  for (const axis of AXIS_KEYS) {
    const counts = new Map<string, number>();
    for (const e of structured) {
      const v = e.axes?.[axis];
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let topVal = '';
    let topCount = 0;
    for (const [v, c] of counts) if (c > topCount) { topVal = v; topCount = c; }
    // An axis "converges" only when its dominant value is shared by a STRICT
    // MAJORITY (> half) of the recent structured canvases. A bare ">= 2" over-
    // fires: with only 3-5 values per axis and ~5 entries, some value collides
    // on nearly every axis by chance, so even a deliberately varied project
    // reads as "repeats everything" (caught dogfooding the showcase).
    if (topCount >= 2 && topCount * 2 > structured.length) {
      repeatedAxes.push(axis);
      repeats.push(`${axis}=${topVal}`);
    }
  }

  if (repeatedAxes.length === 0) {
    return {
      recent,
      repeatedAxes,
      suggestion: 'Recent canvases already vary across the taxonomy axes — keep the variety going.',
    };
  }

  return {
    recent,
    repeatedAxes,
    suggestion: `Recent canvases in this project repeat ${repeats.join(', ')}. Prefer a structure that differs on at least one of: ${repeatedAxes.join(', ')}.`,
  };
}
