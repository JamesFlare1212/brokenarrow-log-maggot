import { initialApmState } from '@ba/contracts';
import { join } from 'node:path';
import type { AppEvent, RpcMethod } from '@ba/contracts';
import { rpcSchemas } from '@ba/contracts';
import { Application } from '../app';
import type { Platform } from '../ports';
import { prepareRealData } from './real-data';

const methods = new Set<RpcMethod>([
  'app.bootstrap',
  'apm.history',
  'config.update',
  'updates.check',
  'players.search',
  'players.report',
  'players.maggot',
  'players.profile',
  'session.query',
  'matches.list',
  'matches.scan',
  'matches.detail',
  'matches.add',
  'matches.delete',
  'bans.list',
  'bans.sync',
  'accounts.list',
  'accounts.delete',
  'decks.list',
  'replays.list',
  'replays.directory',
  'displays.list',
  'displays.thumbnail',
  'api.health',
]);
const preferences = new Set([
  'telemetryEnabled',
  'telemetryConsentConfirmed',
  'telemetryConsentVersion',
  'theme',
  'themeMode',
  'lightTheme',
  'darkTheme',
  'sidebarCollapsed',
  'lang',
  'panelOrder',
  'hiddenPanels',
  'collapsedPanels',
  'banCardVisible',
  'multiAccountBond',
]);
function desktopOnly(): never {
  throw new Error('浏览器开发模式仅使用测试数据，此功能请通过桌面应用使用。');
}

/** Offline fixture service for the browser dev server, with no native integrations. */
export async function createBrowserFixtures(
  fixtureDirectory: string,
  developmentRoot: string,
  version: string | (() => string),
  broadcast: (event: AppEvent) => void,
) {
  const directory = await prepareRealData(fixtureDirectory, developmentRoot);
  const platform: Platform = {
    get version() {
      return typeof version === 'function' ? version() : version;
    },
    http: {
      offline: true,
      fetch: async () => {
        throw new Error('Network disabled in browser fixture mode');
      },
    },
    selectDirectory: async () => desktopOnly(),
    detectLogDirectory: async () => join(directory, 'GameLogs'),
    openPath: async () => desktopOnly(),
    openExternal: async () => desktopOnly(),
    notify: () => {},
    recordings: {
      status: () => ({
        phase: 'idle',
        sessionId: null,
        fid: null,
        map: '',
        sourceId: '',
        startedAt: null,
        seconds: 0,
        hasAudio: false,
        error: null,
      }),
      start: async () => desktopOnly(),
      stop: async () => {},
      abort: async () => {},
      displays: async () => [],
      thumbnail: async () => null,
      playback: async () => desktopOnly(),
    },
    apm: {
      status: () => initialApmState('unavailable'),
      updateMatch: () => {},
      start: () => desktopOnly(),
      stop: () => {},
      disable: () => {},
    },
  };
  const app = new Application(directory, platform, broadcast, false);
  try {
    await app.start();
    await app.invoke('matches.scan', null);
  } catch (error) {
    await app.stop();
    throw error;
  }
  return {
    directory,
    async invoke(method: unknown, input: unknown) {
      if (typeof method !== 'string' || !methods.has(method as RpcMethod)) desktopOnly();
      if (method === 'config.update') {
        const patch = rpcSchemas['config.update'].parse(input);
        if (Object.keys(patch).some((key) => !preferences.has(key))) desktopOnly();
      }
      return app.invoke(method as RpcMethod, input);
    },
    stop: () => app.stop(),
  };
}
