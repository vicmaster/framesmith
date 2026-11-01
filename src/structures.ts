import type { BuildLogEntry, Canvas, SceneNode, Structure, StructureAxes } from './types.js';
import { resolveSurface, SURFACE_TYPES, type SurfaceType } from './surfaces.js';

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

/** Phase 27 slice B — density comes from tokens, not literals. Scaffolds
 * reference the space/radius/elevation vocabulary generate_design_system
 * writes; applyStructure seeds neutral defaults (the pre-27 literal values)
 * for anything not already resolvable, so unthemed canvases render exactly
 * as before and a personality re-densifies every stamp. */
const SPACE = {
  xxs: '$space-3xs',   // 2
  xs2: '$space-2xs',   // 4
  xs: '$space-xs',     // 8
  sm: '$space-sm',     // 12
  md: '$space-md',     // 16
  lg: '$space-lg',     // 24
  xl: '$space-xl',     // 32
  xl2: '$space-2xl',   // 48
} as const;
const RADIUS = {
  sm: '$radius-sm',    // 8
  md: '$radius-md',    // 12
  lg: '$radius-lg',    // 16
} as const;
const ELEV = {
  flat: '$elevation.flat',
  raised: '$elevation.raised',
} as const;
const TYPE = {
  display: '$display',   // hero headlines — the display face at full size
  title: '$title',       // page/screen titles, one step below display
  heading: '$heading',   // section heads
  textLg: '$text-lg',    // card titles, subheads — the step above body
  textSm: '$text-sm',    // small body text — untracked (nav items, prose, meta)
  body: '$body',         // prose and item text
  label: '$label',       // control, CTA, breadcrumb and table-header text
  caption: '$caption',   // metadata, timestamps, eyebrows
} as const;
/** Phase 28 — the tint pair: tint as the FILL, base color as the INK. */
const TINT = {
  accent: { bg: '$accent-tint', ink: COLOR.accent },
  success: { bg: '$success-tint', ink: '$success' },
  warning: { bg: '$warning-tint', ink: '$warning' },
  danger: { bg: '$danger-tint', ink: '$danger' },
  neutral: { bg: '$neutral-tint', ink: COLOR.textSecondary },
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
    minHeight: height,
    minWidth: 0,
    layout: 'vertical',
    justifyContent: 'space-between',
    gap: SPACE.md,
    padding: SPACE.lg,
    cornerRadius: RADIUS.lg,
    fill,
    stroke: COLOR.border,
    strokeWidth: 1,
    children: [
      { id: `${id}-label`, type: 'text', content: label, fontSize: TYPE.textLg, fontWeight: 600, color: COLOR.textPrimary, minWidth: 0 },
      { id: `${id}-body`, type: 'text', content: body, fontSize: TYPE.textSm, color: COLOR.textSecondary, lineHeight: 1.5, minWidth: 0 },
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
    padding: [SPACE.xs, SPACE.lg],
    cornerRadius: RADIUS.sm,
    minWidth: 0,
    overflow: 'hidden',
    fill,
    ...(stroke ? { stroke, strokeWidth: 1 } : {}),
    // Buttons survive hostile-length labels by truncating (designed ellipsis).
    children: [{ id: `${id}-label`, type: 'text', content: label, fontSize: TYPE.body, fontWeight: 600, color, textOverflow: 'ellipsis' }],
  };
}

/** A stat block — icon over a big value slot over a label (no fabricated
 * numbers, C8). The icon defaults sensibly; pass one to vary across a row. */
function stat(id: string, icon = 'activity'): SceneNode {
  return {
    id,
    type: 'frame',
    name: 'KPI card',
    width: 300,
    layout: 'vertical',
    gap: SPACE.sm,
    padding: SPACE.md,
    cornerRadius: RADIUS.md,
    fill: COLOR.bgSurface,
    stroke: COLOR.border,
    strokeWidth: 1,
    shadow: ELEV.flat,
    minWidth: 0,
    children: [
      {
        id: `${id}-head`, type: 'frame', name: 'Label row', width: '100%', layout: 'horizontal',
        alignItems: 'center', justifyContent: 'space-between', gap: SPACE.xs,
        children: [
          {
            id: `${id}-hl`, type: 'frame', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs, minWidth: 0,
            children: [
              {
                id: `${id}-tile`, type: 'frame', name: 'Icon tile', width: 30, height: 30, cornerRadius: RADIUS.sm,
                fill: TINT.accent.bg, layout: 'vertical', alignItems: 'center', justifyContent: 'center',
                children: [{ id: `${id}-icon`, type: 'icon', icon, iconSize: 16, iconColor: TINT.accent.ink }],
              },
              // Uppercase is sanctioned here: the eyebrow census knows a label
              // beside a big tabular figure names a metric, not a section.
              { id: `${id}-label`, type: 'text', content: 'Stat label', fontSize: TYPE.caption, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
            ],
          },
          { id: `${id}-menu`, type: 'icon', icon: 'ellipsis-vertical', iconSize: 14, iconColor: COLOR.textSecondary },
        ],
      },
      {
        id: `${id}-vr`, type: 'frame', name: 'Value row', width: '100%', layout: 'horizontal',
        alignItems: 'end', justifyContent: 'space-between', gap: SPACE.sm, overflow: 'hidden',
        children: [
          {
            id: `${id}-vc`, type: 'frame', layout: 'horizontal', alignItems: 'end', gap: SPACE.xs2, minWidth: 0,
            children: [
              { id: `${id}-value`, type: 'text', content: 'Metric — TBD', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary, letterSpacing: -0.5, tabularNums: true, textOverflow: 'ellipsis' },
              { id: `${id}-ctx`, type: 'text', content: 'of target', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
            ],
          },
          {
            id: `${id}-spark`, type: 'chart', name: 'Sparkline', kind: 'sparkline', width: 64, height: 26,
            series: [{ data: [40, 55, 45, 70, 60, 85, 100], stroke: COLOR.accent }],
          },
        ],
      },
      {
        id: `${id}-foot`, type: 'frame', name: 'Delta row', width: '100%', layout: 'horizontal',
        alignItems: 'center', justifyContent: 'space-between', gap: SPACE.xs, overflow: 'hidden',
        children: [
          { id: `${id}-period`, type: 'text', content: 'vs last period', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
          {
            id: `${id}-pill`, type: 'frame', name: 'Pill', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
            padding: [2, SPACE.xs], cornerRadius: 999, fill: TINT.success.bg, overflow: 'hidden',
            children: [
              { id: `${id}-pill-icon`, type: 'icon', icon: 'trending-up', iconSize: 12, iconColor: TINT.success.ink },
              { id: `${id}-pill-text`, type: 'text', content: 'Change — TBD', fontSize: TYPE.caption, fontWeight: 600, color: TINT.success.ink, textOverflow: 'ellipsis' },
            ],
          },
        ],
      },
    ],
  };
}

/** A sidebar nav row: leading icon + label; the active row reads as selected
 * (elevated fill, accent icon, primary text), rest are quiet; an optional
 * count badge sits trailing. */
function navItem(id: string, label: string, icon = 'circle', opts: { active?: boolean; badge?: string } = {}): SceneNode {
  const active = opts.active === true;
  return {
    id,
    type: 'frame',
    name: label,
    width: '100%',
    layout: 'horizontal',
    alignItems: 'center',
    gap: SPACE.xs,
    padding: [SPACE.xs, SPACE.sm],
    cornerRadius: RADIUS.sm,
    fill: active ? COLOR.bgElevated : 'transparent',
    children: [
      { id: `${id}-icon`, type: 'icon', icon, iconSize: 16, iconColor: active ? COLOR.accent : COLOR.textSecondary },
      { id: `${id}-label`, type: 'text', content: label, fontSize: TYPE.textSm, fontWeight: active ? 600 : 400, color: active ? COLOR.textPrimary : COLOR.textSecondary, textOverflow: 'ellipsis' },
      ...(opts.badge ? [{
        id: `${id}-badge`, type: 'frame' as const, name: 'Badge', layout: 'horizontal' as const, alignItems: 'center' as const,
        justifyContent: 'center' as const, minWidth: 20, padding: [2, SPACE.xs2], cornerRadius: 999, fill: COLOR.bgElevated,
        children: [{ id: `${id}-badge-text`, type: 'text' as const, content: opts.badge, fontSize: TYPE.caption, fontWeight: 600, color: COLOR.textSecondary, tabularNums: true }],
      }] : []),
    ],
  };
}

/** A sidebar nav group: a quiet sentence-case group label (NOT an eyebrow —
 * no uppercase, no tracking) over its items. */
function navGroup(id: string, label: string, items: SceneNode[]): SceneNode {
  return {
    id, type: 'frame', name: label, width: '100%', layout: 'vertical', gap: SPACE.xxs,
    children: [
      { id: `${id}-label`, type: 'text', content: label, fontSize: TYPE.caption, fontWeight: 600, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
      ...items,
    ],
  };
}

/** An activity-feed row: an icon tile beside the event line + timestamp. */
function activityRow(id: string, icon: string): SceneNode {
  return {
    id, type: 'frame', name: 'Activity item', width: '100%', layout: 'horizontal',
    alignItems: 'center', gap: SPACE.sm,
    children: [
      {
        id: `${id}-tile`, type: 'frame', name: 'Icon tile', width: 28, height: 28, cornerRadius: RADIUS.sm,
        fill: COLOR.bgElevated, layout: 'vertical', alignItems: 'center', justifyContent: 'center',
        children: [{ id: `${id}-icon`, type: 'icon', icon, iconSize: 14, iconColor: COLOR.textSecondary }],
      },
      {
        id: `${id}-copy`, type: 'frame', name: 'Copy', layout: 'vertical', minWidth: 0,
        children: [
          { id: `${id}-text`, type: 'text', content: 'Activity item — to confirm', fontSize: TYPE.textSm, color: COLOR.textPrimary, textOverflow: 'ellipsis' },
          { id: `${id}-time`, type: 'text', content: 'Timestamp — TBD', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
        ],
      },
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
    cornerRadius: RADIUS.lg,
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
        gap: SPACE.xs,
        padding: SPACE.md,
        children: [
          { id: `${id}-title`, type: 'text', content: 'Item title', fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary },
          { id: `${id}-meta`, type: 'text', content: 'Meta — to confirm', fontSize: TYPE.textSm, color: COLOR.textSecondary },
        ],
      },
    ],
  };
}

/** A labeled form field for page scaffolds: label over an input box. */
function field(id: string, label: string): SceneNode {
  return {
    id, type: 'frame', name: label, width: '100%', layout: 'vertical', gap: SPACE.xs,
    children: [
      { id: `${id}-label`, type: 'text', content: label, fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.textSecondary },
      { id: `${id}-input`, type: 'frame', name: 'Input', width: '100%', height: 44, cornerRadius: RADIUS.sm, fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1 },
    ],
  };
}

/** A feature row: a check icon + a placeholder feature label. */
function featureRow(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Feature', width: '100%', minWidth: 0, layout: 'horizontal', gap: SPACE.xs, alignItems: 'center',
    children: [
      { id: `${id}-icon`, type: 'icon', icon: 'check', iconSize: 16, iconColor: COLOR.accent },
      { id: `${id}-text`, type: 'text', content: 'Feature — to confirm', fontSize: TYPE.textSm, color: COLOR.textSecondary, width: '100%', minWidth: 0 },
    ],
  };
}

/** A pricing tier card: name, price slot, feature list, CTA. No fake prices. */
function tier(id: string, name: string): SceneNode {
  return {
    id, type: 'frame', name, width: 320, layout: 'vertical', gap: SPACE.lg, padding: SPACE.xl,
    cornerRadius: RADIUS.lg, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: `${id}-head`, type: 'frame', name: 'Tier head', width: '100%', layout: 'vertical', gap: SPACE.xs,
        children: [
          { id: `${id}-name`, type: 'text', content: name, fontSize: TYPE.body, fontWeight: 600, color: COLOR.textSecondary },
          { id: `${id}-price`, type: 'text', content: 'Price — to confirm', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary },
        ],
      },
      {
        id: `${id}-features`, type: 'frame', name: 'Features', width: '100%', layout: 'vertical', gap: SPACE.xs,
        children: [featureRow(`${id}-f1`), featureRow(`${id}-f2`), featureRow(`${id}-f3`)],
      },
      {
        id: `${id}-cta`, type: 'frame', name: 'Choose plan', width: '100%', minWidth: 0, overflow: 'hidden', layout: 'horizontal',
        alignItems: 'center', justifyContent: 'center', padding: [SPACE.xs, SPACE.lg], cornerRadius: RADIUS.sm, fill: COLOR.accent,
        children: [{ id: `${id}-cta-label`, type: 'text', content: 'Choose plan', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.bgPrimary, textOverflow: 'ellipsis', minWidth: 0 }],
      },
    ],
  };
}

/** A settings row: label + description on the left, a real toggle on the right. */
function settingsRow(id: string, on: boolean): SceneNode {
  return {
    id, type: 'frame', name: 'Setting', width: '100%', layout: 'horizontal',
    justifyContent: 'space-between', alignItems: 'center', gap: SPACE.lg, padding: SPACE.lg,
    children: [
      {
        id: `${id}-text`, type: 'frame', layout: 'vertical', gap: SPACE.xs,
        children: [
          { id: `${id}-label`, type: 'text', content: 'Setting label', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.textPrimary },
          { id: `${id}-desc`, type: 'text', content: 'Description — to confirm', fontSize: TYPE.caption, color: COLOR.textSecondary },
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
      gap: SPACE.lg,
      padding: ['$space-3xl', SPACE.xl2],
      fill: COLOR.bgPrimary,
      children: [
        { id: 'mh-eyebrow', type: 'text', name: 'Eyebrow', content: 'Eyebrow — short label', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.accent, textAlign: 'center', letterSpacing: 1 },
        { id: 'mh-headline', type: 'text', name: 'Headline', content: 'Headline', fontSize: TYPE.display, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center', lineHeight: 1.1, maxWidth: 880 },
        { id: 'mh-subhead', type: 'text', name: 'Subheadline', content: 'Body copy — one or two supporting sentences.', fontSize: TYPE.textLg, fontWeight: 400, color: COLOR.textSecondary, textAlign: 'center', lineHeight: 1.5, maxWidth: 640 },
        {
          id: 'mh-cta',
          type: 'frame',
          name: 'CTA row',
          layout: 'horizontal',
          minWidth: 0,
          wrap: true,
          gap: SPACE.md,
          responsive: 'stack',
          alignItems: 'center',
          justifyContent: 'center',
          padding: [SPACE.md, 0, 0, 0],
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
      gap: SPACE.xs,
      padding: ['$space-3xl', SPACE.xl2],
      fill: COLOR.bgSurface,
      children: [
        { id: 'mh-support-title', type: 'text', content: 'Supporting section', fontSize: TYPE.title, fontWeight: 600, color: COLOR.textPrimary, textAlign: 'center' },
        { id: 'mh-support-body', type: 'text', content: 'Body copy — expand on the promise above.', fontSize: TYPE.body, color: COLOR.textSecondary, textAlign: 'center', maxWidth: 560, lineHeight: 1.6 },
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
      gap: SPACE.xl,
      padding: [SPACE.xl2, SPACE.xl2],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'bn-header',
          type: 'frame',
          name: 'Header',
          layout: 'vertical',
          gap: SPACE.xs,
          children: [
            { id: 'bn-eyebrow', type: 'text', content: 'Eyebrow — section label', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.accent, letterSpacing: 1 },
            { id: 'bn-title', type: 'text', content: 'Headline', fontSize: TYPE.display, fontWeight: 700, color: COLOR.textPrimary, lineHeight: 1.2 },
          ],
        },
        {
          // Phase 26 slice A — real CSS grid: a 4-column template with spans
          // gives the asymmetric bento rhythm the flex-wrap approximation
          // could only fake; responsive: "stack" collapses it on mobile.
          id: 'bn-grid',
          type: 'frame',
          name: 'Bento grid',
          layout: 'grid',
          gridColumns: 4,
          gap: SPACE.lg,
          responsive: 'stack',
          children: [
            { ...card('bn-card-1', 'Feature card — primary', 560, 280, COLOR.bgSurface), width: '100%', gridColumn: 3 },
            { ...card('bn-card-2', 'Card — supporting', 300, 280, COLOR.bgSurface), width: '100%' },
            { ...card('bn-card-3', 'Card — metric', 280, 200, COLOR.bgElevated, 'Metric — to confirm'), width: '100%' },
            { ...card('bn-card-4', 'Card — supporting', 280, 200, COLOR.bgSurface), width: '100%' },
            { ...card('bn-card-5', 'Card — wide', 580, 200, COLOR.bgSurface), width: '100%', gridColumn: 2 },
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
      gap: SPACE.xl,
      padding: ['$space-3xl', SPACE.xl2],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'sl-head',
          type: 'frame',
          name: 'Heading',
          width: '100%',
          layout: 'vertical',
          alignItems: 'center',
          gap: SPACE.md,
          children: [
            { id: 'sl-eyebrow', type: 'text', content: 'Eyebrow — short label', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.accent, textAlign: 'center', letterSpacing: 1 },
            { id: 'sl-headline', type: 'text', content: 'Headline', fontSize: TYPE.display, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center', lineHeight: 1.15, maxWidth: 760 },
            { id: 'sl-subhead', type: 'text', content: 'Body copy — one supporting sentence.', fontSize: TYPE.textLg, color: COLOR.textSecondary, textAlign: 'center', maxWidth: 600, lineHeight: 1.5 },
          ],
        },
        {
          id: 'sl-stats',
          type: 'frame',
          name: 'Stat row',
          layout: 'horizontal',
          gap: SPACE.lg,
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
      padding: ['$space-3xl', SPACE.xl2],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'ed-col',
          type: 'frame',
          name: 'Reading column',
          width: '100%',
          maxWidth: 720,
          layout: 'vertical',
          gap: SPACE.lg,
          children: [
            { id: 'ed-kicker', type: 'text', content: 'Eyebrow — category', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.accent, letterSpacing: 1 },
            { id: 'ed-title', type: 'text', content: 'Headline', fontSize: TYPE.display, fontWeight: 700, color: COLOR.textPrimary, lineHeight: 1.2 },
            { id: 'ed-meta', type: 'text', content: 'Byline — author · date', fontSize: TYPE.textSm, color: COLOR.textSecondary },
            { id: 'ed-lead', type: 'text', content: 'Lead paragraph — set up the piece in two or three sentences.', fontSize: TYPE.textLg, color: COLOR.textSecondary, lineHeight: 1.6 },
            { id: 'ed-h2-1', type: 'text', content: 'Section heading', fontSize: TYPE.heading, fontWeight: 600, color: COLOR.textPrimary, lineHeight: 1.3 },
            { id: 'ed-body-1', type: 'text', content: 'Body copy — paragraph to confirm.', fontSize: TYPE.textLg, color: COLOR.textSecondary, lineHeight: 1.7 },
            { id: 'ed-h2-2', type: 'text', content: 'Section heading', fontSize: TYPE.heading, fontWeight: 600, color: COLOR.textPrimary, lineHeight: 1.3 },
            { id: 'ed-body-2', type: 'text', content: 'Body copy — paragraph to confirm.', fontSize: TYPE.textLg, color: COLOR.textSecondary, lineHeight: 1.7 },
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
          gap: SPACE.xs,
          padding: SPACE.lg,
          fill: COLOR.bgSurface,
          stroke: COLOR.border,
          strokeWidth: 1,
          children: [
            { id: 'sw-brand', type: 'text', content: 'Brand', fontSize: TYPE.body, fontWeight: 700, color: COLOR.textPrimary },
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
          gap: SPACE.lg,
          padding: SPACE.lg,
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
                { id: 'sw-title', type: 'text', content: 'Headline', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary },
                button('sw-action', 'Primary action', COLOR.accent, COLOR.bgPrimary),
              ],
            },
            {
              id: 'sw-canvas',
              type: 'frame',
              name: 'Work area',
              width: '100%',
              height: 420,
              cornerRadius: RADIUS.lg,
              fill: COLOR.bgSurface,
              stroke: COLOR.border,
              strokeWidth: 1,
              layout: 'vertical',
              alignItems: 'center',
              justifyContent: 'center',
              children: [{ id: 'sw-canvas-label', type: 'text', content: 'Body copy — main work area', fontSize: TYPE.body, color: COLOR.textSecondary }],
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
      gap: SPACE.xl,
      padding: [SPACE.xl2, SPACE.xl2],
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
            { id: 'cat-title', type: 'text', content: 'Headline', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary },
            { id: 'cat-filter', type: 'text', content: 'Filter — options', fontSize: TYPE.body, color: COLOR.textSecondary },
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
          gap: SPACE.lg,
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
    'Application dashboard — a real product shell: sidebar with grouped navigation (active item, badge count, account row) beside a main column with a topbar (title, search, primary action), a row of kpi-cards, then a labeled chart with legend next to an activity feed with icon tiles and timestamps. Dense and split; stacks on mobile. The default first screen for tools and admin apps.',
  axes: { heroTreatment: 'none', density: 'dense', rhythm: 'uniform', alignment: 'split' },
  nodes: [
    {
      id: 'db-shell', type: 'frame', name: 'Shell', width: '100%', layout: 'horizontal',
      responsive: 'stack', fill: COLOR.bgPrimary,
      children: [
        {
          id: 'db-sidebar', type: 'frame', name: 'Sidebar', width: 248, layout: 'vertical',
          justifyContent: 'space-between', gap: SPACE.lg, padding: SPACE.md,
          fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
          children: [
            {
              id: 'db-side-top', type: 'frame', name: 'Nav', width: '100%', layout: 'vertical', gap: SPACE.lg,
              children: [
                {
                  id: 'db-brand', type: 'frame', name: 'Brand', width: '100%', layout: 'horizontal',
                  alignItems: 'center', gap: SPACE.xs, padding: [SPACE.xs2, SPACE.sm],
                  children: [
                    {
                      id: 'db-brand-mark', type: 'frame', name: 'Mark', width: 28, height: 28, cornerRadius: RADIUS.sm,
                      fill: COLOR.accent, layout: 'vertical', alignItems: 'center', justifyContent: 'center',
                      children: [{ id: 'db-brand-icon', type: 'icon', icon: 'zap', iconSize: 16, iconColor: COLOR.bgPrimary }],
                    },
                    { id: 'db-brand-name', type: 'text', content: 'Brand', fontSize: TYPE.body, fontWeight: 700, color: COLOR.textPrimary, textOverflow: 'ellipsis' },
                  ],
                },
                navGroup('db-group-main', 'Workspace', [
                  navItem('db-nav-1', 'Overview', 'layout-dashboard', { active: true }),
                  navItem('db-nav-2', 'Reports', 'chart-line'),
                  navItem('db-nav-3', 'Inbox', 'inbox', { badge: '3' }),
                ]),
                navGroup('db-group-org', 'Organization', [
                  navItem('db-nav-4', 'Members', 'users'),
                  navItem('db-nav-5', 'Settings', 'settings'),
                ]),
              ],
            },
            {
              id: 'db-account', type: 'frame', name: 'Account row', width: '100%', layout: 'horizontal',
              alignItems: 'center', gap: SPACE.xs, padding: [SPACE.xs, SPACE.sm],
              cornerRadius: RADIUS.sm, fill: COLOR.bgElevated, overflow: 'hidden',
              children: [
                {
                  id: 'db-account-avatar', type: 'frame', name: 'Avatar', width: 28, height: 28, cornerRadius: 999,
                  fill: COLOR.bgPrimary, stroke: COLOR.border, strokeWidth: 1,
                  layout: 'vertical', alignItems: 'center', justifyContent: 'center',
                  children: [{ id: 'db-account-icon', type: 'icon', icon: 'user', iconSize: 14, iconColor: COLOR.textSecondary }],
                },
                {
                  id: 'db-account-copy', type: 'frame', name: 'Identity', layout: 'vertical', minWidth: 0,
                  children: [
                    { id: 'db-account-name', type: 'text', content: 'Account — TBD', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.textPrimary, textOverflow: 'ellipsis' },
                    { id: 'db-account-role', type: 'text', content: 'Workspace — TBD', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
                  ],
                },
                { id: 'db-account-menu', type: 'icon', icon: 'chevrons-up-down', iconSize: 14, iconColor: COLOR.textSecondary },
              ],
            },
          ],
        },
        {
          id: 'db-main', type: 'frame', name: 'Main', width: 1192, layout: 'vertical',
          gap: SPACE.lg, padding: SPACE.lg, fill: COLOR.bgPrimary,
          children: [
            {
              id: 'db-topbar', type: 'frame', name: 'Topbar', width: '100%', layout: 'horizontal',
              justifyContent: 'space-between', alignItems: 'center', gap: SPACE.md,
              children: [
                { id: 'db-title', type: 'text', content: 'Dashboard', fontSize: TYPE.title, color: COLOR.textPrimary, textOverflow: 'ellipsis' },
                {
                  id: 'db-topbar-actions', type: 'frame', name: 'Actions', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs, minWidth: 0,
                  children: [
                    {
                      id: 'db-search', type: 'frame', name: 'Search', width: 240, height: 36, layout: 'horizontal',
                      alignItems: 'center', gap: SPACE.xs, padding: [SPACE.xs, SPACE.sm], cornerRadius: RADIUS.sm,
                      fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, overflow: 'hidden',
                      children: [
                        { id: 'db-search-icon', type: 'icon', icon: 'search', iconSize: 15, iconColor: COLOR.textSecondary },
                        { id: 'db-search-text', type: 'text', content: 'Search', fontSize: TYPE.textSm, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
                      ],
                    },
                    {
                      id: 'db-bell', type: 'frame', name: 'Notifications', width: 36, height: 36, cornerRadius: RADIUS.sm,
                      fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
                      layout: 'vertical', alignItems: 'center', justifyContent: 'center',
                      children: [{ id: 'db-bell-icon', type: 'icon', icon: 'bell', iconSize: 16, iconColor: COLOR.textSecondary }],
                    },
                    button('db-action', 'Primary action', COLOR.accent, COLOR.bgPrimary),
                  ],
                },
              ],
            },
            {
              id: 'db-stats', type: 'frame', name: 'Stat row', width: '100%', layout: 'horizontal',
              gap: SPACE.md, responsive: 'wrap', wrap: true,
              children: [stat('db-stat-1', 'trending-up'), stat('db-stat-2', 'users'), stat('db-stat-3', 'activity')],
            },
            {
              id: 'db-content', type: 'frame', name: 'Content', width: '100%', layout: 'horizontal',
              gap: SPACE.md, responsive: 'stack',
              children: [
                {
                  id: 'db-chart', type: 'frame', name: 'Chart panel', width: 760, layout: 'vertical',
                  gap: SPACE.md, padding: SPACE.lg, cornerRadius: RADIUS.lg,
                  fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, shadow: ELEV.flat,
                  children: [
                    {
                      id: 'db-chart-head', type: 'frame', name: 'Chart header', width: '100%', layout: 'horizontal',
                      alignItems: 'center', justifyContent: 'space-between',
                      children: [
                        { id: 'db-chart-title', type: 'text', content: 'Overview', fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary },
                        {
                          id: 'db-legend', type: 'frame', name: 'Legend', layout: 'horizontal', alignItems: 'center', gap: SPACE.sm,
                          children: [
                            {
                              id: 'db-legend-a', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
                              children: [
                                { id: 'db-legend-a-dot', type: 'ellipse', width: 8, height: 8, fill: COLOR.accent },
                                { id: 'db-legend-a-text', type: 'text', content: 'Series A — TBD', fontSize: TYPE.caption, color: COLOR.textSecondary },
                              ],
                            },
                            {
                              id: 'db-legend-b', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
                              children: [
                                { id: 'db-legend-b-dot', type: 'ellipse', width: 8, height: 8, fill: COLOR.border },
                                { id: 'db-legend-b-text', type: 'text', content: 'Baseline — TBD', fontSize: TYPE.caption, color: COLOR.textSecondary },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      id: 'db-chart-area', type: 'chart', name: 'Chart area', width: 712, height: 224,
                      kind: 'line', curve: 'smooth', gridlines: 4,
                      series: [
                        { data: [12, 18, 15, 24, 22, 30, 34], stroke: COLOR.accent, strokeWidth: 2.5, area: true },
                        { data: [10, 12, 14, 16, 18, 20, 22], stroke: COLOR.border, strokeDasharray: '6 4' },
                      ],
                      xLabels: ['Label', '', '', '', '', '', 'Label'],
                      yLabels: ['Label', '', '', '', 'Label'],
                    },
                  ],
                },
                {
                  id: 'db-side', type: 'frame', name: 'Activity panel', width: 368, layout: 'vertical',
                  gap: SPACE.md, padding: SPACE.lg, cornerRadius: RADIUS.lg,
                  fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, shadow: ELEV.flat,
                  children: [
                    { id: 'db-side-title', type: 'text', content: 'Recent activity', fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary },
                    activityRow('db-act-1', 'git-commit'),
                    activityRow('db-act-2', 'user-plus'),
                    activityRow('db-act-3', 'file-text'),
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
      alignItems: 'center', justifyContent: 'center', padding: SPACE.xl2, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'au-card', type: 'frame', name: 'Card', width: 400, layout: 'vertical', gap: SPACE.lg,
          padding: SPACE.xl, cornerRadius: RADIUS.lg, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
          children: [
            {
              id: 'au-head', type: 'frame', width: '100%', layout: 'vertical', gap: SPACE.xs,
              children: [
                { id: 'au-title', type: 'text', content: 'Sign in', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary },
                { id: 'au-sub', type: 'text', content: 'Body copy — one supporting line.', fontSize: TYPE.textSm, color: COLOR.textSecondary, lineHeight: 1.5 },
              ],
            },
            {
              id: 'au-fields', type: 'frame', width: '100%', layout: 'vertical', gap: SPACE.md,
              children: [field('au-email', 'Email'), field('au-password', 'Password')],
            },
            // Hand-rolled until CI caught it: this was the one button in the
            // library not built from `button()`, so it missed the minWidth /
            // overflow / ellipsis hardening and clipped under a long label.
            // It only failed on Linux — macOS font metrics left just enough
            // room — which is why the Phase 29 scaffold sweep passed it.
            { ...button('au-submit', 'Continue', COLOR.accent, COLOR.bgPrimary), name: 'Submit', width: '100%' },
            { id: 'au-alt', type: 'text', content: 'Secondary link', fontSize: TYPE.textSm, fontWeight: 500, color: COLOR.accent, textAlign: 'center' },
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
      alignItems: 'center', gap: SPACE.xl2, padding: SPACE.xl2, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'pr-head', type: 'frame', name: 'Header', width: '100%', layout: 'vertical', gap: SPACE.md, alignItems: 'center',
          children: [
            { id: 'pr-title', type: 'text', content: 'Pricing', fontSize: TYPE.display, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center', lineHeight: 1.2 },
            { id: 'pr-sub', type: 'text', content: 'Body copy — one supporting line about the plans.', fontSize: TYPE.body, color: COLOR.textSecondary, textAlign: 'center', lineHeight: 1.5, maxWidth: 560 },
          ],
        },
        {
          id: 'pr-tiers', type: 'frame', name: 'Tiers', layout: 'horizontal', gap: SPACE.lg, wrap: true, responsive: 'wrap',
          children: [tier('pr-tier-1', 'Starter'), tier('pr-tier-2', 'Pro'), tier('pr-tier-3', 'Scale')],
        },
      ],
    },
  ],
};

// ── settings (Phase 20) ───────────────────────────────────────────────────
// A centered settings column: heading over a card of toggle rows with dividers.
/** A settings section: a group header (title + one descriptive line) over a
 * card of rows. */
function settingsSection(id: string, title: string, rows: SceneNode[]): SceneNode {
  return {
    id, type: 'frame', name: title, width: '100%', layout: 'vertical', gap: SPACE.sm,
    children: [
      {
        id: `${id}-head`, type: 'frame', name: 'Section header', width: '100%', layout: 'vertical', gap: SPACE.xxs,
        children: [
          { id: `${id}-title`, type: 'text', content: title, fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary },
          { id: `${id}-desc`, type: 'text', content: 'Section description — to confirm', fontSize: TYPE.textSm, color: COLOR.textSecondary },
        ],
      },
      {
        id: `${id}-card`, type: 'frame', name: 'Card', width: '100%', layout: 'vertical',
        cornerRadius: RADIUS.lg, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, shadow: ELEV.flat,
        children: rows,
      },
    ],
  };
}

const settings: Structure = {
  name: 'settings',
  description:
    'A settings screen with real anatomy — page title, grouped sections (each a header + description over a card of preference rows), a danger zone, and a footer action bar with save/cancel. The error-state story coheres: a failed save has a visible save control to point at.',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    {
      id: 'st-page', type: 'frame', name: 'Page', width: '100%', layout: 'vertical',
      alignItems: 'center', gap: SPACE.lg, padding: SPACE.xl2, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'st-col', type: 'frame', name: 'Column', width: 720, layout: 'vertical', gap: SPACE.xl,
          children: [
            { id: 'st-title', type: 'text', content: 'Settings', fontSize: TYPE.title, color: COLOR.textPrimary },
            settingsSection('st-sec-general', 'General', [
              settingsRow('st-row-1', true),
              { id: 'st-div-1', type: 'frame', width: '100%', height: 1, fill: COLOR.border },
              settingsRow('st-row-2', false),
            ]),
            settingsSection('st-sec-notify', 'Notifications', [
              settingsRow('st-row-3', true),
              { id: 'st-div-2', type: 'frame', width: '100%', height: 1, fill: COLOR.border },
              settingsRow('st-row-4', true),
            ]),
            {
              id: 'st-danger', type: 'frame', name: 'Danger zone', width: '100%', layout: 'vertical', gap: SPACE.sm,
              children: [
                { id: 'st-danger-title', type: 'text', content: 'Danger zone', fontSize: TYPE.body, fontWeight: 600, color: '$danger' },
                {
                  id: 'st-danger-card', type: 'frame', name: 'Card', width: '100%', layout: 'horizontal',
                  alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, padding: SPACE.lg,
                  cornerRadius: RADIUS.lg, fill: COLOR.bgSurface, stroke: '$danger', strokeWidth: 1,
                  children: [
                    {
                      id: 'st-danger-copy', type: 'frame', name: 'Copy', layout: 'vertical', gap: SPACE.xxs,
                      children: [
                        { id: 'st-danger-label', type: 'text', content: 'Destructive action — TBD', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.textPrimary },
                        { id: 'st-danger-desc', type: 'text', content: 'Consequence — to confirm', fontSize: TYPE.textSm, color: COLOR.textSecondary },
                      ],
                    },
                    {
                      id: 'st-danger-btn', type: 'frame', name: 'Destructive button', layout: 'horizontal', alignItems: 'center',
                      justifyContent: 'center', padding: [SPACE.xs, SPACE.md], cornerRadius: RADIUS.sm,
                      fill: 'transparent', stroke: '$danger', strokeWidth: 1,
                      children: [{ id: 'st-danger-btn-label', type: 'text', content: 'Delete — TBD', fontSize: TYPE.textSm, fontWeight: 600, color: '$danger' }],
                    },
                  ],
                },
              ],
            },
            {
              id: 'st-footer', type: 'frame', name: 'Footer actions', width: '100%', layout: 'horizontal',
              justifyContent: 'end', alignItems: 'center', gap: SPACE.xs,
              children: [
                button('st-cancel', 'Cancel', 'transparent', COLOR.textSecondary, COLOR.border),
                button('st-save', 'Save changes', COLOR.accent, COLOR.bgPrimary),
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
      alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: SPACE.xl2, fill: COLOR.bgPrimary,
      children: [
        {
          id: 'ob-glyph', type: 'frame', name: 'Glyph', width: 64, height: 64, cornerRadius: RADIUS.lg,
          fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1,
          layout: 'vertical', alignItems: 'center', justifyContent: 'center',
          children: [{ id: 'ob-glyph-icon', type: 'icon', icon: 'sparkles', iconSize: 28, iconColor: COLOR.accent }],
        },
        { id: 'ob-title', type: 'text', content: 'Get started', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center' },
        { id: 'ob-body', type: 'text', content: 'Body copy — explain the empty state and the next step in a sentence.', fontSize: TYPE.body, color: COLOR.textSecondary, textAlign: 'center', lineHeight: 1.5, maxWidth: 420 },
        {
          id: 'ob-cta', type: 'frame', name: 'Primary action', layout: 'horizontal', alignItems: 'center',
          justifyContent: 'center', padding: [SPACE.xs, SPACE.lg], cornerRadius: RADIUS.sm, fill: COLOR.accent,
          children: [{ id: 'ob-cta-label', type: 'text', content: 'Primary action', fontSize: TYPE.body, fontWeight: 600, color: COLOR.bgPrimary }],
        },
      ],
    },
  ],
};

// ── component structures (Phase 16 slice D) ────────────────────────────────
// Reusable fragments stamped under any target node via apply_structure
// targetId, repeatably — template ids get re-keyed per stamp. Same theming
// split as pages: $space-*/$radius-*/$elevation.* geometry tokens, $color
// tokens (Phase 27 slice B — density used to be literal, now it's tokenized
// too). Placeholder copy only (C8).

const formField: Structure = {
  name: 'form-field',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'A labeled form field: label, input box, and help text. Stamp once per field; set the label/help via the returned id map.',
  nodes: [{
    id: 'ff', type: 'frame', name: 'Form field', width: '100%', layout: 'vertical', gap: SPACE.xs,
    children: [
      { id: 'ff-label', type: 'text', content: 'Field label', fontSize: TYPE.label, fontWeight: 600, color: COLOR.textPrimary },
      {
        id: 'ff-input', type: 'frame', name: 'Input', width: '100%', height: 44, layout: 'horizontal', alignItems: 'center',
        padding: [SPACE.xs, SPACE.md], cornerRadius: RADIUS.sm, fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1,
        children: [{ id: 'ff-placeholder', type: 'text', content: 'Placeholder — to confirm', fontSize: TYPE.body, color: COLOR.textSecondary }],
      },
      { id: 'ff-help', type: 'text', content: 'Help text — to confirm', fontSize: TYPE.caption, color: COLOR.textSecondary },
    ],
  }],
};

const toggleRow: Structure = {
  name: 'toggle-row',
  kind: 'component',
  description: 'A settings row: label + description on the left, a toggle on the right. The workhorse of preference screens.',
  nodes: [{
    id: 'tr', type: 'frame', name: 'Toggle row', width: '100%', layout: 'horizontal', alignItems: 'center',
    justifyContent: 'space-between', gap: SPACE.md, padding: [SPACE.xs, SPACE.md], cornerRadius: RADIUS.md,
    fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: 'tr-copy', type: 'frame', name: 'Copy', layout: 'vertical', gap: SPACE.xs2,
        children: [
          { id: 'tr-label', type: 'text', content: 'Setting label', fontSize: TYPE.label, fontWeight: 600, color: COLOR.textPrimary },
          { id: 'tr-desc', type: 'text', content: 'Setting description — to confirm', fontSize: TYPE.caption, color: COLOR.textSecondary },
        ],
      },
      { id: 'tr-toggle', type: 'toggle', checked: true },
    ],
  }],
};

const statCard: Structure = {
  name: 'stat-card',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'The original name for the KPI-card anatomy (tinted icon tile, uppercase metric label, big tabular value, sparkline, tinted delta pill) — kept as an alias for existing callers. Prefer kpi-card for new work; the two stamp the same structure. Stamp several in a horizontal frame for a stat band.',
  nodes: [stat('sc')],
};

const toolbar: Structure = {
  name: 'toolbar',
  kind: 'component',
  description: 'A list-view toolbar: search field on the left, a filter and a primary action on the right.',
  nodes: [{
    id: 'tb', type: 'frame', name: 'Toolbar', width: '100%', layout: 'horizontal', alignItems: 'center',
    justifyContent: 'space-between', gap: SPACE.md,
    children: [
      {
        id: 'tb-search', type: 'frame', name: 'Search', width: 280, height: 36, minWidth: 0, overflow: 'hidden', layout: 'horizontal', alignItems: 'center',
        gap: SPACE.xs, padding: [SPACE.xs, SPACE.md], cornerRadius: RADIUS.sm, fill: COLOR.bgElevated, stroke: COLOR.border, strokeWidth: 1,
        children: [
          { id: 'tb-search-icon', type: 'icon', icon: 'search', iconSize: 16, iconColor: COLOR.textSecondary },
          { id: 'tb-search-text', type: 'text', content: 'Search — to confirm', fontSize: TYPE.textSm, color: COLOR.textSecondary, textOverflow: 'ellipsis', minWidth: 0 },
        ],
      },
      {
        id: 'tb-actions', type: 'frame', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs,
        children: [
          button('tb-filter', 'Filter', COLOR.bgElevated, COLOR.textPrimary, COLOR.border),
          button('tb-primary', 'Primary action', COLOR.accent, COLOR.bgPrimary),
        ],
      },
    ],
  }],
};

/** A data-table row: identity (avatar + name/email), role chip, status dot,
 * right-aligned numeric cell, actions. */
function tableRow(id: string): SceneNode {
  return {
    id, type: 'frame', name: 'Row', width: '100%', layout: 'horizontal', alignItems: 'center',
    padding: [SPACE.xs, SPACE.md], gap: SPACE.md, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: `${id}-identity`, type: 'frame', width: '34%', minWidth: 0, overflow: 'hidden', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs,
        children: [
          { id: `${id}-avatar`, type: 'ellipse', width: 32, height: 32, fill: COLOR.bgElevated },
          {
            id: `${id}-id-copy`, type: 'frame', name: 'Identity', layout: 'vertical', minWidth: 0,
            children: [
              { id: `${id}-name`, type: 'text', content: 'Name — to confirm', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.textPrimary, textOverflow: 'ellipsis' },
              { id: `${id}-email`, type: 'text', content: 'email — to confirm', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
            ],
          },
        ],
      },
      {
        id: `${id}-role`, type: 'frame', width: '18%', layout: 'horizontal', minWidth: 0,
        children: [{
          id: `${id}-role-chip`, type: 'frame', layout: 'horizontal', alignItems: 'center', padding: [SPACE.xs2, SPACE.xs],
          cornerRadius: 999, fill: COLOR.bgElevated, minWidth: 0, overflow: 'hidden',
          children: [{ id: `${id}-role-text`, type: 'text', content: 'Role', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis' }],
        }],
      },
      {
        id: `${id}-status`, type: 'frame', width: '18%', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2, minWidth: 0,
        children: [
          { id: `${id}-status-dot`, type: 'ellipse', width: 8, height: 8, fill: '$success' },
          { id: `${id}-status-text`, type: 'text', content: 'Status', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
        ],
      },
      {
        // The identity cell above has carried minWidth + ellipsis since Phase 29;
        // these three columns never got it, and overflowed on Linux where the
        // fonts are wider than the macOS metrics the sweep was run against.
        id: `${id}-amount`, type: 'frame', width: '18%', layout: 'horizontal', justifyContent: 'end', minWidth: 0,
        children: [{ id: `${id}-amount-text`, type: 'text', content: 'Amount — TBD', fontSize: TYPE.textSm, color: COLOR.textPrimary, tabularNums: true, textOverflow: 'ellipsis' }],
      },
      {
        id: `${id}-actions`, type: 'frame', width: '12%', layout: 'horizontal', justifyContent: 'end',
        children: [{ id: `${id}-actions-icon`, type: 'icon', icon: 'ellipsis', iconSize: 18, iconColor: COLOR.textSecondary }],
      },
    ],
  };
}

function tableHeaderCell(id: string, label: string, width: string, alignEnd = false): SceneNode {
  return {
    id, type: 'frame', width, minWidth: 0, overflow: 'hidden', layout: 'horizontal', ...(alignEnd ? { justifyContent: 'end' as const } : {}),
    children: [{ id: `${id}-text`, type: 'text', content: label, fontSize: TYPE.caption, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: COLOR.textSecondary, tabularNums: true, textOverflow: 'ellipsis', minWidth: 0 }],
  };
}

const dataTable: Structure = {
  name: 'data-table',
  kind: 'component',
  description: 'A high-fidelity data table: header row, three placeholder rows (avatar + name/email, role chip, status dot, right-aligned numeric cell, actions), and a pagination footer. Copy rows with batch_design C ops to extend; ~90 hand-placed nodes for free.',
  nodes: [{
    id: 'dt', type: 'frame', name: 'Data table', width: '100%', layout: 'vertical',
    cornerRadius: RADIUS.md, overflow: 'hidden', fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, shadow: ELEV.flat,
    children: [
      {
        id: 'dt-header', type: 'frame', name: 'Header', width: '100%', layout: 'horizontal', alignItems: 'center',
        padding: [SPACE.xs, SPACE.md], gap: SPACE.md, fill: COLOR.bgElevated,
        children: [
          tableHeaderCell('dt-h-identity', 'Name', '34%'),
          tableHeaderCell('dt-h-role', 'Role', '18%'),
          tableHeaderCell('dt-h-status', 'Status', '18%'),
          tableHeaderCell('dt-h-amount', 'Amount', '18%', true),
          tableHeaderCell('dt-h-actions', 'Actions', '12%', true),
        ],
      },
      tableRow('dt-r1'),
      tableRow('dt-r2'),
      tableRow('dt-r3'),
      {
        id: 'dt-footer', type: 'frame', name: 'Pagination', width: '100%', layout: 'horizontal',
        alignItems: 'center', justifyContent: 'space-between', padding: [SPACE.xs, SPACE.md], fill: COLOR.bgElevated,
        children: [
          { id: 'dt-count', type: 'text', content: 'Row count — TBD', fontSize: TYPE.caption, color: COLOR.textSecondary, tabularNums: true },
          {
            id: 'dt-pager', type: 'frame', name: 'Pager', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
            children: [
              {
                id: 'dt-prev', type: 'frame', name: 'Previous page', width: 28, height: 28, cornerRadius: RADIUS.sm,
                fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
                layout: 'vertical', alignItems: 'center', justifyContent: 'center',
                children: [{ id: 'dt-prev-icon', type: 'icon', icon: 'chevron-left', iconSize: 14, iconColor: COLOR.textSecondary }],
              },
              {
                id: 'dt-next', type: 'frame', name: 'Next page', width: 28, height: 28, cornerRadius: RADIUS.sm,
                fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
                layout: 'vertical', alignItems: 'center', justifyContent: 'center',
                children: [{ id: 'dt-next-icon', type: 'icon', icon: 'chevron-right', iconSize: 14, iconColor: COLOR.textSecondary }],
              },
            ],
          },
        ],
      },
    ],
  }],
};


// ── Phase 24 slice B — state scaffolds ──────────────────────────────────────
// The cheap way to satisfy the coverage demand (slice C): a designed empty
// state and skeleton loading treatments are one stamp each, not hand-builds.

const emptyState: Structure = {
  name: 'empty-state',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'A designed empty state: icon, title, one-line hint, primary action. Stamp it where the data would be — an empty screen is a first-run experience, never a bare void.',
  nodes: [{
    id: 'es', type: 'frame', name: 'Empty state', width: '100%', layout: 'vertical', alignItems: 'center',
    gap: SPACE.xs, padding: [SPACE.xl2, SPACE.lg],
    children: [
      { id: 'es-icon', type: 'icon', icon: 'inbox', iconSize: 28, iconColor: COLOR.textSecondary },
      { id: 'es-title', type: 'text', content: 'Nothing here yet', fontSize: TYPE.body, fontWeight: 600, color: COLOR.textPrimary },
      // $text-sm, not $caption: nine words of prose at 12px are below the iOS
      // Footnote floor, so the hint failed mobile-type-floor on a phone.
      { id: 'es-hint', type: 'text', content: 'Items you create will show up here — to confirm', fontSize: TYPE.textSm, color: COLOR.textSecondary },
      {
        id: 'es-cta', type: 'frame', name: 'CTA', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs,
        padding: [SPACE.xs, SPACE.md], cornerRadius: RADIUS.sm, fill: COLOR.accent, width: 'fit-content',
        children: [
          // bg-primary as on-accent text is theme-adaptive: near-white on the
          // dark accent in light mode, near-black on the light accent in dark
          // mode (the tier() CTA convention — a literal white breaks in dark).
          { id: 'es-cta-icon', type: 'icon', icon: 'plus', iconSize: 14, iconColor: COLOR.bgPrimary },
          { id: 'es-cta-label', type: 'text', content: 'Create item', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.bgPrimary },
        ],
      },
    ],
  }],
};

/** One skeleton row matching the data-table column geometry (40/20/25/15). */
function skeletonRow(id: string): SceneNode {
  const cell = (cid: string, width: string, barWidth: string, alignEnd = false): SceneNode => ({
    id: cid, type: 'frame', width, layout: 'horizontal', ...(alignEnd ? { justifyContent: 'end' as const } : {}),
    children: [{ id: `${cid}-bar`, type: 'skeleton', width: barWidth, height: 12 }],
  });
  return {
    id, type: 'frame', name: 'Skeleton row', width: '100%', layout: 'horizontal', alignItems: 'center',
    padding: [SPACE.sm, SPACE.md], gap: SPACE.md, borderTop: { width: 1, color: COLOR.border },
    children: [
      {
        id: `${id}-identity`, type: 'frame', width: '40%', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs,
        children: [
          { id: `${id}-avatar`, type: 'skeleton', width: 32, height: 32, cornerRadius: RADIUS.lg },
          { id: `${id}-name`, type: 'skeleton', width: '55%', height: 12 },
        ],
      },
      cell(`${id}-role`, '20%', '70%'),
      cell(`${id}-status`, '25%', '45%'),
      cell(`${id}-actions`, '15%', '40%', true),
    ],
  };
}

const skeletonTable: Structure = {
  name: 'skeleton-table',
  kind: 'component',
  description: 'Loading state for a data table: the real header row plus skeleton rows matching data-table geometry, so the loaded table lands without layout shift. Pulses subtly in the live viewer; always static in screenshots.',
  nodes: [{
    id: 'skt', type: 'frame', name: 'Skeleton table', width: '100%', layout: 'vertical',
    cornerRadius: RADIUS.md, overflow: 'hidden', fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: 'skt-header', type: 'frame', name: 'Header', width: '100%', layout: 'horizontal', alignItems: 'center',
        padding: [SPACE.xs, SPACE.md], gap: SPACE.md, fill: COLOR.bgElevated,
        children: [
          tableHeaderCell('skt-h-identity', 'Name', '40%'),
          tableHeaderCell('skt-h-role', 'Role', '20%'),
          tableHeaderCell('skt-h-status', 'Status', '25%'),
          tableHeaderCell('skt-h-actions', 'Actions', '15%', true),
        ],
      },
      skeletonRow('skt-row1'),
      skeletonRow('skt-row2'),
      skeletonRow('skt-row3'),
      skeletonRow('skt-row4'),
    ],
  }],
};

const skeletonCard: Structure = {
  name: 'skeleton-card',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'Loading state for a card: media block, title bar, and two text lines as skeletons — same silhouette as the loaded card.',
  nodes: [{
    id: 'skc', type: 'frame', name: 'Skeleton card', width: '100%', layout: 'vertical', gap: SPACE.sm,
    padding: SPACE.md, cornerRadius: RADIUS.md, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      { id: 'skc-media', type: 'skeleton', width: '100%', height: 120, cornerRadius: RADIUS.sm },
      { id: 'skc-title', type: 'skeleton', width: '60%', height: 14 },
      { id: 'skc-line1', type: 'skeleton', width: '100%', height: 10 },
      { id: 'skc-line2', type: 'skeleton', width: '80%', height: 10 },
    ],
  }],
};

const skeletonStatCard: Structure = {
  name: 'skeleton-stat-card',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'Loading state for a stat card: label bar, value bar, and delta bar as skeletons — same silhouette as the loaded stat. Stamp one per stat in the row so a loading dashboard skeletons EVERY data surface, not just the table.',
  nodes: [{
    id: 'sks', type: 'frame', name: 'Skeleton stat', width: 300, layout: 'vertical', gap: SPACE.sm,
    padding: SPACE.md, cornerRadius: RADIUS.md, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, shadow: ELEV.flat,
    children: [
      {
        id: 'sks-head', type: 'frame', width: '100%', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs,
        children: [
          { id: 'sks-tile', type: 'skeleton', width: 30, height: 30, cornerRadius: RADIUS.sm },
          { id: 'sks-label', type: 'skeleton', width: '40%', height: 10 },
        ],
      },
      {
        id: 'sks-vr', type: 'frame', width: '100%', layout: 'horizontal', alignItems: 'end', justifyContent: 'space-between', gap: SPACE.sm,
        children: [
          { id: 'sks-value', type: 'skeleton', width: '45%', height: 24 },
          { id: 'sks-spark', type: 'skeleton', width: 64, height: 26 },
        ],
      },
      { id: 'sks-delta', type: 'skeleton', width: '55%', height: 10 },
    ],
  }],
};

// ── Phase 28 slice D — dashboard micro-patterns ─────────────────────────────
// The five patterns the reference attempt hand-built. All on the tint pair
// (tint fill + base ink) and the chart vocabulary; customize via idMap.

const kpiCard: Structure = {
  name: 'kpi-card',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'A reference-grade KPI card: tinted icon tile + uppercase metric label, big tabular value with inline context, a live sparkline, and a tinted delta pill. The dashboard structure stamps these; customize copy/data via the idMap.',
  nodes: [stat('kpi')],
};

const statusChip: Structure = {
  name: 'status-chip',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'A status chip on the tint pair: soft tinted pill + icon + label in the matching ink (fill "$success-tint" + color "$success" — AA by construction both themes). Swap the tint/ink pair and icon per status via the idMap.',
  nodes: [{
    id: 'chip', type: 'frame', name: 'Status chip', layout: 'horizontal', alignItems: 'center',
    gap: SPACE.xs2, padding: [2, SPACE.xs], cornerRadius: 999, fill: TINT.success.bg, overflow: 'hidden',
    children: [
      { id: 'chip-icon', type: 'icon', icon: 'circle-check', iconSize: 12, iconColor: TINT.success.ink },
      { id: 'chip-label', type: 'text', content: 'Status — TBD', fontSize: TYPE.caption, fontWeight: 600, color: TINT.success.ink, textOverflow: 'ellipsis' },
    ],
  }],
};

const segmentedControl: Structure = {
  name: 'segmented-control',
  kind: 'component',
  description: 'A segmented range control (7D / 15D / All): one raised active segment on an elevated track. Set the active segment by moving the surface fill + weight; label via the idMap.',
  nodes: [{
    id: 'seg', type: 'frame', name: 'Segmented control', layout: 'horizontal', alignItems: 'center',
    padding: 2, cornerRadius: RADIUS.sm, fill: COLOR.bgElevated,
    children: [
      {
        id: 'seg-a', type: 'frame', name: 'Segment A', layout: 'horizontal', padding: [SPACE.xs2, SPACE.sm], cornerRadius: 6,
        fill: COLOR.bgSurface, shadow: ELEV.flat,
        children: [{ id: 'seg-a-label', type: 'text', content: 'Option A', fontSize: TYPE.caption, fontWeight: 600, color: COLOR.textPrimary, tabularNums: true }],
      },
      {
        id: 'seg-b', type: 'frame', name: 'Segment B', layout: 'horizontal', padding: [SPACE.xs2, SPACE.sm], cornerRadius: 6,
        children: [{ id: 'seg-b-label', type: 'text', content: 'Option B', fontSize: TYPE.caption, fontWeight: 500, color: COLOR.textSecondary, tabularNums: true }],
      },
      {
        id: 'seg-c', type: 'frame', name: 'Segment C', layout: 'horizontal', padding: [SPACE.xs2, SPACE.sm], cornerRadius: 6,
        children: [{ id: 'seg-c-label', type: 'text', content: 'Option C', fontSize: TYPE.caption, fontWeight: 500, color: COLOR.textSecondary, tabularNums: true }],
      },
    ],
  }],
};

const breadcrumb: Structure = {
  name: 'breadcrumb',
  kind: 'component',
  description: 'A two-level breadcrumb: muted parent, chevron, bold current page. Extend by copying the parent+chevron pair via batch_design.',
  nodes: [{
    id: 'crumb', type: 'frame', name: 'Breadcrumb', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
    children: [
      { id: 'crumb-parent', type: 'text', content: 'Parent', fontSize: TYPE.textSm, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
      { id: 'crumb-sep', type: 'icon', icon: 'chevron-right', iconSize: 14, iconColor: COLOR.textSecondary },
      { id: 'crumb-current', type: 'text', content: 'Current page', fontSize: TYPE.textSm, fontWeight: 600, color: COLOR.textPrimary, textOverflow: 'ellipsis' },
    ],
  }],
};

const initialsAvatar: Structure = {
  name: 'initials-avatar',
  kind: 'component',
  surface: 'any', // passes the mobile gate (FR-E4) on a phone canvas
  description: 'An initials avatar on the tint pair: tinted circle + two-letter monogram in the matching ink. Size/tint/initials via the idMap.',
  nodes: [{
    id: 'av', type: 'frame', name: 'Avatar', width: 32, height: 32, cornerRadius: 999, overflow: 'hidden',
    fill: TINT.accent.bg, layout: 'vertical', alignItems: 'center', justifyContent: 'center',
    children: [{ id: 'av-initials', type: 'text', content: 'AB', fontSize: TYPE.caption, fontWeight: 700, color: TINT.accent.ink, textOverflow: 'ellipsis', minWidth: 0 }],
  }],
};

// ── mobile realisations (Phase 30 slice E) ─────────────────────────────────
// One per anatomy, for a phone canvas. Every tap target and every piece of
// device chrome is a primitive (status-bar, nav-bar, list-row, button,
// tab-bar, home-indicator), so the 44px target, safe-area and tab-bar rules
// hold by construction; frames, text and icons only lay out and label. None
// writes `safeArea`: pinned chrome makes the renderer reserve the insets on
// any root, so a stamp on a canvas re-declared mobile is still correct.

const statusBar = (id: string): SceneNode => ({ id, type: 'status-bar', name: 'Status bar' });
const homeIndicator = (id: string): SceneNode => ({ id, type: 'home-indicator', name: 'Home indicator' });

/** The phone content column: full width, the 16px side margin. */
function mobileContent(id: string, children: SceneNode[], extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id, type: 'frame', name: 'Content', width: '100%', layout: 'vertical', gap: SPACE.lg,
    padding: [SPACE.xs, SPACE.md, SPACE.lg, SPACE.md], children, ...extra,
  };
}

/** A grouped list: an optional caption over a rounded card of list rows. */
function rowGroup(id: string, title: string | undefined, rows: SceneNode[]): SceneNode {
  return {
    id, type: 'frame', name: title ?? 'Group', width: '100%', layout: 'vertical', gap: SPACE.xs,
    children: [
      ...(title ? [{ id: `${id}-title`, type: 'text' as const, content: title, fontSize: TYPE.label, fontWeight: 600, color: COLOR.textSecondary }] : []),
      {
        id: `${id}-card`, type: 'frame', name: 'Card', width: '100%', layout: 'vertical',
        cornerRadius: RADIUS.lg, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, overflow: 'hidden',
        children: rows.map((r, i) => (i < rows.length - 1 ? { ...r, divider: true } : r)),
      },
    ],
  };
}

/** A section header row: a title and a trailing ghost action. */
function sectionHead(id: string, title: string, action: string): SceneNode {
  return {
    id, type: 'frame', name: 'Section header', width: '100%', layout: 'horizontal',
    alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm,
    children: [
      { id: `${id}-title`, type: 'text', content: title, fontSize: TYPE.textLg, fontWeight: 600, color: COLOR.textPrimary, textOverflow: 'ellipsis', minWidth: 0 },
      { id: `${id}-action`, type: 'button', label: action, variant: 'ghost', maxWidth: '50%' },
    ],
  };
}

/** A compact metric tile for the phone summary row. */
function mobileStat(id: string, icon: string): SceneNode {
  return {
    id, type: 'frame', name: 'Stat', width: '100%', minWidth: 0, layout: 'vertical', gap: SPACE.xs,
    padding: SPACE.md, cornerRadius: RADIUS.lg, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1,
    children: [
      {
        id: `${id}-head`, type: 'frame', name: 'Label row', width: '100%', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs,
        children: [
          { id: `${id}-icon`, type: 'icon', icon, iconSize: 16, iconColor: COLOR.accent },
          { id: `${id}-label`, type: 'text', content: 'Stat label', fontSize: TYPE.caption, color: COLOR.textSecondary, textOverflow: 'ellipsis', minWidth: 0 },
        ],
      },
      { id: `${id}-value`, type: 'text', content: 'Value — TBD', fontSize: TYPE.textLg, fontWeight: 700, color: COLOR.textPrimary, tabularNums: true, textOverflow: 'ellipsis', minWidth: 0 },
    ],
  };
}

const dashboardMobile: Structure = {
  name: 'dashboard-mobile',
  anatomy: 'dashboard',
  surface: 'mobile',
  description:
    'Phone summary home — large-title nav bar, a headline metric card, a two-up stat row, a recent-items list of rows, and a pinned four-tab bar. The mobile realisation of dashboard. No fabricated numbers.',
  axes: { heroTreatment: 'stat-led', density: 'balanced', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    statusBar('dm-status'),
    { id: 'dm-nav', type: 'nav-bar', name: 'Nav bar', title: 'Today', largeTitle: true, trailing: [{ icon: 'bell' }] },
    mobileContent('dm-content', [
      {
        id: 'dm-hero', type: 'frame', name: 'Headline metric', width: '100%', layout: 'vertical', gap: SPACE.xs,
        padding: SPACE.lg, cornerRadius: RADIUS.lg, fill: COLOR.bgSurface, stroke: COLOR.border, strokeWidth: 1, shadow: ELEV.flat,
        children: [
          { id: 'dm-hero-label', type: 'text', content: 'Metric label', fontSize: TYPE.label, fontWeight: 600, color: COLOR.textSecondary, textOverflow: 'ellipsis' },
          { id: 'dm-hero-value', type: 'text', content: 'Metric — TBD', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary, tabularNums: true, textOverflow: 'ellipsis' },
          {
            id: 'dm-hero-delta', type: 'frame', name: 'Delta', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs2,
            padding: [2, SPACE.xs], cornerRadius: 999, fill: TINT.success.bg, overflow: 'hidden',
            children: [
              { id: 'dm-hero-delta-icon', type: 'icon', icon: 'trending-up', iconSize: 14, iconColor: TINT.success.ink },
              { id: 'dm-hero-delta-text', type: 'text', content: 'Change — TBD', fontSize: TYPE.caption, fontWeight: 600, color: COLOR.textPrimary, textOverflow: 'ellipsis' },
            ],
          },
        ],
      },
      {
        id: 'dm-stats', type: 'frame', name: 'Stat row', width: '100%', layout: 'horizontal', gap: SPACE.sm,
        children: [mobileStat('dm-stat-1', 'activity'), mobileStat('dm-stat-2', 'calendar')],
      },
      {
        id: 'dm-recent', type: 'frame', name: 'Recent', width: '100%', layout: 'vertical', gap: SPACE.xs,
        children: [
          sectionHead('dm-recent-head', 'Recent', 'See all'),
          rowGroup('dm-recent-list', undefined, [1, 2, 3].map((i) => ({
            id: `dm-row-${i}`, type: 'list-row' as const, title: 'Item title', subtitle: 'Supporting detail',
            leading: { icon: ['activity', 'heart', 'compass'][i - 1] }, trailing: { text: 'Meta' },
          }))),
        ],
      },
    ]),
    {
      id: 'dm-tabs', type: 'tab-bar', name: 'Tab bar',
      items: [
        { icon: 'house', label: 'Home', active: true },
        { icon: 'activity', label: 'Activity' },
        { icon: 'chart-column', label: 'Insights' },
        { icon: 'user', label: 'Profile' },
      ],
    },
  ],
};

const settingsMobile: Structure = {
  name: 'settings-mobile',
  anatomy: 'settings',
  surface: 'mobile',
  description:
    'Phone settings — large-title nav bar over grouped list rows (toggles, values, disclosure chevrons), an account group, and a destructive sign-out button. The mobile realisation of settings.',
  axes: { heroTreatment: 'none', density: 'balanced', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    statusBar('sm-status'),
    { id: 'sm-nav', type: 'nav-bar', name: 'Nav bar', title: 'Settings', largeTitle: true },
    mobileContent('sm-content', [
      rowGroup('sm-general', 'General', [
        { id: 'sm-row-1', type: 'list-row', title: 'Preference label', leading: { icon: 'bell' }, trailing: { toggle: true } },
        { id: 'sm-row-2', type: 'list-row', title: 'Preference label', leading: { icon: 'moon' }, trailing: { toggle: false } },
        { id: 'sm-row-3', type: 'list-row', title: 'Preference label', leading: { icon: 'globe' }, trailing: { text: 'Value' } },
      ]),
      rowGroup('sm-account', 'Account', [
        { id: 'sm-row-4', type: 'list-row', title: 'Account detail', subtitle: 'Current value — to confirm', leading: { icon: 'user' }, trailing: { chevron: true } },
        { id: 'sm-row-5', type: 'list-row', title: 'Account detail', leading: { icon: 'lock' }, trailing: { chevron: true } },
        { id: 'sm-row-6', type: 'list-row', title: 'Account detail', leading: { icon: 'credit-card' }, trailing: { chevron: true } },
      ]),
      { id: 'sm-signout', type: 'button', name: 'Sign out', label: 'Sign out', variant: 'destructive', width: '100%' },
      { id: 'sm-version', type: 'text', content: 'Version — TBD', fontSize: TYPE.caption, color: COLOR.textSecondary, textAlign: 'center', width: '100%' },
    ]),
    homeIndicator('sm-home'),
  ],
};

const authMobile: Structure = {
  name: 'auth-mobile',
  anatomy: 'auth',
  surface: 'mobile',
  description:
    'Phone sign-in — a title and supporting line, two form fields, and a full-width primary button with a secondary action held at the bottom of the screen. The mobile realisation of auth.',
  axes: { heroTreatment: 'none', density: 'airy', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    statusBar('amb-status'),
    {
      id: 'amb-content', type: 'frame', name: 'Content', width: '100%', height: '100%', layout: 'vertical',
      justifyContent: 'space-between', gap: SPACE.xl, padding: [SPACE.lg, SPACE.md],
      children: [
        {
          id: 'amb-form', type: 'frame', name: 'Form', width: '100%', layout: 'vertical', gap: SPACE.lg,
          children: [
            {
              id: 'amb-head', type: 'frame', width: '100%', layout: 'vertical', gap: SPACE.xs,
              children: [
                { id: 'amb-title', type: 'text', content: 'Sign in', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary },
                { id: 'amb-sub', type: 'text', content: 'Body copy — one supporting line.', fontSize: TYPE.body, color: COLOR.textSecondary, lineHeight: 1.5 },
              ],
            },
            {
              id: 'amb-fields', type: 'frame', width: '100%', layout: 'vertical', gap: SPACE.md,
              children: [field('amb-email', 'Email'), field('amb-password', 'Password')],
            },
          ],
        },
        {
          id: 'amb-actions', type: 'frame', name: 'Actions', width: '100%', layout: 'vertical', gap: SPACE.xs,
          children: [
            { id: 'amb-submit', type: 'button', name: 'Submit', label: 'Continue', size: 'lg', width: '100%' },
            { id: 'amb-alt', type: 'button', name: 'Secondary action', label: 'Secondary action', variant: 'ghost', width: '100%' },
          ],
        },
      ],
    },
    homeIndicator('amb-home'),
  ],
};

const onboardingMobile: Structure = {
  name: 'onboarding-mobile',
  anatomy: 'onboarding',
  surface: 'mobile',
  description:
    'Phone onboarding page — a skip action, a centred glyph, heading and body line, page dots, and a full-width continue button at the bottom. One page of a paged first-run flow. The mobile realisation of onboarding.',
  axes: { heroTreatment: 'none', density: 'airy', rhythm: 'uniform', alignment: 'centered' },
  nodes: [
    statusBar('om-status'),
    {
      id: 'om-content', type: 'frame', name: 'Content', width: '100%', height: '100%', layout: 'vertical',
      gap: SPACE.lg, padding: [SPACE.xs, SPACE.md, SPACE.lg, SPACE.md],
      children: [
        {
          id: 'om-top', type: 'frame', name: 'Top bar', width: '100%', layout: 'horizontal', justifyContent: 'end',
          children: [{ id: 'om-skip', type: 'button', name: 'Skip', label: 'Skip', variant: 'ghost' }],
        },
        {
          id: 'om-page', type: 'frame', name: 'Page', width: '100%', height: '100%', layout: 'vertical',
          alignItems: 'center', justifyContent: 'center', gap: SPACE.md,
          children: [
            {
              id: 'om-glyph', type: 'frame', name: 'Glyph', width: 96, height: 96, cornerRadius: RADIUS.lg,
              fill: TINT.accent.bg, layout: 'vertical', alignItems: 'center', justifyContent: 'center',
              children: [{ id: 'om-glyph-icon', type: 'icon', icon: 'sparkles', iconSize: 40, iconColor: TINT.accent.ink }],
            },
            { id: 'om-title', type: 'text', content: 'Page heading', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center' },
            { id: 'om-body', type: 'text', content: 'Body copy — what this step offers, in a sentence.', fontSize: TYPE.body, color: COLOR.textSecondary, textAlign: 'center', lineHeight: 1.5, maxWidth: 320 },
            {
              id: 'om-dots', type: 'frame', name: 'Page dots', layout: 'horizontal', alignItems: 'center', gap: SPACE.xs,
              children: [
                { id: 'om-dot-1', type: 'frame', width: 24, height: 8, cornerRadius: 999, fill: COLOR.accent },
                { id: 'om-dot-2', type: 'frame', width: 8, height: 8, cornerRadius: 999, fill: COLOR.border },
                { id: 'om-dot-3', type: 'frame', width: 8, height: 8, cornerRadius: 999, fill: COLOR.border },
              ],
            },
          ],
        },
        { id: 'om-next', type: 'button', name: 'Continue', label: 'Continue', size: 'lg', width: '100%' },
      ],
    },
    homeIndicator('om-home'),
  ],
};

const feedMobile: Structure = {
  name: 'feed-mobile',
  anatomy: 'feed',
  surface: 'mobile',
  description:
    'Phone feed — large-title nav bar with search and compose actions over a full-bleed list of rows (author monogram, title, one-line preview, time), with a pinned four-tab bar. A mobile-first anatomy.',
  axes: { heroTreatment: 'none', density: 'dense', rhythm: 'uniform', alignment: 'left' },
  nodes: [
    statusBar('fm-status'),
    { id: 'fm-nav', type: 'nav-bar', name: 'Nav bar', title: 'Feed', largeTitle: true, trailing: [{ icon: 'search' }, { icon: 'square-pen' }] },
    {
      id: 'fm-list', type: 'frame', name: 'List', width: '100%', layout: 'vertical',
      children: [1, 2, 3, 4, 5, 6].map((i) => ({
        id: `fm-row-${i}`, type: 'list-row' as const, title: 'Author name', subtitle: 'Preview line — to confirm',
        leading: { initials: 'AB' }, trailing: { text: 'Time' }, divider: i < 6,
      })),
    },
    {
      id: 'fm-tabs', type: 'tab-bar', name: 'Tab bar',
      items: [
        { icon: 'house', label: 'Feed', active: true },
        { icon: 'search', label: 'Search' },
        { icon: 'inbox', label: 'Inbox' },
        { icon: 'user', label: 'Profile' },
      ],
    },
  ],
};

const detailMobile: Structure = {
  name: 'detail-mobile',
  anatomy: 'detail',
  surface: 'mobile',
  description:
    'Phone item detail — a back nav bar with a share action, a media slot, title and meta, a body paragraph, an attribute list of rows, and a primary action pinned over the home indicator. A mobile-first anatomy.',
  axes: { heroTreatment: 'split', density: 'balanced', rhythm: 'asymmetric', alignment: 'left' },
  nodes: [
    statusBar('dtm-status'),
    { id: 'dtm-nav', type: 'nav-bar', name: 'Nav bar', title: 'Item', leading: { label: 'Back' }, trailing: [{ icon: 'share' }] },
    mobileContent('dtm-content', [
      {
        id: 'dtm-media', type: 'frame', name: 'Media slot', width: '100%', height: 220, cornerRadius: RADIUS.lg,
        fill: TINT.neutral.bg, layout: 'vertical', alignItems: 'center', justifyContent: 'center',
        children: [{ id: 'dtm-media-icon', type: 'icon', icon: 'image', iconSize: 32, iconColor: TINT.neutral.ink }],
      },
      {
        id: 'dtm-head', type: 'frame', width: '100%', layout: 'vertical', gap: SPACE.xs,
        children: [
          { id: 'dtm-title', type: 'text', content: 'Item title', fontSize: TYPE.title, fontWeight: 700, color: COLOR.textPrimary },
          { id: 'dtm-meta', type: 'text', content: 'Meta — TBD', fontSize: TYPE.label, color: COLOR.textSecondary },
        ],
      },
      { id: 'dtm-body', type: 'text', content: 'Body copy — describe the item in two or three sentences so the reader knows what acting on it means.', fontSize: TYPE.body, color: COLOR.textSecondary, lineHeight: 1.5 },
      rowGroup('dtm-attrs', 'Details', [1, 2, 3].map((i) => ({
        id: `dtm-attr-${i}`, type: 'list-row' as const, title: 'Attribute', trailing: { text: 'Value' },
      }))),
      // Clears the pinned bar at the end of the scroll: with the root's 34px
      // inset it reaches the bar's 110px (12 + 52 + 46).
      { id: 'dtm-end', type: 'frame', name: 'End spacer', width: '100%', height: 76 },
    ]),
    {
      id: 'dtm-bar', type: 'frame', name: 'Action bar', position: 'fixed', bottom: 0, width: '100%',
      // Vertical rhythm in spacer frames, not padding, so the bar is 110px
      // tall on every spacing scale and the end spacer above stays exact.
      layout: 'vertical', padding: [0, SPACE.md], fill: COLOR.bgSurface, borderTop: { width: 1, color: COLOR.border },
      children: [
        { id: 'dtm-bar-top', type: 'frame', name: 'Top spacer', width: '100%', height: 12 },
        { id: 'dtm-cta', type: 'button', name: 'Primary action', label: 'Primary action', size: 'lg', width: '100%' },
        { id: 'dtm-bar-inset', type: 'frame', name: 'Home indicator inset', width: '100%', height: 46 },
      ],
    },
    homeIndicator('dtm-home'),
  ],
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
  // Phase 24 slice B — state scaffolds
  ['empty-state', emptyState],
  ['skeleton-table', skeletonTable],
  ['skeleton-card', skeletonCard],
  ['skeleton-stat-card', skeletonStatCard],
  // Phase 28 — dashboard micro-patterns
  ['kpi-card', kpiCard],
  ['status-chip', statusChip],
  ['segmented-control', segmentedControl],
  ['breadcrumb', breadcrumb],
  ['initials-avatar', initialsAvatar],
  // Phase 30 slice E — mobile realisations
  ['dashboard-mobile', dashboardMobile],
  ['settings-mobile', settingsMobile],
  ['auth-mobile', authMobile],
  ['onboarding-mobile', onboardingMobile],
  ['feed-mobile', feedMobile],
  ['detail-mobile', detailMobile],
]);

// ── anatomy and realisation (Phase 30 slice E) ──────────────────────────────
// A structure realises an anatomy (a screen kind) for one surface. Names stay
// unique; `apply_structure` resolves an anatomy name to the realisation for
// the canvas's type, so `dashboard` on a phone canvas stamps `dashboard-mobile`.

type StructureSurface = NonNullable<Structure['surface']>;

export const structureAnatomy = (s: Structure): string => s.anatomy ?? s.name;
export const structureSurface = (s: Structure): StructureSurface => s.surface ?? 'web';

/** A realisation's surface covers a canvas type when it is that type or `any`. */
const covers = (surface: StructureSurface, type: SurfaceType): boolean => surface === 'any' || surface === type;

/** The registry invariant: (anatomy, surface) is unique, `any` overlapping
 * both types, and no name shadows another structure's anatomy (anatomy
 * resolution runs first, so such a structure could never be reached by name). */
function checkRegistry(structures: Structure[]): void {
  for (const [i, a] of structures.entries()) {
    for (const b of structures.slice(i + 1)) {
      const sameAnatomy = structureAnatomy(a) === structureAnatomy(b);
      if (sameAnatomy && SURFACE_TYPES.some((t) => covers(structureSurface(a), t) && covers(structureSurface(b), t))) {
        throw new Error(`Structures "${a.name}" and "${b.name}" both realise anatomy "${structureAnatomy(a)}" on the same surface.`);
      }
      for (const [x, y] of [[a, b], [b, a]]) {
        if (x.name === structureAnatomy(y) && structureAnatomy(x) !== x.name) {
          throw new Error(`Structure "${x.name}" is named after the anatomy of "${y.name}" but realises "${structureAnatomy(x)}".`);
        }
      }
    }
  }
}
checkRegistry([...structureMap.values()]);

export interface StructureListing {
  name: string;
  kind: 'page' | 'component';
  description: string;
  axes?: StructureAxes;
  anatomy: string;
  surface: StructureSurface;
  /** The canvas types this entry's anatomy has a realisation for. */
  surfaces: SurfaceType[];
}

/** Every structure, or with `type` only those that stamp on that canvas type. */
export function listStructures(opts: { type?: SurfaceType } = {}): StructureListing[] {
  const all = Array.from(structureMap.values());
  const realisedOn = (anatomy: string): SurfaceType[] =>
    SURFACE_TYPES.filter((t) => all.some((s) => structureAnatomy(s) === anatomy && covers(structureSurface(s), t)));
  return all
    .filter((s) => opts.type === undefined || covers(structureSurface(s), opts.type))
    .map((s) => ({
      name: s.name,
      kind: s.kind ?? 'page',
      description: s.description,
      ...(s.axes ? { axes: s.axes } : {}),
      anatomy: structureAnatomy(s),
      surface: structureSurface(s),
      surfaces: realisedOn(structureAnatomy(s)),
    }));
}

export function getStructure(name: string): Structure | undefined {
  return structureMap.get(name);
}

export function registerStructure(structure: Structure): void {
  checkRegistry([...[...structureMap.values()].filter((s) => s.name !== structure.name), structure]);
  structureMap.set(structure.name, structure);
}

/** The structure a name stamps on a canvas of `type`: an anatomy name picks
 * its realisation for the type; any other name must cover the type itself.
 * @throws naming what is available when nothing fits. */
export function resolveStructure(name: string, type: SurfaceType): Structure {
  const all = Array.from(structureMap.values());
  const other: SurfaceType = type === 'web' ? 'mobile' : 'web';
  const available = (kind: Structure['kind']): string => {
    const k = kind ?? 'page';
    const names = [...new Set(all.filter((s) => (s.kind ?? 'page') === k && covers(structureSurface(s), type)).map(structureAnatomy))];
    return names.length > 0
      ? `${k === 'page' ? 'Page' : 'Component'} anatomies with a ${type} realisation: ${names.join(', ')}.`
      : `No ${k} structure has a ${type} realisation.`;
  };

  const realisations = all.filter((s) => structureAnatomy(s) === name);
  if (realisations.length > 0) {
    const fit = realisations.find((s) => covers(structureSurface(s), type));
    if (fit) return fit;
    // Every realisation of it covers the other type, or one would fit.
    throw new Error(`"${name}" has no ${type} realisation. ${available(realisations[0].kind)} Pass realisation: "${other}" to stamp its ${other} realisation anyway.`);
  }

  const structure = structureMap.get(name);
  if (!structure) {
    throw new Error(`Structure "${name}" not found. Use list_structures to see available structures.`);
  }
  const surface = structureSurface(structure);
  if (!covers(surface, type)) {
    throw new Error(
      `"${name}" is the ${surface} realisation of "${structureAnatomy(structure)}" and this canvas is ${type}. ` +
      `${available(structure.kind)} Pass realisation: "${surface}" to stamp it anyway.`,
    );
  }
  return structure;
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
  // Status colors (Phase 27 v2 archetypes: delta chips, danger zones) —
  // AA against the dark defaults above; generated systems override.
  'success': '#4ADE80',
  'warning': '#FBBF24',
  'danger': '#F87171',
  // Phase 28 — the tint layer (chips, icon tiles, pills, avatars). Dark
  // washes paired with the inks above; generated systems override with
  // seed-derived tints in both themes.
  'accent-tint': '#152A47',
  'success-tint': '#0F2E1B',
  'warning-tint': '#33260A',
  'danger-tint': '#3A1715',
  'neutral-tint': '#25282D',
};

/** Phase 27 slice B — default values for the non-color token namespaces the
 * scaffolds now reference. These ARE the pre-27 literal values, so an
 * unthemed stamp renders pixel-identical to before; generate_design_system
 * overrides them with the personality's stances. */
const DEFAULT_SCAFFOLD_SPACING: Record<string, number> = {
  'space-3xs': 2, 'space-2xs': 4, 'space-xs': 8, 'space-sm': 12,
  'space-md': 16, 'space-lg': 24, 'space-xl': 32, 'space-2xl': 48, 'space-3xl': 64,
};
const DEFAULT_SCAFFOLD_RADIUS: Record<string, number> = {
  'radius-sm': 8, 'radius-md': 12, 'radius-lg': 16,
};
const DEFAULT_SCAFFOLD_ELEVATION: Record<string, Array<{ x: number; y: number; blur: number; spread?: number; color: string }>> = {
  flat: [{ x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(16, 24, 40, 0.05)' }],
  raised: [
    { x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(16, 24, 40, 0.06)' },
    { x: 0, y: 2, blur: 4, spread: -1, color: 'rgba(16, 24, 40, 0.08)' },
  ],
};
/** Phase 29 slice C — scaffolds reference the TYPE ROLES rather than literal
 * pixel sizes, so a stamp lands on whatever scale the canvas actually has.
 * These defaults are the pre-29 literals, seeded only when the role isn't
 * already resolvable, so an unthemed canvas keeps its old proportions while a
 * generated design system re-voices every stamp — family, weight and tracking
 * included, which a literal size could never carry.
 *
 * Sizes that shared a role collapse to one value here: the display tier ran
 * 40/44/48/56 across four scaffolds and is now a single `$display`. That is the
 * intended trade (spec C6) — the pattern gate re-baselines rather than holding
 * byte-identical renders. */
const DEFAULT_SCAFFOLD_TYPOGRAPHY: Record<string, { fontSize: number; fontWeight?: number; letterSpacing?: number; lineHeight?: number }> = {
  display: { fontSize: 40, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.15 },
  title: { fontSize: 28, fontWeight: 700, letterSpacing: -0.5 },   // page titles — pre-27 literal + display tracking
  heading: { fontSize: 26, fontWeight: 600, lineHeight: 1.3 },
  'text-lg': { fontSize: 20, lineHeight: 1.35 },
  body: { fontSize: 16, lineHeight: 1.5 },
  'text-sm': { fontSize: 14, lineHeight: 1.5 },
  label: { fontSize: 14, lineHeight: 1.5 },
  caption: { fontSize: 12, lineHeight: 1.5 },
};

/** Node fields that may carry a `$color` token ref (the theming split). */
const COLOR_FIELDS = ['fill', 'color', 'stroke', 'iconColor'] as const;

/** Colour tokens the mobile primitives read through their defaults
 * (`applyControlDefaults`). A stamp holding a primitive references them even
 * though no prop names them, so they seed like any other reference — without
 * this, an unthemed settings-mobile drew near-black row titles on the dark
 * default background. */
const PRIMITIVE_TYPES = new Set(['status-bar', 'home-indicator', 'nav-bar', 'tab-bar', 'button', 'list-row', 'sheet']);
const PRIMITIVE_COLOR_TOKENS = ['text-primary', 'text-secondary', 'accent', 'border', 'bg-surface', 'danger'];

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
  /** Phase 30 — the anatomy stamped and the surface of its realisation. */
  anatomy: string;
  surface: 'web' | 'mobile' | 'any';
  axes?: StructureAxes;
  /** Top-level node ids inserted under the canvas root (page) or target (component). */
  insertedNodeIds: string[];
  /** Component stamps only: template id → live (re-keyed) id, for targeting follow-up ops. */
  idMap?: Record<string, string>;
  /** Fillable placeholders (text/image) with their role label, for populating.
   * A primitive's copy is a placeholder too; `prop` names the field to set
   * (`title` on a list-row or nav-bar, `label` on a button). */
  placeholders: { id: string; role: string; prop?: 'title' | 'label' }[];
  /** Color tokens seeded with neutral defaults because they were unresolved. */
  seededColors: string[];
  /** Phase 27 — spacing/radius/elevation/typography tokens seeded the same way. */
  seededTokens?: string[];
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
  opts: { replace?: boolean; existingColors?: Set<string>; existingTokens?: Set<string>; targetId?: string; realisation?: SurfaceType } = {},
): ApplyStructureResult {
  const structure = resolveStructure(structureName, opts.realisation ?? resolveSurface(canvas).type);
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
      throw new Error(`Structure "${structure.name}" is a page scaffold — it stamps at the canvas root and does not take a targetId. Component structures (see list_structures kind) do.`);
    }
    const existing = canvas.root.children ?? [];
    if (existing.length > 0 && !opts.replace) {
      throw new Error(
        `Canvas root already has ${existing.length} child node(s). Pass replace: true to clear them and stamp "${structure.name}", or use a fresh canvas.`,
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
    // MERGE, don't replace. A canvas may already carry a genre stamp from
    // canvas_set_genre (metadata.provenance.genre since Phase 30), and replacing the whole
    // provenance object silently discarded it — declaring `commerce` and THEN
    // stamping a layout, which is the order the docs encourage, left the canvas
    // with no genre at all and its prices flagged as fabricated. apply_preset
    // has always spread the existing provenance here; this now matches it.
    canvas.metadata = {
      ...canvas.metadata,
      provenance: {
        ...canvas.metadata?.provenance,
        structure: structure.name,
        axes: structure.axes,
        at: new Date().toISOString(),
      },
    };
  }

  // One pass: collect fillable placeholders + referenced color tokens.
  const placeholders: ApplyStructureResult['placeholders'] = [];
  const referenced = new Set<string>();
  const referencedOther = new Set<string>();  // spacing / radius / elevation / typography refs
  for (const root of inserted) {
    walkNodes(root, (n) => {
      if (PRIMITIVE_TYPES.has(n.type)) PRIMITIVE_COLOR_TOKENS.forEach((t) => referenced.add(t));
      if (n.type === 'text' && typeof n.content === 'string') placeholders.push({ id: n.id, role: n.content });
      else if (n.type === 'image') placeholders.push({ id: n.id, role: 'image' });
      else if ((n.type === 'list-row' || n.type === 'nav-bar') && typeof n.title === 'string') placeholders.push({ id: n.id, role: n.title, prop: 'title' });
      else if (n.type === 'button' && typeof n.label === 'string') placeholders.push({ id: n.id, role: n.label, prop: 'label' });
      for (const field of COLOR_FIELDS) {
        const v = (n as unknown as Record<string, unknown>)[field];
        if (typeof v === 'string' && v.startsWith('$')) referenced.add(v.slice(1));
      }
      // Phase 22 slice F — chart series carry their own $color refs.
      for (const s of n.series ?? []) {
        if (typeof s?.stroke === 'string' && s.stroke.startsWith('$')) referenced.add(s.stroke.slice(1));
      }
      // Phase 27 slice B — density/depth/type refs (seeded like colors below).
      const collect = (v: unknown): void => {
        if (typeof v === 'string' && v.startsWith('$')) referencedOther.add(v.slice(1));
        if (Array.isArray(v)) v.forEach(collect);
      };
      collect(n.gap); collect(n.rowGap); collect(n.padding); collect(n.cornerRadius);
      collect(n.shadow); collect(n.fontSize);
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

  // Seed the non-color namespaces the same way (defaults = pre-27 literals).
  // `existingTokens` carries every merged token name resolvable on this
  // canvas — anything already resolvable (e.g. a generated design system at
  // any layer) is left alone.
  const existingOther = opts.existingTokens ?? new Set<string>();
  const seededTokens: string[] = [];
  // Spacing and radius seed their WHOLE ladder on first touch: the spacing
  // check treats defined tokens as the authoritative scale, so a sparse seed
  // ({sm, md} only) would turn every other literal on the canvas off-scale.
  const seedLadder = (cat: 'spacing' | 'radius', defaults: Record<string, number>): void => {
    for (const [k, v] of Object.entries(defaults)) {
      if (existingOther.has(k) || (canvas.variables[cat] as Record<string, number> | undefined)?.[k] !== undefined) continue;
      canvas.variables[cat] = { ...canvas.variables[cat], [k]: v };
      seededTokens.push(k);
    }
  };
  for (const name of referencedOther) {
    if (existingOther.has(name)) continue;
    if (DEFAULT_SCAFFOLD_SPACING[name] !== undefined) {
      seedLadder('spacing', DEFAULT_SCAFFOLD_SPACING);
    } else if (DEFAULT_SCAFFOLD_RADIUS[name] !== undefined) {
      seedLadder('radius', DEFAULT_SCAFFOLD_RADIUS);
    } else if (name.startsWith('elevation.')) {
      const key = name.slice('elevation.'.length);
      if (DEFAULT_SCAFFOLD_ELEVATION[key] !== undefined) {
        canvas.variables.elevation = { ...canvas.variables.elevation, [key]: DEFAULT_SCAFFOLD_ELEVATION[key] };
        seededTokens.push(name);
      }
    } else if (DEFAULT_SCAFFOLD_TYPOGRAPHY[name] !== undefined) {
      canvas.variables.typography = { ...canvas.variables.typography, [name]: DEFAULT_SCAFFOLD_TYPOGRAPHY[name] };
      seededTokens.push(name);
    }
  }

  return {
    applied: structure.name,
    kind,
    anatomy: structureAnatomy(structure),
    surface: structureSurface(structure),
    ...(structure.axes ? { axes: structure.axes } : {}),
    insertedNodeIds: inserted.map((n) => n.id),
    ...(idMap ? { idMap } : {}),
    placeholders,
    seededColors: seededColors.sort(),
    ...(seededTokens.length ? { seededTokens: seededTokens.sort() } : {}),
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
