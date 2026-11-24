// Phase 33 slice D (FR-D4) — a key for a canvas's comments that changes when
// one is added, resolved or deleted: the total, the open count and the latest
// of every entry's \`at\` and \`resolvedAt\`. /api/canvas/:id/meta carries it and
// the detail page reloads its Feedback list when it changes.
import type { Canvas } from '../types.js';
import { listFeedback } from '../feedback.js';

export function feedbackKey(canvas: Canvas): string {
  const entries = listFeedback(canvas, { includeResolved: true });
  const open = entries.filter((e) => !e.resolvedAt).length;
  const latest = entries.reduce((max, e) => [e.at, e.resolvedAt ?? ''].reduce((m, t) => (t > m ? t : m), max), '');
  return `${entries.length}:${open}:${latest}`;
}
