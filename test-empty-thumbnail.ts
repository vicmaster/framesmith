// Smoke for Phase 7 slice 3: the gallery emits a distinct placeholder for
// canvases whose document root has no children, instead of letting the
// renderer produce a silent white panel.
//
// Usage: npx tsx test-empty-thumbnail.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'framesmith-test-'));
process.env.FRAMESMITH_HOME = tmp;

const ws = await import('./src/workspaces.js');
const sg = await import('./src/scene-graph.js');
const viewer = await import('./src/viewer.js');

ws.loadPersistedWorkspaces();
ws.ensureDefaultWorkspaceAndProject();
sg.loadPersistedCanvases();

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// Create one empty canvas (fresh canvas has root.children = [])
const emptyCanvas = sg.createCanvas('empty-one');
// Create one with content
const withContent = sg.createCanvas('has-content');
withContent.root.children = [{ id: 'child', type: 'frame', fill: '#FF0000', width: 100, height: 100 }];

const html = await viewer.renderGalleryPage(3001);

// The empty canvas's card should carry the placeholder markup and class.
check(
  'empty canvas card includes `thumb--empty` modifier class',
  html.includes('thumb--empty'),
);
check(
  'empty canvas card includes the "Empty canvas" label',
  html.includes('Empty canvas'),
);
check(
  'empty canvas card includes the layered-hairlines visual mark',
  html.includes('class="thumb-empty-back"') && html.includes('class="thumb-empty-front"'),
);
check(
  'empty canvas card still has accessible "Empty canvas" label (hidden text)',
  html.includes('class="thumb-empty-icon"') && html.includes('Empty canvas'),
);

// The empty card should NOT have an iframe; the with-content one should.
const emptyCardMatch = html.match(new RegExp(`href="/canvas/${emptyCanvas.id}"[^]*?</a>`));
check('empty card section located in gallery', !!emptyCardMatch);
if (emptyCardMatch) {
  check(
    'empty card has NO iframe',
    !emptyCardMatch[0].includes('<iframe'),
  );
  check(
    'empty card contains the placeholder div',
    emptyCardMatch[0].includes('thumb-empty'),
  );
}

const contentCardMatch = html.match(new RegExp(`href="/canvas/${withContent.id}"[^]*?</a>`));
check('with-content card section located in gallery', !!contentCardMatch);
if (contentCardMatch) {
  check(
    'with-content card uses an iframe (not the placeholder)',
    contentCardMatch[0].includes('<iframe') && !contentCardMatch[0].includes('thumb-empty'),
  );
  check(
    'with-content card does NOT have `thumb--empty` class',
    !contentCardMatch[0].includes('thumb--empty'),
  );
}

// CSS hooks for the new placeholder must be in the inline stylesheet.
check('CSS contains .thumb--empty rule', html.includes('.thumb--empty'));
check('CSS contains .thumb-empty rule (placeholder body)', html.includes('.thumb-empty {'));
check('CSS contains .thumb-empty-back/front rules (layered hairlines)',
  html.includes('.thumb-empty-back') && html.includes('.thumb-empty-front'));

rmSync(tmp, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
