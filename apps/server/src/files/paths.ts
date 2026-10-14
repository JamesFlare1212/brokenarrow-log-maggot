import { resolve, sep, join } from 'node:path';
import { writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { filename } from '@ba/shared';
export function childPath(root: string, name: string, extension?: string): string {
  const full = resolve(root, filename(name, extension)),
    base = resolve(root) + sep;
  if (!full.startsWith(base)) throw new Error('Path escapes its directory');
  return full;
}
export async function atomicWrite(root: string, name: string, data: Uint8Array): Promise<void> {
  await mkdir(root, { recursive: true });
  const dest = childPath(root, name),
    temporary = join(root, '.write-' + randomUUID());
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, dest);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
