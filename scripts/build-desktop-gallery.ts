// Rebuilds docs/framesmith-desktop-app.png — the README gallery's desktop-app
// screen: an issue tracker built from the desktop-app primitives on a
// generated design system (#15803D, "technical"). Before writing the image it
// holds the screen to the bar the gallery claims, in its default state and
// its designed error, empty and loading states: no warning, error or cliche
// tell from canvas_evaluate in fast and detailed mode (both themes), and a
// CLEAN stress run. Exits non-zero, writing nothing, if any state falls short.
//
// Usage: npx tsx scripts/build-desktop-gallery.ts   (needs Chrome and the
// network on first run, to fetch the design system's fonts)

import '../test/env.js';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createCanvas } from '../src/scene-graph.js';
import { setVariables, resolveVariables } from '../src/variables.js';
import { generateDesignSystem } from '../src/design-language.js';
import { evaluateCanvas } from '../src/evaluate.js';
import { renderToHtml } from '../src/renderer.js';
import { expandTree } from '../src/expand.js';
import { getCanvasTokens } from '../src/workspaces.js';
import { ensureFontsForRender, bodyFontFamilyFromTokens } from '../src/fonts.js';
import { computeLayout, takeScreenshot, shutdown } from '../src/screenshot.js';
import { applyPerturbation, compareLayouts, PERTURBATION_NAMES } from '../src/stress.js';
import type { Canvas } from '../src/types.js';

const OUTPUT = resolve(import.meta.dirname, '..', 'docs', 'framesmith-desktop-app.png');

let n = 0;
const id = (p: string) => `${p}-${++n}`;
const T = (content: string, extra: Record<string, unknown> = {}) => ({ id: id('t'), type: 'text', name: content.slice(0, 24), content, fontSize: 14, color: '$text-primary', ...extra });
const F = (name: string, extra: Record<string, unknown>, children: unknown[] = []) => ({ id: id('f'), type: 'frame', name, ...extra, children });
const rule = { width: 1, color: '$border' };

const STATUS: Record<string, string> = { 'In progress': '$warning', 'In review': '$accent', Todo: '$text-secondary', Blocked: '$danger', Done: '$success' };
const chip = (label: string) => F(`Status ${label}`, { layout: 'horizontal', gap: '$space-2xs', alignItems: 'center', padding: [2, 8], cornerRadius: 999, fill: '$neutral-tint', width: 'fit-content', maxWidth: 128 }, [
  { id: id('dot'), type: 'ellipse', name: 'dot', width: 6, height: 6, fill: STATUS[label] },
  T(label, { fontSize: 12, fontWeight: 500, textOverflow: 'ellipsis' }),
]);
const avatar = (initials: string) => F(`Avatar ${initials}`, { width: 24, minWidth: 24, height: 24, cornerRadius: 12, fill: '$accent-tint', overflow: 'hidden', layout: 'horizontal', alignItems: 'center', justifyContent: 'center' }, [
  T(initials, { fontSize: 11, fontWeight: 600, color: '$text-primary', lineHeight: 1, textOverflow: 'ellipsis' }),
]);
const PRIORITY: Record<string, string> = { Urgent: 'circle-alert', High: 'arrow-up', Medium: 'minus', Low: 'arrow-down' };

const issues = [
  ['FW-142', 'Battery reading drifts after OTA update', 'Firmware', 'In progress', 'High', 'MK', true],
  ['FW-139', 'Bootloader rejects signed image on rev C boards', 'Firmware', 'Blocked', 'Urgent', 'JO', false],
  ['MA-311', 'Pairing sheet loses state when the app backgrounds', 'Mobile app', 'In review', 'Medium', 'AR', false],
  ['FW-136', 'Log sensor temperature with each charge cycle', 'Firmware', 'Todo', 'Medium', 'MK', false],
  ['DP-88', 'Nightly export skips devices offline at midnight', 'Data platform', 'In progress', 'High', 'LS', false],
  ['MA-305', 'Show firmware version on the device screen', 'Mobile app', 'Todo', 'Low', 'AR', false],
  ['WS-57', 'Status page shows stale incident after resolve', 'Website', 'In review', 'Medium', 'TN', false],
  ['FW-131', 'Charge LED blinks amber when fully charged', 'Firmware', 'Done', 'Low', 'JO', false],
] as const;

const issueRow = ([key, title, project, status, priority, who, selected]: (typeof issues)[number]) => F(`Issue ${key}`, {
  layout: 'horizontal', gap: '$space-sm', alignItems: 'center', padding: [12, 24], borderBottom: rule, ...(selected ? { fill: '$accent-tint' } : {}),
}, [
  { id: id('pri'), type: 'icon', name: `Priority ${priority}`, icon: PRIORITY[priority], iconSize: 16, iconColor: priority === 'Urgent' ? '$danger' : '$text-secondary' },
  F('Issue text', { layout: 'vertical', gap: '$space-3xs', width: '100%', minWidth: 0 }, [
    T(title, { fontWeight: 500, textOverflow: 'ellipsis' }),
    T(`${key} · ${project}`, { fontSize: 12, color: '$text-secondary', fontFamily: 'JetBrains Mono', textOverflow: 'ellipsis' }),
  ]),
  chip(status),
  avatar(who),
]);

const prop = (label: string, child: unknown) => ({ id: id('pr'), type: 'property-row', name: label, label, labelWidth: 112, children: [child] });

function buildCanvas(opts: { error?: boolean; state?: 'empty' | 'loading' } = {}) {
  const canvas = createCanvas('fieldwork-issues', undefined, { width: 1440, height: 900 }, { type: 'desktop-app', device: 'window-1440' });
  setVariables(canvas, generateDesignSystem('#15803D', 'technical', { surface: 'desktop-app' }).variables);

  const sidebar = F('Sidebar', { layout: 'vertical', justifyContent: 'space-between', width: 232, minWidth: 232, height: '100%', fill: '$bg-surface', padding: [16, 8], borderRight: rule, overflow: 'auto' }, [
   F('Sidebar top', { layout: 'vertical', gap: '$space-3xs' }, [
    F('Brand', { layout: 'horizontal', gap: '$space-xs', alignItems: 'center', padding: [4, 8, 16, 8], minWidth: 0 }, [
      F('Mark', { width: 24, minWidth: 24, height: 24, cornerRadius: 6, fill: '$accent', layout: 'horizontal', alignItems: 'center', justifyContent: 'center' }, [
        { id: id('i'), type: 'icon', name: 'mark', icon: 'hexagon', iconSize: 14, iconColor: '#FFFFFF' },
      ]),
      T('Fieldwork', { fontWeight: 600, textOverflow: 'ellipsis' }),
    ]),
    { id: id('n'), type: 'nav-item', name: 'Inbox', label: 'Inbox', icon: 'inbox', count: 4 },
    { id: id('n'), type: 'nav-item', name: 'My issues', label: 'My issues', icon: 'circle-user', count: 12, active: true },
    { id: id('n'), type: 'nav-item', name: 'Reviews', label: 'Reviews', icon: 'git-pull-request', count: 3 },
    { id: id('n'), type: 'nav-item', name: 'Roadmap', label: 'Roadmap', icon: 'map' },
    F('Projects heading', { padding: [24, 8, 4, 8] }, [T('Projects', { fontSize: 12, fontWeight: 500, color: '$text-secondary', textOverflow: 'ellipsis' })]),
    { id: id('n'), type: 'nav-item', name: 'Firmware', label: 'Firmware', dotColor: '$chart-1', count: 18 },
    { id: id('n'), type: 'nav-item', name: 'Mobile app', label: 'Mobile app', dotColor: '$chart-2', count: 9 },
    { id: id('n'), type: 'nav-item', name: 'Data platform', label: 'Data platform', dotColor: '$chart-3', count: 6 },
    { id: id('n'), type: 'nav-item', name: 'Website', label: 'Website', dotColor: '$chart-4', count: 2 },
   ]),
   F('Sidebar bottom', { layout: 'vertical', gap: '$space-3xs' }, [
    { id: id('n'), type: 'nav-item', name: 'Settings', label: 'Settings', icon: 'settings' },
    F('Account', { layout: 'horizontal', gap: '$space-xs', alignItems: 'center', padding: [8, 8, 0, 8], minWidth: 0 }, [
      avatar('MK'),
      F('Who', { layout: 'vertical', gap: 0, minWidth: 0 }, [T('Maya Kim', { fontSize: 12, fontWeight: 500, textOverflow: 'ellipsis' }), T('Hardware team', { fontSize: 11, color: '$text-secondary', textOverflow: 'ellipsis' })]),
    ]),
   ]),
  ]);

  const list = F('Issue list', { layout: 'vertical', width: 500, minWidth: 500, height: '100%', borderRight: rule }, [
    F('List header', { layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center', padding: [16, 24, 12, 24] }, [
      T('My issues', { fontSize: 18, fontWeight: 600, textOverflow: 'ellipsis' }),
      F('List actions', { layout: 'horizontal', gap: '$space-xs', alignItems: 'center', minWidth: 'fit-content' }, [
      { id: id('b'), type: 'button', name: 'Filter', label: 'Filter', icon: 'list-filter', variant: 'secondary', size: 'sm', maxWidth: 160 },
      { id: id('b'), type: 'button', name: 'New issue', label: 'New issue', icon: 'plus', variant: 'primary', size: 'sm', maxWidth: 160 },
      ]),
    ]),
    F('List tabs', { padding: [0, 24], borderBottom: rule }, [
      { id: id('tabs'), type: 'tabs', name: 'Issue filter', size: 'sm', items: [{ label: 'Active', count: 12, active: true }, { label: 'Backlog', count: 31 }, { label: 'Done' }] },
    ]),
    opts.state === 'empty'
      ? F('Empty list', { layout: 'vertical', height: '100%', alignItems: 'center', justifyContent: 'center', gap: '$space-xs', padding: '$space-xl' }, [
          { id: id('i'), type: 'icon', name: 'done', icon: 'circle-check', iconSize: 24, iconColor: '$text-secondary' },
          T('Nothing assigned to you', { fontWeight: 600 }),
          T('Issues assigned to you show up here.', { color: '$text-secondary' }),
          { id: id('b'), type: 'button', name: 'View backlog', label: 'View backlog', variant: 'secondary', size: 'sm' },
        ])
      : opts.state === 'loading'
        ? F('Loading rows', { layout: 'vertical', height: '100%' }, Array.from({ length: 6 }, (_, k) => F(`Skeleton ${k}`, { layout: 'horizontal', gap: '$space-sm', alignItems: 'center', padding: [12, 24], borderBottom: rule }, [
            F('Bone icon', { width: 16, height: 16, cornerRadius: 6, fill: '$neutral-tint' }),
            F('Bone text', { layout: 'vertical', gap: '$space-xs', width: '100%' }, [
              F('Bone title', { width: `${[72, 58, 66, 80, 52, 62][k]}%`, height: 12, cornerRadius: 6, fill: '$neutral-tint' }),
              F('Bone meta', { width: 96, height: 8, cornerRadius: 6, fill: '$neutral-tint' }),
            ]),
            F('Bone chip', { width: 72, minWidth: 72, height: 16, cornerRadius: 999, fill: '$neutral-tint' }),
          ])))
        : F('Rows', { layout: 'vertical', height: '100%', overflow: 'auto' }, issues.map(issueRow)),
  ]);

  const detail = opts.state ? F('No selection', { layout: 'vertical', width: '100%', minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'center', gap: '$space-xs' }, [
    T(opts.state === 'loading' ? 'Loading issues…' : 'No issue selected', { color: '$text-secondary' }),
  ]) : F('Issue detail', { layout: 'vertical', width: '100%', minWidth: 0, height: '100%', overflow: 'auto', padding: [16, 32, 24, 32], gap: '$space-md' }, [
    F('Crumbs', { layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center' }, [
     F('Path', { layout: 'horizontal', gap: '$space-2xs', alignItems: 'center' }, [
      { id: id('l'), type: 'link', name: 'Firmware', label: 'Firmware' },
      { id: id('i'), type: 'icon', name: 'sep', icon: 'chevron-right', iconSize: 14, iconColor: '$text-secondary' },
      T('FW-142', { fontSize: 12, color: '$text-secondary', fontFamily: 'JetBrains Mono' }),
     ]),
     F('Issue actions', { layout: 'horizontal', gap: '$space-2xs', alignItems: 'center' }, [
      { id: id('b'), type: 'button', name: 'Copy link', icon: 'link', ariaLabel: 'Copy link', variant: 'ghost', size: 'sm' },
      { id: id('b'), type: 'button', name: 'More', icon: 'ellipsis', ariaLabel: 'More actions', variant: 'ghost', size: 'sm' },
     ]),
    ]),
    T('Battery reading drifts after OTA update', { fontSize: 22, fontWeight: 600, fontFamily: 'Space Grotesk' }),
    { id: id('tabs'), type: 'tabs', name: 'Detail tabs', size: 'sm', items: [{ label: 'Details', active: true }, { label: 'Activity', count: 8 }, { label: 'Linked', count: 2 }] },
    F('Properties', { layout: 'vertical', gap: '$space-2xs', width: 440 }, [
      prop('Status', { id: id('s'), type: 'select', name: 'Status', value: 'In progress', width: 220 }),
      prop('Priority', { id: id('s'), type: 'select', name: 'Priority', value: 'High', width: 220 }),
      prop('Assignee', F('Assignee', { layout: 'horizontal', gap: '$space-xs', alignItems: 'center' }, [avatar('MK'), T('Maya Kim')])),
      prop('Labels', F('Labels', { layout: 'horizontal', gap: '$space-2xs' }, [
        F('Label power', { padding: [2, 8], cornerRadius: 999, stroke: '$border', strokeWidth: 1 }, [T('power', { fontSize: 12 })]),
        F('Label ota', { padding: [2, 8], cornerRadius: 999, stroke: '$border', strokeWidth: 1 }, [T('ota', { fontSize: 12 })]),
      ])),
      prop('Due date', { id: id('ti'), type: 'text-input', name: 'Due date', value: opts.error ? 'Nov 2, 2026' : 'Dec 4, 2026', icon: 'calendar', size: 'sm', width: 220, ...(opts.error ? { error: 'Due date is before the start date (Nov 18).' } : {}) }),
      prop('Notify me', { id: id('tg'), type: 'toggle', name: 'Notify me', checked: true }),
    ]),
    { id: id('d'), type: 'divider', name: 'divider' },
    F('Description', { layout: 'vertical', gap: '$space-xs', maxWidth: 560 }, [
      T('Description', { fontWeight: 600 }),
      T('After the 2.3.1 update, units report 4–6% more charge than the cell holds. The gauge recalibrates only after a full discharge, so most devices never correct it.', { color: '$text-secondary', lineHeight: 1.55 }),
      T('Repro: flash 2.3.1 on a rev B board at 60%, then charge to full. The app shows 100% about 20 minutes early.', { color: '$text-secondary', lineHeight: 1.55 }),
    ]),
    F('Activity', { layout: 'vertical', gap: '$space-sm', maxWidth: 560 }, [
      T('Activity', { fontWeight: 600 }),
      ...([
        ['link-2', 'Jordan Okafor', 'linked FW-139 as blocking', '2h'],
        ['arrow-right-left', 'Maya Kim', 'moved this to In progress', 'Yesterday'],
        ['paperclip', 'Lena Sato', 'attached charge-curve-rev-b.csv', 'Nov 20'],
      ] as const).map(([icon, name, what, when]) => F(`Event ${name}`, { layout: 'horizontal', gap: '$space-xs', alignItems: 'flex-start' }, [
        { id: id('i'), type: 'icon', name: 'event', icon, iconSize: 16, iconColor: '$text-secondary' },
        F('Event text', { layout: 'vertical', gap: '$space-3xs' }, [
          T(`${name} ${what}`, { fontSize: 12 }),
          T(when, { fontSize: 11, color: '$text-secondary' }),
        ]),
      ])),
    ]),
    F('Comment', { layout: 'vertical', gap: '$space-xs', maxWidth: 560 }, [
      T('Comment', { fontWeight: 600 }),
      { id: id('ti'), type: 'text-input', name: 'New comment', placeholder: 'Add a comment…', rows: 3 },
      F('Comment actions', { layout: 'horizontal', justifyContent: 'flex-end' }, [
        { id: id('b'), type: 'button', name: 'Comment', label: 'Comment', variant: 'secondary', size: 'sm' },
      ]),
    ]),
  ]);

  canvas.root = { ...canvas.root, layout: 'horizontal', padding: 0, gap: 0, fill: '$bg-primary', children: [sidebar, list, detail] } as typeof canvas.root;
  return canvas;
}

type State = 'default' | 'error' | 'empty' | 'loading';
const STATES: State[] = ['default', 'error', 'empty', 'loading'];
const make = (s: State) => buildCanvas(s === 'error' ? { error: true } : s === 'default' ? {} : { state: s }) as Canvas;

async function renderOpts(canvas: Canvas) {
  const merged = getCanvasTokens(canvas);
  const { extraFonts } = await ensureFontsForRender(expandTree(canvas.root, canvas, merged, {}).root, canvas, merged);
  return { extraFonts, bodyFontFamily: bodyFontFamilyFromTokens(merged) };
}

const problems: string[] = [];
for (const state of STATES) {
  const canvas = make(state);
  const opts = await renderOpts(canvas);
  for (const mode of ['fast', 'detailed'] as const) {
    const ev = await evaluateCanvas(canvas, { mode, designedStates: STATES.filter((s) => s !== 'default'), renderOpts: opts });
    for (const i of ev.issues) {
      if (i.severity !== 'info' || i.category === 'cliche') problems.push(`${state} ${mode}: ${i.severity} ${i.rule ?? i.tell ?? i.category} @${i.nodeId}: ${i.message}`);
    }
    console.log(`${state} ${mode}: ${ev.overallScore}/100`);
  }
  const merged = getCanvasTokens(canvas);
  const base = expandTree(canvas.root, canvas).root;
  const layoutOf = async (root: typeof base) => computeLayout(renderToHtml(resolveVariables(structuredClone(root), merged), 1440, 900, canvas, opts), undefined, 25, { width: 1440, height: 900 });
  const baseline = await layoutOf(base);
  for (const name of PERTURBATION_NAMES) {
    const { root, touched } = applyPerturbation(name, base, { type: 'desktop-app' });
    for (const f of compareLayouts(baseline, await layoutOf(root), touched, 1440)) {
      if (f.severity === 'warning') problems.push(`${state} stress ${name}: ${f.kind} @${f.nodeId}: ${f.detail}`);
    }
  }
  console.log(`${state} stress: done`);
}

if (problems.length) {
  console.error(`Not written: the screen falls short of the gallery bar.\n${problems.join('\n')}`);
  await shutdown();
  process.exit(1);
}
const canvas = make('default');
const merged = getCanvasTokens(canvas);
const png = await takeScreenshot(renderToHtml(expandTree(canvas.root, canvas, merged, { theme: 'light' }).root, 1440, 900, canvas, await renderOpts(canvas)), { width: 1440, height: 900, scale: 2 });
writeFileSync(OUTPUT, Buffer.from(png, 'base64'));
console.log(`Wrote ${OUTPUT} (2880x1800)`);
await shutdown();
