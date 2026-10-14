// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AppEvent,
  Ban,
  Bootstrap,
  Bridge,
  PlayerProfile,
  RecordingState,
  RpcInputs,
  RpcMethod,
  RpcOutputs,
} from '@ba/contracts';
import { configSchema } from '@ba/contracts';
import { summarizeMaggot } from '@ba/shared';
import { App } from '../apps/web/src/app/App';
import { AppProvider, useApp } from '../apps/web/src/app/state';
import { createDemoBridge, demoBootstrap, demoReport } from '../apps/web/src/demo/bridge';
import { useRequest } from '../apps/web/src/hooks/useRequest';
import { translate } from '../apps/web/src/hooks/useI18n';
import { SessionPanel } from '../apps/web/src/features/session/SessionPanel';
import { PlayersPanel } from '../apps/web/src/features/players/PlayersPanel';
import { ReplaysPanel } from '../apps/web/src/features/replays/ReplaysPanel';
import { Button, Dialog } from '../apps/web/src/components/ui';

type Handler<K extends RpcMethod> = (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
type Handlers = { [K in RpcMethod]: Handler<K> };
interface Call {
  method: RpcMethod;
  input: RpcInputs[RpcMethod];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Uses the production bridge contract and demo data, with controllable native event timing. */
function nativeFixture(
  initial = structuredClone(demoBootstrap),
  overrides: Partial<Handlers> = {},
) {
  const backend = structuredClone(initial);
  const fallback = createDemoBridge();
  const listeners = new Set<(event: AppEvent) => void>();
  const calls: Call[] = [];
  const timeline: string[] = [];
  let subscriptions = 0;
  let unsubscriptions = 0;

  const emit = (event: AppEvent) => {
    if (event.revision > backend.revision) {
      backend.revision = event.revision;
      switch (event.type) {
        case 'config':
          backend.config = structuredClone(event.config);
          break;
        case 'session':
          backend.session = structuredClone(event.session);
          break;
        case 'watcher':
          backend.watcher = structuredClone(event.watcher);
          break;
        case 'recording':
          backend.recording = structuredClone(event.recording);
          break;
      }
    }
    for (const callback of listeners) callback(structuredClone(event));
  };

  const api: Bridge = {
    invoke: async <K extends RpcMethod>(method: K, input: RpcInputs[K]): Promise<RpcOutputs[K]> => {
      calls.push({ method, input: structuredClone(input) });
      timeline.push(`invoke:${method}`);
      // The method-indexed handler table is checked when fixtures are declared.
      const override = overrides[method] as Handler<K> | undefined;
      if (override) return override(input);
      if (method === 'app.bootstrap') return structuredClone(backend) as RpcOutputs[K];
      if (method === 'config.update') {
        const config = configSchema.parse({
          ...backend.config,
          ...(input as RpcInputs['config.update']),
        });
        emit({ type: 'config', config, revision: backend.revision + 1 });
        return structuredClone(config) as RpcOutputs[K];
      }
      return fallback.invoke(method, input);
    },
    subscribe: (callback) => {
      subscriptions++;
      timeline.push('subscribe');
      listeners.add(callback);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        unsubscriptions++;
        listeners.delete(callback);
      };
    },
  };

  return {
    api,
    calls,
    timeline,
    emit,
    backend,
    get activeSubscriptions() {
      return listeners.size;
    },
    get subscriptions() {
      return subscriptions;
    },
    get unsubscriptions() {
      return unsubscriptions;
    },
  };
}

function wrapper(api: Bridge) {
  return function TestProvider({ children }: { children: ReactNode }) {
    return <AppProvider api={api}>{children}</AppProvider>;
  };
}

function bootstrapForApp(): Bootstrap {
  const bootstrap = structuredClone(demoBootstrap);
  bootstrap.config.panelOrder = ['current'];
  return bootstrap;
}

function bannedPlayer(): Ban {
  return {
    id: '9000',
    name: 'Banned Arrow',
    steamId: '',
    rating: 2200,
    firstSeenAt: 1000,
    lastSeenAt: 2000,
    encountered: true,
  };
}

afterEach(cleanup);

describe('request and native event ordering', () => {
  it('keeps the newest request when A finishes or fails after B', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const lateFailure = deferred<string>();
    const { result } = renderHook(() => useRequest<string>());
    let requestA!: Promise<string | null>;
    let requestB!: Promise<string | null>;
    act(() => {
      requestA = result.current.load(() => a.promise);
      requestB = result.current.load(() => b.promise);
    });
    await act(async () => {
      b.resolve('Player B');
      await requestB;
    });
    expect(result.current.data).toBe('Player B');
    expect(result.current.pending).toBe(false);
    await act(async () => {
      a.resolve('Player A');
      await requestA;
    });
    expect(result.current.data).toBe('Player B');

    let failed!: Promise<string | null>;
    let latest!: Promise<string | null>;
    act(() => {
      failed = result.current.load(() => lateFailure.promise);
      latest = result.current.load(async () => 'Player C');
    });
    await act(async () => {
      await latest;
    });
    await act(async () => {
      lateFailure.reject(new Error('Old request failed'));
      await failed;
    });
    expect(result.current.data).toBe('Player C');
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it('subscribes before bootstrap, replays newer buffered events in order and rejects late stale state', async () => {
    const bootstrap = structuredClone(demoBootstrap);
    bootstrap.revision = 4;
    bootstrap.watcher.listening = false;
    const pending = deferred<Bootstrap>();
    const native = nativeFixture(bootstrap, { 'app.bootstrap': () => pending.promise });
    const { result } = renderHook(() => useApp(), { wrapper: wrapper(native.api) });
    expect(native.timeline.slice(0, 2)).toEqual(['subscribe', 'invoke:app.bootstrap']);
    act(() => {
      native.emit({
        type: 'watcher',
        watcher: { ...bootstrap.watcher, listening: true, file: 'latest.log' },
        revision: 7,
      });
      native.emit({
        type: 'watcher',
        watcher: { ...bootstrap.watcher, file: 'older.log' },
        revision: 6,
      });
      native.emit({
        type: 'watcher',
        watcher: { ...bootstrap.watcher, file: 'already-in-snapshot.log' },
        revision: 4,
      });
    });
    await act(async () => {
      pending.resolve(bootstrap);
      await pending.promise;
    });
    expect(result.current.state.revision).toBe(7);
    expect(result.current.state.watcher.listening).toBe(true);
    expect(result.current.state.watcher.file).toBe('latest.log');
    act(() => {
      native.emit({
        type: 'watcher',
        watcher: { ...bootstrap.watcher, listening: true, file: 'live.log' },
        revision: 8,
      });
      native.emit({
        type: 'watcher',
        watcher: { ...bootstrap.watcher, file: 'late.log' },
        revision: 5,
      });
    });
    expect(result.current.state.revision).toBe(8);
    expect(result.current.state.watcher.file).toBe('live.log');
  });

  it('does not reopen a ban dialog or emit an error toast for stale revisions', async () => {
    const bootstrap = structuredClone(demoBootstrap);
    bootstrap.revision = 10;
    const native = nativeFixture(bootstrap);
    const { result } = renderHook(() => useApp(), { wrapper: wrapper(native.api) });
    await waitFor(() => expect(result.current?.state.revision).toBe(10));
    act(() => {
      native.emit({ type: 'bans', list: [bannedPlayer()], newly: [bannedPlayer()], revision: 9 });
      native.emit({ type: 'error', message: 'Stale error', revision: 8 });
    });
    expect(result.current.modal).toBeNull();
    expect(screen.queryByText('Stale error')).toBeNull();
  });

  it('shows a buffered ban alert after bootstrap', async () => {
    const bootstrap = structuredClone(demoBootstrap);
    const pending = deferred<Bootstrap>();
    const native = nativeFixture(bootstrap, { 'app.bootstrap': () => pending.promise });
    const { result } = renderHook(() => useApp(), { wrapper: wrapper(native.api) });
    act(() =>
      native.emit({ type: 'bans', list: [bannedPlayer()], newly: [bannedPlayer()], revision: 1 }),
    );
    await act(async () => {
      pending.resolve(bootstrap);
      await pending.promise;
    });
    expect(result.current.modal?.type).toBe('banAlert');
  });

  it('cleans up StrictMode subscriptions and ignores bootstrap results from the discarded mount', async () => {
    const first = deferred<Bootstrap>();
    const second = deferred<Bootstrap>();
    let bootstraps = 0;
    const native = nativeFixture(structuredClone(demoBootstrap), {
      'app.bootstrap': () => (++bootstraps === 1 ? first.promise : second.promise),
    });
    const { result, unmount } = renderHook(() => useApp(), {
      wrapper: wrapper(native.api),
      reactStrictMode: true,
    });
    expect(native.subscriptions).toBe(2);
    expect(native.unsubscriptions).toBe(1);
    expect(native.activeSubscriptions).toBe(1);
    const current = structuredClone(demoBootstrap);
    current.revision = 5;
    await act(async () => {
      second.resolve(current);
      await second.promise;
    });
    const discarded = structuredClone(demoBootstrap);
    discarded.revision = 100;
    discarded.watcher.listening = false;
    await act(async () => {
      first.resolve(discarded);
      await first.promise;
    });
    expect(result.current.state.revision).toBe(5);
    expect(result.current.state.watcher.listening).toBe(true);
    unmount();
    expect(native.activeSubscriptions).toBe(0);
    expect(native.unsubscriptions).toBe(2);
  });
});

describe('user interaction regressions', () => {
  it('replaces the ban alert with the player investigation in a single dialog', async () => {
    const ban = bannedPlayer();
    const profile: PlayerProfile = {
      id: ban.id,
      name: ban.name,
      names: [],
      firstSeen: null,
      lastSeen: null,
      encounters: [],
      banned: ban,
      recentMatches: [],
      recentError: null,
      latestElo: 2200,
      info: null,
    };
    const native = nativeFixture(bootstrapForApp(), {
      'players.profile': () => profile,
      'players.report': ({ id }) => ({ ...demoReport(id), name: ban.name }),
    });
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('监听中');
    act(() => native.emit({ type: 'bans', list: [ban], newly: [ban], revision: 1 }));
    const alert = screen.getByRole('dialog', { name: translate('zh', 'banAlert') });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(within(alert).getByRole('button', { name: '调查羁绊' }));
    await screen.findByRole('dialog', { name: 'Banned Arrow · #9000' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: translate('zh', 'banAlert') })).toBeNull();
    await waitFor(() =>
      expect(native.calls.some((call) => call.method === 'players.profile')).toBe(true),
    );
  });

  it('changes language while preserving the listening state and live status indicator', async () => {
    const native = nativeFixture(bootstrapForApp());
    const view = render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('监听中');
    fireEvent.change(screen.getByRole('combobox', { name: '语言' }), { target: { value: 'en' } });
    await screen.findByText('Listening');
    expect(screen.queryByText('Not listening')).toBeNull();
    expect(view.container.querySelector('.status-dot')?.classList.contains('status-success')).toBe(
      true,
    );
    expect(document.documentElement.lang).toBe('en');
    expect(native.backend.config.lang).toBe('en');
    expect(native.backend.watcher.listening).toBe(true);
  });

  it('applies saved panel order immediately and preserves the collapsed APM and deck panels', async () => {
    const bootstrap = bootstrapForApp();
    bootstrap.config.panelOrder = ['current', 'apm', 'decks'];
    bootstrap.config.inputHookEnabled = true;
    bootstrap.config.collapsedPanels = ['decks', 'apm'];
    const native = nativeFixture(bootstrap);
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('监听中');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = screen.getByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '上移 卡组工具' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const navigation = screen.getByRole('navigation');
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([translate('zh', 'overview'), '卡组工具', 'APM 统计']);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim()),
    ).toEqual(['当前房间 / 对局', '卡组工具', 'APM 统计']);
    expect(
      screen.getByRole('button', { name: 'APM 统计 展开' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(
      screen.getByRole('button', { name: '卡组工具 展开' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(native.backend.config.collapsedPanels).toEqual(['decks', 'apm']);
    expect(native.backend.config.panelOrder).toEqual(['current', 'decks', 'apm']);
  });

  it('safely disables an empty lobby and releases refresh after a fulfilled zero-row query', async () => {
    const bootstrap = structuredClone(demoBootstrap);
    bootstrap.session.phase = 'lobby';
    bootstrap.session.current = null;
    bootstrap.session.lobbyPlayers = [];
    let queries = 0;
    const native = nativeFixture(bootstrap, {
      'session.query': ({ requestId }) => {
        queries++;
        return { requestId, queried: 0, skipped: 0, cancelled: false };
      },
    });
    render(
      <AppProvider api={native.api}>
        <SessionPanel />
      </AppProvider>,
    );
    const refresh = await screen.findByRole('button', { name: '刷新粗查' });
    expect(refresh.hasAttribute('disabled')).toBe(true);
    expect(queries).toBe(0);
    act(() =>
      native.emit({
        type: 'session',
        revision: 1,
        session: {
          ...bootstrap.session,
          lobbyPlayers: [{ id: '8863', name: 'Zola', teamId: null }],
        },
      }),
    );
    expect(refresh.hasAttribute('disabled')).toBe(false);
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '刷新粗查' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新粗查' }));
    await waitFor(() => expect(queries).toBe(2));
    expect(screen.getByRole('button', { name: '刷新粗查' }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps a newly mounted report action disabled throughout a global maggot request', async () => {
    const pending = deferred<RpcOutputs['players.maggot']>();
    let maggotCalls = 0;
    const native = nativeFixture(structuredClone(demoBootstrap), {
      'players.search': () => ({
        source: 'network',
        players: [
          { id: '8863', name: 'First Player', level: 40, rating: 2200 },
          { id: '8864', name: 'Second Player', level: 40, rating: 2300 },
        ],
      }),
      'players.report': ({ id }) => ({
        ...demoReport(id),
        name: id === '8863' ? 'First Player' : 'Second Player',
      }),
      'players.maggot': () => {
        maggotCalls++;
        return pending.promise;
      },
    });
    render(
      <AppProvider api={native.api}>
        <PlayersPanel />
      </AppProvider>,
    );
    fireEvent.change(await screen.findByLabelText(translate('zh', 'searchLabel')), {
      target: { value: 'Player' },
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    fireEvent.click(await screen.findByRole('button', { name: /^First Player/ }));
    const firstButton = await screen.findByRole('button', { name: '查蛆指数' });
    fireEvent.click(firstButton);
    expect(firstButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Second Player/ }));
    await screen.findByRole('heading', { name: 'Second Player #8864' });
    const newButton = screen.getByRole('button', { name: '查蛆指数' });
    expect(newButton).not.toBe(firstButton);
    expect(newButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(newButton);
    expect(maggotCalls).toBe(1);
    const result = summarizeMaggot(
      '8863',
      Array.from({ length: 12 }, (_, i) => ({
        matchId: String(8049993 - i),
        won: true,
        mvpRank: 1,
        killRank: 1,
        lossRank: 1,
        kdRank: 1,
        eloDelta: 14,
      })),
      13,
    );
    await act(async () => {
      pending.resolve(result);
      await pending.promise;
    });
    expect(screen.getByRole('button', { name: '查蛆指数' }).hasAttribute('disabled')).toBe(false);
    expect(maggotCalls).toBe(1);
  });

  it('uses the same recording shape for bootstrap and events and never revives stopped or foreign previews', async () => {
    const bootstrap = structuredClone(demoBootstrap);
    bootstrap.config.replayEnabled = true;
    const active: RecordingState = {
      ...bootstrap.recording,
      phase: 'recording',
      sessionId: 'recording-1',
      fid: '8050000',
      map: 'Dam',
      sourceId: 'screen:0:0',
      seconds: 12,
      startedAt: 1000,
    };
    bootstrap.recording = active;
    const native = nativeFixture(bootstrap);
    render(
      <AppProvider api={native.api}>
        <ReplaysPanel />
      </AppProvider>,
    );
    await screen.findByText('正在录制');
    act(() =>
      native.emit({
        type: 'preview',
        sessionId: 'recording-1',
        dataUrl: 'data:image/png;base64,first',
        hasAudio: true,
        revision: 1,
      }),
    );
    expect(screen.getByAltText('录制预览').getAttribute('src')).toBe('data:image/png;base64,first');
    act(() =>
      native.emit({
        type: 'recording',
        recording: { ...active, seconds: 44, sourceId: 'screen:1:0' },
        revision: 2,
      }),
    );
    expect(screen.getByText(/screen:1:0/)).toBeTruthy();
    const idle: RecordingState = { ...demoBootstrap.recording };
    act(() => native.emit({ type: 'recording', recording: idle, revision: 3 }));
    expect(screen.queryByAltText('录制预览')).toBeNull();
    act(() =>
      native.emit({
        type: 'preview',
        sessionId: 'recording-1',
        dataUrl: 'data:image/png;base64,late',
        hasAudio: true,
        revision: 4,
      }),
    );
    expect(screen.queryByAltText('录制预览')).toBeNull();
    act(() => {
      native.emit({
        type: 'recording',
        recording: { ...active, sessionId: 'recording-2' },
        revision: 5,
      });
      native.emit({
        type: 'preview',
        sessionId: 'recording-1',
        dataUrl: 'data:image/png;base64,foreign',
        hasAudio: false,
        revision: 6,
      });
    });
    expect(screen.queryByAltText('录制预览')).toBeNull();
    act(() =>
      native.emit({
        type: 'preview',
        sessionId: 'recording-2',
        dataUrl: 'data:image/png;base64,current',
        hasAudio: false,
        revision: 7,
      }),
    );
    expect(screen.getByAltText('录制预览').getAttribute('src')).toBe(
      'data:image/png;base64,current',
    );
  });
});

describe('shared dialog focus recovery', () => {
  function FocusHarness() {
    const [route, setRoute] = useState<'first' | 'second' | null>(null);
    return (
      <>
        <Button onClick={() => setRoute('first')}>Open dialog</Button>
        {route === 'first' && (
          <Dialog open title="First dialog" onClose={() => setRoute(null)}>
            <Button onClick={() => setRoute('second')}>Open next dialog</Button>
          </Dialog>
        )}
        {route === 'second' && (
          <Dialog open title="Second dialog" onClose={() => setRoute(null)}>
            <Button>Next action</Button>
          </Dialog>
        )}
      </>
    );
  }

  it('returns focus to the connected opener after the final dialog closes', async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'First dialog' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('does not restore focus to the old opener while another dialog replaces the first', async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    const first = await screen.findByRole('dialog', { name: 'First dialog' });
    const focus = vi.spyOn(opener, 'focus');
    await user.click(within(first).getByRole('button', { name: 'Open next dialog' }));
    const second = await screen.findByRole('dialog', { name: 'Second dialog' });
    await waitFor(() => expect(second.contains(document.activeElement)).toBe(true));
    expect(screen.queryByRole('dialog', { name: 'First dialog' })).toBeNull();
    expect(focus).not.toHaveBeenCalled();
  });
});
