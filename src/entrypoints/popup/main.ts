import { downloadMarkdown } from '../../lib/download';
import { ArticleError, errorMessage } from '../../lib/errors';
import { fetchDocument } from '../../lib/extract';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing popup element: ${id}`);
  return result as T;
}

const app = element('app');
const title = element('title');
const author = element('author');
const eyebrow = element('eyebrow');
const status = element('status');
const actions = element('actions');
const download = element<HTMLButtonElement>('download');
const copy = element<HTMLButtonElement>('copy');
const retry = element<HTMLButtonElement>('retry');
let result: { title: string; markdown: string } | undefined;

function setStatus(message: string, tone = '') {
  status.textContent = message;
  status.dataset.tone = tone;
}

async function load() {
  result = undefined;
  status.title = '';
  app.setAttribute('aria-busy', 'true');
  retry.hidden = true;
  actions.hidden = false;
  download.disabled = true;
  copy.disabled = true;
  author.hidden = true;
  title.textContent = 'Getting your post…';
  eyebrow.textContent = 'X TO MARKDOWN';
  setStatus('Connecting to FxTwitter…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const doc = await fetchDocument(tab?.url ?? '');
    const { markdown, warnings } = doc;
    result = { title: doc.title, markdown };
    eyebrow.textContent =
      doc.kind === 'thread'
        ? `X THREAD · ${doc.posts} POSTS`
        : doc.kind === 'post'
          ? 'X POST'
          : 'X ARTICLE';
    title.textContent = doc.title;
    author.textContent = doc.author ?? '';
    author.hidden = !doc.author;
    setStatus(
      `Ready · ${doc.wordCount.toLocaleString()} words${warnings.length ? ` · ${warnings.length} content notices` : ''}`,
    );
    status.title = warnings.map((warning) => warning.message).join('\n');
    download.disabled = false;
    copy.disabled = false;
  } catch (error) {
    const notArticle = error instanceof ArticleError && error.kind === 'not-article';
    eyebrow.textContent = notArticle ? 'X TO MARKDOWN' : 'UNABLE TO LOAD';
    title.textContent = notArticle ? 'A good read.\nYours to keep.' : 'Try this post again.';
    actions.hidden = true;
    setStatus(errorMessage(error), notArticle ? '' : 'error');
    retry.hidden = notArticle;
  } finally {
    app.setAttribute('aria-busy', 'false');
  }
}

copy.addEventListener('click', async () => {
  if (!result) return;
  copy.disabled = true;
  try {
    await navigator.clipboard.writeText(result.markdown);
    setStatus('✓ Copied', 'success');
  } catch {
    setStatus("Couldn't copy. Try again or download the file.", 'error');
  } finally {
    copy.disabled = false;
  }
});

download.addEventListener('click', async () => {
  if (!result) return;
  download.disabled = true;
  setStatus('Downloading…');
  try {
    const id = await downloadMarkdown(result.title, result.markdown);
    // Do not report success before Chrome confirms the download completed.
    const check = async () => {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === 'complete') {
        setStatus('✓ Downloaded', 'success');
        return true;
      }
      if (item?.state === 'interrupted') throw new Error('Download interrupted');
      return false;
    };
    let finished = await check();
    for (let i = 0; !finished && i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      finished = await check();
    }
    if (!finished) setStatus('Download started. Check Chrome’s downloads.');
  } catch {
    setStatus("Couldn't download. Try again or copy Markdown.", 'error');
  } finally {
    download.disabled = false;
  }
});

retry.addEventListener('click', () => void load());
void load();
