// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { PlayerReport } from '@ba/contracts';
import { MapPerformanceGrid } from '../apps/web/src/features/players/MapPerformanceGrid';
import { LocaleContext } from '../apps/web/src/hooks/useI18n';

afterEach(cleanup);

it('orders maps by sample size without mutating the report and labels map averages', () => {
  const maps: PlayerReport['mapStats'] = [
    { mapId: 1, name: 'Dam', matchCount: 1, winRate: 100, avgKd: 0, avgDestructionScore: 0 },
    {
      mapId: 2,
      name: 'Klaipeda',
      matchCount: 11,
      winRate: 72.7,
      avgKd: 1.79,
      avgDestructionScore: 5347,
    },
    {
      mapId: 3,
      name: 'Airport',
      matchCount: 11,
      winRate: 0,
      avgKd: null,
      avgDestructionScore: null,
    },
  ];
  render(
    <LocaleContext.Provider value="en">
      <MapPerformanceGrid maps={maps} />
    </LocaleContext.Provider>,
  );
  const grid = screen.getByRole('list', { name: 'Map performance' });
  expect(
    within(grid)
      .getAllByRole('heading')
      .map((heading) => heading.textContent),
  ).toEqual(['Klaipeda', 'Airport', 'Dam']);
  expect(maps.map((map) => map.name)).toEqual(['Dam', 'Klaipeda', 'Airport']);
  const map = within(grid).getByRole('listitem', { name: 'Klaipeda' });
  expect(within(map).getByText('11 matches')).toBeTruthy();
  expect(within(map).getByText('72.7%')).toBeTruthy();
  expect(within(map).getByText('Avg. K/D').nextElementSibling?.textContent).toBe('1.79');
  expect(within(map).getByText('Avg. destruction').nextElementSibling?.textContent).toBe('5.3k');
  expect(within(map).getByTitle('5,347')).toBeTruthy();
  expect(within(map).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('72.7');
  const dam = within(grid).getByRole('listitem', { name: 'Dam' });
  expect(within(dam).getByText('1 match')).toBeTruthy();
  expect(within(dam).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
});

it('keeps loading placeholders free of fake metrics and retains loaded cards during refresh', () => {
  const view = render(<MapPerformanceGrid maps={[]} pending />);
  const grid = screen.getByRole('list', { name: '地图表现' });
  expect(grid.getAttribute('aria-busy')).toBe('true');
  expect(within(grid).queryAllByRole('listitem')).toHaveLength(0);
  expect(within(grid).queryByText('0%')).toBeNull();
  expect(within(grid).queryByRole('progressbar')).toBeNull();
  const maps: PlayerReport['mapStats'] = [
    { mapId: 1, name: 'Dam', matchCount: 1, winRate: null, avgKd: null, avgDestructionScore: null },
  ];
  view.rerender(<MapPerformanceGrid maps={maps} />);
  const card = within(grid).getByRole('listitem', { name: 'Dam' });
  expect(grid.getAttribute('aria-busy')).toBe('false');
  expect(within(card).getAllByText('—')).toHaveLength(3);
  expect(within(card).queryByRole('progressbar')).toBeNull();
  view.rerender(<MapPerformanceGrid maps={maps} pending />);
  expect(grid.getAttribute('aria-busy')).toBe('true');
  expect(within(grid).getByRole('listitem', { name: 'Dam' })).toBe(card);
});
