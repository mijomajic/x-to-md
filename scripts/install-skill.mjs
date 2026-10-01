import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(
  process.env.CODEX_HOME || join(homedir(), '.codex'),
  'skills',
  'read-x-articles',
);
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--force'))
  throw new Error('Usage: npm run install:skill -- [--force]');
await mkdir(dirname(destination), { recursive: true });
// Refuse to overwrite an existing skill unless explicitly requested.
if (args.includes('--force')) await rm(destination, { recursive: true, force: true });
await mkdir(destination);
await cp(join(root, 'skills', 'read-x-articles'), destination, { recursive: true });
const skill = join(destination, 'SKILL.md');
await writeFile(
  skill,
  `${await readFile(skill, 'utf8')}\n## Local executable\n\nRun \`node ${JSON.stringify(join(root, 'dist', 'cli.mjs'))} --json "URL"\` if the\ncommand is unavailable on PATH.\n`,
);
console.log(`Installed ${destination}`);
