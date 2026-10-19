export interface CacheUsage {
  entries: number;
  expired: number;
  bytes: number;
}

export interface CacheStats {
  api: CacheUsage;
  snapshots: CacheUsage;
}

export type CacheClearMode = 'expired' | 'all';
