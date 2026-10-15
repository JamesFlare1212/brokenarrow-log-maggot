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
import {
  createDemoBridge,
  demoBootstrap,
  demoMatch,
  demoReport,
} from '../apps/web/src/demo/bridge';
import { useRequest } from '../apps/web/src/hooks/useRequest';
import { translate } from '../apps/web/src/hooks/useI18n';
import { SessionPanel } from '../apps/web/src/features/session/SessionPanel';
import { PlayersPanel } from '../apps/web/src/features/players/PlayersPanel';
import { ProfileDialog } from '../apps/web/src/features/players/ProfileDialog';
import { ReplaysPanel } from '../apps/web/src/features/replays/ReplaysPanel';
import { Button, Dialog } from '../apps/web/src/components/ui';
import { UpdatePanel } from '../apps/web/src/features/settings/UpdatePanel';
import { MatchArchive } from '../apps/web/src/features/matches/MatchArchive';

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

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
});

describe('application updates', () => {
  it('downloads only on click, shows native progress, and blocks restart until the match ends', async () => {
    const initial = structuredClone(demoBootstrap);
    initial.updates = {
      ...initial.updates,
      mode: 'installed',
      status: 'available',
      availableVersion: '4.0.1',
    };
    const f = nativeFixture(initial);
    render(<UpdatePanel />, { wrapper: wrapper(f.api) });
    const download = await screen.findByRole('button', { name: '下载更新' });
    expect(f.calls.some((call) => call.method === 'updates.download')).toBe(false);
    fireEvent.click(download);
    await waitFor(() =>
      expect(f.calls.some((call) => call.method === 'updates.download')).toBe(true),
    );
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, status: 'downloading', downloadPercent: 37 },
        revision: 1,
      }),
    );
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('37');
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, status: 'downloaded', downloadPercent: 100 },
        revision: 2,
      }),
    );
    const install = screen.getByRole('button', { name: '重启并安装' }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(screen.getByText('请在对局和录制结束后重启安装。')).toBeTruthy();
    act(() =>
      f.emit({ type: 'session', session: { ...initial.session, current: null }, revision: 3 }),
    );
    expect(install.disabled).toBe(false);
    fireEvent.click(install);
    await waitFor(() =>
      expect(f.calls.some((call) => call.method === 'updates.install')).toBe(true),
    );
  });

  it('offers portable downloads without exposing an installer or accepting stale update events', async () => {
    const initial = structuredClone(demoBootstrap);
    initial.updates = {
      ...initial.updates,
      mode: 'portable',
      status: 'available',
      availableVersion: '4.0.1',
    };
    const f = nativeFixture(initial);
    render(<UpdatePanel />, { wrapper: wrapper(f.api) });
    const page = await screen.findByRole('button', { name: '打开下载页面' });
    expect(screen.queryByRole('button', { name: '下载更新' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重启并安装' })).toBeNull();
    fireEvent.click(page);
    await waitFor(() =>
      expect(f.calls.some((call) => call.method === 'updates.openDownload')).toBe(true),
    );
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, availableVersion: '4.0.2' },
        revision: 2,
      }),
    );
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, availableVersion: '4.0.0' },
        revision: 1,
      }),
    );
    expect(screen.getByText('发现新版本 v4.0.2')).toBeTruthy();
  });

  it('shows retry controls after a failed download', async () => {
    const initial = structuredClone(demoBootstrap);
    initial.updates = {
      ...initial.updates,
      mode: 'installed',
      status: 'error',
      availableVersion: '4.0.1',
      errorContext: 'download',
      error: 'Network unavailable',
    };
    const f = nativeFixture(initial);
    render(<UpdatePanel />, { wrapper: wrapper(f.api) });
    fireEvent.click(await screen.findByRole('button', { name: '重试下载' }));
    expect(screen.getByRole('alert').textContent).toContain('Network unavailable');
    await waitFor(() =>
      expect(f.calls.some((call) => call.method === 'updates.download')).toBe(true),
    );
  });
});

describe('game log directory detection', () => {
  async function settings(native: ReturnType<typeof nativeFixture>) {
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('监听中');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    return within(await screen.findByRole('dialog', { name: '设置' }));
  }

  it('keeps an unsaved manual path when detection finds nothing and explains how to recover', async () => {
    const native = nativeFixture(bootstrapForApp(), { 'directory.detect': () => '' });
    const dialog = await settings(native);
    const input = dialog.getByRole('textbox', { name: '游戏日志目录' }) as HTMLInputElement;
    const manual = 'G:\\Games\\Broken Arrow\\GameLogs';
    fireEvent.change(input, { target: { value: manual } });
    fireEvent.click(dialog.getByRole('button', { name: '自动检测 Steam' }));
    await dialog.findByRole('alert');
    expect(input.value).toBe(manual);
    expect(dialog.getByRole('alert').textContent).toContain('已保留原路径');
    expect(input.getAttribute('aria-describedby')).toBe('settings-log-feedback');
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(native.backend.config.logDir).toBe(manual));
  });

  it('only applies a detected directory after the user saves settings', async () => {
    const detected = 'G:\\SteamLibrary\\steamapps\\common\\Broken Arrow\\GameLogs';
    const native = nativeFixture(bootstrapForApp(), { 'directory.detect': () => detected });
    const original = native.backend.config.logDir;
    const dialog = await settings(native);
    fireEvent.click(dialog.getByRole('button', { name: '自动检测 Steam' }));
    await dialog.findByText(translate('zh', 'logDetectFound'));
    expect((dialog.getByRole('textbox', { name: '游戏日志目录' }) as HTMLInputElement).value).toBe(
      detected,
    );
    expect(native.backend.config.logDir).toBe(original);
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(native.backend.config.logDir).toBe(detected));
  });

  it.each(['type', 'select'])(
    'ignores late detection after a manual %s and prevents duplicate requests or premature saves',
    async (method) => {
      const pending = deferred<string>();
      const manual = 'H:\\游戏\\GameLogs';
      const native = nativeFixture(bootstrapForApp(), {
        'directory.detect': () => pending.promise,
        'directory.select': () => manual,
      });
      const dialog = await settings(native);
      const input = dialog.getByRole('textbox', { name: '游戏日志目录' }) as HTMLInputElement;
      fireEvent.click(dialog.getByRole('button', { name: '自动检测 Steam' }));
      const detecting = dialog.getByRole('button', { name: '正在检测…' }) as HTMLButtonElement;
      expect(detecting.disabled).toBe(true);
      expect(detecting.getAttribute('aria-busy')).toBe('true');
      expect((dialog.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      fireEvent.click(detecting);
      expect(native.calls.filter((call) => call.method === 'directory.detect')).toHaveLength(1);
      if (method === 'type') fireEvent.change(input, { target: { value: manual } });
      else {
        fireEvent.click(dialog.getAllByRole('button', { name: '选择' })[0]!);
        await waitFor(() => expect(input.value).toBe(manual));
      }
      await act(async () => pending.resolve('C:\\old\\GameLogs'));
      expect(input.value).toBe(manual);
      expect(dialog.queryByRole('alert')).toBeNull();
      expect((dialog.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    },
  );

  it('keeps the path on failure and clears the error after a successful retry', async () => {
    let attempts = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'directory.detect': () => {
        if (!attempts++) throw new Error('Access denied');
        return 'G:\\Steam\\GameLogs';
      },
    });
    const original = native.backend.config.logDir;
    const dialog = await settings(native);
    fireEvent.click(dialog.getByRole('button', { name: '自动检测 Steam' }));
    await dialog.findByRole('alert');
    expect((dialog.getByRole('textbox', { name: '游戏日志目录' }) as HTMLInputElement).value).toBe(
      original,
    );
    expect(dialog.getByRole('alert').textContent).toContain('重试或手动选择');
    fireEvent.click(dialog.getByRole('button', { name: '自动检测 Steam' }));
    await dialog.findByText(translate('zh', 'logDetectFound'));
    expect(dialog.queryByRole('alert')).toBeNull();
  });

  it('lets the user close settings during detection and ignores its late result', async () => {
    const pending = deferred<string>();
    const native = nativeFixture(bootstrapForApp(), { 'directory.detect': () => pending.promise });
    const original = native.backend.config.logDir;
    const dialog = await settings(native);
    fireEvent.click(dialog.getByRole('button', { name: '自动检测 Steam' }));
    fireEvent.click(dialog.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => pending.resolve('C:\\late\\GameLogs'));
    expect(native.backend.config.logDir).toBe(original);
  });
});

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
  it('makes archive records beyond 500 reachable and resets pagination when filters change', async () => {
    const rows = Array.from({ length: 525 }, (_, index) => ({
      ...demoMatch(String(1000 + index)),
      map: `Archive map ${index}`,
      endedAt: 1_700_000_000_000 + index,
      outcome: index % 2 === 0 ? ('win' as const) : ('loss' as const),
      localPlayerId: index % 2 === 0 ? '1' : '2',
    }));
    const native = nativeFixture(structuredClone(demoBootstrap), {
      'matches.list': ({ accountId }) =>
        accountId ? rows.filter((m) => m.localPlayerId === accountId) : rows,
      'accounts.list': () =>
        ['1', '2'].map((id) => ({
          id,
          name: `Account ${id}`,
          persona: id,
          firstSeen: 0,
          lastSeen: 0,
          matchCount: 0,
        })),
    });
    render(
      <AppProvider api={native.api}>
        <MatchArchive />
      </AppProvider>,
    );
    await screen.findByRole('button', { name: 'Archive map 524' });
    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(screen.getByText('样本数: 525')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('页码'), { target: { value: '11' } });
    expect(screen.getByRole('button', { name: 'Archive map 0' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '胜利' }));
    expect((screen.getByLabelText('页码') as HTMLSelectElement).value).toBe('1');
    expect(screen.getByText('样本数: 263')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '全部结果' }));
    fireEvent.change(screen.getByLabelText('页码'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByText('样本数: 262')).toBeTruthy());
    expect((screen.getByLabelText('页码') as HTMLSelectElement).value).toBe('1');
  });

  it('scans local logs before refreshing the archive and exposes a busy state during the scan', async () => {
    const pending = deferred<null>();
    let rows = [demoMatch('101')];
    const native = nativeFixture(structuredClone(demoBootstrap), {
      'matches.list': () => rows,
      'matches.scan': () => pending.promise,
    });
    render(
      <AppProvider api={native.api}>
        <MatchArchive />
      </AppProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '刷新' }).hasAttribute('disabled')).toBe(false),
    );
    const calls = native.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    const scanning = screen.getByRole('button', { name: '扫描本地日志中…' });
    expect(scanning.hasAttribute('disabled')).toBe(true);
    expect(scanning.getAttribute('aria-busy')).toBe('true');
    expect(native.calls.slice(calls).map((call) => call.method)).toEqual(['matches.scan']);
    await act(async () => {
      rows = [...rows, demoMatch('102')];
      pending.resolve(null);
      await pending.promise;
    });
    await screen.findByText('样本数: 2');
    expect(native.calls.slice(calls).map((call) => call.method)).toEqual([
      'matches.scan',
      'matches.list',
    ]);
  });

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
    const dialog = await screen.findByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '上移 卡组工具' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const navigation = screen.getByRole('navigation');
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([translate('zh', 'overview'), '卡组工具', 'APM 统计']);
    fireEvent.click(within(navigation).getByRole('button', { name: '卡组工具' }));
    expect(screen.getByRole('heading', { level: 1, name: '卡组工具' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '卡组工具 展开' }).getAttribute('aria-expanded'),
    ).toBe('false');
    fireEvent.click(within(navigation).getByRole('button', { name: 'APM 统计' }));
    expect(screen.getByRole('heading', { level: 1, name: 'APM 统计' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'APM 统计 展开' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(native.backend.config.collapsedPanels).toEqual(['decks', 'apm']);
    expect(native.backend.config.panelOrder).toEqual(['current', 'decks', 'apm']);
  });

  it('opens a deep link and preserves search and result filters when navigating back', async () => {
    window.history.replaceState(null, '', '#archive');
    const native = nativeFixture();
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: '对局档案' });
    const navigation = screen.getByRole('navigation');
    fireEvent.click(screen.getByRole('button', { name: '失利' }));
    await screen.findByText('没有符合筛选条件的对局');
    fireEvent.click(within(navigation).getByRole('button', { name: '玩家查询' }));
    const search = screen.getByLabelText(translate('zh', 'searchLabel'));
    fireEvent.change(search, { target: { value: 'Zola' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByRole('button', { name: /^Zola #8863/ });
    act(() => {
      window.location.hash = 'archive';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('button', { name: '失利' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    fireEvent.click(within(navigation).getByRole('button', { name: '玩家查询' }));
    expect((screen.getByLabelText(translate('zh', 'searchLabel')) as HTMLInputElement).value).toBe(
      'Zola',
    );
    expect(screen.getByRole('button', { name: /^Zola #8863/ })).toBeTruthy();
    expect(window.location.hash).toBe('#players');
  });

  it('summarizes eligible completed matches for the current account', async () => {
    const win = demoMatch('1001');
    const loss = { ...demoMatch('1002', 1), outcome: 'loss' as const, eloAfter: 2090 };
    const restarted = { ...demoMatch('1003', 2), restarted: true };
    const otherAccount = { ...demoMatch('1004', 3), localPlayerId: '9999' };
    const native = nativeFixture(bootstrapForApp(), {
      'matches.list': () => [win, loss, restarted, otherAccount],
    });
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('1 胜 · 1 负');
    const metric = screen.getByText('近期胜率').closest('.metric-card') as HTMLElement;
    expect(within(metric).getByText('50%')).toBeTruthy();
    const rating = screen.getByText('最近 ELO').closest('.metric-card') as HTMLElement;
    expect(within(rating).getByText('2,114')).toBeTruthy();
    const archive = screen.getByText('已收录对局').closest('.metric-card') as HTMLElement;
    expect(within(archive).getByText('4')).toBeTruthy();
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

describe('profile refresh and report scopes', () => {
  it('refreshes the profile and full report together and explains metric and sample scopes', async () => {
    const profile: PlayerProfile = {
      id: '8863',
      name: 'Player',
      names: [],
      firstSeen: null,
      lastSeen: null,
      encounters: [],
      banned: null,
      recentMatches: [],
      recentError: null,
      latestElo: null,
      info: null,
    };
    const native = nativeFixture(bootstrapForApp(), {
      'players.profile': () => profile,
      'players.report': ({ id, force }) => ({
        ...demoReport(id),
        elo: force ? 2002 : 1001,
        sampleCount: 12,
      }),
    });
    render(<ProfileDialog id="8863" name="Player" />, { wrapper: wrapper(native.api) });
    await screen.findByText('1,001');
    expect(screen.getByText('最近一场 K/D')).toBeTruthy();
    expect(screen.getByText('最近一场 DMR')).toBeTruthy();
    expect(screen.getByText('总场次')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText('2,002');
    expect(screen.queryByText('1,001')).toBeNull();
    expect(
      native.calls.some(
        (call) =>
          call.method === 'players.profile' && 'force' in call.input! && call.input.force === true,
      ),
    ).toBe(true);
    expect(
      native.calls.some(
        (call) =>
          call.method === 'players.report' && 'force' in call.input! && call.input.force === true,
      ),
    ).toBe(true);
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
