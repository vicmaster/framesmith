// Phase 33 — the viewer lives in src/viewer/. This file re-exports what the
// server, the standalone viewer and the tests import, so their paths hold.
export { startViewer, getViewerUrl, setExternalViewerUrl } from './viewer/server.js';
export { renderProjectPage, renderGalleryPage } from './viewer/pages/project.js';
export { renderArchivePage } from './viewer/pages/archive.js';
export { renderDetailPage } from './viewer/pages/detail.js';
export { evalCacheKey, evalFor } from './viewer/scores.js';
