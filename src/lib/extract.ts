import { ArticleError } from './errors';
import { articleToMarkdownWithWarnings, wordCount } from './markdown';
import { fetchPost, postsToMarkdownWithWarnings, postsWordCount } from './post';
import type { ExtractionWarning } from './types';
import { fetchArticle, parseArticleUrl } from './x';

/** One exported X Article, post, or author thread, ready to save or read. */
export interface XDocument {
  kind: 'article' | 'post' | 'thread';
  title: string;
  author?: string;
  published?: string;
  source: string;
  markdown: string;
  wordCount: number;
  warnings: ExtractionWarning[];
  /** Number of posts for posts and threads; absent for articles. */
  posts?: number;
}

export interface FetchOptions {
  fetcher?: typeof fetch;
  /** Include the author's self-thread around a post (default true). */
  thread?: boolean;
}

export async function fetchDocument(input: string, options: FetchOptions = {}): Promise<XDocument> {
  const fetcher = options.fetcher ?? fetch;
  const url = parseArticleUrl(input);
  if (!url) throw new ArticleError('not-article');
  try {
    const article = await fetchArticle(input, fetcher);
    const { markdown, warnings } = articleToMarkdownWithWarnings(article);
    return {
      kind: 'article',
      title: article.title,
      author: article.author,
      published: article.published,
      source: article.source,
      markdown,
      wordCount: wordCount(article),
      warnings,
    };
  } catch (error) {
    // Statuses without an Article are ordinary posts; every other failure stands.
    if (url.kind !== 'status' || !(error instanceof ArticleError) || error.kind !== 'not-article')
      throw error;
  }
  const doc = await fetchPost(url, fetcher, options.thread ?? true);
  const { markdown, warnings } = postsToMarkdownWithWarnings(doc);
  return {
    kind: doc.kind,
    title: doc.title,
    author: doc.author,
    published: doc.published,
    source: doc.source,
    markdown,
    wordCount: postsWordCount(doc),
    warnings,
    posts: doc.posts.length,
  };
}
