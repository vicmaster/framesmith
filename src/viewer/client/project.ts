// Phase 33 slice A — the project page's browser script, moved from viewer.ts.
import { COMPONENTS_JS, MOBILE_TOGGLE_JS } from '../components.js';
import { scriptJson, THUMB_FIT_JS } from '../shared.js';

export function projectScript(projectId: string, count: number): string {
  return `
    ${MOBILE_TOGGLE_JS}
    ${COMPONENTS_JS}
    ${THUMB_FIT_JS}

    // Auto-refresh: poll the canvas count for this project, reload if it changes.
    let lastCount = ${scriptJson(count)};
    const projectId = ${scriptJson(projectId)};
    setInterval(async () => {
      try {
        const res = await fetch('/api/canvases');
        const data = await res.json();
        const inProject = data.filter((c) => c.projectId === projectId && !c.archived).length;
        if (inProject !== lastCount) location.reload();
      } catch {}
    }, 3000);
`;
}
