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
    { themeMode: 'system' },
    { themeMode: 'light', theme: 'forest' },
    { lightTheme: 'forest', darkTheme: 'violet', sidebarCollapsed: true },
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
      { themeMode: 'forest' },
      { lightTheme: 'light' },
      { darkTheme: 'invalid' },
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
        themeMode: 'system',
        lightTheme: 'forest',
        darkTheme: 'violet',
        sidebarCollapsed: true,
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

  it('adds the radar after overview when loading a legacy navigation order and preserves other preferences', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ba-radar-config-'));
    const db = new Database(join(dir, 'assistant.sqlite'));
    try {
      const oldOrder: PublicConfig['panelOrder'] = [
        'players',
        'current',
        'apm',
        'archive',
        'replays',
        'decks',
        'bans',
        'about',
      ];
      db.sql.prepare('INSERT INTO settings VALUES(?,?)').run(
        'public',
        JSON.stringify({
          panelOrder: oldOrder,
          theme: 'forest',
          lang: 'ja',
          sidebarCollapsed: true,
        }),
      );
      const expectedOrder = ['players', 'current', 'radar', ...oldOrder.slice(2)];
      expect(db.config()).toMatchObject({
        panelOrder: expectedOrder,
        theme: 'forest',
        lang: 'ja',
        sidebarCollapsed: true,
      });
      db.updateConfig({ banPollEnabled: false });
      expect(db.config().panelOrder).toEqual(expectedOrder);
      db.updateConfig({ panelOrder: oldOrder });
      expect(db.config().panelOrder).toEqual(expectedOrder);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['light', 'light'],
    ['cyan', 'light'],
    ['orange', 'light'],
    ['dark', 'dark'],
    ['violet', 'dark'],
    ['forest', 'dark'],
    ['ocean', 'dark'],
  ])('preserves legacy %s brightness when opening an existing database', async (theme, mode) => {
    const dir = await mkdtemp(join(tmpdir(), 'ba-appearance-'));
    const db = new Database(join(dir, 'assistant.sqlite'));
    try {
      db.sql.prepare('INSERT INTO settings VALUES(?,?)').run('public', JSON.stringify({ theme }));
      expect(db.config()).toMatchObject({ theme, themeMode: mode });
      db.updateConfig({ themeMode: 'system' });
      expect(db.config()).toMatchObject({ theme, themeMode: 'system' });
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
