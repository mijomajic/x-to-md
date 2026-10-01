import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ArticleError, errorMessage } from '../lib/errors';
import { filenameFromTitle } from '../lib/filename';
import { articleToMarkdownWithWarnings, wordCount } from '../lib/markdown';
import { fetchArticle, parseArticleUrl } from '../lib/x';

const HELP = `Usage: x-to-md <url> [--output article.md]
       x-to-md <url> [<url> ...] --out-dir articles/
       x-to-md --input links.txt --out-dir articles/

Read X Articles as Markdown. A single URL prints Markdown to stdout by default.

  --output, -o <file>  Save one article to a file
  --out-dir <dir>     Save articles using title and source ID filenames
  --input <file>      Read URLs, one per line (blank lines and # comments ignored)
  --force            Replace existing files
  --json             Emit a JSON result (one per line for batches)
  --help, -h         Show this help

Diagnostics and saved paths go to stderr. Exit codes: 0 success, 1 article/file
failure (batch continues), 2 invalid arguments. Extraction uses FxTwitter.
`;

interface Options {
  urls: string[];
  output?: string;
  directory?: string;
  input?: string;
  force: boolean;
  json: boolean;
}

function parseArgs(args: string[]): Options {
  const options: Options = { urls: [], force: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else if (['--output', '-o', '--out-dir', '--input'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value.`);
      const key = arg === '--input' ? 'input' : arg === '--out-dir' ? 'directory' : 'output';
      if (options[key]) throw new Error(`${arg} was specified more than once.`);
      options[key] = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.urls.push(arg);
  }
  if (options.output && options.directory) throw new Error('Use either --output or --out-dir.');
  return options;
}

interface IO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetcher?: typeof fetch;
}

function diagnostic(error: unknown): string {
  if (error instanceof ArticleError) {
    if (error.kind === 'not-article')
      return 'Expected an X Article or a post containing an Article.';
    return errorMessage(error);
  }
  if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
    return 'File already exists; use --force to replace it.';
  return error instanceof Error ? error.message : 'Unexpected error.';
}

export async function runCli(args: string[], io: IO): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout(HELP);
    return 0;
  }
  let options: Options;
  const fail = (error: unknown, code: number, url?: string) => {
    const message = diagnostic(error);
    if (args.includes('--json')) {
      io.stdout(
        `${JSON.stringify({
          schemaVersion: 1,
          ok: false,
          source: url ?? null,
          error: {
            code: code === 2 ? 'usage' : error instanceof ArticleError ? error.kind : 'filesystem',
            message,
            retryable:
              error instanceof ArticleError &&
              ['network', 'timeout', 'rate-limit'].includes(error.kind),
          },
        })}\n`,
      );
    }
    io.stderr(`x-to-md: ${url ? `${url}: ` : ''}${message}\n`);
    return code;
  };
  try {
    options = parseArgs(args);
  } catch (error) {
    fail(error, 2);
    io.stderr(HELP);
    return 2;
  }
  if (options.input) {
    try {
      options.urls.push(
        ...(await readFile(options.input, 'utf8'))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#')),
      );
    } catch (error) {
      return fail(error, 1);
    }
  }
  // Canonicalize valid URLs so tracking parameters do not cause duplicate exports.
  options.urls = [...new Set(options.urls.map((url) => parseArticleUrl(url)?.source ?? url))];
  if (!options.urls.length || (options.urls.length > 1 && !options.directory && !options.json)) {
    return fail(new Error('Supply a URL; multiple URLs require --out-dir or --json.'), 2);
  }
  if (options.output && options.urls.length > 1) {
    return fail(new Error('--output supports a single article; use --out-dir for batches.'), 2);
  }
  if (options.force && !options.output && !options.directory) {
    return fail(new Error('--force requires --output or --out-dir.'), 2);
  }
  if (options.directory) {
    try {
      await mkdir(options.directory, { recursive: true });
    } catch (error) {
      return fail(error, 1);
    }
  }
  let exitCode = 0;
  // Sequential requests avoid flooding the shared upstream API.
  for (const url of options.urls) {
    try {
      const article = await fetchArticle(url, io.fetcher);
      const { markdown, warnings } = articleToMarkdownWithWarnings(article);
      const result = {
        schemaVersion: 1,
        ok: true,
        title: article.title,
        author: article.author ?? null,
        published: article.published ?? null,
        source: article.source,
        markdown,
        wordCount: wordCount(article),
        warnings,
      };
      const parsed = parseArticleUrl(url);
      const filename = filenameFromTitle(article.title).replace(
        /\.md$/,
        `-${parsed?.kind}-${parsed?.id}.${options.json ? 'json' : 'md'}`,
      );
      const target = options.output ?? (options.directory && join(options.directory, filename));
      const json = JSON.stringify({ ...result, ...(target && { savedPath: resolve(target) }) });
      if (target) {
        await writeFile(target, options.json ? `${json}\n` : markdown, {
          encoding: 'utf8',
          flag: options.force ? 'w' : 'wx',
        });
        io.stderr(`Saved ${resolve(target)}\n`);
        if (options.json && options.directory) io.stdout(`${json}\n`);
      } else io.stdout(options.json ? `${json}\n` : markdown);
      for (const warning of warnings) io.stderr(`Warning (${url}): ${warning.message}\n`);
    } catch (error) {
      exitCode = fail(error, 1, url);
    }
  }
  return exitCode;
}
