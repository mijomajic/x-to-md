# Changelog

## 0.1.0 — 2026-09-27

First public release of **X to Markdown**.

- Download X Articles as `.md` files or copy Markdown from a small browser popup.
- Preserve article metadata, headings, bold/italic text, links, lists, quotes, code, images, and captions. Videos and embedded posts become links.
- Extract structured article data through FxTwitter, with article-ID resolution for named-author links.
- Keep emoji formatting intact and generate safe filenames, including non-Latin titles.
- No account, analytics, extension storage, content scripts, or project-operated backend.

### Install

Download `x-to-md-0.1.0-chrome.zip` from this release, extract it into a folder you plan to keep, and load that folder using **Developer mode → Load unpacked** at `chrome://extensions` or `brave://extensions`. Pin the extension, open an X Article, and click **Download .md** or **Copy Markdown**. No Node.js or build step is required for the release ZIP.

Choose the extension ZIP under **Assets**, not GitHub's automatically generated **Source code** archives. `SHA256SUMS` contains the archive's SHA-256 checksum. There is no Chrome Web Store listing yet.

### Known limitations

FxTwitter is a third-party API, so extraction requires a network connection and depends on its availability. Some authorless `x.com/i/article/…` links and older articles require opening the author's publishing post instead. Ordinary posts and threads are not supported. Image URLs remain remote; the export is not an offline media archive.

### Credits

Parts of the extraction implementation are adapted from [Defuddle](https://github.com/kepano/defuddle) by Steph Ango, under the MIT license. The extension also uses [FxTwitter](https://github.com/FixTweet/FxTwitter) and [Turndown](https://github.com/mixmark-io/turndown). Full notices ship in the repository and extension ZIP.
