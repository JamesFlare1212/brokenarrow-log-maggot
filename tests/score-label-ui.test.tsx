// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MATCH_SCORE_LABEL_IDS,
  type Locale,
  type MatchScoreLabel,
  type MatchScoreLabelEvidence,
  type MatchScoreLabelId,
  type MatchTitle,
} from '@ba/contracts';
import { MatchAwards } from '../apps/web/src/features/matches/MatchAwards';
import { LocaleContext, translate } from '../apps/web/src/hooks/useI18n';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const evidenceCases: Array<[MatchScoreLabelId, MatchScoreLabelEvidence, string]> = [
  [
    'destruction',
    { destructionValue: 6965, killed: 52 },
    '本局击杀价值 6,965 点，击杀 52 个单位。',
  ],
  [
    'damage',
    { damageDealt: 1471, damageReceived: 767 },
    '本局造成伤害 1,471 点，承受伤害 767 点。',
  ],
  [
    'dlRatio',
    { destructionValue: 6965, lossValue: 3445, dlRatio: 6965 / 3445 },
    '本局击杀价值 6,965 点，损失价值 3,445 点，价值战损比 2.02。',
  ],
  [
    'efficiency',
    { investment: 11575, refunded: 5315, destructionValue: 6685, roi: 0.19 },
    '本局出兵价值 11,575 点，退款 5,315 点，击杀价值 6,685 点；资源回报率 19%。',
  ],
  ['objectives', { objectivesCaptured: 4 }, '本局占领 4 个目标点。'],
  ['supply', { supplyProvided: 6385 }, '本局队友使用其提供的补给 6,385 点。'],
];
const labels: MatchScoreLabel[] = evidenceCases.map(([id, evidence]) => ({
  id,
  evidence,
  score: 100,
  threshold: 100,
}));
const titles: MatchTitle[] = [
  { id: 'refund', kind: 'neutral', params: { p: 65 } },
  { id: 'carry', kind: 'good', params: { d: 6000, l: 1000, net: 5000 } },
  { id: 'courier', kind: 'neutral', params: { n: 12000 } },
];

describe('two score labels plus two match titles', () => {
  it.each([
    ['carry', 'good', 'success', 'text-success'],
    ['blame', 'bad', 'destructive', 'text-destructive'],
    ['refund', 'neutral', 'secondary', 'text-foreground'],
    ['damage', null, 'info', 'text-info'],
  ] as const)(
    'gives %s the same colored badge details on hover and click',
    async (id, kind, variant, color) => {
      vi.useFakeTimers();
      render(
        <MatchAwards
          titles={kind ? [{ id, kind, params: { d: 6000, l: 1000, net: 5000, p: 65 } }] : []}
          scoreLabels={
            kind
              ? []
              : [
                  {
                    id: 'damage',
                    score: 100,
                    threshold: 100,
                    evidence: { damageDealt: 1471, damageReceived: 767 },
                  },
                ]
          }
        />,
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('data-slot')).toBe('badge');
      expect(button.getAttribute('data-variant')).toBe(variant);
      fireEvent.pointerMove(button, { pointerType: 'mouse' });
      await act(async () => vi.advanceTimersByTime(400));
      const tooltip = explanation();
      const content = tooltip.firstElementChild?.innerHTML;
      const heading = tooltip.querySelector('.match-award-tooltip-name');
      expect(heading?.textContent).toBe(button.textContent);
      expect(heading?.classList.contains(color)).toBe(true);
      expect(tooltip.querySelectorAll('h3, h4')).toHaveLength(2);
      expect(tooltip.textContent).not.toMatch(/本局依据|本局称号|评分标签/);
      fireEvent.click(button);
      fireEvent.pointerLeave(button);
      await act(async () => vi.advanceTimersByTime(200));
      const pinned = explanation();
      expect(pinned.getAttribute('data-slot')).toBe('popover-content');
      expect(pinned.firstElementChild?.innerHTML).toBe(content);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    },
  );

  it.each(evidenceCases)(
    'shows raw %s combat values instead of normalized scores',
    (id, evidence, expected) => {
      render(
        <MatchAwards titles={[]} scoreLabels={[{ id, score: 100, threshold: 100, evidence }]} />,
      );
      fireEvent.click(screen.getByRole('button', { name: translate('zh', `scoreLabel.${id}`) }));
      const evidenceElement = explanation().querySelector('.match-award-evidence');
      expect(evidenceElement?.textContent).toBe(expected);
      expect(explanation().querySelector('.match-award-tooltip-name')?.textContent).toBe(
        translate('zh', `scoreLabel.${id}`),
      );
      expect(evidenceElement?.textContent).not.toMatch(/评分|\/ 100|获奖分数/);
    },
  );
  it('distinguishes unavailable values from recorded zeros and does not substitute the normalized score', () => {
    const { rerender } = render(
      <MatchAwards titles={[]} scoreLabels={[{ id: 'damage', score: 100, threshold: 100 }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '火力投送' }));
    expect(screen.getByText('本局未记录相关战斗数值。')).toBeTruthy();
    rerender(
      <MatchAwards
        titles={[]}
        scoreLabels={[{ id: 'damage', score: 100, threshold: 100, evidence: { damageDealt: 0 } }]}
      />,
    );
    expect(screen.getByText('本局造成伤害 0 点，承受伤害 — 点。')).toBeTruthy();
  });
  it.each([
    [1200, '∞'],
    [0, '—'],
  ] as const)(
    'handles a destruction value of %s and zero losses without a fake numeric ratio',
    (destructionValue, ratio) => {
      render(
        <MatchAwards
          titles={[]}
          scoreLabels={[
            {
              id: 'dlRatio',
              score: 100,
              threshold: 100,
              evidence: { destructionValue, lossValue: 0 },
            },
          ]}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '爱兵如子' }));
      expect(explanation().querySelector('.match-award-evidence')?.textContent).toContain(
        `价值战损比 ${ratio}。`,
      );
    },
  );
  it('keeps both award groups directly beside the player name without visible captions', () => {
    render(
      <div className="player-heading">
        <button>Player</button>
        <MatchAwards titles={titles} scoreLabels={labels} />
      </div>,
    );
    const player = screen.getByRole('button', { name: 'Player' });
    const titleGroup = screen.getByRole('group', { name: '本局称号' });
    const scoreGroup = screen.getByRole('group', { name: '评分标签' });
    expect(player.nextElementSibling).toBe(titleGroup);
    expect(titleGroup.parentElement).toBe(player.parentElement);
    expect(scoreGroup.parentElement).toBe(player.parentElement);
    expect(titleGroup.nextElementSibling).toBe(scoreGroup);
    expect(scoreGroup.querySelector('.match-award-caption')).toBeNull();
    expect(titleGroup.textContent).not.toContain('称号');
  });

  it('uses the requested Kill Leader and Supplier names in Chinese', () => {
    render(<MatchAwards titles={[]} scoreLabels={[labels[0]!, labels[5]!]} />);
    expect(screen.getByRole('button', { name: '击杀王' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '奶妈' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '歼灭大师' })).toBeNull();
    expect(screen.queryByRole('button', { name: '战场奶妈' })).toBeNull();
  });
  it('keeps independent limits and accessible groups without nesting buttons', () => {
    const { container } = render(<MatchAwards titles={titles} scoreLabels={labels} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(
      within(screen.getByRole('group', { name: '评分标签' })).getAllByRole('button'),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole('group', { name: '本局称号' })).getAllByRole('button'),
    ).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '精打细算' })).toBeNull();
    expect(screen.queryByRole('button', { name: '爱兵如子' })).toBeNull();
    expect(screen.queryByRole('button', { name: '快递员' })).toBeNull();
    expect(container.querySelector('button button')).toBeNull();
  });

  it('shows the score rule and evidence on hover, and lets a click pin the full label', async () => {
    vi.useFakeTimers();
    render(<MatchAwards titles={titles} scoreLabels={labels} />);
    const button = screen.getByRole('button', { name: '击杀王' });
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    await act(async () => vi.advanceTimersByTime(400));
    const tooltip = explanation();
    expect(tooltip.textContent).toContain('完整终局，两队合评');
    expect(tooltip.textContent).toContain('摧毁评分最高且 > 0 者获评');
    expect(tooltip.textContent).toContain('并列取战报首位');
    expect(tooltip.textContent).not.toMatch(/本队最高|90%|并列最高均可获得/);
    expect(tooltip.textContent).toContain('每人最多 2 项，高分优先');
    expect(tooltip.textContent).toContain('击杀价值 6,965 点，击杀 52 个单位');
    expect(tooltip.textContent).toContain('超额不顺延');
    expect(tooltip.textContent).not.toMatch(/\{\w+\}/);
    fireEvent.click(button);
    fireEvent.pointerLeave(button);
    await act(async () => vi.advanceTimersByTime(200));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(explanation().getAttribute('data-slot')).toBe('popover-content');
    expect(explanation().textContent).toContain('击杀价值 6,965 点，击杀 52 个单位');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('shows full names in tooltips on focus and click while keeping accessible badge names', async () => {
    const user = userEvent.setup();
    render(
      <LocaleContext.Provider value="en">
        <div style={{ width: 96 }}>
          <MatchAwards titles={titles} scoreLabels={labels} />
        </div>
      </LocaleContext.Provider>,
    );
    await user.tab();
    expect(document.activeElement?.textContent).toBe(translate('en', 'title.refund'));
    expect(explanation().querySelector('.match-award-tooltip-name')?.textContent).toBe(
      translate('en', 'title.refund'),
    );
    await user.keyboard('{Escape}');
    const score = screen.getByRole('button', { name: translate('en', 'scoreLabel.destruction') });
    await user.click(score);
    expect(explanation().querySelector('.match-award-tooltip-name')?.textContent).toBe(
      translate('en', 'scoreLabel.destruction'),
    );
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('renders either group independently and no placeholder when neither group has awards', () => {
    const { rerender, container } = render(<MatchAwards titles={[]} scoreLabels={[]} />);
    expect(container.childElementCount).toBe(0);
    rerender(<MatchAwards titles={[]} scoreLabels={labels} />);
    expect(screen.queryByRole('group', { name: '本局称号' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    rerender(<MatchAwards titles={titles} />);
    expect(screen.queryByRole('group', { name: '评分标签' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it.each(['zh', 'en'] as Locale[])(
    'localizes all six labels and their conditions in %s',
    (locale) => {
      const vars = {
        metric: translate(locale, 'scoreLabel.destruction.metric'),
        limit: 2,
        destructionValue: 6965,
        killed: 52,
        damageDealt: 1471,
        damageReceived: 767,
        lossValue: 3445,
        dlRatio: 2.02,
        investment: 11575,
        refunded: 5315,
        roi: '19%',
        objectivesCaptured: 4,
        supplyProvided: 6385,
      };
      for (const key of [
        ...MATCH_SCORE_LABEL_IDS.map((id) => `scoreLabel.${id}`),
        ...MATCH_SCORE_LABEL_IDS.map((id) => `scoreLabel.${id}.metric`),
        ...MATCH_SCORE_LABEL_IDS.map((id) => `scoreLabel.${id}.evidence`),
        'scoreLabels',
        'scoreLabels.short',
        'matchTitles.short',
        'scoreLabel.condition',
        'scoreLabel.limit',
        'scoreLabel.evidence.unavailable',
      ]) {
        expect(translate(locale, key, vars)).not.toBe(key);
        expect(translate(locale, key, vars)).not.toMatch(/\{\w+\}/);
        if (key.endsWith('.evidence') || key === 'scoreLabel.evidence.unavailable')
          expect(
            translate(locale, key, vars).startsWith(locale === 'zh' ? '本局' : 'This match:'),
          ).toBe(true);
      }
      for (const id of MATCH_SCORE_LABEL_IDS) {
        render(
          <LocaleContext.Provider value={locale}>
            <MatchAwards titles={[]} scoreLabels={[{ id, score: 100, threshold: 100 }]} />
          </LocaleContext.Provider>,
        );
        fireEvent.click(
          screen.getByRole('button', { name: translate(locale, `scoreLabel.${id}`) }),
        );
        const tooltip = explanation();
        expect(tooltip.textContent).toContain(translate(locale, `scoreLabel.${id}.metric`));
        expect(tooltip.textContent).not.toContain('该项');
        expect(tooltip.textContent).not.toMatch(/\{\w+\}/);
        expect(tooltip.querySelector('.match-award-tooltip-name')?.textContent).toBe(
          translate(locale, `scoreLabel.${id}`),
        );
        expect(tooltip.querySelector('.match-award-tooltip-category')).toBeNull();
        expect(tooltip.querySelector('.match-award-rule-heading')?.textContent).toBe(
          translate(locale, 'title.condition.heading'),
        );
        cleanup();
      }
      render(
        <LocaleContext.Provider value={locale}>
          <MatchAwards titles={titles} scoreLabels={labels} />
        </LocaleContext.Provider>,
      );
      expect(screen.getByRole('group', { name: translate(locale, 'scoreLabels') })).toBeTruthy();
    },
  );
});

function explanation() {
  return (
    document.querySelector<HTMLElement>('[data-slot="popover-content"]') ??
    screen.getByRole('tooltip', { hidden: true })
  );
}
