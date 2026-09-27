import { filenameFromTitle } from './filename';

/** Data URLs survive the popup closing; no Blob lifetime or background worker needed. */
export async function downloadMarkdown(title: string, markdown: string): Promise<number> {
  return chrome.downloads.download({
    url: `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`,
    filename: filenameFromTitle(title),
    conflictAction: 'uniquify',
    saveAs: false,
  });
}
