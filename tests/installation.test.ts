import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialApmState } from '@ba/contracts';
import { Application } from '../apps/server/src/app';
import { Database } from '../apps/server/src/storage/database';
import type { Platform } from '../apps/server/src/ports';
import type { VersionObservation } from '../apps/server/src/telemetry';

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
  return app.db.state<VersionObservation | null>('telemetryVersion', null);
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

describe('anonymous version observations and legacy cleanup', () => {
  it('waits for consent before first-open and startup events', async () => {
    const path = await directory();
    const db = new Database(join(path, 'assistant.sqlite'));
    db.updateConfig({
      telemetryEnabled: true,
      telemetryConsentConfirmed: true,
      telemetryConsentVersion: 3,
    });
    db.close();
    vi.useFakeTimers();
    const { app, fetchImpl } = await launch(path, '4.4.3');
    await vi.advanceTimersByTimeAsync(61000);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(fetchImpl).map((event) => event.eventName)).toEqual([
      'app_started',
      'app_first_open',
    ]);
    expect(installation(app)?.reported).toBe(true);
    expect(Object.keys(installation(app)!).sort()).toEqual(['kind', 'reported', 'version']);
  });
  it.each(['online', 'offline', 'disabled'] as const)(
    'deletes legacy identities and queued payloads on a %s launch without sending them',
    async (mode) => {
      const path = await directory();
      const db = new Database(join(path, 'assistant.sqlite'));
      const retired = [
        'telemetryIdentity',
        'telemetryInstallation',
        'telemetry:outbox:v1',
        'telemetry:run:v1',
        'telemetry:update:v1',
      ];
      for (const key of retired)
        db.sql.prepare('INSERT INTO app_state VALUES (?, ?)').run(key, 'invalid JSON');
      db.updateConfig({
        telemetryEnabled: false,
        telemetryConsentConfirmed: true,
        telemetryConsentVersion: 4,
      });
      db.close();
      vi.useFakeTimers();
      const { app, fetchImpl } = await launch(
        path,
        '4.4.3',
        undefined,
        mode !== 'disabled',
        mode === 'offline',
      );
      for (const key of retired) expect(app.db.state(key, null)).toBeNull();
      await vi.advanceTimersByTimeAsync(61000);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it('never derives telemetry identity from game accounts and starts a fresh session after restart', async () => {
    const path = await directory();
    vi.useFakeTimers();
    const first = await launch(path, '4.4.3');
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
    expect(first.app.db.state('telemetryIdentity', null)).toBeNull();
    const firstEvents = events(first.fetchImpl);
    expect(firstEvents.some((event) => event.eventName === 'user_identified')).toBe(false);
    expect(JSON.stringify(firstEvents)).not.toMatch(
      /918273645|55443322|LocalOwner|OtherPlayer|identity_hash|installation_id|event_id|app_session_id/,
    );
    await first.app.stop();
    const restarted = await launch(path, '4.4.3');
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(restarted.fetchImpl).map((event) => event.eventName)).toEqual(['app_started']);
    expect(events(restarted.fetchImpl)[0].sessionId).not.toBe(firstEvents[0].sessionId);
  });
  it('keeps only local version flags and reports changed versions without an installation identifier', async () => {
    const path = await directory();
    vi.useFakeTimers();
    const first = await launch(path, '4.4.3');
    await first.app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(first.fetchImpl).map((event) => event.eventName)).toEqual([
      'app_started',
      'app_first_open',
    ]);
    await first.app.stop();
    const restart = await launch(path, '4.4.3');
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(restart.fetchImpl).map((event) => event.eventName)).toEqual(['app_started']);
    await restart.app.stop();
    const updated = await launch(path, '4.4.4');
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(updated.fetchImpl).map((event) => event.eventName)).toEqual([
      'app_started',
      'app_updated',
    ]);
    expect(events(updated.fetchImpl)[1].props).toEqual({
      distribution: 'installed',
      previous_version: '4.4.3',
    });
    expect(installation(updated.app)).toEqual({
      version: '4.4.4',
      previousVersion: '4.4.3',
      kind: 'version_change',
      reported: true,
    });
  });
  it('keeps a saved refusal through restarts and version changes', async () => {
    const path = await directory();
    vi.useFakeTimers();
    const first = await launch(path, '4.4.3');
    await first.app.invoke('config.update', { telemetryEnabled: false });
    await first.app.stop();
    const restart = await launch(path, '4.4.4');
    await vi.advanceTimersByTimeAsync(61000);
    expect(restart.fetchImpl).not.toHaveBeenCalled();
    expect(restart.app.db.config()).toMatchObject({
      telemetryEnabled: false,
      telemetryConsentConfirmed: true,
    });
  });
  it('starts normally when the optional version marker is corrupt', async () => {
    const path = await directory();
    const db = new Database(join(path, 'assistant.sqlite'));
    db.sql.prepare('INSERT INTO app_state VALUES (?, ?)').run('telemetryVersion', 'invalid JSON');
    db.close();
    vi.useFakeTimers();
    const { app, fetchImpl } = await launch(path, '4.4.3');
    await app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(events(fetchImpl).find((event) => event.eventName === 'app_first_open').props.kind).toBe(
      'existing_profile',
    );
  });
  it('does not persist failed payloads; a later launch observes an unconfirmed first open anew', async () => {
    const path = await directory();
    vi.useFakeTimers();
    const failedFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 500 }));
    const first = await launch(path, '4.4.3', failedFetch);
    await first.app.invoke('config.update', { telemetryEnabled: true });
    await vi.advanceTimersByTimeAsync(20000);
    expect(
      events(failedFetch).filter((event) => event.eventName === 'app_first_open'),
    ).toHaveLength(3);
    expect(installation(first.app)?.reported).toBe(false);
    expect(first.app.db.state('telemetry:outbox:v1', null)).toBeNull();
    const session = events(failedFetch)[0].sessionId;
    await first.app.stop();
    const restart = await launch(path, '4.4.3');
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      events(restart.fetchImpl).find((event) => event.eventName === 'app_first_open'),
    ).toBeTruthy();
    expect(events(restart.fetchImpl)[0].sessionId).not.toBe(session);
  });
});
