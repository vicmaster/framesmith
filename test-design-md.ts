import './test-env.js';
/**
 * DESIGN.md parser smoke test — colors-map filter + component extraction.
 * Run: npx tsx test-design-md.ts
 */
import { parseDesignMd } from './src/design-md-parser.js';
import { renderToHtml } from './src/renderer.js';
import type { Canvas, SceneNode } from './src/types.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  console.log(`  ${condition ? '✓' : '✗'} ${label}`);
  condition ? passed++ : failed++;
}

const md = `# Design System: Test

## 1. Color Palette & Roles

- **Background** (\`#0a0a0a\`)
- **Surface** (\`#1a1a1aff\`)
- **Accent** (\`rgb(59, 130, 246)\`)
- **Accent Soft** (\`rgba(59, 130, 246, 0.2)\`)
- **Text** (\`hsl(0, 0%, 100%)\`)
- **Text Muted** (\`hsla(0, 0%, 100%, 0.6)\`)
- **Brand Short** (\`#fff\`)
- **Card Shadow** (\`0 4px 6px rgba(0, 0, 0, 0.1)\`)
- **Inset Glow** (\`rgba(255, 255, 255, 0.1) inset\`)
- **Hero Gradient** (\`linear-gradient(135deg, #667eea, #764ba2)\`)
- **Duo** (\`#fff, #000\`)
- **Bad Hex** (\`#12345\`)
- **Spacing Note** (\`8px\`)

## 6. Component Stylings

### Buttons
Primary buttons use background \`#3b82f6\` with text color \`#ffffff\`, padding \`12px 24px\`, border-radius \`8px\`, font-size \`15px\`, font-weight \`600\`.

### Cards
Cards have a background \`#1a1a1a\`, padding \`24px\`, border-radius \`12px\`, and a border \`1px solid #2a2a2a\`.

### Badges
Badges use background \`#22c55e\`, text \`#052e16\`, padding \`4px 10px\`, fully rounded pill radius, font-size \`12px\`.
`;

const preset = parseDesignMd(md, 'Test');
const colors = preset.variables.colors ?? {};

// Valid colors kept
assert(colors['background'] === '#0a0a0a', 'hex #RRGGBB kept');
assert(colors['surface'] === '#1a1a1aff', 'hex #RRGGBBAA kept');
assert(colors['accent'] === 'rgb(59, 130, 246)', 'rgb() kept');
assert(colors['accent-soft'] === 'rgba(59, 130, 246, 0.2)', 'rgba() kept');
assert(colors['text'] === 'hsl(0, 0%, 100%)', 'hsl() kept');
assert(colors['text-muted'] === 'hsla(0, 0%, 100%, 0.6)', 'hsla() kept');
assert(colors['brand-short'] === '#fff', 'hex #RGB kept');

// Non-color values rejected
assert(!('card-shadow' in colors), 'box-shadow string rejected');
assert(!('inset-glow' in colors), 'color + trailing keyword rejected');
assert(!('hero-gradient' in colors), 'gradient rejected');
assert(!('duo' in colors), 'comma-separated color list rejected');
assert(!('bad-hex' in colors), 'malformed 5-digit hex rejected');
assert(!('spacing-note' in colors), 'non-color (8px) rejected');

// Component extraction
const components = preset.components ?? {};
const button = components.button;
const card = components.card;
const badge = components.badge;

assert(!!button && button.type === 'component', 'button component extracted');
assert(button?.fill === '#3b82f6', 'button fill parsed');
assert(JSON.stringify(button?.padding) === '[12,24]', 'button padding parsed');
assert(button?.cornerRadius === 8, 'button radius parsed');
assert(button?.children?.[0]?.color === '#ffffff', 'button label color parsed');
assert(button?.children?.[0]?.fontSize === 15, 'button font-size parsed');

assert(!!card && card.type === 'component', 'card component extracted');
assert(card?.fill === '#1a1a1a', 'card fill parsed');
assert(card?.padding === 24, 'card padding parsed');
assert(card?.stroke === '#2a2a2a' && card?.strokeWidth === 1, 'card border parsed');

assert(!!badge && badge.type === 'component', 'badge component extracted');
assert(badge?.fill === '#22c55e', 'badge fill parsed');
assert(badge?.cornerRadius === 9999, 'badge pill radius parsed');

// Components resolve when instanced — mirrors what apply_preset + an instance node do.
const root: SceneNode = {
  id: 'root', type: 'document', width: 400, height: 200, children: [
    { id: 'i1', type: 'instance', componentId: 'button' },
  ],
};
const canvas: Canvas = {
  id: 'c', name: 'c', root, variables: {},
  components: { button: button!, card: card!, badge: badge! },
  createdAt: '', lastModified: '',
};
const html = renderToHtml(root, 400, 200, canvas);
assert(html.includes('background-color: #3b82f6'), 'instanced button renders its fill');
assert(html.includes('Button'), 'instanced button renders its label');

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);