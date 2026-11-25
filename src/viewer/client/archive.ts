// Phase 33 slice E — the archive page's browser script: Restore and Delete
// permanently on the selected canvas. Both reload the archive with the next
// canvas selected (`next`, computed on the server).
import { COMPONENTS_JS, MOBILE_TOGGLE_JS } from '../components.js';
import { scriptJson, THUMB_FIT_JS } from '../shared.js';

export function archiveScript(selectedId: string | null, nextId: string | null): string {
  return `
    ${MOBILE_TOGGLE_JS}
    ${COMPONENTS_JS}
    ${THUMB_FIT_JS}

    (() => {
      const SELECTED = ${scriptJson(selectedId)};
      const NEXT = ${scriptJson(nextId)};
      if (!SELECTED) return;
      const error = document.getElementById('panel-error');
      const after = () => { location.href = '/archive' + (NEXT ? '?canvas=' + encodeURIComponent(NEXT) : ''); };
      const run = async (method, url, verb) => {
        try {
          const res = await fetch(url, { method });
          if (!res.ok) throw new Error('the server answered ' + res.status);
          after();
        } catch (err) {
          error.textContent = 'Could not ' + verb + ' the canvas: ' + err.message;
          error.hidden = false;
        }
      };
      const id = encodeURIComponent(SELECTED);
      const restore = document.getElementById('btn-restore');
      if (restore) restore.addEventListener('click', () => run('POST', '/api/canvas/' + id + '/unarchive', 'restore'));
      document.getElementById('btn-delete').addEventListener('click', async () => {
        if (await window.fsDialog.open('delete-dialog')) run('DELETE', '/api/canvas/' + id, 'delete');
      });
    })();
`;
}
