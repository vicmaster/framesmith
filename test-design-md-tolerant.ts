// Tolerant import_design_md parsing (issue #64, PR 4b). The parser used to only
// understand one rigid format and silently returned empty colors/typography/
// radius for a `- name: value` list or a markdown table — and injected a default
// spacing scale that ignored the doc's own values. These check the new formats.
//
// Usage: npx tsx test-design-md-tolerant.ts

import { parseDesignMd } from './src/design-md-parser.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── Colors: list format ───────────────────────────────────────────────────────
const listColors = parseDesignMd(`# Sys
## Colors
- Primary: #3b82f6
- Surface: \`#0a0a0a\`
- Accent: rgba(255, 0, 80, 0.9)
`).variables.colors ?? {};
check('colors (list): primary', listColors['primary'] === '#3b82f6', JSON.stringify(listColors));
check('colors (list): surface (backticks stripped)', listColors['surface'] === '#0a0a0a');
check('colors (list): rgba accent', listColors['accent'] === 'rgba(255, 0, 80, 0.9)');

// ── Colors: table format ──────────────────────────────────────────────────────
const tableColors = parseDesignMd(`# Sys
## Color Palette
| Name | Hex |
| --- | --- |
| brand | #ff0055 |
| muted | \`#888888\` |
`).variables.colors ?? {};
check('colors (table): brand', tableColors['brand'] === '#ff0055', JSON.stringify(tableColors));
check('colors (table): muted', tableColors['muted'] === '#888888');
check('colors (table): header row not captured', tableColors['name'] === undefined);

// ── Spacing: explicit named values are honored, not replaced by a default ──────
const spacing = parseDesignMd(`# Sys
## Spacing
- xs: 4px
- sm: 8px
- md: 12px
- lg: 18px
- max-width: 1200px
`).variables.spacing ?? {};
check('spacing: honors explicit md:12 (not the old default 16)', spacing['md'] === 12, JSON.stringify(spacing));
check('spacing: honors explicit lg:18', spacing['lg'] === 18);
check('spacing: does not fabricate a 2xl that was never listed', spacing['2xl'] === undefined);
check('spacing: ignores out-of-range max-width:1200', spacing['max-width'] === undefined);

// ── Spacing: base unit still synthesizes a scale when no explicit tokens ───────
const baseSpacing = parseDesignMd(`# Sys
## Layout Principles
Base unit: 8px. Use multiples for rhythm.
`).variables.spacing ?? {};
check('spacing: base unit synthesizes md = base*2', baseSpacing['md'] === 16, JSON.stringify(baseSpacing));

// ── Spacing: nothing stated → no fabrication ──────────────────────────────────
const noSpacing = parseDesignMd(`# Sys
## Spacing
Use generous whitespace throughout.
`).variables.spacing;
check('spacing: empty section fabricates nothing', noSpacing === undefined, JSON.stringify(noSpacing));

// ── Radius: named token list ──────────────────────────────────────────────────
const radius = parseDesignMd(`# Sys
## Border Radius
- sm: 4px
- md: 8px
- lg: 16px
- full: 9999px
`).variables.radius ?? {};
check('radius (list): sm/md/lg', radius['sm'] === 4 && radius['md'] === 8 && radius['lg'] === 16, JSON.stringify(radius));
check('radius (list): full/pill', radius['full'] === 9999);

// ── Typography: simple list fallback ──────────────────────────────────────────
const typo = parseDesignMd(`# Sys
## Typography
- Heading: 32px / 700
- Body: 16px / 400
- Caption: 12px
`).variables.typography ?? {};
check('typography (list): heading size+weight', typo['heading']?.fontSize === 32 && typo['heading']?.fontWeight === 700, JSON.stringify(typo));
check('typography (list): body size+weight', typo['body']?.fontSize === 16 && typo['body']?.fontWeight === 400);
check('typography (list): caption size only', typo['caption']?.fontSize === 12);

// ── A mixed real-world doc carries a full design system ────────────────────────
const full = parseDesignMd(`# My System
## Colors
- bg: #0a0a0a
- fg: #ffffff
## Spacing
- sm: 8px
- md: 12px
## Border Radius
- md: 10px
## Typography
- Title: 28px / 600
`).variables;
check('full doc: all four categories populated', !!full.colors && !!full.spacing && !!full.radius && !!full.typography,
  `colors=${Object.keys(full.colors ?? {}).length} spacing=${Object.keys(full.spacing ?? {}).length} radius=${Object.keys(full.radius ?? {}).length} typo=${Object.keys(full.typography ?? {}).length}`);

console.log(allPass ? '\nTOLERANT DESIGN-MD TEST PASSED ✅' : '\nTOLERANT DESIGN-MD TEST FAILED ✗');
process.exit(allPass ? 0 : 1);
