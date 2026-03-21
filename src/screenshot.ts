import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
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

export async function shutdown(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
