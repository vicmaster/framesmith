// Phase 6b benchmark corpus: a canvas with intentional contrast failures —
// near-white text on a near-white background, plus a few other low-contrast
// pairings. Baseline scores should be low for the color category, validating
// that the contrast checks fire and giving us a regression anchor: if a future
// refactor accidentally weakens contrast detection, this score will rise.

import type { SceneNode } from '../../src/types.js';

export const badContrastRoot: SceneNode = {
  id: 'doc', type: 'document',
  fill: '#F8FAFC', // very light bg
  padding: 32, gap: 16,
  children: [
    // White text on white-ish background — clear contrast failure
    { id: 't1', type: 'text', content: 'Almost invisible heading', fontSize: 28, fontWeight: 700, color: '#FFFFFF' },
    // Light gray text on light bg — also bad
    { id: 't2', type: 'text', content: 'Barely-there subtitle', fontSize: 18, color: '#E2E8F0' },
    // A frame with low contrast against the doc fill
    {
      id: 'panel', type: 'frame', padding: 16, fill: '#FAFAFA', cornerRadius: 8,
      children: [
        // Light yellow text on light gray frame — fails
        { id: 't3', type: 'text', content: 'Hard to read body copy goes right here.', fontSize: 14, color: '#FEF3C7' },
      ],
    },
  ],
};
