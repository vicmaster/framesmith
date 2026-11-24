// Phase 33 slice A (FR-A2) — the viewer's tokens are the design's tokens. Loads
// the repo's .framesmith/workspace.json, reads the "Viewer redesign" project's
// design system, and asserts src/viewer/tokens.ts equals it in both themes. Then
// scans every other src/viewer file for a colour literal, which must not exist.
//
// Usage: npx tsx test/unit/test-viewer-tokens.ts

import '../env.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadRepoWorkspace, getProjectDesignSystem, listProjects } from '../../src/workspaces.js';
import type { RepoWorkspaceFile } from '../../src/repo-store.js';
import { DARK, LIGHT, RADIUS, SPACING, TYPE_ROLES, VIEWER_DESIGN_PROJECT, toBoxShadow, type ViewerTheme } from '../../src/viewer/tokens.js';

let allPass = true;
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) allPass = false;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
}

// ── drift: tokens.ts against the committed design system ─────────────────────
const wf = JSON.parse(readFileSync('.framesmith/workspace.json', 'utf-8')) as RepoWorkspaceFile;
loadRepoWorkspace(wf);
const project = listProjects().find((p) => p.name === VIEWER_DESIGN_PROJECT.name);
check('the "Viewer redesign" project is in the repo workspace', !!project && project.id === VIEWER_DESIGN_PROJECT.id, project?.id);
const ds = project ? getProjectDesignSystem(project.id) : undefined;
check('it has a design system with a dark layer', !!ds?.colors && !!ds.dark?.colors);

type Layers = Record<string, Array<{ x: number; y: number; blur: number; spread: number; color: string }>>;
function compareTheme(label: string, theme: ViewerTheme, colors: Record<string, string> | undefined, elevation: Layers | undefined) {
  const drift = Object.entries(theme.colors).filter(([name, value]) => colors?.[name]?.toLowerCase() !== value.toLowerCase());
  check(`${label}: every colour token equals the design system`, drift.length === 0, drift.map(([n, v]) => `${n} ${v} ≠ ${colors?.[n]}`).join(', '));
  const shadowDrift = Object.entries(theme.elevation).filter(([name, value]) => !elevation?.[name] || toBoxShadow(elevation[name]) !== value);
  check(`${label}: every elevation equals the design system`, shadowDrift.length === 0, shadowDrift.map(([n]) => n).join(', '));
}
compareTheme('light', LIGHT, ds?.colors, ds?.elevation as Layers | undefined);
// The dark layer overrides; a name it leaves out inherits the light value.
compareTheme('dark', DARK, { ...ds?.colors, ...ds?.dark?.colors }, { ...(ds?.elevation as Layers | undefined), ...(ds?.dark?.elevation as Layers | undefined) });

const radiusDrift = Object.entries(RADIUS).filter(([n, v]) => ds?.radius?.[n] !== v);
check('radius equals the design system', radiusDrift.length === 0, radiusDrift.map(([n]) => n).join(', '));
const spacingDrift = Object.entries(SPACING).filter(([n, v]) => ds?.spacing?.[n] !== v);
check('spacing equals the design system', spacingDrift.length === 0, spacingDrift.map(([n]) => n).join(', '));
const typeDrift = Object.entries(TYPE_ROLES).filter(([role, spec]) => JSON.stringify(ds?.typography?.[role]) !== JSON.stringify(spec));
check('type roles equal the design system', typeDrift.length === 0, typeDrift.map(([n]) => n).join(', '));

// ── no colour literal outside tokens.ts ──────────────────────────────────────
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}
/** Comments and numeric HTML entities removed, so `issue #150` and `&#9634;`
 * are not read as colours. */
function stripped(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1').replace(/&#\d+;/g, '');
}
const LITERAL = /#[0-9A-Fa-f]{3,8}(?![\w-])|\b(rgba?|hsla?)\(/g;
const viewerFiles = files('src/viewer').filter((f) => !f.endsWith('tokens.ts'));
check('src/viewer has the expected modules', viewerFiles.length >= 9, String(viewerFiles.length));
for (const file of viewerFiles) {
  const hits = stripped(readFileSync(file, 'utf-8')).match(LITERAL) ?? [];
  check(`${file}: no colour literal`, hits.length === 0, hits.join(' '));
}

// The scanner must catch what it is for: a self-test on known shapes.
check('scanner: finds a hex colour', (stripped('a { color: #FF00aa; }').match(LITERAL) ?? []).length === 1);
check('scanner: finds rgba()', (stripped('box-shadow: 0 0 1px rgba(0,0,0,0.5)').match(LITERAL) ?? []).length === 1);
check('scanner: ignores an id selector', (stripped('#add-btn { }').match(LITERAL) ?? []).length === 0);
check('scanner: ignores an issue reference in a comment', (stripped('// issue #150').match(LITERAL) ?? []).length === 0);
check('scanner: ignores an HTML entity', (stripped('<b>&#9634;</b>').match(LITERAL) ?? []).length === 0);

process.exit(allPass ? 0 : 1);
