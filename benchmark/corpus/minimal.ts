// Phase 6b benchmark corpus: a minimal well-formed canvas — one frame, one
// text node, sensible spacing, good contrast. Baseline scores should be high
// across all categories; mainly serves as an "empty calibration" check that
// nothing in the evaluator penalises a tiny well-formed design.

import type { SceneNode } from '../../src/types.js';

export const minimalRoot: SceneNode = {
  id: 'doc', type: 'document',
  fill: '#0F172A',
  padding: 48, gap: 16,
  alignItems: 'center', justifyContent: 'center',
  children: [
    {
      id: 'card', type: 'frame',
      width: 480, padding: 32, gap: 12,
      fill: '#1E293B', cornerRadius: 12,
      children: [
        { id: 'title', type: 'text', content: 'Hello, world', fontSize: 24, fontWeight: 600, color: '#F8FAFC' },
        { id: 'sub', type: 'text', content: 'A small, well-formed canvas.', fontSize: 14, color: '#94A3B8' },
      ],
    },
  ],
};
