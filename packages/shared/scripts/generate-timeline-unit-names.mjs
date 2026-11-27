import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { format, resolveConfig } from 'prettier';

const root = new URL('../../../', import.meta.url);
const archive = new URL('tests/fixtures/batrace/offline/', root);
const manifestBytes = readFileSync(new URL('manifest.json', archive));
const manifest = JSON.parse(manifestBytes);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const names = {};
for (const file of manifest.files) {
  const bytes = readFileSync(new URL(file.path, archive));
  if (hash(bytes) !== file.sha256) throw new Error(`Fixture checksum mismatch: ${file.path}`);
  for (const row of JSON.parse(gunzipSync(bytes))) {
    for (const unit of row.value?.highlightUnits ?? []) {
      if (
        Number.isSafeInteger(unit.unitId) &&
        unit.unitId >= 0 &&
        typeof unit.unitName === 'string' &&
        unit.unitName.trim()
      )
        names[unit.unitId] ??= unit.unitName;
    }
  }
}
const output = new URL('packages/shared/src/timeline/unit-names.ts', root);
const source = `export const TIMELINE_UNIT_NAMES: Readonly<Record<string, string>> = ${JSON.stringify(names, null, 2)};
`;
writeFileSync(
  output,
  await format(source, { ...(await resolveConfig(output)), parser: 'typescript' }),
);
console.log(`Generated ${Object.keys(names).length} timeline unit names.`);
