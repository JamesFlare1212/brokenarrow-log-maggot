import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialApmState } from '@ba/contracts';
import { Application } from '../apps/server/src/app';
import { Database } from '../apps/server/src/storage/database';
import type { Platform } from '../apps/server/src/ports';
import type { InstallationState } from '../apps/server/src/telemetry';

const directories: string[] = [];
const applications: Application[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'ba-installation-'));
  directories.push(path);
  return path;
}
async function launch(
  path: string,
  version: string,
  fetchImpl = vi.fn<typeof fetch>(async () => Response.json({})),
  enabled = true,
  offline = false,
) {
  const platform: Platform = {
    telemetry: { enabled, distribution: 'installed' },
    version,
    http: { fetch: fetchImpl, offline },
    selectDirectory: async () => null,
    detectLogDirectory: async () => '',
    openPath: async () => {},
    openExternal: async () => {},
    notify: () => {},
    apm: {
      status: () => initialApmState('idle'),
      start() {},
      updateMatch() {},
      stop() {},
      disable() {},
    },
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
      start: async () => {},
      stop: async () => {},
      abort: async () => {},
      displays: async () => [],
      thumbnail: async () => null,
      playback: async () => '',
    },
  };
  const app = new Application(path, platform, () => {}, !offline);
  applications.push(app);
  app.db.updateConfig({ banPollEnabled: false, matchSyncEnabled: false });
  // Keep analytics on the real HTTP port while isolating unrelated BATrace probes.
  vi.spyOn(app.client, 'get').mockResolvedValue({ value: {}, source: 'network', at: Date.now() });
  await app.start();
  return { app, fetchImpl };
}
function installation(app: Application) {
  return app.db.state<InstallationState | null>('telemetryInstallation', null);
}
function events(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchImpl.mock.calls
    .flatMap(([, init]) => JSON.parse(String(init?.body)))
    .filter((event) => event.eventName !== 'performance_sample');
}
afterEach(async () => {
  for (const app of applications.splice(0)) await app.stop();
  vi.useRealTimers();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('installation telemetry across real SQLite profiles', () => {
  it('requires confirmation of the Aptabase provider before resuming an older confirmed opt-in', async () => {
    const path = await directory();
    const db = new Database(join(path, 'assistant.sqlite'));
    db.updateConfig({
      telemetryEnabled: true,
      telemetryConsentConfirmed: true,
      telemetryConsentVersion: 3,
    });
    db.close();
    vi.useFakeTimers();
    const { app, fetchImpl } = await launch(path, '4.1.8');
    await vi.advanceTimersByTimeAsync(61000);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.invoke('config.update', { telemetryEnabled: true });
    expect(app.db.config().telemetryConsentVersion).toBe(4);
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(fetchImpl).map((event) => event.eventName)).toEqual([
      'app_installed',
      'app_started',
    ]);
  });

  it('identifies only the local account from recovered logs and preserves its hash and installation across restarts', async () => {
    const path = await directory();
    vi.useFakeTimers();
    const first = await launch(path, '4.1.8');
    first.app.parser.feed(
      [
        'Log: GetPersonaName LocalOwner',
        'Log: Start loading battle... map: Dam, scenario: Test',
        'Log: Player list:',
        'ID: 918273645, Name: LocalOwner, Team: Alpha',
        'ID: 55443322, Name: OtherPlayer, Team: Bravo',
      ],
      true,
    );
    await first.app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(2000);
    const expected = createHash('sha256')
      .update('brokenarrow.desktop:account:918273645')
      .digest('hex');
    expect(events(first.fetchImpl)[0].props.identity_hash).toBe(expected);
    expect(JSON.stringify(events(first.fetchImpl))).not.toMatch(
      /918273645|55443322|LocalOwner|OtherPlayer/,
    );
    const state = first.app.db.state<{ installationId: string; accountHash: string }>(
      'telemetryIdentity',
      {} as never,
    );
    expect(state.accountHash).toBe(expected);
    await first.app.stop();
    const restarted = await launch(path, '4.1.8');
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(restarted.fetchImpl)[0].props.identity_hash).toBe(expected);
    expect(restarted.app.db.state('telemetryIdentity', null)).toEqual(state);
  });

  it('starts normally when optional installation state is corrupt', async () => {
    const path = await directory();
    const db = new Database(join(path, 'assistant.sqlite'));
    db.sql
      .prepare('INSERT INTO app_state VALUES(?,?)')
      .run('telemetryInstallation', 'invalid JSON');
    db.close();
    vi.useFakeTimers();
    const { app, fetchImpl } = await launch(path, '4.1.8');
    await app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(fetchImpl).map((event) => event.eventName)).toEqual(['app_started']);
  });

  it('waits for consent, confirms a new installation once, and reports a changed version after restart', async () => {
    const path = await directory();
    vi.useFakeTimers();
    const first = await launch(path, '4.1.8');
    expect(first.app.db.config()).toMatchObject({
      telemetryEnabled: true,
      telemetryConsentConfirmed: false,
    });
    expect(installation(first.app)).toMatchObject({
      version: '4.1.8',
      kind: 'first_run',
      reported: false,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(first.fetchImpl).not.toHaveBeenCalled();
    await first.app.invoke('config.update', { lang: 'en' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(first.fetchImpl).not.toHaveBeenCalled();
    await first.app.invoke('config.update', { telemetryEnabled: true });
    expect(first.app.db.config().telemetryConsentConfirmed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(first.fetchImpl)).toHaveLength(2);
    expect(events(first.fetchImpl)[0]).toMatchObject({
      eventName: 'app_installed',
      props: { version: '4.1.8', kind: 'first_run', distribution: 'installed' },
    });
    expect(installation(first.app)?.reported).toBe(true);
    await first.app.stop();

    const restart = await launch(path, '4.1.8');
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(restart.fetchImpl).map((event) => event.eventName)).toEqual(['app_started']);
    await restart.app.stop();

    const updated = await launch(path, '4.1.9');
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(updated.fetchImpl)[0]).toMatchObject({
      eventName: 'app_installed',
      props: { version: '4.1.9', kind: 'version_change', previous_version: '4.1.8' },
    });
    expect(installation(updated.app)?.reported).toBe(true);
  });

  it('persists a refusal across launches and version changes until explicitly enabled later', async () => {
    const path = await directory();
    vi.useFakeTimers();
    const first = await launch(path, '4.1.8');
    await first.app.invoke('config.update', { telemetryEnabled: false });
    expect(first.app.db.config()).toMatchObject({
      telemetryEnabled: false,
      telemetryConsentConfirmed: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(first.fetchImpl).not.toHaveBeenCalled();
    await first.app.stop();
    const restarted = await launch(path, '4.1.9');
    expect(restarted.app.db.config()).toMatchObject({
      telemetryEnabled: false,
      telemetryConsentConfirmed: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(restarted.fetchImpl).not.toHaveBeenCalled();
    await restarted.app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(events(restarted.fetchImpl).map((event) => event.eventName)).toEqual([
      'app_installed',
      'app_updated',
      'app_started',
    ]);
  });

  it('requires confirmation for an older opted-in profile with no consent flag', async () => {
    const path = await directory();
    const db = new Database(join(path, 'assistant.sqlite'));
    db.sql
      .prepare('INSERT INTO settings VALUES(?,?)')
      .run('public', JSON.stringify({ telemetryEnabled: true }));
    db.close();
    vi.useFakeTimers();
    const { app, fetchImpl } = await launch(path, '4.1.8');
    expect(app.db.config()).toMatchObject({
      telemetryEnabled: true,
      telemetryConsentConfirmed: false,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(fetchImpl)[0].props.kind).toBe('existing_profile');
  });

  it.each(['database', 'legacy'] as const)(
    'does not count an existing %s profile as a new installation',
    async (kind) => {
      const path = await directory();
      if (kind === 'database') new Database(join(path, 'assistant.sqlite')).close();
      else await writeFile(join(path, 'settings.json'), JSON.stringify({ lang: 'en' }));
      vi.useFakeTimers();
      const { app, fetchImpl } = await launch(path, '4.1.8');
      expect(installation(app)?.kind).toBe('existing_profile');
      await app.invoke('config.update', { telemetryEnabled: true });
      await vi.advanceTimersByTimeAsync(2000);
      expect(events(fetchImpl)[0].props.kind).toBe('existing_profile');
    },
  );

  it.each(['runtime-disabled', 'offline'] as const)(
    'does not create an installation marker or send in %s mode',
    async (mode) => {
      const path = await directory();
      vi.useFakeTimers();
      const { app, fetchImpl } = await launch(
        path,
        '4.1.8',
        undefined,
        mode !== 'runtime-disabled',
        mode === 'offline',
      );
      await app.invoke('config.update', { telemetryEnabled: true });
      await vi.advanceTimersByTimeAsync(5000);
      expect(installation(app)).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each(['rate-limit', 'timeout', 'server-error', 'network-error'] as const)(
    'keeps %s events unconfirmed with bounded retries and stable installation IDs after restart',
    async (failure) => {
      const path = await directory();
      vi.useFakeTimers();
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        if (failure === 'network-error') throw new Error('Offline');
        if (failure === 'rate-limit') return new Response(null, { status: 429 });
        if (failure === 'timeout') return new Response(null, { status: 408 });
        return Response.json({}, { status: 500 });
      });
      const first = await launch(path, '4.1.8', fetchImpl);
      await first.app.invoke('config.update', { telemetryEnabled: true });
      await vi.advanceTimersByTimeAsync(10000);
      const attempts = events(fetchImpl).filter((event) => event.eventName === 'app_installed');
      expect(attempts.length).toBeGreaterThan(1);
      expect(attempts.length).toBeLessThanOrEqual(5);
      expect(new Set(attempts.map((event) => event.props.event_id)).size).toBe(1);
      expect(installation(first.app)?.reported).toBe(false);
      await first.app.stop();
      const restart = await launch(path, '4.1.8');
      await vi.advanceTimersByTimeAsync(2000);
      expect(events(restart.fetchImpl)[0].props.kind).toBe('first_run');
      expect(installation(restart.app)?.reported).toBe(true);
    },
  );
});
