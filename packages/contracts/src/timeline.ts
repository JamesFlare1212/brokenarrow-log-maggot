/** Calibrated deployment/loss estimates, not a replay or measured field strength. */
export interface TimelineSortie {
  id: string;
  playerId: string;
  player: string;
  team: number;
  unit: string;
  role: string | null;
  spawn: number;
  death: number | null;
  refunded: boolean;
  kills: number;
  damage: number;
  cost: number;
  lossCost: number;
}

export type TimelineEventType =
  'short-multikill' | 'rapid-death' | 'loss-burst' | 'loss-peak' | 'recon-deployment';

export interface TimelineMoment {
  id: string;
  kind: 'highlight' | 'loss' | 'recon';
  eventType: TimelineEventType;
  team: number;
  playerId: string | null;
  player: string;
  start: number;
  end: number;
  value: number;
  /** Recorded unit name for individual events; empty for aggregate loss events. */
  unit: string;
  sorties: TimelineSortie[];
  weight: number;
}

export interface TimelinePoint {
  second: number;
  alpha: number;
  bravo: number;
  difference: number;
  alphaChange: number;
  bravoChange: number;
  alphaLoss: number;
  bravoLoss: number;
}

export interface TimelinePlayer {
  id: string;
  name: string;
  team: number;
}

export interface TimelineData {
  duration: number;
  /** Bucket-end values and losses in (previous boundary, boundary]. */
  points: TimelinePoint[];
  /** Integer-second snapshots, plus the exact final time for fractional durations. */
  frames: TimelinePoint[];
  sorties: TimelineSortie[];
  moments: TimelineMoment[];
  players: TimelinePlayer[];
}

export type MatchTimelineResult = (
  | { status: 'ready'; reason: null; data: TimelineData }
  | {
      status: 'unavailable';
      reason: 'missing-unit-data' | 'invalid-time' | 'unsupported-mode';
      data: null;
    }
) & {
  source: 'network' | 'cache' | 'stale' | 'local';
  updatedAt: number | null;
};
