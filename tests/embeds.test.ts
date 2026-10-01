import { describe, expect, it } from 'vitest';
import { articleToMarkdownWithWarnings } from '../src/lib/markdown';
import { parseArticleResponse, parseArticleUrl } from '../src/lib/x';

function convert(type: string, data: Record<string, unknown> = {}, missing = false) {
  const url = parseArticleUrl('https://x.com/fieldnotes/status/123');
  if (!url) throw new Error('Invalid test URL');
  return articleToMarkdownWithWarnings(
    parseArticleResponse(
      {
        tweet: {
          article: {
            title: 'Embeds',
            content: {
              blocks: [
                { type: 'unstyled', text: 'Before' },
                { type: 'atomic', text: ' ', entityRanges: [{ key: 0, offset: 0, length: 1 }] },
                { type: 'unstyled', text: 'After' },
              ],
              entityMap: missing ? [] : [{ key: '0', value: { type, data } }],
            },
          },
        },
      },
      url,
    ),
  );
}

describe('embed extraction completeness', () => {
  it('renders the real DIVIDER entity as a rule without missing-content warnings', () => {
    const result = convert('DIVIDER');
    expect(result.markdown).toContain('Before\n\n---\n\nAfter');
    expect(result.markdown).not.toContain('[Unsupported embed]');
    expect(result.warnings).toEqual([]);
  });
  it('preserves safe fallback links and captions and flags unsupported content', () => {
    const result = convert('FUTURE', {
      url: 'https://example.com/embed',
      caption: 'Useful content',
    });
    expect(result.markdown).toContain('[Useful content](https://example.com/embed)');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'unsupported-embed',
        block: 1,
        entity: '0',
        url: 'https://example.com/embed',
      }),
    ]);
  });
  it('preserves captions while rejecting executable fallback URLs', () => {
    const result = convert('FUTURE', { url: 'javascript:alert(1)', caption: 'Caption' });
    expect(result.markdown).toContain('Caption\n\n[Unsupported embed]');
    expect(result.markdown).not.toContain('javascript:');
    expect(result.warnings[0]?.url).toBeUndefined();
  });
  it('identifies missing entity data', () => {
    const result = convert('FUTURE', {}, true);
    expect(result.warnings[0]).toMatchObject({ code: 'missing-entity', block: 1, entity: '0' });
  });
  it('reports missing media and preserves its available caption and link', () => {
    const result = convert('MEDIA', { caption: 'Description', url: 'https://example.com/media' });
    expect(result.markdown).toContain('[Media link](https://example.com/media)\n\nDescription');
    expect(result.warnings[0]?.code).toBe('media-unavailable');
    expect(convert('MEDIA', { mediaItems: [{ mediaId: 'missing' }] }).warnings[0]?.code).toBe(
      'media-unavailable',
    );
  });
  it('distinguishes a linked post from extracted post contents', () => {
    const result = convert('TWEET', { tweetId: '123' });
    expect(result.markdown).toContain('[Embedded post](https://x.com/i/status/123)');
    expect(result.warnings[0]).toMatchObject({
      code: 'link-only',
      url: 'https://x.com/i/status/123',
    });
  });
});
