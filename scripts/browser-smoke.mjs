import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const extensionPath = resolve('.output/chrome-mv3');
const manifest = JSON.parse(await readFile(`${extensionPath}/manifest.json`, 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab', 'downloads', 'clipboardWrite']);
assert.deepEqual(manifest.host_permissions, ['https://api.fxtwitter.com/*']);
assert.equal(manifest.background, undefined);
assert.equal(manifest.content_scripts, undefined);
const extensionId = createHash('sha256')
  .update(extensionPath)
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + Number.parseInt(char, 16)));
const fixture = JSON.parse(await readFile('tests/fixtures/article.json', 'utf8'));
const profile = await mkdtemp(`${tmpdir()}/x-to-md-browser-`);
await mkdir(resolve(profile, 'Default'));
await mkdir(resolve(profile, 'downloads'));
await writeFile(
  resolve(profile, 'Default/Preferences'),
  JSON.stringify({
    download: { default_directory: resolve(profile, 'downloads'), prompt_for_download: false },
  }),
);
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  acceptDownloads: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  viewport: { width: 336, height: 460 },
  deviceScaleFactor: 2,
});
const errors = [];
try {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  // Playwright's download override bypasses chrome.downloads' filename choice.
  // Restore Chrome's normal manager, confined to our temporary profile folder.
  await session.send('Browser.setDownloadBehavior', { behavior: 'default' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('aria-busy') === 'false',
  );
  assert.match(await page.locator('#status').innerText(), /Open an X Article/);
  assert.equal(await page.locator('#actions').isVisible(), false);
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().name), 'X to Markdown');

  // Only substitute the active tab URL. The built extension, API fetch, native
  // clipboard and Chrome downloads APIs run for real in a clean Chromium profile.
  await page.addInitScript((url) => {
    chrome.tabs.query = async () => [{ url, active: true, id: 1 }];
  }, process.env.ARTICLE_URL || 'https://x.com/fieldnotes/article/123456789');
  let mode = 'success';
  if (!process.env.ARTICLE_URL) {
    await context.route('https://api.fxtwitter.com/**', async (route) => {
      if (mode === 'network') return route.abort('internetdisconnected');
      if (mode === 'rate-limit') return route.fulfill({ status: 429, body: '{}' });
      if (mode === 'malformed') return route.fulfill({ status: 200, body: '<html>error</html>' });
      return route.fulfill({ json: fixture });
    });
  }
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('aria-busy') === 'false',
    undefined,
    { timeout: 20000 },
  );
  const readyStatus = await page.locator('#status').innerText();
  assert.match(readyStatus, /^Ready/, `Extraction did not finish: ${readyStatus}`);
  assert.equal(await page.locator('#download').isEnabled(), true);
  assert.equal(await page.locator('#copy').isEnabled(), true);
  await mkdir('test-results', { recursive: true });
  await page.locator('#app').screenshot({ path: 'test-results/popup.png' });
  if (!process.env.ARTICLE_URL && process.env.UPDATE_SCREENSHOT === '1')
    await page.locator('#app').screenshot({ path: 'docs/popup.png' });
  await page.bringToFront();
  await page.locator('#copy').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === '✓ Copied');
  // Read from a separate secure test origin: production never asks for clipboardRead.
  const clipboardPage = await context.newPage();
  await context.route('https://clipboard.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Clipboard check</title>' }),
  );
  await context.grantPermissions(['clipboard-read'], { origin: 'https://clipboard.test' });
  await clipboardPage.goto('https://clipboard.test/');
  await clipboardPage.bringToFront();
  const clipboard = await clipboardPage.evaluate(() => navigator.clipboard.readText());
  await clipboardPage.close();
  await page.bringToFront();
  assert.match(clipboard, /^---\ntitle:/);
  if (!process.env.ARTICLE_URL)
    assert.match(clipboard, /🚀 Build \*\*bold\*\* and \*italic\* tools\./);
  await page.locator('#download').click();
  await page.waitForFunction(
    () => document.querySelector('#status')?.textContent === '✓ Downloaded',
  );
  const [download] = await page.evaluate(() =>
    chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 }),
  );
  assert.equal(download.state, 'complete');
  assert.equal(await readFile(download.filename, 'utf8'), clipboard);
  if (!process.env.ARTICLE_URL)
    assert.ok(download.filename.endsWith('building-software-with-agents.md'), download.filename);
  // The smoke test owns this exact generated file; don't leave fixture exports in Downloads.
  await page.evaluate((id) => chrome.downloads.removeFile(id), download.id);
  await page.evaluate((id) => chrome.downloads.erase({ id }), download.id);
  console.log(
    `Loaded MV3 extension; copied and downloaded: ${await page.locator('#title').innerText()}`,
  );

  if (!process.env.ARTICLE_URL) {
    for (const [failure, message] of [
      ['network', 'Check your connection'],
      ['rate-limit', 'FxTwitter is busy'],
      ['malformed', "Couldn't extract"],
    ]) {
      mode = failure;
      await page.reload();
      await page.waitForFunction(
        () => document.querySelector('#app')?.getAttribute('aria-busy') === 'false',
      );
      assert.ok((await page.locator('#status').innerText()).includes(message));
      assert.equal(await page.locator('#retry').isVisible(), true);
      mode = 'success';
      await page.locator('#retry').click();
      await page.waitForFunction(() =>
        document.querySelector('#status')?.textContent?.startsWith('Ready'),
      );
    }
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error('raw-secret');
      };
    });
    await page.locator('#copy').click();
    await page.waitForFunction(() =>
      document.querySelector('#status')?.textContent?.startsWith("Couldn't copy"),
    );
    await page.evaluate(() => {
      chrome.downloads.download = async () => {
        throw new Error('raw-secret');
      };
    });
    await page.locator('#download').click();
    await page.waitForFunction(() =>
      document.querySelector('#status')?.textContent?.startsWith("Couldn't download"),
    );
    assert.ok(!(await page.locator('body').innerText()).includes('raw-secret'));
    console.log(
      'Verified empty, network, rate-limit, malformed, retry, clipboard failure and download failure states.',
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
