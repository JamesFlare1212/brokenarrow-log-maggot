// @vitest-environment jsdom
// Regression scenarios from docs/state-machine-risk-audit.md.
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSchema, type Bridge, type PublicConfig } from '@ba/contracts';
import { AppProvider } from '../apps/web/src/app/state';
import { RecordingSettings } from '../apps/web/src/features/replays/RecordingSettings';
import { useSettingsAutosave } from '../apps/web/src/hooks/useSettingsAutosave';
import { fixtureBootstrap } from './fixtures/ui';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('settings state-machine regressions', () => {
  it('SM-08: an older save acknowledgement cannot roll back a newer config event', async () => {
    const saved = deferred<PublicConfig>();
    const api = { invoke: vi.fn(() => saved.promise), subscribe: () => () => {} } as Bridge;
    const initial = configSchema.parse({ lang: 'zh', glassOpacity: 80 });
    const { result, rerender } = renderHook(({ config }) => useSettingsAutosave(api, config), {
      initialProps: { config: initial },
    });
    act(() => result.current.change({ lang: 'en' }));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledTimes(1));
    rerender({ config: { ...initial, lang: 'en', glassOpacity: 90 } });
    expect(result.current.draft?.glassOpacity).toBe(90);
    await act(async () => {
      saved.resolve({ ...initial, lang: 'en' });
      await result.current.flush();
    });
    expect(result.current.draft?.glassOpacity).toBe(90);
  });

  it('preserves a newer same-field event even when it returns to the original value', async () => {
    const saved = deferred<PublicConfig>();
    const api = { invoke: vi.fn(() => saved.promise), subscribe: () => () => {} } as Bridge;
    const initial = configSchema.parse({ lang: 'zh' });
    const { result, rerender } = renderHook(({ config }) => useSettingsAutosave(api, config), {
      initialProps: { config: initial },
    });
    act(() => result.current.change({ lang: 'en' }));
    rerender({ config: { ...initial, lang: 'en' } });
    rerender({ config: { ...initial, lang: 'zh' } });
    await act(async () => {
      saved.resolve({ ...initial, lang: 'en' });
      await result.current.flush();
    });
    expect(result.current.draft?.lang).toBe('zh');
    await act(async () => {
      await result.current.discard();
    });
    expect(result.current.draft?.lang).toBe('zh');
  });

  it('stages directory work without saving and retains its preparation after a failure', async () => {
    let available = false;
    const initial = configSchema.parse({});
    const invoke = vi.fn(async (_method, patch) => {
      if (!available) throw new Error('Write unavailable');
      return { ...initial, ...patch };
    });
    const api = { invoke, subscribe: () => () => {} } as Bridge;
    const prepare = vi.fn(async () => {});
    const { result } = renderHook(() => useSettingsAutosave(api, initial));
    act(() => result.current.stage({ replaySaveDir: 'F:/Recordings' }, prepare));
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.flush()).toBe(false);
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    available = true;
    await act(async () => {
      expect(await result.current.flush()).toBe(true);
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(result.current.draft?.replaySaveDir).toBe('F:/Recordings');
  });

  it('discards staged directory work without executing migration', async () => {
    const api = { invoke: vi.fn(), subscribe: () => () => {} } as Bridge;
    const initial = configSchema.parse({});
    const prepare = vi.fn(async () => {});
    const { result } = renderHook(() => useSettingsAutosave(api, initial));
    act(() => result.current.stage({ replaySaveDir: 'F:/Recordings' }, prepare));
    await act(async () => {
      await result.current.discard();
      await result.current.flush();
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(api.invoke).not.toHaveBeenCalled();
    expect(result.current.draft?.replaySaveDir).toBe(initial.replaySaveDir);
  });

  it('SM-09: failed recording-setting edits survive leaving and returning to the tab', async () => {
    const initial = structuredClone(fixtureBootstrap);
    initial.config.replayEnabled = false;
    initial.config.analyticsChoiceSaved = true;
    const invoke = vi.fn(async (method: string) => {
      if (method === 'app.bootstrap') return initial;
      if (method === 'config.update') throw new Error('Recording write unavailable');
      if (method === 'displays.list') return [];
      if (method === 'displays.thumbnail') return null;
      throw new Error('Unexpected audit RPC: ' + method);
    });
    const api = { invoke, subscribe: () => () => {} } as Bridge;
    function Harness({ visible }: { visible: boolean }) {
      return <AppProvider api={api}>{visible && <RecordingSettings inline />}</AppProvider>;
    }
    const view = render(<Harness visible />);
    fireEvent.click(await screen.findByRole('switch', { name: '自动录制' }));
    await screen.findByText('Recording write unavailable');
    expect(screen.getByRole('switch', { name: '自动录制' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    view.rerender(<Harness visible={false} />);
    await waitFor(() =>
      expect(invoke.mock.calls.filter(([method]) => method === 'config.update')).toHaveLength(2),
    );
    view.rerender(<Harness visible />);
    const toggle = await screen.findByRole('switch', { name: '自动录制' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});
