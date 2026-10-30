// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RatingTrendPoint } from '@ba/contracts';
import { RatingTrendChart } from '../apps/web/src/features/players/RatingTrendChart';
import { buildRatingTrend } from '../apps/web/src/features/players/rating-trend';
import { LocaleContext } from '../apps/web/src/hooks/useI18n';
import { reportFixture } from './fixtures/ui';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 640,
    bottom: 200,
    width: 640,
    height: 200,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const history: RatingTrendPoint[] = [
  { matchId: '10', endTime: 1800000000000, ratingBefore: 1900, ratingAfter: 1920 },
  { matchId: '11', endTime: 1800003600000, ratingBefore: 1920, ratingAfter: 1910 },
  { matchId: '12', endTime: 1800007200000, ratingBefore: 1910, ratingAfter: 1935 },
];

describe('rating trend data', () => {
  it('measures the full period from the first pre-match rating and retains match details', () => {
    const trend = buildRatingTrend(history);
    expect(trend).toMatchObject({ baseline: 1900, latest: 1935, change: 35, hasRatings: true });
    expect(trend.data.map(({ matchNumber, change }) => ({ matchNumber, change }))).toEqual([
      { matchNumber: 1, change: 20 },
      { matchNumber: 2, change: -10 },
      { matchNumber: 3, change: 25 },
    ]);
    expect(trend.domain[0]).toBeLessThan(1900);
    expect(trend.domain[1]).toBeGreaterThan(1935);
  });

  it('keeps missing endpoints unknown while retaining internal gaps and zero ratings', () => {
    const points = [
      { ...history[0]!, ratingBefore: null, ratingAfter: 0 },
      { ...history[1]!, ratingAfter: null },
      { ...history[2]!, ratingAfter: null },
    ];
    const trend = buildRatingTrend(points);
    expect(trend).toMatchObject({ baseline: null, latest: null, change: null, hasRatings: true });
    expect(trend.data.map((point) => point.ratingAfter)).toEqual([0, null, null]);
    expect(trend.data.map((point) => point.change)).toEqual([null, null, null]);
  });

  it('pads flat and single-point domains and treats an empty history as unavailable', () => {
    const trend = buildRatingTrend([{ ...history[0]!, ratingBefore: 0, ratingAfter: 0 }]);
    expect(trend).toMatchObject({ baseline: 0, latest: 0, change: 0, hasRatings: true });
    expect(trend.domain[0]).toBeLessThan(0);
    expect(trend.domain[1]).toBeGreaterThan(0);
    expect(buildRatingTrend([])).toMatchObject({ hasRatings: false, latest: null, change: null });
  });
});

describe('player rating chart', () => {
  it('shows loading placeholders, an honest empty state, and then the available history', () => {
    const { rerender } = render(<RatingTrendChart report={null} pending />);
    const region = screen.getByRole('region', { name: 'ELO 趋势' });
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    expect(screen.queryByText('暂无 ELO 趋势数据')).toBeNull();

    rerender(<RatingTrendChart report={reportFixture({ ratingTrend: [] })} />);
    expect(region.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByText('暂无 ELO 趋势数据')).toBeTruthy();
    expect(region.querySelector('[data-slot="chart"]')).toBeNull();

    rerender(<RatingTrendChart report={reportFixture({ ratingTrend: history })} />);
    expect(screen.getByText('最近 3 场 · 从早到晚')).toBeTruthy();
    expect(screen.getByText('最近一场赛后 ELO').nextElementSibling?.textContent).toBe('1,935');
    expect(screen.getByText('区间变化').nextElementSibling?.textContent).toBe('+35.00');
    expect(region.querySelector('[data-slot="chart"]')).toBeTruthy();
    expect(region.querySelector('[data-slot="skeleton"]')).toBeNull();

    rerender(<RatingTrendChart report={reportFixture({ ratingTrend: history })} pending />);
    expect(region.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.getByText('+35.00')).toBeTruthy();
  });

  it.each([
    [1950, 'elo-increase', '+50.00'],
    [1870, 'elo-decrease', '-30.00'],
    [1900, '', '0.00'],
    [null, '', '—'],
  ] as const)(
    'uses signed semantic colors for a final rating of %s',
    (ratingAfter, color, label) => {
      render(
        <RatingTrendChart
          report={reportFixture({ ratingTrend: [history[0]!, { ...history[1]!, ratingAfter }] })}
        />,
      );
      const value = screen.getByText('区间变化').nextElementSibling!;
      expect(value.textContent).toBe(label);
      expect(value.className).toBe(color);
    },
  );

  it('exposes match values through keyboard navigation and localizes the chart', async () => {
    render(
      <LocaleContext.Provider value="en">
        <RatingTrendChart report={reportFixture({ ratingTrend: history })} />
      </LocaleContext.Provider>,
    );
    const region = screen.getByRole('region', { name: 'ELO trend' });
    expect(within(region).getByText('Last 3 matches · oldest to newest')).toBeTruthy();
    const chart = await within(region).findByRole('application');
    fireEvent.focus(chart);
    await waitFor(() => expect(within(region).getByText('Match 1 · #10')).toBeTruthy());
    expect(within(region).getByText('+20.00')).toBeTruthy();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    await waitFor(() => expect(within(region).getByText('Match 2 · #11')).toBeTruthy());
    expect(within(region).getByText('-10.00')).toBeTruthy();
  });
});
