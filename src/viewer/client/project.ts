// Phase 33 slice B — the gallery's browser script: search and type filter
// kept in the URL (FR-B3), and the live poll with its Live / Offline status
// (FR-B4).
import { COMPONENTS_JS, MOBILE_TOGGLE_JS } from '../components.js';
import { scriptJson, THUMB_FIT_JS } from '../shared.js';

export function projectScript(projectId: string, initialKey: string): string {
  return `
    ${MOBILE_TOGGLE_JS}
    ${COMPONENTS_JS}
    ${THUMB_FIT_JS}

    (() => {
      const projectId = ${scriptJson(projectId)};
      const cards = Array.from(document.querySelectorAll('.card'));
      const search = document.getElementById('search');
      const tablist = document.querySelector('.filter-bar [role="tablist"]');
      const noMatch = document.getElementById('no-match');
      const params = new URLSearchParams(location.search);
      let query = params.get('q') || '';
      let type = params.get('type') || 'all';

      const apply = () => {
        const q = query.trim().toLowerCase();
        let shown = 0;
        for (const card of cards) {
          const on = (!q || card.dataset.name.includes(q)) && (type === 'all' || card.dataset.type === type);
          card.hidden = !on;
          if (on) shown++;
        }
        if (noMatch) {
          noMatch.hidden = shown > 0 || cards.length === 0;
          document.getElementById('no-match-text').textContent = q ? 'No canvases match \\u201c' + query.trim() + '\\u201d' : 'No canvases of this type';
        }
        const next = new URLSearchParams();
        if (q) next.set('q', query.trim());
        if (type !== 'all') next.set('type', type);
        const url = location.pathname + (next.toString() ? '?' + next : '');
        if (url !== location.pathname + location.search) history.replaceState(null, '', url);
      };
      const selectTab = (id) => {
        const tab = tablist && tablist.querySelector('[data-tab="' + id + '"]');
        if (!tab) { type = 'all'; return; }
        tablist.querySelectorAll('[role="tab"]').forEach((t) => { const on = t === tab; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
      };

      if (search) {
        search.value = query;
        search.addEventListener('input', () => { query = search.value; apply(); });
      }
      if (tablist) tablist.addEventListener('tabchange', (e) => { type = e.detail.tab; apply(); });
      const clear = document.getElementById('clear-filters');
      if (clear) clear.addEventListener('click', () => { query = ''; if (search) search.value = ''; selectTab('all'); type = 'all'; apply(); if (search) search.focus(); });
      selectTab(type);
      apply();

      // Live: reload when a base canvas of this project is added, removed,
      // edited, renamed, retyped, re-genred or gains or loses a state.
      const galleryKey = (rows) => {
        const live = rows.filter((r) => r.projectId === projectId && !r.archived);
        const present = new Set(live.map((r) => r.id));
        return live
          .filter((r) => !(r.variant && present.has(r.variant.of)))
          .map((r) => [r.id, r.versionHash, r.name, r.type || '', r.genre || '', (r.variants || []).map((v) => v.state).sort().join(',')].join('|'))
          .sort()
          .join('\\n');
      };
      const initialKey = ${scriptJson(initialKey)};
      const live = document.getElementById('live');
      const setLive = (ok) => {
        live.classList.toggle('offline', !ok);
        live.querySelector('.live-label').textContent = ok ? 'Live' : 'Offline';
      };
      setInterval(async () => {
        try {
          const res = await fetch('/api/canvases', { cache: 'no-store' });
          if (!res.ok) throw new Error(String(res.status));
          const rows = await res.json();
          setLive(true);
          if (galleryKey(rows) !== initialKey) location.reload();
        } catch { setLive(false); }
      }, 3000);
    })();
`;
}
