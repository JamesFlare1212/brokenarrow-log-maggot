import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configSchema, rpcSchemas, type PublicConfig } from '@ba/contracts';
import { Database } from '../apps/server/src/storage/database';

describe('configuration patches', () => {
  it.each<Partial<PublicConfig>>([
    {},
    { lang: 'en' },
    { collapsedPanels: [] },
    { inputHookEnabled: true },
    { replayEnabled: false },
    { replayQuality: 1080, replayFps: 60, replaySaveDir: 'custom-recordings' },
  ])('keeps omitted fields absent when validating %j', (patch) => {
    expect(rpcSchemas['config.update'].parse(patch)).toEqual(patch);
  });

  it('continues to reject unknown fields and invalid values', () => {
    for (const patch of [
      { unknown: true },
      { lang: 'invalid' },
      { logDir: null },
      { replayFps: 10 },
      { replayQuality: 1440 },
      { panelOrder: ['invalid'] },
    ]) {
      expect(rpcSchemas['config.update'].safeParse(patch).success).toBe(false);
    }
    expect(configSchema.parse({}).theme).toBe('dark');
  });

  it('preserves unrelated preferences on disk across patches and a database reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ba-config-'));
    const file = join(dir, 'assistant.sqlite');
    let db: Database | undefined;
    try {
      db = new Database(file);
      const initial = db.updateConfig({
        logDir: 'custom-logs',
        decksDir: 'custom-decks',
        theme: 'forest',
        lang: 'ja',
        replayEnabled: true,
        replayDisplayId: 'screen:1',
        replayQuality: 1080,
        replayFps: 60,
        replayBitrateMbps: 10,
        replaySaveDir: 'custom-recordings',
        banPollEnabled: false,
        matchSyncEnabled: false,
      });
      db.updateConfig(rpcSchemas['config.update'].parse({ lang: 'en' }));
      db.updateConfig(rpcSchemas['config.update'].parse({ collapsedPanels: [] }));
      db.close();
      db = undefined;
      db = new Database(file);
      expect(db.config()).toEqual({ ...initial, lang: 'en', collapsedPanels: [] });
    } finally {
      db?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
