import { describe, expect, it } from 'vitest';
import { articleToMarkdown, inlineMarkdown, wordCount } from '../src/lib/markdown';
import { parseArticleResponse, parseArticleUrl } from '../src/lib/x';
import fixture from './fixtures/article.json';

const url = parseArticleUrl('https://x.com/fieldnotes/article/123456789');
if (!url) throw new Error('Invalid fixture URL');
const article = () => parseArticleResponse(structuredClone(fixture), url);

function inline(text: string, styles: { offset: number; length: number; style: string }[] = []) {
  const a = article();
  const block = a.blocks[0];
  if (!block) throw new Error('Missing fixture block');
  return inlineMarkdown({ ...block, text, inlineStyleRanges: styles }, a.entities);
}

describe('article to Markdown', () => {
  it('renders the complete article as stable clean Markdown', () => {
    expect(articleToMarkdown(article())).toMatchSnapshot();
  });
  it('preserves cover, inline image, caption, best video and embedded post', () => {
    const md = articleToMarkdown(article());
    expect(md).toContain('![Cover image](https://pbs.twimg.com/media/cover.jpg)');
    expect(md).toContain('![A notebook](https://pbs.twimg.com/media/notebook.jpg)');
    expect(md).toContain('\n\nOne step at a time.');
    expect(md).toContain('[Watch video](https://video.twimg.com/high.mp4)');
    expect(md).not.toContain('low.mp4');
    expect(md).toContain('[Embedded post](https://x.com/i/status/123456789)');
  });
  it('renders headings, links, styles, lists, quotes and code', () => {
    const md = articleToMarkdown(article());
    expect(md).toContain('## A smaller loop');
    expect(md).toContain('### Make it repeatable');
    expect(md).toContain('🚀 Build **bold** and *italic* tools.');
    expect(md).toContain('[guide](https://example.com/guide)');
    expect(md).toContain(
      '- Write a fixture.\n- Check the output.\n    - Keep emoji intact 👩🏽‍💻.',
    );
    expect(md).toContain('1. Build.\n2. Review.');
    expect(md).toContain('> Small tools should stay small.');
    expect(md).toContain('```ts\nconst answer = 42;\n```');
  });
  it('keeps UTF-16 ranges after astral and joined emoji', () => {
    for (const prefix of ['🚀 ', '👩🏽‍💻 ', '🇭🇷 ', 'e\u0301 ']) {
      expect(inline(`${prefix}bold`, [{ offset: prefix.length, length: 4, style: 'Bold' }])).toBe(
        `${prefix}**bold**`,
      );
    }
  });
  it('repairs a range starting halfway through a surrogate pair', () => {
    const text = inline('A 🔄 update', [{ offset: 3, length: 8, style: 'Bold' }]);
    expect(text).toBe('A **🔄 update**');
    expect(text).not.toMatch(/[\uD800-\uDFFF]/u);
  });
  it('handles same-boundary and crossing bold/italic without losing text', () => {
    expect(
      inline('both', [
        { offset: 0, length: 4, style: 'Bold' },
        { offset: 0, length: 4, style: 'Italic' },
      ]),
    ).toBe('***both***');
    expect(
      inline('one two three', [
        { offset: 0, length: 7, style: 'Bold' },
        { offset: 4, length: 9, style: 'Italic' },
      ]),
    ).toBe('**one *two*** *three*');
  });
  it('preserves links and mentions after emoji and ignores duplicate link annotations', () => {
    const a = article();
    const block = a.blocks[0];
    if (!block) throw new Error('Missing fixture');
    block.text = '🚀 guide @fieldnotes';
    block.entityRanges = [{ offset: 3, length: 5, key: '0' }];
    block.data = {
      urls: [{ fromIndex: 3, toIndex: 8, text: 'https://example.com/guide' }],
      mentions: [{ fromIndex: 9, toIndex: 20, text: 'fieldnotes' }],
    };
    expect(inlineMarkdown(block, a.entities)).toBe(
      '🚀 [guide](https://example.com/guide) [@fieldnotes](https://x.com/fieldnotes)',
    );
  });
  it('quotes YAML metadata and escapes literal Markdown/HTML', () => {
    const a = article();
    a.title = 'Title: "quoted"\nsource: evil';
    expect(articleToMarkdown(a)).toContain(
      'title: "Title: \\"quoted\\"\\nsource: evil"'.replaceAll('\\\\"', '\\"'),
    );
    expect(inline('<script>alert(1)</script> *literal* [text]')).toContain('\\*literal\\*');
    expect(inline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('tolerates unknown blocks and unavailable embeds without silently losing content', () => {
    const a = article();
    const block = a.blocks[0];
    if (!block) throw new Error('Missing fixture');
    block.type = 'future-block';
    a.media.clear();
    expect(articleToMarkdown(a)).toContain('Start small.');
    expect(articleToMarkdown(a)).toContain('[Media unavailable]');
  });
  it('uses a longer code fence if code contains backticks', () => {
    const a = article();
    const entity = a.entities.get('2');
    if (!entity) throw new Error('Missing fixture');
    entity.markdown = '```md\n```\n```';
    expect(articleToMarkdown(a)).toContain('````md\n```\n````');
  });
  it('does not mutate article data and counts human text rather than Markdown URLs', () => {
    const a = article();
    const before = structuredClone(a);
    articleToMarkdown(a);
    expect(a).toEqual(before);
    expect(wordCount(a)).toBeGreaterThan(30);
    expect(wordCount(a)).toBeLessThan(100);
  });
});
