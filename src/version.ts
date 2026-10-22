// Phase 23 slice A (#149) — a stable content hash per canvas, so "approved"
// can be falsifiable: a gate records the hash at approval time and can later
// verify the approved canvas is still the current design. The hash covers the
// DESIGN CONTENT only (root tree, resolved tokens, component registry, fonts) —
// never metadata (feedback arriving/resolving, critique stamps, provenance),
// timestamps, or store identity — so an approval survives everything except an
// actual design change, and the same design hashes identically in every
// process and on every machine.
//
// #217 — the original `sha256:` hash covered only the canvas's OWN tokens, so
// a workspace/project design-system edit restyled every inheriting canvas
// without moving its hash. The current `sha256r:` hash covers the WHOLE
// resolved token set (workspace → project → canvas), not just the tokens the
// canvas names (#221): some are read implicitly (body font, control-colour
// fallback, the dark layer), so a referenced-only hash could miss a real
// change. The cost is that any inherited edit, even to an unused token, moves
// every inheriting canvas's hash — the safe direction for a gate. The prefix is
// the algorithm version: legacy `sha256:` approvals are still checked with the
// legacy algorithm (and warned about) instead of all flipping to STALE on
// upgrade.

import { createHash } from 'node:crypto';
import type { Canvas, DesignVariables } from './types.js';
import { getCanvasTokens } from './workspaces.js';

export const VERSION_HASH_PREFIX = 'sha256r:';
export const LEGACY_VERSION_HASH_PREFIX = 'sha256:';

export const LEGACY_HASH_WARNING =
  'Legacy sha256: hash — it covers only the canvas\'s own tokens, NOT the workspace/project design-system tokens it inherits, so a design-system edit would not invalidate it. Re-record the approval with the current versionHash (sha256r:).';

/**
 * Deterministic JSON: object keys recursively sorted, arrays kept in order,
 * `undefined` object members dropped (mirroring JSON.stringify), no
 * whitespace. Never injects defaults — absent and present-but-empty are
 * different inputs and the CALLER decides any normalization.
 */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalSerialize(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalSerialize(v)}`);
  return `{${entries.join(',')}}`;
}

function digest(canvas: Canvas, variables: DesignVariables): string {
  const payload = canonicalSerialize({
    root: canvas.root,
    variables,
    components: canvas.components,
    fonts: canvas.fonts ?? [],
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * `sha256r:<first 16 hex>` over the canvas's design content, with tokens
 * RESOLVED through the workspace → project → canvas chain (#217). Node IDs in
 * the tree ARE included — an ID rewrite is a real change to the checked-in
 * JSON, and a false "changed" is the safe direction for a gate. `fonts` is
 * normalized to [] so a canvas that never touched fonts hashes the same
 * before and after the field first appears.
 */
export function canvasVersionHash(canvas: Canvas): string {
  return `${VERSION_HASH_PREFIX}${digest(canvas, getCanvasTokens(canvas))}`;
}

/** The pre-#217 `sha256:` algorithm (canvas-local tokens only). Kept so
 * approvals recorded before the upgrade can still be checked. */
export function legacyCanvasVersionHash(canvas: Canvas): string {
  return `${LEGACY_VERSION_HASH_PREFIX}${digest(canvas, canvas.variables)}`;
}

export interface VersionCheck {
  /** The current hash (always the current algorithm). */
  versionHash: string;
  matches: boolean;
  /** Present when `expected` was a legacy `sha256:` hash: it was compared
   * with the legacy algorithm, which can't see inherited-token edits. */
  warning?: string;
}

/** Check a recorded hash against the canvas, dispatching on its prefix. */
export function checkVersionHash(canvas: Canvas, expected: string): VersionCheck {
  const versionHash = canvasVersionHash(canvas);
  if (expected.startsWith(LEGACY_VERSION_HASH_PREFIX)) {
    return { versionHash, matches: legacyCanvasVersionHash(canvas) === expected, warning: LEGACY_HASH_WARNING };
  }
  return { versionHash, matches: versionHash === expected };
}
