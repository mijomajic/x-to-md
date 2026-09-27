import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Run with `node scripts/icons.mjs` after `npx playwright install chromium`.
const svg = await readFile(new URL('../public/icon/source.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>body{margin:0}svg{width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}
