import { join } from 'node:path';
import { assertBrowserFixtureRequest, type AppEvent } from '@ba/contracts';
import { Application } from '../app';
import type { Platform } from '../ports';
import { prepareRealData } from './real-data';

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
      offline: 'fixture-cache',
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
      assertBrowserFixtureRequest(method, input);
      return app.invoke(method, input);
    },
    stop: () => app.stop(),
  };
}
