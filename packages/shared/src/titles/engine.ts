// Adapted from ba-dragon; see THIRD_PARTY_NOTICES.txt for the MIT license.
import type { MatchTitle } from '@ba/contracts';
import { number } from '../values';
import model from './model.json';
import type { RawTitleMatch as MatchInfo, RawTitlePlayer as PlayerData, UnitMap } from './types';
const num = (value: unknown): number => number(value) ?? 0;
const MODEL = model as typeof model & { units: UnitMap };

export type TitleKind = 'good' | 'bad' | 'neutral';

export const TITLES: Record<MatchTitle['id'], TitleKind> = {
  carry: 'good',
  blame: 'bad',
  deserter: 'bad',
  tryhard: 'good',
  passenger: 'bad',
  lonewolf: 'good',
  reaper: 'good',
  untouched: 'good',
  landlord: 'good',
  artygod: 'good',
  bandit: 'good',
  canteen: 'good',
  weightlifter: 'neutral',
  killsteal: 'neutral',
  demolition: 'neutral',
  courier: 'neutral',
  refund: 'neutral',
  backstabbed: 'neutral',
  atm: 'bad',
  scraper: 'bad',
  boxed: 'bad',
  camper: 'bad',
  convoy: 'bad',
  freeloader: 'bad',
  spender: 'bad',
  traitor: 'bad',
  crash: 'bad',
};

export interface TitleMetrics {
  id: string;
  name: string;
  team: number;
  minutes: number;
  D: number;
  L: number;
  O: number;
  kills: number;
  deaths: number;
  dmg: number;
  kd: number;
  dShare: number;
  lShare: number;
  lTeamShare: number;
  dTeamRatio: number;
  oTeamShare: number;
  killShare: number;
  deathShare: number;
  dmgShare: number;
  ksEff: number;
  lifeMed: number | null;
  spawnShare: number;
  refundRatio: number;
  convoy: number;
  bandit: number;
  canteen: number;
  freeloader: number;
  airdrop: number;
  ffDestroyCost: number;
  ffLossScore: number;
  airLoss: number;
  buildings: number;
  artyShare: number;
  deserter: boolean;
  lastSpawnFrac: number | null;
  silent: boolean;

  gone?: boolean;
  impact?: number;
  mvp?: boolean;
  blame?: boolean;
}

interface Spec {
  id: MatchTitle['id'];
  key: (m: TitleMetrics) => number | null;
  dir: 1 | -1;
  filter?: (m: TitleMetrics) => boolean;

  pool?: 'all';
  target: number;
  min?: number;
  params: (m: TitleMetrics) => Record<string, string | number | boolean>;
}

const teamOf = (p: PlayerData): number => (p.TeamId == null ? 0 : Number(p.TeamId));
const median = (a: number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};
const r2 = (x: number): number => Math.round(x * 100) / 100;
const pct = (x: number): number => Math.round(x * 100);

export const MAX_TITLES = 2;
const PLAYERS_PER_MATCH = 10;
const DEFAULT_FREQ: Record<string, number> = {
  carry: 1,
  blame: 0.72,
  tryhard: 0.16,
  passenger: 0.1,
  lonewolf: 0.16,
};
const freqOf = (id: string): number =>
  ((MODEL.titleFreq as Record<string, number>)[id] ?? DEFAULT_FREQ[id] ?? 0.1) / PLAYERS_PER_MATCH;

function rarityOf(s: Spec, v: number, th: number): number {
  const d = (MODEL.titleDist as Record<string, { n: number; top: number[] }>)[s.id];
  if (d && d.n) {
    const k = d.top.filter((x) => s.dir * (x - v) >= 0).length;
    return Math.max(k, 0.5) / d.n / PLAYERS_PER_MATCH;
  }

  const ratio = s.dir > 0 ? (th > 0 ? v / th : 3) : v > 0 ? th / v : 3;
  return s.target / Math.max(ratio, 1) / PLAYERS_PER_MATCH;
}

export const SPECS: Spec[] = [
  {
    id: 'reaper',
    key: (m) => m.dShare,
    dir: 1,
    target: 0.15,
    min: 0.15,
    params: (m) => ({ p: pct(m.dShare) }),
  },
  {
    id: 'untouched',
    key: (m) => m.lTeamShare,
    dir: -1,
    filter: (m) => m.dTeamRatio >= 1,
    target: 0.12,
    params: (m) => ({ p: pct(m.lTeamShare), x: r2(m.dTeamRatio) }),
  },
  {
    id: 'weightlifter',
    key: (m) => Math.min(m.killShare, m.deathShare),
    dir: 1,
    filter: (m) => m.kd >= 0.75 && m.kd <= 1.33,
    target: 0.12,
    min: 0.1,
    params: (m) => ({ k: m.kills, d: m.deaths, kd: r2(m.kd) }),
  },
  {
    id: 'atm',
    key: (m) => m.lShare,
    dir: 1,
    filter: (m) => m.kd < 0.5,
    target: 0.12,
    min: 0.1,
    params: (m) => ({ p: pct(m.lShare), kd: r2(m.kd) }),
  },
  {
    id: 'scraper',
    key: (m) => m.dmgShare,
    dir: 1,
    filter: (m) => m.dTeamRatio < 0.8,
    target: 0.1,
    min: 0.1,
    params: (m) => ({ p: pct(m.dmgShare), x: r2(m.dTeamRatio) }),
  },
  {
    id: 'killsteal',
    key: (m) => m.ksEff,
    dir: 1,
    filter: (m) => m.dTeamRatio >= 1 && m.dmg > 0,
    target: 0.08,
    params: (m) => ({ x: Math.round(m.ksEff) }),
  },
  {
    id: 'boxed',
    key: (m) => m.lifeMed,
    dir: -1,
    filter: (m) => m.lifeMed != null && m.deaths >= 10,
    target: 0.1,
    params: (m) => ({ s: Math.round(m.lifeMed || 0) }),
  },
  {
    id: 'camper',
    key: (m) => m.lTeamShare,
    dir: -1,
    filter: (m) => m.dTeamRatio <= 0.5 && m.minutes >= 10,
    target: 0.1,
    params: (m) => ({ p: pct(m.lTeamShare), x: r2(m.dTeamRatio) }),
  },

  {
    id: 'landlord',
    key: (m) => m.oTeamShare + m.O / 1000,
    dir: 1,
    filter: (m) => m.O >= 3,
    target: 0.12,
    min: 0.3,
    params: (m) => ({ n: m.O, p: pct(m.oTeamShare) }),
  },
  {
    id: 'demolition',
    key: (m) => m.buildings + m.D / 1e7,
    dir: 1,
    target: 0.08,
    min: 3,
    params: (m) => ({ n: m.buildings }),
  },
  {
    id: 'convoy',
    key: (m) => m.convoy,
    dir: 1,
    pool: 'all',
    target: 0.1,
    min: 100,
    params: (m) => ({ n: Math.round(m.convoy) }),
  },
  {
    id: 'bandit',
    key: (m) => m.bandit,
    dir: 1,
    target: 0.1,
    min: 100,
    params: (m) => ({ n: Math.round(m.bandit) }),
  },
  {
    id: 'canteen',
    key: (m) => m.canteen,
    dir: 1,
    target: 0.1,
    min: 500,
    params: (m) => ({ n: Math.round(m.canteen) }),
  },
  {
    id: 'freeloader',
    key: (m) => m.freeloader,
    dir: 1,
    target: 0.1,
    min: 500,
    params: (m) => ({ n: Math.round(m.freeloader) }),
  },
  {
    id: 'courier',
    key: (m) => m.airdrop,
    dir: 1,
    target: 0.08,
    min: 500,
    params: (m) => ({ n: Math.round(m.airdrop) }),
  },
  {
    id: 'refund',
    key: (m) => m.refundRatio,
    dir: 1,
    target: 0.08,
    min: 0.1,
    params: (m) => ({ p: pct(m.refundRatio) }),
  },
  {
    id: 'spender',
    key: (m) => m.spawnShare,
    dir: 1,
    filter: (m) => m.dTeamRatio < 0.7,
    target: 0.1,
    min: 0.12,
    params: (m) => ({ p: pct(m.spawnShare), x: r2(m.dTeamRatio) }),
  },
  {
    id: 'traitor',
    key: (m) => m.ffDestroyCost,
    dir: 1,
    pool: 'all',
    target: 0.06,
    min: 100,
    params: (m) => ({ n: Math.round(m.ffDestroyCost) }),
  },
  {
    id: 'backstabbed',
    key: (m) => m.ffLossScore,
    dir: 1,
    pool: 'all',
    target: 0.06,
    min: 100,
    params: (m) => ({ n: Math.round(m.ffLossScore) }),
  },
  {
    id: 'crash',
    key: (m) => m.airLoss,
    dir: 1,
    target: 0.1,
    min: 300,
    params: (m) => ({ n: Math.round(m.airLoss) }),
  },
  {
    id: 'artygod',
    key: (m) => m.dShare,
    dir: 1,
    filter: (m) => m.artyShare >= 0.3,
    target: 0.08,
    min: 0.12,
    params: (m) => ({ p: pct(m.dShare), a: pct(m.artyShare) }),
  },
];

export const DEFAULT_T: Record<string, number> = {
  objValue: 0,
  reaper: 0.2,
  untouched: 0.05,
  weightlifter: 0.16,
  atm: 0.18,
  scraper: 0.17,
  killsteal: 12,
  boxed: 45,
  camper: 0.05,
  landlord: 0.5,
  demolition: 8,
  convoy: 1500,
  bandit: 1500,
  canteen: 8000,
  freeloader: 8000,
  courier: 3000,
  refund: 0.35,
  spender: 0.16,
  traitor: 400,
  backstabbed: 400,
  crash: 3000,
  artygod: 0.2,
};
const thresholds = (): Record<string, number> => ({ ...DEFAULT_T, ...(MODEL.titles || {}) });

export function titleMetrics(mi: MatchInfo, unitMap?: UnitMap): TitleMetrics[] {
  const um = unitMap || MODEL.units || {};
  const all = Object.values(mi?.Data || {}).filter((p) => teamOf(p) === 0 || teamOf(p) === 1);
  const start = num(mi?.StartTime);
  const dur = num(mi?.TotalPlayTimeInSec);
  const sumAll = (k: keyof PlayerData): number => all.reduce((s, p) => s + num(p[k]), 0);
  const tot = {
    D: sumAll('DestructionScore'),
    K: sumAll('Destruction'),
    Dth: sumAll('Losses'),
    L: sumAll('LossesScore'),
    dmg: sumAll('DamageDealt'),
    spawned: sumAll('TotalSpawnedUnitScore'),
  };
  const teamTot: Record<number, { n: number; D: number; L: number; O: number }> = {};
  for (const t of [0, 1]) {
    const team = all.filter((p) => teamOf(p) === t);
    teamTot[t] = {
      n: team.length || 1,
      D: team.reduce((s, p) => s + num(p.DestructionScore), 0),
      L: team.reduce((s, p) => s + num(p.LossesScore), 0),
      O: team.reduce((s, p) => s + num(p.ObjectivesCaptured), 0),
    };
  }
  return all.map((p) => {
    const units = Object.values(p.UnitData || {});
    const spawns = units.map((u) => num(u.SpawnTime)).filter(Boolean);
    const lastSpawnFrac =
      spawns.length && start && dur
        ? Math.max(0, Math.min(1, (Math.max(...spawns) - start) / dur))
        : null;
    const lives = units
      .filter((u) => u.DeathTime && u.SpawnTime)
      .map((u) => num(u.DeathTime) - num(u.SpawnTime))
      .filter((x) => x >= 0);
    let airLoss = 0;
    let artyCost = 0;
    let cost = 0;
    let buildings = 0;
    for (const u of units) {
      buildings += num(u.BuildingDestroyedCount);
      const e = um[String(u.Id)];
      if (!e || !e[0]) continue;
      cost += e[1];
      if (e[0] === 'arty') artyCost += e[1];
      if ((e[0] === 'heli' || e[0] === 'jet') && u.DeathTime) airLoss += e[1];
    }
    const tt = teamTot[teamOf(p)]!;
    const D = num(p.DestructionScore);
    const L = num(p.LossesScore);
    const O = num(p.ObjectivesCaptured);
    return {
      id: String(p.Id),
      name: p.Name || '',
      team: teamOf(p),
      minutes: dur / 60,
      D,
      L,
      O,
      kills: num(p.Destruction),
      deaths: num(p.Losses),
      dmg: num(p.DamageDealt),
      kd: L > 0 ? D / L : D > 0 ? 10 : 1,
      dShare: tot.D ? D / tot.D : 0,
      lShare: tot.L ? L / tot.L : 0,
      lTeamShare: tt.L ? L / tt.L : 0,
      dTeamRatio: tt.D ? D / (tt.D / tt.n) : 0,
      oTeamShare: tt.O ? O / tt.O : 0,
      killShare: tot.K ? num(p.Destruction) / tot.K : 0,
      deathShare: tot.Dth ? num(p.Losses) / tot.Dth : 0,
      dmgShare: tot.dmg ? num(p.DamageDealt) / tot.dmg : 0,
      ksEff: num(p.DamageDealt) > 0 ? D / num(p.DamageDealt) : 0,
      lifeMed: lives.length >= 8 ? median(lives) : null,
      spawnShare: tot.spawned ? num(p.TotalSpawnedUnitScore) / tot.spawned : 0,
      refundRatio:
        num(p.TotalSpawnedUnitScore) > 0
          ? num(p.TotalRefundedUnitScore) / num(p.TotalSpawnedUnitScore)
          : 0,
      convoy: num(p.SupplyCapturedByEnemy),
      bandit: num(p.SupplyCaptured),
      canteen: num(p.SupplyPointsConsumedByAllies),
      freeloader: num(p.SupplyPointsConsumedFromAllies),
      airdrop: num(p.SupplyAirdropped),
      ffDestroyCost: num(p.DestructionFriendlyFireCost),
      ffLossScore: num(p.LossesByFriendlyFireScore),
      airLoss,
      buildings,
      artyShare: cost ? artyCost / cost : 0,
      deserter: !!p.Deserter,
      lastSpawnFrac,
      silent: D + L === 0,
    };
  });
}

export const isGone = (m: TitleMetrics): boolean =>
  m.silent ||
  (m.deserter && (m.lastSpawnFrac == null || m.lastSpawnFrac < 0.85)) ||
  (m.lastSpawnFrac != null && m.lastSpawnFrac < 0.4 && m.dTeamRatio < 0.15);

export const absenceOf = (m: TitleMetrics): number =>
  m.silent ? 1 : m.lastSpawnFrac != null ? 1 - m.lastSpawnFrac : 1;

const livePool = (ms: TitleMetrics[]): TitleMetrics[] =>
  ms.filter((x) => !x.gone && x.minutes >= 8);
const poolFor = (ms: TitleMetrics[], s: Spec): TitleMetrics[] =>
  (s.pool === 'all' ? ms : livePool(ms)).filter((x) => !s.filter || s.filter(x));
function bestOf(pool: TitleMetrics[], s: Spec): TitleMetrics | null {
  let best: TitleMetrics | null = null;
  for (const m of pool) {
    const v = s.key(m);
    if (v == null || !Number.isFinite(v)) continue;
    if (!best || s.dir * (v - (s.key(best) as number)) > 0) best = m;
  }
  return best;
}

export type Title = MatchTitle;
export interface TitleAward {
  titles: Title[];

  candidates: string[];
  mvp: boolean;
  blame: boolean;
  gone: boolean;
  absence: number;
  impact: number;
}

export function awardTitles(
  mi: MatchInfo,
  opts: {
    winnerTeam?: number | null;
    unitMap?: UnitMap;
    thresholds?: Record<string, number>;
    maxTitles?: number;
    excluded?: ReadonlySet<MatchTitle['id']>;
  } = {},
): Record<string, TitleAward> {
  const t = { ...thresholds(), ...(opts.thresholds || {}) };
  const ms = titleMetrics(mi, opts.unitMap);
  const out: Record<string, TitleAward> = {};
  if (!ms.length || new Set(ms.map((m) => m.id)).size !== ms.length) return out;
  const cand: {
    pid: string;
    title: MatchTitle['id'];
    p: number;
    params: Record<string, string | number | boolean>;
  }[] = [];

  const give = (
    m: TitleMetrics,
    title: MatchTitle['id'],
    p: number,
    params?: Record<string, string | number | boolean>,
  ): void => {
    cand.push({ pid: m.id, title, p, params: params || {} });
  };

  for (const m of ms) {
    m.gone = isGone(m);
    m.impact = m.D - m.L + (t.objValue || 0) * m.O;
  }
  const netParams = (m: TitleMetrics): Record<string, number> => ({
    d: Math.round(m.D),
    l: Math.round(m.L),
    net: Math.round(m.impact || 0),
  });
  const byImpact = [...ms].sort((a, b) => (b.impact || 0) - (a.impact || 0));
  const rankOf = (m: TitleMetrics): number => byImpact.indexOf(m) + 1;

  for (const m of ms) {
    if (m.gone) {
      give(m, 'deserter', -1, {
        reason: m.silent ? 'silent' : m.deserter ? 'deserter' : 'inactive',
        min: Math.round((m.lastSpawnFrac ?? 0) * m.minutes),
      });
    }
  }

  const W = opts.winnerTeam;
  if (W === 0 || W === 1) {
    const win = ms.filter((m) => m.team === W && !m.gone);
    const lose = ms.filter((m) => m.team !== W);
    const best = [...win].sort((a, b) => (b.impact || 0) - (a.impact || 0))[0];
    if (best) {
      best.mvp = true;
      give(best, 'carry', freqOf('carry'), netParams(best));
    }

    const loseGone = lose.filter((m) => m.gone);
    if (loseGone.length) {
      for (const m of loseGone) m.blame = true;
    } else {
      const worst = [...lose].sort((a, b) => (a.impact || 0) - (b.impact || 0))[0];
      if (worst) {
        worst.blame = true;
        give(worst, 'blame', freqOf('blame'), netParams(worst));
      }
    }

    const loseBest = [...lose.filter((m) => !m.gone)].sort(
      (a, b) => (b.impact || 0) - (a.impact || 0),
    )[0];
    if (loseBest && rankOf(loseBest) === 1)
      give(loseBest, 'tryhard', freqOf('tryhard'), netParams(loseBest));

    const winWorst = [...win].sort((a, b) => (a.impact || 0) - (b.impact || 0))[0];
    const lastLive = byImpact.filter((m) => !m.gone).pop();
    if (winWorst && winWorst !== best && (winWorst.impact || 0) < 0 && winWorst === lastLive) {
      give(winWorst, 'passenger', freqOf('passenger'), netParams(winWorst));
    }
  }

  for (const team of [0, 1]) {
    const mates = ms.filter((m) => m.team === team);
    const goneN = mates.filter((m) => m.gone).length;
    if (!goneN) continue;
    const top = mates.filter((m) => !m.gone).sort((a, b) => (b.impact || 0) - (a.impact || 0))[0];
    if (top && rankOf(top) <= 3) give(top, 'lonewolf', freqOf('lonewolf'), { n: goneN });
  }

  for (const s of SPECS) {
    if (opts.excluded?.has(s.id)) continue;
    const th = t[s.id];
    if (th == null) continue;
    const best = bestOf(poolFor(ms, s), s);
    if (!best) continue;
    const v = s.key(best);
    if (v == null || !Number.isFinite(v)) continue;
    if (s.dir > 0 ? v < th : v > th) continue;
    give(best, s.id, rarityOf(s, v, th), s.params(best));
  }

  const byPlayer: Record<string, typeof cand> = {};
  for (const c of cand) (byPlayer[c.pid] ||= []).push(c);
  for (const m of ms) {
    const list = (byPlayer[m.id] || []).sort((a, b) => a.p - b.p);
    out[m.id] = {
      titles: list
        .slice(0, opts.maxTitles ?? MAX_TITLES)
        .map((c) => ({ id: c.title, kind: TITLES[c.title], params: c.params })),
      candidates: list.map((c) => c.title),
      mvp: !!m.mvp,
      blame: !!m.blame,
      gone: !!m.gone,
      absence: m.gone ? absenceOf(m) : 0,
      impact: Math.round(m.impact || 0),
    };
  }
  return out;
}
