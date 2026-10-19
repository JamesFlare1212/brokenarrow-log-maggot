export const MATCH_SCORE_LABEL_IDS = [
  'destruction',
  'damage',
  'dlRatio',
  'efficiency',
  'objectives',
  'supply',
] as const;

export type MatchScoreLabelId = (typeof MATCH_SCORE_LABEL_IDS)[number];
export interface MatchScoreLabelEvidence {
  destructionValue?: number | null;
  killed?: number | null;
  damageDealt?: number | null;
  damageReceived?: number | null;
  lossValue?: number | null;
  dlRatio?: number | null;
  investment?: number | null;
  refunded?: number | null;
  roi?: number | null;
  objectivesCaptured?: number | null;
  supplyProvided?: number | null;
}
export interface MatchScoreLabel {
  id: MatchScoreLabelId;
  score: number;
  threshold: number;
  evidence?: MatchScoreLabelEvidence;
}
