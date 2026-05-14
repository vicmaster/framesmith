/**
 * DESIGN.md parser smoke test — focused on the colors-map filter.
 * Run: npx tsx test-design-md.ts
 */
import { parseDesignMd } from './src/design-md-parser.js';

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

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
