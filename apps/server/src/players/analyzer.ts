import type { MaggotReport, MaggotRow, MiniInfo, PlayerReport } from '@ba/contracts';
import {
  array,
  object,
  number,
  text,
  timestamp,
  team,
  summarizeMaggot,
  MAP_NAMES,
} from '@ba/shared';
import type { Database } from '../storage/database';
import type { BatraceClient } from '../network/client';
export class Analyzer {
  private maggotPending = new Set<string>();
  constructor(
    private client: BatraceClient,
    private db: Database,
  ) {}
  async report(id: string, force = false): Promise<PlayerReport> {
    const name = this.db.player(id)?.name || id;
    try {
      const response = await this.client.analysisPlayer(id, force),
        a = object(response.value);
      if (a.matchCount == null && !Array.isArray(object(a.trend).points))
        throw new Error('No analysis');
      const points = array(object(a.trend).points).map(object),
        latest = points.at(-1) || {},
        wins = points.filter((p) => p.won === true).length;
      const maps = array(a.mapPerformance).map(object);
      for (const map of maps) {
        const mapId = number(map.mapId),
          name = text(map.mapName);
        if (mapId !== null && name) {
          MAP_NAMES[mapId] = name;
          this.db.sql
            .prepare(
              'INSERT INTO map_names VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',
            )
            .run(mapId, name);
        }
      }
      const report: PlayerReport = {
        id,
        name,
        level: null,
        fallback: false,
        matchCount: number(a.matchCount) ?? points.length,
        elo: number(latest.ratingAfter),
        kd: number(latest.kdRatio),
        dmr: number(latest.dmr),
        winRate: points.length ? Math.round((wins / points.length) * 100) : null,
        wins,
        losses: points.filter((p) => p.won === false).length,
        updatedAt: response.at,
        stale: response.source === 'stale',
        recentMatches: points
          .slice(-12)
          .reverse()
          .map((p) => ({
            matchId: text(p.matchId),
            won: typeof p.won === 'boolean' ? p.won : null,
            eloDelta:
              number(p.ratingAfter) !== null && number(p.ratingBefore) !== null
                ? Number(p.ratingAfter) - Number(p.ratingBefore)
                : null,
            kd: number(p.kdRatio),
            dmr: number(p.dmr),
            destruction: number(p.destructionScore),
            losses: number(p.lossesScore),
            objectives: number(p.objectivesCaptured),
            endTime: timestamp(p.endTime),
          })),
        favUnits: array(a.highlightUnits)
          .slice(0, 3)
          .map(object)
          .map((u) => ({
            name: text(u.unitName, `unit:${u.unitId}`),
            value: number(u.totalDamage),
            spawn: number(u.spawnCount),
            roi: number(u.avgRoi),
          })),
        categories: array(a.categoryPreferences)
          .slice(0, 3)
          .map(object)
          .map((c) => ({ key: text(c.categoryKey), pct: number(c.percentage) })),
        mapStats: maps.map((m) => ({
          mapId: number(m.mapId),
          name: text(m.mapName),
          matchCount: number(m.matchCount) ?? 0,
          winRate: number(m.winRate),
        })),
        style: text(object(a.playStyle).primaryStyle) || null,
      };
      this.db.saveSnapshot(id, this.mini(report));
      return report;
    } catch (analysisError) {
      try {
        const result = await this.client.playerInfo(id),
          raw = object(result.value),
          info = object(raw.info),
          stats = object(raw.statInfo);
        const wins = number(stats.winCountRt) ?? 0,
          losses = number(stats.lossCountRt) ?? 0,
          count = number(stats.fightsCountRt) ?? wins + losses;
        return {
          id,
          name: text(info.name, name),
          level: number(info.level),
          fallback: true,
          matchCount: count,
          elo: number(info.rating),
          kd: null,
          dmr: null,
          winRate: count ? Math.round((wins / count) * 100) : null,
          wins,
          losses,
          updatedAt: result.at,
          stale: result.source === 'stale',
          recentMatches: [],
          favUnits: [],
          categories: [],
          mapStats: [],
          style: null,
        };
      } catch {
        throw analysisError;
      }
    }
  }
  mini(report: PlayerReport): MiniInfo {
    return {
      name: report.name,
      elo: report.elo,
      kd: report.kd,
      winRate: report.winRate,
      matchCount: report.matchCount,
      category: report.categories[0]?.key ?? null,
      topUnits: report.favUnits.map((u) => u.name).join(', '),
      updatedAt: report.updatedAt,
      stale: report.stale,
    };
  }
  async maggot(
    id: string,
    progress: (done: number, scanned: number) => void,
  ): Promise<MaggotReport> {
    if (this.maggotPending.size) throw new Error('A Maggot Index query is already running');
    this.maggotPending.add(id);
    let calls = 0;
    try {
      const a = await this.client.analysisPlayer(id);
      calls += a.attempts ?? 0;
      if (a.source === 'stale') throw new Error('Fresh ranked match data is required');
      const points = array(object(object(a.value).trend).points)
        .map(object)
        .filter(
          (p) =>
            /^\d+$/.test(text(p.matchId)) &&
            number(p.ratingBefore) !== null &&
            number(p.ratingAfter) !== null &&
            Math.abs(Number(p.ratingAfter) - Number(p.ratingBefore)) >= 0.01,
        )
        .slice(-30)
        .reverse();
      const rows: MaggotRow[] = [],
        seen = new Set<string>();
      for (const [i, p] of points.entries()) {
        if (rows.length >= 12) break;
        const matchId = text(p.matchId);
        if (seen.has(matchId)) continue;
        seen.add(matchId);
        try {
          const response = await this.client.analysisMatch(matchId),
            raw = object(response.value),
            mvp = array(raw.mvpRanking).map(object),
            me = mvp.find((p) => text(p.playerId) === id),
            myTeam = me ? team(me.teamId) : null;
          calls += response.attempts ?? 0;
          if (mvp.length < 10 || !me || (myTeam !== 0 && myTeam !== 1)) continue;
          const allies = mvp.filter((p) => team(p.teamId) === myTeam);
          if (allies.length !== 5 || allies.some((p) => number(p.score) === null)) continue;
          const sorted = [...allies].sort((a, b) => Number(b.score) - Number(a.score)),
            rank = sorted.findIndex((p) => text(p.playerId) === id) + 1;
          const economy = array(object(raw.economy).players).map(object),
            stats = allies.map((p) => {
              const e = economy.find((e) => text(e.playerId) === text(p.playerId));
              return {
                id: text(p.playerId),
                kill: e ? number(e.returnValue) : null,
                loss:
                  e && number(e.investment) !== null && number(e.refunded) !== null
                    ? Math.max(0, Number(e.investment) - Number(e.refunded))
                    : null,
              };
            });
          const rankMetric = (kind: 'kill' | 'loss' | 'kd'): number | null => {
            if (stats.some((s) => s.kill === null || s.loss === null)) return null;
            const value = (s: (typeof stats)[number]) =>
              kind === 'kill'
                ? s.kill || 0
                : kind === 'loss'
                  ? s.loss || 0
                  : (s.kill || 0) / (s.loss || 1);
            return (
              [...stats]
                .sort((a, b) => (kind === 'loss' ? value(a) - value(b) : value(b) - value(a)))
                .findIndex((s) => s.id === id) + 1
            );
          };
          rows.push({
            matchId,
            won: typeof p.won === 'boolean' ? p.won : null,
            mvpRank: rank,
            killRank: rankMetric('kill'),
            lossRank: rankMetric('loss'),
            kdRank: rankMetric('kd'),
            eloDelta: Number(p.ratingAfter) - Number(p.ratingBefore),
          });
        } catch (error) {
          if (String(error).includes('quota')) throw error;
        } finally {
          progress(rows.length, i + 1);
        }
      }
      return summarizeMaggot(id, rows, calls);
    } finally {
      this.maggotPending.delete(id);
    }
  }
}
