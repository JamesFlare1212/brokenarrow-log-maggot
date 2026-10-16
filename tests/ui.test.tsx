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
import { formatMetric, summarizeMaggot } from '@ba/shared';
import { App } from '../apps/web/src/app/App';
import { AppProvider, useApp } from '../apps/web/src/app/state';
import {
  capturedAccounts,
  capturedMatches,
  capturedPlayers,
  fixtureBootstrap,
  matchFixture,
  reportFixture,
} from './fixtures/ui';
import { useRequest } from '../apps/web/src/hooks/useRequest';
import { translate } from '../apps/web/src/hooks/useI18n';
import { SessionPanel } from '../apps/web/src/features/session/SessionPanel';
import { PlayersPanel } from '../apps/web/src/features/players/PlayersPanel';
import { ProfileDialog } from '../apps/web/src/features/players/ProfileDialog';
import { ReplayDialog } from '../apps/web/src/features/replays/ReplayDialog';
import { RecordingSettings } from '../apps/web/src/features/replays/RecordingSettings';
import { ReplaysPanel } from '../apps/web/src/features/replays/ReplaysPanel';
import { Button, Dialog } from '../apps/web/src/components/ui';
import { BatraceStatus } from '../apps/web/src/components/BatraceStatus';
import { UpdatePanel } from '../apps/web/src/features/settings/UpdatePanel';
import { UpdateButton } from '../apps/web/src/features/settings/UpdateButton';
import { MatchArchive } from '../apps/web/src/features/matches/MatchArchive';
import { BansPanel } from '../apps/web/src/features/bans/BansPanel';

type Handler<K extends RpcMethod> = (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
type Handlers = { [K in RpcMethod]: Handler<K> };
interface Call {
  method: RpcMethod;
  input: RpcInputs[RpcMethod];
}
const localPlayer = capturedPlayers.find((p) => p.id === fixtureBootstrap.session.localPlayerId)!;
const secondPlayer = capturedPlayers.find((p) => p.id !== localPlayer.id)!;
const missingHandlers: RpcMethod[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Uses captured game data and explicitly controlled native events and RPC responses. */
function nativeFixture(
  initial = structuredClone(fixtureBootstrap),
  overrides: Partial<Handlers> = {},
) {
  const backend = structuredClone(initial);
  const defaults: Partial<Handlers> = {
    'matches.list': ({ accountId }) =>
      structuredClone(capturedMatches.filter((m) => !accountId || m.localPlayerId === accountId)),
    'accounts.list': () => structuredClone(capturedAccounts),
    'players.search': ({ query }) => ({
      source: 'local',
      players: structuredClone(
        capturedPlayers.filter(
          (player) =>
            player.id.includes(query) || player.name.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    }),
    'bans.list': () => [],
    'decks.list': () => ({
      found: false,
      decksDir: 'test-profile/Decks',
      backupsDir: '',
      decks: [],
      backups: [],
    }),
    'replays.list': () => [],
    'replays.directory': () => ({ dir: 'test-profile/recordings', count: 0 }),
    'displays.list': () => [],
  };
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
      const handler = defaults[method] as Handler<K> | undefined;
      if (handler) return handler(input);
      missingHandlers.push(method);
      throw new Error(`UI test must provide an RPC handler for ${method}`);
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
  const bootstrap = structuredClone(fixtureBootstrap);
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
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  expect(missingHandlers.splice(0)).toEqual([]);
});

describe('BATrace status indicator', () => {
  it('names the match detail API and preserves its block diagnostics beside the page fallback', async () => {
    const native = nativeFixture(bootstrapForApp());
    render(
      <BatraceStatus
        health={{
          state: 'partial',
          at: Date.now(),
          checks: [
            {
              path: '/api/match?matchid=9227650',
              ok: false,
              status: 403,
              ms: 100,
              failure: 'blocked',
              rayId: 'match-health-ray',
              fallback: { path: '/match/9227650', ok: true, status: 200, ms: 200 },
            },
          ],
        }}
      />,
      { wrapper: wrapper(native.api) },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'BATrace · 服务部分可用' }));
    const tooltip = within(screen.getByRole('tooltip'));
    for (const text of [
      '对局详情',
      '/api/match?matchid=9227650',
      '被 Cloudflare 拦截',
      'HTTP 403 · 100 ms',
      'Ray ID: match-health-ray',
      'fallback 成功',
      '/match/9227650',
      'HTTP 200 · 200 ms',
    ])
      expect(tooltip.getByText(text)).toBeTruthy();
  });

  it.each([true, false])(
    'shows fallback success %s below the API failure with the matching colors',
    async (ok) => {
      const native = nativeFixture(bootstrapForApp());
      render(
        <BatraceStatus
          health={{
            state: ok ? 'partial' : 'down',
            at: Date.now(),
            checks: [
              {
                path: '/api/players/info?stbid=8863',
                ok: false,
                ms: 100,
                status: 403,
                failure: 'blocked',
                fallback: { path: '/player/8863', ok, ms: 200, status: ok ? 200 : 403 },
              },
            ],
          }}
        />,
        { wrapper: wrapper(native.api) },
      );
      const trigger = await screen.findByRole('button', {
        name: `BATrace · ${ok ? '服务部分可用' : '服务不可用'}`,
      });
      expect(trigger.classList.contains(ok ? 'badge-warning' : 'badge-danger')).toBe(true);
      fireEvent.click(trigger);
      const tooltip = screen.getByRole('tooltip');
      const blocked = within(tooltip).getByText('被 Cloudflare 拦截');
      const fallback = within(tooltip).getByText(ok ? 'fallback 成功' : 'fallback 失败');
      expect(blocked.className).toBe(ok ? 'text-warning' : 'text-danger');
      expect(fallback.className).toBe(ok ? 'text-success' : 'text-danger');
      expect(blocked.nextElementSibling).toBe(fallback);
      expect(within(tooltip).getByText('/player/8863')).toBeTruthy();
      expect(within(tooltip).getByText(`HTTP ${ok ? 200 : 403} · 200 ms`)).toBeTruthy();
    },
  );

  it('shows endpoint diagnostics on hover, focus and tap, and dismisses on Escape or outside pointer', async () => {
    const initial = bootstrapForApp();
    const native = nativeFixture(initial);
    const health = {
      state: 'partial' as const,
      at: Date.now(),
      checks: [
        { path: '/api/players/search?q=test&limit=1', ok: true, ms: 123, status: 200 },
        {
          path: '/api/players/info?stbid=8863',
          ok: false,
          ms: 456,
          status: 403,
          failure: 'blocked' as const,
          rayId: 'test-ray-EWR',
        },
        {
          path: '/api/leaderboard/ban?limit=1',
          ok: false,
          ms: 15000,
          status: null,
          failure: 'timeout' as const,
        },
        {
          path: '/api/players/matches?stbid=8863&limit=1',
          ok: false,
          ms: 50,
          status: 200,
          failure: 'invalid-response' as const,
        },
      ],
    };
    const view = render(<BatraceStatus health={health} />, { wrapper: wrapper(native.api) });
    const trigger = await screen.findByRole('button', { name: 'BATrace · 服务部分可用' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
    for (const text of [
      '玩家资料',
      '被 Cloudflare 拦截',
      'Ray ID: test-ray-EWR',
      '/api/players/info?stbid=8863',
      'HTTP 403 · 456 ms',
      '请求超时',
      '未收到 HTTP 响应 · 15000 ms',
      translate('zh', 'healthFailure_invalid-response'),
    ])
      expect(within(tooltip).getByText(text)).toBeTruthy();
    expect(tooltip.textContent).toContain('上次检查：');
    expect(tooltip.textContent).toContain('每 10 分钟');
    expect(tooltip.textContent).toContain('业务请求也会更新状态');
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
    view.rerender(<BatraceStatus health={{ state: 'unknown', at: 0, checks: [] }} />);
    fireEvent.focus(trigger);
    expect(within(screen.getByRole('tooltip')).getByText('尚无检查结果。')).toBeTruthy();
  });

  it('shows readable state and matching dot colors as health events arrive', async () => {
    const initial = bootstrapForApp();
    initial.health = { state: 'unknown', at: 0, checks: [] };
    const native = nativeFixture(initial);
    const { container } = render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('BATrace');
    const badge = container.querySelector('.health-status-trigger')!;
    expect(badge.textContent).toContain('未知');
    expect(badge.querySelector('.sr-only')).toBeNull();
    for (const [state, tone, label] of [
      ['ok', 'success', '服务可用'],
      ['partial', 'warning', '服务部分可用'],
      ['down', 'danger', '服务不可用'],
    ] as const) {
      act(() =>
        native.emit({
          type: 'health',
          revision: native.backend.revision + 1,
          health: { state, at: Date.now(), checks: [] },
        }),
      );
      expect(badge.textContent).toContain(label);
      expect(badge.classList.contains(`badge-${tone}`)).toBe(true);
      expect(badge.querySelector(`.status-${tone}`)).not.toBeNull();
    }
  });
});

describe('application updates', () => {
  it('checks directly from the sidebar and replaces refresh with download when an update is found', async () => {
    const initial = bootstrapForApp();
    initial.updates = { ...initial.updates, mode: 'installed', status: 'idle' };
    const checking = deferred<RpcOutputs['updates.check']>();
    const f = nativeFixture(initial, {
      'updates.check': () => checking.promise,
      'updates.download': () => initial.updates,
    });
    render(<App />, { wrapper: wrapper(f.api) });
    const check = await screen.findByRole('button', { name: '检查更新' });
    expect(check.closest('.sidebar-footer')).not.toBeNull();
    expect(check.querySelector('[data-icon="arrows-rotate"]')).not.toBeNull();
    fireEvent.click(check);
    expect(check.querySelector('[data-icon="arrows-rotate"].fa-spin')).not.toBeNull();
    expect(check.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(check);
    await act(async () => checking.resolve(initial.updates));
    await waitFor(() =>
      expect(f.calls.filter((call) => call.method === 'updates.check')).toHaveLength(1),
    );
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, status: 'available', availableVersion: '4.0.1' },
        revision: 1,
      }),
    );
    const download = screen.getByRole('button', { name: '下载更新' });
    expect(download.querySelector('[data-icon="download"]')).not.toBeNull();
    expect(download.querySelector('.update-dot')).not.toBeNull();
    act(() => download.focus());
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toContain(
      '下载完成后，点击“重启并安装”应用更新',
    );
    fireEvent.blur(download);
    expect(f.calls.some((call) => call.method === 'updates.download')).toBe(false);
    fireEvent.click(download);
    await waitFor(() =>
      expect(f.calls.filter((call) => call.method === 'updates.download')).toHaveLength(1),
    );
    expect(screen.queryByRole('main', { name: '设置' })).toBeNull();
  });

  it('shows ring progress without percentages and installs only after clicking the ready button', async () => {
    const initial = structuredClone(fixtureBootstrap);
    initial.session.current = null;
    initial.recording.phase = 'idle';
    initial.updates = {
      ...initial.updates,
      mode: 'installed',
      status: 'downloading',
      downloadPercent: 37,
    };
    const f = nativeFixture(initial, {
      'updates.install': () => ({ ...initial.updates, status: 'installing', downloadPercent: 100 }),
    });
    render(<UpdateButton />, { wrapper: wrapper(f.api) });
    const download = (await screen.findByRole('button', {
      name: '正在下载更新…',
    })) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect(download.textContent).toBe('');
    expect(download.querySelector('.update-ring-progress')?.getAttribute('stroke-dashoffset')).toBe(
      '63',
    );
    expect(download.querySelector('.update-percent')).toBeNull();
    expect(download.querySelector('[data-icon="download"].fa-spin')).toBeNull();
    fireEvent.click(download);
    expect(f.calls.some((call) => call.method.startsWith('updates.'))).toBe(false);
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, status: 'downloaded', downloadPercent: 100 },
        revision: 1,
      }),
    );
    const install = screen.getByRole('button', { name: '重启并安装' }) as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    expect(install.querySelector('[data-icon="arrow-rotate-right"]')).not.toBeNull();
    expect(install.querySelector('.update-dot')).not.toBeNull();
    expect(f.calls.some((call) => call.method === 'updates.install')).toBe(false);
    fireEvent.click(install);
    await waitFor(() =>
      expect(f.calls.filter((call) => call.method === 'updates.install')).toHaveLength(1),
    );
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, status: 'installing', downloadPercent: 100 },
        revision: 2,
      }),
    );
    expect(
      (screen.getByRole('button', { name: '正在保存数据并重启安装…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(install.querySelector('[data-icon="arrow-rotate-right"].fa-spin')).not.toBeNull();
    fireEvent.click(install);
    expect(f.calls.filter((call) => call.method === 'updates.install')).toHaveLength(1);
  });

  it('retries failed downloads from the same button and offers portable downloads', async () => {
    const initial = structuredClone(fixtureBootstrap);
    initial.updates = {
      ...initial.updates,
      mode: 'installed',
      status: 'error',
      errorContext: 'download',
      error: 'Network unavailable',
      availableVersion: '4.0.1',
    };
    const f = nativeFixture(initial, {
      'updates.download': () => initial.updates,
      'updates.openDownload': () => null,
    });
    render(<UpdateButton />, { wrapper: wrapper(f.api) });
    fireEvent.click(await screen.findByRole('button', { name: '下载更新' }));
    await waitFor(() =>
      expect(f.calls.filter((call) => call.method === 'updates.download')).toHaveLength(1),
    );
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, mode: 'portable', status: 'available', error: null },
        revision: 1,
      }),
    );
    const download = screen.getByRole('button', { name: '下载更新' });
    act(() => download.focus());
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toContain('便携版');
    fireEvent.blur(download);
    await waitFor(() => expect((download as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(download);
    await waitFor(() =>
      expect(f.calls.filter((call) => call.method === 'updates.openDownload')).toHaveLength(1),
    );
    expect(f.calls.filter((call) => call.method === 'updates.download')).toHaveLength(1);
  });

  it('downloads only on click, shows native progress, and blocks restart until the match ends', async () => {
    const initial = structuredClone(fixtureBootstrap);
    initial.updates = {
      ...initial.updates,
      mode: 'installed',
      status: 'available',
      availableVersion: '4.0.1',
    };
    const f = nativeFixture(initial, {
      'updates.download': () => initial.updates,
      'updates.install': () => initial.updates,
    });
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
    expect(screen.getByText('更新已就绪，请在对局和录制结束后点击“重启并安装”。')).toBeTruthy();
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
    const initial = structuredClone(fixtureBootstrap);
    initial.updates = {
      ...initial.updates,
      mode: 'portable',
      status: 'available',
      availableVersion: '4.0.1',
    };
    const f = nativeFixture(initial, { 'updates.openDownload': () => null });
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
    const initial = structuredClone(fixtureBootstrap);
    initial.updates = {
      ...initial.updates,
      mode: 'installed',
      status: 'error',
      availableVersion: '4.0.1',
      errorContext: 'download',
      error: 'Network unavailable',
    };
    const f = nativeFixture(initial, { 'updates.download': () => initial.updates });
    render(<UpdatePanel />, { wrapper: wrapper(f.api) });
    fireEvent.click(await screen.findByRole('button', { name: '重试下载' }));
    expect(screen.getByRole('alert').textContent).toContain('Network unavailable');
    await waitFor(() =>
      expect(f.calls.some((call) => call.method === 'updates.download')).toBe(true),
    );
  });
});

describe('settings pages and automatic saving', () => {
  it.each(['#about', '#settings/about', '#settings/updates'])(
    'redirects the legacy %s route to the compact About section in General settings',
    async (route) => {
      window.history.replaceState(null, '', route);
      const initial = bootstrapForApp();
      const native = nativeFixture(initial);
      render(<App />, { wrapper: wrapper(native.api) });
      const settings = within(await screen.findByRole('main', { name: '设置' }));
      expect(location.hash).toBe('#settings/general');
      expect(screen.getByRole('tab', { name: '常规' }).getAttribute('aria-selected')).toBe('true');
      const about = within(settings.getByRole('region', { name: '关于' }));
      expect(about.getByText('v' + initial.version.current)).toBeTruthy();
      expect(about.getByRole('button', { name: '检查更新' })).toBeTruthy();
      expect(about.getByRole('button', { name: 'GitHub' })).toBeTruthy();
      expect(about.getByRole('button', { name: 'BATrace' })).toBeTruthy();
      expect(settings.queryByText(translate('zh', 'aboutText'))).toBeNull();
      expect(screen.queryByRole('tab', { name: '应用更新' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '返回' }));
      await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
      expect(
        within(screen.getByRole('navigation')).queryByRole('button', { name: '关于' }),
      ).toBeNull();
    },
  );

  it('opens General from the stable update toolbar entry and keeps download and project links working', async () => {
    const initial = bootstrapForApp();
    initial.updates = {
      ...initial.updates,
      mode: 'installed',
      status: 'available',
      availableVersion: '4.1.1',
    };
    const native = nativeFixture(initial, {
      'updates.download': () => initial.updates,
      'external.open': () => null,
    });
    render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '查看更新' }));
    const settings = within(await screen.findByRole('main', { name: '设置' }));
    expect(location.hash).toBe('#settings/general');
    const about = within(settings.getByRole('region', { name: '关于' }));
    expect(about.getByText('发现新版本 v4.1.1')).toBeTruthy();
    expect(about.getByText('下载完成后，点击“重启并安装”应用更新。')).toBeTruthy();
    fireEvent.click(about.getByRole('button', { name: '下载更新' }));
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'updates.download')).toHaveLength(1),
    );
    fireEvent.click(about.getByRole('button', { name: 'GitHub' }));
    fireEvent.click(about.getByRole('button', { name: 'BATrace' }));
    await waitFor(() =>
      expect(
        native.calls.filter((call) => call.method === 'external.open').map((call) => call.input),
      ).toEqual([
        { url: 'https://github.com/JamesFlare1212/brokenarrow-log-maggot' },
        { url: 'https://dash.batrace.top/' },
      ]),
    );
  });

  async function openSettings(native: ReturnType<typeof nativeFixture>) {
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('监听中');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    return within(await screen.findByRole('main', { name: '设置' }));
  }

  it('opens a full page, uses addressable tabs, and returns to the previous page with its input intact', async () => {
    const native = nativeFixture(bootstrapForApp());
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('监听中');
    // Include the players page in this fixture's navigation.
    act(() =>
      native.emit({
        type: 'config',
        revision: native.backend.revision + 1,
        config: { ...native.backend.config, panelOrder: ['current', 'players'] },
      }),
    );
    fireEvent.click(
      within(screen.getByRole('navigation')).getByRole('button', { name: '玩家查询' }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: translate('zh', 'searchLabel') }), {
      target: { value: localPlayer.name },
    });
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const page = within(await screen.findByRole('main', { name: '设置' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(page.queryByRole('button', { name: '保存' })).toBeNull();
    expect(page.queryByRole('button', { name: '取消' })).toBeNull();
    expect(location.hash).toBe('#settings/appearance');
    fireEvent.click(screen.getByRole('tab', { name: '游戏连接' }));
    expect(location.hash).toBe('#settings/connection');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(location.hash).toBe('#players');
    expect(
      (screen.getByRole('searchbox', { name: translate('zh', 'searchLabel') }) as HTMLInputElement)
        .value,
    ).toBe(localPlayer.name);
  });

  it('autosaves separate light and dark palettes and restores them when switching modes and reopening', async () => {
    const native = nativeFixture(bootstrapForApp());
    const page = await openSettings(native);
    expect(within(page.getByRole('group', { name: '主题' })).getAllByRole('button')).toHaveLength(
      3,
    );
    expect(
      within(page.getByRole('group', { name: '配色方案' })).getAllByRole('button'),
    ).toHaveLength(18);
    fireEvent.click(page.getByRole('button', { name: '森林 · 浅色' }));
    expect(document.documentElement.dataset.mode).toBe('dark');
    fireEvent.click(page.getByRole('button', { name: '紫夜 · 深色' }));
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({
        lightTheme: 'forest',
        darkTheme: 'violet',
        themeMode: 'dark',
      }),
    );
    expect(document.documentElement.dataset).toMatchObject({ mode: 'dark', theme: 'violet' });
    fireEvent.click(page.getByRole('button', { name: '浅色' }));
    await waitFor(() => expect(native.backend.config.themeMode).toBe('light'));
    expect(document.documentElement.dataset).toMatchObject({ mode: 'light', theme: 'forest' });
    expect(page.getByRole('button', { name: '森林 · 浅色' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(page.getByRole('button', { name: '紫夜 · 深色' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const reopened = within(await screen.findByRole('main', { name: '设置' }));
    expect(reopened.getByRole('button', { name: '森林 · 浅色' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(reopened.getByRole('button', { name: '紫夜 · 深色' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      native.calls
        .filter((call) => call.method === 'config.update')
        .every((call) =>
          Object.keys(call.input!).every((key) =>
            ['lightTheme', 'darkTheme', 'themeMode'].includes(key),
          ),
        ),
    ).toBe(true);
  });

  it.each(['system', 'light', 'dark'] as const)(
    'keeps %s mode when changing individual palettes or a whole pair',
    async (mode) => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
      );
      const initial = bootstrapForApp();
      initial.config.themeMode = mode;
      initial.config.lightTheme = 'dark';
      initial.config.darkTheme = 'dark';
      const native = nativeFixture(initial);
      const page = await openSettings(native);
      const resolvedMode = mode === 'light' ? 'light' : 'dark';
      fireEvent.click(page.getByRole('button', { name: '森林 · 浅色' }));
      await waitFor(() => expect(native.backend.config.lightTheme).toBe('forest'));
      expect(native.backend.config.themeMode).toBe(mode);
      expect(document.documentElement.dataset).toMatchObject({
        mode: resolvedMode,
        theme: mode === 'light' ? 'forest' : 'dark',
      });
      fireEvent.click(page.getByRole('button', { name: '紫夜 · 深色' }));
      await waitFor(() => expect(native.backend.config.darkTheme).toBe('violet'));
      expect(native.backend.config.themeMode).toBe(mode);
      expect(document.documentElement.dataset).toMatchObject({
        mode: resolvedMode,
        theme: mode === 'light' ? 'forest' : 'violet',
      });
      fireEvent.click(page.getByRole('button', { name: '深海 · 选择整组配色' }));
      await waitFor(() =>
        expect(native.backend.config).toMatchObject({
          lightTheme: 'ocean',
          darkTheme: 'ocean',
          themeMode: mode,
        }),
      );
      expect(document.documentElement.dataset).toMatchObject({
        mode: resolvedMode,
        theme: 'ocean',
      });
      expect(
        page
          .getByRole('button', { name: translate('zh', 'themeMode.' + mode) })
          .getAttribute('aria-pressed'),
      ).toBe('true');
      expect(
        native.calls
          .filter((call) => call.method === 'config.update')
          .every((call) => !Object.keys(call.input!).includes('themeMode')),
      ).toBe(true);
    },
  );

  it('selects a full palette pair with the keyboard, preserves system mode, and keeps swatches independent', async () => {
    const initial = bootstrapForApp();
    initial.config.themeMode = 'system';
    initial.config.lightTheme = 'forest';
    initial.config.darkTheme = 'violet';
    const native = nativeFixture(initial);
    const page = await openSettings(native);
    const user = userEvent.setup();
    const card = page.getByRole('button', { name: '石墨 · 选择整组配色' });
    card.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({
        lightTheme: 'dark',
        darkTheme: 'dark',
        themeMode: 'system',
      }),
    );
    expect(
      native.calls.filter((call) => call.method === 'config.update').map((call) => call.input),
    ).toEqual([{ lightTheme: 'dark', darkTheme: 'dark' }]);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(page.getByRole('button', { name: '石墨 · 浅色' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(page.getByRole('button', { name: '石墨 · 深色' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(page.getByRole('button', { name: '紫夜 · 深色' }));
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({
        lightTheme: 'dark',
        darkTheme: 'violet',
        themeMode: 'system',
      }),
    );
    expect(card.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(page.getByRole('button', { name: '森林 · 选择整组配色' }));
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({
        lightTheme: 'forest',
        darkTheme: 'forest',
        themeMode: 'system',
      }),
    );
  });

  it('uses each saved palette when the OS changes, including after leaving settings', async () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) => listeners.delete(callback),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    const native = nativeFixture(bootstrapForApp());
    const page = await openSettings(native);
    fireEvent.click(page.getByRole('button', { name: '森林 · 浅色' }));
    fireEvent.click(page.getByRole('button', { name: '深海 · 深色' }));
    fireEvent.click(page.getByRole('button', { name: '跟随系统' }));
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({
        lightTheme: 'forest',
        darkTheme: 'ocean',
        themeMode: 'system',
      }),
    );
    expect(document.documentElement.dataset).toMatchObject({ mode: 'light', theme: 'forest' });
    act(() => {
      media.matches = true;
      listeners.forEach((callback) => callback());
    });
    expect(document.documentElement.dataset).toMatchObject({ mode: 'dark', theme: 'ocean' });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    act(() => {
      media.matches = false;
      listeners.forEach((callback) => callback());
    });
    expect(document.documentElement.dataset).toMatchObject({ mode: 'light', theme: 'forest' });
  });

  it('retains failed changes, displays the save error, and retries the same patch', async () => {
    let failed = false;
    const native = nativeFixture(bootstrapForApp(), {
      'config.update': (patch) => {
        if (!failed) {
          failed = true;
          throw new Error('Disk is busy');
        }
        const config = configSchema.parse({ ...native.backend.config, ...patch });
        native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
        return config;
      },
    });
    const page = await openSettings(native);
    fireEvent.click(page.getByRole('button', { name: '森林 · 深色' }));
    expect((await page.findByRole('alert')).textContent).toContain('Disk is busy');
    expect(native.backend.config.darkTheme).toBeUndefined();
    expect(document.documentElement.dataset).toMatchObject({ mode: 'dark', theme: 'forest' });
    fireEvent.click(page.getByRole('button', { name: '重试保存' }));
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({ darkTheme: 'forest', themeMode: 'dark' }),
    );
    await waitFor(() => expect(page.queryByRole('alert')).toBeNull());
    expect(page.getByRole('status').textContent).toBe('已自动保存');
  });

  it('serializes saves and keeps the newest choices visible when an older save completes', async () => {
    const writes: Array<{
      patch: RpcInputs['config.update'];
      result: ReturnType<typeof deferred<Bootstrap['config']>>;
    }> = [];
    const native = nativeFixture(bootstrapForApp(), {
      'config.update': (patch) => {
        const result = deferred<Bootstrap['config']>();
        writes.push({ patch, result });
        return result.promise.then((config) => {
          native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
          return config;
        });
      },
    });
    const page = await openSettings(native);
    fireEvent.click(page.getByRole('button', { name: '森林 · 浅色' }));
    fireEvent.click(page.getByRole('button', { name: '暖橙 · 浅色' }));
    fireEvent.click(page.getByRole('button', { name: '紫夜 · 深色' }));
    expect(writes).toHaveLength(1);
    await act(async () =>
      writes[0]!.result.resolve(
        configSchema.parse({ ...native.backend.config, ...writes[0]!.patch }),
      ),
    );
    expect(writes).toHaveLength(2);
    expect(writes[1]!.patch).toEqual({
      lightTheme: 'orange',
      darkTheme: 'violet',
    });
    expect(document.documentElement.dataset).toMatchObject({ mode: 'dark', theme: 'violet' });
    expect(page.getByRole('button', { name: '暖橙 · 浅色' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await act(async () =>
      writes[1]!.result.resolve(
        configSchema.parse({ ...native.backend.config, ...writes[1]!.patch }),
      ),
    );
    expect(native.backend.config).toMatchObject({
      lightTheme: 'orange',
      darkTheme: 'violet',
      themeMode: 'dark',
    });
    expect(page.getByRole('status').textContent).toBe('已自动保存');
  });

  it('preserves settings tab keyboard navigation through the shared sidebar items', async () => {
    const user = userEvent.setup();
    await openSettings(nativeFixture(bootstrapForApp()));
    screen.getByRole('tab', { name: '外观' }).focus();
    await user.keyboard('{ArrowDown}');
    const connection = screen.getByRole('tab', { name: '游戏连接' });
    expect(document.activeElement).toBe(connection);
    expect(connection.getAttribute('aria-selected')).toBe('true');
    expect(connection.tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel', { name: '游戏连接' })).toBeTruthy();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '本机账号' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '常规' }));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '本机账号' }));
    await user.keyboard('{Home}');
    expect(location.hash).toBe('#settings/general');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '常规' }));
  });

  it('persists sidebar collapse and shares it between the workspace and settings', async () => {
    const native = nativeFixture(bootstrapForApp());
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('监听中');
    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }));
    await waitFor(() => expect(native.backend.config.sidebarCollapsed).toBe(true));
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    await screen.findByRole('main', { name: '设置' });
    expect(
      document.querySelector('.settings-page')?.classList.contains('settings-page-collapsed'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));
    await waitFor(() => expect(native.backend.config.sidebarCollapsed).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(
      false,
    );
  });

  it('opens a settings tab directly and saves both label and switch activation', async () => {
    history.replaceState(null, '', '#settings/automation');
    const native = nativeFixture(bootstrapForApp());
    render(<App />, { wrapper: wrapper(native.api) });
    const page = within(await screen.findByRole('main', { name: '设置' }));
    expect(screen.getByRole('tab', { name: '自动化' }).getAttribute('aria-selected')).toBe('true');
    const checkbox = page.getByRole('checkbox', {
      name: translate('zh', 'autoQuery'),
    }) as HTMLInputElement;
    fireEvent.click(page.getByText(translate('zh', 'autoQuery')));
    await waitFor(() => expect(native.backend.config.autoQueryCurrentMatch).toBe(false));
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    await waitFor(() => expect(native.backend.config.autoQueryCurrentMatch).toBe(true));
    checkbox.focus();
    await userEvent.setup().keyboard(' ');
    await waitFor(() => expect(native.backend.config.autoQueryCurrentMatch).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(location.hash).toBe('#current');
  });
});

describe('recording settings automatic saving', () => {
  async function open(native: ReturnType<typeof nativeFixture>) {
    history.replaceState(null, '', '#replays');
    render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '录像设置' }));
    return within(await screen.findByRole('dialog', { name: '录像设置' }));
  }

  it('opens recording settings as a sidebar tab and preserves pending changes when leaving it', async () => {
    history.replaceState(null, '', '#settings/recording');
    const native = nativeFixture(bootstrapForApp(), { 'displays.thumbnail': () => null });
    render(<App />, { wrapper: wrapper(native.api) });
    const panel = within(await screen.findByRole('tabpanel', { name: '录像设置' }));
    expect(screen.getByRole('tab', { name: '录像设置' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    const directory = panel.getByRole('textbox', { name: '保存目录' });
    const destination = 'F:\\Recordings';
    fireEvent.change(directory, { target: { value: destination } });
    fireEvent.change(panel.getByRole('slider', { name: /帧率/ }), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('tab', { name: '自动化' }));
    await waitFor(() => expect(native.backend.config.replaySaveDir).toBe(destination));
    expect(native.backend.config.replayFps).toBe(45);
    expect(screen.queryByRole('button', { name: '录像设置' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '录像设置' }));
    expect(location.hash).toBe('#settings/recording');
    expect((screen.getByRole('textbox', { name: '保存目录' }) as HTMLInputElement).value).toBe(
      destination,
    );
  });

  it('autosaves controls and flushes the latest slider value before starting a recording test', async () => {
    const initial = bootstrapForApp();
    const saving = deferred<RpcOutputs['config.update']>();
    let config = initial.config;
    let saves = 0;
    const native = nativeFixture(initial, {
      'displays.thumbnail': () => null,
      'config.update': async (patch) => {
        config = configSchema.parse({ ...config, ...patch });
        if (++saves === 1) return saving.promise;
        return config;
      },
      'replays.test': () => {
        expect(config.replayFps).toBe(60);
        return null;
      },
    });
    const dialog = await open(native);
    expect(dialog.queryByRole('button', { name: '保存' })).toBeNull();
    expect(dialog.queryByRole('button', { name: '取消' })).toBeNull();
    fireEvent.change(dialog.getByRole('slider', { name: /帧率/ }), { target: { value: '45' } });
    fireEvent.click(dialog.getByRole('button', { name: '录制 60 秒测试' }));
    await waitFor(() => expect(saves).toBe(1));
    expect(native.calls.some((call) => call.method === 'replays.test')).toBe(false);
    fireEvent.change(dialog.getByRole('slider', { name: /帧率/ }), { target: { value: '60' } });
    await act(async () => saving.resolve(config));
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'replays.test')).toHaveLength(1),
    );
    expect(saves).toBe(2);
    expect(dialog.getByText('已自动保存')).toBeTruthy();
    fireEvent.click(dialog.getByRole('checkbox', { name: '自动录制' }));
    await waitFor(() => expect(config.replayEnabled).toBe(!initial.config.replayEnabled));
  });

  it('keeps the original folder after a failed migration and retries before saving the new folder', async () => {
    const initial = bootstrapForApp();
    const destination = 'D:\\Recordings';
    let attempts = 0;
    const native = nativeFixture(initial, {
      'displays.thumbnail': () => null,
      'replays.move': () => ({ moved: 0, failed: ++attempts === 1 ? ['match.webm'] : [] }),
    });
    const dialog = await open(native);
    fireEvent.click(dialog.getByRole('checkbox', { name: '更换目录时迁移已有录像' }));
    const directory = dialog.getByRole('textbox', { name: '保存目录' });
    fireEvent.change(directory, { target: { value: destination } });
    expect(native.calls.some((call) => call.method === 'replays.move')).toBe(false);
    fireEvent.blur(directory);
    await dialog.findByRole('button', { name: '重试保存' });
    expect(native.backend.config.replaySaveDir).toBe(initial.config.replaySaveDir);
    expect(native.calls.some((call) => call.method === 'config.update')).toBe(false);
    expect((directory as HTMLInputElement).value).toBe(destination);
    fireEvent.click(dialog.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(native.backend.config.replaySaveDir).toBe(destination));
    expect(attempts).toBe(2);
    expect(
      native.calls
        .filter((call) => ['replays.move', 'config.update'].includes(call.method))
        .map((call) => call.method),
    ).toEqual(['replays.move', 'replays.move', 'config.update']);
  });

  it('keeps the dialog open when closing cannot save and flushes the directory on retry', async () => {
    let fail = true;
    const initial = bootstrapForApp();
    const native = nativeFixture(initial, {
      'displays.thumbnail': () => null,
      'config.update': (patch) => {
        if (fail) throw new Error('Disk unavailable');
        return configSchema.parse({ ...initial.config, ...patch });
      },
    });
    const dialog = await open(native);
    const destination = 'E:\\Recordings';
    fireEvent.change(dialog.getByRole('textbox', { name: '保存目录' }), {
      target: { value: destination },
    });
    fireEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await dialog.findByText('Disk unavailable');
    expect(screen.getByRole('dialog', { name: '录像设置' })).toBeTruthy();
    fail = false;
    fireEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(native.calls.filter((call) => call.method === 'config.update').at(-1)?.input).toEqual({
      replaySaveDir: destination,
    });
  });
});

describe('game log directory detection', () => {
  async function settings(native: ReturnType<typeof nativeFixture>) {
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('监听中');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const page = within(await screen.findByRole('main', { name: '设置' }));
    fireEvent.click(screen.getByRole('tab', { name: '游戏连接' }));
    return page;
  }

  it('retains and autosaves a manual path when detection finds nothing', async () => {
    const native = nativeFixture(bootstrapForApp(), { 'directory.detect': () => '' });
    const page = await settings(native);
    const input = page.getByRole('textbox', { name: '游戏日志目录' }) as HTMLInputElement;
    const manual = 'G:\\Games\\Broken Arrow\\GameLogs';
    fireEvent.change(input, { target: { value: manual } });
    fireEvent.click(page.getByRole('button', { name: '自动检测 Steam' }));
    await page.findByRole('alert');
    expect(input.value).toBe(manual);
    expect(page.getByRole('alert').textContent).toContain('已保留原路径');
    expect(input.getAttribute('aria-describedby')).toBe('settings-log-feedback');
    await waitFor(() => expect(native.backend.config.logDir).toBe(manual));
  });

  it('automatically saves a detected directory', async () => {
    const detected = 'G:\\SteamLibrary\\steamapps\\common\\Broken Arrow\\GameLogs';
    const native = nativeFixture(bootstrapForApp(), { 'directory.detect': () => detected });
    const page = await settings(native);
    fireEvent.click(page.getByRole('button', { name: '自动检测 Steam' }));
    await page.findByText(translate('zh', 'logDetectFound'));
    await waitFor(() => expect(native.backend.config.logDir).toBe(detected));
  });

  it.each(['type', 'select'])(
    'ignores late detection after a manual %s and prevents duplicate requests',
    async (method) => {
      const pending = deferred<string>();
      const manual = 'H:\\游戏\\GameLogs';
      const native = nativeFixture(bootstrapForApp(), {
        'directory.detect': () => pending.promise,
        'directory.select': () => manual,
      });
      const page = await settings(native);
      const input = page.getByRole('textbox', { name: '游戏日志目录' }) as HTMLInputElement;
      fireEvent.click(page.getByRole('button', { name: '自动检测 Steam' }));
      const detecting = page.getByRole('button', { name: '正在检测…' }) as HTMLButtonElement;
      expect(detecting.disabled).toBe(true);
      expect(detecting.getAttribute('aria-busy')).toBe('true');
      fireEvent.click(detecting);
      expect(native.calls.filter((call) => call.method === 'directory.detect')).toHaveLength(1);
      if (method === 'type') fireEvent.change(input, { target: { value: manual } });
      else {
        fireEvent.click(page.getAllByRole('button', { name: '选择' })[0]!);
        await waitFor(() => expect(input.value).toBe(manual));
      }
      await act(async () => pending.resolve('C:\\old\\GameLogs'));
      expect(input.value).toBe(manual);
      expect(page.queryByRole('alert')).toBeNull();
      await waitFor(() => expect(native.backend.config.logDir).toBe(manual));
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
    const page = await settings(native);
    fireEvent.click(page.getByRole('button', { name: '自动检测 Steam' }));
    await page.findByRole('alert');
    expect((page.getByRole('textbox', { name: '游戏日志目录' }) as HTMLInputElement).value).toBe(
      original,
    );
    expect(page.getByRole('alert').textContent).toContain('重试或手动选择');
    fireEvent.click(page.getByRole('button', { name: '自动检测 Steam' }));
    await page.findByText(translate('zh', 'logDetectFound'));
    expect(page.queryByRole('alert')).toBeNull();
  });

  it('flushes pending text on return and ignores a late detection after leaving', async () => {
    const pending = deferred<string>();
    const native = nativeFixture(bootstrapForApp(), { 'directory.detect': () => pending.promise });
    const page = await settings(native);
    fireEvent.click(page.getByRole('button', { name: '自动检测 Steam' }));
    fireEvent.change(page.getByRole('textbox', { name: '游戏日志目录' }), {
      target: { value: 'G:\\latest\\GameLogs' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(native.backend.config.logDir).toBe('G:\\latest\\GameLogs');
    await act(async () => pending.resolve('C:\\late\\GameLogs'));
    expect(native.backend.config.logDir).toBe('G:\\latest\\GameLogs');
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
    const bootstrap = structuredClone(fixtureBootstrap);
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
    const bootstrap = structuredClone(fixtureBootstrap);
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
    const bootstrap = structuredClone(fixtureBootstrap);
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
    const native = nativeFixture(structuredClone(fixtureBootstrap), {
      'app.bootstrap': () => (++bootstraps === 1 ? first.promise : second.promise),
    });
    const { result, unmount } = renderHook(() => useApp(), {
      wrapper: wrapper(native.api),
      reactStrictMode: true,
    });
    expect(native.subscriptions).toBe(2);
    expect(native.unsubscriptions).toBe(1);
    expect(native.activeSubscriptions).toBe(1);
    const current = structuredClone(fixtureBootstrap);
    current.revision = 5;
    await act(async () => {
      second.resolve(current);
      await second.promise;
    });
    const discarded = structuredClone(fixtureBootstrap);
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
  it('keeps the ban list mounted while a filter request is pending', async () => {
    const pending = deferred<Ban[]>();
    const rows = [
      bannedPlayer(),
      { ...bannedPlayer(), id: '9001', name: 'Unmet player', encountered: false },
    ];
    const native = nativeFixture(bootstrapForApp(), {
      'bans.list': ({ metOnly }) => (metOnly ? pending.promise : rows),
    });
    render(<BansPanel />, { wrapper: wrapper(native.api) });
    await screen.findByRole('button', { name: 'Unmet player #9001' });
    const list = screen.getByRole('list', { name: '封禁追踪' });
    const viewport = list.parentElement!;
    fireEvent.click(screen.getByRole('switch', { name: '我遇到过的作弊者' }));
    expect(viewport.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('list', { name: '封禁追踪' })).toBe(list);
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await act(async () => pending.resolve([rows[0]!]));
    expect(viewport.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('list', { name: '封禁追踪' })).toBe(list);
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Unmet player #9001' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: '封禁追踪' })).toBeNull();
  });

  it('paginates bans, resets list scrolling and filters, and clamps refreshed results', async () => {
    let rows = Array.from({ length: 45 }, (_, index) => ({
      ...bannedPlayer(),
      id: String(9000 + index),
      name: `Banned player ${index}`,
      encountered: index < 3,
    }));
    const native = nativeFixture(bootstrapForApp(), {
      'bans.list': ({ metOnly }) => (metOnly ? rows.filter((row) => row.encountered) : rows),
      'bans.sync': () => rows,
    });
    render(<BansPanel />, { wrapper: wrapper(native.api) });
    await screen.findByText('第 1–20 条，共 45 条');
    const filter = screen.getByRole('switch', { name: '我遇到过的作弊者' });
    expect(filter.getAttribute('aria-checked')).toBe('false');
    const list = screen.getByRole('list', { name: '封禁追踪' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true);
    fireEvent.scroll(list, { target: { scrollTop: 150 } });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(list.scrollTop).toBe(0);
    expect(screen.getByRole('button', { name: 'Banned player 20 #9020' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Banned player 0 #9000' })).toBeNull();
    fireEvent.change(screen.getByLabelText('页码'), { target: { value: '3' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Banned player 44 #9044' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(filter);
    expect(filter.getAttribute('aria-checked')).toBe('true');
    await screen.findByRole('button', { name: 'Banned player 0 #9000' });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('navigation', { name: '封禁追踪' })).toBeNull();
    filter.focus();
    await userEvent.setup().keyboard(' ');
    expect(filter.getAttribute('aria-checked')).toBe('false');
    await screen.findByText('第 1–20 条，共 45 条');
    fireEvent.change(screen.getByLabelText('页码'), { target: { value: '3' } });
    rows = rows.slice(0, 25);
    fireEvent.click(screen.getByRole('button', { name: '同步' }));
    await screen.findByText('第 21–25 条，共 25 条');
    expect(screen.getByRole('button', { name: 'Banned player 24 #9024' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect((screen.getByLabelText('页码') as HTMLSelectElement).value).toBe('2');
  });

  it('makes archive records beyond 500 reachable and resets pagination when filters change', async () => {
    const rows = Array.from({ length: 525 }, (_, index) => ({
      ...matchFixture({ id: String(1000 + index) }),
      map: `Archive map ${index}`,
      endedAt: 1_700_000_000_000 + index,
      outcome: index % 2 === 0 ? ('win' as const) : ('loss' as const),
      localPlayerId: index % 2 === 0 ? '1' : '2',
    }));
    const native = nativeFixture(structuredClone(fixtureBootstrap), {
      'matches.list': ({ accountId }) =>
        accountId ? rows.filter((m) => m.localPlayerId === accountId) : rows,
      'accounts.list': () =>
        ['1', '2'].map((id) => ({
          id,
          name: 'Shared name',
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
    expect(screen.getByRole('option', { name: 'Shared name · #1' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Shared name · #2' })).toBeTruthy();
    const table = document.querySelector<HTMLDivElement>('.archive-table')!;
    table.scrollTop = 900;
    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(screen.getByText('样本数: 525')).toBeTruthy();
    expect(screen.getByText('第 1–50 条，共 525 条')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect((screen.getByLabelText('页码') as HTMLSelectElement).value).toBe('2');
    expect(screen.getByRole('button', { name: 'Archive map 474' })).toBeTruthy();
    expect(table.scrollTop).toBe(0);
    expect(screen.getByText('第 51–100 条，共 525 条')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('页码'), { target: { value: '11' } });
    expect(screen.getByRole('button', { name: 'Archive map 0' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('第 501–525 条，共 525 条')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect((screen.getByLabelText('页码') as HTMLSelectElement).value).toBe('10');
    table.scrollTop = 500;
    fireEvent.click(screen.getByRole('button', { name: '胜利' }));
    expect(table.scrollTop).toBe(0);
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
    let rows = [matchFixture({ id: '101' })];
    const native = nativeFixture(structuredClone(fixtureBootstrap), {
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
      rows = [...rows, matchFixture({ id: '102' })];
      pending.resolve(null);
      await pending.promise;
    });
    await screen.findByText('样本数: 2');
    expect(native.calls.slice(calls).map((call) => call.method)).toEqual([
      'matches.scan',
      'matches.list',
    ]);
  });

  it('keeps one dialog active while allowing a return from the player to the ban alert', async () => {
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
      'players.report': ({ id }) => ({ ...reportFixture({ id }), name: ban.name }),
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
    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }));
    await screen.findByRole('dialog', { name: translate('zh', 'banAlert') });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('changes language in settings while preserving the listening state and live status indicator', async () => {
    const native = nativeFixture(bootstrapForApp());
    const view = render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('监听中');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    await screen.findByRole('main', { name: '设置' });
    fireEvent.click(screen.getByRole('tab', { name: '常规' }));
    fireEvent.change(screen.getByRole('combobox', { name: '语言' }), { target: { value: 'en' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Settings' })).toBeNull());
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
    const native = nativeFixture(bootstrap, {
      'decks.list': () => ({
        found: false,
        decksDir: '',
        backupsDir: '',
        decks: [],
        backups: [],
      }),
    });
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('监听中');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = await screen.findByRole('main', { name: '设置' });
    fireEvent.click(screen.getByRole('tab', { name: '导航' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '上移 卡组工具' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
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

  it('saves page visibility in both navigation menus and restores pages in their saved order', async () => {
    const bootstrap = bootstrapForApp();
    bootstrap.config.panelOrder = ['current', 'players', 'decks'];
    const native = nativeFixture(bootstrap);
    const user = userEvent.setup();
    const view = render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    await screen.findByRole('main', { name: '设置' });
    fireEvent.click(screen.getByRole('tab', { name: '导航' }));
    const players = screen.getByRole('checkbox', { name: '在导航中显示 玩家查询' });
    players.focus();
    await user.keyboard(' ');
    fireEvent.click(screen.getByRole('checkbox', { name: '在导航中显示 卡组工具' }));
    fireEvent.click(screen.getByRole('button', { name: '上移 卡组工具' }));
    await waitFor(() => {
      expect(native.backend.config.hiddenPanels).toEqual(['players', 'decks']);
      expect(native.backend.config.panelOrder).toEqual(['current', 'decks', 'players']);
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(within(screen.getByRole('navigation')).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    const dialog = within(screen.getByRole('dialog', { name: translate('zh', 'workspaceNav') }));
    const navigation = within(dialog.getByRole('navigation'));
    expect(navigation.queryByRole('button', { name: '玩家查询' })).toBeNull();
    expect(navigation.queryByRole('button', { name: '卡组工具' })).toBeNull();
    expect(navigation.getByRole('button', { name: '总览' })).toBeTruthy();

    view.unmount();
    window.history.replaceState(null, '', '#settings/navigation');
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByRole('main', { name: '设置' });
    const restoredPlayers = screen.getByRole('checkbox', { name: '在导航中显示 玩家查询' });
    expect((restoredPlayers as HTMLInputElement).checked).toBe(false);
    fireEvent.click(restoredPlayers);
    fireEvent.click(screen.getByRole('checkbox', { name: '在导航中显示 卡组工具' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(
      within(screen.getByRole('navigation'))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['总览', '卡组工具', '玩家查询']);
    expect(native.backend.config.hiddenPanels).toEqual([]);
    expect(
      native.calls.filter((call) => call.method === 'config.update').map((call) => call.input),
    ).toContainEqual({ hiddenPanels: ['players'] });
  });

  it('keeps settings available when all navigation pages are hidden', async () => {
    const bootstrap = bootstrapForApp();
    bootstrap.config.hiddenPanels = [...bootstrap.config.panelOrder];
    const native = nativeFixture(bootstrap);
    render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    await screen.findByRole('main', { name: '设置' });
    fireEvent.click(screen.getByRole('tab', { name: '导航' }));
    const toggle = screen.getByRole('checkbox', { name: '在导航中显示 当前房间 / 对局' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(
      within(screen.getByRole('navigation')).getByRole('button', { name: '总览' }),
    ).toBeTruthy();
    expect(native.backend.config.hiddenPanels).toEqual([]);
  });

  it('opens a deep link and preserves scroll positions, search and filters when navigating back', async () => {
    window.history.replaceState(null, '', '#archive');
    const native = nativeFixture();
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: '对局档案' });
    const scroll = screen.getByRole('main').parentElement!;
    fireEvent.scroll(scroll, { target: { scrollTop: 180 } });
    const navigation = screen.getByRole('navigation');
    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    await screen.findByText(
      `样本数: ${capturedMatches.filter((m) => m.outcome === 'loss').length}`,
    );
    fireEvent.click(within(navigation).getByRole('button', { name: '玩家查询' }));
    expect(scroll.scrollTop).toBe(0);
    const search = screen.getByLabelText(translate('zh', 'searchLabel'));
    fireEvent.change(search, { target: { value: localPlayer.name } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const resultName = (name: string) => name.startsWith(`${localPlayer.name} #${localPlayer.id}`);
    await screen.findByRole('button', { name: resultName });
    fireEvent.scroll(scroll, { target: { scrollTop: 90 } });
    act(() => {
      window.location.hash = 'archive';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('button', { name: '失败' }).getAttribute('aria-pressed')).toBe('true');
    expect(scroll.scrollTop).toBe(180);
    expect(document.activeElement).toBe(screen.getByRole('main'));
    fireEvent.click(within(navigation).getByRole('button', { name: '玩家查询' }));
    expect(scroll.scrollTop).toBe(90);
    expect((screen.getByLabelText(translate('zh', 'searchLabel')) as HTMLInputElement).value).toBe(
      localPlayer.name,
    );
    expect(screen.getByRole('button', { name: resultName })).toBeTruthy();
    expect(window.location.hash).toBe('#players');
  });

  it('keeps ban tracking out of overview even for legacy visibility preferences and available on its own page', async () => {
    const initial = bootstrapForApp();
    initial.config.panelOrder = ['current', 'bans'];
    initial.config.banCardVisible = true;
    const list = vi.fn(() => [bannedPlayer()]);
    const native = nativeFixture(initial, { 'bans.list': list });
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('监听中');
    expect(screen.queryByRole('group', { name: '封禁追踪' })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    const nav = within(screen.getByRole('navigation'));
    fireEvent.click(nav.getByRole('button', { name: '封禁追踪' }));
    expect(screen.getByRole('heading', { level: 1, name: '封禁追踪' })).toBeTruthy();
    await screen.findByRole('button', { name: /Banned Arrow/ });
    expect(list).toHaveBeenCalledTimes(1);
    fireEvent.click(nav.getByRole('button', { name: '总览' }));
    expect(screen.queryByRole('group', { name: '封禁追踪' })).toBeNull();
  });

  it('copies room analysis into radar and preserves the view independently on both pages', async () => {
    const bootstrap = bootstrapForApp();
    bootstrap.config.panelOrder = ['current', 'radar'];
    const query = vi.fn((input: RpcInputs['session.query']) => ({
      requestId: input.requestId,
      queried: 0,
      skipped: 0,
      cancelled: false,
    }));
    const native = nativeFixture(bootstrap, { 'session.query': query });
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('监听中');
    expect(screen.getByRole('button', { name: '刷新粗查' })).toBeTruthy();
    const overviewPrevious = screen.getByRole('button', { name: '上一局' });
    await waitFor(() => expect(overviewPrevious.hasAttribute('disabled')).toBe(false));
    fireEvent.click(overviewPrevious);
    await screen.findByRole('button', { name: '返回当前局' });
    const nav = within(screen.getByRole('navigation'));
    fireEvent.click(nav.getByRole('button', { name: '蛐雷达' }));
    expect(location.hash).toBe('#radar');
    expect(screen.getByRole('heading', { level: 1, name: '蛐雷达' })).toBeTruthy();
    const previous = await screen.findByRole('button', { name: '上一局' });
    await waitFor(() => expect(previous.hasAttribute('disabled')).toBe(false));
    fireEvent.click(previous);
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ context: 'previous' })),
    );
    const restore = await screen.findByRole('button', { name: '返回当前局' });
    await waitFor(() => expect(restore.hasAttribute('disabled')).toBe(false));
    fireEvent.click(nav.getByRole('button', { name: '总览' }));
    expect(screen.getByRole('button', { name: '刷新粗查' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回当前局' })).toBeTruthy();
    fireEvent.click(nav.getByRole('button', { name: '蛐雷达' }));
    fireEvent.click(screen.getByRole('button', { name: '返回当前局' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新粗查' }));
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ context: 'current' })),
    );
  });

  it('opens radar directly from its URL', async () => {
    history.replaceState(null, '', '#radar');
    const native = nativeFixture(bootstrapForApp());
    render(<App />, { wrapper: wrapper(native.api) });
    expect(await screen.findByRole('heading', { level: 1, name: '蛐雷达' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新粗查' })).toBeTruthy();
  });

  it('summarizes eligible completed matches for the current account', async () => {
    const win = structuredClone(capturedMatches.find((m) => m.outcome === 'win')!);
    const loss = structuredClone(capturedMatches.find((m) => m.outcome === 'loss')!);
    const restarted = matchFixture({ id: 'restarted', restarted: true });
    const otherAccount = matchFixture({ id: 'other-account', localPlayerId: secondPlayer.id });
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
    expect(within(rating).getByText(formatMetric(win.eloAfter, 0))).toBeTruthy();
    const archive = screen.getByText('已收录对局').closest('.metric-card') as HTMLElement;
    expect(within(archive).getByText('4')).toBeTruthy();
  });

  it('safely disables an empty lobby and releases refresh after a fulfilled zero-row query', async () => {
    const bootstrap = structuredClone(fixtureBootstrap);
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
          lobbyPlayers: [{ id: localPlayer.id, name: localPlayer.name, teamId: null }],
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
    const native = nativeFixture(structuredClone(fixtureBootstrap), {
      'players.search': () => ({
        source: 'network',
        players: [
          { ...localPlayer, name: 'First Player' },
          { ...secondPlayer, name: 'Second Player' },
        ],
      }),
      'players.report': ({ id }) => ({
        ...reportFixture({ id }),
        name: id === localPlayer.id ? 'First Player' : 'Second Player',
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
    await screen.findByRole('heading', { name: `Second Player #${secondPlayer.id}` });
    const newButton = screen.getByRole('button', { name: '查蛆指数' });
    expect(newButton).not.toBe(firstButton);
    expect(newButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(newButton);
    expect(maggotCalls).toBe(1);
    const result = summarizeMaggot(
      localPlayer.id,
      Array.from({ length: 12 }, (_, i) => ({
        matchId: capturedMatches[i]!.id,
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
    const bootstrap = structuredClone(fixtureBootstrap);
    bootstrap.config.replayEnabled = true;
    const active: RecordingState = {
      ...bootstrap.recording,
      phase: 'recording',
      sessionId: 'recording-1',
      fid: capturedMatches[0]!.fid,
      map: capturedMatches[0]!.map,
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
    const idle: RecordingState = { ...fixtureBootstrap.recording };
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
      id: localPlayer.id,
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
        ...reportFixture({ id }),
        elo: force ? 2002 : 1001,
        sampleCount: 12,
      }),
    });
    render(<ProfileDialog id={localPlayer.id} name="Player" />, { wrapper: wrapper(native.api) });
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

describe('UX failure recovery', () => {
  it('discards a failed sidebar preference and provides an exit after a settings save failure', async () => {
    const initial = bootstrapForApp();
    const native = nativeFixture(initial, {
      'config.update': () => {
        throw new Error('Preferences are read-only');
      },
    });
    render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Preferences are read-only');
    fireEvent.click(within(alert).getByRole('button', { name: '放弃未保存的更改' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const page = within(await screen.findByRole('main', { name: '设置' }));
    fireEvent.click(page.getByRole('button', { name: '森林 · 深色' }));
    await page.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    const prompt = within(await screen.findByRole('dialog', { name: '更改尚未保存' }));
    fireEvent.click(prompt.getByRole('button', { name: '放弃未保存的更改' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe(initial.config.theme));
    const writes = native.calls.filter((call) => call.method === 'config.update').length;
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    await screen.findByRole('main', { name: '设置' });
    expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(writes);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears a connection error on retry and blocks duplicate checks while waiting', async () => {
    history.replaceState(null, '', '#settings/connection');
    const pending = deferred<RpcOutputs['api.health']>();
    let attempts = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'api.health': () => {
        if (++attempts === 1) throw new Error('Connection timed out');
        return pending.promise;
      },
    });
    render(<App />, { wrapper: wrapper(native.api) });
    const check = await screen.findByRole('button', { name: '检查连接' });
    fireEvent.click(check);
    await screen.findByText('Error: Connection timed out');
    fireEvent.click(check);
    fireEvent.click(check);
    expect(attempts).toBe(2);
    expect(check.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Error: Connection timed out')).toBeNull();
    await act(async () => pending.resolve(fixtureBootstrap.health));
    await waitFor(() => expect(check.hasAttribute('disabled')).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('invalidates the previous selection and its late report when a new search is submitted', async () => {
    const pending = deferred<RpcOutputs['players.report']>();
    let reports = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'players.search': ({ query }) => ({
        source: 'network',
        players: query === 'first' ? [localPlayer] : [],
      }),
      'players.report': () =>
        ++reports === 1
          ? { ...reportFixture({ id: localPlayer.id }), name: 'Previous selection' }
          : pending.promise,
    });
    render(<PlayersPanel />, { wrapper: wrapper(native.api) });
    const search = await screen.findByLabelText(translate('zh', 'searchLabel'));
    fireEvent.change(search, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const result = await screen.findByRole('button', { name: new RegExp('^' + localPlayer.name) });
    fireEvent.click(result);
    await screen.findByRole('heading', { name: /^Previous selection/ });
    fireEvent.click(result);
    fireEvent.change(search, { target: { value: 'missing' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByText('没有找到匹配的玩家');
    await act(async () =>
      pending.resolve({ ...reportFixture({ id: localPlayer.id }), name: 'Late selection' }),
    );
    expect(screen.queryByRole('heading', { name: /Previous selection|Late selection/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '查蛆指数' })).toBeNull();
  });

  it('keeps profile content in place while its two refresh requests finish separately', async () => {
    const nextProfile = deferred<PlayerProfile>();
    const nextReport = deferred<RpcOutputs['players.report']>();
    const profile: PlayerProfile = {
      id: localPlayer.id,
      name: 'Profile owner',
      names: [],
      firstSeen: null,
      lastSeen: null,
      encounters: [],
      banned: null,
      recentMatches: [],
      recentError: null,
      latestElo: 1500,
      info: {
        elo: 1500,
        kd: 2,
        winRate: 50,
        matchCount: 100,
        sampleCount: 100,
        category: null,
        topUnits: '',
        updatedAt: Date.now(),
        stale: false,
      },
    };
    const native = nativeFixture(bootstrapForApp(), {
      'players.profile': ({ force }) => (force ? nextProfile.promise : profile),
      'players.report': ({ force }) => (force ? nextReport.promise : reportFixture({ elo: 1501 })),
    });
    render(<ProfileDialog id={localPlayer.id} name="Profile owner" />, {
      wrapper: wrapper(native.api),
    });
    const report = await screen.findByText('1,501');
    const columns = document.querySelector('.profile-columns');
    const refresh = screen.getByRole('button', { name: '刷新' });
    fireEvent.click(refresh);
    expect(report.isConnected).toBe(true);
    expect(document.querySelector('.profile-columns')).toBe(columns);
    expect(screen.queryByText('加载中…')).toBeNull();
    await act(async () => nextProfile.resolve({ ...profile, latestElo: 1600 }));
    expect(document.querySelector('.profile-columns')).toBe(columns);
    expect(screen.getAllByText('最近一场 K/D')).toHaveLength(1);
    expect(refresh.hasAttribute('disabled')).toBe(true);
    await act(async () => nextReport.resolve(reportFixture({ elo: 1601 })));
    await screen.findByText('1,601');
    expect(refresh.hasAttribute('disabled')).toBe(false);
  });

  it('retries failed playback in place and exposes the selected playback speed', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    let attempts = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'replays.play': () => {
        if (++attempts === 1) throw new Error('Replay temporarily unavailable');
        return { url: 'ba-replay://test/clip.webm' };
      },
    });
    const view = render(<ReplayDialog id="clip.webm" title="Replay" />, {
      wrapper: wrapper(native.api),
    });
    try {
      await screen.findByText('Replay temporarily unavailable');
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
      await waitFor(() =>
        expect(view.container.ownerDocument.querySelector('video')).not.toBeNull(),
      );
      const speed = screen.getByRole('button', { name: '3×' });
      fireEvent.click(speed);
      expect(speed.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: '1×' }).getAttribute('aria-pressed')).toBe('false');
      const video = document.querySelector('video')!;
      expect(video.playbackRate).toBe(3);
      fireEvent.error(video);
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
      await waitFor(() => expect(attempts).toBe(3));
      fireEvent.loadedMetadata(document.querySelector('video')!);
      expect(document.querySelector('video')!.playbackRate).toBe(3);
    } finally {
      view.unmount();
      pause.mockRestore();
      load.mockRestore();
    }
  });

  it('waits for a slow display thumbnail before polling again', async () => {
    vi.useFakeTimers();
    const pending = deferred<string | null>();
    const native = nativeFixture(bootstrapForApp(), {
      'displays.thumbnail': () => pending.promise,
    });
    try {
      await act(async () => {
        render(<RecordingSettings />, { wrapper: wrapper(native.api) });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(native.calls.filter((call) => call.method === 'displays.thumbnail')).toHaveLength(1);
      await act(async () => pending.resolve('data:image/png;base64,preview'));
      expect(screen.getByAltText('显示器').getAttribute('src')).toBe(
        'data:image/png;base64,preview',
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(native.calls.filter((call) => call.method === 'displays.thumbnail')).toHaveLength(2);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
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
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
