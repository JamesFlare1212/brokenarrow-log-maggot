import { readFile, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';

// Use the exact YAML parser used by the installed updater.
const require = createRequire(import.meta.url);
const updaterRequire = createRequire(require.resolve('electron-updater'));
const { load } = updaterRequire('js-yaml');
const root = resolve(process.argv[2] || 'dist');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = load(await readFile(resolve(root, 'latest.yml'), 'utf8'));
if (
  manifest.version !== pkg.version ||
  !Array.isArray(manifest.files) ||
  manifest.files.length !== 1
)
  throw new Error('Update manifest must describe exactly one installer for the current version');
const file = manifest.files[0];
const name = decodeURIComponent(file.url);
const expected = `BrokenArrow-Setup-${pkg.version}-x64.exe`;
if (basename(name) !== name || name !== expected || typeof file.sha512 !== 'string')
  throw new Error('Update manifest must point to the NSIS installer, never the portable EXE');
const hash = createHash('sha512');
for await (const chunk of createReadStream(resolve(root, name))) hash.update(chunk);
if (hash.digest('base64') !== file.sha512)
  throw new Error('Installer SHA-512 does not match latest.yml');
await access(resolve(root, name + '.blockmap'));
await access(resolve(root, `BrokenArrow-Portable-${pkg.version}-x64.exe`));
console.log(
  `Update artifacts verified: v${pkg.version}, NSIS installer, SHA-512, blockmap and portable EXE.`,
);
