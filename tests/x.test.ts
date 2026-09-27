import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArticleError, errorMessage } from '../src/lib/errors';
import { filenameFromTitle } from '../src/lib/filename';
import { articleToMarkdown } from '../src/lib/markdown';
import { fetchArticle, parseArticleResponse, parseArticleUrl, safeUrl } from '../src/lib/x';
import fixture from './fixtures/article.json';

const source = 'https://x.com/fieldnotes/status/123456789';
const url = parseArticleUrl(source);
if (!url) throw new Error('Invalid fixture URL');
afterEach(() => vi.useRealTimers());

describe('URL parsing', () => {
  it.each([
    source,
    'https://twitter.com/fieldnotes/status/123456789?ref=test#fragment',
    'https://x.com/i/article/123456789',
    'https://mobile.twitter.com/fieldnotes/article/123456789/',
  ])('accepts supported article and post URLs: %s', (input) => {
    expect(parseArticleUrl(input)?.id).toBe('123456789');
    expect(parseArticleUrl(input)?.source).not.toContain('?');
  });
  it.each([
    '',
    'garbage',
    'https://x.com/home',
    'https://example.com/fieldnotes/article/123',
    'https://x.com.evil.test/fieldnotes/article/123',
    'https://x.com@evil.test/a/article/123',
    'https://user:pass@x.com/a/article/123',
    'https://x.com/a/article/abc',
    'https://x.com/a/article/123/edit',
    'javascript:alert(1)',
    'ftp://x.com/a/article/123',
    'https://x.com:8443/a/article/123',
    'https://x.com/home/status/123',
  ])('rejects unsupported or malformed URLs: %s', (input) =>
    expect(parseArticleUrl(input)).toBeNull(),
  );
});

describe('response validation', () => {
  it('falls back from FxTwitter’s unknown epoch date to the publication post date', () => {
    const data = structuredClone(fixture);
    data.tweet.article.created_at = '1970-01-01T00:00:00.000Z';
    expect(parseArticleResponse(data, url).published).toBe('2026-09-26');
  });
  it('uses optional metadata fallbacks and supports keyed entity maps', () => {
    const minimal = {
      tweet: {
        article: {
          content: {
            blocks: [{ text: 'Still useful.', type: 'unstyled' }],
            entityMap: { '0': { type: 'LINK', data: { url: 'https://example.com' } } },
          },
        },
      },
    };
    const article = parseArticleResponse(minimal, url);
    expect(article.title).toBe('Untitled article');
    expect(article.author).toBe('@fieldnotes');
    expect(article.published).toBeUndefined();
    expect(article.entities.get('0')?.url).toBe('https://example.com/');
    expect(articleToMarkdown(article)).not.toContain('undefined');
  });
  it('omits unknown author on /i/article and invalid dates', () => {
    const direct = parseArticleUrl('https://x.com/i/article/123');
    if (!direct) throw new Error('Invalid fixture URL');
    const data = {
      tweet: {
        created_at: 'nonsense',
        article: { content: { blocks: [{ type: 'unstyled', text: 'Text' }] } },
      },
    };
    const article = parseArticleResponse(data, direct);
    expect(article.author).toBeUndefined();
    expect(article.published).toBeUndefined();
  });
  it.each([
    null,
    {},
    { tweet: {} },
    { tweet: { article: {} } },
    { tweet: { article: { content: { blocks: [{ text: 5 }] } } } },
  ])('rejects missing or malformed article bodies', (value) => {
    expect(() => parseArticleResponse(value, url)).toThrow(ArticleError);
  });
  it('rejects ordinary posts rather than exporting tweet text', () => {
    const status = parseArticleUrl('https://x.com/fieldnotes/status/123');
    if (!status) throw new Error('Invalid fixture URL');
    expect(() => parseArticleResponse({ tweet: { text: 'Just a post' } }, status)).toThrow(
      'not-article',
    );
  });
  it('does not accept executable media or link URLs', () => {
    for (const input of [
      'javascript:alert(1)',
      'data:text/html,bad',
      '//evil.test',
      'file:///tmp/a',
      'https://u:p@example.com',
    ])
      expect(safeUrl(input)).toBeUndefined();
  });
});

describe('FxTwitter requests', () => {
  it('requests only the API, omits credentials and removes source tracking parameters', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    const article = await fetchArticle(`${source}?tracking=secret`, fetcher);
    expect(article.source).toBe(source);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.fxtwitter.com/fieldnotes/status/123456789',
      expect.objectContaining({
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }),
    );
  });
  it('does not call the network for unsupported URLs', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchArticle('https://example.com', fetcher)).rejects.toThrow('not-article');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [429, 'rate-limit'],
    [503, 'network'],
    [404, 'extraction'],
  ])('handles HTTP %s', async (status, kind) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: Number(status) }));
    await expect(fetchArticle(source, fetcher)).rejects.toThrow(String(kind));
  });
  it('handles a network failure', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Private raw diagnostic'));
    await expect(fetchArticle(source, fetcher)).rejects.toThrow('network');
    expect(errorMessage(new Error('Private raw diagnostic'))).toBe(
      "Couldn't extract this article.",
    );
  });
  it('handles invalid JSON', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>Upstream error</html>'));
    await expect(fetchArticle(source, fetcher)).rejects.toThrow('extraction');
  });
  it('aborts after 15 seconds', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const pending = expect(fetchArticle(source, fetcher)).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
  });
});

describe('filenames', () => {
  it('creates a filesystem-safe slug', () => {
    expect(filenameFromTitle('Building Software With Agents')).toBe(
      'building-software-with-agents.md',
    );
    expect(filenameFromTitle('  Café: "A/B" <C>? * D|E\\F  ')).toBe('cafe-a-b-c-d-e-f.md');
    expect(filenameFromTitle('🚀')).toBe('x-article.md');
    expect(filenameFromTitle('CON')).toBe('article-con.md');
    expect(filenameFromTitle('../..')).toBe('x-article.md');
  });
  it('preserves non-Latin titles while bounding UTF-8 filename length', () => {
    expect(filenameFromTitle('日本語の文章')).toBe('日本語の文章.md');
    expect(
      new TextEncoder().encode(filenameFromTitle('文'.repeat(500))).length,
    ).toBeLessThanOrEqual(123);
    expect(filenameFromTitle('A'.repeat(500)).length).toBeLessThanOrEqual(123);
  });
});
