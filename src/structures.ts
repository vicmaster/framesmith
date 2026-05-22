import type { SceneNode, Structure, StructureAxes } from './types.js';

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
    gap: 12,
    padding: 24,
    cornerRadius: 16,
    fill,
    stroke: COLOR.border,
    strokeWidth: 1,
    children: [
      { id: `${id}-label`, type: 'text', content: label, fontSize: 18, fontWeight: 600, color: COLOR.textPrimary },
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
    padding: [14, 28],
    cornerRadius: 8,
    fill,
    ...(stroke ? { stroke, strokeWidth: 1 } : {}),
    children: [{ id: `${id}-label`, type: 'text', content: label, fontSize: 16, fontWeight: 600, color }],
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
      padding: [120, 48],
      fill: COLOR.bgPrimary,
      children: [
        { id: 'mh-eyebrow', type: 'text', name: 'Eyebrow', content: 'Eyebrow — short label', fontSize: 14, fontWeight: 600, color: COLOR.accent, textAlign: 'center', letterSpacing: 1 },
        { id: 'mh-headline', type: 'text', name: 'Headline', content: 'Headline', fontSize: 64, fontWeight: 700, color: COLOR.textPrimary, textAlign: 'center', lineHeight: 1.1, maxWidth: 880 },
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
      gap: 12,
      padding: [72, 48],
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
      padding: [64, 48],
      fill: COLOR.bgPrimary,
      children: [
        {
          id: 'bn-header',
          type: 'frame',
          name: 'Header',
          layout: 'vertical',
          gap: 8,
          children: [
            { id: 'bn-eyebrow', type: 'text', content: 'Eyebrow — section label', fontSize: 13, fontWeight: 600, color: COLOR.accent, letterSpacing: 1 },
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
          gap: 20,
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

const structureMap = new Map<string, Structure>([
  ['marquee-hero', marqueeHero],
  ['bento-grid', bentoGrid],
]);

export function listStructures(): { name: string; description: string; axes: StructureAxes }[] {
  return Array.from(structureMap.values()).map(({ name, description, axes }) => ({ name, description, axes }));
}

export function getStructure(name: string): Structure | undefined {
  return structureMap.get(name);
}

export function registerStructure(structure: Structure): void {
  structureMap.set(structure.name, structure);
}
