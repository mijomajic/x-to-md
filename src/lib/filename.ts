export function filenameFromTitle(title: string): string {
  let slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // Bound UTF-8 bytes, not JS code units: long CJK titles also fit on disk.
  let bounded = '';
  for (const char of slug) {
    if (new TextEncoder().encode(bounded + char).length > 120) break;
    bounded += char;
  }
  slug = bounded.replace(/-+$/, '') || 'x-article';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) slug = `article-${slug}`;
  return `${slug}.md`;
}
