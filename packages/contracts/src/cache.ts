export interface CacheUsage {
  entries: number;
  expired: number;
  bytes: number;
}

export interface CacheStats {
  at: number;
  nextExpiryAt: number | null;
  api: CacheUsage;
  snapshots: CacheUsage;
}

export type CacheClearMode = 'expired' | 'all';
