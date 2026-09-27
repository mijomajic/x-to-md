export type ErrorKind =
  | 'not-article'
  | 'extraction'
  | 'network'
  | 'timeout'
  | 'rate-limit'
  | 'article-link';

export class ArticleError extends Error {
  constructor(public readonly kind: ErrorKind) {
    super(kind);
    this.name = 'ArticleError';
  }
}

export function errorMessage(error: unknown): string {
  const kind = error instanceof ArticleError ? error.kind : 'extraction';
  return {
    'not-article': 'Open an X Article to use this extension.',
    extraction: "Couldn't extract this article.",
    network: "Couldn't reach FxTwitter. Check your connection and try again.",
    timeout: 'FxTwitter took too long to respond. Try again.',
    'rate-limit': 'FxTwitter is busy. Please wait a moment and try again.',
    'article-link':
      "Couldn't resolve this article link. Open the author's post that shared it and try again.",
  }[kind];
}
