import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildMatchTimeline, object } from '@ba/shared';
import {
  loadOfflineFixtureManifest,
  readOfflineFixtureRecords,
} from '../apps/server/src/dev/offline-fixtures';

describe('timeline production recorded corpus', () => {
  it('derives bounded finite timelines for every captured match with timed unit data', async () => {
    const directory = resolve('tests/fixtures/batrace/offline');
    const manifest = await loadOfflineFixtureManifest(directory);
    const keys = new Set(manifest.matches.map((id) => `match:${id}`));
    let ready = 0;
    for await (const record of readOfflineFixtureRecords(directory, manifest, keys)) {
      const match = object(object(record.value).matchInfo);
      const hasUnits =
        typeof match.StartTime === 'number' &&
        Object.values(object(match.Data)).some((player) =>
          Object.values(object(object(player).UnitData)).some(
            (unit) => typeof object(unit).SpawnTime === 'number',
          ),
        );
      const result = buildMatchTimeline(record.value);
      if (!hasUnits) {
        expect(result.status, record.key).toBe('unavailable');
        continue;
      }
      expect(result.status, record.key).toBe('ready');
      if (result.status !== 'ready') continue;
      ready++;
      expect(result.data.frames.at(-1)?.second, record.key).toBe(result.data.duration);
      expect(result.data.points.at(-1)?.second, record.key).toBe(result.data.duration);
      expect(result.data.frames.length).toBeLessThanOrEqual(86401);
      expect(
        result.data.frames.every(
          (point, index, frames) =>
            Object.values(point).every(Number.isFinite) &&
            point.alpha >= 0 &&
            point.bravo >= 0 &&
            (!index || point.second > frames[index - 1]!.second),
        ),
        record.key,
      ).toBe(true);
      expect(
        result.data.moments.every(
          (moment) =>
            moment.start >= 0 && moment.end >= moment.start && moment.end <= result.data.duration,
        ),
        record.key,
      ).toBe(true);
    }
    expect(ready).toBeGreaterThan(100);
  });
});
