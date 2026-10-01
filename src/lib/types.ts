/** The small subset of FxTwitter's article response that we consume. */
export interface TextRange {
  offset: number;
  length: number;
}

export interface Block {
  text: string;
  type: string;
  depth: number;
  inlineStyleRanges: (TextRange & { style: string })[];
  entityRanges: (TextRange & { key: string })[];
  data: {
    mentions: { fromIndex: number; toIndex: number; text: string }[];
    urls: { fromIndex: number; toIndex: number; text: string }[];
  };
}

export interface Entity {
  type: string;
  url: string;
  caption: string;
  markdown: string;
  tweetId: string;
  mediaIds: string[];
}

export interface Media {
  id: string;
  image?: string;
  video?: string;
  alt: string;
}

export interface Article {
  title: string;
  author?: string;
  published?: string;
  source: string;
  cover?: string;
  blocks: Block[];
  entities: Map<string, Entity>;
  media: Map<string, Media>;
}

export interface ExtractionWarning {
  code: 'unsupported-embed' | 'missing-entity' | 'media-unavailable' | 'link-only';
  message: string;
  block: number;
  entity?: string;
  url?: string;
}
