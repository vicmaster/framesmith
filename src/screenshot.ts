import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';

let browser: Browser | null = null;

/** Chrome binary override. FRAMESMITH_CHROME_PATH wins so users can point the MCP
 * server at a specific Chrome without disturbing other Puppeteer consumers;
 * PUPPETEER_EXECUTABLE_PATH is passed through explicitly because env-based config
 * isn't picked up when the server is launched by an MCP client with a stripped env. */
function chromeExecutablePath(): string | undefined {
  return process.env.FRAMESMITH_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
}

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    const executablePath = chromeExecutablePath();
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to launch Chrome for rendering.\n` +
        `Tried: ${executablePath ?? 'the Puppeteer-managed Chrome (~/.cache/puppeteer)'}\n` +
        `Fixes, in order:\n` +
        `  1. Install the managed browser: npx puppeteer browsers install chrome\n` +
        `  2. Or point at an existing Chrome: set FRAMESMITH_CHROME_PATH (or PUPPETEER_EXECUTABLE_PATH) in the MCP server's env config — note MCP clients often launch servers with a minimal env, so set it in the server config, not your shell profile.\n` +
        `  3. macOS: if the binary was quarantined, run: xattr -dr com.apple.quarantine <chrome dir>\n` +
        `Underlying error: ${detail}`,
      );
    }
  }
  return browser;
}

/** Run a callback against a fresh page on the shared browser (Phase 17 —
 * the import engine reuses the singleton + its launch hardening instead of
 * spawning a second Chrome). The page is always closed afterwards. */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

/** Like withPage, but in a throwaway browser context — canvas_import_url runs
 * here so auth headers/cookies never touch the shared default context and are
 * gone when the context closes (spec FR-C2). */
export async function withIsolatedPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const context = await b.createBrowserContext();
  try {
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context.close();
  }
}

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  scale?: number;
  nodeId?: string;
  /** Phase 29 slice E — capture the whole scrollable document instead of just
   * the viewport. Off by default so every existing caller (diffs, exports,
   * responsive sets, the pattern gate) keeps producing byte-identical output;
   * a design taller than its artboard previously could only be seen by editing
   * `document.height` by hand. */
  fullPage?: boolean;
}

/**
 * Grow the page to its real content height so a capture can exceed the artboard.
 *
 * A full-document capture has to relax the ARTBOARD, not just ask Puppeteer for
 * fullPage. The root frame carries the canvas height as a fixed `height`, so
 * taller content overflows it without extending the scrollable area and Chrome
 * captures the artboard box either way. Turning that height into a floor on the
 * root — and only the root, which is body's single child — lets the document
 * grow to its real content height. Inner fixed heights are untouched.
 *
 * Puppeteer's own `fullPage` is NOT reliable here: it returns the full document
 * on a fresh browser, then silently returns viewport-sized output for every
 * later call once any non-fullPage capture has run in the same browser.
 * framesmith keeps ONE browser for the whole session and takes many screenshots
 * through it, so that is the normal case, not the edge — the flag would have
 * appeared to work in a unit test and failed in use. Measuring the document and
 * sizing the viewport to it is deterministic and owes nothing to that behaviour.
 *
 * Shared by takeScreenshot and exportToFile: `export` shipped without full-page
 * support while `screenshot` had it, so saving a long design meant passing the
 * height by hand. One helper means the two capture paths can't drift again.
 */
async function expandViewportToContent(
  page: Page,
  { width, height, scale }: { width: number; height: number; scale: number },
): Promise<void> {
  await page.addStyleTag({
    content: `body > *:first-child { height: auto !important; min-height: ${height}px; }`,
  });
  const contentHeight = await page.evaluate(() => Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
  ));
  if (contentHeight > height) {
    await page.setViewport({ width, height: contentHeight, deviceScaleFactor: scale });
  }
}

export async function takeScreenshot(html: string, options: ScreenshotOptions = {}): Promise<string> {
  const { width = 1440, height = 900, scale = 2, nodeId, fullPage = false } = options;
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });

    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    if (fullPage && !nodeId) await expandViewportToContent(page, { width, height, scale });

    let screenshotBuffer: Uint8Array;

    if (nodeId) {
      const element = await page.$(`[data-node-id="${nodeId}"]`);
      if (!element) throw new Error(`Node "${nodeId}" not found in rendered HTML`);
      screenshotBuffer = await element.screenshot({ type: 'png' });
    } else {
      screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
    }

    return Buffer.from(screenshotBuffer).toString('base64');
  } finally {
    await page.close();
  }
}

export interface LayoutRect {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Phase 24 slice D — overflow capture for stress testing. scroll* >
   * client* means content is being cut off; `ellipsis` marks a designed
   * truncation (text-overflow: ellipsis), reported softer. */
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  ellipsis?: boolean;
  /** Phase 30 slice D — a primitive whose label (a `data-fs-label` element)
   * is cut off by its designed one-line ellipsis. */
  truncated?: boolean;
  /** Phase 30 slice D — a `data-fs-scroll` element (a sheet panel): its
   * vertical overflow scrolls, it is not a clip. */
  scrolls?: boolean;
  children?: LayoutRect[];
}

/** Browser-side layout walker (string function — see the __name note at the
 * call site). Captures rects plus overflow data (scroll* vs client*, ellipsis)
 * only when content actually exceeds its box, so snapshots stay lean. */
const LAYOUT_WALKER_SOURCE = `(function (rootId, depth) {
  function getRect(el, currentDepth) {
    var nodeId = el.getAttribute('data-node-id');
    if (!nodeId) return null;
    var rect = el.getBoundingClientRect();
    var result = {
      nodeId: nodeId,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) {
      result.scrollWidth = el.scrollWidth;
      result.clientWidth = el.clientWidth;
      result.scrollHeight = el.scrollHeight;
      result.clientHeight = el.clientHeight;
      if (getComputedStyle(el).textOverflow === 'ellipsis') result.ellipsis = true;
    }
    if (el.hasAttribute('data-fs-primitive')) {
      var labels = el.querySelectorAll('[data-fs-label]');
      for (var j = 0; j < labels.length; j++) {
        if (labels[j].closest('[data-node-id]') !== el) continue;
        if (labels[j].scrollWidth > labels[j].clientWidth + 1) { result.truncated = true; break; }
      }
    }
    if (el.hasAttribute('data-fs-scroll')) result.scrolls = true;
    if (currentDepth < depth) {
      var childRects = [];
      for (var i = 0; i < el.children.length; i++) {
        var childRect = getRect(el.children[i], currentDepth + 1);
        if (childRect) childRects.push(childRect);
      }
      if (childRects.length > 0) result.children = childRects;
    }
    return result;
  }
  var rootSelector = rootId ? '[data-node-id="' + rootId + '"]' : '[data-node-id]';
  var root = document.querySelector(rootSelector);
  if (!root) return [];
  var result = getRect(root, 0);
  return result ? [result] : [];
})`;

export async function computeLayout(html: string, rootNodeId?: string, maxDepth = 10, viewport?: { width: number; height: number }): Promise<LayoutRect[]> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({ width: viewport?.width ?? 1440, height: viewport?.height ?? 900 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // String-function walker — the tsx/esbuild `__name` workaround, same as
    // DOM_WALKER_SOURCE in import.ts: a nested named function inside a normal
    // page.evaluate callback gets an injected __name helper that doesn't
    // exist in the browser context.
    const layouts = await page.evaluate(
      `(${LAYOUT_WALKER_SOURCE})(${JSON.stringify(rootNodeId ?? null)}, ${JSON.stringify(maxDepth)})`,
    );

    return layouts as LayoutRect[];
  } finally {
    await page.close();
  }
}

export interface ExportOptions {
  width?: number;
  height?: number;
  scale?: number;
  format: 'png' | 'jpeg' | 'webp' | 'pdf';
  outputPath: string;
  nodeId?: string;
  fileName?: string;
  /** Capture the whole design rather than one viewport (see takeScreenshot). */
  fullPage?: boolean;
}

export async function exportToFile(html: string, options: ExportOptions): Promise<string> {
  const { width = 1440, height = 900, scale = 2, format, outputPath, nodeId, fileName, fullPage = false } = options;
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // PDF paginates on its own; growing the viewport would fight that.
    if (fullPage && !nodeId && format !== 'pdf') {
      await expandViewportToContent(page, { width, height, scale });
    }

    const dir = resolve(outputPath);
    await mkdir(dir, { recursive: true });

    const baseName = fileName ?? (nodeId ?? 'canvas');
    const filePath = join(dir, `${baseName}.${format}`);

    if (format === 'pdf') {
      const pdfBuffer = await page.pdf({
        width: `${width}px`,
        height: `${height}px`,
        printBackground: true,
      });
      await writeFile(filePath, pdfBuffer);
    } else {
      let screenshotBuffer: Uint8Array;

      if (nodeId) {
        const element = await page.$(`[data-node-id="${nodeId}"]`);
        if (!element) throw new Error(`Node "${nodeId}" not found in rendered HTML`);
        screenshotBuffer = await element.screenshot({ type: format });
      } else {
        screenshotBuffer = await page.screenshot({ type: format, fullPage: false });
      }

      await writeFile(filePath, screenshotBuffer);
    }

    return filePath;
  } finally {
    await page.close();
  }
}

export interface Breakpoint {
  label: string;
  width: number;
  height: number;
}

export interface ResponsiveResult {
  label: string;
  width: number;
  height: number;
  data: string;
}

export async function takeResponsiveScreenshots(
  renderForBreakpoint: (bp: Breakpoint) => string,
  breakpoints: Breakpoint[],
  scale = 2,
): Promise<ResponsiveResult[]> {
  const results: ResponsiveResult[] = [];
  const b = await getBrowser();

  // Render HTML separately per breakpoint so the body's max-width / min-height
  // scaffold matches the viewport, not the largest breakpoint. The viewport
  // change alone would already let @media rules fire, but matching the scaffold
  // gives true reflow — no inflated min-height leaking design-width padding
  // into smaller shots.
  for (const bp of breakpoints) {
    const page = await b.newPage();
    try {
      await page.setViewport({ width: bp.width, height: bp.height, deviceScaleFactor: scale });
      await page.setContent(renderForBreakpoint(bp), { waitUntil: 'domcontentloaded' });
      const buffer = await page.screenshot({ type: 'png', fullPage: false });
      results.push({
        label: bp.label,
        width: bp.width,
        height: bp.height,
        data: Buffer.from(buffer).toString('base64'),
      });
    } finally {
      await page.close();
    }
  }

  return results;
}

export interface DiffResult {
  diffImage: string;
  changedPixels: number;
  totalPixels: number;
  changePercent: number;
}

export async function computeDiff(
  html1: string,
  html2: string,
  width = 1440,
  height = 900,
  scale = 1,
): Promise<DiffResult> {
  const b = await getBrowser();

  // Take raw screenshots of both canvases
  async function renderToBuffer(html: string): Promise<Uint8Array> {
    const page = await b.newPage();
    try {
      await page.setViewport({ width, height, deviceScaleFactor: scale });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      return await page.screenshot({ type: 'png', fullPage: false });
    } finally {
      await page.close();
    }
  }

  const buf1 = await renderToBuffer(html1);
  const buf2 = await renderToBuffer(html2);

  // Decode PNGs to raw RGBA using a canvas in the browser
  const page = await b.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: scale });

    // Use page.evaluate with a string function to avoid tsx/esbuild __name transform issues
    const b64_1 = Buffer.from(buf1).toString('base64');
    const b64_2 = Buffer.from(buf2).toString('base64');

    await page.setContent(`<html><body>
      <img id="img1" /><img id="img2" />
      <canvas id="diff"></canvas>
      <script>
        window._runDiff = async function(src1, src2) {
          function loadImg(src) {
            return new Promise(function(resolve, reject) {
              var img = new Image();
              img.onload = function() {
                var c = document.createElement('canvas');
                c.width = img.width;
                c.height = img.height;
                var ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(ctx.getImageData(0, 0, c.width, c.height));
              };
              img.onerror = reject;
              img.src = src;
            });
          }

          var data1 = await loadImg(src1);
          var data2 = await loadImg(src2);
          var w = Math.min(data1.width, data2.width);
          var h = Math.min(data1.height, data2.height);
          var totalPixels = w * h;
          var changedPixels = 0;
          var diffCanvas = document.getElementById('diff');
          diffCanvas.width = w;
          diffCanvas.height = h;
          var diffCtx = diffCanvas.getContext('2d');
          var diffData = diffCtx.createImageData(w, h);

          for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
              var i1 = (y * data1.width + x) * 4;
              var i2 = (y * data2.width + x) * 4;
              var iD = (y * w + x) * 4;
              var d = Math.abs(data1.data[i1] - data2.data[i2])
                    + Math.abs(data1.data[i1+1] - data2.data[i2+1])
                    + Math.abs(data1.data[i1+2] - data2.data[i2+2])
                    + Math.abs(data1.data[i1+3] - data2.data[i2+3]);
              if (d > 10) {
                diffData.data[iD] = 255;
                diffData.data[iD+1] = 0;
                diffData.data[iD+2] = 0;
                diffData.data[iD+3] = 200;
                changedPixels++;
              } else {
                diffData.data[iD] = data1.data[i1];
                diffData.data[iD+1] = data1.data[i1+1];
                diffData.data[iD+2] = data1.data[i1+2];
                diffData.data[iD+3] = Math.round(data1.data[i1+3] * 0.3);
              }
            }
          }
          diffCtx.putImageData(diffData, 0, 0);
          var diffBase64 = diffCanvas.toDataURL('image/png').replace('data:image/png;base64,', '');
          return { diffImage: diffBase64, changedPixels: changedPixels, totalPixels: totalPixels };
        };
      </script>
    </body></html>`, { waitUntil: 'domcontentloaded' });

    const diffResult = await page.evaluate(
      (s1, s2) => (window as unknown as { _runDiff: (a: string, b: string) => Promise<{ diffImage: string; changedPixels: number; totalPixels: number }> })._runDiff(s1, s2),
      'data:image/png;base64,' + b64_1,
      'data:image/png;base64,' + b64_2,
    );

    return {
      ...diffResult,
      changePercent: diffResult.totalPixels > 0
        ? Math.round((diffResult.changedPixels / diffResult.totalPixels) * 10000) / 100
        : 0,
    };
  } finally {
    await page.close();
  }
}

export async function shutdown(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
