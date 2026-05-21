import './test-env.js';
// Smoke for the framesmith://guidelines MCP resource:
//   1. Recomputes the path the server resolves at startup (dist/index.js → ../docs/GUIDELINES.md)
//      and asserts the file is there.
//   2. Asserts the markdown body contains the headings AI clients are pointed at
//      from the batch_design description, so a careless edit can't silently drop
//      the patterns/anti-patterns sections.
//
// Usage: npx tsx test-guidelines.ts

import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
// Same path expression as in src/index.ts (dist/index.js → ../docs/GUIDELINES.md).
const distEquivalent = resolve(repoRoot, 'dist', 'index.js');
const resolvedFromServer = resolve(dirname(distEquivalent), '..', 'docs', 'GUIDELINES.md');

const REQUIRED_HEADINGS = [
  '# Authoring Guidelines',
  '## Width strategies',
  '## Responsive hints',
  '## Common patterns',
  '## Anti-patterns',
];

let allPass = true;

try {
  await access(resolvedFromServer);
  console.log(`PASS  path resolves: ${resolvedFromServer}`);
} catch {
  allPass = false;
  console.log(`FAIL  expected GUIDELINES.md at ${resolvedFromServer}`);
}

if (allPass) {
  const text = await readFile(resolvedFromServer, 'utf-8');
  for (const heading of REQUIRED_HEADINGS) {
    const ok = text.includes(heading);
    if (!ok) allPass = false;
    console.log(`${ok ? 'PASS' : 'FAIL'}  contains "${heading}"`);
  }
}

process.exit(allPass ? 0 : 1);