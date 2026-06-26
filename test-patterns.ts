import './test-env.js';
/**
 * Phase 20 Slice A — pattern library quality gate (FR-D1). Every page structure,
 * stamped onto an empty canvas, must score >= 90 with ZERO cliché tells across
 * multiple themes. A pattern that ships a tell would *teach* slop, so this is the
 * backstop that keeps the library honest. Pure + fast (no Chrome).
 * Run with: npx tsx test-patterns.ts
 */
import { createCanvas } from './src/scene-graph.js';
import { listStructures, applyStructure } from './src/structures.js';
import { getPreset } from './src/presets.js';
import { evaluateCanvas } from './src/evaluate.js';

const BAR = 90;
// Neutral default (applyStructure's seeded defaults) + two clean presets. light/
// minimal are excluded on purpose: they set bg-primary to pure #ffffff, which is
// the pure-black-white tell's job to flag — a preset issue, not a pattern one.
const THEMES = ['default', 'dark', 'material'] as const;

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

async function main() {
  const pages = listStructures().filter((s) => s.kind === 'page');
  console.log(`\nPattern quality gate — ${pages.length} page structures × ${THEMES.length} themes (bar: >=${BAR}, zero tells)\n`);

  for (const s of pages) {
    for (const theme of THEMES) {
      const canvas = createCanvas(`gate-${s.name}-${theme}`);
      applyStructure(canvas, s.name, { replace: true });
      if (theme !== 'default') {
        const preset = getPreset(theme);
        if (preset) canvas.variables = structuredClone(preset.variables);
      }
      const ev = await evaluateCanvas(canvas, { mode: 'fast', genre: theme === 'default' ? undefined : theme });
      const tells = ev.issues.filter((i) => i.category === 'cliche');
      const ok = ev.overallScore >= BAR && tells.length === 0;
      const detail = ok ? `${ev.overallScore}` : `${ev.overallScore}${tells.length ? ' · tells: ' + tells.map((t) => t.tell).join(', ') : ''}`;
      assert(ok, `${s.name} @ ${theme} — ${detail}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
main();
