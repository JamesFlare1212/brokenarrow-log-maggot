import { describe, expect, it } from 'vitest';
import { BATRACE_ORIGIN } from '@ba/contracts';
import { formatTime } from '@ba/shared';
import { formatPlayerSummary } from '../apps/web/src/features/players/report-summary';

const player = {
  name: 'Player One',
  id: '123',
  elo: 1650,
  kd: 0,
  dmr: 1.5,
  winRate: 75,
  wins: 3,
  losses: 1,
  sampleCount: 4,
  fallback: false,
  stale: false,
  updatedAt: 1700000000000,
  favUnits: ['A', '', 'A', 'B', 'C', 'D'].map((name) => ({
    name,
    spawn: null,
    value: null,
    roi: null,
  })),
};
const url = `${BATRACE_ORIGIN}/player/123`;

describe('player summary clipboard text', () => {
  it('groups Chinese report metrics and limits highlight units in source order', () => {
    expect(formatPlayerSummary(player, 'zh')).toBe(
      [
        'Player One #123 · ELO 1,650',
        '近期胜率 75%（3 胜 / 1 负）',
        '最近一场：K/D 0 · DMR 1.5',
        '高光单位：A、B、C…',
        url,
      ].join('\n'),
    );
  });
  it('distinguishes fallback win rate, keeps zeroes and flags stale records', () => {
    expect(
      formatPlayerSummary(
        {
          ...player,
          fallback: true,
          stale: true,
          kd: null,
          dmr: null,
          favUnits: [],
          wins: 0,
          losses: 4,
          winRate: 0,
        },
        'en',
      ),
    ).toBe(
      [
        'Player One #123 · ELO 1,650',
        'Win rate: 0% (0W / 4L)',
        `Cached data may be outdated · ${formatTime(player.updatedAt, 'en')}`,
        url,
      ].join('\n'),
    );
  });
  it('omits unavailable metrics instead of empty separators or an unknown percentage', () => {
    expect(
      formatPlayerSummary(
        {
          ...player,
          name: ' Player\nOne ',
          elo: null,
          sampleCount: 0,
          winRate: null,
          kd: null,
          dmr: null,
          favUnits: [],
        },
        'zh',
      ),
    ).toBe(`Player One #123\n${url}`);
  });
});
