// @vitest-environment jsdom
import { StrictMode, useState, type ReactNode } from 'react';
import { EventEmitter } from 'node:events';
import { UpdateController, type UpdateEngine } from '../apps/desktop/src/updates/controller';
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
  Account,
  AppEvent,
  Ban,
  Bootstrap,
  Bridge,
  Match,
  PlayerProfile,
  RecordingState,
  RpcInputs,
  RpcMethod,
  RpcOutputs,
  Replay,
  HistoryDeletePlan,
  HistoryDeleteResult,
  ReplayMoveResult,
  DisplayPreview,
} from '@ba/contracts';
import { BATRACE_ORIGIN, configSchema } from '@ba/contracts';
import {
  currentRosterKey,
  previousRosterKey,
  formatMetric,
  formatDuration,
  formatTime,
  matchTitles,
  summarizeMaggot,
} from '@ba/shared';
import { App } from '../apps/web/src/app/App';
import { AppProvider, useApp } from '../apps/web/src/app/state';
import {
  capturedAccounts,
  capturedMatches,
  capturedPlayers,
  capturedReports,
  capturedProfiles,
  fixtureBootstrap,
  matchFixture,
  reportFixture,
} from './fixtures/ui';
import { useRequest } from '../apps/web/src/hooks/useRequest';
import { useSettingsAutosave } from '../apps/web/src/hooks/useSettingsAutosave';
import { translate } from '../apps/web/src/hooks/useI18n';
import { SessionPanel } from '../apps/web/src/features/session/SessionPanel';
import { PlayersPanel } from '../apps/web/src/features/players/PlayersPanel';
import { ProfileDialog } from '../apps/web/src/features/players/ProfileDialog';
import {
  ReportCopyButton,
  ReportMatchTable,
  ReportView,
} from '../apps/web/src/features/players/Reports';
import { PlayerActions } from '../apps/web/src/features/players/PlayerActions';
import { TooltipButton } from '../apps/web/src/components/Tooltip';
import { PlayerReportStatus } from '../apps/web/src/features/players/PlayerReportStatus';
import { ProfileRecords } from '../apps/web/src/features/players/ProfileRecords';
import { CacheSettings } from '../apps/web/src/features/settings/CacheSettings';
import { AppearanceSettings } from '../apps/web/src/features/settings/AppearanceSettings';
import { ReplayDialog } from '../apps/web/src/features/replays/ReplayDialog';
import { RecordingSettings } from '../apps/web/src/features/replays/RecordingSettings';
import { ReplaysPanel } from '../apps/web/src/features/replays/ReplaysPanel';
import {
  RecordingAudioFeedback,
  RecordingAudioSummary,
} from '../apps/web/src/features/replays/RecordingAudioFeedback';
import { DecksPanel } from '../apps/web/src/features/decks/DecksPanel';
import { SidebarProvider } from '../apps/web/src/components/ui/sidebar';
import { Button, Dialog } from '../apps/web/src/components/ui';
import { BatraceStatus } from '../apps/web/src/components/BatraceStatus';
import { UpdatePanel } from '../apps/web/src/features/settings/UpdatePanel';
import { UpdateButton } from '../apps/web/src/features/settings/UpdateButton';
import { MatchArchive } from '../apps/web/src/features/matches/MatchArchive';
import { MatchArchiveCard } from '../apps/web/src/features/matches/MatchArchiveCard';
import { ProfileOverview } from '../apps/web/src/features/players/ProfileOverview';
import { BansPanel } from '../apps/web/src/features/bans/BansPanel';
import { Loading } from '../apps/web/src/components/ui';
import { Spinner } from '../apps/web/src/components/ui/spinner';
import { LocaleContext } from '../apps/web/src/hooks/useI18n';
import { MatchDialog } from '../apps/web/src/features/matches/MatchDialog';
import { Dashboard } from '../apps/web/src/features/overview/Dashboard';
import { DevelopmentApp } from '../apps/web/src/dev/DevelopmentApp';
import { StartupBridgeError } from '../apps/web/src/components/StartupBridgeError';
import { useConfirmation } from '../apps/web/src/components/Confirmation';

type Handler<K extends RpcMethod> = (input: RpcInputs[K]) => RpcOutputs[K] | Promise<RpcOutputs[K]>;
type Handlers = { [K in RpcMethod]: Handler<K> };
interface Call {
  method: RpcMethod;
  input: RpcInputs[RpcMethod];
}
const localPlayer = capturedPlayers.find((p) => p.id === fixtureBootstrap.session.localPlayerId)!;
const secondPlayer = capturedPlayers.find((p) => p.id !== localPlayer.id)!;
const rosterActionName = (player: { name: string; id: string }) => (name: string) =>
  name.startsWith(`${player.name} · #${player.id} · `);
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

async function reviewSettingsFailure(lang: 'zh' | 'en' = 'zh') {
  fireEvent.click(
    await screen.findByRole('button', {
      name: translate(lang, 'settingsSaveReview', {
        status: translate(lang, 'settingsSaveFailed'),
      }),
    }),
  );
  return within(
    await screen.findByRole('dialog', { name: translate(lang, 'settingsSaveDetails') }),
  );
}

/** Uses captured game data and explicitly controlled native events and RPC responses. */
function nativeFixture(
  initial = structuredClone(fixtureBootstrap),
  overrides: Partial<Handlers> = {},
) {
  const backend = structuredClone(initial);
  const defaults: Partial<Handlers> = {
    'matches.planDelete': async ({ id }) => {
      const matches = await (overrides['matches.list'] ?? defaults['matches.list']!)({});
      const match = matches.find((match) => match.id === id)!;
      return {
        token: '11111111-1111-4111-8111-111111111111',
        kind: 'match',
        target: { id, name: match.map },
        removed: [{ id, fid: match.fid, map: match.map, at: match.endedAt, accounts: [] }],
        retained: [],
        affectedAccounts: [],
        backupDirectory: 'test-profile/HistoryBackups',
        backupName: 'match-backup.json',
      };
    },
    'matches.list': ({ accountId }) =>
      structuredClone(capturedMatches.filter((m) => !accountId || m.localPlayerId === accountId)),
    'matches.detail': ({ fid }) => {
      const match = capturedMatches.find((match) => match.fid === fid);
      if (!match) throw new Error('No recorded match fixture for ' + fid);
      return structuredClone(match);
    },
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
    'players.report': ({ id }) => {
      const report = capturedReports[id];
      if (!report) throw new Error('No recorded player report for ' + id);
      return structuredClone(report);
    },
    'players.profile': ({ id }) => {
      const profile = capturedProfiles[id];
      if (!profile) throw new Error('No recorded player profile for ' + id);
      return structuredClone(profile);
    },
    'players.maggot': ({ id }) => summarizeMaggot(id, []),
    'bans.list': () => [],
    'logs.refresh': () => {
      emit({
        type: 'watcher',
        watcher: { ...backend.watcher, checkedAt: Date.now() },
        revision: backend.revision + 1,
      });
      return backend.watcher;
    },
    'bans.acknowledgeAlerts': ({ ids }) => {
      emit({
        type: 'banAlerts',
        alerts: backend.banAlerts.filter((alert) => !ids.includes(alert.id)),
        revision: backend.revision + 1,
      });
      return null;
    },
    'decks.list': () => ({
      found: false,
      decksDir: 'test-profile/Decks',
      backupsDir: '',
      decks: [],
      backups: [],
    }),
    'replays.list': () => ({ directory: 'test-profile/recordings', recordings: [] }),
    'replays.release': () => null,
    'replays.directory': () => ({ dir: 'test-profile/recordings', count: 0 }),
    'displays.list': () => [],
    'displays.preview': async ({ id }) => {
      const available = await (overrides['displays.list'] ?? defaults['displays.list']!)(null);
      const thumbnail = await (overrides['displays.thumbnail'] ?? (() => null))({ id });
      const sources = available.length
        ? available
        : thumbnail
          ? [{ id: id || 'fixture-display', label: 'Fixture display', thumbnail }]
          : [];
      const selected = sources.find((source) => source.id === id),
        source = selected ?? sources[0];
      return {
        requestedId: id,
        sourceId: source?.id ?? null,
        label: source?.label ?? null,
        selection: !source ? 'unavailable' : selected ? 'selected' : id ? 'fallback' : 'automatic',
        thumbnail,
        displays: sources.map((source) => ({
          id: source.id,
          displayId: source.id,
          label: source.label,
        })),
      };
    },
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
        case 'banSync':
          backend.banSync = structuredClone(event.status);
          break;
        case 'bans':
        case 'banAlerts':
          backend.banAlerts = structuredClone(event.alerts);
          break;
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
      if (method === 'config.read') {
        emit({ type: 'config', config: backend.config, revision: backend.revision + 1 });
        return {
          config: structuredClone(backend.config),
          revision: backend.revision,
        } as RpcOutputs[K];
      }
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
    return (
      <AppProvider api={api}>
        <SidebarProvider>{children}</SidebarProvider>
      </AppProvider>
    );
  };
}

function bootstrapForApp(): Bootstrap {
  const bootstrap = structuredClone(fixtureBootstrap);
  bootstrap.config.panelOrder = ['current'];
  return bootstrap;
}
function replayFixture(overrides: Partial<Replay> = {}): Replay {
  return {
    id: 'Alpha.webm',
    fid: null,
    map: 'Dam',
    uploaderId: '1',
    uploaderName: 'Alpha',
    teamId: 0,
    size: 1024,
    createdAt: 1700000000000,
    dateSource: 'recording',
    durationSec: 60,
    test: false,
    ...overrides,
  };
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

describe('remaining accessibility and playback ownership', () => {
  it('releases discarded StrictMode playback without revoking the current video', async () => {
    const discarded = deferred<RpcOutputs['replays.play']>();
    let reads = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'replays.play': () =>
        ++reads === 1 ? discarded.promise : { url: 'ba-replay://current/video.webm' },
    });
    const { unmount } = render(<ReplayDialog id="fixture.webm" title="Fixture" />, {
      wrapper: wrapper(native.api),
      reactStrictMode: true,
    });
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'ba-replay://current/video.webm',
      ),
    );
    await act(async () => discarded.resolve({ url: 'ba-replay://discarded/video.webm' }));
    const releases = () =>
      native.calls
        .filter((call) => call.method === 'replays.release')
        .map((call) => (call.input as RpcInputs['replays.release']).url);
    await waitFor(() => expect(releases()).toEqual(['ba-replay://discarded/video.webm']));
    expect(document.querySelector('video')?.getAttribute('src')).toBe(
      'ba-replay://current/video.webm',
    );
    unmount();
    await waitFor(() =>
      expect(releases()).toEqual([
        'ba-replay://discarded/video.webm',
        'ba-replay://current/video.webm',
      ]),
    );
  });
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    it(`names and focuses missing-bridge guidance with an alert in ${lang}`, () => {
      render(<StartupBridgeError locale={lang} />);
      const main = screen.getByRole('main', { name: text('desktopBridgeUnavailableTitle') });
      expect(document.activeElement).toBe(main);
      expect(
        within(main).getByRole('heading', {
          level: 1,
          name: text('desktopBridgeUnavailableTitle'),
        }),
      ).toBeTruthy();
      expect(within(main).getByRole('alert').textContent).toContain(
        text('desktopBridgeUnavailableHint'),
      );
      expect(document.getElementById(main.getAttribute('aria-describedby')!)?.textContent).toBe(
        text('desktopBridgeUnavailableHint'),
      );
    });
    for (const inline of [true, false]) {
      it(`exposes changing Mbps values in ${inline ? 'inline' : 'dialog'} recording settings in ${lang}`, async () => {
        const bootstrap = bootstrapForApp();
        bootstrap.config.lang = lang;
        bootstrap.config.replayBitrateMbps = 8;
        const native = nativeFixture(bootstrap);
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        const slider = await screen.findByRole('slider', { name: text('bitrate') });
        expect(slider.getAttribute('aria-valuetext')).toBe('8 Mbps');
        slider.focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(slider.getAttribute('aria-valuenow')).toBe('9');
        expect(slider.getAttribute('aria-valuetext')).toBe('9 Mbps');
        await userEvent.keyboard('{ArrowLeft}');
        expect(slider.getAttribute('aria-valuetext')).toBe('8 Mbps');
      });
    }
    for (const phase of ['initial', 'retry'] as const) {
      it(`releases current and late ${phase} playback handles after close in ${lang}`, async () => {
        const pending = deferred<RpcOutputs['replays.play']>();
        let reads = 0;
        const bootstrap = bootstrapForApp();
        bootstrap.config.lang = lang;
        const native = nativeFixture(bootstrap, {
          'replays.play': () =>
            ++reads === 1 && phase === 'retry'
              ? { url: 'ba-replay://first/video.webm' }
              : pending.promise,
        });
        const { unmount } = render(<ReplayDialog id="fixture.webm" title="Fixture" />, {
          wrapper: wrapper(native.api),
        });
        await waitFor(() => expect(reads).toBe(1));
        if (phase === 'retry') {
          const current = await waitFor(() => {
            const node = document.querySelector('video');
            expect(node).not.toBeNull();
            return node!;
          });
          fireEvent.error(current);
          await userEvent.click(await screen.findByRole('button', { name: text('retry') }));
          await waitFor(() => expect(reads).toBe(2));
        }
        unmount();
        await act(async () => pending.resolve({ url: 'ba-replay://late/video.webm' }));
        const releases = () =>
          native.calls
            .filter((call) => call.method === 'replays.release')
            .map((call) => (call.input as RpcInputs['replays.release']).url);
        await waitFor(() => expect(releases()).toContain('ba-replay://late/video.webm'));
        expect(releases()).toEqual(
          phase === 'retry'
            ? ['ba-replay://first/video.webm', 'ba-replay://late/video.webm']
            : ['ba-replay://late/video.webm'],
        );
        expect(document.querySelector('video')).toBeNull();
      });
    }
    for (const outcome of ['success', 'failure'] as const) {
      it(`retains playback state and ${outcome === 'success' ? 'replaces' : 'retains'} its lease on ${outcome}ful retry in ${lang}`, async () => {
        const pending = deferred<RpcOutputs['replays.play']>();
        let reads = 0;
        const bootstrap = bootstrapForApp();
        bootstrap.config.lang = lang;
        const native = nativeFixture(bootstrap, {
          'replays.play': () =>
            ++reads === 1 ? { url: 'ba-replay://first/video.webm' } : pending.promise,
        });
        const { unmount } = render(<ReplayDialog id="fixture.webm" title="Fixture" />, {
          wrapper: wrapper(native.api),
        });
        const old = await waitFor(() => {
          const node = document.querySelector('video');
          expect(node).not.toBeNull();
          return node!;
        });
        fireEvent.loadedMetadata(old);
        fireEvent.click(screen.getByRole('radio', { name: '2×' }));
        old.currentTime = 42;
        fireEvent.timeUpdate(old);
        fireEvent.pause(old);
        fireEvent.error(old);
        await userEvent.click(await screen.findByRole('button', { name: text('retry') }));
        expect(native.calls.filter((call) => call.method === 'replays.release')).toHaveLength(0);
        await act(async () =>
          outcome === 'success'
            ? pending.resolve({ url: 'ba-replay://second/video.webm' })
            : pending.reject(new Error('Controlled retry failure')),
        );
        const releases = () =>
          native.calls
            .filter((call) => call.method === 'replays.release')
            .map((call) => (call.input as RpcInputs['replays.release']).url);
        if (outcome === 'success') {
          await waitFor(() => expect(releases()).toEqual(['ba-replay://first/video.webm']));
          const current = document.querySelector('video')!;
          expect(current).not.toBe(old);
          fireEvent.loadedMetadata(current);
          expect(current.currentTime).toBe(42);
          expect(current.playbackRate).toBe(2);
          expect(current.autoplay).toBe(false);
          fireEvent.error(old);
          expect(screen.queryByText(text('error'))).toBeNull();
        } else {
          await screen.findByText('Controlled retry failure');
          expect(document.querySelector('video')).toBe(old);
          expect(releases()).toEqual([]);
        }
        unmount();
        await waitFor(() =>
          expect(releases()).toEqual(
            outcome === 'success'
              ? ['ba-replay://first/video.webm', 'ba-replay://second/video.webm']
              : ['ba-replay://first/video.webm'],
          ),
        );
      });
    }
    it(`localizes exhausted playback capacity without creating a video in ${lang}`, async () => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = lang;
      const native = nativeFixture(bootstrap, {
        'replays.play': () => {
          throw new Error('REPLAY_PLAYBACK_LIMIT');
        },
      });
      render(<ReplayDialog id="fixture.webm" title="Fixture" />, { wrapper: wrapper(native.api) });
      await screen.findByText(text('replayPlaybackLimit'));
      expect(screen.getByRole('button', { name: text('retry') })).toBeTruthy();
      expect(document.querySelector('video')).toBeNull();
    });
  }
});

describe('control discovery and recovery', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, values?: Record<string, string | number>) =>
      translate(lang, key, values);
    for (const input of ['pointer', 'keyboard'] as const) {
      it(`discloses complete deck and backup identities before selection with ${input} in ${lang}`, async () => {
        const base = 'Shared-prefix-'.repeat(9);
        const decks = [base + 'ALPHA.dek', base + 'BRAVO.dek'];
        const backups = [base + 'ALPHA.zip', base + 'BRAVO.zip'];
        const bootstrap = bootstrapForApp();
        bootstrap.config.lang = lang;
        const native = nativeFixture(bootstrap, {
          'decks.list': () => ({
            found: true,
            decksDir: 'Decks',
            backupsDir: 'Backups',
            decks: decks.map((name) => ({ name, size: 10, modifiedAt: 1 })),
            backups: backups.map((name) => ({ name, size: 10, modifiedAt: 1 })),
          }),
          'decks.planRestore': ({ name }) => ({
            token: 'reviewed',
            directory: 'Decks',
            name,
            files: ['Restored.dek'],
            replacements: [],
            newFiles: ['Restored.dek'],
            currentDeckCount: 2,
          }),
        });
        const user = userEvent.setup();
        render(<DecksPanel />, { wrapper: wrapper(native.api) });
        await screen.findByRole('checkbox', { name: decks[0] });
        for (const name of [...decks, ...backups]) {
          const trigger = screen.getByRole('button', { name: text('viewFileName', { name }) });
          if (input === 'pointer') await user.click(trigger);
          else {
            trigger.focus();
            await user.keyboard(' ');
          }
          const detail = await screen.findByRole('dialog', {
            name: text('viewFileName', { name }),
          });
          const reading = within(detail).getByText(name);
          await waitFor(() => expect(document.activeElement).toBe(reading));
          expect(screen.getByRole('checkbox', { name }).getAttribute('aria-checked')).toBe('false');
          await user.keyboard('{Escape}');
          await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
          expect(document.activeElement).toBe(trigger);
        }
        await user.click(screen.getByRole('checkbox', { name: decks[0] }));
        await user.click(screen.getByRole('button', { name: text('backupSelected') }));
        const backup = screen.getByRole('dialog');
        expect(backup.textContent).toContain(decks[0]);
        expect(backup.textContent).not.toContain(decks[1]);
        await user.click(within(backup).getByRole('button', { name: text('cancel') }));
        await user.click(screen.getByRole('checkbox', { name: backups[1] }));
        await user.click(screen.getByRole('button', { name: text('deploy') }));
        const restore = await screen.findByRole('alertdialog');
        expect(restore.textContent).toContain(backups[1]);
        await user.click(within(restore).getByRole('button', { name: text('cancel') }));
        expect(
          native.calls.filter((call) =>
            ['decks.backup', 'decks.deploy', 'decks.delete'].includes(call.method),
          ),
        ).toHaveLength(0);
      });
    }
    for (const action of ['match', 'team', 'report', 'player'] as const) {
      for (const condition of ['missing', 'rejected', 'synchronous', 'success'] as const) {
        it(`reports ${condition} clipboard outcome for ${action} in ${lang}`, async () => {
          const bootstrap = bootstrapForApp();
          bootstrap.config.lang = lang;
          bootstrap.session.current = matchFixture({
            fid: '987654321',
            players: [
              {
                ...matchFixture().players.find((player) => player.id === localPlayer.id)!,
                teamId: 0,
              },
            ],
          });
          const native = nativeFixture(bootstrap);
          const report = reportFixture();
          const user = userEvent.setup();
          const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
          const writeText = vi.fn<(text: string) => Promise<void>>(() => {
            if (condition === 'synchronous') throw new Error('Clipboard denied');
            return condition === 'rejected'
              ? Promise.reject(new Error('Clipboard denied'))
              : Promise.resolve();
          });
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: condition === 'missing' ? undefined : { writeText },
          });
          try {
            render(
              action === 'report' ? (
                <ReportCopyButton report={report} />
              ) : action === 'player' ? (
                <PlayerActions player={{ ...localPlayer, teamId: 0 }} />
              ) : (
                <SessionPanel standalone />
              ),
              { wrapper: wrapper(native.api) },
            );
            const label =
              action === 'match'
                ? `${text('copy')} ${text('matchId')}: 987654321`
                : action === 'team'
                  ? text('copy') + ' Alpha'
                  : text('copy');
            if (action === 'player')
              await user.click(
                await screen.findByRole('button', {
                  name: `${text('actions')}: ${localPlayer.name} #${localPlayer.id}`,
                }),
              );
            const target = await screen.findByRole(action === 'player' ? 'menuitem' : 'button', {
              name: label,
            });
            await act(async () => {
              await new Promise((resolve) => setTimeout(resolve, 0));
            });
            const before = new Set(document.querySelectorAll('[data-sonner-toast]'));
            await user.click(target);
            const fresh = () =>
              [...document.querySelectorAll('[data-sonner-toast]')].filter(
                (node) => !before.has(node),
              );
            await waitFor(() => expect(fresh()).toHaveLength(1));
            expect(fresh()[0]!.getAttribute('data-type')).toBe(
              condition === 'success' ? 'success' : 'error',
            );
            expect(fresh()[0]!.textContent).toContain(
              condition === 'success'
                ? text('copied')
                : condition === 'missing'
                  ? text('clipboardUnavailable')
                  : text('clipboardWriteFailed', { error: 'Clipboard denied' }),
            );
            if (condition === 'missing') expect(writeText).not.toHaveBeenCalled();
            else {
              expect(writeText).toHaveBeenCalledTimes(1);
              expect(writeText.mock.calls[0]![0]).toContain(
                action === 'match'
                  ? '987654321'
                  : action === 'report'
                    ? report.name
                    : localPlayer.name,
              );
            }
            const notification = fresh()[0]!;
            await user.click(
              notification.querySelector<HTMLButtonElement>('button[data-close-button]')!,
            );
            await waitFor(() => expect(notification.isConnected).toBe(false));
          } finally {
            if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
            else Reflect.deleteProperty(navigator, 'clipboard');
          }
        });
      }
    }
    it(`skips the generic disabled tooltip wrapper and retains its description in ${lang}`, async () => {
      const action = vi.fn();
      const user = userEvent.setup();
      const label = text('refresh');
      const detail = text('loading');
      const { rerender } = render(
        <>
          <button>Before</button>
          <TooltipButton
            disabled
            aria-busy="true"
            aria-label={label}
            tooltip={detail}
            onClick={action}
          >
            Icon
          </TooltipButton>
          <button>After</button>
        </>,
      );
      const button = screen.getByRole('button', { name: label });
      const shell = button.parentElement!;
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(shell.tabIndex).toBe(-1);
      expect(shell.hasAttribute('aria-label')).toBe(false);
      expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
        detail,
      );
      screen.getByRole('button', { name: 'Before' }).focus();
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
      await user.click(button);
      expect(action).not.toHaveBeenCalled();
      rerender(
        <>
          <button>Before</button>
          <TooltipButton disabled={false} aria-label={label} tooltip={detail} onClick={action}>
            Icon
          </TooltipButton>
          <button>After</button>
        </>,
      );
      screen.getByRole('button', { name: 'Before' }).focus();
      await user.tab();
      expect(document.activeElement).toBe(button);
      await user.keyboard(' ');
      expect(action).toHaveBeenCalledTimes(1);
    });
  }
});

describe('account perspective and dialog return synchronization', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, values?: Record<string, string | number>) =>
      translate(lang, key, values);
    const a = localPlayer.id,
      b = secondPlayer.id;
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.multiAccountBond = false;
      value.session.localPlayerId = a;
      value.session.localName = 'Alpha';
      return value;
    };
    function Launcher() {
      const { openModal } = useApp();
      return (
        <button onClick={() => openModal({ type: 'profile', id: b, name: 'Target' })}>
          Open scoped profile
        </button>
      );
    }
    const scopedProfile = (accountId: string, count = 1): PlayerProfile => ({
      ...structuredClone(capturedProfiles[b]!),
      encounters: Array.from({ length: count }, (_, index) => ({
        matchId: String(77001 + index),
        at: 1700000000000 + index,
        map: `Perspective ${accountId} ${index}`,
        accountId,
        accountName: accountId === a ? 'Alpha' : 'Bravo',
        relation: accountId === a ? 'same' : 'opponent',
        won: accountId === a,
        custom: false,
      })),
    });
    const switchAccount = (native: ReturnType<typeof nativeFixture>, accountId: string | null) =>
      act(() =>
        native.emit({
          type: 'session',
          revision: native.backend.revision + 1,
          session: {
            ...native.backend.session,
            localPlayerId: accountId,
            localName: accountId === a ? 'Alpha' : 'Bravo',
          },
        }),
      );

    it(`keeps overview metrics and recent rows in one explicit account, including unknown identity in ${lang}`, async () => {
      const next = deferred<RpcOutputs['matches.list']>();
      const alpha = matchFixture({
        localPlayerId: a,
        localPersona: 'Alpha',
        outcome: 'win',
        eloBefore: 1000,
        eloAfter: 1020,
        map: 'Alpha only',
      });
      const bravo = matchFixture({
        localPlayerId: b,
        localPersona: 'Bravo',
        outcome: 'loss',
        eloBefore: 1400,
        eloAfter: 1380,
        map: 'Bravo only',
      });
      const native = nativeFixture(initial(), {
        'matches.list': ({ accountId }) =>
          accountId === a ? [alpha] : accountId === b ? next.promise : [bravo],
      });
      await act(async () => {
        render(<Dashboard />, { wrapper: wrapper(native.api) });
      });
      await screen.findByRole('button', { name: /Alpha only/ });
      expect(screen.getByText('100%')).toBeTruthy();
      switchAccount(native, b);
      expect(screen.queryByRole('button', { name: /Alpha only/ })).toBeNull();
      expect(screen.queryByText('100%')).toBeNull();
      await act(async () => next.resolve([bravo]));
      await screen.findByRole('button', { name: /Bravo only/ });
      expect(screen.getByText('0%')).toBeTruthy();
      expect(screen.getByText('1,380')).toBeTruthy();
      switchAccount(native, null);
      expect(screen.queryByRole('button', { name: /Bravo only/ })).toBeNull();
      expect(screen.getAllByText(text('accountIdentityNeeded')).length).toBeGreaterThan(0);
    });

    it(`rejects late encounter responses after account and association changes in ${lang}`, async () => {
      const late = deferred<PlayerProfile>();
      const native = nativeFixture(initial(), {
        'players.profile': ({ accountId, combined }) =>
          combined
            ? {
                ...scopedProfile(a),
                encounters: [...scopedProfile(a).encounters, ...scopedProfile(b).encounters],
              }
            : accountId === b
              ? late.promise
              : scopedProfile(a),
      });
      render(<ProfileDialog id={b} name="Target" />, { wrapper: wrapper(native.api) });
      const encounters = await screen.findByRole('tab', { name: new RegExp(text('encounters')) });
      await userEvent.click(encounters);
      await screen.findByRole('button', { name: `Perspective ${a} 0 #77001` });
      switchAccount(native, b);
      expect(screen.queryByRole('button', { name: `Perspective ${a} 0 #77001` })).toBeNull();
      await waitFor(() =>
        expect(
          native.calls.some(
            (call) =>
              call.method === 'players.profile' &&
              (call.input as RpcInputs['players.profile']).accountId === b,
          ),
        ).toBe(true),
      );
      switchAccount(native, a);
      await screen.findByRole('button', { name: `Perspective ${a} 0 #77001` });
      await act(async () => late.resolve(scopedProfile(b)));
      expect(screen.queryByRole('button', { name: `Perspective ${b} 0 #77001` })).toBeNull();
      act(() =>
        native.emit({
          type: 'config',
          revision: native.backend.revision + 1,
          config: { ...native.backend.config, multiAccountBond: true },
        }),
      );
      await screen.findByRole('button', { name: `Perspective ${b} 0 #77001` });
      expect(screen.getByText(text('combinedEncounterScope'))).toBeTruthy();
      expect(screen.getByText(text('accountScope', { name: 'Alpha', id: a }))).toBeTruthy();
      expect(screen.getByText(text('accountScope', { name: 'Bravo', id: b }))).toBeTruthy();
    });

    it(`keeps match selection through refresh and hides a previous account while switching in ${lang}`, async () => {
      const pending = deferred<RpcOutputs['matches.detail']>();
      const native = nativeFixture(initial(), {
        'accounts.list': () => [
          capturedAccounts[0]!,
          { ...capturedAccounts[0]!, id: b, name: 'Bravo' },
        ],
        'matches.detail': ({ accountId }) =>
          accountId === b
            ? pending.promise
            : matchFixture({
                map: 'Alpha view',
                localPlayerId: a,
                localPersona: 'Alpha',
                outcome: 'win',
              }),
      });
      render(<MatchDialog fid="77001" accountId={a} />, { wrapper: wrapper(native.api) });
      await screen.findByRole('heading', { name: 'Alpha view' });
      fireEvent.click(screen.getByRole('button', { name: text('refresh') }));
      await waitFor(() =>
        expect(native.calls).toContainEqual({
          method: 'matches.detail',
          input: { fid: '77001', force: true, accountId: a },
        }),
      );
      fireEvent.change(screen.getByRole('combobox', { name: text('matchPerspective') }), {
        target: { value: b },
      });
      expect(screen.queryByRole('heading', { name: 'Alpha view' })).toBeNull();
      await act(async () =>
        pending.resolve(
          matchFixture({
            map: 'Bravo view',
            localPlayerId: b,
            localPersona: 'Bravo',
            outcome: 'loss',
          }),
        ),
      );
      await screen.findByRole('heading', { name: 'Bravo view' });
    });

    it(`uses committed account snapshots instead of a late account-list response in ${lang}`, async () => {
      history.replaceState(null, '', '#settings/accounts');
      const pending = deferred<RpcOutputs['accounts.list']>();
      const native = nativeFixture(initial(), { 'accounts.list': () => pending.promise });
      render(<App />, { wrapper: wrapper(native.api) });
      // Wait for the lazy settings module before publishing the account snapshot.
      await screen.findByRole('heading', { name: text('accounts') }, { timeout: 5000 });
      const account = {
        ...capturedAccounts[0]!,
        id: b,
        name: 'Committed Bravo',
        persona: 'Committed Bravo',
      };
      act(() =>
        native.emit({
          type: 'accounts',
          list: [account],
          activeAccountId: b,
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByText('Committed Bravo');
      await act(async () => pending.resolve([]));
      expect(screen.getByText('Committed Bravo')).toBeTruthy();
      act(() =>
        native.emit({
          type: 'accounts',
          list: [],
          activeAccountId: null,
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByText(text('accountsEmpty'));
      act(() =>
        native.emit({
          type: 'accounts',
          list: [account],
          activeAccountId: b,
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByText('Committed Bravo');
      expect(screen.getByText(text('accountsRediscoveryHint'), { exact: false })).toBeTruthy();
    });

    it(`restores the encounters tab, sixth row, account and scroll after nested match details in ${lang}`, async () => {
      const native = nativeFixture(initial(), {
        'players.profile': () => scopedProfile(a, 8),
        'matches.detail': ({ fid, accountId }) =>
          matchFixture({ id: fid, fid, localPlayerId: accountId || a, map: 'Nested match' }),
      });
      render(
        <>
          <Launcher />
          <App />
        </>,
        { wrapper: wrapper(native.api) },
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Open scoped profile' }));
      await userEvent.click(
        await screen.findByRole('tab', { name: new RegExp(text('encounters')) }),
      );
      const opener = await screen.findByRole('button', { name: `Perspective ${a} 5 #77006` });
      const body = opener.closest('.dialog-body')!;
      body.scrollTop = 135;
      opener.focus();
      fireEvent.click(opener);
      await screen.findByRole('heading', { name: 'Nested match' });
      expect(native.calls).toContainEqual({
        method: 'matches.detail',
        input: { fid: '77006', force: false, accountId: a },
      });
      fireEvent.click(screen.getByRole('button', { name: text('dialogBack') }));
      const returned = await screen.findByRole('button', { name: `Perspective ${a} 5 #77006` });
      await waitFor(() => expect(document.activeElement).toBe(returned));
      expect(
        screen
          .getByRole('tab', { name: new RegExp(text('encounters')) })
          .getAttribute('aria-selected'),
      ).toBe('true');
      expect(returned.closest('.dialog-body')!.scrollTop).toBe(135);
    });
  }
});

describe('list read recovery and account identity', () => {
  const alpha: Account = {
    ...capturedAccounts[0]!,
    id: '101',
    name: 'Alpha',
    persona: 'Alpha',
    matchCount: 1,
  };
  const bravo: Account = { ...alpha, id: '102', name: 'Bravo', persona: 'Bravo', matchCount: 0 };
  const ban: Ban = {
    id: '301',
    steamId: '301',
    name: 'Recovered banned player',
    rating: 1500,
    firstSeenAt: 1700000000000,
    lastSeenAt: 1700000000000,
    encountered: false,
  };
  const planFor = (account: Account): HistoryDeletePlan => ({
    token: '11111111-1111-4111-8111-111111111111',
    kind: 'account',
    target: { id: account.id, name: account.name },
    removed: [],
    retained: [],
    affectedAccounts: [{ id: account.id, name: account.name }],
    backupDirectory: 'test-profile/HistoryBackups',
    backupName: 'account-backup.json',
  });
  const removed = (plan: HistoryDeletePlan): HistoryDeleteResult => ({
    removed: true,
    removedMatches: 1,
    retainedMatches: 0,
    backup: {
      name: plan.backupName,
      version: 'a'.repeat(64),
      createdAt: 1700000000000,
      kind: 'account',
      target: plan.target,
      matchCount: 1,
      restoredAt: null,
    },
  });
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.replayEnabled = false;
      return value;
    };
    for (const surface of ['bans', 'replays', 'accounts'] as const)
      for (const empty of [false, true]) {
        it(`distinguishes unknown ${surface} data from a confirmed empty=${empty} list in ${lang}`, async () => {
          window.history.replaceState(
            null,
            '',
            surface === 'accounts' ? '#settings/accounts' : '#' + surface,
          );
          const banPending = deferred<RpcOutputs['bans.list']>(),
            replayPending = deferred<RpcOutputs['replays.list']>(),
            accountPending = deferred<RpcOutputs['accounts.list']>();
          let failing = true,
            reads = 0;
          const check = () => {
            reads++;
            if (failing) throw new Error('Controlled initial list read failure');
          };
          const native = nativeFixture(initial(), {
            'bans.list': () => {
              if (surface !== 'bans') return [];
              check();
              return banPending.promise;
            },
            'replays.list': () => {
              if (surface !== 'replays')
                return { directory: 'test-profile/recordings', recordings: [] };
              check();
              return replayPending.promise;
            },
            'accounts.list': () => {
              if (surface !== 'accounts') return [alpha, bravo];
              check();
              return accountPending.promise;
            },
          });
          render(<App />, { wrapper: wrapper(native.api) });
          let retry: HTMLElement;
          if (surface === 'bans') {
            retry = await screen.findByRole('button', { name: text('banListReload') });
            expect(screen.queryByText(text('banSourceEmpty'))).toBeNull();
          } else {
            await screen.findByText('Controlled initial list read failure');
            const root = document.querySelector(
              surface === 'accounts' ? '#settings-panel-accounts' : '.replays-panel',
            )!;
            expect(
              within(root as HTMLElement).queryByText(
                text(surface === 'accounts' ? 'accountsEmpty' : 'empty'),
              ),
            ).toBeNull();
            if (surface === 'replays') {
              expect(
                within(root as HTMLElement).getByText(new RegExp('^' + text('storageUsed')))
                  .textContent,
              ).toContain('—');
              expect(
                within(root as HTMLElement).queryByRole('button', {
                  name: text('enableRecording'),
                }),
              ).toBeNull();
            }
            retry =
              surface === 'accounts'
                ? within(root as HTMLElement).getByRole('button', { name: text('retry') })
                : within(root as HTMLElement).getByRole('button', { name: text('refresh') });
          }
          expect(reads).toBe(1);
          failing = false;
          await userEvent.click(retry);
          await waitFor(() => expect(reads).toBe(2));
          if (surface !== 'bans') {
            const owner = document.getElementById(
              surface === 'accounts' ? 'accounts-refresh' : 'replays-refresh',
            )!;
            expect(document.activeElement).toBe(owner);
            expect(owner.getAttribute('aria-busy')).toBe('true');
            await userEvent.click(owner);
            expect(reads).toBe(2);
          }
          await act(async () => {
            if (surface === 'bans') banPending.resolve(empty ? [] : [ban]);
            else if (surface === 'replays')
              replayPending.resolve({
                directory: 'test-profile/recordings',
                recordings: empty
                  ? []
                  : [replayFixture({ id: 'Read.webm', map: 'Recovered recording' })],
              });
            else accountPending.resolve(empty ? [] : [alpha, bravo]);
          });
          if (surface === 'bans')
            await screen.findByText(empty ? text('banSourceEmpty') : ban.name);
          else if (surface === 'accounts')
            await screen.findByText(empty ? text('accountsEmpty') : 'Alpha', {
              selector: empty ? undefined : '[data-slot=item-title]',
            });
          else
            await within(document.querySelector('.replays-panel')!).findByText(
              empty ? text('empty') : 'Recovered recording',
              { selector: empty ? undefined : '[data-slot=card-title]' },
            );
          expect(screen.queryByText('Controlled initial list read failure')).toBeNull();
          expect(
            native.calls.filter((call) =>
              ['bans.sync', 'accounts.delete', 'config.update'].includes(call.method),
            ),
          ).toHaveLength(0);
        });
      }
    for (const surface of ['bans', 'replays'] as const) {
      it(`qualifies retained ${surface} data after a failed read and recovers without sync in ${lang}`, async () => {
        window.history.replaceState(null, '', '#' + surface);
        let failing = false;
        const native = nativeFixture(initial(), {
          'bans.list': () => {
            if (failing) throw new Error('Controlled retained list failure');
            return [ban];
          },
          'replays.list': () => {
            if (failing) throw new Error('Controlled retained list failure');
            return {
              directory: 'test-profile/recordings',
              recordings: [replayFixture({ map: 'Retained recording' })],
            };
          },
        });
        render(<App />, { wrapper: wrapper(native.api) });
        await screen.findByText(surface === 'bans' ? ban.name : 'Retained recording', {
          selector: surface === 'replays' ? '[data-slot=card-title]' : undefined,
        });
        failing = true;
        act(() =>
          native.emit(
            surface === 'bans'
              ? {
                  type: 'bans',
                  list: [ban],
                  newly: [],
                  alerts: [],
                  revision: native.backend.revision + 1,
                }
              : { type: 'replays', revision: native.backend.revision + 1 },
          ),
        );
        if (surface === 'bans') {
          const indicator = await screen.findByRole('button', {
            name: translate(lang, 'banSyncReview', { status: text('banListReadIssue') }),
          });
          await userEvent.click(indicator);
          const detail = within(await screen.findByRole('dialog', { name: text('banSyncTitle') }));
          expect(detail.getByText(text('banListRetainedHint'))).toBeTruthy();
          failing = false;
          await userEvent.click(detail.getByRole('button', { name: text('banListReload') }));
          await waitFor(() =>
            expect(detail.queryByText('Controlled retained list failure')).toBeNull(),
          );
        } else {
          await screen.findByText('Controlled retained list failure');
          expect(screen.getByText(text('listReadRetained'))).toBeTruthy();
          expect(
            screen.getByText('Retained recording', { selector: '[data-slot=card-title]' }),
          ).toBeTruthy();
          failing = false;
          await userEvent.click(document.getElementById('replays-refresh')!);
          await waitFor(() =>
            expect(screen.queryByText('Controlled retained list failure')).toBeNull(),
          );
        }
        expect(native.calls.filter((call) => call.method === 'bans.sync')).toHaveLength(0);
      });
    }
    for (const repeat of [false, true]) {
      it(`keeps a confirmed account deletion separate from list retry, repeat=${repeat}, in ${lang}`, async () => {
        window.history.replaceState(null, '', '#settings/accounts');
        let accounts = [alpha, bravo],
          deleted = false,
          manual = false,
          pending = deferred<Account[]>();
        const plan = planFor(alpha);
        const native = nativeFixture(initial(), {
          'accounts.list': () => {
            if (deleted && !manual) throw new Error('Controlled post-delete list failure');
            return manual ? pending.promise : accounts;
          },
          'accounts.planDelete': () => plan,
          'accounts.delete': () => {
            deleted = true;
            accounts = [bravo];
            return removed(plan);
          },
        });
        render(<App />, { wrapper: wrapper(native.api) });
        await userEvent.click(
          await screen.findByRole('button', {
            name: translate(lang, 'deleteAccountAction', { name: alpha.name, id: alpha.id }),
          }),
        );
        const review = await screen.findByRole('alertdialog');
        await userEvent.click(within(review).getByRole('button', { name: text('delete') }));
        await screen.findByText('Controlled post-delete list failure');
        expect(screen.queryByText('Alpha', { selector: '[data-slot=item-title]' })).toBeNull();
        expect(screen.getByText('Bravo', { selector: '[data-slot=item-title]' })).toBeTruthy();
        expect(
          screen.getByText(translate(lang, 'historyDeleteResult', { removed: 1, retained: 0 })),
        ).toBeTruthy();
        manual = true;
        await userEvent.click(screen.getByRole('button', { name: text('retry') }));
        expect(document.activeElement).toBe(document.getElementById('accounts-refresh'));
        if (repeat) {
          await act(async () => pending.reject(new Error('Controlled second list failure')));
          await screen.findByText('Controlled second list failure');
          pending = deferred<Account[]>();
          await userEvent.click(screen.getByRole('button', { name: text('retry') }));
        }
        await act(async () => pending.resolve(accounts));
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: text('retry') })).toBeNull(),
        );
        expect(screen.queryByText('Alpha', { selector: '[data-slot=item-title]' })).toBeNull();
        expect(native.calls.filter((call) => call.method === 'accounts.delete')).toHaveLength(1);
      });
    }
    it(`distinguishes long account targets and restores the correct canceled action in ${lang}`, async () => {
      window.history.replaceState(null, '', '#settings/accounts');
      const accounts = [
        { ...alpha, name: 'N'.repeat(120) + '-Alpha' },
        { ...bravo, name: 'N'.repeat(120) + '-Bravo' },
      ];
      const native = nativeFixture(initial(), {
        'accounts.list': () => accounts,
        'accounts.planDelete': ({ id }) => planFor(accounts.find((account) => account.id === id)!),
      });
      render(<App />, { wrapper: wrapper(native.api) });
      for (const account of accounts)
        expect(
          await screen.findByRole('button', {
            name: translate(lang, 'deleteAccountAction', { name: account.name, id: account.id }),
          }),
        ).toBeTruthy();
      const target = screen.getByRole('button', {
        name: translate(lang, 'deleteAccountAction', { name: accounts[1]!.name, id: bravo.id }),
      });
      target.focus();
      await userEvent.keyboard(' ');
      const review = await screen.findByRole('alertdialog');
      expect(review.textContent).toContain(accounts[1]!.name);
      expect(review.textContent).toContain('#' + bravo.id);
      expect(document.activeElement).toBe(
        within(review).getByRole('button', { name: text('cancel') }),
      );
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(document.activeElement).toBe(target));
      expect(native.calls.filter((call) => call.method === 'accounts.delete')).toHaveLength(0);
    });
  }
});

describe('overview archive snapshot ownership', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const metric = (key: string) =>
      screen.getByText(text(key)).closest('[data-slot=card]')!.querySelector('strong')!.textContent;
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      return value;
    };
    for (const failure of ['archive', 'personal', 'both'] as const) {
      it(`withdraws invalidated rows and metrics through ${failure} refresh failure in ${lang}`, async () => {
        const value = initial();
        const match = matchFixture({
          id: '900100',
          fid: '900100',
          map: 'Deleted target',
          localPlayerId: value.session.localPlayerId,
          eloBefore: 1500,
          eloAfter: 1520,
          outcome: 'win',
        });
        const archive = deferred<Match[]>(),
          personal = deferred<Match[]>();
        let phase: 'initial' | 'held' | 'recovered' = 'initial';
        const native = nativeFixture(value, {
          'matches.list': ({ accountId }) =>
            phase === 'held'
              ? accountId
                ? personal.promise
                : archive.promise
              : phase === 'initial'
                ? [match]
                : [],
        });
        render(<Dashboard />, { wrapper: wrapper(native.api) });
        const row = await screen.findByRole('button', { name: /Deleted target/ });
        await waitFor(() => expect(metric('recentRating')).toBe('1,520'));
        expect(metric('recentWinRate')).toBe('100%');
        row.focus();
        phase = 'held';
        act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
        expect(screen.queryByRole('button', { name: /Deleted target/ })).toBeNull();
        expect(metric('recentRating')).toBe('—');
        expect(metric('recentWinRate')).toBe('—');
        expect(metric('archiveCount')).toBe('—');
        expect(document.activeElement).toBe(document.querySelector('.dashboard > [role=status]'));
        await act(async () => {
          if (failure === 'archive' || failure === 'both')
            archive.reject(new Error('Controlled archive refresh failure'));
          else archive.resolve([]);
          if (failure === 'personal' || failure === 'both')
            personal.reject(new Error('Controlled personal refresh failure'));
          else personal.resolve([]);
        });
        expect(screen.queryByRole('button', { name: /Deleted target/ })).toBeNull();
        expect(metric('recentRating')).toBe('—');
        expect(metric('recentWinRate')).toBe('—');
        expect(metric('archiveCount')).toBe(failure === 'personal' ? '0' : '—');
        if (failure !== 'personal')
          expect(screen.getByText('Controlled archive refresh failure')).toBeTruthy();
        if (failure !== 'archive')
          expect(screen.getByText('Controlled personal refresh failure')).toBeTruthy();
        phase = 'recovered';
        for (const retry of screen.getAllByRole('button', { name: text('retry') })) {
          retry.focus();
          await userEvent.keyboard(' ');
        }
        await waitFor(() =>
          expect(screen.queryAllByRole('button', { name: text('retry') })).toHaveLength(0),
        );
        await waitFor(() => expect(metric('archiveCount')).toBe('0'));
        expect(metric('recentRating')).toBe('—');
        expect(screen.queryByRole('button', { name: /Deleted target/ })).toBeNull();
        expect(document.activeElement).toBe(document.querySelector('.dashboard > [role=status]'));
      });
    }
    it(`rejects an older snapshot after a newer archive revision succeeds in ${lang}`, async () => {
      const value = initial(),
        late = deferred<Match[]>();
      const old = matchFixture({
        id: '900200',
        fid: '900200',
        map: 'Older snapshot',
        localPlayerId: value.session.localPlayerId,
        eloAfter: 1520,
      });
      const latest = {
        ...old,
        id: '900201',
        fid: '900201',
        map: 'Newest snapshot',
        eloAfter: 1800,
      };
      let phase: 'initial' | 'held' | 'latest' = 'initial';
      const native = nativeFixture(value, {
        'matches.list': () =>
          phase === 'held' ? late.promise : phase === 'latest' ? [latest] : [old],
      });
      render(<Dashboard />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: /Older snapshot/ });
      phase = 'held';
      act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
      phase = 'latest';
      act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
      await screen.findByRole('button', { name: /Newest snapshot/ });
      await act(async () => late.resolve([old]));
      expect(screen.queryByRole('button', { name: /Older snapshot/ })).toBeNull();
      expect(metric('recentRating')).toBe('1,800');
    });
    it(`requires a fresh personal snapshot after account metadata changes in ${lang}`, async () => {
      const value = initial(),
        pending = deferred<Match[]>();
      const match = matchFixture({
        map: 'Account metadata snapshot',
        localPlayerId: value.session.localPlayerId,
        eloAfter: 1520,
      });
      let held = false;
      const native = nativeFixture(value, {
        'matches.list': ({ accountId }) => (held && accountId ? pending.promise : [match]),
      });
      render(<Dashboard />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: /Account metadata snapshot/ });
      held = true;
      act(() =>
        native.emit({
          type: 'accounts',
          list: capturedAccounts.map((account) => ({
            ...account,
            name: account.name + ' refreshed',
          })),
          activeAccountId: value.session.localPlayerId,
          revision: native.backend.revision + 1,
        }),
      );
      expect(screen.queryByRole('button', { name: /Account metadata snapshot/ })).toBeNull();
      expect(metric('recentRating')).toBe('—');
      expect(metric('archiveCount')).toBe('1');
      await act(async () => pending.resolve([match]));
      await screen.findByRole('button', { name: /Account metadata snapshot/ });
      expect(metric('recentRating')).toBe('1,520');
    });
  }
});

describe('diagnostic text and overview shortcut recovery', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const diagnostic = (source: string) =>
      `${source}: C:\\BARadar\\${'X'.repeat(200)}\\错误文件.sqlite — complete diagnostic`;
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.replayEnabled = true;
      return value;
    };
    for (const size of ['short', 'long'] as const) {
      it(`keeps the intended overview shortcut usable through a ${size} recording error in ${lang}`, async () => {
        const native = nativeFixture(initial());
        render(<App />, { wrapper: wrapper(native.api) });
        const quick = within(
          await screen.findByRole('complementary', { name: text('quickTools') }),
        );
        const shortcut = quick.getByRole('button', { name: new RegExp(text('playerShortcut')) });
        shortcut.focus();
        const error = size === 'short' ? 'Controlled recording failure' : diagnostic('recording');
        act(() =>
          native.emit({
            type: 'recording',
            recording: {
              ...native.backend.recording,
              phase: 'error',
              error,
              failure: { kind: 'start', discarded: true },
            },
            revision: native.backend.revision + 1,
          }),
        );
        expect(document.activeElement).toBe(shortcut);
        const status = quick.getByRole('button', {
          name: translate(lang, 'recordingStatusReview', { status: text('recordingFailed') }),
        });
        await userEvent.click(status);
        const details = within(
          await screen.findByRole('dialog', { name: text('recordingStatus') }),
        );
        expect(details.getByRole('alert').textContent).toContain(error);
        await userEvent.keyboard('{Escape}');
        expect(document.activeElement).toBe(status);
        shortcut.focus();
        act(() =>
          native.emit({
            type: 'recording',
            recording: { ...native.backend.recording, phase: 'idle', error: null, failure: null },
            revision: native.backend.revision + 1,
          }),
        );
        expect(quick.queryByRole('alert')).toBeNull();
        expect(document.activeElement).toBe(shortcut);
        await userEvent.keyboard(' ');
        await waitFor(() => expect(location.hash).toBe('#players'));
        expect(await screen.findByRole('searchbox', { name: text('searchLabel') })).toBeTruthy();
      });
    }
    for (const warning of ['audio', 'display'] as const) {
      it(`keeps ${warning} warnings discoverable in overview recording details in ${lang}`, async () => {
        const value = initial();
        value.recording.phase = 'recording';
        value.recording.sessionId = 'overview-status';
        if (warning === 'audio')
          value.recording.audio = {
            system: { state: 'unavailable', gap: true },
            microphone: { state: 'off', gap: false },
          };
        else
          value.recording.display = {
            requestedId: 'old-screen',
            sourceId: 'new-screen',
            label: 'Available display',
            selection: 'fallback',
          };
        const native = nativeFixture(value);
        render(<App />, { wrapper: wrapper(native.api) });
        const status = await screen.findByRole('button', {
          name: translate(lang, 'recordingStatusReview', {
            status: text('recordingNeedsAttention'),
          }),
        });
        await userEvent.click(status);
        const details = await screen.findByRole('dialog', { name: text('recordingStatus') });
        expect(
          details.querySelector(
            warning === 'audio'
              ? '[data-recording-audio-feedback]'
              : '[data-recording-display-feedback]',
          ),
        ).toBeTruthy();
        const close = within(details).getByRole('button', { name: text('close') });
        close.focus();
        act(() =>
          native.emit({
            type: 'recording',
            recording: { ...native.backend.recording, audio: undefined, display: undefined },
            revision: native.backend.revision + 1,
          }),
        );
        expect(document.activeElement).toBe(close);
        await userEvent.keyboard('{Escape}');
        expect(document.activeElement).toBe(status);
      });
    }
    it(`returns focus to recording details when recovery removes its action in ${lang}`, async () => {
      const value = initial();
      value.recording = {
        ...value.recording,
        phase: 'error',
        error: 'Controlled recoverable capture',
        failure: { kind: 'start', discarded: true },
      };
      const native = nativeFixture(value);
      render(<App />, { wrapper: wrapper(native.api) });
      const status = await screen.findByRole('button', {
        name: translate(lang, 'recordingStatusReview', { status: text('recordingFailed') }),
      });
      await userEvent.click(status);
      const details = within(await screen.findByRole('dialog', { name: text('recordingStatus') }));
      const action = details.getByRole('button', { name: text('recordingRetryCurrent') });
      action.focus();
      act(() =>
        native.emit({
          type: 'recording',
          recording: {
            ...native.backend.recording,
            phase: 'recording',
            error: null,
            failure: null,
          },
          revision: native.backend.revision + 1,
        }),
      );
      expect(action.isConnected).toBe(false);
      expect(document.activeElement).toBe(
        details.getByRole('region', { name: text('recordingStatusDetails') }),
      );
      await userEvent.keyboard('{Escape}');
      expect(document.activeElement).toBe(status);
    });
    for (const recovery of ['retry', 'discard'] as const) {
      it(`preserves complete settings diagnostics through ${recovery} in ${lang}`, async () => {
        window.history.replaceState(null, '', '#settings/connection');
        const failure = diagnostic('settings');
        let fail = true;
        const native = nativeFixture(initial(), {
          'config.update': (patch) => {
            if (fail) throw new Error(failure);
            const config = { ...native.backend.config, ...patch };
            native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
            return config;
          },
        });
        render(<App />, { wrapper: wrapper(native.api) });
        const input = await screen.findByRole('textbox', { name: text('logDirectory') });
        const original = native.backend.config.logDir;
        fireEvent.change(input, { target: { value: 'G:\\Replacement\\GameLogs' } });
        fireEvent.blur(input);
        const review = await reviewSettingsFailure(lang);
        expect(review.getByRole('alert').textContent).toBe(failure);
        const region = review.getByRole('region', { name: text('settingsSaveDetails') });
        expect(region.tabIndex).toBe(0);
        expect(review.getByRole('button', { name: text('settingsRetry') })).toBeTruthy();
        expect(review.getByRole('button', { name: text('settingsDiscard') })).toBeTruthy();
        fail = false;
        fireEvent.click(
          review.getByRole('button', {
            name: text(recovery === 'retry' ? 'settingsRetry' : 'settingsDiscard'),
          }),
        );
        await waitFor(() => expect(review.queryByRole('alert')).toBeNull());
        expect(native.backend.config.logDir).toBe(
          recovery === 'retry' ? 'G:\\Replacement\\GameLogs' : original,
        );
      });
    }
    it(`retains complete startup diagnostics through repeated failure and recovery in ${lang}`, async () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(lang === 'zh' ? 'zh-CN' : 'en-US');
      const first = diagnostic('startup'),
        second = diagnostic('startup-again');
      let attempts = 0;
      const value = initial();
      const native = nativeFixture(value, {
        'app.bootstrap': () => {
          if (++attempts < 3) throw new Error(attempts === 1 ? first : second);
          return value;
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      const retry = await screen.findByRole('button', { name: text('startupRetry') });
      expect(screen.getByRole('alert').textContent).toBe(first);
      fireEvent.click(retry);
      await screen.findByText(second);
      expect(screen.getByRole('alert').textContent).toBe(second);
      fireEvent.click(retry);
      await screen.findByRole('complementary', { name: text('quickTools') });
      expect(screen.queryByText(second)).toBeNull();
      expect(attempts).toBe(3);
    });
  }
});

describe('startup recovery', () => {
  const tree = (api: Bridge) => (
    <AppProvider api={api}>
      <SidebarProvider>
        <App />
      </SidebarProvider>
    </AppProvider>
  );
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const initial = () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(lang === 'zh' ? 'zh-CN' : 'en-US');
      const value = bootstrapForApp();
      value.config.lang = lang;
      return value;
    };
    for (const route of ['#current', '#settings/connection']) {
      it(`retains retry focus through repeated failure and replays buffered events into ${route} in ${lang}`, async () => {
        history.replaceState(null, '', route);
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        const bootstrap = initial();
        let gate = deferred<Bootstrap>(),
          attempts = 0;
        const native = nativeFixture(bootstrap, {
          'app.bootstrap': () =>
            ++attempts === 1 ? Promise.reject(new Error('Initial startup failure')) : gate.promise,
        });
        render(tree(native.api));
        const button = await screen.findByRole('button', { name: text('startupRetry') });
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(screen.getByRole('alert').textContent).toContain('Initial startup failure');
        expect(native.activeSubscriptions).toBe(0);
        button.focus();
        await userEvent.keyboard(' ');
        await waitFor(() => expect(attempts).toBe(2));
        expect(document.activeElement).toBe(button);
        expect(screen.getByRole('status').textContent).toBe(text('startupRetrying'));
        expect(screen.getByRole('alert').textContent).toContain(text('startupPreviousFailure'));
        await userEvent.keyboard('{Enter} ');
        expect(attempts).toBe(2);
        await act(async () => gate.reject(new Error('Second startup failure')));
        await screen.findByText('Second startup failure');
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(button);
        expect(screen.getByRole('button', { name: text('startupRetry') })).toBe(button);
        gate = deferred();
        await userEvent.keyboard(' ');
        await waitFor(() => expect(attempts).toBe(3));
        act(() =>
          native.emit({
            type: 'health',
            health: { state: 'partial', at: Date.now(), checks: [] },
            revision: native.backend.revision + 1,
          }),
        );
        await act(async () => gate.resolve(bootstrap));
        await waitFor(() => expect(document.querySelector('.startup-error')).toBeNull());
        await waitFor(() =>
          expect(document.activeElement?.id).toBe(
            route.startsWith('#settings') ? 'settings-content' : 'main-content',
          ),
        );
        expect(
          document.querySelector('.health-status-trigger')?.getAttribute('aria-label'),
        ).toContain(text('servicePartial'));
        expect(native.activeSubscriptions).toBe(1);
        expect(native.subscriptions).toBe(3);
        expect(native.unsubscriptions).toBe(2);
        expect(location.hash).toBe(route);
      });
    }
    it(`does not reclaim focus moved outside the startup retry in ${lang}`, async () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      const bootstrap = initial(),
        gate = deferred<Bootstrap>();
      let attempts = 0;
      const native = nativeFixture(bootstrap, {
        'app.bootstrap': () =>
          ++attempts === 1 ? Promise.reject(new Error('Startup unavailable')) : gate.promise,
      });
      render(
        <>
          {tree(native.api)}
          <button>Outside startup recovery</button>
        </>,
      );
      const retry = await screen.findByRole('button', { name: text('startupRetry') });
      retry.focus();
      await userEvent.keyboard(' ');
      await waitFor(() => expect(attempts).toBe(2));
      const outside = screen.getByRole('button', { name: 'Outside startup recovery' });
      outside.focus();
      await act(async () => gate.resolve(bootstrap));
      await waitFor(() => expect(document.querySelector('.startup-error')).toBeNull());
      expect(document.activeElement).toBe(outside);
    });
    it(`recovers a synchronous subscription failure with one live listener in ${lang}`, async () => {
      const native = nativeFixture(initial());
      let attempts = 0;
      const api: Bridge = {
        ...native.api,
        subscribe: (callback) => {
          if (++attempts === 1) throw new Error('Subscription unavailable');
          return native.api.subscribe(callback);
        },
      };
      render(tree(api));
      const retry = await screen.findByRole('button', { name: text('startupRetry') });
      expect(screen.getByRole('alert').textContent).toContain('Subscription unavailable');
      expect(native.calls.some((call) => call.method === 'app.bootstrap')).toBe(false);
      fireEvent.click(retry);
      await waitFor(() => expect(document.querySelector('.startup-error')).toBeNull());
      expect(native.activeSubscriptions).toBe(1);
      expect(attempts).toBe(2);
    });
    it(`ignores an old retry response after the bridge changes in ${lang}`, async () => {
      const bootstrap = initial(),
        gate = deferred<Bootstrap>();
      let attempts = 0;
      const first = nativeFixture(bootstrap, {
        'app.bootstrap': () =>
          ++attempts === 1 ? Promise.reject(new Error('Old bridge failure')) : gate.promise,
      });
      const current = structuredClone(bootstrap);
      current.health = { state: 'down', at: Date.now(), checks: [] };
      const second = nativeFixture(current);
      const view = render(tree(first.api));
      fireEvent.click(await screen.findByRole('button', { name: text('startupRetry') }));
      await waitFor(() => expect(attempts).toBe(2));
      view.rerender(tree(second.api));
      await screen.findByRole('button', { name: 'BATrace · ' + text('serviceDown') });
      await act(async () => gate.resolve({ ...bootstrap, revision: 100 }));
      expect(screen.getByRole('button', { name: 'BATrace · ' + text('serviceDown') })).toBeTruthy();
      expect(first.activeSubscriptions).toBe(0);
      expect(second.activeSubscriptions).toBe(1);
    });
    it(`recovers a synchronously thrown bootstrap invocation in ${lang}`, async () => {
      const native = nativeFixture(initial());
      let failed = false;
      const api: Bridge = {
        ...native.api,
        invoke: (method, input) => {
          if (method === 'app.bootstrap' && !failed) {
            failed = true;
            throw new Error('Synchronous startup failure');
          }
          return native.api.invoke(method, input);
        },
      };
      render(tree(api));
      const retry = await screen.findByRole('button', { name: text('startupRetry') });
      expect(screen.getByRole('alert').textContent).toContain('Synchronous startup failure');
      fireEvent.click(retry);
      await waitFor(() => expect(document.querySelector('.startup-error')).toBeNull());
      expect(native.activeSubscriptions).toBe(1);
    });
    it(`retries under StrictMode without retaining failed subscriptions in ${lang}`, async () => {
      const bootstrap = initial(),
        gate = deferred<Bootstrap>();
      let recovering = false;
      const native = nativeFixture(bootstrap, {
        'app.bootstrap': () =>
          recovering ? gate.promise : Promise.reject(new Error('Strict startup failure')),
      });
      render(<StrictMode>{tree(native.api)}</StrictMode>);
      const retry = await screen.findByRole('button', { name: text('startupRetry') });
      await waitFor(() => expect(retry.getAttribute('aria-busy')).toBe('false'));
      expect(native.activeSubscriptions).toBe(0);
      expect(native.calls.filter((call) => call.method === 'app.bootstrap')).toHaveLength(2);
      recovering = true;
      fireEvent.click(retry);
      await waitFor(() =>
        expect(native.calls.filter((call) => call.method === 'app.bootstrap')).toHaveLength(3),
      );
      await act(async () => gate.resolve(bootstrap));
      await waitFor(() => expect(document.querySelector('.startup-error')).toBeNull());
      expect(native.activeSubscriptions).toBe(1);
      expect(native.subscriptions).toBe(3);
    });
  }
});

describe('automatic retry feedback', () => {
  for (const lang of ['zh', 'en'] as const)
    for (const count of [1, 2]) {
      it(`shows ${count} failed player queries, a bounded retry and manual recovery in ${lang}`, async () => {
        const bootstrap = bootstrapForApp();
        bootstrap.config.lang = lang;
        bootstrap.session = {
          ...bootstrap.session,
          current: null,
          phase: 'lobby',
          lobbyId: 'retry-ui',
          lobbyPlayers: [localPlayer, secondPlayer].map((player) => ({ ...player, teamId: 0 })),
        };
        const gate = deferred<RpcOutputs['session.query']>();
        const native = nativeFixture(bootstrap, { 'session.query': () => gate.promise });
        const sourceKey = currentRosterKey(bootstrap.session);
        const text = (key: string, vars: Record<string, string | number> = {}) =>
          translate(lang, key, vars);
        render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
        await screen.findByRole('button', { name: rosterActionName(localPlayer) });
        const send = (event: AppEvent) =>
          act(() => native.emit({ ...event, revision: native.backend.revision + 1 }));
        const begin = (requestId: string) =>
          send({
            type: 'rosterQuery',
            requestId,
            context: 'current',
            sourceKey,
            pendingIds: bootstrap.session.lobbyPlayers.map((player) => player.id),
            revision: 0,
          });
        const complete = (requestId: string, fail: boolean) =>
          bootstrap.session.lobbyPlayers.forEach((player, index) =>
            send({
              type: 'roster',
              requestId,
              context: 'current',
              generation: bootstrap.session.generation,
              sourceKey,
              player,
              info:
                fail && index < count
                  ? null
                  : {
                      elo: 2200 - index * 400,
                      kd: null,
                      winRate: null,
                      matchCount: null,
                      topUnits: '',
                      category: null,
                      updatedAt: Date.now(),
                      stale: false,
                    },
              error: fail && index < count ? 'Transient player outage' : null,
              revision: 0,
            }),
          );
        begin('automatic');
        complete('automatic', true);
        const retryAt = Date.now() + 5000;
        send({
          type: 'rosterRetry',
          context: 'current',
          requestId: 'automatic',
          sourceKey,
          retryAt,
          revision: 0,
        });
        expect(screen.getByRole('status').textContent).toBe(
          text('rosterRetryScheduled', {
            n: count,
            time: new Date(retryAt).toLocaleTimeString(lang),
          }),
        );
        if (lang === 'en')
          expect(screen.getByRole('status').textContent).toContain(
            count === 1 ? '1 player query failed.' : '2 player queries failed.',
          );
        const button = screen.getByRole('button', { name: text('query') });
        expect(button.getAttribute('aria-disabled')).toBe('false');
        send({
          type: 'rosterRetry',
          context: 'current',
          requestId: 'automatic',
          sourceKey,
          retryAt: null,
          revision: 0,
        });
        expect(screen.getByRole('status').textContent).toBe(
          text('rosterQueryIncomplete', { n: count }),
        );
        button.focus();
        await userEvent.keyboard(' ');
        await waitFor(() =>
          expect(native.calls.filter((call) => call.method === 'session.query')).toHaveLength(1),
        );
        const input = native.calls.find((call) => call.method === 'session.query')!
          .input as RpcInputs['session.query'];
        begin(input.requestId);
        complete(input.requestId, false);
        send({
          type: 'rosterRetry',
          context: 'current',
          requestId: 'automatic',
          sourceKey,
          retryAt,
          revision: 0,
        });
        await act(async () =>
          gate.resolve({ requestId: input.requestId, queried: 2, skipped: 0, cancelled: false }),
        );
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(button);
        expect(screen.queryAllByText('Transient player outage')).toHaveLength(0);
        expect(screen.queryByRole('status')).toBeNull();
      });
    }
});

describe('shared cache operation state', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, vars: Record<string, string | number> = {}) =>
      translate(lang, key, vars);
    const stats = (expired = 3): RpcOutputs['cache.stats'] => ({
      at: Date.now(),
      nextExpiryAt: null,
      api: { entries: 3, expired: Math.min(expired, 2), bytes: 2048 },
      snapshots: { entries: 2, expired: Math.max(0, expired - 2), bytes: 1024 },
    });
    const after = (mode: 'expired' | 'all'): RpcOutputs['cache.stats'] => ({
      at: Date.now(),
      nextExpiryAt: null,
      api: { entries: mode === 'all' ? 0 : 1, expired: 0, bytes: 0 },
      snapshots: { entries: mode === 'all' ? 0 : 1, expired: 0, bytes: 0 },
    });
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      return value;
    };
    const cleanupButton = (mode: 'expired' | 'all') =>
      screen.getByRole('button', {
        name: text(mode === 'all' ? 'cacheClearAll' : 'cacheClearExpired'),
      });
    const changeTab = async (key: string) => {
      fireEvent.click(screen.getByRole('tab', { name: text(key) }));
      await screen.findByRole('tabpanel', { name: text(key) });
    };
    for (const mode of ['expired', 'all'] as const) {
      for (const outcome of ['success', 'uncertain', 'unreconciled'] as const) {
        it(`keeps ${mode} cleanup ${outcome} across cache navigation in ${lang}`, async () => {
          history.replaceState(null, '', '#settings/cache');
          const gate = deferred<RpcOutputs['cache.clear']>();
          let applied = false,
            readable = outcome !== 'unreconciled';
          const native = nativeFixture(initial(), {
            'cache.stats': () => {
              if (applied && !readable) throw new Error('Reconciliation unavailable');
              return applied ? after(mode) : stats();
            },
            'cache.clear': () => gate.promise,
          });
          render(<App />, { wrapper: wrapper(native.api) });
          await screen.findByText('3 KB');
          fireEvent.click(cleanupButton(mode));
          if (mode === 'all') {
            const dialog = await screen.findByRole('alertdialog');
            fireEvent.click(within(dialog).getByRole('button', { name: text('cacheClearAll') }));
          }
          await waitFor(() =>
            expect(native.calls.filter((call) => call.method === 'cache.clear')).toHaveLength(1),
          );
          await changeTab('generalSettings');
          await changeTab('cache');
          const button = cleanupButton(mode);
          expect(button.getAttribute('aria-busy')).toBe('true');
          fireEvent.click(button);
          expect(screen.queryByRole('alertdialog')).toBeNull();
          expect(native.calls.filter((call) => call.method === 'cache.clear')).toHaveLength(1);
          button.focus();
          applied = true;
          await act(async () => {
            if (outcome === 'success')
              gate.resolve({ removed: mode === 'all' ? 5 : 3, stats: after(mode) });
            else gate.reject(new Error('Cleanup response lost'));
          });
          await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
          expect(document.activeElement).toBe(button);
          if (outcome === 'success')
            expect(
              screen.getByText(text('cacheCleared', { count: mode === 'all' ? 5 : 3 })),
            ).toBeTruthy();
          else {
            expect(screen.getByText('Cleanup response lost')).toBeTruthy();
            expect(screen.queryByText(text('cacheCleared', { count: 0 }))).toBeNull();
            if (outcome === 'unreconciled') {
              expect(screen.getByText('Reconciliation unavailable')).toBeTruthy();
              expect(cleanupButton('all').getAttribute('aria-disabled')).toBe('true');
              fireEvent.click(cleanupButton('all'));
              expect(screen.queryByRole('alertdialog')).toBeNull();
              readable = true;
              fireEvent.click(screen.getByRole('button', { name: text('refresh') }));
            }
            await screen.findByText(text('cacheClearUnknownReconciled'));
          }
          await changeTab('generalSettings');
          await changeTab('cache');
          if (outcome === 'success')
            await screen.findByText(text('cacheCleared', { count: mode === 'all' ? 5 : 3 }));
          else await screen.findByText(text('cacheClearUnknownReconciled'));
          expect(native.calls.filter((call) => call.method === 'cache.clear')).toHaveLength(1);
        });
      }
    }
    it(`updates expiry counts and cleanup eligibility at the next deadline in ${lang}`, async () => {
      let clock = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
      const deadline = clock + 80;
      let reads = 0;
      const native = nativeFixture(initial(), {
        'cache.stats': () => {
          reads++;
          return {
            ...stats(clock < deadline ? 0 : 1),
            nextExpiryAt: clock < deadline ? deadline : null,
          };
        },
      });
      render(<CacheSettings />, { wrapper: wrapper(native.api) });
      await screen.findByText('3 KB');
      expect(cleanupButton('expired').getAttribute('aria-disabled')).toBe('true');
      clock = deadline + 1;
      await waitFor(() =>
        expect(cleanupButton('expired').getAttribute('aria-disabled')).toBe('false'),
      );
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(native.calls.some((call) => call.method === 'cache.clear')).toBe(false);
    });
    for (const event of ['focus', 'visibilitychange'] as const) {
      it(`refreshes an elapsed snapshot on ${event} in ${lang}`, async () => {
        let clock = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => clock);
        const deadline = clock + 10000;
        const native = nativeFixture(initial(), {
          'cache.stats': () => ({
            ...stats(clock < deadline ? 0 : 1),
            nextExpiryAt: clock < deadline ? deadline : null,
          }),
        });
        render(<CacheSettings />, { wrapper: wrapper(native.api) });
        await screen.findByText('3 KB');
        clock = deadline + 1;
        act(() => (event === 'focus' ? window : document).dispatchEvent(new Event(event)));
        await waitFor(() =>
          expect(cleanupButton('expired').getAttribute('aria-disabled')).toBe('false'),
        );
        expect(native.calls.filter((call) => call.method === 'cache.stats')).toHaveLength(2);
      });
    }
    it(`marks an expiry read failure stale until a successful retry in ${lang}`, async () => {
      let clock = Date.now(),
        readable = true;
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
      const deadline = clock + 80;
      const native = nativeFixture(initial(), {
        'cache.stats': () => {
          if (!readable) throw new Error('Expiry statistics unavailable');
          return {
            ...stats(clock < deadline ? 0 : 1),
            nextExpiryAt: clock < deadline ? deadline : null,
          };
        },
      });
      render(<CacheSettings />, { wrapper: wrapper(native.api) });
      await screen.findByText('3 KB');
      readable = false;
      clock = deadline + 1;
      await screen.findByText('Expiry statistics unavailable');
      expect(cleanupButton('all').getAttribute('aria-disabled')).toBe('true');
      expect(document.querySelector('.settings-section [role=status]')?.textContent).toContain(
        text('cacheStatsOutdated', { time: formatTime(deadline - 80, lang) }),
      );
      readable = true;
      fireEvent.click(screen.getByRole('button', { name: text('refresh') }));
      await waitFor(() =>
        expect(cleanupButton('expired').getAttribute('aria-disabled')).toBe('false'),
      );
      expect(screen.queryByText('Expiry statistics unavailable')).toBeNull();
    });
    it(`joins visibility refreshes and blocks cleanup during the same pending read in ${lang}`, async () => {
      const gate = deferred<RpcOutputs['cache.stats']>();
      let reads = 0;
      const native = nativeFixture(initial(), {
        'cache.stats': () => (++reads === 1 ? stats() : gate.promise),
      });
      render(<CacheSettings />, { wrapper: wrapper(native.api) });
      await screen.findByText('3 KB');
      fireEvent.click(screen.getByRole('button', { name: text('refresh') }));
      await waitFor(() => expect(reads).toBe(2));
      act(() => window.dispatchEvent(new Event('focus')));
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      fireEvent.click(cleanupButton('all'));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(reads).toBe(2);
      await act(async () => gate.resolve(after('all')));
      expect(cleanupButton('expired').getAttribute('aria-disabled')).toBe('true');
    });
  }
});

describe('shared connection feedback', () => {
  const paths = [
    '/api/players/search',
    '/api/players/info',
    '/api/leaderboard/ban',
    '/api/players/matches',
    '/api/match',
  ];
  const healthFor = (
    state: RpcOutputs['api.health']['state'],
    at = 1700000000000,
  ): RpcOutputs['api.health'] => ({
    state,
    at,
    checks:
      state === 'unknown'
        ? []
        : paths.map((path, index) => ({
            path,
            ok: state === 'ok' || (state === 'partial' && index === 0),
            status: state === 'ok' || (state === 'partial' && index === 0) ? 200 : 503,
            ms: 12,
          })),
  });
  const stateKey = {
    ok: 'serviceConnected',
    partial: 'servicePartial',
    down: 'serviceDown',
    unknown: 'unknown',
  };
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.health = healthFor('ok', 1000);
      return value;
    };
    const settingsCheck = () => screen.getByRole('button', { name: text('healthCheck') });
    const badge = (key: string) =>
      screen.findByRole('button', { name: new RegExp('^BATrace · ' + text(key)) });
    for (const state of ['unknown', 'down', 'partial', 'ok'] as const) {
      it(`shows the returned ${state} result and endpoint details in connection settings in ${lang}`, async () => {
        history.replaceState(null, '', '#settings/connection');
        const result = healthFor(state);
        const native = nativeFixture(initial(), { 'api.health': () => result });
        render(<App />, { wrapper: wrapper(native.api) });
        fireEvent.click(await screen.findByRole('button', { name: text('healthCheck') }));
        await waitFor(() => expect(settingsCheck().getAttribute('aria-busy')).toBe('false'));
        const panel = document.querySelector<HTMLElement>('[data-health-panel]')!;
        expect(within(panel).getByRole('status').textContent).toContain(text(stateKey[state]));
        expect(within(panel).getByRole('status').textContent).toContain(
          new Date(result.at).toLocaleString(lang),
        );
        expect(within(panel).queryByText(text('success'))).toBeNull();
        fireEvent.click(within(panel).getByRole('button', { name: text('healthDetails') }));
        expect(within(panel).getByText('/api/match')).toBeTruthy();
        if (state === 'unknown')
          expect(within(panel).getAllByText(text('healthEndpointNotChecked'))).toHaveLength(5);
        else expect(within(panel).getAllByText(/HTTP (200|503)/)).toHaveLength(5);
        fireEvent.click(screen.getByRole('button', { name: text('settingsBack') }));
        await badge(stateKey[state]);
      });
    }
    it(`shares failed checks across settings and workspace and preserves retry focus in ${lang}`, async () => {
      history.replaceState(null, '', '#settings/connection');
      const gate = deferred<RpcOutputs['api.health']>();
      let attempts = 0;
      const native = nativeFixture(initial(), {
        'api.health': () =>
          ++attempts === 1 ? Promise.reject(new Error('Shared health failure')) : gate.promise,
      });
      render(<App />, { wrapper: wrapper(native.api) });
      fireEvent.click(await screen.findByRole('button', { name: text('healthCheck') }));
      await screen.findByText('Shared health failure');
      fireEvent.click(screen.getByRole('button', { name: text('settingsBack') }));
      const failed = await badge('healthCheckFailed');
      expect(failed.getAttribute('aria-label')).toContain(text('serviceConnected'));
      fireEvent.click(screen.getByRole('button', { name: text('settings') }));
      fireEvent.click(await screen.findByRole('tab', { name: text('gameConnection') }));
      const check = await screen.findByRole('button', { name: text('healthCheck') });
      expect(screen.getByText('Shared health failure')).toBeTruthy();
      check.focus();
      await userEvent.keyboard(' ');
      await waitFor(() => expect(attempts).toBe(2));
      expect(check.getAttribute('aria-busy')).toBe('true');
      expect(document.activeElement).toBe(check);
      await userEvent.keyboard('{Enter} ');
      expect(attempts).toBe(2);
      expect(screen.queryByText('Shared health failure')).toBeNull();
      await act(async () => gate.resolve(healthFor('partial')));
      await waitFor(() => expect(check.getAttribute('aria-busy')).toBe('false'));
      expect(document.activeElement).toBe(check);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelector('[data-health-panel] [role=status]')?.textContent).toContain(
        text('servicePartial'),
      );
    });
    for (const state of ['down', 'partial', 'ok'] as const) {
      it(`qualifies a failed persistent badge until a ${state} retry succeeds in ${lang}`, async () => {
        const gate = deferred<RpcOutputs['api.health']>();
        let attempts = 0;
        const onCheck = vi.fn(() =>
          ++attempts === 1 ? Promise.reject(new Error('Popover health failure')) : gate.promise,
        );
        const native = nativeFixture(initial());
        render(<BatraceStatus health={healthFor('ok', 1000)} onCheck={onCheck} />, {
          wrapper: wrapper(native.api),
        });
        fireEvent.click(await badge('serviceConnected'));
        let check = within(explanation()).getByRole('button', { name: text('health') });
        check.focus();
        await userEvent.keyboard(' ');
        await screen.findByText('Popover health failure');
        expect(document.activeElement).toBe(check);
        await userEvent.keyboard('{Escape}');
        const failed = await badge('healthCheckFailed');
        expect(failed.getAttribute('aria-label')).toContain(text('serviceConnected'));
        fireEvent.click(failed);
        expect(within(explanation()).getByRole('alert').textContent).toContain(
          'Popover health failure',
        );
        check = within(explanation()).getByRole('button', { name: text('health') });
        check.focus();
        await userEvent.keyboard(' ');
        await waitFor(() => expect(attempts).toBe(2));
        await badge('healthChecking');
        expect(check.getAttribute('aria-busy')).toBe('true');
        await act(async () => gate.resolve(healthFor(state)));
        await badge(stateKey[state]);
        expect(document.activeElement).toBe(check);
        expect(screen.queryByRole('alert')).toBeNull();
      });
    }
    it(`keeps a newer health event when an older check response arrives in ${lang}`, async () => {
      history.replaceState(null, '', '#settings/connection');
      const gate = deferred<RpcOutputs['api.health']>();
      const native = nativeFixture(initial(), { 'api.health': () => gate.promise });
      render(<App />, { wrapper: wrapper(native.api) });
      fireEvent.click(await screen.findByRole('button', { name: text('healthCheck') }));
      act(() =>
        native.emit({
          type: 'health',
          health: healthFor('down', 3000),
          revision: native.backend.revision + 1,
        }),
      );
      await act(async () => gate.resolve(healthFor('ok', 2000)));
      await waitFor(() => expect(settingsCheck().getAttribute('aria-busy')).toBe('false'));
      expect(document.querySelector('[data-health-panel] [role=status]')?.textContent).toContain(
        text('serviceDown'),
      );
    });
    it(`retains an in-flight check and its failure across page navigation in ${lang}`, async () => {
      history.replaceState(null, '', '#settings/connection');
      const gate = deferred<RpcOutputs['api.health']>();
      const probe = vi.fn(() => gate.promise);
      const native = nativeFixture(initial(), { 'api.health': probe });
      render(<App />, { wrapper: wrapper(native.api) });
      fireEvent.click(await screen.findByRole('button', { name: text('healthCheck') }));
      await waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: text('settingsBack') }));
      const trigger = await badge('healthChecking');
      fireEvent.click(trigger);
      const check = within(explanation()).getByRole('button', { name: text('health') });
      expect(check.getAttribute('aria-busy')).toBe('true');
      fireEvent.click(check);
      expect(probe).toHaveBeenCalledTimes(1);
      await act(async () => gate.reject(new Error('Navigated health failure')));
      await badge('healthCheckFailed');
      expect(within(explanation()).getByRole('alert').textContent).toContain(
        'Navigated health failure',
      );
    });
  }
});

describe('BATrace status indicator', () => {
  it('shows every endpoint before the first check and runs checks inside the details without duplicate requests', async () => {
    const pending = deferred<RpcOutputs['api.health']>();
    const onCheck = vi.fn(() => pending.promise);
    const native = nativeFixture(bootstrapForApp());
    render(<BatraceStatus health={{ state: 'unknown', at: 0, checks: [] }} onCheck={onCheck} />, {
      wrapper: wrapper(native.api),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'BATrace · 未知' }));
    const details = within(explanation());
    expect(details.getAllByText('未检查')).toHaveLength(5);
    expect(details.getByText('/api/players/search')).toBeTruthy();
    expect(details.getByText('/api/match')).toBeTruthy();
    const check = details.getByRole('button', { name: 'API 健康检查' });
    fireEvent.click(check);
    fireEvent.click(check);
    await waitFor(() => expect(onCheck).toHaveBeenCalledTimes(1));
    expect(check.getAttribute('aria-busy')).toBe('true');
    await act(async () =>
      pending.resolve({
        state: 'ok',
        at: 1000,
        checks: [
          '/api/players/search',
          '/api/players/info',
          '/api/leaderboard/ban',
          '/api/players/matches',
          '/api/match',
        ].map((path) => ({ path, ok: true, ms: 12, status: 200 })),
      }),
    );
    expect(screen.getByRole('button', { name: 'BATrace · 服务可用' })).toBeTruthy();
    expect(details.getAllByText('HTTP 200 · 12 ms')).toHaveLength(5);
    expect(check.getAttribute('aria-busy')).toBe('false');
  });

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
    const tooltip = within(explanation());
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
      expect(trigger.querySelector('[data-slot=badge]')?.getAttribute('data-variant')).toBe(
        ok ? 'warning' : 'destructive',
      );
      fireEvent.click(trigger);
      const tooltip = explanation();
      const blocked = within(tooltip).getByText('被 Cloudflare 拦截');
      const fallback = within(tooltip).getByText(ok ? 'fallback 成功' : 'fallback 失败');
      expect(blocked.className).toBe(ok ? 'text-warning' : 'text-danger');
      expect(fallback.className).toBe(ok ? 'text-success' : 'text-danger');
      expect(blocked.nextElementSibling).toBe(fallback);
      expect(within(tooltip).getByText('/player/8863')).toBeTruthy();
      expect(within(tooltip).getByText(`HTTP ${ok ? 200 : 403} · 200 ms`)).toBeTruthy();
    },
  );

  it('shows endpoint diagnostics in the native popover and dismisses on Escape or outside press', async () => {
    const user = userEvent.setup();
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
    await user.click(trigger);
    const tooltip = explanation();
    expect(trigger.getAttribute('aria-controls')).toBe(tooltip.id);
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
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger);
    expect(explanation()).toBeTruthy();
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<BatraceStatus health={{ state: 'unknown', at: 0, checks: [] }} />);
    await user.click(trigger);
    expect(within(explanation()).getByText('尚无检查结果。')).toBeTruthy();
  });

  it('shows readable state and matching dot colors as health events arrive', async () => {
    const initial = bootstrapForApp();
    initial.health = { state: 'unknown', at: 0, checks: [] };
    const native = nativeFixture(initial);
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByText('BATrace');
    const badge = screen.getByRole('button', { name: 'BATrace · 未知' });
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
      expect(badge.querySelector('[data-slot=badge]')?.getAttribute('data-variant')).toBe(
        tone === 'success'
          ? 'success'
          : tone === 'danger'
            ? 'destructive'
            : tone === 'warning'
              ? 'warning'
              : 'secondary',
      );
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
    expect(check.closest('[data-slot=sidebar-footer]')).not.toBeNull();
    expect(check.querySelector('svg')).not.toBeNull();
    fireEvent.click(check);
    expect(check.querySelector('[data-slot=spinner]')).not.toBeNull();
    expect(check.getAttribute('aria-disabled')).toBe('true');
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
    expect(download.querySelector('svg')).not.toBeNull();
    expect(download.textContent).toContain('下载更新');
    act(() => download.focus());
    expect(explanation().textContent).toContain('下载完成后，点击“重启并安装”应用更新');
    fireEvent.blur(download);
    expect(f.calls.some((call) => call.method === 'updates.download')).toBe(false);
    fireEvent.click(download);
    await waitFor(() =>
      expect(f.calls.filter((call) => call.method === 'updates.download')).toHaveLength(1),
    );
    expect(screen.queryByRole('main', { name: '设置' })).toBeNull();
  });

  it('shows native download progress and installs only after clicking the ready button', async () => {
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
    expect(download.getAttribute('aria-disabled')).toBe('true');
    expect(download.textContent).toBe('正在下载更新…');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('37');
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
    expect(install.getAttribute('aria-disabled')).toBe('false');
    expect(install.querySelector('svg')).not.toBeNull();
    expect(install.textContent).toContain('重启并安装');
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
      screen.getByRole('button', { name: '正在保存数据并重启安装…' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(install.querySelector('[data-slot=spinner]')).not.toBeNull();
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
    fireEvent.click(await screen.findByRole('button', { name: '重试下载' }));
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
    const download = screen.getByRole('button', { name: '打开下载页面' });
    act(() => download.focus());
    expect(explanation().textContent).toContain('便携版');
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
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('37');
    act(() =>
      f.emit({
        type: 'updates',
        updates: { ...initial.updates, status: 'downloaded', downloadPercent: 100 },
        revision: 2,
      }),
    );
    const install = screen.getByRole('button', { name: '重启并安装' }) as HTMLButtonElement;
    expect(install.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('更新已就绪，请在对局和录制结束后点击“重启并安装”。')).toBeTruthy();
    act(() =>
      f.emit({ type: 'session', session: { ...initial.session, current: null }, revision: 3 }),
    );
    expect(install.getAttribute('aria-disabled')).toBe('false');
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
    expect(screen.queryByRole('alert')).toBeNull();
    expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
    await waitFor(() =>
      expect(f.calls.some((call) => call.method === 'updates.download')).toBe(true),
    );
  });
});

describe('update feedback and guarded actions', () => {
  const controllers: UpdateController[] = [];
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose();
  });
  class Engine extends EventEmitter {
    autoDownload = true;
    autoInstallOnAppQuit = true;
    allowPrerelease = true;
    allowDowngrade = true;
    channel: string | null = null;
    checkForUpdates = vi.fn<UpdateEngine['checkForUpdates']>(async () => {
      const info = { version: '4.5.2', files: [], releaseDate: '2026-10-29', path: '', sha512: '' };
      return { isUpdateAvailable: true, updateInfo: info, versionInfo: info };
    });
    downloadUpdate = vi.fn<UpdateEngine['downloadUpdate']>(async () => [
      'controlled-installer.exe',
    ]);
    quitAndInstall = vi.fn<UpdateEngine['quitAndInstall']>();
  }
  async function fixture(
    lang: 'zh' | 'en',
    ready = false,
    mode: 'installed' | 'portable' = 'installed',
  ) {
    const engine = new Engine(),
      canInstall = vi.fn(() => true),
      prepareInstall = vi.fn(async (_version: string) => {}),
      open = vi.fn(async () => null);
    let native: ReturnType<typeof nativeFixture> | undefined;
    const controller = new UpdateController({
      version: '4.5.1',
      mode,
      engine,
      canInstall,
      prepareInstall,
      installFailed: vi.fn(),
      emit: (updates) =>
        native?.emit({ type: 'updates', updates, revision: native.backend.revision + 1 }),
    });
    controllers.push(controller);
    await controller.check();
    if (ready) await controller.download();
    const initial = bootstrapForApp();
    initial.config.lang = lang;
    initial.session.current = null;
    initial.recording.phase = 'idle';
    initial.updates = controller.status();
    const handlers = {
      'updates.check': () => controller.check(),
      'updates.download': () => controller.download(),
      'updates.install': () => controller.install(),
      'updates.openDownload': () => open(),
    };
    native = nativeFixture(initial, handlers);
    return { native, engine, controller, canInstall, prepareInstall, open, handlers };
  }
  const view = (placement: 'sidebar' | 'settings') =>
    placement === 'sidebar' ? <UpdateButton /> : <UpdatePanel />;
  const updateDescription = (button: HTMLElement) =>
    (button.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
  const toastContains = (text: string) =>
    [...document.querySelectorAll('[data-sonner-toast]')].some((node) =>
      node.textContent?.includes(text),
    );
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    for (const placement of ['sidebar', 'settings'] as const) {
      for (const blocker of ['match', 'starting', 'recording', 'stopping'] as const) {
        it(`explains ${blocker} blocking and recovers the ${placement} install action in ${lang}`, async () => {
          const f = await fixture(lang, true);
          if (blocker === 'match')
            f.native.backend.session.current = { ...capturedMatches[0]!, endedAt: null };
          else f.native.backend.recording.phase = blocker;
          render(view(placement), { wrapper: wrapper(f.native.api) });
          const button = await screen.findByRole('button', { name: text('updateInstall') });
          expect(button.getAttribute('aria-disabled')).toBe('true');
          expect(updateDescription(button)).toContain(text('updateBlocked'));
          if (placement === 'sidebar')
            expect(
              screen.getByRole('region', { name: text('updateStatusLabel') }).textContent,
            ).toContain(text('updateBlocked'));
          button.focus();
          await userEvent.keyboard(' {Enter}');
          expect(f.native.calls.filter((call) => call.method === 'updates.install')).toHaveLength(
            0,
          );
          act(() =>
            f.native.emit({
              type: 'session',
              session: { ...f.native.backend.session, current: null },
              revision: f.native.backend.revision + 1,
            }),
          );
          act(() =>
            f.native.emit({
              type: 'recording',
              recording: { ...f.native.backend.recording, phase: 'idle' },
              revision: f.native.backend.revision + 1,
            }),
          );
          expect(button.getAttribute('aria-disabled')).toBe('false');
          expect(document.activeElement).toBe(button);
          await userEvent.keyboard(' ');
          await waitFor(() => expect(f.engine.quitAndInstall).toHaveBeenCalledTimes(1));
          expect(f.native.calls.filter((call) => call.method === 'updates.install')).toHaveLength(
            1,
          );
          expect(f.prepareInstall).toHaveBeenCalledTimes(1);
        });
      }
      for (const stage of ['entry', 'scheduled'] as const) {
        it(`explains a backend ${stage} rejection and retries through ${placement} in ${lang}`, async () => {
          const f = await fixture(lang, true);
          if (stage === 'scheduled') f.canInstall.mockReturnValueOnce(true).mockReturnValue(false);
          else f.canInstall.mockReturnValue(false);
          render(view(placement), { wrapper: wrapper(f.native.api) });
          await userEvent.click(await screen.findByRole('button', { name: text('updateInstall') }));
          const retry = await screen.findByRole('button', { name: text('updateRetryInstall') });
          await waitFor(() => expect(retry.getAttribute('aria-disabled')).toBe('false'));
          expect(updateDescription(retry)).toContain(text('updateInstallBlocked'));
          expect(f.controller.status()).toMatchObject({
            status: 'downloaded',
            installBlocked: true,
            availableVersion: '4.5.2',
          });
          expect(f.prepareInstall).not.toHaveBeenCalled();
          expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
          f.canInstall.mockReturnValue(true);
          retry.focus();
          await userEvent.keyboard(' ');
          await waitFor(() => expect(f.engine.quitAndInstall).toHaveBeenCalledTimes(1));
          expect(f.controller.status().installBlocked).toBe(false);
          expect(f.native.calls.filter((call) => call.method === 'updates.install')).toHaveLength(
            2,
          );
        });
      }
      for (const gesture of ['pointer', 'keyboard'] as const) {
        it(`replaces the failed ${placement} download notification and rejects a held ${gesture} install in ${lang}`, async () => {
          const f = await fixture(lang);
          const cause = `Download failure ${lang} ${placement} ${gesture}`;
          f.engine.downloadUpdate.mockRejectedValueOnce(new Error(cause));
          render(view(placement), { wrapper: wrapper(f.native.api) });
          await userEvent.click(
            await screen.findByRole('button', { name: text('updateDownload') }),
          );
          await waitFor(() => expect(toastContains(cause)).toBe(true));
          const gate = deferred<string[]>();
          f.engine.downloadUpdate.mockReturnValueOnce(gate.promise);
          const retry = screen.getByRole('button', { name: text('updateRetryDownload') });
          await userEvent.click(retry);
          await waitFor(() => expect(f.engine.downloadUpdate).toHaveBeenCalledTimes(2));
          await waitFor(() => expect(toastContains(cause)).toBe(false));
          expect(document.activeElement).toBe(retry);
          expect(retry.getAttribute('aria-disabled')).toBe('true');
          if (gesture === 'pointer')
            fireEvent.pointerDown(retry, { button: 0, pointerType: 'mouse' });
          else await userEvent.keyboard('[Space>]');
          await act(async () => gate.resolve(['controlled-installer.exe']));
          await waitFor(() => expect(retry.getAttribute('aria-disabled')).toBe('false'));
          if (gesture === 'pointer') {
            fireEvent.pointerUp(retry, { button: 0, pointerType: 'mouse' });
            fireEvent.click(retry);
          } else await userEvent.keyboard('[/Space]');
          expect(f.native.calls.filter((call) => call.method === 'updates.install')).toHaveLength(
            0,
          );
          expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
          expect(f.controller.status().status).toBe('downloaded');
          await waitFor(() => expect(toastContains(text('updateDownloaded'))).toBe(true));
          expect(toastContains(cause)).toBe(false);
          expect(screen.queryByText(cause)).toBeNull();
        });
      }
      it(`describes portable downloads consistently in ${placement} in ${lang}`, async () => {
        const f = await fixture(lang, false, 'portable');
        render(view(placement), { wrapper: wrapper(f.native.api) });
        const button = await screen.findByRole('button', { name: text('updateReleasePage') });
        expect(screen.queryByRole('button', { name: text('updateDownload') })).toBeNull();
        expect(screen.getByText(text('updatePortable'))).toBeTruthy();
        button.focus();
        await userEvent.keyboard(' ');
        await waitFor(() => expect(f.open).toHaveBeenCalledTimes(1));
        expect(f.engine.downloadUpdate).not.toHaveBeenCalled();
        expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
      });
      it(`confirms a lost download reply from the native event in ${placement} in ${lang}`, async () => {
        const f = await fixture(lang);
        f.handlers['updates.download'] = async () => {
          await f.controller.download();
          throw new Error('Update response lost');
        };
        render(view(placement), { wrapper: wrapper(f.native.api) });
        await userEvent.click(await screen.findByRole('button', { name: text('updateDownload') }));
        await screen.findByRole('button', { name: text('updateInstall') });
        await waitFor(() => expect(toastContains(text('updateDownloaded'))).toBe(true));
        expect(toastContains('Update response lost')).toBe(false);
        expect(screen.queryByText('Update response lost')).toBeNull();
        expect(f.engine.downloadUpdate).toHaveBeenCalledTimes(1);
      });
      it(`recovers an external-download request failure in ${placement} in ${lang}`, async () => {
        const f = await fixture(lang, false, 'portable');
        const cause = `Downloads request failed ${lang} ${placement}`;
        f.open.mockRejectedValueOnce(new Error(cause));
        render(view(placement), { wrapper: wrapper(f.native.api) });
        const button = await screen.findByRole('button', { name: text('updateReleasePage') });
        await userEvent.click(button);
        await waitFor(() => expect(toastContains(cause)).toBe(true));
        await userEvent.click(button);
        await waitFor(() => expect(f.open).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(toastContains(cause)).toBe(false));
        expect(screen.queryByText(cause)).toBeNull();
        expect(f.engine.downloadUpdate).not.toHaveBeenCalled();
      });
    }
    it(`shares a pending download across sidebar and settings in ${lang}`, async () => {
      const f = await fixture(lang);
      const gate = deferred<string[]>();
      f.engine.downloadUpdate.mockReturnValueOnce(gate.promise);
      render(
        <>
          <UpdateButton />
          <UpdatePanel />
        </>,
        { wrapper: wrapper(f.native.api) },
      );
      const buttons = await screen.findAllByRole('button', { name: text('updateDownload') });
      fireEvent.click(buttons[0]!);
      fireEvent.click(buttons[1]!);
      expect(f.engine.downloadUpdate).toHaveBeenCalledTimes(1);
      for (const button of buttons) expect(button.getAttribute('aria-disabled')).toBe('true');
      await act(async () => gate.resolve(['controlled-installer.exe']));
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: text('updateInstall') })).toHaveLength(2),
      );
      expect(f.native.calls.filter((call) => call.method === 'updates.download')).toHaveLength(1);
    });
  }
});

describe('first-launch analytics consent', () => {
  it.each([true, false])(
    'persists an explicit %s decision and does not prompt again',
    async (enabled) => {
      const initial = bootstrapForApp();
      initial.config.analyticsEnabled = true;
      initial.config.analyticsChoiceSaved = false;
      const native = nativeFixture(initial);
      const mounted = render(<App />, { wrapper: wrapper(native.api) });
      const dialog = await screen.findByRole('dialog', {
        name: translate('zh', 'analyticsConsentTitle'),
      });
      expect(within(dialog).getByText(translate('zh', 'analyticsConsentPrompt'))).toBeTruthy();
      expect(within(dialog).queryByRole('button', { name: translate('zh', 'close') })).toBeNull();
      await userEvent.setup().keyboard('{Escape}');
      expect(
        screen.getByRole('dialog', { name: translate('zh', 'analyticsConsentTitle') }),
      ).toBeTruthy();
      expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(0);
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: translate('zh', enabled ? 'analyticsConsentAccept' : 'analyticsConsentDecline'),
        }),
      );
      await waitFor(() =>
        expect(native.backend.config).toMatchObject({
          analyticsEnabled: enabled,
          analyticsChoiceSaved: true,
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: translate('zh', 'analyticsConsentTitle') }),
        ).toBeNull(),
      );
      mounted.unmount();
      render(<App />, { wrapper: wrapper(native.api) });
      await screen.findByText('监听中');
      expect(
        screen.queryByRole('dialog', { name: translate('zh', 'analyticsConsentTitle') }),
      ).toBeNull();
    },
  );

  it('keeps the consent dialog open after a failed save and allows retrying the same choice', async () => {
    const initial = bootstrapForApp();
    initial.config.analyticsEnabled = true;
    initial.config.analyticsChoiceSaved = false;
    let fail = true;
    const native = nativeFixture(initial, {
      'config.update': async (patch) => {
        if (fail) {
          fail = false;
          throw new Error('Disk is busy');
        }
        const config = configSchema.parse({ ...native.backend.config, ...patch });
        native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
        return config;
      },
    });
    render(<App />, { wrapper: wrapper(native.api) });
    const dialog = within(
      await screen.findByRole('dialog', { name: translate('zh', 'analyticsConsentTitle') }),
    );
    fireEvent.click(
      dialog.getByRole('button', { name: translate('zh', 'analyticsConsentAccept') }),
    );
    expect((await dialog.findByRole('alert')).textContent).toContain('Disk is busy');
    expect(native.backend.config.analyticsChoiceSaved).toBe(false);
    fireEvent.click(
      dialog.getByRole('button', { name: translate('zh', 'analyticsConsentAccept') }),
    );
    await waitFor(() => expect(native.backend.config.analyticsChoiceSaved).toBe(true));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: translate('zh', 'analyticsConsentTitle') }),
      ).toBeNull(),
    );
  });
});

describe('consent recovery and saved configuration confirmation', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`keeps a rejected reversal open after confirming the opposite stored choice in ${lang}`, async () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.analyticsEnabled = false;
      value.config.analyticsChoiceSaved = false;
      let writes = 0,
        readable = false;
      const native = nativeFixture(value, {
        'config.update': (patch) => {
          writes++;
          if (writes === 2) throw new Error('Opposite choice rejected');
          const config = configSchema.parse({ ...native.backend.config, ...patch });
          native.backend.config = config;
          if (writes === 1) throw new Error('First response lost');
          native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
          return config;
        },
        'config.read': () => {
          if (!readable) throw new Error('Confirmation unavailable');
          native.emit({
            type: 'config',
            config: native.backend.config,
            revision: native.backend.revision + 1,
          });
          return { config: native.backend.config, revision: native.backend.revision };
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      const text = (key: string) => translate(lang, key);
      const root = await screen.findByRole('dialog', { name: text('analyticsConsentTitle') });
      const dialog = within(root);
      await userEvent.click(dialog.getByRole('button', { name: text('analyticsConsentAccept') }));
      await dialog.findByText(text('settingsSaveUnconfirmed'));
      readable = true;
      const decline = dialog.getByRole('button', { name: text('analyticsConsentDecline') });
      decline.focus();
      await userEvent.keyboard(' ');
      await dialog.findByText('Opposite choice rejected');
      expect(root.isConnected).toBe(true);
      expect(document.activeElement).toBe(decline);
      expect(native.backend.config).toMatchObject({
        analyticsEnabled: true,
        analyticsChoiceSaved: true,
      });
      expect(writes).toBe(2);
      await userEvent.keyboard(' ');
      await waitFor(() => expect(root.isConnected).toBe(false));
      expect(native.backend.config).toMatchObject({
        analyticsEnabled: false,
        analyticsChoiceSaved: true,
      });
      expect(writes).toBe(3);
    });
  }
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.analyticsEnabled = false;
      value.config.analyticsChoiceSaved = false;
      return value;
    };
    for (const enabled of [false, true]) {
      const label = text(enabled ? 'analyticsConsentAccept' : 'analyticsConsentDecline');
      it(`preserves the ${enabled} choice focus, details and reversal after failed saves in ${lang}`, async () => {
        const gate = deferred<RpcOutputs['config.update']>();
        let attempts = 0;
        const native = nativeFixture(initial(), {
          'config.update': (patch) => {
            if (++attempts === 1) return gate.promise;
            const config = configSchema.parse({ ...native.backend.config, ...patch });
            native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
            return config;
          },
        });
        render(<App />, { wrapper: wrapper(native.api) });
        const root = await screen.findByRole('dialog', { name: text('analyticsConsentTitle') });
        const dialog = within(root);
        const descriptions = (root.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id));
        expect(descriptions.every(Boolean)).toBe(true);
        expect(descriptions.map((node) => node?.textContent).join(' ')).toBe(
          text('analyticsConsentSummary'),
        );
        const details = dialog.getByRole('region', { name: text('analyticsConsentDetails') });
        for (const key of [
          'analyticsConsentPrompt',
          'analyticsDescription',
          'analyticsPrivacy',
          'analyticsConsentChangeLater',
        ])
          expect(within(details).getByText(text(key))).toBeTruthy();
        const decline = dialog.getByRole('button', { name: text('analyticsConsentDecline') });
        await waitFor(() => expect(document.activeElement).toBe(decline));
        const choice = dialog.getByRole('button', { name: label });
        expect(details.contains(choice)).toBe(false);
        choice.focus();
        await userEvent.keyboard(' ');
        expect(choice.getAttribute('aria-busy')).toBe('true');
        expect(
          dialog.getByRole('status', { name: text('analyticsConsentFeedback') }).textContent,
        ).toBe(text('analyticsConsentSaving'));
        expect(document.activeElement).toBe(choice);
        for (const button of [
          decline,
          dialog.getByRole('button', { name: text('analyticsConsentAccept') }),
        ])
          expect(button.getAttribute('aria-disabled')).toBe('true');
        await userEvent.keyboard('{Enter} ');
        expect(attempts).toBe(1);
        await act(async () => gate.reject(new Error('Consent write rejected')));
        await dialog.findByText('Consent write rejected');
        expect(
          dialog.getByRole('status', { name: text('analyticsConsentFeedback') }).textContent,
        ).toBe(text('analyticsConsentSaveFailed'));
        expect(document.activeElement).toBe(choice);
        const feedbackDetails = dialog.getByRole('button', {
          name: text('analyticsConsentFeedbackDetails'),
        });
        await userEvent.click(feedbackDetails);
        expect(document.activeElement).toBe(details);
        expect(native.calls.filter((call) => call.method === 'config.read')).toHaveLength(1);
        const opposite = dialog.getByRole('button', {
          name: text(enabled ? 'analyticsConsentDecline' : 'analyticsConsentAccept'),
        });
        opposite.focus();
        await userEvent.keyboard(' ');
        await waitFor(() =>
          expect(screen.queryByRole('dialog', { name: text('analyticsConsentTitle') })).toBeNull(),
        );
        expect(native.backend.config).toMatchObject({
          analyticsEnabled: !enabled,
          analyticsChoiceSaved: true,
        });
        expect(attempts).toBe(2);
      });
      for (const eventFirst of [true, false]) {
        it(`confirms committed ${enabled} consent without rewriting, eventFirst=${eventFirst} in ${lang}`, async () => {
          const native = nativeFixture(initial(), {
            'config.update': (patch) => {
              const config = configSchema.parse({ ...native.backend.config, ...patch });
              native.backend.config = config;
              if (eventFirst)
                native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
              throw new Error('Consent acknowledgement lost');
            },
          });
          const mounted = render(<App />, { wrapper: wrapper(native.api) });
          const dialog = within(
            await screen.findByRole('dialog', { name: text('analyticsConsentTitle') }),
          );
          await userEvent.click(dialog.getByRole('button', { name: label }));
          await waitFor(() =>
            expect(
              screen.queryByRole('dialog', { name: text('analyticsConsentTitle') }),
            ).toBeNull(),
          );
          expect(native.backend.config).toMatchObject({
            analyticsEnabled: enabled,
            analyticsChoiceSaved: true,
          });
          expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
          expect(native.calls.filter((call) => call.method === 'config.read')).toHaveLength(1);
          expect(document.querySelector('[data-save-state]')?.getAttribute('data-save-state')).toBe(
            'saved',
          );
          expect(screen.queryByText('Consent acknowledgement lost')).toBeNull();
          mounted.unmount();
          render(<App />, { wrapper: wrapper(native.api) });
          await screen.findByRole('main');
          expect(screen.queryByRole('dialog', { name: text('analyticsConsentTitle') })).toBeNull();
        });
      }
      for (const lateEvent of [false, true]) {
        it(`recovers unconfirmed ${enabled} consent by ${lateEvent ? 'late event' : 'read-only retry'} in ${lang}`, async () => {
          let readable = false;
          const native = nativeFixture(initial(), {
            'config.update': (patch) => {
              native.backend.config = configSchema.parse({ ...native.backend.config, ...patch });
              throw new Error('Consent response unavailable');
            },
            'config.read': () => {
              if (!readable) throw new Error('Saved configuration unavailable');
              native.emit({
                type: 'config',
                config: native.backend.config,
                revision: native.backend.revision + 1,
              });
              return { config: native.backend.config, revision: native.backend.revision };
            },
          });
          render(<App />, { wrapper: wrapper(native.api) });
          const dialog = within(
            await screen.findByRole('dialog', { name: text('analyticsConsentTitle') }),
          );
          const choice = dialog.getByRole('button', { name: label });
          choice.focus();
          await userEvent.keyboard(' ');
          await dialog.findByText(text('settingsSaveUnconfirmed'));
          expect(dialog.getByText(text('analyticsConsentUnconfirmedHint'))).toBeTruthy();
          expect(document.activeElement).toBe(choice);
          expect(document.querySelector('[data-save-state]')?.getAttribute('data-save-state')).toBe(
            'unconfirmed',
          );
          if (lateEvent) {
            act(() =>
              native.emit({
                type: 'config',
                config: native.backend.config,
                revision: native.backend.revision + 1,
              }),
            );
          } else {
            await userEvent.keyboard(' ');
            await waitFor(() =>
              expect(native.calls.filter((call) => call.method === 'config.read')).toHaveLength(2),
            );
            await dialog.findByText(text('settingsSaveUnconfirmed'));
            expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
            readable = true;
            await userEvent.keyboard(' ');
          }
          await waitFor(() =>
            expect(
              screen.queryByRole('dialog', { name: text('analyticsConsentTitle') }),
            ).toBeNull(),
          );
          expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
          expect(document.querySelector('[data-save-state]')?.getAttribute('data-save-state')).toBe(
            'saved',
          );
        });
      }
    }
  }
  it('preserves newer pending fields when a committed older save loses its response', async () => {
    const gate = deferred<RpcOutputs['config.update']>();
    let writes = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'config.update': (patch) => {
        if (++writes === 1) return gate.promise;
        const config = configSchema.parse({ ...native.backend.config, ...patch });
        native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
        return config;
      },
    });
    const { result } = renderHook(() => useApp().settings, { wrapper: wrapper(native.api) });
    await waitFor(() => expect(result.current.confirmed).toBeTruthy());
    act(() => result.current.change({ darkTheme: 'forest' }));
    act(() => result.current.change({ decksDir: 'G:\\Pending\\Decks' }));
    native.backend.config = { ...native.backend.config, darkTheme: 'forest' };
    await act(async () => gate.reject(new Error('Old response lost')));
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(result.current.draft).toMatchObject({
      darkTheme: 'forest',
      decksDir: 'G:\\Pending\\Decks',
    });
    expect(
      native.calls.filter((call) => call.method === 'config.update').map((call) => call.input),
    ).toEqual([{ darkTheme: 'forest' }, { decksDir: 'G:\\Pending\\Decks' }]);
  });
  it('rejects a stale confirmation reply after a newer configuration event', async () => {
    const read = deferred<RpcOutputs['config.read']>();
    const native = nativeFixture(bootstrapForApp(), {
      'config.update': () => Promise.reject(new Error('Response lost')),
      'config.read': () => read.promise,
    });
    const { result } = renderHook(() => useApp().settings, { wrapper: wrapper(native.api) });
    await waitFor(() => expect(result.current.confirmed).toBeTruthy());
    act(() => result.current.change({ darkTheme: 'forest' }));
    await waitFor(() =>
      expect(native.calls.some((call) => call.method === 'config.read')).toBe(true),
    );
    const snapshot = {
      config: { ...native.backend.config, darkTheme: 'forest' as const },
      revision: native.backend.revision + 1,
    };
    act(() =>
      native.emit({
        type: 'config',
        config: { ...native.backend.config, darkTheme: 'ocean' },
        revision: snapshot.revision + 1,
      }),
    );
    await act(async () => read.resolve(snapshot));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.confirmed?.darkTheme).toBe('ocean');
    expect(result.current.draft?.darkTheme).toBe('forest');
    await act(async () => result.current.discard());
    expect(result.current.draft?.darkTheme).toBe('ocean');
    expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
  });
  for (const readable of [false, true]) {
    it(`discards uncertain local edits without undoing an applied choice, readable=${readable}`, async () => {
      let available = false;
      const native = nativeFixture(bootstrapForApp(), {
        'config.update': (patch) => {
          native.backend.config = configSchema.parse({ ...native.backend.config, ...patch });
          throw new Error('Response lost');
        },
        'config.read': () => {
          if (!available) throw new Error('Read unavailable');
          native.emit({
            type: 'config',
            config: native.backend.config,
            revision: native.backend.revision + 1,
          });
          return { config: native.backend.config, revision: native.backend.revision };
        },
      });
      const { result } = renderHook(() => useApp().settings, { wrapper: wrapper(native.api) });
      await waitFor(() => expect(result.current.confirmed).toBeTruthy());
      act(() => result.current.change({ darkTheme: 'forest' }));
      await waitFor(() => expect(result.current.status).toBe('unconfirmed'));
      available = readable;
      await act(async () => result.current.discard());
      expect(result.current.status).toBe(readable ? 'saved' : 'unconfirmed');
      available = true;
      await act(async () => result.current.flush());
      expect(result.current.status).toBe('saved');
      expect(result.current.draft?.darkTheme).toBe('forest');
      expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
    });
  }
  it('keeps a preparation failure separate from an uncertain native write', async () => {
    const native = nativeFixture(bootstrapForApp());
    const { result } = renderHook(() =>
      useSettingsAutosave(native.api, native.backend.config, async () => {
        throw new Error('Preparation blocked');
      }),
    );
    act(() => result.current.change({ darkTheme: 'forest' }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Preparation blocked');
    expect(
      native.calls.filter((call) => ['config.read', 'config.update'].includes(call.method)),
    ).toHaveLength(0);
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
      // A cold CI worker also transforms the lazy settings module on this first navigation.
      const settings = within(await screen.findByRole('main', { name: '设置' }, { timeout: 5000 }));
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
        within(screen.getByRole('navigation', { name: '工作空间' })).queryByRole('button', {
          name: '关于',
        }),
      ).toBeNull();
    },
  );

  it('keeps updates in General settings and download and project links working', async () => {
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
    await screen.findByText('监听中');
    expect(screen.queryByRole('button', { name: '查看更新' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const settings = within(await screen.findByRole('main', { name: '设置' }));
    fireEvent.click(screen.getByRole('tab', { name: '常规' }));
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

  const cacheStats = {
    at: Date.now(),
    nextExpiryAt: null,
    api: { entries: 3, expired: 2, bytes: 2048 },
    snapshots: { entries: 2, expired: 1, bytes: 1024 },
  };

  it('opens the cache settings route and updates usage after cleaning expired entries', async () => {
    window.history.replaceState(null, '', '#settings/cache');
    const clearing = deferred<RpcOutputs['cache.clear']>();
    const native = nativeFixture(bootstrapForApp(), {
      'cache.stats': () => cacheStats,
      'cache.clear': () => clearing.promise,
    });
    render(<App />, { wrapper: wrapper(native.api) });
    const panel = within(await screen.findByRole('tabpanel', { name: '缓存' }));
    expect(screen.getByRole('tab', { name: '缓存' }).getAttribute('aria-selected')).toBe('true');
    expect(await panel.findByText('3 KB')).toBeTruthy();
    expect(panel.getByText('3 条 · 2 条已过期')).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: '清理过期缓存' }));
    await waitFor(() =>
      expect(
        native.calls.filter((call) => call.method === 'cache.clear').map((call) => call.input),
      ).toEqual([{ mode: 'expired' }]),
    );
    expect(
      panel.getByRole('button', { name: '清空全部缓存' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    expect(
      panel.getByRole('button', { name: '刷新' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    clearing.resolve({
      removed: 3,
      stats: {
        at: Date.now(),
        nextExpiryAt: null,
        api: { entries: 1, expired: 0, bytes: 1024 },
        snapshots: { entries: 1, expired: 0, bytes: 512 },
      },
    });
    expect(await panel.findByText('已清理 3 条缓存。')).toBeTruthy();
    expect(
      panel.getByRole('button', { name: '清理过期缓存' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    expect(
      panel.getByRole('button', { name: '清空全部缓存' }).getAttribute('aria-disabled') === 'true',
    ).toBe(false);
  });

  it('requires confirmation to clear all cache and keeps cancellation harmless', async () => {
    const user = userEvent.setup();
    const native = nativeFixture(bootstrapForApp(), {
      'cache.stats': () => cacheStats,
      'cache.clear': () => ({
        removed: 5,
        stats: {
          at: Date.now(),
          nextExpiryAt: null,
          api: { entries: 0, expired: 0, bytes: 0 },
          snapshots: { entries: 0, expired: 0, bytes: 0 },
        },
      }),
    });
    await openSettings(native);
    expect(native.calls.some((call) => call.method === 'cache.stats')).toBe(false);
    await user.click(screen.getByRole('tab', { name: '缓存' }));
    const panel = within(screen.getByRole('tabpanel', { name: '缓存' }));
    await panel.findByText('3 KB');
    const clear = panel.getByRole('button', { name: '清空全部缓存' });
    await user.click(clear);
    let dialog = within(await screen.findByRole('alertdialog', { name: '清空全部缓存' }));
    expect(dialog.getByText(translate('zh', 'cachePreserved'))).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: '取消' }));
    expect(native.calls.some((call) => call.method === 'cache.clear')).toBe(false);
    await user.click(clear);
    dialog = within(await screen.findByRole('alertdialog', { name: '清空全部缓存' }));
    await user.click(dialog.getByRole('button', { name: '清空全部缓存' }));
    expect(await panel.findByText('已清理 5 条缓存。')).toBeTruthy();
    expect(
      panel.getByRole('button', { name: '清空全部缓存' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    expect(
      native.calls.filter((call) => call.method === 'cache.clear').map((call) => call.input),
    ).toEqual([{ mode: 'all' }]);
  });

  it('allows retry after cache loading or cleanup fails without displaying false success', async () => {
    let available = false;
    const native = nativeFixture(bootstrapForApp(), {
      'cache.stats': () => {
        if (!available) throw new Error('Cache statistics unavailable');
        return cacheStats;
      },
      'cache.clear': () => {
        throw new Error('Cache cleanup failed');
      },
    });
    await openSettings(native);
    fireEvent.click(screen.getByRole('tab', { name: '缓存' }));
    const panel = within(screen.getByRole('tabpanel', { name: '缓存' }));
    expect((await panel.findByRole('alert')).textContent).toContain('Cache statistics unavailable');
    expect(
      panel.getByRole('button', { name: '清空全部缓存' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    available = true;
    fireEvent.click(panel.getByRole('button', { name: '刷新' }));
    await panel.findByText('3 KB');
    fireEvent.click(panel.getByRole('button', { name: '清理过期缓存' }));
    expect((await panel.findByRole('alert')).textContent).toContain('Cache cleanup failed');
    expect(panel.queryByText('已清理 3 条缓存。')).toBeNull();
    expect(panel.getByText('3 条 · 2 条已过期')).toBeTruthy();
    expect(
      panel.getByRole('button', { name: '清理过期缓存' }).getAttribute('aria-disabled') === 'true',
    ).toBe(false);
  });

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
      within(screen.getByRole('navigation', { name: '工作空间' })).getByRole('button', {
        name: '玩家查询',
      }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: translate('zh', 'searchLabel') }), {
      target: { value: localPlayer.name },
    });
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const page = within(await screen.findByRole('main', { name: '设置' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(8);
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

  it('previews glass opacity in five-percent steps, saves it, and restores the default', async () => {
    const native = nativeFixture(bootstrapForApp());
    const page = await openSettings(native);
    const slider = page.getByRole('slider', { name: '玻璃不透明度' });
    const opacity = () => document.documentElement.style.getPropertyValue('--glass-opacity');
    const resetName = '恢复默认透明度（50%）';
    expect(page.getByRole('button', { name: resetName }).hasAttribute('disabled')).toBe(true);
    expect(slider.getAttribute('aria-valuemin')).toBe('40');
    expect(slider.getAttribute('aria-valuemax')).toBe('100');
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
    expect(slider.getAttribute('aria-valuetext')).toBe('50%');
    expect(opacity()).toBe('50%');
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
    expect(opacity()).toBe('100%');
    expect(document.documentElement.style.getPropertyValue('--glass-blur')).toBe('0px');
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuenow')).toBe('40');
    expect(opacity()).toBe('40%');
    expect(document.documentElement.style.getPropertyValue('--glass-blur')).toBe('');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(opacity()).toBe('45%');
    expect(slider.getAttribute('aria-valuetext')).toBe('45%');
    expect(page.getByRole('button', { name: resetName }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(native.backend.config.glassOpacity).toBe(45);
    expect(opacity()).toBe('45%');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const reopened = within(await screen.findByRole('main', { name: '设置' }));
    expect(
      reopened.getByRole('slider', { name: '玻璃不透明度' }).getAttribute('aria-valuetext'),
    ).toBe('45%');
    fireEvent.click(reopened.getByRole('radio', { name: '浅色' }));
    expect(opacity()).toBe('45%');
    fireEvent.click(reopened.getByRole('radio', { name: '深色' }));
    expect(opacity()).toBe('45%');
    fireEvent.click(reopened.getByRole('button', { name: resetName }));
    expect(opacity()).toBe('50%');
    expect(
      reopened.getByRole('slider', { name: '玻璃不透明度' }).getAttribute('aria-valuetext'),
    ).toBe('50%');
    expect(reopened.getByRole('button', { name: resetName }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(native.backend.config.glassOpacity).toBe(50));
  });

  it('previews and saves ELO color preferences and restores them after remounting', async () => {
    const native = nativeFixture(bootstrapForApp());
    const page = await openSettings(native);
    const group = within(page.getByRole('radiogroup', { name: 'ELO 涨跌配色' }));
    expect(group.getByRole('radio', { name: '涨绿跌红' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(document.documentElement.dataset.eloColorScheme).toBe('green-up');
    fireEvent.click(group.getByRole('radio', { name: '涨红跌绿' }));
    expect(document.documentElement.dataset.eloColorScheme).toBe('red-up');
    await waitFor(() => expect(native.backend.config.eloColorScheme).toBe('red-up'));
    expect(native.calls.filter((call) => call.method === 'config.update').at(-1)?.input).toEqual({
      eloColorScheme: 'red-up',
    });

    cleanup();
    render(<App />, { wrapper: wrapper(native.api) });
    const reopened = within(await screen.findByRole('radiogroup', { name: 'ELO 涨跌配色' }));
    expect(reopened.getByRole('radio', { name: '涨红跌绿' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(document.documentElement.dataset.eloColorScheme).toBe('red-up');
    fireEvent.click(reopened.getByRole('radio', { name: '涨红跌绿' }));
    expect(reopened.getByRole('radio', { name: '涨红跌绿' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(reopened.getByRole('radio', { name: '涨绿跌红' }));
    expect(document.documentElement.dataset.eloColorScheme).toBe('green-up');
    await waitFor(() => expect(native.backend.config.eloColorScheme).toBe('green-up'));
  });

  it('autosaves separate light and dark palettes and restores them when switching modes and reopening', async () => {
    const initial = bootstrapForApp();
    initial.config.themeMode = 'dark';
    const native = nativeFixture(initial);
    const page = await openSettings(native);
    expect(
      within(page.getByRole('radiogroup', { name: '主题' })).getAllByRole('radio'),
    ).toHaveLength(3);
    expect(page.getByRole('heading', { name: '主题', level: 3 })).toBeTruthy();
    expect(page.getByRole('heading', { name: '配色模式', level: 3 })).toBeTruthy();
    expect(
      within(page.getByRole('region', { name: '配色模式' })).getByRole('button', {
        name: '森林 · 浅色',
      }),
    ).toBeTruthy();
    expect(page.getAllByRole('radio')).toHaveLength(5);
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
    fireEvent.click(page.getByRole('radio', { name: '浅色' }));
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
          .getByRole('radio', { name: translate('zh', 'themeMode.' + mode) })
          .getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        native.calls
          .filter((call) => call.method === 'config.update')
          .every((call) => !Object.keys(call.input!).includes('themeMode')),
      ).toBe(true);
    },
  );

  it('keeps picked spheres selected, supports arrow-key selection and applies pairs from the card surface', async () => {
    const initial = bootstrapForApp();
    initial.config.themeMode = 'system';
    initial.config.lightTheme = 'forest';
    initial.config.darkTheme = 'violet';
    const native = nativeFixture(initial);
    const page = await openSettings(native);
    const user = userEvent.setup();
    const light = page.getByRole('button', { name: '森林 · 浅色' });
    const dark = page.getByRole('button', { name: '森林 · 深色' });
    light.focus();
    await user.keyboard(' ');
    expect(light.getAttribute('aria-pressed')).toBe('true');
    expect(native.calls.filter((call) => call.method === 'config.update')).toEqual([]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(dark);
    await user.keyboard(' ');
    await waitFor(() => expect(native.backend.config.darkTheme).toBe('forest'));
    expect(native.backend.config.themeMode).toBe('system');
    expect(light.getAttribute('aria-pressed')).toBe('true');
    expect(dark.getAttribute('aria-pressed')).toBe('true');
    expect(page.getByRole('button', { name: '紫夜 · 深色' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    const ocean = page.getByRole('button', { name: '深海 · 选择整组配色' });
    fireEvent.click(ocean.closest('[data-theme-library-card]')!);
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({
        lightTheme: 'ocean',
        darkTheme: 'ocean',
        themeMode: 'system',
      }),
    );
    expect(
      native.calls.filter((call) => call.method === 'config.update').map((call) => call.input),
    ).toEqual([{ darkTheme: 'forest' }, { lightTheme: 'ocean', darkTheme: 'ocean' }]);
  });

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

  it('follows the OS by default and uses each saved palette, including after leaving settings', async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, callback: (event: MediaQueryListEvent) => void) =>
        listeners.add(callback),
      removeEventListener: (_: string, callback: (event: MediaQueryListEvent) => void) =>
        listeners.delete(callback),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    const native = nativeFixture(bootstrapForApp());
    const page = await openSettings(native);
    expect(page.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(page.getByRole('button', { name: '森林 · 浅色' }));
    fireEvent.click(page.getByRole('button', { name: '深海 · 深色' }));
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
      listeners.forEach((callback) => callback({ matches: media.matches } as MediaQueryListEvent));
    });
    expect(document.documentElement.dataset).toMatchObject({ mode: 'dark', theme: 'ocean' });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    act(() => {
      media.matches = false;
      listeners.forEach((callback) => callback({ matches: media.matches } as MediaQueryListEvent));
    });
    expect(document.documentElement.dataset).toMatchObject({ mode: 'light', theme: 'forest' });
  });

  it('retains failed changes, displays the save error, and retries the same patch', async () => {
    let failed = false;
    const initial = bootstrapForApp();
    initial.config.themeMode = 'dark';
    const native = nativeFixture(initial, {
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
    const recovery = await reviewSettingsFailure();
    expect((await recovery.findByRole('alert')).textContent).toContain('Disk is busy');
    expect(native.backend.config.darkTheme).toBeUndefined();
    expect(document.documentElement.dataset).toMatchObject({ mode: 'dark', theme: 'forest' });
    fireEvent.click(recovery.getByRole('button', { name: '重试保存' }));
    await waitFor(() =>
      expect(native.backend.config).toMatchObject({ darkTheme: 'forest', themeMode: 'dark' }),
    );
    await waitFor(() => expect(recovery.queryByRole('alert')).toBeNull());
    expect(
      page.getByRole('status', { name: translate('zh', 'settingsSaveStatus') }).textContent,
    ).toBe('已自动保存');
  });

  it('serializes saves and keeps the newest choices visible when an older save completes', async () => {
    const writes: Array<{
      patch: RpcInputs['config.update'];
      result: ReturnType<typeof deferred<Bootstrap['config']>>;
    }> = [];
    const initial = bootstrapForApp();
    initial.config.themeMode = 'dark';
    const native = nativeFixture(initial, {
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
    expect(
      page.getByRole('status', { name: translate('zh', 'settingsSaveStatus') }).textContent,
    ).toBe('已自动保存');
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
    const workspaceToggle = screen.getByRole('button', { name: '折叠侧边栏' });
    expect(workspaceToggle.closest('.topbar')).not.toBeNull();
    expect(workspaceToggle.getAttribute('aria-controls')).toBe('workspace-sidebar');
    expect(workspaceToggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(workspaceToggle);
    await waitFor(() => expect(native.backend.config.sidebarCollapsed).toBe(true));
    expect(workspaceToggle.getAttribute('aria-expanded')).toBe('false');
    expect(Boolean(document.querySelector('[data-slot=sidebar][data-state=collapsed]'))).toBe(true);
    expect(document.getElementById('workspace-sidebar')?.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull();
    history.replaceState(null, '', '#settings/appearance');
    fireEvent(window, new HashChangeEvent('hashchange'));
    await screen.findByRole('main', { name: '设置' });
    expect(
      Boolean(document.querySelector('.settings-page [data-slot=sidebar][data-state=collapsed]')),
    ).toBe(true);
    const settingsToggle = screen.getByRole('button', { name: '展开侧边栏' });
    expect(settingsToggle.closest('.settings-page-toolbar')).not.toBeNull();
    expect(settingsToggle.getAttribute('aria-controls')).toBe('settings-sidebar');
    fireEvent.click(settingsToggle);
    await waitFor(() => expect(native.backend.config.sidebarCollapsed).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-collapsed')).toBe(
      false,
    );
  });

  it('keeps analytics opt-in and saves keyboard changes without changing other preferences', async () => {
    history.replaceState(null, '', '#settings/general');
    const native = nativeFixture(bootstrapForApp());
    render(<App />, { wrapper: wrapper(native.api) });
    const page = within(await screen.findByRole('main', { name: '设置' }));
    const checkbox = page.getByRole('switch', {
      name: translate('zh', 'analyticsEnabled'),
    }) as HTMLInputElement;
    expect(checkbox.getAttribute('aria-checked') === 'true').toBe(false);
    expect(checkbox.getAttribute('aria-describedby')).toBe(
      'analytics-description analytics-privacy',
    );
    expect(page.getByText(translate('zh', 'analyticsDescription')).textContent).toContain(
      'aptabase.jamesflare.com',
    );
    const before = structuredClone(native.backend.config);
    checkbox.focus();
    await userEvent.setup().keyboard(' ');
    await waitFor(() => expect(native.backend.config.analyticsEnabled).toBe(true));
    expect(native.backend.config).toEqual({ ...before, analyticsEnabled: true });
    fireEvent.click(checkbox);
    await waitFor(() => expect(native.backend.config.analyticsEnabled).toBe(false));
    expect(native.backend.config).toEqual(before);
  });

  it('opens a settings tab directly and saves both label and switch activation', async () => {
    history.replaceState(null, '', '#settings/automation');
    const native = nativeFixture(bootstrapForApp());
    render(<App />, { wrapper: wrapper(native.api) });
    const page = within(await screen.findByRole('main', { name: '设置' }));
    expect(screen.getByRole('tab', { name: '自动化' }).getAttribute('aria-selected')).toBe('true');
    const checkbox = page.getByRole('switch', {
      name: translate('zh', 'autoQuery'),
    }) as HTMLInputElement;
    fireEvent.click(page.getByText(translate('zh', 'autoQuery')));
    await waitFor(() => expect(native.backend.config.autoQueryCurrentMatch).toBe(false));
    expect(checkbox.getAttribute('aria-checked') === 'true').toBe(false);
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

describe('auto-record controls and preview', () => {
  it('opens the configured recording directory beside its path', async () => {
    const native = nativeFixture(bootstrapForApp(), { 'replays.open': () => null });
    render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
    const input = await screen.findByRole('textbox', { name: '保存目录' });
    const directory = input.closest('footer')!;
    await userEvent.setup().click(within(directory).getByRole('button', { name: '打开目录' }));
    expect(native.calls.filter((call) => call.method === 'replays.open')).toEqual([
      { method: 'replays.open', input: null },
    ]);
  });

  it('switches the replay library between cards and a list without reloading recordings', async () => {
    const native = nativeFixture(bootstrapForApp(), {
      'replays.list': () => ({
        directory: 'test-profile/recordings',
        recordings: [
          {
            id: 'view-switch.webm',
            fid: null,
            map: 'Dam',
            uploaderId: null,
            uploaderName: 'Raven',
            teamId: null,
            size: 1024,
            createdAt: 1700000000000,
            dateSource: 'recording',
            durationSec: 60,
            test: true,
          },
        ],
      }),
    });
    render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
    const library = within(await screen.findByRole('list', { name: '录像库' }));
    const user = userEvent.setup();
    const grid = screen.getByRole('radio', { name: '网格视图' });
    const list = screen.getByRole('radio', { name: '列表视图' });
    expect(grid.getAttribute('aria-checked')).toBe('true');
    expect(library.getByRole('button', { name: /^播放: Dam · Raven · / })).toBeTruthy();
    await user.click(list);
    expect(list.getAttribute('aria-checked')).toBe('true');
    expect(library.getByRole('button', { name: /^播放: Dam · Raven · / })).toBeTruthy();
    await user.click(library.getByRole('button', { name: /^操作: Dam · Raven · / }));
    expect(await screen.findByRole('menuitem', { name: '删除' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(grid);
    expect(grid.getAttribute('aria-checked')).toBe('true');
    expect(native.calls.filter((call) => call.method === 'replays.list')).toHaveLength(1);
  });

  it('toggles directly only from the switch and keeps settings behind their own button', async () => {
    history.replaceState(null, '', '#replays');
    const initial = bootstrapForApp();
    initial.config.replayEnabled = false;
    const native = nativeFixture(initial, { 'displays.thumbnail': () => null });
    render(<App />, { wrapper: wrapper(native.api) });
    const toggle = (await screen.findByRole('switch', {
      name: '自动录制',
    })) as HTMLInputElement;
    const user = userEvent.setup();

    await user.click(screen.getByText('自动录制'));
    await user.click(toggle.parentElement!);
    expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked') === 'true').toBe(true));
    expect(native.backend.config.replayEnabled).toBe(true);
    expect(native.calls.filter((call) => call.method === 'config.update').at(-1)?.input).toEqual({
      replayEnabled: true,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('录制开始后显示预览')).toBeTruthy();
    expect(screen.queryByText('自动录制未开启')).toBeNull();

    toggle.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(toggle.getAttribute('aria-checked') === 'true').toBe(false));
    expect(native.backend.config.replayEnabled).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: '录像设置' }));
    const dialog = within(await screen.findByRole('dialog', { name: '录像设置' }));
    const saves = native.calls.filter((call) => call.method === 'config.update').length;
    await user.click(dialog.getByText('自动录制'));
    expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(saves);
    expect(native.backend.config.replayEnabled).toBe(false);
  });

  it.each([
    { enabled: false, phase: 'idle', message: '自动录制未开启' },
    { enabled: true, phase: 'idle', message: '录制开始后显示预览' },
    { enabled: true, phase: 'starting', message: '等待预览画面' },
    { enabled: true, phase: 'recording', message: '等待预览画面' },
    { enabled: false, phase: 'stopping', message: '保存中' },
    { enabled: true, phase: 'error', message: '预览暂不可用' },
  ] as const)(
    'shows the correct preview for $phase with auto-record $enabled',
    async ({ enabled, phase, message }) => {
      const initial = bootstrapForApp();
      initial.config.replayEnabled = enabled;
      initial.recording.phase = phase;
      const native = nativeFixture(initial);
      render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('switch', { name: '自动录制' });
      const preview = document.querySelector('.recording-preview-media') as HTMLElement;
      expect(within(preview).getByText(message)).toBeTruthy();
    },
  );
});

describe('stable archive updates and recovery', () => {
  const accounts = [
    { id: '1', name: 'Alpha account', persona: 'Alpha', firstSeen: 1, lastSeen: 2, matchCount: 1 },
    { id: '2', name: 'Bravo account', persona: 'Bravo', firstSeen: 1, lastSeen: 2, matchCount: 1 },
  ];
  const row = (id: string, map: string, owner = '1', time = 1700000000000) =>
    matchFixture({
      id,
      fid: id,
      map,
      localPlayerId: owner,
      localPersona: owner === '1' ? 'Alpha account' : 'Bravo account',
      endedAt: time,
      outcome: 'win',
    });
  const bootstrap = (locale: 'zh' | 'en') => {
    const value = bootstrapForApp();
    value.config.lang = locale;
    return value;
  };
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['list', 'grid'] as const).map((view) => ({ locale, view })),
    ),
  )('queues new matches without replacing $view controls in $locale', async ({ locale, view }) => {
    let rows = [row('101', 'Stable Alpha')];
    const native = nativeFixture(bootstrap(locale), {
      'accounts.list': () => accounts,
      'matches.list': () => structuredClone(rows),
      'matches.scan': () => null,
    });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Stable Alpha' });
    if (view === 'grid')
      await user.click(screen.getByRole('radio', { name: translate(locale, 'gridView') }));
    const target = screen.getByRole('button', { name: 'Stable Alpha' });
    target.focus();
    let menu: HTMLElement | null = null;
    if (view === 'list') {
      await user.click(
        screen.getByRole('button', { name: `${translate(locale, 'actions')}: #101` }),
      );
      menu = screen.getByRole('menu');
    }
    const focused = document.activeElement;
    rows = [row('102', 'New Bravo', '2', 1700000001000), ...rows];
    act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
    await screen.findByText(translate(locale, 'archiveUpdatesAvailable'));
    expect(target.isConnected).toBe(true);
    expect(document.activeElement).toBe(focused);
    expect(screen.queryByRole('button', { name: 'New Bravo' })).toBeNull();
    if (menu) {
      expect(screen.getByRole('menu')).toBe(menu);
      await user.keyboard('{Escape}');
    }
    await user.click(screen.getByRole('button', { name: translate(locale, 'refresh') }));
    expect(await screen.findByRole('button', { name: 'New Bravo' })).toBeTruthy();
    expect(screen.getByText(translate(locale, 'archiveUpdatesCurrent'))).toBeTruthy();
  });
  it.each(['zh', 'en'] as const)(
    'disables removed snapshot targets until refresh in %s',
    async (locale) => {
      let rows = [row('101', 'Removed Alpha'), row('102', 'Retained Bravo', '2')];
      const native = nativeFixture(bootstrap(locale), {
        'accounts.list': () => accounts,
        'matches.list': () => structuredClone(rows),
        'matches.scan': () => null,
      });
      render(<MatchArchive />, { wrapper: wrapper(native.api) });
      const target = await screen.findByRole('button', { name: 'Removed Alpha' });
      rows = rows.slice(1);
      act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
      await screen.findByText(translate(locale, 'archiveUpdatesAvailable'));
      expect(target.isConnected).toBe(true);
      expect(target.hasAttribute('disabled')).toBe(true);
      expect(
        screen
          .getByRole('button', { name: `${translate(locale, 'actions')}: #101` })
          .hasAttribute('disabled'),
      ).toBe(true);
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: translate(locale, 'refresh') }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Removed Alpha' })).toBeNull(),
      );
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['list', 'grid'] as const).map((view) => ({ locale, view })),
    ),
  )(
    'clears old account targets while $view loading fails and retries in $locale',
    async ({ locale, view }) => {
      const pending = deferred<RpcOutputs['matches.list']>();
      let fail = true;
      const rows = [row('101', 'Alpha match'), row('201', 'Bravo match', '2')];
      const native = nativeFixture(bootstrap(locale), {
        'accounts.list': () => accounts,
        'matches.list': (input) =>
          input.accountId === '2' ? (fail ? pending.promise : [rows[1]!]) : structuredClone(rows),
      });
      render(<MatchArchive />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: 'Alpha match' });
      if (view === 'grid')
        await user.click(screen.getByRole('radio', { name: translate(locale, 'gridView') }));
      await user.selectOptions(screen.getByLabelText(translate(locale, 'account')), '2');
      expect(screen.queryByRole('button', { name: 'Alpha match' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Bravo match' })).toBeNull();
      await act(async () => pending.reject(new Error('Bravo list unavailable')));
      await screen.findByText('Bravo list unavailable');
      expect(screen.queryByText(translate(locale, 'noFilteredMatches'))).toBeNull();
      expect(
        screen.queryByRole('button', { name: `${translate(locale, 'actions')}: #101` }),
      ).toBeNull();
      fail = false;
      await user.click(screen.getByRole('button', { name: translate(locale, 'retry') }));
      expect(await screen.findByRole('button', { name: 'Bravo match' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Alpha match' })).toBeNull();
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['scan', 'detail', 'delete'] as const).flatMap((operation) =>
        (['before', 'same', 'after'] as const).map((eventOrder) => ({
          locale,
          operation,
          eventOrder,
        })),
      ),
    ),
  )(
    'uses the current account after a held $operation with the event $eventOrder its response in $locale',
    async ({ locale, operation, eventOrder }) => {
      let rows = [row('101', 'Alpha match'), row('201', 'Bravo match', '2')];
      const held = deferred<null>();
      const native = nativeFixture(bootstrap(locale), {
        'accounts.list': () => accounts,
        'matches.list': (input) =>
          structuredClone(
            rows.filter((match) => !input.accountId || match.localPlayerId === input.accountId),
          ),
        'matches.scan': () => held.promise,
        'matches.detail': async () => {
          await held.promise;
          return rows[0]!;
        },
        'matches.delete': async () => {
          await held.promise;
          rows = rows.filter((match) => match.id !== '101');
          return {
            removed: true,
            removedMatches: 1,
            retainedMatches: 0,
            backup: {
              name: 'fixture.json',
              version: 'a'.repeat(64),
              createdAt: 1,
              kind: 'match',
              target: { id: '101', name: 'Alpha match' },
              matchCount: 1,
              restoredAt: null,
            },
          };
        },
      });
      render(<MatchArchive />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: 'Alpha match' });
      if (operation === 'scan')
        await user.click(screen.getByRole('button', { name: translate(locale, 'refresh') }));
      else {
        await user.click(
          screen.getByRole('button', { name: `${translate(locale, 'actions')}: #101` }),
        );
        await user.click(
          screen.getByRole('menuitem', {
            name: translate(locale, operation === 'detail' ? 'refresh' : 'delete'),
          }),
        );
        if (operation === 'delete') {
          const confirmation = await screen.findByRole('alertdialog');
          await user.click(
            within(confirmation).getByRole('button', { name: translate(locale, 'delete') }),
          );
          await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
        }
      }
      await user.selectOptions(screen.getByLabelText(translate(locale, 'account')), '2');
      await screen.findByRole('button', { name: 'Bravo match' });
      const requests = native.calls.filter((call) => call.method === 'matches.list').length;
      if (eventOrder === 'before') {
        await act(async () =>
          native.emit({ type: 'matches', revision: native.backend.revision + 1 }),
        );
        await waitFor(() =>
          expect(
            screen
              .getByRole('button', { name: 'Bravo match' })
              .closest('[aria-busy]')
              ?.getAttribute('aria-busy'),
          ).toBe('false'),
        );
      }
      const requestsBeforeCompletion = native.calls.filter(
        (call) => call.method === 'matches.list',
      ).length;
      await act(async () => {
        if (eventOrder === 'same')
          native.emit({ type: 'matches', revision: native.backend.revision + 1 });
        held.resolve(null);
      });
      await waitFor(() =>
        expect(
          native.calls.filter((call) => call.method === 'matches.list').length,
        ).toBeGreaterThan(requestsBeforeCompletion),
      );
      if (eventOrder === 'after') {
        await act(async () =>
          native.emit({ type: 'matches', revision: native.backend.revision + 1 }),
        );
        await waitFor(() =>
          expect(
            screen
              .getByRole('button', { name: 'Bravo match' })
              .closest('[aria-busy]')
              ?.getAttribute('aria-busy'),
          ).toBe('false'),
        );
      }
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Bravo match' }).hasAttribute('disabled')).toBe(
          false,
        ),
      );
      expect((screen.getByLabelText(translate(locale, 'account')) as HTMLSelectElement).value).toBe(
        '2',
      );
      expect(screen.queryByRole('button', { name: 'Alpha match' })).toBeNull();
      expect(
        native.calls
          .filter((call) => call.method === 'matches.list')
          .slice(requests)
          .every((call) => (call.input as RpcInputs['matches.list']).accountId === '2'),
      ).toBe(true);
    },
  );
  it.each(['zh', 'en'] as const)(
    'applies the newest response when background updates overlap a manual refresh in %s',
    async (locale) => {
      const older = deferred<RpcOutputs['matches.list']>();
      let calls = 0;
      const original = [row('101', 'Old Alpha')],
        latest = [row('102', 'Latest Bravo', '2', 1700000001000), ...original];
      const native = nativeFixture(bootstrap(locale), {
        'accounts.list': () => accounts,
        'matches.scan': () => null,
        'matches.list': () => (++calls === 1 ? original : calls === 2 ? older.promise : latest),
      });
      render(<MatchArchive />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: 'Old Alpha' });
      await user.click(screen.getByRole('button', { name: translate(locale, 'refresh') }));
      await waitFor(() => expect(calls).toBe(2));
      act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
      await screen.findByRole('button', { name: 'Latest Bravo' });
      await act(async () => older.resolve(original));
      expect(screen.getByRole('button', { name: 'Latest Bravo' })).toBeTruthy();
    },
  );
  it.each(['zh', 'en'] as const)(
    'reconciles a deleted account with the archive filter in %s',
    async (locale) => {
      let choices = accounts,
        rows = [row('101', 'Deleted Alpha'), row('201', 'Preserved Bravo', '2')];
      const native = nativeFixture(bootstrap(locale), {
        'accounts.list': () => choices,
        'matches.scan': () => null,
        'matches.list': (input) =>
          structuredClone(
            rows.filter((match) => !input.accountId || match.localPlayerId === input.accountId),
          ),
      });
      render(<MatchArchive />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: 'Deleted Alpha' });
      await user.selectOptions(screen.getByLabelText(translate(locale, 'account')), '1');
      await screen.findByRole('button', { name: 'Deleted Alpha' });
      choices = accounts.slice(1);
      rows = rows.slice(1);
      act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
      await screen.findByRole('button', { name: 'Preserved Bravo' });
      expect((screen.getByLabelText(translate(locale, 'account')) as HTMLSelectElement).value).toBe(
        '',
      );
      await user.click(screen.getByRole('button', { name: translate(locale, 'refresh') }));
      await waitFor(() =>
        expect(native.calls.filter((call) => call.method === 'matches.list').at(-1)?.input).toEqual(
          {},
        ),
      );
    },
  );
});

describe('encounter-driven ban list freshness', () => {
  const initial = (locale: 'zh' | 'en') => {
    const value = bootstrapForApp();
    value.config.lang = locale;
    return value;
  };
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['all', 'met'] as const).map((filter) => ({ locale, filter })),
    ),
  )(
    'updates $filter rows and preserves query and filter in $locale after an encounter event',
    async ({ locale, filter }) => {
      let rows = [
        {
          ...bannedPlayer(),
          name: 'Lookup target',
          encountered: false,
          lastEncounterAt: null as number | null,
        },
      ];
      const native = nativeFixture(initial(locale), { 'bans.list': () => rows });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Lookup target #9000' });
      const input = screen.getByRole('searchbox', { name: translate(locale, 'filterPlayers') });
      fireEvent.change(input, { target: { value: 'Lookup' } });
      if (filter === 'met') {
        fireEvent.click(screen.getByRole('radio', { name: translate(locale, 'metBans') }));
        expect(screen.getByText(translate(locale, 'banMetEmpty'))).toBeTruthy();
      }
      rows = [{ ...rows[0]!, encountered: true, lastEncounterAt: 1700000000000 }];
      act(() =>
        native.emit({
          type: 'bans',
          list: rows,
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByRole('button', { name: 'Lookup target #9000' });
      expect(screen.getByText(formatTime(1700000000000, locale))).toBeTruthy();
      rows = [{ ...rows[0]!, lastEncounterAt: 1700003600000 }];
      act(() =>
        native.emit({
          type: 'bans',
          list: rows,
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByText(formatTime(1700003600000, locale));
      expect((input as HTMLInputElement).value).toBe('Lookup');
      expect(
        screen
          .getByRole('radio', { name: translate(locale, filter === 'met' ? 'metBans' : 'allBans') })
          .getAttribute('aria-checked'),
      ).toBe('true');
      expect(native.calls.some((call) => call.method === 'bans.sync')).toBe(false);
    },
  );
  it.each(['zh', 'en'] as const)(
    'qualifies failed encounter reloads and retries without changing filters in %s',
    async (locale) => {
      let fail = false;
      const held = deferred<Ban[]>();
      let waiting = false;
      const native = nativeFixture(initial(locale), {
        'bans.list': () => {
          if (fail) throw new Error('Encounter reload failed');
          return waiting ? held.promise : [];
        },
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByText(translate(locale, 'banSourceEmpty'));
      fireEvent.click(screen.getByRole('radio', { name: translate(locale, 'metBans') }));
      fail = true;
      act(() =>
        native.emit({
          type: 'bans',
          list: [],
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
      const retry = await screen.findByRole('button', { name: translate(locale, 'banListReload') });
      expect(screen.queryByText(translate(locale, 'banMetEmpty'))).toBeNull();
      expect(screen.getByText(translate(locale, 'banListRetainedHint'))).toBeTruthy();
      fail = false;
      waiting = true;
      retry.focus();
      await userEvent.setup().keyboard(' ');
      expect(document.activeElement).toBe(document.querySelector('.ban-list-paged'));
      await act(async () => held.resolve([{ ...bannedPlayer(), lastEncounterAt: 1700000000000 }]));
      await screen.findByRole('button', { name: 'Banned Arrow #9000' });
      expect(
        screen
          .getByRole('radio', { name: translate(locale, 'metBans') })
          .getAttribute('aria-checked'),
      ).toBe('true');
      expect(document.activeElement).toBe(document.querySelector('.ban-list-paged'));
    },
  );
  it.each(['zh', 'en'] as const)(
    'keeps unverified legacy observations in All bans and removes qualification after game evidence in %s',
    async (locale) => {
      let rows = [
        {
          ...bannedPlayer(),
          encountered: false,
          lastEncounterAt: null as number | null,
          unverifiedObservation: true,
        },
      ];
      const native = nativeFixture(initial(locale), { 'bans.list': () => rows });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByText(translate(locale, 'unverifiedEncounter'));
      fireEvent.click(screen.getByRole('radio', { name: translate(locale, 'metBans') }));
      expect(screen.queryByRole('button', { name: 'Banned Arrow #9000' })).toBeNull();
      rows = [
        {
          ...rows[0]!,
          encountered: true,
          lastEncounterAt: 1700000000000,
          unverifiedObservation: false,
        },
      ];
      act(() =>
        native.emit({
          type: 'bans',
          list: rows,
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByRole('button', { name: 'Banned Arrow #9000' });
      expect(screen.queryByText(translate(locale, 'unverifiedEncounter'))).toBeNull();
    },
  );
  it.each(['zh', 'en'] as const)(
    'explains unverified profile observations while retaining known aliases in %s',
    async (locale) => {
      const profile: PlayerProfile = {
        id: '9000',
        name: 'Legacy target',
        unverifiedObservation: true,
        names: [{ name: 'Legacy alias', firstSeen: 1, lastSeen: 2 }],
        firstSeen: null,
        lastSeen: null,
        encounters: [],
        banned: null,
        recentMatches: [],
        recentError: null,
        latestElo: null,
        info: null,
      };
      const native = nativeFixture(initial(locale), {
        'players.profile': () => profile,
        'players.report': () => reportFixture({ id: '9000', name: 'Legacy target', stale: false }),
      });
      render(<ProfileDialog id="9000" name="Legacy target" />, { wrapper: wrapper(native.api) });
      expect(await screen.findByText(translate(locale, 'unverifiedEncounterHint'))).toBeTruthy();
      const aliases = screen.getByRole('button', { name: new RegExp(translate(locale, 'names')) });
      await userEvent.setup().click(aliases);
      expect(await screen.findByText('Legacy alias')).toBeTruthy();
    },
  );
});

describe('player search request ownership and identity', () => {
  const initial = (locale: 'zh' | 'en') => {
    const value = bootstrapForApp();
    value.config.lang = locale;
    return value;
  };
  const result = (name: string, id = '90001'): RpcOutputs['players.search'] => ({
    source: 'network',
    players: [{ ...localPlayer, id, name }],
  });
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      [false, true].flatMap((oldFails) =>
        [false, true].flatMap((newFails) =>
          [false, true].map((oldFirst) => ({ locale, oldFails, newFails, oldFirst })),
        ),
      ),
    ),
  )(
    'accepts the edited query and ignores obsolete responses in $locale: oldFails=$oldFails, newFails=$newFails, oldFirst=$oldFirst',
    async ({ locale, oldFails, newFails, oldFirst }) => {
      const old = deferred<RpcOutputs['players.search']>(),
        next = deferred<RpcOutputs['players.search']>();
      const native = nativeFixture(initial(locale), {
        'players.search': ({ query }) =>
          query === 'Seed' ? result('Seed player') : query === 'Alpha' ? old.promise : next.promise,
      });
      render(<PlayersPanel />, { wrapper: wrapper(native.api) });
      const input = await screen.findByRole('searchbox', {
        name: translate(locale, 'searchLabel'),
      });
      const user = userEvent.setup();
      const submit = async (value: string) => {
        fireEvent.change(input, { target: { value } });
        input.focus();
        await user.keyboard('{Enter}');
      };
      await submit('Seed');
      await screen.findByRole('button', { name: /^Seed player/ });
      await submit('Alpha');
      await submit('Bravo');
      expect(
        native.calls.filter((call) => call.method === 'players.search').map((call) => call.input),
      ).toEqual([{ query: 'Seed' }, { query: 'Alpha' }, { query: 'Bravo' }]);
      const finishOld = () =>
        oldFails
          ? old.reject(new Error('Obsolete failure'))
          : old.resolve(result('Obsolete Alpha'));
      const finishNew = () =>
        newFails
          ? next.reject(new Error('Current failure'))
          : next.resolve(result('Current Bravo', '90002'));
      if (oldFirst) await act(async () => finishOld());
      await act(async () => finishNew());
      if (!oldFirst) await act(async () => finishOld());
      expect(screen.queryByText('Obsolete failure')).toBeNull();
      expect(screen.queryByRole('button', { name: /^Obsolete Alpha/ })).toBeNull();
      expect((input as HTMLInputElement).value).toBe('Bravo');
      expect(input.getAttribute('aria-invalid')).toBeNull();
      expect(input.getAttribute('aria-describedby')).toBe('player-search-hint');
      if (newFails) {
        expect(screen.getByRole('alert').textContent).toContain('Bravo');
        expect(screen.getByRole('alert').textContent).toContain('Current failure');
        expect(screen.getByRole('button', { name: /^Seed player/ })).toBeTruthy();
      } else {
        expect(screen.getByRole('button', { name: /^Current Bravo/ })).toBeTruthy();
        expect(
          screen.getByText(translate(locale, 'searchResultSummary', { query: 'Bravo', count: 1 })),
        ).toBeTruthy();
      }
    },
  );
  it.each(['zh', 'en'] as const)(
    'deduplicates a pending query and keeps a changed query submit available in %s',
    async (locale) => {
      const held = deferred<RpcOutputs['players.search']>();
      const native = nativeFixture(initial(locale), { 'players.search': () => held.promise });
      render(<PlayersPanel />, { wrapper: wrapper(native.api) });
      const input = await screen.findByRole('searchbox', {
        name: translate(locale, 'searchLabel'),
      });
      fireEvent.change(input, { target: { value: 'Alpha' } });
      const submit = screen.getByRole('button', { name: translate(locale, 'search') });
      fireEvent.click(submit);
      fireEvent.click(submit);
      expect(native.calls.filter((call) => call.method === 'players.search')).toHaveLength(1);
      expect(submit.getAttribute('aria-disabled')).toBe('true');
      expect(submit.hasAttribute('disabled')).toBe(false);
      fireEvent.change(input, { target: { value: 'Bravo' } });
      expect(submit.getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(submit);
      expect(native.calls.filter((call) => call.method === 'players.search')).toHaveLength(2);
      await act(async () => held.resolve(result('Current Bravo')));
    },
  );
  it.each(['zh', 'en'] as const)(
    'binds a service failure to its submitted query and restores retry focus in %s',
    async (locale) => {
      const failed = deferred<RpcOutputs['players.search']>(),
        retry = deferred<RpcOutputs['players.search']>();
      let count = 0;
      const native = nativeFixture(initial(locale), {
        'players.search': () => (++count === 1 ? failed.promise : retry.promise),
      });
      render(<PlayersPanel />, { wrapper: wrapper(native.api) });
      const input = await screen.findByRole('searchbox', {
        name: translate(locale, 'searchLabel'),
      });
      fireEvent.change(input, { target: { value: 'Alpha' } });
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'search') }));
      fireEvent.change(input, { target: { value: 'Bravo' } });
      await act(async () => failed.reject(new Error('Temporary transport failure')));
      expect(screen.getByRole('alert').textContent).toContain('Alpha');
      expect(input.getAttribute('aria-invalid')).toBeNull();
      const action = screen.getByRole('button', { name: translate(locale, 'retry') });
      action.focus();
      await userEvent.setup().keyboard(' ');
      expect(document.activeElement).toBe(input);
      expect((input as HTMLInputElement).value).toBe('Alpha');
      expect(native.calls.filter((call) => call.method === 'players.search').at(-1)?.input).toEqual(
        { query: 'Alpha' },
      );
      await act(async () => retry.resolve(result('Recovered Alpha')));
      expect(document.activeElement).toBe(input);
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      [false, true].map((failure) => ({ locale, failure })),
    ),
  )(
    'keeps both retained result actions usable with query context in $locale, failure=$failure',
    async ({ locale, failure }) => {
      const held = deferred<RpcOutputs['players.search']>();
      const native = nativeFixture(initial(locale), {
        'players.search': ({ query }) =>
          query === 'Alpha' ? result('Retained Alpha') : held.promise,
        'players.report': ({ id }) => reportFixture({ id, name: 'Retained Alpha' }),
      });
      render(<PlayersPanel />, { wrapper: wrapper(native.api) });
      const input = await screen.findByRole('searchbox', {
        name: translate(locale, 'searchLabel'),
      });
      fireEvent.change(input, { target: { value: 'Alpha' } });
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'search') }));
      await screen.findByRole('button', { name: /^Retained Alpha/ });
      fireEvent.change(input, { target: { value: 'Bravo' } });
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'search') }));
      if (failure) await act(async () => held.reject(new Error('Current query failed')));
      expect(
        screen.getByText(translate(locale, 'playerSearchRetainedQuery', { query: 'Alpha' })),
      ).toBeTruthy();
      const row = screen.getByRole('button', { name: /^Retained Alpha/ });
      expect(row.hasAttribute('disabled')).toBe(false);
      fireEvent.click(row);
      await screen.findByRole('heading', { name: 'Retained Alpha #90001' });
      await userEvent.setup().click(
        screen.getByRole('button', {
          name: `${translate(locale, 'actions')}: Retained Alpha #90001`,
        }),
      );
      expect(
        await screen.findByRole('menuitem', { name: translate(locale, 'investigate') }),
      ).toBeTruthy();
      expect(native.calls.filter((call) => call.method === 'players.report').at(-1)?.input).toEqual(
        { id: '90001', force: false },
      );
      if (!failure) await act(async () => held.resolve(result('Bravo', '90002')));
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) => ['90001', '90002'].map((id) => ({ locale, id }))),
  )(
    'identifies the same-name suggestion before selection in $locale for $id',
    async ({ locale, id }) => {
      const value = initial(locale);
      value.session.current = null;
      value.session.lobbyPlayers = ['90001', '90002'].map((id) => ({
        ...localPlayer,
        id,
        name: 'Synthetic Twin',
        teamId: null,
      }));
      const native = nativeFixture(value, {
        'players.report': ({ id }) => reportFixture({ id, name: 'Synthetic Twin' }),
      });
      render(<PlayersPanel />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('button', { name: translate(locale, 'currentRoomPlayers') }),
      );
      const target = await screen.findByRole('button', { name: `Synthetic Twin #${id}` });
      expect(target.textContent).toContain('#' + id);
      target.focus();
      await user.keyboard(' ');
      await screen.findByRole('heading', { name: `Synthetic Twin #${id}` });
      expect(native.calls.filter((call) => call.method === 'players.report').at(-1)?.input).toEqual(
        { id, force: false },
      );
    },
  );
  it.each(['zh', 'en'] as const)('distinguishes same-name menu targets in %s', async (locale) => {
    const data = result('Synthetic Twin');
    data.players.push({ ...data.players[0]!, id: '90002' });
    const native = nativeFixture(initial(locale), { 'players.search': () => data });
    render(<PlayersPanel />, { wrapper: wrapper(native.api) });
    const input = await screen.findByRole('searchbox', { name: translate(locale, 'searchLabel') });
    fireEvent.change(input, { target: { value: 'Twin' } });
    fireEvent.click(screen.getByRole('button', { name: translate(locale, 'search') }));
    for (const id of ['90001', '90002'])
      expect(
        await screen.findByRole('button', {
          name: `${translate(locale, 'actions')}: Synthetic Twin #${id}`,
        }),
      ).toBeTruthy();
  });
  it.each(['zh', 'en'] as const)(
    'keeps shared loading text localized and decorative spinner names hidden in %s',
    (locale) => {
      render(
        <LocaleContext.Provider value={locale}>
          <Loading />
          <Spinner aria-label={translate(locale, 'loading')} />
        </LocaleContext.Provider>,
      );
      expect(screen.getByRole('status', { name: translate(locale, 'loading') })).toBeTruthy();
      expect(screen.getByText(translate(locale, 'loading'))).toBeTruthy();
      expect(document.querySelectorAll('[data-slot=spinner][aria-hidden=true]')).toHaveLength(1);
      if (locale === 'zh') expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    },
  );
});

describe('ban list filtering and synchronization recovery', () => {
  it.each(['zh', 'en'] as const)(
    'keeps a newer background failure after reconciling an older transport failure in %s',
    async (locale) => {
      const value = bootstrapForApp();
      value.config.lang = locale;
      const native = nativeFixture(value, {
        'bans.list': () => [bannedPlayer()],
        'bans.sync': () => {
          throw new Error('Old transport failure');
        },
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Banned Arrow #9000' });
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'sync') }));
      await screen.findByRole('button', {
        name: translate(locale, 'banSyncReview', { status: translate(locale, 'banSyncFailed') }),
      });
      act(() =>
        native.emit({
          type: 'banSync',
          status: {
            phase: 'success',
            attemptId: 'recovered',
            lastAttemptAt: 10,
            lastSuccessAt: 11,
            error: null,
          },
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByRole('button', {
        name: translate(locale, 'banSyncReview', { status: translate(locale, 'banSyncSuccess') }),
      });
      act(() =>
        native.emit({
          type: 'banSync',
          status: {
            phase: 'error',
            attemptId: 'newer',
            lastAttemptAt: 12,
            lastSuccessAt: 11,
            error: 'New background failure',
          },
          revision: native.backend.revision + 1,
        }),
      );
      fireEvent.click(
        await screen.findByRole('button', {
          name: translate(locale, 'banSyncReview', { status: translate(locale, 'banSyncFailed') }),
        }),
      );
      expect(await screen.findByText('New background failure')).toBeTruthy();
      expect(screen.queryByText('Old transport failure')).toBeNull();
    },
  );
  const initial = (locale: 'zh' | 'en') => {
    const value = bootstrapForApp();
    value.config.lang = locale;
    return value;
  };
  const rows = () => [
    bannedPlayer(),
    { ...bannedPlayer(), id: '9001', name: 'Unmet player', encountered: false },
  ];
  const success = (id = 'attempt-1') => ({
    phase: 'success' as const,
    attemptId: id,
    lastAttemptAt: 1700000000000,
    lastSuccessAt: 1700000001000,
    error: null,
  });
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['before', 'same', 'after'] as const).map((order) => ({ locale, order })),
    ),
  )(
    'keeps encountered rows consistent for the $order event order in $locale',
    async ({ locale, order }) => {
      const held = deferred<Ban[]>();
      const native = nativeFixture(initial(locale), {
        'bans.list': () => rows(),
        'bans.sync': () => held.promise,
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Unmet player #9001' });
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'sync') }));
      fireEvent.click(screen.getByRole('radio', { name: translate(locale, 'metBans') }));
      let wrongRows = 0;
      const observer = new MutationObserver(() => {
        if (screen.queryByRole('button', { name: 'Unmet player #9001' })) wrongRows++;
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const emit = () =>
        native.emit({
          type: 'bans',
          list: rows(),
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        });
      if (order === 'before') act(emit);
      await act(async () => {
        held.resolve(rows());
        if (order === 'same') emit();
      });
      if (order === 'after') act(emit);
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: translate(locale, 'sync') }).getAttribute('aria-busy'),
        ).toBe('false'),
      );
      expect(screen.queryByRole('button', { name: 'Unmet player #9001' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Banned Arrow #9000' })).toBeTruthy();
      expect(
        native.calls
          .filter((call) => call.method === 'bans.list')
          .every((call) => !(call.input as RpcInputs['bans.list']).metOnly),
      ).toBe(true);
      observer.disconnect();
      expect(wrongRows).toBe(0);
    },
  );
  it.each(['zh', 'en'] as const)(
    'keeps the current filter after a failed local reload and recovers in $locale',
    async (locale) => {
      let fail = false;
      const native = nativeFixture(initial(locale), {
        'bans.list': () => {
          if (fail) throw new Error('Local read unavailable');
          return rows();
        },
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Unmet player #9001' });
      fail = true;
      act(() =>
        native.emit({
          type: 'bans',
          list: rows(),
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByRole('button', {
        name: translate(locale, 'banSyncReview', { status: translate(locale, 'banListReadIssue') }),
      });
      fireEvent.click(screen.getByRole('radio', { name: translate(locale, 'metBans') }));
      expect(screen.queryByRole('button', { name: 'Unmet player #9001' })).toBeNull();
      fireEvent.click(
        screen.getByRole('button', {
          name: translate(locale, 'banSyncReview', {
            status: translate(locale, 'banListReadIssue'),
          }),
        }),
      );
      expect(await screen.findByText(translate(locale, 'banListRetainedHint'))).toBeTruthy();
      fail = false;
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'banListReload') }));
      await waitFor(() => expect(screen.queryByText('Local read unavailable')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Unmet player #9001' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Banned Arrow #9000' })).toBeTruthy();
    },
  );
  it.each(['zh', 'en'] as const)(
    'distinguishes empty sources, encountered filters and queries and restores focus in $locale',
    async (locale) => {
      let source = rows().map((row) => ({ ...row, encountered: false }));
      const native = nativeFixture(initial(locale), { 'bans.list': () => source });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Unmet player #9001' });
      const user = userEvent.setup();
      const input = screen.getByRole('searchbox', { name: translate(locale, 'filterPlayers') });
      await user.type(input, 'missing');
      expect(screen.getByText(translate(locale, 'banQueryEmpty'))).toBeTruthy();
      const clear = screen.getByRole('button', { name: translate(locale, 'clearFilters') });
      clear.focus();
      await user.keyboard(' ');
      expect(document.activeElement).toBe(input);
      fireEvent.click(screen.getByRole('radio', { name: translate(locale, 'metBans') }));
      expect(screen.getByText(translate(locale, 'banMetEmpty'))).toBeTruthy();
      const all = screen.getByRole('button', { name: translate(locale, 'allBans') });
      all.focus();
      await user.keyboard('{Enter}');
      expect(document.activeElement).toBe(
        screen.getByRole('radio', { name: translate(locale, 'allBans') }),
      );
      source = [];
      act(() =>
        native.emit({
          type: 'bans',
          list: [],
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
      const updates = screen.getByRole('button', {
        name: new RegExp('^' + translate(locale, 'banListApplyUpdates')),
      });
      await waitFor(() => expect(updates.getAttribute('aria-disabled')).toBe('false'));
      await user.click(updates);
      expect(await screen.findByText(translate(locale, 'banSourceEmpty'))).toBeTruthy();
      expect(screen.queryByText(translate(locale, 'banQueryEmpty'))).toBeNull();
    },
  );
  it.each(['zh', 'en'] as const)(
    'offers a local retry without asserting an unread source is empty in $locale',
    async (locale) => {
      let fail = true;
      const native = nativeFixture(initial(locale), {
        'bans.list': () => {
          if (fail) throw new Error('Read failed');
          return [];
        },
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      const retry = await screen.findByRole('button', { name: translate(locale, 'banListReload') });
      expect(screen.queryByText(translate(locale, 'banSourceEmpty'))).toBeNull();
      fail = false;
      fireEvent.click(retry);
      expect(await screen.findByText(translate(locale, 'banSourceEmpty'))).toBeTruthy();
      expect(native.calls.some((call) => call.method === 'bans.sync')).toBe(false);
    },
  );
  it.each(['zh', 'en'] as const)(
    'retains a failed synchronization across navigation and clears it after retry in $locale',
    async (locale) => {
      const held = deferred<Ban[]>();
      let fail = true;
      const native = nativeFixture(initial(locale), {
        'bans.list': () => rows(),
        'bans.sync': async () => {
          if (fail) return held.promise;
          native.emit({
            type: 'banSync',
            status: success(),
            revision: native.backend.revision + 1,
          });
          return rows();
        },
      });
      function Surface() {
        const [shown, show] = useState(true);
        return (
          <>
            <button onClick={() => show(!shown)}>Switch surface</button>
            {shown && <BansPanel />}
          </>
        );
      }
      render(<Surface />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Banned Arrow #9000' });
      const sync = screen.getByRole('button', { name: translate(locale, 'sync') });
      sync.focus();
      fireEvent.click(sync);
      fireEvent.click(sync);
      await waitFor(() =>
        expect(native.calls.filter((call) => call.method === 'bans.sync')).toHaveLength(1),
      );
      fireEvent.click(screen.getByText('Switch surface'));
      await act(async () => held.reject(new Error('Persistent sync failure')));
      fireEvent.click(screen.getByText('Switch surface'));
      const indicator = await screen.findByRole('button', {
        name: translate(locale, 'banSyncReview', { status: translate(locale, 'banSyncFailed') }),
      });
      fireEvent.click(indicator);
      expect(await screen.findByText('Persistent sync failure')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Banned Arrow #9000' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'close') }));
      fail = false;
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'sync') }));
      expect(
        await screen.findByRole('button', {
          name: translate(locale, 'banSyncReview', { status: translate(locale, 'banSyncSuccess') }),
        }),
      ).toBeTruthy();
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      [true, false].map((eventFirst) => ({ locale, eventFirst })),
    ),
  )(
    'reconciles a lost response with authoritative success, eventFirst=$eventFirst in $locale',
    async ({ locale, eventFirst }) => {
      const held = deferred<Ban[]>();
      const native = nativeFixture(initial(locale), {
        'bans.list': () => rows(),
        'bans.sync': () => held.promise,
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Banned Arrow #9000' });
      fireEvent.click(screen.getByRole('button', { name: translate(locale, 'sync') }));
      const emit = () =>
        native.emit({ type: 'banSync', status: success(), revision: native.backend.revision + 1 });
      if (eventFirst) act(emit);
      await act(async () => held.reject(new Error('Response lost')));
      if (!eventFirst) act(emit);
      expect(
        await screen.findByRole('button', {
          name: translate(locale, 'banSyncReview', { status: translate(locale, 'banSyncSuccess') }),
        }),
      ).toBeTruthy();
      expect(screen.queryByText('Response lost')).toBeNull();
    },
  );
  it.each(['zh', 'en'] as const)(
    'ignores an older local response after a newer synchronization event in $locale',
    async (locale) => {
      const held = deferred<Ban[]>();
      let calls = 0;
      const native = nativeFixture(initial(locale), {
        'bans.list': () => (++calls === 1 ? held.promise : rows()),
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await waitFor(() => expect(calls).toBe(1));
      fireEvent.click(screen.getByRole('radio', { name: translate(locale, 'metBans') }));
      act(() =>
        native.emit({
          type: 'bans',
          list: rows(),
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
      await screen.findByRole('button', { name: 'Banned Arrow #9000' });
      await act(async () => held.resolve([]));
      expect(screen.getByRole('button', { name: 'Banned Arrow #9000' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Unmet player #9001' })).toBeNull();
    },
  );
});

describe('archive sorting, pagination and add behavior', () => {
  const initial = (locale: 'zh' | 'en') => {
    const value = bootstrapForApp();
    value.config.lang = locale;
    return value;
  };
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['archive', 'bans'] as const).map((surface) => ({ locale, surface })),
    ),
  )(
    'reconciles shrinking $surface pages and focus without jumping back on growth in $locale',
    async ({ locale, surface }) => {
      let matches = Array.from({ length: 105 }, (_, index) =>
        matchFixture({
          id: String(1000 + index),
          fid: String(1000 + index),
          map: `Paged match ${index}`,
          endedAt: 1700000000000 - index,
          outcome: 'win',
        }),
      );
      let bans = Array.from({ length: 45 }, (_, index) => ({
        ...bannedPlayer(),
        id: String(9000 + index),
        name: `Paged ban ${index}`,
      }));
      const held = deferred<null>();
      let waits = true;
      const native = nativeFixture(initial(locale), {
        'matches.list': () => structuredClone(matches),
        'matches.scan': () => (waits ? held.promise : null),
        'bans.list': () => structuredClone(bans),
        'bans.sync': async () => {
          if (waits) await held.promise;
          return bans;
        },
      });
      render(surface === 'archive' ? <MatchArchive /> : <BansPanel />, {
        wrapper: wrapper(native.api),
      });
      const user = userEvent.setup();
      await screen.findByRole('button', {
        name: surface === 'archive' ? 'Paged match 0' : 'Paged ban 0 #9000',
      });
      await user.click(
        screen.getByRole('link', { name: translate(locale, 'goToPage', { page: 3 }) }),
      );
      await user.click(
        screen.getByRole('button', {
          name: translate(locale, surface === 'archive' ? 'refresh' : 'sync'),
        }),
      );
      const pageThree = screen.getByRole('link', {
        name: translate(locale, 'goToPage', { page: 3 }),
      });
      await user.click(pageThree);
      expect(document.activeElement).toBe(pageThree);
      matches = matches.slice(0, 5);
      bans = bans.slice(0, 5);
      waits = false;
      await act(async () => held.resolve(null));
      if (surface === 'archive')
        await screen.findByText(
          translate(locale, 'paginationRange', { start: 1, end: 5, total: 5 }),
        );
      else {
        const apply = screen.getByRole('button', {
          name: new RegExp('^' + translate(locale, 'banListApplyUpdates')),
        });
        await waitFor(() => expect(apply.getAttribute('aria-disabled')).toBe('false'));
        expect(document.activeElement).toBe(pageThree);
        await user.click(apply);
        await waitFor(() =>
          expect(
            screen
              .getByRole('table', { name: translate(locale, 'bans') })
              .querySelectorAll('tbody tr'),
          ).toHaveLength(5),
        );
      }
      const fallback =
        surface === 'archive'
          ? screen.getByRole('link', { name: translate(locale, 'goToPage', { page: 1 }) })
          : screen.getByRole('button', {
              name: new RegExp('^' + translate(locale, 'banListApplyUpdates')),
            });
      await waitFor(() => expect(document.activeElement).toBe(fallback));
      matches = Array.from({ length: 105 }, (_, index) =>
        matchFixture({
          id: String(1000 + index),
          fid: String(1000 + index),
          map: `Paged match ${index}`,
          endedAt: 1700000000000 - index,
          outcome: 'win',
        }),
      );
      bans = Array.from({ length: 45 }, (_, index) => ({
        ...bannedPlayer(),
        id: String(9000 + index),
        name: `Paged ban ${index}`,
      }));
      if (surface === 'archive') {
        act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
        await screen.findByText(translate(locale, 'archiveUpdatesAvailable'));
        await user.click(screen.getByRole('button', { name: translate(locale, 'refresh') }));
      } else {
        act(() =>
          native.emit({
            type: 'bans',
            list: bans,
            newly: [],
            alerts: [],
            revision: native.backend.revision + 1,
          }),
        );
        const apply = screen.getByRole('button', {
          name: new RegExp('^' + translate(locale, 'banListApplyUpdates')),
        });
        await waitFor(() => expect(apply.getAttribute('aria-disabled')).toBe('false'));
        await user.click(apply);
      }
      await screen.findByRole('link', { name: translate(locale, 'goToPage', { page: 3 }) });
      expect(
        screen
          .getByRole('link', { name: translate(locale, 'goToPage', { page: 1 }) })
          .getAttribute('aria-current'),
      ).toBe('page');
    },
  );
  it.each(['zh', 'en'] as const)(
    'exposes multi-sort priority and changes the same sort in grid view in %s',
    async (locale) => {
      const rows = [
        matchFixture({ id: '1', map: 'Alpha', endedAt: 10, outcome: 'win' }),
        matchFixture({ id: '2', map: 'Zebra', endedAt: 20, outcome: 'win' }),
        matchFixture({ id: '3', map: 'Bravo', endedAt: 20, outcome: 'win' }),
      ];
      const native = nativeFixture(initial(locale), { 'matches.list': () => rows });
      render(<MatchArchive />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: 'Alpha' });
      const map = screen.getByRole('button', { name: translate(locale, 'map') });
      map.focus();
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      const summary = document.querySelector('[data-archive-sort-summary]')!;
      expect(summary.textContent).toContain(
        `1. ${translate(locale, 'time')} ${translate(locale, 'sortDescending')}`,
      );
      expect(summary.textContent).toContain(
        `2. ${translate(locale, 'map')} ${translate(locale, 'sortAscending')}`,
      );
      expect(document.getElementById(map.getAttribute('aria-describedby')!)?.textContent).toContain(
        '2.',
      );
      const names = () =>
        Array.from(document.querySelectorAll('.archive-open-match, .archive-card-map'), (button) =>
          button.textContent?.trim(),
        );
      expect(names()).toEqual(['Bravo', 'Zebra', 'Alpha']);
      await user.keyboard('{Shift>}[Space]{/Shift}');
      expect(names()).toEqual(['Zebra', 'Bravo', 'Alpha']);
      await user.click(screen.getByRole('radio', { name: translate(locale, 'gridView') }));
      expect(summary.textContent).toContain(
        `2. ${translate(locale, 'map')} ${translate(locale, 'sortDescending')}`,
      );
      await user.selectOptions(screen.getByLabelText(translate(locale, 'archiveSortBy')), 'map');
      expect(names()).toEqual(['Alpha', 'Bravo', 'Zebra']);
      await user.click(
        screen.getByRole('button', { name: translate(locale, 'archiveSortDirection') }),
      );
      expect(names()).toEqual(['Zebra', 'Bravo', 'Alpha']);
      await user.click(screen.getByRole('radio', { name: translate(locale, 'listView') }));
      expect(map.isConnected).toBe(false);
      expect(
        screen
          .getByRole('button', { name: translate(locale, 'map') })
          .closest('th')
          ?.getAttribute('aria-sort'),
      ).toBe('descending');
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['escape', 'cancel', 'close'] as const).map((dismiss) => ({ locale, dismiss })),
    ),
  )('restores the Add Match opener after $dismiss in $locale', async ({ locale, dismiss }) => {
    history.replaceState(null, '', '#archive');
    const native = nativeFixture(initial(locale), {
      'matches.list': () => [],
      'history.backups': () => ({ directory: 'test-profile/HistoryBackups', backups: [] }),
    });
    render(<App />, { wrapper: wrapper(native.api) });
    const user = userEvent.setup();
    if (dismiss === 'close') {
      await user.click(
        await screen.findByRole('button', { name: translate(locale, 'historyRecovery') }),
      );
      const previous = await screen.findByRole('dialog');
      await user.click(within(previous).getByRole('button', { name: translate(locale, 'close') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    const opener = await screen.findByRole('button', { name: translate(locale, 'addMatch') });
    if (dismiss === 'escape') {
      opener.focus();
      await user.keyboard('{Enter}');
    } else await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: translate(locale, 'addMatch') });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole('textbox', { name: translate(locale, 'matchId') }),
      ),
    );
    if (dismiss === 'escape') await user.keyboard('{Escape}');
    else
      await user.click(
        within(dialog).getByRole('button', {
          name: translate(locale, dismiss === 'cancel' ? 'cancel' : 'close'),
        }),
      );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(native.calls.some((call) => call.method === 'matches.add')).toBe(false);
  });
  it.each(['zh', 'en'] as const)(
    'opens an added unknown-outcome match without changing filters in %s',
    async (locale) => {
      history.replaceState(null, '', '#archive');
      let saved: ReturnType<typeof matchFixture> | null = null;
      const native = nativeFixture(initial(locale), {
        'matches.list': () => (saved ? [saved] : []),
        'matches.add': ({ fid }) => {
          saved = matchFixture({ id: fid, fid, map: 'New unknown match', outcome: 'unknown' });
          return saved;
        },
        'matches.detail': () => saved!,
      });
      render(<App />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: translate(locale, 'addMatch') }));
      const dialog = screen.getByRole('dialog');
      await user.type(
        within(dialog).getByRole('textbox', { name: translate(locale, 'matchId') }),
        '99901',
      );
      await user.click(within(dialog).getByRole('button', { name: translate(locale, 'addMatch') }));
      await screen.findByText(translate(locale, 'archiveAddedMatch', { id: '99901' }));
      expect(
        screen
          .getByRole('switch', { name: translate(locale, 'hideUnknownResults') })
          .getAttribute('aria-checked'),
      ).toBe('true');
      expect(screen.queryByRole('button', { name: 'New unknown match' })).toBeNull();
      await user.click(screen.getByRole('button', { name: translate(locale, 'openAddedMatch') }));
      expect(
        await screen.findByRole('dialog', { name: `${translate(locale, 'matchDetail')} · #99901` }),
      ).toBeTruthy();
    },
  );
  it.each(['zh', 'en'] as const)(
    'keeps numeric match IDs valid after service failure and retries in %s',
    async (locale) => {
      let failed = true;
      const match = matchFixture({
        id: '99902',
        fid: '99902',
        map: 'Recovered match',
        outcome: 'win',
      });
      const native = nativeFixture(initial(locale), {
        'matches.list': () => (failed ? [] : [match]),
        'matches.add': () => {
          if (failed) throw new Error('Controlled add failure');
          return match;
        },
      });
      render(<MatchArchive />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: translate(locale, 'addMatch') }));
      const dialog = screen.getByRole('dialog'),
        input = within(dialog).getByRole('textbox', { name: translate(locale, 'matchId') });
      await user.type(input, '99902');
      await user.click(within(dialog).getByRole('button', { name: translate(locale, 'addMatch') }));
      await within(dialog).findByText('Error: Controlled add failure');
      expect(input.getAttribute('aria-invalid')).not.toBe('true');
      expect((input as HTMLInputElement).value).toBe('99902');
      failed = false;
      await user.click(within(dialog).getByRole('button', { name: translate(locale, 'addMatch') }));
      expect(await screen.findByRole('button', { name: 'Recovered match' })).toBeTruthy();
    },
  );
});

describe('workspace loading stability', () => {
  for (const locale of ['zh', 'en'] as const) {
    const t = (key: string) => translate(locale, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = locale;
      value.session.phase = 'lobby';
      value.session.current = null;
      value.session.lobbyPlayers = [
        { ...localPlayer, teamId: 0 },
        { ...secondPlayer, teamId: 1 },
      ];
      return value;
    };
    it(`retains room and search controls across loading, failure, retry, empty and clear in ${locale}`, async () => {
      let response = deferred<RpcOutputs['players.search']>();
      const native = nativeFixture(initial(), { 'players.search': () => response.promise });
      render(<PlayersPanel />, { wrapper: wrapper(native.api) });
      const input = await screen.findByRole('searchbox', { name: t('searchLabel') });
      const region = screen.getByRole('region', { name: t('searchResults') });
      const room = screen.getByRole('region', { name: t('currentRoomPlayers') });
      const picker = within(room).getByRole('button', { name: t('currentRoomPlayers') });
      expect(picker.getAttribute('aria-expanded')).toBe('false');
      const initialRoomSession = structuredClone(native.backend.session);
      input.focus();
      act(() =>
        native.emit({
          type: 'session',
          session: { ...initialRoomSession, lobbyPlayers: [] },
          revision: native.backend.revision + 1,
        }),
      );
      expect(picker.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(input);
      act(() =>
        native.emit({
          type: 'session',
          session: initialRoomSession,
          revision: native.backend.revision + 1,
        }),
      );
      expect(picker.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(picker);
      let roomButton = within(room).getByRole('button', {
        name: `${localPlayer.name} #${localPlayer.id}`,
      });
      const submit = () => {
        fireEvent.change(input, { target: { value: 'Alpha' } });
        fireEvent.click(screen.getByRole('button', { name: t('search') }));
      };
      submit();
      expect(roomButton.isConnected).toBe(true);
      const roomSession = structuredClone(native.backend.session);
      input.focus();
      act(() =>
        native.emit({
          type: 'session',
          session: { ...roomSession, lobbyPlayers: [] },
          revision: native.backend.revision + 1,
        }),
      );
      expect(picker.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(input);
      expect(input.isConnected).toBe(true);
      act(() =>
        native.emit({
          type: 'session',
          session: roomSession,
          revision: native.backend.revision + 1,
        }),
      );
      roomButton = within(room).getByRole('button', {
        name: `${localPlayer.name} #${localPlayer.id}`,
      });
      await act(async () => response.resolve({ source: 'local', players: [localPlayer] }));
      const result = await within(region).findByRole('button', {
        name: new RegExp('^' + localPlayer.name),
      });
      response = deferred();
      fireEvent.change(input, { target: { value: 'Bravo' } });
      fireEvent.click(screen.getByRole('button', { name: t('search') }));
      result.focus();
      await act(async () => response.reject(new Error('Controlled layout failure')));
      expect(document.activeElement).toBe(result);
      expect(result.isConnected).toBe(true);
      expect(roomButton.isConnected).toBe(true);
      expect(region.contains(screen.getByText('Controlled layout failure'))).toBe(true);
      expect(
        result.compareDocumentPosition(screen.getByText('Controlled layout failure')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      response = deferred();
      fireEvent.click(within(region).getByRole('button', { name: t('retry') }));
      expect(document.activeElement).toBe(input);
      await act(async () => response.resolve({ source: 'local', players: [] }));
      expect(within(region).getByText(t('searchEmpty'))).toBeTruthy();
      expect(roomButton.isConnected).toBe(true);
      fireEvent.click(within(region).getByRole('button', { name: t('clearSearch') }));
      expect(document.activeElement).toBe(input);
      expect(screen.getByRole('region', { name: t('searchResults') })).toBe(region);
      expect(within(region).queryByText(t('searchEmpty'))).toBeNull();
      expect(roomButton.isConnected).toBe(true);
    });
    it(`shows the selected report heading and restores its originating player through loading and failure in ${locale}`, async () => {
      const first = deferred<RpcOutputs['players.report']>(),
        second = deferred<RpcOutputs['players.report']>();
      const native = nativeFixture(initial(), {
        'players.report': ({ id }) => (id === localPlayer.id ? first.promise : second.promise),
      });
      render(<PlayersPanel />, { wrapper: wrapper(native.api) });
      const room = await screen.findByRole('region', { name: t('currentRoomPlayers') });
      const user = userEvent.setup();
      await user.click(within(room).getByRole('button', { name: t('currentRoomPlayers') }));
      const a = within(room).getByRole('button', {
        name: `${localPlayer.name} #${localPlayer.id}`,
      });
      await user.click(a);
      const heading = screen.getByRole('heading', { name: `${t('report')} · #${localPlayer.id}` });
      expect(document.activeElement).toBe(heading);
      const back = screen.getByRole('button', { name: t('backToPlayerSelection') });
      await user.click(back);
      expect(document.activeElement).toBe(a);
      await user.click(a);
      expect(document.activeElement).toBe(heading);
      await user.click(back);
      expect(document.activeElement).toBe(a);
      const b = within(room).getByRole('button', {
        name: `${secondPlayer.name} #${secondPlayer.id}`,
      });
      await user.click(b);
      await act(async () =>
        first.resolve(reportFixture({ id: localPlayer.id, name: 'Old report' })),
      );
      expect(screen.queryByRole('heading', { name: `Old report #${localPlayer.id}` })).toBeNull();
      await act(async () => second.reject(new Error('Controlled report failure')));
      expect(screen.getByText('Controlled report failure')).toBeTruthy();
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: `${t('report')} · #${secondPlayer.id}` }),
      );
      await user.click(back);
      expect(document.activeElement).toBe(b);
    });
    it(`retains deck selection and operation identity when refresh grows and shrinks the file list in ${locale}`, async () => {
      const single: RpcOutputs['decks.list'] = {
        found: true,
        decksDir: 'A',
        backupsDir: 'A/Backups',
        decks: [{ name: 'Ready.dek', size: 1, modifiedAt: 1 }],
        backups: [],
      };
      let response = deferred<RpcOutputs['decks.list']>(),
        reads = 0;
      const native = nativeFixture(initial(), {
        'decks.list': () => (++reads === 1 ? single : response.promise),
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup(),
        checkbox = await screen.findByRole('checkbox', { name: 'Ready.dek' });
      await user.click(checkbox);
      const viewport = document.getElementById('front-decks'),
        backup = screen.getByRole('button', { name: t('backupAll') }),
        refresh = screen.getByRole('button', { name: t('refresh') });
      await user.click(refresh);
      backup.focus();
      const large = {
        ...single,
        decks: [
          ...single.decks,
          ...Array.from({ length: 20 }, (_, index) => ({
            name: `Added-${index}.dek`,
            size: 1,
            modifiedAt: 1,
          })),
        ],
      };
      await act(async () => response.resolve(large));
      expect(document.activeElement).toBe(backup);
      expect(document.getElementById('front-decks')).toBe(viewport);
      expect(checkbox.getAttribute('aria-checked')).toBe('true');
      await user.click(backup);
      const dialog = await screen.findByRole('dialog', { name: t('backupAll') });
      expect(
        within(dialog)
          .getByRole('list', { name: t('backupContents') })
          .querySelectorAll('li'),
      ).toHaveLength(21);
      await user.click(within(dialog).getByRole('button', { name: t('cancel') }));
      response = deferred();
      await user.click(refresh);
      backup.focus();
      await act(async () => response.resolve(single));
      expect(document.activeElement).toBe(backup);
      expect(checkbox.getAttribute('aria-checked')).toBe('true');
      expect(document.getElementById('front-decks')).toBe(viewport);
      expect(native.calls.some((call) => call.method === 'decks.backup')).toBe(false);
    });
    it(`retains the same deck refresh control through cold loading, failure and directory discovery in ${locale}`, async () => {
      let response = deferred<RpcOutputs['decks.list']>();
      const native = nativeFixture(initial(), { 'decks.list': () => response.promise });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const button = await screen.findByRole('button', { name: t('refresh') });
      button.focus();
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(document.querySelectorAll('.decks-panel [data-slot=skeleton]')).toHaveLength(6);
      fireEvent.click(button);
      expect(native.calls.filter((call) => call.method === 'decks.list')).toHaveLength(1);
      await act(async () => response.reject(new Error('Controlled cold deck failure')));
      expect(screen.getAllByText(t('deckListUnavailable'))).toHaveLength(2);
      expect(document.activeElement).toBe(button);
      response = deferred();
      fireEvent.click(button);
      const missing: RpcOutputs['decks.list'] = {
        found: false,
        decksDir: 'A',
        backupsDir: 'A/Backups',
        decks: [],
        backups: [],
      };
      await act(async () => response.resolve(missing));
      expect(screen.getByText(t('deckMissing'))).toBeTruthy();
      expect(screen.getByRole('button', { name: t('refresh') })).toBe(button);
      response = deferred();
      fireEvent.click(button);
      await act(async () =>
        response.resolve({
          ...missing,
          found: true,
          decks: [{ name: 'Ready.dek', size: 1, modifiedAt: 1 }],
        }),
      );
      expect(await screen.findByRole('checkbox', { name: 'Ready.dek' })).toBeTruthy();
      expect(document.activeElement).toBe(button);
      expect(button.isConnected).toBe(true);
    });
    it(`keeps cache usage placeholders truthful and cleanup unavailable through cold loading and recovery in ${locale}`, async () => {
      let response = deferred<RpcOutputs['cache.stats']>();
      const native = nativeFixture(initial(), { 'cache.stats': () => response.promise });
      render(<CacheSettings />, { wrapper: wrapper(native.api) });
      const usage = (await screen.findByRole('heading', { name: t('cacheUsage') })).closest(
        'section',
      )!;
      const cleanup = screen.getByText(t('cacheCleanup')).closest('[data-slot=card]')!;
      const action = within(cleanup as HTMLElement).getByRole('button', {
        name: t('cacheClearExpired'),
      });
      await waitFor(() => expect(usage.querySelectorAll('[data-slot=skeleton]')).toHaveLength(5));
      expect(action.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(action);
      expect(native.calls.some((call) => call.method === 'cache.clear')).toBe(false);
      await act(async () => response.reject(new Error('Controlled cold cache failure')));
      expect(usage.textContent).toContain(t('cacheStatsUnavailable'));
      expect([...usage.querySelectorAll('dd')].map((node) => node.textContent)).toEqual([
        '—',
        '—',
        '—',
      ]);
      expect(screen.getByText(t('cacheCleanup')).closest('[data-slot=card]')).toBe(cleanup);
      response = deferred();
      fireEvent.click(within(usage).getByRole('button', { name: t('refresh') }));
      const stats: RpcOutputs['cache.stats'] = {
        at: 1700000000000,
        nextExpiryAt: null,
        api: { entries: 3, expired: 1, bytes: 2048 },
        snapshots: { entries: 2, expired: 0, bytes: 1024 },
      };
      await act(async () => response.resolve(stats));
      expect(action.getAttribute('aria-disabled')).toBe('false');
      expect(usage.querySelector('dd')?.textContent).toBe('5');
      expect(screen.getByText(t('cacheCleanup')).closest('[data-slot=card]')).toBe(cleanup);
      expect(usage.querySelectorAll('[data-slot=skeleton]')).toHaveLength(0);
    });
  }
});

describe('archive presentation and palette scope', () => {
  for (const locale of ['zh', 'en'] as const) {
    const t = (key: string) => translate(locale, key);
    it(`exposes outcome, dates, duration and unknown facts on archive cards in ${locale}`, async () => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      const rows = [
        matchFixture({
          id: '501',
          fid: '501',
          outcome: 'win',
          endedAt: 1700000000000,
          durationSec: 300,
        }),
        matchFixture({
          id: '502',
          fid: '502',
          outcome: 'loss',
          endedAt: null,
          startedAt: 1700000100000,
          durationSec: 0,
        }),
        matchFixture({
          id: 'local:unknown',
          fid: null,
          outcome: 'unknown',
          endedAt: null,
          startedAt: null,
          durationSec: null,
        }),
        matchFixture({ id: '504', fid: '504', outcome: 'unknown', restarted: true }),
      ];
      const native = nativeFixture(initial);
      render(
        <>
          {rows.map((match) => (
            <MatchArchiveCard key={match.id} match={match} />
          ))}
        </>,
        { wrapper: wrapper(native.api) },
      );
      await screen.findByLabelText(`${t('result')}: ${t('win')}`);
      expect(screen.getByLabelText(`${t('result')}: ${t('loss')}`)).toBeTruthy();
      expect(screen.getByLabelText(`${t('result')}: ${t('unknown')}`)).toBeTruthy();
      expect(screen.getByLabelText(`${t('result')}: ${t('restarted')}`)).toBeTruthy();
      const cards = document.querySelectorAll('.archive-card');
      for (const index of [0, 1]) {
        const at = rows[index]!.endedAt ?? rows[index]!.startedAt!;
        expect(cards[index]!.querySelector('time')?.dateTime).toBe(new Date(at).toISOString());
        expect(cards[index]!.textContent).toContain(formatTime(at, locale));
        expect(cards[index]!.textContent).toContain(formatDuration(rows[index]!.durationSec));
      }
      expect(cards[2]!.textContent).toContain(t('matchTimeUnknown'));
      expect(cards[2]!.textContent).toContain(t('matchDurationUnknown'));
      expect(cards[2]!.querySelector('time')).toBeNull();
      expect(native.calls.filter((call) => call.method === 'matches.detail')).toEqual([]);
    });
    for (const view of ['list', 'grid'] as const) {
      it(`keeps refresh, external links and reviewed delete recovery in ${view} view in ${locale}`, async () => {
        const initial = bootstrapForApp();
        initial.config.lang = locale;
        const match = matchFixture({ id: '701', fid: '701', map: 'Action match', outcome: 'loss' });
        const local = matchFixture({
          id: 'local:actions',
          fid: null,
          map: 'Local action match',
          outcome: 'win',
        });
        let rows = [match, local],
          fail = true;
        const native = nativeFixture(initial, {
          'matches.list': () => structuredClone(rows),
          'matches.detail': () => match,
          'external.open': () => null,
          'matches.delete': () => {
            if (fail) throw new Error('HISTORY_TARGET_CHANGED');
            rows = rows.filter((row) => row.id !== match.id);
            return {
              removed: true,
              removedMatches: 1,
              retainedMatches: 0,
              backup: {
                name: 'match-backup.json',
                version: 'a'.repeat(64),
                kind: 'match',
                createdAt: 1700000000000,
                target: { id: match.id, name: match.map },
                matchCount: 1,
                restoredAt: null,
              },
            };
          },
        });
        render(<MatchArchive />, { wrapper: wrapper(native.api) });
        const user = userEvent.setup();
        await screen.findByRole('button', { name: match.map });
        if (view === 'grid') await user.click(screen.getByRole('radio', { name: t('gridView') }));
        const menu = () => screen.getByRole('button', { name: `${t('actions')}: #701` });
        const choose = async (label: string) => {
          await user.click(menu());
          await user.click(await screen.findByRole('menuitem', { name: label }));
        };
        await choose(t('refresh'));
        await waitFor(() =>
          expect(
            native.calls.some(
              (call) =>
                call.method === 'matches.detail' &&
                JSON.stringify(call.input) ===
                  JSON.stringify({ fid: '701', force: true, accountId: match.localPlayerId }),
            ),
          ).toBe(true),
        );
        await choose(t('openBatrace'));
        expect(native.calls.find((call) => call.method === 'external.open')?.input).toEqual({
          url: `${BATRACE_ORIGIN}/match/701`,
        });
        await user.click(screen.getByRole('button', { name: `${t('actions')}: #local:actions` }));
        expect(screen.queryByRole('menuitem', { name: t('refresh') })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: t('openBatrace') })).toBeNull();
        expect(screen.getByRole('menuitem', { name: t('delete') })).toBeTruthy();
        await user.keyboard('{Escape}');
        await choose(t('delete'));
        let dialog = await screen.findByRole('alertdialog');
        expect(dialog.textContent).toContain(match.map);
        expect(dialog.textContent).toContain('match-backup.json');
        await user.click(within(dialog).getByRole('button', { name: t('cancel') }));
        expect(native.calls.filter((call) => call.method === 'matches.delete')).toEqual([]);
        await waitFor(() => expect(document.activeElement).toBe(menu()));
        await choose(t('delete'));
        dialog = await screen.findByRole('alertdialog');
        await user.click(within(dialog).getByRole('button', { name: t('delete') }));
        await screen.findAllByText(t('HISTORY_TARGET_CHANGED'));
        expect(screen.getByRole('button', { name: match.map })).toBeTruthy();
        fail = false;
        await choose(t('delete'));
        await user.click(
          within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('delete') }),
        );
        await waitFor(() => expect(screen.queryByRole('button', { name: match.map })).toBeNull());
        expect(screen.getByRole('button', { name: local.map })).toBeTruthy();
        expect(
          native.calls.filter((call) => call.method === 'matches.delete').map((call) => call.input),
        ).toEqual([
          { token: '11111111-1111-4111-8111-111111111111' },
          { token: '11111111-1111-4111-8111-111111111111' },
        ]);
      });
    }
    it(`keeps individual and pair scope visible and keyboard choices independent in ${locale}`, async () => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      const changes = vi.fn();
      function AppearanceProbe() {
        const [draft, setDraft] = useState(initial.config);
        return (
          <AppearanceSettings
            draft={draft}
            change={(patch) => {
              changes(patch);
              setDraft((current) => ({ ...current, ...patch }));
            }}
          />
        );
      }
      render(<AppearanceProbe />, { wrapper: wrapper(nativeFixture(initial).api) });
      expect(await screen.findByText(t('colorSchemeHint'))).toBeTruthy();
      const user = userEvent.setup();
      const card = document.querySelector<HTMLElement>('[data-theme-library-card=forest]')!;
      const light = within(card).getByRole('button', {
        name: `${t('theme.forest')} · ${t('themeMode.light')}`,
      });
      const dark = within(card).getByRole('button', {
        name: `${t('theme.forest')} · ${t('themeMode.dark')}`,
      });
      expect(within(light).getByText(t('themeMode.light'))).toBeTruthy();
      expect(within(dark).getByText(t('themeMode.dark'))).toBeTruthy();
      const pair = within(card).getByRole('button', {
        name: `${t('theme.forest')} · ${t('selectPalettePair')}`,
      });
      expect(within(pair).getByText(t('selectPalettePair'))).toBeTruthy();
      light.focus();
      await user.keyboard(' ');
      expect(changes.mock.calls.at(-1)).toEqual([{ lightTheme: 'forest' }]);
      expect(dark.getAttribute('aria-pressed')).toBe('false');
      dark.focus();
      await user.keyboard(' ');
      expect(changes.mock.calls.at(-1)).toEqual([{ darkTheme: 'forest' }]);
      pair.focus();
      await user.keyboard('{Enter}');
      expect(changes.mock.calls.at(-1)).toEqual([{ lightTheme: 'forest', darkTheme: 'forest' }]);
      expect(changes.mock.calls.every(([patch]) => !('themeMode' in patch))).toBe(true);
    });
  }
});

describe('reviewed history operations', () => {
  const plan = (kind: 'account' | 'match'): HistoryDeletePlan => ({
    token: '22222222-2222-4222-8222-222222222222',
    kind,
    target: {
      id: kind === 'account' ? '1' : '102',
      name: kind === 'account' ? 'Alpha' : 'Shared match',
    },
    removed: [
      {
        id: kind === 'account' ? '101' : '102',
        fid: kind === 'account' ? '101' : '102',
        map: kind === 'account' ? 'Exclusive match' : 'Shared match',
        at: 1700000000000,
        accounts:
          kind === 'match'
            ? [
                { id: '1', name: 'Alpha' },
                { id: '2', name: 'Bravo' },
              ]
            : [],
      },
    ],
    retained:
      kind === 'account'
        ? [
            {
              id: '102',
              fid: '102',
              map: 'Shared match',
              at: 1700000000000,
              accounts: [{ id: '2', name: 'Bravo' }],
            },
          ]
        : [],
    affectedAccounts:
      kind === 'account'
        ? [{ id: '1', name: 'Alpha' }]
        : [
            { id: '1', name: 'Alpha' },
            { id: '2', name: 'Bravo' },
          ],
    backupDirectory: 'test-profile/HistoryBackups',
    backupName: kind + '-recovery.json',
  });
  const result = (value: HistoryDeletePlan): HistoryDeleteResult => ({
    removed: true,
    removedMatches: value.removed.length,
    retainedMatches: value.retained.length,
    backup: {
      name: value.backupName,
      version: 'a'.repeat(64),
      kind: value.kind,
      createdAt: 1700000000000,
      target: value.target,
      matchCount: value.removed.length + value.retained.length,
      restoredAt: null,
    },
  });
  it.each(['zh', 'en'] as const)(
    'reviews account scope, guards overlap and ignores old lists after deletion in %s',
    async (locale) => {
      history.replaceState(null, '', '#settings/accounts');
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      const original = [
        { id: '1', name: 'Alpha', persona: 'Alpha', firstSeen: 1, lastSeen: 2, matchCount: 2 },
        { id: '2', name: 'Bravo', persona: 'Bravo', firstSeen: 1, lastSeen: 2, matchCount: 2 },
      ];
      let accounts = structuredClone(original),
        listCalls = 0;
      const old = deferred<RpcOutputs['accounts.list']>();
      const review = vi.fn(() => plan('account'));
      const native = nativeFixture(bootstrap, {
        'accounts.list': () => (++listCalls === 1 ? old.promise : structuredClone(accounts)),
        'accounts.planDelete': review,
        'accounts.delete': (input) => {
          expect(input).toEqual({ token: plan('account').token });
          accounts = accounts.filter((account) => account.id !== '1');
          native.emit({ type: 'matches', revision: native.backend.revision + 1 });
          return result(plan('account'));
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      await waitFor(() => expect(listCalls).toBe(1));
      act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
      const user = userEvent.setup();
      const row = () =>
        screen
          .getByText('Alpha', { selector: '[data-slot=item-title]' })
          .closest('[data-slot=item]') as HTMLElement;
      await screen.findByText('Alpha', { selector: '[data-slot=item-title]' });
      await user.click(
        within(row()).getByRole('button', {
          name: translate(locale, 'deleteAccountAction', { name: 'Alpha', id: '1' }),
        }),
      );
      const confirmation = await screen.findByRole('alertdialog');
      expect(confirmation.textContent).toContain('Exclusive match');
      expect(confirmation.textContent).toContain('Shared match');
      expect(confirmation.textContent).toContain('Bravo #2');
      expect(confirmation.textContent).toContain('account-recovery.json');
      expect(confirmation.textContent).toContain(
        translate(locale, 'historyRemovedMatches', { count: 1 }),
      );
      expect(confirmation.textContent).toContain(
        translate(locale, 'historyRetainedMatches', { count: 1 }),
      );
      expect(
        within(row())
          .getByRole('button', {
            name: translate(locale, 'deleteAccountAction', { name: 'Alpha', id: '1' }),
            hidden: true,
          })
          .hasAttribute('disabled'),
      ).toBe(true);
      expect(review).toHaveBeenCalledTimes(1);
      await user.click(
        within(confirmation).getByRole('button', { name: translate(locale, 'delete') }),
      );
      await waitFor(() =>
        expect(screen.queryByText('Alpha', { selector: '[data-slot=item-title]' })).toBeNull(),
      );
      await act(async () => old.resolve(original));
      expect(screen.queryByText('Alpha', { selector: '[data-slot=item-title]' })).toBeNull();
      expect(screen.getByText('Bravo', { selector: '[data-slot=item-title]' })).toBeTruthy();
      expect(
        screen.getByText(translate(locale, 'historyDeleteResult', { removed: 1, retained: 1 })),
      ).toBeTruthy();
    },
  );
  it.each(['zh', 'en'] as const)(
    'shows all match owners and restores through conflict feedback and retry in %s',
    async (locale) => {
      history.replaceState(null, '', '#archive');
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      const match = matchFixture({ id: '102', fid: '102', map: 'Shared match', outcome: 'win' });
      let matches = [match],
        restored = false,
        failRestore = true;
      const outcome = result(plan('match'));
      const native = nativeFixture(bootstrap, {
        'matches.list': () => structuredClone(matches),
        'matches.planDelete': () => plan('match'),
        'matches.delete': (input) => {
          expect(input).toEqual({ token: plan('match').token });
          matches = [];
          native.emit({ type: 'matches', revision: native.backend.revision + 1 });
          return outcome;
        },
        'history.backups': () => ({
          directory: 'test-profile/HistoryBackups',
          backups: [{ ...outcome.backup, restoredAt: restored ? 1700000000001 : null }],
        }),
        'history.restore': (input) => {
          expect(input).toEqual({ name: outcome.backup.name, version: outcome.backup.version });
          if (failRestore) throw new Error('HISTORY_RESTORE_CONFLICT');
          restored = true;
          matches = [match];
          native.emit({ type: 'matches', revision: native.backend.revision + 1 });
          return { restoredMatches: 1, restoredAccounts: 0 };
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('button', { name: `${translate(locale, 'actions')}: #102` }),
      );
      await user.click(screen.getByRole('menuitem', { name: translate(locale, 'delete') }));
      const confirmation = await screen.findByRole('alertdialog');
      expect(confirmation.textContent).toContain('Alpha #1, Bravo #2');
      await user.click(
        within(confirmation).getByRole('button', { name: translate(locale, 'delete') }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: `${translate(locale, 'actions')}: #102` }),
        ).toBeNull(),
      );
      await user.click(
        screen.getAllByRole('button', { name: translate(locale, 'historyRecovery') })[0]!,
      );
      const dialog = await screen.findByRole('dialog', {
        name: translate(locale, 'historyRecovery'),
      });
      const restore = async () => {
        await user.click(
          await within(dialog).findByRole('button', {
            name: translate(locale, 'historyRestoreAction'),
          }),
        );
        const confirmation = await screen.findByRole('alertdialog');
        await user.click(
          within(confirmation).getByRole('button', {
            name: translate(locale, 'historyRestoreAction'),
          }),
        );
      };
      await restore();
      await within(dialog).findByText(translate(locale, 'HISTORY_RESTORE_CONFLICT'));
      failRestore = false;
      await restore();
      await within(dialog).findByText(
        translate(locale, 'historyRestoreResult', { matches: 1, accounts: 0 }),
      );
      expect(
        within(dialog)
          .getByRole('button', { name: translate(locale, 'historyAlreadyRestored') })
          .hasAttribute('disabled'),
      ).toBe(true);
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      expect(native.calls.filter((call) => call.method === 'history.restore')).toHaveLength(2);
    },
  );
});

describe('recording preference and capture decisions', () => {
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['inline', 'dialog'] as const).map((surface) => ({ locale, surface })),
    ),
  )(
    'prevents a recording test during a pending auto-record preference on $surface in $locale',
    async ({ locale, surface }) => {
      const bootstrap = initial(locale, false),
        held = deferred<null>();
      const native = nativeFixture(bootstrap, {
        'displays.thumbnail': () => null,
        'config.update': async (patch) => {
          await held.promise;
          const config = configSchema.parse({ ...native.backend.config, ...patch });
          native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
          return config;
        },
      });
      renderSurface(surface, native.api);
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'autoRecord') }),
      );
      const test = screen.getByRole('button', { name: translate(locale, 'recordingTest') });
      expect(test.hasAttribute('disabled')).toBe(true);
      await user.click(test);
      expect(native.calls.some((call) => call.method === 'replays.test')).toBe(false);
      await act(async () => held.resolve(null));
      await waitFor(() => expect(test.hasAttribute('disabled')).toBe(false));
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['watcher error', 'ended match'] as const).map((condition) => ({ locale, condition })),
    ),
  )('withholds recording retry after $condition in $locale', async ({ locale, condition }) => {
    const bootstrap = initial(locale, false);
    bootstrap.config.replayEnabled = true;
    bootstrap.recording = {
      ...bootstrap.recording,
      phase: 'error',
      error: 'Controlled earlier capture failure',
      failure: { kind: 'start', discarded: true },
    };
    if (condition === 'watcher error') bootstrap.watcher.error = 'Controlled read failure';
    else bootstrap.session.current = { ...bootstrap.session.current!, endedAt: 1700000060000 };
    const native = nativeFixture(bootstrap, { 'displays.thumbnail': () => null });
    renderSurface('inline', native.api);
    await screen.findByText(translate(locale, 'recordingStartFailed'));
    expect(
      screen.queryByRole('button', { name: translate(locale, 'recordingRetryCurrent') }),
    ).toBeNull();
    expect(screen.getByText(translate(locale, 'recordingRetryCondition'))).toBeTruthy();
    expect(native.calls.some((call) => call.method === 'replays.retry')).toBe(false);
  });
  const surfaces = ['page', 'inline', 'dialog'] as const;
  function initial(locale: 'zh' | 'en', active = true) {
    const value = bootstrapForApp();
    value.config.lang = locale;
    value.config.replayEnabled = active;
    value.session.current = matchFixture({
      id: '99001',
      fid: '99001',
      map: 'Reviewed Alpha',
      endedAt: null,
    });
    value.session.recovering = false;
    value.watcher.live = true;
    value.recording = {
      ...value.recording,
      phase: active ? 'recording' : 'idle',
      sessionId: active ? 'capture-alpha' : null,
      fid: '99001',
      map: 'Reviewed Alpha',
      error: null,
    };
    return value;
  }
  function renderSurface(surface: (typeof surfaces)[number], api: Bridge) {
    return render(
      surface === 'page' ? <ReplaysPanel /> : <RecordingSettings inline={surface === 'inline'} />,
      { wrapper: wrapper(api) },
    );
  }
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      surfaces.flatMap((surface) =>
        (['cancel', 'finish', 'stop'] as const).map((choice) => ({ locale, surface, choice })),
      ),
    ),
  )(
    'reviews $choice on $surface in $locale before changing an active capture',
    async ({ locale, surface, choice }) => {
      const native = nativeFixture(initial(locale), {
        'displays.thumbnail': () => null,
        'replays.stop': ({ sessionId }) => {
          expect(sessionId).toBe('capture-alpha');
          const recording = {
            ...native.backend.recording,
            phase: 'idle' as const,
            sessionId: null,
          };
          native.emit({ type: 'recording', recording, revision: native.backend.revision + 1 });
          return recording;
        },
      });
      renderSurface(surface, native.api);
      const user = userEvent.setup();
      const toggle = await screen.findByRole('switch', { name: translate(locale, 'autoRecord') });
      await user.click(toggle);
      const review = await screen.findByRole('dialog', {
        name: translate(locale, 'recordingDisableTitle'),
      });
      expect(review.textContent).toContain('Reviewed Alpha');
      expect(review.textContent).toContain('#99001');
      expect(review.textContent).toContain(translate(locale, 'recordingStopWarning'));
      expect(
        native.calls.some(
          (call) => call.method === 'config.update' || call.method === 'replays.stop',
        ),
      ).toBe(false);
      await user.click(
        within(review).getByRole('button', {
          name: translate(
            locale,
            choice === 'cancel'
              ? 'cancel'
              : choice === 'finish'
                ? 'recordingFinishCurrent'
                : 'recordingStopNow',
          ),
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: translate(locale, 'recordingDisableTitle') }),
        ).toBeNull(),
      );
      expect(native.backend.config.replayEnabled).toBe(choice === 'cancel');
      expect(native.calls.filter((call) => call.method === 'replays.stop')).toHaveLength(
        choice === 'stop' ? 1 : 0,
      );
      expect(native.backend.recording.phase).toBe(choice === 'stop' ? 'idle' : 'recording');
      expect(toggle.getAttribute('aria-checked')).toBe(choice === 'cancel' ? 'true' : 'false');
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      ([true, false] as const).flatMap((enabled) =>
        (['success', 'failure'] as const).map((outcome) => ({ locale, enabled, outcome })),
      ),
    ),
  )(
    'exposes the pending $enabled preference and recovers $outcome in $locale',
    async ({ locale, enabled, outcome }) => {
      const bootstrap = initial(locale, false);
      bootstrap.config.replayEnabled = !enabled;
      const held = deferred<null>();
      let attempts = 0;
      const native = nativeFixture(bootstrap, {
        'config.update': async (patch) => {
          if (++attempts === 1) {
            await held.promise;
            if (outcome === 'failure') throw new Error('Controlled preference failure');
          }
          const config = configSchema.parse({ ...native.backend.config, ...patch });
          native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
          return config;
        },
      });
      renderSurface('page', native.api);
      const user = userEvent.setup();
      const toggle = await screen.findByRole('switch', { name: translate(locale, 'autoRecord') });
      await user.click(toggle);
      expect(toggle.hasAttribute('disabled')).toBe(true);
      expect(toggle.getAttribute('aria-checked')).toBe(String(enabled));
      expect(toggle.closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
      await user.click(toggle);
      expect(attempts).toBe(1);
      await act(async () => held.resolve(null));
      await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
      if (outcome === 'failure') {
        expect(toggle.getAttribute('aria-checked')).toBe(String(!enabled));
        await screen.findByText(translate(locale, 'recordingPreferenceNotSaved'));
        await user.click(screen.getByRole('button', { name: translate(locale, 'settingsRetry') }));
        await waitFor(() => expect(native.backend.config.replayEnabled).toBe(enabled));
        expect(attempts).toBe(2);
      } else expect(native.backend.config.replayEnabled).toBe(enabled);
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['inline', 'dialog'] as const).map((surface) => ({ locale, surface })),
    ),
  )(
    'separates a saved preference from failed startup and an explicit capture retry on $surface in $locale',
    async ({ locale, surface }) => {
      const bootstrap = initial(locale, false);
      const native = nativeFixture(bootstrap, {
        'displays.thumbnail': () => null,
        'config.update': (patch) => {
          const config = configSchema.parse({ ...native.backend.config, ...patch });
          native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
          const recording = {
            ...native.backend.recording,
            phase: 'error' as const,
            error: 'Controlled display failure',
            failure: { kind: 'start' as const, discarded: true },
          };
          native.emit({ type: 'recording', recording, revision: native.backend.revision + 1 });
          return config;
        },
        'replays.retry': () => {
          const recording = {
            ...native.backend.recording,
            phase: 'recording' as const,
            sessionId: 'capture-retry',
            error: null,
            failure: null,
          };
          native.emit({ type: 'recording', recording, revision: native.backend.revision + 1 });
          return recording;
        },
      });
      renderSurface(surface, native.api);
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'autoRecord') }),
      );
      await screen.findByText(translate(locale, 'recordingStartFailed'));
      expect(native.backend.config.replayEnabled).toBe(true);
      expect(screen.queryByRole('button', { name: translate(locale, 'settingsRetry') })).toBeNull();
      expect(screen.getByText(translate(locale, 'recordingRetryLimit'))).toBeTruthy();
      await user.click(
        screen.getByRole('button', { name: translate(locale, 'recordingRetryCurrent') }),
      );
      await waitFor(() =>
        expect(screen.queryByText(translate(locale, 'recordingStartFailed'))).toBeNull(),
      );
      expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
      expect(native.calls.filter((call) => call.method === 'replays.retry')).toHaveLength(1);
    },
  );
  it.each(
    (['zh', 'en'] as const).flatMap((locale) => surfaces.map((surface) => ({ locale, surface }))),
  )(
    'keeps a failed stop separate from a saved disabled preference on $surface in $locale',
    async ({ locale, surface }) => {
      const native = nativeFixture(initial(locale), {
        'displays.thumbnail': () => null,
        'replays.stop': () => {
          const recording = {
            ...native.backend.recording,
            phase: 'error' as const,
            sessionId: null,
            error: 'Controlled save failure',
            failure: { kind: 'save' as const, discarded: true },
          };
          native.emit({ type: 'recording', recording, revision: native.backend.revision + 1 });
          throw new Error('Controlled save failure');
        },
      });
      renderSurface(surface, native.api);
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'autoRecord') }),
      );
      const review = await screen.findByRole('dialog', {
        name: translate(locale, 'recordingDisableTitle'),
      });
      await user.click(
        within(review).getByRole('button', { name: translate(locale, 'recordingStopNow') }),
      );
      await screen.findByText(translate(locale, 'recordingTemporaryDiscarded'));
      await screen.findByText(translate(locale, 'recordingPreferenceSavedCaptureUnchanged'));
      expect(native.backend.config.replayEnabled).toBe(false);
      expect(screen.queryByRole('button', { name: translate(locale, 'settingsRetry') })).toBeNull();
      expect(native.backend.recording.phase).toBe('error');
    },
  );
  it.each(['zh', 'en'] as const)(
    'rejects a changed reviewed capture without stopping the new capture in %s',
    async (locale) => {
      const native = nativeFixture(initial(locale), {
        'replays.stop': () => {
          throw new Error('RECORDING_TARGET_CHANGED');
        },
      });
      renderSurface('page', native.api);
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'autoRecord') }),
      );
      const review = await screen.findByRole('dialog', {
        name: translate(locale, 'recordingDisableTitle'),
      });
      await act(async () =>
        native.emit({
          type: 'recording',
          recording: { ...native.backend.recording, sessionId: 'capture-bravo', map: 'New Bravo' },
          revision: native.backend.revision + 1,
        }),
      );
      await user.click(
        within(review).getByRole('button', { name: translate(locale, 'recordingStopNow') }),
      );
      await screen.findByText(translate(locale, 'RECORDING_TARGET_CHANGED'));
      expect(native.backend.recording.sessionId).toBe('capture-bravo');
      expect(native.backend.recording.phase).toBe('recording');
      expect(native.backend.config.replayEnabled).toBe(false);
      expect(native.calls.find((call) => call.method === 'replays.stop')?.input).toEqual({
        sessionId: 'capture-alpha',
      });
    },
  );
});

describe('recording migration feedback and recovery', () => {
  const outcome = (to: string, committed = false): ReplayMoveResult => ({
    createdAt: Date.now(),
    from: 'A',
    to,
    directory: committed ? to : 'A',
    committed,
    moved: committed ? 2 : 0,
    copied: committed ? ['Alpha.webm', 'Bravo.webm'] : [],
    retained: committed ? [] : ['Alpha.webm', 'Bravo.webm'],
    destinationCopies: [],
    failed: committed ? [] : [{ name: 'Bravo.webm', message: 'REPLAY_MIGRATION_COLLISION' }],
  });
  async function changeFolder(locale: 'zh' | 'en', target: string) {
    const input = screen.getByRole('textbox', { name: translate(locale, 'saveDirectory') });
    fireEvent.change(input, { target: { value: target } });
    fireEvent.blur(input);
  }
  it.each(['zh', 'en'] as const)(
    'keeps detailed migration outcomes after discard and reopening the library in %s',
    async (locale) => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      initial.config.replaySaveDir = 'A';
      let result: ReplayMoveResult | null = null;
      const native = nativeFixture(initial, {
        'displays.thumbnail': () => null,
        'replays.directory': () => ({ dir: 'A', count: 2 }),
        'replays.move': ({ to }) => (result = outcome(to)),
        'replays.list': () => ({ directory: 'A', recordings: [], migration: result }),
      });
      const rendered = render(<RecordingSettings inline />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'migrateFilesOnChange') }),
      );
      await changeFolder(locale, 'B');
      const recovery = await reviewSettingsFailure(locale);
      await recovery.findByRole('button', { name: translate(locale, 'settingsRetry') });
      await user.click(recovery.getByRole('button', { name: translate(locale, 'close') }));
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(translate(locale, 'recordingMigrationErrors')),
        }),
      );
      expect(screen.getByText(/Bravo.webm:/).textContent).toContain(
        translate(locale, 'REPLAY_MIGRATION_COLLISION'),
      );
      const discardReview = await reviewSettingsFailure(locale);
      await user.click(
        discardReview.getByRole('button', { name: translate(locale, 'settingsDiscard') }),
      );
      await user.click(discardReview.getByRole('button', { name: translate(locale, 'close') }));
      expect(
        (
          screen.getByRole('textbox', {
            name: translate(locale, 'saveDirectory'),
          }) as HTMLInputElement
        ).value,
      ).toBe('A');
      expect(screen.queryByRole('button', { name: translate(locale, 'settingsRetry') })).toBeNull();
      expect(screen.getByText(translate(locale, 'recordingMigrationUnchanged'))).toBeTruthy();
      rendered.unmount();
      render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
      await screen.findByText(translate(locale, 'recordingMigrationUnchanged'));
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(translate(locale, 'recordingMigrationRetained')),
        }),
      );
      expect(screen.getByText('Alpha.webm')).toBeTruthy();
      expect(screen.getByText('Bravo.webm')).toBeTruthy();
      expect(native.backend.config.replaySaveDir).toBe('A');
    },
  );
  it.each(['zh', 'en'] as const)(
    'can choose another destination after a failed migration without hiding the outcome in %s',
    async (locale) => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      initial.config.replaySaveDir = 'A';
      let result: ReplayMoveResult | null = null;
      const native = nativeFixture(initial, {
        'displays.thumbnail': () => null,
        'replays.directory': () => ({ dir: 'A', count: 2 }),
        'replays.move': ({ to }) => (result = outcome(to, to === 'C')),
        'replays.list': () => ({
          directory: native.backend.config.replaySaveDir,
          recordings: [],
          migration: result,
        }),
      });
      render(<RecordingSettings inline />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'migrateFilesOnChange') }),
      );
      await changeFolder(locale, 'B');
      const recovery = await reviewSettingsFailure(locale);
      await recovery.findByRole('button', { name: translate(locale, 'settingsRetry') });
      await user.click(recovery.getByRole('button', { name: translate(locale, 'close') }));
      await changeFolder(locale, 'C');
      await screen.findByText(translate(locale, 'recordingMigrationCommitted'));
      await waitFor(() => expect(native.backend.config.replaySaveDir).toBe('C'));
      expect(
        native.calls
          .filter((call) => call.method === 'replays.move')
          .map((call) => (call.input as RpcInputs['replays.move']).to),
      ).toEqual(['B', 'C']);
      expect(screen.queryByRole('button', { name: translate(locale, 'settingsRetry') })).toBeNull();
    },
  );
  it.each(['zh', 'en'] as const)(
    'identifies source cleanup warnings separately from a successful folder save in %s',
    async (locale) => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      initial.config.replaySaveDir = 'A';
      const result = {
        ...outcome('B', true),
        retained: ['Alpha.webm'],
        moved: 1,
        failed: [{ name: 'Alpha.webm', message: 'Controlled source cleanup failure' }],
      };
      const native = nativeFixture(initial, {
        'displays.thumbnail': () => null,
        'replays.directory': () => ({ dir: 'A', count: 2 }),
        'replays.move': () => result,
      });
      render(<RecordingSettings inline />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'migrateFilesOnChange') }),
      );
      await changeFolder(locale, 'B');
      await screen.findByText(translate(locale, 'recordingMigrationCommitted'));
      await waitFor(() => expect(native.backend.config.replaySaveDir).toBe('B'));
      expect(screen.queryByRole('button', { name: translate(locale, 'settingsRetry') })).toBeNull();
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(translate(locale, 'recordingMigrationErrors')),
        }),
      );
      expect(screen.getByText(/Alpha.webm: Controlled source cleanup failure/)).toBeTruthy();
    },
  );
  it.each(['zh', 'en'] as const)(
    'explains active recording rejection and permits an accurate retry in %s',
    async (locale) => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      initial.config.replaySaveDir = 'A';
      let active = true;
      const native = nativeFixture(initial, {
        'displays.thumbnail': () => null,
        'replays.directory': () => ({ dir: 'A', count: 2 }),
        'replays.move': () => {
          if (active) throw new Error('REPLAY_MIGRATION_RECORDING_ACTIVE');
          return outcome('B', true);
        },
      });
      render(<RecordingSettings inline />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'migrateFilesOnChange') }),
      );
      await changeFolder(locale, 'B');
      const recovery = await reviewSettingsFailure(locale);
      await recovery.findByText(translate(locale, 'REPLAY_MIGRATION_RECORDING_ACTIVE'));
      expect(native.backend.config.replaySaveDir).toBe('A');
      active = false;
      await user.click(screen.getByRole('button', { name: translate(locale, 'settingsRetry') }));
      await waitFor(() => expect(native.backend.config.replaySaveDir).toBe('B'));
    },
  );
  it.each(['zh', 'en'] as const)(
    'disables the recording test while storage migration is pending in %s',
    async (locale) => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      initial.config.replaySaveDir = 'A';
      const pending = deferred<ReplayMoveResult>();
      const native = nativeFixture(initial, {
        'displays.thumbnail': () => null,
        'replays.directory': () => ({ dir: 'A', count: 2 }),
        'replays.move': () => pending.promise,
      });
      render(<RecordingSettings inline />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('switch', { name: translate(locale, 'migrateFilesOnChange') }),
      );
      await changeFolder(locale, 'B');
      expect(
        screen
          .getByRole('button', { name: translate(locale, 'recordingTest') })
          .hasAttribute('disabled'),
      ).toBe(true);
      await act(async () => pending.resolve(outcome('B', true)));
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: translate(locale, 'recordingTest') })
            .hasAttribute('disabled'),
        ).toBe(false),
      );
    },
  );
});

describe('archive detail focus recovery', () => {
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['direct', 'profile', 'removed'] as const).map((path) => ({ locale, path })),
    ),
  )(
    'restores an available focus target after $path details in $locale',
    async ({ locale, path }) => {
      history.replaceState(null, '', '#archive');
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      const match = matchFixture({ id: '99001', fid: '99001', map: 'Focus Alpha', outcome: 'win' });
      let rows = [match];
      const native = nativeFixture(initial, {
        'matches.list': () => structuredClone(rows),
        'matches.detail': () => {
          native.emit({ type: 'matches', revision: native.backend.revision + 1 });
          return match;
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      const opener = await screen.findByRole('button', { name: match.map });
      opener.focus();
      await user.keyboard('{Enter}');
      let dialog = await screen.findByRole('dialog');
      await within(dialog).findByRole('button', { name: match.players[0]!.name });
      expect(opener.isConnected).toBe(true);
      if (path === 'profile') {
        await user.click(within(dialog).getByRole('button', { name: match.players[0]!.name }));
        dialog = await screen.findByRole('dialog');
        await within(dialog).findByRole('heading', { name: translate(locale, 'profileOverview') });
        await user.click(
          within(dialog).getByRole('button', { name: translate(locale, 'dialogBack') }),
        );
        dialog = await screen.findByRole('dialog');
        await within(dialog).findByRole('button', { name: match.players[0]!.name });
      } else if (path === 'removed') {
        rows = [];
        await act(async () =>
          native.emit({ type: 'matches', revision: native.backend.revision + 1 }),
        );
        await waitFor(() => expect(opener.hasAttribute('disabled')).toBe(true));
      }
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() =>
        expect(document.activeElement).toBe(
          path === 'removed' ? document.getElementById('main-content') : opener,
        ),
      );
      expect(opener.isConnected).toBe(true);
    },
  );
});

describe('stable archive controls', () => {
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      (['watcher', 'config', 'session'] as const).flatMap((eventType) =>
        (['map', 'menu'] as const).map((control) => ({ locale, eventType, control })),
      ),
    ),
  )(
    'retains $control through unrelated $eventType events in $locale',
    async ({ locale, eventType, control }) => {
      const initial = bootstrapForApp();
      initial.config.lang = locale;
      const match = matchFixture({
        id: '99001',
        fid: '99001',
        map: 'Stable Alpha',
        outcome: 'win',
      });
      const native = nativeFixture(initial, { 'matches.list': () => [structuredClone(match)] });
      function ModalTarget() {
        const { modal } = useApp();
        return (
          <output data-testid="archive-route">{modal?.type === 'match' ? modal.fid : ''}</output>
        );
      }
      render(
        <>
          <MatchArchive />
          <ModalTarget />
        </>,
        { wrapper: wrapper(native.api) },
      );
      const user = userEvent.setup();
      const map = await screen.findByRole('button', { name: 'Stable Alpha' });
      const trigger = screen.getByRole('button', {
        name: `${translate(locale, 'actions')}: #99001`,
      });
      if (control === 'menu') await user.click(trigger);
      else map.focus();
      const active = document.activeElement;
      const menu = control === 'menu' ? screen.getByRole('menu') : null;
      const requests = native.calls.filter((call) => call.method === 'matches.list').length;
      await act(async () => {
        for (let index = 0; index < 3; index++) {
          const revision = native.backend.revision + 1;
          if (eventType === 'watcher')
            native.emit({ type: 'watcher', watcher: { ...native.backend.watcher }, revision });
          else if (eventType === 'config')
            native.emit({
              type: 'config',
              config: { ...native.backend.config, glassOpacity: 75 },
              revision,
            });
          else native.emit({ type: 'session', session: { ...native.backend.session }, revision });
        }
      });
      expect(map.isConnected).toBe(true);
      expect(trigger.isConnected).toBe(true);
      expect(document.activeElement).toBe(active);
      expect(native.calls.filter((call) => call.method === 'matches.list')).toHaveLength(requests);
      if (menu) {
        expect(screen.getByRole('menu')).toBe(menu);
        await user.click(screen.getByRole('menuitem', { name: translate(locale, 'delete') }));
        const confirmation = await screen.findByRole('alertdialog');
        expect(confirmation.textContent).toContain('Stable Alpha');
        expect(confirmation.textContent).toContain('#99001');
        await user.click(
          within(confirmation).getByRole('button', { name: translate(locale, 'cancel') }),
        );
        expect(native.calls.some((call) => call.method === 'matches.delete')).toBe(false);
      } else {
        await user.keyboard('{Enter}');
        expect(screen.getByTestId('archive-route').textContent).toBe('99001');
        expect(map.isConnected).toBe(true);
      }
    },
  );
});

describe('reviewed recording operations', () => {
  it.each(['zh', 'en'] as const)(
    'binds cleanup confirmation to the reviewed files and guards pending operations in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      let recordings = [replayFixture()];
      const pending = deferred<RpcOutputs['replays.clean']>();
      const native = nativeFixture(bootstrap, {
        'replays.list': () => ({ directory: 'A', recordings: structuredClone(recordings) }),
        'replays.planClean': ({ directory, days }) => ({
          token: 'reviewed',
          directory,
          days,
          createdAt: Date.now(),
          recordings: structuredClone(recordings),
        }),
        'replays.clean': () => pending.promise,
      });
      const t = (key: string) => translate(locale, key);
      render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: new RegExp('^' + t('play') + ': Dam · Alpha') });
      await user.click(screen.getByRole('button', { name: t('actions') }));
      await user.click(screen.getByRole('menuitem', { name: t('cleanAll') }));
      const confirmation = await screen.findByRole('alertdialog');
      expect(confirmation.textContent).toContain('Alpha.webm');
      expect(confirmation.textContent).toContain(t('recordingDate'));
      recordings = [
        replayFixture({ id: 'Bravo.webm', uploaderName: 'Bravo', createdAt: 1800000000000 }),
        ...recordings,
      ];
      act(() => native.emit({ type: 'replays', revision: 1 }));
      expect(confirmation.textContent).not.toContain('Bravo.webm');
      await user.click(within(confirmation).getByRole('button', { name: t('cleanAll') }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: t('actions') }).hasAttribute('disabled')).toBe(
          true,
        ),
      );
      expect(native.calls.filter((call) => call.method === 'replays.clean')).toEqual([
        { method: 'replays.clean', input: { token: 'reviewed' } },
      ]);
      recordings = recordings.filter((recording) => recording.id !== 'Alpha.webm');
      await act(async () =>
        pending.resolve({
          directory: 'A',
          removed: 1,
          completed: ['Alpha.webm'],
          failed: [],
          skipped: [],
        }),
      );
      await screen.findByRole('button', { name: new RegExp('^' + t('play') + ': Dam · Bravo') });
      expect(
        screen.queryByRole('button', { name: new RegExp('^' + t('play') + ': Dam · Alpha') }),
      ).toBeNull();
      expect(native.calls.filter((call) => call.method === 'replays.planClean')).toHaveLength(1);
    },
  );

  it.each(['zh', 'en'] as const)(
    'keeps partial cleanup results and retries the remaining recording in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      let recordings = [
        replayFixture(),
        replayFixture({ id: 'Bravo.webm', uploaderName: 'Bravo', dateSource: 'modified' }),
      ];
      let attempts = 0;
      const native = nativeFixture(bootstrap, {
        'replays.list': () => ({ directory: 'A', recordings: structuredClone(recordings) }),
        'replays.planClean': ({ directory, days }) => ({
          token: 'plan-' + attempts,
          directory,
          days,
          createdAt: Date.now(),
          recordings: structuredClone(recordings),
        }),
        'replays.clean': () => {
          if (++attempts === 1) {
            recordings = recordings.slice(1);
            return {
              directory: 'A',
              removed: 1,
              completed: ['Alpha.webm'],
              failed: [{ name: 'Bravo.webm', message: 'REPLAY_METADATA_DELETE_FAILED' }],
              skipped: [],
            };
          }
          recordings = [];
          return { directory: 'A', removed: 1, completed: ['Bravo.webm'], failed: [], skipped: [] };
        },
      });
      const t = (key: string) => translate(locale, key);
      render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: new RegExp('^' + t('play') + ': Dam · Alpha') });
      for (let attempt = 0; attempt < 2; attempt++) {
        await user.click(screen.getByRole('button', { name: t('actions') }));
        await user.click(screen.getByRole('menuitem', { name: t('cleanAll') }));
        const confirmation = await screen.findByRole('alertdialog');
        expect(confirmation.textContent).toContain(t('recordingModifiedDate'));
        if (attempt === 1) expect(confirmation.textContent).not.toContain('Alpha.webm');
        await user.click(within(confirmation).getByRole('button', { name: t('cleanAll') }));
        if (attempt === 0) {
          const result = await screen.findByRole('alert');
          expect(result.textContent).toContain('Alpha.webm');
          expect(result.textContent).toContain('Bravo.webm');
          expect(result.textContent).toContain(t('REPLAY_METADATA_DELETE_FAILED'));
          await waitFor(() =>
            expect(
              screen.getByRole('button', { name: t('actions') }).hasAttribute('disabled'),
            ).toBe(false),
          );
        }
      }
      await waitFor(() =>
        expect(screen.queryByRole('list', { name: t('recordingLibrary') })).toBeNull(),
      );
    },
  );

  it.each(['zh', 'en'] as const)(
    'rejects a directory switch while a recording delete confirmation remains open in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      bootstrap.config.replaySaveDir = 'A';
      let directory = 'A';
      const native = nativeFixture(bootstrap, {
        'replays.list': () => ({
          directory,
          recordings: [replayFixture({ uploaderName: directory })],
        }),
        'replays.planDelete': ({ directory }) => ({
          token: 'reviewed-A',
          directory,
          days: null,
          createdAt: Date.now(),
          recordings: [replayFixture({ uploaderName: 'A' })],
        }),
        'replays.delete': () => {
          throw new Error('REPLAY_DIRECTORY_CHANGED');
        },
      });
      const t = (key: string) => translate(locale, key);
      render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('button', { name: new RegExp('^' + t('actions') + ': Dam · A ·') }),
      );
      await user.click(screen.getByRole('menuitem', { name: t('delete') }));
      const confirmation = await screen.findByRole('alertdialog');
      directory = 'B';
      act(() =>
        native.emit({
          type: 'config',
          revision: 1,
          config: { ...bootstrap.config, replaySaveDir: 'B' },
        }),
      );
      await user.click(within(confirmation).getByRole('button', { name: t('delete') }));
      await screen.findByText(t('REPLAY_DIRECTORY_CHANGED'), { selector: '[role="alert"] span' });
      expect(native.calls.filter((call) => call.method === 'replays.delete')).toEqual([
        { method: 'replays.delete', input: { token: 'reviewed-A' } },
      ]);
      await screen.findByRole('button', { name: new RegExp('^' + t('play') + ': Dam · B ·') });
      expect(
        (screen.getByRole('textbox', { name: t('saveDirectory') }) as HTMLInputElement).value,
      ).toBe('B');
    },
  );

  it.each(['grid', 'list'] as const)(
    'appends asynchronous recordings without replacing an existing action target in %s view',
    async (view) => {
      let recordings = [replayFixture()];
      const native = nativeFixture(bootstrapForApp(), {
        'replays.list': () => ({ directory: 'A', recordings: structuredClone(recordings) }),
      });
      render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await screen.findByRole('button', { name: /^播放: Dam · Alpha/ });
      if (view === 'list') await user.click(screen.getByRole('radio', { name: '列表视图' }));
      const original = screen.getByRole('button', { name: /^播放: Dam · Alpha/ });
      act(() => original.focus());
      recordings = [
        replayFixture({ id: 'Bravo.webm', uploaderName: 'Bravo', createdAt: 1800000000000 }),
        ...recordings,
      ];
      act(() => native.emit({ type: 'replays', revision: 1 }));
      await screen.findByRole('button', { name: /^播放: Dam · Bravo/ });
      expect(document.querySelectorAll('.replay-play')[0]).toBe(original);
      expect(document.activeElement).toBe(original);
      await user.click(screen.getByRole('button', { name: '刷新' }));
      await waitFor(() =>
        expect(document.querySelectorAll('.replay-play')[0]?.getAttribute('aria-label')).toMatch(
          /^播放: Dam · Bravo/,
        ),
      );
    },
  );

  it.each(['zh', 'en'] as const)(
    'recovers failed and changing recording links inside an open match in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      const match = matchFixture();
      let attempts = 0;
      let recordings = [replayFixture({ fid: match.fid })];
      const native = nativeFixture(bootstrap, {
        'replays.list': () => {
          if (++attempts === 1) throw new Error('Recording list unavailable');
          return { directory: 'A', recordings: structuredClone(recordings) };
        },
      });
      const t = (key: string) => translate(locale, key);
      render(<MatchDialog fid={match.fid!} />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      const notice = await screen.findByRole('alert');
      expect(notice.textContent).toContain(t('recordingLinksUnavailable'));
      expect(await screen.findByRole('heading', { name: match.map })).toBeTruthy();
      await user.click(within(notice).getByRole('button', { name: t('retry') }));
      await screen.findByRole('button', { name: new RegExp('^' + t('play') + ': Dam · Alpha') });
      recordings = [
        ...recordings,
        replayFixture({
          id: 'Bravo.webm',
          fid: match.fid,
          uploaderName: 'Alpha',
          createdAt: 1700000000500,
        }),
      ];
      act(() => native.emit({ type: 'replays', revision: 1 }));
      await screen.findByRole('button', { name: new RegExp('Bravo.webm$') });
      expect(
        screen.getAllByRole('button', { name: new RegExp('^' + t('play') + ':') }),
      ).toHaveLength(2);
      const texts = screen
        .getAllByRole('button', { name: new RegExp('^' + t('play') + ':') })
        .map((button) => button.textContent);
      expect(texts[0]).not.toBe(texts[1]);
      recordings = recordings.slice(1);
      act(() => native.emit({ type: 'replays', revision: 2 }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /Alpha.webm$/ })).toBeNull());
      expect(native.calls.filter((call) => call.method === 'matches.detail')).toHaveLength(1);
    },
  );

  it.each(['zh', 'en'] as const)(
    'reports external match-link failures and allows retry in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      let attempts = 0;
      const native = nativeFixture(bootstrap, {
        'external.open': () => {
          if (++attempts === 1) throw new Error('External opener failed ' + locale);
          return null;
        },
      });
      render(<MatchDialog fid={matchFixture().fid!} />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      const open = await screen.findByRole('button', { name: translate(locale, 'openBatrace') });
      await user.click(open);
      await screen.findByText('External opener failed ' + locale);
      await user.click(open);
      expect(attempts).toBe(2);
    },
  );

  it.each([
    ['zh', 'replays'],
    ['en', 'replays'],
    ['zh', 'current'],
    ['en', 'current'],
  ] as const)(
    'opens auto-record setup without enabling recording in %s on %s',
    async (locale, page) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      bootstrap.config.replayEnabled = false;
      history.replaceState(null, '', '#' + page);
      const native = nativeFixture(bootstrap, { 'displays.thumbnail': () => null });
      render(<App />, { wrapper: wrapper(native.api) });
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('button', { name: translate(locale, 'enableRecording') }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: translate(locale, 'recordingSettings'),
      });
      expect(
        within(dialog)
          .getByRole('switch', { name: translate(locale, 'autoRecord') })
          .getAttribute('aria-checked'),
      ).toBe('false');
      expect(
        native.calls.filter(
          (call) =>
            call.method === 'config.update' &&
            (call.input as Partial<Bootstrap['config']>)?.replayEnabled === true,
        ),
      ).toEqual([]);
      expect(native.backend.config.replayEnabled).toBe(false);
    },
  );

  it.each(['zh', 'en'] as const)(
    'describes a failed recording accurately on both recording and overview surfaces in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      bootstrap.config.replayEnabled = true;
      bootstrap.recording.phase = 'error';
      bootstrap.recording.error = 'Capture failed';
      history.replaceState(null, '', '#replays');
      const native = nativeFixture(bootstrap);
      render(<App />, { wrapper: wrapper(native.api) });
      await screen.findByText(translate(locale, 'recordingFailed'));
      await act(async () => {
        location.hash = '#current';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      await waitFor(() =>
        expect(
          within(document.querySelector('.dashboard')!).getByText(
            translate(locale, 'recordingFailed'),
          ),
        ).toBeTruthy(),
      );
      expect(
        within(document.querySelector('.dashboard')!).queryByText(
          translate(locale, 'recordingReady'),
        ),
      ).toBeNull();
    },
  );
});

describe('recording settings automatic saving', () => {
  async function open(native: ReturnType<typeof nativeFixture>) {
    history.replaceState(null, '', '#replays');
    render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '录像设置' }));
    return within(await screen.findByRole('dialog', { name: '录像设置' }));
  }

  it('starts at the new minimums and saves the highest resolution, frame rate and bitrate', async () => {
    const initial = bootstrapForApp();
    Object.assign(initial.config, { replayQuality: 720, replayFps: 30, replayBitrateMbps: 5 });
    const native = nativeFixture(initial, { 'displays.thumbnail': () => null });
    const dialog = await open(native);
    const quality = dialog.getByRole('slider', { name: '分辨率' });
    const fps = dialog.getByRole('slider', { name: '帧率' });
    const bitrate = dialog.getByRole('slider', { name: '码率' });
    expect(quality.getAttribute('aria-valuetext')).toBe('720p');
    expect(fps.getAttribute('aria-valuemin')).toBe('30');
    expect(fps.getAttribute('aria-valuemax')).toBe('120');
    expect(bitrate.getAttribute('aria-valuemin')).toBe('5');
    expect(bitrate.getAttribute('aria-valuemax')).toBe('20');
    fireEvent.keyDown(fps, { key: 'ArrowRight' });
    expect(fps.getAttribute('aria-valuenow')).toBe('40');
    for (const slider of [quality, fps, bitrate]) fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(native.backend.config).toMatchObject({
      replayQuality: 2160,
      replayFps: 120,
      replayBitrateMbps: 20,
    });
    fireEvent.click(screen.getByRole('button', { name: '录像设置' }));
    const reopened = within(await screen.findByRole('dialog', { name: '录像设置' }));
    expect(reopened.getByRole('slider', { name: '分辨率' }).getAttribute('aria-valuetext')).toBe(
      '2160p',
    );
    expect(reopened.getByRole('slider', { name: '帧率' }).getAttribute('aria-valuenow')).toBe(
      '120',
    );
    expect(reopened.getByRole('slider', { name: '码率' }).getAttribute('aria-valuenow')).toBe('20');
  });

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
    fireEvent.keyDown(panel.getByRole('slider', { name: /帧率/ }), { key: 'Home' });
    for (let index = 0; index < 2; index++)
      fireEvent.keyDown(panel.getByRole('slider', { name: /帧率/ }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('tab', { name: '自动化' }));
    await waitFor(() => expect(native.backend.config.replaySaveDir).toBe(destination));
    expect(native.backend.config.replayFps).toBe(50);
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
        expect(config.replayFps).toBe(120);
        return null;
      },
    });
    const dialog = await open(native);
    expect(dialog.queryByRole('button', { name: '保存' })).toBeNull();
    expect(dialog.queryByRole('button', { name: '取消' })).toBeNull();
    fireEvent.keyDown(dialog.getByRole('slider', { name: /帧率/ }), { key: 'Home' });
    for (let index = 0; index < 2; index++)
      fireEvent.keyDown(dialog.getByRole('slider', { name: /帧率/ }), { key: 'ArrowRight' });
    fireEvent.click(dialog.getByRole('button', { name: '录制 60 秒测试' }));
    await waitFor(() => expect(saves).toBe(1));
    expect(native.calls.some((call) => call.method === 'replays.test')).toBe(false);
    fireEvent.keyDown(dialog.getByRole('slider', { name: /帧率/ }), { key: 'End' });
    await act(async () => saving.resolve(config));
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'replays.test')).toHaveLength(1),
    );
    expect(saves).toBe(2);
    expect(dialog.getByText('已自动保存')).toBeTruthy();
    fireEvent.click(dialog.getByRole('switch', { name: '自动录制' }));
    await waitFor(() => expect(config.replayEnabled).toBe(!initial.config.replayEnabled));
  });

  it('keeps the original folder after a failed migration and retries before saving the new folder', async () => {
    const initial = bootstrapForApp();
    const destination = 'D:\\Recordings';
    let attempts = 0;
    const native = nativeFixture(initial, {
      'displays.thumbnail': () => null,
      'replays.move': ({ from, to }) => {
        const failed = ++attempts === 1;
        return {
          createdAt: Date.now(),
          from,
          to,
          directory: failed ? from : to,
          committed: !failed,
          moved: 0,
          copied: [],
          retained: failed ? ['match.webm'] : [],
          destinationCopies: [],
          failed: failed ? [{ name: 'match.webm', message: 'REPLAY_MIGRATION_COLLISION' }] : [],
        };
      },
    });
    const dialog = await open(native);
    fireEvent.click(dialog.getByRole('switch', { name: '更换目录时迁移已有录像' }));
    const directory = dialog.getByRole('textbox', { name: '保存目录' });
    fireEvent.change(directory, { target: { value: destination } });
    expect(native.calls.some((call) => call.method === 'replays.move')).toBe(false);
    fireEvent.blur(directory);
    const recovery = await reviewSettingsFailure();
    await recovery.findByRole('button', { name: '重试保存' });
    expect(native.backend.config.replaySaveDir).toBe(initial.config.replaySaveDir);
    expect(native.calls.some((call) => call.method === 'config.update')).toBe(false);
    expect((directory as HTMLInputElement).value).toBe(destination);
    fireEvent.click(recovery.getByRole('button', { name: '重试保存' }));
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
    const recovery = await reviewSettingsFailure();
    await recovery.findByText('Disk unavailable');
    expect(screen.getByRole('dialog', { name: '录像设置' })).toBeTruthy();
    fail = false;
    fireEvent.click(recovery.getByRole('button', { name: '关闭' }));
    fireEvent.click(dialog.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(native.calls.filter((call) => call.method === 'config.update').at(-1)?.input).toEqual({
      replaySaveDir: destination,
    });
  });
});

describe('stable live list targets and complete roster identity', () => {
  const alpha = { id: '99101', name: 'Stable Alpha', teamId: 0 as const };
  const bravo = { id: '99102', name: 'Stable Twin', teamId: 0 as const };
  const charlie = { id: '99103', name: 'Stable Twin', teamId: 0 as const };
  const delta = { id: '99104', name: 'Stable Delta', teamId: 0 as const };
  const ban = (player: typeof alpha | typeof bravo | typeof charlie) => ({
    ...bannedPlayer(),
    ...player,
    encountered: false,
  });
  function ModalProbe() {
    const { modal } = useApp();
    return <output data-testid="live-modal">{JSON.stringify(modal)}</output>;
  }
  const rosterCard = (id: string, active = true) =>
    document.querySelector<HTMLElement>(
      `.player-card[data-player-id="${id}"][data-player-active="${active}"]`,
    )!;
  const rosterButton = (id: string, active = true) =>
    rosterCard(id, active).querySelector<HTMLButtonElement>('.player-card-trigger')!;
  const order = () =>
    [...document.querySelectorAll('[data-ban-id]')].map((row) => row.getAttribute('data-ban-id'));
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, vars?: Record<string, string | number>) =>
      translate(lang, key, vars);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.session = {
        ...value.session,
        phase: 'lobby',
        lobbyId: 'stable-room',
        current: null,
        lobbyPlayers: [alpha, bravo, charlie],
      };
      return value;
    };
    const emitBans = (native: ReturnType<typeof nativeFixture>, list: Ban[]) =>
      act(() =>
        native.emit({
          type: 'bans',
          list,
          newly: [],
          alerts: [],
          revision: native.backend.revision + 1,
        }),
      );
    const emitSession = (native: ReturnType<typeof nativeFixture>, session: Bootstrap['session']) =>
      act(() => native.emit({ type: 'session', session, revision: native.backend.revision + 1 }));
    const updateButton = () =>
      screen.getByRole('button', { name: new RegExp('^' + text('banListApplyUpdates')) });
    it(`keeps ban actions and focus until the latest update is explicitly applied in ${lang}`, async () => {
      let source = [ban(alpha)];
      const native = nativeFixture(initial(), { 'bans.list': () => structuredClone(source) });
      render(
        <>
          <BansPanel />
          <ModalProbe />
        </>,
        { wrapper: wrapper(native.api) },
      );
      const target = await screen.findByRole('button', { name: alpha.name + ' #' + alpha.id });
      act(() => target.focus());
      source = [ban(bravo), ban(alpha)];
      emitBans(native, source);
      await waitFor(() => expect(updateButton().getAttribute('aria-disabled')).toBe('false'));
      expect(order()).toEqual([alpha.id]);
      expect(document.activeElement).toBe(target);
      fireEvent.click(target);
      expect(JSON.parse(screen.getByTestId('live-modal').textContent!).id).toBe(alpha.id);
      const apply = updateButton();
      await userEvent.click(apply);
      expect(order()).toEqual([bravo.id, alpha.id]);
      expect(document.activeElement).toBe(apply);
      expect(apply.getAttribute('aria-disabled')).toBe('true');
    });
    it(`queues a completed sync from the closed detail popover without replacing the focused player in ${lang}`, async () => {
      let source = [ban(alpha)];
      const held = deferred<Ban[]>();
      const native = nativeFixture(initial(), {
        'bans.list': () => source,
        'bans.sync': () => held.promise,
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      const target = await screen.findByRole('button', { name: alpha.name + ' #' + alpha.id });
      const opener = document.querySelector('[data-ban-sync-state] button')!;
      fireEvent.click(opener);
      const detail = await screen.findByRole('dialog', { name: text('banSyncTitle') });
      fireEvent.click(within(detail).getByRole('button', { name: text('sync') }));
      fireEvent.click(within(detail).getByRole('button', { name: text('close') }));
      await waitFor(() => expect(document.activeElement).toBe(opener));
      act(() => target.focus());
      source = [ban(bravo), ban(alpha)];
      await act(async () => {
        held.resolve(source);
        await held.promise;
      });
      await waitFor(() =>
        expect(native.calls.filter((call) => call.method === 'bans.list').length).toBeGreaterThan(
          1,
        ),
      );
      await waitFor(() => expect(updateButton().getAttribute('aria-disabled')).toBe('false'));
      expect(order()).toEqual([alpha.id]);
      expect(document.activeElement).toBe(target);
    });
    it(`preserves the page and filter while a ban insertion waits for review in ${lang}`, async () => {
      let source = Array.from({ length: 45 }, (_, index) => ({
        ...ban(alpha),
        id: String(99200 + index),
        name: 'Stable ' + index,
      }));
      const native = nativeFixture(initial(), { 'bans.list': () => structuredClone(source) });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: 'Stable 0 #99200' });
      const input = screen.getByRole('searchbox', { name: text('filterPlayers') });
      fireEvent.change(input, { target: { value: 'Stable' } });
      fireEvent.click(screen.getByRole('link', { name: text('nextPage') }));
      const before = order();
      expect(before[0]).toBe('99220');
      source = [{ ...ban(bravo), name: 'Stable newly added' }, ...source];
      emitBans(native, source);
      await waitFor(() => expect(updateButton().getAttribute('aria-disabled')).toBe('false'));
      expect(order()).toEqual(before);
      expect((input as HTMLInputElement).value).toBe('Stable');
      fireEvent.click(updateButton());
      expect(order()[0]).toBe(bravo.id);
      expect((input as HTMLInputElement).value).toBe('Stable');
    });
    it(`updates encounter facts immediately and appends newly eligible met rows in ${lang}`, async () => {
      let source = [
        { ...ban(alpha), encountered: false },
        { ...ban(bravo), encountered: true },
      ];
      const native = nativeFixture(initial(), { 'bans.list': () => structuredClone(source) });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: alpha.name + ' #' + alpha.id });
      fireEvent.click(screen.getByRole('radio', { name: text('metBans') }));
      const retained = screen.getByRole('button', { name: bravo.name + ' #' + bravo.id });
      act(() => retained.focus());
      const time = 1700000000000;
      source = [
        { ...ban(alpha), encountered: true, lastEncounterAt: time },
        { ...ban(bravo), encountered: true },
      ];
      emitBans(native, source);
      await screen.findByRole('button', { name: alpha.name + ' #' + alpha.id });
      expect(order()).toEqual([bravo.id, alpha.id]);
      expect(document.activeElement).toBe(retained);
      expect(screen.getByText(formatTime(time, lang))).toBeTruthy();
      expect(native.calls.some((call) => call.method === 'bans.sync')).toBe(false);
      fireEvent.click(updateButton());
      expect(order()).toEqual([alpha.id, bravo.id]);
    });
    it(`rejects older ban reads after a newer revision completes in ${lang}`, async () => {
      const older = deferred<Ban[]>(),
        newer = deferred<Ban[]>();
      let reads = 0;
      const native = nativeFixture(initial(), {
        'bans.list': () =>
          ++reads === 1 ? [ban(alpha)] : reads === 2 ? older.promise : newer.promise,
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: alpha.name + ' #' + alpha.id });
      emitBans(native, [ban(bravo), ban(alpha)]);
      await waitFor(() => expect(reads).toBe(2));
      emitBans(native, [ban(charlie), ban(alpha)]);
      await waitFor(() => expect(reads).toBe(3));
      await act(async () => newer.resolve([ban(charlie), ban(alpha)]));
      await act(async () => older.resolve([ban(bravo), ban(alpha)]));
      fireEvent.click(updateButton());
      expect(order()).toEqual([charlie.id, alpha.id]);
    });
    it(`carries an explicit ban reread intent through a newer background revision in ${lang}`, async () => {
      const older = deferred<Ban[]>(),
        newer = deferred<Ban[]>();
      let reads = 0;
      const native = nativeFixture(initial(), {
        'bans.list': () =>
          ++reads === 1 ? [ban(alpha)] : reads === 2 ? older.promise : newer.promise,
      });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: alpha.name + ' #' + alpha.id });
      fireEvent.click(document.querySelector('[data-ban-sync-state] button')!);
      fireEvent.click(await screen.findByRole('button', { name: text('banListReload') }));
      await waitFor(() => expect(reads).toBe(2));
      emitBans(native, [ban(charlie)]);
      await waitFor(() => expect(reads).toBe(3));
      await act(async () => newer.resolve([ban(charlie)]));
      await act(async () => older.resolve([ban(bravo)]));
      expect(order()).toEqual([charlie.id]);
      expect(updateButton().getAttribute('aria-disabled')).toBe('true');
    });
    it(`keeps a confirmed empty ban snapshot until a nonempty update is applied in ${lang}`, async () => {
      let source: Ban[] = [];
      const native = nativeFixture(initial(), { 'bans.list': () => source });
      render(<BansPanel />, { wrapper: wrapper(native.api) });
      await screen.findByText(text('banSourceEmpty'));
      source = [ban(alpha)];
      emitBans(native, source);
      await waitFor(() => expect(updateButton().getAttribute('aria-disabled')).toBe('false'));
      expect(screen.getByText(text('banSourceEmpty'))).toBeTruthy();
      expect(order()).toEqual([]);
      fireEvent.click(updateButton());
      expect(order()).toEqual([alpha.id]);
    });
    it(`retains departed slots and only copies active members through arrivals and rejoining in ${lang}`, async () => {
      const native = nativeFixture(initial());
      const user = userEvent.setup();
      const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
      render(
        <>
          <SessionPanel standalone />
          <ModalProbe />
        </>,
        { wrapper: wrapper(native.api), reactStrictMode: true },
      );
      await screen.findByRole('button', { name: rosterActionName(bravo) });
      const target = rosterButton(bravo.id);
      act(() => target.focus());
      emitSession(native, { ...native.backend.session, lobbyPlayers: [bravo, charlie] });
      expect(rosterButton(bravo.id)).toBe(target);
      expect(document.activeElement).toBe(target);
      const departed = rosterButton(alpha.id, false);
      expect(departed.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(departed);
      expect(screen.getByTestId('live-modal').textContent).toBe('null');
      expect(rosterCard(alpha.id, false).textContent).toContain(text('rosterPlayerLeft'));
      await user.click(screen.getByRole('button', { name: text('copy') + ' Alpha' }));
      expect(copy.mock.calls.at(-1)?.[0]).not.toContain(alpha.name);
      expect(copy.mock.calls.at(-1)?.[0]).toContain(bravo.name);
      emitSession(native, { ...native.backend.session, lobbyPlayers: [bravo, charlie, delta] });
      expect(
        [...document.querySelectorAll('.player-card')].map((card) =>
          card.getAttribute('data-player-id'),
        ),
      ).toEqual([alpha.id, bravo.id, charlie.id, delta.id]);
      emitSession(native, {
        ...native.backend.session,
        lobbyPlayers: [delta, alpha, bravo, charlie],
      });
      expect(rosterButton(alpha.id)).toBe(departed);
      expect(rosterButton(bravo.id)).toBe(target);
      expect(document.querySelectorAll('[data-player-active="false"]')).toHaveLength(0);
    });
    it(`retains other team slots and explicitly compacts moved players in ${lang}`, async () => {
      const value = initial();
      const match = matchFixture({
        players: [
          { ...matchFixture().players[0]!, ...alpha },
          { ...matchFixture().players[0]!, ...bravo },
          { ...matchFixture().players[0]!, ...charlie, teamId: 1 },
        ],
      });
      value.session = { ...value.session, phase: 'match', current: match };
      const native = nativeFixture(value);
      render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: rosterActionName(bravo) });
      const retained = rosterButton(charlie.id);
      const changed = {
        ...match,
        players: match.players.map((player) =>
          player.id === bravo.id ? { ...player, teamId: 1 as const } : player,
        ),
      };
      emitSession(native, { ...native.backend.session, current: changed });
      expect(rosterButton(charlie.id)).toBe(retained);
      expect(rosterCard(bravo.id, false).textContent).toContain(
        text('rosterPlayerMoved', { team: 'Bravo' }),
      );
      expect(rosterButton(bravo.id).getAttribute('aria-label')).toContain('Bravo');
      const compact = screen.getByRole('button', { name: text('rosterCompact') });
      await userEvent.click(compact);
      expect(document.querySelectorAll('[data-player-active="false"]')).toHaveLength(0);
      expect(document.activeElement).toBe(compact);
      expect(compact.getAttribute('aria-disabled')).toBe('true');
    });
    it(`cancels held profile activation across a new lobby scope in ${lang}`, async () => {
      const native = nativeFixture(initial());
      render(
        <>
          <SessionPanel standalone />
          <ModalProbe />
        </>,
        { wrapper: wrapper(native.api) },
      );
      await screen.findByRole('button', { name: rosterActionName(bravo) });
      const before = rosterButton(bravo.id);
      fireEvent.pointerDown(before, { button: 0 });
      emitSession(native, {
        ...native.backend.session,
        generation: native.backend.session.generation + 1,
        lobbyId: 'new-room',
        lobbyPlayers: [bravo],
      });
      fireEvent.click(rosterButton(bravo.id), { detail: 1 });
      expect(screen.getByTestId('live-modal').textContent).toBe('null');
      act(() => rosterButton(bravo.id).focus());
      await userEvent.keyboard(' ');
      expect(JSON.parse(screen.getByTestId('live-modal').textContent!).id).toBe(bravo.id);
      expect(document.querySelectorAll('.player-card')).toHaveLength(1);
    });
    for (const length of [63, 128, 203])
      it(`discloses the full ${length}-character roster name without opening a profile in ${lang}`, async () => {
        const value = initial();
        const name = 'N'.repeat(length - 7) + '-SUFFIX';
        value.session.lobbyPlayers = [{ ...bravo, name }];
        const native = nativeFixture(value);
        render(
          <>
            <SessionPanel standalone />
            <ModalProbe />
          </>,
          { wrapper: wrapper(native.api) },
        );
        const action = await screen.findByRole('button', {
          name: text('rosterIdentityAction', { name, id: bravo.id }),
        });
        act(() => action.focus());
        await userEvent.keyboard('{Enter}');
        const region = await screen.findByRole('region', { name: text('profileIdentity') });
        expect(region.querySelector('[data-roster-full-name]')?.textContent).toBe(name);
        expect(within(region).getByText('#' + bravo.id)).toBeTruthy();
        expect(document.activeElement).toBe(region);
        expect(screen.getByTestId('live-modal').textContent).toBe('null');
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(document.activeElement).toBe(action));
      });
    it(`keeps the complete successful statistics in the roster reading area in ${lang}`, async () => {
      const native = nativeFixture(initial());
      render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: rosterActionName(bravo) });
      const sourceKey = currentRosterKey(native.backend.session);
      act(() =>
        native.emit({
          type: 'rosterQuery',
          requestId: 'stats',
          context: 'current',
          sourceKey,
          pendingIds: [bravo.id],
          revision: native.backend.revision + 1,
        }),
      );
      act(() =>
        native.emit({
          type: 'roster',
          requestId: 'stats',
          context: 'current',
          sourceKey,
          generation: native.backend.session.generation,
          player: bravo,
          info: {
            elo: 2100,
            kd: 1.66,
            winRate: 50,
            matchCount: 10,
            category: null,
            topUnits: '',
            updatedAt: 1700000000000,
            stale: false,
          },
          error: null,
          revision: native.backend.revision + 1,
        }),
      );
      fireEvent.click(
        within(rosterCard(bravo.id)).getByRole('button', {
          name: text('rosterIdentityAction', { name: bravo.name, id: bravo.id }),
        }),
      );
      const region = await screen.findByRole('region', { name: text('profileIdentity') });
      const analysis = region.querySelector('[data-roster-full-analysis]')!;
      expect(analysis.textContent).toContain(text('recentWinRate') + ' 50%');
      expect(analysis.textContent).toContain(text('latestKd') + ' 1.66');
    });
    for (const [error, key] of [
      ['BATrace HTTP 503', 'rosterServiceFailure'],
      ['BATrace HTTP 404', 'rosterRequestFailure'],
      ['BATrace returned invalid JSON', 'rosterInvalidResponse'],
      ['No analysis', 'rosterAnalysisUnavailable'],
      ['BATrace returned incomplete player analysis', 'rosterAnalysisUnavailable'],
      ['Unexpected source diagnostic', 'rosterFailureSummary'],
    ] as const)
      it(`localizes ${key} while retaining its diagnostic and recovery in ${lang}`, async () => {
        const native = nativeFixture(initial());
        render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
        await screen.findByRole('button', { name: rosterActionName(bravo) });
        act(() =>
          native.emit({
            type: 'rosterQuery',
            requestId: 'failure',
            context: 'current',
            sourceKey: currentRosterKey(native.backend.session),
            pendingIds: [bravo.id],
            revision: native.backend.revision + 1,
          }),
        );
        act(() =>
          native.emit({
            type: 'roster',
            requestId: 'failure',
            context: 'current',
            sourceKey: currentRosterKey(native.backend.session),
            generation: native.backend.session.generation,
            player: bravo,
            info: null,
            error,
            revision: native.backend.revision + 1,
          }),
        );
        const card = rosterCard(bravo.id);
        expect(card.querySelector('.player-analysis')?.textContent).toContain(
          text(key, { status: /HTTP (\d{3})/.exec(error)?.[1] ?? '503' }),
        );
        expect(card.querySelector('.player-analysis')?.textContent).not.toContain(error);
        fireEvent.click(
          within(card).getByRole('button', {
            name: text('rosterIdentityAction', { name: bravo.name, id: bravo.id }),
          }),
        );
        const region = await screen.findByRole('region', { name: text('profileIdentity') });
        expect(within(region).getByText(error)).toBeTruthy();
        expect(within(region).getByText(text('rosterQueryFailed'))).toBeTruthy();
      });
    it(`gives same-name profile actions distinct IDs while preserving surrounding status in ${lang}`, async () => {
      const native = nativeFixture(initial());
      render(
        <>
          <SessionPanel standalone />
          <ModalProbe />
        </>,
        { wrapper: wrapper(native.api) },
      );
      for (const player of [bravo, charlie]) {
        const action = await screen.findByRole('button', {
          name: player.name + ' · #' + player.id + ' · Alpha',
        });
        expect(action.getAttribute('aria-describedby')).toBeTruthy();
        act(() => action.focus());
        await userEvent.keyboard(' ');
        expect(JSON.parse(screen.getByTestId('live-modal').textContent!).id).toBe(player.id);
      }
      expect(document.querySelector('button button')).toBeNull();
    });
  }
});

describe('radar result ownership and freshness', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, vars: Record<string, string | number> = {}) =>
      translate(lang, key, vars);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.session = {
        ...value.session,
        phase: 'lobby',
        current: null,
        lobbyId: 'room-a',
        lobbyPlayers: [localPlayer, secondPlayer].map((p) => ({ ...p, teamId: 0 })),
      };
      return value;
    };
    type QueryEvent = Extract<AppEvent, { type: 'rosterQuery' | 'roster' }>;
    type QueryInput = QueryEvent extends infer E
      ? E extends QueryEvent
        ? Omit<E, 'revision'>
        : never
      : never;
    const send = (native: ReturnType<typeof nativeFixture>, event: QueryInput) =>
      act(() => native.emit({ ...event, revision: native.backend.revision + 1 } as AppEvent));
    const begin = (native: ReturnType<typeof nativeFixture>, requestId: string) =>
      send(native, {
        type: 'rosterQuery',
        requestId,
        context: 'current',
        sourceKey: currentRosterKey(native.backend.session),
        pendingIds: native.backend.session.lobbyPlayers.map((p) => p.id),
      });
    const finish = (
      native: ReturnType<typeof nativeFixture>,
      requestId: string,
      index: number,
      elo: number,
      stale = false,
      key = currentRosterKey(native.backend.session),
    ) =>
      send(native, {
        type: 'roster',
        requestId,
        context: 'current',
        sourceKey: key,
        generation: native.backend.session.generation,
        player: native.backend.session.lobbyPlayers[index]!,
        info: {
          elo,
          kd: 1,
          winRate: 50,
          matchCount: 10,
          category: null,
          topUnits: '',
          updatedAt: 1700000000000,
          stale,
        },
        error: null,
      } as Omit<Extract<AppEvent, { type: 'roster' }>, 'revision'>);
    const card = (name: string) =>
      screen
        .getByRole('button', { name: (value) => value.startsWith(name + ' · #') })
        .closest('.player-card')!;

    it(`labels stale source times, team values and copied values in ${lang}`, async () => {
      const native = nativeFixture(initial());
      userEvent.setup();
      const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
      render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: rosterActionName(localPlayer) });
      begin(native, 'freshness');
      finish(native, 'freshness', 0, 2100, true);
      finish(native, 'freshness', 1, 1800);
      expect(card(localPlayer.name).textContent).toContain(text('stale'));
      expect(card(localPlayer.name).textContent).toContain(formatTime(1700000000000, lang));
      const trigger = screen.getByRole('button', { name: rosterActionName(localPlayer) });
      expect(
        document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent,
      ).toContain(text('stale'));
      expect(screen.getByText(text('rosterMixedFreshness'))).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: text('copy') + ' Alpha' }));
      await waitFor(() => expect(copy).toHaveBeenCalled());
      expect(copy.mock.calls.at(-1)?.[0]).toContain('2,100 (' + text('stale') + ')');
    });
    for (const change of ['generation', 'room'] as const) {
      it(`clears repeated-player values on a ${change} change and rejects late data in ${lang}`, async () => {
        const native = nativeFixture(initial());
        render(<SessionPanel />, { wrapper: wrapper(native.api) });
        await screen.findByRole('button', { name: rosterActionName(localPlayer) });
        begin(native, 'old');
        finish(native, 'old', 0, 2100);
        const oldKey = currentRosterKey(native.backend.session);
        const session = {
          ...native.backend.session,
          ...(change === 'generation'
            ? { generation: native.backend.session.generation + 1 }
            : { lobbyId: 'room-b' }),
        };
        act(() => native.emit({ type: 'session', session, revision: native.backend.revision + 1 }));
        expect(card(localPlayer.name).querySelector('.player-rating strong')?.textContent).toBe(
          '—',
        );
        finish(native, 'old', 0, 9999, false, oldKey);
        expect(card(localPlayer.name).textContent).not.toContain('9,999');
        begin(native, 'new');
        finish(native, 'new', 0, 2200);
        expect(card(localPlayer.name).querySelector('.player-rating strong')?.textContent).toBe(
          '2,200',
        );
      });
    }
    it(`retains marked values and progress during an automatic partial refresh in ${lang}`, async () => {
      const native = nativeFixture(initial(), {
        'session.query': ({ requestId }) => ({
          requestId,
          queried: 2,
          skipped: 0,
          cancelled: false,
        }),
      });
      render(<SessionPanel />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: rosterActionName(localPlayer) });
      begin(native, 'first');
      finish(native, 'first', 0, 2100);
      finish(native, 'first', 1, 1800);
      begin(native, 'second');
      finish(native, 'second', 0, 2200);
      const query = screen.getByRole('button', { name: text('query') });
      expect(query.getAttribute('aria-busy')).toBe('true');
      expect(screen.getByRole('status').textContent).toBe(
        text('rosterQueryProgress', { done: 1, total: 2 }),
      );
      expect(card(secondPlayer.name).querySelector('.player-rating strong')?.textContent).toBe(
        '1,800',
      );
      expect(card(secondPlayer.name).textContent).toContain(
        text('rosterRefreshingPrevious', { time: formatTime(1700000000000, lang) }),
      );
      fireEvent.click(query);
      expect(native.calls.some((call) => call.method === 'session.query')).toBe(false);
      finish(native, 'second', 1, 1900);
      expect(query.getAttribute('aria-busy')).toBe('false');
      expect(card(secondPlayer.name).querySelector('.player-rating strong')?.textContent).toBe(
        '1,900',
      );
      expect(screen.queryByText(text('rosterMixedFreshness'))).toBeNull();
    });
    for (const standalone of [false, true]) {
      it(`ignores late previous-match lists and queries a changed displayed match (${standalone}) in ${lang}`, async () => {
        const first = deferred<RpcOutputs['matches.list']>();
        const queryGate = deferred<RpcOutputs['session.query']>();
        const a = matchFixture({
          id: 'previous-a',
          fid: '101',
          map: 'Match A',
          players: [{ ...matchFixture().players[0]!, ...localPlayer }],
        });
        const b = matchFixture({
          id: 'previous-b',
          fid: '102',
          map: 'Match B',
          players: [{ ...matchFixture().players[0]!, ...secondPlayer }],
        });
        const old = matchFixture({
          id: 'previous-old',
          fid: '100',
          map: 'Old match',
          players: [{ ...matchFixture().players[0]!, ...localPlayer }],
        });
        let listCalls = 0,
          shown = a,
          queryCalls = 0;
        const bootstrap = initial();
        bootstrap.session.current = a;
        const native = nativeFixture(bootstrap, {
          'matches.list': () => (++listCalls === 1 ? first.promise : [shown, old]),
          'matches.detail': ({ fid }) => [a, b, old].find((m) => m.fid === fid)!,
          'session.query': ({ requestId }) =>
            ++queryCalls === 2
              ? queryGate.promise
              : { requestId, queried: 1, skipped: 0, cancelled: false },
        });
        render(<SessionPanel standalone={standalone} />, { wrapper: wrapper(native.api) });
        await waitFor(() => expect(listCalls).toBe(1));
        act(() =>
          native.emit({
            type: 'session',
            session: { ...native.backend.session, current: b },
            revision: native.backend.revision + 1,
          }),
        );
        const previous = await screen.findByRole('button', { name: text('previous') });
        await waitFor(() => expect(previous.getAttribute('aria-disabled')).toBe('false'));
        fireEvent.click(previous);
        await screen.findByRole('heading', { name: 'Match A' });
        await waitFor(() => expect(queryCalls).toBe(1));
        await act(async () => first.resolve([a, old]));
        expect(screen.getByRole('heading', { name: 'Match A' })).toBeTruthy();
        expect(queryCalls).toBe(1);
        shown = old;
        act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
        await screen.findByRole('heading', { name: 'Old match' });
        await waitFor(() => expect(queryCalls).toBe(2));
        const query = screen.getByRole('button', { name: text('query') });
        expect(query.getAttribute('aria-busy')).toBe('true');
        const inputs = native.calls
          .filter((call) => call.method === 'session.query')
          .map((call) => call.input as RpcInputs['session.query']);
        expect(inputs.map((input) => input.fid)).toEqual(['101', '100']);
        await act(async () =>
          queryGate.resolve({
            requestId: inputs[1]!.requestId,
            queried: 1,
            skipped: 0,
            cancelled: false,
          }),
        );
        await waitFor(() => expect(query.getAttribute('aria-busy')).toBe('false'));
      });
    }
  }
});

describe('metric availability and copying', () => {
  const statistic = (root: Element, label: string) =>
    [...root.querySelectorAll('dt')]
      .find((node) => node.textContent === label)
      ?.closest('[data-slot=card]')
      ?.querySelector('dd')?.textContent;
  for (const locale of ['zh', 'en'] as const) {
    const text = (key: string) => translate(locale, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = locale;
      return value;
    };
    for (const rate of [null, 0] as const)
      it(`distinguishes ${rate} percentages in report, profile, roster and copy in ${locale}`, async () => {
        const report = reportFixture({
          winRate: rate,
          categories: [
            { key: 'tanks', pct: null },
            { key: 'infantry', pct: 0 },
          ],
          mapStats: [
            { mapId: 9901, name: 'Unknown rate map', winRate: null, matchCount: 2 },
            { mapId: 9902, name: 'Zero rate map', winRate: 0, matchCount: 2 },
          ],
        });
        const bootstrap = initial();
        bootstrap.session.phase = 'lobby';
        bootstrap.session.current = null;
        bootstrap.session.lobbyPlayers = [
          { ...localPlayer, id: report.id, name: report.name, teamId: 0 },
        ];
        const native = nativeFixture(bootstrap);
        const user = userEvent.setup();
        const copy = vi.spyOn(navigator.clipboard, 'writeText');
        render(
          <>
            <ReportView report={report} />
            <ProfileOverview id={report.id} report={report} profile={null} />
            <SessionPanel standalone />
          </>,
          { wrapper: wrapper(native.api) },
        );
        await screen.findByRole('button', { name: text('copy') });
        act(() =>
          native.emit({
            type: 'rosterQuery',
            requestId: 'metric-rate',
            context: 'current',
            sourceKey: currentRosterKey(bootstrap.session),
            pendingIds: [bootstrap.session.lobbyPlayers[0]!.id],
            revision: native.backend.revision + 1,
          }),
        );
        act(() =>
          native.emit({
            type: 'roster',
            context: 'current',
            generation: bootstrap.session.generation,
            requestId: 'metric-rate',
            sourceKey: currentRosterKey(bootstrap.session),
            player: bootstrap.session.lobbyPlayers[0]!,
            info: {
              elo: report.elo,
              kd: null,
              winRate: rate,
              matchCount: report.matchCount,
              sampleCount: report.sampleCount,
              category: null,
              topUnits: '',
              updatedAt: Date.now(),
              stale: false,
            },
            error: null,
            revision: native.backend.revision + 1,
          }),
        );
        const expected = rate === null ? '—' : '0%';
        expect(statistic(document.querySelector('.report')!, text('recentWinRate'))).toBe(expected);
        expect(statistic(document.querySelector('.profile-overview')!, text('recentWinRate'))).toBe(
          expected,
        );
        expect(document.querySelector('.session-roster')!.textContent).toContain(
          text('recentWinRate') + ' ' + expected,
        );
        await user.click(screen.getByRole('button', { name: text('mapStatistics') }));
        expect(screen.getByText('Unknown rate map · — (2)')).toBeTruthy();
        expect(screen.getByText('Zero rate map · 0% (2)')).toBeTruthy();
        expect(document.querySelector('.report-tags')!.textContent).toContain(
          text('cat.tanks') + ' —',
        );
        await user.click(screen.getByRole('button', { name: text('copy') }));
        expect(copy.mock.calls.at(-1)?.[0]).toContain(text('recentWinRate') + ' ' + expected);
        expect(document.body.textContent).not.toContain('—%');
        expect(copy.mock.calls.at(-1)?.[0]).not.toContain('—%');
      });
    for (const missing of ['wins', 'losses'] as const)
      it(`shows missing ${missing} and sample size as unknown with recovery in ${locale}`, async () => {
        const report = reportFixture({
          fallback: true,
          wins: missing === 'wins' ? null : 6,
          losses: missing === 'losses' ? null : 4,
          matchCount: 20,
          sampleCount: null,
          winRate: null,
          detailAvailability: { matches: false, maps: false },
          recentMatches: [],
          mapStats: [],
          categories: [],
        });
        const native = nativeFixture(initial());
        const user = userEvent.setup();
        const copy = vi.spyOn(navigator.clipboard, 'writeText');
        render(
          <>
            <ReportView report={report} />
            <ProfileOverview id={report.id} report={report} profile={null} />
          </>,
          { wrapper: wrapper(native.api) },
        );
        const button = await screen.findByRole('button', { name: text('copy') });
        expect(statistic(document.querySelector('.report')!, text('winRate'))).toBe('—');
        expect(statistic(document.querySelector('.profile-overview')!, text('winRate'))).toBe('—');
        expect(document.querySelector('.report-identity-meta')!.textContent).toContain(
          text('samples') + ' —',
        );
        expect(screen.getByText(text('reportOutcomeCountsUnavailable'))).toBeTruthy();
        expect(screen.getByRole('button', { name: text('retryAnalysis') })).toBeTruthy();
        await user.click(button);
        expect(copy.mock.calls.at(-1)?.[0]).toContain(text('winRate') + ' — (—)');
        expect(copy.mock.calls.at(-1)?.[0]).toContain(text('reportOutcomeCountsUnavailable'));
        expect(copy.mock.calls.at(-1)?.[0]).not.toContain('null');
      });
    for (const scenario of ['queried', 'mixed-zero', 'failed', 'unknown'] as const)
      it(`copies the displayed team ratings through ${scenario} results in ${locale}`, async () => {
        const match = matchFixture();
        match.players = match.players.slice(0, 2).map((player, index) => ({
          ...player,
          name: 'Metric player ' + index,
          teamId: 0,
          oldRating: index === 0 ? (scenario === 'unknown' ? null : 1500) : 1600,
        }));
        const bootstrap = initial();
        bootstrap.session.current = null;
        bootstrap.session.phase = 'idle';
        bootstrap.session.lobbyPlayers = [];
        const gate = deferred<RpcOutputs['session.query']>();
        const native = nativeFixture(bootstrap, {
          'matches.list': () => [match],
          'matches.detail': () => match,
          'session.query': () => gate.promise,
        });
        const user = userEvent.setup();
        const copy = vi.spyOn(navigator.clipboard, 'writeText');
        render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
        const previous = await screen.findByRole('button', { name: text('previous') });
        await waitFor(() => expect(previous.getAttribute('aria-disabled')).toBe('false'));
        await user.click(previous);
        const copyButton = await screen.findByRole('button', { name: text('copy') + ' Alpha' });
        await user.click(copyButton);
        expect(copy.mock.calls.at(-1)?.[0]).toContain(
          scenario === 'unknown'
            ? 'Metric player 0 —'
            : `Metric player 0 1,500 (${text('matchStartingRating')})`,
        );
        expect(copy.mock.calls.at(-1)?.[0]).toContain(
          `Metric player 1 1,600 (${text('matchStartingRating')})`,
        );
        const input = native.calls.find((call) => call.method === 'session.query')!
          .input as RpcInputs['session.query'];
        const ratings =
          scenario === 'queried'
            ? [1700, 1800]
            : scenario === 'mixed-zero'
              ? [0, null]
              : [null, null];
        act(() =>
          native.emit({
            type: 'rosterQuery',
            requestId: input.requestId,
            context: 'previous',
            sourceKey: previousRosterKey(match.fid, match.players),
            pendingIds: match.players.map((player) => player.id),
            revision: native.backend.revision + 1,
          }),
        );
        for (const [index, player] of match.players.entries())
          act(() =>
            native.emit({
              type: 'roster',
              requestId: input.requestId,
              sourceKey: previousRosterKey(match.fid, match.players),
              context: 'previous',
              generation: bootstrap.session.generation,
              player,
              info:
                scenario === 'failed'
                  ? null
                  : {
                      elo: ratings[index]!,
                      winRate: null,
                      kd: null,
                      matchCount: null,
                      sampleCount: null,
                      fallback: true,
                      category: null,
                      topUnits: '',
                      updatedAt: Date.now(),
                      stale: false,
                    },
              error: scenario === 'failed' ? 'Controlled query failure' : null,
              revision: native.backend.revision + 1,
            }),
          );
        await act(async () =>
          gate.resolve({
            requestId: input.requestId,
            queried: scenario === 'failed' ? 0 : 2,
            skipped: 0,
            cancelled: false,
          }),
        );
        await user.click(copyButton);
        const visible = [...document.querySelectorAll('.player-rating strong')].map(
          (node) => node.textContent,
        );
        const expected =
          scenario === 'queried'
            ? ['1,700', '1,800']
            : scenario === 'mixed-zero'
              ? ['0', '1,600']
              : scenario === 'unknown'
                ? ['—', '1,600']
                : ['1,500', '1,600'];
        expect(visible).toEqual(expected);
        for (const [index, value] of expected.entries())
          expect(copy.mock.calls.at(-1)?.[0]).toContain(`Metric player ${index} ${value}`);
        expect(document.querySelector('.team-rating strong')!.textContent).toBe(
          scenario === 'queried'
            ? '1,750'
            : scenario === 'mixed-zero'
              ? '800'
              : scenario === 'unknown'
                ? '—'
                : '1,550',
        );
        if (scenario === 'queried')
          expect(copy.mock.calls.at(-1)?.[0]).not.toContain(text('matchStartingRating'));
      });
    for (const latestRating of [null, 0, 1500] as const)
      it(`uses the latest completed match with ${latestRating} ELO in ${locale}`, async () => {
        let latest = matchFixture({
          id: '990001',
          fid: '990001',
          endedAt: 1700604800000,
          eloAfter: latestRating,
        });
        const older = matchFixture({
          id: '990000',
          fid: '990000',
          endedAt: 1700000000000,
          eloAfter: 1400,
        });
        const bootstrap = initial();
        bootstrap.session.localPlayerId = latest.localPlayerId;
        const native = nativeFixture(bootstrap, { 'matches.list': () => [older, latest] });
        render(<Dashboard />, { wrapper: wrapper(native.api) });
        const label = await screen.findByText(text('recentRating'));
        const metric = label.closest('[data-slot=card]')!;
        await waitFor(() =>
          expect(metric.querySelector('strong')!.textContent).toBe(
            latestRating === null ? '—' : latestRating === 0 ? '0' : '1,500',
          ),
        );
        if (latestRating === null) {
          expect(metric.textContent).toContain(text('latestRatingUnavailable'));
          latest = { ...latest, eloAfter: 1500 };
          act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
          await waitFor(() => expect(metric.querySelector('strong')!.textContent).toBe('1,500'));
          expect(metric.textContent).not.toContain(text('latestRatingUnavailable'));
        }
      });
  }
});

describe('localized interface labels', () => {
  for (const locale of ['zh', 'en'] as const) {
    const text = (key: string) => translate(locale, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = locale;
      value.config.panelOrder = ['current', 'radar', 'players', 'archive', 'replays'];
      value.config.hiddenPanels = [];
      return value;
    };
    it(`names and saves glass opacity consistently in ${locale}`, async () => {
      const bootstrap = initial();
      bootstrap.config.glassOpacity = 50;
      const native = nativeFixture(bootstrap);
      window.history.replaceState(null, '', '#settings/appearance');
      render(<App />, { wrapper: wrapper(native.api) });
      const slider = await screen.findByRole('slider', {
        name: locale === 'zh' ? '玻璃不透明度' : 'Glass opacity',
      });
      slider.focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(slider.getAttribute('aria-valuenow')).toBe('55');
      expect(slider.getAttribute('aria-valuetext')).toBe('55%');
      expect(document.activeElement).toBe(slider);
      await waitFor(() => expect(native.backend.config.glassOpacity).toBe(55));
    });
    it(`uses Overview for navigation visibility and ordering controls in ${locale}`, async () => {
      const native = nativeFixture(initial());
      window.history.replaceState(null, '', '#settings/navigation');
      render(<App />, { wrapper: wrapper(native.api) });
      const name = locale === 'zh' ? '总览' : 'Overview';
      const toggle = await screen.findByRole('switch', {
        name: text('showInNavigation') + ' ' + name,
      });
      expect(screen.getByRole('button', { name: text('moveUp') + ' ' + name })).toBeTruthy();
      expect(screen.getByRole('button', { name: text('moveDown') + ' ' + name })).toBeTruthy();
      toggle.focus();
      await userEvent.keyboard(' ');
      await waitFor(() => expect(native.backend.config.hiddenPanels).toEqual(['current']));
      await userEvent.click(screen.getByRole('button', { name: text('settingsBack') }));
      const navigation = within(
        await screen.findByRole('navigation', { name: text('workspaceNav') }),
      );
      expect(navigation.queryByRole('button', { name })).toBeNull();
      expect(navigation.getByRole('button', { name: text('radar') })).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: text('settings') }));
      await userEvent.click(await screen.findByRole('tab', { name: text('navigationSettings') }));
      await userEvent.click(
        screen.getByRole('switch', { name: text('showInNavigation') + ' ' + name }),
      );
      await waitFor(() => expect(native.backend.config.hiddenPanels).toEqual([]));
    });
    for (const warning of ['code', 'legacy', 'technical'] as const)
      it(`localizes ${warning} cache warnings without losing unrelated detail in ${locale}`, async () => {
        const match = structuredClone(capturedMatches[0]!);
        match.warning =
          warning === 'code'
            ? undefined
            : warning === 'legacy'
              ? 'Cached match data; BATrace is unavailable'
              : 'BATrace HTTP 503';
        match.warningCode = warning === 'code' ? 'batrace-cache' : undefined;
        const native = nativeFixture(initial(), { 'matches.detail': () => match });
        render(<MatchDialog fid={match.fid!} />, { wrapper: wrapper(native.api) });
        expect(
          await screen.findByText(
            warning === 'technical'
              ? 'BATrace HTTP 503'
              : locale === 'zh'
                ? '当前显示缓存对局数据，BATrace 暂不可用。'
                : 'Cached match data; BATrace is unavailable.',
          ),
        ).toBeTruthy();
        if (locale === 'zh' && warning !== 'technical')
          expect(screen.queryByText('Cached match data; BATrace is unavailable')).toBeNull();
      });
    for (const surface of ['radar', 'match', 'archive'] as const)
      it(`keeps spectator/unknown and Alpha/Bravo names consistent on ${surface} in ${locale}`, async () => {
        const match = structuredClone(capturedMatches[0]!);
        match.players = match.players
          .slice(0, 4)
          .map((player, index) => ({ ...player, teamId: ([0, 1, 100, null] as const)[index]! }));
        const bootstrap = initial();
        bootstrap.session.phase = 'match';
        bootstrap.session.current = match;
        const native = nativeFixture(bootstrap, { 'matches.detail': () => match });
        render(
          surface === 'radar' ? (
            <SessionPanel standalone />
          ) : surface === 'match' ? (
            <MatchDialog fid={match.fid!} />
          ) : (
            <MatchArchiveCard match={match} />
          ),
          { wrapper: wrapper(native.api) },
        );
        for (const name of [
          'Alpha',
          'Bravo',
          locale === 'zh' ? '观战' : 'Spectator',
          locale === 'zh' ? '未知' : 'Unknown',
        ]) {
          expect(await screen.findByRole('heading', { name: new RegExp('^' + name) })).toBeTruthy();
          if (surface === 'radar')
            expect(screen.getByRole('button', { name: text('copy') + ' ' + name })).toBeTruthy();
          if (surface === 'match') expect(screen.getByRole('table', { name })).toBeTruthy();
        }
      });
    it(`uses localized team fallbacks for recording labels and action names in ${locale}`, async () => {
      const recordings = ([100, null] as const).map((teamId, index) =>
        replayFixture({ id: `team-${index}.webm`, teamId, uploaderName: '', map: '' }),
      );
      const native = nativeFixture(initial(), {
        'replays.list': () => ({ directory: 'test-profile/recordings', recordings }),
      });
      render(<ReplaysPanel />, { wrapper: wrapper(native.api) });
      for (const name of locale === 'zh' ? ['观战', '未知'] : ['Spectator', 'Unknown']) {
        expect(await screen.findByText(name)).toBeTruthy();
        expect(
          screen.getByRole('button', { name: new RegExp('^' + text('play') + ': ' + name) }),
        ).toBeTruthy();
      }
    });
  }
});

describe('playback retry continuity', () => {
  for (const locale of ['zh', 'en'] as const)
    for (const outcome of ['playing', 'paused', 'failed', 'later-focus'] as const)
      it(`ignores old media errors during ${outcome} recovery in ${locale}`, async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        const bootstrap = bootstrapForApp();
        bootstrap.config.lang = locale;
        const next = deferred<{ url: string }>();
        let attempts = 0;
        const native = nativeFixture(bootstrap, {
          'replays.play': () =>
            ++attempts === 1 ? { url: 'ba-replay://test/first.webm' } : next.promise,
        });
        render(<ReplayDialog id="clip.webm" title="Replay" />, { wrapper: wrapper(native.api) });
        await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
        const old = document.querySelector('video')!;
        fireEvent.loadedMetadata(old);
        fireEvent.click(screen.getByRole('radio', { name: '2×' }));
        old.currentTime = 80;
        fireEvent.timeUpdate(old);
        if (outcome === 'paused') fireEvent.pause(old);
        else fireEvent.play(old);
        fireEvent.error(old);
        const retry = await screen.findByRole('button', { name: translate(locale, 'retry') });
        retry.focus();
        const user = userEvent.setup();
        await user.keyboard(' ');
        await waitFor(() => expect(attempts).toBe(2));
        expect(document.activeElement).toBe(retry);
        expect(document.querySelector('video')).toBe(old);
        expect(retry.getAttribute('aria-disabled')).toBe('true');
        fireEvent.error(old);
        expect(screen.queryByText(translate(locale, 'error'))).toBeNull();
        await user.keyboard('{Enter} ');
        expect(attempts).toBe(2);
        const close = screen.getByRole('button', { name: translate(locale, 'close') });
        if (outcome === 'later-focus') close.focus();
        await act(async () =>
          outcome === 'failed'
            ? next.reject(new Error('Controlled playback failure'))
            : next.resolve({ url: 'ba-replay://test/recovered.webm' }),
        );
        if (outcome === 'failed') {
          await screen.findByText('Controlled playback failure');
          expect(document.querySelector('video')).toBe(old);
          expect(retry.textContent).toBe(translate(locale, 'retry'));
        } else {
          await waitFor(() => expect(document.querySelector('video')).not.toBe(old));
          const current = document.querySelector('video')!;
          Object.defineProperty(current, 'duration', { configurable: true, value: 120 });
          fireEvent.loadedMetadata(current);
          expect(current.currentTime).toBe(80);
          expect(current.playbackRate).toBe(2);
          expect(current.autoplay).toBe(outcome !== 'paused');
          expect(screen.queryByText(translate(locale, 'error'))).toBeNull();
          expect(retry.textContent).toBe(translate(locale, 'refresh'));
        }
        expect(document.activeElement).toBe(outcome === 'later-focus' ? close : retry);
        expect(retry.isConnected).toBe(true);
        expect(retry.getAttribute('aria-disabled')).toBe('false');
      });
});

describe('settings recovery focus ownership', () => {
  for (const locale of ['zh', 'en'] as const)
    for (const scope of ['application', 'recording', 'automatic'] as const)
      for (const outcome of ['retry', 'discard', 'retry-failed', 'later-focus'] as const) {
        it(`preserves context after ${outcome} for ${scope} in ${locale}`, async () => {
          const bootstrap = bootstrapForApp();
          bootstrap.config = {
            ...bootstrap.config,
            lang: locale,
            replaySaveDir: 'A',
            replayEnabled: false,
          };
          const retry = deferred<Bootstrap['config']>();
          let attempts = 0;
          const native = nativeFixture(bootstrap, {
            'config.update': async (patch) => {
              if (++attempts === 1) throw new Error('Controlled initial save failure');
              await retry.promise;
              const config = configSchema.parse({ ...native.backend.config, ...patch });
              native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
              return config;
            },
          });
          window.history.replaceState(
            null,
            '',
            scope === 'application' ? '#settings/general' : '#settings/recording',
          );
          render(<App />, { wrapper: wrapper(native.api) });
          if (scope === 'application') {
            fireEvent.change(
              await screen.findByRole('combobox', { name: translate(locale, 'language') }),
              { target: { value: locale === 'zh' ? 'en' : 'zh' } },
            );
          } else if (scope === 'recording') {
            fireEvent.change(
              await screen.findByRole('textbox', { name: translate(locale, 'saveDirectory') }),
              { target: { value: 'B' } },
            );
            fireEvent.click(
              screen.getByRole('tab', { name: translate(locale, 'generalSettings') }),
            );
          } else
            fireEvent.click(
              await screen.findByRole('switch', { name: translate(locale, 'autoRecord') }),
            );
          const review = await reviewSettingsFailure(locale);
          const scopeControl = review.getByRole('combobox', {
            name: translate(locale, 'settingsSaveScope'),
          });
          const region = review.getByRole('region', {
            name: translate(locale, 'settingsSaveDetails'),
          });
          const button = review.getByRole('button', {
            name: translate(locale, outcome === 'discard' ? 'settingsDiscard' : 'settingsRetry'),
          });
          const user = userEvent.setup();
          button.focus();
          await user.keyboard(' ');
          if (outcome !== 'discard') {
            await waitFor(() => expect(attempts).toBe(2));
            expect(document.activeElement).toBe(button);
            expect(button.isConnected).toBe(true);
            expect(button.getAttribute('aria-disabled')).toBe('true');
            await user.keyboard('{Enter} ');
            expect(attempts).toBe(2);
            if (outcome === 'later-focus') scopeControl.focus();
            await act(async () =>
              outcome === 'retry-failed'
                ? retry.reject(new Error('Controlled retry failure'))
                : retry.resolve(bootstrap.config),
            );
          }
          await waitFor(() => {
            expect(document.activeElement).toBe(outcome === 'later-focus' ? scopeControl : region);
            expect(region.isConnected).toBe(true);
          });
          if (outcome === 'retry-failed') {
            expect(review.getByText('Controlled retry failure')).toBeTruthy();
            expect(button.isConnected).toBe(true);
            expect(button.getAttribute('aria-disabled')).toBe('false');
          } else {
            expect(button.isConnected).toBe(false);
            const saved = outcome !== 'discard';
            expect(native.backend.config.lang).toBe(
              scope === 'application' && saved ? (locale === 'zh' ? 'en' : 'zh') : locale,
            );
            expect(native.backend.config.replaySaveDir).toBe(
              scope === 'recording' && saved ? 'B' : 'A',
            );
            expect(native.backend.config.replayEnabled).toBe(scope === 'automatic' && saved);
          }
          expect(attempts).toBe(outcome === 'discard' ? 1 : 2);
        });
      }
});

describe('persistent settings recovery', () => {
  function initial(lang: 'zh' | 'en') {
    const value = bootstrapForApp();
    value.config = { ...value.config, lang, replaySaveDir: 'A', replayEnabled: false };
    return value;
  }
  function commit(native: ReturnType<typeof nativeFixture>, patch: RpcInputs['config.update']) {
    const config = configSchema.parse({ ...native.backend.config, ...patch });
    native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
    return config;
  }
  async function start(
    native: ReturnType<typeof nativeFixture>,
    lang: 'zh' | 'en',
    workspace = false,
  ) {
    window.history.replaceState(null, '', workspace ? '#current' : '#settings/recording');
    render(<App />, { wrapper: wrapper(native.api) });
    if (workspace) {
      fireEvent.click(await screen.findByRole('button', { name: translate(lang, 'settings') }));
      fireEvent.click(
        await screen.findByRole('tab', { name: translate(lang, 'recordingSettings') }),
      );
    }
    return screen.findByRole('textbox', { name: translate(lang, 'saveDirectory') });
  }
  async function state(lang: 'zh' | 'en', value: 'saved' | 'saving' | 'error') {
    return screen.findByRole('button', {
      name: translate(lang, 'settingsSaveReview', {
        status: translate(
          lang,
          value === 'saved'
            ? 'settingsAutoSaved'
            : value === 'error'
              ? 'settingsSaveFailed'
              : 'settingsSaving',
        ),
      }),
    });
  }
  for (const lang of ['zh', 'en'] as const) {
    for (const timing of ['before-return', 'after-return'])
      for (const action of ['retry', 'discard']) {
        it(`retains a failed recording draft across tabs ${timing} and ${action} in ${lang}`, async () => {
          const pending = deferred<Bootstrap['config']>();
          let attempts = 0;
          const native = nativeFixture(initial(lang), {
            'config.update': (patch) =>
              ++attempts === 1 ? pending.promise : commit(native, patch),
          });
          const input = await start(native, lang);
          fireEvent.change(input, { target: { value: 'B' } });
          fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'generalSettings') }));
          await state(lang, 'saving');
          expect(native.backend.config.replaySaveDir).toBe('A');
          if (timing === 'before-return')
            await act(async () => pending.reject(new Error('Controlled recording save failure')));
          fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'recordingSettings') }));
          expect(
            (
              screen.getByRole('textbox', {
                name: translate(lang, 'saveDirectory'),
              }) as HTMLInputElement
            ).value,
          ).toBe('B');
          if (timing === 'after-return')
            await act(async () => pending.reject(new Error('Controlled recording save failure')));
          const recovery = await reviewSettingsFailure(lang);
          expect(recovery.getByText('Controlled recording save failure')).toBeTruthy();
          expect(
            recovery
              .getByRole('combobox', { name: translate(lang, 'settingsSaveScope') })
              .getAttribute('id'),
          ).toBeTruthy();
          fireEvent.click(
            recovery.getByRole('button', {
              name: translate(lang, action === 'retry' ? 'settingsRetry' : 'settingsDiscard'),
            }),
          );
          await state(lang, 'saved');
          fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'close') }));
          expect(
            (
              screen.getByRole('textbox', {
                name: translate(lang, 'saveDirectory'),
              }) as HTMLInputElement
            ).value,
          ).toBe(action === 'retry' ? 'B' : 'A');
          expect(native.backend.config.replaySaveDir).toBe(action === 'retry' ? 'B' : 'A');
          expect(
            native.calls
              .filter((call) => call.method === 'config.update')
              .map((call) => call.input),
          ).toEqual(
            action === 'retry'
              ? [{ replaySaveDir: 'B' }, { replaySaveDir: 'B' }]
              : [{ replaySaveDir: 'B' }],
          );
        });
      }
    for (const action of ['retry', 'discard']) {
      it(`waits for a recording write on Back and permits ${action} after failure in ${lang}`, async () => {
        const pending = deferred<Bootstrap['config']>();
        let attempts = 0;
        const native = nativeFixture(initial(lang), {
          'config.update': (patch) => (++attempts === 1 ? pending.promise : commit(native, patch)),
        });
        const input = await start(native, lang);
        fireEvent.change(input, { target: { value: 'B' } });
        fireEvent.click(screen.getByRole('button', { name: translate(lang, 'settingsBack') }));
        await state(lang, 'saving');
        expect(screen.getByRole('main', { name: translate(lang, 'settings') })).toBeTruthy();
        await act(async () => pending.reject(new Error('Controlled Back save failure')));
        const decision = within(
          await screen.findByRole('dialog', { name: translate(lang, 'settingsUnsavedTitle') }),
        );
        if (action === 'discard')
          fireEvent.click(
            decision.getByRole('button', { name: translate(lang, 'settingsDiscard') }),
          );
        else {
          fireEvent.click(
            decision.getByRole('button', { name: translate(lang, 'settingsKeepEditing') }),
          );
          expect(
            (
              screen.getByRole('textbox', {
                name: translate(lang, 'saveDirectory'),
              }) as HTMLInputElement
            ).value,
          ).toBe('B');
          const recovery = await reviewSettingsFailure(lang);
          fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'settingsRetry') }));
          await state(lang, 'saved');
          fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'close') }));
          fireEvent.click(screen.getByRole('button', { name: translate(lang, 'settingsBack') }));
        }
        await waitFor(() =>
          expect(screen.queryByRole('main', { name: translate(lang, 'settings') })).toBeNull(),
        );
        await state(lang, 'saved');
        expect(native.backend.config.replaySaveDir).toBe(action === 'retry' ? 'B' : 'A');
        expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(
          action === 'retry' ? 2 : 1,
        );
      });
      it(`reports a pending history-navigation write in the workspace and permits ${action} in ${lang}`, async () => {
        const pending = deferred<Bootstrap['config']>();
        let attempts = 0;
        const native = nativeFixture(initial(lang), {
          'config.update': (patch) => (++attempts === 1 ? pending.promise : commit(native, patch)),
        });
        const input = await start(native, lang, true);
        fireEvent.change(input, { target: { value: 'B' } });
        await act(async () => {
          window.history.back();
        });
        await waitFor(() =>
          expect(screen.queryByRole('main', { name: translate(lang, 'settings') })).toBeNull(),
        );
        await state(lang, 'saving');
        await act(async () => pending.reject(new Error('Controlled history save failure')));
        const recovery = await reviewSettingsFailure(lang);
        expect(recovery.getByText('Controlled history save failure')).toBeTruthy();
        fireEvent.click(
          recovery.getByRole('button', {
            name: translate(lang, action === 'retry' ? 'settingsRetry' : 'settingsDiscard'),
          }),
        );
        await state(lang, 'saved');
        fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'close') }));
        fireEvent.click(screen.getByRole('button', { name: translate(lang, 'settings') }));
        fireEvent.click(
          await screen.findByRole('tab', { name: translate(lang, 'recordingSettings') }),
        );
        expect(
          (
            screen.getByRole('textbox', {
              name: translate(lang, 'saveDirectory'),
            }) as HTMLInputElement
          ).value,
        ).toBe(action === 'retry' ? 'B' : 'A');
        expect(native.backend.config.replaySaveDir).toBe(action === 'retry' ? 'B' : 'A');
      });
    }
    for (const timing of ['before-return', 'after-return'])
      for (const route of ['back', 'reopen']) {
        it(`retains migration intent and the failed draft while reviewing queued alerts ${timing} via ${route} in ${lang}`, async () => {
          window.history.replaceState(null, '', '#replays');
          const pending = deferred<ReplayMoveResult>();
          let attempts = 0;
          const native = nativeFixture(initial(lang), {
            'replays.directory': () => ({ dir: native.backend.config.replaySaveDir, count: 1 }),
            'replays.move': ({ from, to }) =>
              ++attempts === 1
                ? pending.promise
                : {
                    createdAt: Date.now(),
                    from,
                    to,
                    directory: to,
                    committed: true,
                    moved: 1,
                    copied: ['Alpha.webm'],
                    retained: [],
                    destinationCopies: [],
                    failed: [],
                  },
          });
          render(<App />, { wrapper: wrapper(native.api) });
          fireEvent.click(
            await screen.findByRole('button', { name: translate(lang, 'recordingSettings') }),
          );
          const form = within(
            await screen.findByRole('dialog', { name: translate(lang, 'recordingSettings') }),
          );
          fireEvent.click(
            form.getByRole('switch', { name: translate(lang, 'migrateFilesOnChange') }),
          );
          fireEvent.change(form.getByRole('textbox', { name: translate(lang, 'saveDirectory') }), {
            target: { value: 'B' },
          });
          fireEvent.blur(form.getByRole('textbox', { name: translate(lang, 'saveDirectory') }));
          const ban = bannedPlayer();
          act(() =>
            native.emit({
              type: 'bans',
              list: [ban],
              newly: [ban],
              alerts: [{ id: 'batch-alpha', createdAt: 1, players: [ban] }],
              revision: native.backend.revision + 1,
            }),
          );
          expect(screen.queryByRole('dialog', { name: translate(lang, 'banAlert') })).toBeNull();
          fireEvent.click(
            form.getByRole('button', { name: translate(lang, 'banAlertsPending', { count: 1 }) }),
          );
          const alert = within(
            await screen.findByRole('dialog', { name: translate(lang, 'banAlert') }),
          );
          await waitFor(() => expect(attempts).toBe(1));
          if (timing === 'before-return')
            await act(async () =>
              pending.reject(new Error('Controlled interrupted migration failure')),
            );
          fireEvent.click(alert.getByRole('button', { name: translate(lang, 'close') }));
          const returned = within(
            await screen.findByRole('dialog', { name: translate(lang, 'recordingSettings') }),
          );
          expect(
            (
              returned.getByRole('textbox', {
                name: translate(lang, 'saveDirectory'),
              }) as HTMLInputElement
            ).value,
          ).toBe('B');
          expect(
            returned
              .getByRole('switch', { name: translate(lang, 'migrateFilesOnChange') })
              .getAttribute('aria-checked'),
          ).toBe('true');
          if (timing === 'after-return')
            await act(async () =>
              pending.reject(new Error('Controlled interrupted migration failure')),
            );
          const recovery = await reviewSettingsFailure(lang);
          expect(recovery.getByText('Controlled interrupted migration failure')).toBeTruthy();
          fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'settingsRetry') }));
          await state(lang, 'saved');
          expect(native.backend.config.replaySaveDir).toBe('B');
          expect(
            native.calls.filter((call) => call.method === 'replays.move').map((call) => call.input),
          ).toEqual([
            { from: 'A', to: 'B' },
            { from: 'A', to: 'B' },
          ]);
        });
      }
    it(`aggregates pending and failed owners across every category and recovers only the selected scope in ${lang}`, async () => {
      const application = deferred<Bootstrap['config']>(),
        recording = deferred<Bootstrap['config']>();
      let attempts = 0;
      const native = nativeFixture(initial(lang), {
        'cache.stats': () => ({
          at: Date.now(),
          nextExpiryAt: null,
          api: { entries: 0, expired: 0, bytes: 0 },
          snapshots: { entries: 0, expired: 0, bytes: 0 },
        }),
        'config.update': (patch) =>
          ++attempts === 1
            ? application.promise
            : attempts === 2
              ? recording.promise
              : commit(native, patch),
      });
      await start(native, lang);
      fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'automation') }));
      const query = screen.getByRole('switch', { name: translate(lang, 'autoQuery') });
      const requested = query.getAttribute('aria-checked') !== 'true';
      fireEvent.click(query);
      fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'recordingSettings') }));
      fireEvent.change(screen.getByRole('combobox', { name: translate(lang, 'audio') }), {
        target: { value: 'off' },
      });
      await waitFor(() => expect(attempts).toBe(2));
      for (const key of [
        'generalSettings',
        'appearance',
        'gameConnection',
        'automation',
        'cache',
        'recordingSettings',
        'navigationSettings',
        'accounts',
      ]) {
        fireEvent.click(screen.getByRole('tab', { name: translate(lang, key) }));
        await state(lang, 'saving');
      }
      await act(async () => {
        application.reject(new Error('Controlled application save failure'));
        recording.reject(new Error('Controlled audio save failure'));
      });
      const recovery = await reviewSettingsFailure(lang);
      expect(recovery.getByText('Controlled application save failure')).toBeTruthy();
      fireEvent.change(
        recovery.getByRole('combobox', { name: translate(lang, 'settingsSaveScope') }),
        { target: { value: 'recording' } },
      );
      expect(recovery.getByText('Controlled audio save failure')).toBeTruthy();
      fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'settingsDiscard') }));
      await waitFor(() => expect(recovery.queryByRole('alert')).toBeNull());
      await state(lang, 'error');
      expect(attempts).toBe(2);
      fireEvent.change(
        recovery.getByRole('combobox', { name: translate(lang, 'settingsSaveScope') }),
        { target: { value: 'application' } },
      );
      fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'settingsRetry') }));
      await state(lang, 'saved');
      expect(native.backend.config.autoQueryCurrentMatch).toBe(requested);
      expect(native.backend.config.replayAudio).toBe(initial(lang).config.replayAudio);
      expect(native.calls.filter((call) => call.method === 'config.update').at(-1)?.input).toEqual({
        autoQueryCurrentMatch: requested,
      });
    });
    for (const navigation of ['history', 'back']) {
      it(`keeps a pending automatic-recording preference visible and recoverable after ${navigation} in ${lang}`, async () => {
        const pending = deferred<Bootstrap['config']>();
        let attempts = 0;
        const native = nativeFixture(initial(lang), {
          'config.update': (patch) => (++attempts === 1 ? pending.promise : commit(native, patch)),
        });
        await start(native, lang, true);
        fireEvent.click(screen.getByRole('switch', { name: translate(lang, 'autoRecord') }));
        if (navigation === 'history') {
          await act(async () => {
            window.history.back();
          });
          await waitFor(() =>
            expect(screen.queryByRole('main', { name: translate(lang, 'settings') })).toBeNull(),
          );
        } else
          fireEvent.click(screen.getByRole('button', { name: translate(lang, 'settingsBack') }));
        await state(lang, 'saving');
        await act(async () => pending.reject(new Error('Controlled automatic preference failure')));
        if (navigation === 'back') {
          const decision = within(
            await screen.findByRole('dialog', { name: translate(lang, 'settingsUnsavedTitle') }),
          );
          fireEvent.click(
            decision.getByRole('button', { name: translate(lang, 'settingsDiscard') }),
          );
          await waitFor(() =>
            expect(screen.queryByRole('main', { name: translate(lang, 'settings') })).toBeNull(),
          );
          await state(lang, 'saved');
          expect(native.backend.config.replayEnabled).toBe(false);
          expect(attempts).toBe(1);
        } else {
          const recovery = await reviewSettingsFailure(lang);
          expect(recovery.getByText('Controlled automatic preference failure')).toBeTruthy();
          fireEvent.click(recovery.getByRole('button', { name: translate(lang, 'settingsRetry') }));
          await state(lang, 'saved');
          expect(native.backend.config.replayEnabled).toBe(true);
          expect(attempts).toBe(2);
        }
      });
    }
    for (const scope of ['recording', 'application']) {
      it(`does not retry a failed ${scope} write merely by reviewing or leaving an unchanged field in ${lang}`, async () => {
        let attempts = 0;
        const native = nativeFixture(initial(lang), {
          'config.update': (patch) => {
            if (++attempts === 1) throw new Error('Controlled retained failure');
            return commit(native, patch);
          },
        });
        const directory = await start(native, lang);
        if (scope === 'recording') {
          fireEvent.change(directory, { target: { value: 'B' } });
          fireEvent.blur(directory);
        } else {
          fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'generalSettings') }));
          fireEvent.change(screen.getByRole('combobox', { name: translate(lang, 'language') }), {
            target: { value: lang === 'zh' ? 'en' : 'zh' },
          });
        }
        await state(lang, 'error');
        fireEvent.click(
          screen.getByRole('tab', {
            name: translate(lang, scope === 'recording' ? 'recordingSettings' : 'gameConnection'),
          }),
        );
        const unchanged = screen.getByRole('textbox', {
          name: translate(lang, scope === 'recording' ? 'saveDirectory' : 'logDirectory'),
        });
        const user = userEvent.setup();
        await user.click(unchanged);
        await user.click(await state(lang, 'error'));
        const recovery = within(
          await screen.findByRole('dialog', { name: translate(lang, 'settingsSaveDetails') }),
        );
        expect(recovery.getByText('Controlled retained failure')).toBeTruthy();
        expect(attempts).toBe(1);
        expect(native.backend.config.lang).toBe(lang);
        expect(native.backend.config.replaySaveDir).toBe('A');
        await user.click(recovery.getByRole('button', { name: translate(lang, 'close') }));
        fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'automation') }));
        await state(lang, 'error');
        await act(async () => {
          window.history.pushState(null, '', '#current');
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await state(lang, 'error');
        expect(attempts).toBe(1);
        const retained = await reviewSettingsFailure(lang);
        expect(retained.getByText('Controlled retained failure')).toBeTruthy();
        fireEvent.click(retained.getByRole('button', { name: translate(lang, 'settingsDiscard') }));
        await state(lang, 'saved');
        expect(attempts).toBe(1);
      });
    }
    it(`keeps recovery focus meaningful and suppresses repeated retry while saving in ${lang}`, async () => {
      const retry = deferred<Bootstrap['config']>();
      let attempts = 0;
      let patch: RpcInputs['config.update'] = {};
      const native = nativeFixture(initial(lang), {
        'config.update': (input) => {
          patch = input;
          if (++attempts === 1) throw new Error('Controlled recovery focus failure');
          return retry.promise;
        },
      });
      await start(native, lang);
      fireEvent.change(screen.getByRole('combobox', { name: translate(lang, 'audio') }), {
        target: { value: 'off' },
      });
      const recovery = await reviewSettingsFailure(lang);
      const user = userEvent.setup();
      const button = recovery.getByRole('button', { name: translate(lang, 'settingsRetry') });
      await user.click(button);
      await user.click(button);
      expect(attempts).toBe(2);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(button);
      await act(async () => retry.resolve(commit(native, patch)));
      await state(lang, 'saved');
      expect(document.activeElement).toBe(
        recovery.getByRole('region', { name: translate(lang, 'settingsSaveDetails') }),
      );
      await user.keyboard('{Escape}');
      expect(
        screen.queryByRole('dialog', { name: translate(lang, 'settingsSaveDetails') }),
      ).toBeNull();
      expect(document.activeElement).toBe(await state(lang, 'saved'));
    });
    it(`keeps writing and failure ahead of a directory draft staged during a delayed slider save in ${lang}`, async () => {
      const pending = deferred<Bootstrap['config']>();
      let attempts = 0;
      const native = nativeFixture(initial(lang), {
        'config.update': (patch) => (++attempts === 1 ? pending.promise : commit(native, patch)),
      });
      const { result } = renderHook(() => useApp(), { wrapper: wrapper(native.api) });
      await waitFor(() => expect(result.current?.state.config.replaySaveDir).toBe('A'));
      vi.useFakeTimers();
      try {
        act(() => {
          result.current.recordingSettings.change({ replayFps: 90 }, 250);
          result.current.recordingSettings.setDirectory('B');
        });
        expect(result.current.settingsStatus).toBe('pending');
        await act(async () => vi.advanceTimersByTimeAsync(250));
        expect(attempts).toBe(1);
        expect(result.current.settingsStatus).toBe('saving');
        expect(result.current.recordingSettings.directory).toBe('B');
        await act(async () => pending.reject(new Error('Controlled slider save failure')));
        expect(result.current.settingsStatus).toBe('error');
        expect(result.current.recordingSettings.error).toBe('Controlled slider save failure');
        expect(result.current.recordingSettings.directory).toBe('B');
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(attempts).toBe(1);
        await act(async () => {
          await result.current.recordingSettings.flush();
        });
        expect(result.current.settingsStatus).toBe('saved');
        expect(native.backend.config.replaySaveDir).toBe('B');
        expect(native.backend.config.replayFps).toBe(90);
        expect(
          native.calls.filter((call) => call.method === 'config.update').map((call) => call.input),
        ).toEqual([{ replayFps: 90 }, { replayFps: 90, replaySaveDir: 'B' }]);
      } finally {
        vi.useRealTimers();
      }
    });
    it(`preserves both owners when successful responses arrive in different orders in ${lang}`, async () => {
      const writes: {
        result: ReturnType<typeof deferred<Bootstrap['config']>>;
        config: Bootstrap['config'];
      }[] = [];
      const native = nativeFixture(initial(lang), {
        'config.update': (patch) => {
          const config = commit(native, patch),
            result = deferred<Bootstrap['config']>();
          writes.push({ result, config });
          return result.promise;
        },
      });
      const input = await start(native, lang);
      fireEvent.change(input, { target: { value: 'B' } });
      fireEvent.blur(input);
      fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'automation') }));
      const query = screen.getByRole('switch', { name: translate(lang, 'autoQuery') });
      const requested = query.getAttribute('aria-checked') !== 'true';
      fireEvent.click(query);
      await waitFor(() => expect(writes).toHaveLength(2));
      const first = lang === 'zh' ? 0 : 1,
        second = first === 0 ? 1 : 0;
      await act(async () => writes[first]!.result.resolve(writes[first]!.config));
      await state(lang, 'saving');
      await act(async () => writes[second]!.result.resolve(writes[second]!.config));
      await state(lang, 'saved');
      expect(native.backend.config.replaySaveDir).toBe('B');
      expect(native.backend.config.autoQueryCurrentMatch).toBe(requested);
      expect(query.getAttribute('aria-checked')).toBe(String(requested));
      fireEvent.click(screen.getByRole('tab', { name: translate(lang, 'recordingSettings') }));
      expect(
        (
          screen.getByRole('textbox', {
            name: translate(lang, 'saveDirectory'),
          }) as HTMLInputElement
        ).value,
      ).toBe('B');
      expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(2);
    });
  }
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
    expect(input.getAttribute('aria-describedby')?.split(/\s+/)).toEqual([
      'settings-log-feedback',
      'settings-log-hint',
    ]);
    await waitFor(() => expect(native.backend.config.logDir).toBe(manual));
  });

  it('automatically saves a detected directory', async () => {
    const detected = 'G:\\SteamLibrary\\steamapps\\common\\Broken Arrow\\GameLogs';
    const native = nativeFixture(bootstrapForApp(), { 'directory.detect': () => detected });
    const page = await settings(native);
    fireEvent.click(page.getByRole('button', { name: '自动检测 Steam' }));
    await page.findByText(translate('zh', 'logDirectorySaved'));
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
      const detecting = page.getByRole('button', { name: '自动检测 Steam' }) as HTMLButtonElement;
      expect(detecting.getAttribute('aria-disabled')).toBe('true');
      expect(detecting.disabled).toBe(false);
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
    await page.findByText(translate('zh', 'logDirectorySaved'));
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

describe('directory settings ownership and save truth', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    async function open(native: ReturnType<typeof nativeFixture>) {
      window.history.replaceState(null, '', '#settings/connection');
      render(<App />, { wrapper: wrapper(native.api) });
      return within(await screen.findByRole('main', { name: text('settings') }));
    }
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      return value;
    };
    for (const recovery of ['retry', 'discard'] as const) {
      it(`qualifies detected paths through pending, failed and ${recovery} saving in ${lang}`, async () => {
        const pending = deferred<RpcOutputs['config.update']>();
        const detected = 'G:\\Detected\\GameLogs';
        let fail = true;
        const native = nativeFixture(initial(), {
          'directory.detect': () => detected,
          'config.update': async (patch) => {
            if (fail) return pending.promise;
            const config = { ...native.backend.config, ...patch };
            native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
            native.emit({
              type: 'watcher',
              watcher: {
                ...native.backend.watcher,
                dir: detected,
                file: null,
                error: null,
                live: false,
              },
              revision: native.backend.revision + 1,
            });
            return config;
          },
        });
        const original = native.backend.config.logDir;
        const page = await open(native);
        const input = page.getByRole('textbox', { name: text('logDirectory') }) as HTMLInputElement;
        fireEvent.click(page.getByRole('button', { name: text('detect') }));
        await page.findByText(text('logDetectFound'));
        expect(input.value).toBe(detected);
        expect(native.backend.config.logDir).toBe(original);
        expect(page.queryByText(text('logDirectorySaved'))).toBeNull();
        await act(async () => pending.reject(new Error('Controlled path save failure')));
        await page.findByText(text('logDetectSaveFailed'));
        expect(page.queryByText(text('logDetectFound'))).toBeNull();
        expect(page.queryByText(text('logDetectMonitoringReady'))).toBeNull();
        const review = await reviewSettingsFailure(lang);
        fail = false;
        fireEvent.click(
          review.getByRole('button', {
            name: text(recovery === 'retry' ? 'settingsRetry' : 'settingsDiscard'),
          }),
        );
        await waitFor(() => expect(input.value).toBe(recovery === 'retry' ? detected : original));
        await waitFor(() =>
          expect(native.backend.config.logDir).toBe(recovery === 'retry' ? detected : original),
        );
        if (recovery === 'retry') {
          await page.findByText(text('logDirectorySaved'));
          await page.findByText(text('logDetectWaiting'));
        } else {
          expect(page.queryByText(text('logDetectSaveFailed'))).toBeNull();
          expect(input.getAttribute('aria-describedby')).toBe('settings-log-hint');
        }
      });
    }
    for (const action of ['detect', 'logs', 'decks'] as const) {
      it(`ignores a late ${action} result after application-group discard in ${lang}`, async () => {
        const pending = deferred<string>();
        const native = nativeFixture(initial(), {
          'directory.detect': () => pending.promise,
          'directory.select': () => pending.promise,
          'config.update': () => {
            throw new Error('Controlled dirty path');
          },
        });
        const original = { ...native.backend.config };
        const page = await open(native);
        const field = page.getByRole('textbox', {
          name: text(action === 'decks' ? 'decksDirectory' : 'logDirectory'),
        }) as HTMLInputElement;
        fireEvent.change(field, { target: { value: 'G:\\Unsaved' } });
        fireEvent.blur(field);
        await screen.findByRole('button', {
          name: translate(lang, 'settingsSaveReview', { status: text('settingsSaveFailed') }),
        });
        const trigger =
          action === 'detect'
            ? page.getByRole('button', { name: text('detect') })
            : page.getAllByRole('button', { name: text('select') })[action === 'logs' ? 0 : 1]!;
        fireEvent.click(trigger);
        fireEvent.click(trigger);
        expect(
          native.calls.filter(
            (call) =>
              call.method === (action === 'detect' ? 'directory.detect' : 'directory.select'),
          ),
        ).toHaveLength(1);
        const review = await reviewSettingsFailure(lang);
        fireEvent.click(review.getByRole('button', { name: text('settingsDiscard') }));
        await waitFor(() =>
          expect(field.value).toBe(action === 'decks' ? original.decksDir : original.logDir),
        );
        await act(async () => pending.resolve('G:\\LateResult'));
        expect(field.value).toBe(action === 'decks' ? original.decksDir : original.logDir);
        expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
        expect(trigger.getAttribute('aria-busy')).toBe('false');
      });
    }
    for (const kind of ['logs', 'decks'] as const) {
      it(`keeps a manual ${kind} edit when an older picker fails in ${lang}`, async () => {
        const pending = deferred<string>();
        const native = nativeFixture(initial(), { 'directory.select': () => pending.promise });
        const page = await open(native);
        fireEvent.click(
          page.getAllByRole('button', { name: text('select') })[kind === 'logs' ? 0 : 1]!,
        );
        const field = page.getByRole('textbox', {
          name: text(kind === 'logs' ? 'logDirectory' : 'decksDirectory'),
        }) as HTMLInputElement;
        fireEvent.change(field, { target: { value: 'G:\\Manual' } });
        await act(async () => pending.reject(new Error('Obsolete picker failure')));
        expect(page.queryByText('Error: Obsolete picker failure')).toBeNull();
        fireEvent.blur(field);
        await waitFor(() =>
          expect(native.backend.config[kind === 'logs' ? 'logDir' : 'decksDir']).toBe('G:\\Manual'),
        );
      });
      it(`ignores a late ${kind} picker after leaving settings in ${lang}`, async () => {
        const pending = deferred<string>();
        const native = nativeFixture(initial(), { 'directory.select': () => pending.promise });
        const page = await open(native);
        const original = { ...native.backend.config };
        fireEvent.click(
          page.getAllByRole('button', { name: text('select') })[kind === 'logs' ? 0 : 1]!,
        );
        fireEvent.click(screen.getByRole('button', { name: text('settingsBack') }));
        await waitFor(() =>
          expect(screen.queryByRole('main', { name: text('settings') })).toBeNull(),
        );
        await act(async () => pending.resolve('G:\\LateSelection'));
        expect(native.backend.config.logDir).toBe(original.logDir);
        expect(native.backend.config.decksDir).toBe(original.decksDir);
        expect(native.calls.filter((call) => call.method === 'config.update')).toEqual([]);
      });
    }
    it(`lets detection supersede a pending log picker in ${lang}`, async () => {
      const pending = deferred<string>();
      const native = nativeFixture(initial(), {
        'directory.select': () => pending.promise,
        'directory.detect': () => 'G:\\Newest\\GameLogs',
      });
      const page = await open(native);
      fireEvent.click(page.getAllByRole('button', { name: text('select') })[0]!);
      fireEvent.click(page.getByRole('button', { name: text('detect') }));
      await waitFor(() => expect(native.backend.config.logDir).toBe('G:\\Newest\\GameLogs'));
      await act(async () => pending.resolve('G:\\OldPicker'));
      expect(native.backend.config.logDir).toBe('G:\\Newest\\GameLogs');
      expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
    });
    for (const found of [true, false]) {
      it(`separates an automatic deck candidate (${found}) from editable settings in ${lang}`, async () => {
        const value = initial();
        value.config.decksDir = '';
        const candidate = 'G:\\Automatic\\Decks';
        const native = nativeFixture(value, {
          'decks.list': () => ({
            found,
            decksDir: candidate,
            backupsDir: '',
            decks: [],
            backups: [],
          }),
        });
        const page = await open(native);
        const input = page.getByRole('textbox', {
          name: text('decksDirectory'),
        }) as HTMLInputElement;
        await page.findByText(text(found ? 'decksAutomaticFound' : 'decksAutomaticMissing'));
        expect(input.value).toBe('');
        expect(page.getByText(candidate)).toBeTruthy();
        expect(input.getAttribute('aria-describedby')).toBe(
          'settings-decks-feedback settings-decks-hint',
        );
        fireEvent.change(input, { target: { value: 'G:\\Replacement\\Decks' } });
        fireEvent.blur(input);
        await waitFor(() => expect(native.backend.config.decksDir).toBe('G:\\Replacement\\Decks'));
        expect(page.queryByText(candidate)).toBeNull();
        fireEvent.change(input, { target: { value: '' } });
        expect(input.value).toBe('');
        fireEvent.blur(input);
        await waitFor(() => expect(native.backend.config.decksDir).toBe(''));
        await page.findByText(text(found ? 'decksAutomaticFound' : 'decksAutomaticMissing'));
        expect(input.value).toBe('');
      });
    }
  }
  it('invalidates field suggestions synchronously when discard must await an active save', async () => {
    const pending = deferred<RpcOutputs['config.update']>();
    const value = bootstrapForApp();
    value.config.themeMode = 'light';
    const native = nativeFixture(value, { 'config.update': () => pending.promise });
    const { result } = renderHook(() => useSettingsAutosave(native.api, native.backend.config));
    const logLookup = result.current.capture('logDir');
    act(() => result.current.change({ themeMode: 'dark' }));
    expect(result.current.status).toBe('saving');
    expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
    expect(logLookup()).toBe(true);
    let discarded!: Promise<void>;
    act(() => {
      discarded = result.current.discard();
    });
    expect(logLookup()).toBe(false);
    await act(async () => {
      pending.resolve({ ...native.backend.config, themeMode: 'dark' });
      await discarded;
    });
    expect(result.current.status).toBe('saved');
    expect(result.current.draft?.logDir).toBe(native.backend.config.logDir);
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
      native.emit({
        type: 'bans',
        list: [bannedPlayer()],
        newly: [bannedPlayer()],
        alerts: [{ id: 'batch-alpha', createdAt: 1, players: [bannedPlayer()] }],
        revision: 9,
      });
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
      native.emit({
        type: 'bans',
        list: [bannedPlayer()],
        newly: [bannedPlayer()],
        alerts: [{ id: 'batch-alpha', createdAt: 1, players: [bannedPlayer()] }],
        revision: 1,
      }),
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
  for (const lang of ['zh', 'en'] as const) {
    for (const outcome of ['success', 'failure', 'hidden'] as const) {
      it(`restores meaningful development focus after a held ${outcome} scene change in ${lang}`, async () => {
        const bootstrap = bootstrapForApp();
        bootstrap.config.lang = lang;
        const pending = deferred<Bootstrap>();
        let reads = 0;
        const native = nativeFixture(bootstrap, {
          'app.bootstrap': () => (++reads === 1 ? bootstrap : pending.promise),
        });
        render(<DevelopmentApp api={native.api} />);
        const layer = document.querySelector('[data-development-layer]')!.shadowRoot!;
        const tools = within(layer.querySelector<HTMLElement>('.development-tools-theme')!);
        const text = (key: string) => translate(lang, key);
        const launcher = await tools.findByRole('button', { name: text('devTools') });
        fireEvent.click(launcher);
        const selected = await tools.findByRole('radio', { name: text('devMode.captured') });
        const requested = tools.getByRole('radio', { name: text('devMode.demo') });
        requested.focus();
        fireEvent.click(requested);
        await waitFor(() => expect(requested.hasAttribute('disabled')).toBe(true));
        if (outcome === 'hidden') {
          const hide = tools.getByRole('button', { name: text('devHideTools') });
          expect(layer.getElementById(hide.getAttribute('aria-describedby')!)?.textContent).toBe(
            text('devHideToolsHint'),
          );
          fireEvent.click(hide);
        }
        await act(async () =>
          outcome === 'failure'
            ? pending.reject(new Error('Controlled scene failure'))
            : pending.resolve(bootstrap),
        );
        if (outcome === 'hidden') {
          await waitFor(() => expect(document.activeElement?.id).toBe('main-content'));
          expect(layer.querySelector('[data-dev-tools]')).toBeNull();
        } else {
          await waitFor(() => expect(requested.hasAttribute('disabled')).toBe(false));
          const expected = outcome === 'failure' ? selected : requested;
          await waitFor(() => expect(layer.activeElement).toBe(expected));
          expect(expected.getAttribute('aria-checked')).toBe('true');
          if (outcome === 'failure') {
            expect(tools.getByRole('alert').textContent).toContain('Controlled scene failure');
            expect(reads).toBe(2);
          }
        }
      });
    }
  }
  it.each(['current', 'radar'] as const)(
    'shows pre-match party teammates and their stats on the %s page from development tools',
    async (page) => {
      history.replaceState(null, '', `#${page}`);
      const bootstrap = bootstrapForApp();
      bootstrap.config.panelOrder = [page];
      const native = nativeFixture(bootstrap);
      render(<DevelopmentApp api={native.api} />);
      const tools = within(
        document
          .querySelector('[data-development-layer]')!
          .shadowRoot!.querySelector<HTMLElement>('.development-tools-theme')!,
      );
      fireEvent.click(tools.getByRole('button', { name: '开发工具' }));
      const lobby = within(await tools.findByRole('radiogroup', { name: '组队大厅人数' }));
      expect(lobby.getByRole('radio', { name: '1' }).hasAttribute('disabled')).toBe(true);
      fireEvent.click(tools.getByRole('radio', { name: '模拟数据' }));
      await waitFor(() =>
        expect(lobby.getByRole('radio', { name: '1' }).hasAttribute('disabled')).toBe(false),
      );
      for (const count of [1, 2, 3, 4, 5, 2, 5]) {
        const option = lobby.getByRole('radio', { name: String(count) });
        fireEvent.click(option);
        await waitFor(() =>
          expect(
            document.querySelectorAll(`.page-${page} .player-card[data-player-active="true"]`),
          ).toHaveLength(count),
        );
        expect(option.getAttribute('aria-checked')).toBe('true');
        const roster = document.querySelector<HTMLElement>(`.page-${page} .session-roster`)!;
        expect(within(roster).getByRole('heading', { name: '组队大厅' })).toBeTruthy();
        expect(within(roster).getByRole('heading', { name: /^Alpha/ })).toBeTruthy();
        expect(within(roster).getByText('等待开局')).toBeTruthy();
        expect(within(roster).queryByRole('heading', { name: 'Dam' })).toBeNull();
        expect(within(roster).queryByText('Armored.deck')).toBeNull();
        expect(roster.querySelectorAll('.team-column')).toHaveLength(1);
        expect(
          roster.querySelectorAll('.team-0 .player-card[data-player-active="true"]'),
        ).toHaveLength(count);
        expect(roster.querySelector('.team-1, .team-100, .team-null, .match-id')).toBeNull();
        const localCard = within(roster)
          .getByRole('button', { name: (name) => name.startsWith('Raven · #') })
          .closest('.player-card')!;
        expect(localCard.querySelector('.player-analysis')?.textContent).toContain('58%');
        expect(localCard.querySelector('.player-rating')?.textContent).toContain(
          formatMetric(1520, 0),
        );
      }
      fireEvent.click(lobby.getByRole('radio', { name: '5v5' }));
      await waitFor(() =>
        expect(document.querySelectorAll(`.page-${page} .player-card`)).toHaveLength(10),
      );
      expect(screen.getByRole('heading', { name: 'Dam' })).toBeTruthy();
      expect(document.querySelectorAll(`.page-${page} .team-0 .player-card`)).toHaveLength(5);
      expect(document.querySelectorAll(`.page-${page} .team-1 .player-card`)).toHaveLength(5);
      expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(0);
      if (page === 'current') {
        const toolsCard = document.querySelector<HTMLElement>('.quick-tools')!;
        expect(within(toolsCard).queryByRole('heading', { name: '快捷工具' })).toBeNull();
        expect(within(toolsCard).getByRole('button', { name: /玩家查询/ })).toBeTruthy();
      }
    },
  );

  it.each(['current', 'radar'] as const)(
    'opens player details with pointer and keyboard from the %s roster',
    async (page) => {
      history.replaceState(null, '', `#${page}`);
      const bootstrap = bootstrapForApp();
      bootstrap.config.panelOrder = ['current', 'radar'];
      const native = nativeFixture(bootstrap);
      const user = userEvent.setup();
      render(<App />, { wrapper: wrapper(native.api) });

      for (const [player, key] of [
        [localPlayer, null],
        [secondPlayer, '{Enter}'],
        [localPlayer, ' '],
      ] as const) {
        const trigger = await screen.findByRole('button', { name: rosterActionName(player) });
        if (key) {
          act(() => trigger.focus());
          await user.keyboard(key);
        } else {
          await user.click(trigger);
        }
        const dialog = await screen.findByRole('dialog', { name: new RegExp(`#${player.id}$`) });
        await within(dialog).findByRole('heading', { name: '玩家概览' });
        expect(native.calls).toContainEqual({
          method: 'players.profile',
          input: {
            id: player.id,
            force: false,
            accountId: bootstrap.session.localPlayerId,
            combined: bootstrap.config.multiAccountBond,
          },
        });
        await user.click(within(dialog).getByRole('button', { name: '关闭' }));
        await waitFor(() => expect(document.querySelector('.profile-dialog')).toBeNull());
      }
      expect(document.querySelector('button button')).toBeNull();
    },
  );

  it('highlights the saved local player when the current session has no login identity', async () => {
    const bootstrap = bootstrapForApp();
    const match = matchFixture({ localPlayerId: localPlayer.id });
    bootstrap.session.localPlayerId = null;
    bootstrap.session.localName = '';
    bootstrap.session.current = match;
    const native = nativeFixture(bootstrap);
    render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
    const name = await screen.findByRole('button', { name: rosterActionName(localPlayer) });
    const card = name.closest('.player-card') as HTMLElement;
    expect(card.getAttribute('data-variant')).toBe('muted');
    expect(within(card).queryByText('你')).toBeNull();
    expect(screen.getByText('我方队伍')).toBeTruthy();
  });

  it('supports partial, full, and keyboard deck selection through the same checkbox controls', async () => {
    const native = nativeFixture(bootstrapForApp(), {
      'decks.list': () => ({
        found: true,
        decksDir: 'test-profile/Decks',
        backupsDir: 'test-profile/Backups',
        decks: [
          { name: 'Armored.deck', size: 8200, modifiedAt: 1 },
          { name: 'Airborne.deck', size: 6400, modifiedAt: 1 },
        ],
        backups: [],
      }),
    });
    render(<DecksPanel />, { wrapper: wrapper(native.api) });
    await screen.findByRole('checkbox', { name: 'Armored.deck' });
    const files = within(screen.getByRole('group', { name: '当前卡组' }));
    const user = userEvent.setup();
    const all = files.getByRole('checkbox', { name: '全选' });
    const first = files.getByRole('checkbox', { name: 'Armored.deck' });
    const second = files.getByRole('checkbox', { name: 'Airborne.deck' });
    await user.click(first);
    expect(all.getAttribute('aria-checked')).toBe('mixed');
    await user.click(all);
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(second.getAttribute('aria-checked')).toBe('true');
    await user.click(all);
    expect(first.getAttribute('aria-checked')).toBe('false');
    expect(second.getAttribute('aria-checked')).toBe('false');
    document.getElementById('front-decks')!.focus();
    await user.keyboard('{Control>}a{/Control}');
    expect(all.getAttribute('aria-checked')).toBe('true');
  });

  it.each(['zh', 'en'] as const)(
    'preserves the submitted backup name and prevents dismissal while saving in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      const pending = deferred<RpcOutputs['decks.backup']>();
      const native = nativeFixture(bootstrap, {
        'decks.list': () => ({
          found: true,
          decksDir: 'test-profile/Decks',
          backupsDir: 'test-profile/Backups',
          decks: [{ name: 'Alpha.dek', size: 1, modifiedAt: 1 }],
          backups: [],
        }),
        'decks.backup': () => pending.promise,
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const t = (key: string) => translate(locale, key);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: t('backupAll') }));
      const modal = screen.getByRole('dialog', { name: t('backupAll') });
      const dialog = within(modal);
      expect(dialog.getByRole('list', { name: t('backupContents') }).textContent).toBe('Alpha.dek');
      const input = dialog.getByRole('textbox', { name: t('packageName') }) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'reviewed-backup');
      await user.click(dialog.getByRole('button', { name: t('save') }));
      expect(input.disabled).toBe(true);
      expect(dialog.getByRole('button', { name: t('cancel') }).hasAttribute('disabled')).toBe(true);
      expect(dialog.queryByRole('button', { name: t('close') })).toBeNull();
      expect(dialog.getByRole('status').textContent).toBe(t('backupSaving'));
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: t('backupAll') })).toBe(modal);
      expect(native.calls.filter((call) => call.method === 'decks.backup')).toEqual([
        {
          method: 'decks.backup',
          input: {
            names: ['Alpha.dek'],
            packageName: 'reviewed-backup',
            directory: 'test-profile/Decks',
          },
        },
      ]);
      await act(async () => pending.resolve({ name: 'reviewed-backup.zip' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
  );

  it.each(['zh', 'en'] as const)(
    'keeps backup validation and collision feedback associated with the name in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      let attempts = 0;
      const base = 'decks-' + new Date().toISOString().slice(0, 10);
      const native = nativeFixture(bootstrap, {
        'decks.list': () => ({
          found: true,
          decksDir: 'test-profile/Decks',
          backupsDir: 'test-profile/Backups',
          decks: [{ name: 'Alpha.dek', size: 1, modifiedAt: 1 }],
          backups: [{ name: base.toUpperCase() + '.ZIP', size: 1, modifiedAt: 1 }],
        }),
        'decks.backup': ({ packageName }) => {
          if (++attempts === 1) throw new Error('DECK_BACKUP_EXISTS');
          return { name: packageName + '.zip' };
        },
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const t = (key: string) => translate(locale, key);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('checkbox', { name: 'Alpha.dek' }));
      await user.click(screen.getByRole('button', { name: t('backupSelected') }));
      const dialog = within(screen.getByRole('dialog', { name: t('backupSelected') }));
      const input = dialog.getByRole('textbox', { name: t('packageName') }) as HTMLInputElement;
      expect(input.value).toBe(base + '-2');
      await user.clear(input);
      await user.type(input, 'CON');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
        t('backupNameInvalid'),
      );
      expect(dialog.getByRole('button', { name: t('save') }).hasAttribute('disabled')).toBe(true);
      expect(attempts).toBe(0);
      await user.clear(input);
      await user.type(input, 'collision');
      await user.click(dialog.getByRole('button', { name: t('save') }));
      await dialog.findByText(t('backupNameExists'));
      expect(input.value).toBe('collision');
      expect(input.disabled).toBe(false);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
        t('backupNameExists'),
      );
      expect(dialog.getByText('Alpha.dek')).toBeTruthy();
      await user.clear(input);
      await user.type(input, 'recovered');
      expect(input.getAttribute('aria-invalid')).toBe('false');
      await user.click(dialog.getByRole('button', { name: t('save') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(
        native.calls.filter((call) => call.method === 'decks.backup').map((call) => call.input),
      ).toEqual([
        { names: ['Alpha.dek'], packageName: 'collision', directory: 'test-profile/Decks' },
        { names: ['Alpha.dek'], packageName: 'recovered', directory: 'test-profile/Decks' },
      ]);
    },
  );

  it.each(['zh', 'en'] as const)(
    'reconciles a partial deck deletion and exposes a safe remaining-file retry in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      let names = ['Alpha.dek', 'Bravo.dek'];
      let attempts = 0;
      const native = nativeFixture(bootstrap, {
        'decks.list': () => ({
          found: true,
          decksDir: 'A',
          backupsDir: 'Backups',
          decks: names.map((name) => ({ name, size: 1, modifiedAt: 1 })),
          backups: [],
        }),
        'decks.delete': ({ names: selected }) => {
          if (++attempts === 1) {
            names = ['Bravo.dek'];
            return {
              removed: 1,
              completed: ['Alpha.dek'],
              failed: [{ name: 'Bravo.dek', message: 'File is busy' }],
              skipped: [],
            };
          }
          expect(selected).toEqual(['Bravo.dek']);
          names = [];
          return { removed: 1, completed: ['Bravo.dek'], failed: [], skipped: [] };
        },
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const t = (key: string) => translate(locale, key);
      const user = userEvent.setup();
      await screen.findByRole('checkbox', { name: 'Alpha.dek' });
      const current = within(
        (await screen.findByRole('group', { name: t('frontDecks') })).closest('section')!,
      );
      await user.click(current.getByRole('checkbox', { name: t('selectAll') }));
      await user.click(current.getByRole('button', { name: t('delete') }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: t('delete') }),
      );
      await waitFor(() =>
        expect(current.queryByRole('checkbox', { name: 'Alpha.dek' })).toBeNull(),
      );
      expect(
        current.getByRole('checkbox', { name: 'Bravo.dek' }).getAttribute('aria-checked'),
      ).toBe('true');
      const result = screen.getByRole('alert');
      expect(result.textContent).toContain('Alpha.dek');
      expect(result.textContent).toContain('Bravo.dek');
      expect(result.textContent).toContain('File is busy');
      await user.click(current.getByRole('button', { name: t('delete') }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: t('delete') }),
      );
      await waitFor(() =>
        expect(current.queryByRole('checkbox', { name: 'Bravo.dek' })).toBeNull(),
      );
      expect(current.getByRole('button', { name: t('delete') }).hasAttribute('disabled')).toBe(
        true,
      );
    },
  );

  it.each(['zh', 'en'] as const)(
    'preserves unrelated deck selections and disables unavailable folder actions in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      const pending = deferred<null>();
      const native = nativeFixture(bootstrap, {
        'decks.list': () => ({
          found: true,
          decksDir: 'A',
          backupsDir: 'Backups',
          decks: [{ name: 'Alpha.dek', size: 1, modifiedAt: 1 }],
          backups: [{ name: 'Snapshot.zip', size: 1, modifiedAt: 1 }],
        }),
        'decks.open': () => pending.promise,
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const t = (key: string) => translate(locale, key);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('checkbox', { name: 'Alpha.dek' }));
      await user.click(screen.getByRole('checkbox', { name: 'Snapshot.zip' }));
      const folders = screen.getAllByRole('button', { name: t('folder') });
      await user.click(folders[0]!);
      expect(folders.every((button) => button.hasAttribute('disabled'))).toBe(true);
      expect(screen.getByRole('checkbox', { name: 'Alpha.dek' }).hasAttribute('disabled')).toBe(
        true,
      );
      await act(async () => pending.resolve(null));
      await waitFor(() => expect(folders[0]!.hasAttribute('disabled')).toBe(false));
      expect(screen.getByRole('checkbox', { name: 'Alpha.dek' }).getAttribute('aria-checked')).toBe(
        'true',
      );
      expect(
        screen.getByRole('checkbox', { name: 'Snapshot.zip' }).getAttribute('aria-checked'),
      ).toBe('true');
    },
  );

  it.each(['zh', 'en'] as const)(
    'retains the reviewed directory during an open delete confirmation in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      bootstrap.config.decksDir = 'A';
      let directory = 'A';
      const native = nativeFixture(bootstrap, {
        'decks.list': () => ({
          found: true,
          decksDir: directory,
          backupsDir: directory + '/Backups',
          decks: [{ name: 'Shared.dek', size: 1, modifiedAt: 1 }],
          backups: [],
        }),
        'decks.delete': ({ directory: intended }) => {
          expect(intended).toBe('A');
          throw new Error('DECK_DIRECTORY_CHANGED');
        },
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const t = (key: string) => translate(locale, key);
      const user = userEvent.setup();
      const current = within(
        (await screen.findByRole('checkbox', { name: 'Shared.dek' })).closest('section')!,
      );
      await user.click(current.getByRole('checkbox', { name: 'Shared.dek' }));
      await user.click(current.getByRole('button', { name: t('delete') }));
      const confirmation = screen.getByRole('alertdialog');
      expect(confirmation.textContent).toContain('A');
      directory = 'B';
      act(() =>
        native.emit({
          type: 'config',
          revision: 1,
          config: { ...bootstrap.config, decksDir: 'B' },
        }),
      );
      await user.click(within(confirmation).getByRole('button', { name: t('delete') }));
      await screen.findByText(t('DECK_DIRECTORY_CHANGED'), { selector: '[role="alert"] span' });
      await waitFor(() =>
        expect(
          screen.getByRole('checkbox', { name: 'Shared.dek' }).getAttribute('aria-checked'),
        ).toBe('false'),
      );
    },
  );

  it.each(['zh', 'en'] as const)(
    'reviews restore conflicts and retains partial outcomes and recovery information in %s',
    async (locale) => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = locale;
      const deploy = vi.fn<Handler<'decks.deploy'>>(() => ({
        deployed: 1,
        completed: ['Alpha.dek'],
        failed: [{ name: 'Bravo.dek', message: 'Disk is busy' }],
        skipped: ['Charlie.dek'],
        recoveryBackup: 'recovery.zip',
      }));
      const native = nativeFixture(bootstrap, {
        'decks.list': () => ({
          found: true,
          decksDir: 'A',
          backupsDir: 'Backups',
          decks: [{ name: 'Alpha.dek', size: 1, modifiedAt: 1 }],
          backups: [{ name: 'Snapshot.zip', size: 1, modifiedAt: 1 }],
        }),
        'decks.planRestore': () => ({
          token: 'reviewed',
          directory: 'A',
          name: 'Snapshot.zip',
          files: ['Alpha.dek', 'Bravo.dek', 'Charlie.dek'],
          replacements: ['Alpha.dek'],
        }),
        'decks.deploy': deploy,
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const t = (key: string) => translate(locale, key);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('checkbox', { name: 'Snapshot.zip' }));
      await user.click(screen.getByRole('button', { name: t('deploy') }));
      let confirmation = await screen.findByRole('alertdialog');
      expect(confirmation.textContent).toContain(t('deckRestoreReplacements'));
      expect(confirmation.textContent).toContain('Alpha.dek');
      expect(confirmation.textContent).toContain(t('deckRestoreRecoveryHint'));
      const description = confirmation
        .getAttribute('aria-describedby')!
        .split(/\s+/)
        .map((id) => {
          const node = document.getElementById(id);
          expect(node, `Missing description ${id}: ${confirmation.outerHTML}`).not.toBeNull();
          return node!.textContent;
        })
        .join(' ');
      expect(description).toContain('Snapshot.zip');
      expect(description).toContain('Alpha.dek');
      expect(
        within(confirmation).getByRole('region', { name: t('confirmation.details') }).tabIndex,
      ).toBe(0);
      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(document.activeElement).toBe(
        within(confirmation).getByRole('region', { name: t('confirmation.details') }),
      );
      await user.click(within(confirmation).getByRole('button', { name: t('cancel') }));
      expect(deploy).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: t('deploy') }).hasAttribute('disabled')).toBe(
          false,
        ),
      );
      await user.click(screen.getByRole('button', { name: t('deploy') }));
      confirmation = await screen.findByRole('alertdialog');
      await user.click(within(confirmation).getByRole('button', { name: t('deploy') }));
      const result = await screen.findByRole('alert');
      expect(result.textContent).toContain('Alpha.dek');
      expect(result.textContent).toContain('Bravo.dek');
      expect(result.textContent).toContain('Charlie.dek');
      expect(result.textContent).toContain('recovery.zip');
      expect(deploy).toHaveBeenCalledWith({ token: 'reviewed' });
    },
  );

  it('closes narrow-screen navigation without changing the desktop collapse preference', async () => {
    vi.stubGlobal('innerWidth', 375);
    const native = nativeFixture(bootstrapForApp());
    render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '打开导航' }));
    const dialog = await screen.findByRole('dialog', { name: translate('zh', 'workspaceNav') });
    expect(dialog.id).toBe('workspace-sidebar');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭导航' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(native.backend.config.sidebarCollapsed).toBe(false);
    expect(native.calls.filter((call) => call.method === 'config.update')).toEqual([]);
  });

  it('retains a valid match draft after service failure and retries without dismissing a pending save', async () => {
    const pending = deferred<RpcOutputs['matches.add']>();
    let attempts = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'matches.add': () => {
        if (++attempts === 1) throw new Error('Match temporarily unavailable');
        return pending.promise;
      },
    });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    const addLabel = translate('zh', 'addMatch');
    fireEvent.click(await screen.findByRole('button', { name: addLabel }));
    const modal = screen.getByRole('dialog', { name: addLabel });
    const dialog = within(modal);
    const input = dialog.getByRole('textbox', { name: '对局 ID' }) as HTMLInputElement;
    const submit = dialog.getByRole('button', { name: addLabel });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: 'invalid' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(dialog.getByRole('alert').textContent).toBe(translate('zh', 'matchIdInvalid'));
    expect(input.getAttribute('aria-describedby')).toBe(dialog.getByRole('alert').id);
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(input, { target: { value: ' 9227650 ' } });
    fireEvent.click(submit);
    await dialog.findByText('Error: Match temporarily unavailable');
    expect(input.value).toBe(' 9227650 ');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('match-id-hint');
    fireEvent.click(submit);
    expect(dialog.queryByRole('alert')).toBeNull();
    expect(input.disabled).toBe(true);
    expect(dialog.queryByRole('button', { name: '关闭' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: addLabel })).toBe(modal);
    expect(
      native.calls.filter((call) => call.method === 'matches.add').map((call) => call.input),
    ).toEqual([{ fid: '9227650' }, { fid: '9227650' }]);
    await act(async () => pending.resolve(matchFixture({ fid: '9227650' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adds a match from the archive dialog and refreshes the list after saving', async () => {
    const user = userEvent.setup();
    let saved: ReturnType<typeof matchFixture> | null = null;
    const native = nativeFixture(bootstrapForApp(), {
      'matches.list': () => (saved ? [saved] : []),
      'matches.add': ({ fid }) => {
        saved = matchFixture({ id: 'added-match', fid, map: 'Added match' });
        return saved;
      },
    });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    await user.click(await screen.findByRole('button', { name: translate('zh', 'addMatch') }));
    const dialog = within(screen.getByRole('dialog', { name: translate('zh', 'addMatch') }));
    const submit = dialog.getByRole('button', { name: translate('zh', 'addMatch') });
    expect(submit.hasAttribute('disabled')).toBe(true);
    const input = dialog.getByRole('textbox', { name: translate('zh', 'matchId') });
    await user.type(input, 'abc');
    expect(submit.hasAttribute('disabled')).toBe(true);
    await user.clear(input);
    await user.type(input, '9227650');
    await user.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Added match' })).toBeTruthy();
    expect(native.calls.filter((call) => call.method === 'matches.add')).toEqual([
      { method: 'matches.add', input: { fid: '9227650' } },
    ]);
  });

  it('filters the full local ban snapshot without another request or unrelated retained rows', async () => {
    const rows = [
      bannedPlayer(),
      { ...bannedPlayer(), id: '9001', name: 'Unmet player', encountered: false },
    ];
    const native = nativeFixture(bootstrapForApp(), {
      'bans.list': () => rows,
    });
    render(<BansPanel />, { wrapper: wrapper(native.api) });
    await screen.findByRole('button', { name: 'Unmet player #9001' });
    const list = screen.getByRole('table', { name: '封禁追踪' });
    const viewport = list.closest<HTMLElement>('[aria-busy]')!;
    fireEvent.click(screen.getByRole('radio', { name: '我遇到过的作弊者' }));
    expect(viewport.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('table', { name: '封禁追踪' })).toBe(list);
    expect(within(list).getAllByRole('row').slice(1)).toHaveLength(1);
    expect(native.calls.filter((call) => call.method === 'bans.list')).toEqual([
      { method: 'bans.list', input: { metOnly: false } },
    ]);
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
    const filter = screen.getByRole('radio', { name: '我遇到过的作弊者' });
    expect(filter.getAttribute('aria-checked')).toBe('false');
    const list = screen.getByRole('table', { name: '封禁追踪' });
    expect(within(list).getAllByRole('row').slice(1)).toHaveLength(20);
    expect(
      screen.getByRole('link', { name: '上一页' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    fireEvent.scroll(list.closest('.ban-list-paged')!, { target: { scrollTop: 150 } });
    fireEvent.click(screen.getByRole('link', { name: '下一页' }));
    expect(list.closest('.ban-list-paged')!.scrollTop).toBe(0);
    expect(screen.getByRole('button', { name: 'Banned player 20 #9020' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Banned player 0 #9000' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '第 3 页' }));
    expect(within(list).getAllByRole('row').slice(1)).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Banned player 44 #9044' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '下一页' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    fireEvent.click(filter);
    expect(filter.getAttribute('aria-checked')).toBe('true');
    await screen.findByRole('button', { name: 'Banned player 0 #9000' });
    expect(within(list).getAllByRole('row').slice(1)).toHaveLength(3);
    expect(screen.queryByRole('navigation', { name: '封禁追踪' })).toBeNull();
    filter.focus();
    fireEvent.click(screen.getByRole('radio', { name: translate('zh', 'allBans') }));
    expect(filter.getAttribute('aria-checked')).toBe('false');
    await screen.findByText('第 1–20 条，共 45 条');
    fireEvent.click(screen.getByRole('link', { name: '第 3 页' }));
    rows = rows.slice(0, 25);
    fireEvent.click(screen.getByRole('button', { name: '同步' }));
    const apply = screen.getByRole('button', { name: /^查看更新/ });
    await waitFor(() => expect(apply.getAttribute('aria-disabled')).toBe('false'));
    expect(screen.getByText('第 41–45 条，共 45 条')).toBeTruthy();
    fireEvent.click(apply);
    await screen.findByText('第 1–20 条，共 25 条');
    fireEvent.click(screen.getByRole('link', { name: '第 2 页' }));
    await screen.findByText('第 21–25 条，共 25 条');
    expect(screen.getByRole('button', { name: 'Banned player 24 #9024' })).toBeTruthy();
    expect(within(list).getAllByRole('row').slice(1)).toHaveLength(5);
    expect(screen.getByRole('link', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page');
  });

  it('preserves archive sorting and pagination when switching views without reloading matches', async () => {
    const rows = Array.from({ length: 55 }, (_, index) =>
      matchFixture({
        id: `grid-${index}`,
        map: `Grid map ${index}`,
        endedAt: 1_700_000_000_000 + 55 - index,
        eloBefore: 1500,
        eloAfter: 1500 + index,
        outcome: index % 2 === 0 ? 'win' : 'loss',
      }),
    );
    const native = nativeFixture(bootstrapForApp(), { 'matches.list': () => rows });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    await screen.findByRole('button', { name: 'Grid map 0' });
    fireEvent.click(screen.getByRole('button', { name: 'ELO 变化' }));
    fireEvent.click(screen.getByRole('link', { name: '下一页' }));
    const gridToggle = screen.getByRole('radio', { name: '网格视图' });
    fireEvent.click(gridToggle);
    const grid = screen.getByRole('list', { name: '对局档案' });
    expect(gridToggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('table', { name: '对局档案' })).toBeNull();
    expect(grid.children).toHaveLength(5);
    expect(grid.children[0]?.textContent).toContain('Grid map 4');
    expect(screen.getByText('第 51–55 条，共 55 条')).toBeTruthy();
    fireEvent.click(gridToggle);
    expect(screen.getByRole('list', { name: '对局档案' })).toBe(grid);
    fireEvent.click(screen.getByRole('radio', { name: '列表视图' }));
    expect(
      within(screen.getByRole('table', { name: '对局档案' })).getAllByRole('row')[1]?.textContent,
    ).toContain('Grid map 4');
    fireEvent.click(gridToggle);
    const currentViewport = screen.getByRole('list', { name: '对局档案' }).parentElement!;
    currentViewport.scrollTop = 150;
    fireEvent.click(screen.getByRole('radio', { name: '胜利' }));
    expect(currentViewport.scrollTop).toBe(0);
    expect(screen.getByText('第 1–28 条，共 28 条')).toBeTruthy();
    expect(native.calls.filter((call) => call.method === 'matches.list')).toHaveLength(1);
    expect(native.calls.filter((call) => call.method === 'matches.detail')).toHaveLength(0);
  });

  it('shows archive team relationships, rating fallbacks and player navigation without querying details', async () => {
    const players = matchFixture()
      .players.slice(0, 4)
      .map((player, index) => ({
        ...player,
        teamId: ([0, 1, 100, null] as const)[index] ?? null,
        newRating: index === 0 ? 2056 : null,
        oldRating: index === 1 ? 1876 : null,
      }));
    const match = matchFixture({ players, localPlayerId: players[1]!.id });
    const native = nativeFixture(bootstrapForApp(), { 'matches.list': () => [match] });
    function ModalProbe() {
      const { modal } = useApp();
      return <output data-testid="archive-modal">{JSON.stringify(modal)}</output>;
    }
    render(
      <>
        <MatchArchive />
        <ModalProbe />
      </>,
      { wrapper: wrapper(native.api) },
    );
    await screen.findByRole('button', { name: match.map });
    fireEvent.click(screen.getByRole('radio', { name: '网格视图' }));
    const grid = within(screen.getByRole('list', { name: '对局档案' }));
    expect(grid.getByText('4 位玩家')).toBeTruthy();
    expect(grid.getByRole('heading', { name: 'Alpha · 对方队伍' })).toBeTruthy();
    expect(grid.getByRole('heading', { name: 'Bravo · 我方队伍' })).toBeTruthy();
    expect(grid.getByRole('heading', { name: '观战' })).toBeTruthy();
    expect(grid.getByRole('heading', { name: '未知' })).toBeTruthy();
    expect(grid.getByText('2,056')).toBeTruthy();
    expect(grid.getByText('1,876')).toBeTruthy();
    expect(grid.getAllByText('—')).toHaveLength(2);
    expect(grid.queryByRole('button', { name: /刷新/ })).toBeNull();
    fireEvent.click(grid.getByRole('button', { name: match.map }));
    expect(JSON.parse(screen.getByTestId('archive-modal').textContent!)).toEqual({
      type: 'match',
      fid: match.fid,
      accountId: match.localPlayerId,
    });
    fireEvent.click(grid.getByRole('button', { name: players[0]!.name }));
    expect(JSON.parse(screen.getByTestId('archive-modal').textContent!)).toEqual({
      type: 'profile',
      id: players[0]!.id,
      name: players[0]!.name,
    });
    expect(native.calls.filter((call) => call.method === 'matches.detail')).toHaveLength(0);
  });

  it('shows ELO changes on archive cards with signed values and neutral missing ratings', async () => {
    const cases = [
      { before: 1500, after: 1520, value: '+20.00', color: 'elo-increase' },
      { before: 1500, after: 1480, value: '-20.00', color: 'elo-decrease' },
      { before: 1500, after: 1500, value: '0.00', color: null },
      { before: null, after: 1520, value: '—', color: null },
      { before: 1500, after: null, value: '—', color: null },
    ];
    const rows = cases.map((entry, index) =>
      matchFixture({
        id: `elo-grid-${index}`,
        fid: String(9500000 + index),
        map: `ELO map ${index}`,
        outcome: 'win',
        eloBefore: entry.before,
        eloAfter: entry.after,
      }),
    );
    const native = nativeFixture(bootstrapForApp(), { 'matches.list': () => rows });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('radio', { name: '网格视图' }));
    await screen.findByRole('button', { name: 'ELO map 0' });
    for (const [index, entry] of cases.entries()) {
      const card = screen
        .getByRole('button', { name: `ELO map ${index}` })
        .closest('.archive-card')!;
      const badge = within(card as HTMLElement).getByLabelText(`ELO 变化: ${entry.value}`);
      expect(badge.textContent).toBe(entry.value);
      expect(badge.firstElementChild?.classList.contains('elo-increase')).toBe(
        entry.color === 'elo-increase',
      );
      expect(badge.firstElementChild?.classList.contains('elo-decrease')).toBe(
        entry.color === 'elo-decrease',
      );
    }
  });

  it('shows archive grid loading, missing rosters and empty filters with a working reset', async () => {
    const pending = deferred<RpcOutputs['matches.list']>();
    const native = nativeFixture(bootstrapForApp(), { 'matches.list': () => pending.promise });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('radio', { name: '网格视图' }));
    const viewport = document.querySelector<HTMLDivElement>('.archive-grid-viewport')!;
    expect(viewport.getAttribute('aria-busy')).toBe('true');
    expect(within(viewport).getByText(translate('zh', 'loading'))).toBeTruthy();
    const match = matchFixture({ fid: null, map: '', players: [], outcome: 'unknown' });
    await act(async () => pending.resolve([match]));
    expect(viewport.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('switch', { name: '隐藏未知结果' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.queryByRole('list', { name: '对局档案' })).toBeNull();
    expect(screen.getByText('第 0–0 条，共 0 条')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('list', { name: '对局档案' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '#' + match.id })).toBeTruthy();
    expect(screen.getByText('暂无玩家数据')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /我方队伍|对方队伍/ })).toBeNull();
    expect(native.calls.filter((call) => call.method === 'matches.list')).toHaveLength(1);
  });

  it('sorts the entire archive, resets the selected page and preserves sortable column semantics', async () => {
    const rows = Array.from({ length: 55 }, (_, index) =>
      matchFixture({
        id: `sorted-${index}`,
        map: `Sorted map ${index}`,
        endedAt: 1_700_000_000_000 + 55 - index,
        eloBefore: 1500,
        eloAfter: 1500 + index,
      }),
    );
    const native = nativeFixture(bootstrapForApp(), { 'matches.list': () => rows });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    await screen.findByRole('button', { name: 'Sorted map 0' });
    fireEvent.click(screen.getByRole('link', { name: '下一页' }));
    await screen.findByRole('button', { name: 'Sorted map 54' });
    const viewport = document.querySelector<HTMLDivElement>('.archive-table')!;
    fireEvent.scroll(viewport, { target: { scrollTop: 180 } });
    const sort = screen.getByRole('button', { name: 'ELO 变化' });
    fireEvent.click(sort);
    expect(screen.getByRole('link', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page');
    expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(
      within(screen.getByRole('table', { name: '对局档案' })).getAllByRole('row')[1]?.textContent,
    ).toContain('Sorted map 54');
    expect(viewport.scrollTop).toBe(0);
    fireEvent.click(sort);
    expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    expect(
      within(screen.getByRole('table', { name: '对局档案' })).getAllByRole('row')[1]?.textContent,
    ).toContain('Sorted map 0');
  });

  it('filters the ban table locally and resets pagination without another service request', async () => {
    const rows = Array.from({ length: 45 }, (_, index) => ({
      ...bannedPlayer(),
      id: String(9000 + index),
      name: `Banned player ${index}`,
    }));
    const native = nativeFixture(bootstrapForApp(), { 'bans.list': () => rows });
    render(<BansPanel />, { wrapper: wrapper(native.api) });
    await screen.findByRole('button', { name: 'Banned player 0 #9000' });
    fireEvent.click(screen.getByRole('link', { name: '第 3 页' }));
    const search = screen.getByRole('searchbox', { name: '筛选名字或 ID' });
    fireEvent.change(search, { target: { value: '9044' } });
    expect(screen.getByRole('button', { name: 'Banned player 44 #9044' })).toBeTruthy();
    expect(
      within(screen.getByRole('table', { name: '封禁追踪' })).getAllByRole('row'),
    ).toHaveLength(2);
    expect(screen.queryByRole('navigation', { name: '封禁追踪' })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('link', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page');
    expect(native.calls.filter((call) => call.method === 'bans.list')).toHaveLength(1);
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
    expect(
      screen.getByRole('link', { name: '上一页' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: '下一页' }));
    expect(screen.getByRole('link', { name: '第 2 页' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Archive map 474' })).toBeTruthy();
    expect(table.scrollTop).toBe(0);
    expect(screen.getByText('第 51–100 条，共 525 条')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '第 11 页' }));
    expect(screen.getByRole('button', { name: 'Archive map 0' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(
      screen.getByRole('link', { name: '下一页' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    expect(screen.getByText('第 501–525 条，共 525 条')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '上一页' }));
    expect(screen.getByRole('link', { name: '第 10 页' }).getAttribute('aria-current')).toBe(
      'page',
    );
    table.scrollTop = 500;
    fireEvent.click(screen.getByRole('radio', { name: '胜利' }));
    expect(table.scrollTop).toBe(0);
    expect(screen.getByRole('link', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('样本数: 263')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '全部结果' }));
    fireEvent.click(screen.getByRole('link', { name: '第 11 页' }));
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByText('样本数: 262')).toBeTruthy());
    expect(screen.getByRole('link', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page');
  });

  it('hides unknown outcomes by default, supports toggling, and resets pagination and filters', async () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, index) =>
        matchFixture({
          id: String(3000 + index),
          map: `Known result ${index}`,
          endedAt: 1_700_000_000_000 + index,
          outcome: index % 2 === 0 ? 'win' : 'loss',
          localPlayerId: '1',
        }),
      ),
      ...Array.from({ length: 50 }, (_, index) =>
        matchFixture({
          id: String(4000 + index),
          map: `Unknown result ${index === 0 ? 'A' : index === 1 ? 'B' : index}`,
          endedAt: 1_700_000_000_200 - index,
          outcome: 'unknown',
          localPlayerId: '2',
        }),
      ),
      matchFixture({
        id: '5000',
        map: 'Spectator result',
        endedAt: 1_700_000_000_201,
        outcome: 'spectator',
        localPlayerId: '1',
      }),
    ];
    const native = nativeFixture(structuredClone(fixtureBootstrap), {
      'matches.list': ({ accountId }) =>
        accountId ? rows.filter((match) => match.localPlayerId === accountId) : rows,
      'accounts.list': () => [
        {
          id: '2',
          name: 'Unknown account',
          persona: '2',
          firstSeen: 0,
          lastSeen: 0,
          matchCount: 50,
        },
      ],
    });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    await screen.findByRole('button', { name: 'Known result 0' });
    const toggle = screen.getByRole('switch', { name: '隐藏未知结果' }) as HTMLInputElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Unknown result A' })).toBeNull();
    expect(screen.getByText('样本数: 13')).toBeTruthy();
    fireEvent.click(toggle);
    await screen.findByRole('button', { name: 'Unknown result A' });
    expect(toggle.getAttribute('aria-checked') === 'true').toBe(false);
    fireEvent.click(screen.getByRole('link', { name: '下一页' }));
    const table = document.querySelector<HTMLDivElement>('.archive-table')!;
    table.scrollTop = 900;
    toggle.focus();
    await userEvent.setup().keyboard(' ');
    expect(toggle.getAttribute('aria-checked') === 'true').toBe(true);
    expect(table.scrollTop).toBe(0);
    expect(screen.getByRole('link', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('样本数: 13')).toBeTruthy();
    const pagination = screen.getByRole('navigation', { name: '对局档案分页' });
    expect(within(pagination).getByText('第 1–13 条，共 13 条')).toBeTruthy();
    expect(
      within(pagination).getByRole('link', { name: '上一页' }).getAttribute('aria-disabled') ===
        'true',
    ).toBe(true);
    expect(
      within(pagination).getByRole('link', { name: '下一页' }).getAttribute('aria-disabled') ===
        'true',
    ).toBe(true);
    expect(within(pagination).queryByRole('combobox', { name: '页码' }) === null).toBe(true);
    expect(within(pagination).getByRole('link', { name: '第 1 页' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unknown result A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unknown result B' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Spectator result' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '胜利' }));
    expect(screen.getByText('样本数: 6')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked') === 'true').toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '全部结果' }));
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: '2' } });
    await screen.findByText('样本数: 0');
    expect(screen.getByRole('navigation', { name: '对局档案分页' })).toBeTruthy();
    expect(screen.getByText('第 0–0 条，共 0 条')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    await screen.findByRole('button', { name: 'Unknown result A' });
    expect(toggle.getAttribute('aria-checked') === 'true').toBe(false);
    expect(screen.getByText('样本数: 63')).toBeTruthy();
    expect(screen.getByRole('link', { name: '第 2 页' })).toBeTruthy();
    expect((screen.getByLabelText('账号') as HTMLSelectElement).value).toBe('');
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
    act(() =>
      native.emit({
        type: 'bans',
        list: [ban],
        newly: [ban],
        alerts: [{ id: 'batch-alpha', createdAt: 1, players: [ban] }],
        revision: 1,
      }),
    );
    const alert = screen.getByRole('dialog', { name: translate('zh', 'banAlert') });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(
      within(alert).getByRole('button', {
        name: translate('zh', 'banAlertsInvestigate', { name: ban.name, id: ban.id }),
      }),
    );
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
    const language = screen.getByRole('combobox', { name: '语言' });
    expect(
      within(language)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(['zh', 'en']);
    fireEvent.change(language, { target: { value: 'en' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: 'Settings' })).toBeNull());
    await screen.findByText('Listening');
    expect(screen.queryByText('Not listening')).toBeNull();
    expect(view.container.querySelector('[data-log-status]')?.getAttribute('data-log-state')).toBe(
      'listening',
    );
    expect(document.documentElement.lang).toBe('en');
    expect(native.backend.config.lang).toBe('en');
    expect(native.backend.watcher.listening).toBe(true);
  });

  it('applies saved panel order and keeps standalone tools visible while preserving overview collapse preferences', async () => {
    const bootstrap = bootstrapForApp();
    bootstrap.config.panelOrder = ['current', 'players', 'decks'];
    bootstrap.config.collapsedPanels = ['decks'];
    const native = nativeFixture(bootstrap, {
      'decks.list': () => ({
        found: true,
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
    const navigation = screen.getByRole('navigation', { name: '工作空间' });
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([translate('zh', 'overview'), '卡组工具', translate('zh', 'players')]);
    fireEvent.click(within(navigation).getByRole('button', { name: '卡组工具' }));
    expect(screen.getByRole('heading', { level: 1, name: '卡组工具' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '卡组工具 展开' })).toBeNull();
    expect(await screen.findByRole('group', { name: '当前卡组' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '备份卡组' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '刷新' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'decks.list')).toHaveLength(2),
    );
    expect(native.backend.config.collapsedPanels).toEqual(['decks']);
    expect(native.backend.config.panelOrder).toEqual(['current', 'decks', 'players']);
  });

  it('saves page visibility in both navigation menus and restores pages in their saved order', async () => {
    const bootstrap = bootstrapForApp();
    bootstrap.config.panelOrder = ['current', 'players', 'decks'];
    const native = nativeFixture(bootstrap);
    const user = userEvent.setup();
    let view = render(<App />, { wrapper: wrapper(native.api) });
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    await screen.findByRole('main', { name: '设置' });
    fireEvent.click(screen.getByRole('tab', { name: '导航' }));
    const players = screen.getByRole('switch', { name: '在导航中显示 玩家查询' });
    players.focus();
    await user.keyboard(' ');
    fireEvent.click(screen.getByRole('switch', { name: '在导航中显示 卡组工具' }));
    fireEvent.click(screen.getByRole('button', { name: '上移 卡组工具' }));
    await waitFor(() => {
      expect(native.backend.config.hiddenPanels).toEqual(['players', 'decks']);
      expect(native.backend.config.panelOrder).toEqual(['current', 'decks', 'players']);
    });
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(
      within(screen.getByRole('navigation', { name: '工作空间' })).getAllByRole('button'),
    ).toHaveLength(1);
    view.unmount();
    vi.stubGlobal('innerWidth', 390);
    view = render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByRole('heading', { name: '对局工作台' });
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    const dialog = within(screen.getByRole('dialog', { name: translate('zh', 'workspaceNav') }));
    const navigation = within(dialog.getByRole('navigation', { name: '工作空间' }));
    expect(navigation.queryByRole('button', { name: '玩家查询' })).toBeNull();
    expect(navigation.queryByRole('button', { name: '卡组工具' })).toBeNull();
    expect(navigation.getByRole('button', { name: '总览' })).toBeTruthy();

    view.unmount();
    vi.stubGlobal('innerWidth', 1024);
    window.history.replaceState(null, '', '#settings/navigation');
    render(<App />, { wrapper: wrapper(native.api) });
    await screen.findByRole('main', { name: '设置' });
    const restoredPlayers = screen.getByRole('switch', {
      name: '在导航中显示 玩家查询',
    });
    expect(restoredPlayers.getAttribute('aria-checked') === 'true').toBe(false);
    fireEvent.click(restoredPlayers);
    fireEvent.click(screen.getByRole('switch', { name: '在导航中显示 卡组工具' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(
      within(screen.getByRole('navigation', { name: '工作空间' }))
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
    const toggle = screen.getByRole('switch', { name: '在导航中显示 总览' });
    expect(toggle.getAttribute('aria-checked') === 'true').toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '设置' })).toBeNull());
    expect(
      within(screen.getByRole('navigation', { name: '工作空间' })).getByRole('button', {
        name: '总览',
      }),
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
    const scroll = document.querySelector<HTMLElement>('.workspace-scroll')!;
    fireEvent.scroll(scroll, { target: { scrollTop: 180 } });
    const navigation = screen.getByRole('navigation', { name: '工作空间' });
    fireEvent.click(screen.getByRole('radio', { name: '失败' }));
    await screen.findByText(
      `样本数: ${capturedMatches.filter((m) => m.outcome === 'loss').length}`,
    );
    fireEvent.click(within(navigation).getByRole('button', { name: '玩家查询' }));
    expect(scroll.scrollTop).toBe(0);
    const search = screen.getByLabelText(translate('zh', 'searchLabel'));
    fireEvent.change(search, { target: { value: localPlayer.name } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const resultName = (name: string) => name.startsWith(`${localPlayer.name} #${localPlayer.id}`);
    const resultRegion = within(
      screen.getByRole('region', { name: translate('zh', 'searchResults') }),
    );
    await resultRegion.findByRole('button', { name: resultName });
    fireEvent.scroll(scroll, { target: { scrollTop: 90 } });
    act(() => {
      window.location.hash = 'archive';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('radio', { name: '失败' }).getAttribute('aria-checked')).toBe('true');
    expect(scroll.scrollTop).toBe(180);
    expect(document.activeElement).toBe(document.getElementById('main-content'));
    fireEvent.click(within(navigation).getByRole('button', { name: '玩家查询' }));
    expect(scroll.scrollTop).toBe(90);
    expect((screen.getByLabelText(translate('zh', 'searchLabel')) as HTMLInputElement).value).toBe(
      localPlayer.name,
    );
    expect(resultRegion.getByRole('button', { name: resultName })).toBeTruthy();
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
    const nav = within(screen.getByRole('navigation', { name: '工作空间' }));
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
    const nav = within(screen.getByRole('navigation', { name: '工作空间' }));
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

  it('shows previous-match score labels and titles on radar and hides them when returning to a live match', async () => {
    const bootstrap = bootstrapForApp();
    const previous = matchFixture({
      id: '987654321',
      fid: '987654321',
      endedAt: 1000,
      titles: {
        [localPlayer.id]: [{ id: 'carry', kind: 'good', params: { d: 6000, l: 1000, net: 5000 } }],
      },
      scoreLabels: {
        [localPlayer.id]: [
          { id: 'destruction', score: 100, threshold: 100 },
          { id: 'damage', score: 98, threshold: 98 },
          { id: 'efficiency', score: 95, threshold: 95 },
        ],
      },
    });
    const native = nativeFixture(bootstrap, {
      'matches.list': () => [previous],
      'matches.detail': () => previous,
      'session.query': ({ requestId }) => ({ requestId, queried: 0, skipped: 0, cancelled: false }),
    });
    render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
    const button = await screen.findByRole('button', { name: '上一局' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(screen.queryByRole('button', { name: '大腿' })).toBeNull();
    expect(screen.queryByRole('button', { name: '击杀王' })).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByRole('button', { name: '击杀王' })).toBeTruthy();
    const playerHeading = screen
      .getByRole('button', { name: rosterActionName(localPlayer) })
      .closest('.player-card')!
      .querySelector('.player-heading')!;
    expect(playerHeading.querySelector('[data-award-source="score"]')?.parentElement).toBe(
      playerHeading,
    );
    expect(document.querySelector('.session-roster .player-avatar')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '大腿' }));
    expect(screen.getByText('本局赢方净交换最高：摧毁 6000 − 损失 1000 = 5000。')).toBeTruthy();
    const back = screen.getByRole('button', { name: '返回当前局' });
    await waitFor(() => expect(back.hasAttribute('disabled')).toBe(false));
    fireEvent.click(back);
    expect(screen.queryByRole('button', { name: '大腿' })).toBeNull();
    expect(screen.queryByRole('button', { name: '击杀王' })).toBeNull();
    expect(document.querySelector('button button')).toBeNull();
  });

  it('copies the match identifier without its display prefix', async () => {
    const bootstrap = bootstrapForApp();
    bootstrap.session.current = matchFixture({ fid: '987654321' });
    const native = nativeFixture(bootstrap);
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    render(<SessionPanel standalone />, { wrapper: wrapper(native.api) });
    const button = await screen.findByRole('button', {
      name: `${translate('zh', 'copy')} ${translate('zh', 'matchId')}: 987654321`,
    });
    await user.click(button);
    expect(copy).toHaveBeenCalledExactlyOnceWith('987654321');
  });

  it('requires explicit confirmation before deleting a match and restores focus after cancellation', async () => {
    const user = userEvent.setup();
    const match = matchFixture();
    const remove = vi.fn(() => ({
      removed: true,
      removedMatches: 1,
      retainedMatches: 0,
      backup: {
        name: 'match-backup.json',
        version: 'a'.repeat(64),
        kind: 'match' as const,
        createdAt: 1,
        target: { id: match.id, name: match.map },
        matchCount: 1,
        restoredAt: null,
      },
    }));
    const native = nativeFixture(bootstrapForApp(), {
      'matches.list': () => [match],
      'matches.delete': remove,
    });
    render(<MatchArchive />, { wrapper: wrapper(native.api) });
    const trigger = await screen.findByRole('button', { name: `操作: #${match.fid || match.id}` });
    const openConfirmation = async () => {
      await user.click(trigger);
      await user.click(await screen.findByRole('menuitem', { name: '删除' }));
      return screen.findByRole('alertdialog', { name: '删除对局记录？' });
    };
    let dialog = await openConfirmation();
    expect(dialog.textContent).toContain(`${match.map} · #${match.fid || match.id}`);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }));
    expect(remove).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(remove).not.toHaveBeenCalled();
    dialog = await openConfirmation();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(remove).not.toHaveBeenCalled();
    dialog = await openConfirmation();
    await user.click(document.querySelector('[data-slot=alert-dialog-overlay]')!);
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledExactlyOnceWith({
        token: '11111111-1111-4111-8111-111111111111',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('preserves match facts and title evidence in the detail dialog without embedding explanations in the table', async () => {
    const match = matchFixture();
    match.titles = matchTitles(match);
    const native = nativeFixture(bootstrapForApp(), { 'matches.detail': () => match });
    render(<MatchDialog fid={match.fid!} />, { wrapper: wrapper(native.api) });
    const map = await screen.findByRole('heading', { name: match.map });
    const dialog = map.closest('[role="dialog"]') as HTMLElement;
    const summary = dialog.querySelector('.match-summary') as HTMLElement;
    expect(within(summary).getByText(match.localPersona)).toBeTruthy();
    expect(within(summary).getByText(formatDuration(match.durationSec))).toBeTruthy();
    expect(within(summary).getByText(formatTime(match.endedAt, 'zh'))).toBeTruthy();
    expect(dialog.querySelectorAll('tbody tr')).toHaveLength(match.players.length);
    const [playerId, titles] = Object.entries(match.titles).find(([, list]) => list.length > 0)!;
    const player = match.players.find((p) => p.id === playerId)!;
    const name = within(dialog).getByRole('button', { name: player.name });
    const heading = name.closest('.match-player-heading') as HTMLElement;
    const title = within(heading).getByRole('button', {
      name: translate('zh', `title.${titles[0]!.id}`),
    });
    fireEvent.click(title);
    const tooltip = explanation();
    expect(tooltip.textContent).not.toMatch(/\{\w+\}/);
    expect(dialog.contains(tooltip)).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(document.querySelector('button button')).toBeNull();
  });

  it('summarizes eligible completed matches for the current account', async () => {
    const win = structuredClone(capturedMatches.find((m) => m.outcome === 'win')!);
    const loss = structuredClone(capturedMatches.find((m) => m.outcome === 'loss')!);
    const restarted = matchFixture({ id: 'restarted', restarted: true });
    const otherAccount = matchFixture({ id: 'other-account', localPlayerId: secondPlayer.id });
    const native = nativeFixture(bootstrapForApp(), {
      'matches.list': ({ accountId }) =>
        [win, loss, restarted, otherAccount].filter(
          (match) => !accountId || match.localPlayerId === accountId,
        ),
    });
    render(
      <AppProvider api={native.api}>
        <App />
      </AppProvider>,
    );
    await screen.findByText('1 胜 · 1 负');
    const metric = screen.getByText('近期胜率').closest('[data-slot="card"]') as HTMLElement;
    expect(within(metric).getByText('50%')).toBeTruthy();
    const rating = screen.getByText('最近 ELO').closest('[data-slot="card"]') as HTMLElement;
    expect(within(rating).getByText(formatMetric(win.eloAfter, 0))).toBeTruthy();
    const archive = screen.getByText('已收录对局').closest('[data-slot="card"]') as HTMLElement;
    expect(within(archive).getByText('4')).toBeTruthy();
  });

  it('keeps the initial empty room height after showing a taller previous-match roster', async () => {
    const bootstrap = structuredClone(fixtureBootstrap);
    bootstrap.session.phase = 'idle';
    bootstrap.session.current = null;
    bootstrap.session.lobbyPlayers = [];
    const previous = matchFixture();
    const native = nativeFixture(bootstrap, {
      'matches.list': () => [previous],
      'matches.detail': () => previous,
      'session.query': ({ requestId }) => ({
        requestId,
        queried: 0,
        skipped: previous.players.length,
        cancelled: false,
      }),
    });
    const rect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('session-layout')) {
        return new DOMRect(0, 0, 900, this.querySelector('.team-grid') ? 650 : 489);
      }
      return rect.call(this);
    });
    render(<SessionPanel />, { wrapper: wrapper(native.api) });
    const toggle = await screen.findByRole('button', { name: '上一局' });
    await waitFor(() => expect(toggle.getAttribute('aria-disabled') === 'true').toBe(false));
    const layout = document.querySelector<HTMLElement>('.session-layout')!;
    expect(layout.style.minHeight).toBe('');
    fireEvent.click(toggle);
    await screen.findByRole('button', { name: '返回当前局' });
    expect(layout.querySelectorAll('.player-card')).toHaveLength(previous.players.length);
    await waitFor(() => expect(toggle.getAttribute('aria-disabled') === 'true').toBe(false));
    fireEvent.click(toggle);
    await screen.findByText('等待游戏日志');
    expect(layout.querySelector('.team-grid')).toBeNull();
    expect(layout.style.minHeight).toBe('');
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
    expect(refresh.getAttribute('aria-disabled') === 'true').toBe(true);
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
    expect(refresh.getAttribute('aria-disabled') === 'true').toBe(false);
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '刷新粗查' }).getAttribute('aria-disabled') === 'true',
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新粗查' }));
    await waitFor(() => expect(queries).toBe(2));
    expect(
      screen.getByRole('button', { name: '刷新粗查' }).getAttribute('aria-disabled') === 'true',
    ).toBe(false);
  });

  it('automatically calculates selected players in sequence and reuses their own results', async () => {
    const first = deferred<RpcOutputs['players.maggot']>();
    const second = deferred<RpcOutputs['players.maggot']>();
    const native = nativeFixture(structuredClone(fixtureBootstrap), {
      'players.search': () => ({
        source: 'network',
        players: [
          { ...localPlayer, name: 'First Player' },
          { ...secondPlayer, name: 'Second Player' },
        ],
      }),
      'players.report': ({ id }) =>
        reportFixture({ id, name: id === localPlayer.id ? 'First Player' : 'Second Player' }),
      'players.maggot': ({ id }) => (id === localPlayer.id ? first.promise : second.promise),
    });
    render(<PlayersPanel />, { wrapper: wrapper(native.api) });
    fireEvent.change(await screen.findByLabelText(translate('zh', 'searchLabel')), {
      target: { value: 'Player' },
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    fireEvent.click(await screen.findByRole('button', { name: /^First Player/ }));
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'players.maggot')).toHaveLength(1),
    );
    expect(screen.queryByRole('button', { name: '查蛆指数' })).toBeNull();
    const firstCall = native.calls.find((call) => call.method === 'players.maggot')!;
    const firstInput = firstCall.input as RpcInputs['players.maggot'];
    act(() =>
      native.emit({ type: 'maggot', ...firstInput, done: 6, scanned: 8, total: 12, revision: 1 }),
    );
    expect(
      screen.getByRole('progressbar', { name: '自动计算中' }).getAttribute('aria-valuenow'),
    ).toBe('6');
    fireEvent.click(screen.getByRole('button', { name: /^Second Player/ }));
    await screen.findByRole('heading', { name: `Second Player #${secondPlayer.id}` });
    expect(screen.getAllByText('等待计算').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(native.calls.filter((call) => call.method === 'players.maggot')).toHaveLength(1);
    const complete = (id: string, rank: number) =>
      summarizeMaggot(
        id,
        Array.from({ length: 12 }, (_, i) => ({
          matchId: capturedMatches[i]!.id,
          won: true,
          mvpRank: rank,
          killRank: rank,
          lossRank: rank,
          kdRank: rank,
          eloDelta: 14,
        })),
        13,
      );
    await act(async () => first.resolve(complete(localPlayer.id, 1)));
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'players.maggot')).toHaveLength(2),
    );
    const secondCard = screen.getByRole('region', { name: '蛐指数' });
    expect(secondCard.querySelector('.maggot-score')).toBeNull();
    await act(async () => second.resolve(complete(secondPlayer.id, 5)));
    expect(secondCard.querySelector('.maggot-score')?.textContent).toBe('10');
    expect(within(secondCard).queryByRole('table')).toBeNull();
    expect(within(secondCard).queryByRole('button', { name: '查看计算明细' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^First Player/ }));
    await screen.findByRole('heading', { name: `First Player #${localPlayer.id}` });
    expect(
      screen.getByRole('region', { name: '蛐指数' }).querySelector('.maggot-score')?.textContent,
    ).toBe('1');
    expect(native.calls.filter((call) => call.method === 'players.maggot')).toHaveLength(2);
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

describe('recording audio source feedback', () => {
  const token = '11111111-1111-4111-8111-111111111111';
  function audioBootstrap(lang: 'zh' | 'en', source: 'system' | 'microphone' = 'system') {
    const bootstrap = bootstrapForApp();
    bootstrap.config.lang = lang;
    bootstrap.recording = {
      ...bootstrap.recording,
      phase: 'recording',
      sessionId: token,
      hasAudio: true,
      audio: {
        system: { state: 'active', gap: false },
        microphone: { state: 'active', gap: false },
      },
    };
    bootstrap.recording.audio![source] = { state: 'unavailable', gap: true };
    return bootstrap;
  }
  for (const lang of ['zh', 'en'] as const) {
    for (const inline of [true, false])
      it(`explains the paused microphone preference and retains it after restoring audio in ${lang} ${inline ? 'inline' : 'dialog'}`, async () => {
        const bootstrap = bootstrapForApp();
        bootstrap.config = {
          ...bootstrap.config,
          lang,
          replayAudio: 'off',
          replayMicrophone: true,
        };
        const native = nativeFixture(bootstrap, { 'displays.thumbnail': () => null });
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        const toggle = await screen.findByRole('switch', {
          name: translate(lang, 'recordMicrophone'),
        });
        expect(toggle.hasAttribute('disabled')).toBe(true);
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        const description = document.getElementById(toggle.getAttribute('aria-describedby')!)!;
        expect(description.textContent).toBe(translate(lang, 'recordingMicrophonePausedOn'));
        await userEvent
          .setup()
          .selectOptions(screen.getByLabelText(translate(lang, 'audio')), 'default');
        await waitFor(() => expect(native.backend.config.replayAudio).toBe('default'));
        expect(toggle.hasAttribute('disabled')).toBe(false);
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(native.backend.config.replayMicrophone).toBe(true);
        expect(document.getElementById(toggle.getAttribute('aria-describedby')!)!.textContent).toBe(
          translate(lang, 'recordingAudioNextCapture'),
        );
        expect(
          native.calls.filter((c) => c.method === 'config.update').map((c) => c.input),
        ).toEqual([{ replayAudio: 'default' }]);
      });
    for (const source of ['system', 'microphone'] as const)
      it(`identifies missing ${source} without treating the other audio track as success in ${lang}`, async () => {
        const native = nativeFixture(audioBootstrap(lang, source));
        render(<RecordingAudioFeedback />, { wrapper: wrapper(native.api) });
        await screen.findByText(translate(lang, 'recordingAudioMissing'));
        const summary = document.querySelector('[data-recording-audio-summary]')!;
        expect(summary.textContent).toContain(
          `${translate(lang, source === 'system' ? 'audio' : 'recordingMicrophone')}: ${translate(lang, 'recordingAudio.unavailable')}`,
        );
        expect(summary.textContent).toContain(
          `${translate(lang, source === 'system' ? 'recordingMicrophone' : 'audio')}: ${translate(lang, 'recordingAudio.active')}`,
        );
        expect(
          screen.getByRole('button', { name: translate(lang, 'recordingAudioRetry') }),
        ).toBeTruthy();
      });
    it(`holds one retry for the reviewed capture, reports failure and retains the recovered gap in ${lang}`, async () => {
      const pending = deferred<RecordingState>(),
        bootstrap = audioBootstrap(lang),
        native = nativeFixture(bootstrap, { 'replays.retryAudio': () => pending.promise });
      render(<RecordingAudioFeedback />, { wrapper: wrapper(native.api) });
      const button = await screen.findByRole('button', {
          name: translate(lang, 'recordingAudioRetry'),
        }),
        user = userEvent.setup();
      await user.click(button);
      await user.click(button);
      expect(native.calls.filter((c) => c.method === 'replays.retryAudio')).toEqual([
        { method: 'replays.retryAudio', input: { sessionId: token } },
      ]);
      expect(button.getAttribute('aria-busy')).toBe('true');
      await act(async () => {
        pending.reject(new Error('RECORDING_AUDIO_UNAVAILABLE'));
        await Promise.resolve();
      });
      await screen.findByText(translate(lang, 'RECORDING_AUDIO_UNAVAILABLE'));
      expect(button.hasAttribute('disabled')).toBe(false);
      act(() =>
        native.emit({
          type: 'recording',
          revision: 1,
          recording: {
            ...bootstrap.recording,
            audio: {
              system: { state: 'active', gap: true },
              microphone: { state: 'active', gap: false },
            },
            audioRetryError: null,
          },
        }),
      );
      await screen.findByText(translate(lang, 'recordingAudioRecovered'));
      expect(
        screen.queryByRole('button', { name: translate(lang, 'recordingAudioRetry') }),
      ).toBeNull();
      expect(screen.queryByText(translate(lang, 'RECORDING_AUDIO_UNAVAILABLE'))).toBeNull();
      expect(screen.getByText(translate(lang, 'recordingAudioGapLimit'))).toBeTruthy();
      expect(
        native.calls.some((c) => c.method === 'replays.test' || c.method === 'config.update'),
      ).toBe(false);
    });
    it(`disables every audio retry entry point while the controller owns a pending request in ${lang}`, async () => {
      const bootstrap = audioBootstrap(lang);
      bootstrap.recording.audioRetryPending = true;
      const native = nativeFixture(bootstrap);
      render(
        <>
          <RecordingAudioFeedback />
          <RecordingAudioFeedback />
        </>,
        { wrapper: wrapper(native.api) },
      );
      const buttons = await screen.findAllByRole('button', {
        name: translate(lang, 'recordingAudioRetry'),
      });
      expect(buttons).toHaveLength(2);
      for (const button of buttons) expect(button.hasAttribute('disabled')).toBe(true);
      expect(native.calls.some((c) => c.method === 'replays.retryAudio')).toBe(false);
    });
    it(`ignores an old retry rejection after the capture identity changes in ${lang}`, async () => {
      const pending = deferred<RecordingState>(),
        bootstrap = audioBootstrap(lang),
        native = nativeFixture(bootstrap, { 'replays.retryAudio': () => pending.promise });
      render(<RecordingAudioFeedback />, { wrapper: wrapper(native.api) });
      await userEvent
        .setup()
        .click(await screen.findByRole('button', { name: translate(lang, 'recordingAudioRetry') }));
      act(() =>
        native.emit({
          type: 'recording',
          revision: 1,
          recording: { ...bootstrap.recording, sessionId: '22222222-2222-4222-8222-222222222222' },
        }),
      );
      await act(async () => {
        pending.reject(new Error('Old capture failure'));
        await Promise.resolve();
      });
      expect(screen.queryByText('Old capture failure')).toBeNull();
      expect(
        screen
          .getByRole('button', { name: translate(lang, 'recordingAudioRetry') })
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    it(`retains the saved filename and gap without offering an expired retry in ${lang}`, async () => {
      const bootstrap = audioBootstrap(lang);
      bootstrap.recording = {
        ...bootstrap.recording,
        phase: 'idle',
        sessionId: null,
        lastSavedName: 'Dam-with-audio-gap.webm',
      };
      const native = nativeFixture(bootstrap);
      render(<RecordingAudioFeedback />, { wrapper: wrapper(native.api) });
      await screen.findByText(translate(lang, 'recordingAudioSavedGap'));
      expect(screen.getByText('Dam-with-audio-gap.webm')).toBeTruthy();
      expect(screen.getByText(translate(lang, 'recordingAudioAtFinish'))).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: translate(lang, 'recordingAudioRetry') }),
      ).toBeNull();
    });
    it(`does not infer system audio from a legacy any-audio flag in ${lang}`, async () => {
      const bootstrap = audioBootstrap(lang);
      delete bootstrap.recording.audio;
      const native = nativeFixture(bootstrap);
      render(<RecordingAudioSummary />, { wrapper: wrapper(native.api) });
      await screen.findByText(translate(lang, 'recordingAudioUnknown'));
      expect(screen.queryByText(translate(lang, 'audio'))).toBeNull();
    });
  }
});

describe('recording display snapshots', () => {
  const choices = [
    { id: 'A', displayId: '1', label: 'Display A' },
    { id: 'B', displayId: '2', label: 'Display B' },
  ];
  function preview(id: string, source = id || 'A', displays = choices): DisplayPreview {
    return {
      requestedId: id,
      sourceId: source,
      label: 'Display ' + source,
      selection: !id ? 'automatic' : id === source ? 'selected' : 'fallback',
      thumbnail: 'data:image/png;base64,' + source,
      displays,
    };
  }
  function bootstrap(lang: 'zh' | 'en', id = 'A') {
    const initial = bootstrapForApp();
    initial.config = { ...initial.config, lang, replayDisplayId: id };
    return initial;
  }
  for (const lang of ['zh', 'en'] as const)
    for (const inline of [true, false]) {
      const scope = `${lang} ${inline ? 'inline' : 'dialog'}`;
      it(`hides a previous target while the next preview is held or fails and retries with stable focus in ${scope}`, async () => {
        const first = deferred<DisplayPreview>(),
          second = deferred<DisplayPreview>();
        let attempts = 0;
        const native = nativeFixture(bootstrap(lang), {
          'displays.preview': ({ id }) =>
            id === 'A' ? preview(id) : ++attempts === 1 ? first.promise : second.promise,
        });
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display A' }));
        const user = userEvent.setup();
        await user.selectOptions(screen.getByLabelText(translate(lang, 'display')), 'B');
        expect(screen.queryByRole('img')).toBeNull();
        expect(document.querySelector('.display-preview-slot')!.getAttribute('aria-busy')).toBe(
          'true',
        );
        await act(async () => {
          first.reject(new Error('Controlled B preview failure'));
          await Promise.resolve();
        });
        await screen.findByText(/Controlled B preview failure/);
        expect(screen.queryByText(translate(lang, 'displayPreviewNoSources'))).toBeNull();
        expect(
          screen.queryByAltText(translate(lang, 'displayPreviewFor', { display: 'Display A' })),
        ).toBeNull();
        const refresh = screen.getByRole('button', { name: translate(lang, 'refreshDisplays') });
        await user.click(refresh);
        await user.click(refresh);
        expect(attempts).toBe(2);
        expect(refresh.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText(/Controlled B preview failure/)).toBeTruthy();
        await act(async () => {
          second.resolve(preview('B'));
          await Promise.resolve();
        });
        await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display B' }));
        expect(screen.queryByText(/Controlled B preview failure/)).toBeNull();
        expect(document.activeElement).toBe(refresh);
      });
      it(`ignores an older target response after returning to a previous display in ${scope}`, async () => {
        const pending = deferred<DisplayPreview>();
        const native = nativeFixture(bootstrap(lang), {
          'displays.preview': ({ id }) => (id === 'B' ? pending.promise : preview(id)),
        });
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display A' }));
        const user = userEvent.setup(),
          select = screen.getByLabelText(translate(lang, 'display'));
        await user.selectOptions(select, 'B');
        await user.selectOptions(select, 'A');
        await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display A' }));
        await act(async () => {
          pending.resolve(preview('B'));
          await Promise.resolve();
        });
        expect(
          screen.queryByAltText(translate(lang, 'displayPreviewFor', { display: 'Display B' })),
        ).toBeNull();
        expect((select as HTMLSelectElement).value).toBe('A');
      });
      it(`refreshes topology in place and retains an unavailable saved choice until an explicit change in ${scope}`, async () => {
        vi.useFakeTimers();
        let current = preview('B');
        const native = nativeFixture(bootstrap(lang, 'B'), {
          'displays.preview': ({ id }) =>
            id === 'C'
              ? preview(id, id, [choices[0]!, { id: 'C', displayId: '3', label: 'Display C' }])
              : current,
        });
        try {
          await act(async () => {
            render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
          });
          expect(
            screen.getByAltText(translate(lang, 'displayPreviewFor', { display: 'Display B' })),
          ).toBeTruthy();
          current = preview('B', 'A', [
            choices[0]!,
            { id: 'C', displayId: '3', label: 'Display C' },
          ]);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
          });
          const select = screen.getByLabelText(translate(lang, 'display')) as HTMLSelectElement;
          expect(select.value).toBe('B');
          expect(select.selectedOptions[0]!.textContent).toBe(
            translate(lang, 'displayMissingChoice', { id: 'B' }),
          );
          expect(screen.getByRole('option', { name: 'Display C' })).toBeTruthy();
          expect(
            screen.getByText(
              translate(lang, 'displayPreviewFallback', { id: 'B', display: 'Display A' }),
            ),
          ).toBeTruthy();
          expect(
            screen.getByAltText(translate(lang, 'displayPreviewFor', { display: 'Display A' })),
          ).toBeTruthy();
          expect(native.calls.some((call) => call.method === 'config.update')).toBe(false);
          await act(async () => {
            fireEvent.change(select, { target: { value: 'C' } });
            await Promise.resolve();
          });
          expect(native.backend.config.replayDisplayId).toBe('C');
          expect(
            screen.getByAltText(translate(lang, 'displayPreviewFor', { display: 'Display C' })),
          ).toBeTruthy();
        } finally {
          cleanup();
          vi.useRealTimers();
        }
      });
      it(`preserves enumeration failure beside the selector independently of recording-test failure in ${scope}`, async () => {
        let fail = true;
        const native = nativeFixture(bootstrap(lang), {
          'displays.preview': ({ id }) => {
            if (fail) throw new Error('Controlled enumeration failure');
            return preview(id);
          },
          'replays.test': () => {
            throw new Error('Controlled recording test failure');
          },
        });
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        await screen.findByText(/Controlled enumeration failure/);
        expect(screen.queryByText(translate(lang, 'displayPreviewNoSources'))).toBeNull();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: translate(lang, 'recordingTest') }));
        await screen.findByText(/Controlled recording test failure/);
        expect(
          screen.getByText(/Controlled enumeration failure/).closest('.recording-video-card'),
        ).toBeTruthy();
        fail = false;
        await user.click(screen.getByRole('button', { name: translate(lang, 'refreshDisplays') }));
        await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display A' }));
        expect(screen.queryByText(/Controlled enumeration failure/)).toBeNull();
        expect(screen.getByText(/Controlled recording test failure/)).toBeTruthy();
      });
      it(`shows a missing saved ID and persists an explicit Automatic selection in ${scope}`, async () => {
        const native = nativeFixture(bootstrap(lang, 'missing'), {
          'displays.preview': ({ id }) => preview(id, 'A'),
        });
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        await screen.findByText(
          translate(lang, 'displayPreviewFallback', { id: 'missing', display: 'Display A' }),
        );
        const select = screen.getByLabelText(translate(lang, 'display')) as HTMLSelectElement;
        expect(select.value).toBe('missing');
        expect(select.selectedOptions[0]!.textContent).toBe(
          translate(lang, 'displayMissingChoice', { id: 'missing' }),
        );
        expect(native.backend.config.replayDisplayId).toBe('missing');
        expect(native.calls.some((call) => call.method === 'config.update')).toBe(false);
        await userEvent.setup().selectOptions(select, '');
        await waitFor(() => expect(native.backend.config.replayDisplayId).toBe(''));
        expect(select.value).toBe('');
        expect(select.selectedOptions[0]!.textContent).toBe(
          lang === 'zh' ? '自动（优先鼠标所在屏幕）' : 'Automatic (prefer screen under pointer)',
        );
        expect(screen.getByText(translate(lang, 'displayAutomaticPolicy'))).toBeTruthy();
        expect(
          native.calls.filter((call) => call.method === 'config.update').map((call) => call.input),
        ).toEqual([{ replayDisplayId: '' }]);
      });
      it(`reports image decoding failure without losing display choices or applying an older image error in ${scope}`, async () => {
        const native = nativeFixture(bootstrap(lang), {
          'displays.preview': ({ id }) => preview(id),
        });
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        const old = await screen.findByAltText(
          translate(lang, 'displayPreviewFor', { display: 'Display A' }),
        );
        fireEvent.error(old);
        expect(screen.getByText(translate(lang, 'displayPreviewImageFailed'))).toBeTruthy();
        const select = screen.getByLabelText(translate(lang, 'display'));
        await userEvent.setup().selectOptions(select, 'B');
        await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display B' }));
        fireEvent.error(old);
        expect(screen.queryByText(translate(lang, 'displayPreviewImageFailed'))).toBeNull();
        expect((select as HTMLSelectElement).value).toBe('B');
      });
      it(`rejects a response labelled for another requested display in ${scope}`, async () => {
        const native = nativeFixture(bootstrap(lang), { 'displays.preview': () => preview('B') });
        render(<RecordingSettings inline={inline} />, { wrapper: wrapper(native.api) });
        await screen.findByText(translate(lang, 'displayPreviewTargetChanged'));
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByText(translate(lang, 'displayPreviewUnconfirmed'))).toBeTruthy();
      });
    }
  for (const lang of ['zh', 'en'] as const) {
    it(`recognizes a saved native display alias without rewriting the preference in ${lang}`, async () => {
      const native = nativeFixture(bootstrap(lang, '1'), {
        'displays.preview': () => ({ ...preview('1', 'A'), selection: 'selected' }),
      });
      render(<RecordingSettings inline />, { wrapper: wrapper(native.api) });
      await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display A' }));
      const select = screen.getByLabelText(translate(lang, 'display')) as HTMLSelectElement;
      expect(select.value).toBe('A');
      expect(select.selectedOptions[0]!.textContent).toBe('Display A');
      expect(native.backend.config.replayDisplayId).toBe('1');
      expect(native.calls.some((call) => call.method === 'config.update')).toBe(false);
    });
    it(`distinguishes the active fallback capture from the next selected display in ${lang}`, async () => {
      const initial = bootstrap(lang, 'B');
      initial.recording = {
        ...initial.recording,
        phase: 'recording',
        sessionId: '11111111-1111-4111-8111-111111111111',
        sourceId: 'A',
        display: {
          requestedId: 'missing',
          sourceId: 'A',
          label: 'Display A',
          selection: 'fallback',
        },
      };
      const native = nativeFixture(initial, { 'displays.preview': ({ id }) => preview(id) });
      render(<RecordingSettings inline />, { wrapper: wrapper(native.api) });
      await screen.findByAltText(translate(lang, 'displayPreviewFor', { display: 'Display B' }));
      expect(
        screen.getByText(
          translate(lang, 'recordingDisplayFallback', { id: 'missing', display: 'Display A' }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(translate(lang, 'displayFixedPolicy'))).toBeTruthy();
    });
  }
});

describe('navigation focus and drawer continuity', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.panelOrder = [
        'current',
        'radar',
        'players',
        'archive',
        'replays',
        'decks',
        'bans',
      ];
      value.config.hiddenPanels = [];
      value.config.sidebarCollapsed = false;
      return value;
    };
    const fixture = (overrides: Partial<Handlers> = {}) =>
      nativeFixture(initial(), {
        'cache.stats': () => ({
          at: Date.now(),
          nextExpiryAt: null,
          api: { entries: 0, expired: 0, bytes: 0 },
          snapshots: { entries: 0, expired: 0, bytes: 0 },
        }),
        ...overrides,
      });
    const mount = (native: ReturnType<typeof fixture>, route: string) => {
      history.replaceState(null, '', route);
      return render(<App />, { wrapper: wrapper(native.api) });
    };
    const drawer = async (section: 'workspace' | 'settings') => {
      const opener = await screen.findByRole('button', { name: text('openNavigation') });
      opener.focus();
      await userEvent.keyboard(' ');
      const dialog = await screen.findByRole('dialog', {
        name: text(section === 'workspace' ? 'workspaceNav' : 'settings'),
      });
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      return { opener, dialog };
    };
    const closeDrawer = async () => {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };
    for (const section of ['workspace', 'settings'] as const) {
      it(`returns ${section} sidebar shortcut focus to its visible toggle in ${lang}`, async () => {
        const native = fixture();
        mount(native, section === 'workspace' ? '#players' : '#settings/general');
        const toggle = await screen.findByRole('button', { name: text('collapseSidebar') });
        const sidebar = document.getElementById(
          section === 'workspace' ? 'workspace-sidebar' : 'settings-sidebar',
        )!;
        const source = within(sidebar).getByRole(section === 'workspace' ? 'button' : 'tab', {
          name: text(section === 'workspace' ? 'players' : 'generalSettings'),
        });
        source.focus();
        await userEvent.keyboard('{Control>}b{/Control}');
        expect(document.activeElement).toBe(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(sidebar.hasAttribute('inert')).toBe(true);
        await waitFor(() => expect(native.backend.config.sidebarCollapsed).toBe(true));
        fireEvent.keyDown(window, { key: 'b', ctrlKey: true, repeat: true });
        fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true });
        fireEvent.keyDown(window, { key: 'b', ctrlKey: true, altKey: true });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        await userEvent.keyboard('{Meta>}b{/Meta}');
        expect(document.activeElement).toBe(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        await waitFor(() => expect(native.backend.config.sidebarCollapsed).toBe(false));
      });
      it(`does not steal focus outside the ${section} sidebar when it collapses in ${lang}`, async () => {
        const native = fixture();
        mount(native, section === 'workspace' ? '#players' : '#settings/general');
        const toggle = await screen.findByRole('button', { name: text('collapseSidebar') });
        const source =
          section === 'workspace'
            ? await screen.findByRole('searchbox', { name: text('searchLabel') })
            : await screen.findByRole('tabpanel', { name: text('generalSettings') });
        source.focus();
        await userEvent.keyboard('{Control>}b{/Control}');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(source);
        await userEvent.keyboard('{Control>}b{/Control}');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(source);
        const prevented = new KeyboardEvent('keydown', {
          key: 'b',
          ctrlKey: true,
          cancelable: true,
        });
        prevented.preventDefault();
        fireEvent(window, prevented);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
      });
      for (const method of ['escape', 'close', 'backdrop'] as const) {
        it(`restores the ${section} drawer opener after ${method} dismissal in ${lang}`, async () => {
          vi.stubGlobal('innerWidth', 450);
          const native = fixture();
          mount(native, section === 'workspace' ? '#players' : '#settings/general');
          const { opener, dialog } = await drawer(section);
          if (method === 'close') {
            within(dialog)
              .getByRole('button', { name: text('closeNavigation') })
              .focus();
            await userEvent.keyboard(' ');
          } else if (method === 'backdrop') {
            await userEvent.click(document.querySelector('[data-slot="sheet-overlay"]')!);
          } else {
            await userEvent.keyboard('{Escape}');
            if (screen.queryByRole('dialog')) await userEvent.keyboard('{Escape}');
          }
          await closeDrawer();
          await waitFor(() => expect(document.activeElement).toBe(opener));
          expect(opener.getAttribute('aria-expanded')).toBe('false');
          expect(native.backend.config.sidebarCollapsed).toBe(false);
          expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(0);
          await userEvent.tab();
          expect(document.activeElement).not.toBe(document.body);
          expect(document.activeElement).not.toBe(opener);
        });
      }
    }
    for (const activation of [' ', '{Enter}']) {
      it(`focuses selected workspace content after drawer activation ${activation} in ${lang}`, async () => {
        vi.stubGlobal('innerWidth', 450);
        const native = fixture();
        mount(native, '#current');
        const { dialog, opener } = await drawer('workspace');
        within(dialog)
          .getByRole('button', { name: text('players') })
          .focus();
        await userEvent.keyboard(activation);
        await closeDrawer();
        await waitFor(() =>
          expect(document.activeElement).toBe(document.getElementById('main-content')),
        );
        expect(location.hash).toBe('#players');
        expect(document.activeElement).not.toBe(opener);
        await userEvent.tab();
        const roomPicker = screen.getByRole('button', { name: text('currentRoomPlayers') });
        expect(document.activeElement).toBe(roomPicker);
        expect(roomPicker.getAttribute('aria-expanded')).toBe('false');
        await userEvent.tab();
        expect(document.activeElement).toBe(
          screen.getByRole('searchbox', { name: text('searchLabel') }),
        );
      });
    }
    for (const activation of [' ', '{Enter}', 'pointer']) {
      it(`traverses settings categories in one drawer and commits with ${activation} in ${lang}`, async () => {
        vi.stubGlobal('innerWidth', 450);
        const native = fixture();
        mount(native, '#settings/general');
        const { dialog } = await drawer('settings');
        const tabs = within(dialog).getAllByRole('tab');
        tabs[0]!.focus();
        for (const next of tabs.slice(1)) {
          await userEvent.keyboard('{ArrowDown}');
          expect(document.activeElement).toBe(next);
          expect(next.getAttribute('aria-selected')).toBe('true');
          expect(screen.getByRole('dialog')).toBe(dialog);
        }
        await userEvent.keyboard('{ArrowDown}');
        expect(document.activeElement).toBe(tabs[0]);
        await userEvent.keyboard('{ArrowUp}');
        expect(document.activeElement).toBe(tabs.at(-1));
        await userEvent.keyboard('{Home}');
        expect(document.activeElement).toBe(tabs[0]);
        const target = within(dialog).getByRole('tab', { name: text('navigationSettings') });
        target.focus();
        await waitFor(() => expect(target.getAttribute('aria-selected')).toBe('true'));
        if (activation === 'pointer') await userEvent.click(target);
        else await userEvent.keyboard(activation);
        await closeDrawer();
        await waitFor(() =>
          expect(document.activeElement).toBe(document.getElementById('settings-panel-navigation')),
        );
        expect(location.hash).toBe('#settings/navigation');
        expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(0);
        await userEvent.tab();
        expect(document.activeElement).toBe(screen.getAllByRole('switch')[0]);
      });
    }
    it(`dismisses a settings preview back to the opener after arrow traversal in ${lang}`, async () => {
      vi.stubGlobal('innerWidth', 450);
      const native = fixture();
      mount(native, '#settings/general');
      const { dialog, opener } = await drawer('settings');
      within(dialog).getAllByRole('tab')[0]!.focus();
      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      expect(location.hash).toBe('#settings/connection');
      expect(screen.getByRole('dialog')).toBe(dialog);
      await userEvent.keyboard('{Escape}');
      if (screen.queryByRole('dialog')) await userEvent.keyboard('{Escape}');
      await closeDrawer();
      await waitFor(() => expect(document.activeElement).toBe(opener));
    });
    it(`does not override a new control focused while the drawer closes in ${lang}`, async () => {
      vi.stubGlobal('innerWidth', 450);
      const native = fixture();
      mount(native, '#players');
      const input = await screen.findByRole('searchbox', { name: text('searchLabel') });
      const { dialog } = await drawer('workspace');
      fireEvent.click(within(dialog).getByRole('button', { name: text('closeNavigation') }));
      input.focus();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await closeDrawer();
      expect(document.activeElement).toBe(input);
    });
    it(`preserves the opener if the user chooses it again while navigation closes the drawer in ${lang}`, async () => {
      vi.stubGlobal('innerWidth', 450);
      const native = fixture();
      mount(native, '#current');
      const { dialog, opener } = await drawer('workspace');
      fireEvent.click(within(dialog).getByRole('button', { name: text('players') }));
      opener.focus();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await closeDrawer();
      expect(location.hash).toBe('#players');
      expect(document.activeElement).toBe(opener);
    });
    it(`keeps a reopened drawer focused when an older close callback arrives in ${lang}`, async () => {
      vi.stubGlobal('innerWidth', 450);
      const native = fixture();
      mount(native, '#players');
      const { dialog, opener } = await drawer('workspace');
      fireEvent.click(within(dialog).getByRole('button', { name: text('closeNavigation') }));
      opener.focus();
      fireEvent.click(opener);
      const reopened = await screen.findByRole('dialog');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await waitFor(() => expect(reopened.contains(document.activeElement)).toBe(true));
      expect(native.backend.config.sidebarCollapsed).toBe(false);
    });
    it(`returns drawer focus to the visible toggle after changing to desktop layout in ${lang}`, async () => {
      vi.stubGlobal('innerWidth', 450);
      const changes = new Set<() => void>();
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        addEventListener: (_type: string, listener: unknown) => {
          if (query.includes('max-width')) changes.add(listener as () => void);
        },
        removeEventListener: (_type: string, listener: unknown) => {
          changes.delete(listener as () => void);
        },
      }));
      const native = fixture();
      mount(native, '#players');
      const { opener } = await drawer('workspace');
      act(() => {
        vi.stubGlobal('innerWidth', 1000);
        for (const change of changes) change();
      });
      await closeDrawer();
      await waitFor(() => expect(document.activeElement).toBe(opener));
      expect(opener.getAttribute('aria-expanded')).toBe('true');
      expect(native.backend.config.sidebarCollapsed).toBe(false);
    });
    it(`preserves a later navigation control after its reorder save fails in ${lang}`, async () => {
      const gate = deferred<RpcOutputs['config.update']>();
      const native = fixture({ 'config.update': () => gate.promise });
      const original = [...native.backend.config.panelOrder];
      mount(native, '#settings/navigation');
      const button = await screen.findByRole('button', {
        name: text('moveUp') + ' ' + text(original[3]!),
      });
      button.focus();
      await userEvent.keyboard(' ');
      await userEvent.tab();
      const destination = document.activeElement;
      await waitFor(() =>
        expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1),
      );
      await act(async () => gate.reject(new Error('Controlled navigation save failure')));
      await screen.findByRole('button', {
        name: translate(lang, 'settingsSaveReview', { status: text('settingsSaveFailed') }),
      });
      expect(document.activeElement).toBe(destination);
      expect(native.backend.config.panelOrder).toEqual(original);
      expect(
        [...document.querySelectorAll<HTMLElement>('.panel-order > li')].map(
          (node) => node.dataset.panel,
        ),
      ).not.toEqual(original);
    });
    const moves = [
      { index: 1, direction: -1, boundary: true },
      { index: 5, direction: 1, boundary: true },
      { index: 3, direction: -1, boundary: false },
      { index: 3, direction: 1, boundary: false },
    ];
    for (const { index, direction, boundary } of moves) {
      it(`keeps the moved navigation action at index ${index} direction ${direction} in ${lang}`, async () => {
        const gate = deferred<void>();
        const native = fixture({
          'config.update': async (patch) => {
            await gate.promise;
            const config = configSchema.parse({ ...native.backend.config, ...patch });
            native.emit({ type: 'config', config, revision: native.backend.revision + 1 });
            return config;
          },
        });
        const order = [...native.backend.config.panelOrder];
        const panel = order[index]!;
        const next = index + direction;
        [order[index], order[next]] = [order[next]!, order[index]!];
        mount(native, '#settings/navigation');
        const button = await screen.findByRole('button', {
          name: text(direction < 0 ? 'moveUp' : 'moveDown') + ' ' + text(panel),
        });
        const row = button.closest('[data-panel]');
        button.focus();
        await userEvent.keyboard(' ');
        expect(document.activeElement).toBe(button);
        expect(button.closest('[data-panel]')).toBe(row);
        expect(button.hasAttribute('disabled')).toBe(false);
        expect(button.getAttribute('aria-disabled')).toBe(String(boundary));
        expect(
          [...document.querySelectorAll<HTMLElement>('.panel-order > li')].map(
            (node) => node.dataset.panel,
          ),
        ).toEqual(order);
        await waitFor(() =>
          expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1),
        );
        await act(async () => gate.resolve());
        await waitFor(() => expect(native.backend.config.panelOrder).toEqual(order));
        expect(document.activeElement).toBe(button);
        if (boundary) {
          await userEvent.keyboard('{Enter} ');
          expect(native.calls.filter((call) => call.method === 'config.update')).toHaveLength(1);
          expect(native.backend.config.panelOrder).toEqual(order);
        }
        await userEvent.tab({ shift: direction > 0 });
        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement).not.toBe(button);
        expect(row?.contains(document.activeElement)).toBe(true);
      });
    }
  }
});

describe('busy refresh keyboard continuity', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.session.current = matchFixture();
      value.session.phase = 'match';
      return value;
    };
    const deckList = (found = true): RpcOutputs['decks.list'] => ({
      found,
      decksDir: 'focus-profile/Decks',
      backupsDir: 'focus-profile/Backups',
      decks: found ? [{ name: 'Focus.deck', size: 100, modifiedAt: 1 }] : [],
      backups: found ? [{ name: 'Focus.zip', size: 100, modifiedAt: 1 }] : [],
    });
    const activate = async (button: HTMLElement) => {
      button.focus();
      await userEvent.keyboard(' ');
      expect(document.activeElement).toBe(button);
    };
    const verifyBusy = async (button: HTMLElement) => {
      await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(document.activeElement).toBe(button);
      await userEvent.keyboard('{Enter} ');
    };
    for (const kind of ['front', 'back']) {
      it(`keeps shared deck refresh focused with ${kind} selection through failure and recovery in ${lang}`, async () => {
        let response = deferred<RpcOutputs['decks.list']>();
        let requests = 0;
        const native = nativeFixture(initial(), {
          'decks.list': () => (++requests === 1 ? deckList() : response.promise),
        });
        render(<DecksPanel />, { wrapper: wrapper(native.api) });
        await screen.findByRole('group', { name: text('frontDecks') });
        const button = screen.getByRole('button', { name: text('refresh') });
        const checkbox = screen.getByRole('checkbox', {
          name: kind === 'front' ? /Focus.deck/ : /Focus.zip/,
        });
        await userEvent.click(checkbox);
        await activate(button);
        await verifyBusy(button);
        expect(requests).toBe(2);
        await act(async () => response.reject(new Error('Deck focus read failure')));
        await screen.findByText('Deck focus read failure');
        expect(document.activeElement).toBe(button);
        expect(checkbox.getAttribute('aria-checked')).toBe('true');
        response = deferred();
        await activate(button);
        await verifyBusy(button);
        expect(requests).toBe(3);
        await act(async () => response.resolve(deckList()));
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(button);
        response = deferred();
        await activate(button);
        await userEvent.tab();
        const destination = document.activeElement;
        await act(async () => response.resolve(deckList()));
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(destination);
      });
    }
    it(`recovers deck refresh focus across missing and discovered directories in ${lang}`, async () => {
      let response = deferred<RpcOutputs['decks.list']>();
      let requests = 0;
      const native = nativeFixture(initial(), {
        'decks.list': () => (++requests === 1 ? deckList(false) : response.promise),
      });
      render(<DecksPanel />, { wrapper: wrapper(native.api) });
      const first = await screen.findByRole('button', { name: text('refresh') });
      await waitFor(() => expect(first.getAttribute('aria-busy')).toBe('false'));
      await activate(first);
      await verifyBusy(first);
      await act(async () => response.resolve(deckList()));
      const next = screen.getAllByRole('button', { name: text('refresh') })[0]!;
      expect(first.isConnected).toBe(true);
      expect(next).toBe(first);
      expect(document.activeElement).toBe(next);
      response = deferred();
      await activate(next);
      await act(async () => response.resolve(deckList(false)));
      const last = screen.getByRole('button', { name: text('refresh') });
      expect(next.isConnected).toBe(true);
      expect(last).toBe(first);
      expect(document.activeElement).toBe(last);
    });
    for (const action of ['refresh', 'cacheClearExpired', 'cacheClearAll'] as const) {
      for (const leave of [false, true]) {
        it(`preserves cache ${action} ${leave ? 'Tab destination' : 'focus'} through failure and zero-result recovery in ${lang}`, async () => {
          const stats = {
            at: Date.now(),
            nextExpiryAt: null,
            api: { entries: 3, expired: 2, bytes: 2048 },
            snapshots: { entries: 2, expired: 1, bytes: 1024 },
          };
          const empty = {
            at: Date.now(),
            nextExpiryAt: null,
            api: { entries: 0, expired: 0, bytes: 0 },
            snapshots: { entries: 0, expired: 0, bytes: 0 },
          };
          const refresh = action === 'refresh';
          let response = deferred<RpcOutputs['cache.stats']>();
          let cleared = deferred<RpcOutputs['cache.clear']>();
          let reads = 0;
          const native = nativeFixture(initial(), {
            'cache.stats': () => (!refresh || ++reads === 1 ? stats : response.promise),
            'cache.clear': () => cleared.promise,
          });
          render(
            <>
              <CacheSettings />
              <button>Following control</button>
            </>,
            {
              wrapper: wrapper(native.api),
            },
          );
          await screen.findByText('3 KB');
          const button = screen.getByRole('button', { name: text(action) });
          const begin = async () => {
            if (action === 'cacheClearAll') {
              button.focus();
              await userEvent.keyboard(' ');
              const dialog = await screen.findByRole('alertdialog');
              await userEvent.click(within(dialog).getByRole('button', { name: text(action) }));
              await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
              await waitFor(() => expect(document.activeElement).toBe(button));
            } else await activate(button);
            await verifyBusy(button);
          };
          await begin();
          const method = refresh ? 'cache.stats' : 'cache.clear';
          const expected = refresh ? 2 : 1;
          expect(native.calls.filter((call) => call.method === method)).toHaveLength(expected);
          await act(async () =>
            (refresh ? response : cleared).reject(new Error('Cache focus source failure')),
          );
          await screen.findByText('Cache focus source failure');
          expect(document.activeElement).toBe(button);
          response = deferred();
          cleared = deferred();
          await begin();
          if (leave) await userEvent.tab();
          const destination = document.activeElement;
          await act(async () => {
            if (refresh) response.resolve(empty);
            else cleared.resolve({ removed: 5, stats: empty });
          });
          await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
          expect(document.activeElement).toBe(destination);
          expect(button.hasAttribute('disabled')).toBe(false);
          expect(button.getAttribute('aria-disabled')).toBe(String(!refresh));
          expect(native.calls.filter((call) => call.method === method)).toHaveLength(expected + 1);
          if (!refresh && !leave) {
            await userEvent.keyboard('{Enter} ');
            expect(native.calls.filter((call) => call.method === method)).toHaveLength(
              expected + 1,
            );
            expect(screen.queryByRole('alertdialog')).toBeNull();
          }
        });
      }
    }
    for (const context of ['current', 'previous'] as const) {
      it(`keeps ${context} radar refresh focused through errors and an empty successful query in ${lang}`, async () => {
        let response = deferred<RpcOutputs['session.query']>();
        let requests = 0;
        const native = nativeFixture(initial(), {
          'matches.list': () => [matchFixture({ id: 'focus-previous', fid: 'focus-previous' })],
          'session.query': ({ requestId }) => {
            if (++requests === 1 && context === 'previous')
              return { requestId, queried: 0, skipped: 0, cancelled: false };
            return response.promise;
          },
        });
        render(<SessionPanel />, { wrapper: wrapper(native.api) });
        if (context === 'previous') {
          const previous = await screen.findByRole('button', { name: text('previous') });
          await waitFor(() => expect(previous.getAttribute('aria-disabled')).toBe('false'));
          await userEvent.click(previous);
          await waitFor(() => expect(requests).toBe(1));
        }
        const button = await screen.findByRole('button', { name: text('query') });
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        await activate(button);
        await verifyBusy(button);
        const expected = context === 'current' ? 1 : 2;
        expect(requests).toBe(expected);
        await act(async () => response.reject(new Error('Radar focus query failure')));
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(button);
        response = deferred();
        await activate(button);
        await verifyBusy(button);
        await act(async () =>
          response.resolve({ requestId: 'focus', queried: 0, skipped: 0, cancelled: false }),
        );
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(button);
        response = deferred();
        await activate(button);
        await userEvent.tab();
        const destination = document.activeElement;
        await act(async () =>
          response.resolve({ requestId: 'focus', queried: 0, skipped: 0, cancelled: false }),
        );
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(destination);
      });
    }
    it(`can return to the current roster after its displayed previous match disappears in ${lang}`, async () => {
      let available = true;
      const native = nativeFixture(initial(), {
        'matches.list': () =>
          available ? [matchFixture({ id: 'focus-previous', fid: 'focus-previous' })] : [],
        'session.query': ({ requestId }) => ({
          requestId,
          queried: 0,
          skipped: 0,
          cancelled: false,
        }),
      });
      render(<SessionPanel />, { wrapper: wrapper(native.api) });
      const previous = await screen.findByRole('button', { name: text('previous') });
      await waitFor(() => expect(previous.getAttribute('aria-disabled')).toBe('false'));
      await activate(previous);
      await waitFor(() => expect(previous.getAttribute('aria-disabled')).toBe('false'));
      available = false;
      act(() => native.emit({ type: 'matches', revision: native.backend.revision + 1 }));
      await waitFor(() =>
        expect(document.querySelector('.session-layout .player-card')).toBeNull(),
      );
      expect(previous.textContent).toBe(text('back'));
      expect(previous.getAttribute('aria-disabled')).toBe('false');
      await activate(previous);
      expect(previous.textContent).toBe(text('previous'));
      expect(document.querySelector('.session-layout .player-card')).toBeTruthy();
      expect(previous.getAttribute('aria-disabled')).toBe('true');
    });
    it(`keeps the previous-match query toggle focused while its automatic query is pending in ${lang}`, async () => {
      const response = deferred<RpcOutputs['session.query']>();
      const native = nativeFixture(initial(), {
        'matches.list': () => [matchFixture({ id: 'focus-previous', fid: 'focus-previous' })],
        'session.query': () => response.promise,
      });
      render(<SessionPanel />, { wrapper: wrapper(native.api) });
      const previous = await screen.findByRole('button', { name: text('previous') });
      await waitFor(() => expect(previous.getAttribute('aria-disabled')).toBe('false'));
      await activate(previous);
      await verifyBusy(previous);
      expect(native.calls.filter((call) => call.method === 'session.query')).toHaveLength(1);
      await act(async () =>
        response.resolve({ requestId: 'focus', queried: 0, skipped: 0, cancelled: false }),
      );
      await waitFor(() => expect(previous.getAttribute('aria-disabled')).toBe('false'));
      expect(document.activeElement).toBe(previous);
    });
  }
});

describe('player recovery keyboard continuity', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    const id = localPlayer.id;
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.panelOrder = ['players'];
      return value;
    };
    const full = () => reportFixture({ id, name: 'Keyboard recovery target' });
    const callsFor = (native: ReturnType<typeof nativeFixture>, method: RpcMethod) =>
      native.calls.filter((call) => call.method === method).length;
    const activate = async (button: HTMLElement) => {
      button.focus();
      await userEvent.keyboard(' ');
      expect(document.activeElement).toBe(button);
    };
    const pending = async (button: HTMLElement) => {
      await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(document.activeElement).toBe(button);
      await userEvent.keyboard('{Enter} ');
    };
    for (const view of ['profile', 'search'] as const) {
      it(`keeps the ${view} report retry mounted through failure, partial and complete results in ${lang}`, async () => {
        let next = deferred<RpcOutputs['players.report']>();
        const native = nativeFixture(initial(), {
          'players.report': ({ force }) => {
            if (!force) throw new Error('Initial report failure');
            return next.promise;
          },
        });
        if (view === 'profile') {
          render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
        } else {
          render(<PlayersPanel />, { wrapper: wrapper(native.api) });
          fireEvent.change(await screen.findByRole('searchbox', { name: text('searchLabel') }), {
            target: { value: localPlayer.name },
          });
          await userEvent.click(screen.getByRole('button', { name: text('search') }));
          await userEvent.click(
            await within(document.querySelector<HTMLElement>('.player-results-card')!).findByRole(
              'button',
              { name: new RegExp('^' + localPlayer.name) },
            ),
          );
        }
        await screen.findByText('Initial report failure');
        const status = document.querySelector('[data-report-status]')! as HTMLElement;
        const button = within(status).getByRole('button', { name: text('retry') });
        await activate(button);
        await pending(button);
        expect(callsFor(native, 'players.report')).toBe(2);
        await act(async () => next.reject(new Error('Retry report failure')));
        await within(status).findByText('Retry report failure');
        expect(document.activeElement).toBe(button);
        next = deferred();
        await activate(button);
        await pending(button);
        expect(callsFor(native, 'players.report')).toBe(3);
        await act(async () =>
          next.resolve({
            ...full(),
            fallback: true,
            detailAvailability: { matches: false, maps: false },
          }),
        );
        await within(status).findByText(text('reportBasicOnly'));
        expect(document.querySelector('[data-report-status]')).toBe(status);
        expect(document.activeElement).toBe(button);
        expect(button.textContent).toBe(text('retryAnalysis'));
        next = deferred();
        await activate(button);
        await pending(button);
        expect(callsFor(native, 'players.report')).toBe(4);
        await act(async () => next.resolve(full()));
        await waitFor(() => expect(button.textContent).toBe(text('refreshAnalysis')));
        expect(document.activeElement).toBe(button);
        expect(button.getAttribute('aria-disabled')).toBe('false');
        next = deferred();
        await activate(button);
        await pending(button);
        await userEvent.tab();
        const destination = document.activeElement;
        expect(destination).not.toBe(button);
        await act(async () => next.resolve(full()));
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(destination);
      });
      it(`keeps the ${view} Maggot retry focused until recovery and respects a later Tab in ${lang}`, async () => {
        let next = deferred<RpcOutputs['players.maggot']>();
        let requests = 0;
        const native = nativeFixture(initial(), {
          'players.maggot': ({ id: requested }) => {
            if (++requests === 1) throw new Error('Initial calculation failure');
            expect(requested).toBe(id);
            return next.promise;
          },
        });
        if (view === 'profile') {
          render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
        } else {
          render(<ReportView report={full()} />, { wrapper: wrapper(native.api) });
        }
        await screen.findByText('Initial calculation failure');
        const card = screen.getByRole('region', { name: text('maggot') });
        const button = within(card).getByRole('button', { name: text('retry') });
        await activate(button);
        await pending(button);
        expect(callsFor(native, 'players.maggot')).toBe(2);
        await act(async () => next.reject(new Error('Calculation retry failure')));
        await within(card).findByText('Calculation retry failure');
        expect(document.activeElement).toBe(button);
        next = deferred();
        await activate(button);
        await pending(button);
        await act(async () => next.resolve(summarizeMaggot(id, [])));
        await waitFor(() => expect(button.textContent).toBe(text('recalculateMaggot')));
        expect(document.activeElement).toBe(button);
        next = deferred();
        await activate(button);
        await pending(button);
        await userEvent.tab();
        const destination = document.activeElement;
        expect(destination).not.toBe(button);
        await act(async () => next.resolve(summarizeMaggot(id, [])));
        await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(destination);
      });
    }
    for (const section of ['matchStatistics', 'mapStatistics', 'encounters'] as const) {
      for (const empty of [false, true]) {
        it(`preserves ${section} retry focus after ${empty ? 'empty' : 'populated'} recovery in ${lang}`, async () => {
          const analysis = section !== 'encounters';
          const method = analysis ? 'players.report' : 'players.profile';
          const response = deferred<RpcOutputs[typeof method]>();
          const native = nativeFixture(initial(), {
            [method]: ({ force }: { force?: boolean }) => {
              if (!force) throw new Error('Initial source failure');
              return response.promise;
            },
          });
          render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
          await screen.findByText('Initial source failure');
          await userEvent.click(screen.getByRole('tab', { name: new RegExp(text(section)) }));
          const pane = screen.getByRole('tabpanel');
          const button = within(pane).getByRole('button', {
            name: text(analysis ? 'retryAnalysis' : 'retry'),
          });
          await activate(button);
          await pending(button);
          expect(callsFor(native, method)).toBe(2);
          const value = analysis
            ? { ...full(), ...(empty ? { recentMatches: [], mapStats: [] } : {}) }
            : {
                ...structuredClone(capturedProfiles[id]!),
                ...(empty ? { encounters: [] } : {}),
              };
          await act(async () => response.resolve(value));
          await waitFor(() =>
            expect(button.textContent).toBe(
              text(analysis ? 'refreshAnalysis' : 'refreshEncounters'),
            ),
          );
          expect(document.activeElement).toBe(button);
          if (empty)
            expect(
              within(pane).getByText(
                text(
                  analysis
                    ? section === 'mapStatistics'
                      ? 'noMapStatistics'
                      : 'noMatchStatistics'
                    : 'noEncounters',
                ),
              ),
            ).toBeTruthy();
          await userEvent.tab();
          expect(document.activeElement).not.toBe(button);
        });
      }
    }
    it(`does not carry a recovery action or late result into another player's profile in ${lang}`, async () => {
      const old = deferred<RpcOutputs['players.report']>();
      const native = nativeFixture(initial(), {
        'players.report': ({ id: requested, force }) => {
          if (requested !== id) return structuredClone(capturedReports[requested]!);
          if (!force) throw new Error('Old identity source failure');
          return old.promise;
        },
      });
      const rendered = render(<ProfileDialog id={id} name="Target" />, {
        wrapper: wrapper(native.api),
      });
      await screen.findByText('Old identity source failure');
      const status = document.querySelector('[data-report-status]')! as HTMLElement;
      await activate(within(status).getByRole('button', { name: text('retry') }));
      const close = screen.getByRole('button', { name: text('close') });
      close.focus();
      rendered.rerender(<ProfileDialog id={secondPlayer.id} name={secondPlayer.name} />);
      await screen.findByRole('dialog', { name: new RegExp('#' + secondPlayer.id) });
      await act(async () => old.resolve(full()));
      expect(document.activeElement).toBe(close);
      expect(document.querySelector('[data-report-status]')).not.toBe(status);
      expect(screen.queryByText(text('refreshAnalysis'))).toBeNull();
      expect(screen.queryByText('Old identity source failure')).toBeNull();
    });
    it(`keeps a focused report recovery action when shared data recovers before activation in ${lang}`, async () => {
      const native = nativeFixture(initial());
      const failure = {
        pending: false,
        data: full(),
        error: 'Shared report failure',
        failedAt: 1000,
        details: { matches: null, maps: null },
      };
      const rendered = render(<PlayerReportStatus request={failure} onRetry={() => {}} />, {
        wrapper: wrapper(native.api),
      });
      const button = await screen.findByRole('button', { name: text('retry') });
      await act(async () => button.focus());
      rendered.rerender(
        <PlayerReportStatus request={{ ...failure, error: null }} onRetry={() => {}} />,
      );
      expect(document.activeElement).toBe(button);
      expect(button.textContent).toBe(text('refreshAnalysis'));
    });
    it(`resets encounter recovery ownership without resetting its selected tab in ${lang}`, async () => {
      const native = nativeFixture(initial());
      const retry = vi.fn();
      const rendered = render(
        <ProfileRecords
          profile={null}
          report={full()}
          recoveryKey="first-account"
          onRetryProfile={retry}
        />,
        { wrapper: wrapper(native.api) },
      );
      const tab = await screen.findByRole('tab', { name: new RegExp(text('encounters')) });
      await userEvent.click(tab);
      const button = within(screen.getByRole('tabpanel')).getByRole('button', {
        name: text('retry'),
      });
      await activate(button);
      expect(retry).toHaveBeenCalledTimes(1);
      tab.focus();
      rendered.rerender(
        <ProfileRecords
          profile={structuredClone(capturedProfiles[id]!)}
          report={full()}
          recoveryKey="second-account"
          onRetryProfile={retry}
        />,
      );
      expect(document.activeElement).toBe(tab);
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(button.isConnected).toBe(false);
      expect(
        within(screen.getByRole('tabpanel')).queryByText(text('refreshEncounters')),
      ).toBeNull();
    });
    it(`preserves the local-profile error action while its error clears and after success in ${lang}`, async () => {
      const response = deferred<PlayerProfile>();
      const native = nativeFixture(initial(), {
        'players.profile': ({ force }) => {
          if (!force) throw new Error('Local-profile source failure');
          return response.promise;
        },
      });
      render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
      await screen.findByText('Local-profile source failure');
      const button = within(screen.getByRole('dialog')).getByRole('button', {
        name: text('retry'),
      });
      await activate(button);
      await pending(button);
      expect(screen.queryByText('Local-profile source failure')).toBeNull();
      expect(callsFor(native, 'players.profile')).toBe(2);
      await act(async () => response.resolve(structuredClone(capturedProfiles[id]!)));
      await waitFor(() => expect(button.textContent).toBe(text('refreshEncounters')));
      expect(document.activeElement).toBe(button);
    });
  }
});

describe('report availability and shared refresh recovery', () => {
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, vars?: Record<string, string | number>) =>
      translate(lang, key, vars);
    const id = localPlayer.id;
    const initial = () => {
      const value = bootstrapForApp();
      value.config.lang = lang;
      value.config.panelOrder = ['players'];
      return value;
    };
    const full = (overrides: Partial<RpcOutputs['players.report']> = {}) =>
      reportFixture({ id, name: 'Recovery target', ...overrides });
    const tab = (key: string) => screen.getByRole('tab', { name: new RegExp(text(key)) });
    const pane = () => screen.getByRole('tabpanel');
    const basic = () =>
      full({
        fallback: true,
        elo: 1500,
        matchCount: 20,
        recentMatches: [],
        mapStats: [],
        detailAvailability: { matches: false, maps: false },
      });

    it(`distinguishes delayed, failed and recovered report sections in ${lang}`, async () => {
      const first = deferred<RpcOutputs['players.report']>();
      const native = nativeFixture(initial(), {
        'players.report': ({ force }) => (force ? full() : first.promise),
      });
      render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
      await screen.findByRole('tab', { name: new RegExp(text('matchStatistics')) });
      expect(tab('matchStatistics').querySelector('.profile-tab-count')?.textContent).toBe('—');
      expect(screen.queryByText(text('noMatchStatistics'))).toBeNull();
      await act(async () => first.reject(new Error('Detailed report unavailable')));
      await screen.findByText(text('reportRequestFailed'));
      expect(screen.getByText(text('reportRecordsUnavailable'))).toBeTruthy();
      await userEvent.click(tab('mapStatistics'));
      expect(tab('mapStatistics').querySelector('.profile-tab-count')?.textContent).toBe('—');
      expect(screen.queryByText(text('noMapStatistics'))).toBeNull();
      await userEvent.click(within(pane()).getByRole('button', { name: text('retryAnalysis') }));
      await screen.findByRole('table', { name: text('mapStatistics') });
      expect(tab('mapStatistics').querySelector('.profile-tab-count')?.textContent).toBe(
        String(full().mapStats.length),
      );
      expect(native.calls).toContainEqual({ method: 'players.report', input: { id, force: true } });
    });

    it(`keeps independently loaded report data when encounter records fail in ${lang}`, async () => {
      const first = deferred<PlayerProfile>();
      const recovered = {
        ...structuredClone(capturedProfiles[id]!),
        encounters: [
          {
            matchId: '12345',
            map: 'Recovered encounter',
            at: 1000,
            accountId: id,
            accountName: 'Local',
            relation: 'same' as const,
            won: true,
            custom: false,
          },
        ],
      };
      const native = nativeFixture(initial(), {
        'players.profile': ({ force }) => (force ? recovered : first.promise),
      });
      render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
      await screen.findByRole('table', { name: text('matchStatistics') });
      await userEvent.click(tab('encounters'));
      expect(tab('encounters').querySelector('.profile-tab-count')?.textContent).toBe('—');
      expect(screen.queryByText(text('noEncounters'))).toBeNull();
      await act(async () => first.reject(new Error('Local record read failed')));
      await screen.findByText(text('encounterRequestFailed'));
      expect(screen.getByText(text('encounterRecordsUnavailable'))).toBeTruthy();
      await userEvent.click(tab('matchStatistics'));
      expect(screen.getByRole('table', { name: text('matchStatistics') })).toBeTruthy();
      await userEvent.click(tab('encounters'));
      await userEvent.click(within(pane()).getByRole('button', { name: text('retry') }));
      await screen.findByRole('button', { name: 'Recovered encounter #12345' });
      expect(tab('encounters').querySelector('.profile-tab-count')?.textContent).toBe('1');
    });

    it(`distinguishes basic fallback from a genuinely empty detailed result in ${lang}`, async () => {
      const native = nativeFixture(initial(), {
        'players.report': ({ force }) =>
          force
            ? full({
                recentMatches: [],
                mapStats: [],
                detailAvailability: { matches: true, maps: true },
              })
            : basic(),
      });
      render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
      await screen.findByText(text('reportBasicOnly'));
      expect(tab('matchStatistics').querySelector('.profile-tab-count')?.textContent).toBe('—');
      expect(screen.queryByText(text('noMatchStatistics'))).toBeNull();
      expect(screen.getByText('1,500')).toBeTruthy();
      await userEvent.click(within(pane()).getByRole('button', { name: text('retryAnalysis') }));
      await screen.findByText(text('noMatchStatistics'));
      expect(tab('matchStatistics').querySelector('.profile-tab-count')?.textContent).toBe('0');
      await userEvent.click(tab('mapStatistics'));
      expect(screen.getByText(text('noMapStatistics'))).toBeTruthy();
      expect(tab('mapStatistics').querySelector('.profile-tab-count')?.textContent).toBe('0');
    });

    async function selectSearchPlayer(native: ReturnType<typeof nativeFixture>) {
      history.replaceState(null, '', '#players');
      render(<App />, { wrapper: wrapper(native.api) });
      fireEvent.change(await screen.findByRole('searchbox', { name: text('searchLabel') }), {
        target: { value: localPlayer.name },
      });
      await userEvent.click(screen.getByRole('button', { name: text('search') }));
      await userEvent.click(
        await within(document.querySelector<HTMLElement>('.player-results-card')!).findByRole(
          'button',
          { name: new RegExp('^' + localPlayer.name) },
        ),
      );
      await screen.findByRole('heading', { name: `Recovery target #${id}` });
    }
    it(`reconciles the search report after a successful detail refresh without reselecting in ${lang}`, async () => {
      const native = nativeFixture(initial(), {
        'players.report': ({ force }) =>
          force ? full({ elo: 1800, updatedAt: Date.now() }) : basic(),
      });
      await selectSearchPlayer(native);
      const searchReport = document.querySelector('.report')! as HTMLElement;
      expect(within(searchReport).getByText(text('reportBasicOnly'))).toBeTruthy();
      await userEvent.click(
        within(searchReport).getByRole('button', { name: text('investigate') }),
      );
      const dialog = await screen.findByRole('dialog');
      await waitFor(() =>
        expect(
          within(dialog)
            .getByRole('button', { name: text('refresh') })
            .getAttribute('aria-busy'),
        ).toBe('false'),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: text('refresh') }));
      await within(dialog).findByRole('table', { name: text('matchStatistics') });
      const count = native.calls.filter((call) => call.method === 'players.report').length;
      await userEvent.click(within(dialog).getByRole('button', { name: text('close') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(within(searchReport).getByRole('table', { name: text('recent') })).toBeTruthy();
      expect(within(searchReport).getByText('1,800')).toBeTruthy();
      expect(within(searchReport).queryByText(text('reportBasicOnly'))).toBeNull();
      expect(native.calls.filter((call) => call.method === 'players.report')).toHaveLength(count);
    });

    it(`identifies the failed source and retained report during a partial profile refresh in ${lang}`, async () => {
      const failed = deferred<RpcOutputs['players.report']>();
      let forceCount = 0;
      const native = nativeFixture(initial(), {
        'players.profile': ({ force }) => ({
          ...structuredClone(capturedProfiles[id]!),
          name: force ? 'Updated profile name' : 'Original profile name',
        }),
        'players.report': ({ force }) =>
          !force
            ? full({ elo: 1501, updatedAt: 1000 })
            : ++forceCount === 1
              ? failed.promise
              : full({ elo: 1800, updatedAt: Date.now() }),
      });
      render(<ProfileDialog id={id} name="Target" />, { wrapper: wrapper(native.api) });
      await screen.findByText('1,501');
      await userEvent.click(screen.getByRole('button', { name: text('refresh') }));
      await screen.findByRole('dialog', { name: `Updated profile name · #${id}` });
      expect(screen.getByText('1,501')).toBeTruthy();
      await act(async () => failed.reject(new Error('Generic transport failure')));
      await screen.findByText(text('reportRequestFailed'));
      expect(
        screen.getAllByText(text('reportPreviousResult', { time: formatTime(1000, lang) })).length,
      ).toBeGreaterThan(0);
      expect(screen.getByText('1,501')).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: text('refresh') }));
      await screen.findByText('1,800');
      expect(screen.queryByText(text('reportRequestFailed'))).toBeNull();
    });

    it(`retains the failed recalculation score in details and search, then recovers in ${lang}`, async () => {
      const rows = (rank: number) =>
        Array.from({ length: 12 }, (_, i) => ({
          matchId: String(i + 1),
          won: true,
          mvpRank: rank,
          killRank: rank,
          lossRank: rank,
          kdRank: rank,
          eloDelta: 20,
        }));
      const first = summarizeMaggot(id, rows(2)),
        last = summarizeMaggot(id, rows(8));
      const failure = deferred<RpcOutputs['players.maggot']>();
      let calls = 0;
      const native = nativeFixture(initial(), {
        'players.report': () => full(),
        'players.maggot': () => (++calls === 1 ? first : calls === 2 ? failure.promise : last),
      });
      await selectSearchPlayer(native);
      await waitFor(() =>
        expect(document.querySelector('.maggot-score')?.textContent).toBe(
          formatMetric(first.index, 1),
        ),
      );
      await userEvent.click(
        within(document.querySelector('.report')! as HTMLElement).getByRole('button', {
          name: text('investigate'),
        }),
      );
      const dialog = await screen.findByRole('dialog');
      await waitFor(() =>
        expect(
          within(dialog)
            .getByRole('button', { name: text('refresh') })
            .getAttribute('aria-busy'),
        ).toBe('false'),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: text('refresh') }));
      await waitFor(() => expect(calls).toBe(2));
      expect(
        within(dialog)
          .getByRole('region', { name: text('maggot') })
          .querySelector('.maggot-score')?.textContent,
      ).toBe(formatMetric(first.index, 1));
      await act(async () => failure.reject(new Error('Recalculation unavailable')));
      await within(dialog).findByText('Recalculation unavailable');
      expect(
        within(dialog)
          .getByRole('region', { name: text('maggot') })
          .querySelector('.maggot-score')?.textContent,
      ).toBe(formatMetric(first.index, 1));
      await userEvent.click(within(dialog).getByRole('button', { name: text('close') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const card = screen.getByRole('region', { name: text('maggot') });
      expect(card.querySelector('.maggot-score')?.textContent).toBe(formatMetric(first.index, 1));
      expect(within(card).getByText(/Previous calculation|上次计算结果/)).toBeTruthy();
      await userEvent.click(within(card).getByRole('button', { name: text('retry') }));
      await waitFor(() =>
        expect(card.querySelector('.maggot-score')?.textContent).toBe(formatMetric(last.index, 1)),
      );
      expect(within(card).queryByText('Recalculation unavailable')).toBeNull();
    });
  }
});

describe('profile identity and stable navigation', () => {
  function fixture(lang: 'zh' | 'en') {
    const p = deferred<PlayerProfile>(),
      r = deferred<RpcOutputs['players.report']>();
    let next: {
      p: ReturnType<typeof deferred<PlayerProfile>>;
      r: ReturnType<typeof deferred<RpcOutputs['players.report']>>;
    } | null = null;
    const historical = ['H'.repeat(56) + '-SUFFIX', 'Old '.repeat(52).slice(0, 196) + '-SUFFIX'];
    const profile: PlayerProfile = {
      ...structuredClone(capturedProfiles[localPlayer.id]!),
      id: localPlayer.id,
      name: 'Current profile short',
      names: historical.map((name, index) => ({
        name,
        firstSeen: 1700000000000 + index,
        lastSeen: 1700000000000 + index,
      })),
      encounters: [1, 2].map((index) => ({
        matchId: String(99120 + index),
        map: 'Dam',
        at: null,
        relation: 'same',
        won: null,
        custom: false,
      })),
    };
    const report = reportFixture({ id: localPlayer.id, name: 'Report short', elo: 1601 });
    const value = bootstrapForApp();
    value.config.lang = lang;
    const native = nativeFixture(value, {
      'players.profile': ({ force }) => (force && next ? next.p.promise : p.promise),
      'players.report': ({ force }) => (force && next ? next.r.promise : r.promise),
      'external.open': async () => null,
    });
    const resolve = async (kind: 'profile' | 'report') =>
      act(async () => {
        if (kind === 'profile') p.resolve(profile);
        else r.resolve(report);
      });
    return {
      p,
      r,
      profile,
      report,
      historical,
      native,
      resolve,
      reload: () =>
        (next = { p: deferred<PlayerProfile>(), r: deferred<RpcOutputs['players.report']>() }),
    };
  }
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    for (const first of ['profile', 'report'] as const) {
      it(`retains the header, active tab and all count contexts when ${first} arrives first in ${lang}`, async () => {
        const f = fixture(lang);
        render(<ProfileDialog id={localPlayer.id} name="Opened short" />, {
          wrapper: wrapper(f.native.api),
        });
        const map = await screen.findByRole('tab', { name: new RegExp(text('mapStatistics')) });
        const allTabs = screen.getAllByRole('tab');
        const header = screen
          .getByRole('button', { name: text('close') })
          .closest('[data-slot=dialog-header]')!;
        const actions = Array.from(header.querySelectorAll('button'));
        expect(map.closest('.dialog-body')).toBeNull();
        await userEvent.click(map);
        await f.resolve(first);
        expect(screen.getByRole('tab', { name: new RegExp(text('mapStatistics')) })).toBe(map);
        expect(map.getAttribute('aria-selected')).toBe('true');
        await f.resolve(first === 'profile' ? 'report' : 'profile');
        expect(screen.getAllByRole('tab')).toEqual(allTabs);
        expect(Array.from(header.querySelectorAll('button'))).toEqual(actions);
        expect(map.getAttribute('aria-selected')).toBe('true');
        expect(map.querySelector('.profile-tab-count')?.textContent).toBe(
          String(f.report.mapStats.length),
        );
        const encounters = screen.getByRole('tab', { name: new RegExp(text('encounters')) });
        expect(encounters.querySelector('.profile-tab-count')?.textContent).toBe('2');
        expect(document.activeElement).toBe(map);
      });
    }
    for (const failed of ['profile', 'report'] as const)
      for (const first of ['profile', 'report'] as const) {
        it(`keeps navigation and independent recovery when ${failed} fails with ${first} first in ${lang}`, async () => {
          const f = fixture(lang);
          render(<ProfileDialog id={localPlayer.id} name="Opened short" />, {
            wrapper: wrapper(f.native.api),
          });
          const tab = await screen.findByRole('tab', { name: new RegExp(text('encounters')) });
          await userEvent.click(tab);
          const settle = async (kind: 'profile' | 'report') => {
            if (kind === failed)
              await act(async () => {
                (kind === 'profile' ? f.p : f.r).reject(
                  new Error('Controlled ' + kind + ' failure'),
                );
              });
            else await f.resolve(kind);
          };
          await settle(first);
          await settle(first === 'profile' ? 'report' : 'profile');
          await screen.findByText(
            text(failed === 'profile' ? 'encounterRequestFailed' : 'reportRequestFailed'),
          );
          expect(screen.getByRole('tab', { name: new RegExp(text('encounters')) })).toBe(tab);
          expect(tab.getAttribute('aria-selected')).toBe('true');
          expect(document.activeElement).toBe(tab);
          const refresh = screen.getByRole('button', { name: text('refresh') });
          expect(refresh.getAttribute('aria-disabled')).toBe('false');
          const copy = within(refresh.closest('[data-slot=dialog-header]')!).getByRole('button', {
            name: text('copy'),
          });
          expect(copy.getAttribute('aria-disabled')).toBe(String(failed === 'report'));
          const identity = screen.getByRole('region', { name: text('profileIdentity') });
          expect(identity.querySelector('[data-profile-full-name]')?.textContent).toBe(
            failed === 'profile' ? f.report.name : f.profile.name,
          );
        });
      }
    for (const first of ['profile', 'report'] as const) {
      it(`keeps selected content and header focus through a partial refresh with ${first} first in ${lang}`, async () => {
        const f = fixture(lang);
        render(<ProfileDialog id={localPlayer.id} name="Opened short" />, {
          wrapper: wrapper(f.native.api),
        });
        await f.resolve('profile');
        await f.resolve('report');
        const tab = await screen.findByRole('tab', { name: new RegExp(text('mapStatistics')) });
        await userEvent.click(tab);
        const content = document.querySelector('.profile-records');
        const next = f.reload();
        const refresh = screen.getByRole('button', { name: text('refresh') });
        await userEvent.click(refresh);
        await userEvent.keyboard(' {Enter}');
        expect(f.native.calls.filter((call) => call.method === 'players.profile')).toHaveLength(2);
        expect(f.native.calls.filter((call) => call.method === 'players.report')).toHaveLength(2);
        await act(async () => {
          if (first === 'profile') next.p.reject(new Error('Controlled refresh failure'));
          else next.r.resolve({ ...f.report, elo: 1801 });
        });
        expect(document.querySelector('.profile-records')).toBe(content);
        expect(refresh.getAttribute('aria-disabled')).toBe('true');
        expect(document.activeElement).toBe(refresh);
        await act(async () => {
          if (first === 'profile') next.r.resolve({ ...f.report, elo: 1801 });
          else next.p.reject(new Error('Controlled refresh failure'));
        });
        await screen.findByText(text('encounterRequestFailed'));
        expect(refresh.getAttribute('aria-disabled')).toBe('false');
        expect(document.activeElement).toBe(refresh);
        expect(tab.getAttribute('aria-selected')).toBe('true');
        expect(document.querySelector('.profile-records')).toBe(content);
      });
    }
    for (const [length, spaced] of [
      [43, false],
      [81, false],
      [152, true],
      [203, true],
    ] as const) {
      it(`exposes the complete ${length}-character identity and distinct historical suffixes in ${lang}`, async () => {
        const f = fixture(lang),
          value =
            (spaced ? 'Abc '.repeat(length) : 'N'.repeat(length)).slice(0, length - 7) + '-SUFFIX';
        f.profile.name = value;
        render(<ProfileDialog id={localPlayer.id} name="Opened roster name" />, {
          wrapper: wrapper(f.native.api),
        });
        await f.resolve('report');
        await f.resolve('profile');
        const identity = await screen.findByRole('region', { name: text('profileIdentity') });
        expect(identity.querySelector('[data-profile-full-name]')?.textContent).toBe(value);
        expect(identity.querySelector('[data-profile-opened-name]')?.textContent).toBe(
          'Opened roster name',
        );
        expect(within(identity).getByText('#' + localPlayer.id)).toBeTruthy();
        const dialog = screen.getByRole('dialog', { name: value + ' · #' + localPlayer.id });
        const ids = (dialog.getAttribute('aria-describedby') ?? '').split(/\s+/);
        expect(ids.map((id) => document.getElementById(id)?.textContent).join(' ')).toContain(
          text('profileIdentityHint'),
        );
        await userEvent.click(
          screen.getByRole('button', { name: new RegExp('^' + text('names')) }),
        );
        for (const [index, name] of f.historical.entries()) {
          const entry = screen.getByText(name, { selector: '.profile-alias strong' });
          expect(
            within(entry.closest('.profile-alias')!).getByText(
              formatTime(f.profile.names[index]!.lastSeen, lang),
            ),
          ).toBeTruthy();
        }
      });
    }
    it(`keeps the same Copy action unavailable until its report exists in ${lang}`, async () => {
      const f = fixture(lang),
        user = userEvent.setup();
      const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
      render(<ProfileDialog id={localPlayer.id} name="Opened short" />, {
        wrapper: wrapper(f.native.api),
      });
      const copy = await screen.findByRole('button', { name: text('copy') });
      expect(copy.getAttribute('aria-disabled')).toBe('true');
      await user.click(copy);
      expect(copied).not.toHaveBeenCalled();
      await f.resolve('profile');
      expect(copy.getAttribute('aria-disabled')).toBe('true');
      await f.resolve('report');
      expect(screen.getByRole('button', { name: text('copy') })).toBe(copy);
      expect(copy.getAttribute('aria-disabled')).toBe('false');
      await user.click(copy);
      expect(copied).toHaveBeenCalledTimes(1);
      expect(copied.mock.calls[0]![0]).toContain(f.report.name);
    });
    it(`keeps arrow selection connected to its fixed navigation context in ${lang}`, async () => {
      const f = fixture(lang),
        user = userEvent.setup();
      render(<ProfileDialog id={localPlayer.id} name="Opened short" />, {
        wrapper: wrapper(f.native.api),
      });
      await f.resolve('profile');
      await f.resolve('report');
      const first = await screen.findByRole('tab', { name: new RegExp(text('matchStatistics')) });
      first.focus();
      await user.keyboard('{ArrowRight}');
      const encounters = screen.getByRole('tab', { name: new RegExp(text('encounters')) });
      expect(encounters.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(encounters);
      expect(screen.getByRole('table', { name: text('encounters') })).toBeTruthy();
      await user.keyboard('{ArrowRight}');
      const maps = screen.getByRole('tab', { name: new RegExp(text('mapStatistics')) });
      expect(maps.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(maps);
    });
  }
});

describe('encounter identity and local details', () => {
  function fixture(lang: 'zh' | 'en', kind: 'local' | 'legacy' | 'numeric', long = false) {
    const ids =
      kind === 'numeric'
        ? ['91001', '91002']
        : [`${kind}:${long ? 'x'.repeat(122) : 'session-a'}`, `${kind}:session-b`];
    const records = new Map(
      ids.map((id) => [
        id,
        matchFixture({
          id,
          fid: kind === 'numeric' ? id : null,
          sessionId: id,
          map: 'Dam',
          endedAt: null,
          localPlayerId: localPlayer.id,
        }),
      ]),
    );
    const profile: PlayerProfile = {
      id: secondPlayer.id,
      name: secondPlayer.name,
      names: [],
      firstSeen: null,
      lastSeen: null,
      banned: null,
      info: null,
      recentMatches: [],
      recentError: null,
      latestElo: null,
      encounters: ids.map((matchId) => ({
        matchId,
        map: 'Dam',
        at: null,
        relation: 'same',
        won: null,
        custom: false,
        accountId: localPlayer.id,
        accountName: localPlayer.name,
      })),
    };
    const initial = bootstrapForApp();
    initial.config.lang = lang;
    let held: ReturnType<typeof deferred<Match>> | null = null;
    const native = nativeFixture(initial, {
      'matches.list': () => [...records.values()],
      'players.profile': () => structuredClone(profile),
      'players.report': ({ id }) =>
        reportFixture({ id, name: secondPlayer.name, recentMatches: [] }),
      'matches.detail': async ({ fid, accountId }) => {
        const gate = held;
        held = null;
        const match = gate ? await gate.promise : records.get(fid);
        if (!match) throw new Error('LOCAL_MATCH_UNAVAILABLE');
        return { ...structuredClone(match), localPlayerId: accountId ?? match.localPlayerId };
      },
      'accounts.list': () => [
        { ...capturedAccounts[0]!, id: localPlayer.id, name: localPlayer.name },
        { ...capturedAccounts[0]!, id: secondPlayer.id, name: secondPlayer.name },
      ],
      'external.open': async () => null,
    });
    return {
      native,
      ids,
      records,
      profile,
      hold: (value: ReturnType<typeof deferred<Match>>) => {
        held = value;
      },
    };
  }
  const description = (element: HTMLElement) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string) => translate(lang, key);
    it(`scrolls the encounter region without intercepting its action keys in ${lang}`, async () => {
      const f = fixture(lang, 'local');
      render(<ProfileRecords profile={f.profile} report={null} tab="encounters" />, {
        wrapper: wrapper(f.native.api),
      });
      const region = await screen.findByRole('region', { name: text('encounters') });
      expect(region.tabIndex).toBe(0);
      expect(description(region)).toBe(text('encounterScrollHint'));
      fireEvent.keyDown(region, { key: 'ArrowRight' });
      expect(region.scrollLeft).toBe(80);
      fireEvent.keyDown(region, { key: 'ArrowLeft' });
      expect(region.scrollLeft).toBe(0);
      fireEvent.keyDown(within(region).getByRole('button', { name: `Dam #${f.ids[0]}` }), {
        key: 'ArrowRight',
      });
      expect(region.scrollLeft).toBe(0);
    });
    for (const kind of ['local', 'legacy', 'numeric'] as const) {
      it(`distinguishes undated same-map ${kind} encounters before opening either in ${lang}`, async () => {
        const f = fixture(lang, kind);
        render(
          <>
            <ProfileRecords profile={f.profile} report={null} tab="encounters" />
            <App />
          </>,
          { wrapper: wrapper(f.native.api) },
        );
        const table = await screen.findByRole('table', { name: text('encounters') });
        const rows = within(table).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.textContent).not.toBe(rows[1]!.textContent);
        for (const [index, id] of f.ids.entries()) {
          const button = within(table).getByRole('button', { name: `Dam #${id}` });
          expect(within(rows[index]!).getByText('#' + id)).toBeTruthy();
          expect(description(button)).toContain(text('encounterEndUnknown'));
          expect(description(button)).toContain(text('same'));
          expect(description(button)).toContain(text('unknown'));
          expect(description(button)).toContain(localPlayer.id);
          await userEvent.click(button);
          const dialog = await screen.findByRole('dialog', {
            name: new RegExp(kind === 'numeric' ? '#' + id + '$' : text('localMatch') + '$'),
          });
          await within(dialog).findByRole('heading', { name: 'Dam' });
          expect(within(dialog).queryByRole('alert')).toBeNull();
          expect(!!within(dialog).queryByRole('button', { name: text('openBatrace') })).toBe(
            kind === 'numeric',
          );
          const calls = f.native.calls.filter((call) => call.method === 'matches.detail');
          expect(calls.at(-1)?.input).toMatchObject({ fid: id, accountId: localPlayer.id });
          if (kind !== 'numeric') expect(description(dialog)).toContain(id);
          await userEvent.click(within(dialog).getByRole('button', { name: text('close') }));
          await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
          expect(document.activeElement).toBe(button);
        }
        expect(f.native.calls.filter((call) => call.method === 'matches.detail')).toHaveLength(2);
      });
    }
    for (const kind of ['local', 'legacy'] as const) {
      it(`reloads, qualifies retained ${kind} details after deletion, and recovers in ${lang}`, async () => {
        const f = fixture(lang, kind),
          id = f.ids[0]!;
        render(<MatchDialog fid={id} accountId={localPlayer.id} />, {
          wrapper: wrapper(f.native.api),
        });
        await screen.findByRole('heading', { name: 'Dam' });
        fireEvent.change(screen.getByLabelText(text('matchPerspective')), {
          target: { value: secondPlayer.id },
        });
        await waitFor(() =>
          expect(
            f.native.calls.filter((call) => call.method === 'matches.detail').at(-1)?.input,
          ).toMatchObject({ accountId: secondPlayer.id }),
        );
        f.records.set(id, { ...f.records.get(id)!, map: 'Reloaded local map' });
        const reload = screen.getByRole('button', { name: text('localMatchRefresh') });
        await userEvent.click(reload);
        await screen.findByRole('heading', { name: 'Reloaded local map' });
        expect(document.activeElement).toBe(reload);
        f.records.delete(id);
        await userEvent.click(reload);
        await screen.findByText(text('localMatchUnavailable'));
        expect(screen.getByText(text('localMatchRetained'))).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Reloaded local map' })).toBeTruthy();
        expect(screen.queryByText('LOCAL_MATCH_UNAVAILABLE')).toBeNull();
        expect(document.activeElement).toBe(reload);
        f.records.set(id, matchFixture({ id, fid: null, map: 'Restored local map' }));
        await userEvent.click(reload);
        await screen.findByRole('heading', { name: 'Restored local map' });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByLabelText<HTMLSelectElement>(text('matchPerspective')).value).toBe(
          secondPlayer.id,
        );
        expect(screen.queryByRole('button', { name: text('openBatrace') })).toBeNull();
        expect(f.native.calls.filter((call) => call.method === 'external.open')).toHaveLength(0);
      });
    }
    it(`retains focus and rejects duplicate local reloads while pending in ${lang}`, async () => {
      const f = fixture(lang, 'local'),
        id = f.ids[0]!;
      render(<MatchDialog fid={id} />, { wrapper: wrapper(f.native.api) });
      await screen.findByRole('heading', { name: 'Dam' });
      const gate = deferred<Match>();
      f.hold(gate);
      const reload = screen.getByRole('button', { name: text('localMatchRefresh') });
      await userEvent.click(reload);
      expect(reload.getAttribute('aria-disabled')).toBe('true');
      expect(reload.hasAttribute('disabled')).toBe(false);
      await userEvent.keyboard(' {Enter}');
      expect(f.native.calls.filter((call) => call.method === 'matches.detail')).toHaveLength(2);
      expect(document.activeElement).toBe(reload);
      await act(async () => gate.resolve(f.records.get(id)!));
      await waitFor(() => expect(reload.getAttribute('aria-disabled')).toBe('false'));
      expect(document.activeElement).toBe(reload);
    });
    it(`uses a known numeric destination when a local key has an online ID in ${lang}`, async () => {
      const f = fixture(lang, 'local'),
        id = f.ids[0]!;
      f.records.set(id, { ...f.records.get(id)!, fid: '91009' });
      render(<MatchDialog fid={id} />, { wrapper: wrapper(f.native.api) });
      await screen.findByRole('heading', { name: 'Dam' });
      expect(screen.queryByText(text('localMatchOnlineUnavailable'))).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: text('openBatrace') }));
      expect(f.native.calls.find((call) => call.method === 'external.open')?.input).toEqual({
        url: 'https://dash.batrace.top/match/91009',
      });
    });
    it(`keeps a full local reference out of the control header in ${lang}`, async () => {
      const f = fixture(lang, 'local', true),
        id = f.ids[0]!;
      render(<MatchDialog fid={id} />, { wrapper: wrapper(f.native.api) });
      const dialog = await screen.findByRole('dialog', {
        name: `${text('matchDetail')} · ${text('localMatch')}`,
      });
      await screen.findByRole('heading', { name: 'Dam' });
      expect(within(dialog).getByText('#' + id, { selector: 'code' })).toBeTruthy();
      expect(description(dialog)).toContain(id);
      expect(dialog.querySelector('[data-slot=dialog-title]')?.textContent).not.toContain(id);
    });
    for (const kind of ['local', 'numeric'] as const) {
      it(`returns from ${kind} detail to the same profile encounter and perspective in ${lang}`, async () => {
        const f = fixture(lang, kind),
          id = f.ids[0]!;
        function Launcher() {
          const { openModal } = useApp();
          return (
            <button
              onClick={() =>
                openModal({ type: 'profile', id: secondPlayer.id, name: secondPlayer.name })
              }
            >
              Open encounter profile
            </button>
          );
        }
        render(
          <>
            <Launcher />
            <App />
          </>,
          { wrapper: wrapper(f.native.api) },
        );
        await userEvent.click(
          await screen.findByRole('button', { name: 'Open encounter profile' }),
        );
        await userEvent.click(
          await screen.findByRole('tab', { name: new RegExp(text('encounters')) }),
        );
        const button = await screen.findByRole('button', { name: `Dam #${id}` });
        await userEvent.click(button);
        await screen.findByRole('heading', { name: 'Dam' });
        expect(screen.getByLabelText<HTMLSelectElement>(text('matchPerspective')).value).toBe(
          localPlayer.id,
        );
        await userEvent.click(screen.getByRole('button', { name: text('dialogBack') }));
        const returned = await screen.findByRole('button', { name: `Dam #${id}` });
        await waitFor(() => expect(document.activeElement).toBe(returned));
        expect(
          screen
            .getByRole('tab', { name: new RegExp(text('encounters')) })
            .getAttribute('aria-selected'),
        ).toBe('true');
      });
    }
  }
});

describe('shared report return readiness', () => {
  it.each(['zh', 'en'] as const)(
    'waits for the returning report and explains a removed source action in %s',
    async (lang) => {
      const id = localPlayer.id,
        value = bootstrapForApp();
      value.config.lang = lang;
      const original = reportFixture({
        id,
        recentMatches: Array.from({ length: 8 }, (_, index) => ({
          ...reportFixture().recentMatches[0]!,
          matchId: String(88001 + index),
        })),
      });
      const held = deferred<RpcOutputs['players.report']>();
      let reportCalls = 0;
      const native = nativeFixture(value, {
        'players.report': () => (++reportCalls === 1 ? original : held.promise),
        'matches.detail': ({ fid }) => matchFixture({ id: fid, fid }),
      });
      function Launcher() {
        const { openModal } = useApp();
        return (
          <button onClick={() => openModal({ type: 'profile', id, name: localPlayer.name })}>
            Open report return case
          </button>
        );
      }
      render(
        <>
          <Launcher />
          <App />
        </>,
        { wrapper: wrapper(native.api) },
      );
      await userEvent.click(await screen.findByRole('button', { name: 'Open report return case' }));
      const opener = await screen.findByRole('button', { name: '#88006' });
      opener.focus();
      await userEvent.click(opener);
      await screen.findByRole('dialog', { name: new RegExp('#88006$') });
      await userEvent.click(screen.getByRole('button', { name: translate(lang, 'dialogBack') }));
      await waitFor(() => expect(reportCalls).toBe(2));
      const staleSource = await screen.findByRole('button', { name: '#88006' });
      expect(document.activeElement).not.toBe(staleSource);
      await act(async () =>
        held.resolve({
          ...original,
          updatedAt: Date.now(),
          recentMatches: original.recentMatches.filter((match) => match.matchId !== '88006'),
        }),
      );
      await screen.findByText(translate(lang, 'dialogReturnUnavailable'));
      expect(document.activeElement).toBe(
        screen.getByRole('tab', { name: new RegExp(translate(lang, 'matchStatistics')) }),
      );
      expect(screen.queryByRole('button', { name: '#88006' })).toBeNull();
    },
  );
});

describe('profile refresh and report scopes', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`keeps report identities, dates, outcomes and metric access associated in ${lang}`, async () => {
      const bootstrap = bootstrapForApp();
      bootstrap.config.lang = lang;
      const native = nativeFixture(bootstrap);
      const report = reportFixture();
      report.recentMatches = [
        { ...report.recentMatches[0]!, matchId: '990001', won: true },
        { ...report.recentMatches[0]!, matchId: '990002', won: null, endTime: null },
      ];
      render(<ReportMatchTable report={report} label="Recent matches" />, {
        wrapper: wrapper(native.api),
      });
      const region = await screen.findByRole('region', { name: 'Recent matches' });
      expect(region.tabIndex).toBe(0);
      expect(region.getAttribute('aria-describedby')).toBeTruthy();
      Object.defineProperty(region, 'clientWidth', { value: 400 });
      fireEvent.keyDown(region, { key: 'ArrowRight' });
      expect(region.scrollLeft).toBe(200);
      fireEvent.keyDown(region, { key: 'ArrowLeft' });
      expect(region.scrollLeft).toBe(0);
      const first = within(region).getByRole('button', { name: '#990001' });
      const second = within(region).getByRole('button', { name: '#990002' });
      fireEvent.keyDown(first, { key: 'ArrowRight' });
      expect(region.scrollLeft).toBe(0);
      const description = (button: HTMLElement) =>
        button
          .getAttribute('aria-describedby')!
          .split(' ')
          .map((id) => document.getElementById(id)!.textContent)
          .join(' ');
      expect(description(first)).toBe(
        `${formatTime(report.recentMatches[0]!.endTime, lang)} ${translate(lang, 'win')}`,
      );
      expect(description(second)).toBe(
        `${translate(lang, 'matchTimeUnknown')} ${translate(lang, 'unknown')}`,
      );
      expect(within(region).getAllByRole('columnheader')).toHaveLength(8);
      for (const column of [
        'matchId',
        'time',
        'result',
        'eloDelta',
        'K/D',
        'DMR',
        'destruction',
        'losses',
        'objectives',
      ]) {
        expect(region.querySelector(`tbody [data-column="${column}"]`)).toBeTruthy();
      }
    });
  }

  it('marks ELO increases and decreases while leaving zero and missing values neutral', async () => {
    const native = nativeFixture(bootstrapForApp());
    const report = reportFixture();
    report.recentMatches = [20, -20, 0, null].map((eloDelta, index) => ({
      ...report.recentMatches[0]!,
      matchId: String(index + 1),
      eloDelta,
    }));
    render(<ReportMatchTable report={report} label="ELO changes" />, {
      wrapper: wrapper(native.api),
    });
    const table = await screen.findByRole('table', { name: 'ELO changes' });
    const cells = Array.from(table.querySelectorAll('td.elo-column'));
    expect(cells.map((cell) => cell.textContent)).toEqual(['+20.00', '-20.00', '0.00', '—']);
    expect(
      cells.map((cell) => [
        cell.classList.contains('elo-increase'),
        cell.classList.contains('elo-decrease'),
      ]),
    ).toEqual([
      [true, false],
      [false, true],
      [false, false],
      [false, false],
    ]);
  });

  it('keeps profile data available when automatic calculation fails and supports retry', async () => {
    let attempts = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'players.maggot': ({ id }) => {
        if (++attempts === 1) throw new Error('Analysis unavailable');
        return summarizeMaggot(id, []);
      },
    });
    render(<ProfileDialog id={localPlayer.id} name={localPlayer.name} />, {
      wrapper: wrapper(native.api),
    });
    await screen.findByText('Analysis unavailable');
    const card = screen.getByRole('region', { name: '蛐指数' });
    expect(within(card).getByRole('alert').textContent).toContain('Analysis unavailable');
    expect(screen.getByRole('heading', { name: '玩家概览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新' }).hasAttribute('disabled')).toBe(false);
    expect(attempts).toBe(1);
    fireEvent.click(within(card).getByRole('button', { name: '重试' }));
    await within(card).findByText('样本不足');
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(within(card).getByText('需要 12 场有效的五人队排位；当前 0 场。')).toBeTruthy();
    expect(card.querySelector('.maggot-score')?.textContent).toBe('—');
    expect(within(card).queryByText('稳定')).toBeNull();
    expect(within(card).queryByRole('button', { name: '查看计算明细' })).toBeNull();
    expect(attempts).toBe(2);
  });

  it('shows one profile summary and switches record tabs with the keyboard while retaining aliases', async () => {
    const profile: PlayerProfile = {
      id: localPlayer.id,
      name: 'Profile player',
      names: [
        { name: 'Profile player', firstSeen: 1000, lastSeen: 2000 },
        { name: 'Previous alias', firstSeen: 500, lastSeen: 900 },
      ],
      firstSeen: 500,
      lastSeen: 2000,
      encounters: [],
      banned: null,
      recentMatches: [matchFixture()],
      recentError: null,
      latestElo: 1995,
      info: {
        elo: 1995,
        kd: 1.66,
        winRate: 50,
        matchCount: 100,
        sampleCount: 100,
        category: null,
        topUnits: '',
        updatedAt: 1000,
        stale: true,
      },
    };
    const native = nativeFixture(bootstrapForApp(), {
      'players.profile': () => profile,
      'players.report': () =>
        reportFixture({ id: localPlayer.id, name: profile.name, elo: 1995, stale: true }),
    });
    render(<ProfileDialog id={localPlayer.id} name={profile.name} />, {
      wrapper: wrapper(native.api),
    });
    await screen.findByText('1,995');
    expect(screen.getAllByText('1,995')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '刷新' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '查蛆指数' })).toBeNull();
    expect(screen.getByRole('region', { name: '蛐指数' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: translate('zh', 'openBatrace') })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '复制' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '调查羁绊' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '相遇记录' })).toBeNull();
    expect(screen.getAllByText(/缓存数据，可能已过期/)).toHaveLength(1);
    const matchData = screen.getByRole('table', { name: '对局数据' });
    expect(within(matchData).getAllByRole('columnheader')).toHaveLength(8);
    expect(matchData.querySelectorAll('tbody [data-column="time"]')).toHaveLength(12);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.queryByRole('tab', { name: /^近期对局/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /^对局数据明细/ })).toBeNull();
    const user = userEvent.setup();
    const dataTab = screen.getByRole('tab', { name: /^对局数据/ });
    expect(dataTab.getAttribute('aria-selected')).toBe('true');
    dataTab.focus();
    await user.keyboard('{End}');
    const mapsTab = screen.getByRole('tab', { name: /^地图表现/ });
    await waitFor(() => expect(mapsTab.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('table', { name: '地图表现' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: '对局数据' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /^相遇记录/ }));
    expect(screen.getByText('暂无相遇记录')).toBeTruthy();
    await user.click(dataTab);
    expect(screen.getByRole('table', { name: '对局数据' })).toBeTruthy();
    const aliases = document.querySelector<HTMLElement>('.profile-name-history')!;
    expect(within(aliases).getByRole('button').getAttribute('aria-expanded')).toBe('false');
    await userEvent.setup().click(within(aliases).getByText('名字历史'));
    expect(within(aliases).getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(within(aliases).getByText('Previous alias')).toBeTruthy();
    expect(within(aliases).queryByText('Profile player')).toBeNull();
  });

  it('omits removed recent-list notices and keeps teammate outcomes separate from opponents', async () => {
    const profile: PlayerProfile = {
      id: localPlayer.id,
      name: 'Profile player',
      names: [],
      firstSeen: null,
      lastSeen: null,
      encounters: [
        { matchId: '1', at: 1000, map: 'Dam', relation: 'same', won: true, custom: false },
        {
          matchId: '2',
          at: 2000,
          map: 'Frontiers',
          relation: 'opponent',
          won: false,
          custom: false,
        },
        {
          matchId: '3',
          at: null,
          map: 'Unknown result',
          relation: 'same',
          won: null,
          custom: true,
        },
      ],
      banned: null,
      recentMatches: [matchFixture()],
      recentError: 'Recent matches are cached',
      latestElo: null,
      info: null,
    };
    const native = nativeFixture(bootstrapForApp(), {
      'players.profile': () => profile,
      'players.report': () =>
        reportFixture({
          winRate: null,
          mapStats: [
            { mapId: 1, name: 'Dam', matchCount: 5, winRate: 0 },
            { mapId: 2, name: 'Frontiers', matchCount: 0, winRate: null },
          ],
        }),
    });
    render(<ProfileDialog id={localPlayer.id} name={profile.name} />, {
      wrapper: wrapper(native.api),
    });
    await screen.findByRole('table', { name: '对局数据' });
    expect(screen.queryByText('正在显示缓存对局，刷新可获取最新记录。')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Recent matches are cached')).toBeNull();
    expect(screen.queryByText('—%')).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: '相遇记录 3' }));
    expect(screen.getByText('同队获胜').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('同队落败').nextElementSibling?.textContent).toBe('0');
    const encounters = screen.getByRole('table', { name: '相遇记录' });
    expect(within(encounters).getAllByRole('row')).toHaveLength(4);
    expect(within(encounters).getByText('自定义')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: '地图表现 2' }));
    const maps = screen.getByRole('table', { name: '地图表现' });
    expect(within(maps).getByText('0%')).toBeTruthy();
    expect(within(maps).getByText('—')).toBeTruthy();
    expect(screen.queryByRole('table', { name: '相遇记录' })).toBeNull();
  });

  it('keeps the latest profile ELO when the report is unavailable and no cached metrics exist', async () => {
    const native = nativeFixture(bootstrapForApp(), {
      'players.profile': () => ({
        id: localPlayer.id,
        name: 'Fallback player',
        names: [],
        firstSeen: null,
        lastSeen: null,
        encounters: [],
        banned: null,
        recentMatches: [],
        recentError: null,
        latestElo: 1456,
        info: null,
      }),
      'players.report': () => {
        throw new Error('Report unavailable');
      },
    });
    render(<ProfileDialog id={localPlayer.id} name="Fallback player" />, {
      wrapper: wrapper(native.api),
    });
    await screen.findByText('1,456');
    expect(screen.getByRole('alert').textContent).toContain('Report unavailable');
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.querySelector('.profile-name-history')).toBeNull();
  });

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
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'players.maggot')).toHaveLength(1),
    );
    expect(screen.getByText('最近一场 K/D')).toBeTruthy();
    expect(screen.getByText('最近一场 DMR')).toBeTruthy();
    expect(screen.getByText('总场次')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText('2,002');
    await waitFor(() =>
      expect(native.calls.filter((call) => call.method === 'players.maggot')).toHaveLength(2),
    );
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
    const recovery = await reviewSettingsFailure();
    const alert = await recovery.findByRole('alert');
    expect(alert.textContent).toContain('Preferences are read-only');
    fireEvent.click(recovery.getByRole('button', { name: '放弃未保存的更改' }));
    await waitFor(() => expect(recovery.queryByRole('alert')).toBeNull());
    fireEvent.click(recovery.getByRole('button', { name: '关闭' }));
    expect(screen.getByRole('button', { name: '折叠侧边栏' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(native.backend.config.sidebarCollapsed).toBe(initial.config.sidebarCollapsed);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const page = within(await screen.findByRole('main', { name: '设置' }));
    fireEvent.click(page.getByRole('button', { name: '森林 · 深色' }));
    const pageReview = await reviewSettingsFailure();
    expect((await pageReview.findByRole('alert')).textContent).toContain(
      'Preferences are read-only',
    );
    fireEvent.click(pageReview.getByRole('button', { name: '关闭' }));
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
    await screen.findByText('Connection timed out');
    fireEvent.click(check);
    fireEvent.click(check);
    await waitFor(() => expect(attempts).toBe(2));
    expect(check.getAttribute('aria-disabled')).toBe('true');
    expect(check.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText('Connection timed out')).toBeNull();
    await act(async () => pending.resolve(fixtureBootstrap.health));
    await waitFor(() => expect(check.getAttribute('aria-disabled')).toBe('false'));
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
    const result = await within(
      document.querySelector<HTMLElement>('.player-results-card')!,
    ).findByRole('button', { name: new RegExp('^' + localPlayer.name) });
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

  it('keeps search results in place during another query and cancels late results when cleared', async () => {
    const pending = deferred<RpcOutputs['players.search']>();
    const native = nativeFixture(bootstrapForApp(), {
      'players.search': ({ query }) =>
        query === 'first' ? { source: 'local', players: [localPlayer] } : pending.promise,
    });
    render(<PlayersPanel />, { wrapper: wrapper(native.api) });
    const input = (await screen.findByRole('searchbox', {
      name: translate('zh', 'searchLabel'),
    })) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const result = await within(
      document.querySelector<HTMLElement>('.player-results-card')!,
    ).findByRole('button', { name: new RegExp('^' + localPlayer.name) });
    await screen.findByText(
      translate('zh', 'searchResultSummary', { query: 'first', count: 1 }) +
        ' · ' +
        translate('zh', 'offline'),
    );
    fireEvent.change(input, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(result.isConnected).toBe(true);
    expect(result.hasAttribute('disabled')).toBe(false);
    expect(
      screen.getByText(translate('zh', 'playerSearchRetainedQuery', { query: 'first' })),
    ).toBeTruthy();
    expect(screen.getByText(translate('zh', 'searchingPlayers'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll('.search-result')).toHaveLength(0);
    await act(async () => pending.resolve({ source: 'local', players: [secondPlayer] }));
    expect(document.querySelectorAll('.search-result')).toHaveLength(0);
    expect(screen.queryByText(translate('zh', 'searchingPlayers'))).toBeNull();
  });

  it('identifies the failed submitted query without marking valid input invalid and recovers on a second submit', async () => {
    let attempts = 0;
    const native = nativeFixture(bootstrapForApp(), {
      'players.search': () => {
        if (++attempts === 1) throw new Error('Search temporarily unavailable');
        return { source: 'local', players: [localPlayer] };
      },
    });
    render(<PlayersPanel />, { wrapper: wrapper(native.api) });
    const input = await screen.findByRole('searchbox', { name: translate('zh', 'searchLabel') });
    fireEvent.change(input, { target: { value: localPlayer.name } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('Search temporarily unavailable');
    expect(error.textContent).toContain(localPlayer.name);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('player-search-hint');
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await within(document.querySelector<HTMLElement>('.player-results-card')!).findByRole(
      'button',
      { name: new RegExp('^' + localPlayer.name) },
    );
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('player-search-hint');
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
    const records = document.querySelector('.profile-records');
    await userEvent.setup().click(screen.getByRole('tab', { name: /^地图表现/ }));
    const refresh = screen.getByRole('button', { name: '刷新' });
    const header = refresh.closest<HTMLElement>('[data-slot="dialog-header"]')!;
    expect(header).toBeTruthy();
    expect(Array.from(header.querySelectorAll('button')).slice(-2)).toEqual([
      refresh,
      screen.getByRole('button', { name: '关闭' }),
    ]);
    expect(refresh.textContent).toBe('');
    expect(document.querySelector('.profile-toolbar')?.contains(refresh)).toBe(false);
    fireEvent.click(refresh);
    expect(report.isConnected).toBe(true);
    expect(document.querySelector('.profile-records')).toBe(records);
    expect(screen.queryByText('加载中…')).toBeNull();
    await act(async () => nextProfile.resolve({ ...profile, latestElo: 1600 }));
    expect(document.querySelector('.profile-records')).toBe(records);
    expect(screen.getByRole('tab', { name: /^地图表现/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getAllByText('最近一场 K/D')).toHaveLength(1);
    expect(refresh.getAttribute('aria-disabled')).toBe('true');
    expect(refresh.hasAttribute('disabled')).toBe(false);
    fireEvent.click(refresh);
    expect(native.calls.filter((call) => call.method === 'players.report')).toHaveLength(2);
    await act(async () => nextReport.resolve(reportFixture({ elo: 1601 })));
    await screen.findByText('1,601');
    expect(refresh.getAttribute('aria-disabled')).toBe('false');
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
      const speed = screen.getByRole('radio', { name: '3×' });
      fireEvent.click(speed);
      expect(speed.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: '1×' }).getAttribute('aria-checked')).toBe('false');
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
      expect(native.calls.filter((call) => call.method === 'displays.preview')).toHaveLength(1);
      await act(async () => pending.resolve('data:image/png;base64,preview'));
      expect(screen.getByAltText('显示器预览：Fixture display').getAttribute('src')).toBe(
        'data:image/png;base64,preview',
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(native.calls.filter((call) => call.method === 'displays.preview')).toHaveLength(2);
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

function explanation() {
  return (
    document.querySelector<HTMLElement>('[data-slot="popover-content"]') ??
    screen.getByRole('tooltip', { hidden: true })
  );
}

describe('durable noninterrupting ban alerts', () => {
  function batch(id: string, players: Ban[] = [{ ...bannedPlayer(), id, name: `Player ${id}` }]) {
    return { id: `batch-${id}`, createdAt: Number(id), players };
  }
  function emit(native: ReturnType<typeof nativeFixture>, ...batches: ReturnType<typeof batch>[]) {
    act(() =>
      native.emit({
        type: 'bans',
        list: batches.flatMap((batch) => batch.players),
        newly: batches.at(-1)!.players,
        alerts: batches,
        revision: native.backend.revision + 1,
      }),
    );
  }
  function Probe({ decisions }: { decisions: boolean[] }) {
    const { openModal } = useApp();
    const confirm = useConfirmation();
    return (
      <>
        <button
          onClick={() => openModal({ type: 'replay', id: 'Alpha.webm', title: 'Fixture video' })}
        >
          Open fixture video
        </button>
        <button
          onClick={async () =>
            decisions.push(
              await confirm({ title: 'Delete fixture', description: 'Review before deleting' }),
            )
          }
        >
          Open fixture confirmation
        </button>
      </>
    );
  }
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, values?: Record<string, string | number>) =>
      translate(lang, key, values);
    function initial() {
      const value = bootstrapForApp();
      value.config.lang = lang;
      return value;
    }
    async function popover(scope: HTMLElement, count: number) {
      fireEvent.click(
        within(scope).getByRole('button', { name: text('banAlertsPending', { count }) }),
      );
      return screen.findByRole('dialog', { name: text('banAlert') });
    }
    for (const revision of [0, 2])
      it(`retains both pre-consent alerts when bootstrap revision is ${revision} in ${lang}`, async () => {
        const bootstrap = initial();
        bootstrap.config.analyticsChoiceSaved = false;
        bootstrap.config.analyticsEnabled = false;
        bootstrap.revision = revision;
        const first = batch('1'),
          second = batch('2');
        if (revision === 2) bootstrap.banAlerts = [first, second];
        const pending = deferred<Bootstrap>();
        const native = nativeFixture(bootstrap, { 'app.bootstrap': () => pending.promise });
        render(<App />, { wrapper: wrapper(native.api) });
        act(() => {
          native.emit({
            type: 'bans',
            list: first.players,
            newly: first.players,
            alerts: [first],
            revision: 1,
          });
          native.emit({
            type: 'bans',
            list: [...first.players, ...second.players],
            newly: second.players,
            alerts: [first, second],
            revision: 2,
          });
        });
        await act(async () => {
          pending.resolve(bootstrap);
          await pending.promise;
        });
        expect(screen.queryByRole('dialog', { name: text('banAlert') })).toBeNull();
        fireEvent.click(
          await screen.findByRole('button', { name: text('analyticsConsentDecline') }),
        );
        const alert = await screen.findByRole('dialog', { name: text('banAlert') });
        expect(within(alert).getByText('Player 1')).toBeTruthy();
        expect(within(alert).queryByText('Player 2')).toBeNull();
        fireEvent.click(within(alert).getByRole('button', { name: text('banAlertsDismiss') }));
        await waitFor(() =>
          expect(
            within(screen.getByRole('dialog', { name: text('banAlert') })).getByText('Player 2'),
          ).toBeTruthy(),
        );
        expect(native.backend.banAlerts.map((batch) => batch.id)).toEqual(['batch-2']);
        fireEvent.click(
          within(screen.getByRole('dialog', { name: text('banAlert') })).getByRole('button', {
            name: text('close'),
          }),
        );
        await waitFor(() =>
          expect(screen.queryByRole('dialog', { name: text('banAlert') })).toBeNull(),
        );
        expect(native.backend.banAlerts).toEqual([]);
      });
    it(`keeps a profile and its unread originating alert while acknowledging the next alert in ${lang}`, async () => {
      const first = batch('1'),
        second = batch('2');
      const native = nativeFixture(initial(), {
        'players.profile': ({ id }) => ({
          ...capturedProfiles[localPlayer.id]!,
          id,
          name: 'Player ' + id,
        }),
        'players.report': ({ id }) => reportFixture({ id }),
      });
      render(<App />, { wrapper: wrapper(native.api) });
      await screen.findByText(text('listening'));
      emit(native, first);
      fireEvent.click(
        within(screen.getByRole('dialog', { name: text('banAlert') })).getByRole('button', {
          name: text('banAlertsInvestigate', { name: 'Player 1', id: '1' }),
        }),
      );
      const profile = await screen.findByRole('dialog', { name: 'Player 1 · #1' });
      await waitFor(() =>
        expect(native.calls.filter((call) => call.method === 'players.profile')).toHaveLength(1),
      );
      const scroller = profile.querySelector('.dialog-body')!;
      scroller.scrollTop = 157;
      const before = native.calls.filter((call) => call.method === 'players.profile').length;
      emit(native, first, second);
      expect(screen.getByRole('dialog', { name: 'Player 1 · #1' })).toBe(profile);
      const review = await popover(profile, 1);
      fireEvent.click(within(review).getByRole('button', { name: text('banAlertsDismiss') }));
      await within(review).findByText(text('banAlertsAcknowledged'));
      fireEvent.click(within(review).getByRole('button', { name: text('close') }));
      expect(screen.getByRole('dialog', { name: 'Player 1 · #1' })).toBe(profile);
      expect(scroller.scrollTop).toBe(157);
      expect(native.calls.filter((call) => call.method === 'players.profile')).toHaveLength(before);
      expect(native.backend.banAlerts.map((batch) => batch.id)).toEqual([first.id]);
      fireEvent.click(within(profile).getByRole('button', { name: text('close') }));
      expect(
        within(await screen.findByRole('dialog', { name: text('banAlert') })).getByText('Player 1'),
      ).toBeTruthy();
    });
    it(`keeps the same paused video, time, speed and playback request while reviewing an alert in ${lang}`, async () => {
      const native = nativeFixture(initial(), {
        'replays.play': () => ({ url: 'ba-replay://fixture/Alpha.webm' }),
      });
      const decisions: boolean[] = [];
      render(
        <>
          <App />
          <Probe decisions={decisions} />
        </>,
        { wrapper: wrapper(native.api) },
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Open fixture video' }));
      const dialog = await screen.findByRole('dialog', { name: 'Fixture video' });
      await waitFor(() => expect(dialog.querySelector('video')).toBeTruthy());
      const video = dialog.querySelector('video')!;
      video.currentTime = 12;
      fireEvent.click(within(dialog).getByRole('radio', { name: '2×' }));
      expect(video.playbackRate).toBe(2);
      emit(native, batch('1'));
      const review = await popover(dialog, 1);
      fireEvent.click(within(review).getByRole('button', { name: text('banAlertsDismiss') }));
      await within(review).findByText(text('banAlertsAcknowledged'));
      fireEvent.click(within(review).getByRole('button', { name: text('close') }));
      expect(dialog.querySelector('video')).toBe(video);
      expect(video.currentTime).toBe(12);
      expect(video.playbackRate).toBe(2);
      expect(video.paused).toBe(true);
      expect(native.calls.filter((call) => call.method === 'replays.play')).toHaveLength(1);
    });
    it(`retains safe Cancel focus and cancellation while notifications arrive in ${lang}`, async () => {
      const native = nativeFixture(initial());
      const decisions: boolean[] = [];
      render(
        <>
          <App />
          <Probe decisions={decisions} />
        </>,
        { wrapper: wrapper(native.api) },
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Open fixture confirmation' }));
      const confirmation = await screen.findByRole('alertdialog', { name: 'Delete fixture' });
      const cancel = within(confirmation).getByRole('button', { name: text('cancel') });
      await waitFor(() => expect(document.activeElement).toBe(cancel));
      emit(native, batch('1'));
      expect(document.activeElement).toBe(cancel);
      expect(screen.queryByRole('dialog', { name: text('banAlert') })).toBeNull();
      const review = await popover(confirmation, 1);
      fireEvent.click(within(review).getByRole('button', { name: text('banAlertsDismiss') }));
      await within(review).findByText(text('banAlertsAcknowledged'));
      fireEvent.click(within(review).getByRole('button', { name: text('close') }));
      await waitFor(() => expect(confirmation.contains(document.activeElement)).toBe(true));
      fireEvent.click(cancel);
      await waitFor(() => expect(decisions).toEqual([false]));
      expect(native.backend.banAlerts).toEqual([]);
    });
    it(`retains a failed or delayed acknowledgement without consuming a later batch in ${lang}`, async () => {
      const pending = deferred<null>();
      let attempts = 0;
      const first = batch('1'),
        second = batch('2'),
        third = batch('3');
      const native = nativeFixture(initial(), {
        'bans.acknowledgeAlerts': ({ ids }) => {
          if (++attempts === 1) return pending.promise;
          act(() =>
            native.emit({
              type: 'banAlerts',
              alerts: native.backend.banAlerts.filter((alert) => !ids.includes(alert.id)),
              revision: native.backend.revision + 1,
            }),
          );
          return null;
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      await screen.findByText(text('listening'));
      emit(native, first);
      const alert = screen.getByRole('dialog', { name: text('banAlert') });
      const acknowledge = within(alert).getByRole('button', { name: text('banAlertsDismiss') });
      fireEvent.click(acknowledge);
      fireEvent.click(acknowledge);
      fireEvent.click(within(alert).getByRole('button', { name: text('close') }));
      emit(native, first, second, third);
      expect(attempts).toBe(1);
      expect(within(alert).getByText('Player 1')).toBeTruthy();
      await act(async () => pending.reject(new Error('Controlled acknowledgement failure')));
      expect(within(alert).getByText(/Controlled acknowledgement failure/)).toBeTruthy();
      expect(native.backend.banAlerts).toHaveLength(3);
      fireEvent.click(within(alert).getByRole('button', { name: text('retry') }));
      await waitFor(() =>
        expect(
          within(screen.getByRole('dialog', { name: text('banAlert') })).getByText('Player 2'),
        ).toBeTruthy(),
      );
      expect(native.backend.banAlerts.map((batch) => batch.id)).toEqual([second.id, third.id]);
    });
    it(`defers automatic delivery until the existing review popover closes in ${lang}`, async () => {
      const native = nativeFixture(initial());
      render(<App />, { wrapper: wrapper(native.api) });
      const trigger = await screen.findByRole('button', {
        name: text('settingsSaveReview', { status: text('settingsAutoSaved') }),
      });
      fireEvent.click(trigger);
      const review = document.querySelector<HTMLElement>('[data-slot=popover-content]')!;
      const focused = document.activeElement;
      emit(native, batch('1'));
      expect(screen.queryByRole('dialog', { name: text('banAlert') })).toBeNull();
      expect(document.activeElement).toBe(focused);
      fireEvent.click(within(review).getByRole('button', { name: text('close') }));
      await screen.findByRole('dialog', { name: text('banAlert') });
    });
    it(`identifies same-name and long-name investigation actions by full visible player ID in ${lang}`, async () => {
      const players = ['1', '2', '3'].map((id) => ({
        ...bannedPlayer(),
        id,
        name: id === '3' ? '超长Player'.repeat(12) : 'Same name',
      }));
      const native = nativeFixture(initial());
      render(<App />, { wrapper: wrapper(native.api) });
      await screen.findByText(text('listening'));
      emit(native, batch('1', players));
      const alert = screen.getByRole('dialog', { name: text('banAlert') });
      for (const player of players) {
        const action = within(alert).getByRole('button', {
          name: text('banAlertsInvestigate', { name: player.name, id: player.id }),
        });
        expect(action.getAttribute('aria-describedby')).toBeTruthy();
        expect(within(alert).getByText('#' + player.id, { exact: false })).toBeTruthy();
      }
    });
  }
});

describe('persistent log monitoring', () => {
  const cache = {
    at: Date.now(),
    nextExpiryAt: null,
    api: { entries: 0, bytes: 0, expired: 0 },
    snapshots: { entries: 0, expired: 0, bytes: 0 },
  };
  const routes = [
    'current',
    'radar',
    'players',
    'archive',
    'replays',
    'decks',
    'bans',
    ...[
      'appearance',
      'general',
      'connection',
      'automation',
      'cache',
      'recording',
      'navigation',
      'accounts',
    ].map((tab) => 'settings/' + tab),
  ];
  function initial(lang: 'zh' | 'en') {
    const value = bootstrapForApp();
    value.config.lang = lang;
    value.watcher = {
      ...value.watcher,
      live: false,
      error: 'Controlled log directory unavailable',
      checkedAt: 1,
    };
    return value;
  }
  for (const lang of ['zh', 'en'] as const) {
    const text = (key: string, values?: Record<string, string | number>) =>
      translate(lang, key, values);
    const label = (key: string) => text('logMonitoringReview', { status: text(key) });
    for (const route of routes)
      it(`exposes a visible persistent monitoring problem on ${route} in ${lang}`, async () => {
        window.history.replaceState(null, '', '#' + route);
        const native = nativeFixture(initial(lang), { 'cache.stats': () => cache });
        render(<App />, { wrapper: wrapper(native.api) });
        const scope = route.startsWith('settings/')
          ? within(await screen.findByRole('main', { name: text('settings') }))
          : screen;
        const trigger = await scope.findByRole('button', { name: label('logMonitoringIssue') });
        expect(trigger.closest('[data-log-status]')?.classList.contains('sr-only')).toBe(false);
        expect(trigger.textContent).toContain(text('logMonitoringIssue'));
        fireEvent.click(trigger);
        const review = await screen.findByRole('dialog', { name: text('logMonitoringTitle') });
        const announcement = scope.getByRole('status', { name: text('logMonitoringTitle') });
        expect(announcement.textContent).toBe(label('logMonitoringIssue'));
        expect(announcement.contains(review)).toBe(false);
        expect(within(review).getByText('Controlled log directory unavailable')).toBeTruthy();
        expect(within(review).getByText(text('logMonitoringFailureHint'))).toBeTruthy();
        expect(
          within(review).getByRole('button', { name: text('logMonitoringRetry') }),
        ).toBeTruthy();
        expect(
          within(review).getByRole('button', { name: text('logMonitoringSettings') }),
        ).toBeTruthy();
      });
    it(`marks the current room as last known and restores its status after verification in ${lang}`, async () => {
      window.history.replaceState(null, '', '#radar');
      const native = nativeFixture(initial(lang));
      render(<App />, { wrapper: wrapper(native.api) });
      await screen.findByRole('button', { name: label('logMonitoringIssue') });
      expect(screen.getByText(text('logLastKnownRoom'))).toBeTruthy();
      const room = document.querySelector('.session-banner')!;
      const before = room.querySelector('h2')!.textContent;
      act(() =>
        native.emit({
          type: 'watcher',
          watcher: { ...native.backend.watcher, error: null, live: true, checkedAt: 2 },
          revision: native.backend.revision + 1,
        }),
      );
      expect(screen.queryByText(text('logLastKnownRoom'))).toBeNull();
      expect(room.querySelector('h2')!.textContent).toBe(before);
      expect(screen.getByRole('button', { name: label('listening') })).toBeTruthy();
    });
    it(`shares a held retry across settings navigation and suppresses repeated activation in ${lang}`, async () => {
      const pending = deferred<Bootstrap['watcher']>();
      const native = nativeFixture(initial(lang), { 'logs.refresh': () => pending.promise });
      render(<App />, { wrapper: wrapper(native.api) });
      fireEvent.click(await screen.findByRole('button', { name: label('logMonitoringIssue') }));
      let review = await screen.findByRole('dialog', { name: text('logMonitoringTitle') });
      const retry = within(review).getByRole('button', { name: text('logMonitoringRetry') });
      retry.focus();
      fireEvent.click(retry);
      fireEvent.click(retry);
      expect(retry.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(within(review).getByRole('button', { name: text('logMonitoringSettings') }));
      const settings = await screen.findByRole('main', { name: text('settings') });
      fireEvent.click(within(settings).getByRole('button', { name: label('logMonitoringIssue') }));
      review = await screen.findByRole('dialog', { name: text('logMonitoringTitle') });
      fireEvent.click(within(review).getByRole('button', { name: text('logMonitoringRetry') }));
      expect(native.calls.filter((call) => call.method === 'logs.refresh')).toHaveLength(1);

      const ready = { ...native.backend.watcher, error: null, live: true, checkedAt: 2 };
      await act(async () => {
        native.emit({ type: 'watcher', watcher: ready, revision: native.backend.revision + 1 });
        pending.resolve(ready);
      });
      expect(within(settings).getByRole('button', { name: label('listening') })).toBeTruthy();
      expect(within(review).queryByRole('alert')).toBeNull();
    });
    it(`checks the same detected path without rewriting it and reports accessible empty monitoring in ${lang}`, async () => {
      window.history.replaceState(null, '', '#settings/connection');
      const value = initial(lang);
      const native = nativeFixture(value, {
        'directory.detect': () => value.config.logDir,
        'logs.refresh': () => {
          const watcher = {
            ...native.backend.watcher,
            error: null,
            file: null,
            live: false,
            checkedAt: 2,
          };
          native.emit({ type: 'watcher', watcher, revision: native.backend.revision + 1 });
          return watcher;
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      const settings = await screen.findByRole('main', { name: text('settings') });
      fireEvent.click(within(settings).getByRole('button', { name: text('detect') }));
      await within(settings).findByText(text('logDetectWaiting'));
      expect(
        within(settings).getByRole('button', { name: label('logMonitoringWaiting') }),
      ).toBeTruthy();
      expect(native.calls.filter((call) => call.method === 'config.update')).toEqual([]);
      expect(native.calls.filter((call) => call.method === 'logs.refresh')).toHaveLength(1);
      act(() =>
        native.emit({
          type: 'watcher',
          watcher: { ...native.backend.watcher, file: 'new.log', live: true, checkedAt: 3 },
          revision: native.backend.revision + 1,
        }),
      );
      await within(settings).findByText(text('logDetectMonitoringReady'));
      expect(within(settings).queryByText(text('logDetectWaiting'))).toBeNull();
      act(() =>
        native.emit({
          type: 'watcher',
          watcher: {
            ...native.backend.watcher,
            error: 'Controlled later log failure',
            live: false,
          },
          revision: native.backend.revision + 1,
        }),
      );
      await within(settings).findByText(text('logDetectMonitoringFailed'));
    });
    it(`retains a transport failure until a successful source check arrives in ${lang}`, async () => {
      const native = nativeFixture(initial(lang), {
        'logs.refresh': () => {
          throw new Error('Controlled retry transport failure');
        },
      });
      render(<App />, { wrapper: wrapper(native.api) });
      fireEvent.click(await screen.findByRole('button', { name: label('logMonitoringIssue') }));
      const review = await screen.findByRole('dialog', { name: text('logMonitoringTitle') });
      fireEvent.click(within(review).getByRole('button', { name: text('logMonitoringRetry') }));
      await within(review).findByText('Controlled retry transport failure');
      act(() =>
        native.emit({
          type: 'watcher',
          watcher: { ...native.backend.watcher, error: null, live: true, checkedAt: 2 },
          revision: native.backend.revision + 1,
        }),
      );
      await waitFor(() =>
        expect(within(review).queryByText('Controlled retry transport failure')).toBeNull(),
      );
      expect(screen.getByRole('button', { name: label('listening') })).toBeTruthy();
    });
    it(`explains that auto-record waits for verified logs while retaining its preference in ${lang}`, async () => {
      window.history.replaceState(null, '', '#replays');
      const value = initial(lang);
      value.config.replayEnabled = false;
      const native = nativeFixture(value);
      render(<App />, { wrapper: wrapper(native.api) });
      const control = await screen.findByRole('switch', { name: text('autoRecord') });
      expect(screen.getByText(text('logMonitoringRecordingWaits'))).toBeTruthy();
      fireEvent.click(control);
      await waitFor(() => expect(native.backend.config.replayEnabled).toBe(true));
      expect(screen.getByText(text('logMonitoringRecordingWaits'))).toBeTruthy();
      expect(native.calls.some((call) => call.method === 'replays.test')).toBe(false);
    });
  }
});
