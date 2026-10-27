import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialUpdateState } from '@ba/contracts';
import { AnalyticsService } from '../apps/server/src/analytics';
import type { AptabaseEvent, PendingUpdateStore } from '../apps/server/src/aptabase';
const services: AnalyticsService[] = [];
function pendingUpdateStore() {
  const state = { pending: null as unknown };
  const pendingUpdates: PendingUpdateStore = {
    load: () => state.pending,
    save: (value) => {
      state.pending = structuredClone(value);
    },
  };
  return { state, pendingUpdates };
}
function launch(store: ReturnType<typeof pendingUpdateStore>, version = '4.4.3', allowed = true) {
  const sent: AptabaseEvent[] = [];
  const analytics = new AnalyticsService({
    allowed,
    version,
    distribution: 'installed',
    pendingUpdates: store.pendingUpdates,
    fetch: async (_url, init) => {
      sent.push(...JSON.parse(String(init?.body)));
      return Response.json({});
    },
  });
  services.push(analytics);
  return { analytics, sent };
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
      const store = pendingUpdateStore();
      const first = launch(store);
      first.analytics.configure(true, 'en');
      first.analytics.observeUpdate({
        ...initialUpdateState('4.4.3', 'installed'),
        status: 'installing',
        availableVersion: '4.4.4',
      });
      expect(store.state.pending).toEqual({
        fromVersion: '4.4.3',
        targetVersion: '4.4.4',
        stage: 'installing',
      });
      first.analytics.close();
      const next = launch(store, version);
      next.analytics.configure(true, 'en');
      await vi.advanceTimersByTimeAsync(1000);
      const result = next.sent.find((event) => event.eventName === 'update_outcome')!;
      expect(result.props).toEqual({
        distribution: 'installed',
        from_version: '4.4.3',
        target_version: '4.4.4',
        stage: 'installing',
        outcome,
      });
      expect(result.sessionId).toBe(next.sent[0]!.sessionId);
      expect(store.state.pending).toBeNull();
      next.analytics.close();
      const third = launch(store, version);
      third.analytics.configure(true, 'en');
      await vi.advanceTimersByTimeAsync(1000);
      expect(third.sent.some((event) => event.eventName === 'update_outcome')).toBe(false);
    },
  );
  it('reports interrupted downloads separately from installation failures', async () => {
    vi.useFakeTimers();
    const store = pendingUpdateStore();
    const first = launch(store);
    first.analytics.configure(true, 'en');
    first.analytics.observeUpdate({
      ...initialUpdateState('4.4.3', 'installed'),
      status: 'downloading',
      availableVersion: '4.4.4',
    });
    first.analytics.close();
    const next = launch(store);
    next.analytics.configure(true, 'en');
    await vi.advanceTimersByTimeAsync(1000);
    expect(next.sent.find((event) => event.eventName === 'update_outcome')?.props.outcome).toBe(
      'interrupted',
    );
  });
  it('preserves anonymous pending update metadata offline and clears it on refusal', () => {
    const store = pendingUpdateStore();
    const pending = { fromVersion: '4.4.3', targetVersion: '4.4.4', stage: 'installing' };
    store.state.pending = pending;
    const offline = launch(store, '4.4.3', false);
    offline.analytics.configure(true, 'en');
    offline.analytics.close();
    expect(store.state.pending).toEqual(pending);
    const refused = launch(store);
    refused.analytics.configure(false, 'en');
    expect(store.state.pending).toBeNull();
  });
  it('optional update storage failures never interrupt collection', async () => {
    vi.useFakeTimers();
    const store = pendingUpdateStore();
    store.pendingUpdates.load = () => {
      throw new Error('private path');
    };
    store.pendingUpdates.save = () => {
      throw new Error('private path');
    };
    const next = launch(store);
    next.analytics.configure(true, 'en');
    next.analytics.observeUpdate({
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
