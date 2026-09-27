import { describe, expect, it, vi } from 'vitest';
import { fetchArticle } from '../src/lib/x';
import fixture from './fixtures/article.json';

const articleUrl = 'https://x.com/fieldnotes/article/987654321';
const full = {
  ...fixture,
  tweet: { ...fixture.tweet, article: { ...fixture.tweet.article, id: '987654321' } },
};
const publishingPost = {
  id: '123456789',
  author: { screen_name: 'fieldnotes' },
  article: { id: '987654321' },
};
const unavailable = () => new Response('{}', { status: 404 });

describe('article ID resolution', () => {
  it('resolves a distinct article ID through the author feed and preserves the source', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(Response.json({ code: 200, results: [publishingPost] }))
      .mockResolvedValueOnce(Response.json(full));
    const article = await fetchArticle(articleUrl, fetcher);
    expect(article.title).toBe(fixture.tweet.article.title);
    expect(article.source).toBe(articleUrl);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://api.fxtwitter.com/fieldnotes/status/987654321',
      'https://api.fxtwitter.com/2/profile/fieldnotes/articles?count=100',
      'https://api.fxtwitter.com/fieldnotes/status/123456789',
    ]);
  });
  it('paginates but never scans more than three feed pages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(unavailable());
    for (let i = 0; i < 3; i++)
      fetcher.mockResolvedValueOnce(
        Response.json({
          results: [{ ...publishingPost, article: { id: '555' } }],
          cursor: { bottom: `page-${i}` },
        }),
      );
    await expect(fetchArticle(articleUrl, fetcher)).rejects.toThrow('article-link');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[0]).toContain('cursor=page-1');
  });
  it('never exports an unrelated article returned for the resolved post', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(Response.json({ results: [publishingPost] }))
      .mockResolvedValueOnce(Response.json(fixture));
    await expect(fetchArticle(articleUrl, fetcher)).rejects.toThrow('extraction');
  });
  it('does not mistake another author’s sharing post for the author', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(
        Response.json({
          results: [{ ...publishingPost, author: { screen_name: 'someone_else' } }],
        }),
      );
    await expect(fetchArticle(articleUrl, fetcher)).rejects.toThrow('article-link');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('explains unresolved authorless links without claiming they are ordinary posts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(unavailable());
    await expect(fetchArticle('https://x.com/i/article/987654321', fetcher)).rejects.toThrow(
      'article-link',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not fall back on rate limits or network outages', async () => {
    for (const status of [429, 503]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }));
      await expect(fetchArticle(articleUrl, fetcher)).rejects.toThrow(
        status === 429 ? 'rate-limit' : 'network',
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
