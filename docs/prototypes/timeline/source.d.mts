import type { RawMatch, UnitCatalog } from './model';
export function loadSource(): {
  match: RawMatch;
  catalog: UnitCatalog;
  provenance: {
    matchId: string;
    map: string;
    capturedAt: number;
    shard: string;
    sha256: string;
    names: string;
    prices: string;
  };
};
