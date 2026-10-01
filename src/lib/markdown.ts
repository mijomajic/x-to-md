/**
 * Draft.js entity/media handling adapted from Defuddle's x-oembed.ts (MIT).
 * Copyright (c) 2025 Steph Ango (@kepano). See THIRD_PARTY_NOTICES.md.
 * We serialize structured API data, never scrape or convert the surrounding X DOM.
 */
import TurndownService from 'turndown';
import { ArticleError } from './errors';
import type { Article, Block, Entity, ExtractionWarning } from './types';
import { safeUrl } from './x';

function html(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
function destination(url: string): string {
  return url.replace(/[()<>\s\\]/g, (c) =>
    encodeURIComponent(c).replace('(', '%28').replace(')', '%29'),
  );
}
function label(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&');
}

const turndown = new TurndownService({
  emDelimiter: '*',
  strongDelimiter: '**',
  codeBlockStyle: 'fenced',
});
const escapeText = turndown.escape.bind(turndown);
turndown.escape = (text) =>
  escapeText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
turndown.addRule('safe-link', {
  filter: 'a',
  replacement: (content, node) => {
    const url = safeUrl(node.getAttribute('href'));
    return url ? `[${content}](${destination(url)})` : content;
  },
});

interface Span {
  start: number;
  end: number;
  open: string;
  close: string;
  priority: number;
}

/** Draft ranges are UTF-16 already. Never apply tweet facet code-point conversion here. */
function span(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string,
  priority: number,
): Span | undefined {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    start >= text.length
  )
    return;
  end = Math.min(end, text.length);
  // Repair malformed upstream boundaries without splitting an emoji surrogate pair.
  if (
    start > 0 &&
    /[\uDC00-\uDFFF]/.test(text[start] ?? '') &&
    /[\uD800-\uDBFF]/.test(text[start - 1] ?? '')
  )
    start--;
  if (
    end < text.length &&
    /[\uDC00-\uDFFF]/.test(text[end] ?? '') &&
    /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')
  )
    end++;
  return { start, end, open, close, priority };
}

export function inlineMarkdown(block: Block, entities: Map<string, Entity>): string {
  const { text } = block;
  const spans: Span[] = [];
  const add = (s: Span | undefined) => {
    if (s) spans.push(s);
  };
  const link = (start: number, end: number, input: string) => {
    const url = safeUrl(input);
    if (url) add(span(text, start, end, `<a href="${html(url)}">`, '</a>', 0));
  };
  for (const range of block.inlineStyleRanges) {
    const tags: Record<string, string> = {
      BOLD: 'strong',
      ITALIC: 'em',
      CODE: 'code',
      STRIKETHROUGH: 'del',
      UNDERLINE: 'u',
    };
    const tag = tags[range.style.toUpperCase()];
    if (tag)
      add(
        span(
          text,
          range.offset,
          range.offset + range.length,
          `<${tag}>`,
          `</${tag}>`,
          tag === 'strong' ? 1 : 2,
        ),
      );
  }
  for (const range of block.entityRanges) {
    const entity = entities.get(range.key);
    if (entity?.type === 'LINK') link(range.offset, range.offset + range.length, entity.url);
  }
  for (const item of block.data.urls) link(item.fromIndex, item.toIndex, item.text);
  for (const item of block.data.mentions) {
    const handle = item.text.replace(/^@/, '');
    if (/^\w{1,15}$/.test(handle)) link(item.fromIndex, item.toIndex, `https://x.com/${handle}`);
  }

  // A sweep with a stable tag stack keeps nested/crossing styles valid HTML.
  // Turndown handles Markdown's whitespace and emphasis delimiter rules.
  const boundaries = [...new Set([0, text.length, ...spans.flatMap((s) => [s.start, s.end])])].sort(
    (a, b) => a - b,
  );
  let output = '';
  let stack: Span[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i] ?? 0;
    const end = boundaries[i + 1] ?? text.length;
    const active = spans
      .filter((s) => s.start <= start && s.end >= end)
      .sort((a, b) => a.priority - b.priority || a.start - b.start || b.end - a.end);
    // API entities and block annotations can describe the same link.
    const next = active.filter(
      (s, index) => s.priority !== 0 || active.findIndex((a) => a.priority === 0) === index,
    );
    let shared = 0;
    while (shared < stack.length && stack[shared] === next[shared]) shared++;
    for (let j = stack.length - 1; j >= shared; j--) output += stack[j]?.close ?? '';
    for (const s of next.slice(shared)) output += s.open;
    output += html(text.slice(start, end)).replace(/\n/g, '<br>');
    stack = next;
  }
  output += stack
    .reverse()
    .map((s) => s.close)
    .join('');
  return turndown.turndown(output);
}

function codeFence(code: string, language = ''): string {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const lang = /^[\w#+.-]+$/.test(language) ? language : '';
  return `${fence}${lang}\n${code.replace(/\n$/, '')}\n${fence}`;
}

function atomicMarkdown(
  block: Block,
  article: Article,
  blockIndex: number,
  warnings: ExtractionWarning[],
): string {
  const keys = [...new Set(block.entityRanges.map((r) => r.key))];
  if (!keys.length) {
    warnings.push({
      code: 'missing-entity',
      message: 'Embed has no entity reference.',
      block: blockIndex,
    });
    return block.text.trim() ? label(block.text) : '[Unsupported embed]';
  }
  return keys
    .map((key) => {
      const warn = (code: ExtractionWarning['code'], message: string, url?: string) => {
        warnings.push({ code, message, block: blockIndex, entity: key, ...(url && { url }) });
      };
      const entity = article.entities.get(key);
      if (!entity) {
        warn('missing-entity', `Embed entity ${key} is unavailable.`);
        return '[Unsupported embed]';
      }
      if (entity.type === 'DIVIDER') return '---';
      if (entity.type === 'MARKDOWN') {
        const match = entity.markdown.match(/^(`{3,})([^\n]*)\n([\s\S]*?)\n?\1\s*$/);
        return match ? codeFence(match[3] ?? '', match[2]?.trim()) : codeFence(entity.markdown);
      }
      if (entity.type === 'TWEET' && /^\d+$/.test(entity.tweetId)) {
        const url = `https://x.com/i/status/${entity.tweetId}`;
        warn('link-only', 'Embedded post is preserved as a link; its text was not fetched.', url);
        return `[Embedded post](${url})`;
      }
      if (entity.type === 'MEDIA') {
        const items = entity.mediaIds.map((id) => {
          const media = article.media.get(id);
          if (!media || (!media.image && !media.video)) {
            warn('media-unavailable', `Media ${id} is unavailable.`);
            return '[Media unavailable]';
          }
          const image = media.image
            ? `![${label(media.alt || entity.caption || 'Image')}](${destination(media.image)})`
            : '';
          if (media.video) {
            warn(
              'link-only',
              'Video is preserved as a link; its contents were not transcribed.',
              media.video,
            );
            return [image, `[Watch video](${destination(media.video)})`]
              .filter(Boolean)
              .join('\n\n');
          }
          return image || '[Media unavailable]';
        });
        if (!entity.mediaIds.length) {
          warn('media-unavailable', 'Media embed has no media references.');
          if (entity.url) items.push(`[Media link](${destination(entity.url)})`);
          else items.push('[Media unavailable]');
        }
        if (entity.caption) items.push(label(entity.caption));
        return items.join('\n\n') || '[Media unavailable]';
      }
      if (entity.type === 'LINK' && entity.url)
        return `[${label(entity.caption || 'Link')}](${destination(entity.url)})`;
      warn(
        'unsupported-embed',
        `Unsupported embed type: ${entity.type || 'unknown'}.`,
        entity.url || undefined,
      );
      return entity.url
        ? `[${label(entity.caption || 'Embedded content')}](${destination(entity.url)})`
        : [entity.caption && label(entity.caption), '[Unsupported embed]']
            .filter(Boolean)
            .join('\n\n');
    })
    .join('\n\n');
}

export function articleToMarkdown(article: Article): string {
  return articleToMarkdownWithWarnings(article).markdown;
}

export function articleToMarkdownWithWarnings(article: Article): {
  markdown: string;
  warnings: ExtractionWarning[];
} {
  const warnings: ExtractionWarning[] = [];
  const parts: string[] = [];
  let previousList = false;
  const listStack: { type: string; count: number }[] = [];
  for (const [blockIndex, block] of article.blocks.entries()) {
    const isList = block.type === 'unordered-list-item' || block.type === 'ordered-list-item';
    if (isList) {
      // Clamp impossible depth jumps while preserving valid nested lists.
      const depth = Math.min(block.depth, listStack.length);
      const continuesList = previousList && (depth > 0 || listStack[0]?.type === block.type);
      listStack.length = depth + 1;
      const previous = listStack[depth];
      const count = previous?.type === block.type ? previous.count + 1 : 1;
      listStack[depth] = { type: block.type, count };
      const marker = block.type === 'ordered-list-item' ? `${count}. ` : '- ';
      const indent = '    '.repeat(depth);
      const text = inlineMarkdown(block, article.entities).replace(
        /\n/g,
        `\n${indent}${' '.repeat(marker.length)}`,
      );
      const line = `${indent}${marker}${text}`;
      if (continuesList) parts[parts.length - 1] += `\n${line}`;
      else parts.push(line);
      previousList = true;
      continue;
    }
    listStack.length = 0;
    previousList = false;
    if (block.type === 'atomic') {
      parts.push(atomicMarkdown(block, article, blockIndex, warnings));
      continue;
    }
    if (block.type === 'code-block') {
      parts.push(codeFence(block.text));
      continue;
    }
    const text = inlineMarkdown(block, article.entities);
    if (!text) continue;
    const heading: Record<string, string> = {
      'header-one': '##',
      'header-two': '##',
      'header-three': '###',
      'header-four': '####',
    };
    if (heading[block.type]) parts.push(`${heading[block.type]} ${text.replace(/\n/g, ' ')}`);
    else if (block.type === 'blockquote')
      parts.push(
        text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
      );
    else parts.push(text);
  }
  const body = parts.filter(Boolean).join('\n\n');
  if (!body.trim()) throw new ArticleError('extraction');
  // JSON string escaping is also valid YAML quoting (including embedded newlines).
  const metadata = [`title: ${JSON.stringify(article.title)}`];
  if (article.author) metadata.push(`author: ${JSON.stringify(article.author)}`);
  if (article.published) metadata.push(`published: ${article.published}`);
  metadata.push(`source: ${article.source}`);
  const cover = article.cover ? `![Cover image](${destination(article.cover)})\n\n` : '';
  return {
    markdown: `---\n${metadata.join('\n')}\n---\n\n# ${label(article.title)}\n\n${cover}${body}\n`,
    warnings,
  };
}

export function wordCount(article: Article): number {
  const text = article.blocks
    .filter((b) => b.type !== 'atomic')
    .map((b) => b.text)
    .join('\n');
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)).filter(
    (segment) => segment.isWordLike,
  ).length;
}
