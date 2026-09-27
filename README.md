# X to Markdown

Save X Articles as clean Markdown in one click.

[Download the extension](https://github.com/mijomajic/x-to-md/releases/latest) · [Report a bug](https://github.com/mijomajic/x-to-md/issues) · [MIT license](LICENSE)

<img src="docs/popup.png" alt="X to Markdown popup with an article title, Download .md and Copy Markdown buttons" width="336" />

<!-- Demo: replace this comment with a short recording of opening an article and saving it. -->

A small Chrome / Chromium extension. Open an X Article, click the extension, then **Download .md** or **Copy Markdown**. No account, service to set up, or configuration screen.

## Features

- Clean Markdown with YAML frontmatter: title, author, publication date when available, and the source URL.
- Paragraphs, headings, bold, italics, links, mentions, quotes, ordered and unordered lists.
- Cover images, article images, captions, code blocks, video links, and embedded-post links.
- Unicode-aware formatting and word counts, including emoji and non-Latin text.
- Safe, bounded filenames, with clear errors and a retry button.
- A tiny Manifest V3 popup. No content scripts or background service worker.

Frontmatter, images, and source URLs are always included. Media is referenced by URL, not downloaded or embedded into the file.

## Installation

### Download and load — no build required

1. Open the [latest release](https://github.com/mijomajic/x-to-md/releases/latest) and download **`x-to-md-0.1.0-chrome.zip`** under **Assets**. Choose the extension ZIP, not the **Source code** archives.
2. Extract the ZIP into a folder you plan to keep. The extracted folder should contain `manifest.json`.
3. Open `chrome://extensions` in Chrome, or `brave://extensions` in Brave.
4. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder.
5. Pin **X to Markdown** from the Extensions menu.
6. Open an X Article, click the extension, and choose **Download .md** or **Copy Markdown**.

Keep the extracted folder in place while the extension is installed. No Node.js, terminal commands, or Chrome Web Store listing is required. To update, extract the new release into the same folder and click **Reload** on the extension's card.

### Build from source

Requires **Node.js 22.12+ (22.x) or 24+** and npm.

1. Clone, install, and build:

   ```sh
   git clone https://github.com/mijomajic/x-to-md.git
   cd x-to-md
   npm ci
   npm run build
   ```

2. Open `chrome://extensions` (or your Chromium browser's extension page).
3. Turn on **Developer mode**, click **Load unpacked**, and select **`.output/chrome-mv3`** inside this repository. On macOS, use **Cmd + Shift + .** in the folder picker to show hidden folders.
4. Pin **X to Markdown**, open an article on X, and click the extension.

Downloads go to your browser's normal download location; its “ask where to save” preference still applies. Existing filenames are made unique. **Copied** means Markdown is on your clipboard; **Downloaded** appears only after Chrome confirms completion.

Run `npm run zip` to create a distributable ZIP and `SHA256SUMS` in `.output/`. This also verifies the production manifest, permissions, assets, and bundled license notices. A ZIP alone cannot be installed by dropping it into Chrome.

## Supported links and limitations

- `https://x.com/<username>/article/<id>`
- `https://x.com/<username>/status/<id>` when the post contains an Article
- Equivalent `twitter.com` links

An article ID can differ from the ID of its publishing post. If the direct FxTwitter lookup fails for a named-author article link, the extension searches up to three pages of that author's article feed, matches the exact article ID, and fetches the publishing post. It keeps your original, normalized URL in the Markdown.

Authorless `x.com/i/article/<id>` links are tried directly, but FxTwitter often cannot resolve them. Open the author's **post that shared the article** and use the extension there. The same workaround applies when an older article is outside the bounded feed lookup. Ordinary posts and threads are intentionally unsupported.

Extraction depends on FxTwitter's availability and on what X exposes to it. Deleted, protected, restricted, or incomplete articles may be unavailable. There is no DOM-scraping fallback and no export of a truncated preview in place of the full article. Unknown text blocks retain their text; unavailable media and unsupported embeds get a small placeholder. Videos and embedded posts become links, not interactive embeds. Underline and strikethrough currently retain their text without those styles.

## Development

```sh
npm ci
npm run dev          # WXT development mode and browser runner
npm run typecheck
npm run lint
npm test            # Synthetic fixtures; no network needed
npm run build       # Production MV3 extension
npm run check       # Typecheck, lint, tests, build, and package verification
npm run zip         # Release ZIP and SHA-256 checksum in .output/
```

WXT uses a separate browser profile for development. If its browser runner cannot find Chrome, use the production build and **Load unpacked** instructions above, then rebuild and reload the extension after edits. Don't distribute a development build: WXT adds development-only capabilities for its reload server.

### Browser smoke test

```sh
npx playwright install chromium
npm run test:browser
```

The smoke test loads the **production extension unpacked** in a fresh Chromium profile, checks the generated manifest, tests the real clipboard and download APIs, compares the downloaded file with the clipboard, and exercises empty/error/retry states. It substitutes only the active-tab URL and FxTwitter response for repeatability. It uses the system clipboard and removes its test download afterward. A screenshot is written to `test-results/popup.png`. To deliberately refresh the README screenshot on macOS/Linux, run `UPDATE_SCREENSHOT=1 npm run test:browser`.

To also test a real public article against the live API (optional):

```sh
ARTICLE_URL='https://x.com/arscontexta/status/2013045749580259680' npm run test:browser
```

This makes actual third-party requests and can fail if the article or API becomes unavailable. It does not copy the article into repository fixtures or documentation. For a manual toolbar check, open a supported article, click the extension, and try both buttons; also try an ordinary page and an offline connection.

### Project layout

```text
src/
  entrypoints/popup/   HTML, CSS, and popup interactions
  lib/
    x.ts              URL validation, FxTwitter requests, response normalization
    markdown.ts       Structured blocks/entities/media → Markdown
    types.ts          Small normalized article model
    filename.ts       Unicode-safe filename generation
    download.ts       Chrome download adapter
    errors.ts         User-facing error messages
tests/                Fixtures and converter/request tests
scripts/              Browser smoke test, package verification, and icon generation
public/               Icons and bundled license notices
```

TypeScript, [WXT](https://wxt.dev/), and plain HTML/CSS. [Turndown](https://github.com/mixmark-io/turndown) is the only direct runtime dependency; it handles inline Markdown escaping and emphasis from our generated, escaped markup. No UI framework. The icon is an editable SVG; regenerate its PNG sizes with `node scripts/icons.mjs` after installing Playwright's Chromium.

## How it works

1. `activeTab` provides the current tab URL only when you invoke the extension.
2. The URL is validated and stripped of query strings and fragments.
3. The extension requests structured data from `api.fxtwitter.com`, resolving a distinct article ID through the author's article feed if necessary.
4. Only the returned Article's blocks, entities, metadata, and media are converted. The surrounding X UI is never read.
5. Markdown stays in popup memory until you copy or download it. Closing the popup discards that memory.

Draft.js article offsets use JavaScript **UTF-16 code units**. FxTwitter's tweet facets use **Unicode code points**. These are different: applying tweet-facet conversion to article ranges would shift formatting after emoji. Tests cover astral characters, joined emoji, overlapping styles, and malformed surrogate boundaries.

## Privacy

- No account, tracking, analytics, telemetry, or backend operated by this project.
- Nothing is persistently stored by the extension: no storage permission, saved preferences, article history, or cache. Explicit exports go to your clipboard or disk, and Chrome maintains its usual download history.
- Extraction makes HTTPS requests to the **third-party [FxTwitter API](https://github.com/FixTweet/FxTwitter)**. It receives the article/post ID, username where present, and your IP address as part of normal network requests. Named article-ID resolution can also request that author's article feed and pagination cursors.
- Requests omit credentials and referrers. X session cookies, browsing history, and page contents are not sent. This project does not control FxTwitter's data handling or availability.
- This is **not fully local extraction**. Markdown conversion happens in your browser after the API response arrives.
- Opening exported Markdown in another application may load remote images from X's media servers.

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Read the current tab URL when you click the extension. |
| `downloads` | Save the `.md` file and check download completion. |
| `clipboardWrite` | Copy Markdown after a button click. |
| `https://api.fxtwitter.com/*` | Fetch structured article data and resolve article IDs. |

No broad host access, X host permission, cookies, `tabs`, `scripting`, or storage permission.

## Contributing

Small, focused fixes are welcome. Please include a minimal synthetic fixture for extraction bugs and run `npm run check`; run `npm run test:browser` when changing the popup, permissions, or export behavior. `npm run format` applies formatting and safe lint fixes.

Keep the scope **X Article → Markdown**. Avoid adding accounts, server infrastructure, telemetry, generic webpage clipping, or extra settings screens. Do not commit private article content, credentials, generated builds, or browser profiles. If you change adapted extraction code, retain its attribution and keep both copies of `THIRD_PARTY_NOTICES.md` in sync.

## Acknowledgements

**[Defuddle by Steph Ango (@kepano)](https://github.com/kepano/defuddle)** is the foundation for the extraction approach. Parts of our FxTwitter response mapping, Draft.js entity/media handling, code-block handling, and metadata fallback are adapted from its MIT-licensed [`x-oembed.ts`](https://github.com/kepano/defuddle/blob/6a0f47234fbd620f0d6e6fa11cfa3a699ddd74aa/src/extractors/x-oembed.ts). We also followed its distinction between Unicode code-point facet indices and UTF-16 article indices.

Thanks to **[FxTwitter](https://github.com/FixTweet/FxTwitter)** for the structured API, and **[Turndown](https://github.com/mixmark-io/turndown)** for Markdown serialization. FxTwitter is an external service; its implementation is not bundled or copied into this extension.

The full upstream MIT notices and pinned Defuddle provenance are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and included in the built extension.

## License

[MIT](LICENSE). Adapted Defuddle code retains its original copyright notice. This is an independent project, unaffiliated with X Corp.
