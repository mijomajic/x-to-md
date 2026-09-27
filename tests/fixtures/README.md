# Fixtures

`article.json` is original, synthetic test content shaped like FxTwitter's structured article response. It is safe to modify and redistributes no author's article. It covers cover/inline images, captions, MP4 variants, headings, nested lists, quotes, code, links, styles, and emoji.

The shape and UTF-16 article range conventions were checked against Defuddle's `src/extractors/x-oembed.ts` at commit `6a0f47234fbd620f0d6e6fa11cfa3a699ddd74aa` and FxTwitter's article schemas. Tweet `raw_text.facets` use code points; article Draft.js ranges use UTF-16. Do not apply tweet-facet index conversion to articles.

Unit and browser tests must not depend on the live API. To reproduce a bug, add a minimal synthetic fixture retaining its relevant block/entity structure, with author text and identifying metadata removed.
