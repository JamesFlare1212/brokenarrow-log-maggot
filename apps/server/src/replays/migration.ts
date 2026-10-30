import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { object } from '@ba/shared';

export async function recordingDigest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function copyVerifiedRecording(source: string, destination: string): Promise<string> {
  const output = await open(destination, 'wx');
  const owner = await output.stat();
  try {
    for await (const chunk of createReadStream(source)) {
      const buffer = chunk as Buffer;
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await output.write(buffer, offset, buffer.length - offset);
        if (!bytesWritten) throw new Error('REPLAY_MIGRATION_COPY_MISMATCH');
        offset += bytesWritten;
      }
    }
    await output.sync();
    const digest = await recordingDigest(source);
    if (digest !== (await recordingDigest(destination)))
      throw new Error('REPLAY_MIGRATION_COPY_MISMATCH');
    return digest;
  } catch (error) {
    await output.close().catch(() => {});
    const current = await lstat(destination).catch(() => null);
    if (current?.dev === owner.dev && current.ino === owner.ino)
      await unlink(destination).catch(() => {});
    throw error;
  } finally {
    await output.close().catch(() => {});
  }
}

export async function publishRecording(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(String(object(error).code)))
      throw error;
    await copyVerifiedRecording(source, destination);
  }
}
