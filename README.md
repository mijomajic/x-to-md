# X to Markdown

Save X Articles as clean Markdown in one click.

[Download the extension](https://github.com/mijomajic/x-to-md/releases/latest) · [Report a bug](https://github.com/mijomajic/x-to-md/issues)

<img src="docs/popup.png" alt="X to Markdown showing an article title, Download .md and Copy Markdown buttons" width="336" />

Open an X Article, click the extension, and **download a `.md` file** or **copy the Markdown**. Free and open source. No account or setup beyond installing the extension.

## Features

- Article title, author, publication date, and source URL.
- Headings, bold, italics, links, lists, quotes, and code blocks.
- Cover images, inline images, captions, and links to embedded videos and posts.
- Emoji support and clean filenames based on the article title.

## Install

Available for Chrome, Brave, and other Chromium browsers. No terminal commands or build step required.

1. Open the [latest release](https://github.com/mijomajic/x-to-md/releases/latest) and download the **`x-to-md-…-chrome.zip`** file under **Assets**. Choose the extension ZIP, not a **Source code** archive.
2. Extract the ZIP into a folder you plan to keep.
3. Open `chrome://extensions` in Chrome, or `brave://extensions` in Brave.
4. Enable **Developer mode**, click **Load unpacked**, and select the extracted folder containing `manifest.json`.
5. Pin **X to Markdown** from the Extensions menu.

Keep the extracted folder in place while the extension is installed. The extension isn't on the Chrome Web Store yet.

To update, replace the contents of that folder with the new release and click **Reload** on the extension's card.

## Use

1. Open an X Article or the author's post that contains it.
2. Click **X to Markdown** in your browser toolbar.
3. Choose **Download .md** or **Copy Markdown**.

Files go to your browser's usual download location. You can paste the Markdown into Obsidian, a text editor, or any app that accepts Markdown.

## Supported articles

Works with `x.com/<username>/article/<id>` and `x.com/<username>/status/<id>` links when the post contains an Article, including equivalent `twitter.com` links. Ordinary posts and threads aren't supported.

If an `x.com/i/article/…` link or an older article fails, open the **author's post that shared the article** and try again. For connection errors, use **Retry** in the popup.

Extraction depends on the third-party FxTwitter API. Deleted, protected, restricted, or unavailable articles may not be accessible. Images remain remote URLs, so the Markdown file isn't an offline media archive. Videos and embedded posts are saved as links.

## Privacy

- No account, tracking, analytics, or backend operated by this project.
- Nothing is stored by the extension. Articles stay in memory until you close the popup; files and clipboard content are saved only when you request them.
- Extraction sends the article or post ID and, where available, the author's username to the [FxTwitter API](https://github.com/FixTweet/FxTwitter). FxTwitter also receives your IP address. Resolving an article link may request the author's article feed.
- Your X cookies, browsing history, and page contents aren't sent. Conversion to Markdown happens in your browser, but extraction isn't fully local.
- Opening the exported file in another app may load images from X's media servers.

## License

[MIT](LICENSE). [Third-party license notices](THIRD_PARTY_NOTICES.md) are included with the extension.

Independent project. Not affiliated with X Corp.
