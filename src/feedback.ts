// Phase 21 — point-and-tell feedback: the pure, testable core (the Phase 13
// critique.ts pattern). The user clicks an element in the viewer and leaves a
// comment; the agent reads it via get_feedback and closes it via
// resolve_feedback. Entries live on `canvas.metadata.feedback` (C1) so they
// travel with the canvas and reach a running server through ensureFresh.
//
// Everything here mutates the in-memory canvas and leaves persistence to the
// caller (touchCanvas on the server side, writeCanvasFileAt on the viewer's
// repo write-back path).

import { nanoid } from 'nanoid';
import { findNode } from './scene-graph.js';
import type { Canvas, FeedbackEntry } from './types.js';

/** Max characters of node text captured into the comment-time snapshot. */
const SNAPSHOT_TEXT_MAX = 80;

/** A read view of an entry: `orphaned` is computed at read time (never
 * stored) — true when the anchor node no longer exists in the tree. Orphaned
 * entries stay open; the concern usually still applies to the node's
 * replacement ("the CTA is too loud" survives the CTA being rebuilt). */
export interface FeedbackView extends FeedbackEntry {
  orphaned?: boolean;
}

function feedbackList(canvas: Canvas): FeedbackEntry[] {
  canvas.metadata ??= {};
  canvas.metadata.feedback ??= [];
  return canvas.metadata.feedback;
}

/** Append a comment. Anchored comments require the node to exist NOW (the
 * snapshot is what keeps the entry meaningful later); throws on a bad nodeId
 * so the caller surfaces a clear error instead of storing a dead anchor. */
export function addFeedback(canvas: Canvas, input: { nodeId?: string; comment: string }): FeedbackEntry {
  const comment = input.comment.trim();
  if (!comment) throw new Error('Feedback comment must not be empty');
  const entry: FeedbackEntry = {
    id: `fb-${nanoid(8)}`,
    comment,
    at: new Date().toISOString(),
  };
  if (input.nodeId) {
    const found = findNode(canvas.root, input.nodeId);
    if (!found) throw new Error(`Node "${input.nodeId}" not found in canvas "${canvas.id}"`);
    entry.nodeId = input.nodeId;
    entry.node = {
      type: found.node.type,
      ...(found.node.name ? { name: found.node.name } : {}),
      ...(found.node.content ? { text: found.node.content.slice(0, SNAPSHOT_TEXT_MAX) } : {}),
    };
  }
  feedbackList(canvas).push(entry);
  return entry;
}

/** Entries with `orphaned` computed against the current tree. Open-only by
 * default; resolved history is opt-in. */
export function listFeedback(canvas: Canvas, opts: { includeResolved?: boolean } = {}): FeedbackView[] {
  const entries = canvas.metadata?.feedback ?? [];
  return entries
    .filter((e) => opts.includeResolved || !e.resolvedAt)
    .map((e) => ({
      ...e,
      ...(e.nodeId && !findNode(canvas.root, e.nodeId) ? { orphaned: true } : {}),
    }));
}

/** Mark entries resolved. Unknown (or already-resolved) ids are reported, not
 * thrown — the agent may be replaying a stale list after an external change. */
export function resolveFeedback(
  canvas: Canvas,
  ids: string[],
  by: 'agent' | 'user',
  note?: string,
): { resolved: string[]; notFound: string[] } {
  const open = new Map((canvas.metadata?.feedback ?? []).filter((e) => !e.resolvedAt).map((e) => [e.id, e]));
  const resolved: string[] = [];
  const notFound: string[] = [];
  const now = new Date().toISOString();
  for (const id of ids) {
    const entry = open.get(id);
    if (!entry) {
      notFound.push(id);
      continue;
    }
    entry.resolvedAt = now;
    entry.resolvedBy = by;
    if (note) entry.resolutionNote = note;
    resolved.push(id);
  }
  return { resolved, notFound };
}

/** Remove an entry outright (viewer-side "this note is moot"). */
export function deleteFeedback(canvas: Canvas, id: string): boolean {
  const entries = canvas.metadata?.feedback;
  if (!entries) return false;
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  return true;
}

/** The checkpoint helper: how many comments still block presenting. */
export function openFeedbackCount(canvas: Canvas): number {
  return (canvas.metadata?.feedback ?? []).filter((e) => !e.resolvedAt).length;
}

/** Slice C — fold open feedback into canvas_evaluate's present/keep-working
 * directive. Open comments block presenting even when the score is READY:
 * the human's note outranks the heuristics. */
export function appendFeedbackDirective(directive: string, open: number): string {
  if (open <= 0) return directive;
  return `${directive} ALSO BLOCKING: ${open} open point-and-tell comment(s) from the user — read them with get_feedback, address each, then resolve_feedback. Do NOT present while feedback is open.`;
}
