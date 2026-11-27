import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

export function recordedTimelineMatch() {
  const archive = resolve('tests/fixtures/batrace/offline');
  const manifest = JSON.parse(readFileSync(join(archive, 'manifest.json'), 'utf8')) as {
    files: Array<{ path: string; sha256: string }>;
  };
  const file = manifest.files.find((file) => file.path === 'responses-044.json.gz')!;
  const bytes = readFileSync(join(archive, file.path));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (
    actual !== file.sha256 ||
    actual !== 'f7baaa744d93937771e067cf3d5551da32fa9accaaf87ef51b45ea6c5fce3cd1'
  )
    throw new Error('Timeline fixture checksum mismatch');
  const records = JSON.parse(gunzipSync(bytes).toString('utf8')) as Array<{
    key: string;
    at: number;
    value: unknown;
  }>;
  return records.find((record) => record.key === 'match:9485138')!;
}
