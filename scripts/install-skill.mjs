import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = {
  codex: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'),
  claude: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills'),
};
const args = process.argv.slice(2);
const force = args.includes('--force');
const chosen = args.filter((arg) => arg !== '--force');
if (chosen.some((arg) => !['--codex', '--claude'].includes(arg)))
  throw new Error('Usage: npm run install:skill -- [--codex] [--claude] [--force]');
// Default: every agent home that exists, falling back to Codex as before.
let names = chosen.length ? chosen.map((arg) => arg.slice(2)) : [];
if (!names.length) {
  for (const [name, dir] of Object.entries(targets))
    if (await stat(dirname(dir)).catch(() => undefined)) names.push(name);
  if (!names.length) names = ['codex'];
}
for (const name of names) {
  const destination = join(targets[name], 'read-x-articles');
  await mkdir(dirname(destination), { recursive: true });
  // Refuse to overwrite an existing skill unless explicitly requested.
  if (force) await rm(destination, { recursive: true, force: true });
  await mkdir(destination);
  await cp(join(root, 'skills', 'read-x-articles'), destination, { recursive: true });
  if (name === 'claude') await rm(join(destination, 'agents'), { recursive: true, force: true });
  const skill = join(destination, 'SKILL.md');
  await writeFile(
    skill,
    `${await readFile(skill, 'utf8')}\n## Local executable\n\nRun \`node ${JSON.stringify(join(root, 'dist', 'cli.mjs'))} --json "URL"\` if the\ncommand is unavailable on PATH.\n`,
  );
  console.log(`Installed ${destination}`);
}
