// Phase 33 slice A — helpers every viewer page shares: escaping, safe script
// JSON, the node index, and the artboard-proportioned thumbnails.
import type { Canvas, SceneNode } from '../types.js';
import { DEFAULT_DEVICE, DEVICE_PROFILES } from '../surfaces.js';

export function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** JSON.stringify safe to inline inside a <script> block. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}



/** Phase 21 — id → { name, type } for every node, embedded in the detail page
 * so the comment-mode breadcrumb can label ancestors without extra requests. */
export function buildNodeIndex(root: SceneNode): Record<string, { name?: string; type: string }> {
  const index: Record<string, { name?: string; type: string }> = {};
  const walk = (n: SceneNode) => {
    index[n.id] = { ...(n.name ? { name: n.name } : {}), type: n.type };
    for (const child of n.children ?? []) walk(child);
  };
  walk(root);
  return index;
}


/** The root's artboard size, defaulting the way every render path does. */
export function artboardSize(canvas: Canvas): { w: number; h: number } {
  const { width, height } = canvas.root;
  return {
    w: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 1440,
    h: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 900,
  };
}

// Phase 30 slice F — card thumbnails at the artboard's real proportions. The
// box takes the artboard's aspect ratio, clamped between a phone held upright
// and 2:1 (a long landing page shows its top instead of becoming a 1,300px
// card). The iframe renders at the artboard size; the server writes a scale
// that makes it 0.222 × 1440 wide, and THUMB_FIT_JS refits it to the card.
export const PHONE = DEVICE_PROFILES[DEFAULT_DEVICE];
const THUMB_WIDTH = 0.222 * 1440;
const THUMB_MAX_ASPECT = 2;

export function thumbAspect(w: number, h: number): string {
  if (w / h < PHONE.width / PHONE.height) return `${PHONE.width} / ${PHONE.height}`;
  if (w / h > THUMB_MAX_ASPECT) return `${THUMB_MAX_ASPECT} / 1`;
  return `${w} / ${h}`;
}

export function renderThumb(canvas: Canvas, badge = ''): string {
  const { w, h } = artboardSize(canvas);
  const isEmpty = !canvas.root.children || canvas.root.children.length === 0;
  const body = isEmpty
    ? `<div class="thumb-empty">
            <div class="thumb-empty-back" aria-hidden="true"></div>
            <div class="thumb-empty-front" aria-hidden="true"></div>
            <span class="thumb-empty-icon" hidden>Empty canvas</span>
          </div>`
    : `<iframe src="/canvas/${canvas.id}/html" scrolling="no" loading="lazy" style="width: ${w}px; height: ${h}px;"></iframe>`;
  const scale = Number((THUMB_WIDTH / w).toFixed(4));
  return `<div class="thumb${isEmpty ? ' thumb--empty' : ''}" data-artboard-w="${w}" style="aspect-ratio: ${thumbAspect(w, h)}; --thumb-scale: ${scale};">${badge}${body}</div>`;
}

export const THUMB_FIT_JS = `
    // Scale each thumbnail's artboard to its card's width, and keep it there.
    (() => {
      const fit = (thumb) => {
        const w = Number(thumb.dataset.artboardW);
        const width = thumb.getBoundingClientRect().width;
        if (w > 0 && width > 0) thumb.style.setProperty('--thumb-scale', String(width / w));
      };
      const thumbs = document.querySelectorAll('.thumb[data-artboard-w]');
      if (typeof ResizeObserver !== 'function') { thumbs.forEach(fit); return; }
      const observer = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
      thumbs.forEach((t) => observer.observe(t));
    })();`;
