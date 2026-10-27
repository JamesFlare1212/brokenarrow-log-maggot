// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { AppEvent, Bridge, RpcInputs, RpcMethod, RpcOutputs } from '@ba/contracts';
import { AppProvider } from '../apps/web/src/app/state';
import { MatchDialog } from '../apps/web/src/features/matches/MatchDialog';
import { ProfileDialog } from '../apps/web/src/features/players/ProfileDialog';
import { createBrowserFixtures } from '../apps/server/src/dev/browser';
import { loadRealData } from '../apps/server/src/dev/real-data';
import { translate } from '../apps/web/src/hooks/useI18n';

const root = resolve('.test-data/offline-ui-tests');
const source = resolve(process.env.BA_TEST_FIXTURE_DIRECTORY || 'tests/fixtures/real');
const services: Awaited<ReturnType<typeof createBrowserFixtures>>[] = [];
const t = (key: string) => translate('zh', key);
async function setup() {
  const listeners = new Set<(event: AppEvent) => void>();
  const service = await createBrowserFixtures(source, root, '4.3.0', (event) => {
    for (const listener of listeners) listener(event);
  });
  services.push(service);
  await service.invoke('config.update', { lang: 'zh' });
  const calls: Array<{ method: RpcMethod; input: unknown }> = [];
  const completed: Array<{ method: RpcMethod; input: unknown }> = [];
  const api: Bridge = {
    invoke: async <K extends RpcMethod>(method: K, input: RpcInputs[K]): Promise<RpcOutputs[K]> => {
      calls.push({ method, input });
      const result = await service.invoke(method, input);
      completed.push({ method, input });
      return result as RpcOutputs[K];
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { api, calls, completed };
}
afterEach(async () => {
  cleanup();
  for (const service of services.splice(0)) {
    await service.stop();
    if (!service.directory.startsWith(root + sep))
      throw new Error('Unsafe offline UI cleanup path');
    await rm(service.directory, { recursive: true, force: true });
  }
});

describe('UI backed by the complete recorded BATrace service', () => {
  it('renders real match statistics, titles, score labels, and evidence after an offline refresh', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    const { api, completed } = await setup();
    render(
      <AppProvider api={api}>
        <MatchDialog fid="9227650" />
      </AppProvider>,
    );
    await screen.findByRole('heading', { name: 'Dam' });
    await waitFor(() => expect(document.querySelectorAll('.match-player-cell')).toHaveLength(10));
    expect(
      document.querySelectorAll('[data-award-source="title"] .match-award-button').length,
    ).toBeGreaterThan(0);
    expect(
      document.querySelectorAll('[data-award-source="score"] .match-award-button').length,
    ).toBeGreaterThan(0);
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-award-source="title"] .match-award-button')!,
    );
    const details = await Promise.resolve(explanation());
    expect(details.querySelector('.match-award-evidence')?.textContent).toMatch(/\d/);
    expect(details.textContent).not.toContain(t('title.condition.evidence'));
    fireEvent.click(screen.getByRole('button', { name: t('refresh') }));
    await waitFor(() =>
      expect(completed).toContainEqual({
        method: 'matches.detail',
        input: { fid: '9227650', force: true },
      }),
    );
    expect(document.querySelectorAll('.match-player-cell')).toHaveLength(10);
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it('automatically calculates the recorded player index and refreshes the profile offline', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'));
    const { data } = await loadRealData(source);
    const id = data.activeAccountId!;
    const { api, calls, completed } = await setup();
    render(
      <AppProvider api={api}>
        <ProfileDialog id={id} name={id} />
      </AppProvider>,
    );
    const matchData = await screen.findByRole('table', { name: t('matchStatistics') });
    expect(within(matchData).getAllByRole('row')).toHaveLength(13);
    expect(within(matchData).getAllByRole('columnheader')).toHaveLength(9);
    expect(screen.queryByRole('tab', { name: new RegExp(t('recent')) })).toBeNull();
    expect(screen.getAllByText(t('latestKd'))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: t('maggot') })).toBeNull();
    await waitFor(
      () => expect(completed.filter((call) => call.method === 'players.maggot')).toHaveLength(1),
      { timeout: 10000 },
    );
    const maggot = screen.getByRole('region', { name: t('maggot') });
    const index = maggot.querySelector('.maggot-score')?.textContent;
    expect(index).toBeTruthy();
    expect(index).not.toBe('—');
    expect(within(maggot).getByText(translate('zh', 'maggotSample', { n: 12 }))).toBeTruthy();
    expect(within(maggot).queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('refresh') }));
    await waitFor(() => {
      expect(completed).toContainEqual({ method: 'players.profile', input: { id, force: true } });
      expect(completed).toContainEqual({ method: 'players.report', input: { id, force: true } });
    });
    await waitFor(
      () => expect(completed.filter((call) => call.method === 'players.maggot')).toHaveLength(2),
      { timeout: 10000 },
    );
    expect(calls.filter((call) => call.method === 'players.maggot')).toHaveLength(2);
    expect(maggot.querySelector('.maggot-score')?.textContent).toBe(index);
    expect(within(maggot).queryByRole('button', { name: '查看计算明细' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  }, 30000);
});

function explanation() {
  return (
    document.querySelector<HTMLElement>('[data-slot="popover-content"]') ??
    screen.getByRole('tooltip', { hidden: true })
  );
}
