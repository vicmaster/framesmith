// Phase 33 slice A — the archive page's browser script, moved from viewer.ts.
import { COMPONENTS_JS, MOBILE_TOGGLE_JS } from '../components.js';
import { THUMB_FIT_JS } from '../shared.js';

export function archiveScript(): string {
  return `
    ${MOBILE_TOGGLE_JS}
    ${COMPONENTS_JS}
    ${THUMB_FIT_JS}

    // Lifecycle actions: restore / permanent delete. Both call JSON endpoints
    // and reload on success. Delete prompts to confirm — it's irreversible.
    document.querySelectorAll('.card-action').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'delete' && !confirm('Permanently delete this canvas? This cannot be undone.')) return;
        try {
          const url = '/api/canvas/' + id + (action === 'restore' ? '/unarchive' : '');
          const method = action === 'delete' ? 'DELETE' : 'POST';
          const res = await fetch(url, { method });
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          location.reload();
        } catch (err) {
          alert('Action failed: ' + err.message);
        }
      });
    });
`;
}
