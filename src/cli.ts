// Phase 23 slice C (#148, #149) — the CI entry points. Sync being *available*
// but never *demanded* is exactly how both #148 incidents happened, so the
// gate checks must be runnable where they fail loudly: a pre-commit hook or a
// CI job, no MCP client involved.
//
//   framesmith verify <canvasIdOrName> --hash <sha256r:...>  exit 0 match / 1 mismatch / 2 error
//   framesmith check-drift <canvasIdOrName> --url <url>      exit 0 in-sync / 1 drift / 2 error
//
// Shared flags: --project-dir <dir> (where the .framesmith/ walk starts,
// default cwd), --json (machine output). check-drift also takes --viewport
// WxH, --selector <css>, --wait-for <selector|ms>. `verify` never touches
// Chrome; `check-drift` needs it (same import pipeline as canvas_import_url).
// Gated pages (auth headers/cookies) are the MCP tool's job — credentials
// don't belong in shell history.
//
// Kept free of MCP/server imports; Chrome-touching modules load lazily inside
// the check-drift branch so `verify` stays fast enough for a pre-commit hook.

import { detectBinding, projectStartDir, readWorkspaceFile, setRepoBackend, migrateLegacyHome } from './repo-store.js';
import { loadPersistedWorkspaces, ensureDefaultWorkspaceAndProject, loadRepoWorkspace } from './workspaces.js';
import { loadPersistedCanvases, listCanvases, getCanvas } from './scene-graph.js';
import { canvasVersionHash, checkVersionHash } from './version.js';
import { computeStructuralDrift, expandInstances } from './drift.js';
import type { Canvas } from './types.js';

interface CliFlags {
  url?: string;
  hash?: string;
  projectDir?: string;
  json: boolean;
  viewport?: { width: number; height: number };
  selector?: string;
  waitFor?: string | number;
}

const USAGE = `framesmith gate checks (design gate integrity — Phase 23):

  framesmith verify <canvasIdOrName> --hash <sha256r:...>
      Exit 0 when the recorded hash still matches the canvas, 1 when the
      design changed since it was recorded, 2 on error. Chrome-free.
      A missing --hash is an error (exit 2), never a skip. Legacy sha256:
      hashes still verify, with a warning: they don't cover inherited
      workspace/project tokens.

  framesmith check-drift <canvasIdOrName> --url <http(s)://...>
      Structural drift between the canvas and the live page.
      Exit 0 in sync, 1 drifted, 2 on error. Needs Chrome.
      Extra flags: --viewport WxH, --selector <css>, --wait-for <selector|ms>

  Shared flags: --project-dir <dir>  start the .framesmith/ discovery there
                --json               machine-readable output

Run with no arguments to start the MCP server (the default).`;

function parseFlags(args: string[]): { positional: string[]; flags: CliFlags } | { error: string } {
  const positional: string[] = [];
  const flags: CliFlags = { json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const next = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} requires a value`);
      return v;
    };
    try {
      switch (a) {
        case '--url': flags.url = next(); break;
        case '--hash': flags.hash = next(); break;
        case '--project-dir': flags.projectDir = next(); break;
        case '--json': flags.json = true; break;
        case '--selector': flags.selector = next(); break;
        case '--wait-for': {
          const v = next();
          flags.waitFor = /^\d+$/.test(v) ? parseInt(v, 10) : v;
          break;
        }
        case '--viewport': {
          const m = next().match(/^(\d+)x(\d+)$/i);
          if (!m) return { error: '--viewport expects WIDTHxHEIGHT, e.g. 1440x900' };
          flags.viewport = { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
          break;
        }
        default: return { error: `Unknown flag ${a}\n\n${USAGE}` };
      }
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
  return { positional, flags };
}

/** Mirror the server's boot: bind to the repo when a .framesmith/ marker is
 * found walking up from the project dir, else the global store. Read-only —
 * no registry self-registration, nothing written. */
function loadStore(projectDir?: string): { bound: string | null } {
  if (projectDir) process.env.FRAMESMITH_PROJECT_DIR = projectDir;
  migrateLegacyHome();
  const binding = detectBinding(projectStartDir());
  const repoFile = binding ? readWorkspaceFile(binding.dir) : null;
  if (binding && repoFile) {
    setRepoBackend(binding.root, binding.dir);
    loadRepoWorkspace(repoFile);
    loadPersistedCanvases();
    return { bound: binding.dir };
  }
  loadPersistedWorkspaces();
  ensureDefaultWorkspaceAndProject();
  loadPersistedCanvases();
  return { bound: null };
}

/** Resolve by exact id first, then by exact name (case-insensitive). An
 * ambiguous name is an error — a gate must never check the wrong canvas. */
function resolveCanvas(ref: string): { canvas: Canvas } | { error: string } {
  const byId = getCanvas(ref);
  if (byId) return { canvas: byId };
  const matches = listCanvases().filter((c) => c.name.toLowerCase() === ref.toLowerCase() && !c.archived);
  if (matches.length === 1) return { canvas: getCanvas(matches[0].id)! };
  if (matches.length > 1) {
    return { error: `Canvas name "${ref}" is ambiguous — matches ${matches.map((m) => `${m.id} (project ${m.projectId})`).join(', ')}. Use the id.` };
  }
  return { error: `Canvas "${ref}" not found (by id or name). Available: ${listCanvases().filter((c) => !c.archived).map((c) => `${c.name} [${c.id}]`).join(', ') || '(none)'}` };
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  if (command !== 'verify' && command !== 'check-drift') {
    process.stderr.write(`Unknown command "${command}"\n\n${USAGE}\n`);
    return 2;
  }
  const parsed = parseFlags(rest);
  if ('error' in parsed) { process.stderr.write(parsed.error + '\n'); return 2; }
  const { positional, flags } = parsed;
  const ref = positional[0];
  if (!ref) { process.stderr.write(`Missing <canvasIdOrName>.\n\n${USAGE}\n`); return 2; }

  const { bound } = loadStore(flags.projectDir);
  const resolved = resolveCanvas(ref);
  if ('error' in resolved) { process.stderr.write(resolved.error + '\n'); return 2; }
  const { canvas } = resolved;

  if (command === 'verify') {
    if (!flags.hash) { process.stderr.write(`verify requires --hash <sha256r:...>\n`); return 2; }
    const { versionHash, matches, warning } = checkVersionHash(canvas, flags.hash);
    if (flags.json) {
      process.stdout.write(JSON.stringify({ canvasId: canvas.id, name: canvas.name, versionHash, expectedHash: flags.hash, matches, bound, ...(warning ? { warning } : {}) }, null, 2) + '\n');
    } else {
      if (warning) process.stderr.write(`WARNING — ${warning}\n`);
      process.stdout.write(matches
        ? `OK — "${canvas.name}" still matches ${flags.hash}\n`
        : `STALE — "${canvas.name}" is now ${versionHash}; the recorded approval (${flags.hash}) no longer describes the current design.\n`);
    }
    return matches ? 0 : 1;
  }

  if (command === 'check-drift') {
    if (!flags.url || !/^https?:\/\//i.test(flags.url)) {
      process.stderr.write(`check-drift requires --url <http(s)://...>\n`);
      return 2;
    }
    // Lazy: this path (and only this path) needs the import pipeline + Chrome.
    const { importUrl } = await import('./import.js');
    const { shutdown } = await import('./screenshot.js');
    try {
      const w = flags.viewport?.width ?? (typeof canvas.root.width === 'number' ? canvas.root.width : 1440);
      const h = flags.viewport?.height ?? (typeof canvas.root.height === 'number' ? canvas.root.height : 900);
      const imported = await importUrl(flags.url, { viewport: { width: w, height: h }, selector: flags.selector, waitFor: flags.waitFor });
      const drift = computeStructuralDrift(expandInstances(canvas.root, canvas), imported.root);
      const versionHash = canvasVersionHash(canvas);
      if (flags.json) {
        process.stdout.write(JSON.stringify({ canvasId: canvas.id, name: canvas.name, versionHash, url: flags.url, ...drift }, null, 2) + '\n');
      } else {
        const blocking = drift.findings.filter((f) => f.severity !== 'info');
        process.stdout.write(drift.inSync
          ? `IN SYNC — "${canvas.name}" structurally matches ${flags.url} (${versionHash})\n`
          : `DRIFTED — "${canvas.name}" vs ${flags.url}: ${blocking.length} finding(s)\n${blocking.map((f) => `  [${f.severity}] ${f.kind}: ${f.detail}`).join('\n')}\n`);
      }
      return drift.inSync ? 0 : 1;
    } catch (err) {
      process.stderr.write(`check-drift failed: ${(err as Error).message}\n`);
      return 2;
    } finally {
      await shutdown();
    }
  }

  return 2; // unreachable — command validated above
}
