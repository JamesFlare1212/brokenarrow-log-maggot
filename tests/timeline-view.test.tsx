// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMatchTimeline } from '@ba/shared';
import { TimelineView } from '../apps/web/src/features/timeline/TimelineView';
import { LocaleContext } from '../apps/web/src/hooks/useI18n';
import { recordedTimelineMatch } from './timeline-fixture';

const result = buildMatchTimeline(recordedTimelineMatch().value);
if (result.status !== 'ready') throw new Error('Recorded timeline unavailable');
const data = result.data;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        font: '',
        measureText: (text: string) => ({ width: text.length * 7 }),
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('production timeline presentation', () => {
  it.each(['zh', 'en'] as const)('renders real records and localized controls in %s', (locale) => {
    render(
      <LocaleContext.Provider value={locale}>
        <TimelineView data={data} />
      </LocaleContext.Provider>,
    );
    expect(screen.getAllByTestId('moment-row')).toHaveLength(6);
    expect(screen.getByTestId('readout-time').textContent).toContain('22:19');
    expect(
      screen.getByRole('button', { name: locale === 'zh' ? '分钟数据' : 'Minute data' }),
    ).toBeTruthy();
    expect(screen.getByText(locale === 'zh' ? '短时多杀' : 'Short multikill')).toBeTruthy();
    expect(screen.getByText('Ka-50 Akula')).toBeTruthy();
    expect(screen.getByTestId('estimate-caveat').textContent).toBe(
      locale === 'zh' ? '非在场值 · 回收除外' : 'Not field strength · Excludes refunds',
    );
    expect(document.body.textContent).not.toMatch(/timeline\.[a-zA-Z]/);
  });

  it('distinguishes a record without derived moments from an empty filter', () => {
    render(<TimelineView data={{ ...data, moments: [] }} />);
    expect(screen.getByText('没有可识别的关键时刻')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull();
    expect(screen.getByTestId('overview-chart')).toBeTruthy();
  });

  it('recovers a filtered empty result without replacing real data', async () => {
    render(<TimelineView data={data} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('筛选事件玩家'), '75402');
    await user.click(screen.getByRole('radio', { name: '高光' }));
    expect(screen.getByText('没有匹配的时刻')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getAllByTestId('moment-row')).toHaveLength(6);
    expect(screen.getByTestId('alpha-value').textContent).toBe('11,681');
  });
});
