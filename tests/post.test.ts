import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli/run';
import { fetchDocument } from '../src/lib/extract';
import {
  parsePost,
  parsePostResponse,
  postBlocks,
  postsToMarkdownWithWarnings,
} from '../src/lib/post';
import { parseArticleUrl } from '../src/lib/x';
import article from './fixtures/article.json';
import thread from './fixtures/thread.json';

const source = 'https://x.com/fieldnotes/status/222';
const url = parseArticleUrl(source);
if (!url) throw new Error('Invalid fixture URL');

/** v1 lookups return a plain post (no Article); v2 thread lookups return the fixture. */
function fetcher(v2: unknown = thread) {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) =>
      String(input).includes('/2/')
        ? Response.json(v2)
        : Response.json({ code: 200, tweet: { text: 'plain post' } }),
    );
}

describe('posts and threads', () => {
  it('renders an author thread with polls, quotes, media and links', () => {
    const doc = parsePostResponse(thread, url);
    expect(doc.kind).toBe('thread');
    // Replies from other accounts are never mixed into the author's thread.
    expect(doc.posts.map((p) => p.id)).toEqual(['111', '222']);
    expect(doc.title).toBe('First post is *bold* about prices.');
    const { markdown, warnings } = postsToMarkdownWithWarnings(doc);
    expect(markdown).toMatchSnapshot();
    expect(markdown).toContain('# Thread by @fieldnotes (2 posts)');
    expect(markdown).toContain('**\\*bold\\***');
    expect(markdown).toContain('[@friend](https://x.com/friend)');
    expect(markdown).toContain('[#tags](https://x.com/hashtag/tags)');
    expect(markdown).toContain('[example.com/report](https://example.com/report)');
    expect(markdown).not.toContain('t.co');
    expect(markdown).toContain('- Yes — 75% (30 votes)');
    expect(markdown).toContain('> **[@other\\_user](https://x.com/other_user/status/333)**');
    expect(markdown).toContain('> Quoted &lt;words&gt; &amp; stuff');
    expect(warnings).toEqual([]);
  });

  it('exports a single post with --no-thread semantics', () => {
    const doc = parsePostResponse(thread, url, false);
    expect(doc.kind).toBe('post');
    const { markdown, warnings } = postsToMarkdownWithWarnings(doc);
    expect(markdown).toContain('# Post by @fieldnotes');
    expect(markdown).toContain('*Replying to [@fieldnotes](https://x.com/fieldnotes/status/111)*');
    expect(markdown).toContain('![A chart](https://pbs.twimg.com/media/a.jpg)');
    expect(markdown).toContain('[Watch video](https://video.twimg.com/high.mp4)');
    expect(markdown).not.toContain('javascript:');
    expect(warnings).toEqual([expect.objectContaining({ code: 'link-only', block: 0 })]);
  });

  it('converts code-point facets around emoji to UTF-16 offsets', () => {
    const [block] = postBlocks(parsePost(thread.status));
    expect(block?.text).toBe('Second 🧵 post with @friend and #tags example.com/report');
    const mention = block?.data.mentions[0];
    expect(block?.text.slice(mention?.fromIndex, mention?.toIndex)).toBe('@friend');
  });

  it('never deletes words when facet indices are misaligned', () => {
    const post = parsePost({
      id: '9',
      raw_text: {
        text: 'Keep every word here. https://t.co/pic',
        facets: [
          { type: 'media', indices: [5, 21], original: 'https://t.co/pic' },
          { type: 'italic', indices: [0, 4] },
        ],
      },
    });
    expect(postBlocks(post).map((b) => b.text)).toEqual(['Keep every word here.']);
    expect(postBlocks(post)[0]?.inlineStyleRanges).toEqual([]);
  });

  it('rejects malformed statuses and thread responses for another post', () => {
    expect(() => parsePost({ id: 'abc', text: 'x' })).toThrow('extraction');
    const other = parseArticleUrl('https://x.com/fieldnotes/status/999');
    if (!other) throw new Error('Invalid URL');
    expect(() => parsePostResponse(thread, other)).toThrow('extraction');
    expect(() => parsePostResponse({ code: 404 }, url)).toThrow('extraction');
    expect(() => parsePostResponse({ code: 429 }, url)).toThrow('rate-limit');
  });

  it('falls back from Articles to posts only for statuses without an Article', async () => {
    const doc = await fetchDocument(source, { fetcher: fetcher() });
    expect(doc).toMatchObject({ kind: 'thread', posts: 2, author: '@fieldnotes', source });
    const articleDoc = await fetchDocument(source, {
      fetcher: vi.fn<typeof fetch>().mockImplementation(async () => Response.json(article)),
    });
    expect(articleDoc.kind).toBe('article');
    await expect(
      fetchDocument('https://x.com/fieldnotes/article/222', { fetcher: fetcher() }),
    ).rejects.toThrow();
  });

  it('requests only the status endpoint with --no-thread and reports kind in JSON', async () => {
    const io = {
      stdout: vi.fn<(text: string) => void>(),
      stderr: vi.fn<(text: string) => void>(),
      fetcher: fetcher({ code: 200, status: thread.status }),
    };
    expect(await runCli([source, '--json', '--no-thread'], io)).toBe(0);
    expect(io.fetcher.mock.calls.map(([input]) => String(input))).toContain(
      'https://api.fxtwitter.com/2/status/222',
    );
    expect(JSON.parse(io.stdout.mock.calls.flat().join(''))).toMatchObject({
      ok: true,
      kind: 'post',
      posts: 1,
      author: '@fieldnotes',
    });
  });
});
