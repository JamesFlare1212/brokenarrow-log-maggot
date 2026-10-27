import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, CacheStats, Match, RpcOutputs } from '@ba/contracts';
import { createBrowserFixtures } from '../apps/server/src/dev/browser';
import { loadRealData } from '../apps/server/src/dev/real-data';

const source = resolve('tests/fixtures/real');
const root = resolve('.test-data/browser-tests');
const services: Awaited<ReturnType<typeof createBrowserFixtures>>[] = [];
async function create(events: AppEvent[] = [], version: string | (() => string) = '4.0.2') {
  const service = await createBrowserFixtures(source, root, version, (e) => events.push(e));
  services.push(service);
  return service;
}
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.stop();
    if (!service.directory.startsWith(root + sep)) throw new Error('Unsafe cleanup path');
    await rm(service.directory, { recursive: true, force: true });
  }
});

describe('browser development with repository fixtures', () => {
  it('uses the current project version after it changes without recreating the fixture service', async () => {
    let version = '4.0.2';
    const service = await create([], () => version);
    expect(await service.invoke('app.bootstrap', null)).toMatchObject({
      updates: { currentVersion: '4.0.2', mode: 'disabled' },
    });
    version = '4.3.0';
    expect(await service.invoke('app.bootstrap', null)).toMatchObject({
      updates: { currentVersion: '4.3.0', mode: 'disabled' },
    });
    expect(await service.invoke('updates.check', null)).toMatchObject({
      currentVersion: '4.3.0',
      mode: 'disabled',
    });
  }, 30000);

  // Importing the complete recorded corpus into two SQLite profiles can exceed ten seconds.
  it('cleans cache only in the writable browser profile and preserves match history', async () => {
    const service = await create();
    const before = (await service.invoke('cache.stats', null)) as CacheStats;
    expect(before.api.entries).toBeGreaterThan(0);
    const matches = (await service.invoke('matches.list', {})) as Match[];
    const result = (await service.invoke('cache.clear', {
      mode: 'all',
    })) as RpcOutputs['cache.clear'];
    expect(result.removed).toBe(before.api.entries + before.snapshots.entries);
    expect(result.stats.api.entries).toBe(0);
    expect(result.stats.snapshots.entries).toBe(0);
    expect(await service.invoke('matches.list', {})).toHaveLength(matches.length);
    const fresh = await create();
    const restored = (await fresh.invoke('cache.stats', null)) as CacheStats;
    expect(restored.api.entries).toBe(before.api.entries);
  }, 30000);

  it('loads real logs and cached analysis offline, broadcasts preferences, and isolates edits', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    const { data, manifest } = await loadRealData(source);
    const events: AppEvent[] = [];
    const service = await create(events);
    const matches = (await service.invoke('matches.list', {})) as Match[];
    expect(matches).toHaveLength(manifest.expected.seededMatches);
    const playerId = data.activeAccountId!;
    expect(await service.invoke('players.profile', { id: playerId })).toMatchObject({
      id: playerId,
    });
    expect(await service.invoke('players.search', { query: playerId })).toMatchObject({
      players: expect.arrayContaining([expect.objectContaining({ id: playerId })]),
    });
    await service.invoke('config.update', {
      theme: 'forest',
      themeMode: 'light',
      lightTheme: 'forest',
      darkTheme: 'violet',
      eloColorScheme: 'red-up',
      sidebarCollapsed: true,
      hiddenPanels: ['players', 'decks'],
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'config',
        config: expect.objectContaining({
          theme: 'forest',
          themeMode: 'light',
          lightTheme: 'forest',
          darkTheme: 'violet',
          eloColorScheme: 'red-up',
          sidebarCollapsed: true,
          hiddenPanels: ['players', 'decks'],
        }),
      }),
    );
    await service.invoke('matches.delete', { id: matches[0]!.id });
    expect(await service.invoke('matches.list', {})).toHaveLength(matches.length - 1);
    const fresh = await create();
    expect(fresh.directory).not.toBe(service.directory);
    expect(await fresh.invoke('matches.list', {})).toHaveLength(manifest.expected.seededMatches);
    expect((await loadRealData(source)).manifest.sha256).toBe(manifest.sha256);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it('validates requests and keeps native features and filesystem paths out of browser RPC', async () => {
    const service = await create();
    for (const [method, input] of [
      ['apm.history', null],
      ['config.update', { logDir: 'C:/real-game/GameLogs' }],
      ['replays.move', { from: 'C:/from', to: 'C:/to' }],
      ['replays.test', null],
      ['directory.select', { kind: 'logs' }],
      ['updates.install', null],
      ['__proto__', null],
    ])
      await expect(service.invoke(method, input)).rejects.toThrow('浏览器开发模式');
    await expect(service.invoke('matches.list', { accountId: 'invalid' })).rejects.toThrow();
    await expect(service.invoke('config.update', { inputHookEnabled: true })).rejects.toThrow();
    expect(await service.invoke('app.bootstrap', null)).toMatchObject({
      config: { replayEnabled: false },
      updates: { mode: 'disabled' },
    });
  }, 30000);
});
