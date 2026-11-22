import { afterEach, expect, it, vi } from 'vitest';
import { createFixtureBridge } from '../apps/web/src/dev/bridge';

afterEach(() => vi.unstubAllGlobals());

it('rejects native actions and mixed path patches before making a browser request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const bridge = createFixtureBridge();
  await expect(bridge.invoke('external.open', { url: 'https://batrace.aoe.top/' })).rejects.toThrow(
    'desktop',
  );
  await expect(
    bridge.invoke('config.update', { theme: 'dark', decksDir: 'C:/Decks' }),
  ).rejects.toThrow('desktop');
  await expect(bridge.invoke('replays.test', null)).rejects.toThrow('desktop');
  expect(fetch).not.toHaveBeenCalled();
});

it('opens project links in an isolated browser tab, never through fixture RPC', async () => {
  const open = vi.fn(),
    fetch = vi.fn();
  vi.stubGlobal('window', { open });
  vi.stubGlobal('fetch', fetch);
  const bridge = createFixtureBridge();
  const url = 'https://dash.batrace.top/player/75402';
  await expect(bridge.invoke('external.open', { url })).resolves.toBeNull();
  expect(open).toHaveBeenCalledExactlyOnceWith(url, '_blank', 'noopener,noreferrer');
  await expect(bridge.invoke('external.open', { url: 'https://example.org' })).rejects.toThrow(
    'desktop',
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('forwards supported reads and preserves errors from the fixture service', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ value: [] }))
    .mockResolvedValueOnce(Response.json({ error: 'Missing recorded response' }, { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  const bridge = createFixtureBridge();
  await expect(bridge.invoke('replays.list', null)).resolves.toEqual([]);
  await expect(bridge.invoke('players.report', { id: '1234' })).rejects.toThrow(
    'Missing recorded response',
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
