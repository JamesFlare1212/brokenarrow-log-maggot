import { resolve, sep, join } from 'node:path';
import { constants } from 'node:fs';
import { writeFile, rename, unlink, mkdir, link, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { filename, object } from '@ba/shared';
export function childPath(root: string, name: string, extension?: string): string {
  const full = resolve(root, filename(name, extension)),
    base = resolve(root) + sep;
  if (!full.startsWith(base)) throw new Error('Path escapes its directory');
  return full;
}
export async function atomicWrite(
  root: string,
  name: string,
  data: Uint8Array,
  replaceExisting = true,
): Promise<void> {
  await mkdir(root, { recursive: true });
  const dest = childPath(root, name),
    temporary = join(root, '.write-' + randomUUID());
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    if (replaceExisting) await rename(temporary, dest);
    else {
      try {
        await link(temporary, dest);
      } catch (error) {
        if (
          !['EXDEV', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(
            String(object(error).code),
          )
        )
          throw error;
        await copyFile(temporary, dest, constants.COPYFILE_EXCL);
      }
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
