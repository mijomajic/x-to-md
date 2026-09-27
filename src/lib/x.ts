/**
 * Article response mapping adapted from Defuddle's x-oembed.ts (MIT).
 * Copyright (c) 2025 Steph Ango (@kepano). See THIRD_PARTY_NOTICES.md.
 */
import { ArticleError } from './errors';
import type { Article, Block, Entity, Media } from './types';

export interface ArticleUrl {
  username?: string;
  id: string;
  kind: 'article' | 'status';
  source: string;
}

const HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);
const RESERVED = new Set([
  'home',
  'explore',
  'search',
  'settings',
  'intent',
  'compose',
  'notifications',
  'messages',
]);

export function parseArticleUrl(input: string): ArticleUrl | null {
  try {
    const url = new URL(input);
    if (
      !HOSTS.has(url.hostname) ||
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const match = url.pathname.match(
      /^\/([a-zA-Z0-9_]{1,15})\/(article|status)\/([0-9]{1,25})\/?$/,
    );
    if (!match) return null;
    const [, username = '', kind, id = ''] = match;
    if (RESERVED.has(username.toLowerCase())) return null;
    return {
      username: username.toLowerCase() === 'i' ? undefined : username,
      id,
      kind: kind as 'article' | 'status',
      source: `https://x.com/${username}/${kind}/${id}`,
    };
  } catch {
    return null;
  }
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    /* Invalid upstream URLs are omitted, never executed. */
  }
  return undefined;
}

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
function integer(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) ? (value as number) : fallback;
}

function date(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (value === '') return undefined;
  const parsed = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > 0
    ? parsed.toISOString().slice(0, 10)
    : undefined;
}

function normalizeBlock(input: unknown): Block {
  const block = record(input);
  if (typeof block.text !== 'string' || typeof block.type !== 'string')
    throw new ArticleError('extraction');
  const data = record(block.data);
  const ranges = (value: unknown) =>
    list(value)
      .map(record)
      .filter(
        (r) =>
          Number.isSafeInteger(r.offset) &&
          Number.isSafeInteger(r.length) &&
          Number(r.offset) >= 0 &&
          Number(r.length) > 0,
      );
  const annotations = (value: unknown) =>
    list(value)
      .map(record)
      .map((r) => ({
        fromIndex: integer(r.fromIndex),
        toIndex: integer(r.toIndex),
        text: str(r.text),
      }));
  return {
    text: block.text,
    type: block.type,
    depth: Math.max(0, Math.min(8, integer(block.depth))),
    inlineStyleRanges: ranges(block.inlineStyleRanges).map((r) => ({
      offset: Number(r.offset),
      length: Number(r.length),
      style: str(r.style),
    })),
    entityRanges: ranges(block.entityRanges).map((r) => ({
      offset: Number(r.offset),
      length: Number(r.length),
      key: id(r.key),
    })),
    data: { mentions: annotations(data.mentions), urls: annotations(data.urls) },
  };
}

export function parseArticleResponse(input: unknown, url: ArticleUrl): Article {
  const response = record(input);
  if (response.code === 429) throw new ArticleError('rate-limit');
  if (response.code !== undefined && response.code !== 200) throw new ArticleError('extraction');
  const tweet = record(response.tweet);
  if (!tweet.article) throw new ArticleError(url.kind === 'status' ? 'not-article' : 'extraction');
  const article = record(tweet.article);
  const content = record(article.content);
  const blocks = list(content.blocks).map(normalizeBlock);
  if (!blocks.length) throw new ArticleError('extraction');

  const entities = new Map<string, Entity>();
  const entries = Array.isArray(content.entityMap)
    ? content.entityMap
    : Object.entries(record(content.entityMap)).map(([key, value]) => ({ key, value }));
  for (const entry of entries) {
    const row = record(entry);
    const value = record(row.value);
    const data = record(value.data);
    entities.set(id(row.key), {
      type: str(value.type).toUpperCase(),
      url: safeUrl(data.url) ?? '',
      caption: str(data.caption),
      markdown: str(data.markdown),
      tweetId: id(data.tweetId),
      mediaIds: list(data.mediaItems).map((item) => id(record(item).mediaId)),
    });
  }

  const media = new Map<string, Media>();
  for (const item of list(article.media_entities)) {
    const entry = record(item);
    const info = record(entry.media_info);
    const variants = list(info.variants ?? record(info.video_info).variants)
      .map(record)
      .filter((v) => v.content_type === 'video/mp4' && safeUrl(v.url))
      .sort((a, b) => integer(b.bit_rate ?? b.bitrate) - integer(a.bit_rate ?? a.bitrate));
    const mediaId = id(entry.media_id);
    media.set(mediaId, {
      id: mediaId,
      image: safeUrl(info.original_img_url ?? record(info.preview_image).original_img_url),
      video: safeUrl(variants[0]?.url),
      alt: str(entry.alt_text ?? info.alt_text),
    });
  }
  const author = str(record(tweet.author).screen_name) || url.username;
  return {
    title: str(article.title).trim() || 'Untitled article',
    author: author && /^[a-zA-Z0-9_]{1,15}$/.test(author) ? `@${author}` : undefined,
    published: date(article.created_at) ?? date(tweet.created_at),
    source: url.source,
    cover: safeUrl(record(record(article.cover_media).media_info).original_img_url),
    blocks,
    entities,
    media,
  };
}

async function requestJson(
  path: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`https://api.fxtwitter.com/${path}`, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ArticleError(signal.aborted ? 'timeout' : 'network');
  }
  if (response.status === 429) throw new ArticleError('rate-limit');
  if (response.status >= 500) throw new ArticleError('network');
  if (!response.ok) throw new ArticleError('extraction');
  try {
    return await response.json();
  } catch {
    throw new ArticleError(signal.aborted ? 'timeout' : 'extraction');
  }
}

/** Resolve genuine article IDs, which are distinct from the publishing post ID. */
async function resolveArticle(
  url: ArticleUrl,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Article> {
  if (!url.username) throw new ArticleError('article-link');
  let cursor = '';
  // Keep this bounded: never crawl a profile indefinitely from a popup.
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams({ count: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = record(
      await requestJson(`2/profile/${url.username}/articles?${query}`, fetcher, signal),
    );
    if (response.code === 429) throw new ArticleError('rate-limit');
    const match = list(response.results)
      .map(record)
      .find(
        (post) =>
          id(record(post.article).id) === url.id &&
          str(record(post.author).screen_name).toLowerCase() === url.username?.toLowerCase(),
      );
    if (match) {
      const postId = id(match.id);
      if (!/^\d{1,25}$/.test(postId)) throw new ArticleError('extraction');
      const data = await requestJson(`${url.username}/status/${postId}`, fetcher, signal);
      if (id(record(record(record(data).tweet).article).id) !== url.id)
        throw new ArticleError('extraction');
      return parseArticleResponse(data, url);
    }
    const next = str(record(response.cursor).bottom);
    if (!next || next === cursor || !list(response.results).length) break;
    cursor = next;
  }
  throw new ArticleError('article-link');
}

export async function fetchArticle(input: string, fetcher: typeof fetch = fetch): Promise<Article> {
  const url = parseArticleUrl(input);
  if (!url) throw new ArticleError('not-article');
  const path = url.username ? `${url.username}/status/${url.id}` : `status/${url.id}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    try {
      return parseArticleResponse(await requestJson(path, fetcher, controller.signal), url);
    } catch (error) {
      // Retry only unavailable article IDs, never outages or rate limits.
      if (url.kind !== 'article' || !(error instanceof ArticleError) || error.kind !== 'extraction')
        throw error;
      return await resolveArticle(url, fetcher, controller.signal);
    }
  } finally {
    clearTimeout(timeout);
  }
}
