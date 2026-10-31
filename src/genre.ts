// Phase 30 slice A — genre (what a screen is FOR) and preset (what style it
// uses) used to share metadata.provenance.preset, so apply_preset silently
// overwrote a genre stamp. Genre now has its own field; this module holds the
// storage rules both writers and every reader share.

import type { Provenance } from './types.js';
import { BUILTIN_PRESET_NAMES } from './presets.js';

export function isPresetName(value: string): boolean {
  return BUILTIN_PRESET_NAMES.has(value);
}

/** The genre as stored, before alias folding. A provenance with a `genre` key
 * is migrated: its value (or null) is the genre. Without the key, a `preset`
 * that is not a built-in preset name is a genre the old canvas_set_genre
 * wrote there (the legacy read, defined negatively so unknown genres survive). */
export function storedGenre(prov: Partial<Provenance> | undefined): string | undefined {
  if (!prov) return undefined;
  if ('genre' in prov) return typeof prov.genre === 'string' ? prov.genre : undefined;
  return typeof prov.preset === 'string' && !isPresetName(prov.preset) ? prov.preset : undefined;
}

/** Migrate-on-write, called by canvas_set_genre and apply_preset before they
 * write. Moves a legacy genre out of `preset` verbatim, or marks the canvas
 * migrated with `genre: null`, so a later imported-preset name is never
 * mistaken for a genre. Mutates `prov`; returns whether it changed. */
export function migrateProvenance(prov: Partial<Provenance>): boolean {
  if ('genre' in prov) return false;
  const legacy = storedGenre(prov);
  if (legacy !== undefined) {
    prov.genre = legacy;
    delete prov.preset;
  } else {
    prov.genre = null;
  }
  return true;
}

/** apply_preset's provenance write: migrate, then record the preset. Never
 * touches `genre`, so styling a canvas can't change what it is declared as. */
export function stampPreset(prov: Partial<Provenance> | undefined, preset: string): Provenance {
  const next: Partial<Provenance> = { ...prov };
  migrateProvenance(next);
  return { ...next, preset, at: new Date().toISOString() };
}
