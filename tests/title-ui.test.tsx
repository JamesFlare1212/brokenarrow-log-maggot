// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale, MatchTitle } from '@ba/contracts';
import { MatchTitles } from '../apps/web/src/features/matches/MatchTitles';
import { LocaleContext, translate } from '../apps/web/src/hooks/useI18n';
import { TITLES } from '../packages/shared/src/titles/engine';

afterEach(cleanup);
const titles: MatchTitle[] = [
  { id: 'reaper', kind: 'good', params: { p: 31 } },
  { id: 'carry', kind: 'good', params: { d: 6000, l: 1000, net: 5000 } },
  { id: 'courier', kind: 'neutral', params: { n: 12000 } },
];

describe('match title badges', () => {
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

  it.each(['zh', 'en', 'ja', 'ru'] as Locale[])(
    'provides all names and explanations in %s',
    (locale) => {
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
      for (const id of Object.keys(TITLES)) {
        for (const key of [`title.${id}`, `title.${id}.tip`]) {
          const result = translate(locale, key, vars);
          expect(result).not.toBe(key);
          expect(result).not.toMatch(/\{\w+\}/);
        }
      }
      render(
        <LocaleContext.Provider value={locale}>
          <MatchTitles titles={titles} />
        </LocaleContext.Provider>,
      );
      expect(screen.getByRole('group', { name: translate(locale, 'matchTitles') })).toBeTruthy();
    },
  );
});
