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
    { hiddenPanels: ['players', 'decks'] },
    { hiddenPanels: [] },
    { inputHookEnabled: true },
    { replayEnabled: false },
    { replayMicrophone: false },
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
      { replayMicrophone: 'false' },
      { panelOrder: ['invalid'] },
      { hiddenPanels: ['invalid'] },
      { hiddenPanels: ['about'] },
      { hiddenPanels: null },
    ]) {
      expect(rpcSchemas['config.update'].safeParse(patch).success).toBe(false);
    }
    expect(configSchema.parse({}).theme).toBe('dark');
    expect(configSchema.parse({}).themeMode).toBe('system');
    expect(configSchema.parse({}).hiddenPanels).toEqual([]);
    expect(configSchema.parse({ replayAudio: 'default' }).replayMicrophone).toBe(true);
    expect(configSchema.parse({ replayMicrophone: false }).replayMicrophone).toBe(false);
  });

  it('preserves unrelated preferences on disk across patches and a database reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ba-config-'));
    const file = join(dir, 'assistant.sqlite');
    let db: Database | undefined;
    try {
      db = new Database(file);
      expect(db.config().themeMode).toBe('system');
      expect(db.updateConfig({ lang: 'en' }).themeMode).toBe('system');
      const initial = db.updateConfig({
        logDir: 'custom-logs',
        decksDir: 'custom-decks',
        theme: 'forest',
        themeMode: 'system',
        lightTheme: 'forest',
        darkTheme: 'violet',
        sidebarCollapsed: true,
        hiddenPanels: ['players', 'decks'],
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

  it('migrates legacy navigation by adding radar and removing About while preserving preferences', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ba-radar-config-'));
    const db = new Database(join(dir, 'assistant.sqlite'));
    try {
      const oldOrder = [
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
          collapsedPanels: ['about', 'decks'],
          theme: 'forest',
          lang: 'ja',
          sidebarCollapsed: true,
        }),
      );
      const expectedOrder = [
        'players',
        'current',
        'radar',
        ...oldOrder.slice(2).filter((panel) => panel !== 'about'),
      ];
      expect(db.config()).toMatchObject({
        panelOrder: expectedOrder,
        hiddenPanels: [],
        collapsedPanels: ['decks'],
        theme: 'forest',
        lang: 'ja',
        sidebarCollapsed: true,
      });
      db.updateConfig({ banPollEnabled: false });
      expect(db.config().panelOrder).toEqual(expectedOrder);
      db.updateConfig(rpcSchemas['config.update'].parse({ panelOrder: oldOrder }));
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
