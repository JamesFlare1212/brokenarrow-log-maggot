import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export function loadSource() {
  const archive = resolve(root, 'tests/fixtures/batrace/offline');
  const manifest = JSON.parse(readFileSync(resolve(archive, 'manifest.json'), 'utf8'));
  const model = JSON.parse(
    readFileSync(resolve(root, 'packages/shared/src/titles/model.json'), 'utf8'),
  );
  const catalog = {};
  let record;
  for (const file of manifest.files) {
    const bytes = readFileSync(resolve(archive, file.path));
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`Fixture checksum mismatch: ${file.path}`);
    }
    for (const row of JSON.parse(gunzipSync(bytes))) {
      if (row.key === 'match:9485138') record = row;
      for (const unit of row.value?.highlightUnits ?? []) {
        const [role, cost] = model.units[String(unit.unitId)] ?? [null, 100];
        catalog[unit.unitId] ??= { name: unit.unitName, role, cost };
      }
    }
  }
  if (!record) throw new Error('The recorded match is missing.');
  const usedIds = new Set(
    Object.values(record.value.matchInfo.Data).flatMap((p) =>
      Object.values(p.UnitData).map((u) => u.Id),
    ),
  );
  const units = Object.fromEntries(
    [...usedIds].map((id) => [
      id,
      catalog[id] ?? {
        name: `Unit #${id}`,
        role: model.units[id]?.[0] ?? null,
        cost: model.units[id]?.[1] ?? 100,
      },
    ]),
  );
  return {
    match: record.value.matchInfo,
    catalog: units,
    provenance: {
      matchId: '9485138',
      map: 'Baltiisk',
      capturedAt: record.at,
      shard: 'tests/fixtures/batrace/offline/responses-044.json.gz',
      sha256: manifest.files.find((f) => f.path === 'responses-044.json.gz').sha256,
      names: 'Recorded BATrace player analysis highlightUnits',
      prices:
        'packages/shared/src/titles/model.json; baseline prices scaled to each player’s official totals',
    },
  };
}
