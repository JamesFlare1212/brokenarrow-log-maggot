/** Fields omitted by BATrace protobuf JSON represent zero in a complete match response. */
export interface RawTitleUnit {
  Id?: number | string;
  SpawnTime?: number;
  DeathTime?: number;
  BuildingDestroyedCount?: number;
}
export interface RawTitlePlayer {
  [key: string]: unknown;
  Id: string;
  Name?: string;
  TeamId?: number;
  DestructionScore?: number;
  LossesScore?: number;
  ObjectivesCaptured?: number;
  Destruction?: number;
  Losses?: number;
  DamageDealt?: number;
  TotalSpawnedUnitScore?: number;
  TotalRefundedUnitScore?: number;
  SupplyCapturedByEnemy?: number;
  SupplyCaptured?: number;
  SupplyPointsConsumedByAllies?: number;
  SupplyPointsConsumed?: number;
  SupplyPointsConsumedFromAllies?: number;
  SupplyAirdropped?: number;
  DestructionFriendlyFireCost?: number;
  LossesByFriendlyFireScore?: number;
  Deserter?: boolean;
  UnitData?: Record<string, RawTitleUnit>;
}
export interface RawTitleMatch {
  StartTime?: number;
  TotalPlayTimeInSec?: number;
  Data?: Record<string, RawTitlePlayer>;
}
export type UnitMap = Record<string, readonly [string | null, number]>;
