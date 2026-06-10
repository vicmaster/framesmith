import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';

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

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  scale?: number;
  nodeId?: string;
}

export async function takeScreenshot(html: string, options: ScreenshotOptions = {}): Promise<string> {
  const { width = 1440, height = 900, scale = 2, nodeId } = options;
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });

    await page.setContent(html, { waitUntil: 'domcontentloaded' });

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
  children?: LayoutRect[];
}

export async function computeLayout(html: string, rootNodeId?: string, maxDepth = 10): Promise<LayoutRect[]> {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const layouts = await page.evaluate(
      (rootId: string | undefined, depth: number) => {
        function getRect(el: Element, currentDepth: number): { nodeId: string; x: number; y: number; width: number; height: number; children?: ReturnType<typeof getRect>[] } | null {
          const nodeId = el.getAttribute('data-node-id');
          if (!nodeId) return null;

          const rect = el.getBoundingClientRect();
          const result: { nodeId: string; x: number; y: number; width: number; height: number; children?: ReturnType<typeof getRect>[] } = {
            nodeId,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };

          if (currentDepth < depth) {
            const childRects: NonNullable<typeof result.children> = [];
            for (const child of el.children) {
              const childRect = getRect(child, currentDepth + 1);
              if (childRect) childRects.push(childRect);
            }
            if (childRects.length > 0) result.children = childRects;
          }

          return result;
        }

        const rootSelector = rootId ? `[data-node-id="${rootId}"]` : '[data-node-id]';
        const root = document.querySelector(rootSelector);
        if (!root) return [];

        const result = getRect(root, 0);
        return result ? [result] : [];
      },
      rootNodeId,
      maxDepth
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
}

export async function exportToFile(html: string, options: ExportOptions): Promise<string> {
  const { width = 1440, height = 900, scale = 2, format, outputPath, nodeId, fileName } = options;
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

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
