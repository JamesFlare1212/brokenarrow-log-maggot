'@vitest-environment jsdom';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchTimelineResult, TimelineData } from '@ba/contracts';
import { emptyMatch } from '@ba/shared';
import { LocaleContext } from '../apps/web/src/hooks/useI18n';
import { TooltipProvider } from '../apps/web/src/components/ui/tooltip';
import {
  MatchTimeline,
  timelineScrollContainer,
} from '../apps/web/src/features/matches/MatchTimeline';
import { MatchDetails } from '../apps/web/src/features/matches/MatchDetails';

const { invoke, api, notify, openModal } = vi.hoisted(() => {
  const invoke = vi.fn();
  return { invoke, api: { invoke }, notify: vi.fn(), openModal: vi.fn() };
});
vi.mock('../apps/web/src/app/state', () => ({
  useApp: () => ({
    api,
    access: { method: () => true },
    state: { replaysRevision: 0 },
    notify,
    openModal,
  }),
}));
vi.mock('../apps/web/src/features/timeline/TimelineView', () => ({
  TimelineView: ({ data, stickyOffset }: { data: TimelineData; stickyOffset: number }) => (
    <div
      data-testid="timeline-presentation"
      data-duration={data.duration}
      data-offset={stickyOffset}
    />
  ),
}));

function result(
  duration = 60,
  source: MatchTimelineResult['source'] = 'cache',
): MatchTimelineResult {
  const frame = (second: number) => ({
    second,
    alpha: 100,
    bravo: 100,
    difference: 0,
    alphaChange: 0,
    bravoChange: 0,
    alphaLoss: 0,
    bravoLoss: 0,
  });
  return {
    status: 'ready',
    reason: null,
    source,
    updatedAt: duration,
    data: {
      duration,
      points: [frame(0), frame(duration)],
      frames: Array.from({ length: duration + 1 }, (_, second) => frame(second)),
      sorties: [],
      moments: [],
      players: [],
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <LocaleContext.Provider value="zh">
      <TooltipProvider>{children}</TooltipProvider>
    </LocaleContext.Provider>
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (method: string, input: { fid: string }) => {
    if (method === 'matches.detail')
      return { ...emptyMatch(input.fid), source: 'api', map: 'Baltiisk', durationSec: 1339 };
    if (method === 'replays.list') return [];
    if (method === 'matches.timeline') return result();
    throw new Error('Unexpected test RPC: ' + method);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('match timeline integration', () => {
  it('loads timeline data only when its match-detail tab is selected', async () => {
    render(<MatchDetails matchId="9485138" />, { wrapper });
    await screen.findByRole('heading', { name: 'Baltiisk' });
    const user = userEvent.setup();
    for (const name of ['战斗数据', '支援数据']) {
      await user.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true');
    }
    expect(invoke.mock.calls.some(([method]) => method === 'matches.timeline')).toBe(false);
    await userEvent.setup().click(screen.getByRole('tab', { name: '时间线' }));
    await screen.findByTestId('timeline-presentation');
    expect(invoke).toHaveBeenCalledWith('matches.timeline', { fid: '9485138', force: false });
    await userEvent.setup().click(screen.getByRole('tab', { name: '核心战绩' }));
    expect(screen.queryByTestId('timeline-presentation')).toBeNull();
    expect(screen.getByRole('tab', { name: '核心战绩' })).toBeTruthy();
  });

  it.each([
    [null, undefined, '本地日志'],
    ['9485138', 'pve', '该对局模式'],
  ] as const)(
    'does not request unavailable local/PvE timelines (%s)',
    async (fid, mode, description) => {
      render(<MatchTimeline fid={fid} mode={mode} />, { wrapper });
      expect(screen.getByText('暂无时间线数据')).toBeTruthy();
      expect(screen.getByText(new RegExp(description))).toBeTruthy();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it('shows a real loading state rather than zero-filled data', async () => {
    const pending = deferred<MatchTimelineResult>();
    invoke.mockReturnValue(pending.promise);
    render(<MatchTimeline fid="1" />, { wrapper });
    expect(screen.getByTestId('timeline-loading')).toBeTruthy();
    expect(screen.queryByTestId('timeline-presentation')).toBeNull();
    pending.resolve(result(120));
    expect((await screen.findByTestId('timeline-presentation')).dataset.duration).toBe('120');
  });

  it('retains usable data with an explicit stale warning', async () => {
    invoke.mockResolvedValue(result(60, 'stale'));
    render(<MatchTimeline fid="1" />, { wrapper });
    await screen.findByTestId('timeline-presentation');
    expect(screen.getByText('当前显示缓存时间线，在线数据暂不可用。')).toBeTruthy();
  });

  it.each(['missing-unit-data', 'invalid-time', 'unsupported-mode'] as const)(
    'renders an unavailable response without a fabricated chart (%s)',
    async (reason) => {
      invoke.mockResolvedValue({
        status: 'unavailable',
        reason,
        data: null,
        source: 'cache',
        updatedAt: 1,
      });
      render(<MatchTimeline fid="1" />, { wrapper });
      await screen.findByText('暂无时间线数据');
      expect(screen.queryByTestId('timeline-presentation')).toBeNull();
      expect(!!screen.queryByRole('button', { name: '刷新' })).toBe(reason !== 'unsupported-mode');
    },
  );

  it('offers retry after a failed request', async () => {
    invoke.mockRejectedValueOnce(new Error('Offline test failure')).mockResolvedValueOnce(result());
    render(<MatchTimeline fid="1" />, { wrapper });
    expect((await screen.findByRole('alert')).textContent).toContain('Offline test failure');
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    await screen.findByTestId('timeline-presentation');
    expect(invoke).toHaveBeenLastCalledWith('matches.timeline', { fid: '1', force: true });
  });

  it('refreshes active timeline data while retaining the previous view', async () => {
    const next = deferred<MatchTimelineResult>();
    invoke.mockResolvedValueOnce(result(60)).mockReturnValueOnce(next.promise);
    const rendered = render(<MatchTimeline fid="1" refreshVersion={5} />, { wrapper });
    await screen.findByTestId('timeline-presentation');
    expect(invoke).toHaveBeenLastCalledWith('matches.timeline', { fid: '1', force: false });
    rendered.rerender(<MatchTimeline fid="1" refreshVersion={6} />);
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith('matches.timeline', { fid: '1', force: true }),
    );
    expect(screen.getByTestId('timeline-presentation').dataset.duration).toBe('60');
    next.resolve(result(120));
    await waitFor(() =>
      expect(screen.getByTestId('timeline-presentation').dataset.duration).toBe('120'),
    );
  });

  it('ignores late responses after a match switch', async () => {
    const first = deferred<MatchTimelineResult>();
    const second = deferred<MatchTimelineResult>();
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const rendered = render(<MatchTimeline fid="1" />, { wrapper });
    rendered.rerender(<MatchTimeline fid="2" />);
    second.resolve(result(120));
    await screen.findByTestId('timeline-presentation');
    first.resolve(result(60));
    await waitFor(() =>
      expect(screen.getByTestId('timeline-presentation').dataset.duration).toBe('120'),
    );
  });

  it.each(['match-detail-page', 'dialog-body'])(
    'uses the %s scrollport below the header',
    (className) => {
      const { container } = render(
        <>
          <header />
          <div className={className} style={{ overflowY: 'auto' }}>
            <div className="match-details">
              <div data-testid="host" />
            </div>
          </div>
        </>,
      );
      expect(timelineScrollContainer(within(container).getByTestId('host'))).toBe(
        container.querySelector('.' + className),
      );
    },
  );
});
