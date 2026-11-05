/**
 * Ordinary X posts and author threads, read from FxTwitter's v2 status API.
 * Tweet `raw_text.facets` indices are Unicode code points (unlike article
 * Draft.js ranges, which are UTF-16), so they are converted here exactly once.
 */
import { ArticleError } from './errors';
import { destination, inlineMarkdown, label } from './markdown';
import type { Block, ExtractionWarning } from './types';
import { type ArticleUrl, requestJson, safeUrl } from './x';

export interface PostFacet {
  type: string;
  start: number;
  end: number;
  replacement?: string;
  display?: string;
  original?: string;
}

export interface PostMedia {
  type: 'photo' | 'video' | 'gif';
  image?: string;
  video?: string;
  alt: string;
}

export interface PollChoice {
  label: string;
  count: number;
  percentage: number;
}

export interface Post {
  id: string;
  source: string;
  author?: string;
  published?: string;
  text: string;
  range: [number, number];
  facets: PostFacet[];
  media: PostMedia[];
  quote?: Post;
  poll?: { choices: PollChoice[]; total: number; ended: boolean };
  replyingTo?: { author: string; source: string };
  note?: string;
}

export interface PostDocument {
  kind: 'post' | 'thread';
  title: string;
  author?: string;
  published?: string;
  source: string;
  posts: Post[];
}

const HANDLE = /^[a-zA-Z0-9_]{1,15}$/;
const STATUS_ID = /^\d{1,25}$/;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function id(value: unknown): string {
  return typeof value === 'number' ? String(value) : str(value);
}
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function date(timestamp: unknown, text: unknown): string | undefined {
  const value =
    typeof timestamp === 'number' && timestamp > 0
      ? new Date(timestamp * 1000)
      : new Date(str(text));
  return Number.isFinite(value.getTime()) && value.getTime() > 0
    ? value.toISOString().slice(0, 10)
    : undefined;
}

function parseMedia(input: unknown): PostMedia | undefined {
  const item = record(input);
  const type = str(item.type);
  if (type === 'photo') {
    const image = safeUrl(item.url);
    return image ? { type, image, alt: str(item.altText ?? item.alt_text) } : undefined;
  }
  if (type === 'video' || type === 'gif') {
    const mp4 = list(item.formats ?? item.variants)
      .map(record)
      .filter((f) => (f.container === 'mp4' || f.content_type === 'video/mp4') && safeUrl(f.url))
      .sort((a, b) => num(b.bitrate ?? b.bit_rate) - num(a.bitrate ?? a.bit_rate));
    const video = safeUrl(mp4[0]?.url) ?? safeUrl(item.url);
    const image = safeUrl(item.thumbnail_url);
    return video || image
      ? { type, video, image, alt: str(item.altText ?? item.alt_text) }
      : undefined;
  }
  return undefined;
}

/** Normalize one FxTwitter v2 status. Never trusts upstream URLs or handles. */
export function parsePost(input: unknown, depth = 0): Post {
  const status = record(input);
  const postId = id(status.id);
  const raw = record(status.raw_text);
  const text = typeof raw.text === 'string' ? raw.text : str(status.text);
  if (!STATUS_ID.test(postId) || typeof (raw.text ?? status.text) !== 'string')
    throw new ArticleError('extraction');
  const handle = str(record(status.author).screen_name);
  const author = HANDLE.test(handle) ? handle : undefined;
  const length = Array.from(text).length;
  const range = list(raw.display_text_range);
  const start = Math.max(0, Math.min(length, num(range[0])));
  const end = range.length === 2 ? Math.max(start, Math.min(length, num(range[1]))) : length;
  const facets: PostFacet[] = list(raw.facets)
    .map(record)
    .map((f) => {
      const [a, b] = list(f.indices).map(num);
      return {
        type: str(f.type),
        start: a ?? -1,
        end: b ?? -1,
        replacement: str(f.replacement) || undefined,
        display: str(f.display) || undefined,
        original: str(f.original) || undefined,
      };
    })
    .filter((f) => Number.isSafeInteger(f.start) && f.start >= 0 && f.end > f.start);
  const media = list(record(status.media).all)
    .map(parseMedia)
    .filter((m): m is PostMedia => !!m);
  const pollInput = record(status.poll);
  const choices = list(pollInput.choices)
    .map(record)
    .map((c) => ({ label: str(c.label), count: num(c.count), percentage: num(c.percentage) }))
    .filter((c) => c.label);
  const reply = record(status.replying_to);
  const replyHandle = str(reply.screen_name);
  const replyId = id(reply.status ?? status.replying_to_status);
  const note = record(status.community_note);
  const quote = depth === 0 && status.quote ? safeQuote(status.quote) : undefined;
  return {
    id: postId,
    source: `https://x.com/${author ?? 'i'}/status/${postId}`,
    author: author && `@${author}`,
    published: date(status.created_timestamp, status.created_at),
    text,
    range: [start, end],
    facets,
    media,
    ...(quote && { quote }),
    ...(choices.length && {
      poll: {
        choices,
        total: num(pollInput.total_votes),
        ended: str(pollInput.time_left_en).toLowerCase().includes('final'),
      },
    }),
    ...(HANDLE.test(replyHandle) &&
      STATUS_ID.test(replyId) && {
        replyingTo: {
          author: `@${replyHandle}`,
          source: `https://x.com/${replyHandle}/status/${replyId}`,
        },
      }),
    ...(str(note.text).trim() && { note: str(note.text).trim() }),
  };
}

function safeQuote(input: unknown): Post | undefined {
  try {
    return parsePost(input, 1);
  } catch {
    return undefined;
  }
}

/**
 * Long-form ("note") posts can carry facet indices from the truncated text.
 * Verify each checkable facet against its original text and relocate or drop
 * it, so a misaligned media facet can never delete real words.
 */
function alignFacets(post: Post): { facets: PostFacet[]; aligned: boolean } {
  const chars = Array.from(post.text);
  const joined = post.text;
  let aligned = true;
  const used = new Set<number>();
  const facets: PostFacet[] = [];
  for (const facet of post.facets) {
    const prefix = { mention: '@', hashtag: '#', cashtag: '$' }[facet.type] ?? '';
    const original = facet.original?.replace(/^[@#$]/, '');
    if (!original) {
      if (!['bold', 'italic'].includes(facet.type) || facet.end <= chars.length) facets.push(facet);
      continue;
    }
    const expected = `${prefix}${original}`.toLowerCase();
    const at = (start: number) =>
      chars
        .slice(start, start + Array.from(expected).length)
        .join('')
        .toLowerCase() === expected;
    if (at(facet.start) && !used.has(facet.start)) {
      used.add(facet.start);
      facets.push(facet);
      continue;
    }
    aligned = false;
    // Relocate to the nearest unused exact occurrence, in code points.
    let best = -1;
    const lower = joined.toLowerCase();
    for (let i = lower.indexOf(expected); i >= 0; i = lower.indexOf(expected, i + 1)) {
      const point = Array.from(joined.slice(0, i)).length;
      if (
        !used.has(point) &&
        (best < 0 || Math.abs(point - facet.start) < Math.abs(best - facet.start))
      )
        best = point;
    }
    if (best < 0) continue;
    used.add(best);
    facets.push({ ...facet, start: best, end: best + Array.from(expected).length });
  }
  // Styles cannot be verified; drop them when other facets proved misaligned.
  return {
    facets: aligned ? facets : facets.filter((f) => !['bold', 'italic'].includes(f.type)),
    aligned,
  };
}

/** Rewrite a post's display text into UTF-16 paragraph blocks for the article renderer. */
export function postBlocks(post: Post): Block[] {
  const chars = Array.from(post.text);
  const { facets } = alignFacets(post);
  const [start, end] = post.range;
  // Map each code point index to its UTF-16 offset in the rewritten text.
  const map = new Array<number>(chars.length + 1).fill(-1);
  const urls: { from: number; to: number; url: string }[] = [];
  const mentions: { from: number; to: number; text: string }[] = [];
  const replacements = facets
    .filter((f) => ['url', 'media'].includes(f.type) && f.start >= start && f.end <= end)
    .sort((a, b) => a.start - b.start);
  let output = '';
  let cursor = start;
  const copy = (until: number) => {
    for (; cursor < until; cursor++) {
      map[cursor] = output.length;
      output += chars[cursor] ?? '';
    }
  };
  for (const facet of replacements) {
    if (facet.start < cursor) continue;
    copy(facet.start);
    const from = output.length;
    const url = safeUrl(facet.replacement);
    if (facet.type === 'url' && url) {
      output += facet.display || url;
      urls.push({ from, to: output.length, url });
    }
    for (; cursor < facet.end; cursor++) map[cursor] = from;
  }
  copy(end);
  map[end] = output.length;
  const at = (index: number) => {
    for (let i = Math.min(Math.max(index, start), end); i <= end; i++)
      if ((map[i] ?? -1) >= 0) return map[i] ?? output.length;
    return output.length;
  };
  for (const facet of facets) {
    if (facet.start < start || facet.end > end) continue;
    const from = at(facet.start);
    const to = at(facet.end);
    if (to <= from) continue;
    const segment = output.slice(from, to);
    if (facet.type === 'mention') mentions.push({ from, to, text: segment });
    else if (facet.type === 'hashtag' && /^#\w+$/u.test(segment))
      urls.push({ from, to, url: `https://x.com/hashtag/${encodeURIComponent(segment.slice(1))}` });
    else if (facet.type === 'cashtag' && /^\$\w+$/u.test(segment))
      urls.push({ from, to, url: `https://x.com/search?q=${encodeURIComponent(segment)}` });
  }
  const styles = facets
    .filter((f) => ['bold', 'italic'].includes(f.type))
    .map((f) => ({ from: at(f.start), to: at(f.end), style: f.type.toUpperCase() }))
    .filter((s) => s.to > s.from);

  // Split into paragraphs so blank lines become Markdown paragraphs, not <br> runs.
  const blocks: Block[] = [];
  for (const match of output.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]*)*/g)) {
    const text = match[0].replace(/\s+$/, '');
    const offset = match.index ?? 0;
    if (!text.trim()) continue;
    const limit = offset + text.length;
    const clip = <T extends { from: number; to: number }>(items: T[]) =>
      items
        .filter((r) => r.from < limit && r.to > offset)
        .map((r) => ({
          ...r,
          from: Math.max(r.from, offset) - offset,
          to: Math.min(r.to, limit) - offset,
        }));
    blocks.push({
      text,
      type: 'unstyled',
      depth: 0,
      inlineStyleRanges: clip(styles).map((s) => ({
        offset: s.from,
        length: s.to - s.from,
        style: s.style,
      })),
      entityRanges: [],
      data: {
        urls: clip(urls).map((u) => ({ fromIndex: u.from, toIndex: u.to, text: u.url })),
        mentions: clip(mentions).map((m) => ({ fromIndex: m.from, toIndex: m.to, text: m.text })),
      },
    });
  }
  return blocks;
}

export function postPlainText(post: Post): string {
  return postBlocks(post)
    .map((b) => b.text)
    .join('\n\n');
}

function postBody(post: Post, index: number, warnings: ExtractionWarning[]): string {
  const parts = postBlocks(post).map((block) => inlineMarkdown(block, new Map()));
  for (const media of post.media) {
    const image = media.image
      ? `![${label(media.alt || (media.type === 'photo' ? 'Image' : 'Video thumbnail'))}](${destination(media.image)})`
      : '';
    if (media.video) {
      warnings.push({
        code: 'link-only',
        message: 'Video is preserved as a link; its contents were not transcribed.',
        block: index,
        url: media.video,
      });
      parts.push(
        [image, `[Watch ${media.type === 'gif' ? 'GIF' : 'video'}](${destination(media.video)})`]
          .filter(Boolean)
          .join('\n\n'),
      );
    } else if (image) parts.push(image);
  }
  if (post.poll) {
    const lines = post.poll.choices.map(
      (c) => `- ${label(c.label)} — ${c.percentage}% (${c.count.toLocaleString('en-US')} votes)`,
    );
    lines.push(
      '',
      `*Poll · ${post.poll.total.toLocaleString('en-US')} votes${post.poll.ended ? ' · final results' : ' · still open'}*`,
    );
    parts.push(lines.join('\n'));
  }
  if (post.quote) {
    const quote = post.quote;
    const who = quote.author ? label(quote.author) : 'Quoted post';
    const header = `**[${who}](${destination(quote.source)})**${quote.published ? ` · ${quote.published}` : ''}`;
    const body = postBody(quote, index, warnings) || `[Quoted post](${destination(quote.source)})`;
    parts.push(
      [header, body]
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n'),
    );
  }
  if (post.note) parts.push(`> **Community note:** ${label(post.note).replace(/\n+/g, ' ')}`);
  return parts.filter(Boolean).join('\n\n');
}

function title(doc: PostDocument): string {
  const first = doc.posts[0] ? postPlainText(doc.posts[0]) : '';
  const line = (first.split('\n').find((l) => l.trim()) ?? '').replace(/\s+/g, ' ').trim();
  if (!line)
    return `${doc.kind === 'thread' ? 'Thread' : 'Post'} by ${doc.author ?? 'unknown author'}`;
  if (Array.from(line).length <= 80) return line;
  const cut = Array.from(line).slice(0, 80).join('');
  return `${cut.replace(/\s+\S*$/, '') || cut}…`;
}

export function postsToMarkdownWithWarnings(doc: PostDocument): {
  markdown: string;
  warnings: ExtractionWarning[];
} {
  const warnings: ExtractionWarning[] = [];
  const bodies = doc.posts.map((post, index) => {
    const reply =
      index === 0 && post.replyingTo
        ? `*Replying to [${label(post.replyingTo.author)}](${destination(post.replyingTo.source)})*\n\n`
        : '';
    return reply + postBody(post, index, warnings);
  });
  const body = bodies.filter(Boolean).join('\n\n---\n\n');
  if (!body.trim()) throw new ArticleError('extraction');
  const metadata = [`title: ${JSON.stringify(doc.title)}`, `type: ${doc.kind}`];
  const who = doc.author ? label(doc.author) : 'unknown author';
  const heading =
    doc.kind === 'thread' ? `Thread by ${who} (${doc.posts.length} posts)` : `Post by ${who}`;
  if (doc.author) metadata.push(`author: ${JSON.stringify(doc.author)}`);
  if (doc.published) metadata.push(`published: ${doc.published}`);
  metadata.push(`source: ${doc.source}`);
  if (doc.kind === 'thread') metadata.push(`posts: ${doc.posts.length}`);
  return {
    markdown: `---\n${metadata.join('\n')}\n---\n\n# ${heading}\n\n${body}\n`,
    warnings,
  };
}

export function postsWordCount(doc: PostDocument): number {
  const text = doc.posts.map(postPlainText).join('\n');
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)).filter(
    (segment) => segment.isWordLike,
  ).length;
}

/** Build a post or thread document from a `2/status` or `2/thread` response. */
export function parsePostResponse(input: unknown, url: ArticleUrl, thread = true): PostDocument {
  const response = record(input);
  if (response.code === 429) throw new ArticleError('rate-limit');
  if (response.code !== undefined && response.code !== 200) throw new ArticleError('extraction');
  const status = parsePost(response.status);
  if (status.id !== url.id) throw new ArticleError('extraction');
  let posts = [status];
  if (thread) {
    const items = list(response.thread)
      .map((item) => {
        try {
          return parsePost(item);
        } catch {
          return undefined;
        }
      })
      .filter((p): p is Post => !!p && p.author === status.author);
    // Only accept an author thread that actually contains the requested post.
    if (items.length > 1 && items.some((p) => p.id === status.id))
      posts = items.filter((p, i) => items.findIndex((q) => q.id === p.id) === i);
  }
  const doc: PostDocument = {
    kind: posts.length > 1 ? 'thread' : 'post',
    title: '',
    author: status.author ?? (url.username ? `@${url.username}` : undefined),
    published: posts[0]?.published,
    source: url.source,
    posts,
  };
  doc.title = title(doc);
  return doc;
}

export async function fetchPost(
  input: ArticleUrl,
  fetcher: typeof fetch = fetch,
  thread = true,
): Promise<PostDocument> {
  if (input.kind !== 'status') throw new ArticleError('not-article');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const path = `2/${thread ? 'thread' : 'status'}/${input.id}`;
    return parsePostResponse(await requestJson(path, fetcher, controller.signal), input, thread);
  } finally {
    clearTimeout(timeout);
  }
}
