import './test-env.js';
/**
 * Visual check: detail-page toolbar wraps on narrow viewports.
 * Requires the standalone viewer running (npm run viewer).
 * Run: npx tsx test-viewer-navbar.ts <port>
 * Output: /tmp/framesmith-navbar/
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const PORT = process.argv[2] ?? '3002';
const OUT = '/tmp/framesmith-navbar';

async function main() {
  await mkdir(OUT, { recursive: true });
  const base = `http://localhost:${PORT}`;
  const list = await (await fetch(`${base}/api/canvases`)).json();
  if (!list.length) throw new Error('no canvases to view');
  const id = list[0].id;
  const url = `${base}/canvas/${id}`;

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const sizes = [
    { label: 'mobile-375', width: 375, height: 700 },
    { label: 'narrow-640', width: 640, height: 700 },
    { label: 'desktop-1100', width: 1100, height: 700 },
  ];

  for (const s of sizes) {
    await page.setViewport({ width: s.width, height: s.height });
    await page.goto(url, { waitUntil: 'networkidle0' });
    const box = await page.evaluate(() => {
      const tb = document.querySelector('.toolbar') as HTMLElement;
      const r = tb.getBoundingClientRect();
      const overflow = tb.scrollWidth > tb.clientWidth + 1;
      return { height: r.height, overflow };
    });
    await page.screenshot({ path: join(OUT, `${s.label}.png`) as `${string}.png` });
    console.log(`   ${s.label}: toolbar h=${box.height}px overflowX=${box.overflow}`);
  }

  await browser.close();
  console.log(`\nOpen: open ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });