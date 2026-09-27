import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = '.output/chrome-mv3';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.name, 'X to Markdown');
assert.equal(manifest.description, pkg.description);
assert.deepEqual(manifest.permissions, ['activeTab', 'downloads', 'clipboardWrite']);
assert.deepEqual(manifest.host_permissions, ['https://api.fxtwitter.com/*']);
for (const field of [
  'background',
  'content_scripts',
  'optional_permissions',
  'optional_host_permissions',
  'externally_connectable',
  'web_accessible_resources',
  'key',
]) {
  assert.equal(manifest[field], undefined, `Unexpected manifest field: ${field}`);
}
assert.equal(manifest.action.default_popup, 'popup.html');
for (const asset of [manifest.action.default_popup, ...Object.values(manifest.icons)]) {
  await access(join(root, asset));
}
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  assert.equal(
    await readFile(join(root, file), 'utf8'),
    await readFile(file, 'utf8'),
    `${file} is missing or out of sync`,
  );
}
const files = await readdir(root, { recursive: true });
assert.ok(
  !files.some((file) => /(^|\/)(\.env|node_modules|\.git)(\/|$)|\.map$/.test(file)),
  'Unexpected development files in extension',
);
const popup = await readFile(join(root, 'popup.html'), 'utf8');
assert.ok(
  !popup.includes('localhost') && !popup.includes('@vite'),
  'Development popup cannot be released',
);
for (const match of popup.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
  await access(join(root, match[1].replace(/^\//, '')));
}

if (process.argv.includes('--checksum')) {
  const filename = `${pkg.name}-${pkg.version}-chrome.zip`;
  const zip = await readFile(join('.output', filename));
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'Invalid ZIP header');
  const checksum = createHash('sha256').update(zip).digest('hex');
  await writeFile('.output/SHA256SUMS', `${checksum}  ${filename}\n`);
  console.log(
    `Release archive: ${filename} (${zip.length.toLocaleString()} bytes). SHA256SUMS written.`,
  );
}
console.log(`Verified v${pkg.version}: MV3 manifest, permissions, assets, and license notices.`);
