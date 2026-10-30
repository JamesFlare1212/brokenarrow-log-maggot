import { describe, expect, it } from 'vitest';
import { translate } from '../apps/web/src/hooks/useI18n';
import { localizedTeamLabel } from '../apps/web/src/lib/team-label';
import { replayIdentity } from '../apps/web/src/features/replays/labels';
import type { Replay } from '@ba/contracts';

describe('localized count grammar', () => {
  const cases = [
    {
      key: 'playersCount',
      variable: 'n',
      en: ['0 players', '1 player', '2 players'],
      zh: ['0 位玩家', '1 位玩家', '2 位玩家'],
    },
    {
      key: 'accountMatches',
      variable: 'count',
      en: ['0 matches', '1 match', '2 matches'],
      zh: ['0 场对局', '1 场对局', '2 场对局'],
    },
    {
      key: 'searchResultSummary',
      variable: 'count',
      en: ['“Arrow” · 0 players', '“Arrow” · 1 player', '“Arrow” · 2 players'],
      zh: ['“Arrow” · 0 位玩家', '“Arrow” · 1 位玩家', '“Arrow” · 2 位玩家'],
    },
    {
      key: 'cacheEntrySummary',
      variable: 'entries',
      en: ['0 entries · 1 expired', '1 entry · 1 expired', '2 entries · 1 expired'],
      zh: ['0 条 · 1 条已过期', '1 条 · 1 条已过期', '2 条 · 1 条已过期'],
    },
    {
      key: 'cacheCleared',
      variable: 'count',
      en: ['Removed 0 cached entries.', 'Removed 1 cached entry.', 'Removed 2 cached entries.'],
      zh: ['已清理 0 条缓存。', '已清理 1 条缓存。', '已清理 2 条缓存。'],
    },
    {
      key: 'banAlertsPending',
      variable: 'count',
      en: [
        'Pending ban alerts: 0 players',
        'Pending ban alerts: 1 player',
        'Pending ban alerts: 2 players',
      ],
      zh: ['待处理封禁提醒：0 名玩家', '待处理封禁提醒：1 名玩家', '待处理封禁提醒：2 名玩家'],
    },
    {
      key: 'maggotSample',
      variable: 'n',
      en: [
        'Based on the latest 0 eligible ranked matches',
        'Based on the latest 1 eligible ranked match',
        'Based on the latest 2 eligible ranked matches',
      ],
      zh: ['基于最近 0 场有效排位', '基于最近 1 场有效排位', '基于最近 2 场有效排位'],
    },
    {
      key: 'movePartial',
      variable: 'n',
      en: [
        '0 files could not be moved; original folder remains selected.',
        '1 file could not be moved; original folder remains selected.',
        '2 files could not be moved; original folder remains selected.',
      ],
      zh: [
        '0 个文件迁移失败；原目录和设置保留。',
        '1 个文件迁移失败；原目录和设置保留。',
        '2 个文件迁移失败；原目录和设置保留。',
      ],
    },
  ];
  it.each(cases)(
    'renders zero, one and two independently for $key',
    ({ key, variable, en, zh }) => {
      for (const n of [0, 1, 2]) {
        const vars = { [variable]: n, query: 'Arrow', expired: 1 };
        expect(translate('en', key, vars)).toBe(en[n]);
        expect(translate('zh', key, vars)).toBe(zh[n]);
      }
    },
  );
  it.each([0, 1, 2].flatMap((wins) => [0, 1, 2].map((losses) => ({ wins, losses }))))(
    'counts $wins wins and $losses losses independently',
    ({ wins, losses }) => {
      const expected = [
        ['0 wins · 0 losses', '0 wins · 1 loss', '0 wins · 2 losses'],
        ['1 win · 0 losses', '1 win · 1 loss', '1 win · 2 losses'],
        ['2 wins · 0 losses', '2 wins · 1 loss', '2 wins · 2 losses'],
      ];
      expect(translate('en', 'winLossCount', { wins, losses })).toBe(expected[wins]![losses]);
      expect(translate('zh', 'winLossCount', { wins, losses })).toBe(`${wins} 胜 · ${losses} 负`);
    },
  );
  it('handles formatted count strings without changing interpolation or key fallback', () => {
    expect(translate('en', 'cacheCleared', { count: '1' })).toBe('Removed 1 cached entry.');
    expect(translate('en', 'cacheCleared', { count: '1,000' })).toBe(
      'Removed 1,000 cached entries.',
    );
    expect(translate('en', 'playersCount')).toBe('{n} players');
    expect(translate('en', 'unregistered-key')).toBe('unregistered-key');
    expect(translate('en', 'searchResultSummary', { query: 'A {literal}', count: 1 })).toBe(
      '“A {literal}” · 1 player',
    );
    expect(translate('en', 'unattributedEncounterHint', { count: 1 })).toBe(
      '1 imported record has no known account. Enable multi-account association to view it.',
    );
    expect(translate('en', 'unattributedEncounterHint', { count: 2 })).toBe(
      '2 imported records have no known account. Enable multi-account association to view them.',
    );
  });
});

describe('localized team identity', () => {
  it.each(
    (['zh', 'en'] as const).flatMap((locale) =>
      ([0, 1, 100, null] as const).map((team) => ({ locale, team })),
    ),
  )('names team $team in $locale without changing Alpha/Bravo', ({ locale, team }) => {
    const expected =
      team === 0
        ? 'Alpha'
        : team === 1
          ? 'Bravo'
          : team === 100
            ? locale === 'zh'
              ? '观战'
              : 'Spectator'
            : locale === 'zh'
              ? '未知'
              : 'Unknown';
    expect(localizedTeamLabel(team, locale)).toBe(expected);
  });
  it.each(['zh', 'en'] as const)(
    'includes a readable fallback in recording action identity in %s',
    (locale) => {
      const replay = {
        map: '',
        uploaderName: '',
        teamId: 100,
        createdAt: 1700000000000,
        id: 'local.webm',
      } as Replay;
      const expected = locale === 'zh' ? '观战' : 'Spectator';
      expect(replayIdentity(replay, locale)).toContain(expected);
      expect(replayIdentity({ ...replay, uploaderName: 'Known player' }, locale)).toContain(
        'Known player',
      );
      expect(replayIdentity({ ...replay, uploaderName: 'Known player' }, locale)).not.toContain(
        expected,
      );
      expect(replayIdentity(replay, locale)).toContain('local.webm');
    },
  );
});
