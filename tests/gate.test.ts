import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  class FakeBrowserWindow {
    destroyed = false;
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    on = vi.fn();
    loadURL = vi.fn(async () => {});
    constructor(_options: unknown) {
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const windows: FakeBrowserWindow[] = [];
  return {
    BrowserWindow: FakeBrowserWindow,
    windows,
    fetch: vi.fn<typeof fetch>(),
    getVersion: vi.fn<() => string>(),
  };
});
vi.mock('electron', () => ({
  BrowserWindow: electron.BrowserWindow,
  net: { fetch: electron.fetch },
  app: { getVersion: electron.getVersion },
}));
import { VerificationGate } from '../apps/desktop/src/gate';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  electron.windows.length = 0;
});

describe('BATrace verification identity', () => {
  it.each(['4.1.4', '5.0.0'])(
    'identifies version %s on the API host and its probes',
    async (version) => {
      vi.useFakeTimers();
      electron.getVersion.mockReturnValue(version);
      electron.fetch
        .mockResolvedValueOnce(new Response('<html>TencentEOCaptchaWidget</html>', { status: 403 }))
        .mockResolvedValueOnce(Response.json({ players: [] }));
      const changed = vi.fn();
      const gate = new VerificationGate(changed);
      const pending = gate.open();
      expect(gate.open()).toBe(pending);
      const window = electron.windows[0]!;
      const identity = `brokenarrow-log-maggot/${version}`;
      expect(window.loadURL).toHaveBeenCalledWith('https://bot.batrace.top/', {
        extraHeaders:
          `User-Agent: ${identity} (+https://github.com/JamesFlare1212/brokenarrow-log-maggot)\r\n` +
          'X-Client: brokenarrow-log-maggot',
      });

      const navigate = window.webContents.on.mock.calls.find(
        ([event]) => event === 'will-navigate',
      )![1];
      const preventDefault = vi.fn();
      navigate({ preventDefault }, 'https://bot.batrace.top/');
      navigate({ preventDefault }, 'https://turing.captcha.qcloud.com/');
      expect(preventDefault).not.toHaveBeenCalled();
      navigate({ preventDefault }, 'https://unrelated.example/');
      expect(preventDefault).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2000);
      expect(changed.mock.calls).toEqual([['open']]);
      await vi.advanceTimersByTimeAsync(2000);
      await pending;
      expect(electron.fetch).toHaveBeenCalledTimes(2);
      for (const [url, init] of electron.fetch.mock.calls) {
        expect(url).toBe('https://bot.batrace.top/api/players/search?q=test&limit=1');
        const headers = new Headers(init?.headers);
        expect(headers.get('X-Client')).toBe('brokenarrow-log-maggot');
        expect(headers.get('User-Agent')).toBe(
          `${identity} (+https://github.com/JamesFlare1212/brokenarrow-log-maggot)`,
        );
      }
      expect(changed.mock.calls).toEqual([['open'], ['done']]);
      expect(window.destroyed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
