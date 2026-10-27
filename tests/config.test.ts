import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configSchema, rpcSchemas, type PublicConfig } from '@ba/contracts';
import { Database } from '../apps/server/src/storage/database';
import { projectConfig, projectConfigSchema } from '../apps/server/src/config';
import { canvasSize, estimateRecordingBytes } from '@ba/shared';

describe('project configuration', () => {
  it('accepts zero offset and retry delay while keeping positive timeouts and intervals', () => {
    const config = structuredClone(projectConfig);
    config.network.requestOffsetMs = 0;
    config.network.retryDelayMs = 0;
    expect(projectConfigSchema.parse(config)).toEqual(config);
  });

  it.each([
    ['network', 'requestOffsetMs', -1],
    ['network', 'requestOffsetMs', 0.5],
    ['network', 'requestOffsetMs', '300'],
    ['network', 'requestOffsetMs', 2147483648],
    ['network', 'requestTimeoutMs', 0],
    ['network', 'maxAttempts', 0],
    ['network', 'retryDelayMs', -1],
    ['cache', 'maxApiEntries', 0],
    ['cache', 'maxPlayerSnapshots', 0],
    ['background', 'syncIntervalMs', 0],
    ['queries', 'maxRoomPlayers', 101],
    ['network', 'unknownSetting', 1],
  ])('rejects invalid %s.%s = %j', (section, key, value) => {
    const config = structuredClone(projectConfig) as Record<string, Record<string, unknown>>;
    config[section]![key] = value;
    expect(projectConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe('configuration patches', () => {
  it.each<Partial<PublicConfig>>([
    {},
    { lang: 'en' },
    { themeMode: 'system' },
    { themeMode: 'light', theme: 'forest' },
    { lightTheme: 'forest', darkTheme: 'violet', sidebarCollapsed: true },
    { glassOpacity: 40 },
    { glassOpacity: 50 },
    { glassOpacity: 100 },
    { eloColorScheme: 'green-up' },
    { eloColorScheme: 'red-up' },
    { collapsedPanels: [] },
    { hiddenPanels: ['players', 'decks'] },
    { hiddenPanels: [] },
    { inputHookEnabled: true },
    { inputHookEnabled: false },
    { analyticsEnabled: true },
    { analyticsEnabled: false },
    { analyticsChoiceSaved: false },
    { analyticsEnabled: true, analyticsChoiceSaved: true },
    { replayEnabled: false },
    { replayMicrophone: false },
    { replayQuality: 1080, replayFps: 60, replaySaveDir: 'custom-recordings' },
    { replayQuality: 1440, replayFps: 90, replayBitrateMbps: 15 },
    { replayQuality: 2160, replayFps: 120, replayBitrateMbps: 20 },
  ])('keeps omitted fields absent when validating %j', (patch) => {
    expect(rpcSchemas['config.update'].parse(patch)).toEqual(patch);
  });

  it('continues to reject unknown fields and invalid values', () => {
    for (const patch of [
      { unknown: true },
      { lang: 'invalid' },
      { lang: 'ja' },
      { lang: 'ru' },
      { themeMode: 'forest' },
      { lightTheme: 'light' },
      { darkTheme: 'invalid' },
      { glassOpacity: 39 },
      { glassOpacity: 101 },
      { glassOpacity: 50.5 },
      { glassOpacity: '50' },
      { eloColorScheme: 'blue-up' },
      { eloColorScheme: null },
      { logDir: null },
      { replayFps: 10 },
      { replayQuality: 480 },
      { replayQuality: 4320 },
      { replayFps: 121 },
      { replayFps: 45 },
      { replayBitrateMbps: 4 },
      { replayBitrateMbps: 21 },
      { replayMicrophone: 'false' },
      { analyticsEnabled: 'true' },
      { analyticsChoiceSaved: 'true' },
      { panelOrder: ['invalid'] },
      { hiddenPanels: ['invalid'] },
      { hiddenPanels: ['about'] },
      { hiddenPanels: null },
    ]) {
      expect(rpcSchemas['config.update'].safeParse(patch).success).toBe(false);
    }
    expect(configSchema.parse({}).theme).toBe('dark');
    expect(configSchema.parse({}).inputHookEnabled).toBe(true);
    expect(configSchema.parse({ inputHookEnabled: false }).inputHookEnabled).toBe(false);
    expect(configSchema.parse({}).analyticsEnabled).toBe(false);
    expect(configSchema.parse({}).analyticsChoiceSaved).toBe(false);
    expect(configSchema.parse({}).themeMode).toBe('system');
    expect(configSchema.parse({}).glassOpacity).toBe(50);
    expect(configSchema.parse({}).eloColorScheme).toBe('green-up');
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
      expect(db.config().inputHookEnabled).toBe(true);
      expect(db.config().themeMode).toBe('system');
      expect(db.config().glassOpacity).toBe(50);
      expect(db.config().eloColorScheme).toBe('green-up');
      expect(db.updateConfig({ lang: 'en' }).themeMode).toBe('system');
      const initial = db.updateConfig({
        inputHookEnabled: false,
        analyticsEnabled: true,
        analyticsChoiceSaved: true,
        logDir: 'custom-logs',
        decksDir: 'custom-decks',
        theme: 'forest',
        themeMode: 'system',
        lightTheme: 'forest',
        darkTheme: 'violet',
        glassOpacity: 67,
        eloColorScheme: 'red-up',
        sidebarCollapsed: true,
        hiddenPanels: ['players', 'decks'],
        lang: 'zh',
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
        lang: 'zh',
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

  it.each(['ja', 'ru'])(
    'falls back to Chinese for saved %s settings without losing preferences',
    (lang) => {
      const db = new Database(':memory:');
      try {
        db.sql
          .prepare('INSERT INTO settings VALUES(?,?)')
          .run(
            'public',
            JSON.stringify({ lang, theme: 'forest', sidebarCollapsed: true, logDir: 'saved-logs' }),
          );
        expect(db.config()).toMatchObject({
          lang: 'zh',
          theme: 'forest',
          sidebarCollapsed: true,
          logDir: 'saved-logs',
        });
        db.updateConfig({ banPollEnabled: false });
        expect(db.config()).toMatchObject({
          lang: 'zh',
          theme: 'forest',
          sidebarCollapsed: true,
          logDir: 'saved-logs',
          banPollEnabled: false,
        });
      } finally {
        db.close();
      }
    },
  );

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

describe('recording configuration ranges', () => {
  it('starts with 720p, 30fps and 5Mbps and sizes the highest recording quality correctly', () => {
    expect(configSchema.parse({})).toMatchObject({
      replayQuality: 720,
      replayFps: 30,
      replayBitrateMbps: 5,
    });
    expect(canvasSize(2160, 3840, 2160)).toEqual({ width: 3840, height: 2160 });
    expect(estimateRecordingBytes(45, 20, true)).toBe(6_793_200_000);
  });

  it.each([240, 360, 480])(
    'upgrades saved %ip and 3Mbps without losing other preferences',
    (quality) => {
      const db = new Database(':memory:');
      try {
        db.sql.prepare('INSERT INTO settings VALUES(?,?)').run(
          'public',
          JSON.stringify({
            replayQuality: quality,
            replayFps: 45,
            replayBitrateMbps: 3,
            lang: 'en',
            replaySaveDir: 'custom-recordings',
          }),
        );
        expect(db.config()).toMatchObject({
          replayQuality: 720,
          replayFps: 50,
          replayBitrateMbps: 5,
          lang: 'en',
          replaySaveDir: 'custom-recordings',
        });
        expect(db.updateConfig({ replayFps: 120 })).toMatchObject({
          replayQuality: 720,
          replayFps: 120,
          replayBitrateMbps: 5,
          lang: 'en',
        });
      } finally {
        db.close();
      }
    },
  );
});
