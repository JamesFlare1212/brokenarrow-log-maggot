import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialUpdateState } from '@ba/contracts';
import { TelemetryService } from '../apps/server/src/telemetry';
import {
  restoreOutbox,
  type TelemetryPersistence,
  type QueuedTelemetryEvent,
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
function launch(store: ReturnType<typeof stateStore>, version = '4.1.8', allowed = true) {
  const sent: { eventName: string; props: Record<string, unknown> }[] = [];
  const telemetry = new TelemetryService({
    allowed,
    version,
    distribution: 'installed',
    identity: { installationId: '4f1351be-985f-4ec0-b1b5-6b48d507e346' },
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
describe('telemetry restart recovery', () => {
  it.each([
    ['4.1.9', 'applied'],
    ['4.1.8', 'not_applied'],
    ['4.2.0', 'other_version'],
  ])('confirms an installing attempt as %s/%s on the next launch', async (version, outcome) => {
    vi.useFakeTimers();
    const store = stateStore();
    const first = launch(store);
    first.telemetry.configure(true, 'en');
    first.telemetry.observeUpdate({
      ...initialUpdateState('4.1.8', 'installed'),
      status: 'downloading',
      availableVersion: '4.1.9',
    });
    first.telemetry.observeUpdate({
      ...initialUpdateState('4.1.8', 'installed'),
      status: 'installing',
      availableVersion: '4.1.9',
    });
    const attempt = store.values.get('update') as { id: string };
    first.telemetry.close();
    const next = launch(store, version);
    next.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      next.sent.find((event) => event.eventName === 'update_attempt_result')?.props,
    ).toMatchObject({
      update_attempt_id: attempt.id,
      target_version: '4.1.9',
      from_version: '4.1.8',
      last_stage: 'installing',
      outcome,
    });
    expect(
      next.sent
        .filter((event) => event.eventName === 'update_state_changed')
        .every((event) => event.props.update_attempt_id === attempt.id),
    ).toBe(true);
    next.telemetry.close();
    const third = launch(store, version);
    third.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(third.sent.some((event) => event.eventName === 'update_attempt_result')).toBe(false);
  });
  it('reports interrupted downloads separately from update application failures', async () => {
    vi.useFakeTimers();
    const store = stateStore();
    const first = launch(store);
    first.telemetry.configure(true, 'en');
    first.telemetry.observeUpdate({
      ...initialUpdateState('4.1.8', 'installed'),
      status: 'downloaded',
      availableVersion: '4.1.9',
    });
    first.telemetry.close();
    const next = launch(store);
    next.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      next.sent.find((event) => event.eventName === 'update_attempt_result')?.props,
    ).toMatchObject({ outcome: 'interrupted', last_stage: 'downloaded' });
  });
  it('backfills an unclean exit without claiming that every unclean exit was a crash', async () => {
    vi.useFakeTimers();
    const store = stateStore();
    const first = launch(store);
    first.telemetry.configure(true, 'en');
    const open = structuredClone(store.values.get('run'));
    first.telemetry.close();
    store.values.set('run', open);
    const next = launch(store);
    next.telemetry.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(next.sent.find((event) => event.eventName === 'previous_run_exit')?.props.reason).toBe(
      'unclean_exit',
    );
  });
  it('preserves deferred critical events during an offline launch but purges them after a refusal', () => {
    const store = stateStore();
    const first = launch(store);
    first.telemetry.configure(true, 'en');
    first.telemetry.error('main', new Error());
    first.telemetry.close();
    const queued = structuredClone(store.values.get('outbox'));
    expect((queued as unknown[]).length).toBeGreaterThan(0);
    const offline = launch(store, '4.1.8', false);
    offline.telemetry.configure(true, 'en');
    offline.telemetry.close();
    expect(store.values.get('outbox')).toEqual(queued);
    const refused = launch(store);
    refused.telemetry.configure(false, 'en');
    expect(store.values.get('outbox')).toEqual([]);
  });
  it('rejects expired, foreign-installation, or corrupted outbox records before replaying', () => {
    const store = stateStore();
    const first = launch(store);
    first.telemetry.configure(true, 'en');
    first.telemetry.error('main', new Error());
    first.telemetry.close();
    const queue = (structuredClone(store.values.get('outbox')) as QueuedTelemetryEvent[]).filter(
      (item) => item.payload.eventName === 'app_error',
    );
    const id = String(queue[0]!.payload.props.installation_id);
    expect(restoreOutbox(queue, Date.now(), id)).toHaveLength(1);
    expect(restoreOutbox(queue, Date.now(), 'f'.repeat(64))).toHaveLength(0);
    queue[0]!.payload.props.private_value = 'secret';
    expect(restoreOutbox(queue, Date.now(), id)).toHaveLength(0);
    delete queue[0]!.payload.props.private_value;
    queue[0]!.expiresAt = Date.now() - 1;
    expect(restoreOutbox(queue, Date.now(), id)).toHaveLength(0);
  });
  it('drops legacy provider envelopes and stale capture times even when the local expiry is valid', () => {
    const store = stateStore();
    const first = launch(store);
    first.telemetry.configure(true, 'en');
    first.telemetry.matchStarted('local-match');
    first.telemetry.close();
    const event = (store.values.get('outbox') as QueuedTelemetryEvent[]).find(
      (item) => item.payload.eventName === 'match_started',
    )!;
    const installationId = String(event.payload.props.installation_id);
    expect(restoreOutbox([event], Date.now(), installationId)).toHaveLength(1);
    const stale = structuredClone(event);
    stale.payload.timestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(restoreOutbox([stale], Date.now(), installationId)).toEqual([]);
    const legacy = {
      ...event,
      payload: {
        event: 'match_started',
        uuid: event.payload.props.event_id,
        distinct_id: event.payload.props.identity_hash,
        timestamp: event.payload.timestamp,
        properties: { ...event.payload.props, telemetry_schema: 3 },
      },
    };
    expect(restoreOutbox([legacy], Date.now(), installationId)).toEqual([]);
    const privateFrame = structuredClone(event);
    privateFrame.payload.systemProps.osVersion = 'x'.repeat(101);
    expect(restoreOutbox([privateFrame], Date.now(), installationId)).toEqual([]);
  });
});
