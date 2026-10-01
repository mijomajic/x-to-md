import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli/run';
import fixture from './fixtures/article.json';

const url = 'https://x.com/fieldnotes/status/123456789';
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'x-to-md-cli-'));
  dirs.push(dir);
  return dir;
}
function io(
  fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(fixture)),
) {
  return {
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
    fetcher,
  };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('agent CLI', () => {
  it('prints complete Markdown to stdout and content notices to stderr', async () => {
    const output = io();
    expect(await runCli([url], output)).toBe(0);
    expect(output.stdout.mock.calls[0]?.[0]).toContain('## A smaller loop');
    expect(output.stdout.mock.calls[0]?.[0]).toContain(`source: ${url}`);
    expect(output.stderr.mock.calls.flat().join('')).toContain('preserved as a link');
  });

  it.each([
    [],
    ['--unknown'],
    ['--output'],
    [url, '--output', 'a', '--out-dir', 'b'],
    [url, `${url}0`],
    [url, '--force'],
    [url, '-o', 'a', '-o', 'b'],
  ])('rejects invalid arguments without network access: %j', async (...args) => {
    const output = io();
    expect(await runCli(args as string[], output)).toBe(2);
    expect(output.fetcher).not.toHaveBeenCalled();
    expect(output.stdout).not.toHaveBeenCalled();
  });

  it('saves to paths with spaces and protects existing files unless forced', async () => {
    const file = join(await temp(), 'my article.md');
    await writeFile(file, 'keep');
    expect(await runCli([url, '-o', file], io())).toBe(1);
    expect(await readFile(file, 'utf8')).toBe('keep');
    const output = io();
    expect(await runCli([url, '-o', file, '--force'], output)).toBe(0);
    expect(await readFile(file, 'utf8')).toContain('## A smaller loop');
    expect(output.stdout).not.toHaveBeenCalled();
    expect(output.stderr).toHaveBeenCalledWith(`Saved ${file}\n`);
  });

  it('reads CRLF batches, deduplicates tracking URLs, and continues after failure', async () => {
    const dir = await temp();
    const input = join(dir, 'links.txt');
    const out = join(dir, 'nested', 'articles');
    await writeFile(
      input,
      `# links\r\n\r\n${url}\r\n${url}?tracking=1\r\nhttps://example.com\r\n${url}0\r\n`,
    );
    const output = io();
    expect(await runCli(['--input', input, '--out-dir', out], output)).toBe(1);
    expect(output.fetcher).toHaveBeenCalledTimes(2);
    const files = await readdir(out);
    expect(files).toHaveLength(2);
    expect(files.some((file) => file.endsWith('-status-123456789.md'))).toBe(true);
    expect(files.some((file) => file.endsWith('-status-1234567890.md'))).toBe(true);
    expect(output.stdout).not.toHaveBeenCalled();
    expect(output.stderr.mock.calls.flat().join('')).toContain('Expected an X Article');
  });

  it('reports upstream rate limits without emitting article text', async () => {
    const output = io(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 })));
    expect(await runCli([url], output)).toBe(1);
    expect(output.stderr.mock.calls.flat().join('')).toContain('Please wait');
    expect(output.stdout).not.toHaveBeenCalled();
  });

  it('reports missing input files', async () => {
    const output = io();
    expect(
      await runCli(['--input', join(await temp(), 'missing'), '--out-dir', 'unused'], output),
    ).toBe(1);
    expect(output.fetcher).not.toHaveBeenCalled();
  });

  it('returns structured article fields and content notices as valid JSON', async () => {
    const output = io();
    expect(await runCli([url, '--json'], output)).toBe(0);
    const result = JSON.parse(output.stdout.mock.calls.flat().join(''));
    expect(result).toMatchObject({
      schemaVersion: 1,
      ok: true,
      title: fixture.tweet.article.title,
      author: '@fieldnotes',
      source: url,
    });
    expect(result.markdown).toContain('## A smaller loop');
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'link-only', url: 'https://x.com/i/status/123456789' }),
      ]),
    );
  });

  it('streams mixed JSON batch results without requiring an output directory', async () => {
    const output = io();
    expect(await runCli(['https://example.com', url, '--json'], output)).toBe(1);
    const results = output.stdout.mock.calls
      .flat()
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      ok: false,
      source: 'https://example.com',
      error: { code: 'not-article', retryable: false },
    });
    expect(results[1]).toMatchObject({ ok: true, source: url });
  });

  it('emits machine-readable retryable errors and argument errors', async () => {
    const output = io(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 })));
    expect(await runCli([url, '--json'], output)).toBe(1);
    expect(JSON.parse(output.stdout.mock.calls.flat().join(''))).toMatchObject({
      ok: false,
      error: { code: 'rate-limit', retryable: true },
    });
    const invalid = io();
    expect(await runCli(['--json', '--unknown'], invalid)).toBe(2);
    expect(JSON.parse(invalid.stdout.mock.calls.flat().join(''))).toMatchObject({
      ok: false,
      error: { code: 'usage', retryable: false },
    });
  });

  it('saves JSON output and protects it from replacement', async () => {
    const file = join(await temp(), 'article.json');
    const output = io();
    expect(await runCli([url, '--json', '-o', file], output)).toBe(0);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ ok: true, savedPath: file });
    expect(output.stdout).not.toHaveBeenCalled();
    const blocked = io();
    expect(await runCli([url, '--json', '-o', file], blocked)).toBe(1);
    expect(JSON.parse(blocked.stdout.mock.calls.flat().join(''))).toMatchObject({
      ok: false,
      error: { code: 'filesystem', retryable: false },
    });
  });

  it('saves directory JSON files and emits their structured results', async () => {
    const directory = await temp();
    const output = io();
    expect(await runCli([url, '--json', '--out-dir', directory], output)).toBe(0);
    const result = JSON.parse(output.stdout.mock.calls.flat().join(''));
    expect(result.savedPath).toMatch(/-status-123456789\.json$/);
    expect(JSON.parse(await readFile(result.savedPath, 'utf8'))).toEqual(result);
  });

  it('runs the bundled executable from another directory with real Node Markdown conversion', async () => {
    execFileSync(process.execPath, ['scripts/build-cli.mjs']);
    const dir = await temp();
    const preload = join(dir, 'fixture.mjs');
    await writeFile(
      preload,
      `globalThis.fetch = async () => Response.json(${JSON.stringify(fixture)});`,
    );
    const result = spawnSync(
      process.execPath,
      ['--import', preload, resolve('dist/cli.mjs'), url],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('🚀 Build **bold** and *italic* tools.');
    expect(result.stderr).toContain('preserved as a link');
    const help = spawnSync(resolve('dist/cli.mjs'), ['--help'], { cwd: dir, encoding: 'utf8' });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain('Usage: x-to-md');
  });
});
