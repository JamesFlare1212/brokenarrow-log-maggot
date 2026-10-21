import { mkdir, copyFile, readFile } from 'node:fs/promises';
await mkdir('build', { recursive: true });
const logoPath = 'apps/web/public/logo.png';
const source = await readFile(logoPath);
if (source.length < 24 || source.readUInt32BE(0) !== 0x89504e47)
  throw new Error(`${logoPath} must be a PNG image`);
if (source.readUInt32BE(16) < 256 || source.readUInt32BE(20) < 256)
  throw new Error('Application icon must be at least 256×256');
await copyFile(logoPath, 'build/icon.png');
