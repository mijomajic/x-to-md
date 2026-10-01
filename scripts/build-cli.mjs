import { chmod } from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/main.ts'],
  outfile: 'dist/cli.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
await chmod('dist/cli.mjs', 0o755);
