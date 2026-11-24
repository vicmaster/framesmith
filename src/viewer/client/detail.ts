// Phase 33 slice A — the canvas detail page's browser script, moved verbatim
// from viewer.ts; every server value it inlines goes through scriptJson.
import type { Canvas } from '../../types.js';
import { listFeedback } from '../../feedback.js';
import { evalCacheKey } from '../scores.js';
import { buildNodeIndex, scriptJson } from '../shared.js';
import { feedbackKey as feedbackKeyOf } from '../feedback-key.js';
import { LIGHT } from '../tokens.js';
import { COMPONENTS_JS, icon } from '../components.js';

export function detailScript(canvas: Canvas, w: number, h: number, surfaceType: string): string {
  return `
    ${COMPONENTS_JS}
    const canvasId = ${scriptJson(canvas.id)};
    // Outlines drawn inside the canvas iframe, which cannot read the page's CSS variables.
    const HIGHLIGHT = ${scriptJson(LIGHT.colors.accent)};
    const MOON_ICON = ${scriptJson(icon('moon'))};
    const SUN_ICON = ${scriptJson(icon('sun'))};
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
    let NODE_INDEX = ${scriptJson(buildNodeIndex(canvas.root))};
    let feedbackKey = ${scriptJson(feedbackKeyOf(canvas))};

    // Auto-refresh polling, and the Live / Offline status (FR-C1).
    const liveEl = document.getElementById('live');
    const setLive = (ok) => {
      if (!liveEl) return;
      liveEl.classList.toggle('offline', !ok);
      liveEl.querySelector('.live-label').textContent = ok ? 'Live' : 'Offline';
    };
    setInterval(async () => {
      try {
        const res = await fetch('/api/canvas/' + canvasId + '/meta', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const meta = await res.json();
        setLive(true);
        // contentKey catches edits that never bump lastModified (issue #150).
        if (meta.lastModified !== lastModified || (meta.contentKey && meta.contentKey !== contentKey)) {
          if (meta.type !== pageShape.type || (meta.width ?? null) !== pageShape.width || (meta.height ?? null) !== pageShape.height || JSON.stringify(meta.safeArea ?? null) !== pageShape.safeArea) {
            location.reload();
            return;
          }
          lastModified = meta.lastModified;
          contentKey = meta.contentKey || contentKey;
          refreshFrames();
          if (!document.getElementById('json-panel').hidden) loadJson();
        }
        // The panels catch up on their own keys, which move only after a fetch
        // succeeds, so a failed or slow one is retried on the next poll. An
        // edit also re-reads the comments: their "node gone" flags can change.
        if (meta.contentKey && meta.contentKey !== inspectorKey) refreshInspector(meta.contentKey);
        if ((meta.feedbackKey && meta.feedbackKey !== feedbackKey) || (meta.contentKey && meta.contentKey !== feedbackContentKey)) loadFeedback(meta.feedbackKey, meta.contentKey);
      } catch {
        setLive(false);
      }
    }, 2000);

    // Phase 25 slice D — flip every iframe between light and dark renders.
    let themeMode = 'light';
    function toggleTheme() {
      themeMode = themeMode === 'light' ? 'dark' : 'light';
      const btn = document.getElementById('theme-toggle');
      // The label stays "Preview in dark" and aria-pressed says whether it is
      // on; the icon shows the theme the preview is in.
      if (btn) {
        btn.setAttribute('aria-pressed', themeMode === 'dark' ? 'true' : 'false');
        btn.innerHTML = themeMode === 'dark' ? SUN_ICON : MOON_ICON;
      }
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
      const vp = document.getElementById('viewport');
      if (vp && vp.classList.contains('compare')) {
        document.querySelectorAll('.compare-cell iframe').forEach(bump);
      } else {
        bump(document.getElementById('frame'));
      }
    }

    const canvasW = ${scriptJson(w)};
    const canvasH = ${scriptJson(h)};

    // FR-C4 — the preview scales with a transform: fit (never above 100%) by
    // default, or a zoom step. The box takes the scaled size, so the pane
    // scrolls over it when the preview is larger than the pane.
    const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2];
    let bpW = canvasW, bpH = canvasH, zoom = null; // null = fit
    function fitScale() {
      const vp = document.getElementById('viewport');
      const style = getComputedStyle(vp);
      const room = vp.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
      return Math.max(0.05, Math.min(1, room / bpW));
    }
    function applyScale() {
      const box = document.getElementById('frame-box');
      const frame = document.getElementById('frame');
      if (!box || !frame) return;
      const scale = zoom ?? fitScale();
      box.style.width = Math.round(bpW * scale) + 'px';
      box.style.height = Math.round(bpH * scale) + 'px';
      frame.style.width = bpW + 'px';
      frame.style.height = bpH + 'px';
      frame.style.transform = 'scale(' + scale + ')';
      document.getElementById('stage').dataset.scale = scale.toFixed(4);
      document.getElementById('stage').dataset.mode = zoom === null ? 'fit' : 'zoom';
      if (!document.getElementById('viewport').classList.contains('compare')) {
        document.getElementById('btn-zoom-in').disabled = !ZOOM_STEPS.some((s) => s > scale + 1e-6);
        document.getElementById('btn-zoom-out').disabled = !ZOOM_STEPS.some((s) => s < scale - 1e-6);
      }
    }
    function zoomBy(dir) {
      const current = zoom ?? fitScale();
      const next = dir > 0 ? ZOOM_STEPS.find((s) => s > current + 1e-6) : [...ZOOM_STEPS].reverse().find((s) => s < current - 1e-6);
      if (next === undefined) return;
      zoom = next;
      applyScale();
    }
    function fitPreview() { zoom = null; applyScale(); }
    function setZoomTools(enabled) {
      ['btn-zoom-in', 'btn-zoom-out', 'btn-fit'].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = !enabled; });
      if (enabled) applyScale();
    }
    window.addEventListener('resize', () => { if (zoom === null) applyScale(); });
    applyScale();

    function selectBp(bp) {
      document.querySelectorAll('.bp-btn').forEach((b) => {
        const on = b.id === 'bp-' + bp;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      currentBp = bp;
    }

    function setViewport(w, h, bp) {
      const frame = document.getElementById('frame');
      const vp = document.getElementById('viewport');
      vp.classList.remove('compare');
      bpW = w; bpH = h; zoom = null;
      frame.width = w;
      frame.height = h;
      frame.src = '/canvas/' + canvasId + '/html?w=' + w + '&h=' + h + (themeMode === 'dark' ? '&theme=dark' : '') + '&t=' + Date.now();
      selectBp(bp);
      setZoomTools(true);
    }

    function setCompareMode() {
      document.getElementById('viewport').classList.add('compare');
      setZoomTools(false);
      selectBp('compare');
    }

    // The breakpoint tabs fire "tabchange" (click or arrow keys, COMPONENTS_JS).
    const bpTabs = document.querySelector('.bp-tabs');
    if (bpTabs) bpTabs.addEventListener('tabchange', (e) => {
      const tab = document.getElementById('bp-' + e.detail.tab);
      if (e.detail.tab === 'compare') setCompareMode();
      else setViewport(Number(tab.dataset.w), Number(tab.dataset.h), e.detail.tab);
    });

    function toggleSafeArea() {
      const overlay = document.getElementById('safe-overlay');
      overlay.hidden = !overlay.hidden;
      document.getElementById('btn-safe').setAttribute('aria-pressed', overlay.hidden ? 'false' : 'true');
    }

    function toggleJson(force) {
      const panel = document.getElementById('json-panel');
      const open = typeof force === 'boolean' ? force : panel.hidden;
      panel.hidden = !open;
      if (open) { loadJson(); panel.querySelector('button').focus(); }
    }
    document.getElementById('json-panel').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); toggleJson(false); } });

    async function loadJson() {
      try {
        const res = await fetch('/canvas/' + canvasId + '/json');
        const data = await res.json();
        document.getElementById('json-content').textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('json-content').textContent = 'Error loading JSON';
      }
    }

    // Archive / restore / delete. Delete confirms in the dialog first (FR-C3);
    // afterwards the canvas page has nothing to show, so go to the project.
    async function lifecycleAction(action) {
      if (action === 'delete' && !(await fsDialog.open('delete-dialog'))) return;
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

    // FR-C2 — the More menu.
    let copyTimer = 0;
    async function copyCanvasId(item) {
      let ok = false;
      try { await navigator.clipboard.writeText(canvasId); ok = true; } catch {
        const field = document.createElement('textarea');
        field.value = canvasId; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select();
        try { ok = document.execCommand('copy'); } catch {}
        field.remove();
        item.focus();
      }
      const label = item.querySelector('span');
      label.dataset.label = label.dataset.label || label.textContent;
      label.textContent = ok ? 'Copied' : 'Copy failed';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { label.textContent = label.dataset.label; }, 2000);
    }
    const moreMenu = document.querySelector('[data-menu="more-menu"]');
    if (moreMenu) moreMenu.addEventListener('menuaction', (e) => {
      const action = e.detail.action;
      if (action === 'json') toggleJson(true);
      else if (action === 'copy') copyCanvasId(moreMenu.querySelector('[data-action="copy"]'));
      else lifecycleAction(action);
    });

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
        resolveBtn.type = 'button';
        resolveBtn.className = 'btn btn--secondary';
        resolveBtn.textContent = 'Resolve';
        resolveBtn.onclick = (e) => { e.stopPropagation(); fbAction('/feedback/' + entry.id + '/resolve', 'POST'); };
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn--ghost';
        delBtn.textContent = 'Delete';
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          if (!(await fsDialog.open('fb-delete-dialog'))) return;
          await fbAction('/feedback/' + entry.id, 'DELETE');
          document.getElementById('tab-feedback').focus(); // the card it came from is gone
        };
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
      if (!pane) return;
      pane.replaceChildren();
      const open = entries.filter((e) => !e.resolvedAt);
      const done = entries.filter((e) => e.resolvedAt);
      // The open count on the Feedback tab and the Comment button.
      const tabCount = document.querySelector('#tab-feedback .tab-count');
      if (tabCount) tabCount.textContent = String(open.length);
      const commentCount = document.getElementById('comment-count');
      if (commentCount) { commentCount.textContent = String(open.length); commentCount.hidden = open.length === 0; }
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

    let feedbackSeq = 0;
    let feedbackContentKey = contentKey;
    async function loadFeedback(key, forContent) {
      const seq = ++feedbackSeq;
      try {
        const res = await fetch('/api/canvas/' + canvasId + '/feedback', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (seq !== feedbackSeq) return; // a newer fetch is on its way
        renderFeedbackPane(data.entries);
        if (key) feedbackKey = key;
        if (forContent) feedbackContentKey = forContent;
      } catch { /* the pane keeps its last state; the next poll retries */ }
    }

    async function fbAction(suffix, method) {
      try {
        const res = await fetch('/api/canvas/' + canvasId + suffix, { method });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        await loadFeedback();
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
      openPopover(chain);
    }

    function hookFrame() {
      const doc = frameDoc();
      if (!doc) return;
      doc.removeEventListener('click', onFrameClick, true);
      doc.addEventListener('click', onFrameClick, true);
      setFrameCommentAffordance(commentMode);
    }

    // FR-D3 — Comment opens the popover under the button and turns comment
    // mode on; clicking an element in the preview pins the comment to it.
    const pop = document.getElementById('comment-pop');
    const chipsEl = document.getElementById('fb-chips');
    const textEl = document.getElementById('comment-text');
    let popoverSelected = null; // nodeId, or null for the whole page

    function setCommentMode(on) {
      commentMode = on;
      const btn = document.getElementById('btn-comment');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      pop.hidden = !on;
      if (on) { textEl.focus(); } else {
        if (popoverSelected) highlightNode(null, false);
        chipsEl.replaceChildren(); chipsEl.hidden = true; popoverSelected = null;
        textEl.value = '';
      }
      hookFrame();
    }
    function toggleComment() { setCommentMode(!commentMode); }
    /** Close the popover; refocus the Comment button when the popover had focus. */
    function closePopover() {
      if (!commentMode) return;
      const hadFocus = pop.contains(document.activeElement);
      setCommentMode(false);
      if (hadFocus) document.getElementById('btn-comment').focus();
    }

    /** Fill the anchor chips from a clicked element's chain (nearest first). */
    function setAnchor(chain) {
      chipsEl.replaceChildren();
      popoverSelected = chain.length ? chain[0] : null;
      chipsEl.hidden = chain.length === 0;
      highlightNode(popoverSelected, !!popoverSelected);
      if (!chain.length) return;
      const chips = [];
      const makeChip = (label, nodeId, title) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'fb-chip';
        chip.textContent = label;
        chip.title = title;
        chip.setAttribute('aria-pressed', nodeId === popoverSelected ? 'true' : 'false');
        chip.onclick = () => {
          popoverSelected = nodeId;
          chips.forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
          highlightNode(nodeId, !!nodeId);
        };
        chips.push(chip);
        chipsEl.appendChild(chip);
      };
      chain.slice(0, 5).forEach((nodeId) => makeChip(nodeLabel(nodeId), nodeId, 'Pin the comment to this element'));
      makeChip('whole page', null, 'A note about the whole page');
    }
    function openPopover(chain) { if (!commentMode) setCommentMode(true); setAnchor(chain); textEl.focus(); }

    document.getElementById('comment-cancel').addEventListener('click', closePopover);
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closePopover(); } });
    document.getElementById('comment-save').addEventListener('click', async () => {
      const comment = textEl.value.trim();
      if (!comment) { textEl.focus(); return; }
      try {
        const res = await fetch('/api/canvas/' + canvasId + '/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(popoverSelected ? { nodeId: popoverSelected, comment } : { comment }),
        });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        closePopover();
        loadFeedback();
        document.getElementById('tab-feedback').click();
        document.getElementById('tab-feedback').focus();
      } catch (err) { alert('Could not save comment: ' + err.message); }
    });

    // An Escape the menu, dialog or JSON panel already handled keeps the draft.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) closePopover(); });
    document.getElementById('frame').addEventListener('load', hookFrame);
    hookFrame();
    renderFeedbackPane(FB_INIT);

    // Phase 19 Slice A — click an issue to outline its node in the preview.
    // The render carries data-node-id on every element; iframes are same-origin
    // so we toggle an outline directly in their documents.
    function highlightNode(nodeId, on) { highlightNodes(on && nodeId ? [nodeId] : []); }
    // Every outline goes through here, so a "Show n nodes" button is pressed
    // only while its own outline is the one showing.
    function highlightNodes(nodeIds) {
      document.querySelectorAll('.issue-nodes[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
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
        let first = null;
        for (const nodeId of nodeIds) {
          const t = doc.querySelector('[data-node-id="' + (window.CSS && CSS.escape ? CSS.escape(nodeId) : nodeId) + '"]');
          if (!t) continue;
          t.style.outline = '2px solid ' + HIGHLIGHT; t.style.outlineOffset = '1px';
          t.setAttribute('data-fs-hl', '1');
          first = first || t;
        }
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    // FR-D1 — "Show n nodes" outlines an issue's nodes; delegated, so it works
    // after a live swap of the Quality panel.
    document.getElementById('inspector').addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.issue-nodes');
      if (!btn) return;
      const on = btn.getAttribute('aria-pressed') !== 'true';
      highlightNodes(on ? JSON.parse(btn.dataset.nodes) : []);
      if (on) btn.setAttribute('aria-pressed', 'true');
    });

    // FR-D4 — swap the Quality and Design system panels (and the node index)
    // when the canvas changes, keeping the scroll position.
    let inspectorKey = contentKey;
    let inspectorSeq = 0;
    async function refreshInspector(key) {
      const seq = ++inspectorSeq;
      try {
        const res = await fetch('/canvas/' + canvasId + '/inspector', { cache: 'no-store' });
        if (!res.ok) return;
        const parts = await res.json();
        if (seq !== inspectorSeq) return; // a newer fetch is on its way
        const inspector = document.getElementById('inspector');
        const top = inspector.scrollTop;
        document.getElementById('insp-quality').innerHTML = parts.quality;
        document.getElementById('insp-design').innerHTML = parts.design;
        NODE_INDEX = parts.nodeIndex;
        inspector.scrollTop = top;
        inspectorKey = key;
      } catch { /* the panels keep their last state */ }
    }
`;
}
