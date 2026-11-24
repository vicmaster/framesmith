// Phase 33 slice A — the canvas detail page's browser script, moved verbatim
// from viewer.ts; every server value it inlines goes through scriptJson.
import type { Canvas } from '../../types.js';
import { listFeedback } from '../../feedback.js';
import { evalCacheKey } from '../scores.js';
import { buildNodeIndex, scriptJson } from '../shared.js';
import { LIGHT } from '../tokens.js';

export function detailScript(canvas: Canvas, w: number, h: number, surfaceType: string): string {
  return `
    const canvasId = ${scriptJson(canvas.id)};
    // Outlines drawn inside the canvas iframe, which cannot read the page's CSS variables.
    const HIGHLIGHT = ${scriptJson(LIGHT.colors.accent)};
    let lastModified = ${scriptJson(canvas.lastModified)};
    let contentKey = ${scriptJson(evalCacheKey(canvas))};
    // The layout (device frame or breakpoints, artboard size, safe-area bands)
    // is server-rendered, so a change to the type, the root size or its
    // safeArea reloads the page.
    const pageShape = ${scriptJson({ type: surfaceType, width: canvas.root.width ?? null, height: canvas.root.height ?? null, safeArea: JSON.stringify(canvas.root.safeArea ?? null) })};
    let currentBp = 'desktop';

    // Phase 21 — point-and-tell: initial feedback entries + node labels for
    // the breadcrumb. Kept fresh client-side via GET /api/canvas/:id/feedback.
    const FB_INIT = ${scriptJson(listFeedback(canvas, { includeResolved: true }))};
    const NODE_INDEX = ${scriptJson(buildNodeIndex(canvas.root))};

    // Auto-refresh polling
    setInterval(async () => {
      try {
        const res = await fetch('/api/canvas/' + canvasId + '/meta');
        const meta = await res.json();
        document.getElementById('status').className = 'status';
        // contentKey catches edits that never bump lastModified (issue #150).
        if (meta.lastModified !== lastModified || (meta.contentKey && meta.contentKey !== contentKey)) {
          if (meta.type !== pageShape.type || (meta.width ?? null) !== pageShape.width || (meta.height ?? null) !== pageShape.height || JSON.stringify(meta.safeArea ?? null) !== pageShape.safeArea) {
            location.reload();
            return;
          }
          lastModified = meta.lastModified;
          contentKey = meta.contentKey || contentKey;
          refreshFrames();
          // Update JSON if panel is open
          if (document.getElementById('json-panel').classList.contains('open')) loadJson();
        }
      } catch {
        document.getElementById('status').className = 'status stale';
      }
    }, 2000);

    // Phase 25 slice D — flip every iframe between light and dark renders.
    let themeMode = 'light';
    function toggleTheme() {
      themeMode = themeMode === 'light' ? 'dark' : 'light';
      const btn = document.getElementById('theme-toggle');
      if (btn) { btn.textContent = themeMode === 'light' ? 'Dark' : 'Light'; btn.classList.toggle('active', themeMode === 'dark'); }
      document.querySelectorAll('iframe').forEach((frame) => {
        const u = new URL(frame.src, location.href);
        if (themeMode === 'dark') u.searchParams.set('theme', 'dark');
        else u.searchParams.delete('theme');
        frame.src = u.toString();
      });
    }

    function refreshFrames() {
      const t = Date.now();
      const bump = (frame) => {
        const url = new URL(frame.src, location.href);
        url.searchParams.set('t', t);
        frame.src = url.toString();
      };
      if (document.getElementById('viewport').classList.contains('compare')) {
        document.querySelectorAll('.compare-cell iframe').forEach(bump);
      } else {
        bump(document.getElementById('frame'));
      }
    }

    const canvasW = ${scriptJson(w)};
    const canvasH = ${scriptJson(h)};

    function setViewport(w, h, bp) {
      const frame = document.getElementById('frame');
      const vp = document.getElementById('viewport');
      vp.classList.remove('fit', 'compare');
      document.getElementById('btn-fit').classList.remove('active');

      // Reload iframe at the new viewport size so content reflows
      frame.width = w;
      frame.height = h;
      frame.style.transform = '';
      frame.style.maxWidth = '';
      frame.style.maxHeight = '';
      frame.style.width = '';
      frame.style.height = '';
      frame.style.overflow = '';
      frame.src = '/canvas/' + canvasId + '/html?w=' + w + '&h=' + h + (themeMode === 'dark' ? '&theme=dark' : '') + '&t=' + Date.now();

      // The pressed button is the active breakpoint; other toolbar state stays.
      document.querySelectorAll('.bp-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('bp-' + bp).classList.add('active');
      currentBp = bp;
    }

    function setCompareMode() {
      const vp = document.getElementById('viewport');
      vp.classList.remove('fit');
      vp.classList.add('compare');
      document.getElementById('btn-fit').classList.remove('active');
      document.querySelectorAll('.bp-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('bp-compare').classList.add('active');
      currentBp = 'compare';
    }

    function toggleSafeArea() {
      const overlay = document.getElementById('safe-overlay');
      overlay.hidden = !overlay.hidden;
      document.getElementById('btn-safe').classList.toggle('active', !overlay.hidden);
    }

    function toggleFit() {
      const vp = document.getElementById('viewport');
      const btn = document.getElementById('btn-fit');
      vp.classList.toggle('fit');
      btn.classList.toggle('active');
    }

    function toggleJson() {
      const panel = document.getElementById('json-panel');
      const btn = document.getElementById('btn-json');
      panel.classList.toggle('open');
      btn.classList.toggle('active');
      if (panel.classList.contains('open')) loadJson();
    }

    async function loadJson() {
      try {
        const res = await fetch('/canvas/' + canvasId + '/json');
        const data = await res.json();
        document.getElementById('json-content').textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('json-content').textContent = 'Error loading JSON';
      }
    }

    // Archive / unarchive / delete. Delete is irreversible — confirm first.
    // After action: archive / unarchive bounce back to the project page;
    // delete bounces too (the canvas is gone, no point staying on its page).
    async function lifecycleAction(action) {
      if (action === 'delete' && !confirm('Permanently delete this canvas? This cannot be undone.')) return;
      const projectId = ${scriptJson(canvas.projectId)};
      try {
        const url = '/api/canvas/' + canvasId + (action === 'archive' ? '/archive' : action === 'unarchive' ? '/unarchive' : '');
        const method = action === 'delete' ? 'DELETE' : 'POST';
        const res = await fetch(url, { method });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        location.href = '/project/' + projectId;
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
    }

    // ── Phase 21 — point-and-tell feedback ─────────────────────────────────
    // Pane renderer: cards are built with DOM APIs (never innerHTML from user
    // text) so comment content can't inject markup.
    function nodeLabel(nodeId) {
      const n = NODE_INDEX[nodeId];
      return n ? (n.name || n.type) : nodeId;
    }

    function fbCard(entry) {
      const card = document.createElement('div');
      card.className = 'fb-card' + (entry.resolvedAt ? ' resolved' : '');
      const top = document.createElement('div');
      top.className = 'fb-card-top';
      const anchor = document.createElement('span');
      anchor.className = 'fb-anchor';
      anchor.textContent = entry.nodeId ? ((entry.node && (entry.node.name || entry.node.type)) || nodeLabel(entry.nodeId)) : 'whole page';
      top.appendChild(anchor);
      if (entry.orphaned) {
        const o = document.createElement('span');
        o.className = 'fb-orphan';
        o.title = 'The anchored node no longer exists — the concern may still apply to its replacement';
        o.textContent = 'node gone';
        top.appendChild(o);
      }
      const when = document.createElement('span');
      when.className = 'fb-when';
      when.textContent = new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      top.appendChild(when);
      card.appendChild(top);
      const msg = document.createElement('div');
      msg.className = 'fb-comment';
      msg.textContent = entry.comment;
      card.appendChild(msg);
      if (entry.resolutionNote) {
        const reply = document.createElement('div');
        reply.className = 'fb-reply';
        reply.textContent = (entry.resolvedBy === 'agent' ? 'agent: ' : '') + entry.resolutionNote;
        card.appendChild(reply);
      }
      if (!entry.resolvedAt) {
        const actions = document.createElement('div');
        actions.className = 'fb-actions';
        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'fb-btn';
        resolveBtn.textContent = 'Resolve';
        resolveBtn.onclick = (e) => { e.stopPropagation(); fbAction('/feedback/' + entry.id + '/resolve', 'POST'); };
        const delBtn = document.createElement('button');
        delBtn.className = 'fb-btn fb-btn--danger';
        delBtn.textContent = 'Delete';
        delBtn.onclick = (e) => { e.stopPropagation(); if (confirm('Delete this comment?')) fbAction('/feedback/' + entry.id, 'DELETE'); };
        actions.appendChild(resolveBtn);
        actions.appendChild(delBtn);
        card.appendChild(actions);
      }
      if (entry.nodeId && !entry.orphaned) {
        card.onclick = () => {
          const wasSel = card.classList.contains('sel');
          document.querySelectorAll('.fb-card.sel').forEach((o) => o.classList.remove('sel'));
          if (wasSel) { highlightNode(null, false); return; }
          card.classList.add('sel');
          highlightNode(entry.nodeId, true);
        };
      }
      return card;
    }

    function renderFeedbackPane(entries) {
      const pane = document.getElementById('fb-pane');
      const badge = document.getElementById('fb-badge');
      if (!pane) return;
      pane.replaceChildren();
      const open = entries.filter((e) => !e.resolvedAt);
      const done = entries.filter((e) => e.resolvedAt);
      if (badge) { badge.textContent = String(open.length); badge.hidden = open.length === 0; }
      if (!open.length && !done.length) {
        const empty = document.createElement('div');
        empty.className = 'fb-empty';
        empty.textContent = 'No comments yet.';
        pane.appendChild(empty);
        return;
      }
      open.forEach((e) => pane.appendChild(fbCard(e)));
      if (done.length) {
        const sep = document.createElement('div');
        sep.className = 'fb-sep';
        sep.textContent = 'Resolved';
        pane.appendChild(sep);
        done.forEach((e) => pane.appendChild(fbCard(e)));
      }
    }

    async function loadFeedback() {
      try {
        const res = await fetch('/api/canvas/' + canvasId + '/feedback');
        const data = await res.json();
        renderFeedbackPane(data.entries);
      } catch { /* pane keeps its last state */ }
    }

    async function fbAction(suffix, method) {
      try {
        const res = await fetch('/api/canvas/' + canvasId + suffix, { method });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        loadFeedback();
      } catch (err) { alert('Action failed: ' + err.message); }
    }

    // Comment mode: crosshair + hover outline inside the main iframe; click
    // resolves the nearest data-node-id, a popover picks scope + takes the note.
    let commentMode = false;
    const HOVER_STYLE_ID = 'fs-comment-hover';

    function frameDoc() {
      const frame = document.getElementById('frame');
      try { return frame.contentDocument; } catch { return null; }
    }

    function setFrameCommentAffordance(on) {
      const doc = frameDoc();
      if (!doc || !doc.body) return;
      doc.getElementById(HOVER_STYLE_ID)?.remove();
      if (on) {
        const style = doc.createElement('style');
        style.id = HOVER_STYLE_ID;
        style.textContent = 'body { cursor: crosshair !important; } [data-node-id]:hover { outline: 1px dashed ' + HIGHLIGHT + ' !important; outline-offset: 1px; }';
        doc.head.appendChild(style);
      }
    }

    function onFrameClick(e) {
      if (!commentMode) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest ? e.target.closest('[data-node-id]') : null;
      const chain = [];
      let el = target;
      while (el) {
        // A node inside a component instance renders as "<instance>/<node>":
        // the comment anchors on the instance, the node the canvas stores.
        const id = el.getAttribute('data-node-id').split('/')[0];
        if (!chain.includes(id)) chain.push(id);
        el = el.parentElement && el.parentElement.closest('[data-node-id]');
      }
      openPopover(chain, e);
    }

    function hookFrame() {
      const doc = frameDoc();
      if (!doc) return;
      doc.removeEventListener('click', onFrameClick, true);
      doc.addEventListener('click', onFrameClick, true);
      setFrameCommentAffordance(commentMode);
    }

    function toggleComment() {
      commentMode = !commentMode;
      document.getElementById('btn-comment').classList.toggle('active', commentMode);
      if (!commentMode) closePopover();
      hookFrame();
    }

    let popoverEl = null;
    let popoverSelected = null; // nodeId or null = whole page

    function closePopover() {
      if (popoverEl) { popoverEl.remove(); popoverEl = null; }
      highlightNode(null, false);
    }

    function openPopover(chain, clickEvent) {
      closePopover();
      popoverSelected = chain.length ? chain[0] : null;
      const pop = document.createElement('div');
      pop.className = 'fb-popover';
      const chips = document.createElement('div');
      chips.className = 'fb-chips';
      const allChips = [];
      const makeChip = (label, nodeId, title) => {
        const chip = document.createElement('span');
        chip.className = 'fb-chip';
        chip.textContent = label;
        if (title) chip.title = title;
        chip.onclick = () => {
          popoverSelected = nodeId;
          allChips.forEach((c) => c.classList.remove('sel'));
          chip.classList.add('sel');
          highlightNode(nodeId, !!nodeId);
        };
        allChips.push(chip);
        chips.appendChild(chip);
        return chip;
      };
      chain.slice(0, 5).forEach((nodeId) => makeChip(nodeLabel(nodeId), nodeId, 'Anchor the comment to this element'));
      makeChip('whole page', null, 'A general note not tied to one element');
      const selIdx = chain.length ? 0 : allChips.length - 1;
      allChips[selIdx].classList.add('sel');
      if (popoverSelected) highlightNode(popoverSelected, true);
      pop.appendChild(chips);
      const ta = document.createElement('textarea');
      ta.placeholder = 'Tell the agent what to change…';
      pop.appendChild(ta);
      const actions = document.createElement('div');
      actions.className = 'fb-pop-actions';
      const cancel = document.createElement('button');
      cancel.className = 'fb-btn';
      cancel.textContent = 'Cancel';
      cancel.onclick = closePopover;
      const save = document.createElement('button');
      save.className = 'fb-btn';
      save.textContent = 'Save comment';
      save.onclick = async () => {
        const comment = ta.value.trim();
        if (!comment) { ta.focus(); return; }
        try {
          const res = await fetch('/api/canvas/' + canvasId + '/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(popoverSelected ? { nodeId: popoverSelected, comment } : { comment }),
          });
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          closePopover();
          loadFeedback();
          const fbTab = document.querySelector('.insp-tab[data-tab="feedback"]');
          if (fbTab) fbTab.click();
        } catch (err) { alert('Could not save comment: ' + err.message); }
      };
      actions.appendChild(cancel);
      actions.appendChild(save);
      pop.appendChild(actions);
      document.body.appendChild(pop);
      popoverEl = pop;
      // Position near the click, mapping iframe coords → page coords (handles
      // Fit-mode scaling); clamp so the popover stays on-screen.
      const frame = document.getElementById('frame');
      const rect = frame.getBoundingClientRect();
      const win = frame.contentWindow;
      const sx = win && win.innerWidth ? rect.width / win.innerWidth : 1;
      const sy = win && win.innerHeight ? rect.height / win.innerHeight : 1;
      const px = rect.left + clickEvent.clientX * sx;
      const py = rect.top + clickEvent.clientY * sy;
      pop.style.left = Math.max(8, Math.min(px, window.innerWidth - 316)) + 'px';
      pop.style.top = Math.max(60, Math.min(py + 8, window.innerHeight - pop.offsetHeight - 8)) + 'px';
      ta.focus();
    }

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
    document.getElementById('frame').addEventListener('load', hookFrame);
    hookFrame();
    renderFeedbackPane(FB_INIT);

    // Phase 19 Slice A — click an issue to outline its node in the preview.
    // The render carries data-node-id on every element; iframes are same-origin
    // so we toggle an outline directly in their documents.
    function highlightNode(nodeId, on) {
      const frames = [];
      const main = document.getElementById('frame');
      if (main && getComputedStyle(main).display !== 'none') frames.push(main);
      document.querySelectorAll('.compare-cell iframe').forEach((f) => frames.push(f));
      for (const f of frames) {
        let doc;
        try { doc = f.contentDocument; } catch { continue; }
        if (!doc) continue;
        doc.querySelectorAll('[data-fs-hl]').forEach((n) => {
          n.style.outline = ''; n.style.outlineOffset = ''; n.removeAttribute('data-fs-hl');
        });
        if (on && nodeId) {
          const t = doc.querySelector('[data-node-id="' + (window.CSS && CSS.escape ? CSS.escape(nodeId) : nodeId) + '"]');
          if (t) {
            t.style.outline = '2px solid ' + HIGHLIGHT; t.style.outlineOffset = '1px';
            t.setAttribute('data-fs-hl', '1');
            t.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
      }
    }
    document.querySelectorAll('.insp-issue[data-issue-node]').forEach((el) => {
      el.addEventListener('click', () => {
        const wasSel = el.classList.contains('sel');
        document.querySelectorAll('.insp-issue.sel').forEach((o) => o.classList.remove('sel'));
        if (wasSel) { highlightNode(null, false); return; }
        el.classList.add('sel');
        highlightNode(el.getAttribute('data-issue-node'), true);
      });
    });

    // Phase 19 Slice B — inspector tab switching (Quality / Design system).
    document.querySelectorAll('.insp-tab[data-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.getAttribute('data-tab');
        document.querySelectorAll('.insp-tab[data-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.insp-tabpane').forEach((p) => { p.hidden = p.getAttribute('data-pane') !== name; });
      });
    });
`;
}
