// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale, MatchTitle } from '@ba/contracts';
import { titleConditionDetails } from '@ba/shared';
import { MatchTitles } from '../apps/web/src/features/matches/MatchTitles';
import { LocaleContext, translate } from '../apps/web/src/hooks/useI18n';
import { TITLES } from '../packages/shared/src/titles/engine';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const titles: MatchTitle[] = [
  { id: 'reaper', kind: 'good', params: { p: 31 } },
  { id: 'carry', kind: 'good', params: { d: 6000, l: 1000, net: 5000 } },
  { id: 'courier', kind: 'neutral', params: { n: 12000 } },
];

describe('match title badges', () => {
  it('shows calibrated award conditions and match evidence on hover without clicking', async () => {
    vi.useFakeTimers();
    render(<MatchTitles titles={titles} />);
    const reaper = screen.getByRole('button', { name: '收割机' });
    fireEvent.pointerEnter(reaper, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).not.toContain('收割机');
    expect(tooltip.textContent).toContain('全场摧毁占比 ≥ 21.84%。');
    expect(tooltip.textContent).toContain('终局 ≥ 8 分钟');
    expect(tooltip.textContent).toContain('每人最多 2 个');
    expect(tooltip.textContent).toContain('摧毁分占全场 31%，为全场最高。');
    expect(reaper.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(reaper.getAttribute('aria-expanded')).toBe('false');
    fireEvent.pointerLeave(reaper);
    fireEvent.pointerEnter(tooltip);
    await act(async () => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip', { hidden: true })).toBe(tooltip);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('shows the same conditions on keyboard focus and dismisses them without activation', async () => {
    const user = userEvent.setup();
    render(<MatchTitles titles={titles} />);
    await user.tab();
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toContain('21.84%');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '收割机' }));
    await user.tab();
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toContain('净交换 = 摧毁分 − 损失分');
    expect(tooltip.textContent).not.toContain('终局 ≥ 8 分钟');
  });
  it('shows two titles and lets pointer and keyboard users expand and collapse evidence', () => {
    render(<MatchTitles titles={titles} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '快递员' })).toBeNull();
    const reaper = screen.getByRole('button', { name: '收割机' });
    fireEvent.click(reaper);
    expect(reaper.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('摧毁分占全场 31%，为全场最高。')).toBeTruthy();
    expect(document.getElementById(reaper.getAttribute('aria-controls')!)?.textContent).toContain(
      '31%',
    );
    fireEvent.click(screen.getByRole('button', { name: '大腿' }));
    expect(screen.queryByText('摧毁分占全场 31%，为全场最高。')).toBeNull();
    expect(screen.getByText('赢方净交换最高：摧毁 6000 − 损失 1000 = 5000。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '大腿' }));
    expect(screen.queryByText('赢方净交换最高：摧毁 6000 − 损失 1000 = 5000。')).toBeNull();
    expect(document.querySelector('button button')).toBeNull();
  });

  it('renders no placeholder for players without titles', () => {
    const { container } = render(<MatchTitles titles={[]} />);
    expect(container.childElementCount).toBe(0);
  });

  it.each(['zh', 'en'] as Locale[])('provides all names and explanations in %s', (locale) => {
    const vars = {
      d: 1000,
      l: 500,
      net: 500,
      p: 30,
      x: 2,
      k: 10,
      kd: 1,
      s: 30,
      n: 10,
      a: 40,
      min: 2,
    };
    for (const id of Object.keys(TITLES) as MatchTitle['id'][]) {
      const condition = titleConditionDetails(id as MatchTitle['id']);
      const keys = [
        `title.${id}`,
        `title.${id}.tip`,
        condition.key,
        condition.eligibility,
        condition.selection,
        'title.condition.heading',
        'title.condition.evidence',
        'title.condition.limit',
        'title.condition.net',
        'title.condition.netWeighted',
      ].filter((key): key is string => key !== null);
      for (const key of keys) {
        const result = translate(locale, key, { ...vars, ...condition.params });
        expect(result).not.toBe(key);
        expect(result).not.toMatch(/\{\w+\}/);
      }
      render(
        <LocaleContext.Provider value={locale}>
          <MatchTitles titles={[{ id, kind: 'neutral', params: { ...vars, reason: 'silent' } }]} />
        </LocaleContext.Provider>,
      );
      const button = screen.getByRole('button', { name: translate(locale, `title.${id}`) });
      fireEvent.click(button);
      const tooltip = screen.getByRole('tooltip', { hidden: true });
      expect(tooltip.querySelector('.button-tooltip-label')).toBeNull();
      expect(tooltip.firstElementChild?.textContent).toBe(
        translate(locale, 'title.condition.heading'),
      );
      expect(tooltip.textContent).not.toMatch(/\{\w+\}/);
      cleanup();
    }
    render(
      <LocaleContext.Provider value={locale}>
        <MatchTitles titles={titles} />
      </LocaleContext.Provider>,
    );
    expect(screen.getByRole('group', { name: translate(locale, 'matchTitles') })).toBeTruthy();
  });
});
