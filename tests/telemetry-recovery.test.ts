import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialUpdateState } from '@ba/contracts';
import { TelemetryService } from '../apps/server/src/telemetry';
import type {
  TelemetryEnvelope,
  TelemetryPersistence,
} from '../apps/server/src/telemetry-protocol';
const services: TelemetryService[] = [];
function stateStore() {
  const values = new Map<string, unknown>();
  const persistence: TelemetryPersistence = {
    read: (key) => values.get(key),
    write: (key, value) => values.set(key, structuredClone(value)),
  };
  return { values, persistence };
}
function launch(store: ReturnType<typeof stateStore>, version = '4.4.3', allowed = true) {
  const sent: TelemetryEnvelope[] = [];
  const telemetry = new TelemetryService({
    allowed,
    version,
    distribution: 'installed',
    persistence: store.persistence,
    fetch: async (_url, init) => {
      sent.push(...JSON.parse(String(init?.body)));
      return Response.json({});
    },
  });
  services.push(telemetry);
  return { telemetry, sent };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  vi.useRealTimers();
});
describe('anonymous update outcomes', () => {
  it.each([
    ['4.4.4', 'applied'],
    ['4.4.3', 'not_applied'],
    ['4.4.5', 'other_version'],
  ])(
    'observes %s/%s after restarting without carrying any correlation identifiers',
    async (version, outcome) => {
      vi.useFakeTimers();
      const store = stateStore();
      const first = launch(store);
      first.telemetry.configure(true, 'en');
      first.telemetry.observeUpdate({
        ...initialUpdateState('4.4.3', 'installed'),
        status: 'installing',
        availableVersion: '4.4.4',
      });
      expect(store.values.get('update')).toEqual({
        fromVersion: '4.4.3',
        targetVersion: '4.4.4',
        stage: 'installing',
      });
      first.telemetry.close();
      const next = launch(store, version);
      next.telemetry.configure(true, 'en');
      await vi.advanceTimersByTimeAsync(1000);
      const result = next.sent.find((event) => event.eventName === 'update_attempt_result')!;
      expect(result.props).toEqual({
        distribution: 'installed',
        from_version: '4.4.3',
        target_version: '4.4.4',
        last_stage: 'installing',
        outcome,
      });
      expect(result.sessionId).toBe(next.sent[0]!.sessionId);
      expect(store.values.get('update')).toBeNull();
      next.telemetry.close();
      const third = launch(store, version);
      third.telemetry.configure(true, 'en');
      await vi.advanceTimersByTimeAsync(1000);
      expect(third.sent.some((event) => event.eventName === 'update_attempt_result')).toBe(false);
    },
  );
  it('reports interrupted downloads separately from installation failures', async () => {
    vi.useFakeTimers();
    const store = stateStore();
    const first = launch(store);
    first.telemetry.configure(true, 'en');
    first.telemetry.observeUpdate({
      ...initialUpdateState('4.4.3', 'installed'),
      status: 'downloading',
      availableVersion: '4.4.4',
    });
    first.telemetry.close();
    const next = launch(store);
    next.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      next.sent.find((event) => event.eventName === 'update_attempt_result')?.props.outcome,
    ).toBe('interrupted');
  });
  it('preserves anonymous pending update metadata offline and clears it on refusal', () => {
    const store = stateStore();
    const pending = { fromVersion: '4.4.3', targetVersion: '4.4.4', stage: 'installing' };
    store.values.set('update', pending);
    const offline = launch(store, '4.4.3', false);
    offline.telemetry.configure(true, 'en');
    offline.telemetry.close();
    expect(store.values.get('update')).toEqual(pending);
    const refused = launch(store);
    refused.telemetry.configure(false, 'en');
    expect(store.values.get('update')).toBeNull();
  });
  it('does not accept old update records containing correlation IDs or arbitrary content', async () => {
    vi.useFakeTimers();
    const store = stateStore();
    store.values.set('update', {
      fromVersion: '4.4.3',
      targetVersion: '4.4.4',
      stage: 'installing',
      id: 'private-id',
    });
    const next = launch(store);
    next.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(next.sent.map((event) => event.eventName)).toEqual(['app_started']);
    expect(JSON.stringify(next.sent)).not.toContain('private-id');
  });
  it('optional update storage failures never interrupt collection', async () => {
    vi.useFakeTimers();
    const store = stateStore();
    store.persistence.read = () => {
      throw new Error('private path');
    };
    store.persistence.write = () => {
      throw new Error('private path');
    };
    const next = launch(store);
    next.telemetry.configure(true, 'en');
    next.telemetry.observeUpdate({
      ...initialUpdateState('4.4.3', 'installed'),
      status: 'installing',
      availableVersion: '4.4.4',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(next.sent.map((event) => event.eventName)).toEqual([
      'app_started',
      'update_state_changed',
    ]);
    expect(JSON.stringify(next.sent)).not.toContain('private path');
  });
});
