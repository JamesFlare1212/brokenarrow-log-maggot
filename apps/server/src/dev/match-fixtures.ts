import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { MedalHistoryFixture, TitleHistoryFixture } from '@ba/shared';
import type { Database } from '../storage/database';

/** Optional recorded match/analysis captures enrich isolated development profiles only. */
export async function seedRecordedMatchCaches(db: Database, directory: string): Promise<void> {
  let titleManifest;
  try {
    titleManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const medalManifest = JSON.parse(await readFile(join(directory, 'medal-manifest.json'), 'utf8'));
  const titleBytes = await readFile(join(directory, 'responses.json.gz'));
  const medalBytes = await readFile(join(directory, 'analyses.json.gz'));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  if (
    titleManifest.version !== 1 ||
    medalManifest.version !== 1 ||
    hash(titleBytes) !== titleManifest.sha256 ||
    hash(medalBytes) !== medalManifest.sha256 ||
    medalManifest.titleHistorySha256 !== titleManifest.sha256
  )
    throw new Error('Recorded match fixture checksum or version is invalid');
  const titles = JSON.parse(
    gunzipSync(titleBytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'),
  ) as TitleHistoryFixture;
  const medals = JSON.parse(
    gunzipSync(medalBytes, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'),
  ) as MedalHistoryFixture;
  db.transaction(() => {
    for (const [prefix, responses] of [
      ['match:', titles.responses],
      ['amatch:', medals.responses],
    ] as const)
      for (const response of responses)
        db.saveCache(prefix + response.id, response.value, 86400000, response.at);
  });
}
